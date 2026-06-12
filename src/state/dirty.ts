export type DirtyDomain = "page" | "componentEdit";

export interface DirtySnapshot {
  page: number;
  componentEdit: number;
  lastCallIndeterminate: boolean;
}

/**
 * Split dirty tracking (PRD §4.2 rule 4). Counts AI-initiated buffered
 * mutations only — a LOWER BOUND on unsaved state (the API has no events, so
 * concurrent manual edits and UI saves are invisible). pageDirty clears on
 * etch_save; componentEditDirty clears on save_component_edit or
 * exit_component_edit({revert:true}).
 */
export class DirtyTracker {
  private page = 0;
  private componentEdit = 0;
  private indeterminate = false;

  mark(domain: DirtyDomain): void {
    this[domain === "page" ? "page" : "componentEdit"] += 1;
    this.indeterminate = false;
  }

  /** Outcome-unknown call: conservatively dirty + flag for etch_status. */
  markIndeterminate(domain: DirtyDomain): void {
    this[domain === "page" ? "page" : "componentEdit"] += 1;
    this.indeterminate = true;
  }

  clearPage(): void {
    this.page = 0;
  }

  clearComponentEdit(): void {
    this.componentEdit = 0;
  }

  reset(): void {
    this.page = 0;
    this.componentEdit = 0;
    this.indeterminate = false;
  }

  isDirty(): boolean {
    return this.page > 0 || this.componentEdit > 0;
  }

  snapshot(): DirtySnapshot {
    return {
      page: this.page,
      componentEdit: this.componentEdit,
      lastCallIndeterminate: this.indeterminate,
    };
  }
}

const IMMEDIATE_DOMAINS = new Set(["stylesheets", "components", "fields"]);

/**
 * Monotonic count of every successful mutating bridge call across all
 * domains — the basis for undo checkpoints (F11). Distinct from DirtyTracker:
 * never resets on save.
 */
export class MutationCounter {
  private log: string[] = [];

  increment(domain: string): void {
    this.log.push(domain);
  }

  value(): number {
    return this.log.length;
  }

  since(checkpoint: number): number {
    return Math.max(0, this.log.length - checkpoint);
  }

  /** Immediate-persistence domains mutated since the checkpoint (F11 warning list). */
  immediateSince(checkpoint: number): string[] {
    return this.log.slice(checkpoint).filter((d) => IMMEDIATE_DOMAINS.has(d));
  }
}
