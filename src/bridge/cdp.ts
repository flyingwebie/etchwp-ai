import { type Browser, type CDPSession, chromium, type Page } from "playwright-core";
import type { Config } from "../config.ts";
import { toolError } from "../errors.ts";
import { assertAllowed, ETCH_ALLOWLIST } from "./allowlist.ts";
import { type CandidateTab, chooseTab, filterByHint } from "./discovery.ts";
import {
  EVAL_WRAPPER,
  IS_AVAILABLE,
  type PageEvalResult,
  PROBE_FEATURES,
  READ_ROOT_VARIABLES,
} from "./page-functions.ts";
import { CallQueue } from "./queue.ts";
import type {
  BridgeSession,
  EtchBridge,
  FeatureMap,
  RootVariable,
  ScreenshotOptions,
} from "./types.ts";

const AVAILABILITY_POLL_MS = 500;
const AVAILABILITY_TIMEOUT_MS = 20000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * CDP implementation of EtchBridge: attaches to the user's running Chrome
 * (never launches one, never touches credentials) and drives the pinned
 * builder tab. Pure logic (discovery, allowlist, queue, page functions) is
 * unit-tested; this class is the playwright-core glue.
 */
export class CdpBridge implements EtchBridge {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
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
  private readonly queue: CallQueue;

  constructor(private readonly config: Config) {
    this.queue = new CallQueue(config.callTimeoutMs);
  }

  async attach(): Promise<void> {
    try {
      this.browser = await chromium.connectOverCDP(this.config.cdpUrl);
    } catch (e: any) {
      throw toolError(
        "E_NO_CHROME",
        `Could not reach CDP at ${this.config.cdpUrl}: ${e?.message ?? e}`,
      );
    }
    const pages = this.browser.contexts().flatMap((c) => c.pages());
    const tabs: Array<{ tab: CandidateTab; page: Page }> = [];
    for (const page of pages) {
      let title = "";
      try {
        title = await page.title();
      } catch {
        /* tab may be mid-navigation; keep the URL */
      }
      tabs.push({ tab: { targetId: page.url(), url: page.url(), title }, page });
    }
    const hinted = new Set(
      filterByHint(
        tabs.map((t) => t.tab),
        this.config.tabUrlHint,
      ),
    );
    const probed = [];
    for (const { tab, page } of tabs) {
      if (!hinted.has(tab)) continue;
      let hasEtch = false;
      try {
        hasEtch = (await page.evaluate(IS_AVAILABLE)) === true;
      } catch {
        hasEtch = false;
      }
      probed.push({ tab, hasEtch, page });
    }
    const chosen = chooseTab(probed, this.config.tabUrlHint);
    const entry = probed.find((p) => p.tab === chosen);
    if (!entry) throw toolError("E_NO_TAB", "chosen tab vanished during attach");
    this.page = entry.page;
    this.cdp = await this.page.context().newCDPSession(this.page);
    const info = (await this.cdp.send("Target.getTargetInfo")) as {
      targetInfo: { targetId: string };
    };
    this.state = {
      state: "attached",
      targetId: info.targetInfo.targetId,
      url: this.page.url(),
      epoch: 0,
      etchVersion: null,
      apiVersion: null,
    };
    this.page.on("framenavigated", (frame) => {
      if (frame !== this.page?.mainFrame()) return;
      this.state.epoch += 1;
      this.state.url = frame.url();
      if (!this.expectingNavigation) this.reloadFlag = true;
    });
    this.page.on("close", () => {
      this.state = { ...this.state, state: "detached" };
    });
    const meta = await this.page.evaluate(() => {
      const etch = (window as unknown as { etch?: { apiVersion?: string; version?: string } }).etch;
      return { apiVersion: etch?.apiVersion ?? null, version: etch?.version ?? null };
    });
    this.state.etchVersion = meta.version;
    this.state.apiVersion = meta.apiVersion;
  }

  async detach(): Promise<void> {
    this.state = { ...this.state, state: "detached" };
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.page = null;
    this.cdp = null;
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

  /** Wrap a nav-tool call so its reload does not count as unexpected. */
  async expectNavigation<T>(fn: () => Promise<T>): Promise<T> {
    this.expectingNavigation = true;
    try {
      return await fn();
    } finally {
      // Give the navigation event a beat to fire before re-arming detection.
      setTimeout(() => {
        this.expectingNavigation = false;
      }, 1500);
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    try {
      return (await this.page.evaluate(IS_AVAILABLE)) === true;
    } catch {
      return false;
    }
  }

  async eval(domain: string, method: string, args: unknown[] = []): Promise<unknown> {
    assertAllowed(domain, method);
    return this.queue.run(`${domain}.${method}`, async () => {
      await this.waitForAvailability();
      const result = await this.rawEval(domain, method, args);
      if (!result.ok) {
        throw toolError(result.code ?? "OPERATION_FAILED", result.message);
      }
      return result.value ?? null;
    });
  }

  async readRootVariables(): Promise<RootVariable[]> {
    return this.queue.run("readRootVariables", async () => {
      await this.waitForAvailability();
      return this.alivePage().evaluate(READ_ROOT_VARIABLES);
    });
  }

  async screenshot(opts?: ScreenshotOptions): Promise<Uint8Array> {
    return this.queue.run("screenshot", async () => {
      const page = this.alivePage();
      const scale = opts?.scaleFactor;
      if (scale && scale > 0 && scale < 1 && this.cdp) {
        const vp = page.viewportSize();
        if (vp) {
          await this.cdp.send("Emulation.setDeviceMetricsOverride", {
            width: vp.width,
            height: vp.height,
            deviceScaleFactor: scale,
            mobile: false,
          });
          try {
            const buf = await page.screenshot({
              type: opts?.format ?? "png",
              quality: opts?.format === "jpeg" ? (opts?.quality ?? 70) : undefined,
              clip: opts?.clip,
            });
            return new Uint8Array(buf);
          } finally {
            await this.cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
          }
        }
      }
      const buf = await page.screenshot({
        type: opts?.format ?? "png",
        quality: opts?.format === "jpeg" ? (opts?.quality ?? 70) : undefined,
        clip: opts?.clip,
      });
      return new Uint8Array(buf);
    });
  }

  async probeFeatures(): Promise<FeatureMap> {
    return this.queue.run("probeFeatures", async () => {
      await this.waitForAvailability();
      const manifest = Object.fromEntries(
        Object.entries(ETCH_ALLOWLIST).map(([d, ms]) => [d, [...ms]]),
      );
      return this.alivePage().evaluate(PROBE_FEATURES, manifest);
    });
  }

  private alivePage(): Page {
    if (!this.page || this.page.isClosed() || this.state.state !== "attached") {
      this.markDetached();
      throw toolError("E_DETACHED");
    }
    return this.page;
  }

  private async rawEval(domain: string, method: string, args: unknown[]): Promise<PageEvalResult> {
    try {
      return (await this.alivePage().evaluate(EVAL_WRAPPER, {
        domain,
        method,
        args,
      })) as PageEvalResult;
    } catch (e: any) {
      if (this.page?.isClosed()) {
        this.markDetached();
        throw toolError("E_DETACHED");
      }
      // Execution context destroyed / protocol error mid-call: outcome unknown.
      throw toolError("E_INDETERMINATE", String(e?.message ?? e));
    }
  }

  private async waitForAvailability(): Promise<void> {
    const deadline = Date.now() + AVAILABILITY_TIMEOUT_MS;
    while (!(await this.isAvailable())) {
      if (!this.page || this.page.isClosed()) {
        this.markDetached();
        throw toolError("E_DETACHED");
      }
      if (Date.now() >= deadline) throw toolError("E_NOT_AVAILABLE");
      await sleep(AVAILABILITY_POLL_MS);
    }
  }
}
