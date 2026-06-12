import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolError } from "../errors.ts";
import { envelope, registerTool, runRead, runWrite, type ToolContext } from "../tool-kit.ts";

const READ_ACTIONS = [
  "get_tree",
  "get_json",
  "find",
  "get_selected",
  "get_attribute",
  "has_class",
  "is_in_component_edit_mode",
] as const;

const WRITE_ACTIONS = [
  "create",
  "replace",
  "update",
  "delete",
  "duplicate",
  "move",
  "set_text",
  "rename",
  "set_attribute",
  "remove_attribute",
  "add_class",
  "remove_class",
  "select",
  "deselect",
  "enter_component_edit",
  "exit_component_edit",
  "save_component_edit",
] as const;

/** Actions that mutate the document (mark dirty). Mode/selection switches don't. */
const DOC_MUTATING = new Set<string>([
  "create",
  "replace",
  "update",
  "delete",
  "duplicate",
  "move",
  "set_text",
  "rename",
  "set_attribute",
  "remove_attribute",
  "add_class",
  "remove_class",
]);

const BLOCK_PATCH_KEYS = new Set(["name", "hidden", "attributes", "text"]);

function rejectStylesArray(node: unknown, path = "json"): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if ("styles" in obj) {
    throw toolError(
      "E_VALIDATION",
      `${path}.styles is read-only — the styles array is rejected on authoring. Create the style via etch_styles_write create (returns a styleId), then attach it with etch_blocks_write add_class.`,
    );
  }
  if ("id" in obj) {
    throw toolError(
      "E_VALIDATION",
      `${path}.id is not allowed in authoring JSON (EtchBlockJson has no id — Etch assigns one). Reads return PublicBlockJson (with ids); writes take EtchBlockJson.`,
    );
  }
  const children = obj.children;
  if (Array.isArray(children)) {
    for (const [i, c] of children.entries()) rejectStylesArray(c, `${path}.children[${i}]`);
  }
}

function requireString(args: Record<string, unknown>, key: string, action: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw toolError("E_VALIDATION", `'${action}' requires string param '${key}'`);
  }
  return v;
}

interface TreeNode {
  [k: string]: unknown;
  children?: TreeNode[];
}

function postProcessTree(
  node: TreeNode,
  opts: { depth?: number; mode?: string; includeUnsafe?: boolean },
  level = 1,
): TreeNode {
  const children = Array.isArray(node.children) ? node.children : [];
  if (opts.mode === "summary") {
    return {
      id: node.id,
      type: node.type,
      name:
        (node.context as { name?: string } | undefined)?.name ?? (node.name as string | undefined),
      childCount: children.length,
      ...(children.length && opts.depth !== undefined && level < opts.depth
        ? { children: children.map((c) => postProcessTree(c, opts, level + 1)) }
        : {}),
    };
  }
  const out: TreeNode = { ...node };
  if (!opts.includeUnsafe && node.type === "etch/raw-html") {
    delete out.unsafe;
  }
  if (opts.depth !== undefined && level >= opts.depth) {
    delete out.children;
    out.childCount = children.length;
  } else if (children.length) {
    out.children = children.map((c) => postProcessTree(c, opts, level + 1));
  }
  return out;
}

function guardSize(ctx: ToolContext, value: unknown): unknown {
  const size = JSON.stringify(value)?.length ?? 0;
  if (size > ctx.config.maxReadBytes) {
    throw toolError(
      "E_READ_TOO_LARGE",
      `Response is ${size} bytes (limit ${ctx.config.maxReadBytes}). Re-run with depth (e.g. depth: 2) or mode: "summary" to get a smaller view, or raise ETCH_MAX_READ_BYTES.`,
    );
  }
  return value;
}

export function registerBlockTools(server: McpServer, ctx: ToolContext): void {
  registerTool(
    server,
    ctx,
    "etch_blocks_read",
    "Read blocks from the Etch document. Actions: get_tree (whole document — INSIDE component edit mode it returns the component's tree instead), get_json (one block + subtree), find (presence-only predicate: type exact-match, class/attribute existence — NO value matching), get_selected, get_attribute, has_class, is_in_component_edit_mode. get_tree/get_json accept depth (child levels) and mode: 'summary' (id/type/name/childCount). raw-html blocks return sanitized content; original markup only with include_unsafe: true.",
    {
      action: z.enum(READ_ACTIONS),
      blockId: z.string().optional(),
      predicate: z
        .object({
          type: z.string().optional(),
          class: z.string().optional(),
          attribute: z.string().optional(),
        })
        .optional()
        .describe("find only; class/attribute are presence-only (no value matching)"),
      key: z.string().optional().describe("get_attribute: attribute key"),
      styleId: z.string().optional().describe("has_class: style id from etch_styles_write create"),
      depth: z.number().int().positive().optional(),
      mode: z.enum(["full", "summary"]).optional(),
      include_unsafe: z.boolean().optional(),
    },
    async (args) => {
      const action = args.action as string;
      const treeOpts = {
        depth: args.depth as number | undefined,
        mode: (args.mode as string | undefined) ?? "full",
        includeUnsafe: args.include_unsafe === true,
      };
      switch (action) {
        case "get_tree": {
          const tree = (await runRead(ctx, "blocks", "getTree")) as TreeNode[];
          const processed = (tree ?? []).map((n) => postProcessTree(n, treeOpts));
          return envelope(ctx, guardSize(ctx, processed));
        }
        case "get_json": {
          const id = requireString(args, "blockId", action);
          const json = (await runRead(ctx, "blocks", "getJson", [id])) as TreeNode;
          return envelope(ctx, guardSize(ctx, postProcessTree(json, treeOpts)));
        }
        case "find":
          return envelope(ctx, await runRead(ctx, "blocks", "find", [args.predicate ?? {}]));
        case "get_selected":
          return envelope(ctx, await runRead(ctx, "blocks", "getSelectedId"));
        case "get_attribute": {
          const id = requireString(args, "blockId", action);
          const key = requireString(args, "key", action);
          return envelope(ctx, await runRead(ctx, "blocks", "getAttribute", [id, key]));
        }
        case "has_class": {
          const id = requireString(args, "blockId", action);
          const styleId = requireString(args, "styleId", action);
          return envelope(ctx, await runRead(ctx, "blocks", "hasClass", [id, styleId]));
        }
        case "is_in_component_edit_mode":
          return envelope(ctx, await runRead(ctx, "blocks", "isInComponentEditMode"));
        default:
          throw toolError("E_VALIDATION", `unknown action '${action}'`);
      }
    },
  );

  registerTool(
    server,
    ctx,
    "etch_blocks_write",
    "Mutate blocks. BUFFERED — changes are lost without etch_save (or save_component_edit for component definitions). Actions: create/replace take EtchBlockJson (version+context+children required; NO id, NO styles array — attach classes via add_class with a styleId from etch_styles_write create); update takes BlockPatch {name?,hidden?,attributes?,text?} with MERGE semantics (attributes: undefined value removes the key; text only on etch/text); delete removes the whole subtree; set_text only works on etch/text (WRONG_BLOCK_TYPE otherwise); attribute values are strings ('true', mediaId, src, tag) and support {curly} dynamic tokens; select/deselect/enter_component_edit/exit_component_edit are mode/UI switches (non-dirty); exit_component_edit accepts revert: true to DISCARD unsaved component edits; save_component_edit persists the component definition (page still needs etch_save).",
    {
      action: z.enum(WRITE_ACTIONS),
      blockId: z.string().optional(),
      json: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("create/replace: EtchBlockJson authoring shape (no id, no styles)"),
      parentId: z.string().optional().describe("create: parent block id (omit = document root)"),
      index: z.number().int().optional(),
      newParentId: z
        .string()
        .nullable()
        .optional()
        .describe("move: null re-parents to document root"),
      patch: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("update: BlockPatch {name?, hidden?, attributes?, text?} — merge, not replace"),
      text: z.string().optional(),
      name: z.string().optional(),
      key: z.string().optional(),
      value: z.string().optional().describe("set_attribute: omit to clear the key"),
      styleId: z
        .string()
        .optional()
        .describe("add_class/remove_class: id from etch_styles_write create"),
      revert: z
        .boolean()
        .optional()
        .describe("exit_component_edit: true discards unsaved component edits"),
    },
    async (args) => {
      const action = args.action as string;
      const dirtyKind = DOC_MUTATING.has(action)
        ? ctx.componentEditMode
          ? ("componentEdit" as const)
          : ("page" as const)
        : null;
      const write = (method: string, callArgs: unknown[]) =>
        runWrite(ctx, "blocks", method, callArgs, { dirty: dirtyKind });

      switch (action) {
        case "create": {
          const json = args.json;
          if (!json) throw toolError("E_VALIDATION", "'create' requires 'json' (EtchBlockJson)");
          rejectStylesArray(json);
          const callArgs: unknown[] = [json];
          if (args.parentId !== undefined) callArgs.push(args.parentId);
          if (args.index !== undefined) {
            if (args.parentId === undefined) callArgs.push(undefined);
            callArgs.push(args.index);
          }
          return envelope(ctx, await write("create", callArgs), { persistence: "buffered" });
        }
        case "replace": {
          const id = requireString(args, "blockId", action);
          if (!args.json) throw toolError("E_VALIDATION", "'replace' requires 'json'");
          rejectStylesArray(args.json);
          return envelope(ctx, await write("replace", [id, args.json]), {
            persistence: "buffered",
          });
        }
        case "update": {
          const id = requireString(args, "blockId", action);
          const patch = args.patch as Record<string, unknown> | undefined;
          if (!patch) throw toolError("E_VALIDATION", "'update' requires 'patch' (BlockPatch)");
          const illegal = Object.keys(patch).filter((k) => !BLOCK_PATCH_KEYS.has(k));
          if (illegal.length) {
            throw toolError(
              "E_VALIDATION",
              `update takes BlockPatch {name?, hidden?, attributes?, text?} with merge semantics — got illegal key(s): ${illegal.join(", ")}. To swap a block's structure or type, use 'replace' with full EtchBlockJson.`,
            );
          }
          return envelope(ctx, await write("update", [id, patch]), { persistence: "buffered" });
        }
        case "delete":
          return envelope(ctx, await write("delete", [requireString(args, "blockId", action)]), {
            persistence: "buffered",
            hint: "Removed the block AND its entire subtree.",
          });
        case "duplicate":
          return envelope(ctx, await write("duplicate", [requireString(args, "blockId", action)]), {
            persistence: "buffered",
          });
        case "move": {
          const id = requireString(args, "blockId", action);
          const callArgs: unknown[] = [id, args.newParentId ?? null];
          if (args.index !== undefined) callArgs.push(args.index);
          return envelope(ctx, await write("move", callArgs), { persistence: "buffered" });
        }
        case "set_text": {
          const id = requireString(args, "blockId", action);
          const text = args.text;
          if (typeof text !== "string")
            throw toolError("E_VALIDATION", "'set_text' requires 'text'");
          return envelope(ctx, await write("setText", [id, text]), { persistence: "buffered" });
        }
        case "rename":
          return envelope(
            ctx,
            await write("rename", [
              requireString(args, "blockId", action),
              requireString(args, "name", action),
            ]),
            { persistence: "buffered" },
          );
        case "set_attribute": {
          const id = requireString(args, "blockId", action);
          const key = requireString(args, "key", action);
          return envelope(ctx, await write("setAttribute", [id, key, args.value]), {
            persistence: "buffered",
          });
        }
        case "remove_attribute":
          return envelope(
            ctx,
            await write("removeAttribute", [
              requireString(args, "blockId", action),
              requireString(args, "key", action),
            ]),
            { persistence: "buffered" },
          );
        case "add_class":
        case "remove_class": {
          const id = requireString(args, "blockId", action);
          const styleId = requireString(args, "styleId", action);
          const method = action === "add_class" ? "addClass" : "removeClass";
          return envelope(ctx, await write(method, [id, styleId]), { persistence: "buffered" });
        }
        case "select":
          return envelope(ctx, await write("select", [requireString(args, "blockId", action)]));
        case "deselect":
          return envelope(ctx, await write("deselect", []));
        case "enter_component_edit": {
          const id = requireString(args, "blockId", action);
          const result = await write("enterComponentEditMode", [id]);
          ctx.componentEditMode = true;
          return envelope(ctx, result, {
            hint: "Component edit mode active: get_tree now returns the COMPONENT's tree; mutations mark componentEditDirty and persist via save_component_edit.",
          });
        }
        case "exit_component_edit": {
          const result = await write("exitComponentEditMode", [
            args.revert === true ? { revert: true } : undefined,
          ]);
          ctx.componentEditMode = false;
          if (args.revert === true) ctx.dirty.clearComponentEdit();
          return envelope(ctx, result, {
            hint:
              args.revert === true
                ? "Unsaved component-definition edits were DISCARDED (revert)."
                : ctx.dirty.snapshot().componentEdit > 0
                  ? "componentEditDirty is non-zero — those edits are NOT persisted; re-enter and save_component_edit, or they may be lost."
                  : undefined,
          });
        }
        case "save_component_edit": {
          const result = await runWrite(ctx, "blocks", "saveComponentEditModeAsync", [], {
            dirty: null,
          });
          ctx.dirty.clearComponentEdit();
          return envelope(ctx, result, {
            persistence: "immediate",
            hint: "Component DEFINITION persisted. The page itself still needs etch_save.",
          });
        }
        default:
          throw toolError("E_VALIDATION", `unknown action '${action}'`);
      }
    },
  );
}
