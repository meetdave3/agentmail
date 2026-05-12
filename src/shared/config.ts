import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { type BusConfig, DEFAULT_PORT } from "./types.ts";

export interface ResolvedPaths {
  root: string;
  busDir: string;
  configPath: string;
  dbPath: string;
  pidPath: string;
  mcpLogPath: string;
}

/**
 * Resolve the project's agentmail state directory.
 * Priority:
 *  1. AGENTMAIL_DIR env var (absolute or relative to CWD).
 *  2. ./.mail in the current working directory.
 *
 * Note: we deliberately do NOT walk up to find an ancestor .mail, because each
 * project that runs `agentmail init` should anchor its own state to its own CWD.
 *
 * The internal property name `busDir` reflects the underlying message-bus
 * mechanism; the on-disk directory is `.mail`.
 */
export function resolvePaths(cwd: string = process.cwd()): ResolvedPaths {
  const fromEnv = process.env.AGENTMAIL_DIR;
  const busDir = fromEnv
    ? resolve(cwd, fromEnv)
    : join(cwd, ".mail");
  const root = resolve(busDir, "..");
  return {
    root,
    busDir,
    configPath: join(busDir, "config.json"),
    dbPath: join(busDir, "state.sqlite"),
    pidPath: join(busDir, "pid"),
    mcpLogPath: join(busDir, "mcp.log"),
  };
}

export function ensureBusDir(paths: ResolvedPaths): void {
  if (!existsSync(paths.busDir)) {
    mkdirSync(paths.busDir, { recursive: true });
  }
}

export function defaultConfig(port: number = DEFAULT_PORT): BusConfig {
  return {
    port,
    modes: { claude: "manual", codex: "manual" },
    createdAt: Date.now(),
  };
}

/**
 * Pick a TCP port the OS thinks is free on 127.0.0.1. Used at `init` time so
 * each project's `.mail/config.json` gets its own port — without this, every
 * project would default to 7777 and MCP clients from one project would
 * silently connect to whichever daemon happened to bind that port first.
 *
 * There's a classic TOCTOU here: by the time the daemon actually binds, the
 * port could be in use. We accept that — collisions get a friendly error
 * from `startServer` telling the user to re-run `init`.
 */
export function pickFreePort(): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const srv = createServer();
    srv.once("error", rejectP);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        rejectP(new Error("could not determine free port"));
        return;
      }
      const port = addr.port;
      srv.close((err) => (err ? rejectP(err) : resolveP(port)));
    });
  });
}

export function readConfig(paths: ResolvedPaths): BusConfig {
  if (!existsSync(paths.configPath)) {
    throw new Error(
      `No agentmail config at ${paths.configPath}. Run \`agentmail init\` in this directory first.`,
    );
  }
  const raw = readFileSync(paths.configPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<BusConfig>;
  const def = defaultConfig();
  return {
    port: parsed.port ?? def.port,
    modes: {
      claude: parsed.modes?.claude ?? def.modes.claude,
      codex: parsed.modes?.codex ?? def.modes.codex,
    },
    createdAt: parsed.createdAt ?? def.createdAt,
  };
}

export function writeConfig(paths: ResolvedPaths, config: BusConfig): void {
  ensureBusDir(paths);
  writeFileSync(paths.configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function busUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function busWsUrl(port: number): string {
  return `ws://127.0.0.1:${port}/ws`;
}
