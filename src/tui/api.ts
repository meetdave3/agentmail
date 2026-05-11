import { busUrl } from "../shared/config.ts";
import type { AgentMode } from "../shared/types.ts";

export class TuiApi {
  private base: string;
  constructor(port: number) {
    this.base = busUrl(port);
  }

  async release(id: string): Promise<void> {
    await this.post("/api/release", { id });
  }

  async drop(id: string): Promise<void> {
    await this.post("/api/drop", { id });
  }

  async setMode(agent: "claude" | "codex", mode: AgentMode): Promise<void> {
    await this.post("/api/mode", { agent, mode });
  }

  private async post(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }
  }
}
