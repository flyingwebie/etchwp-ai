/**
 * Maps every documented Etch Public API operation (the allowlist) to the MCP
 * tool/action that exposes it. The coverage test fails if any op is unmapped
 * or any mapping references an unknown op — this is the §6.3-3 coverage gate.
 * navigation.getActivePostId / isEditingTemplate are consumed by etch_status
 * (no duplicate read path, grill finding C24).
 */
export interface OpMapping {
  tool: string;
  action: string | null; // null = the whole tool IS the op
}

export const OPS_MANIFEST: Record<string, Record<string, OpMapping>> = {
  root: {
    saveAsync: { tool: "etch_save", action: null },
  },
  blocks: {
    select: { tool: "etch_blocks_write", action: "select" },
    deselect: { tool: "etch_blocks_write", action: "deselect" },
    getSelectedId: { tool: "etch_blocks_read", action: "get_selected" },
    getJson: { tool: "etch_blocks_read", action: "get_json" },
    getTree: { tool: "etch_blocks_read", action: "get_tree" },
    find: { tool: "etch_blocks_read", action: "find" },
    create: { tool: "etch_blocks_write", action: "create" },
    delete: { tool: "etch_blocks_write", action: "delete" },
    duplicate: { tool: "etch_blocks_write", action: "duplicate" },
    move: { tool: "etch_blocks_write", action: "move" },
    replace: { tool: "etch_blocks_write", action: "replace" },
    update: { tool: "etch_blocks_write", action: "update" },
    setText: { tool: "etch_blocks_write", action: "set_text" },
    rename: { tool: "etch_blocks_write", action: "rename" },
    getAttribute: { tool: "etch_blocks_read", action: "get_attribute" },
    setAttribute: { tool: "etch_blocks_write", action: "set_attribute" },
    removeAttribute: { tool: "etch_blocks_write", action: "remove_attribute" },
    addClass: { tool: "etch_blocks_write", action: "add_class" },
    removeClass: { tool: "etch_blocks_write", action: "remove_class" },
    hasClass: { tool: "etch_blocks_read", action: "has_class" },
    enterComponentEditMode: { tool: "etch_blocks_write", action: "enter_component_edit" },
    exitComponentEditMode: { tool: "etch_blocks_write", action: "exit_component_edit" },
    isInComponentEditMode: { tool: "etch_blocks_read", action: "is_in_component_edit_mode" },
    saveComponentEditModeAsync: { tool: "etch_blocks_write", action: "save_component_edit" },
  },
  styles: {
    list: { tool: "etch_styles_read", action: "list" },
    create: { tool: "etch_styles_write", action: "create" },
    update: { tool: "etch_styles_write", action: "update" },
    delete: { tool: "etch_styles_write", action: "delete" },
    listVariables: { tool: "etch_styles_read", action: "list_variables" },
    getVariable: { tool: "etch_styles_read", action: "get_variable" },
    setVariable: { tool: "etch_styles_write", action: "set_variable" },
    removeVariable: { tool: "etch_styles_write", action: "remove_variable" },
  },
  stylesheets: {
    list: { tool: "etch_stylesheets_read", action: "list" },
    get: { tool: "etch_stylesheets_read", action: "get" },
    createAsync: { tool: "etch_stylesheets_write", action: "create" },
    updateAsync: { tool: "etch_stylesheets_write", action: "update" },
    appendAsync: { tool: "etch_stylesheets_write", action: "append" },
    deleteAsync: { tool: "etch_stylesheets_write", action: "delete" },
    listCustomMedia: { tool: "etch_stylesheets_read", action: "list_custom_media" },
    addCustomMediaAsync: { tool: "etch_stylesheets_write", action: "add_custom_media" },
  },
  components: {
    list: { tool: "etch_components_read", action: "list" },
    getJson: { tool: "etch_components_read", action: "get_json" },
    createAsync: { tool: "etch_components_write", action: "create" },
    updateAsync: { tool: "etch_components_write", action: "update" },
    deleteAsync: { tool: "etch_components_write", action: "delete" },
  },
  loops: {
    getAll: { tool: "etch_loops_read", action: "get_all" },
    add: { tool: "etch_loops_write", action: "add" },
    update: { tool: "etch_loops_write", action: "update" },
    delete: { tool: "etch_loops_write", action: "delete" },
    findLoop: { tool: "etch_loops_read", action: "find" },
    setForBlock: { tool: "etch_loops_write", action: "set_for_block" },
  },
  navigation: {
    goTo: { tool: "etch_nav", action: "go_to" },
    getCurrentPlace: { tool: "etch_nav", action: "get_current_place" },
    getPlaces: { tool: "etch_nav", action: "get_places" },
    openPostAsync: { tool: "etch_nav", action: "open_post" },
    openTemplateAsync: { tool: "etch_nav", action: "open_template" },
    getActivePostId: { tool: "etch_status", action: null },
    isEditingTemplate: { tool: "etch_status", action: null },
    listPostsAsync: { tool: "etch_nav", action: "list_posts" },
    listTemplatesAsync: { tool: "etch_nav", action: "list_templates" },
  },
  fields: {
    listGroupsAsync: { tool: "etch_fields_read", action: "list_groups" },
    getGroupAsync: { tool: "etch_fields_read", action: "get_group" },
    createGroupAsync: { tool: "etch_fields_write", action: "create_group" },
    updateGroupAsync: { tool: "etch_fields_write", action: "update_group" },
    deleteGroupAsync: { tool: "etch_fields_write", action: "delete_group" },
    addFieldAsync: { tool: "etch_fields_write", action: "add_field" },
    updateFieldAsync: { tool: "etch_fields_write", action: "update_field" },
    removeFieldAsync: { tool: "etch_fields_write", action: "remove_field" },
    getValuesAsync: { tool: "etch_fields_read", action: "get_values" },
    getValueAsync: { tool: "etch_fields_read", action: "get_value" },
    setValueAsync: { tool: "etch_fields_write", action: "set_value" },
    setValuesAsync: { tool: "etch_fields_write", action: "set_values" },
    deleteValueAsync: { tool: "etch_fields_write", action: "delete_value" },
  },
  ui: {
    getColorScheme: { tool: "etch_ui", action: "get_color_scheme" },
    setColorScheme: { tool: "etch_ui", action: "set_color_scheme" },
    toggleColorScheme: { tool: "etch_ui", action: "toggle_color_scheme" },
    isInterfaceHidden: { tool: "etch_ui", action: "is_interface_hidden" },
    setInterfaceHidden: { tool: "etch_ui", action: "set_interface_hidden" },
    toggleInterface: { tool: "etch_ui", action: "toggle_interface" },
    exitToWordPress: { tool: "etch_nav", action: "exit_to_wordpress" },
  },
  history: {
    undo: { tool: "etch_history", action: "undo" },
    redo: { tool: "etch_history", action: "redo" },
    canUndo: { tool: "etch_history", action: "can_undo" },
    canRedo: { tool: "etch_history", action: "can_redo" },
  },
};
