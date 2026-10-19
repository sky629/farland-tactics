import { loadProgram, type Program } from '../script/program';
import { BATTLE_FIELDS, type BattleEntry, type DialogTemplate, ITEM_FIELDS, MAGIC_FIELDS, type MenuTemplate, RACE_FIELDS, ROSTER_FIELDS, type RosterUnit, type StaffLine, type Tables, type UiResources, VISUAL_FIELDS, type VisualRecord, assertRecords } from './types';

export class DataError extends Error {
  override name = 'DataError';
  constructor(readonly file: string, message: string) {
    super(`${file}: ${message}`);
  }
}

/** Roster records must index existing table rows (spec §5.4, §12). */
export function validateRoster(recs: RosterUnit[], tables: Tables, file: string): void {
  recs.forEach((r, i) => {
    if (r.race < 0 || r.race >= tables.race.length) throw new DataError(file, `unit ${i} race ${r.race} out of range`);
    for (const k of ['weapon', 'armor', 'drop_item'] as const) {
      if (r[k] < 0 || r[k] >= tables.item.length) throw new DataError(file, `unit ${i} ${k} ${r[k]} out of range`);
    }
    if (r.level < 1 || r.level > 99) throw new DataError(file, `unit ${i} level ${r.level} out of range`);
    if (r.side < 0 || r.side > 7) throw new DataError(file, `unit ${i} side ${r.side} out of range`);
  });
}

/** Fetches tools/ft2_export.py data output (assets/data/*.json). Tables and the catalog are fetched once. */
export class DataLoader {
  private tablesP: Promise<Tables> | null = null;
  private battlesP: Promise<BattleEntry[]> | null = null;

  constructor(private readonly base = 'assets/data') {}

  tables(): Promise<Tables> {
    this.tablesP ??= (async () => {
      const [race, item, magic] = await Promise.all([this.json('race.json'), this.json('item.json'), this.json('magic.json')]);
      assertRecords(race, RACE_FIELDS, `${this.base}/race.json: record`);
      assertRecords(item, ITEM_FIELDS, `${this.base}/item.json: record`);
      assertRecords(magic, MAGIC_FIELDS, `${this.base}/magic.json: record`);
      return { race, item, magic } as Tables;
    })().catch((e: unknown) => { this.tablesP = null; throw e; });
    return this.tablesP;
  }

  async roster(n: number): Promise<RosterUnit[]> {
    const file = `${this.base}/roster/stage${String(n).padStart(3, '0')}.json`;
    const recs = await this.json(file, true);
    assertRecords(recs, ROSTER_FIELDS, `${file}: record`);
    validateRoster(recs as RosterUnit[], await this.tables(), file);
    return recs as RosterUnit[];
  }

  /** vsllst.dat records (assets/data/visual.json): which bitmap each visual scene slot holds. */
  async visual(): Promise<VisualRecord[]> {
    const list = await this.json('visual.json');
    assertRecords(list, VISUAL_FIELDS, `${this.base}/visual.json: record`);
    return list as VisualRecord[];
  }

  /** The ending's staff roll (assets/data/staff.json). */
  async staff(): Promise<StaffLine[]> {
    const list = await this.json('staff.json');
    if (!Array.isArray(list)) throw new DataError(`${this.base}/staff.json`, 'not a list');
    return list as StaffLine[];
  }

  /** Decoded event script of one stage (assets/data/eventNN.json). */
  async event(n: number): Promise<Program> {
    return loadProgram(n, await this.json(`event${String(n).padStart(2, '0')}.json`));
  }

  battles(): Promise<BattleEntry[]> {
    this.battlesP ??= (async () => {
      const list = await this.json('battles.json');
      assertRecords(list, BATTLE_FIELDS, `${this.base}/battles.json: entry`);
      return list as BattleEntry[];
    })().catch((e: unknown) => { this.battlesP = null; throw e; });
    return this.battlesP;
  }

  /** The original's dialog templates and menu 103 (assets/data/dialogs.json, menu.json): the Win32 chrome rebuilt from data. */
  async ui(): Promise<UiResources> {
    const [dialogs, menu] = await Promise.all([this.json('dialogs.json'), this.json('menu.json')]);
    if (typeof dialogs !== 'object' || dialogs === null || Array.isArray(dialogs)) throw new DataError(`${this.base}/dialogs.json`, 'not an object of templates');
    for (const [id, d] of Object.entries(dialogs as Record<string, Partial<DialogTemplate>>)) {
      if (typeof d.cx !== 'number' || typeof d.cy !== 'number' || !Array.isArray(d.items) || typeof d.title !== 'string') throw new DataError(`${this.base}/dialogs.json`, `dialog ${id}: no size, title or items`);
    }
    const items = (menu as Partial<MenuTemplate> | null)?.items;
    if (!Array.isArray(items) || items.length === 0) throw new DataError(`${this.base}/menu.json`, 'no menu items');
    return { dialogs: dialogs as Record<string, DialogTemplate>, menu: menu as MenuTemplate };
  }

  private async json(rel: string, absolute = false): Promise<unknown> {
    const path = absolute ? rel : `${this.base}/${rel}`;
    const res = await fetch(path);
    if (!res.ok) throw new DataError(path, `HTTP ${res.status}`);
    try { return await res.json(); } catch { throw new DataError(path, 'invalid JSON'); }
  }
}
