## [2026-06-12] F1: CDP bridge core — built
Branch feat/2026-06-12-F1-cdp-bridge-core. EtchBridge interface + CdpBridge (playwright-core
connectOverCDP), 85-op allowlist (9 domains + root), FIFO CallQueue w/ E_TIMEOUT, deterministic
tab discovery (E_NO_TAB / E_MULTIPLE_TABS, never auto-pick), fixed page functions, session epoch
+ reload flag, MockBridge. 32 tests green. CDP glue untestable in CI (no Chrome) — pure parts tested.

## [2026-06-12] F2: MCP server skeleton + status/save — built
McpServer + ToolContext (lazy attach), §4.4 envelope + error table, etch_status (featureMap cached,
reload-exempt), etch_save (clears pageDirty only, hints componentEditDirty), split DirtyTracker +
MutationCounter, E_SESSION_RELOADED once-semantics, stderr-only logging + dirty disconnect warning,
CI workflow (test/typecheck/lint on PR). 44 tests green.
