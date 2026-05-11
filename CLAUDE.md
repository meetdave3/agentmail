# agentbus — Contributor Guide

Instructions for AI coding agents (Claude, Codex, etc.) working **on** this
repo. For instructions on how end users wire `agentbus` into _their_ projects,
see [`README.md`](./README.md).

## Project context

- A local, single-process, pull-only message bus between two AI coding agents.
- Stack: Bun + Hono (HTTP + WebSocket), `bun:sqlite` for state, Ink (React for
  the terminal) for the TUI, `@modelcontextprotocol/sdk` for the stdio MCP
  surface.
- Per-project state lives in `./.bus/` (sqlite + pid + config + mcp log).
- Bind is `127.0.0.1` only. No remote access. No multi-user. No authn/authz.

## Commands

- Install:               `bun install`
- Typecheck:             `bunx tsc --noEmit`
- End-to-end test:       `bun tests/e2e.ts`  (also `bun test`)
- Run the CLI locally:   `bun run bin/agentbus.ts <command>`
- Globally link for dev: `bun link`  (then `agentbus <command>` works anywhere)

## Layout

```
bin/agentbus.ts         CLI entry — routes subcommands
src/
  server/               Bun.serve + Hono routes + WebSocket hub + SQLite store
  mcp/                  stdio MCP server + bus_inbox/pull/send/status tools
  tui/                  Ink app (components + hooks + REST/WS client)
  cli/                  init / start / stop / mode / log / send / status / tui / mcp
  shared/               AgentId / Message / BusEvent / config resolver / ulid
tests/e2e.ts            spawns a fresh daemon, talks MCP as both agents,
                        asserts the full pending → release → pull cycle
```

## Working rules

### Context discipline is the whole point

- **Never** add a tool that pushes content into an agent's context. The
  agent's call is the only path. `bus_pull` is the explicit "spend context
  here" act.
- **Never** add a `bus_wait` / long-poll / streaming tool. Agents pull when
  they choose to, not on a schedule.
- `bus_inbox` returns **headers only**. No bodies, no edits, no log entries.
  If you find yourself wanting to enrich it, stop and reconsider.
- `bus_status` is write-only. Any tool that writes user-visible state to the
  server must not return that state back into agent context.
- Anything an agent calls returns the smallest payload that satisfies the
  contract.

### Mode gating is server-side

- The MANUAL / AUTO mode gate lives in `src/server/routes.ts` at the
  `/api/send` boundary. New endpoints or message paths must respect it.
- New types of "delivery" (e.g. broadcast, multi-recipient) MUST be designed
  with the gate in mind. Default to MANUAL semantics for anything novel.

### State and persistence

- All persistent state goes through `src/server/store.ts`. Don't read or
  write the sqlite db from anywhere else.
- Schema changes go in the `migrate()` function. Use `IF NOT EXISTS` /
  additive ALTERs. We don't yet have a migration framework — keep changes
  forward-compatible and append-only.

### Dependencies

- Keep the dep list small and justified. Don't add a library to do something
  20 lines of Bun-native code can do.
- Never add a runtime dep just for the TUI without strong justification —
  Ink + React are already a lot.
- No new dependencies without explicit user approval.

### Process discipline

- The MCP server logs to `.bus/mcp.log` via stderr. **Stdout is reserved for
  the MCP transport.** Never `console.log` from MCP code paths.
- Daemon process logs to stderr (`console.error`) so stdout stays free for
  potential future piping.
- All errors crossing the MCP boundary become terse `isError: true` tool
  results. Never raw stack traces — they would pollute the agent's context.

### TUI conventions

- Ink components are functional, use React hooks. No class components.
- Live state flows in via `useBus()` in `src/tui/hooks/useBus.ts` — a single
  WebSocket subscription. Don't open additional sockets from components.
- All mutations go through `TuiApi` (`src/tui/api.ts`).
- Hotkeys are owned by `app.tsx` via `useInput`. Don't scatter `useInput`
  across components — it'll cause double-firing.

## Validation

Before reporting any non-trivial change complete:

1. `bunx tsc --noEmit` — typecheck clean.
2. `bun tests/e2e.ts` — all 13 assertions green.
3. Manual smoke if you touched the TUI:
   ```bash
   agentbus init   # in /tmp/somewhere
   agentbus start  # one pane
   agentbus tui    # another pane
   ```
   Then send a message and verify the live log + pending review update.

Docs-only changes (README, CLAUDE.md, LICENSE) don't need the build gate —
say so explicitly when you skip it.

## Non-goals — don't accidentally add these

- Headless agent invocation (`claude --print`, `codex exec` orchestration).
- Remote bus, multi-user, authn/authz.
- Threading model beyond `from`/`to`/`ts`.
- Web UI.
- A general-purpose log/event-sourcing layer. The store is intentionally
  one row per message, no derived tables.

## Coordination contract (when used to coordinate Claude ↔ Codex)

The bus is workflow-agnostic, but the default expectation is a "planner ↔
implementer" split (e.g. Codex plans + reviews, Claude implements). Message
`type` values follow that flow:

- `prompt` — a planner-to-implementer task delegation
- `report-back` — implementer's completion report
- `blockers` — implementer stops mid-task and asks for product/scope guidance
- `review-finding` — planner asks for changes
- `green-light` — planner approves
- `commit-pr-prompt` — final "create commits and a PR" instruction

The labels are advisory; the bus does not enforce a workflow.
