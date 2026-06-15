/**
 * Wire protocol between the MCP `WsBridge` (controller) and the in-page agent
 * (the WordPress plugin's agent.js). JSON frames, one direction at a time.
 *
 * Mirror of this protocol lives in the plugin's assets/agent.js — keep both in
 * sync. The agent runs the SAME page functions (EVAL_WRAPPER, IS_AVAILABLE,
 * READ_ROOT_VARIABLES, PROBE_FEATURES) as the CDP path so semantics are identical.
 */

/** Relay handshake (relay mode only): each peer joins a room with a role. */
export interface JoinFrame {
  t: "join";
  role: "controller" | "agent";
  room: string;
  token?: string;
}

/** Agent → controller: sent once window.etch is present, identifies the tab. */
export interface HelloFrame {
  t: "hello";
  url: string;
  title: string;
  hasEtch: boolean;
  etchVersion: string | null;
  apiVersion: string | null;
  token?: string;
}

/** Agent → controller: the editor tab navigated/reloaded (epoch bump). */
export interface NavigatedFrame {
  t: "navigated";
  url: string;
}

export type CallKind = "eval" | "readRootVariables" | "probeFeatures" | "isAvailable";

/** Controller → agent: one request, correlated by id. */
export interface CallFrame {
  t: "call";
  id: number;
  kind: CallKind;
  domain?: string;
  method?: string;
  args?: unknown[];
  /** for probeFeatures: domain → method[] manifest. */
  manifest?: Record<string, string[]>;
}

/** Agent → controller: the result for a CallFrame id (shape mirrors PageEvalResult). */
export interface ResultFrame {
  t: "result";
  id: number;
  ok: boolean;
  value?: unknown;
  code?: string;
  message?: string;
}

export type AgentFrame = HelloFrame | NavigatedFrame | ResultFrame | JoinFrame;
export type ControllerFrame = CallFrame | JoinFrame;

export function isAgentFrame(v: unknown): v is AgentFrame {
  return !!v && typeof v === "object" && typeof (v as { t?: unknown }).t === "string";
}

/** Default subprotocol marker so a relay/agent can sanity-check the peer. */
export const ETCH_WS_SUBPROTOCOL = "etchwp-ai.v1";
