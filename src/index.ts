#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CdpBridge } from "./bridge/cdp.ts";
import type { EtchBridge } from "./bridge/types.ts";
import { WsBridge } from "./bridge/ws.ts";
import { loadConfig } from "./config.ts";
import { buildServer } from "./server.ts";

async function main() {
  const config = loadConfig();
  const bridge: EtchBridge =
    config.transport === "ws" ? new WsBridge(config) : new CdpBridge(config);
  console.error(
    `[etchwp-ai] info: transport=${config.transport}${
      config.transport === "ws" ? ` (ws mode=${config.ws.mode})` : ""
    }.`,
  );
  const { server, ctx } = buildServer({ bridge, config });

  const warnIfDirty = () => {
    const snap = ctx.dirty.snapshot();
    if (snap.page > 0 || snap.componentEdit > 0) {
      console.error(
        `[etchwp-ai] warn: disconnecting with unsaved buffered changes (page=${snap.page}, componentEdit=${snap.componentEdit}) — they will be LOST unless saved in the builder.`,
      );
    }
  };
  process.on("exit", warnIfDirty);
  process.on("SIGINT", () => {
    warnIfDirty();
    process.exit(130);
  });

  if (!config.sidecar) {
    console.error(
      "[etchwp-ai] info: WP REST sidecar disabled (set WP_BASE_URL, WP_APP_USER, WP_APP_PASSWORD to enable wp_media/wp_content).",
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[etchwp-ai] info: MCP server ready on stdio.");
}

main().catch((e) => {
  console.error(`[etchwp-ai] error: fatal — ${e?.message ?? e}`);
  process.exit(1);
});
