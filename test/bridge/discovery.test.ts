import { describe, expect, test } from "bun:test";
import { chooseTab, filterByHint } from "../../src/bridge/discovery.ts";

const tab = (url: string, title = "t") => ({ targetId: url, url, title });

describe("filterByHint", () => {
  test("no hint keeps all tabs", () => {
    const tabs = [tab("https://a.com/x"), tab("https://b.com/y")];
    expect(filterByHint(tabs, undefined)).toEqual(tabs);
  });

  test("case-insensitive substring match", () => {
    const tabs = [tab("https://Staging.Example.com/?etch=editor"), tab("https://other.com/page")];
    expect(filterByHint(tabs, "staging.example")).toEqual([tabs[0]!]);
  });
});

describe("chooseTab", () => {
  test("exactly one etch tab wins", () => {
    const probed = [
      { tab: tab("https://a.com/builder"), hasEtch: true },
      { tab: tab("https://b.com/blog"), hasEtch: false },
    ];
    expect(chooseTab(probed, undefined).url).toBe("https://a.com/builder");
  });

  test("zero candidates throws E_NO_TAB listing open tab urls", () => {
    const probed = [{ tab: tab("https://b.com/blog"), hasEtch: false }];
    try {
      chooseTab(probed, undefined);
      expect.unreachable();
    } catch (e: any) {
      expect(e.code).toBe("E_NO_TAB");
      expect(e.message).toContain("https://b.com/blog");
    }
  });

  test("multiple candidates throws E_MULTIPLE_TABS listing each title+url, never auto-picks", () => {
    const probed = [
      { tab: { targetId: "1", url: "https://a.com/p1", title: "Post 1" }, hasEtch: true },
      { tab: { targetId: "2", url: "https://a.com/p2", title: "Post 2" }, hasEtch: true },
    ];
    try {
      chooseTab(probed, "a.com");
      expect.unreachable();
    } catch (e: any) {
      expect(e.code).toBe("E_MULTIPLE_TABS");
      expect(e.message).toContain("Post 1");
      expect(e.message).toContain("https://a.com/p2");
    }
  });
});
