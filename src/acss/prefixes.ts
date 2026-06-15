/**
 * ACSS namespace prefixes — DISPLAY METADATA ONLY, never used for
 * classification (classification is by stylesheet origin; ACSS color palettes
 * are renameable in the dashboard, so no prefix list can be complete).
 * Transcribed from .do-it/research/acss-variables.md (v3.3.5 stylesheet +
 * 4.x docs). Boundary-aware match: name === --p or startsWith --p-.
 */
export const ACSS_VARIABLE_PREFIXES: ReadonlyArray<{ prefix: string; namespace: string }> = [
  // color families (default names; sites may rename — origin classification covers those)
  ...[
    "primary",
    "secondary",
    "tertiary",
    "accent",
    "base",
    "neutral",
    "shade",
    "success",
    "danger",
    "warning",
    "info",
    "white",
    "black",
  ].map((prefix) => ({ prefix, namespace: "color" })),
  // spacing / layout
  ...[
    "space",
    "section",
    "gutter",
    "container-gap",
    "content-gap",
    "grid",
    "width",
    "content-width",
    "vp-max",
    "feature",
    "boxed-width",
    "header-height",
    "admin-bar-height",
    "sticky",
    "offset",
    "col",
    "column-count",
    "aspect",
  ].map((prefix) => ({ prefix, namespace: "spacing" })),
  // typography
  ...[
    "text",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "heading",
    "root-font-size",
    "paragraph-spacing",
    "flow-spacing",
    "list",
    "nested-list",
    "blockquote-spacing",
    "figure-spacing",
    "figcaption-spacing",
  ].map((prefix) => ({ prefix, namespace: "typography" })),
  // scheme / contextual
  ...[
    "bg",
    "body",
    "selection",
    "link",
    "focus",
    "overlay",
    "light-card",
    "dark-card",
    "light",
    "dark",
    "ultra-light",
    "ultra-dark",
    "surface",
  ].map((prefix) => ({ prefix, namespace: "scheme" })),
  // borders / radius / shadows
  ...[
    "border",
    "radius",
    "divider",
    "concentric-radius",
    "outline",
    "box-shadow",
    "text-shadow",
    "drop-shadow",
  ].map((prefix) => ({ prefix, namespace: "border" })),
  // components
  ...["btn", "card", "icon", "ribbon", "f", "wsf", "fr"].map((prefix) => ({
    prefix,
    namespace: "component",
  })),
  // effects
  ...["transition", "fade-amount"].map((prefix) => ({ prefix, namespace: "effect" })),
];

/** Longest-prefix namespace lookup for an acss-classified variable. */
export function namespaceFor(name: string): string | undefined {
  const bare = name.startsWith("--") ? name.slice(2) : name;
  let best: { prefix: string; namespace: string } | undefined;
  for (const entry of ACSS_VARIABLE_PREFIXES) {
    if (bare === entry.prefix || bare.startsWith(`${entry.prefix}-`)) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
  }
  return best?.namespace;
}
