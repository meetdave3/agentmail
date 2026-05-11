#!/usr/bin/env bun
/**
 * End-to-end verification for agentbus.
 *
 * Spawns its own daemon in a temp directory, talks MCP over stdio as both
 * agents, and verifies:
 *  - manual mode holds messages as pending
 *  - the human can release a pending message
 *  - released messages appear in the recipient's inbox header listing
 *  - bus_pull returns the body and consumes the message
 *  - auto mode delivers immediately
 *  - bus_status writes only — value does not leak into agent context
 *  - return trip codex → claude works symmetrically
 *
 * Exits 0 on full pass, 1 on any failure.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    [k: string]: unknown;
  };
  error?: { code: number; message: string };
}

const BIN = join(import.meta.dir, "..", "bin", "agentbus.ts");

class Reporter {
  private failed = 0;
  private passed = 0;

  ok(label: string): void {
    this.passed++;
    console.log(`[32m✓[0m ${label}`);
  }

  fail(label: string, detail?: string): void {
    this.failed++;
    console.log(`[31m✗[0m ${label}`);
    if (detail) console.log(`  ${detail}`);
  }

  assert(cond: boolean, label: string, detail?: string): void {
    if (cond) this.ok(label);
    else this.fail(label, detail);
  }

  summary(): boolean {
    console.log(`\n${this.passed} passed, ${this.failed} failed`);
    return this.failed === 0;
  }
}

async function mcpCall(
  asAgent: "claude" | "codex",
  busDir: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", [BIN, "mcp", "--as", asAgent], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, AGENTBUS_DIR: busDir },
    });
    let stdout = "";
    let settled = false;
    const finalize = (fn: () => void) => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      fn();
    };
    const targetId = 2;
    const tryResolveFromStdout = () => {
      const lines = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as JsonRpcResponse;
          if (parsed.id === targetId) {
            finalize(() => resolve(parsed));
            return true;
          }
        } catch {
          // skip non-JSON
        }
      }
      return false;
    };
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      tryResolveFromStdout();
    });
    proc.stderr.on("data", () => {
      // discard
    });
    proc.on("error", (err) => finalize(() => reject(err)));
    proc.on("close", () => {
      if (settled) return;
      const lines = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as JsonRpcResponse;
          if (parsed.id === targetId) {
            resolve(parsed);
            return;
          }
        } catch {
          // skip non-JSON
        }
      }
      reject(new Error(`no response for tool call. stdout:\n${stdout}`));
    });

    const init: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e", version: "0" },
      },
    };
    const initialized = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };
    const call: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    };
    proc.stdin.write(JSON.stringify(init) + "\n");
    proc.stdin.write(JSON.stringify(initialized) + "\n");
    proc.stdin.write(JSON.stringify(call) + "\n");
    // Safety: if no response after 3s, give up. The MCP server ignores
    // stdin EOF on purpose (Codex compatibility) so we rely on SIGTERM
    // via finalize() to actually shut it down.
    setTimeout(() => {
      if (settled) return;
      finalize(() => reject(new Error(`mcp timeout. stdout so far:\n${stdout}`)));
    }, 3000);
  });
}

function bodyText(r: JsonRpcResponse): string {
  return r.result?.content?.[0]?.text ?? "";
}

async function http<T>(url: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  const r = new Reporter();
  const tempRoot = mkdtempSync(join(tmpdir(), "agentbus-e2e-"));
  const busDir = join(tempRoot, ".bus");

  // Use a per-run random port so the test doesn't collide with any local
  // daemon (e.g. one running for actual day-to-day use on the default port).
  const port = 20000 + Math.floor(Math.random() * 30000);
  console.log(`temp project: ${tempRoot}  port: ${port}`);

  // init via CLI
  const init = spawn("bun", [BIN, "init"], {
    cwd: tempRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve) => init.on("close", resolve));

  // Override the default port in the generated config so this run is
  // hermetic.
  const configPath = join(busDir, "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { port: number };
  config.port = port;
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  // start daemon in background
  const daemon = spawn("bun", [BIN, "start"], {
    cwd: tempRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, AGENTBUS_DIR: busDir },
  });

  // wait for /api/health
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      const h = await fetch(`${base}/api/health`);
      if (h.ok) break;
    } catch {
      // not yet
    }
    await Bun.sleep(100);
  }
  r.assert(
    (await fetch(`${base}/api/health`).then((res) => res.ok)),
    "daemon responds on /api/health",
  );

  try {
    // (1) claude sends to codex (codex MANUAL by default)
    const sendRes = await mcpCall("claude", busDir, "bus_send", {
      type: "prompt",
      title: "audit auth middleware",
      body: "<objective>review middleware</objective>",
    });
    const sendText = bodyText(sendRes);
    r.assert(
      sendText.includes("status: pending"),
      "claude → codex (manual) yields status=pending",
      `got: ${sendText}`,
    );
    const sentId = sendText.match(/(01[A-Z0-9]{24})/)?.[1] ?? "";

    // (2) codex inbox should be empty (held)
    const inboxHeldRes = await mcpCall("codex", busDir, "bus_inbox", {});
    r.assert(
      bodyText(inboxHeldRes) === "inbox empty",
      "codex inbox is empty while message is held",
      `got: ${bodyText(inboxHeldRes)}`,
    );

    // (3) Human releases via REST
    await http(`${base}/api/release`, "POST", { id: sentId });
    const inboxReleasedRes = await mcpCall("codex", busDir, "bus_inbox", {});
    r.assert(
      bodyText(inboxReleasedRes).includes(sentId),
      "codex inbox shows released message header",
      `got: ${bodyText(inboxReleasedRes)}`,
    );
    r.assert(
      !bodyText(inboxReleasedRes).includes("<objective>"),
      "inbox listing does NOT include the body",
    );

    // (4) codex pulls body
    const pullRes = await mcpCall("codex", busDir, "bus_pull", { id: sentId });
    r.assert(
      bodyText(pullRes).includes("<objective>review middleware</objective>"),
      "bus_pull returns the body",
    );

    // (5) inbox empty after consume
    const inboxAfterRes = await mcpCall("codex", busDir, "bus_inbox", {});
    r.assert(
      bodyText(inboxAfterRes) === "inbox empty",
      "inbox empty after consumption",
    );

    // (6) toggle codex to AUTO and send again — should land immediately
    await http(`${base}/api/mode`, "POST", { agent: "codex", mode: "auto" });
    const autoSendRes = await mcpCall("claude", busDir, "bus_send", {
      type: "note",
      title: "auto test",
      body: "auto body",
    });
    r.assert(
      bodyText(autoSendRes).includes("status: released"),
      "auto-mode send is released immediately",
      `got: ${bodyText(autoSendRes)}`,
    );
    const autoInboxRes = await mcpCall("codex", busDir, "bus_inbox", {});
    r.assert(
      bodyText(autoInboxRes).includes("auto test"),
      "auto-mode message lands directly in codex inbox",
    );

    // (7) return trip codex → claude (claude still MANUAL)
    const returnRes = await mcpCall("codex", busDir, "bus_send", {
      type: "report-back",
      title: "review done",
      body: "lgtm minus one nit",
    });
    r.assert(
      bodyText(returnRes).includes("status: pending"),
      "return trip codex → claude held pending (claude MANUAL)",
      `got: ${bodyText(returnRes)}`,
    );

    // (8) bus_status writes only — confirm no leak in any response
    const statusRes = await mcpCall("codex", busDir, "bus_status", {
      text: "reviewing diff #42",
    });
    r.assert(
      bodyText(statusRes) === "ok",
      "bus_status returns only an ack — no echo into context",
      `got: ${bodyText(statusRes)}`,
    );
    interface StateResp {
      agents: Array<{ id: string; status: string; mode: string }>;
    }
    const state = await http<StateResp>(`${base}/api/state`, "GET");
    const codex = state.agents.find((a) => a.id === "codex");
    r.assert(
      codex?.status === "reviewing diff #42",
      "agent status visible to TUI via /api/state",
    );

    // (9) sending to self is rejected
    const selfRes = await mcpCall("codex", busDir, "bus_send", {
      type: "note",
      title: "self",
      body: "x",
      to: "codex",
    });
    r.assert(
      Boolean(selfRes.result?.isError),
      "cannot send to yourself",
    );
  } catch (err) {
    r.fail("test threw", err instanceof Error ? err.message : String(err));
  } finally {
    daemon.kill("SIGTERM");
    await new Promise((resolve) => daemon.on("close", resolve));
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  const ok = r.summary();
  process.exit(ok ? 0 : 1);
}

await main();
