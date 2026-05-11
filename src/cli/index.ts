import chalk from "chalk";
import { runDefault } from "./default.ts";
import { runInit } from "./init.ts";
import { runStart } from "./start.ts";
import { runStop } from "./stop.ts";
import { runMode } from "./mode.ts";
import { runLog } from "./log.ts";
import { runTui } from "./tui.ts";
import { runMcp } from "./mcp.ts";
import { runSend } from "./send.ts";
import { runStatus } from "./status.ts";

const HELP = `${chalk.bold("agentmail")} — local pull-only message bus between AI coding agents

${chalk.bold("Usage")}
  agentmail                     Start the daemon (if needed) and open the dashboard
  agentmail <command> [options]

${chalk.bold("Commands")}
  ${chalk.dim("(no command)")}                  Init if needed, start the daemon, open the TUI
  init                          Scaffold ./.mail and print MCP snippets
  start [--detach]              Start the agentmail daemon
  stop                          Stop the agentmail daemon
  tui                           Open the Ink dashboard (daemon must be running)
  log [--follow]                Tail the message log
  mode <agent> <auto|manual>    Set an agent's inbound mode
  send <to> <type> <title> [-]  Send a message (body from stdin if "-" or omitted)
  status <agent> <text...>      Set an agent's "working on" status
  mcp --as <claude|codex>       Run the stdio MCP server (used by agent CLIs)
  help                          Show this help

${chalk.bold("Globals")}
  AGENTMAIL_DIR  Override the .mail directory location (default: ./.mail)
`;

export async function runCli(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;

  try {
    switch (cmd) {
      case undefined:
        await runDefault();
        return;
      case "help":
      case "-h":
      case "--help":
        process.stdout.write(HELP);
        return;
      case "init":
        await runInit();
        return;
      case "start":
        await runStart(rest);
        return;
      case "stop":
        await runStop();
        return;
      case "tui":
        await runTui();
        return;
      case "log":
        await runLog(rest);
        return;
      case "mode":
        await runMode(rest);
        return;
      case "send":
        await runSend(rest);
        return;
      case "status":
        await runStatus(rest);
        return;
      case "mcp":
        await runMcp(rest);
        return;
      default:
        console.error(chalk.red(`Unknown command: ${cmd}`));
        process.stdout.write(HELP);
        process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red("error:"), message);
    process.exit(1);
  }
}
