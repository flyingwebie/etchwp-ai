import { describe, expect, test } from "bun:test";
import { allOperations, assertAllowed, ETCH_ALLOWLIST } from "../../src/bridge/allowlist.ts";

describe("allowlist", () => {
  test("allows documented operations", () => {
    expect(() => assertAllowed("blocks", "create")).not.toThrow();
    expect(() => assertAllowed("root", "saveAsync")).not.toThrow();
    expect(() => assertAllowed("ui", "exitToWordPress")).not.toThrow();
    expect(() => assertAllowed("fields", "setValuesAsync")).not.toThrow();
  });

  test("rejects unknown methods and domains with E_VALIDATION", () => {
    expect(() => assertAllowed("blocks", "evilMethod")).toThrow(
      expect.objectContaining({ code: "E_VALIDATION" }),
    );
    expect(() => assertAllowed("evil", "anything")).toThrow(
      expect.objectContaining({ code: "E_VALIDATION" }),
    );
  });

  test("rejects prototype-pollution shaped names", () => {
    expect(() => assertAllowed("__proto__", "constructor")).toThrow();
    expect(() => assertAllowed("blocks", "__proto__")).toThrow();
    expect(() => assertAllowed("blocks", "constructor")).toThrow();
  });

  test("covers all nine namespaces plus root", () => {
    expect(Object.keys(ETCH_ALLOWLIST).sort()).toEqual(
      [
        "blocks",
        "components",
        "fields",
        "history",
        "loops",
        "navigation",
        "root",
        "styles",
        "stylesheets",
        "ui",
      ].sort(),
    );
  });

  test("operation counts match the api-map", () => {
    const counts = Object.fromEntries(
      Object.entries(ETCH_ALLOWLIST).map(([d, ms]) => [d, ms.length]),
    );
    expect(counts).toEqual({
      root: 1,
      blocks: 24,
      styles: 8,
      stylesheets: 8,
      components: 5,
      loops: 6,
      navigation: 9,
      fields: 13,
      ui: 7,
      history: 4,
    });
    expect(allOperations().length).toBe(85);
  });
});
