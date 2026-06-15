import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolError } from "../errors.ts";
import { envelope, registerTool, runRead, runWrite, type ToolContext } from "../tool-kit.ts";

function reqStr(args: Record<string, unknown>, key: string, action: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0)
    throw toolError("E_VALIDATION", `'${action}' requires string param '${key}'`);
  return v;
}

function reqNum(args: Record<string, unknown>, key: string, action: string): number {
  const v = args[key];
  if (typeof v !== "number" || !Number.isInteger(v))
    throw toolError(
      "E_VALIDATION",
      `'${action}' requires integer param '${key}' (post ids are numbers)`,
    );
  return v;
}

export function registerFieldTools(server: McpServer, ctx: ToolContext): void {
  registerTool(
    server,
    ctx,
    "etch_fields_read",
    "Read Etch custom field groups, definitions and per-post values. Actions: list_groups (Record<groupId, CustomFieldGroup>), get_group, get_values (all values for a post), get_value (one field for a post). Post ids are numbers; group ids are strings; field types are open strings (text/textarea/number/boolean/anything).",
    {
      action: z.enum(["list_groups", "get_group", "get_values", "get_value"]),
      groupId: z.string().optional(),
      postId: z.number().int().optional(),
      fieldKey: z.string().optional(),
    },
    async (args) => {
      switch (args.action) {
        case "list_groups":
          return envelope(ctx, await runRead(ctx, "fields", "listGroupsAsync"));
        case "get_group":
          return envelope(
            ctx,
            await runRead(ctx, "fields", "getGroupAsync", [reqStr(args, "groupId", "get_group")]),
          );
        case "get_values":
          return envelope(
            ctx,
            await runRead(ctx, "fields", "getValuesAsync", [reqNum(args, "postId", "get_values")]),
          );
        case "get_value":
          return envelope(
            ctx,
            await runRead(ctx, "fields", "getValueAsync", [
              reqNum(args, "postId", "get_value"),
              reqStr(args, "fieldKey", "get_value"),
            ]),
          );
        default:
          throw toolError("E_VALIDATION", `unknown action '${String(args.action)}'`);
      }
    },
  );

  registerTool(
    server,
    ctx,
    "etch_fields_write",
    "Mutate Etch custom fields. Persistence is IMMEDIATE (no etch_save needed). Actions: create_group {definition: {label, fields, assigned_to: {post_types|post_ids|taxonomies, op: isIn|isNotIn}}}, update_group (FULL replacement definition), delete_group, add_field {groupId, field: {label, key, type, …}}, update_field (FULL replacement, repeats key), remove_field, set_value {postId, fieldKey, value}, set_values {postId, values: {key: value}}, delete_value. CustomFieldType is open — any string type is forwarded.",
    {
      action: z.enum([
        "create_group",
        "update_group",
        "delete_group",
        "add_field",
        "update_field",
        "remove_field",
        "set_value",
        "set_values",
        "delete_value",
      ]),
      groupId: z.string().optional(),
      definition: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("create_group/update_group: CustomFieldGroup (update = FULL replacement)"),
      field: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("add_field/update_field: CustomField"),
      fieldKey: z.string().optional(),
      postId: z.number().int().optional(),
      value: z.unknown().optional(),
      values: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("set_values: {fieldKey: value}"),
    },
    async (args) => {
      const write = (method: string, callArgs: unknown[]) =>
        runWrite(ctx, "fields", method, callArgs, { dirty: null });
      const immediate = { persistence: "immediate" as const };
      const a = args.action as string;
      switch (a) {
        case "create_group": {
          if (!args.definition)
            throw toolError("E_VALIDATION", "'create_group' requires 'definition'");
          return envelope(ctx, await write("createGroupAsync", [args.definition]), immediate);
        }
        case "update_group": {
          const id = reqStr(args, "groupId", a);
          if (!args.definition) {
            throw toolError(
              "E_VALIDATION",
              "'update_group' is a FULL replacement — send the complete group definition (read it first via get_group), not a partial diff.",
            );
          }
          return envelope(ctx, await write("updateGroupAsync", [id, args.definition]), immediate);
        }
        case "delete_group":
          return envelope(
            ctx,
            await write("deleteGroupAsync", [reqStr(args, "groupId", a)]),
            immediate,
          );
        case "add_field": {
          if (!args.field) throw toolError("E_VALIDATION", "'add_field' requires 'field'");
          return envelope(
            ctx,
            await write("addFieldAsync", [reqStr(args, "groupId", a), args.field]),
            immediate,
          );
        }
        case "update_field": {
          if (!args.field) {
            throw toolError(
              "E_VALIDATION",
              "'update_field' is a FULL replacement — send the complete field (repeating its key).",
            );
          }
          return envelope(
            ctx,
            await write("updateFieldAsync", [
              reqStr(args, "groupId", a),
              reqStr(args, "fieldKey", a),
              args.field,
            ]),
            immediate,
          );
        }
        case "remove_field":
          return envelope(
            ctx,
            await write("removeFieldAsync", [
              reqStr(args, "groupId", a),
              reqStr(args, "fieldKey", a),
            ]),
            immediate,
          );
        case "set_value":
          return envelope(
            ctx,
            await write("setValueAsync", [
              reqNum(args, "postId", a),
              reqStr(args, "fieldKey", a),
              args.value,
            ]),
            immediate,
          );
        case "set_values": {
          if (!args.values) throw toolError("E_VALIDATION", "'set_values' requires 'values'");
          return envelope(
            ctx,
            await write("setValuesAsync", [reqNum(args, "postId", a), args.values]),
            immediate,
          );
        }
        case "delete_value":
          return envelope(
            ctx,
            await write("deleteValueAsync", [
              reqNum(args, "postId", a),
              reqStr(args, "fieldKey", a),
            ]),
            immediate,
          );
        default:
          throw toolError("E_VALIDATION", `unknown action '${a}'`);
      }
    },
  );
}
