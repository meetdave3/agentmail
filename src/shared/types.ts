export type AgentId = "claude" | "codex" | "user";

export const HUMAN_AGENT: AgentId = "user";
export const LLM_AGENTS: AgentId[] = ["claude", "codex"];
export const ALL_AGENTS: AgentId[] = ["claude", "codex", "user"];

export type MessageType =
  | "prompt"
  | "report-back"
  | "blockers"
  | "review-finding"
  | "green-light"
  | "commit-pr-prompt"
  | "note";

export const MESSAGE_TYPES: MessageType[] = [
  "prompt",
  "report-back",
  "blockers",
  "review-finding",
  "green-light",
  "commit-pr-prompt",
  "note",
];

export type MessageStatus = "pending" | "released" | "consumed" | "dropped";

export type AgentMode = "auto" | "manual";

export interface MessageEdit {
  by: AgentId;
  ts: number;
  note: string;
}

export interface Message {
  id: string;
  from: AgentId;
  to: AgentId;
  type: MessageType;
  title: string;
  body: string;
  ts: number;
  status: MessageStatus;
  edits: MessageEdit[];
  consumedAt?: number;
}

export interface InboxEntry {
  id: string;
  from: AgentId;
  ts: number;
  title: string;
  type: MessageType;
}

export interface AgentState {
  id: AgentId;
  mode: AgentMode;
  status: string;
  statusTs: number;
}

export type BusEvent =
  | { kind: "message:created"; message: Message }
  | { kind: "message:released"; id: string }
  | { kind: "message:edited"; id: string; edit: MessageEdit }
  | { kind: "message:consumed"; id: string; by: AgentId }
  | { kind: "message:dropped"; id: string }
  | { kind: "agent:status"; agent: AgentId; status: string; statusTs: number }
  | { kind: "agent:mode"; agent: AgentId; mode: AgentMode };

export interface BusConfig {
  port: number;
  modes: Record<"claude" | "codex", AgentMode>;
  createdAt: number;
}

export const DEFAULT_PORT = 7777;

export function isAgentId(v: unknown): v is AgentId {
  return v === "claude" || v === "codex" || v === "user";
}

export function isLlmAgent(v: unknown): v is "claude" | "codex" {
  return v === "claude" || v === "codex";
}

export function isMessageType(v: unknown): v is MessageType {
  return MESSAGE_TYPES.includes(v as MessageType);
}

export function isAgentMode(v: unknown): v is AgentMode {
  return v === "auto" || v === "manual";
}
