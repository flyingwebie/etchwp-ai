import { describe, expect, test } from "bun:test";
import { MockBridge } from "../../src/bridge/mock.ts";
import { call, connectedClient } from "../server.test.ts";

const TREE = [
  {
    id: "root1",
    type: "etch/element",
    tag: "section",
    children: [
      {
        id: "c1",
        type: "etch/raw-html",
        content: "<p>safe</p>",
        unsafe: "<script>evil</script>",
        children: [{ id: "g1", type: "etch/text", text: "hi", children: [] }],
      },
    ],
  },
];

function bridgeWithTree() {
  const b = new MockBridge();
  b.setHandler("blocks", "getTree", () => structuredClone(TREE));
  b.setHandler("blocks", "isInComponentEditMode", () => false);
  return b;
}

describe("etch_blocks_read", () => {
  test("get_tree returns the tree, strips raw-html unsafe by default", async () => {
    const client = await connectedClient(bridgeWithTree());
    const out = await call(client, "etch_blocks_read", { action: "get_tree" });
    expect(out.ok).toBe(true);
    expect(out.result[0].id).toBe("root1");
    expect(out.result[0].children[0].content).toBe("<p>safe</p>");
    expect(out.result[0].children[0].unsafe).toBeUndefined();
  });

  test("include_unsafe surfaces the raw field", async () => {
    const client = await connectedClient(bridgeWithTree());
    const out = await call(client, "etch_blocks_read", {
      action: "get_tree",
      include_unsafe: true,
    });
    expect(out.result[0].children[0].unsafe).toBe("<script>evil</script>");
  });

  test("depth=1 prunes children, replacing them with childCount", async () => {
    const client = await connectedClient(bridgeWithTree());
    const out = await call(client, "etch_blocks_read", { action: "get_tree", depth: 1 });
    expect(out.result[0].children).toBeUndefined();
    expect(out.result[0].childCount).toBe(1);
  });

  test("mode=summary returns id/type/name/childCount only", async () => {
    const client = await connectedClient(bridgeWithTree());
    const out = await call(client, "etch_blocks_read", { action: "get_tree", mode: "summary" });
    expect(out.result[0]).toEqual({
      id: "root1",
      type: "etch/element",
      name: undefined,
      childCount: 1,
    });
  });

  test("oversized response is refused with a depth/summary hint", async () => {
    const client = await connectedClient(bridgeWithTree(), { ETCH_MAX_READ_BYTES: "50" });
    const out = await call(client, "etch_blocks_read", { action: "get_tree" });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("E_READ_TOO_LARGE");
    expect(out.error.message).toMatch(/depth|summary/);
  });

  test("find forwards presence-only predicate", async () => {
    const b = bridgeWithTree();
    b.setHandler("blocks", "find", (pred) => {
      expect(pred).toEqual({ type: "etch/text" });
      return ["g1"];
    });
    const client = await connectedClient(b);
    const out = await call(client, "etch_blocks_read", {
      action: "find",
      predicate: { type: "etch/text" },
    });
    expect(out.result).toEqual(["g1"]);
  });
});

describe("etch_blocks_write", () => {
  test("create forwards EtchBlockJson and marks pageDirty", async () => {
    const b = bridgeWithTree();
    b.setHandler("blocks", "create", () => "new1");
    const client = await connectedClient(b);
    const json = { type: "etch/text", version: 1, context: {}, children: [], text: "hello" };
    const out = await call(client, "etch_blocks_write", {
      action: "create",
      json,
      parentId: "root1",
    });
    expect(out.ok).toBe(true);
    expect(out.result).toBe("new1");
    expect(out.dirty.page).toBe(1);
    expect(out.persistence).toBe("buffered");
  });

  test("create rejects a styles array anywhere in the tree with a teaching error", async () => {
    const client = await connectedClient(bridgeWithTree());
    const out = await call(client, "etch_blocks_write", {
      action: "create",
      json: {
        type: "etch/element",
        version: 1,
        context: {},
        tag: "div",
        attributes: {},
        children: [
          { type: "etch/text", version: 1, context: {}, children: [], text: "x", styles: ["s1"] },
        ],
      },
    });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("E_VALIDATION");
    expect(out.error.message).toContain("add_class");
    expect(out.dirty?.page ?? 0).toBe(0);
  });

  test("update accepts BlockPatch only; full block JSON is rejected pointing to replace", async () => {
    const b = bridgeWithTree();
    b.setHandler("blocks", "update", () => undefined);
    const client = await connectedClient(b);
    const good = await call(client, "etch_blocks_write", {
      action: "update",
      blockId: "g1",
      patch: { name: "renamed", attributes: { "data-x": "1" } },
    });
    expect(good.ok).toBe(true);
    const bad = await call(client, "etch_blocks_write", {
      action: "update",
      blockId: "g1",
      patch: { type: "etch/text", children: [] },
    });
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe("E_VALIDATION");
    expect(bad.error.message).toContain("replace");
  });

  test("add_class forwards the styleId", async () => {
    const b = bridgeWithTree();
    b.setHandler("blocks", "addClass", (id, styleId) => {
      expect(id).toBe("g1");
      expect(styleId).toBe("style-123");
    });
    const client = await connectedClient(b);
    const out = await call(client, "etch_blocks_write", {
      action: "add_class",
      blockId: "g1",
      styleId: "style-123",
    });
    expect(out.ok).toBe(true);
  });

  test("select/deselect/enter/exit component edit are non-dirty", async () => {
    const b = bridgeWithTree();
    b.setHandler("blocks", "select", () => undefined);
    b.setHandler("blocks", "enterComponentEditMode", () => undefined);
    b.setHandler("blocks", "exitComponentEditMode", () => undefined);
    const client = await connectedClient(b);
    await call(client, "etch_blocks_write", { action: "select", blockId: "g1" });
    await call(client, "etch_blocks_write", { action: "enter_component_edit", blockId: "c1" });
    const out = await call(client, "etch_blocks_write", { action: "exit_component_edit" });
    expect(out.dirty).toEqual({ page: 0, componentEdit: 0, lastCallIndeterminate: false });
  });

  test("writes inside component edit mode mark componentEditDirty; save_component_edit clears it", async () => {
    const b = bridgeWithTree();
    b.setHandler("blocks", "enterComponentEditMode", () => undefined);
    b.setHandler("blocks", "setText", () => undefined);
    b.setHandler("blocks", "saveComponentEditModeAsync", () => undefined);
    const client = await connectedClient(b);
    await call(client, "etch_blocks_write", { action: "enter_component_edit", blockId: "c1" });
    const w = await call(client, "etch_blocks_write", {
      action: "set_text",
      blockId: "g1",
      text: "new",
    });
    expect(w.dirty).toEqual({ page: 0, componentEdit: 1, lastCallIndeterminate: false });
    const saved = await call(client, "etch_blocks_write", { action: "save_component_edit" });
    expect(saved.dirty.componentEdit).toBe(0);
  });

  test("exit_component_edit with revert true clears componentEditDirty and forwards the option", async () => {
    const b = bridgeWithTree();
    b.setHandler("blocks", "enterComponentEditMode", () => undefined);
    b.setHandler("blocks", "setText", () => undefined);
    let exitArgs: unknown;
    b.setHandler("blocks", "exitComponentEditMode", (opts) => {
      exitArgs = opts;
    });
    const client = await connectedClient(b);
    await call(client, "etch_blocks_write", { action: "enter_component_edit", blockId: "c1" });
    await call(client, "etch_blocks_write", { action: "set_text", blockId: "g1", text: "x" });
    const out = await call(client, "etch_blocks_write", {
      action: "exit_component_edit",
      revert: true,
    });
    expect(exitArgs).toEqual({ revert: true });
    expect(out.dirty.componentEdit).toBe(0);
  });

  test("WRONG_BLOCK_TYPE from setText passes through with guidance", async () => {
    const b = bridgeWithTree();
    b.setHandler("blocks", "setText", () => {
      const e = new Error("not a text block") as Error & { code: string };
      e.code = "WRONG_BLOCK_TYPE";
      throw e;
    });
    const client = await connectedClient(b);
    const out = await call(client, "etch_blocks_write", {
      action: "set_text",
      blockId: "root1",
      text: "x",
    });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("WRONG_BLOCK_TYPE");
  });
});
