import { describe, expect, test } from "bun:test";
import { MockBridge } from "../../src/bridge/mock.ts";

describe("MockBridge", () => {
  test("eval routes to handler and records the call", async () => {
    const b = new MockBridge();
    b.setHandler("blocks", "getTree", () => [{ id: "b1", type: "etch/element" }]);
    await b.attach();
    const result = await b.eval("blocks", "getTree", []);
    expect(result).toEqual([{ id: "b1", type: "etch/element" }]);
    expect(b.calls).toEqual([{ domain: "blocks", method: "getTree", args: [] }]);
  });

  test("eval enforces the allowlist", async () => {
    const b = new MockBridge();
    await b.attach();
    await expect(b.eval("blocks", "notAMethod", [])).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  test("unhandled allowlisted method returns E_FEATURE_MISSING when feature-detection says absent", async () => {
    const b = new MockBridge({ missingFeatures: [["blocks", "find"]] });
    await b.attach();
    await expect(b.eval("blocks", "find", [{}])).rejects.toMatchObject({
      code: "E_FEATURE_MISSING",
    });
    const features = await b.probeFeatures();
    expect(features.blocks?.find).toBe(false);
    expect(features.blocks?.create).toBe(true);
  });

  test("handler throwing EtchApiError-shaped error passes its code through", async () => {
    const b = new MockBridge();
    b.setHandler("blocks", "getJson", () => {
      const e = new Error("nope") as Error & { code: string };
      e.code = "BLOCK_NOT_FOUND";
      throw e;
    });
    await b.attach();
    await expect(b.eval("blocks", "getJson", ["x"])).rejects.toMatchObject({
      code: "BLOCK_NOT_FOUND",
    });
  });

  test("simulateNavigation bumps the epoch and sets the reload flag", async () => {
    const b = new MockBridge();
    await b.attach();
    const before = b.session().epoch;
    b.simulateNavigation();
    expect(b.session().epoch).toBe(before + 1);
    expect(b.takeReloadFlag()).toBe(true);
    expect(b.takeReloadFlag()).toBe(false); // consumed
  });

  test("expected navigation (nav-tool initiated) does not set the reload flag", async () => {
    const b = new MockBridge();
    b.setHandler("navigation", "openPostAsync", () => {
      b.simulateNavigation({ expected: true });
      return undefined;
    });
    await b.attach();
    await b.eval("navigation", "openPostAsync", [42]);
    expect(b.takeReloadFlag()).toBe(false);
    expect(b.session().epoch).toBe(1);
  });

  test("detached bridge rejects with E_DETACHED", async () => {
    const b = new MockBridge();
    await b.attach();
    await b.detach();
    await expect(b.eval("blocks", "getTree", [])).rejects.toMatchObject({ code: "E_DETACHED" });
  });

  test("unavailable etch rejects with E_NOT_AVAILABLE after poll timeout", async () => {
    const b = new MockBridge({ pollIntervalMs: 1, availabilityTimeoutMs: 5 });
    await b.attach();
    b.available = false;
    await expect(b.eval("blocks", "getTree", [])).rejects.toMatchObject({
      code: "E_NOT_AVAILABLE",
    });
  });

  test("readRootVariables returns configured fixtures", async () => {
    const vars = [
      { name: "--space-m", value: "1.5rem", stylesheetHref: "/automatic-css/automatic.css" },
    ];
    const b = new MockBridge({ rootVariables: vars });
    await b.attach();
    expect(await b.readRootVariables()).toEqual(vars);
  });
});
