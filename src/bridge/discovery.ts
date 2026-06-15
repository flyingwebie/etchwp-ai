import { toolError } from "../errors.ts";

export interface CandidateTab {
  targetId: string;
  url: string;
  title: string;
}

export interface ProbedTab {
  tab: CandidateTab;
  hasEtch: boolean;
}

/** Case-insensitive substring filter (PRD F1 tab-discovery algorithm, step 2). */
export function filterByHint(tabs: CandidateTab[], hint: string | undefined): CandidateTab[] {
  if (!hint) return tabs;
  const needle = hint.toLowerCase();
  return tabs.filter((t) => t.url.toLowerCase().includes(needle));
}

/**
 * Deterministic selection (PRD F1): exactly one probed tab with window.etch
 * wins; zero → E_NO_TAB listing what was open; more than one →
 * E_MULTIPLE_TABS listing candidates — never auto-pick.
 */
export function chooseTab(probed: ProbedTab[], hint: string | undefined): CandidateTab {
  const withEtch = probed.filter((p) => p.hasEtch).map((p) => p.tab);
  if (withEtch.length === 1) return withEtch[0] as CandidateTab;
  if (withEtch.length === 0) {
    const seen = probed.map((p) => `  - ${p.tab.title}: ${p.tab.url}`).join("\n");
    throw toolError(
      "E_NO_TAB",
      `No tab with the Etch builder found${hint ? ` (hint: "${hint}")` : ""}. Open tabs probed:\n${seen}`,
    );
  }
  const candidates = withEtch.map((t) => `  - ${t.title}: ${t.url}`).join("\n");
  throw toolError(
    "E_MULTIPLE_TABS",
    `${withEtch.length} tabs have the Etch builder loaded — narrow ETCH_TAB_URL_HINT:\n${candidates}`,
  );
}
