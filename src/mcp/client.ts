import { Agent } from "undici";
import {
  busUrl,
  readConfig,
  resolvePaths,
  type ResolvedPaths,
} from "../shared/config.ts";
import type {
  AgentId,
  InboxEntry,
  Message,
  MessageType,
} from "../shared/types.ts";

// Node's global fetch (undici) defaults to a 5-minute headersTimeout, which
// kills our 30-minute long-poll mid-flight as "fetch failed". This agent is
// used only by wait() to disable both timeouts. Other calls keep the
// defaults — they're short and benefit from the safety net.
const longPollAgent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  keepAliveTimeout: 30 * 60 * 1000,
});

export class BusClient {
  readonly paths: ResolvedPaths;
  private base: string;

  constructor(paths?: ResolvedPaths) {
    this.paths = paths ?? resolvePaths();
    const config = readConfig(this.paths);
    this.base = busUrl(config.port);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.parse<T>(res, `POST ${path}`);
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`);
    return this.parse<T>(res, `GET ${path}`);
  }

  private async parse<T>(res: Response, label: string): Promise<T> {
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const j = JSON.parse(text) as { error?: string };
        if (j.error) detail = j.error;
      } catch {
        // keep raw text
      }
      throw new Error(`${label}: ${res.status} ${detail}`);
    }
    return JSON.parse(text) as T;
  }

  async health(): Promise<boolean> {
    try {
      await this.get<{ ok: boolean }>("/api/health");
      return true;
    } catch {
      return false;
    }
  }

  async inbox(agent: AgentId): Promise<InboxEntry[]> {
    const r = await this.get<{ inbox: InboxEntry[] }>(
      `/api/inbox?agent=${encodeURIComponent(agent)}`,
    );
    return r.inbox;
  }

  async wait(
    agent: AgentId,
    timeoutSec: number,
  ): Promise<{ inbox: InboxEntry[]; timedOut: boolean }> {
    // Use a dedicated dispatcher with no headers/body timeout so the long-poll
    // can outlive Node's 5-minute default. The MCP host's own tool-call
    // timeout is the ultimate ceiling.
    const url = `${this.base}/api/wait?agent=${encodeURIComponent(agent)}&timeoutSec=${timeoutSec}`;
    const res = await fetch(url, {
      // @ts-expect-error: dispatcher is a Node-undici extension; not in lib.dom
      dispatcher: longPollAgent,
    });
    return this.parse<{ inbox: InboxEntry[]; timedOut: boolean }>(res, "GET /api/wait");
  }

  async pull(agent: AgentId, id: string): Promise<Message> {
    const r = await this.post<{ message: Message }>(`/api/pull`, { agent, id });
    return r.message;
  }

  async send(args: {
    from: AgentId;
    to: AgentId;
    type: MessageType;
    title: string;
    body: string;
  }): Promise<Message> {
    const r = await this.post<{ message: Message }>(`/api/send`, args);
    return r.message;
  }

  async status(agent: AgentId, status: string): Promise<void> {
    await this.post<{ ok: boolean }>(`/api/status`, { agent, status });
  }
}
