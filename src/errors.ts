/**
 * Stable error codes + remediation strings for server/bridge-originated failures.
 * Etch's own EtchApiError codes (BLOCK_NOT_FOUND, …) pass through verbatim and
 * get the generic remediation.
 */
export const ERROR_REMEDIATIONS: Record<string, string> = {
  E_NO_CHROME:
    "Chrome's debug port is unreachable. Start Chrome with --remote-debugging-port=9222 (quit all Chrome instances first), or set ETCH_CDP_URL if you use a different port.",
  E_NO_TAB:
    "No open tab has the Etch builder loaded. Open your page in the Etch builder, or set ETCH_TAB_URL_HINT to a substring of the builder tab's URL.",
  E_MULTIPLE_TABS:
    "More than one tab matches. Narrow ETCH_TAB_URL_HINT to a substring unique to the tab you want — the server never picks one for you.",
  E_NO_ETCH:
    "The matched tab has no window.etch. Make sure the Etch builder (not the front-end page) is open in that tab.",
  E_NOT_AVAILABLE:
    "window.etch did not become available in time. The builder may still be loading — retry, or reload the builder tab.",
  E_TIMEOUT:
    "The call exceeded ETCH_CALL_TIMEOUT_MS. The builder tab may be busy or stalled; the operation may or may not have applied — check etch_status and the builder.",
  E_INDETERMINATE:
    "The connection dropped mid-call; the operation may or may not have applied. Check etch_status and the builder before retrying a mutation.",
  E_DETACHED:
    "The bridge is no longer attached to the builder tab (closed or navigated away). Re-open the builder and retry; the server will re-attach.",
  E_SESSION_RELOADED:
    "The builder page reloaded since your last call — previous block/style IDs are no longer valid and unsaved buffered changes were lost. Re-read the tree (etch_blocks_read get_tree) before continuing.",
  E_UNSAVED_CHANGES:
    "There are unsaved buffered changes. Call etch_save first, or retry with discard: true to knowingly throw them away.",
  E_FEATURE_MISSING:
    "This Etch install does not expose that API method (the 0.x contract varies). Check etch_status.featureMap for what is available.",
  E_VALIDATION: "The input was rejected before reaching Etch. Fix the arguments per the message.",
  E_PATTERN_PARTIAL:
    "Pattern insertion stopped mid-way leaving a partial subtree in the buffer. Run etch_history rollback to revert to the auto checkpoint, or finish manually.",
  E_READ_TOO_LARGE:
    "The response exceeds ETCH_MAX_READ_BYTES. Re-run with depth or mode: 'summary' for a smaller view, or raise the limit.",
  E_SIDECAR_DISABLED:
    "The WP REST sidecar is not configured. Set WP_BASE_URL, WP_APP_USER, and WP_APP_PASSWORD (application password) to enable wp_media/wp_content.",
  E_SIDECAR_AUTH:
    "WordPress rejected the sidecar credentials. Re-create the application password (WP Admin → Users → Profile → Application Passwords) and update WP_APP_USER/WP_APP_PASSWORD.",
};

const GENERIC_REMEDIATION =
  "Etch rejected the operation. Inspect the message, re-read current state (etch_status / etch_blocks_read), and adjust the call.";

export class EtchToolError extends Error {
  readonly code: string;
  readonly remediation: string;

  constructor(code: string, message?: string, remediation?: string) {
    super(message ?? code);
    this.name = "EtchToolError";
    this.code = code;
    this.remediation = remediation ?? ERROR_REMEDIATIONS[code] ?? GENERIC_REMEDIATION;
  }
}

export function toolError(code: string, message?: string, remediation?: string): EtchToolError {
  return new EtchToolError(code, message, remediation);
}

export function isEtchToolError(v: unknown): v is EtchToolError {
  return v instanceof EtchToolError;
}
