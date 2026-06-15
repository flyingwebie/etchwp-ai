import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockBridge } from "../src/bridge/mock.ts";
import { loadConfig } from "../src/config.ts";
import { buildServer } from "../src/server.ts";

const CORE_TOOLS = [
  "etch_status",
  "etch_save",
  "etch_blocks_read",
  "etch_blocks_write",
  "etch_styles_read",
  "etch_styles_write",
  "etch_tokens",
  "etch_stylesheets_read",
  "etch_stylesheets_write",
  "etch_components_read",
  "etch_components_write",
  "etch_loops_read",
  "etch_loops_write",
  "etch_fields_read",
  "etch_fields_write",
  "etch_nav",
  "etch_ui",
  "etch_history",
  "etch_screenshot",
  "etch_insert_pattern",
];

function depthOf(schema: unknown, level = 0): number {
  if (!schema || typeof schema !== "object") return level;
  let max = level;
  for (const v of Object.values(schema as Record<string, unknown>)) {
    if (v && typeof v === "object") max = Math.max(max, depthOf(v, level + 1));
  }
  return max;
}

describe("tool schema lint (OpenAI compatibility, PRD §4.4)", () => {
  async function allTools(env: Record<string, string> = {}) {
    const { server } = buildServer({ bridge: new MockBridge(), config: loadConfig(env) });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "lint", version: "0" });
    await Promise.all([client.connect(ct), server.connect(st)]);
    return (await client.listTools()).tools;
  }

  test("exactly the 20 core tools without sidecar env; 22 with", async () => {
    const core = await allTools();
    expect(core.map((t) => t.name).sort()).toEqual([...CORE_TOOLS].sort());
    const withSidecar = await allTools({
      WP_BASE_URL: "https://x.test",
      WP_APP_USER: "u",
      WP_APP_PASSWORD: "p",
    });
    expect(withSidecar.length).toBe(22);
  });

  test("no top-level unions; parameter nesting depth ≤ 5; every tool has a description", async () => {
    for (const tool of await allTools()) {
      const schema = tool.inputSchema as Record<string, unknown>;
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
      for (const k of ["oneOf", "anyOf", "allOf"]) {
        expect(schema[k], `${tool.name} has top-level ${k}`).toBeUndefined();
        const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
        for (const [pname, p] of Object.entries(props)) {
          expect(p[k], `${tool.name}.${pname} has ${k}`).toBeUndefined();
        }
      }
      const d = depthOf((schema.properties ?? {}) as Record<string, unknown>);
      expect(d, `${tool.name} schema too deep (${d})`).toBeLessThanOrEqual(5);
    }
  });
});
