import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifyTokens } from "../acss/classify.ts";
import { toolError } from "../errors.ts";
import { envelope, registerTool, runRead, runWrite, type ToolContext } from "../tool-kit.ts";

function requireString(args: Record<string, unknown>, key: string, action: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw toolError("E_VALIDATION", `'${action}' requires string param '${key}'`);
  }
  return v;
}

export function registerStyleTools(server: McpServer, ctx: ToolContext): void {
  registerTool(
    server,
    ctx,
    "etch_styles_read",
    "Read Etch CSS styles (rules) and CSS variables. Actions: list (StyleSummary[] — each id is the handle etch_blocks_write add_class needs), list_variables (Etch-registered :root variables, optional collection), get_variable. For ALL live design tokens incl. ACSS/theme variables use etch_tokens instead.",
    {
      action: z.enum(["list", "list_variables", "get_variable"]),
      type: z.string().optional().describe("list: filter by selector type (class/id/tag/…)"),
      name: z.string().optional().describe("get_variable: variable name incl. leading --"),
      collection: z.string().optional(),
    },
    async (args) => {
      switch (args.action) {
        case "list":
          return envelope(
            ctx,
            await runRead(ctx, "styles", "list", args.type ? [{ type: args.type }] : []),
          );
        case "list_variables":
          return envelope(
            ctx,
            await runRead(ctx, "styles", "listVariables", args.collection ? [args.collection] : []),
          );
        case "get_variable": {
          const name = requireString(args, "name", "get_variable");
          const callArgs: unknown[] = [name];
          if (args.collection) callArgs.push(args.collection);
          return envelope(ctx, await runRead(ctx, "styles", "getVariable", callArgs));
        }
        default:
          throw toolError("E_VALIDATION", `unknown action '${String(args.action)}'`);
      }
    },
  );

  registerTool(
    server,
    ctx,
    "etch_styles_write",
    "Mutate Etch CSS styles and variables. BUFFERED — lost without etch_save. Actions: create (selector + css declarations → returns the styleId for etch_blocks_write add_class — this is the ONLY way to attach classes to blocks), update (patch {selector?, css?}), delete, set_variable / remove_variable (:root custom properties, optional collection; names include the leading --).",
    {
      action: z.enum(["create", "update", "delete", "set_variable", "remove_variable"]),
      selector: z.string().optional().describe("create: e.g. '.hero'"),
      css: z.string().optional().describe("create/update: CSS declarations"),
      styleId: z.string().optional(),
      patch: z
        .object({ selector: z.string().optional(), css: z.string().optional() })
        .optional()
        .describe("update: StylePatch"),
      name: z.string().optional().describe("variables: name incl. leading --"),
      value: z.string().optional(),
      collection: z.string().optional(),
    },
    async (args) => {
      const write = (method: string, callArgs: unknown[]) =>
        runWrite(ctx, "styles", method, callArgs, { dirty: "page" });
      switch (args.action) {
        case "create": {
          const selector = requireString(args, "selector", "create");
          const callArgs: unknown[] = [selector];
          if (args.css !== undefined) callArgs.push(args.css);
          return envelope(ctx, await write("create", callArgs), {
            persistence: "buffered",
            hint: "Attach this styleId to blocks via etch_blocks_write add_class.",
          });
        }
        case "update":
          return envelope(
            ctx,
            await write("update", [requireString(args, "styleId", "update"), args.patch ?? {}]),
            { persistence: "buffered" },
          );
        case "delete":
          return envelope(ctx, await write("delete", [requireString(args, "styleId", "delete")]), {
            persistence: "buffered",
          });
        case "set_variable": {
          const name = requireString(args, "name", "set_variable");
          const value = requireString(args, "value", "set_variable");
          const callArgs: unknown[] = [name, value];
          if (args.collection) callArgs.push(args.collection);
          return envelope(ctx, await write("setVariable", callArgs), { persistence: "buffered" });
        }
        case "remove_variable": {
          const name = requireString(args, "name", "remove_variable");
          const callArgs: unknown[] = [name];
          if (args.collection) callArgs.push(args.collection);
          return envelope(ctx, await write("removeVariable", callArgs), {
            persistence: "buffered",
          });
        }
        default:
          throw toolError("E_VALIDATION", `unknown action '${String(args.action)}'`);
      }
    },
  );

  registerTool(
    server,
    ctx,
    "etch_tokens",
    "All live design tokens: merges Etch-registered variables (source 'etch') with a read-only :root snapshot of the page (source 'computed' — covers ACSS, theme and plugin tokens). Classification is by STYLESHEET ORIGIN (a variable is 'acss' iff its owning stylesheet matches the ACSS pattern — works even with dashboard-renamed palettes); the namespace field is best-effort prefix metadata. filter: acss | etch | custom | all. Use these real token names (e.g. var(--space-m)) in generated CSS instead of hardcoded values.",
    {
      filter: z.enum(["acss", "etch", "custom", "all"]).default("all"),
    },
    async (args) => {
      await ctx.ensureAttached();
      const registry = ((await runRead(ctx, "styles", "listVariables")) ?? {}) as Record<
        string,
        string
      >;
      const computed = await ctx.bridge.readRootVariables();
      const tokens = classifyTokens(computed, registry, ctx.config.acssStylesheetPattern);
      const filter = (args.filter as string) ?? "all";
      const result = tokens.filter((t) => filter === "all" || t.classification === filter);
      return envelope(ctx, result);
    },
  );
}
