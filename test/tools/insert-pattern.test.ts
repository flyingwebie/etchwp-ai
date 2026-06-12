import { describe, expect, test } from "bun:test";
import { MockBridge } from "../../src/bridge/mock.ts";
import { call, connectedClient } from "../server.test.ts";

const HTML = `<section class="hero"><h2 class="hero__title">Hi</h2></section>`;
const CSS = `.hero { background: var(--bg-dark); } .hero__title { color: var(--primary); }`;

function rigged() {
  const b = new MockBridge();
  let styleN = 0;
  b.setHandler("styles", "create", () => `style-${++styleN}`);
  b.setHandler("blocks", "create", () => "root-1");
  b.setHandler("blocks", "getJson", () => ({
    id: "root-1",
    type: "etch/element",
    children: [
      {
        id: "h2-1",
        type: "etch/element",
        children: [{ id: "t-1", type: "etch/text", children: [] }],
      },
    ],
  }));
  b.setHandler("blocks", "addClass", () => undefined);
  return b;
}

describe("etch_insert_pattern", () => {
  test("happy path: styles → block tree → class attachments; manifest returned", async () => {
    const b = rigged();
    const client = await connectedClient(b);
    const out = await call(client, "etch_insert_pattern", {
      html: HTML,
      css: CSS,
      targetParentId: "parent-9",
    });
    expect(out.ok).toBe(true);
    expect(out.persistence).toBe("buffered");
    expect(out.result.createdStyles).toEqual({
      ".hero": "style-1",
      ".hero__title": "style-2",
    });
    expect(out.result.createdRootBlockIds).toEqual(["root-1"]);
    expect(out.result.attachments).toEqual([
      { blockId: "root-1", className: "hero", styleId: "style-1" },
      { blockId: "h2-1", className: "hero__title", styleId: "style-2" },
    ]);
    expect(out.dirty.page).toBeGreaterThan(0);
    const sequence = b.calls.map((c) => `${c.domain}.${c.method}`);
    expect(sequence).toEqual([
      "styles.create",
      "styles.create",
      "blocks.create",
      "blocks.getJson",
      "blocks.addClass",
      "blocks.addClass",
    ]);
    const createArgs = b.calls[2]?.args as unknown[];
    expect(createArgs[1]).toBe("parent-9");
    expect(JSON.stringify(createArgs[0])).not.toContain('"styles"');
  });

  test("validation failure issues ZERO bridge calls", async () => {
    const b = rigged();
    const client = await connectedClient(b);
    const out = await call(client, "etch_insert_pattern", { html: "  ", css: "" });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("E_VALIDATION");
    expect(b.calls.length).toBe(0);
  });

  test("mid-orchestration failure returns partial manifest and recommends rollback", async () => {
    const b = rigged();
    b.setHandler("blocks", "create", () => {
      const e = new Error("denied") as Error & { code: string };
      e.code = "OPERATION_FAILED";
      throw e;
    });
    const client = await connectedClient(b);
    const out = await call(client, "etch_insert_pattern", { html: HTML, css: CSS });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("E_PATTERN_PARTIAL");
    expect(out.error.message).toContain("style-1");
    expect(out.error.remediation).toContain("rollback");
  });

  test("class without matching CSS rule is reported, not fatal", async () => {
    const b = rigged();
    const client = await connectedClient(b);
    const out = await call(client, "etch_insert_pattern", {
      html: `<div class="unstyled">x</div>`,
      css: "",
    });
    expect(out.ok).toBe(true);
    expect(out.result.unstyledClasses).toEqual(["unstyled"]);
    expect(out.result.attachments).toEqual([]);
  });
});
