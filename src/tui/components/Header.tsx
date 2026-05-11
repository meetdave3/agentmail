import React from "react";
import { Box, Text } from "ink";
import { basename } from "node:path";

interface Props {
  busDir: string;
  port: number;
  connected: boolean;
}

export function Header({ busDir, port, connected }: Props): React.ReactElement {
  const project = basename(busDir.replace(/\/?\.bus\/?$/, ""));
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      justifyContent="space-between"
    >
      <Text>
        <Text bold color="cyan">
          agentbus
        </Text>{" "}
        · <Text color="white">{project}</Text>
      </Text>
      <Text>
        <Text dimColor>127.0.0.1:{port}</Text>{" "}
        {connected ? (
          <Text color="green">● live</Text>
        ) : (
          <Text color="red">○ disconnected</Text>
        )}
      </Text>
    </Box>
  );
}
