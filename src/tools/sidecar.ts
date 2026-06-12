import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SidecarConfig } from "../config.ts";
import { toolError } from "../errors.ts";
import { envelope, registerTool, type ToolContext } from "../tool-kit.ts";

async function wpFetch(
  sidecar: SidecarConfig,
  fetchImpl: typeof fetch,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<unknown> {
  const auth = `Basic ${Buffer.from(`${sidecar.user}:${sidecar.password}`).toString("base64")}`;
  const url = `${sidecar.baseUrl.replace(/\/$/, "")}${path}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...init,
      headers: { Authorization: auth, ...(init.headers ?? {}) },
    });
  } catch (e) {
    throw toolError("E_SIDECAR_DISABLED", `WP REST request failed: ${(e as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw toolError("E_SIDECAR_AUTH", `WordPress returned ${res.status} for ${path}`);
  }
  if (!res.ok) {
    throw toolError("OPERATION_FAILED", `WP REST ${path} returned ${res.status}`);
  }
  return res.json();
}

function listQuery(args: Record<string, unknown>): string {
  const q = new URLSearchParams();
  if (args.page !== undefined) q.set("page", String(args.page));
  if (args.per_page !== undefined) q.set("per_page", String(args.per_page));
  if (typeof args.search === "string" && args.search) q.set("search", args.search);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function registerSidecarTools(
  server: McpServer,
  ctx: ToolContext,
  fetchImpl: typeof fetch,
): void {
  const sidecar = ctx.config.sidecar;
  if (!sidecar) return; // unregistered entirely — absent from tools/list

  registerTool(
    server,
    ctx,
    "wp_content",
    "WordPress REST content listing (sidecar — fills the Etch API's missing pagination). Actions: list_posts, list_pages; params page, per_page, search. Returns {items, total}. Post/page ids work with etch_nav open_post and etch_fields values.",
    {
      action: z.enum(["list_posts", "list_pages"]),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().optional(),
      search: z.string().optional(),
    },
    async (args) => {
      const path = args.action === "list_posts" ? "/wp-json/wp/v2/posts" : "/wp-json/wp/v2/pages";
      const items = await wpFetch(sidecar, fetchImpl, `${path}${listQuery(args)}`);
      return envelope(ctx, { items, total: Array.isArray(items) ? items.length : null });
    },
    { skipReloadCheck: true },
  );

  registerTool(
    server,
    ctx,
    "wp_media",
    "WordPress media library (sidecar — Etch has no media API). Actions: upload {filename, mimeType, base64} → {id, url} (use the numeric id as the STRING mediaId attribute on etch/dynamic-image blocks), list {page?, per_page?, search?}.",
    {
      action: z.enum(["upload", "list"]),
      filename: z.string().optional(),
      mimeType: z.string().optional(),
      base64: z.string().optional().describe("upload: file content, base64-encoded"),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().positive().optional(),
      search: z.string().optional(),
    },
    async (args) => {
      if (args.action === "list") {
        const items = await wpFetch(sidecar, fetchImpl, `/wp-json/wp/v2/media${listQuery(args)}`);
        return envelope(ctx, { items });
      }
      const filename = args.filename;
      const base64 = args.base64;
      if (typeof filename !== "string" || !filename || typeof base64 !== "string" || !base64) {
        throw toolError("E_VALIDATION", "'upload' requires 'filename' and 'base64'");
      }
      const bytes = Buffer.from(base64, "base64");
      const media = (await wpFetch(sidecar, fetchImpl, "/wp-json/wp/v2/media", {
        method: "POST",
        headers: {
          "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
          "Content-Type":
            typeof args.mimeType === "string" ? args.mimeType : "application/octet-stream",
        },
        body: bytes,
      })) as { id: number; source_url: string };
      return envelope(
        ctx,
        { id: media.id, url: media.source_url },
        {
          hint: `Use mediaId: "${media.id}" (a string) as the attribute on etch/dynamic-image blocks via etch_blocks_write set_attribute.`,
        },
      );
    },
    { skipReloadCheck: true },
  );
}
