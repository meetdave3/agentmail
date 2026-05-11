import { isLlmAgent } from "../shared/types.ts";

export async function runMcp(argv: string[]): Promise<void> {
  const asIdx = argv.indexOf("--as");
  const asArg = asIdx >= 0 ? argv[asIdx + 1] : undefined;
  if (!isLlmAgent(asArg)) {
    throw new Error("usage: agentbus mcp --as <claude|codex>");
  }
  const { startMcpServer } = await import("../mcp/server.ts");
  await startMcpServer(asArg);
}
