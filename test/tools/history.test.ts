import { describe, expect, test } from "bun:test";
import { MockBridge } from "../../src/bridge/mock.ts";
import { call, connectedClient } from "../server.test.ts";

function rigged() {
  const b = new MockBridge();
  b.setHandler("styles", "create", () => "s1");
  b.setHandler("stylesheets", "createAsync", () => "ss1");
  b.setHandler("blocks", "create", () => "b1");
  let undos = 0;
  b.setHandler("history", "undo", () => {
    undos += 1;
  });
  b.setHandler("history", "canUndo", () => true);
  return { b, undoCount: () => undos };
}

describe("etch_history checkpoint/rollback", () => {
  test("rollback undoes exactly the mutations since checkpoint, flags immediate-domain writes", async () => {
    const { b, undoCount } = rigged();
    const client = await connectedClient(b);
    await call(client, "etch_styles_write", { action: "create", selector: ".pre" }); // before checkpoint
    const cp = await call(client, "etch_history", { action: "checkpoint" });
    expect(cp.ok).toBe(true);
    await call(client, "etch_styles_write", { action: "create", selector: ".a" });
    await call(client, "etch_stylesheets_write", { action: "create", name: "S", css: "x" }); // immediate
    await call(client, "etch_blocks_write", {
      action: "create",
      json: { type: "etch/text", version: 1, context: {}, children: [], text: "t" },
    });
    const rb = await call(client, "etch_history", { action: "rollback" });
    expect(rb.ok).toBe(true);
    expect(rb.result.requested).toBe(3);
    expect(rb.result.performed).toBe(3);
    expect(undoCount()).toBe(3);
    expect(rb.result.immediateDomainsSinceCheckpoint).toEqual(["stylesheets"]);
    expect(rb.hint).toMatch(/immediate|undocumented/i);
  });

  test("rollback stops on undo-stack exhaustion and reports it", async () => {
    const { b } = rigged();
    let calls = 0;
    b.setHandler("history", "canUndo", () => {
      calls += 1;
      return calls <= 1; // only one undo allowed
    });
    const client = await connectedClient(b);
    await call(client, "etch_history", { action: "checkpoint" });
    await call(client, "etch_styles_write", { action: "create", selector: ".a" });
    await call(client, "etch_styles_write", { action: "create", selector: ".b" });
    const rb = await call(client, "etch_history", { action: "rollback" });
    expect(rb.result.requested).toBe(2);
    expect(rb.result.performed).toBe(1);
    expect(rb.result.stoppedBecause).toBe("undo_stack_exhausted");
  });

  test("rollback without checkpoint is a validation error", async () => {
    const { b } = rigged();
    const client = await connectedClient(b);
    const rb = await call(client, "etch_history", { action: "rollback" });
    expect(rb.ok).toBe(false);
    expect(rb.error.code).toBe("E_VALIDATION");
  });
});
