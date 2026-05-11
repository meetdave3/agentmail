import chalk from "chalk";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import {
  busUrl,
  readConfig,
  resolvePaths,
} from "../shared/config.ts";
import { runInit } from "./init.ts";
import { runStart } from "./start.ts";
import { runTui } from "./tui.ts";

/**
 * `agentmail` with no subcommand — the one-shot entrypoint.
 *
 * 1. If this project has no .bus/ yet → run init and exit. The user pastes
 *    the printed MCP snippets, then runs `agentmail` again.
 * 2. If the daemon isn't running → start it detached.
 * 3. Wait until the daemon is reachable.
 * 4. Launch the TUI (foreground; blocks until quit).
 *
 * The daemon survives TUI exit on purpose: closing the dashboard mid-task
 * must not break agents in flight. Use `agentmail stop` to fully shut down.
 */
export async function runDefault(): Promise<void> {
  const paths = resolvePaths();

  if (!existsSync(paths.configPath)) {
    await runInit();
    console.error(
      chalk.bold(
        `\nFirst-time setup complete. Paste the snippets above, then run \`agentmail\` again.`,
      ),
    );
    return;
  }

  const config = readConfig(paths);
  const url = busUrl(config.port);

  const alreadyHealthy = await isHealthy(url);
  if (!alreadyHealthy) {
    cleanStalePid(paths.pidPath);
    await runStart(["--detach"]);
    const ready = await waitForHealth(url, 5000);
    if (!ready) {
      throw new Error(
        `daemon did not become reachable at ${url} within 5s. Check the daemon logs — try \`agentmail start\` directly to see startup errors.`,
      );
    }
  }

  await runTui();

  console.error(
    chalk.dim(
      `\ndaemon still running in the background. \`agentmail stop\` to shut it down.`,
    ),
  );
}

async function isHealthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(url)) return true;
    await Bun.sleep(100);
  }
  return false;
}

function cleanStalePid(pidPath: string): void {
  if (!existsSync(pidPath)) return;
  const pid = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  if (!pid || !processAlive(pid)) {
    try {
      unlinkSync(pidPath);
    } catch {
      // ignore
    }
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
