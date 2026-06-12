import { describe, expect, test } from "bun:test";
import { MockBridge } from "../../src/bridge/mock.ts";
import { call, connectedClient } from "../server.test.ts";

describe("etch_styles", () => {
  test("create returns a styleId usable by add_class (integration)", async () => {
    const b = new MockBridge();
    b.setHandler("styles", "create", (selector, css) => {
      expect(selector).toBe(".hero");
      expect(css).toBe("color: var(--primary);");
      return "style-77";
    });
    let attached: unknown[] = [];
    b.setHandler("blocks", "addClass", (...a) => {
      attached = a;
    });
    const client = await connectedClient(b);
    const created = await call(client, "etch_styles_write", {
      action: "create",
      selector: ".hero",
      css: "color: var(--primary);",
    });
    expect(created.ok).toBe(true);
    expect(created.result).toBe("style-77");
    expect(created.dirty.page).toBe(1);
    const add = await call(client, "etch_blocks_write", {
      action: "add_class",
      blockId: "b1",
      styleId: created.result,
    });
    expect(add.ok).toBe(true);
    expect(attached).toEqual(["b1", "style-77"]);
  });

  test("list and variable reads work; variable writes mark pageDirty", async () => {
    const b = new MockBridge();
    b.setHandler("styles", "list", () => [
      { id: "s1", selector: ".x", collection: "default", css: "" },
    ]);
    b.setHandler("styles", "listVariables", (collection) => {
      expect(collection).toBe("brand");
      return { "--brand": "#0af" };
    });
    b.setHandler("styles", "setVariable", () => undefined);
    const client = await connectedClient(b);
    const list = await call(client, "etch_styles_read", { action: "list" });
    expect(list.result[0].id).toBe("s1");
    const vars = await call(client, "etch_styles_read", {
      action: "list_variables",
      collection: "brand",
    });
    expect(vars.result).toEqual({ "--brand": "#0af" });
    const set = await call(client, "etch_styles_write", {
      action: "set_variable",
      name: "--brand",
      value: "#fff",
    });
    expect(set.dirty.page).toBe(1);
  });
});

describe("etch_tokens", () => {
  const ACSS_SHEET = "https://site.com/wp-content/uploads/automatic-css/automatic.css";
  const THEME_SHEET = "https://site.com/wp-content/themes/custom/style.css";

  function tokenBridge() {
    const b = new MockBridge({
      rootVariables: [
        { name: "--space-m", value: "1.5rem", stylesheetHref: ACSS_SHEET },
        { name: "--action-hover", value: "#0af", stylesheetHref: ACSS_SHEET }, // renamed palette
        { name: "--text-brand", value: "#333", stylesheetHref: THEME_SHEET }, // user var w/ ACSS-ish prefix
        { name: "--my-var", value: "10px", stylesheetHref: null },
      ],
    });
    b.setHandler("styles", "listVariables", () => ({
      "--etch-reg": "1px",
      "--space-m": "SHADOWED",
    }));
    return b;
  }

  test("merges sources: etch wins on name collision, sources tagged", async () => {
    const client = await connectedClient(tokenBridge());
    const out = await call(client, "etch_tokens", { filter: "all" });
    expect(out.ok).toBe(true);
    const byName = Object.fromEntries(out.result.map((t: any) => [t.name, t]));
    expect(byName["--etch-reg"].source).toBe("etch");
    expect(byName["--space-m"].source).toBe("etch"); // etch wins dedupe
    expect(byName["--action-hover"].source).toBe("computed");
  });

  test("classification is by stylesheet origin, not prefix", async () => {
    const client = await connectedClient(tokenBridge());
    const acss = await call(client, "etch_tokens", { filter: "acss" });
    const names = acss.result.map((t: any) => t.name).sort();
    // renamed --action-* family IS acss (origin); --text-brand is NOT (theme sheet) despite prefix
    expect(names).toEqual(["--action-hover"]);
    const custom = await call(client, "etch_tokens", { filter: "custom" });
    const customNames = custom.result.map((t: any) => t.name).sort();
    expect(customNames).toEqual(["--my-var", "--text-brand"]);
  });

  test("acss tokens carry namespace metadata from the prefix constant", async () => {
    const b = new MockBridge({
      rootVariables: [
        { name: "--space-m", value: "1.5rem", stylesheetHref: ACSS_SHEET },
        { name: "--btn-padding-x", value: "1rem", stylesheetHref: ACSS_SHEET },
      ],
    });
    b.setHandler("styles", "listVariables", () => ({}));
    const client = await connectedClient(b);
    const out = await call(client, "etch_tokens", { filter: "acss" });
    const byName = Object.fromEntries(out.result.map((t: any) => [t.name, t.namespace]));
    expect(byName["--space-m"]).toBe("spacing");
    expect(byName["--btn-padding-x"]).toBe("component");
  });

  test("filter etch returns only registry variables", async () => {
    const client = await connectedClient(tokenBridge());
    const out = await call(client, "etch_tokens", { filter: "etch" });
    const names = out.result.map((t: any) => t.name).sort();
    expect(names).toEqual(["--etch-reg", "--space-m"]);
  });
});
