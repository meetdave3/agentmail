import React, { useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import {
  busUrl,
  readConfig,
  resolvePaths,
} from "../shared/config.ts";
import { Header } from "./components/Header.tsx";
import { AgentPanel } from "./components/AgentPanel.tsx";
import { MessageLog } from "./components/MessageLog.tsx";
import { PendingReview } from "./components/PendingReview.tsx";
import { HelpBar } from "./components/HelpBar.tsx";
import { useBus } from "./hooks/useBus.ts";
import { TuiApi } from "./api.ts";

interface AppProps {
  port: number;
  busDir: string;
}

function App({ port, busDir }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const state = useBus(port);
  const api = useMemo(() => new TuiApi(port), [port]);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const clampedIdx = state.pending.length === 0
    ? 0
    : Math.min(selectedIdx, state.pending.length - 1);

  const pendingByAgent = useMemo(() => {
    const c = { claude: 0, codex: 0 };
    for (const m of state.pending) {
      if (m.to === "claude" || m.to === "codex") c[m.to] += 1;
    }
    return c;
  }, [state.pending]);

  const doAction = async (label: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(label);
    setLastError(null);
    try {
      await fn();
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (input === "1") {
      const next = state.agents.claude.mode === "auto" ? "manual" : "auto";
      void doAction(`claude → ${next}`, () => api.setMode("claude", next));
      return;
    }
    if (input === "2") {
      const next = state.agents.codex.mode === "auto" ? "manual" : "auto";
      void doAction(`codex → ${next}`, () => api.setMode("codex", next));
      return;
    }
    if (state.pending.length === 0) return;
    if (input === "j" || key.downArrow) {
      setSelectedIdx((i) => Math.min(i + 1, state.pending.length - 1));
      setExpanded(false);
      return;
    }
    if (input === "k" || key.upArrow) {
      setSelectedIdx((i) => Math.max(i - 1, 0));
      setExpanded(false);
      return;
    }
    if (key.rightArrow) {
      setExpanded(true);
      return;
    }
    if (key.leftArrow) {
      setExpanded(false);
      return;
    }
    if (key.return) {
      setExpanded((v) => !v);
      return;
    }
    const target = state.pending[clampedIdx];
    if (!target) return;
    if (input === "r") {
      void doAction(`releasing ${target.id}`, () => api.release(target.id));
      return;
    }
    if (input === "d") {
      void doAction(`dropping ${target.id}`, () => api.drop(target.id));
      return;
    }
    if (input === "g") {
      void doAction("releasing all", async () => {
        for (const m of state.pending) {
          await api.release(m.id).catch(() => undefined);
        }
      });
    }
  });

  return (
    <Box flexDirection="column">
      <Header busDir={busDir} port={port} connected={state.connected} />
      <Box>
        <AgentPanel agent={state.agents.claude} pendingCount={pendingByAgent.claude} hotkey="1" />
        <AgentPanel agent={state.agents.codex} pendingCount={pendingByAgent.codex} hotkey="2" />
      </Box>
      <MessageLog messages={state.log} rows={14} />
      <PendingReview
        pending={state.pending}
        selectedIdx={clampedIdx}
        expanded={expanded}
        busy={busy}
        lastError={lastError}
      />
      <HelpBar />
      {!state.connected && (
        <Box paddingX={1}>
          <Text color="red">
            disconnected from daemon — start it with `agentbus start`
          </Text>
        </Box>
      )}
    </Box>
  );
}

export async function renderTui(): Promise<void> {
  const paths = resolvePaths();
  const config = readConfig(paths);

  // Sanity check: daemon reachable?
  try {
    const res = await fetch(`${busUrl(config.port)}/api/health`);
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (err) {
    console.error(
      `agentbus tui: daemon not reachable at ${busUrl(config.port)} — run \`agentbus start\` first.`,
    );
    console.error(`  detail: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const { waitUntilExit } = render(<App port={config.port} busDir={paths.busDir} />);
  await waitUntilExit();
}
