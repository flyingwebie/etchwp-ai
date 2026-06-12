import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

describe("config", () => {
  test("defaults", () => {
    const c = loadConfig({});
    expect(c.cdpUrl).toBe("http://localhost:9222");
    expect(c.tabUrlHint).toBeUndefined();
    expect(c.callTimeoutMs).toBe(15000);
    expect(c.maxReadBytes).toBe(100000);
    expect(c.sidecar).toBeNull();
    expect(c.acssStylesheetPattern.test("/wp-content/uploads/automatic-css/automatic.css")).toBe(
      true,
    );
    expect(c.acssStylesheetPattern.test("/themes/mytheme/style.css")).toBe(false);
  });

  test("env overrides", () => {
    const c = loadConfig({
      ETCH_CDP_URL: "http://127.0.0.1:9333",
      ETCH_TAB_URL_HINT: "staging.example.com",
      ETCH_CALL_TIMEOUT_MS: "5000",
      ETCH_MAX_READ_BYTES: "50000",
    });
    expect(c.cdpUrl).toBe("http://127.0.0.1:9333");
    expect(c.tabUrlHint).toBe("staging.example.com");
    expect(c.callTimeoutMs).toBe(5000);
    expect(c.maxReadBytes).toBe(50000);
  });

  test("sidecar enabled only when all three WP vars set", () => {
    expect(loadConfig({ WP_BASE_URL: "https://x.com" }).sidecar).toBeNull();
    expect(loadConfig({ WP_BASE_URL: "https://x.com", WP_APP_USER: "u" }).sidecar).toBeNull();
    const c = loadConfig({
      WP_BASE_URL: "https://x.com",
      WP_APP_USER: "u",
      WP_APP_PASSWORD: "p",
    });
    expect(c.sidecar).toEqual({ baseUrl: "https://x.com", user: "u", password: "p" });
  });
});
