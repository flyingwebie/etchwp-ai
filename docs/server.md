# Server layer

`buildServer({bridge, config})` (src/server.ts) wires McpServer + ToolContext.
- ToolContext: bridge, config, DirtyTracker, MutationCounter, ensureAttached() (lazy — server
  starts without Chrome), log() to stderr (stdout = MCP protocol).
- registerTool (src/tool-kit.ts): every tool returns the envelope
  {ok, result, dirty:{page,componentEdit,lastCallIndeterminate}, persistence?, hint?} or
  {ok:false, error:{code,message,remediation}}. Non-status tools fail once with E_SESSION_RELOADED
  after an unexpected reload (dirty resets — buffer died with the document).
- runWrite/runRead: confirmed-success dirty semantics; E_TIMEOUT/E_INDETERMINATE → markIndeterminate.
- Dirty model: pageDirty (blocks outside component edit + styles + loops; cleared by etch_save),
  componentEditDirty (blocks inside edit mode; cleared by save_component_edit / revert-exit).
  MutationCounter: monotonic all-domain count for F11 checkpoints (never resets on save).
Entry: src/index.ts — stdio transport, sidecar-disabled notice, dirty warning on exit/SIGINT.
