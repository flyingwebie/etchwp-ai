# Spec: bridge

### Requirement: Allowlisted eval surface
Only `window.etch.<domain>.<method>` calls from the 85-op documented allowlist (plus the fixed
read-only READ_ROOT_VARIABLES page function) may execute in the builder page. Anything else →
E_VALIDATION. No client-supplied JS path exists.

### Requirement: Deterministic tab discovery
Enumerate CDP page targets → optional ETCH_TAB_URL_HINT case-insensitive substring filter →
probe window.etch. Zero matches → E_NO_TAB (lists probed tabs); multiple → E_MULTIPLE_TABS
(lists candidates, never auto-picks). TargetId pinned on attach; vanished target → E_DETACHED.

### Requirement: Serialized calls with timeout
All bridge calls run through one FIFO queue; per-call timeout ETCH_CALL_TIMEOUT_MS → E_TIMEOUT;
a timed-out call never blocks the queue. Connection loss mid-call → E_INDETERMINATE.

### Requirement: Reload detection
Main-frame navigations bump a session epoch; unexpected loads set a one-shot reload flag
(takeReloadFlag). After navigation the bridge re-polls availability (500ms/20s) before the next call.

### Requirement: Test double parity
MockBridge implements the same interface and semantics (allowlist, queue, availability poll,
epoch/reload, feature gaps) with scriptable handlers and call recording.
