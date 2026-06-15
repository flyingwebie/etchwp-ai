import { describe, expect, test } from "bun:test";
import { buildValueIndex, classifyTokens } from "../../src/acss/classify.ts";
import type { RootVariable } from "../../src/bridge/types.ts";

const ACSS = "https://site.com/wp-content/uploads/automatic-css/automatic.css";
const THEME = "https://site.com/wp-content/themes/custom/style.css";
const PATTERN = /automatic-?css/i;

describe("classifyTokens", () => {
  const computed: RootVariable[] = [
    { name: "--space-m", value: "1.5rem", stylesheetHref: ACSS },
    { name: "--action-hover", value: "#0af", stylesheetHref: ACSS }, // renamed palette
    { name: "--text-brand", value: "#333", stylesheetHref: THEME }, // ACSS-ish prefix, theme origin
    { name: "--my-var", value: "10px", stylesheetHref: null },
  ];

  test("classifies by stylesheet origin, not prefix", () => {
    const tokens = classifyTokens(computed, {}, PATTERN);
    const byName = Object.fromEntries(tokens.map((t) => [t.name, t]));
    expect(byName["--action-hover"]?.classification).toBe("acss"); // origin wins
    expect(byName["--text-brand"]?.classification).toBe("custom"); // theme sheet despite prefix
    expect(byName["--my-var"]?.classification).toBe("custom");
    expect(byName["--space-m"]?.namespace).toBe("spacing"); // metadata for acss
  });

  test("etch registry wins on name collision and is classified etch", () => {
    const tokens = classifyTokens(
      computed,
      { "--space-m": "SHADOW", "--etch-reg": "1px" },
      PATTERN,
    );
    const byName = Object.fromEntries(tokens.map((t) => [t.name, t]));
    expect(byName["--space-m"]?.source).toBe("etch");
    expect(byName["--space-m"]?.value).toBe("SHADOW");
    expect(byName["--space-m"]?.classification).toBe("etch");
    expect(byName["--etch-reg"]?.classification).toBe("etch");
  });
});

describe("buildValueIndex", () => {
  test("maps normalized values to design-system token names; skips custom", () => {
    const tokens = classifyTokens(
      [
        { name: "--space-m", value: "1.5rem", stylesheetHref: ACSS },
        { name: "--h6", value: "1.5rem", stylesheetHref: ACSS }, // shares a value
        { name: "--my-var", value: "1.5rem", stylesheetHref: THEME }, // custom, excluded
      ],
      {},
      PATTERN,
    );
    const index = buildValueIndex(tokens);
    expect(index.get("1.5rem")).toEqual(["--space-m", "--h6"]);
  });

  test("normalizes zero-length spellings to 0", () => {
    const tokens = classifyTokens(
      [{ name: "--gap-none", value: "0px", stylesheetHref: ACSS }],
      {},
      PATTERN,
    );
    expect(buildValueIndex(tokens).get("0")).toEqual(["--gap-none"]);
  });
});
