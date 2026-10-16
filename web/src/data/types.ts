// Field names follow tools/ft2_tables.py (spec D9).
export interface RaceData {
  name: string; exp_value: number;
  hp: number; hp_up: number; mp: number; mp_up: number; str: number; str_up: number; def: number; def_up: number;
  wis: number; wis_up: number; mgr: number; mgr_up: number; agi: number; agi_up: number;
  elem0: number; elem1: number; elem2: number; size: number; climb_max: number; drop_max: number;
  cost_land0: number; cost_land1: number; cost_land2: number; cost_land3: number;
  cost_land4: number; cost_land5: number; cost_land6: number; cost_land7: number;
  spell0: number; spell1: number; spell2: number; spell3: number;
}
export interface ItemData {
  name: string; price: number; hp_heal: number; mp_heal: number; atk: number; def: number; wis: number; mgr: number; agi: number;
  elem0: number; elem1: number; elem2: number; range_min: number; range_max: number; slot: number; use_effect: number;
  weapon_type: number; status_code: number; race_mask: number;
}
export interface MagicData {
  name: string; learn_level: number; mp_cost: number; elem0: number; elem1: number; elem2: number;
  range_min: number; range_max: number; effect: string; effect_no: number; target: number; shape: number; learn_mask: number; short: string;
}
export interface RosterUnit {
  unit_id: number; race: number; level: number; dir: number; c: number; r: number; status: number; side: number;
  weapon: number; armor: number; drop_item: number; drop_gold: number;
}
export interface BattleEntry { event: number; label: string; map: string; roster: number; episode: string; objective: string; heal: boolean }
export interface Tables { race: RaceData[]; item: ItemData[]; magic: MagicData[] }

export const RACE_FIELDS = ['name', 'exp_value', 'hp', 'hp_up', 'mp', 'mp_up', 'str', 'str_up', 'def', 'def_up', 'wis', 'wis_up', 'mgr', 'mgr_up', 'agi', 'agi_up', 'elem0', 'elem1', 'elem2', 'size', 'climb_max', 'drop_max', 'cost_land0', 'cost_land1', 'cost_land2', 'cost_land3', 'cost_land4', 'cost_land5', 'cost_land6', 'cost_land7', 'spell0', 'spell1', 'spell2', 'spell3'] as const;
export const ITEM_FIELDS = ['name', 'price', 'hp_heal', 'mp_heal', 'atk', 'def', 'wis', 'mgr', 'agi', 'elem0', 'elem1', 'elem2', 'range_min', 'range_max', 'slot', 'use_effect', 'weapon_type', 'status_code', 'race_mask'] as const;
export const MAGIC_FIELDS = ['name', 'learn_level', 'mp_cost', 'elem0', 'elem1', 'elem2', 'range_min', 'range_max', 'effect', 'effect_no', 'target', 'shape', 'learn_mask', 'short'] as const;
/** One vsllst.dat record (assets/data/visual.json): the bitmap a visual scene slot holds. */
export interface VisualRecord { scene: number; step: number; slot: number; name: string }
export const VISUAL_FIELDS = ['scene', 'step', 'slot', 'name'] as const;
/** data/staff.json: the staff roll of DATA/staff.lst (see TextLine in visual/timeline). */
export type StaffLine = { text: string; size: number; font: 'mincho' | 'gotic'; bold: boolean; gap: number } | { space: number };
export const ROSTER_FIELDS = ['unit_id', 'race', 'level', 'dir', 'c', 'r', 'status', 'side', 'weapon', 'armor', 'drop_item', 'drop_gold'] as const;
export const BATTLE_FIELDS = ['event', 'label', 'map', 'roster', 'episode', 'objective', 'heal'] as const;

/** Throws TypeError naming the first missing field of the first bad record. */
export function assertRecords(x: unknown, fields: readonly string[], what: string): void {
  if (!Array.isArray(x)) throw new TypeError(`${what} is not an array`);
  x.forEach((rec, i) => {
    const o = rec as Record<string, unknown>;
    for (const f of fields) if (!(f in o)) throw new TypeError(`${what} ${i} missing "${f}"`);
  });
}

/** Elemental vector of a race, item or magic record. */
export const elems = (r: { elem0: number; elem1: number; elem2: number }): [number, number, number] => [r.elem0, r.elem1, r.elem2];
export const costLand = (r: RaceData): number[] => [r.cost_land0, r.cost_land1, r.cost_land2, r.cost_land3, r.cost_land4, r.cost_land5, r.cost_land6, r.cost_land7];
export const raceSpells = (r: RaceData): number[] => [r.spell0, r.spell1, r.spell2, r.spell3];
