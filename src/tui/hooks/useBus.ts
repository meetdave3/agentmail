import { useEffect, useReducer } from "react";
import { busUrl, busWsUrl } from "../../shared/config.ts";
import type {
  AgentState,
  BusEvent,
  Message,
} from "../../shared/types.ts";

export interface BusState {
  connected: boolean;
  agents: Record<"claude" | "codex", AgentState>;
  pending: Message[];
  log: Message[];
  consumed: Record<string, { by: string; at: number }>;
  releasedIds: Set<string>;
  droppedIds: Set<string>;
}

type Action =
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "snapshot"; agents: AgentState[]; pending: Message[]; log: Message[] }
  | { type: "event"; event: BusEvent };

function initialState(): BusState {
  return {
    connected: false,
    agents: {
      claude: { id: "claude", mode: "manual", status: "", statusTs: 0 },
      codex: { id: "codex", mode: "manual", status: "", statusTs: 0 },
    },
    pending: [],
    log: [],
    consumed: {},
    releasedIds: new Set(),
    droppedIds: new Set(),
  };
}

function reducer(state: BusState, action: Action): BusState {
  switch (action.type) {
    case "connect":
      return { ...state, connected: true };
    case "disconnect":
      return { ...state, connected: false };
    case "snapshot": {
      const next: BusState = {
        ...state,
        agents: { ...state.agents },
        pending: action.pending,
        log: action.log,
      };
      for (const a of action.agents) {
        if (a.id === "claude" || a.id === "codex") {
          next.agents[a.id] = a;
        }
      }
      return next;
    }
    case "event": {
      const ev = action.event;
      switch (ev.kind) {
        case "message:created": {
          const isPending = ev.message.status === "pending";
          return {
            ...state,
            log: [ev.message, ...state.log].slice(0, 500),
            pending: isPending ? [...state.pending, ev.message] : state.pending,
          };
        }
        case "message:released": {
          const newReleased = new Set(state.releasedIds);
          newReleased.add(ev.id);
          return {
            ...state,
            releasedIds: newReleased,
            pending: state.pending.filter((m) => m.id !== ev.id),
            log: state.log.map((m) =>
              m.id === ev.id ? { ...m, status: "released" } : m,
            ),
          };
        }
        case "message:consumed": {
          return {
            ...state,
            consumed: { ...state.consumed, [ev.id]: { by: ev.by, at: Date.now() } },
            log: state.log.map((m) =>
              m.id === ev.id
                ? { ...m, status: "consumed", consumedAt: Date.now() }
                : m,
            ),
          };
        }
        case "message:dropped": {
          const newDropped = new Set(state.droppedIds);
          newDropped.add(ev.id);
          return {
            ...state,
            droppedIds: newDropped,
            pending: state.pending.filter((m) => m.id !== ev.id),
            log: state.log.map((m) =>
              m.id === ev.id ? { ...m, status: "dropped" } : m,
            ),
          };
        }
        case "message:edited": {
          return {
            ...state,
            pending: state.pending.map((m) =>
              m.id === ev.id ? { ...m, edits: [...m.edits, ev.edit] } : m,
            ),
            log: state.log.map((m) =>
              m.id === ev.id ? { ...m, edits: [...m.edits, ev.edit] } : m,
            ),
          };
        }
        case "agent:mode": {
          if (ev.agent !== "claude" && ev.agent !== "codex") return state;
          return {
            ...state,
            agents: {
              ...state.agents,
              [ev.agent]: { ...state.agents[ev.agent], mode: ev.mode },
            },
          };
        }
        case "agent:status": {
          if (ev.agent !== "claude" && ev.agent !== "codex") return state;
          return {
            ...state,
            agents: {
              ...state.agents,
              [ev.agent]: {
                ...state.agents[ev.agent],
                status: ev.status,
                statusTs: ev.statusTs,
              },
            },
          };
        }
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

export function useBus(port: number): BusState {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  useEffect(() => {
    let cancelled = false;
    const base = busUrl(port);

    const loadSnapshot = async () => {
      try {
        const [stateRes, logRes] = await Promise.all([
          fetch(`${base}/api/state`),
          fetch(`${base}/api/log?limit=200`),
        ]);
        if (!stateRes.ok || !logRes.ok) return;
        const stateJson = (await stateRes.json()) as {
          agents: AgentState[];
          pending: Message[];
        };
        const logJson = (await logRes.json()) as { messages: Message[] };
        if (cancelled) return;
        dispatch({
          type: "snapshot",
          agents: stateJson.agents,
          pending: stateJson.pending,
          log: logJson.messages,
        });
      } catch {
        // ignore
      }
    };

    void loadSnapshot();

    const ws = new WebSocket(busWsUrl(port));
    ws.addEventListener("open", () => dispatch({ type: "connect" }));
    ws.addEventListener("close", () => dispatch({ type: "disconnect" }));
    ws.addEventListener("error", () => dispatch({ type: "disconnect" }));
    ws.addEventListener("message", (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data)) as BusEvent | { kind: string };
        if (data.kind === "hello") return;
        dispatch({ type: "event", event: data as BusEvent });
      } catch {
        // ignore
      }
    });

    return () => {
      cancelled = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, [port]);

  return state;
}
