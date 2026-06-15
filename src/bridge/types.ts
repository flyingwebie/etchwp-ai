export interface RootVariable {
  name: string;
  value: string;
  /** href of the stylesheet that defines it; null when only visible via computed style. */
  stylesheetHref: string | null;
}

export type FeatureMap = Record<string, Record<string, boolean>>;

export interface BridgeSession {
  state: "detached" | "attached";
  targetId: string | null;
  url: string | null;
  /** Increments on every document load in the attached tab. */
  epoch: number;
  etchVersion: string | null;
  apiVersion: string | null;
}

export interface ScreenshotOptions {
  clip?: { x: number; y: number; width: number; height: number };
  /** Downscale factor applied via CDP device-metrics override (0 < f <= 1). */
  scaleFactor?: number;
  format?: "png" | "jpeg";
  quality?: number;
}

/**
 * Transport abstraction over a live Etch builder session (PRD §4.2 rule 1).
 * CDP is the v1 implementation; a WP-plugin/WebSocket relay can implement the
 * same interface later. Implementations MUST:
 *  - enforce the operation allowlist (no client-supplied JS),
 *  - serialize calls through a single FIFO queue,
 *  - poll availability after navigation before the next call,
 *  - track a session epoch and expose unexpected reloads via takeReloadFlag().
 */
export interface EtchBridge {
  attach(): Promise<void>;
  detach(): Promise<void>;
  isAvailable(): Promise<boolean>;
  eval(domain: string, method: string, args?: unknown[]): Promise<unknown>;
  /** The single fixed read-only page function (PRD §4.2 rule 2 exception). */
  readRootVariables(): Promise<RootVariable[]>;
  screenshot(opts?: ScreenshotOptions): Promise<Uint8Array>;
  probeFeatures(): Promise<FeatureMap>;
  session(): Readonly<BridgeSession>;
  /** True exactly once after an unexpected (non-nav-tool) document reload. */
  takeReloadFlag(): boolean;
  /** Wrap a navigation-triggering call so its reload is not flagged as unexpected. */
  expectNavigation?<T>(fn: () => Promise<T>): Promise<T>;
}
