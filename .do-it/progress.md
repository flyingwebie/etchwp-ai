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

## [2026-06-12] F3: Blocks domain — built
etch_blocks_read (7 actions; depth/summary post-processing, E_READ_TOO_LARGE size guard,
raw-html unsafe stripped unless include_unsafe) + etch_blocks_write (17 actions; create/replace
EtchBlockJson w/ recursive styles+id rejection teaching errors, update=BlockPatch merge-only,
add/remove_class via styleId, mode-aware dirty: doc mutations → componentEditDirty inside edit
mode, revert-exit clears it, save_component_edit persists definition). ctx.componentEditMode
server-tracked. 58 tests green.

## [2026-06-12] F4: Styles + tokens — built
etch_styles_read/write (rules CRUD + variables; create hints add_class wiring; pageDirty),
etch_tokens (merge listVariables [etch] + readRootVariables [computed], dedupe etch-wins,
ORIGIN-based acss classification via ETCH_ACSS_STYLESHEET_PATTERN — survives renamed palettes;
ACSS_VARIABLE_PREFIXES = namespace display metadata only). Fixture partition test covers renamed
--action-* family and colliding --text-brand user var. 64 tests green.
