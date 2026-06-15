# Bridge layer

`EtchBridge` (src/bridge/types.ts) abstracts the transport to a live Etch builder tab.
v1 impl: `CdpBridge` (src/bridge/cdp.ts) — attaches to user's Chrome via playwright-core
`connectOverCDP`; never launches a browser, never stores WP credentials.

Key invariants:
- **Allowlist** (src/bridge/allowlist.ts): 85 documented ops across 9 domains + root.
  `assertAllowed` throws E_VALIDATION for anything else. No client-supplied JS; only fixed
  page functions in src/bridge/page-functions.ts run in the page (single read-only exception:
  READ_ROOT_VARIABLES).
- **FIFO queue** (src/bridge/queue.ts): serializes all calls; E_TIMEOUT per ETCH_CALL_TIMEOUT_MS;
  a timed-out call doesn't block the queue.
- **Tab discovery** (src/bridge/discovery.ts): hint filter (case-insensitive substring) →
  probe window.etch → exactly one wins; 0 → E_NO_TAB, >1 → E_MULTIPLE_TABS (never auto-pick).
- **Session epoch**: framenavigated on main frame bumps epoch; unexpected loads set the reload
  flag consumed once via takeReloadFlag() → server raises E_SESSION_RELOADED.
- **MockBridge** (src/bridge/mock.ts): same semantics, scriptable handlers, call recording.

Errors: src/errors.ts — stable codes + remediation; EtchApiError codes pass through.
Config: src/config.ts — ETCH_CDP_URL, ETCH_TAB_URL_HINT, ETCH_CALL_TIMEOUT_MS,
ETCH_MAX_READ_BYTES, ETCH_ACSS_STYLESHEET_PATTERN, WP_* (sidecar trio), ETCH_LOG_LEVEL.
