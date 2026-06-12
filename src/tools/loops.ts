import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolError } from "../errors.ts";
import { envelope, registerTool, runRead, runWrite, type ToolContext } from "../tool-kit.ts";

const LOOP_DESCRIPTION =
  "EtchLoop: {key, name, global: boolean, config}. config.type: 'wp-query'|'main-query' (args mirror WP_Query — open-ended: post_type, posts_per_page (-1 = all), orderby, tax_query, meta_query, …), 'wp-terms', 'wp-users', or 'json' ({data: unknown[]}). Numeric/boolean args accept the param mini-language: '$count' or '$count ?? 10' — values supplied per block via set_for_block loopParams. 'page' aliases 'paged'.";

export function registerLoopTools(server: McpServer, ctx: ToolContext): void {
  registerTool(
    server,
    ctx,
    "etch_loops_read",
    `Read Etch loops. Actions: get_all (Record<loopId, EtchLoop>), find (FUZZY match on name/key — not exact lookup). ${LOOP_DESCRIPTION}`,
    {
      action: z.enum(["get_all", "find"]),
      query: z.string().optional().describe("find: fuzzy name/key query"),
    },
    async (args) => {
      switch (args.action) {
        case "get_all":
          return envelope(ctx, await runRead(ctx, "loops", "getAll"));
        case "find": {
          const q = args.query;
          if (typeof q !== "string" || !q.length)
            throw toolError("E_VALIDATION", "'find' requires 'query'");
          return envelope(ctx, await runRead(ctx, "loops", "findLoop", [q]));
        }
        default:
          throw toolError("E_VALIDATION", `unknown action '${String(args.action)}'`);
      }
    },
  );

  registerTool(
    server,
    ctx,
    "etch_loops_write",
    `Mutate Etch loops. BUFFERED — lost without etch_save. Actions: add (returns loopId), update (FULL REPLACEMENT — send the complete loop, not a diff), delete, set_for_block (bind a loop to an etch/loop block: {loopId?, target?, itemId?, indexId?, loopParams?} e.g. loopParams {count: 3} feeds '$count'). ${LOOP_DESCRIPTION}`,
    {
      action: z.enum(["add", "update", "delete", "set_for_block"]),
      loopId: z.string().optional(),
      loop: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("add/update: the complete EtchLoop object"),
      blockId: z.string().optional().describe("set_for_block: id of an etch/loop block"),
      binding: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "set_for_block: BlockLoopBinding {loopId?, target?, itemId?, indexId?, loopParams?}",
        ),
    },
    async (args) => {
      const write = (method: string, callArgs: unknown[]) =>
        runWrite(ctx, "loops", method, callArgs, { dirty: "page" });
      const buffered = { persistence: "buffered" as const };
      switch (args.action) {
        case "add": {
          if (!args.loop) throw toolError("E_VALIDATION", "'add' requires 'loop' (EtchLoop)");
          return envelope(ctx, await write("add", [args.loop]), buffered);
        }
        case "update": {
          const id = args.loopId;
          if (typeof id !== "string" || !id.length)
            throw toolError("E_VALIDATION", "'update' requires 'loopId'");
          if (!args.loop) {
            throw toolError(
              "E_VALIDATION",
              "'update' is a FULL replacement — send the complete loop object in 'loop' (read it first via get_all), not a partial diff.",
            );
          }
          return envelope(ctx, await write("update", [id, args.loop]), buffered);
        }
        case "delete": {
          const id = args.loopId;
          if (typeof id !== "string" || !id.length)
            throw toolError("E_VALIDATION", "'delete' requires 'loopId'");
          return envelope(ctx, await write("delete", [id]), buffered);
        }
        case "set_for_block": {
          const blockId = args.blockId;
          if (typeof blockId !== "string" || !blockId.length)
            throw toolError("E_VALIDATION", "'set_for_block' requires 'blockId'");
          return envelope(ctx, await write("setForBlock", [blockId, args.binding ?? {}]), buffered);
        }
        default:
          throw toolError("E_VALIDATION", `unknown action '${String(args.action)}'`);
      }
    },
  );
}
