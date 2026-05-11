import chalk from "chalk";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import {
  defaultConfig,
  resolvePaths,
  writeConfig,
} from "../shared/config.ts";

export async function runInit(): Promise<void> {
  const cwd = process.cwd();
  const paths = resolvePaths(cwd);
  const project = basename(paths.root);

  if (existsSync(paths.configPath)) {
    console.error(chalk.yellow(`agentmail already initialized at ${paths.busDir}`));
  } else {
    writeConfig(paths, defaultConfig());
    console.error(chalk.green(`wrote ${paths.configPath}`));
  }

  const claudeSnippet = JSON.stringify(
    {
      mcpServers: {
        agentmail: {
          command: "agentmail",
          args: ["mcp", "--as", "claude"],
          env: { AGENTMAIL_DIR: paths.busDir },
        },
      },
    },
    null,
    2,
  );

  // Codex's MCP client needs a generous startup_timeout_sec — the default 10s
  // is tight when other MCP servers are starting in parallel. 30s matches
  // what other production MCP entries use (e.g. mongodb-mcp-server).
  const codexSnippet = [
    "[mcp_servers.agentmail]",
    'command = "agentmail"',
    'args = ["mcp", "--as", "codex"]',
    "startup_timeout_sec = 30",
    "",
    "[mcp_servers.agentmail.env]",
    `AGENTMAIL_DIR = "${paths.busDir}"`,
  ].join("\n");

  process.stdout.write(`
${chalk.bold(`agentmail initialized for "${project}"`)}
  mail dir  : ${paths.busDir}
  db        : ${paths.dbPath}

${chalk.bold("Next steps")}
  1. Wire Claude — paste into ${chalk.cyan(".mcp.json")} (project root):

${indent(claudeSnippet)}

  2. Wire Codex — paste into ${chalk.cyan(".codex/config.toml")} (or merge into existing):

${indent(codexSnippet)}

  3. Run ${chalk.cyan("agentmail")} again. The daemon starts in the background and the dashboard opens.

  4. Restart any Claude or Codex sessions you had open before pasting the snippets — they need
     to re-read the MCP config. New sessions started in this directory will see five mail tools:
       ${chalk.cyan("mail_inbox")}   — list headers of messages awaiting you (no bodies)
       ${chalk.cyan("mail_wait")}    — block until a new message arrives (long-poll, no busy-loop)
       ${chalk.cyan("mail_pull")}    — fetch a single message body by id (spends context)
       ${chalk.cyan("mail_send")}    — send a message to the other agent
       ${chalk.cyan("mail_status")}  — set "what I'm working on" (write-only, no echo)
`);
}

function indent(text: string, prefix: string = "      "): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
