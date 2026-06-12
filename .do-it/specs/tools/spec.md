# Spec: tools

### Requirement: Blocks domain coverage
etch_blocks_read (get_tree/get_json w/ depth+summary+size guard+raw-html sanitization, find
presence-only, get_selected, get_attribute, has_class, is_in_component_edit_mode) and
etch_blocks_write (17 actions; create/replace=EtchBlockJson w/ styles+id rejection,
update=BlockPatch merge-only, classes via styleId, mode-aware dirty, revert path,
save_component_edit) per PRD §7.1 F3.
