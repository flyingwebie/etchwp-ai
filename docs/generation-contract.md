# Generation Contract — BEM + ACSS tokens

The contract every generated section must follow before it goes through
`etch_insert_pattern`. Enforcement is wired into the insert pipeline; this doc is
the human/skill-facing spec behind it.

## 1. BEM class names (markup)

- One block per component; elements and modifiers stem from it.
- Grammar: `block(__element)?(--modifier)?`, all **lowercase-kebab**
  (`hero`, `hero__title`, `card__media--featured`).
- **No grandchild nesting** — `block__a__b` is invalid; re-root instead.
- **No ACSS utility classes in markup.** Utilities are not BEM and are not linted
  away — keep them out of generated HTML; all styling goes in the CSS as tokens.
- A bare single-segment class (`hero`, `card`) is a valid block.

Violations are reported as `bemFindings` (warn) or rejected with
`E_ACSS_ENFORCEMENT` (reject). Linter: `src/acss/lint.ts → lintBem`.

## 2. ACSS tokens only (CSS)

No hardcoded design values. Every color, space, font-size, radius, border-width,
width and shadow must reference an ACSS variable via `var(--…)`.

| Property family | Use a token like |
| --------------- | ---------------- |
| color / background / border-color | `var(--primary)`, `var(--text)`, `var(--base)`, `var(--bg-dark)` |
| padding / margin | `var(--space-m)` |
| gap | `var(--space-s)`, `var(--grid-gap)` |
| font-size | `var(--text-m)`, `var(--h2)` |
| border-radius | `var(--radius)` |
| border-width | `var(--border)` |
| width / max-width | `var(--content-width)`, `var(--width-50)` |
| box-shadow | `var(--box-shadow-1)` |

Source of truth for names: the **live** page (`etch_tokens`, or
`bun run export:tokens`). Sites rename palettes, so prefer live names; the static
catalog (`src/acss/tokens.ts`) is the v4 default-name fallback for offline use.

### What is NOT flagged

`var(--…)`, `0`/`auto`/`100%`/`inherit`/`none`/`transparent`/`currentColor`,
`border-radius: 50%`, `grid-template-columns: repeat(3, 1fr)`, `aspect-ratio`,
unitless `line-height`, `calc(…)`, and the sanctioned transparency pattern
`color-mix(in oklch, var(--token) N%, transparent)`. Detector:
`src/acss/lint.ts → findHardcodedValues`.

## 3. Suggestions: static vs live

- **Static (pure transform):** family-level only — "use a `--space-*` token" —
  because ACSS values are site-configured and exact value→token claims would be
  wrong on most sites.
- **Live (insert tool):** when a page is attached, hardcoded values are matched
  against the real `:root` snapshot and `tokenFindings[].resolvedTokens` carries
  exact candidates (e.g. `1.5rem → ["--space-m"]`), ranked by property affinity.
  Best-effort: if the read fails, the static suggestion stands.

## 4. Enforcement modes

| Env var | Default | Effect |
| ------- | ------- | ------ |
| `ETCH_ENFORCE_TOKENS` | `warn` | hardcoded values: `off` ignore · `warn` report in `tokenFindings` · `reject` fail with `E_ACSS_ENFORCEMENT`, zero mutations |
| `ETCH_BEM_LINT` | `warn` | BEM violations: `off` / `warn` (`bemFindings`) / `reject` |

`reject` fires after the pure transform but **before** any bridge write — a
rejected pattern leaves the page untouched.
