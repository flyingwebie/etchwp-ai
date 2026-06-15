import { describe, expect, test } from "bun:test";
import { allOperations, ETCH_ALLOWLIST } from "../src/bridge/allowlist.ts";
import { OPS_MANIFEST } from "../src/ops-manifest.ts";

describe("API coverage gate (PRD §6.3-3)", () => {
  test("every documented op is mapped to a tool — zero unmapped rows", () => {
    const unmapped = allOperations().filter(
      ({ domain, method }) => !OPS_MANIFEST[domain]?.[method],
    );
    expect(unmapped).toEqual([]);
    expect(allOperations().length).toBe(85);
  });

  test("the manifest references only documented ops (no phantom coverage)", () => {
    for (const [domain, methods] of Object.entries(OPS_MANIFEST)) {
      for (const method of Object.keys(methods)) {
        expect(
          ETCH_ALLOWLIST[domain]?.includes(method),
          `manifest maps unknown op ${domain}.${method}`,
        ).toBe(true);
      }
    }
  });
});
