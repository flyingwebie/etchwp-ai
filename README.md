# etchwp-ai

**MCP server that lets AI assistants drive the [Etch](https://etchwp.com) WordPress builder.**

Works with Claude Code, Claude Desktop, OpenCode, OpenAI Agents SDK, Cursor — anything that speaks [MCP](https://modelcontextprotocol.io).

---

## How it works

### The problem

Etch publishes a Public API — but it is **not** a REST API. It exists only as a JavaScript object, `window.etch`, injected into the browser tab where the Etch builder is open. If the builder isn't open in a browser, the API does not exist anywhere. So an AI assistant (which runs outside your browser) has no way to call it directly.

### The bridge

etchwp-ai solves this with a three-hop chain:

```
┌──────────────────────┐   MCP (stdio)   ┌──────────────────────┐   Chrome DevTools    ┌─────────────────────────┐
│  Your AI client      │ ──────────────► │  etchwp-ai server    │ ──────────────────►  │  YOUR Chrome tab        │
│  Claude / OpenAI /   │ ◄────────────── │  (this package,      │ ◄──────────────────  │  with the Etch builder  │
│  OpenCode / Cursor   │    tool results │   runs on your       │   Protocol (CDP,     │  open → window.etch     │
└──────────────────────┘                 │   machine via npx)   │   localhost:9222)    └───────────┬─────────────┘
                                         └──────────────────────┘                                  │
                                                                                       ┌───────────▼─────────────┐
                                                                                       │  Your WordPress site    │
                                                                                       └─────────────────────────┘
```

Step by step, what happens on every tool call:

1. **Your AI client** (e.g. Claude Code) calls an MCP tool like `etch_blocks_write` over stdio.
2. **The etchwp-ai server** validates the input against a strict schema, checks the operation against an **allowlist of the 85 documented Etch API operations** ([full table](docs/coverage.md)), and queues it — calls run strictly one at a time, because the builder is stateful.
3. **The bridge** sends the call into your already-open Chrome tab via the Chrome DevTools Protocol and invokes `window.etch.<domain>.<method>(...)` there. No browser is launched, no WordPress password is stored — it drives the session *you* logged into, and you watch every edit appear live in your builder.
4. The result (or a structured Etch error) travels back the same way, wrapped in a uniform envelope: `{ ok, result, dirty, persistence, hint }` — so the AI always knows whether the change is saved yet and what to do next.

> **No Chrome flags?** The CDP hop (step 3) can be swapped for a WebSocket: install the
> **etchwp-ai Bridge** WordPress plugin and set `ETCH_TRANSPORT=ws`. The plugin's in-page
> agent relays the same `window.etch` calls — same tools, any browser, no debug port. See
> [the WordPress plugin setup](#websocket-transport-etch_transportws--the-wordpress-plugin).

### The save model (the part that matters most)

Etch has three persistence regimes, and getting them wrong silently loses work. etchwp-ai encodes them into every response:

| Regime | Domains | What it means |
| ------ | ------- | ------------- |
| **buffered** | blocks, styles, loops | Changes live in the builder's buffer and **vanish on reload unless `etch_save` is called** — exactly like a human forgetting to hit Save |
| **immediate** | stylesheets, components, custom fields | Persist instantly; no save needed, no taking it back via the buffer |
| **component definitions** | component edit mode | Need their own `save_component_edit` — separate from the page save |

The server tracks a **dirty counter** for buffered changes (split into page edits vs component-definition edits) and returns it on every write. Navigation that would destroy unsaved work fails with `E_UNSAVED_CHANGES` unless the AI explicitly passes `discard: true`. If the page reloads unexpectedly, the next call fails once with `E_SESSION_RELOADED` so the AI knows its block IDs are stale and the buffer is gone.

### Safety design

- **No arbitrary code execution.** There is no "run JS" tool. The bridge can only invoke the 85 allowlisted `window.etch` operations, plus a few fixed, read-only, server-shipped snippets (availability check, feature probe, version read, and the `:root` variable snapshot behind `etch_tokens`). No client-supplied JavaScript ever runs in your page; anything else → `E_VALIDATION`.
- **No credentials in the core.** CDP attaches to your logged-in session. The optional WordPress REST sidecar takes an [application password](https://wordpress.org/documentation/article/application-passwords/) via env vars only and never logs it.
- **Destructive actions are gated.** `exit_to_wordpress` (kills the builder session) requires `confirm: true`; discarding unsaved work requires `discard: true`; risky batches can be wrapped with `etch_history` `checkpoint` → `rollback`.
- **Never guesses.** If several tabs could be the builder, the server lists them and asks you to narrow `ETCH_TAB_URL_HINT` — it never auto-picks a tab to edit.
- **`0.x`-proof.** The Etch API is experimental; etchwp-ai probes every method on the first `etch_status` call (cached as `etch_status.featureMap`) and fails per-action with `E_FEATURE_MISSING` instead of breaking.
- **No telemetry.** Nothing leaves your machine except your own WP REST calls.

---

## Setup, step by step

**Prerequisites:** [Node.js](https://nodejs.org) ≥ 20 (provides `npx` — check with `node -v`), Google Chrome, and a WordPress site with the Etch builder active.

### Step 1 — Start Chrome with the debug port

The server needs Chrome's DevTools port open to reach your tab.

> **Important (Chrome 136+):** Chrome ignores `--remote-debugging-port` on your default profile — a deliberate security change. You must also pass `--user-data-dir` pointing at a dedicated directory. This opens a separate Chrome profile, so you'll log into WordPress once inside it.

**macOS**
```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.etchwp-ai-chrome"
```

**Windows (PowerShell)**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\.etchwp-ai-chrome"
```
*(Per-user Chrome installs live at `$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe` instead.)*

**Linux**
```sh
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.etchwp-ai-chrome"
```

Verify the port is open: visiting `http://localhost:9222/json/version` in that Chrome should show JSON.

> The debug port gives local processes control of that Chrome instance. It binds to `localhost` only; close Chrome when you're done working.

### Step 2 — Open your page in the Etch builder

In that Chrome window, log into WordPress and open the page you want to edit **in the Etch builder** (not the front-end preview). Keep the tab open — that tab *is* the API. One builder tab is ideal; with several open, set `ETCH_TAB_URL_HINT` (Step 4).

### Step 3 — Connect your AI client

> **Not on npm yet?** Until the package is published, run it from source instead of `npx`:
> ```sh
> git clone https://github.com/flyingweb/etchwp-ai && cd etchwp-ai
> bun install && bun run build
> pwd   # note this absolute path — you'll point your client at <path>/dist/index.js
> ```
> Then everywhere below replace `"command": "npx", "args": ["-y", "etchwp-ai"]` with
> `"command": "node", "args": ["/absolute/path/to/etchwp-ai/dist/index.js"]`. A full
> from-source entry with an env var (the `node` equivalent of the Claude Desktop block below):
> ```json
> {
>   "mcpServers": {
>     "etchwp-ai": {
>       "command": "node",
>       "args": ["/absolute/path/to/etchwp-ai/dist/index.js"],
>       "env": { "ETCH_TAB_URL_HINT": "mysite.com" }
>     }
>   }
> }
> ```
> The dist path doesn't change when you rebuild (`bun run build` overwrites the same file).
> In Claude Desktop / Cursor (GUI apps), `"command": "node"` can fail with `spawn node ENOENT`
> if Node was installed via nvm/Homebrew — use the absolute path from `which node`
> (e.g. `/Users/you/.nvm/versions/node/v22.21.0/bin/node`). Claude Code's CLI inherits your
> shell PATH, so a bare `node` is fine there.

**Claude Code**
```sh
claude mcp add etchwp-ai -- npx -y etchwp-ai
```
(Env vars: `claude mcp add etchwp-ai -e ETCH_TAB_URL_HINT=mysite.com -- npx -y etchwp-ai`)

**Claude Desktop** — edit the config file (Settings → Developer → Edit Config, or directly):
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Create it if it doesn't exist:
```json
{
  "mcpServers": {
    "etchwp-ai": {
      "command": "npx",
      "args": ["-y", "etchwp-ai"],
      "env": { "ETCH_TAB_URL_HINT": "mysite.com" }
    }
  }
}
```
Fully quit and restart Claude Desktop afterwards; the tools appear under the tools icon. If the server fails with `spawn npx ENOENT` (common on macOS — GUI apps don't see Homebrew/nvm paths), replace `"npx"` with the absolute path from `which npx` (e.g. `/opt/homebrew/bin/npx`).

**Cursor** — add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):
```json
{
  "mcpServers": {
    "etchwp-ai": {
      "command": "npx",
      "args": ["-y", "etchwp-ai"],
      "env": { "ETCH_TAB_URL_HINT": "mysite.com" }
    }
  }
}
```

**OpenCode** — add to `opencode.json` (note: OpenCode uses `environment`, not `env`):
```json
{
  "mcp": {
    "etchwp-ai": {
      "type": "local",
      "command": ["npx", "-y", "etchwp-ai"],
      "environment": { "ETCH_TAB_URL_HINT": "mysite.com" }
    }
  }
}
```

**OpenAI Agents SDK (TypeScript)**
```ts
import { MCPServerStdio } from "@openai/agents";

const etch = new MCPServerStdio({ command: "npx", args: ["-y", "etchwp-ai"] });
```

### Step 4 — Configure (optional)

Everything is environment variables — set them in your MCP client's `env` block (see the Claude Desktop example above) or via `claude mcp add -e KEY=value` for Claude Code:

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `ETCH_TRANSPORT` | `cdp` | `cdp` (Chrome debug port) or `ws` (WebSocket via the WordPress plugin — see below) |
| `ETCH_CDP_URL` | `http://localhost:9222` | Chrome debug endpoint (CDP transport) |
| `ETCH_TAB_URL_HINT` | — | Case-insensitive URL substring to pick the builder tab when several are open |
| `ETCH_CALL_TIMEOUT_MS` | `15000` | Per-call timeout |
| `ETCH_MAX_READ_BYTES` | `100000` | Tree-read size guard (past it, use `depth` / `mode: "summary"`) |
| `ETCH_ACSS_STYLESHEET_PATTERN` | `automatic-?css` | Regex classifying a token's stylesheet origin as AutomaticCSS |
| `WP_BASE_URL` + `WP_APP_USER` + `WP_APP_PASSWORD` | — | All three together enable the `wp_media` / `wp_content` sidecar |
| `ETCH_LOG_LEVEL` | `info` | stderr log level (stdout is the MCP channel) |

### WebSocket transport (`ETCH_TRANSPORT=ws`) — the WordPress plugin

Prefer not to launch Chrome with a debug flag? The **etchwp-ai Bridge** WordPress plugin is
an alternative to Steps 1–2 above. It injects a tiny in-page agent into the Etch editor that
relays the same `window.etch` Public API to the MCP server over a WebSocket. Works in **any
browser**, is **scoped to the Etch tab only**, and needs **no `--remote-debugging-port`**.

> Trade-off: `etch_screenshot` needs CDP, so it is unavailable on this transport. Use
> `ETCH_TRANSPORT=cdp` (Steps 1–2) if you need screenshots.

Two modes:

- **Relay (default, recommended for online/staging sites).** Both the MCP server and the
  plugin dial a shared `wss://` broker, paired by a `room` + `token`. No loopback ⇒ **no
  Chrome prompt**, and the browser and the MCP server can even be on different machines.
- **Direct (same machine).** The MCP server hosts a loopback `ws(s)` server; the plugin
  connects to it. Chrome 147+ shows a **one-time Local Network Access permission prompt** the
  first time — accept it. Use `wss` with a locally-trusted cert (e.g. [mkcert](https://github.com/FiloSottile/mkcert)) for the smoothest experience.

#### A. Install the plugin

Get `etchwp-ai-bridge.zip`, then in WP Admin go to **Plugins → Add New → Upload Plugin →**
choose the zip **→ Install Now → Activate**. Where to get the zip:

- **Release:** download it from the [GitHub Releases](https://github.com/flyingwebie/etchwp-ai/releases) page (attached to each `v*` tag).
- **CI artifact:** `gh run download <run-id>` — every PR/build uploads it as the
  `etchwp-ai-bridge` artifact.
- **Build locally:** zip the `wordpress-plugin/etchwp-ai-bridge` folder (same output the
  release Action produces):
  ```sh
  cd wordpress-plugin && zip -r ../etchwp-ai-bridge.zip etchwp-ai-bridge
  ```

#### B. (Relay mode only) Run the relay

The relay is a tiny stateless broker (`relay/`). Run it with Bun behind a `wss://`
TLS-terminating proxy:

```sh
RELAY_PORT=8787 bun relay/server.ts
```

See [relay/README.md](relay/README.md) for a Caddy/nginx snippet. Give each site its own
`room` + `token`. (Skip this section entirely for Direct mode.)

#### C. Configure both sides — they must match

In WP Admin: **Settings → etchwp-ai Bridge**. Pick the **Mode** (the page shows only that
mode's fields), click **Generate** for a strong **Shared token**, and fill the **Relay URL +
Room** (relay) or **Host/Port + wss** (direct). The page builds a copy-paste **MCP server
environment** block from your entries, and a **live status panel** turns green once the
in-page agent connects. Set the same values as MCP server env vars:

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `ETCH_WS_MODE` | `relay` | `relay` or `direct` |
| `ETCH_WS_RELAY_URL` | — | relay mode: `wss://` URL of the broker |
| `ETCH_WS_ROOM` | `default` | relay mode: room id pairing this server with its in-page agent |
| `ETCH_WS_TOKEN` | — | shared secret the agent must present (both modes) |
| `ETCH_WS_PORT` | `9223` | direct mode: loopback server port |
| `ETCH_WS_CERT` + `ETCH_WS_KEY` | — | direct mode: TLS cert/key paths for `wss` |

A Claude Desktop config block for **relay** mode (the `node`-from-source form; adapt the
`command`/`args` per Step 3):

```json
{
  "mcpServers": {
    "etchwp-ai": {
      "command": "node",
      "args": ["/absolute/path/to/etchwp-ai/dist/index.js"],
      "env": {
        "ETCH_TRANSPORT": "ws",
        "ETCH_WS_MODE": "relay",
        "ETCH_WS_RELAY_URL": "wss://relay.example.com",
        "ETCH_WS_ROOM": "mysite",
        "ETCH_WS_TOKEN": "a-long-random-secret",
        "ETCH_TAB_URL_HINT": "mysite.com"
      }
    }
  }
}
```

#### D. Use it

Open your page in the **Etch builder** (logged in normally — no debug-flag Chrome needed).
The agent connects automatically — a small **● etchwp-ai connected** badge appears in the
editor and the settings **status panel** flips to *Agent connected*. In Direct mode, accept
the one-time Chrome Local Network Access prompt. Then jump to Step 5 — `etch_status` should
return live builder state through the plugin.

### Step 5 — Verify it works

Ask your AI:

> Using the etchwp-ai tools: check etch_status, then build a hero section — a container with an h2 reading "Hello Etch" and one paragraph below it; create a `.hero` class using a background token from etch_tokens and attach it to the container; take a screenshot; read the tree back with etch_blocks_read get_tree; then save.

Pass checks:
1. The `get_tree` read-back shows the section / h2 / paragraph node types and text.
2. A screenshot came back showing the section.
3. Manually reload the builder tab, then ask: *"Run etch_blocks_read get_tree and confirm the hero section is still there."* The first call after the reload returns `E_SESSION_RELOADED` — that's expected, retry once — then `get_tree` shows a structurally matching subtree (compare types/names/text; block IDs are session-scoped and change on reload, that's normal).

---

## The tools

20 core tools, +2 when the sidecar is configured. Reads and writes are split per domain, so read-only use is trivial to permission in your client.

### Session & persistence

| Tool | What it does |
| ---- | ------------ |
| `etch_status` | The "look before you leap" tool: active post, template vs post mode, component-edit mode, dirty counters, undo state, session epoch, Etch version, feature map. Call it before acting on assumptions. |
| `etch_save` | Persists all **buffered** changes (blocks/styles/loops) — same as the builder's Save button. Clears the page dirty counter. |

### Building blocks

| Tool | What it does |
| ---- | ------------ |
| `etch_blocks_read` | `get_tree` (whole document; `depth` + `mode: "summary"` for big pages), `get_json`, `find`, selection + attribute/class reads |
| `etch_blocks_write` | create / replace (full block JSON) · update (merge patch) · delete / duplicate / move · set_text / rename · attributes · attach/detach classes by styleId · component edit mode (enter / exit with `revert` / `save_component_edit`) |
| `etch_insert_pattern` | The power tool: give it HTML + CSS, it builds the whole section — parses locally, creates every CSS rule, creates the block tree, attaches every class — and returns a manifest. Auto-checkpoints first; on partial failure tells you to roll back. |

### Styling & tokens

| Tool | What it does |
| ---- | ------------ |
| `etch_styles_read` / `etch_styles_write` | Etch CSS rules (create returns the **styleId** — the only handle that attaches classes to blocks) + Etch-registered CSS variables |
| `etch_tokens` | Every live design token on the page: merges Etch's registry with a read-only `:root` snapshot. Each token is tagged by source and classified `acss` / `etch` / `custom` **by stylesheet origin** — so renamed ACSS palettes still classify correctly. Use these real tokens (e.g. `var(--space-m)`) in generated CSS instead of hardcoded values. |
| `etch_stylesheets_read` / `etch_stylesheets_write` | Whole stylesheets + `@custom-media` queries (immediate persistence) |

### Content & structure

| Tool | What it does |
| ---- | ------------ |
| `etch_components_read` / `etch_components_write` | Component definitions (numeric IDs; update is a partial patch, but `properties`/`blocks` replace wholesale) |
| `etch_loops_read` / `etch_loops_write` | Query loops (wp-query / terms / users / json configs, `$param ?? default` mini-language, bind to blocks) |
| `etch_fields_read` / `etch_fields_write` | Custom field groups, fields, and per-post values (immediate persistence) |

### Navigation, safety & feedback

| Tool | What it does |
| ---- | ------------ |
| `etch_nav` | Open posts/templates, switch builder areas, list posts/templates. Context-changing actions are dirty-guarded; `exit_to_wordpress` needs `confirm: true`. |
| `etch_ui` | Builder chrome: color scheme, hide/show interface (handy before screenshots) |
| `etch_history` | undo / redo / can_undo / can_redo + `checkpoint` / `rollback` — best-effort transactions over the shared undo stack |
| `etch_screenshot` | PNG of the tab (`hide_chrome: true` for clean shots) — closes the visual feedback loop. **CDP transport only** — unavailable when `ETCH_TRANSPORT=ws`. |

### WordPress sidecar (optional)

| Tool | What it does |
| ---- | ------------ |
| `wp_media` | Upload media (returns the ID to use as `mediaId` on image blocks) + paginated listing — Etch itself has no media API |
| `wp_content` | Paginated, searchable post/page listing — Etch's own lists are unpaginated |

These two only appear in `tools/list` when `WP_BASE_URL`, `WP_APP_USER`, and `WP_APP_PASSWORD` are all set.

---

## Troubleshooting

Every error returns a stable code plus remediation text. The full matrix:

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
| `E_READ_TOO_LARGE` | Tree bigger than `ETCH_MAX_READ_BYTES` | Use `depth` / `mode: "summary"`, or raise the limit |
| `E_PATTERN_PARTIAL` | `etch_insert_pattern` failed mid-way | `etch_history rollback` reverts to the auto checkpoint |
| `E_SIDECAR_DISABLED` | WP REST env not set | Set `WP_BASE_URL`, `WP_APP_USER`, `WP_APP_PASSWORD` |
| `E_SIDECAR_AUTH` | WordPress rejected credentials | Re-create the application password |
| `E_VALIDATION` | Input rejected before reaching Etch | The message explains exactly what to fix |

---

## How the code is organized

```
src/
├── index.ts              entry point: stdio transport, dirty-disconnect warning
├── server.ts             builds the McpServer + ToolContext, registers every tool
├── config.ts             env-driven configuration
├── errors.ts             stable error codes + remediation strings
├── tool-kit.ts           the shared envelope wrapper + dirty-tracking write helpers
├── bridge/
│   ├── types.ts          EtchBridge interface — the transport abstraction
│   ├── cdp.ts            CDP implementation (playwright-core connectOverCDP)
│   ├── ws.ts             WebSocket implementation (drives the WP-plugin agent)
│   ├── ws-transport.ts   ws connection layer: direct loopback server / relay client
│   ├── ws-protocol.ts    JSON frame protocol shared with the plugin agent
│   ├── mock.ts           in-memory bridge powering the whole test suite
│   ├── allowlist.ts      the 85 documented operations — the only callable surface
│   ├── discovery.ts      deterministic builder-tab selection
│   ├── queue.ts          FIFO serialization + per-call timeout
│   └── page-functions.ts the only code that runs inside the page (fixed, reviewed)
├── state/dirty.ts        DirtyTracker (page/componentEdit split) + MutationCounter
├── acss/prefixes.ts      ACSS namespace metadata (display only — origin classifies)
├── ops-manifest.ts       op → tool/action map; CI fails if any op is unmapped
├── pattern/transform.ts  pure HTML+CSS → insertion plan (htmlparser2 + css-tree)
└── tools/                one file per domain tool

relay/                    standalone WebSocket broker for ws relay mode (run with Bun)
wordpress-plugin/         the etchwp-ai-bridge plugin (in-page agent + settings page)
```

Key design decisions:

- **`EtchBridge` is an interface.** CDP and the WordPress-plugin/WebSocket relay are two transports behind the same interface — every tool is transport-agnostic and untouched by the choice.
- **Everything is testable without WordPress.** The mock bridge implements identical semantics (allowlist, queue, reload flags, feature gaps); 100+ tests run against it in CI.
- **Schemas are deliberately flat** (action enum + optional fields, no unions, depth ≤ 5) so OpenAI-family clients parse them as reliably as Claude. A CI test enforces this.

## Development

```sh
bun install
bun test            # full suite against the mock bridge — no WordPress needed
bun run typecheck
bun run lint
bun run build       # dist/index.js (Node ≥ 20)
node scripts/handshake-test.mjs dist/index.js   # real stdio handshake smoke test
bun scripts/coverage-table.ts                   # regenerate docs/coverage.md
```

More docs: [docs/bridge.md](docs/bridge.md) · [docs/server.md](docs/server.md) · [docs/coverage.md](docs/coverage.md) · [docs/verification.md](docs/verification.md)

## Roadmap (v2)

- ACSS-opinionated generation: token-enforced CSS, utility suggestions, BEM lint
- ✅ WordPress-plugin/WebSocket transport (no Chrome flags needed) — see `ETCH_TRANSPORT=ws` above
- Streamable HTTP transport, multi-session
- Watch upstream: `etch.connect?()` reserved official transport

## License

MIT © [Flying Web](https://flyingweb.ie)
