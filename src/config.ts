export interface SidecarConfig {
  baseUrl: string;
  user: string;
  password: string;
}

/** Enforcement strictness for ACSS-token / BEM lint in etch_insert_pattern. */
export type EnforceMode = "off" | "warn" | "reject";

/** Which bridge transport drives the builder. */
export type Transport = "cdp" | "ws";
/** WebSocket connection mode: MCP hosts a loopback server, or both peers dial a relay. */
export type WsMode = "direct" | "relay";

export interface WsConfig {
  mode: WsMode;
  /** direct: loopback server port. */
  port: number;
  /** direct: TLS cert/key paths for wss (omit → plain ws, relies on Chrome LNA exemption). */
  certPath: string | undefined;
  keyPath: string | undefined;
  /** relay: wss URL of the broker both peers connect to. */
  relayUrl: string | undefined;
  /** relay: room id pairing this MCP with its in-page agent. */
  room: string;
  /** shared secret the agent must present (both modes). */
  token: string | undefined;
}

export interface Config {
  transport: Transport;
  ws: WsConfig;
  cdpUrl: string;
  tabUrlHint: string | undefined;
  callTimeoutMs: number;
  maxReadBytes: number;
  /** Stylesheet hrefs matching this pattern classify variables as ACSS (see research/acss-variables.md). */
  acssStylesheetPattern: RegExp;
  /** Hardcoded-value enforcement in etch_insert_pattern (ETCH_ENFORCE_TOKENS). */
  enforceTokens: EnforceMode;
  /** BEM class-name enforcement in etch_insert_pattern (ETCH_BEM_LINT). */
  bemLint: EnforceMode;
  sidecar: SidecarConfig | null;
  logLevel: string;
}

function enforceMode(value: string | undefined, fallback: EnforceMode): EnforceMode {
  return value === "off" || value === "warn" || value === "reject" ? value : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const sidecar =
    env.WP_BASE_URL && env.WP_APP_USER && env.WP_APP_PASSWORD
      ? { baseUrl: env.WP_BASE_URL, user: env.WP_APP_USER, password: env.WP_APP_PASSWORD }
      : null;
  return {
    transport: env.ETCH_TRANSPORT === "ws" ? "ws" : "cdp",
    ws: {
      mode: env.ETCH_WS_MODE === "direct" ? "direct" : "relay",
      port: Number(env.ETCH_WS_PORT ?? 9223),
      certPath: env.ETCH_WS_CERT,
      keyPath: env.ETCH_WS_KEY,
      relayUrl: env.ETCH_WS_RELAY_URL,
      room: env.ETCH_WS_ROOM ?? "default",
      token: env.ETCH_WS_TOKEN,
    },
    cdpUrl: env.ETCH_CDP_URL ?? "http://localhost:9222",
    tabUrlHint: env.ETCH_TAB_URL_HINT,
    callTimeoutMs: Number(env.ETCH_CALL_TIMEOUT_MS ?? 15000),
    maxReadBytes: Number(env.ETCH_MAX_READ_BYTES ?? 100000),
    acssStylesheetPattern: new RegExp(env.ETCH_ACSS_STYLESHEET_PATTERN ?? "automatic-?css", "i"),
    enforceTokens: enforceMode(env.ETCH_ENFORCE_TOKENS, "warn"),
    bemLint: enforceMode(env.ETCH_BEM_LINT, "warn"),
    sidecar,
    logLevel: env.ETCH_LOG_LEVEL ?? "info",
  };
}
