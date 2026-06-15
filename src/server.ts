import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtchBridge } from "./bridge/types.ts";
import type { Config } from "./config.ts";
import { DirtyTracker, MutationCounter } from "./state/dirty.ts";
import type { ToolContext } from "./tool-kit.ts";
import { registerBlockTools } from "./tools/blocks.ts";
import { registerComponentTools } from "./tools/components.ts";
import { registerFieldTools } from "./tools/fields.ts";
import { registerInsertPatternTool } from "./tools/insert-pattern.ts";
import { registerLoopTools } from "./tools/loops.ts";
import { registerNavTools } from "./tools/nav.ts";
import { registerScreenshotTool } from "./tools/screenshot.ts";
import { registerSidecarTools } from "./tools/sidecar.ts";
import { registerStatusTools, resetFeatureCache } from "./tools/status.ts";
import { registerStyleTools } from "./tools/styles.ts";
import { registerStylesheetTools } from "./tools/stylesheets.ts";

export interface ServerDeps {
  bridge: EtchBridge;
  config: Config;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export function buildServerWithCtx({ bridge, config, fetchImpl }: ServerDeps): {
  server: McpServer;
  ctx: ToolContext;
} {
  resetFeatureCache();
  let attached = false;
  const ctx: ToolContext = {
    bridge,
    config,
    dirty: new DirtyTracker(),
    mutations: new MutationCounter(),
    componentEditMode: false,
    checkpointAt: null,
    async ensureAttached() {
      if (attached && bridge.session().state === "attached") return;
      await bridge.attach();
      attached = true;
    },
    log(level, message) {
      // stdout is the MCP protocol channel — all logging goes to stderr.
      const order: Record<string, number> = { error: 0, warn: 1, info: 2 };
      if ((order[level] ?? 2) <= (order[config.logLevel] ?? 2)) {
        console.error(`[etchwp-ai] ${level}: ${message}`);
      }
    },
  };

  const server = new McpServer({ name: "etchwp-ai", version: "0.1.0" });
  registerStatusTools(server, ctx);
  registerBlockTools(server, ctx);
  registerStyleTools(server, ctx);
  registerStylesheetTools(server, ctx);
  registerComponentTools(server, ctx);
  registerLoopTools(server, ctx);
  registerFieldTools(server, ctx);
  registerNavTools(server, ctx);
  registerScreenshotTool(server, ctx);
  registerInsertPatternTool(server, ctx);
  registerSidecarTools(server, ctx, fetchImpl ?? fetch);
  return { server, ctx };
}

export function buildServer(deps: ServerDeps): { server: McpServer; ctx: ToolContext } {
  return buildServerWithCtx(deps);
}
