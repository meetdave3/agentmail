# agentmail

![Agentmail](./assets/hero.png)

**Two AI coding agents. One shared inbox. A dashboard so you can watch them work.**

agentmail is a local message-bus daemon (Bun, SQLite, [MCP](https://modelcontextprotocol.io)) that lets two separate agent processes hand work back and forth in their own context windows. It's infrastructure: a transport, not a methodology. You bring the workflow.

Here's the one I use it for. Claude writes the code, Codex reviews it. Claude is fast and creative. Codex is strict and pedantic. They send each other prompts, reports, and review notes through agentmail. I watch from a terminal dashboard and either let messages through, edit them, or drop them before they reach the other side.

Your pair can be anything that speaks MCP. Claude and Codex is just mine.

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

Here's the path that got me here. Started with one agent, Claude. Ships fast, cuts corners. Tests it didn't actually run. Edge cases it hand-waved. Features marked done that weren't quite.

A sharper prompt only gets you so far. What it actually needed was a second pair of eyes on the output. So I brought in Codex. Stricter LLM, different temperament. The kind that reads the spec twice.

First try was letting Codex spawn Claude CLIs directly. Worked for a minute. Then both contexts ballooned into tool calls *talking about* the code instead of writing it.

Turns out the two don't need to live in each other's heads. They just need to pass notes.

That's agentmail. Each agent gets an inbox. They send structured messages, pull them when ready, and spend the rest of their context on the actual work. You watch the live dashboard and decide what gets through.

## Four rules it lives by

**Pull-only.** No message ever auto-injects into an agent's context. Agents call `inbox` to see what's queued (headers only, never bodies), then `pull <id>` when they're ready to spend context on one. The discipline of copy-paste, without the keyboard.

**Tiny tool surface.** Five MCP tools total. Only one of them blocks: `wait`, which long-polls for the next message instead of forcing the agent to spin in a poll loop.

**Human-gated by default.** Every new agent starts in `MANUAL` mode. Inbound messages sit in a pending queue until you release them, with optional edits or appended notes. You decide what gets through, every time, until you flip the agent to `AUTO`.

**Per-project, local-first.** State lives in `.mail/` inside the project root. One daemon per workspace. No remote sync. No multi-user. No cloud.

## Prerequisites

- [Bun](https://bun.sh) 1.2 or newer (runs the daemon and TUI)
- [Node.js](https://nodejs.org) 18 or newer (the stdio MCP server runs under Node; see [`src/cli/mcp.ts`](./src/cli/mcp.ts) for why)
- A terminal that supports 256 colors (any modern one)
- One or more MCP-capable agent CLIs ([Claude Code](https://claude.ai/code), [OpenAI Codex](https://github.com/openai/codex), etc.)

## Install

```bash
bun add -g @meetdave/agentmail
# or
npm i -g @meetdave/agentmail
```

That puts `agentmail` on your `PATH`. Confirm:

```bash
agentmail help
```

### From source

For contributors and local development:

```bash
git clone https://github.com/meetdave3/agentmail.git ~/Code/agentmail
cd ~/Code/agentmail
bun install
bun link              # registers `agentmail` as a global command
```

## Quickstart

From the root of any project you want to coordinate agents in:

```bash
agentmail
```

That's it. The first run scaffolds `.mail/` and prints MCP wiring snippets to paste into your agents' configs:

- **Claude** goes in `.mcp.json` in the project root
- **Codex** goes in `.codex/config.toml` (or merge with an existing block)

Both snippets set `AGENTMAIL_DIR` to this project's `.mail/` so the MCP server finds the right daemon when the agent CLI launches it.

Paste them, then run `agentmail` again. This time it starts the daemon (in the background, surviving the dashboard) and opens the TUI:

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

Add `.mail/` to your project's `.gitignore`. It holds local sqlite state and a pid file.

Start your agent CLIs from the same project directory. They'll automatically expose the five MCP tools.

**Shutdown.** The bare `agentmail` command owns the daemon it starts: pressing `q` (or Ctrl+C) in the TUI stops both. If the daemon was already running when you opened the TUI (because you started it separately with `agentmail start`), quitting only closes the TUI and the daemon keeps running. To stop a daemon you didn't start in this session:

```bash
agentmail stop
```

## Wire it into your project's instructions

Each agent needs to know how to use agentmail. There's a bootstrap guide written for an LLM to read. Point a setup session at:

```
https://raw.githubusercontent.com/meetdave3/agentmail/main/llms.txt
```

Open a fresh session in the project you want to wire up and say:

> Read <https://raw.githubusercontent.com/meetdave3/agentmail/main/llms.txt>
> and follow it to update this project's CLAUDE.md and AGENTS.md.

The file documents the five MCP tools, the implementer ↔ reviewer loop, and the exact snippets to merge into each agent's instruction file. It's versioned in this repo, so the link is always current.

## MCP tools (the entire surface)

| Tool         | Purpose |
| ------------ | ------- |
| `inbox`  | List headers of messages addressed to you and currently pullable. Returns `id`, `from`, `ts`, `title`, `type` only. **Never bodies.** Cheap on context. Returns instantly. |
| `wait`   | Block until your inbox has at least one visible message, or `timeoutSec` elapses (default 1800, capped at 1800). Returns the same headers as `inbox`, never bodies. If your inbox is already non-empty, returns immediately. Use this instead of a polling loop. |
| `pull`   | Fetch the full body of one message by id and mark it consumed. The only path a body enters your context. |
| `send`   | Send a tagged message to the other agent (or to the human). Defaults `to` to the peer. |
| `status` | Set a short "what I'm working on" string for the dashboard. Write-only. The value is never echoed back into your context. |

### Message types

`send` accepts a `type` field used for filtering and labeling:

- `prompt`: a task delegated to the recipient
- `report-back`: completion report from the recipient
- `blockers`: a mid-flight question or blocker raised by the recipient
- `review-finding`: a reviewer asking for changes
- `green-light`: a reviewer approving the work
- `commit-pr-prompt`: a final "create commits and a PR" instruction
- `note`: anything else

These labels are advisory. agentmail doesn't enforce a workflow. Use whichever match the contract you and your agents have agreed on.

## Modes

Modes are set **per-agent** and govern **inbound** delivery to that agent.

- **MANUAL** (default). Every message addressed to this agent is held in the pending-review queue. The agent's `inbox` does not see it until you release it in the TUI, with optional edits or appended notes. This is the hands-on gate.
- **AUTO**. Messages addressed to this agent are released immediately and visible in their inbox. You can still append notes, but you don't have to.

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
HELD    held in the manual-mode gate. Recipient's inbox can't see it yet.
✓       released. Visible in the recipient's inbox, but they haven't pulled the body.
✓✓      consumed. The recipient called pull and the body entered their context.
DROP    dropped. You rejected it; it never reached the recipient.
```

The same row updates in place as a message progresses. No new row is added when an agent reads.

## Commands

The everyday command is just `agentmail`. It auto-inits, ensures the daemon is running, and opens the dashboard. The rest are escape hatches.

```
agentmail                               init if needed, ensure daemon, open TUI
agentmail stop                          stop the background daemon
agentmail log [--follow]                tail the message log to stdout
agentmail mode <agent> <auto|manual>    flip an agent's inbound mode
agentmail send <to> <type> <title> [-]  send a message as `user` (body via stdin or arg)
agentmail status <agent> <text...>      set an agent's "working on" string
agentmail help                          show usage

Advanced / scripting:
agentmail init                          scaffold ./.mail and print MCP snippets only
agentmail start [--detach]              start the daemon directly (no TUI)
agentmail tui                           open just the TUI (assumes daemon is up)
agentmail mcp --as <claude|codex>       stdio MCP server (spawned by agent CLIs)
```

Environment:

- `AGENTMAIL_DIR` overrides the `.mail` directory location. Defaults to `./.mail` in the current working directory.

## How agents discover agentmail

Three signals lead an agent to use these tools:

1. **MCP tool descriptions** ship with the server. When the agent starts, it sees `inbox`, `pull`, `send`, `status` in its tool list, each with a description that explains the mechanics and the context cost.
2. **The conversation.** A typical session begins with you saying something like *"there's a prompt from <peer> in your inbox, check it."* The agent then calls `inbox` then `pull`.
3. **Project instructions.** You can document the coordination contract in `CLAUDE.md` / `AGENTS.md` / `.codex/AGENTS.md` so each agent knows when in its own workflow it should pull, send a `report-back`, raise a `blockers` block, and so on.

agentmail doesn't impose a workflow. It provides a substrate.

## Architecture

```
agentmail/
  bin/agentmail                 CLI entry (routes subcommands)
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

- `config.json`: port, default modes
- `state.sqlite`: message log, agent state (mode + status)
- `pid`: daemon process id (so `agentmail stop` works)
- `mcp.log`: stderr from spawned MCP servers (stdout is reserved for the MCP transport)

### Daemon endpoints

REST under `/api/*` for the MCP client and CLI commands. WebSocket `/ws` for the TUI to subscribe to live events. Bound to `127.0.0.1` only. No remote access.

## Testing

```bash
bun test
```

`tests/e2e.ts` spins up a fresh daemon in a temp directory, runs the MCP server as both agents over stdio, and asserts the full pending → release → pull cycle, auto-mode delivery, return-trip semantics, and the write-only status guarantee.

## Troubleshooting

| Symptom | Likely cause / fix |
| ------- | ------------------ |
| Agent's tool errors say "daemon not reachable" | The daemon isn't running for this project. `cd` to the project root and run `agentmail`. The MCP server resolves the daemon by reading `./.mail/config.json` (or `AGENTMAIL_DIR`). |
| Port collision on startup | Default port is `7777`. Edit `.mail/config.json` (`"port"` field) and restart. |
| `agentmail start` says "already running" but nothing answers | Stale pid file. Delete `.mail/pid` and try again. |
| MCP tool errors that don't show up anywhere | Check `.mail/mcp.log`. Stdout is reserved for the MCP transport, so all diagnostics go to the log file. |
| Renamed the project or moved the `.mail` dir | Restart the agent CLI so it re-reads `AGENTMAIL_DIR`. |

## Non-goals

- **No headless agent invocation.** This is a mailbox, not an orchestrator. Agents stay in their normal interactive sessions.
- **No remote access.** Localhost only.
- **No multi-conversation threading.** Reconstruct from `from`/`to`/`ts` if you need it.
- **No web UI.** The terminal dashboard is the only UI.
- **No authn/authz.** Anyone with local network access can hit the daemon. Bind is `127.0.0.1` only.

## License

MIT. See [LICENSE](./LICENSE).
