import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolError } from "../errors.ts";
import { envelope, registerTool, runRead, runWrite, type ToolContext } from "../tool-kit.ts";

function req(args: Record<string, unknown>, key: string, action: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw toolError("E_VALIDATION", `'${action}' requires string param '${key}'`);
  }
  return v;
}

export function registerStylesheetTools(server: McpServer, ctx: ToolContext): void {
  registerTool(
    server,
    ctx,
    "etch_stylesheets_read",
    "Read Etch stylesheets and @custom-media queries. Actions: list, get (by stylesheetId), list_custom_media (e.g. {'--md': '(min-width: 768px)'}).",
    {
      action: z.enum(["list", "get", "list_custom_media"]),
      stylesheetId: z.string().optional(),
    },
    async (args) => {
      switch (args.action) {
        case "list":
          return envelope(ctx, await runRead(ctx, "stylesheets", "list"));
        case "get":
          return envelope(
            ctx,
            await runRead(ctx, "stylesheets", "get", [req(args, "stylesheetId", "get")]),
          );
        case "list_custom_media":
          return envelope(ctx, await runRead(ctx, "stylesheets", "listCustomMedia"));
        default:
          throw toolError("E_VALIDATION", `unknown action '${String(args.action)}'`);
      }
    },
  );

  registerTool(
    server,
    ctx,
    "etch_stylesheets_write",
    "Mutate Etch stylesheets. Persistence is IMMEDIATE — these writes save instantly (no etch_save needed, no buffered undo via save). Actions: create {name, css, type?}, update (partial patch), append (adds css with a leading newline), delete, add_custom_media (upsert, e.g. name '--md').",
    {
      action: z.enum(["create", "update", "append", "delete", "add_custom_media"]),
      stylesheetId: z.string().optional(),
      name: z.string().optional(),
      css: z.string().optional(),
      type: z.enum(["default", "@custom-media"]).optional(),
      patch: z
        .object({
          name: z.string().optional(),
          css: z.string().optional(),
          type: z.string().optional(),
        })
        .optional(),
      query: z.string().optional().describe("add_custom_media: e.g. '(min-width: 768px)'"),
    },
    async (args) => {
      const write = (method: string, callArgs: unknown[]) =>
        runWrite(ctx, "stylesheets", method, callArgs, { dirty: null });
      const immediate = { persistence: "immediate" as const };
      switch (args.action) {
        case "create": {
          const input: Record<string, unknown> = {
            name: req(args, "name", "create"),
            css: req(args, "css", "create"),
          };
          if (args.type) input.type = args.type;
          return envelope(ctx, await write("createAsync", [input]), immediate);
        }
        case "update":
          return envelope(
            ctx,
            await write("updateAsync", [req(args, "stylesheetId", "update"), args.patch ?? {}]),
            immediate,
          );
        case "append":
          return envelope(
            ctx,
            await write("appendAsync", [
              req(args, "stylesheetId", "append"),
              req(args, "css", "append"),
            ]),
            immediate,
          );
        case "delete":
          return envelope(
            ctx,
            await write("deleteAsync", [req(args, "stylesheetId", "delete")]),
            immediate,
          );
        case "add_custom_media":
          return envelope(
            ctx,
            await write("addCustomMediaAsync", [
              req(args, "name", "add_custom_media"),
              req(args, "query", "add_custom_media"),
            ]),
            immediate,
          );
        default:
          throw toolError("E_VALIDATION", `unknown action '${String(args.action)}'`);
      }
    },
  );
}
