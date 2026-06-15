/**
 * Static catalog of Automatic.css (ACSS) v4 DEFAULT variable names, grouped by
 * category. This is the offline/default-name half of the token story; the live
 * per-site values come from `etch_tokens` / `scripts/export-tokens.ts` (classified
 * by stylesheet origin). Sites can rename palettes and reconfigure scales, so:
 *
 *   - Names here are the v4 DEFAULTS. `isKnownAcssToken` is therefore advisory:
 *     a `false` means "not a default ACSS name", not "invalid".
 *   - `defaultValue` is ADVISORY (rough v4 default) and is used ONLY by
 *     `emitRootFallbackCss`. It is never used for value→token matching — exact
 *     matching uses the LIVE values via `buildValueIndex` (see classify.ts).
 *
 * Transcribed from docs.automaticcss.com (v4 current) + .do-it/research/acss-variables.md.
 */

export type AcssCategory =
  | "color"
  | "spacing"
  | "typography"
  | "width"
  | "radius"
  | "border"
  | "shadow"
  | "grid"
  | "transition";

export type Confidence = "high" | "medium";

/** CSS property families a token can legitimately substitute for (drives suggestions). */
export type PropertyFamily =
  | "color"
  | "spacing"
  | "font-size"
  | "radius"
  | "border"
  | "shadow"
  | "width"
  | "gap"
  | "transition";

export interface AcssTokenDef {
  /** includes the leading `--`. */
  name: string;
  category: AcssCategory;
  /** ADVISORY rough v4 default; emitter-only, never used for matching. */
  defaultValue?: string;
  confidence: Confidence;
  /** empty = known token but not a value-substitution target (e.g. HSL channels, grid templates). */
  propertyFamilies: PropertyFamily[];
}

// --- generators ------------------------------------------------------------

const COLOR_SLOTS = [
  "primary",
  "secondary",
  "tertiary",
  "accent",
  "base",
  "neutral",
  "success",
  "danger",
  "warning",
  "info",
] as const;
const SHADES = ["ultra-light", "light", "semi-light", "semi-dark", "dark", "ultra-dark"] as const;
const CHANNELS = ["h", "s", "l"] as const;

/** Standard t-shirt order, smallest → largest. `xxl` and `2xl` are BOTH emitted
 * (medium): the research file uses `xxl`, the live generation skill uses `2xl`. */
const SIZES_HIGH = ["xs", "s", "m", "l", "xl"] as const;
const SIZES_TOP = ["xxl", "2xl"] as const; // medium — version/config dependent spelling

const SPACE_DEFAULTS: Record<string, string> = {
  xs: "0.5rem",
  s: "1rem",
  m: "1.5rem",
  l: "2rem",
  xl: "3rem",
  xxl: "4rem",
  "2xl": "4rem",
};
const TEXT_DEFAULTS: Record<string, string> = {
  xs: "0.75rem",
  s: "0.875rem",
  m: "1rem",
  l: "1.25rem",
  xl: "1.5rem",
  xxl: "2rem",
  "2xl": "2rem",
};
const HEADING_DEFAULTS: Record<string, string> = {
  h1: "3rem",
  h2: "2.4rem",
  h3: "1.9rem",
  h4: "1.5rem",
  h5: "1.2rem",
  h6: "1rem",
};

function build(): AcssTokenDef[] {
  const out: AcssTokenDef[] = [];
  const add = (
    name: string,
    category: AcssCategory,
    propertyFamilies: PropertyFamily[],
    confidence: Confidence = "high",
    defaultValue?: string,
  ) => out.push({ name, category, propertyFamilies, confidence, defaultValue });

  // ---- color ----
  for (const slot of COLOR_SLOTS) {
    add(`--${slot}`, "color", ["color"]);
    add(`--${slot}-hover`, "color", ["color"]);
    add(`--${slot}-clr`, "color", ["color"]); // full hsl() string
    for (const shade of SHADES) add(`--${slot}-${shade}`, "color", ["color"]);
    // HSL channels: known, but not a direct color substitute → no families.
    for (const ch of CHANNELS) add(`--${slot}-${ch}`, "color", [], "medium");
  }
  for (const n of ["--white", "--black", "--shade"]) add(n, "color", ["color"]);
  // contextual / assignment-based (renameable in the dashboard) → medium.
  for (const n of [
    "--bg-light",
    "--bg-ultra-light",
    "--bg-dark",
    "--bg-ultra-dark",
    "--text",
    "--text-color",
    "--surface",
    "--heading-color",
    "--body-bg-color",
    "--body-color",
  ]) {
    add(n, "color", ["color"], "medium");
  }

  // ---- spacing ----
  for (const sz of SIZES_HIGH) {
    add(`--space-${sz}`, "spacing", ["spacing", "gap"], "high", SPACE_DEFAULTS[sz]);
    add(`--section-space-${sz}`, "spacing", ["spacing"]);
  }
  for (const sz of SIZES_TOP) {
    add(`--space-${sz}`, "spacing", ["spacing", "gap"], "medium", SPACE_DEFAULTS[sz]);
    add(`--section-space-${sz}`, "spacing", ["spacing"], "medium");
  }
  // fluid bridge spacing (larger→smaller); spelling/exact set is version dependent → medium.
  for (const top of [
    ["xs", "s", "m", "l", "xl", "xxl"],
    ["xs", "s", "m", "l", "xl", "2xl"],
  ]) {
    for (let i = top.length - 1; i >= 0; i--) {
      for (let j = i - 1; j >= 0; j--) {
        add(`--space-${top[i]}-to-${top[j]}`, "spacing", ["spacing", "gap"], "medium");
      }
    }
  }
  add("--gutter", "spacing", ["spacing"]);
  add("--content-gap", "spacing", ["spacing", "gap"]);
  add("--grid-gap", "spacing", ["gap"]);
  add("--gap", "spacing", ["gap"]);

  // ---- typography ----
  for (const sz of SIZES_HIGH)
    add(`--text-${sz}`, "typography", ["font-size"], "high", TEXT_DEFAULTS[sz]);
  for (const sz of SIZES_TOP)
    add(`--text-${sz}`, "typography", ["font-size"], "medium", TEXT_DEFAULTS[sz]);
  const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
  for (const h of HEADINGS) add(`--${h}`, "typography", ["font-size"], "high", HEADING_DEFAULTS[h]);
  // heading fluid bridges (larger→smaller; h1 is largest).
  for (let i = 0; i < HEADINGS.length; i++) {
    for (let j = i + 1; j < HEADINGS.length; j++) {
      add(`--${HEADINGS[i]}-to-${HEADINGS[j]}`, "typography", ["font-size"], "medium");
    }
  }
  add("--heading-font-family", "typography", []);
  add("--root-font-size", "typography", []);
  add("--heading-line-height", "typography", [], "medium");

  // ---- width ----
  add("--content-width", "width", ["width"], "high", "1140px");
  add("--content-width-safe", "width", ["width"]);
  for (let w = 10; w <= 90; w += 10) add(`--width-${w}`, "width", ["width"]);

  // ---- radius ----
  add("--radius", "radius", ["radius"], "high", "0.5rem");
  add("--radius-m", "radius", ["radius"], "medium");
  add("--card-radius", "radius", ["radius"]);
  add("--btn-radius", "radius", ["radius"]);

  // ---- border ----
  add("--border", "border", ["border"]);
  add("--border-size", "border", ["border"], "medium");

  // ---- shadow (configurable count/names) → medium ----
  for (let s = 1; s <= 5; s++) add(`--box-shadow-${s}`, "shadow", ["shadow"], "medium");
  add("--card-shadow", "shadow", ["shadow"], "medium");

  // ---- grid (template values; not scanned substitutes) ----
  for (let g = 1; g <= 12; g++) add(`--grid-${g}`, "grid", []);
  for (const u of ["1-2", "2-1", "1-3", "3-1", "2-3", "3-2"]) add(`--grid-${u}`, "grid", []);
  add("--columns", "grid", []);

  // ---- transition ----
  add("--transition", "transition", ["transition"]);
  for (const t of ["duration", "timing", "delay"])
    add(`--transition-${t}`, "transition", ["transition"]);

  // dedupe by name (the two bridge size-lists overlap on non-top pairs); keep first.
  const seen = new Set<string>();
  return out.filter((t) => !seen.has(t.name) && seen.add(t.name));
}

export const ACSS_TOKEN_CATALOG: readonly AcssTokenDef[] = Object.freeze(build());

const NAME_SET: ReadonlySet<string> = new Set(ACSS_TOKEN_CATALOG.map((t) => t.name));

/** True iff `name` is a v4 DEFAULT ACSS variable name (advisory — sites rename). */
export function isKnownAcssToken(name: string): boolean {
  return NAME_SET.has(name);
}

export function tokensByCategory(category: AcssCategory): readonly AcssTokenDef[] {
  return ACSS_TOKEN_CATALOG.filter((t) => t.category === category);
}

/** Tokens that can substitute for a hardcoded value in the given property family. */
export function tokensForProperty(family: PropertyFamily): readonly AcssTokenDef[] {
  return ACSS_TOKEN_CATALOG.filter((t) => t.propertyFamilies.includes(family));
}

/**
 * Emit a `:root { … }` fallback stylesheet of the catalog. ADVISORY scaffold:
 * tokens with a default value are emitted as declarations; the rest as commented
 * placeholders. Medium-confidence tokens get an inline `/* medium *\/` note.
 */
export function emitRootFallbackCss(opts: { includeMedium?: boolean } = {}): string {
  const includeMedium = opts.includeMedium ?? true;
  const lines: string[] = [
    ":root {",
    "  /* ACSS v4 default-name scaffold — ADVISORY ONLY. Your ACSS install is the",
    "     source of truth; values here are rough defaults, not authoritative. */",
  ];
  let lastCategory = "";
  for (const t of ACSS_TOKEN_CATALOG) {
    if (t.confidence === "medium" && !includeMedium) continue;
    if (t.category !== lastCategory) {
      lines.push(`  /* ${t.category} */`);
      lastCategory = t.category;
    }
    const note = t.confidence === "medium" ? " /* medium */" : "";
    if (t.defaultValue) lines.push(`  ${t.name}: ${t.defaultValue};${note}`);
    else lines.push(`  /* ${t.name}: <set in ACSS>; */${note}`);
  }
  lines.push("}");
  return lines.join("\n");
}
