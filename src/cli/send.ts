import chalk from "chalk";
import { busUrl, readConfig, resolvePaths } from "../shared/config.ts";
import { isAgentId, isMessageType } from "../shared/types.ts";

/**
 * `agentbus send <to> <type> <title> [body|-]`
 *
 * Intended for human use (the user acts as the sender by default). If the body
 * arg is "-" or omitted, read body from stdin.
 */
export async function runSend(argv: string[]): Promise<void> {
  const [to, type, title, ...bodyArgs] = argv;
  if (!isAgentId(to)) throw new Error("to must be 'claude' | 'codex' | 'user'");
  if (!isMessageType(type)) {
    throw new Error("type must be prompt | report-back | blockers | review-finding | green-light | commit-pr-prompt | note");
  }
  if (!title) throw new Error("title required");

  let body: string;
  const joined = bodyArgs.join(" ").trim();
  if (joined === "" || joined === "-") {
    body = await readStdin();
  } else {
    body = joined;
  }
  if (body.trim() === "") throw new Error("body required (pipe via stdin or pass as arg)");

  const paths = resolvePaths();
  const config = readConfig(paths);
  const res = await fetch(`${busUrl(config.port)}/api/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: "user", to, type, title, body }),
  });
  if (!res.ok) {
    throw new Error(`server returned ${res.status}: ${await res.text()}`);
  }
  const { message } = (await res.json()) as { message: { id: string; status: string } };
  console.error(chalk.green(`sent ${message.id} (status: ${message.status})`));
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
