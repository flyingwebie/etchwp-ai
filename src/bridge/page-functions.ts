/**
 * The fixed, server-shipped functions evaluated in the builder page.
 * These are the ONLY code that runs in the page (PRD §4.2 rule 2):
 * the eval wrapper invokes allowlisted window.etch methods with data-only
 * args, and readRootVariables is a parameterless read-only snapshot.
 */

export interface PageEvalResult {
  ok: boolean;
  value?: unknown;
  code?: string;
  message?: string;
}

/** Invoke window.etch.<domain>.<method>(...args) inside the page. */
export const EVAL_WRAPPER = (input: { domain: string; method: string; args: unknown[] }) => {
  const w = window as unknown as { etch?: Record<string, any> & ((...a: never) => unknown) };
  const fail = (code: string, message: string) => ({ ok: false, code, message });
  try {
    if (!w.etch) return fail("E_NO_ETCH", "window.etch is not present on this page");
    const target = input.domain === "root" ? w.etch : w.etch[input.domain];
    const fn = target?.[input.method];
    if (typeof fn !== "function")
      return fail("E_FEATURE_MISSING", `etch.${input.domain}.${input.method} is not a function`);
    const out = fn.apply(target, input.args);
    return Promise.resolve(out).then(
      (value: unknown) => ({ ok: true, value: value === undefined ? null : value }),
      (e: any) =>
        fail(typeof e?.code === "string" ? e.code : "OPERATION_FAILED", String(e?.message ?? e)),
    );
  } catch (e: any) {
    return fail(typeof e?.code === "string" ? e.code : "OPERATION_FAILED", String(e?.message ?? e));
  }
};

/** True when window.etch exists (poll-after-navigation check). */
export const IS_AVAILABLE = () =>
  typeof (window as unknown as { etch?: unknown }).etch !== "undefined";

/**
 * Snapshot of :root custom properties with owning stylesheet hrefs.
 * Cross-origin sheets whose rules are unreadable are skipped; variables only
 * visible via computed style come back with stylesheetHref: null.
 */
export const READ_ROOT_VARIABLES = () => {
  const out: Array<{ name: string; value: string; stylesheetHref: string | null }> = [];
  const seen = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin
    }
    for (const rule of Array.from(rules)) {
      const styleRule = rule as CSSStyleRule;
      if (
        !styleRule.selectorText ||
        !styleRule.selectorText.split(",").some((s) => s.trim() === ":root")
      )
        continue;
      for (const prop of Array.from(styleRule.style)) {
        if (!prop.startsWith("--")) continue;
        const key = `${prop}@@${sheet.href ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          name: prop,
          value: styleRule.style.getPropertyValue(prop).trim(),
          stylesheetHref: sheet.href,
        });
      }
    }
  }
  // Computed-style sweep catches vars set by inline styles or unreadable sheets.
  const names = new Set(out.map((v) => v.name));
  const computed = getComputedStyle(document.documentElement);
  for (const prop of Array.from(computed)) {
    if (prop.startsWith("--") && !names.has(prop)) {
      out.push({ name: prop, value: computed.getPropertyValue(prop).trim(), stylesheetHref: null });
    }
  }
  return out;
};

/** typeof-probe every operation in the manifest (0.x feature detection). */
export const PROBE_FEATURES = (manifest: Record<string, string[]>) => {
  const w = window as unknown as { etch?: Record<string, any> };
  const result: Record<string, Record<string, boolean>> = {};
  for (const domain of Object.keys(manifest)) {
    result[domain] = {};
    const target = domain === "root" ? w.etch : w.etch?.[domain];
    for (const method of manifest[domain] ?? []) {
      result[domain][method] = typeof target?.[method] === "function";
    }
  }
  return result;
};
