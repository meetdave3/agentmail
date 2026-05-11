import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isLlmAgent } from "../shared/types.ts";

// We delegate to a separate Node process (rather than running the MCP server
// in-process under Bun) because Bun 1.2.x buffers process.stdout while a
// stdin "data" listener is active. The MCP SDK installs exactly that
// listener, so under Bun the `initialize` response never reaches Codex
// before its startup_timeout_sec elapses. Node has no such buffering issue.
export async function runMcp(argv: string[]): Promise<void> {
  const asIdx = argv.indexOf("--as");
  const asArg = asIdx >= 0 ? argv[asIdx + 1] : undefined;
  if (!isLlmAgent(asArg)) {
    throw new Error("usage: agentmail mcp --as <claude|codex>");
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, "..", "..", "bin", "mcp-entry.js");
  if (!existsSync(built)) {
    throw new Error(
      `MCP entry not built at ${built}. Run \`bun run build:mcp\` ` +
        `(\`bun install\` will run it automatically via postinstall).`,
    );
  }

  const child = spawn("node", [built, "--as", asArg], { stdio: "inherit" });

  const forward = (sig: NodeJS.Signals) => {
    if (!child.killed) child.kill(sig);
  };
  process.on("SIGTERM", forward);
  process.on("SIGINT", forward);
  process.on("SIGHUP", forward);

  const code: number = await new Promise((resolve) => {
    child.on("exit", (c, sig) => resolve(c ?? (sig ? 128 : 0)));
  });
  process.exit(code);
}
