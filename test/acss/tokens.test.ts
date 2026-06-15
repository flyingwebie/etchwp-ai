import { describe, expect, test } from "bun:test";
import {
  ACSS_TOKEN_CATALOG,
  emitRootFallbackCss,
  isKnownAcssToken,
  tokensByCategory,
  tokensForProperty,
} from "../../src/acss/tokens.ts";

describe("acss token catalog", () => {
  test("every token name starts with -- and is unique", () => {
    const names = ACSS_TOKEN_CATALOG.map((t) => t.name);
    expect(names.every((n) => n.startsWith("--"))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  test("full color ramp per slot: base, hover, clr, 6 shades, 3 channels", () => {
    for (const slot of ["primary", "base", "danger"]) {
      for (const suffix of [
        "",
        "-hover",
        "-clr",
        "-ultra-light",
        "-ultra-dark",
        "-h",
        "-s",
        "-l",
      ]) {
        expect(isKnownAcssToken(`--${slot}${suffix}`)).toBe(true);
      }
    }
  });

  test("isKnownAcssToken: known true, unknown false", () => {
    expect(isKnownAcssToken("--space-m")).toBe(true);
    expect(isKnownAcssToken("--text-l")).toBe(true);
    expect(isKnownAcssToken("--radius")).toBe(true);
    expect(isKnownAcssToken("--width-50")).toBe(true);
    expect(isKnownAcssToken("--nope")).toBe(false);
    expect(isKnownAcssToken("--space-xxxl")).toBe(false);
  });

  test("both xxl and 2xl spellings are accepted (naming-conflict guard)", () => {
    expect(isKnownAcssToken("--space-xxl")).toBe(true);
    expect(isKnownAcssToken("--space-2xl")).toBe(true);
    expect(isKnownAcssToken("--text-xxl")).toBe(true);
    expect(isKnownAcssToken("--text-2xl")).toBe(true);
  });

  test("tokensForProperty returns substitutes for the family, excludes others", () => {
    const spacing = tokensForProperty("spacing").map((t) => t.name);
    expect(spacing).toContain("--space-m");
    expect(spacing.some((n) => n.startsWith("--primary"))).toBe(false);
    const colors = tokensForProperty("color").map((t) => t.name);
    expect(colors).toContain("--primary");
    expect(colors).not.toContain("--space-m");
    // HSL channels are known but not substitution targets.
    expect(colors).not.toContain("--primary-h");
  });

  test("contextual colors + box-shadow flagged medium confidence", () => {
    const medium = new Set(
      ACSS_TOKEN_CATALOG.filter((t) => t.confidence === "medium").map((t) => t.name),
    );
    expect(medium.has("--surface")).toBe(true);
    expect(medium.has("--body-color")).toBe(true);
    expect(medium.has("--box-shadow-3")).toBe(true);
    expect(medium.has("--space-2xl")).toBe(true);
    // high-confidence staples are not medium
    expect(medium.has("--space-m")).toBe(false);
    expect(medium.has("--primary")).toBe(false);
  });

  test("tokensByCategory partitions the catalog", () => {
    expect(tokensByCategory("radius").map((t) => t.name)).toContain("--radius");
    expect(tokensByCategory("grid").map((t) => t.name)).toContain("--grid-3");
  });

  test("emitRootFallbackCss is a valid :root block and annotates medium tokens", () => {
    const css = emitRootFallbackCss();
    expect(css.startsWith(":root {")).toBe(true);
    expect(css.trim().endsWith("}")).toBe(true);
    expect(css).toContain("--space-m: 1.5rem;");
    expect(css).toContain("/* medium */");
    // excluding medium drops them
    const highOnly = emitRootFallbackCss({ includeMedium: false });
    expect(highOnly).not.toContain("/* medium */");
    expect(highOnly).toContain("--space-m: 1.5rem;");
  });
});
