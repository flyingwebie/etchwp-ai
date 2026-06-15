import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockBridge } from "../../src/bridge/mock.ts";
import { loadConfig } from "../../src/config.ts";
import { buildServer } from "../../src/server.ts";
import { call } from "../server.test.ts";

const SIDECAR_ENV = {
  WP_BASE_URL: "https://site.test",
  WP_APP_USER: "admin",
  WP_APP_PASSWORD: "s3cret-pass",
};

async function clientWith(fetchImpl: typeof fetch, env: Record<string, string> = SIDECAR_ENV) {
  const { server } = buildServer({
    bridge: new MockBridge(),
    config: loadConfig(env),
    fetchImpl,
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return client;
}

describe("wp sidecar", () => {
  test("tools are UNREGISTERED when sidecar env is missing", async () => {
    const client = await clientWith(fetch, {});
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("wp_media");
    expect(names).not.toContain("wp_content");
  });

  test("list_posts forwards pagination and basic auth", async () => {
    let captured: { url: string; auth: string | null } | null = null;
    const fake: typeof fetch = (async (url: any, init: any) => {
      captured = { url: String(url), auth: init?.headers?.Authorization ?? null };
      return new Response(JSON.stringify([{ id: 1, title: { rendered: "Home" } }]), {
        status: 200,
        headers: { "content-type": "application/json", "X-WP-Total": "1" },
      });
    }) as unknown as typeof fetch;
    const client = await clientWith(fake);
    const out = await call(client, "wp_content", { action: "list_posts", page: 2, per_page: 5 });
    expect(out.ok).toBe(true);
    expect(out.result.items[0].id).toBe(1);
    expect(captured!.url).toBe("https://site.test/wp-json/wp/v2/posts?page=2&per_page=5");
    expect(captured!.auth).toBe(`Basic ${Buffer.from("admin:s3cret-pass").toString("base64")}`);
  });

  test("401 yields E_SIDECAR_AUTH with app-password remediation, password never logged", async () => {
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => logged.push(a.join(" "));
    try {
      const fake = (async () => new Response("denied", { status: 401 })) as unknown as typeof fetch;
      const client = await clientWith(fake);
      const out = await call(client, "wp_content", { action: "list_posts" });
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe("E_SIDECAR_AUTH");
      expect(out.error.remediation).toMatch(/[Aa]pplication [Pp]assword/);
      expect(JSON.stringify(out)).not.toContain("s3cret-pass");
      expect(logged.join("\n")).not.toContain("s3cret-pass");
    } finally {
      console.error = orig;
    }
  });

  test("media upload posts bytes and returns id + source_url", async () => {
    const fake: typeof fetch = (async (url: any, init: any) => {
      expect(String(url)).toBe("https://site.test/wp-json/wp/v2/media");
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Disposition"]).toContain('filename="pic.png"');
      return new Response(JSON.stringify({ id: 55, source_url: "https://site.test/pic.png" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = await clientWith(fake);
    const out = await call(client, "wp_media", {
      action: "upload",
      filename: "pic.png",
      mimeType: "image/png",
      base64: Buffer.from("fake").toString("base64"),
    });
    expect(out.ok).toBe(true);
    expect(out.result).toEqual({ id: 55, url: "https://site.test/pic.png" });
    expect(out.hint).toContain("mediaId");
  });
});
