import { BROKEN_SUMMARY, SaveError, saveSummary, type SaveSummary } from './format';

export const SLOT_COUNT = 32;   // save00..save31; 30 and 31 are the original's autosaves

/** Where slot bytes live: IndexedDB in the browser, memory in tests or when IndexedDB is unavailable. */
export interface SlotBackend {
  get(slot: number): Promise<Uint8Array | null>;
  put(slot: number, bytes: Uint8Array): Promise<void>;
  remove(slot: number): Promise<void>;
  keys(): Promise<number[]>;
}

export class MemoryBackend implements SlotBackend {
  private readonly slots = new Map<number, Uint8Array>();
  async get(slot: number): Promise<Uint8Array | null> { return this.slots.get(slot) ?? null; }
  async put(slot: number, bytes: Uint8Array): Promise<void> { this.slots.set(slot, bytes.slice()); }
  async remove(slot: number): Promise<void> { this.slots.delete(slot); }
  async keys(): Promise<number[]> { return [...this.slots.keys()]; }
}

/** One object store 'saves' keyed by slot number in database 'ft2'. */
export class IdbBackend implements SlotBackend {
  private constructor(private readonly db: IDBDatabase) {}

  static open(dbName = 'ft2'): Promise<IdbBackend> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('saves')) req.result.createObjectStore('saves'); };
      req.onsuccess = () => resolve(new IdbBackend(req.result));
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    });
  }

  private run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = op(this.db.transaction('saves', mode).objectStore('saves'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });
  }
  async get(slot: number): Promise<Uint8Array | null> { const v = await this.run<unknown>('readonly', (s) => s.get(slot)); return v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null; }
  async put(slot: number, bytes: Uint8Array): Promise<void> { await this.run('readwrite', (s) => s.put(bytes, slot)); }
  async remove(slot: number): Promise<void> { await this.run('readwrite', (s) => s.delete(slot)); }
  async keys(): Promise<number[]> { return (await this.run<IDBValidKey[]>('readonly', (s) => s.getAllKeys())).filter((k): k is number => typeof k === 'number'); }
}

const checkSlot = (slot: number): void => { if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) throw new RangeError(`save slot ${slot} is outside 0..${SLOT_COUNT - 1}`); };

/** The 32 save slots over a backend; every write is validated as a 6848-byte save file first. */
export class SaveStore {
  constructor(private readonly backend: SlotBackend) {}

  static fileName(slot: number): string { return `save${String(slot).padStart(2, '0')}.dat`; }

  async summaries(): Promise<(SaveSummary | null)[]> {
    const out: (SaveSummary | null)[] = new Array<SaveSummary | null>(SLOT_COUNT).fill(null);
    for (const slot of await this.backend.keys()) {
      if (slot < 0 || slot >= SLOT_COUNT) continue;
      const bytes = await this.backend.get(slot);
      if (bytes) { try { out[slot] = saveSummary(bytes); } catch { out[slot] = BROKEN_SUMMARY; } }
    }
    return out;
  }
  async read(slot: number): Promise<Uint8Array | null> { checkSlot(slot); return this.backend.get(slot); }
  async write(slot: number, bytes: Uint8Array): Promise<void> {
    checkSlot(slot);
    saveSummary(bytes);                                                          // throws SaveError for anything that is not a save file
    await this.backend.put(slot, bytes);
  }
  async remove(slot: number): Promise<void> { checkSlot(slot); await this.backend.remove(slot); }
  /** A file the player picked: validated, stored, summarised. */
  async importBytes(slot: number, bytes: Uint8Array): Promise<SaveSummary> {
    checkSlot(slot);
    const sum = saveSummary(bytes);
    await this.backend.put(slot, bytes);
    return sum;
  }
}
export { SaveError };
