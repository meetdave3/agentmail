// Node-runnable entrypoint for the stdio MCP server.
//
// `agentbus mcp --as <agent>` (a Bun process) re-execs into Node with this
// file as the script. We don't run the MCP server under Bun because Bun
// 1.2.x buffers process.stdout while a stdin "data" listener is active —
// which delays the `initialize` response past Codex's startup_timeout_sec
// and makes Codex give up on the server before it ever sees a reply.
// Node flushes stdout writes immediately and has no such issue.

import { isLlmAgent } from "../shared/types.ts";
import { startMcpServer } from "./server.ts";

const argv = process.argv.slice(2);
const asIdx = argv.indexOf("--as");
const asArg = asIdx >= 0 ? argv[asIdx + 1] : undefined;
if (!isLlmAgent(asArg)) {
  process.stderr.write("usage: mcp-entry --as <claude|codex>\n");
  process.exit(2);
}

await startMcpServer(asArg);
