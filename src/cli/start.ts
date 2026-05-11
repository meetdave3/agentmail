import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { resolvePaths } from "../shared/config.ts";
import { startServer } from "../server/index.ts";

export async function runStart(argv: string[]): Promise<void> {
  const detach = argv.includes("--detach") || argv.includes("-d");
  const paths = resolvePaths();

  if (existsSync(paths.pidPath)) {
    const pid = parseInt(readFileSync(paths.pidPath, "utf8").trim(), 10);
    if (pid && processAlive(pid)) {
      console.error(chalk.yellow(`bus already running (pid ${pid})`));
      return;
    }
  }

  if (detach) {
    const exe = process.execPath;
    const args = [process.argv[1] ?? "agentbus", "start"];
    const proc = Bun.spawn([exe, ...args], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    proc.unref();
    console.error(chalk.green(`bus started in background (pid ${proc.pid})`));
    return;
  }

  await startServer();
  // Keep the event loop alive — Bun.serve does this implicitly, but be explicit.
  await new Promise(() => {});
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
