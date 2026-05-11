import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  type AgentId,
  MESSAGE_TYPES,
  type MessageType,
} from "../shared/types.ts";
import type { BusClient } from "./client.ts";

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Registers the four bus tools on an MCP server, scoped to `me` (the calling
 * agent's identity). All bodies are returned verbatim with no decoration —
 * the agent decides when to spend context.
 */
export function registerBusTools(
  server: McpServer,
  client: BusClient,
  me: AgentId,
): void {
  const otherAgent: AgentId = me === "claude" ? "codex" : "claude";

  server.registerTool(
    "bus_inbox",
    {
      title: "List inbox headers",
      description:
        "List headers of messages addressed to you that are awaiting pull. Returns id, from, ts, title, type only — no bodies. Cheap on context. Call bus_pull(id) to read a body.",
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      try {
        const inbox = await client.inbox(me);
        if (inbox.length === 0) return textResult("inbox empty");
        const lines = inbox.map(
          (e) =>
            `- ${e.id} · from=${e.from} · type=${e.type} · ${new Date(e.ts).toISOString()} · ${e.title}`,
        );
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(toErr(err));
      }
    },
  );

  server.registerTool(
    "bus_wait",
    {
      title: "Wait for inbox messages",
      description:
        "Block until a message addressed to you is visible in your inbox, or the timeout elapses. Returns the same header listing as bus_inbox (id, from, ts, title, type — no bodies). If your inbox already has messages, returns immediately. Use this to coordinate with the other agent without polling. Default timeout 30 minutes.",
      inputSchema: {
        timeoutSec: z
          .number()
          .int()
          .min(1)
          .max(1800)
          .optional()
          .describe(
            "Max seconds to wait. Default 1800 (30 minutes). Capped at 1800.",
          ),
      },
    },
    async ({ timeoutSec }): Promise<CallToolResult> => {
      try {
        const sec = timeoutSec ?? 1800;
        const { inbox, timedOut } = await client.wait(me, sec);
        if (inbox.length === 0) {
          return textResult(timedOut ? "timeout" : "inbox empty");
        }
        const lines = inbox.map(
          (e) =>
            `- ${e.id} · from=${e.from} · type=${e.type} · ${new Date(e.ts).toISOString()} · ${e.title}`,
        );
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(toErr(err));
      }
    },
  );

  server.registerTool(
    "bus_pull",
    {
      title: "Pull a message body",
      description:
        "Fetch the full body of a single message by id and mark it consumed. This is the only path a message body enters your context. Call after bus_inbox identifies a message worth reading.",
      inputSchema: {
        id: z.string().min(1).describe("Message id from bus_inbox"),
      },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const msg = await client.pull(me, id);
        const editsBlock = msg.edits.length
          ? `\n\n---\nReviewer's notes/edits:\n` +
            msg.edits
              .map(
                (e, i) =>
                  `${i + 1}. (${new Date(e.ts).toISOString()}) ${e.note}`,
              )
              .join("\n")
          : "";
        return textResult(
          `# ${msg.title}\nfrom: ${msg.from}\ntype: ${msg.type}\nts: ${new Date(msg.ts).toISOString()}\n\n${msg.body}${editsBlock}`,
        );
      } catch (err) {
        return errorResult(toErr(err));
      }
    },
  );

  server.registerTool(
    "bus_send",
    {
      title: "Send a message",
      description: `Send a tagged message to ${otherAgent}. If ${otherAgent} is in MANUAL mode, the human reviews before it lands. If AUTO, it lands in their inbox immediately. You will not see a body in return — just an acknowledgement.`,
      inputSchema: {
        type: z
          .enum(MESSAGE_TYPES as [MessageType, ...MessageType[]])
          .describe(
            "One of: prompt, report-back, blockers, review-finding, green-light, commit-pr-prompt, note",
          ),
        title: z
          .string()
          .min(1)
          .max(120)
          .describe("Short subject line shown in the inbox listing"),
        body: z
          .string()
          .min(1)
          .describe(
            "Full message body. Use the AGENTS.md tagged-block schema where appropriate.",
          ),
        to: z
          .enum(["claude", "codex", "user"])
          .optional()
          .describe(
            `Recipient. Defaults to "${otherAgent}". You may send to "user" for a human-only note.`,
          ),
      },
    },
    async ({ type, title, body, to }): Promise<CallToolResult> => {
      try {
        const recipient: AgentId = (to as AgentId | undefined) ?? otherAgent;
        if (recipient === me) {
          return errorResult("cannot send to yourself");
        }
        const msg = await client.send({
          from: me,
          to: recipient,
          type,
          title,
          body,
        });
        return textResult(`sent ${msg.id} → ${recipient} (status: ${msg.status})`);
      } catch (err) {
        return errorResult(toErr(err));
      }
    },
  );

  server.registerTool(
    "bus_status",
    {
      title: "Set status",
      description:
        "Set a short 'what I'm working on' string visible to the human in the TUI. Write-only — the value is never returned to you, so it costs zero context.",
      inputSchema: {
        text: z
          .string()
          .max(200)
          .describe("Short status, e.g. 'reviewing diff for #123'"),
      },
    },
    async ({ text }): Promise<CallToolResult> => {
      try {
        await client.status(me, text);
        return textResult("ok");
      } catch (err) {
        return errorResult(toErr(err));
      }
    },
  );
}

function toErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
