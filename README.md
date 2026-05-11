# agentmail

![Agentmail](./assets/hero.png)

A local, pull-only message bus between two AI coding agents (Claude, Codex,
or any pair of CLI agents that speak MCP), with a live terminal dashboard
for the human in the loop.

The goal is to replace copy-paste relay between agents — without giving up
the things copy-paste gets right: explicit, context-conscious handoffs and
a human gate on what each agent sees.

```
┌──────────────┐                       ┌──────────────┐
│   claude     │── send ─────────▶ │  agentmail    │
│   (CLI)      │◀── pull/inbox ────│  (daemon)    │
└──────────────┘                       │              │
                                       │   SQLite +   │
┌──────────────┐                       │   WebSocket  │
│   codex      │── send ─────────▶ │              │
│   (CLI)      │◀── pull/inbox ────│              │
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

`agentmail` replaces the copy step with a tiny local daemon. Agents read and
write via five MCP tools. The human watches a dashboard and decides what
gets through.

## Design constraints

- **Pull-only.** No message ever auto-injects into an agent's context. Agents
  call `inbox` (terse headers, no bodies) to see what's queued, then
  `pull <id>` to deliberately spend context on one message. This mirrors
  the discipline of copy-paste.
- **Tiny tool surface.** Five MCP tools, total. The only blocking one is
  `wait`, which long-polls for the next visible message — a single
  tool call rather than a polling loop.
- **Human-gated by default.** New agents start in `MANUAL` mode — every
  inbound message is held until the human releases it (with optional edits
  and appended notes).
- **Per-project, local-first.** State lives in `.mail/` in the project root.
  One daemon per workspace. No remote sync. No multi-user.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2 (daemon + TUI)
- [Node.js](https://nodejs.org) ≥ 18 (the stdio MCP server runs under Node — see [`src/cli/mcp.ts`](./src/cli/mcp.ts) for why)
- A terminal that supports 256 colors (any modern one)
- One or more MCP-compatible agent CLIs ([Claude
  Code](https://claude.ai/code), [OpenAI
  Codex](https://github.com/openai/codex), etc.)

## Install

```bash
git clone https://github.com/meetdave3/agentmail.git ~/Code/agentmail
cd ~/Code/agentmail
bun install
bun link              # registers `agentmail` as a global command
```

That puts `agentmail` on your `PATH`. Confirm:

```bash
agentmail help
```

## Quickstart

From the root of any project you want to coordinate agents in:

```bash
agentmail
```

That's it. The first run scaffolds `.mail/` and prints MCP wiring snippets to
paste into your agents' configs:

- **Claude** → `.mcp.json` in the project root
- **Codex** → `.codex/config.toml` (or merge with an existing block)

Both snippets set `AGENTMAIL_DIR` to this project's `.mail/` so the MCP server
finds the right daemon when the agent CLI launches it.

Paste them, then run `agentmail` again. This time it starts the daemon (in
the background, surviving the dashboard) and opens the TUI:

```
┌─ agentmail · backoffice ─────────────── 127.0.0.1:7777 ● live ─┐
│ CLAUDE [1] MANUAL    │ CODEX  [2] MANUAL                       │
│ status: —            │ status: reviewing diff                  │
│ pending for me: 0    │ pending for me: 1                       │
└──────────────────────┴─────────────────────────────────────────┘
LIVE LOG
PENDING REVIEW (1) · [j/k] move · [→/←] expand/collapse · [r]elease · [d]rop · [g] release all
▸ codex → claude [prompt] audit auth middleware
```

Add `.mail/` to your project's `.gitignore` (it holds local sqlite state and a
pid file).

Start your agent CLIs from the same project directory. They'll automatically
expose the five `mail_*` tools.

**Shutdown.** Closing the TUI (`q`) leaves the daemon running so in-flight
agent calls don't break. To fully stop:

```bash
agentmail stop
```

## MCP tools (the entire surface)

| Tool         | Purpose |
| ------------ | ------- |
| `inbox`  | List headers of messages addressed to you and currently pullable. Returns `id`, `from`, `ts`, `title`, `type` only. **Never bodies.** Cheap on context. Returns instantly. |
| `wait`   | Block until your inbox has at least one visible message, or `timeoutSec` elapses (default 1800, capped at 1800). Returns the same headers as `inbox` — never bodies. If your inbox is already non-empty, returns immediately. Use this instead of a polling loop. |
| `pull`   | Fetch the full body of one message by id and mark it consumed. The only path a body enters your context. |
| `send`   | Send a tagged message to the other agent (or to the human). Defaults `to` to the peer. |
| `status` | Set a short "what I'm working on" string for the dashboard. Write-only — the value is never echoed back into your context. |

### Message types

`send` accepts a `type` field used for filtering and labeling:

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
  the pending-review queue. The agent's `inbox` does not see it until
  you release it in the TUI (with optional edits or appended notes). This
  is the hands-on gate.
- **AUTO** — messages addressed to this agent are released immediately and
  visible in their inbox. You can still append notes, but you don't have to.

Toggle from the TUI with `1` (Claude) and `2` (Codex), or:

```bash
agentmail mode claude auto
agentmail mode codex manual
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
HELD    held in the manual-mode gate — recipient's inbox can't see it yet
✓       released — visible in the recipient's inbox, but they haven't pulled the body
✓✓      consumed — the recipient called pull and the body entered their context
DROP    dropped — you rejected it; it never reached the recipient
```

The same row updates in place as a message progresses. No new row is added
when an agent reads.

## Commands

The everyday command is just `agentmail` — it auto-inits, ensures the daemon is
running, and opens the dashboard. The rest are escape hatches.

```
agentmail                               init if needed, ensure daemon, open TUI
agentmail stop                          stop the background daemon
agentmail log [--follow]                tail the message log to stdout
agentmail mode <agent> <auto|manual>    flip an agent's inbound mode
agentmail send <to> <type> <title> [-]  send a message as `user` (body via stdin or arg)
agentmail status <agent> <text...>      set an agent's "working on" string
agentmail help                          show usage

Advanced / scripting:
agentmail init                          scaffold ./.bus and print MCP snippets only
agentmail start [--detach]              start the daemon directly (no TUI)
agentmail tui                           open just the TUI (assumes daemon is up)
agentmail mcp --as <claude|codex>       stdio MCP server (spawned by agent CLIs)
```

Environment:

- `AGENTMAIL_DIR` overrides the `.bus` directory location (defaults to
  `./.bus` in the current working directory).

## How agents discover the bus

There are three signals that lead an agent to use these tools:

1. **MCP tool descriptions** ship with the server. When the agent starts, it
   sees `inbox`, `pull`, `send`, `status` in its tool list,
   each with a description that explains the mechanics and the
   context-cost.
2. **The conversation.** Most workflows start with the human saying
   something like *"there's a prompt from <peer> on the bus — check your
   inbox."* The agent then calls `inbox` → `pull`.
3. **Project instructions.** You can document the coordination contract in
   `CLAUDE.md` / `AGENTS.md` / `.codex/AGENTS.md` so each agent knows when in
   its own workflow it should pull, send a `report-back`, raise a
   `blockers` block, etc.

The bus does not impose a workflow — it provides a substrate.

### Bootstrapping a new project's instructions

If you want to wire agentmail into a new project's `CLAUDE.md` / `AGENTS.md`
without writing the snippets by hand, point a setup LLM at this URL:

```
https://raw.githubusercontent.com/meetdave3/agentmail/main/llms.txt
```

That file is a self-contained bootstrap guide aimed at an LLM. Open a fresh
session in the project you want to wire up and say:

> Read <https://raw.githubusercontent.com/meetdave3/agentmail/main/llms.txt>
> and follow it to update this project's CLAUDE.md and AGENTS.md.

The file documents the five MCP tools, the implementer ↔ reviewer loop, and
the exact snippets to merge into each agent's instruction file. It's
versioned in this repo, so the link is always current.

## Architecture

```
agentmail/
  bin/agentmail.ts              CLI entry — routes subcommands
  src/
    server/                    Bun + Hono daemon + WebSocket hub + SQLite
    mcp/                       stdio MCP server (the agent-facing surface)
    tui/                       Ink dashboard (React for the terminal)
    cli/                       init / start / stop / mode / log / send / status
    shared/                    types + config resolver + ulid
  tests/e2e.ts                 end-to-end MCP round-trip test
```

### State

Per project, in `.mail/`:

- `config.json` — port, default modes
- `state.sqlite` — message log, agent state (mode + status)
- `pid` — daemon process id (so `agentmail stop` works)
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
| Agent's tool errors say "daemon not reachable" | The daemon isn't running for this project. `cd` to the project root and run `agentmail`. The MCP server resolves the bus by reading `./.mail/config.json` (or `AGENTMAIL_DIR`). |
| Port collision on startup | Default port is `7777`. Edit `.mail/config.json` (`"port"` field) and restart. |
| `agentmail start` says "already running" but nothing answers | Stale pid file. Delete `.mail/pid` and try again. |
| MCP tool errors that don't show up anywhere | Check `.mail/mcp.log`. Stdout is reserved for the MCP transport, so all diagnostics go to the log file. |
| Renamed the project / moved the `.bus` dir | Restart the agent CLI so it re-reads `AGENTMAIL_DIR`. |

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
