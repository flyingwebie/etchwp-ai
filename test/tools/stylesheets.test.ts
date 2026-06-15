import { describe, expect, test } from "bun:test";
import { MockBridge } from "../../src/bridge/mock.ts";
import { call, connectedClient } from "../server.test.ts";

describe("etch_stylesheets", () => {
  test("reads work; writes persist immediately and never mark dirty", async () => {
    const b = new MockBridge();
    b.setHandler("stylesheets", "list", () => [
      { id: "ss1", name: "Main", css: "", type: "default" },
    ]);
    b.setHandler("stylesheets", "createAsync", (input) => {
      expect(input).toEqual({ name: "Tokens", css: ":root{--x:1}" });
      return "ss2";
    });
    b.setHandler("stylesheets", "appendAsync", () => undefined);
    b.setHandler("stylesheets", "listCustomMedia", () => ({ "--md": "(min-width: 768px)" }));
    b.setHandler("stylesheets", "addCustomMediaAsync", () => undefined);
    const client = await connectedClient(b);

    const list = await call(client, "etch_stylesheets_read", { action: "list" });
    expect(list.result[0].id).toBe("ss1");

    const created = await call(client, "etch_stylesheets_write", {
      action: "create",
      name: "Tokens",
      css: ":root{--x:1}",
    });
    expect(created.ok).toBe(true);
    expect(created.result).toBe("ss2");
    expect(created.persistence).toBe("immediate");
    expect(created.dirty).toEqual({ page: 0, componentEdit: 0, lastCallIndeterminate: false });

    const media = await call(client, "etch_stylesheets_read", { action: "list_custom_media" });
    expect(media.result["--md"]).toBe("(min-width: 768px)");

    const appended = await call(client, "etch_stylesheets_write", {
      action: "append",
      stylesheetId: "ss2",
      css: ".y{}",
    });
    expect(appended.persistence).toBe("immediate");
  });

  test("STYLESHEET_NOT_FOUND passes through", async () => {
    const b = new MockBridge();
    b.setHandler("stylesheets", "get", () => {
      const e = new Error("missing") as Error & { code: string };
      e.code = "STYLESHEET_NOT_FOUND";
      throw e;
    });
    const client = await connectedClient(b);
    const out = await call(client, "etch_stylesheets_read", {
      action: "get",
      stylesheetId: "nope",
    });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("STYLESHEET_NOT_FOUND");
  });
});
