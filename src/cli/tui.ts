export async function runTui(): Promise<void> {
  // Lazy-load Ink/React so non-TUI commands stay fast and don't pay for the
  // (chunky) renderer on simple operations.
  const { renderTui } = await import("../tui/app.tsx");
  await renderTui();
}
