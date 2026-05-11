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
    console.error(chalk.yellow(`agentbus already initialized at ${paths.busDir}`));
  } else {
    writeConfig(paths, defaultConfig());
    console.error(chalk.green(`wrote ${paths.configPath}`));
  }

  const claudeSnippet = JSON.stringify(
    {
      mcpServers: {
        agentbus: {
          command: "bun",
          args: ["x", "agentbus", "mcp", "--as", "claude"],
          env: { AGENTBUS_DIR: paths.busDir },
        },
      },
    },
    null,
    2,
  );

  const codexSnippet = [
    "[mcp_servers.agentbus]",
    'command = "bun"',
    'args = ["x", "agentbus", "mcp", "--as", "codex"]',
    "[mcp_servers.agentbus.env]",
    `AGENTBUS_DIR = "${paths.busDir}"`,
  ].join("\n");

  process.stdout.write(`
${chalk.bold(`agentbus initialized for "${project}"`)}
  bus dir   : ${paths.busDir}
  db        : ${paths.dbPath}

${chalk.bold("Next steps")}
  1. Start the daemon:        ${chalk.cyan("agentbus start")}
  2. Open the dashboard:      ${chalk.cyan("agentbus tui")}
  3. Wire Claude — paste into ${chalk.cyan(".mcp.json")} (project root):

${indent(claudeSnippet)}

  4. Wire Codex — paste into ${chalk.cyan(".codex/config.toml")} (or merge into existing):

${indent(codexSnippet)}

  5. In each agent session, the bus exposes these MCP tools:
       ${chalk.cyan("bus_inbox")}   — list headers of messages awaiting you (no bodies)
       ${chalk.cyan("bus_pull")}    — fetch a single message body by id (spends context)
       ${chalk.cyan("bus_send")}    — send a message to the other agent
       ${chalk.cyan("bus_status")}  — set "what I'm working on" (write-only, no echo)
`);
}

function indent(text: string, prefix: string = "      "): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
