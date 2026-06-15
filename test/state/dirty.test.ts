import { describe, expect, test } from "bun:test";
import { DirtyTracker, MutationCounter } from "../../src/state/dirty.ts";

describe("DirtyTracker", () => {
  test("starts clean", () => {
    const d = new DirtyTracker();
    expect(d.snapshot()).toEqual({ page: 0, componentEdit: 0, lastCallIndeterminate: false });
    expect(d.isDirty()).toBe(false);
  });

  test("page vs componentEdit counters are independent", () => {
    const d = new DirtyTracker();
    d.mark("page");
    d.mark("page");
    d.mark("componentEdit");
    expect(d.snapshot()).toEqual({ page: 2, componentEdit: 1, lastCallIndeterminate: false });
  });

  test("clearPage keeps componentEdit; clearComponentEdit keeps page", () => {
    const d = new DirtyTracker();
    d.mark("page");
    d.mark("componentEdit");
    d.clearPage();
    expect(d.snapshot().page).toBe(0);
    expect(d.snapshot().componentEdit).toBe(1);
    d.mark("page");
    d.clearComponentEdit();
    expect(d.snapshot().page).toBe(1);
    expect(d.snapshot().componentEdit).toBe(0);
  });

  test("indeterminate marks the domain dirty and sets the flag", () => {
    const d = new DirtyTracker();
    d.markIndeterminate("page");
    expect(d.snapshot().page).toBe(1);
    expect(d.snapshot().lastCallIndeterminate).toBe(true);
    d.mark("page"); // a later confirmed call clears the flag
    expect(d.snapshot().lastCallIndeterminate).toBe(false);
  });

  test("reset clears everything (session reload)", () => {
    const d = new DirtyTracker();
    d.mark("page");
    d.markIndeterminate("componentEdit");
    d.reset();
    expect(d.snapshot()).toEqual({ page: 0, componentEdit: 0, lastCallIndeterminate: false });
  });
});

describe("MutationCounter", () => {
  test("monotonic across domains, never resets on save", () => {
    const m = new MutationCounter();
    m.increment("blocks");
    m.increment("stylesheets");
    m.increment("fields");
    expect(m.value()).toBe(3);
    expect(m.since(1)).toBe(2);
    expect(m.immediateSince(0)).toEqual(["stylesheets", "fields"]);
  });
});
