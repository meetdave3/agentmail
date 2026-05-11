import type { ServerWebSocket } from "bun";
import type { BusEvent } from "../shared/types.ts";

interface WsData {
  id: string;
}

export type BusWs = ServerWebSocket<WsData>;

type EventListener = (event: BusEvent) => void;

class WsHub {
  private clients = new Set<BusWs>();
  private listeners = new Set<EventListener>();

  add(ws: BusWs): void {
    this.clients.add(ws);
  }

  remove(ws: BusWs): void {
    this.clients.delete(ws);
  }

  // In-process subscription used by /api/wait long-polls. Returns an
  // unsubscribe function. Listeners must be cheap and non-throwing.
  subscribe(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  broadcast(event: BusEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.clients) {
      try {
        ws.send(payload);
      } catch {
        // ignore — closed clients are removed by the close handler
      }
    }
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // a misbehaving listener must not break the broadcast loop
      }
    }
  }

  size(): number {
    return this.clients.size;
  }
}

export const hub = new WsHub();
