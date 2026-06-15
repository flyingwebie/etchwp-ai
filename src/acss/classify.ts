/**
 * Token classification — shared by the `etch_tokens` tool (src/tools/styles.ts)
 * and the live export script (scripts/export-tokens.ts). Pure: no bridge, no I/O.
 *
 * Classification is by STYLESHEET ORIGIN, never by prefix — ACSS color palettes
 * are renameable in the dashboard, so a name-prefix list can never be complete
 * (see .do-it/research/acss-variables.md). The namespace field is best-effort
 * display metadata only.
 */
import type { RootVariable } from "../bridge/types.ts";
import { namespaceFor } from "./prefixes.ts";

export interface ClassifiedToken {
  name: string;
  value: string;
  source: "etch" | "computed";
  classification: "acss" | "etch" | "custom";
  namespace?: string;
  stylesheetHref?: string | null;
}

/**
 * Merge a computed `:root` snapshot with the Etch variable registry and classify
 * each token. Etch-registered variables win on a name collision (they are the
 * authored design tokens). A computed variable is `acss` iff its owning
 * stylesheet matches `acssPattern`; everything else non-etch is `custom`.
 */
export function classifyTokens(
  computed: RootVariable[],
  registry: Record<string, string>,
  acssPattern: RegExp,
): ClassifiedToken[] {
  const tokens = new Map<string, ClassifiedToken>();
  for (const v of computed) {
    const isAcss = v.stylesheetHref ? acssPattern.test(v.stylesheetHref) : false;
    tokens.set(v.name, {
      name: v.name,
      value: v.value,
      source: "computed",
      classification: isAcss ? "acss" : "custom",
      namespace: isAcss ? namespaceFor(v.name) : undefined,
      stylesheetHref: v.stylesheetHref,
    });
  }
  for (const [name, value] of Object.entries(registry)) {
    tokens.set(name, { name, value, source: "etch", classification: "etch" });
  }
  return [...tokens.values()];
}

/**
 * Normalize a CSS value for value→token matching: trims, lowercases, and folds
 * every zero-length spelling (`0px`/`0rem`/`0%`/`0.0`) to a bare `0` so a
 * hardcoded `0px` resolves against a token whose value is `0`.
 */
export function normalizeValue(value: string): string {
  const v = value.trim().toLowerCase();
  if (/^0(?:\.0+)?(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex)?$/.test(v)) return "0";
  return v;
}

/**
 * Reverse index from a token's value to the token name(s) that hold it, used for
 * EXACT live suggestions ("1.5rem → --space-m"). Only design-system tokens
 * (`acss` / `etch`) are indexed; `custom` site/theme vars are not substitution
 * targets. A value may map to several tokens (e.g. `--space-m` and `--h6`), so
 * the value maps to an ordered, de-duplicated list.
 */
export function buildValueIndex(tokens: ClassifiedToken[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const t of tokens) {
    if (t.classification === "custom") continue;
    if (!t.value) continue;
    const key = normalizeValue(t.value);
    const names = index.get(key) ?? [];
    if (!names.includes(t.name)) names.push(t.name);
    index.set(key, names);
  }
  return index;
}
