import chalk from "chalk";
import { busUrl, busWsUrl, readConfig, resolvePaths } from "../shared/config.ts";
import type { BusEvent, Message } from "../shared/types.ts";

function formatLine(m: Message): string {
  const t = new Date(m.ts).toISOString().slice(11, 19);
  const status = m.status === "pending" ? chalk.yellow("HELD")
    : m.status === "released" ? chalk.cyan("RELE")
    : m.status === "consumed" ? chalk.green("READ")
    : chalk.gray("DROP");
  return `${chalk.gray(t)} ${status} ${chalk.bold(m.from)} → ${chalk.bold(m.to)} [${m.type}] ${m.title}`;
}

export async function runLog(argv: string[]): Promise<void> {
  const follow = argv.includes("--follow") || argv.includes("-f");
  const paths = resolvePaths();
  const config = readConfig(paths);

  const res = await fetch(`${busUrl(config.port)}/api/log?limit=100`);
  if (!res.ok) throw new Error(`server returned ${res.status}`);
  const { messages } = (await res.json()) as { messages: Message[] };
  for (const m of [...messages].reverse()) {
    console.log(formatLine(m));
  }
  if (!follow) return;

  const ws = new WebSocket(busWsUrl(config.port));
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("ws failed"));
  });

  ws.onmessage = (ev) => {
    try {
      const event = JSON.parse(String(ev.data)) as BusEvent | { kind: "hello" };
      if (event.kind === "message:created") {
        console.log(formatLine(event.message));
      } else if (event.kind === "message:released") {
        console.log(chalk.cyan(`         RELE  ${event.id}`));
      } else if (event.kind === "message:consumed") {
        console.log(chalk.green(`         READ  ${event.id} by ${event.by}`));
      } else if (event.kind === "agent:mode") {
        console.log(chalk.magenta(`         MODE  ${event.agent} → ${event.mode}`));
      } else if (event.kind === "agent:status") {
        console.log(chalk.gray(`         STAT  ${event.agent}: ${event.status}`));
      }
    } catch {
      // ignore
    }
  };

  await new Promise(() => {});
}
