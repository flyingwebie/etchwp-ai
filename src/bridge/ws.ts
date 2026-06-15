import type { Config } from "../config.ts";
import { toolError } from "../errors.ts";
import { assertAllowed, ETCH_ALLOWLIST } from "./allowlist.ts";
import { type CandidateTab, chooseTab, filterByHint, type ProbedTab } from "./discovery.ts";
import { CallQueue } from "./queue.ts";
import type {
  BridgeSession,
  EtchBridge,
  FeatureMap,
  RootVariable,
  ScreenshotOptions,
} from "./types.ts";
import type { CallFrame, ResultFrame } from "./ws-protocol.ts";
import type { AgentConn, WsTransport } from "./ws-transport.ts";
import { createWsTransport } from "./ws-transport.ts";

const AVAILABILITY_POLL_MS = 250;
const AVAILABILITY_TIMEOUT_MS = 20000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * WebSocket implementation of EtchBridge. Instead of CDP, it talks to the
 * WordPress plugin's in-page agent over a JSON frame protocol (direct loopback
 * server or shared relay). The agent runs the same allowlisted window.etch
 * Public API and the same page functions as the CDP path, so tool behaviour is
 * identical. The transport is injectable for tests.
 */
export class WsBridge implements EtchBridge {
  private agent: AgentConn | null = null;
  private state: BridgeSession = {
    state: "detached",
    targetId: null,
    url: null,
    epoch: 0,
    etchVersion: null,
    apiVersion: null,
  };
  private reloadFlag = false;
  private expectingNavigation = false;
  private seq = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (r: ResultFrame) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly queue: CallQueue;
  private readonly transport: WsTransport;

  constructor(
    private readonly config: Config,
    transport?: WsTransport,
  ) {
    this.queue = new CallQueue(config.callTimeoutMs);
    this.transport = transport ?? createWsTransport(config.ws);
  }

  async attach(): Promise<void> {
    await this.transport.start();
    const agents = await this.transport.waitForAgents(AVAILABILITY_TIMEOUT_MS);
    const tabs = new Map<string, AgentConn>(agents.map((a) => [a.id, a]));
    const candidates: CandidateTab[] = agents.map((a) => ({
      targetId: a.id,
      url: a.hello.url,
      title: a.hello.title,
    }));
    const hinted = new Set(filterByHint(candidates, this.config.tabUrlHint).map((c) => c.targetId));
    const probed: ProbedTab[] = candidates
      .filter((c) => hinted.has(c.targetId))
      .map((c) => ({ tab: c, hasEtch: tabs.get(c.targetId)?.hello.hasEtch ?? false }));
    const chosen: CandidateTab = chooseTab(probed, this.config.tabUrlHint);
    const agent = agents.find((a) => a.id === chosen.targetId);
    if (!agent) throw toolError("E_NO_AGENT", "chosen agent vanished during attach");
    this.agent = agent;

    agent.onFrame((frame) => {
      if (frame.t === "result") {
        const p = this.pending.get(frame.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(frame.id);
          p.resolve(frame);
        }
      } else if (frame.t === "navigated") {
        this.state.epoch += 1;
        this.state.url = frame.url;
        if (!this.expectingNavigation) this.reloadFlag = true;
      }
    });
    agent.onClose(() => this.markDetached());
    this.transport.onAgentDisconnect((id) => {
      if (id === this.agent?.id) this.markDetached();
    });

    this.state = {
      state: "attached",
      targetId: agent.id,
      url: agent.hello.url,
      epoch: 0,
      etchVersion: agent.hello.etchVersion,
      apiVersion: agent.hello.apiVersion,
    };
  }

  async detach(): Promise<void> {
    this.markDetached();
    await this.transport.stop().catch(() => {});
    this.agent = null;
  }

  markDetached(): void {
    this.state = { ...this.state, state: "detached" };
  }

  session(): Readonly<BridgeSession> {
    return { ...this.state };
  }

  takeReloadFlag(): boolean {
    const v = this.reloadFlag;
    this.reloadFlag = false;
    return v;
  }

  async expectNavigation<T>(fn: () => Promise<T>): Promise<T> {
    this.expectingNavigation = true;
    try {
      return await fn();
    } finally {
      setTimeout(() => {
        this.expectingNavigation = false;
      }, 1500);
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.agent || this.state.state !== "attached") return false;
    try {
      const r = await this.request({ kind: "isAvailable" });
      return r.ok && r.value === true;
    } catch {
      return false;
    }
  }

  async eval(domain: string, method: string, args: unknown[] = []): Promise<unknown> {
    assertAllowed(domain, method);
    return this.queue.run(`${domain}.${method}`, async () => {
      await this.waitForAvailability();
      const r = await this.request({ kind: "eval", domain, method, args });
      if (!r.ok) throw toolError(r.code ?? "OPERATION_FAILED", r.message);
      return r.value ?? null;
    });
  }

  async readRootVariables(): Promise<RootVariable[]> {
    return this.queue.run("readRootVariables", async () => {
      await this.waitForAvailability();
      const r = await this.request({ kind: "readRootVariables" });
      if (!r.ok) throw toolError(r.code ?? "OPERATION_FAILED", r.message);
      return (r.value as RootVariable[]) ?? [];
    });
  }

  async probeFeatures(): Promise<FeatureMap> {
    return this.queue.run("probeFeatures", async () => {
      await this.waitForAvailability();
      const manifest = Object.fromEntries(
        Object.entries(ETCH_ALLOWLIST).map(([d, ms]) => [d, [...ms]]),
      );
      const r = await this.request({ kind: "probeFeatures", manifest });
      if (!r.ok) throw toolError(r.code ?? "OPERATION_FAILED", r.message);
      return (r.value as FeatureMap) ?? {};
    });
  }

  async screenshot(_opts?: ScreenshotOptions): Promise<Uint8Array> {
    throw toolError("E_UNSUPPORTED");
  }

  // --- internals -------------------------------------------------------------

  /** Send a correlated request frame and await its result (not queued). */
  private request(req: Omit<CallFrame, "t" | "id">): Promise<ResultFrame> {
    const agent = this.agent;
    if (!agent || this.state.state !== "attached") {
      return Promise.reject(toolError("E_DETACHED"));
    }
    const id = ++this.seq;
    const frame: CallFrame = { t: "call", id, ...req };
    return new Promise<ResultFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(toolError("E_INDETERMINATE", "agent did not reply in time"));
      }, this.config.callTimeoutMs + 1000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        agent.send(frame);
      } catch (e: any) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.markDetached();
        reject(toolError("E_DETACHED", String(e?.message ?? e)));
      }
    });
  }

  private async waitForAvailability(): Promise<void> {
    const deadline = Date.now() + AVAILABILITY_TIMEOUT_MS;
    while (!(await this.isAvailable())) {
      if (this.state.state !== "attached") throw toolError("E_DETACHED");
      if (Date.now() >= deadline) throw toolError("E_NOT_AVAILABLE");
      await sleep(AVAILABILITY_POLL_MS);
    }
  }
}
