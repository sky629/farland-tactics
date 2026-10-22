import { raceSpells, type ItemData, type MagicData, type RaceData, type RosterUnit, type Tables } from '../data/types';
import type { RandomSource } from './rng';

export const PARTY_SLOTS = 10;
export const MAX_SLOTS = 50;

/** Presentation state the story scripts set on a unit (the original keeps sprite handles in the unit record too). */
export interface SpriteOverride { apd?: string; layer?: number; anim?: { name: string; loop: boolean; force: boolean }; hidden?: boolean; offset?: { x: number; y: number }; marker?: boolean; bare?: boolean }
// bare: a sprite record just made by LOAD_SPRITE / SPRITE_REUSE / ATTACH_SPRITE / RESPRITE_UNIT — anim −1 (FUN_00429630), so nothing is drawn and the field's body pose does not apply
//       until an ANIM or a rebuild of the unit's sprites (FUN_0041e9e0: SET_DIR, FACE_UNIT, WAIT_UNIT, LOAD_UNITS, BATTLE_START, the EXT unit ops).

/** The battle-relevant fields of the original 124-byte unit record (battle_rules.md §7). */
export interface Unit {
  slot: number;
  id: number; race: number; level: number; dir: 0 | 1 | 2 | 3; c: number; r: number;
  status: number; side: number;
  weapon: number; armor: number; acc: [number, number];
  dropItem: number; dropGold: number;
  bag: number[];                       // 4 equipment slots of a party unit (words 0xe..0x11; battle_rules.md §4.3)
  sprite?: SpriteOverride;             // script-driven sprite state (story_flow.md); absent for plain battle units
  hpMax: number; hp: number; mpMax: number; mp: number; exp: number;
  str: number; def: number; wis: number; mgr: number; agi: number;
  spells: number[];
  buff: { str: number; def: number; wis: number; mgr: number; agi: number };
  elem: [number, number, number];
  moved: boolean; acted: boolean; special: boolean;
  statusCounter: number;
}

export function itemsOf(u: Unit, items: ItemData[]): [ItemData, ItemData, ItemData, ItemData] {
  const at = (i: number) => items[i] ?? items[0]!;
  return [at(u.weapon), at(u.armor), at(u.acc[0]), at(u.acc[1])];
}

const STAT_PAIRS = [['hpMax', 'hp_up'], ['mpMax', 'mp_up'], ['str', 'str_up'], ['def', 'def_up'],
  ['wis', 'wis_up'], ['mgr', 'mgr_up'], ['agi', 'agi_up']] as const;

/** Party spell list: every magic whose learn_mask has bit (id-1) and 0 < learn_level ≤ level. Returns the ones learned exactly at this level. */
export function rebuildSpells(u: Unit, magic: MagicData[]): number[] {
  const bit = 1 << (u.id - 1);
  const learned: number[] = [];
  u.spells = [];
  magic.forEach((m, i) => {
    if (i === 0 || !(m.learn_mask & bit) || m.learn_level <= 0 || m.learn_level > u.level) return;
    u.spells.push(i);
    if (m.learn_level === u.level) learned.push(i);
  });
  return learned;
}

/** FUN_0041f7c0: one level of growth. With randomize, each stat draws rand(3)-1 twice (bound check, then value). */
export function growUnit(u: Unit, race: RaceData, randomize: boolean, rng: RandomSource, magic: MagicData[]): number[] {
  for (const [statKey, upKey] of STAT_PAIRS) {
    const up = race[upKey];
    const probe = u[statKey] + up + (randomize ? rng.rand(3) - 1 : 0);
    u[statKey] = probe < 1000 ? u[statKey] + up + (randomize ? rng.rand(3) - 1 : 0) : 999;
  }
  if (u.status !== 1) { u.hp = u.hpMax; u.mp = u.mpMax; }
  return u.side === 0 ? rebuildSpells(u, magic) : [];
}

/** FUN_0041fae0 for a fresh slot: base stats, (level-1) growths (random only for non-party), status, exp, monster spells. */
export function createUnit(rec: RosterUnit, slot: number, tables: Tables, rng: RandomSource): Unit {
  const u: Unit = {
    slot, id: rec.unit_id, race: rec.race, level: rec.level, dir: (rec.dir & 3) as 0 | 1 | 2 | 3, c: rec.c, r: rec.r,
    status: rec.status, side: rec.side, weapon: rec.weapon, armor: rec.armor, acc: [0, 0], dropItem: rec.drop_item, dropGold: rec.drop_gold, bag: [0, 0, 0, 0],
    hpMax: 0, hp: 0, mpMax: 0, mp: 0, exp: 0, str: 0, def: 0, wis: 0, mgr: 0, agi: 0, spells: [],
    buff: { str: 0, def: 0, wis: 0, mgr: 0, agi: 0 }, elem: [0, 0, 0], moved: true, acted: true, special: false, statusCounter: 0,
  };
  const race = tables.race[rec.race];
  if (race && rec.side !== 7) {
    u.hpMax = u.hp = race.hp; u.mpMax = u.mp = race.mp;
    u.str = race.str; u.def = race.def; u.wis = race.wis; u.mgr = race.mgr; u.agi = race.agi;
    for (let lv = 2; lv <= rec.level; lv++) growUnit(u, race, rec.side !== 0, rng, tables.magic);
    if (u.status === 1) u.hp = 0;
    else if (u.status !== 0) u.statusCounter = 100;
    u.exp = (u.level - 1) * 100;
    if (u.id > 7) u.spells = raceSpells(race).filter((m) => m !== 0);
  }
  return u;
}

/** A thing to pick up: an object (side 7) of the drop races — 8 보물상자 (an item), 9 금 (gold) — whether a roster's chest or a fallen
 *  unit's drop (FUN_0043a2e0 case 9 turns the unit into one and keeps its id). Story objects (잃어버린 어린이, 붙잡힌 루루 …) have their own races. */
export const isTreasure = (u: Unit): boolean => u.side === 7 && (u.race === 8 || u.race === 9);
