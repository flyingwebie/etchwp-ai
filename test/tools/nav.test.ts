import { describe, expect, test } from "bun:test";
import { MockBridge } from "../../src/bridge/mock.ts";
import { call, connectedClient } from "../server.test.ts";

function navBridge() {
  const b = new MockBridge();
  b.setHandler("styles", "create", () => "s1");
  b.setHandler("navigation", "openPostAsync", () => {
    b.simulateNavigation({ expected: !b.unexpectedNav });
  });
  b.setHandler("navigation", "listPostsAsync", () => [
    { id: 1, title: "Home", slug: "home", status: "publish", postType: "page" },
  ]);
  b.setHandler("ui", "exitToWordPress", () => undefined);
  b.setHandler("ui", "setColorScheme", () => undefined);
  b.setHandler("ui", "isInterfaceHidden", () => false);
  b.setHandler("history", "undo", () => undefined);
  b.setHandler("history", "canUndo", () => true);
  return b;
}

describe("etch_nav", () => {
  test("open_post with dirty buffer fails with E_UNSAVED_CHANGES", async () => {
    const b = navBridge();
    const client = await connectedClient(b);
    await call(client, "etch_styles_write", { action: "create", selector: ".x" }); // dirty
    const out = await call(client, "etch_nav", { action: "open_post", postId: 1 });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("E_UNSAVED_CHANGES");
    expect(out.error.remediation).toContain("etch_save");
  });

  test("open_post with discard true proceeds, resets dirty, notes the discard", async () => {
    const b = navBridge();
    const client = await connectedClient(b);
    await call(client, "etch_styles_write", { action: "create", selector: ".x" });
    const out = await call(client, "etch_nav", { action: "open_post", postId: 1, discard: true });
    expect(out.ok).toBe(true);
    expect(out.dirty.page).toBe(0);
    expect(out.hint).toMatch(/discard/i);
    // nav-initiated reload must NOT poison the next call
    const next = await call(client, "etch_nav", { action: "list_posts" });
    expect(next.ok).toBe(true);
  });

  test("open_post with clean buffer proceeds without discard", async () => {
    const client = await connectedClient(navBridge());
    const out = await call(client, "etch_nav", { action: "open_post", postId: 1 });
    expect(out.ok).toBe(true);
  });

  test("exit_to_wordpress requires confirm: true", async () => {
    const client = await connectedClient(navBridge());
    const out = await call(client, "etch_nav", { action: "exit_to_wordpress" });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("E_VALIDATION");
    expect(out.error.message).toContain("confirm");
    const confirmed = await call(client, "etch_nav", {
      action: "exit_to_wordpress",
      confirm: true,
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.hint).toMatch(/session/i);
  });

  test("list_posts notes missing pagination via description contract (returns raw list)", async () => {
    const client = await connectedClient(navBridge());
    const out = await call(client, "etch_nav", { action: "list_posts" });
    expect(out.result[0].slug).toBe("home");
  });
});

describe("etch_ui", () => {
  test("actions are local-ui persistence and never dirty", async () => {
    const client = await connectedClient(navBridge());
    const out = await call(client, "etch_ui", { action: "set_color_scheme", scheme: "dark" });
    expect(out.ok).toBe(true);
    expect(out.persistence).toBe("local-ui");
    expect(out.dirty).toEqual({ page: 0, componentEdit: 0, lastCallIndeterminate: false });
    const hidden = await call(client, "etch_ui", { action: "is_interface_hidden" });
    expect(hidden.result).toBe(false);
  });
});

describe("etch_history", () => {
  test("undo resolves; can_undo readable; dirty counters untouched", async () => {
    const b = navBridge();
    const client = await connectedClient(b);
    await call(client, "etch_styles_write", { action: "create", selector: ".x" });
    const undo = await call(client, "etch_history", { action: "undo" });
    expect(undo.ok).toBe(true);
    expect(undo.dirty.page).toBe(1); // undo does NOT adjust dirty (lower-bound semantics)
    const can = await call(client, "etch_history", { action: "can_undo" });
    expect(can.result).toBe(true);
  });
});
