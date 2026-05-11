import type { ServerWebSocket } from "bun";
import type { BusEvent } from "../shared/types.ts";

interface WsData {
  id: string;
}

export type BusWs = ServerWebSocket<WsData>;

class WsHub {
  private clients = new Set<BusWs>();

  add(ws: BusWs): void {
    this.clients.add(ws);
  }

  remove(ws: BusWs): void {
    this.clients.delete(ws);
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
  }

  size(): number {
    return this.clients.size;
  }
}

export const hub = new WsHub();
