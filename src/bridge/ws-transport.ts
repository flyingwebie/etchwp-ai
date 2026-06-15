import type { WsConfig } from "../config.ts";
import { toolError } from "../errors.ts";
import {
  type AgentFrame,
  type ControllerFrame,
  type HelloFrame,
  isAgentFrame,
} from "./ws-protocol.ts";

/**
 * One connected in-page agent (one Etch editor tab). Direct mode may surface
 * several (multiple tabs dialing loopback); relay mode surfaces exactly one
 * (the room pairs a single agent).
 */
export interface AgentConn {
  readonly id: string;
  readonly hello: HelloFrame;
  send(frame: ControllerFrame): void;
  onFrame(cb: (f: AgentFrame) => void): void;
  onClose(cb: () => void): void;
}

/** Connection abstraction so WsBridge is identical across direct/relay and is unit-testable. */
export interface WsTransport {
  /** Begin listening (direct) or dial the relay (relay). */
  start(): Promise<void>;
  /** Resolves once ≥1 agent has completed hello, else rejects after timeoutMs. */
  waitForAgents(timeoutMs: number): Promise<AgentConn[]>;
  agents(): AgentConn[];
  onAgentDisconnect(cb: (id: string) => void): void;
  stop(): Promise<void>;
}

export function createWsTransport(cfg: WsConfig): WsTransport {
  return cfg.mode === "relay" ? new RelayClientTransport(cfg) : new DirectServerTransport(cfg);
}

// --- shared agent bookkeeping -------------------------------------------------

class AgentRegistry {
  readonly conns = new Map<string, AgentConn>();
  private waiters: Array<(a: AgentConn[]) => void> = [];
  private disconnectCbs: Array<(id: string) => void> = [];

  add(conn: AgentConn): void {
    this.conns.set(conn.id, conn);
    conn.onClose(() => this.remove(conn.id));
    const all = [...this.conns.values()];
    for (const w of this.waiters.splice(0)) w(all);
  }

  remove(id: string): void {
    if (this.conns.delete(id)) for (const cb of this.disconnectCbs) cb(id);
  }

  onDisconnect(cb: (id: string) => void): void {
    this.disconnectCbs.push(cb);
  }

  waitForAgents(timeoutMs: number): Promise<AgentConn[]> {
    if (this.conns.size > 0) return Promise.resolve([...this.conns.values()]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== onAgent);
        reject(toolError("E_NO_AGENT"));
      }, timeoutMs);
      const onAgent = (a: AgentConn[]) => {
        clearTimeout(timer);
        resolve(a);
      };
      this.waiters.push(onAgent);
    });
  }
}

/** Parse a frame from a raw ws message; null if it isn't a valid agent frame. */
function parseFrame(data: unknown): AgentFrame | null {
  try {
    const obj = JSON.parse(typeof data === "string" ? data : String(data));
    return isAgentFrame(obj) ? obj : null;
  } catch {
    return null;
  }
}

// --- direct mode: MCP hosts a loopback ws(s) server ---------------------------

class DirectServerTransport implements WsTransport {
  private readonly registry = new AgentRegistry();
  private wss: { close: (cb?: () => void) => void } | null = null;
  private httpServer: { close: (cb?: () => void) => void } | null = null;
  private seq = 0;

  constructor(private readonly cfg: WsConfig) {}

  async start(): Promise<void> {
    const { WebSocketServer } = await import("ws");
    let serverOpts: Record<string, unknown> = { host: "127.0.0.1", port: this.cfg.port };
    if (this.cfg.certPath && this.cfg.keyPath) {
      const [{ createServer }, { readFileSync }] = await Promise.all([
        import("node:https"),
        import("node:fs"),
      ]);
      const https = createServer({
        cert: readFileSync(this.cfg.certPath),
        key: readFileSync(this.cfg.keyPath),
      });
      await new Promise<void>((res) => https.listen(this.cfg.port, "127.0.0.1", res));
      this.httpServer = https;
      serverOpts = { server: https };
    }
    const wss = new WebSocketServer(serverOpts);
    this.wss = wss;
    wss.on("connection", (socket: WsLike) => this.onSocket(socket));
    if (!this.httpServer) {
      await new Promise<void>((res) => wss.once("listening", res));
    }
  }

  private onSocket(socket: WsLike): void {
    const frameCbs: Array<(f: AgentFrame) => void> = [];
    const closeCbs: Array<() => void> = [];
    let helloed = false;

    socket.on("message", (data: unknown) => {
      const frame = parseFrame(data);
      if (!frame) return;
      if (!helloed) {
        if (frame.t !== "hello") return; // ignore until identified
        if (this.cfg.token && frame.token !== this.cfg.token) {
          socket.close(4001, "bad token");
          return;
        }
        helloed = true;
        const id = `direct-${++this.seq}`;
        this.registry.add({
          id,
          hello: frame,
          send: (f) => socket.send(JSON.stringify(f)),
          onFrame: (cb) => frameCbs.push(cb),
          onClose: (cb) => closeCbs.push(cb),
        });
        return;
      }
      for (const cb of frameCbs) cb(frame);
    });
    socket.on("close", () => {
      for (const cb of closeCbs) cb();
    });
    socket.on("error", () => socket.close());
  }

  waitForAgents(timeoutMs: number): Promise<AgentConn[]> {
    return this.registry.waitForAgents(timeoutMs);
  }
  agents(): AgentConn[] {
    return [...this.registry.conns.values()];
  }
  onAgentDisconnect(cb: (id: string) => void): void {
    this.registry.onDisconnect(cb);
  }
  async stop(): Promise<void> {
    await new Promise<void>((res) => (this.wss ? this.wss.close(() => res()) : res()));
    if (this.httpServer) await new Promise<void>((res) => this.httpServer?.close(() => res()));
  }
}

// --- relay mode: MCP dials a shared wss broker; the room pairs one agent ------

class RelayClientTransport implements WsTransport {
  private readonly registry = new AgentRegistry();
  private socket: WsLike | null = null;

  constructor(private readonly cfg: WsConfig) {}

  async start(): Promise<void> {
    if (!this.cfg.relayUrl)
      throw toolError("E_WS_CONFIG", "ETCH_WS_RELAY_URL is required in relay mode");
    const { WebSocket } = await import("ws");
    const socket = new WebSocket(this.cfg.relayUrl) as unknown as WsLike;
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => {
        socket.send(
          JSON.stringify({
            t: "join",
            role: "controller",
            room: this.cfg.room,
            token: this.cfg.token,
          }),
        );
        resolve();
      });
      socket.on("error", (e: unknown) =>
        reject(
          toolError("E_WS_RELAY", `relay connect failed: ${String((e as Error)?.message ?? e)}`),
        ),
      );
    });

    const frameCbs: Array<(f: AgentFrame) => void> = [];
    const closeCbs: Array<() => void> = [];
    let agentId: string | null = null;
    socket.on("message", (data: unknown) => {
      const frame = parseFrame(data);
      if (!frame) return;
      if (frame.t === "hello") {
        if (agentId) return; // already paired
        agentId = `relay-${this.cfg.room}`;
        this.registry.add({
          id: agentId,
          hello: frame,
          send: (f) => socket.send(JSON.stringify(f)),
          onFrame: (cb) => frameCbs.push(cb),
          onClose: (cb) => closeCbs.push(cb),
        });
        return;
      }
      if (agentId) for (const cb of frameCbs) cb(frame);
    });
    const drop = () => {
      if (agentId) for (const cb of closeCbs) cb();
    };
    socket.on("close", drop);
    socket.on("error", drop);
  }

  waitForAgents(timeoutMs: number): Promise<AgentConn[]> {
    return this.registry.waitForAgents(timeoutMs);
  }
  agents(): AgentConn[] {
    return [...this.registry.conns.values()];
  }
  onAgentDisconnect(cb: (id: string) => void): void {
    this.registry.onDisconnect(cb);
  }
  async stop(): Promise<void> {
    this.socket?.close();
  }
}

/** Minimal structural type for a `ws` socket (avoids a hard dep in types). */
interface WsLike {
  on(event: string, cb: (...args: unknown[]) => void): void;
  once(event: string, cb: (...args: unknown[]) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
