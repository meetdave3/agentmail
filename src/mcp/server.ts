import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ensureBusDir, resolvePaths } from "../shared/config.ts";
import type { AgentId } from "../shared/types.ts";
import { BusClient } from "./client.ts";
import { registerBusTools } from "./tools.ts";

export async function startMcpServer(me: AgentId): Promise<void> {
  const paths = resolvePaths();
  ensureBusDir(paths);

  const log = (...args: unknown[]) => {
    const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
    try {
      appendFileSync(paths.mcpLogPath, line);
    } catch {
      // logging must never crash the MCP server
    }
  };

  log(`mcp start as=${me} bus=${paths.busDir}`);

  const client = new BusClient(paths);
  const reachable = await client.health();
  if (!reachable) {
    log(`warning: bus daemon not reachable. Run \`agentbus start\` from the project root.`);
    // We still start the MCP server so the agent gets a clean tool error
    // rather than a hard failure to launch.
  }

  const server = new McpServer({
    name: "agentbus",
    version: "0.1.0",
  });

  registerBusTools(server, client, me);

  const transport = new StdioServerTransport();

  // Hold the process open until we receive a termination signal. We do NOT
  // exit on transport.onclose — some MCP hosts (notably the Codex CLI) spawn
  // the server with stdin closed or set to /dev/null, and only attach the
  // real pipe once they've sent `initialize`. If we exit on the first
  // stdin EOF, the host sees a startup timeout. Letting the parent SIGTERM
  // us on shutdown is the only signal we trust.
  let resolveExit: () => void = () => undefined;
  const exitWhen = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  transport.onclose = () => {
    log("transport close (ignored — waiting for signal)");
  };
  const onSignal = (sig: NodeJS.Signals) => {
    log(`signal ${sig}`);
    resolveExit();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("SIGHUP", onSignal);

  await server.connect(transport);
  log("mcp ready");
  await exitWhen;
  log("mcp exit");
}
