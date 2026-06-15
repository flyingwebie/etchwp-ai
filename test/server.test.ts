import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockBridge } from "../src/bridge/mock.ts";
import { loadConfig } from "../src/config.ts";
import { buildServer } from "../src/server.ts";

export async function connectedClient(bridge: MockBridge, env: Record<string, string> = {}) {
  const { server } = buildServer({ bridge, config: loadConfig(env) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

export async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return JSON.parse(res.content[0]?.text ?? "{}");
}

describe("server skeleton", () => {
  test("initialize handshake exposes etch_status and etch_save", async () => {
    const client = await connectedClient(new MockBridge());
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("etch_status");
    expect(names).toContain("etch_save");
  });

  test("etch_status reports session, dirty split, featureMap", async () => {
    const bridge = new MockBridge({ missingFeatures: [["blocks", "find"]] });
    bridge.setHandler("navigation", "getActivePostId", () => 42);
    bridge.setHandler("navigation", "isEditingTemplate", () => false);
    bridge.setHandler("navigation", "getCurrentPlace", () => "builder");
    bridge.setHandler("blocks", "isInComponentEditMode", () => false);
    bridge.setHandler("history", "canUndo", () => true);
    bridge.setHandler("history", "canRedo", () => false);
    const client = await connectedClient(bridge);
    const out = await call(client, "etch_status");
    expect(out.ok).toBe(true);
    expect(out.result.activePostId).toBe(42);
    expect(out.result.isEditingTemplate).toBe(false);
    expect(out.result.place).toBe("builder");
    expect(out.result.componentEditMode).toBe(false);
    expect(out.result.canUndo).toBe(true);
    expect(out.result.dirty).toEqual({ page: 0, componentEdit: 0, lastCallIndeterminate: false });
    expect(out.result.featureMap.blocks.find).toBe(false);
    expect(out.result.apiVersion).toBe("0.x");
    expect(out.result.sessionEpoch).toBe(0);
  });

  test("etch_save calls saveAsync and clears pageDirty only", async () => {
    const bridge = new MockBridge();
    let saved = 0;
    bridge.setHandler("root", "saveAsync", () => {
      saved += 1;
    });
    const { server, ctx } = (await import("../src/server.ts")).buildServerWithCtx({
      bridge,
      config: loadConfig({}),
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([client.connect(ct), server.connect(st)]);
    ctx.dirty.mark("page");
    ctx.dirty.mark("componentEdit");
    const out = await call(client, "etch_save");
    expect(out.ok).toBe(true);
    expect(saved).toBe(1);
    expect(out.dirty).toEqual({ page: 0, componentEdit: 1, lastCallIndeterminate: false });
    expect(out.hint).toContain("save_component_edit");
  });

  test("errors carry code + remediation in the envelope", async () => {
    const bridge = new MockBridge();
    bridge.setHandler("root", "saveAsync", () => {
      const e = new Error("save failed") as Error & { code: string };
      e.code = "OPERATION_FAILED";
      throw e;
    });
    const client = await connectedClient(bridge);
    const out = await call(client, "etch_save");
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("OPERATION_FAILED");
    expect(out.error.remediation.length).toBeGreaterThan(0);
  });

  test("session reload fails the next non-status call once with E_SESSION_RELOADED and resets dirty", async () => {
    const bridge = new MockBridge();
    bridge.setHandler("root", "saveAsync", () => {});
    const { server, ctx } = (await import("../src/server.ts")).buildServerWithCtx({
      bridge,
      config: loadConfig({}),
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([client.connect(ct), server.connect(st)]);
    ctx.dirty.mark("page");
    bridge.simulateNavigation();
    const first = await call(client, "etch_save");
    expect(first.ok).toBe(false);
    expect(first.error.code).toBe("E_SESSION_RELOADED");
    const second = await call(client, "etch_save");
    expect(second.ok).toBe(true);
    expect(second.dirty.page).toBe(0);
  });

  test("etch_status survives a reload flag without consuming it", async () => {
    const bridge = new MockBridge();
    bridge.setHandler("root", "saveAsync", () => {});
    const client = await connectedClient(bridge);
    bridge.simulateNavigation();
    const status = await call(client, "etch_status");
    expect(status.ok).toBe(true);
    expect(status.result.sessionEpoch).toBe(1);
    const save = await call(client, "etch_save");
    expect(save.ok).toBe(false);
    expect(save.error.code).toBe("E_SESSION_RELOADED");
  });
});
