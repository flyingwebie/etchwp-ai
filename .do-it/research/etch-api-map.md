# Etch Public API — Capability Map for MCP Connector Design

> Synthesized from docs.etchwp.com/public-api (index + blocks, styles, stylesheets, components, loops, navigation, fields, ui-and-history, types-reference), all last updated 2026-06-11, cross-verified against github.com/Digital-Gravy/etch-docs. Entire Public API section is badged "New".

---

## 1. Overview

**What it is.** Etch (WordPress visual builder by Digital Gravy) exposes a typed JavaScript scripting API on `window.etch` that lets scripts/plugins read and mutate the document the builder is editing: blocks, styles, stylesheets, loops, components, custom fields, navigation, UI chrome, and undo/redo history. Every mutation routes through the same guarded paths as the UI, so undo/redo and validation always apply.

**Transport.** In-browser JavaScript runtime API — **NOT REST/HTTP**. No HTTP endpoints are documented anywhere. The global `window.etch` is injected by the Etch builder during page load and exists **only inside a loaded builder session**. The published contract is the MIT-licensed npm package `@digital-gravy/etch-public-api` (TypeScript types + thin accessor `getEtch(options?)` / `isEtchAvailable()`; the builder on the page provides the runtime). Since `window.etch` may appear after a script runs, docs recommend polling `isEtchAvailable()` (100ms interval, 10s timeout).

**Auth model.** No API keys, nonces, capabilities, or application passwords documented. Access is implicitly gated by context: the API only exists for a logged-in WordPress user with the Etch builder open. `getEtch()` throws `EtchApiError` code `NOT_AVAILABLE` outside the builder. `ConnectOptions` supports `id` (plugin identifier, telemetry only) and `apiVersion` (e.g. `"^1.0"`, reserved for the future 1.x runtime; on 0.x a major-version mismatch only warns).

**Versioning / beta status.** Contract version is **0.x and explicitly experimental** — the surface may change WITHOUT a major version bump until stable. Docs say: prefer feature detection (`typeof etch.blocks.someMethod === "function"`) over version comparison; do NOT pin production plugins to 0.x. Root object exposes `readonly apiVersion` (contract, "0.x") and `readonly version` (Etch product). `etch.connect?()` is reserved for the future stable runtime (feature-detect before use). `ETCH_API_VERSION` const in the npm package = `"0.x"`.

**Persistence model (split — critical):**
- **Buffered** (lost unless `await etch.saveAsync()` is called — the same save the UI performs): all `blocks.*`, `styles.*`, `loops.*` mutations.
- **Immediate** (no saveAsync needed): all `stylesheets.*Async`, `components.*Async`, `fields.*Async` mutating methods.
- **Component definitions**: a third path — `blocks.saveComponentEditModeAsync()` persists the component definition; `etch.saveAsync()` still persists the page.

**Error model.** Every API error is an `EtchApiError extends Error` with machine-readable `code: EtchApiErrorCode`: `BLOCK_NOT_FOUND | WRONG_BLOCK_TYPE | READONLY | INVALID_ARGUMENT | LOOP_NOT_FOUND | STYLE_NOT_FOUND | STYLESHEET_NOT_FOUND | COMPONENT_NOT_FOUND | POST_NOT_FOUND | OPERATION_FAILED | NOT_AVAILABLE | (string & {})` — open-ended union; tolerate unknown codes. Type guard: `isEtchApiError(value)`.

**Module exports (npm package):** `getEtch(options?: ConnectOptions): Etch` (throws NOT_AVAILABLE), `isEtchAvailable(): boolean`, `isEtchApiError(v): v is EtchApiError`, `EtchApiError` class, `ETCH_API_VERSION` const, plus all contract types.

**Root `Etch` interface:** nine namespaces (`blocks`, `loops`, `styles`, `stylesheets`, `components`, `navigation`, `fields`, `ui`, `history`) plus `saveAsync(): Promise<void>`, reserved `connect?()`, `apiVersion`, `version`.

---

## 2. Capability Domains

### 2.1 Blocks (`etch.blocks` — EtchBlocksApi) — persistence: BUFFERED (saveAsync)

Selection & reading:
| Operation | Signature | Params | Returns | Notes |
|---|---|---|---|---|
| select | `select(blockId: string): void` | blockId req. | void | Selects block in canvas |
| deselect | `deselect(): void` | — | void | Clears selection |
| getSelectedId | `getSelectedId(): string \| null` | — | string\|null | |
| getJson | `getJson(blockId: string): PublicBlockJson` | blockId req. | block + subtree (read shape) | Discriminated union on `type`; throws BLOCK_NOT_FOUND |
| getTree | `getTree(): PublicBlockJson[]` | — | whole document (top-level blocks, recursive children) | Inside component edit mode returns the component's tree instead |
| find | `find(predicate: FindBlocksPredicate): string[]` | `{ type?, class?, attribute? }` all optional | matching block ids | type = exact match; class/attribute = presence only (no value matching, no regex) |

Structural mutations:
| Operation | Signature | Params | Returns | Notes |
|---|---|---|---|---|
| create | `create(json: EtchBlockJson, parentId?: string, index?: number): string` | authoring JSON (type-checked union); optional parent + index | new block id | `styles` array REJECTED on authoring; every block needs `version`, `context`, `children` |
| delete | `delete(blockId: string): void` | blockId req. | void | Removes block AND entire subtree |
| duplicate | `duplicate(blockId: string): string` | blockId req. | new block id | Deep copy |
| move | `move(blockId: string, newParentId: string \| null, index?: number): void` | null parent = re-parent to document root | void | |
| replace | `replace(blockId: string, json: EtchBlockJson): string` | full authoring JSON | resulting block id | |
| update | `update(blockId: string, patch: BlockPatch): void` | `{ name?, hidden?, attributes? (merge; undefined removes key), text? (text blocks only) }` | void | Patches only the "editable surface", in place |

Text / naming / attributes / classes:
| Operation | Signature | Notes |
|---|---|---|
| setText | `setText(blockId: string, text: string): void` | etch/text only — WRONG_BLOCK_TYPE otherwise |
| rename | `rename(blockId: string, name: string): void` | Structure-panel label |
| getAttribute | `getAttribute(blockId: string, key: string): string \| undefined` | |
| setAttribute | `setAttribute(blockId: string, key: string, value?: string): void` | undefined clears. Special behavior keys: etch/dynamic-image → `mediaId` (supports `{post.featured_image_id}` tokens), `useSrcSet` ("true"), `maximumSize`; etch/svg → `src`, `stripColors`; etch/dynamic-element → `tag`. Boolean-ish values are strings |
| removeAttribute | `removeAttribute(blockId: string, key: string): void` | |
| addClass | `addClass(blockId: string, className: string): void` | Pass the **style id** from `styles.create()` / StyleSummary.id — NOT the selector text. Only way to set the read-only `styles` array |
| removeClass | `removeClass(blockId: string, className: string): void` | |
| hasClass | `hasClass(blockId: string, className: string): boolean` | |

Component edit mode:
| Operation | Signature | Notes |
|---|---|---|
| enterComponentEditMode | `enterComponentEditMode(blockId: string): void` | blockId of an etch/component block; afterwards the component's internal tree is reachable via the same blocks methods |
| exitComponentEditMode | `exitComponentEditMode(options?: { revert?: boolean }): void` | `revert: true` discards changes |
| isInComponentEditMode | `isInComponentEditMode(): boolean` | |
| saveComponentEditModeAsync | `saveComponentEditModeAsync(): Promise<void>` | Persists the component DEFINITION (separate from page save). Docs flow: enter → edit → await saveComponentEditModeAsync() → await etch.saveAsync() → exit |

### 2.2 Styles (`etch.styles` — EtchStylesApi) — persistence: BUFFERED (saveAsync)

CSS rules:
| Operation | Signature | Params | Returns |
|---|---|---|---|
| list | `list(filter?: StyleListFilter): StyleSummary[]` | `{ type?: StyleSelectorType }` | `{ id, selector, type?, collection ("default"), css }[]` |
| create | `create(selector: string, css?: string): string` | selector e.g. ".lead"; css declarations | new rule id (the addClass handle) |
| update | `update(styleId: string, patch: StylePatch): void` | `{ selector?, css? }` | void |
| delete | `delete(styleId: string): void` | | void |

CSS variables (`:root` custom properties; optional named collection):
| Operation | Signature | Returns |
|---|---|---|
| listVariables | `listVariables(collection?: string): Record<string, string>` | e.g. `{ "--brand": "#0af" }` |
| getVariable | `getVariable(name: string, collection?: string): string \| undefined` | |
| setVariable | `setVariable(name: string, value: string, collection?: string): void` | |
| removeVariable | `removeVariable(name: string, collection?: string): void` | |

Notes: StyleSummary.type is inferred and may be undefined; `collection` field on rules is internal (always "default") — distinct from the meaningful `collection` arg on variable methods. Variable names include leading `--`. No error behavior documented for invalid styleId / duplicate selector / malformed CSS.

### 2.3 Stylesheets (`etch.stylesheets` — EtchStylesheetsApi) — persistence: IMMEDIATE

| Operation | Signature | Params | Returns | Notes |
|---|---|---|---|---|
| list | `list(): StylesheetSummary[]` | — | `{ id, name, css, type }[]` | Sync read |
| get | `get(stylesheetId: string): StylesheetSummary` | id req. | summary | Throws STYLESHEET_NOT_FOUND |
| createAsync | `createAsync(input: StylesheetInput): Promise<string>` | `{ name (req), css (req), type? ("default" default) }` | new id | |
| updateAsync | `updateAsync(stylesheetId: string, patch: StylesheetPatch): Promise<void>` | `{ name?, css?, type? }` | void | Partial patch |
| appendAsync | `appendAsync(stylesheetId: string, css: string): Promise<void>` | | void | Newline inserted before appended CSS |
| deleteAsync | `deleteAsync(stylesheetId: string): Promise<void>` | | void | |
| listCustomMedia | `listCustomMedia(): Record<string, string>` | — | e.g. `{ "--md": "(min-width: 768px)" }` | Sync read |
| addCustomMediaAsync | `addCustomMediaAsync(name: string, query: string): Promise<void>` | name e.g. "--md" | void | "Add or look up" — idempotent-ish upsert |

StylesheetType: `"default" | "@custom-media"`.

### 2.4 Components (`etch.components` — EtchComponentsApi) — persistence: IMMEDIATE; **numeric ids**

| Operation | Signature | Params | Returns | Notes |
|---|---|---|---|---|
| list | `list(): PublicComponentSummary[]` | — | `{ id: number, name, key (PascalCase), description?, properties }[]` | No block trees |
| getJson | `getJson(componentId: number): PublicComponentJson` | numeric id | summary + `blocks: PublicBlockJson[]` | Throws COMPONENT_NOT_FOUND |
| createAsync | `createAsync(name: string): Promise<number>` | name only | new numeric id | Creates EMPTY component; set properties/blocks via follow-up updateAsync |
| updateAsync | `updateAsync(componentId: number, patch: ComponentPatch): Promise<void>` | `{ name?, key? (auto-PascalCased), description?, properties? (FULL REPLACEMENT), blocks? (FULL REPLACEMENT EtchBlockJson[]) }` | void | |
| deleteAsync | `deleteAsync(componentId: number): Promise<void>` | numeric id | void | |

ComponentProperty discriminated union (on `type.primitive` + optional `type.specialized`): string (specialized: color/url/image/select/array/wpMediaId; `options`/`selectOptionsString` for select), number (**RESERVED, not implemented**), boolean (default may be string for expression-driven defaults), object (specialized "group" → nested `properties`), array (specialized "class" → string[] of CSS classes; "repeater" → nested `properties`), string specialized "condition" (gated group; default = condition expression). `SelectOptionsString` = newline-separated "Label : Value" lines; line without " : " is both label and value; FIRST line is default.

Interactive editing of a component's internals goes through blocks' component edit mode (2.1); this namespace only offers wholesale `blocks` replacement.

### 2.5 Loops (`etch.loops` — EtchLoopsApi) — persistence: BUFFERED (saveAsync)

| Operation | Signature | Params | Returns | Notes |
|---|---|---|---|---|
| getAll | `getAll(): EtchLoopObj` | — | `Record<loopId, EtchLoop>` | |
| add | `add(loop: EtchLoop): string` | `{ key, name, global, config, [k: string]: unknown }` | generated loop id | |
| update | `update(loopId: string, loop: EtchLoop): void` | full replacement | void | Replaces, not patches |
| delete | `delete(loopId: string): void` | | void | |
| findLoop | `findLoop(query: string): (EtchLoop & { id: string })[]` | fuzzy by name/key | loops with ids | Not exact lookup |
| setForBlock | `setForBlock(blockId: string, loop: BlockLoopBinding): void` | blockId of etch/loop block; `{ loopId?, target?, itemId?, indexId?, loopParams? }` | void | e.g. `{ loopId, itemId: "post", indexId: "i", loopParams: { count: 3 } }` |

EtchLoopConfig (discriminated on `type`): `wp-query`/`main-query` (WpQueryArgs), `wp-terms` (WpTermsArgs), `wp-users` (WpUsersArgs), `json` (`data: unknown[]`). All args open-ended (`[key: string]: unknown`) mirroring WP_Query etc. Parameter mini-language: NumericParam/BooleanParam accept `"$count"`, `"$count ?? 10"`, `"$flag ?? true"` — values supplied per block via `loopParams`. `posts_per_page: -1` = all; `page` aliases `paged`.

### 2.6 Navigation (`etch.navigation` — EtchNavigationApi)

| Operation | Signature | Returns | Notes |
|---|---|---|---|
| goTo | `goTo(place: NavigationPlace): void` | void | Places: "builder" \| "templates" \| "content-hub" \| "style-manager" \| "loop-manager" |
| getCurrentPlace | `getCurrentPlace(): NavigationPlace` | current area | |
| getPlaces | `getPlaces(): NavigationPlace[]` | all valid goTo targets | Enumerate at runtime instead of hardcoding |
| openPostAsync | `openPostAsync(postId: number): Promise<void>` | void | Opens post on canvas; likely POST_NOT_FOUND on bad id (undocumented) |
| openTemplateAsync | `openTemplateAsync(templateId: number): Promise<void>` | void | |
| getActivePostId | `getActivePostId(): number \| null` | id or null | Same field for posts AND templates — disambiguate with isEditingTemplate() |
| isEditingTemplate | `isEditingTemplate(): boolean` | | |
| listPostsAsync | `listPostsAsync(postType?: string): Promise<PostSummary[]>` | `{ id, title, slug, status, postType }[]` | No pagination/sort/limit/search params; default-postType behavior unstated |
| listTemplatesAsync | `listTemplatesAsync(): Promise<TemplateSummary[]>` | `{ id, title, slug }[]` | No filters |

### 2.7 Custom Fields (`etch.fields` — EtchFieldsApi) — persistence: IMMEDIATE (all methods *Async)

Group management:
| Operation | Signature | Notes |
|---|---|---|
| listGroupsAsync | `listGroupsAsync(): Promise<Record<string, CustomFieldGroup>>` | keyed by group id |
| getGroupAsync | `getGroupAsync(groupId: string): Promise<CustomFieldGroup>` | |
| createGroupAsync | `createGroupAsync(definition: CustomFieldGroup): Promise<string>` | `{ label (req), description?, fields (req), assigned_to (req) }`; returns new group id |
| updateGroupAsync | `updateGroupAsync(groupId: string, definition: CustomFieldGroup): Promise<void>` | FULL replacement definition |
| deleteGroupAsync | `deleteGroupAsync(groupId: string): Promise<void>` | |

Field management:
| Operation | Signature | Notes |
|---|---|---|
| addFieldAsync | `addFieldAsync(groupId: string, field: CustomField): Promise<void>` | `{ label, key, type, description?, required? }` |
| updateFieldAsync | `updateFieldAsync(groupId: string, fieldKey: string, field: CustomField): Promise<void>` | FULL replacement, repeats key |
| removeFieldAsync | `removeFieldAsync(groupId: string, fieldKey: string): Promise<void>` | |

Values (per post):
| Operation | Signature | Returns |
|---|---|---|
| getValuesAsync | `getValuesAsync(postId: number): Promise<PostCustomFieldValuesResponse>` | `{ post_id, groups: Record<groupId, { label, fields: Record<fieldKey, { label, type, value }> }> }` |
| getValueAsync | `getValueAsync(postId: number, fieldKey: string): Promise<PostCustomFieldValueResponse>` | `{ post_id, group_id, field: { key, label, type, value (null when unset) } }` |
| setValueAsync | `setValueAsync(postId: number, fieldKey: string, value: unknown): Promise<PostCustomFieldValueResponse>` | updated resolved value |
| setValuesAsync | `setValuesAsync(postId: number, values: Record<string, unknown>): Promise<void>` | set many at once |
| deleteValueAsync | `deleteValueAsync(postId: number, fieldKey: string): Promise<void>` | clears one value |

CustomFieldAssignment: `{ post_types: string[], op: "isIn"|"isNotIn" } | { post_ids: number[], op } | { taxonomies: string[], op }`. CustomFieldType: `"text"|"textarea"|"number"|"boolean"|(string & {})` (open). Group/field types carry index signatures — allow additionalProperties.

### 2.8 UI & History (`etch.ui` — EtchUiApi; `etch.history` — EtchHistoryApi)

| Operation | Signature | Notes |
|---|---|---|
| ui.getColorScheme | `getColorScheme(): ColorScheme` | "light" \| "dark" |
| ui.setColorScheme | `setColorScheme(scheme: ColorScheme): void` | Persisted LOCALLY (per browser) |
| ui.toggleColorScheme | `toggleColorScheme(): void` | |
| ui.isInterfaceHidden | `isInterfaceHidden(): boolean` | Builder chrome (panels/toolbars) |
| ui.setInterfaceHidden | `setInterfaceHidden(hidden: boolean): void` | |
| ui.toggleInterface | `toggleInterface(): void` | Distraction-free mode |
| ui.exitToWordPress | `exitToWordPress(): void` | Navigates away to wp-admin — **destroys the builder session / window.etch** |
| history.undo | `undo(): void` | Same stack as keyboard shortcuts; scripted mutations participate automatically. Returns void — no success signal |
| history.redo | `redo(): void` | |
| history.canUndo | `canUndo(): boolean` | Guard before undo |
| history.canRedo | `canRedo(): boolean` | |

---

## 3. Types Reference (consolidated)

### Root & module
- `Etch`: `{ blocks; loops; styles; stylesheets; components; navigation; fields; ui; history; saveAsync(): Promise<void>; connect?(options?: ConnectOptions): Etch; readonly apiVersion: string; readonly version: string }`
- `ConnectOptions`: `{ apiVersion?: string; id?: string }`
- `EtchApiError`: `class extends Error { readonly code: EtchApiErrorCode; name: "EtchApiError" }`
- `EtchApiErrorCode`: `"BLOCK_NOT_FOUND" | "WRONG_BLOCK_TYPE" | "READONLY" | "INVALID_ARGUMENT" | "LOOP_NOT_FOUND" | "STYLE_NOT_FOUND" | "STYLESHEET_NOT_FOUND" | "COMPONENT_NOT_FOUND" | "POST_NOT_FOUND" | "OPERATION_FAILED" | "NOT_AVAILABLE" | (string & {})`

### Block JSON
- `EtchBlockType` = `` `etch/${string}` ``; `EtchBlockTypeName` = `EtchBlockJson["type"]`
- `EtchBlockJson` — AUTHORING discriminated union (no id/parentId/styles)
- `PublicBlockJson` = `WithIdentity<EtchBlockJson>` — READ shape: adds `id: string`, `parentId: string | null` (null at root), recursive `children: PublicBlockJson[]`, and `styles: readonly string[]` on styled blocks
- `EtchBlockCommon` (base of every block): `{ version: number; context: EtchBlockContext; script?: { code: string }; options?: { [k: string]: unknown }; children: EtchBlockJson[] }`
- `EtchBlockContext`: `{ name?: string; structureState?: "open" | "closed"; hidden?: boolean }`
- 13 block variants (all extend EtchBlockCommon):
  - `etch/text`: `{ text: string }`
  - `etch/element`: `{ tag: string; attributes: EtchHtmlAttributes }`
  - `etch/dynamic-element`: `{ attributes }` (rendered tag from `attributes.tag`)
  - `etch/dynamic-image`: `{ attributes }` (special: mediaId, useSrcSet, maximumSize)
  - `etch/svg`: `{ attributes }` (special: src, stripColors)
  - `etch/loop`: `{ itemId: string; target?; indexId?; loopId?; loopParams? }`
  - `etch/condition`: `{ conditionString: string }`
  - `etch/component`: `{ componentId: number; attributes }` (attrs bound to properties)
  - `etch/slot-content`: `{ slotName: string }`
  - `etch/slot-placeholder`: `{ slotName: string }`
  - `etch/post-content`: (no extra fields)
  - `etch/raw-html`: `{ content: string (sanitized); unsafe: string (original) }`
  - `etch/passthrough`: `{ gutenbergBlock: GutenbergBlock }`
- `EtchHtmlAttributes` = `Record<string, string | undefined>`
- `GutenbergBlock`: `{ blockName; innerBlocks: GutenbergBlock[]; innerHTML; innerContent: (string | null)[]; attrs }`
- `FindBlocksPredicate`: `{ type?: string; class?: string; attribute?: string }`
- `BlockPatch`: `{ name?: string; hidden?: boolean; attributes?: Record<string, string | undefined>; text?: string }`

### Styles & stylesheets
- `StyleSummary`: `{ id; selector; type: StyleSelectorType | undefined; collection: string ("default"); css }`
- `StyleListFilter`: `{ type?: StyleSelectorType }`; `StylePatch`: `{ selector?; css? }`
- `StyleSelectorType`: `"class" | "id" | "tag" | "element" | "attribute" | "custom"`
- `StylesheetSummary`: `{ id; name; css; type }`; `StylesheetInput`: `{ name; css; type? }`; `StylesheetPatch`: `{ name?; css?; type? }`
- `StylesheetType`: `"default" | "@custom-media"`

### Components
- `PublicComponentSummary`: `{ id: number; name; key (PascalCase); description?; properties: ComponentProperty[] }`
- `PublicComponentJson` = summary + `{ blocks: PublicBlockJson[] }`
- `ComponentPatch`: `{ name?; key? (auto-PascalCase); description?; properties? (replace); blocks? (replace) }`
- `ComponentProperty` = `{ name; key; description? }` & union: String (specialized?: color|url|image|select|array|wpMediaId; default?; options?; selectOptionsString?), Number (RESERVED), Boolean (default?: boolean | string), Object (default?), Array (default?), Class (array/"class", default?: string[]), Group (object/"group", nested properties), Repeater (array/"repeater", nested properties), Condition (string/"condition", nested properties, default = expression)
- `SelectOptionsString`: newline-separated "Label : Value"; no " : " → text is both; first line is default

### Loops
- `EtchLoop`: `{ key; name; global: boolean; config: EtchLoopConfig; [k]: unknown }`; `EtchLoopObj` = `Record<string, EtchLoop>`
- `EtchLoopConfig`: `{ type: "wp-query" | "main-query"; args: WpQueryArgs } | { type: "wp-terms"; args: WpTermsArgs } | { type: "wp-users"; args: WpUsersArgs } | { type: "json"; data: unknown[] }`
- `BlockLoopBinding`: `{ loopId?; target?; itemId?; indexId?; loopParams? }`
- `WpQueryArgs` (open-ended): post_type, posts_per_page (NumericParam, -1=all), offset, paged, page (alias), orderby, order, post_status, ignore_sticky_posts (BooleanParam), author, author_name, category, category_name, tag, tax_query: TaxQueryItem[], meta_query: MetaQueryItem[], s, `[k]: unknown`
- `TaxQueryItem`: `{ taxonomy; field: "term_id"|"slug"|"name"; terms; operator?: "IN"|"NOT IN"|"AND"; include_children?; [k]: unknown }`
- `MetaQueryItem`: `{ key; value; compare? (=,!=,>,>=,<,<=,LIKE,NOT LIKE,IN,NOT IN,BETWEEN,NOT BETWEEN,EXISTS,NOT EXISTS); type? (NUMERIC,BINARY,CHAR,DATE,DATETIME,DECIMAL,SIGNED,TIME,UNSIGNED); [k]: unknown }`
- `WpTermsArgs`, `WpUsersArgs` — open-ended, mirror WP queries
- `LoopParamRef` = `` `$${string}` ``; `NumericParam` = `number | LoopParamRef | "$x ?? N"`; `BooleanParam` = `boolean | 0 | 1 | LoopParamRef | "$x ?? bool"`

### Navigation / fields / UI
- `NavigationPlace`: `"builder" | "templates" | "content-hub" | "style-manager" | "loop-manager"`
- `PostSummary`: `{ id: number; title; slug; status; postType }`; `TemplateSummary`: `{ id: number; title; slug }`
- `CustomFieldGroup`: `{ label; description?; fields: CustomField[]; assigned_to: CustomFieldAssignment; [k]: unknown }`
- `CustomFieldAssignment`: `{ post_types, op } | { post_ids, op } | { taxonomies, op }` with op `"isIn" | "isNotIn"`
- `CustomField`: `{ label; key; type: CustomFieldType; description?; required?; [k]: unknown }`
- `CustomFieldType`: `"text" | "textarea" | "number" | "boolean" | (string & {})`
- `ResolvedCustomField`: `{ key; label; type; value: unknown (null when unset) }`
- `PostCustomFieldValuesResponse`: `{ post_id; groups: Record<groupId, { label; fields: Record<fieldKey, { label; type; value }> }> }`
- `PostCustomFieldValueResponse`: `{ post_id; group_id; field: ResolvedCustomField }`
- `ColorScheme`: `"light" | "dark"`

---

## 4. Gotchas & Limitations

1. **No HTTP/REST surface at all.** Browser-side JS only; an MCP connector MUST execute JS inside a loaded builder page (browser automation, injected companion script, or extension bridge).
2. **Experimental 0.x contract.** Surface may change WITHOUT a major bump. Docs: feature-detect (`typeof etch.x.y === "function"`), don't pin to 0.x. Entire docs section badged "New".
3. **Split persistence is easy to get wrong.** blocks/styles/loops = buffered, lost without `etch.saveAsync()`; stylesheets/components/fields = immediate. Component definitions need `saveComponentEditModeAsync()` (plus `saveAsync()` for the page).
4. **`getEtch()` throws NOT_AVAILABLE** outside the builder; `window.etch` appears during page load — poll `isEtchAvailable()` (100ms/10s pattern).
5. **Block `styles` array is read-only** — present in reads, rejected on authoring. Classes apply only via `blocks.addClass(blockId, styleId)` using the style **id** (not selector text).
6. **setText / BlockPatch.text are etch/text only** → WRONG_BLOCK_TYPE otherwise.
7. **Authoring JSON requires `version`, `context`, `children`** on every block; type-checked union (e.g. etch/text has no `tag`).
8. **ID type inconsistency:** component ids are NUMBERS; block/style/stylesheet/loop/group ids are STRINGS; post/template ids are numbers.
9. **Replacement-not-merge semantics:** `components.updateAsync` `properties`/`blocks`, `loops.update`, `fields.updateGroupAsync`, `fields.updateFieldAsync` all take full replacements.
10. **ComponentPatch.key auto-PascalCased**; NumberComponentProperty reserved/unimplemented; `createAsync(name)` makes an EMPTY component.
11. **Component internals** only editable via enterComponentEditMode (or wholesale `blocks` replacement); `exitComponentEditMode({ revert: true })` discards.
12. **Special string attributes drive behavior** (mediaId/useSrcSet/maximumSize, src/stripColors, dynamic-element tag); booleans as strings ("true"); dynamic bindings use `{curly}` token syntax.
13. **Nullable/undefined-driven semantics:** `move(id, null)` → document root; `setAttribute(..., undefined)` clears; `BlockPatch.attributes` merges with undefined removing keys.
14. **find() predicates are presence-only** for class/attribute — no value matching, no combinators, no regex.
15. **No pagination/filters** on listPostsAsync/listTemplatesAsync; default postType behavior unstated; large-site behavior unknown.
16. **getActivePostId() conflates posts and templates** — must pair with isEditingTemplate().
17. **Open-ended types everywhere:** EtchApiErrorCode, CustomFieldType, WpQueryArgs/TaxQueryItem/MetaQueryItem/EtchLoop carry `(string & {})` or index signatures — tool schemas need additionalProperties and must tolerate unknown enum values.
18. **Loop param mini-language:** "$count", "$count ?? 10"; values bound per-block via `loopParams`; `posts_per_page: -1` = all; `page` aliases `paged`.
19. **SelectOptionsString parsing rules** (Label : Value lines; first line = default).
20. **undo()/redo() return void** — no success signal; guard with canUndo()/canRedo(). All scripted mutations land on the same undo stack as the UI.
21. **ui.exitToWordPress() kills the session** (navigates to wp-admin) — destructive to any connector bridge.
22. **ui.setColorScheme persists locally only** (per browser).
23. **Undocumented error behavior** for many ops (invalid styleId, duplicate selectors, malformed CSS, bad post/template ids, invalid goTo place).
24. **etch/raw-html carries both `content` (sanitized) and `unsafe` (raw)** — be deliberate about which is surfaced/written.
25. **getTree() is context-sensitive** — inside component edit mode it returns the component's tree, not the page's.
26. **docs.etchwp.com 403s automated fetchers** — runtime doc scraping needs a browser UA; source of truth also at github.com/Digital-Gravy/etch-docs.

---

## 5. MCP Connector Design Implications

### 5.1 Bridge architecture (the core problem)
There is no HTTP API, so the MCP server cannot talk to Etch directly. Options:
- **Browser automation bridge** (Playwright/CDP): MCP server launches/attaches to a Chrome session, logs into wp-admin, opens the builder, and evaluates JS against `window.etch`. Most self-contained; requires storing WP credentials or reusing a logged-in profile; must poll `isEtchAvailable()` after navigation.
- **Companion WordPress plugin / injected script** that runs inside the builder, gets `window.etch` natively, and opens an outbound channel (WebSocket/SSE/long-poll) to the local MCP server. Cleanest UX ("install plugin, builder connects"), but is its own product surface; the MCP server then relays tool calls as JS invocations.
- **Browser extension bridge** — similar relay, no WP plugin install, but per-browser setup.
Either way the connector is a **remote-eval RPC layer over a JS object**, and every tool result must be JSON-serialized out of the page context.

### 5.2 Auth flow
No Etch-level auth exists — auth is **WordPress login + an open builder session**. The connector must: (a) obtain a WP session (credentials, application password for login automation, or attach to user's existing browser); (b) navigate into the Etch builder for a target post/template; (c) wait for `isEtchAvailable()`. Pass a connector `id` via `getEtch({ id: "..." })` for telemetry. There is nothing like scopes/capabilities to request — permissioning inherits whatever the logged-in WP user can do. PRD question: who owns the browser session (headless managed by connector vs. user's live builder tab)?

### 5.3 Tool mapping & granularity
~70 operations across 9 namespaces. Recommendations:
- **Group per domain, not per operation.** 70 one-op tools blow up tool lists; pure "eval JS" is too opaque/unsafe. Sweet spot: one tool per domain with an `action` enum (e.g. `etch_blocks {action: "create"|"update"|"move"|...}`), or ~12-18 tools grouping by intent:
  - `etch_session` (connect/status/apiVersion/feature-detect)
  - `etch_navigation` (open post/template, list posts/templates, goTo/place)
  - `etch_blocks_read` (getTree/getJson/find/getSelectedId) — read tools separate from writes for safety/permissioning
  - `etch_blocks_write` (create/update/move/replace/delete/duplicate/setText/attributes/classes)
  - `etch_styles` (rules CRUD + variables), `etch_stylesheets`, `etch_components`, `etch_component_edit_mode` (enter/save/exit — stateful, deserves its own tool), `etch_loops`, `etch_fields_schema`, `etch_fields_values`, `etch_ui`, `etch_history`, `etch_save`
- **`save` must be explicit and prominent** (a dedicated tool and/or an `autosave: boolean` option on buffered-domain write tools) — the #1 silent-failure mode is an AI mutating blocks and never persisting.
- Tool schemas must mirror API quirks: numeric component ids vs string block ids; additionalProperties:true for WP query args/custom fields; open enums for error codes/field types; separate authoring (EtchBlockJson, no id/styles) vs read (PublicBlockJson) schemas.
- Consider a composite "build subtree" tool: `blocks.create` accepts a full nested `children` tree in one call — exploit this so the AI creates whole sections in one tool call instead of N create calls.

### 5.4 State & session concerns
- **Heavily stateful server:** active post/template (navigation), selection, component edit mode flag, buffered-vs-saved dirty state, undo stack. The connector should track and expose a `status` resource/tool: `{ activePostId, isEditingTemplate, place, isInComponentEditMode, dirty (unsaved buffered changes), canUndo/canRedo }`.
- **Component edit mode is a modal trap:** getTree() silently switches meaning inside it. The connector should guard writes with mode checks and force explicit enter/save/exit sequencing.
- **Single-session concurrency:** one builder session = one document; concurrent tool calls must be serialized through the page eval channel. Page reloads/navigation (openPostAsync, goTo, exitToWordPress) invalidate in-flight assumptions — re-poll availability after each.
- **Block ids are session/document-scoped strings** returned by create/find — the AI must thread them; the connector could maintain a friendly-name → id map or always return compact tree snapshots after writes.
- **Block exhaustion risk:** getTree() on large pages may be huge — connector should support depth limits / field projection / summarized tree views for token economy.

### 5.5 What the API is missing (connector must work around)
- **No HTTP transport** → entire bridge layer (5.1).
- **No auth/capability model** → connector owns credential handling and should add its own confirmation gates for destructive ops (delete subtree, deleteGroupAsync, exitToWordPress).
- **No events/subscriptions** → no way to observe user edits or save completion beyond promise resolution; connector must poll/diff if it wants change detection.
- **No dry-run/validation endpoint** → errors only surface as thrown EtchApiError at execution; connector should map codes to MCP tool errors and tolerate unknown codes.
- **No pagination on post/template listing** → connector should filter/truncate client-side.
- **No screenshot/render readback** → pairing with browser automation enables canvas screenshots as a separate visual-feedback tool (highly valuable for AI-driven design loops).
- **No media library API** → mediaId values must come from WP REST or dynamic tokens; a WP REST sidecar (posts/media/users) would complement the builder bridge.
- **No batch/transaction primitive** beyond nested create + the undo stack; connector can approximate transactions with undo checkpoints (count mutations, undo N times to roll back).
- **0.x churn** → connector should feature-detect per method at session start and surface a capability manifest, rather than assuming the full surface.
