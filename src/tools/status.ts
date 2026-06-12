import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FeatureMap } from "../bridge/types.ts";
import { envelope, registerTool, type ToolContext } from "../tool-kit.ts";

let featureCache: FeatureMap | null = null;

export function resetFeatureCache(): void {
  featureCache = null;
}

async function readOrNull(ctx: ToolContext, domain: string, method: string): Promise<unknown> {
  try {
    return await ctx.bridge.eval(domain, method, []);
  } catch {
    return null;
  }
}

export function registerStatusTools(server: McpServer, ctx: ToolContext): void {
  registerTool(
    server,
    ctx,
    "etch_status",
    "Current Etch builder session state: activePostId, isEditingTemplate, place, componentEditMode, dirty counters (a LOWER BOUND — manual edits in the builder are not observable), canUndo/canRedo, sessionEpoch, apiVersion, version, featureMap (0.x feature detection). Call this before acting on assumptions about builder state.",
    {},
    async () => {
      await ctx.ensureAttached();
      if (!featureCache) featureCache = await ctx.bridge.probeFeatures();
      const session = ctx.bridge.session();
      const result = {
        activePostId: await readOrNull(ctx, "navigation", "getActivePostId"),
        isEditingTemplate: await readOrNull(ctx, "navigation", "isEditingTemplate"),
        place: await readOrNull(ctx, "navigation", "getCurrentPlace"),
        componentEditMode: await readOrNull(ctx, "blocks", "isInComponentEditMode"),
        dirty: ctx.dirty.snapshot(),
        canUndo: await readOrNull(ctx, "history", "canUndo"),
        canRedo: await readOrNull(ctx, "history", "canRedo"),
        sessionEpoch: session.epoch,
        attached: session.state === "attached",
        url: session.url,
        apiVersion: session.apiVersion,
        version: session.etchVersion,
        featureMap: featureCache,
      };
      return envelope(ctx, result);
    },
    { skipReloadCheck: true },
  );

  registerTool(
    server,
    ctx,
    "etch_save",
    "Persist all buffered mutations (blocks/styles/loops) — the same save the builder UI performs. Buffered changes are SILENTLY LOST without this call. Clears the page dirty counter. Component-definition edits need save_component_edit (etch_blocks_write), not this.",
    {},
    async () => {
      const { runWrite } = await import("../tool-kit.ts");
      await runWrite(ctx, "root", "saveAsync", [], { dirty: null, mutationDomain: "save" });
      ctx.dirty.clearPage();
      const snap = ctx.dirty.snapshot();
      return envelope(
        ctx,
        { saved: true },
        {
          persistence: "buffered",
          hint:
            snap.componentEdit > 0
              ? `componentEditDirty is still ${snap.componentEdit} — component-definition edits persist via etch_blocks_write save_component_edit, not etch_save.`
              : undefined,
        },
      );
    },
  );
}
