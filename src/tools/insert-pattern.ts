import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildValueIndex, classifyTokens, normalizeValue } from "../acss/classify.ts";
import { toolError } from "../errors.ts";
import {
  type InsertionPlan,
  type TokenPlanFinding,
  transformPattern,
} from "../pattern/transform.ts";
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

/** Rank exact token candidates so names matching the finding's family come first. */
function familyAffinity(name: string, family: string): number {
  switch (family) {
    case "spacing":
    case "gap":
      return /^--(space|section-space|grid-gap|gutter|content-gap|gap)\b/.test(name) ? 0 : 1;
    case "font-size":
      return /^--(text|h[1-6])\b/.test(name) ? 0 : 1;
    case "radius":
      return /^--(radius|card-radius|btn-radius)\b/.test(name) ? 0 : 1;
    case "width":
      return /^--(content-width|width-)/.test(name) ? 0 : 1;
    case "border":
      return /^--border\b/.test(name) ? 0 : 1;
    case "shadow":
      return /^--(box-shadow|card-shadow)/.test(name) ? 0 : 1;
    default:
      return 0;
  }
}

/**
 * Best-effort: upgrade family-level token findings to EXACT `resolvedTokens`
 * using the live `:root` snapshot. Reads only — never mutates. The caller wraps
 * this so a bridge failure degrades to the static (family-level) suggestion.
 */
async function enrichWithLiveTokens(
  ctx: ToolContext,
  findings: TokenPlanFinding[],
): Promise<TokenPlanFinding[]> {
  await ctx.ensureAttached();
  const registry = ((await runRead(ctx, "styles", "listVariables")) ?? {}) as Record<
    string,
    string
  >;
  const computed = await ctx.bridge.readRootVariables();
  const index = buildValueIndex(
    classifyTokens(computed, registry, ctx.config.acssStylesheetPattern),
  );
  return findings.map((f) => {
    const matches = index.get(normalizeValue(f.value));
    if (!matches?.length) return f;
    const resolvedTokens = [...matches].sort(
      (a, b) => familyAffinity(a, f.family) - familyAffinity(b, f.family),
    );
    return { ...f, resolvedTokens };
  });
}

export function registerInsertPatternTool(server: McpServer, ctx: ToolContext): void {
  registerTool(
    server,
    ctx,
    "etch_insert_pattern",
    "Build a whole section in one call: takes semantic HTML + CSS, decomposes them into an Etch block tree (etch/element + etch/text; script/style/svg dropped and reported; raw-html never emitted), creates each CSS rule via styles.create, and attaches classes to blocks via add_class — the only legal way (the styles array is read-only). BUFFERED: call etch_save after. Input is validated locally first; invalid HTML/CSS fails with E_VALIDATION and ZERO mutations. ACSS/BEM enforcement is active (ETCH_ENFORCE_TOKENS / ETCH_BEM_LINT = off|warn|reject, default warn): hardcoded colors/lengths and BEM violations are reported in the manifest (bemFindings/tokenFindings, with exact token suggestions from the live page) and, when mode=reject, fail with E_ACSS_ENFORCEMENT and ZERO mutations. An undo checkpoint is recorded automatically; on mid-orchestration failure the error recommends etch_history rollback. Use real tokens from etch_tokens in the CSS.",
    {
      html: z
        .string()
        .describe(
          "semantic HTML — BEM classes REQUIRED (block__element--modifier, lowercase-kebab, no grandchild nesting); no ACSS utility classes in markup",
        ),
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

      // 1a. ACSS/BEM enforcement gate — PURE, before any bridge call. In reject
      //     mode a violation fails with E_ACSS_ENFORCEMENT and ZERO mutations.
      const { enforceTokens, bemLint } = ctx.config;
      const rejectBem = bemLint === "reject" && plan.bemFindings.length > 0;
      const rejectTokens = enforceTokens === "reject" && plan.tokenFindings.length > 0;
      if (rejectBem || rejectTokens) {
        const parts: string[] = [];
        if (rejectBem) {
          parts.push(
            `${plan.bemFindings.length} BEM violation(s): ${plan.bemFindings
              .slice(0, 3)
              .map((f) => `'${f.className}' [${f.violations.join(", ")}]`)
              .join("; ")}`,
          );
        }
        if (rejectTokens) {
          parts.push(
            `${plan.tokenFindings.length} hardcoded value(s): ${plan.tokenFindings
              .slice(0, 3)
              .map((f) => `${f.selector} { ${f.property}: ${f.value} } — ${f.suggestion}`)
              .join("; ")}`,
          );
        }
        throw toolError("E_ACSS_ENFORCEMENT", parts.join(" | "));
      }

      // 1b. Warn-mode reporting (+ best-effort live exact-token suggestions).
      const reportBem = bemLint === "warn" ? plan.bemFindings : [];
      let reportTokens = enforceTokens === "warn" ? plan.tokenFindings : [];
      if (reportTokens.length > 0) {
        try {
          reportTokens = await enrichWithLiveTokens(ctx, reportTokens);
        } catch {
          // Bridge read failed — keep the static family-level suggestions.
        }
      }

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

        const warnings = reportBem.length + reportTokens.length;
        const baseHint =
          "Pattern inserted into the buffer — call etch_save to persist. A checkpoint was recorded; etch_history rollback reverts the whole insertion.";
        return envelope(
          ctx,
          {
            createdRootBlockIds,
            createdStyles,
            attachments,
            unstyledClasses: [...new Set(unstyledClasses)],
            skipped: plan.skipped,
            bemFindings: reportBem,
            tokenFindings: reportTokens,
            enforcement: { tokens: enforceTokens, bem: bemLint },
          },
          {
            persistence: "buffered",
            hint:
              warnings > 0
                ? `${baseHint} ${warnings} ACSS/BEM warning(s) — see bemFindings/tokenFindings.`
                : baseHint,
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
