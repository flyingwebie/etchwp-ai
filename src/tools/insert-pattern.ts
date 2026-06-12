import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolError } from "../errors.ts";
import { type InsertionPlan, transformPattern } from "../pattern/transform.ts";
import { envelope, registerTool, runRead, runWrite, type ToolContext } from "../tool-kit.ts";

interface CreatedTree {
  id: string;
  children?: CreatedTree[];
}

function idAtPath(root: CreatedTree, path: number[]): string | null {
  let node: CreatedTree | undefined = root;
  for (const idx of path) {
    node = node?.children?.[idx];
  }
  return node?.id ?? null;
}

export function registerInsertPatternTool(server: McpServer, ctx: ToolContext): void {
  registerTool(
    server,
    ctx,
    "etch_insert_pattern",
    "Build a whole section in one call: takes semantic HTML + CSS, decomposes them into an Etch block tree (etch/element + etch/text; script/style/svg dropped and reported; raw-html never emitted), creates each CSS rule via styles.create, and attaches classes to blocks via add_class — the only legal way (the styles array is read-only). BUFFERED: call etch_save after. Input is validated locally first; invalid HTML/CSS fails with E_VALIDATION and ZERO mutations. An undo checkpoint is recorded automatically; on mid-orchestration failure the error recommends etch_history rollback. Use real tokens from etch_tokens in the CSS.",
    {
      html: z.string().describe("semantic HTML (BEM classes recommended)"),
      css: z
        .string()
        .default("")
        .describe("CSS rules; class selectors get attached to the matching elements"),
      targetParentId: z.string().optional().describe("parent block id (omit = document root)"),
      position: z.number().int().optional().describe("index under the parent"),
    },
    async (args) => {
      // 1. Pure transform — throws E_VALIDATION before any bridge call.
      const plan: InsertionPlan = transformPattern(String(args.html ?? ""), String(args.css ?? ""));

      // 2. Auto checkpoint for rollback on partial failure.
      ctx.checkpointAt = ctx.mutations.value();

      const createdStyles: Record<string, string> = {};
      const createdRootBlockIds: string[] = [];
      const attachments: Array<{ blockId: string; className: string; styleId: string }> = [];
      const step = (s: string) => completed.push(s);
      const completed: string[] = [];

      try {
        // 3. Styles first — their ids are the class handles.
        for (const style of plan.styles) {
          const styleId = (await runWrite(ctx, "styles", "create", [style.selector, style.css], {
            dirty: "page",
          })) as string;
          createdStyles[style.selector] = styleId;
          step(`styles.create ${style.selector} → ${styleId}`);
        }

        // 4. Block trees — one nested create per root block.
        const roots: CreatedTree[] = [];
        for (const [i, block] of plan.blocks.entries()) {
          const callArgs: unknown[] = [block];
          if (args.targetParentId !== undefined) callArgs.push(args.targetParentId);
          if (args.position !== undefined) {
            if (args.targetParentId === undefined) callArgs.push(undefined);
            callArgs.push((args.position as number) + i);
          }
          const rootId = (await runWrite(ctx, "blocks", "create", callArgs, {
            dirty: "page",
          })) as string;
          createdRootBlockIds.push(rootId);
          step(`blocks.create root[${i}] → ${rootId}`);
          const created = (await runRead(ctx, "blocks", "getJson", [rootId])) as CreatedTree;
          roots.push(created);
        }

        // 5. Class attachments via styleIds.
        const unstyledClasses: string[] = [];
        for (const att of plan.attachments) {
          const [rootIdx, ...rest] = att.blockPath;
          const root = roots[rootIdx ?? 0];
          const blockId = root ? idAtPath(root, rest) : null;
          const styleId = createdStyles[`.${att.className}`];
          if (!styleId) {
            unstyledClasses.push(att.className);
            continue;
          }
          if (!blockId) {
            unstyledClasses.push(att.className);
            continue;
          }
          await runWrite(ctx, "blocks", "addClass", [blockId, styleId], { dirty: "page" });
          attachments.push({ blockId, className: att.className, styleId });
          step(`blocks.addClass ${blockId} ${att.className}`);
        }

        return envelope(
          ctx,
          {
            createdRootBlockIds,
            createdStyles,
            attachments,
            unstyledClasses: [...new Set(unstyledClasses)],
            skipped: plan.skipped,
          },
          {
            persistence: "buffered",
            hint: "Pattern inserted into the buffer — call etch_save to persist. A checkpoint was recorded; etch_history rollback reverts the whole insertion.",
          },
        );
      } catch (e) {
        const code = (e as { code?: string })?.code ?? "OPERATION_FAILED";
        throw toolError(
          "E_PATTERN_PARTIAL",
          `Pattern insertion failed mid-way (${code}: ${(e as Error)?.message ?? e}). Completed steps: ${completed.join("; ") || "none"}. Created styles: ${Object.values(createdStyles).join(", ") || "none"}; created blocks: ${createdRootBlockIds.join(", ") || "none"}.`,
          "The document now holds a partial insertion. Run etch_history rollback to revert to the auto-recorded checkpoint, or finish manually with etch_blocks_write/etch_styles_write.",
        );
      }
    },
  );
}
