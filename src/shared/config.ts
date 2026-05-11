import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
 * Resolve the .bus directory location.
 * Priority:
 *  1. AGENTBUS_DIR env var (absolute or relative to CWD).
 *  2. ./.bus in the current working directory.
 *
 * Note: we deliberately do NOT walk up to find an ancestor .bus, because each
 * project that runs `agentbus init` should anchor its own bus to its own CWD.
 */
export function resolvePaths(cwd: string = process.cwd()): ResolvedPaths {
  const fromEnv = process.env.AGENTBUS_DIR;
  const busDir = fromEnv
    ? resolve(cwd, fromEnv)
    : join(cwd, ".bus");
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

export function defaultConfig(): BusConfig {
  return {
    port: DEFAULT_PORT,
    modes: { claude: "manual", codex: "manual" },
    createdAt: Date.now(),
  };
}

export function readConfig(paths: ResolvedPaths): BusConfig {
  if (!existsSync(paths.configPath)) {
    throw new Error(
      `No agentbus config at ${paths.configPath}. Run \`agentbus init\` in this directory first.`,
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
