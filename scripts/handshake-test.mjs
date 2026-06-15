#!/usr/bin/env node
/**
 * Release-gate smoke test (PRD §6.3-6a): spawn the packaged bin over stdio,
 * perform an MCP initialize handshake and a tools/list, assert the 20 core
 * tools are present (sidecar excluded — no WP_* env). Plain Node, no SDK.
 *
 * Usage: node scripts/handshake-test.mjs <path-to-bin.js>
 */
import { spawn } from "node:child_process";

const bin = process.argv[2] ?? "dist/index.js";
const child = spawn(process.execPath, [bin], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, WP_BASE_URL: "", WP_APP_USER: "", WP_APP_PASSWORD: "" },
});

const EXPECTED = 20;
let buffer = "";
const pending = new Map();
let nextId = 1;

function send(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10000);
  });
}

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx = buffer.indexOf("\n");
  while (idx !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) {
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id).resolve(msg);
          pending.delete(msg.id);
        }
      } catch {
        /* non-JSON noise */
      }
    }
    idx = buffer.indexOf("\n");
  }
});

try {
  const init = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "handshake-test", version: "0.0.0" },
  });
  if (!init.result?.serverInfo?.name) throw new Error("initialize failed: no serverInfo");
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const tools = await send("tools/list", {});
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  if (names.length !== EXPECTED) {
    throw new Error(`expected ${EXPECTED} core tools, got ${names.length}: ${names.join(", ")}`);
  }
  if (names.includes("wp_media")) throw new Error("sidecar tools leaked without env");
  console.log(`handshake OK — server '${init.result.serverInfo.name}', ${names.length} tools`);
  process.exit(0);
} catch (e) {
  console.error(`handshake FAILED: ${e.message}`);
  process.exit(1);
} finally {
  child.kill();
}
