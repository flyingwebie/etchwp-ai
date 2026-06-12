import { toolError } from "../errors.ts";
import { assertAllowed, ETCH_ALLOWLIST } from "./allowlist.ts";
import { CallQueue } from "./queue.ts";
import type {
  BridgeSession,
  EtchBridge,
  FeatureMap,
  RootVariable,
  ScreenshotOptions,
} from "./types.ts";

type Handler = (...args: unknown[]) => unknown;

export interface MockBridgeOptions {
  pollIntervalMs?: number;
  availabilityTimeoutMs?: number;
  rootVariables?: RootVariable[];
  missingFeatures?: Array<[string, string]>;
  screenshotBytes?: Uint8Array;
  callTimeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * In-memory EtchBridge for tests: same allowlist, queue, availability-poll,
 * epoch and reload-flag semantics as the CDP implementation, with scriptable
 * per-operation handlers and full call recording.
 */
export class MockBridge implements EtchBridge {
  available = true;
  readonly calls: Array<{ domain: string; method: string; args: unknown[] }> = [];

  private handlers = new Map<string, Handler>();
  private state: BridgeSession = {
    state: "detached",
    targetId: null,
    url: null,
    epoch: 0,
    etchVersion: "0.9.0-mock",
    apiVersion: "0.x",
  };
  private reloadFlag = false;
  private readonly opts: Required<
    Pick<MockBridgeOptions, "pollIntervalMs" | "availabilityTimeoutMs" | "callTimeoutMs">
  > &
    MockBridgeOptions;
  private readonly queue: CallQueue;
  private readonly missing: Set<string>;

  constructor(options: MockBridgeOptions = {}) {
    this.opts = {
      pollIntervalMs: 5,
      availabilityTimeoutMs: 50,
      callTimeoutMs: 1000,
      ...options,
    };
    this.queue = new CallQueue(this.opts.callTimeoutMs);
    this.missing = new Set((options.missingFeatures ?? []).map(([d, m]) => `${d}.${m}`));
  }

  setHandler(domain: string, method: string, fn: Handler): void {
    assertAllowed(domain, method);
    this.handlers.set(`${domain}.${method}`, fn);
  }

  simulateNavigation(opts: { expected?: boolean } = {}): void {
    this.state.epoch += 1;
    if (!opts.expected) this.reloadFlag = true;
  }

  takeReloadFlag(): boolean {
    const v = this.reloadFlag;
    this.reloadFlag = false;
    return v;
  }

  async attach(): Promise<void> {
    this.state = {
      ...this.state,
      state: "attached",
      targetId: "mock-target",
      url: "mock://builder",
    };
  }

  async detach(): Promise<void> {
    this.state = { ...this.state, state: "detached", targetId: null, url: null };
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  session(): Readonly<BridgeSession> {
    return { ...this.state };
  }

  async eval(domain: string, method: string, args: unknown[] = []): Promise<unknown> {
    assertAllowed(domain, method);
    if (this.state.state !== "attached") {
      throw toolError("E_DETACHED", "mock bridge is detached");
    }
    return this.queue.run(`${domain}.${method}`, async () => {
      await this.waitForAvailability();
      if (this.missing.has(`${domain}.${method}`)) {
        throw toolError("E_FEATURE_MISSING", `etch.${domain}.${method} is not a function`);
      }
      this.calls.push({ domain, method, args });
      const handler = this.handlers.get(`${domain}.${method}`);
      if (!handler) return null;
      try {
        const value = await handler(...args);
        return value === undefined ? null : value;
      } catch (e: any) {
        if (typeof e?.code === "string") throw toolError(e.code, e.message);
        throw e;
      }
    });
  }

  async readRootVariables(): Promise<RootVariable[]> {
    return this.opts.rootVariables ?? [];
  }

  async screenshot(_opts?: ScreenshotOptions): Promise<Uint8Array> {
    return this.opts.screenshotBytes ?? new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  }

  async probeFeatures(): Promise<FeatureMap> {
    const map: FeatureMap = {};
    for (const [domain, methods] of Object.entries(ETCH_ALLOWLIST)) {
      map[domain] = {};
      for (const method of methods) {
        map[domain][method] = !this.missing.has(`${domain}.${method}`);
      }
    }
    return map;
  }

  private async waitForAvailability(): Promise<void> {
    const deadline = Date.now() + this.opts.availabilityTimeoutMs;
    while (!(await this.isAvailable())) {
      if (Date.now() >= deadline) {
        throw toolError("E_NOT_AVAILABLE", "window.etch did not become available (mock)");
      }
      await sleep(this.opts.pollIntervalMs);
    }
  }
}
