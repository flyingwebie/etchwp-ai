=== etchwp-ai Bridge ===
Contributors: flyingweb
Tags: etch, mcp, ai, automation, websocket
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 0.1.0
License: MIT

Drive the Etch builder from the etchwp-ai MCP server over a WebSocket — no Chrome debug flags.

== Description ==

The etchwp-ai MCP server normally attaches to Chrome's CDP debug port
(`--remote-debugging-port=9222`) to drive the Etch builder. This plugin offers an
alternative: it injects a small in-page agent into the Etch editor that connects to the
MCP server over a WebSocket and relays the allowlisted `window.etch` Public API.

Benefits:

* No `--remote-debugging-port` / `--user-data-dir` Chrome flags.
* Works in any browser (not just Chromium).
* Scoped to the Etch tab only — the whole browser is not exposed.

== Modes ==

* **Relay (recommended for online sites).** Both the MCP server and this plugin dial a
  shared `wss://` relay; a room id + token pairs them. No loopback, so **no Chrome Local
  Network Access prompt**, and it works even when the browser and the MCP server are on
  different machines.
* **Direct.** The MCP server hosts a loopback `ws(s)` server on `127.0.0.1`; the agent
  connects to it. Same-machine only. Chrome 147+ shows a **one-time Local Network Access
  permission prompt** the first time the page connects to localhost — accept it. Use `wss`
  with a locally-trusted certificate for the smoothest experience.

== Setup ==

1. Install and activate this plugin.
2. Go to **Settings → etchwp-ai Bridge** and set the mode, token, and relay URL/room (or
   host/port for direct mode). These must match the MCP server's `ETCH_WS_*` environment
   variables.
3. On the MCP server set `ETCH_TRANSPORT=ws` and the matching `ETCH_WS_*` vars.
4. Open a page in the Etch builder. The agent connects automatically.

== Limitations ==

* `etch_screenshot` is unavailable over the WebSocket transport (it needs CDP). Use
  `ETCH_TRANSPORT=cdp` if you need screenshots.

== Changelog ==

= 0.1.0 =
* Initial release: relay and direct WebSocket transports for the etchwp-ai MCP server.
