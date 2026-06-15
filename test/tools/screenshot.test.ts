import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockBridge } from "../../src/bridge/mock.ts";
import { loadConfig } from "../../src/config.ts";
import { buildServer } from "../../src/server.ts";
import { parsePngSize } from "../../src/tools/screenshot.ts";

export function makePng(width: number, height: number, extraBytes = 0): Uint8Array {
  const buf = new Uint8Array(33 + extraBytes);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // signature
  const dv = new DataView(buf.buffer);
  dv.setUint32(8, 13); // IHDR length
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  return buf;
}

async function rawCall(bridge: MockBridge) {
  const { server } = buildServer({ bridge, config: loadConfig({}) });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return (args: Record<string, unknown>) =>
    client.callTool({ name: "etch_screenshot", arguments: args }) as Promise<{
      content: Array<Record<string, unknown>>;
      isError?: boolean;
    }>;
}

describe("parsePngSize", () => {
  test("reads IHDR dimensions", () => {
    expect(parsePngSize(makePng(1280, 720))).toEqual({ width: 1280, height: 720 });
    expect(parsePngSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("etch_screenshot", () => {
  test("small capture returns MCP image content (png)", async () => {
    const b = new MockBridge({ screenshotBytes: makePng(1280, 720) });
    const shot = await rawCall(b);
    const res = await shot({ mode: "viewport" });
    expect(res.isError).toBeFalsy();
    const img = res.content.find((c) => c.type === "image");
    expect(img).toBeTruthy();
    expect(img?.mimeType).toBe("image/png");
  });

  test("oversized dimensions trigger a scaled recapture", async () => {
    const b = new MockBridge();
    const captured: unknown[] = [];
    b.screenshotImpl = (opts) => {
      captured.push(opts);
      return captured.length === 1 ? makePng(3200, 1800) : makePng(1600, 900);
    };
    const shot = await rawCall(b);
    const res = await shot({ mode: "viewport" });
    expect(res.isError).toBeFalsy();
    expect(captured.length).toBe(2);
    expect((captured[1] as { scaleFactor?: number }).scaleFactor).toBeCloseTo(0.5);
  });

  test("hide_chrome wraps capture in interface hide/show", async () => {
    const b = new MockBridge({ screenshotBytes: makePng(800, 600) });
    b.setHandler("ui", "setInterfaceHidden", () => undefined);
    const shot = await rawCall(b);
    await shot({ mode: "viewport", hide_chrome: true });
    const uiCalls = b.calls.filter((c) => c.method === "setInterfaceHidden").map((c) => c.args[0]);
    expect(uiCalls).toEqual([true, false]);
  });

  test("detached bridge yields E_DETACHED envelope", async () => {
    const b = new MockBridge({ screenshotBytes: makePng(800, 600) });
    const shot = await rawCall(b);
    await shot({ mode: "viewport" }); // attaches
    await b.detach();
    b.failScreenshots = true;
    const res = await shot({ mode: "viewport" });
    const text = JSON.parse((res.content[0] as { text: string }).text);
    expect(text.ok).toBe(false);
    expect(text.error.code).toBe("E_DETACHED");
  });
});
