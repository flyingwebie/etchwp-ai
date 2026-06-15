import { describe, expect, test } from "bun:test";
import { WsBridge } from "../../src/bridge/ws.ts";
import type {
  AgentFrame,
  CallFrame,
  HelloFrame,
  ResultFrame,
} from "../../src/bridge/ws-protocol.ts";
import type { AgentConn, WsTransport } from "../../src/bridge/ws-transport.ts";
import { loadConfig } from "../../src/config.ts";
import { isEtchToolError, toolError } from "../../src/errors.ts";

type Responder = (f: CallFrame) => Partial<ResultFrame>;

function defaultResponder(f: CallFrame): Partial<ResultFrame> {
  switch (f.kind) {
    case "isAvailable":
      return { ok: true, value: true };
    case "readRootVariables":
      return { ok: true, value: [{ name: "--x", value: "1", stylesheetHref: null }] };
    case "probeFeatures": {
      const map: Record<string, Record<string, boolean>> = {};
      for (const [d, ms] of Object.entries(f.manifest ?? {})) {
        map[d] = {};
        for (const m of ms) map[d][m] = true;
      }
      return { ok: true, value: map };
    }
    default:
      return { ok: true, value: { domain: f.domain, method: f.method, args: f.args } };
  }
}

class FakeAgent implements AgentConn {
  readonly hello: HelloFrame;
  private frameCbs: Array<(f: AgentFrame) => void> = [];
  private closeCbs: Array<() => void> = [];
  responder: Responder = defaultResponder;

  constructor(
    readonly id: string,
    hello: Partial<HelloFrame> = {},
  ) {
    this.hello = {
      t: "hello",
      url: "https://example.com/?etch=builder",
      title: "Etch",
      hasEtch: true,
      etchVersion: "0.9.0",
      apiVersion: "0.x",
      ...hello,
    };
  }

  send(frame: CallFrame): void {
    if (frame.t !== "call") return;
    const res = this.responder(frame);
    queueMicrotask(() => this.emit({ t: "result", id: frame.id, ok: true, ...res }));
  }
  emit(f: AgentFrame): void {
    for (const cb of this.frameCbs) cb(f);
  }
  onFrame(cb: (f: AgentFrame) => void): void {
    this.frameCbs.push(cb);
  }
  onClose(cb: () => void): void {
    this.closeCbs.push(cb);
  }
  navigate(url: string): void {
    this.emit({ t: "navigated", url });
  }
  drop(): void {
    for (const cb of this.closeCbs) cb();
  }
}

class FakeTransport implements WsTransport {
  private disconnectCbs: Array<(id: string) => void> = [];
  constructor(private readonly list: AgentConn[]) {}
  async start(): Promise<void> {}
  async waitForAgents(): Promise<AgentConn[]> {
    if (this.list.length === 0) throw toolError("E_NO_AGENT");
    return this.list;
  }
  agents(): AgentConn[] {
    return this.list;
  }
  onAgentDisconnect(cb: (id: string) => void): void {
    this.disconnectCbs.push(cb);
  }
  fireDisconnect(id: string): void {
    for (const cb of this.disconnectCbs) cb(id);
  }
  async stop(): Promise<void> {}
}

function makeBridge(agents: AgentConn[], env: Record<string, string> = {}) {
  const config = loadConfig({ ETCH_TRANSPORT: "ws", ETCH_CALL_TIMEOUT_MS: "1000", ...env });
  return new WsBridge(config, new FakeTransport(agents));
}

describe("WsBridge", () => {
  test("attaches to the single agent with window.etch and reports session", async () => {
    const agent = new FakeAgent("a1");
    const bridge = makeBridge([agent]);
    await bridge.attach();
    const s = bridge.session();
    expect(s.state).toBe("attached");
    expect(s.targetId).toBe("a1");
    expect(s.etchVersion).toBe("0.9.0");
    expect(s.apiVersion).toBe("0.x");
  });

  test("eval forwards an allowlisted call and returns the value", async () => {
    const agent = new FakeAgent("a1");
    const bridge = makeBridge([agent]);
    await bridge.attach();
    const out = await bridge.eval("blocks", "getTree", [{ depth: 2 }]);
    expect(out).toEqual({ domain: "blocks", method: "getTree", args: [{ depth: 2 }] });
  });

  test("eval rejects a non-allowlisted operation before sending", async () => {
    const agent = new FakeAgent("a1");
    const bridge = makeBridge([agent]);
    await bridge.attach();
    await expect(bridge.eval("blocks", "nope")).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  test("eval surfaces an error result code from the agent", async () => {
    const agent = new FakeAgent("a1");
    agent.responder = (f) =>
      f.kind === "eval"
        ? { ok: false, code: "E_FEATURE_MISSING", message: "missing" }
        : defaultResponder(f);
    const bridge = makeBridge([agent]);
    await bridge.attach();
    await expect(bridge.eval("blocks", "create", [])).rejects.toMatchObject({
      code: "E_FEATURE_MISSING",
    });
  });

  test("readRootVariables and probeFeatures round-trip", async () => {
    const agent = new FakeAgent("a1");
    const bridge = makeBridge([agent]);
    await bridge.attach();
    const vars = await bridge.readRootVariables();
    expect(vars).toEqual([{ name: "--x", value: "1", stylesheetHref: null }]);
    const feats = await bridge.probeFeatures();
    expect(feats.blocks?.getTree).toBe(true);
  });

  test("navigation sets the reload flag unless expected", async () => {
    const agent = new FakeAgent("a1");
    const bridge = makeBridge([agent]);
    await bridge.attach();
    agent.navigate("https://example.com/other");
    expect(bridge.takeReloadFlag()).toBe(true);
    expect(bridge.takeReloadFlag()).toBe(false);
    await bridge.expectNavigation(async () => {
      agent.navigate("https://example.com/third");
    });
    expect(bridge.takeReloadFlag()).toBe(false);
    expect(bridge.session().epoch).toBe(2);
  });

  test("agent disconnect detaches the bridge", async () => {
    const agent = new FakeAgent("a1");
    const transport = new FakeTransport([agent]);
    const config = loadConfig({ ETCH_TRANSPORT: "ws", ETCH_CALL_TIMEOUT_MS: "1000" });
    const bridge = new WsBridge(config, transport);
    await bridge.attach();
    transport.fireDisconnect("a1");
    expect(bridge.session().state).toBe("detached");
    await expect(bridge.eval("blocks", "getTree")).rejects.toMatchObject({ code: "E_DETACHED" });
  });

  test("two builder tabs error E_MULTIPLE_TABS; a hint disambiguates", async () => {
    const a = new FakeAgent("a", { url: "https://site-a.com/?etch" });
    const b = new FakeAgent("b", { url: "https://site-b.com/?etch" });
    await expect(makeBridge([a, b]).attach()).rejects.toMatchObject({ code: "E_MULTIPLE_TABS" });
    const bridge = makeBridge([a, b], { ETCH_TAB_URL_HINT: "site-b.com" });
    await bridge.attach();
    expect(bridge.session().targetId).toBe("b");
  });

  test("an agent without window.etch errors E_NO_TAB", async () => {
    const agent = new FakeAgent("a1", { hasEtch: false });
    await expect(makeBridge([agent]).attach()).rejects.toMatchObject({ code: "E_NO_TAB" });
  });

  test("screenshot is unsupported over the ws transport", async () => {
    const agent = new FakeAgent("a1");
    const bridge = makeBridge([agent]);
    await bridge.attach();
    const err = await bridge.screenshot().catch((e) => e);
    expect(isEtchToolError(err) && err.code).toBe("E_UNSUPPORTED");
  });
});
