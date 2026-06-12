import { toolError } from "../errors.ts";

/**
 * The complete documented Etch Public API surface (contract 0.x).
 * Source of truth: .do-it/research/etch-api-map.md §2.
 * The bridge refuses to evaluate anything not listed here — there is no
 * client-supplied JS path (PRD §4.2 rule 2).
 */
export const ETCH_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  root: ["saveAsync"],
  blocks: [
    "select",
    "deselect",
    "getSelectedId",
    "getJson",
    "getTree",
    "find",
    "create",
    "delete",
    "duplicate",
    "move",
    "replace",
    "update",
    "setText",
    "rename",
    "getAttribute",
    "setAttribute",
    "removeAttribute",
    "addClass",
    "removeClass",
    "hasClass",
    "enterComponentEditMode",
    "exitComponentEditMode",
    "isInComponentEditMode",
    "saveComponentEditModeAsync",
  ],
  styles: [
    "list",
    "create",
    "update",
    "delete",
    "listVariables",
    "getVariable",
    "setVariable",
    "removeVariable",
  ],
  stylesheets: [
    "list",
    "get",
    "createAsync",
    "updateAsync",
    "appendAsync",
    "deleteAsync",
    "listCustomMedia",
    "addCustomMediaAsync",
  ],
  components: ["list", "getJson", "createAsync", "updateAsync", "deleteAsync"],
  loops: ["getAll", "add", "update", "delete", "findLoop", "setForBlock"],
  navigation: [
    "goTo",
    "getCurrentPlace",
    "getPlaces",
    "openPostAsync",
    "openTemplateAsync",
    "getActivePostId",
    "isEditingTemplate",
    "listPostsAsync",
    "listTemplatesAsync",
  ],
  fields: [
    "listGroupsAsync",
    "getGroupAsync",
    "createGroupAsync",
    "updateGroupAsync",
    "deleteGroupAsync",
    "addFieldAsync",
    "updateFieldAsync",
    "removeFieldAsync",
    "getValuesAsync",
    "getValueAsync",
    "setValueAsync",
    "setValuesAsync",
    "deleteValueAsync",
  ],
  ui: [
    "getColorScheme",
    "setColorScheme",
    "toggleColorScheme",
    "isInterfaceHidden",
    "setInterfaceHidden",
    "toggleInterface",
    "exitToWordPress",
  ],
  history: ["undo", "redo", "canUndo", "canRedo"],
});

export function assertAllowed(domain: string, method: string): void {
  const methods = Object.hasOwn(ETCH_ALLOWLIST, domain) ? ETCH_ALLOWLIST[domain] : undefined;
  if (!methods || !methods.includes(method)) {
    throw toolError("E_VALIDATION", `'${domain}.${method}' is not a documented Etch API operation`);
  }
}

export function allOperations(): Array<{ domain: string; method: string }> {
  return Object.entries(ETCH_ALLOWLIST).flatMap(([domain, methods]) =>
    methods.map((method) => ({ domain, method })),
  );
}
