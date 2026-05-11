import { Database } from "bun:sqlite";
import {
  type AgentId,
  type AgentMode,
  type AgentState,
  type InboxEntry,
  type Message,
  type MessageEdit,
  type MessageStatus,
  type MessageType,
  isLlmAgent,
} from "../shared/types.ts";

interface MessageRow {
  id: string;
  from_agent: string;
  to_agent: string;
  type: string;
  title: string;
  body: string;
  ts: number;
  status: string;
  edits_json: string;
  consumed_at: number | null;
}

interface AgentRow {
  id: string;
  mode: string;
  status: string;
  status_ts: number;
}

const INBOX_LIMIT = 20;

export class Store {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        ts INTEGER NOT NULL,
        status TEXT NOT NULL,
        edits_json TEXT NOT NULL DEFAULT '[]',
        consumed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_messages_to_status_ts
        ON messages(to_agent, status, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts DESC);

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT '',
        status_ts INTEGER NOT NULL DEFAULT 0
      );
    `);
    // Seed default agent rows if missing.
    const upsert = this.db.prepare(
      "INSERT OR IGNORE INTO agents (id, mode, status, status_ts) VALUES (?, 'manual', '', 0)",
    );
    upsert.run("claude");
    upsert.run("codex");
  }

  close(): void {
    this.db.close();
  }

  private rowToMessage(row: MessageRow): Message {
    const edits = JSON.parse(row.edits_json) as MessageEdit[];
    return {
      id: row.id,
      from: row.from_agent as AgentId,
      to: row.to_agent as AgentId,
      type: row.type as MessageType,
      title: row.title,
      body: row.body,
      ts: row.ts,
      status: row.status as MessageStatus,
      edits,
      consumedAt: row.consumed_at ?? undefined,
    };
  }

  insertMessage(m: Message): void {
    this.db
      .prepare(
        `INSERT INTO messages (id, from_agent, to_agent, type, title, body, ts, status, edits_json, consumed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.id,
        m.from,
        m.to,
        m.type,
        m.title,
        m.body,
        m.ts,
        m.status,
        JSON.stringify(m.edits),
        m.consumedAt ?? null,
      );
  }

  getMessage(id: string): Message | null {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(id) as MessageRow | null;
    return row ? this.rowToMessage(row) : null;
  }

  /** Headers only — bodies are NOT returned. Returns most-recent first. */
  getInboxFor(agent: AgentId): InboxEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, from_agent, type, title, ts FROM messages
         WHERE to_agent = ? AND status = 'released'
         ORDER BY ts DESC
         LIMIT ?`,
      )
      .all(agent, INBOX_LIMIT) as Array<{
      id: string;
      from_agent: string;
      type: string;
      title: string;
      ts: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      from: r.from_agent as AgentId,
      type: r.type as MessageType,
      title: r.title,
      ts: r.ts,
    }));
  }

  /** All pending messages awaiting the user's release (for the TUI). */
  getPending(): Message[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE status = 'pending' ORDER BY ts ASC`,
      )
      .all() as MessageRow[];
    return rows.map((r) => this.rowToMessage(r));
  }

  /** Full activity log for the TUI (all statuses, recent first). */
  getLog(limit: number = 200): Message[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages ORDER BY ts DESC LIMIT ?`,
      )
      .all(limit) as MessageRow[];
    return rows.map((r) => this.rowToMessage(r));
  }

  markReleased(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE messages SET status = 'released' WHERE id = ? AND status = 'pending'`,
      )
      .run(id);
    return result.changes > 0;
  }

  markConsumed(id: string, by: AgentId): boolean {
    const result = this.db
      .prepare(
        `UPDATE messages SET status = 'consumed', consumed_at = ? WHERE id = ? AND to_agent = ? AND status = 'released'`,
      )
      .run(Date.now(), id, by);
    return result.changes > 0;
  }

  markDropped(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE messages SET status = 'dropped' WHERE id = ? AND status IN ('pending', 'released')`,
      )
      .run(id);
    return result.changes > 0;
  }

  editMessageBody(id: string, newBody: string, edit: MessageEdit): boolean {
    const row = this.db
      .prepare("SELECT edits_json FROM messages WHERE id = ?")
      .get(id) as { edits_json: string } | null;
    if (!row) return false;
    const edits = JSON.parse(row.edits_json) as MessageEdit[];
    edits.push(edit);
    const result = this.db
      .prepare(
        `UPDATE messages SET body = ?, edits_json = ? WHERE id = ?`,
      )
      .run(newBody, JSON.stringify(edits), id);
    return result.changes > 0;
  }

  appendEdit(id: string, edit: MessageEdit): boolean {
    const row = this.db
      .prepare("SELECT edits_json FROM messages WHERE id = ?")
      .get(id) as { edits_json: string } | null;
    if (!row) return false;
    const edits = JSON.parse(row.edits_json) as MessageEdit[];
    edits.push(edit);
    const result = this.db
      .prepare(`UPDATE messages SET edits_json = ? WHERE id = ?`)
      .run(JSON.stringify(edits), id);
    return result.changes > 0;
  }

  setAgentStatus(agent: AgentId, status: string): { status: string; statusTs: number } {
    if (!isLlmAgent(agent)) {
      throw new Error("status can only be set for claude or codex");
    }
    const now = Date.now();
    this.db
      .prepare(`UPDATE agents SET status = ?, status_ts = ? WHERE id = ?`)
      .run(status, now, agent);
    return { status, statusTs: now };
  }

  setAgentMode(agent: AgentId, mode: AgentMode): void {
    if (!isLlmAgent(agent)) {
      throw new Error("mode can only be set for claude or codex");
    }
    this.db.prepare(`UPDATE agents SET mode = ? WHERE id = ?`).run(mode, agent);
  }

  getAgentState(agent: AgentId): AgentState {
    if (!isLlmAgent(agent)) {
      return { id: agent, mode: "auto", status: "", statusTs: 0 };
    }
    const row = this.db
      .prepare(`SELECT id, mode, status, status_ts FROM agents WHERE id = ?`)
      .get(agent) as AgentRow | null;
    if (!row) {
      return { id: agent, mode: "manual", status: "", statusTs: 0 };
    }
    return {
      id: row.id as AgentId,
      mode: row.mode as AgentMode,
      status: row.status,
      statusTs: row.status_ts,
    };
  }

  allAgentStates(): AgentState[] {
    return (["claude", "codex"] as const).map((a) => this.getAgentState(a));
  }
}
