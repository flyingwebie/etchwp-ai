# Spec: server

### Requirement: Envelope + error table
Every tool returns {ok, result, dirty, persistence?, hint?} or {ok:false, error:{code, message,
remediation}}; bridge/server codes per src/errors.ts; Etch codes pass through.

### Requirement: Status + save tools
etch_status reports activePostId, isEditingTemplate, place, componentEditMode, split dirty,
canUndo/canRedo, sessionEpoch, apiVersion/version, featureMap (cached probe). etch_save persists
the page buffer, clears pageDirty only, hints when componentEditDirty remains.

### Requirement: Split dirty + confirmed-success semantics
pageDirty / componentEditDirty counters move only on eval-confirmed success; E_TIMEOUT /
E_INDETERMINATE conservatively mark dirty + lastCallIndeterminate. Dirty is a documented lower
bound (no API events). Unexpected reload → next non-status call fails once with
E_SESSION_RELOADED and resets counters.

### Requirement: Process hygiene
stdout is MCP-only; logs to stderr; disconnect with dirty buffer warns on stderr; sidecar-disabled
notice at startup; CI gates (test/typecheck/lint) on every PR.
