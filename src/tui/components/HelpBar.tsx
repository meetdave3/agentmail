import React from "react";
import { Box, Text } from "ink";

export function HelpBar(): React.ReactElement {
  return (
    <Box paddingX={1}>
      <Text dimColor>
        [1/2] toggle mode · [j/k] move · [enter] expand · [r]elease · [d]rop · [g] release all · [q] quit
      </Text>
    </Box>
  );
}
