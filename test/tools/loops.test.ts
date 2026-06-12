import { describe, expect, test } from "bun:test";
import { MockBridge } from "../../src/bridge/mock.ts";
import { call, connectedClient } from "../server.test.ts";

describe("etch_loops", () => {
  test("add forwards open-ended config and marks pageDirty", async () => {
    const b = new MockBridge();
    let added: unknown;
    b.setHandler("loops", "add", (loop) => {
      added = loop;
      return "loop-1";
    });
    const client = await connectedClient(b);
    const loop = {
      key: "recent_posts",
      name: "Recent Posts",
      global: true,
      config: {
        type: "wp-query",
        args: { post_type: "post", posts_per_page: "$count ?? 10", custom_arg: "kept" },
      },
    };
    const out = await call(client, "etch_loops_write", { action: "add", loop });
    expect(out.result).toBe("loop-1");
    expect(added).toEqual(loop);
    expect(out.dirty.page).toBe(1);
    expect(out.persistence).toBe("buffered");
  });

  test("update requires the FULL loop (replacement) and says so", async () => {
    const client = await connectedClient(new MockBridge());
    const out = await call(client, "etch_loops_write", {
      action: "update",
      loopId: "loop-1",
    });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("E_VALIDATION");
    expect(out.error.message).toMatch(/full|replacement/i);
  });

  test("set_for_block binds a loop with params", async () => {
    const b = new MockBridge();
    let bound: unknown[] = [];
    b.setHandler("loops", "setForBlock", (...a) => {
      bound = a;
    });
    const client = await connectedClient(b);
    const binding = { loopId: "loop-1", itemId: "post", indexId: "i", loopParams: { count: 3 } };
    const out = await call(client, "etch_loops_write", {
      action: "set_for_block",
      blockId: "blk-9",
      binding,
    });
    expect(out.ok).toBe(true);
    expect(bound).toEqual(["blk-9", binding]);
  });

  test("get_all and find read", async () => {
    const b = new MockBridge();
    b.setHandler("loops", "getAll", () => ({ "loop-1": { key: "k", name: "n", global: false } }));
    b.setHandler("loops", "findLoop", (q) => {
      expect(q).toBe("recent");
      return [{ id: "loop-1", key: "k", name: "Recent", global: false }];
    });
    const client = await connectedClient(b);
    const all = await call(client, "etch_loops_read", { action: "get_all" });
    expect(all.result["loop-1"].key).toBe("k");
    const found = await call(client, "etch_loops_read", { action: "find", query: "recent" });
    expect(found.result[0].id).toBe("loop-1");
  });
});
