import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EtchBridge } from "./bridge/types.ts";
import type { Config } from "./config.ts";
import { DirtyTracker, MutationCounter } from "./state/dirty.ts";
import type { ToolContext } from "./tool-kit.ts";
import { registerStatusTools, resetFeatureCache } from "./tools/status.ts";

export interface ServerDeps {
  bridge: EtchBridge;
  config: Config;
}

export function buildServerWithCtx({ bridge, config }: ServerDeps): {
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
    async ensureAttached() {
      if (attached && bridge.session().state === "attached") return;
      await bridge.attach();
      attached = true;
    },
    log(level, message) {
      // stdout is the MCP protocol channel — all logging goes to stderr.
      console.error(`[etchwp-ai] ${level}: ${message}`);
    },
  };

  const server = new McpServer({ name: "etchwp-ai", version: "0.1.0" });
  registerStatusTools(server, ctx);
  return { server, ctx };
}

export function buildServer(deps: ServerDeps): { server: McpServer; ctx: ToolContext } {
  return buildServerWithCtx(deps);
}
