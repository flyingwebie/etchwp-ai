import { describe, expect, test } from "bun:test";
import { transformPattern } from "../../src/pattern/transform.ts";

describe("transformPattern", () => {
  test("hero pattern: elements, text children, classes stripped into attachments", () => {
    const plan = transformPattern(
      `<section class="hero">
         <h2 class="hero__title">Hello Etch</h2>
         <p>Built by AI</p>
       </section>`,
      `.hero { background: var(--bg-dark); }
       .hero__title { color: var(--primary); }`,
    );
    expect(plan.blocks).toHaveLength(1);
    const section = plan.blocks[0] as any;
    expect(section.type).toBe("etch/element");
    expect(section.tag).toBe("section");
    expect(section.version).toBe(1);
    expect(section.context).toEqual({ name: "section.hero" });
    expect(section.attributes.class).toBeUndefined();
    const h2 = section.children[0];
    expect(h2.tag).toBe("h2");
    expect(h2.children[0]).toMatchObject({ type: "etch/text", text: "Hello Etch" });
    const p = section.children[1];
    expect(p.children[0]).toMatchObject({ type: "etch/text", text: "Built by AI" });
    expect(plan.styles).toEqual([
      { selector: ".hero", css: "background:var(--bg-dark)" },
      { selector: ".hero__title", css: "color:var(--primary)" },
    ]);
    expect(plan.attachments).toEqual([
      { blockPath: [0], className: "hero" },
      { blockPath: [0, 0], className: "hero__title" },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  test("img maps to etch/element img; script/style/svg/comments skipped and reported; no raw-html ever", () => {
    const plan = transformPattern(
      `<div><img src="/x.png" alt="pic"><script>evil()</script><svg><path/></svg><!-- note --></div>`,
      "",
    );
    const div = plan.blocks[0] as any;
    expect(div.children).toHaveLength(1);
    expect(div.children[0]).toMatchObject({
      type: "etch/element",
      tag: "img",
      attributes: { src: "/x.png", alt: "pic" },
    });
    const reasons = plan.skipped.map((s) => s.node).sort();
    expect(reasons).toEqual(["comment", "script", "svg"]);
    expect(JSON.stringify(plan)).not.toContain("raw-html");
  });

  test("duplicate selectors merge locally (upstream behavior undocumented)", () => {
    const plan = transformPattern(
      "<div class='a'>x</div>",
      ".a { color: red; } .a { font-size: 1rem; }",
    );
    expect(plan.styles).toEqual([{ selector: ".a", css: "color:red;font-size:1rem" }]);
  });

  test("unparseable CSS yields E_VALIDATION with zero plan output", () => {
    expect(() => transformPattern("<div>x</div>", ".a { color: }")).toThrow(
      expect.objectContaining({ code: "E_VALIDATION" }),
    );
  });

  test("empty/element-free HTML yields E_VALIDATION", () => {
    expect(() => transformPattern("   ", "")).toThrow(
      expect.objectContaining({ code: "E_VALIDATION" }),
    );
  });

  test("clean tokenized + BEM pattern yields empty findings (additive, non-breaking)", () => {
    const plan = transformPattern(
      `<section class="hero"><h2 class="hero__title">Hi</h2></section>`,
      `.hero { background: var(--bg-dark); padding: var(--space-l); }
       .hero__title { color: var(--primary); }`,
    );
    expect(plan.bemFindings).toEqual([]);
    expect(plan.tokenFindings).toEqual([]);
  });

  test("hardcoded values and bad BEM populate findings", () => {
    const plan = transformPattern(
      `<section class="Hero"><h2 class="hero__title--big">Hi</h2></section>`,
      `.Hero { padding: 20px; color: #ff0000; }`,
    );
    const bemClasses = plan.bemFindings.map((f) => f.className);
    expect(bemClasses).toContain("Hero");
    const token = plan.tokenFindings.find((f) => f.property === "padding");
    expect(token).toMatchObject({ selector: ".Hero", family: "spacing", value: "20px" });
    expect(token?.suggestion).toContain("--space");
    expect(plan.tokenFindings.some((f) => f.kind === "color")).toBe(true);
  });

  test("findings dedupe a class repeated across elements", () => {
    const plan = transformPattern(`<div class="Bad"><span class="Bad">x</span></div>`, "");
    expect(plan.bemFindings.filter((f) => f.className === "Bad")).toHaveLength(1);
  });
});
