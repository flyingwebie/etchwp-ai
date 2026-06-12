# etchwp-ai

**MCP server that lets AI assistants drive the [Etch](https://etchwp.com) WordPress builder.**

Etch's Public API lives at `window.etch` inside the live builder tab — there is no REST API. etchwp-ai bridges that gap: it attaches to *your own Chrome tab* over the Chrome DevTools Protocol and exposes the full documented `0.x` API surface (85 operations — [coverage table](docs/coverage.md)) as 20 well-schematized MCP tools, plus an optional WordPress REST sidecar for media and paginated content listing.

Works with Claude Code, Claude Desktop, OpenCode, OpenAI Agents SDK, Cursor — anything that speaks MCP.

- ✅ No WordPress credentials stored — it drives the session *you* are logged into, and you watch every edit live
- ✅ No arbitrary JS execution — only allowlisted `window.etch.*` calls plus one fixed read-only token snapshot
- ✅ Explicit save with dirty tracking — buffered Etch mutations are never silently lost *or* silently persisted
- ✅ Screenshots — the AI sees what it built
- ✅ Live design tokens — reads your real `:root` variables (AutomaticCSS-aware via stylesheet-origin classification)
- ✅ `etch_insert_pattern` — hand it HTML + CSS, get a whole styled section in one call

> ⚠️ The Etch Public API is `0.x` and experimental. etchwp-ai feature-detects every method at attach (`etch_status.featureMap`) and degrades per-action instead of breaking.

## Quick start

### 1. Start Chrome with the debug port

Quit Chrome completely first, then:

**macOS**
```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

**Windows (PowerShell)**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

**Linux**
```sh
google-chrome --remote-debugging-port=9222
```

### 2. Open your page in the Etch builder

Log into WordPress in that Chrome window and open the page you want to edit in the Etch builder. Keep the tab open — that tab *is* the API.

### 3. Connect your AI client

**Claude Code**
```sh
claude mcp add etchwp-ai -- npx -y etchwp-ai
```

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "etchwp-ai": {
      "command": "npx",
      "args": ["-y", "etchwp-ai"]
    }
  }
}
```

**OpenCode** — add to `opencode.json`:
```json
{
  "mcp": {
    "etchwp-ai": { "type": "local", "command": ["npx", "-y", "etchwp-ai"] }
  }
}
```

**OpenAI Agents SDK (TypeScript)**
```ts
import { MCPServerStdio } from "@openai/agents";

const etch = new MCPServerStdio({ command: "npx", args: ["-y", "etchwp-ai"] });
```

### 4. Verify (canonical prompt)

Ask your AI:

> Using the etchwp-ai tools: check etch_status, then build a hero section — a container with an h2 reading "Hello Etch" and one paragraph below it; create a `.hero` class using a background token from etch_tokens and attach it to the container; take a screenshot; then save.

Pass checks: (a) `etch_blocks_read get_tree` shows the section/h2/paragraph node types and text; (b) a screenshot came back; (c) after reloading the builder tab manually, `get_tree` still contains a structurally matching subtree (compare types/names/text — block IDs are session-scoped and change on reload).

## Configuration

All via environment variables (set them in your MCP client's `env` block):

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `ETCH_CDP_URL` | `http://localhost:9222` | Chrome debug endpoint |
| `ETCH_TAB_URL_HINT` | — | Case-insensitive URL substring to pick the builder tab when several are open |
| `ETCH_CALL_TIMEOUT_MS` | `15000` | Per-call timeout |
| `ETCH_MAX_READ_BYTES` | `100000` | Tree-read size guard (use `depth`/`mode: summary` past it) |
| `ETCH_ACSS_STYLESHEET_PATTERN` | `automatic-?css` | Regex classifying token origin as ACSS |
| `WP_BASE_URL` + `WP_APP_USER` + `WP_APP_PASSWORD` | — | Enables the `wp_media`/`wp_content` sidecar ([application password](https://wordpress.org/documentation/article/application-passwords/)) |
| `ETCH_LOG_LEVEL` | `info` | stderr log level |

## Tools

20 core tools (+2 with the sidecar). Reads and writes are split per domain so read-only use is trivial to permission.

`etch_status` · `etch_save` · `etch_blocks_read/write` · `etch_styles_read/write` · `etch_tokens` · `etch_stylesheets_read/write` · `etch_components_read/write` · `etch_loops_read/write` · `etch_fields_read/write` · `etch_nav` · `etch_ui` · `etch_history` (incl. checkpoint/rollback) · `etch_screenshot` · `etch_insert_pattern` · `wp_media` · `wp_content`

The three persistence regimes (the #1 Etch gotcha) are encoded in every response:
- **buffered** — blocks/styles/loops mutations vanish without `etch_save`
- **immediate** — stylesheets/components/fields persist instantly
- component definitions — `save_component_edit`, separate from the page save

## Security notes

- The CDP debug port gives full control of that Chrome instance to local processes. Keep it `localhost` (the default) and close Chrome when done.
- The core server stores no WordPress credentials; the optional sidecar takes an application password via env vars only and never logs it.
- No client-supplied JavaScript ever runs in your page — the eval surface is a fixed allowlist of documented `window.etch` calls plus one read-only `:root` snapshot.
- `exit_to_wordpress` and unsaved-discarding navigation require explicit confirmation flags.
- No telemetry. Nothing leaves your machine except your own WP REST calls.

## Troubleshooting

| Error code | Cause | Fix |
| ---------- | ----- | --- |
| `E_NO_CHROME` | Debug port unreachable | Quit Chrome fully, relaunch with `--remote-debugging-port=9222`, or set `ETCH_CDP_URL` |
| `E_NO_TAB` | No tab has `window.etch` | Open the page in the **Etch builder** (not the front-end); set `ETCH_TAB_URL_HINT` |
| `E_MULTIPLE_TABS` | Several builder tabs match | Narrow `ETCH_TAB_URL_HINT` to one tab — the server never guesses |
| `E_NO_ETCH` | Matched tab lacks the builder | Same as above — builder, not preview |
| `E_NOT_AVAILABLE` | Builder still loading | Retry; reload the builder tab if it persists |
| `E_TIMEOUT` | Call exceeded `ETCH_CALL_TIMEOUT_MS` | Builder busy/stalled — check the tab; the op may or may not have applied (see `etch_status`) |
| `E_INDETERMINATE` | Connection dropped mid-call | Check `etch_status` + the builder before retrying a mutation |
| `E_DETACHED` | Tab closed or navigated away | Re-open the builder; the server re-attaches on the next call |
| `E_SESSION_RELOADED` | Page reloaded since the last call | Previous block/style IDs are dead; re-read `get_tree`; unsaved buffer was lost |
| `E_UNSAVED_CHANGES` | Navigation would destroy unsaved work | `etch_save` first, or pass `discard: true` deliberately |
| `E_FEATURE_MISSING` | This Etch build lacks that method (`0.x`) | Check `etch_status.featureMap` |
| `E_READ_TOO_LARGE` | Tree bigger than `ETCH_MAX_READ_BYTES` | Use `depth`/`mode: "summary"`, or raise the limit |
| `E_PATTERN_PARTIAL` | `etch_insert_pattern` failed mid-way | `etch_history rollback` reverts to the auto checkpoint |
| `E_SIDECAR_DISABLED` | WP REST env not set | Set `WP_BASE_URL`, `WP_APP_USER`, `WP_APP_PASSWORD` |
| `E_SIDECAR_AUTH` | WordPress rejected credentials | Re-create the application password |
| `E_VALIDATION` | Input rejected before reaching Etch | The message explains exactly what to fix |

## Development

```sh
bun install
bun test            # 100+ tests against the mock bridge — no WordPress needed
bun run typecheck
bun run lint
bun run build       # dist/index.js (Node ≥ 20)
node scripts/handshake-test.mjs dist/index.js   # stdio smoke test
bun scripts/coverage-table.ts                   # regenerate docs/coverage.md
```

Architecture: `EtchBridge` interface (CDP is the v1 transport; a WP-plugin/WebSocket relay can slot in later) → serialized call queue → 22 zod-schematized tools with a uniform `{ok, result, dirty, persistence, hint}` envelope. See `docs/`.

## Roadmap (v2)

- ACSS-opinionated generation: token-enforced CSS, utility suggestions, BEM lint
- WP-plugin/WebSocket transport (no Chrome flags needed)
- Streamable HTTP transport, multi-session
- Watch upstream: `etch.connect?()` reserved official transport

## License

MIT © [Flying Web](https://flyingweb.ie)
