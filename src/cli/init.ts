import chalk from "chalk";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import * as readline from "node:readline/promises";
import {
  defaultConfig,
  pickFreePort,
  readConfig,
  resolvePaths,
  writeConfig,
} from "../shared/config.ts";
import { DEFAULT_PORT } from "../shared/types.ts";

const LLMS_URL =
  "https://raw.githubusercontent.com/meetdave3/agentmail/main/llms.txt";

export async function runInit(): Promise<void> {
  const cwd = process.cwd();
  const paths = resolvePaths(cwd);
  const project = basename(paths.root);

  let resolvedPort: number;
  if (existsSync(paths.configPath)) {
    const existing = readConfig(paths);
    if (existing.port === DEFAULT_PORT) {
      // Legacy artifact: every project used to default to 7777, which meant
      // the MCP clients of unrelated projects all connected to whichever
      // daemon happened to win the bind. Re-roll to a project-specific port.
      const fresh = await pickFreePort();
      writeConfig(paths, { ...existing, port: fresh });
      resolvedPort = fresh;
      console.error(
        chalk.yellow(
          `migrated this project from the shared default port ${DEFAULT_PORT} to ${fresh}.`,
        ),
      );
      console.error(
        chalk.yellow(
          `if a daemon is running here, restart it (\`agentmail stop && agentmail\`) and restart any editor MCP sessions for this project.`,
        ),
      );
    } else {
      resolvedPort = existing.port;
      console.error(chalk.yellow(`agentmail already initialized at ${paths.busDir}`));
    }
  } else {
    resolvedPort = await pickFreePort();
    writeConfig(paths, defaultConfig(resolvedPort));
    console.error(chalk.green(`wrote ${paths.configPath}`));
  }

  const bootstrapPrompt = buildBootstrapPrompt(paths.busDir);

  process.stdout.write(`
${chalk.bold(`agentmail initialized for "${project}"`)}
  mail dir  : ${paths.busDir}
  db        : ${paths.dbPath}
  port      : ${resolvedPort}

${chalk.bold("Wire it up — copy this prompt into Claude Code, Codex, or any MCP-aware agent:")}

${indent(bootstrapPrompt, "  │ ")}

That prompt points the agent at ${chalk.cyan(LLMS_URL)}, which walks
through writing ${chalk.cyan(".mcp.json")}, ${chalk.cyan(".codex/config.toml")}, and the
per-agent instruction sections in ${chalk.cyan("CLAUDE.md")} / ${chalk.cyan("AGENTS.md")}.

`);

  const choice = await promptAgentChoice();
  if (choice === "skip") {
    process.stdout.write(
      `${chalk.dim("skipped — paste the prompt above into your agent of choice when ready.")}\n` +
        `${chalk.dim("after that, run")} ${chalk.cyan("agentmail")} ${chalk.dim("to start the daemon and open the dashboard.")}\n`,
    );
    return;
  }

  process.stdout.write(
    `\n${chalk.dim(`launching ${choice} with the bootstrap prompt …`)}\n` +
      `${chalk.dim(`when it finishes, run`)} ${chalk.cyan("agentmail")} ${chalk.dim("to start the daemon and open the dashboard.")}\n\n`,
  );
  await spawnAgent(choice, bootstrapPrompt, paths.busDir);
}

function buildBootstrapPrompt(absMailDir: string): string {
  return [
    `Wire up agentmail in this project.`,
    ``,
    `1. Read ${LLMS_URL} for the full setup instructions.`,
    `2. Follow it. The agentmail state directory for this project is:`,
    `   ${absMailDir}`,
    `   Use that absolute path as AGENTMAIL_DIR in the MCP server config.`,
    `3. When you finish, summarise what you changed in one line per file.`,
  ].join("\n");
}

async function promptAgentChoice(): Promise<"claude" | "codex" | "skip"> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return "skip";
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (
      await rl.question(
        chalk.bold("Run setup now? ") +
          chalk.dim("[c]laude / co[d]ex / [s]kip ") +
          chalk.dim("(default: skip): "),
      )
    )
      .trim()
      .toLowerCase();
    if (answer === "c" || answer === "claude") return "claude";
    if (answer === "d" || answer === "codex") return "codex";
    return "skip";
  } finally {
    rl.close();
  }
}

function spawnAgent(
  cli: "claude" | "codex",
  prompt: string,
  busDir: string,
): Promise<void> {
  return new Promise((resolvePromise) => {
    const proc = spawn(cli, [prompt], {
      stdio: "inherit",
      env: { ...process.env, AGENTMAIL_DIR: busDir },
    });
    proc.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        process.stderr.write(
          chalk.red(
            `\ncould not launch \`${cli}\` — is it installed and on your PATH?\n`,
          ) + chalk.dim(`paste the prompt above into your agent manually.\n`),
        );
      } else {
        process.stderr.write(
          chalk.red(`\nfailed to launch ${cli}: ${err.message}\n`) +
            chalk.dim(`paste the prompt above into your agent manually.\n`),
        );
      }
      resolvePromise();
    });
    proc.on("exit", () => resolvePromise());
  });
}

function indent(text: string, prefix: string = "      "): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
