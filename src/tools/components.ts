import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolError } from "../errors.ts";
import { envelope, registerTool, runRead, runWrite, type ToolContext } from "../tool-kit.ts";

function requireNumericId(args: Record<string, unknown>, action: string): number {
  const v = args.componentId;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw toolError(
      "E_VALIDATION",
      `'${action}' requires a NUMERIC componentId (got ${JSON.stringify(v)}). Component ids are numbers; block/style/stylesheet/loop ids are strings.`,
    );
  }
  return v;
}

function rejectReservedNumberProperties(patch: Record<string, unknown>): void {
  const properties = patch.properties;
  if (!Array.isArray(properties)) return;
  for (const p of properties) {
    const primitive = (p as { type?: { primitive?: string } })?.type?.primitive;
    if (primitive === "number") {
      throw toolError(
        "E_VALIDATION",
        "Number-primitive component properties are RESERVED/unimplemented in the 0.x contract (they cause OPERATION_FAILED). Use a string property instead.",
      );
    }
  }
}

export function registerComponentTools(server: McpServer, ctx: ToolContext): void {
  registerTool(
    server,
    ctx,
    "etch_components_read",
    "Read Etch components. Actions: list (summaries — no block trees), get_json (summary + blocks, by NUMERIC componentId).",
    {
      action: z.enum(["list", "get_json"]),
      componentId: z.number().int().optional().describe("get_json: numeric component id"),
    },
    async (args) => {
      switch (args.action) {
        case "list":
          return envelope(ctx, await runRead(ctx, "components", "list"));
        case "get_json":
          return envelope(
            ctx,
            await runRead(ctx, "components", "getJson", [requireNumericId(args, "get_json")]),
          );
        default:
          throw toolError("E_VALIDATION", `unknown action '${String(args.action)}'`);
      }
    },
  );

  registerTool(
    server,
    ctx,
    "etch_components_write",
    "Mutate Etch components. Persistence is IMMEDIATE (no etch_save needed). Component ids are NUMBERS. Actions: create {name} (creates an EMPTY component — populate via update with blocks, or enter_component_edit on an etch/component block); update (PARTIAL patch: name?/key?/description? — but properties and blocks, when supplied, REPLACE WHOLESALE, they are never merged; key is auto-PascalCased); delete. Number-primitive properties are reserved/unimplemented upstream and rejected here.",
    {
      action: z.enum(["create", "update", "delete"]),
      componentId: z.number().int().optional(),
      name: z.string().optional(),
      patch: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "update: ComponentPatch {name?, key?, description?, properties? (FULL replacement), blocks? (FULL replacement, EtchBlockJson[])}",
        ),
    },
    async (args) => {
      const immediate = { persistence: "immediate" as const };
      switch (args.action) {
        case "create": {
          const name = args.name;
          if (typeof name !== "string" || !name.length) {
            throw toolError("E_VALIDATION", "'create' requires 'name'");
          }
          const id = await runWrite(ctx, "components", "createAsync", [name], { dirty: null });
          return envelope(ctx, id, {
            ...immediate,
            hint: "Created an EMPTY component. Add properties/blocks via update, or insert an etch/component block and use etch_blocks_write enter_component_edit.",
          });
        }
        case "update": {
          const id = requireNumericId(args, "update");
          const patch = (args.patch ?? {}) as Record<string, unknown>;
          rejectReservedNumberProperties(patch);
          const result = await runWrite(ctx, "components", "updateAsync", [id, patch], {
            dirty: null,
          });
          const wholesale = ["properties", "blocks"].filter((k) => k in patch);
          return envelope(ctx, result, {
            ...immediate,
            hint: wholesale.length
              ? `${wholesale.join(" and ")} were REPLACED wholesale (never merged) — anything not in the patch is gone. To restore, send a full replace again.`
              : undefined,
          });
        }
        case "delete":
          return envelope(
            ctx,
            await runWrite(ctx, "components", "deleteAsync", [requireNumericId(args, "delete")], {
              dirty: null,
            }),
            immediate,
          );
        default:
          throw toolError("E_VALIDATION", `unknown action '${String(args.action)}'`);
      }
    },
  );
}
