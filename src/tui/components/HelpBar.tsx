import React from "react";
import { Box, Text } from "ink";

export function HelpBar(): React.ReactElement {
  return (
    <Box paddingX={1}>
      <Text dimColor>
        [1] toggle Claude mode · [2] toggle Codex mode · [q] quit
      </Text>
    </Box>
  );
}
