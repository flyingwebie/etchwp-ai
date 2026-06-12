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

## [2026-06-12] F5: Stylesheets domain — built
etch_stylesheets_read (list/get/list_custom_media) + etch_stylesheets_write (create/update/append/
delete/add_custom_media; IMMEDIATE persistence, never dirty). 66 tests green.

## [2026-06-12] F6: Components domain — built
etch_components_read/write — numeric-id validation teaching errors, update = partial patch with
properties/blocks wholesale-replacement warning hint, reserved number-primitive property rejected,
create→empty hint. IMMEDIATE persistence. 70 tests green.

## [2026-06-12] F7: Loops domain — built
etch_loops_read (get_all, fuzzy find) + etch_loops_write (add/update/delete/set_for_block;
update full-replacement teaching error; open-ended WP query args; $param ?? default mini-language
documented in descriptions). pageDirty. 74 tests green.

## [2026-06-12] F8: Fields domain — built
etch_fields_read (list_groups/get_group/get_values/get_value) + etch_fields_write (9 actions;
full-replacement teaching errors on update_group/update_field; open CustomFieldType; numeric
postId validation). IMMEDIATE persistence. 76 tests green.

## [2026-06-12] F9: Navigation, UI chrome + history — built
etch_nav (8 actions; E_UNSAVED_CHANGES dirty guard + discard:true on open_post/open_template/go_to;
expectNavigation suppresses false E_SESSION_RELOADED; exit_to_wordpress confirm-gated, detaches;
getActivePostId/isEditingTemplate consumed by etch_status per grill C24), etch_ui (6 chrome actions,
local-ui, non-dirty), etch_history (undo/redo/can_undo/can_redo; no dirty adjustment — lower-bound
semantics; excluded from MutationCounter via countMutation:false). 83 tests green.

## [2026-06-12] F10: Screenshot — built
etch_screenshot: MCP image content; PNG IHDR dimension parse (no image lib) → scaled recapture
via CDP Emulation.setDeviceMetricsOverride when longest edge >1600px; JPEG q70 fallback when
payload >800KB (E_READ_TOO_LARGE if still over); hide_chrome wraps capture in set_interface_hidden;
canvas mode ships viewport fallback noted (selector = open Q4). 88 tests green.

## [2026-06-12] F11: Checkpoint/rollback — built
etch_history gains checkpoint (records MutationCounter value) + rollback (undo-N with canUndo
guard each step; {requested, performed, stoppedBecause}; immediate-domain writes since checkpoint
listed with undocumented-undo warning; best-effort semantics in description). undo/redo/ui-chrome/
nav/save excluded from MutationCounter. 91 tests green.
