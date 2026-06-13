/**
 * Pure lint helpers for Etch generation: BEM class-name validation and
 * hardcoded-value detection. No bridge, no I/O — these run inside the pure
 * transform (src/pattern/transform.ts) and produce FAMILY-LEVEL findings only.
 * Exact value→token resolution happens later at the tool layer with live tokens.
 */
import type { PropertyFamily } from "./tokens.ts";

// --------------------------------------------------------------------------
// BEM
// --------------------------------------------------------------------------

export type BemViolation =
  | "empty"
  | "uppercase"
  | "double-element"
  | "modifier-without-block"
  | "leading-trailing-separator"
  | "bad-separator"
  | "not-kebab-case";

export interface BemFinding {
  className: string;
  violations: BemViolation[];
}

/** A BEM segment: lowercase-kebab, alphanumeric words joined by single hyphens. */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Case-insensitive structural kebab — used to separate "uppercase" from "weird chars". */
const KEBAB_CI = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

/**
 * Validate a single class name against BEM (`block(__element)?(--modifier)?`,
 * lowercase-kebab). Returns null when valid — a bare single segment (`hero`,
 * `card`) is a valid block. Classes are only meaningfully BEM-checked when they
 * carry `__`/`--`; a plain block is accepted (no ACSS-utility name whitelist —
 * name lists are unreliable, per the origin-classification philosophy).
 */
export function lintBem(className: string): BemFinding | null {
  const name = className.trim();
  const v = new Set<BemViolation>();
  if (!name) return { className, violations: ["empty"] };
  if (/[A-Z]/.test(name)) v.add("uppercase");
  if ((name.match(/__/g)?.length ?? 0) > 1) v.add("double-element");

  // split modifier (first `--`), then element (first `__`).
  let base = name;
  const modIdx = name.indexOf("--");
  let modifier: string | null = null;
  if (modIdx !== -1) {
    base = name.slice(0, modIdx);
    modifier = name.slice(modIdx + 2);
    if (modifier.includes("--")) v.add("bad-separator"); // >1 modifier separator
    if (base === "") v.add("modifier-without-block");
  }
  let block = base;
  let element: string | null = null;
  const elIdx = base.indexOf("__");
  if (elIdx !== -1) {
    block = base.slice(0, elIdx);
    element = base.slice(elIdx + 2);
  }

  const checkSeg = (seg: string | null, isBlock: boolean) => {
    if (seg === null) return;
    if (seg === "") {
      // dangling separator: `hero__`, `hero--`, `--mod` (block "")
      if (!(isBlock && v.has("modifier-without-block"))) v.add("leading-trailing-separator");
      return;
    }
    if (seg.startsWith("-") || seg.endsWith("-")) v.add("leading-trailing-separator");
    if (seg.includes("_")) v.add("bad-separator"); // stray single underscore
    if (!KEBAB.test(seg) && KEBAB_CI.test(seg)) {
      // structurally fine but has uppercase — already covered by "uppercase".
    } else if (
      !KEBAB_CI.test(seg) &&
      !seg.includes("_") &&
      !seg.startsWith("-") &&
      !seg.endsWith("-")
    ) {
      v.add("not-kebab-case"); // invalid chars (., space, @, …)
    }
  };
  checkSeg(block, true);
  checkSeg(element, false);
  checkSeg(modifier, false);

  return v.size ? { className, violations: [...v] } : null;
}

// --------------------------------------------------------------------------
// Hardcoded values
// --------------------------------------------------------------------------

export type HardcodedKind = "color" | "length" | "shadow";

export interface HardcodedFinding {
  property: string;
  /** the offending literal substring (hex/length/raw color). */
  value: string;
  kind: HardcodedKind;
  family: PropertyFamily;
}

const COLOR_PROPS = new Set([
  "color",
  "background",
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "fill",
  "stroke",
  "text-decoration-color",
  "caret-color",
  "column-rule-color",
]);
const GAP_PROPS = new Set(["gap", "row-gap", "column-gap", "grid-gap"]);
const SPACING_PROPS = new Set([
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-block",
  "padding-inline",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block",
  "margin-inline",
]);
const RADIUS_PROPS = new Set([
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
]);
const WIDTH_PROPS = new Set(["width", "min-width", "max-width"]);
const BORDER_WIDTH_PROPS = new Set([
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
]);

/** Words that are valid bare CSS keywords, never flagged as hardcoded colors. */
const SKIP_KEYWORDS = new Set([
  "auto",
  "inherit",
  "initial",
  "unset",
  "revert",
  "none",
  "transparent",
  "currentcolor",
  "0",
]);

/** A small set of common named colors (full list is large; these cover real usage). */
const NAMED_COLORS = new Set([
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "purple",
  "pink",
  "brown",
  "white",
  "black",
  "gray",
  "grey",
  "silver",
  "gold",
  "navy",
  "teal",
  "aqua",
  "cyan",
  "magenta",
  "lime",
  "maroon",
  "olive",
  "fuchsia",
  "indigo",
  "violet",
  "coral",
  "salmon",
  "khaki",
  "crimson",
  "tomato",
  "tan",
  "beige",
]);

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const COLOR_FN = /\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\s*\(/i;
const LENGTH = /(?<![\w.-])(\d*\.?\d+)(px|rem|em)\b/gi;
const VAR_CALL = /var\([^()]*\)/g;

/** Remove `var(--…)` (and simple fallbacks) so tokenized parts aren't scanned. */
function stripVars(value: string): string {
  let prev = value;
  let next = value.replace(VAR_CALL, " ");
  while (next !== prev) {
    prev = next;
    next = next.replace(VAR_CALL, " ");
  }
  return next;
}

function firstColorLiteral(s: string): string | null {
  const hex = s.match(HEX);
  if (hex) return hex[0];
  const fn = s.match(COLOR_FN);
  if (fn) {
    const tail = s.slice(fn.index ?? 0).split(/\s/)[0];
    return tail && tail.length > 0 ? tail : fn[0];
  }
  for (const word of s.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (NAMED_COLORS.has(word) && !SKIP_KEYWORDS.has(word)) return word;
  }
  return null;
}

function firstNonZeroLength(s: string): string | null {
  for (const m of s.matchAll(LENGTH)) {
    const num = m[1];
    if (num !== undefined && Number.parseFloat(num) !== 0) return m[0];
  }
  return null;
}

/**
 * Scan one declaration's value for hardcoded literals that should be ACSS tokens.
 * Returns [] when the value is fully tokenized / an allowed keyword / a property
 * we don't police. Deterministic: driven by property + value-shape, no heuristics.
 */
export function findHardcodedValues(property: string, value: string): HardcodedFinding[] {
  const prop = property.trim().toLowerCase();
  const raw = value.trim();
  const low = raw.toLowerCase();
  if (!raw || SKIP_KEYWORDS.has(low)) return [];

  const s = stripVars(raw);
  const out: HardcodedFinding[] = [];

  if (prop === "box-shadow") {
    const color = firstColorLiteral(s);
    if (color) out.push({ property: prop, value: color, kind: "shadow", family: "shadow" });
    return out;
  }

  if (COLOR_PROPS.has(prop)) {
    const color = firstColorLiteral(s);
    if (color) out.push({ property: prop, value: color, kind: "color", family: "color" });
    return out;
  }

  // length-bearing properties — skip inside calc() (intentional math).
  if (s.includes("calc(")) return out;
  let family: PropertyFamily | null = null;
  if (GAP_PROPS.has(prop)) family = "gap";
  else if (SPACING_PROPS.has(prop)) family = "spacing";
  else if (prop === "font-size") family = "font-size";
  else if (RADIUS_PROPS.has(prop)) family = "radius";
  else if (WIDTH_PROPS.has(prop)) family = "width";
  else if (BORDER_WIDTH_PROPS.has(prop)) family = "border";
  if (!family) return out;

  const len = firstNonZeroLength(s);
  if (len) out.push({ property: prop, value: len, kind: "length", family });
  return out;
}

/** Human-readable family-level suggestion (static; no exact token). */
export function familySuggestion(family: PropertyFamily): string {
  switch (family) {
    case "color":
      return "use an ACSS color token (e.g. var(--primary), var(--text), var(--base))";
    case "spacing":
      return "use an ACSS spacing token (e.g. var(--space-m))";
    case "gap":
      return "use an ACSS spacing/gap token (e.g. var(--space-s), var(--grid-gap))";
    case "font-size":
      return "use an ACSS text/heading token (e.g. var(--text-m), var(--h2))";
    case "radius":
      return "use the ACSS radius token (var(--radius))";
    case "width":
      return "use an ACSS width token (e.g. var(--content-width), var(--width-50))";
    case "border":
      return "use the ACSS border token (var(--border) / var(--border-size))";
    case "shadow":
      return "use an ACSS shadow token (e.g. var(--box-shadow-1))";
    case "transition":
      return "use the ACSS transition token (var(--transition))";
  }
}
