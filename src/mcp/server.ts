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
    log(`warning: agentmail daemon not reachable. Run \`agentmail start\` from the project root.`);
    // We still start the MCP server so the agent gets a clean tool error
    // rather than a hard failure to launch.
  }

  const server = new McpServer({
    name: "agentmail",
    version: "0.1.0",
  });

  registerBusTools(server, client, me);

  const transport = new StdioServerTransport();

  // Exit when the parent (Codex / Claude) closes our stdin or signals us.
  // Both are normal MCP-stdio shutdown paths; honouring stdin EOF avoids
  // accumulating orphaned servers when the host can't deliver a signal
  // (e.g. after re-parenting to init).
  let resolveExit: () => void = () => undefined;
  const exitWhen = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  const shutdown = (reason: string) => {
    log(`shutdown: ${reason}`);
    resolveExit();
  };
  process.stdin.once("end", () => shutdown("stdin end"));
  process.stdin.once("close", () => shutdown("stdin close"));
  process.on("SIGTERM", (sig) => shutdown(`signal ${sig}`));
  process.on("SIGINT", (sig) => shutdown(`signal ${sig}`));
  process.on("SIGHUP", (sig) => shutdown(`signal ${sig}`));

  await server.connect(transport);
  log("mcp ready");
  await exitWhen;
  log("mcp exit");
}
