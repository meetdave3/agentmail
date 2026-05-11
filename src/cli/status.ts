import chalk from "chalk";
import { busUrl, readConfig, resolvePaths } from "../shared/config.ts";
import { isLlmAgent } from "../shared/types.ts";

export async function runStatus(argv: string[]): Promise<void> {
  const [agent, ...rest] = argv;
  if (!isLlmAgent(agent)) throw new Error("agent must be 'claude' or 'codex'");
  const text = rest.join(" ").trim();
  const paths = resolvePaths();
  const config = readConfig(paths);
  const res = await fetch(`${busUrl(config.port)}/api/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, status: text }),
  });
  if (!res.ok) throw new Error(`server returned ${res.status}: ${await res.text()}`);
  console.error(chalk.green(`set ${agent} status`));
}
