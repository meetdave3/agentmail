# agentbus

![Agentbus](./assets/hero.png)

A local, pull-only message bus between two AI coding agents (Claude, Codex,
or any pair of CLI agents that speak MCP), with a live terminal dashboard
for the human in the loop.

The goal is to replace copy-paste relay between agents — without giving up
the things copy-paste gets right: explicit, context-conscious handoffs and
a human gate on what each agent sees.

```
┌──────────────┐                       ┌──────────────┐
│   claude     │── bus_send ─────────▶ │  agentbus    │
│   (CLI)      │◀── bus_pull/inbox ────│  (daemon)    │
└──────────────┘                       │              │
                                       │   SQLite +   │
┌──────────────┐                       │   WebSocket  │
│   codex      │── bus_send ─────────▶ │              │
│   (CLI)      │◀── bus_pull/inbox ────│              │
└──────────────┘                       └──────┬───────┘
                                              │ ws
                                              ▼
                                       ┌──────────────┐
                                       │   Ink TUI    │
                                       │  (you here)  │
                                       │   ─ live log │
                                       │   ─ pending  │
                                       │   ─ modes    │
                                       └──────────────┘
```

## Why

Multi-agent coding workflows usually have one agent plan and another
implement. Today, the human in the middle pastes structured prompts and
diffs between two CLI windows. That works, but:

- Every relay step is slow and lossy.
- There's no live picture of who's doing what.
- The human has no easy way to edit, gate, or annotate a message in flight.
- Tab-switching breaks flow.

`agentbus` replaces the copy step with a tiny local daemon. Agents read and
write via four MCP tools. The human watches a dashboard and decides what
gets through.

## Design constraints

- **Pull-only.** No message ever auto-injects into an agent's context. Agents
  call `bus_inbox` (terse headers, no bodies) to see what's queued, then
  `bus_pull <id>` to deliberately spend context on one message. This mirrors
  the discipline of copy-paste.
- **Tiny tool surface.** Four MCP tools, total. No `bus_wait`, no streaming,
  no chatty polling.
- **Human-gated by default.** New agents start in `MANUAL` mode — every
  inbound message is held until the human releases it (with optional edits
  and appended notes).
- **Per-project, local-first.** State lives in `.bus/` in the project root.
  One daemon per workspace. No remote sync. No multi-user.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- A terminal that supports 256 colors (any modern one)
- One or more MCP-compatible agent CLIs ([Claude
  Code](https://claude.ai/code), [OpenAI
  Codex](https://github.com/openai/codex), etc.)

## Install

```bash
git clone https://github.com/meetdave3/agentbus.git ~/Code/agentbus
cd ~/Code/agentbus
bun install
bun link              # registers `agentbus` as a global command
```

That puts `agentbus` on your `PATH`. Confirm:

```bash
agentbus help
```

## Quickstart

From the root of any project you want to coordinate agents in:

```bash
agentbus
```

That's it. The first run scaffolds `.bus/` and prints MCP wiring snippets to
paste into your agents' configs:

- **Claude** → `.mcp.json` in the project root
- **Codex** → `.codex/config.toml` (or merge with an existing block)

Both snippets set `AGENTBUS_DIR` to this project's `.bus/` so the MCP server
finds the right daemon when the agent CLI launches it.

Paste them, then run `agentbus` again. This time it starts the daemon (in
the background, surviving the dashboard) and opens the TUI:

```
┌─ agentbus · backoffice ─────────────── 127.0.0.1:7777 ● live ─┐
│ CLAUDE [1] MANUAL    │ CODEX  [2] MANUAL                       │
│ status: —            │ status: reviewing diff                  │
│ pending for me: 0    │ pending for me: 1                       │
└──────────────────────┴─────────────────────────────────────────┘
LIVE LOG
PENDING REVIEW (1) · [j/k] move · [→/←] expand/collapse · [r]elease · [d]rop · [g] release all
▸ codex → claude [prompt] audit auth middleware
```

Add `.bus/` to your project's `.gitignore` (it holds local sqlite state and a
pid file).

Start your agent CLIs from the same project directory. They'll automatically
expose the four `bus_*` tools.

**Shutdown.** Closing the TUI (`q`) leaves the daemon running so in-flight
agent calls don't break. To fully stop:

```bash
agentbus stop
```

## MCP tools (the entire surface)

| Tool         | Purpose |
| ------------ | ------- |
| `bus_inbox`  | List headers of messages addressed to you and currently pullable. Returns `id`, `from`, `ts`, `title`, `type` only. **Never bodies.** Cheap on context. |
| `bus_pull`   | Fetch the full body of one message by id and mark it consumed. The only path a body enters your context. |
| `bus_send`   | Send a tagged message to the other agent (or to the human). Defaults `to` to the peer. |
| `bus_status` | Set a short "what I'm working on" string for the dashboard. Write-only — the value is never echoed back into your context. |

There is intentionally no `bus_wait` / long-poll tool. Agents pull when
they're ready, not on a schedule.

### Message types

`bus_send` accepts a `type` field used for filtering and labeling:

- `prompt` — a task delegated to the recipient
- `report-back` — completion report from the recipient
- `blockers` — a mid-flight question/blocker raised by the recipient
- `review-finding` — a reviewer asking for changes
- `green-light` — a reviewer approving the work
- `commit-pr-prompt` — a final "create commits and a PR" instruction
- `note` — anything else

The bus does not enforce a workflow — these labels are advisory. Use whichever
matches the contract you and the agents have agreed on.

## Modes

Modes are set **per-agent** and govern **inbound** delivery to that agent.

- **MANUAL** (default) — every message addressed to this agent is held in
  the pending-review queue. The agent's `bus_inbox` does not see it until
  you release it in the TUI (with optional edits or appended notes). This
  is the hands-on gate.
- **AUTO** — messages addressed to this agent are released immediately and
  visible in their inbox. You can still append notes, but you don't have to.

Toggle from the TUI with `1` (Claude) and `2` (Codex), or:

```bash
agentbus mode claude auto
agentbus mode codex manual
```

## TUI hotkeys

```
1         toggle Claude mode  (manual ↔ auto)
2         toggle Codex mode
j / k     move selection in the pending review queue
↑ / ↓     same as k / j
→ / ←     expand / collapse the selected message's full body (enter toggles)
r         release the selected pending message
d         drop the selected pending message
g         release every pending message
q         quit
```

### Live log indicators

Each row in the live log shows a delivery state, WhatsApp-style:

```
HELD    held in the manual-mode gate — recipient's bus_inbox can't see it yet
✓       released — visible in the recipient's bus_inbox, but they haven't pulled the body
✓✓      consumed — the recipient called bus_pull and the body entered their context
DROP    dropped — you rejected it; it never reached the recipient
```

The same row updates in place as a message progresses. No new row is added
when an agent reads.

## Commands

The everyday command is just `agentbus` — it auto-inits, ensures the daemon is
running, and opens the dashboard. The rest are escape hatches.

```
agentbus                               init if needed, ensure daemon, open TUI
agentbus stop                          stop the background daemon
agentbus log [--follow]                tail the message log to stdout
agentbus mode <agent> <auto|manual>    flip an agent's inbound mode
agentbus send <to> <type> <title> [-]  send a message as `user` (body via stdin or arg)
agentbus status <agent> <text...>      set an agent's "working on" string
agentbus help                          show usage

Advanced / scripting:
agentbus init                          scaffold ./.bus and print MCP snippets only
agentbus start [--detach]              start the daemon directly (no TUI)
agentbus tui                           open just the TUI (assumes daemon is up)
agentbus mcp --as <claude|codex>       stdio MCP server (spawned by agent CLIs)
```

Environment:

- `AGENTBUS_DIR` overrides the `.bus` directory location (defaults to
  `./.bus` in the current working directory).

## How agents discover the bus

There are three signals that lead an agent to use these tools:

1. **MCP tool descriptions** ship with the server. When the agent starts, it
   sees `bus_inbox`, `bus_pull`, `bus_send`, `bus_status` in its tool list,
   each with a description that explains the mechanics and the
   context-cost.
2. **The conversation.** Most workflows start with the human saying
   something like *"there's a prompt from <peer> on the bus — check your
   inbox."* The agent then calls `bus_inbox` → `bus_pull`.
3. **Project instructions.** You can document the coordination contract in
   `CLAUDE.md` / `AGENTS.md` / `.codex/AGENTS.md` so each agent knows when in
   its own workflow it should pull, send a `report-back`, raise a
   `blockers` block, etc.

The bus does not impose a workflow — it provides a substrate.

## Architecture

```
agentbus/
  bin/agentbus.ts              CLI entry — routes subcommands
  src/
    server/                    Bun + Hono daemon + WebSocket hub + SQLite
    mcp/                       stdio MCP server (the agent-facing surface)
    tui/                       Ink dashboard (React for the terminal)
    cli/                       init / start / stop / mode / log / send / status
    shared/                    types + config resolver + ulid
  tests/e2e.ts                 end-to-end MCP round-trip test
```

### State

Per project, in `.bus/`:

- `config.json` — port, default modes
- `state.sqlite` — message log, agent state (mode + status)
- `pid` — daemon process id (so `agentbus stop` works)
- `mcp.log` — stderr from spawned MCP servers (stdout is reserved for the
  MCP transport)

### Daemon endpoints

REST under `/api/*` for the MCP client and CLI commands. WebSocket `/ws` for
the TUI to subscribe to live events. Bound to `127.0.0.1` only — no remote
access.

## Testing

```bash
bun test
```

`tests/e2e.ts` spins up a fresh daemon in a temp directory, runs the MCP
server as both agents over stdio, and asserts the full pending → release →
pull cycle, auto-mode delivery, return-trip semantics, and the write-only
status guarantee.

## Troubleshooting

| Symptom | Likely cause / fix |
| ------- | ------------------ |
| Agent's tool errors say "daemon not reachable" | The daemon isn't running for this project. `cd` to the project root and run `agentbus`. The MCP server resolves the bus by reading `./.bus/config.json` (or `AGENTBUS_DIR`). |
| Port collision on startup | Default port is `7777`. Edit `.bus/config.json` (`"port"` field) and restart. |
| `agentbus start` says "already running" but nothing answers | Stale pid file. Delete `.bus/pid` and try again. |
| MCP tool errors that don't show up anywhere | Check `.bus/mcp.log`. Stdout is reserved for the MCP transport, so all diagnostics go to the log file. |
| Renamed the project / moved the `.bus` dir | Restart the agent CLI so it re-reads `AGENTBUS_DIR`. |

## Non-goals

- **No headless agent invocation.** This is a bus, not an orchestrator —
  agents stay in their normal interactive sessions.
- **No remote bus.** Localhost only.
- **No multi-conversation threading.** Reconstruct from `from`/`to`/`ts` if
  you need it.
- **No web UI.** The terminal dashboard is the only UI.
- **No authn/authz.** Anyone with local network access can hit the daemon.
  Bind is `127.0.0.1` only.

## License

MIT — see [LICENSE](./LICENSE).
