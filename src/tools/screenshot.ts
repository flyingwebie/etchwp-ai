import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolError } from "../errors.ts";
import { errorEnvelope, type ToolContext } from "../tool-kit.ts";

export const MAX_EDGE_PX = 1600;
export const MAX_PAYLOAD_BYTES = 800_000;

/** Read width/height from a PNG IHDR header (no image library needed). */
export function parsePngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47];
  if (!sig.every((b, i) => bytes[i] === b)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function registerScreenshotTool(server: McpServer, ctx: ToolContext): void {
  // Registered directly (not via registerTool) because the success payload is
  // MCP image content, not the JSON envelope; errors still use the envelope.
  (server.tool as (...a: unknown[]) => unknown)(
    "etch_screenshot",
    "Capture the builder tab so you can SEE what you built. mode: 'viewport' (whole tab) or 'canvas' (best-effort crop to the preview area via ETCH_CANVAS_SELECTOR; falls back to viewport with fallback:'viewport' noted). hide_chrome: true hides the builder UI around the capture (etch_ui set_interface_hidden) for a clean shot. Output: PNG (JPEG fallback when the encoded payload would exceed 800KB), longest edge downscaled to 1600px.",
    {
      mode: z.enum(["viewport", "canvas"]).default("viewport"),
      hide_chrome: z.boolean().optional(),
    },
    async (args: Record<string, unknown>) => {
      const fail = (e: unknown) => ({
        content: [{ type: "text" as const, text: JSON.stringify(errorEnvelope(e)) }],
        isError: true,
      });
      try {
        if (ctx.bridge.takeReloadFlag()) {
          ctx.dirty.reset();
          throw toolError("E_SESSION_RELOADED");
        }
        await ctx.ensureAttached();

        const hide = args.hide_chrome === true;
        if (hide) await ctx.bridge.eval("ui", "setInterfaceHidden", [true]);
        let fallback: string | undefined;
        try {
          const mode = (args.mode as string) ?? "viewport";
          if (mode === "canvas") {
            // Canvas-only cropping needs a verified selector (PRD §10 Q4) — until
            // then canvas mode captures the viewport and says so.
            fallback = "viewport";
          }

          let bytes = await ctx.bridge.screenshot({});
          const size = parsePngSize(bytes);
          if (size) {
            const longest = Math.max(size.width, size.height);
            if (longest > MAX_EDGE_PX) {
              bytes = await ctx.bridge.screenshot({ scaleFactor: MAX_EDGE_PX / longest });
            }
          }
          let mimeType = "image/png";
          if (bytes.length > MAX_PAYLOAD_BYTES) {
            bytes = await ctx.bridge.screenshot({ format: "jpeg", quality: 70 });
            mimeType = "image/jpeg";
            if (bytes.length > MAX_PAYLOAD_BYTES) {
              throw toolError(
                "E_READ_TOO_LARGE",
                `Screenshot is ${bytes.length} bytes even as JPEG (limit ${MAX_PAYLOAD_BYTES}). Shrink the browser window and retry.`,
              );
            }
          }
          const content: Array<Record<string, unknown>> = [
            { type: "image", data: toBase64(bytes), mimeType },
          ];
          if (fallback) {
            content.push({
              type: "text",
              text: JSON.stringify({ ok: true, fallback, dirty: ctx.dirty.snapshot() }),
            });
          }
          return { content };
        } finally {
          if (hide) {
            await ctx.bridge.eval("ui", "setInterfaceHidden", [false]).catch(() => {});
          }
        }
      } catch (e) {
        return fail(e);
      }
    },
  );
}
