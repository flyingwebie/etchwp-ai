import { describe, expect, test } from "bun:test";
import { runExport, serializeTokens } from "../../scripts/export-tokens.ts";
import { MockBridge } from "../../src/bridge/mock.ts";
import { loadConfig } from "../../src/config.ts";

const ACSS = "https://site.com/wp-content/uploads/automatic-css/automatic.css";

function exportBridge() {
  const b = new MockBridge({
    rootVariables: [
      { name: "--space-m", value: "1.5rem", stylesheetHref: ACSS },
      { name: "--my-var", value: "10px", stylesheetHref: null },
    ],
  });
  b.setHandler("styles", "listVariables", () => ({ "--etch-reg": "1px" }));
  return b;
}

describe("runExport", () => {
  test("acss filter exports only origin-classified ACSS tokens (json)", async () => {
    const out = await runExport(exportBridge(), loadConfig({}), { format: "json", filter: "acss" });
    const tokens = JSON.parse(out);
    expect(tokens.map((t: { name: string }) => t.name)).toEqual(["--space-m"]);
    expect(tokens[0].classification).toBe("acss");
  });

  test("all filter includes etch + custom", async () => {
    const out = await runExport(exportBridge(), loadConfig({}), { format: "json", filter: "all" });
    const names = JSON.parse(out)
      .map((t: { name: string }) => t.name)
      .sort();
    expect(names).toEqual(["--etch-reg", "--my-var", "--space-m"]);
  });
});

describe("serializeTokens", () => {
  const tokens = [
    {
      name: "--space-m",
      value: "1.5rem",
      source: "computed" as const,
      classification: "acss" as const,
    },
  ];

  test("css format emits a :root block", () => {
    expect(serializeTokens(tokens, "css")).toBe(":root {\n  --space-m: 1.5rem;\n}\n");
  });

  test("ts format emits a typed const", () => {
    const ts = serializeTokens(tokens, "ts");
    expect(ts).toContain("export const LIVE_ACSS_TOKENS");
    expect(ts).toContain('"--space-m"');
  });

  test("json format round-trips", () => {
    expect(JSON.parse(serializeTokens(tokens, "json"))[0].name).toBe("--space-m");
  });
});
