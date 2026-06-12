## [2026-06-12] F2: MCP server skeleton + status/save — built
McpServer + ToolContext (lazy attach), §4.4 envelope + error table, etch_status (featureMap cached,
reload-exempt), etch_save (clears pageDirty only, hints componentEditDirty), split DirtyTracker +
MutationCounter, E_SESSION_RELOADED once-semantics, stderr-only logging + dirty disconnect warning,
CI workflow (test/typecheck/lint on PR). 44 tests green.
