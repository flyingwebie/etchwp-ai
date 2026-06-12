import { describe, expect, test } from "bun:test";
import { MockBridge } from "../../src/bridge/mock.ts";
import { call, connectedClient } from "../server.test.ts";

describe("etch_components", () => {
  test("list/get_json read; create returns numeric id; immediate persistence", async () => {
    const b = new MockBridge();
    b.setHandler("components", "list", () => [
      { id: 7, name: "Card", key: "Card", properties: [] },
    ]);
    b.setHandler("components", "createAsync", (name) => {
      expect(name).toBe("Hero");
      return 8;
    });
    const client = await connectedClient(b);
    const list = await call(client, "etch_components_read", { action: "list" });
    expect(list.result[0].id).toBe(7);
    const created = await call(client, "etch_components_write", { action: "create", name: "Hero" });
    expect(created.result).toBe(8);
    expect(created.persistence).toBe("immediate");
    expect(created.dirty.page).toBe(0);
    expect(created.hint).toContain("empty");
  });

  test("string componentId rejected with teaching error", async () => {
    const client = await connectedClient(new MockBridge());
    const out = await call(client, "etch_components_read", {
      action: "get_json",
      componentId: "7" as unknown as number,
    });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("E_VALIDATION");
    expect(out.error.message).toMatch(/numeric|number/i);
  });

  test("update forwards a partial patch and warns about wholesale fields", async () => {
    const b = new MockBridge();
    let patched: unknown;
    b.setHandler("components", "updateAsync", (_id, patch) => {
      patched = patch;
    });
    const client = await connectedClient(b);
    const out = await call(client, "etch_components_write", {
      action: "update",
      componentId: 7,
      patch: { description: "new desc", blocks: [] },
    });
    expect(out.ok).toBe(true);
    expect(patched).toEqual({ description: "new desc", blocks: [] });
    expect(out.hint).toMatch(/replace/i);
  });

  test("reserved number-primitive component property is rejected", async () => {
    const client = await connectedClient(new MockBridge());
    const out = await call(client, "etch_components_write", {
      action: "update",
      componentId: 7,
      patch: {
        properties: [{ name: "Count", key: "count", type: { primitive: "number" } }],
      },
    });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("E_VALIDATION");
    expect(out.error.message).toMatch(/reserved/i);
  });
});
