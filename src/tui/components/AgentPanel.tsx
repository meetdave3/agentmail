import React from "react";
import { Box, Text } from "ink";
import type { AgentState } from "../../shared/types.ts";

interface Props {
  agent: AgentState;
  pendingCount: number;
  hotkey: string;
}

function relTime(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export function AgentPanel({ agent, pendingCount, hotkey }: Props): React.ReactElement {
  const name = agent.id.toUpperCase();
  const isAuto = agent.mode === "auto";
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={agent.id === "claude" ? "magenta" : "blue"}
      paddingX={1}
      width="50%"
    >
      <Box justifyContent="space-between">
        <Text bold color={agent.id === "claude" ? "magenta" : "blue"}>
          {name}
        </Text>
        <Text>
          <Text dimColor>[{hotkey}] </Text>
          <Text
            color={isAuto ? "green" : "yellow"}
            inverse
          >
            {" "}
            {agent.mode.toUpperCase()}{" "}
          </Text>
        </Text>
      </Box>
      <Box marginTop={0}>
        <Text dimColor>status:</Text>
        <Text> {agent.status || <Text dimColor>—</Text>}</Text>
      </Box>
      <Box>
        <Text dimColor>last update:</Text>
        <Text> {relTime(agent.statusTs)}</Text>
      </Box>
      <Box>
        <Text dimColor>pending for me:</Text>
        <Text color={pendingCount > 0 ? "yellow" : undefined}> {pendingCount}</Text>
      </Box>
    </Box>
  );
}
