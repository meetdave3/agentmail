import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { ensureBusDir, readConfig, resolvePaths } from "../shared/config.ts";
import { hub, type BusWs } from "./events.ts";
import { createRoutes } from "./routes.ts";
import { Store } from "./store.ts";

export interface StartOptions {
  cwd?: string;
  silent?: boolean;
}

export async function startServer(opts: StartOptions = {}): Promise<{
  stop: () => Promise<void>;
  port: number;
  url: string;
}> {
  const paths = resolvePaths(opts.cwd ?? process.cwd());
  ensureBusDir(paths);
  const config = readConfig(paths);

  const store = new Store(paths.dbPath);
  const app = createRoutes(store);
  const log = (...args: unknown[]) => {
    if (!opts.silent) console.error("[agentbus]", ...args);
  };

  const server = Bun.serve({
    port: config.port,
    // Disable the 10-second per-connection idle timeout — /api/wait holds
    // requests open for up to 30 minutes with no bytes flowing.
    idleTimeout: 0,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const ok = srv.upgrade(req);
        if (ok) return undefined;
        return new Response("ws upgrade failed", { status: 400 });
      }
      return app.fetch(req);
    },
    websocket: {
      open(ws) {
        hub.add(ws as unknown as BusWs);
        ws.send(JSON.stringify({ kind: "hello", ts: Date.now() }));
      },
      message() {
        // Inbound WS messages are ignored — the bus is HTTP-write, WS-broadcast.
      },
      close(ws) {
        hub.remove(ws as unknown as BusWs);
      },
    },
  });

  // PID file for `agentbus stop`.
  writeFileSync(paths.pidPath, String(process.pid), "utf8");
  log(`listening on http://127.0.0.1:${server.port} (project: ${paths.root})`);

  const stop = async (): Promise<void> => {
    server.stop(true);
    store.close();
    if (existsSync(paths.pidPath)) {
      try {
        unlinkSync(paths.pidPath);
      } catch {
        // ignore
      }
    }
    log("stopped");
  };

  const signalHandler = async () => {
    await stop();
    process.exit(0);
  };
  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);

  const port = server.port ?? config.port;
  return { stop, port, url: `http://127.0.0.1:${port}` };
}
