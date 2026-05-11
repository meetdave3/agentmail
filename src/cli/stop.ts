import chalk from "chalk";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolvePaths } from "../shared/config.ts";

export async function runStop(): Promise<void> {
  const paths = resolvePaths();
  if (!existsSync(paths.pidPath)) {
    console.error(chalk.yellow("no pid file — agentmail not running here"));
    return;
  }
  const pid = parseInt(readFileSync(paths.pidPath, "utf8").trim(), 10);
  if (!pid) {
    console.error(chalk.yellow("pid file empty"));
    unlinkSync(paths.pidPath);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.error(chalk.green(`sent SIGTERM to pid ${pid}`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.yellow(`could not kill pid ${pid}: ${msg}`));
  }
  try {
    unlinkSync(paths.pidPath);
  } catch {
    // already gone, fine
  }
}
