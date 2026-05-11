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
  await server.connect(transport);
  log("mcp ready");
}
