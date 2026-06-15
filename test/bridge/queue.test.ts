import { describe, expect, test } from "bun:test";
import { CallQueue } from "../../src/bridge/queue.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("CallQueue", () => {
  test("serializes concurrent calls FIFO", async () => {
    const q = new CallQueue(1000);
    const order: string[] = [];
    const a = q.run("a", async () => {
      order.push("a-start");
      await sleep(30);
      order.push("a-end");
      return "a";
    });
    const b = q.run("b", async () => {
      order.push("b-start");
      await sleep(5);
      order.push("b-end");
      return "b";
    });
    expect(await Promise.all([a, b])).toEqual(["a", "b"]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  test("rejects with E_TIMEOUT after the per-call timeout", async () => {
    const q = new CallQueue(20);
    await expect(q.run("slow", () => sleep(500).then(() => "late"))).rejects.toMatchObject({
      code: "E_TIMEOUT",
    });
  });

  test("a timed-out call does not block the next call", async () => {
    const q = new CallQueue(20);
    const slow = q.run("slow", () => sleep(500).then(() => "late"));
    const fast = q.run("fast", async () => "fast");
    await expect(slow).rejects.toMatchObject({ code: "E_TIMEOUT" });
    expect(await fast).toBe("fast");
  });

  test("a rejected call surfaces its own error, queue continues", async () => {
    const q = new CallQueue(1000);
    const bad = q.run("bad", async () => {
      throw new Error("boom");
    });
    const good = q.run("good", async () => 42);
    await expect(bad).rejects.toThrow("boom");
    expect(await good).toBe(42);
  });
});
