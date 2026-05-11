import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../../shared/types.ts";

interface Props {
  pending: Message[];
  selectedIdx: number;
  busy: string | null;
  lastError: string | null;
}

export function PendingReview({
  pending,
  selectedIdx,
  busy,
  lastError,
}: Props): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={pending.length > 0 ? "yellow" : "gray"}
      paddingX={1}
    >
      <Box>
        <Text dimColor>PENDING REVIEW </Text>
        <Text color={pending.length > 0 ? "yellow" : undefined} bold>
          ({pending.length})
        </Text>
        <Text dimColor>
          {"  ·  [j/k] move  ·  [r]elease  ·  [d]rop  ·  [g] release all"}
        </Text>
      </Box>
      {pending.length === 0 ? (
        <Text dimColor>nothing waiting for review</Text>
      ) : (
        pending.map((m, i) => {
          const selected = i === selectedIdx;
          return (
            <Box key={m.id}>
              <Text color={selected ? "yellow" : undefined}>
                {selected ? "▸ " : "  "}
              </Text>
              <Text
                color={m.from === "claude" ? "magenta" : "blue"}
                bold={selected}
              >
                {m.from}
              </Text>
              <Text dimColor> → </Text>
              <Text color={m.to === "claude" ? "magenta" : "blue"} bold={selected}>
                {m.to}
              </Text>
              <Text dimColor> [{m.type}] </Text>
              <Text bold={selected}>{m.title}</Text>
            </Box>
          );
        })
      )}
      {busy && (
        <Box marginTop={1}>
          <Text color="cyan">… {busy}</Text>
        </Box>
      )}
      {lastError && (
        <Box marginTop={1}>
          <Text color="red">! {lastError}</Text>
        </Box>
      )}
    </Box>
  );
}
