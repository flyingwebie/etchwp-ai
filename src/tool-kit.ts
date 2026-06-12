import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import type { EtchBridge } from "./bridge/types.ts";
import type { Config } from "./config.ts";
import { EtchToolError, toolError } from "./errors.ts";
import type { DirtyDomain, DirtyTracker, MutationCounter } from "./state/dirty.ts";

export interface ToolContext {
  bridge: EtchBridge;
  config: Config;
  dirty: DirtyTracker;
  mutations: MutationCounter;
  /** Lazily attaches the bridge on first use so the server starts without Chrome. */
  ensureAttached(): Promise<void>;
  log(level: "info" | "warn" | "error", message: string): void;
}

export type Persistence = "buffered" | "immediate" | "local-ui";

export interface Envelope {
  ok: boolean;
  result?: unknown;
  dirty?: { page: number; componentEdit: number; lastCallIndeterminate: boolean };
  persistence?: Persistence;
  hint?: string;
  error?: { code: string; message: string; remediation: string };
}

export function envelope(
  ctx: ToolContext,
  result: unknown,
  extra: Partial<Envelope> = {},
): Envelope {
  return { ok: true, result, dirty: ctx.dirty.snapshot(), ...extra };
}

export function errorEnvelope(e: unknown): Envelope {
  const err =
    e instanceof EtchToolError
      ? e
      : toolError(
          typeof (e as { code?: unknown })?.code === "string"
            ? String((e as { code: string }).code)
            : "OPERATION_FAILED",
          e instanceof Error ? e.message : String(e),
        );
  return {
    ok: false,
    error: { code: err.code, message: err.message, remediation: err.remediation },
  };
}

function toContent(env: Envelope) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(env) }],
    isError: !env.ok,
  };
}

export interface RegisterToolOptions {
  /** etch_status skips the reload-flag check (it reports instead of failing). */
  skipReloadCheck?: boolean;
}

/**
 * Shared tool wrapper: every tool returns the §4.4 envelope; thrown
 * EtchToolErrors become {ok:false,error:{code,message,remediation}}; an
 * unexpected session reload fails the call once with E_SESSION_RELOADED and
 * resets the dirty counters (the buffer died with the old document).
 */
export function registerTool<Shape extends ZodRawShape>(
  server: McpServer,
  ctx: ToolContext,
  name: string,
  description: string,
  shape: Shape,
  handler: (args: Record<string, unknown>) => Promise<Envelope>,
  opts: RegisterToolOptions = {},
): void {
  const cb = async (args: Record<string, unknown>) => {
    try {
      if (!opts.skipReloadCheck && ctx.bridge.takeReloadFlag()) {
        ctx.dirty.reset();
        throw toolError("E_SESSION_RELOADED");
      }
      return toContent(await handler(args ?? {}));
    } catch (e) {
      return toContent(errorEnvelope(e));
    }
  };
  (server.tool as (...a: unknown[]) => unknown)(name, description, shape, cb);
}

/**
 * Run a mutating bridge call with confirmed-success dirty semantics
 * (PRD §4.2 rule 4): counters move only after the eval resolves; timeout or
 * connection loss conservatively marks dirty + indeterminate.
 */
export async function runWrite(
  ctx: ToolContext,
  domain: string,
  method: string,
  args: unknown[],
  opts: { dirty: DirtyDomain | null; mutationDomain?: string },
): Promise<unknown> {
  await ctx.ensureAttached();
  try {
    const value = await ctx.bridge.eval(domain, method, args);
    if (opts.dirty) ctx.dirty.mark(opts.dirty);
    ctx.mutations.increment(opts.mutationDomain ?? domain);
    return value;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (opts.dirty && (code === "E_TIMEOUT" || code === "E_INDETERMINATE")) {
      ctx.dirty.markIndeterminate(opts.dirty);
    }
    throw e;
  }
}

export async function runRead(
  ctx: ToolContext,
  domain: string,
  method: string,
  args: unknown[] = [],
): Promise<unknown> {
  await ctx.ensureAttached();
  return ctx.bridge.eval(domain, method, args);
}
