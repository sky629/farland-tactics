/**
 * Named loads that start once: a name is pending from `start` until `done` or `fail`; a failed name stays failed (it is
 * neither retried nor pending), so a bitmap that cannot load does not hold the auto-play clock (`BrowserStage.pendingLoads`).
 */
export class LoadTable<T> {
  private readonly entries = new Map<string, { value: T | null; pending: boolean }>();
  /** True when this call started the load: the caller performs it and reports `done` or `fail`. */
  start(name: string): boolean {
    if (this.entries.has(name)) return false;
    this.entries.set(name, { value: null, pending: true });
    return true;
  }
  done(name: string, value: T): void { this.entries.set(name, { value, pending: false }); }
  fail(name: string): void { this.entries.set(name, { value: null, pending: false }); }
  get(name: string): T | null { return this.entries.get(name)?.value ?? null; }
  get pending(): number { let n = 0; for (const e of this.entries.values()) if (e.pending) n++; return n; }
  clear(): void { this.entries.clear(); }
}
