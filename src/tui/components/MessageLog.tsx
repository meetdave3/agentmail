import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../../shared/types.ts";

interface Props {
  messages: Message[];
  rows: number;
}

function statusBadge(status: Message["status"]): React.ReactElement {
  switch (status) {
    case "pending":
      return (
        <Text color="yellow" inverse>
          {" HELD "}
        </Text>
      );
    case "released":
      return (
        <Text color="cyan" inverse>
          {" RELE "}
        </Text>
      );
    case "consumed":
      return (
        <Text color="green" inverse>
          {" READ "}
        </Text>
      );
    case "dropped":
      return (
        <Text color="gray" inverse>
          {" DROP "}
        </Text>
      );
  }
}

function arrow(from: Message["from"], to: Message["to"]): React.ReactElement {
  const colorFor = (a: string) =>
    a === "claude" ? "magenta" : a === "codex" ? "blue" : "white";
  return (
    <Text>
      <Text color={colorFor(from)}>{from}</Text>
      <Text dimColor> → </Text>
      <Text color={colorFor(to)}>{to}</Text>
    </Text>
  );
}

function hhmmss(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19);
}

export function MessageLog({ messages, rows }: Props): React.ReactElement {
  const slice = messages.slice(0, rows);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      flexGrow={1}
    >
      <Text dimColor>LIVE LOG</Text>
      {slice.length === 0 ? (
        <Text dimColor>no messages yet — send something with bus_send</Text>
      ) : (
        slice.map((m) => (
          <Box key={m.id}>
            <Text dimColor>{hhmmss(m.ts)} </Text>
            {statusBadge(m.status)}
            <Text> </Text>
            {arrow(m.from, m.to)}
            <Text dimColor> [{m.type}] </Text>
            <Text>{m.title}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
