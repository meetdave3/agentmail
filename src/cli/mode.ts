import chalk from "chalk";
import { busUrl, readConfig, resolvePaths } from "../shared/config.ts";
import { isAgentMode, isLlmAgent } from "../shared/types.ts";

export async function runMode(argv: string[]): Promise<void> {
  const [agent, mode] = argv;
  if (!isLlmAgent(agent)) {
    throw new Error(`agent must be 'claude' or 'codex' (got: ${agent ?? "<missing>"})`);
  }
  if (!isAgentMode(mode)) {
    throw new Error(`mode must be 'auto' or 'manual' (got: ${mode ?? "<missing>"})`);
  }
  const paths = resolvePaths();
  const config = readConfig(paths);
  const res = await fetch(`${busUrl(config.port)}/api/mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, mode }),
  });
  if (!res.ok) {
    throw new Error(`server returned ${res.status}: ${await res.text()}`);
  }
  console.error(chalk.green(`set ${agent} mode → ${mode}`));
}
