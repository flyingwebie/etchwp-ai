# Spec: tools

### Requirement: Blocks domain coverage
etch_blocks_read (get_tree/get_json w/ depth+summary+size guard+raw-html sanitization, find
presence-only, get_selected, get_attribute, has_class, is_in_component_edit_mode) and
etch_blocks_write (17 actions; create/replace=EtchBlockJson w/ styles+id rejection,
update=BlockPatch merge-only, classes via styleId, mode-aware dirty, revert path,
save_component_edit) per PRD §7.1 F3.

### Requirement: Full domain coverage
All 85 documented 0.x ops exposed across 20 core tools (+2 sidecar); ops manifest CI-gated;
schema lint (no top-level unions, depth ≤5); persistence regime in every response.

### Requirement: Safety rails
Dirty guard on context-changing navigation; confirm gate on exit_to_wordpress; checkpoint/rollback;
insert_pattern zero-mutation validation + partial-failure manifest; raw-html unsafe gating;
credential hygiene (sidecar).

### Requirement: Distribution
Node ≥20 dist via bun build, bin etchwp-ai, MIT, npm provenance release flow with Node 20/22
pack+handshake matrix; README with per-OS setup, 4 client configs, troubleshooting matrix,
canonical verification script; generated coverage table.
