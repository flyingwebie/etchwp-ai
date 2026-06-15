import { describe, expect, test } from "bun:test";
import { findHardcodedValues, lintBem } from "../../src/acss/lint.ts";

describe("lintBem", () => {
  test("valid BEM returns null", () => {
    expect(lintBem("hero")).toBeNull();
    expect(lintBem("card")).toBeNull();
    expect(lintBem("hero__title")).toBeNull();
    expect(lintBem("card__media--featured")).toBeNull();
    expect(lintBem("nav__item--active")).toBeNull();
    expect(lintBem("hero-section")).toBeNull();
    expect(lintBem("col-2")).toBeNull();
  });

  test("uppercase is flagged", () => {
    expect(lintBem("Hero")?.violations).toContain("uppercase");
    expect(lintBem("heroTitle")?.violations).toContain("uppercase");
  });

  test("double-element (grandchild nesting) is flagged", () => {
    expect(lintBem("a__b__c")?.violations).toContain("double-element");
  });

  test("modifier without a block is flagged", () => {
    expect(lintBem("--mod")?.violations).toContain("modifier-without-block");
  });

  test("stray single underscore is a bad separator", () => {
    expect(lintBem("hero_title")?.violations).toContain("bad-separator");
  });

  test("dangling separators flagged", () => {
    expect(lintBem("hero__")?.violations).toContain("leading-trailing-separator");
    expect(lintBem("-hero")?.violations).toContain("leading-trailing-separator");
  });

  test("invalid characters are not-kebab-case", () => {
    expect(lintBem("hero.title")?.violations).toContain("not-kebab-case");
  });
});

describe("findHardcodedValues", () => {
  test("flags hardcoded colors on color properties", () => {
    expect(findHardcodedValues("color", "#fff")[0]).toMatchObject({
      kind: "color",
      family: "color",
    });
    expect(findHardcodedValues("background-color", "rgb(0,0,0)")[0]?.kind).toBe("color");
    expect(findHardcodedValues("color", "red")[0]?.value).toBe("red");
  });

  test("flags hardcoded lengths with the right family", () => {
    expect(findHardcodedValues("padding", "16px")[0]).toMatchObject({
      kind: "length",
      family: "spacing",
      value: "16px",
    });
    expect(findHardcodedValues("gap", "1rem")[0]?.family).toBe("gap");
    expect(findHardcodedValues("font-size", "1.5rem")[0]?.family).toBe("font-size");
    expect(findHardcodedValues("border-radius", "8px")[0]?.family).toBe("radius");
    expect(findHardcodedValues("max-width", "1200px")[0]?.family).toBe("width");
    expect(findHardcodedValues("border-width", "2px")[0]?.family).toBe("border");
  });

  test("flags a raw-colored box-shadow as shadow", () => {
    expect(findHardcodedValues("box-shadow", "0 4px 24px #0003")[0]?.family).toBe("shadow");
  });

  test("skips tokenized and allowed values", () => {
    expect(findHardcodedValues("padding", "var(--space-m)")).toEqual([]);
    expect(findHardcodedValues("color", "var(--primary)")).toEqual([]);
    expect(findHardcodedValues("padding", "0")).toEqual([]);
    expect(findHardcodedValues("padding", "0px")).toEqual([]);
    expect(findHardcodedValues("width", "100%")).toEqual([]);
    expect(findHardcodedValues("width", "auto")).toEqual([]);
    expect(findHardcodedValues("border-radius", "50%")).toEqual([]);
    expect(findHardcodedValues("color", "inherit")).toEqual([]);
    expect(findHardcodedValues("color", "transparent")).toEqual([]);
  });

  test("skips structural / sanctioned patterns", () => {
    expect(findHardcodedValues("grid-template-columns", "repeat(3, 1fr)")).toEqual([]);
    expect(findHardcodedValues("aspect-ratio", "16 / 9")).toEqual([]);
    expect(findHardcodedValues("line-height", "1.5")).toEqual([]);
    expect(findHardcodedValues("padding", "calc(var(--space-m) + 2px)")).toEqual([]);
    expect(
      findHardcodedValues("background", "color-mix(in oklch, var(--primary) 20%, transparent)"),
    ).toEqual([]);
  });

  test("box-shadow fully tokenized is not flagged", () => {
    expect(findHardcodedValues("box-shadow", "var(--box-shadow-1)")).toEqual([]);
  });
});
