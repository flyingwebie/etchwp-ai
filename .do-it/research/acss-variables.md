# ACSS Variable Research (for etch_tokens / F4)

> Source: live generated stylesheet `https://automaticcss.com/wp-content/uploads/automatic-css/automatic.css` (v3.3.5, 1460 unique custom property names) + docs.automaticcss.com (4.x current, /3.0/ archive). Extracted 2026-06-12.

## Classification strategy (normative for F4)

1. **Primary: stylesheet origin.** ACSS ships its variables in same-origin stylesheets under a recognizable path (`/wp-content/uploads/automatic-css/automatic.css`, plugin dir variants). `readRootVariables()` walks `document.styleSheets`, records each `--*` custom property **with its owning stylesheet href**. `source: "acss"` iff href matches the ACSS stylesheet pattern (configurable regex, default `/automatic-?css/i`). This survives dashboard-renamed color palettes (e.g. a site using `--action-*` instead of `--primary-*`) — no prefix list can.
2. **Secondary: namespace metadata.** `ACSS_VARIABLE_PREFIXES` constant tags each acss-classified variable with a namespace group (spacing, typography, color, component…) for display/grouping only — never for classification.
3. **Never classify by generic local utility params** (see Collisions) — exact-match exclusion list.

## Namespace prefixes (verified v3.3.5 CSS; 4.x deltas noted)

Match rule: `name === '--'+p || name.startsWith('--'+p+'-')`.

**Color families** (shades light/semi-light/ultra-light/medium/semi-dark/dark/ultra-dark, `-hover`, `-comp`, `-trans-10..90` [3.x only], partials `-h -s -l -r -g -b -hsl -rgb -hex`):
`primary secondary tertiary accent base neutral shade success danger warning info white black`
⚠ Renameable/extensible in dashboard → origin classification required.

**Spacing/layout:** `space section gutter container-gap content-gap grid width content-width vp-max feature boxed-width header-height admin-bar-height sticky offset col column-count aspect`

**Typography:** `text h1 h2 h3 h4 h5 h6 heading root-font-size paragraph-spacing flow-spacing list nested-list blockquote-spacing figure-spacing figcaption-spacing`

**Scheme/contextual:** `bg body selection link focus overlay light-card dark-card light dark ultra-light ultra-dark surface` (surface = 4.x)

**Borders/radius/shadows:** `border radius divider concentric-radius outline box-shadow text-shadow drop-shadow` (text-/drop-shadow = 4.x)

**Components:** `btn card icon ribbon f wsf fr option-primary-btn-outline option-secondary-btn-outline` (⚠ `f`/`fr` swallow user `--f-*`)

**Effects:** `transition fade-amount`

## Collisions / exclusions

ACSS *local utility parameters* — generic names defined+consumed inside utility classes; exclude from any namespace matcher (exact-match-only if at all):
`gap row-gap m l s xs xl xxl min min-formula full on off alt content shadow visibility line-count align-content align-items justify-content justify-items text-align object-fit object-position auto-grid-aggressiveness 10..90 1-2 1-3 2-1 2-3 3-1 3-2`

Other notes:
- `--wp-admin--admin-bar--height` = WP core, not ACSS.
- 4.x removals: `-trans-N`, "Alt" colors, preset breakpoints, width t-shirt sizes (→ 10–90 numerics).
- No `--breakpoint-*` custom properties in either version.
- `secondary`/`accent` confirmed from 4.x palette docs (site itself renamed palette → `action`).

## Sources

Ground truth: automatic.css v3.3.5 (full extraction). Docs pages: fundamentals/variables, typography-variables, spacing-variables, contextual-spacing, palette-intro, main-colors, semantic-colors, transparencies, unified-lightness, modern-color-scheme-workflow, button-variables, card-styling, link-styling, form-styling-basics, global-border-system, shadows-overview, grid-variables, content-width, whats-new-in-4, effects-overview, icon-framework. Cheat sheet now lives in plugin dashboard (not web-fetchable).
