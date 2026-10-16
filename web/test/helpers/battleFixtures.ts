import type { MapCell, MapData } from '../../src/assets/types';
import type { RandomSource } from '../../src/battle/rng';
import type { Unit } from '../../src/battle/unit';
import type { ItemData, MagicData, RaceData, Tables } from '../../src/data/types';

export const RACE = (over: Partial<RaceData> = {}): RaceData => ({
  name: 'test', exp_value: 10, hp: 24, hp_up: 3, mp: 24, mp_up: 3, str: 18, str_up: 5, def: 14, def_up: 4, wis: 22, wis_up: 5,
  mgr: 12, mgr_up: 5, agi: 18, agi_up: 4, elem0: 0, elem1: 0, elem2: 0, size: 3, climb_max: 4, drop_max: 4,
  cost_land0: 99, cost_land1: 5, cost_land2: 5, cost_land3: 6, cost_land4: 7, cost_land5: 7, cost_land6: 8, cost_land7: 5,
  spell0: 0, spell1: 0, spell2: 0, spell3: 0, ...over,
});
export const ITEM = (over: Partial<ItemData> = {}): ItemData => ({
  name: 'item', price: 0, hp_heal: 0, mp_heal: 0, atk: 0, def: 0, wis: 0, mgr: 0, agi: 0, elem0: 0, elem1: 0, elem2: 0,
  range_min: 1, range_max: 1, slot: 0, use_effect: 0, weapon_type: 0, status_code: 0, race_mask: 0, ...over,
});
export const MAGIC = (over: Partial<MagicData> = {}): MagicData => ({
  name: 'magic', learn_level: 1, mp_cost: 6, elem0: 5, elem1: 0, elem2: 0, range_min: 1, range_max: 3, effect: 'BURST',
  effect_no: 1, target: 0, shape: 0, learn_mask: 1, short: '', ...over,
});

/** race 0 mage-like, 1 slime-like (strong def, low hp), 2 flying. item 0 none, 1 sword, 2 bow, 3 pike (line), 4 halberd (T), 5 armor, 6 poison dagger. magic 0 none, 1 burst (shape 1), 2 heal (shape 1, allies), 3 line (shape 2), 4 self-area (shape 3), 5 sleep (status), 6 quake (shape 4, map-wide). */
export function tables(over: Partial<Tables> = {}): Tables {
  return {
    race: [RACE(), RACE({ name: 'slime', hp: 12, hp_up: 4, str: 20, def: 22, agi: 12, size: 3 }), RACE({ name: 'bird', cost_land0: 4 })],
    item: [ITEM({ name: 'none', range_min: 0, range_max: 0 }), ITEM({ name: 'sword', atk: 10 }), ITEM({ name: 'bow', atk: 6, weapon_type: 3, range_min: 1, range_max: 7 }),
      ITEM({ name: 'pike', atk: 8, weapon_type: 1, range_min: 1, range_max: 2 }), ITEM({ name: 'halberd', atk: 9, weapon_type: 2 }),
      ITEM({ name: 'armor', slot: 1, def: 5 }), ITEM({ name: 'poison dagger', atk: 5, status_code: 2 })],
    magic: [MAGIC({ name: 'none', mp_cost: 0 }), MAGIC({ name: 'burst', shape: 1, range_min: 2, range_max: 6 }),
      MAGIC({ name: 'heal', shape: 1, target: 1, elem0: 0, elem2: 1, range_min: 0, range_max: 6, learn_mask: 2 }),
      MAGIC({ name: 'line', shape: 2, range_min: 1, range_max: 4 }), MAGIC({ name: 'area', shape: 3, range_min: 1, range_max: 2 }),
      MAGIC({ name: 'sleep', shape: 0, elem0: 0, elem1: 3, learn_level: 2 }), MAGIC({ name: 'quake', shape: 4, range_min: 0, range_max: 0, learn_mask: 0 })],
    ...over,
  };
}

export function unit(over: Partial<Unit> & { slot: number }): Unit {
  return {
    id: 1, race: 0, level: 1, dir: 0, c: 0, r: 0, status: 0, side: 0, weapon: 1, armor: 0, acc: [0, 0], dropItem: 0, dropGold: 0,
    hpMax: 30, hp: 30, mpMax: 20, mp: 20, exp: 0, str: 20, def: 10, wis: 10, mgr: 10, agi: 10, spells: [],
    buff: { str: 0, def: 0, wis: 0, mgr: 0, agi: 0 }, elem: [0, 0, 0], moved: false, acted: false, special: false, statusCounter: 0,
    ...over,
  };
}

/** 50-slot unit array with each unit in its slot. */
export function units(...us: Unit[]): (Unit | null)[] {
  const out = new Array<Unit | null>(50).fill(null);
  for (const u of us) out[u.slot] = u;
  return out;
}

/** Deterministic RandomSource cycling through `values` (each already reduced: callers use them as 0..n-1). */
export function fixedRng(values: number[]): RandomSource & { calls: number } {
  let i = 0;
  return { calls: 0, rand(n: number) { this.calls++; const v = values[i++ % values.length]!; return n > 0 ? v % n : v; } };
}

/** N×N diagonal grid with every (c, r) present (w = N, h = 1 → gridSize N). `edit` overrides cell fields per position. */
export function flatMap(N: number, edit: (c: number, r: number) => Partial<MapCell> = () => ({})): MapData {
  const cells: MapCell[] = [];
  const cellAt = new Array<number>(N * N).fill(-1);
  for (let c = 0; c < N; c++) {
    for (let r = 0; r < N; r++) {
      cellAt[c * N + r] = cells.length;
      cells.push({ h: 0, blocked: 0, flag2: 0, land: 1, objs: [], ...edit(c, r) });
    }
  }
  return { w: N, h: 1, bg: null, layers: [], start: [0, 0], origin: [N * 32, 0], pixelSize: [Math.max(640, N * 64), Math.max(480, N * 32)], cells, cellAt };
}
