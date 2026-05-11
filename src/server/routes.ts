import { Hono } from "hono";
import {
  type AgentId,
  type AgentMode,
  type Message,
  type MessageEdit,
  type MessageType,
  isAgentId,
  isAgentMode,
  isLlmAgent,
  isMessageType,
} from "../shared/types.ts";
import { ulid } from "../shared/ulid.ts";
import type { Store } from "./store.ts";
import { hub } from "./events.ts";

interface SendBody {
  from?: unknown;
  to?: unknown;
  type?: unknown;
  title?: unknown;
  body?: unknown;
}

interface PullBody {
  agent?: unknown;
  id?: unknown;
}

interface StatusBody {
  agent?: unknown;
  status?: unknown;
}

interface ModeBody {
  agent?: unknown;
  mode?: unknown;
}

interface ReleaseBody {
  id?: unknown;
}

interface EditBody {
  id?: unknown;
  body?: unknown;
  note?: unknown;
  by?: unknown;
}

interface DropBody {
  id?: unknown;
}

function trimTitle(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return trimmed.length > 120 ? trimmed.slice(0, 117) + "..." : trimmed;
}

export function createRoutes(store: Store): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

  app.get("/api/state", (c) => {
    const agents = store.allAgentStates();
    const pending = store.getPending();
    return c.json({ agents, pending });
  });

  app.post("/api/send", async (c) => {
    let body: SendBody;
    try {
      body = (await c.req.json()) as SendBody;
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { from, to, type, title, body: msgBody } = body;
    if (!isAgentId(from)) return c.json({ error: "invalid from" }, 400);
    if (!isAgentId(to)) return c.json({ error: "invalid to" }, 400);
    if (from === to) return c.json({ error: "cannot send to self" }, 400);
    if (!isMessageType(type)) return c.json({ error: "invalid type" }, 400);
    if (typeof title !== "string" || title.trim() === "") {
      return c.json({ error: "title required" }, 400);
    }
    if (typeof msgBody !== "string" || msgBody.length === 0) {
      return c.json({ error: "body required" }, 400);
    }

    // Mode gate: if recipient is an LLM agent in MANUAL mode, hold pending.
    let status: Message["status"] = "released";
    if (isLlmAgent(to)) {
      const state = store.getAgentState(to);
      if (state.mode === "manual") status = "pending";
    }

    const message: Message = {
      id: ulid(),
      from,
      to,
      type,
      title: trimTitle(title),
      body: msgBody,
      ts: Date.now(),
      status,
      edits: [],
    };
    store.insertMessage(message);
    hub.broadcast({ kind: "message:created", message });
    return c.json({ message });
  });

  app.get("/api/inbox", (c) => {
    const agent = c.req.query("agent");
    if (!isAgentId(agent)) return c.json({ error: "agent query param required" }, 400);
    return c.json({ inbox: store.getInboxFor(agent) });
  });

  app.post("/api/pull", async (c) => {
    let body: PullBody;
    try {
      body = (await c.req.json()) as PullBody;
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { agent, id } = body;
    if (!isAgentId(agent)) return c.json({ error: "invalid agent" }, 400);
    if (typeof id !== "string") return c.json({ error: "id required" }, 400);

    const msg = store.getMessage(id);
    if (!msg) return c.json({ error: "not found" }, 404);
    if (msg.to !== agent) return c.json({ error: "not addressed to you" }, 403);
    if (msg.status !== "released") {
      return c.json({ error: `message status is ${msg.status}` }, 409);
    }

    const ok = store.markConsumed(id, agent);
    if (!ok) return c.json({ error: "could not consume" }, 409);
    hub.broadcast({ kind: "message:consumed", id, by: agent });
    const updated = store.getMessage(id);
    return c.json({ message: updated });
  });

  app.post("/api/status", async (c) => {
    let body: StatusBody;
    try {
      body = (await c.req.json()) as StatusBody;
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { agent, status } = body;
    if (!isLlmAgent(agent)) return c.json({ error: "invalid agent" }, 400);
    if (typeof status !== "string") return c.json({ error: "status must be string" }, 400);
    const result = store.setAgentStatus(agent as AgentId, status.slice(0, 200));
    hub.broadcast({
      kind: "agent:status",
      agent: agent as AgentId,
      status: result.status,
      statusTs: result.statusTs,
    });
    return c.json({ ok: true, ...result });
  });

  app.post("/api/mode", async (c) => {
    let body: ModeBody;
    try {
      body = (await c.req.json()) as ModeBody;
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { agent, mode } = body;
    if (!isLlmAgent(agent)) return c.json({ error: "invalid agent" }, 400);
    if (!isAgentMode(mode)) return c.json({ error: "invalid mode" }, 400);
    store.setAgentMode(agent as AgentId, mode as AgentMode);
    hub.broadcast({ kind: "agent:mode", agent: agent as AgentId, mode: mode as AgentMode });
    return c.json({ ok: true, agent, mode });
  });

  app.post("/api/release", async (c) => {
    let body: ReleaseBody;
    try {
      body = (await c.req.json()) as ReleaseBody;
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { id } = body;
    if (typeof id !== "string") return c.json({ error: "id required" }, 400);
    const ok = store.markReleased(id);
    if (!ok) return c.json({ error: "could not release (not pending or not found)" }, 409);
    hub.broadcast({ kind: "message:released", id });
    return c.json({ ok: true });
  });

  app.post("/api/edit", async (c) => {
    let body: EditBody;
    try {
      body = (await c.req.json()) as EditBody;
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { id, body: newBody, note, by } = body;
    if (typeof id !== "string") return c.json({ error: "id required" }, 400);
    const byAgent: AgentId = isAgentId(by) ? by : "user";
    const noteStr = typeof note === "string" ? note : "";
    const edit: MessageEdit = { by: byAgent, ts: Date.now(), note: noteStr };
    let ok = false;
    if (typeof newBody === "string") {
      ok = store.editMessageBody(id, newBody, edit);
    } else {
      ok = store.appendEdit(id, edit);
    }
    if (!ok) return c.json({ error: "could not edit (not found)" }, 404);
    hub.broadcast({ kind: "message:edited", id, edit });
    return c.json({ ok: true });
  });

  app.post("/api/drop", async (c) => {
    let body: DropBody;
    try {
      body = (await c.req.json()) as DropBody;
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { id } = body;
    if (typeof id !== "string") return c.json({ error: "id required" }, 400);
    const ok = store.markDropped(id);
    if (!ok) return c.json({ error: "could not drop (already final or not found)" }, 409);
    hub.broadcast({ kind: "message:dropped", id });
    return c.json({ ok: true });
  });

  app.get("/api/log", (c) => {
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 200, 1000) : 200;
    return c.json({ messages: store.getLog(limit) });
  });

  app.get("/api/message/:id", (c) => {
    const id = c.req.param("id");
    const msg = store.getMessage(id);
    if (!msg) return c.json({ error: "not found" }, 404);
    return c.json({ message: msg });
  });

  return app;
}

export type { MessageType, AgentMode };
