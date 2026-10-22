import type { ApdData } from '../../src/assets/types';
import { BattleGrid } from '../../src/battle/grid';
import { emptyInventory } from '../../src/battle/inventory';
import type { BattleState } from '../../src/battle/types';
import { MapModel } from '../../src/map/mapModel';
import { ApdModel } from '../../src/sprite/apdModel';
import { fixedRng, flatMap, tables, unit, units } from './battleFixtures';

/** One 8×8 image; every anim is 2 frames × 100 ms unless named otherwise. */
let apdSeq = 0;
export function apd(anims: Record<string, string>): ApdModel {
  const data: ApdData = { version: 3, sheets: ['s'], images: [{ sheet: 0, key: 255, x: 0, y: 0, w: 8, h: 8, ox: -4, oy: -8 }],
    patterns: [{ yOffset: 0, images: [0] }], anims: Object.entries(anims).map(([name, script]) => ({ name, script })) };
  return new ApdModel(`apd${++apdSeq}`, data, [{ width: 8, height: 8, indices: new Uint8Array(64), palette: new Uint8Array(768) }]);
}
export const hero = apd({ 'F.STAND': 'P0', 'B.STAND': 'P0', 'F.COMPLETE': 'P0', 'F.SET': 'P0', 'F.MIDDLE_DAMAGE': 'S100 P0 P0', 'F.DEAD': 'P0', 'F.DOWN_DAMAGE': 'P0', 'F.DEFENSE': 'S100 P0 P0' });
export const heroB = apd({ 'F.RUN1': 'S100 P0 P0', 'F.RUN2': 'S100 P0 P0', 'B.RUN1': 'S100 P0 P0', 'B.RUN2': 'S100 P0 P0', 'F.WALK1': 'S100 P0 P0', 'F.ATTACK1': 'S150 P0 P0' });
export const heroE = apd({ 'F.CAST1A': 'S100 P0 P0', 'F.CAST1B': 'S100 P0 P0' });
export const slime = apd({ 'F.STAND': 'P0', 'B.STAND': 'P0', 'F.DOWN_DAMAGE': 'P0', 'F.MIDDLE_DAMAGE': 'S100 P0 P0', 'F.DEFENSE': 'S100 P0 P0' });
export const walkerB = apd({ 'F.WALK1': 'S100 P0 P0', 'F.WALK2': 'S100 P0 P0' });
export const flyerB = apd({ 'F.FLY1': 'S100 P0 P0', 'F.FLY2': 'S100 P0 P0' });
export const chest = apd({ 'F.STAND': 'P0', 'F.HIDE': 'P0', 'B.STAND': 'P0', 'B.HIDE': 'P0' });
export const healing = apd({ 'HEAL': 'S100 P0 P0' });
export const system = apd({ 'LARGE.M': 'P0', 'F.SWEAT': 'S100 P0 P0', 'HUGE.M': 'P0', 'MOVE': 'P0', 'ATTACK': 'P0', 'CURSOR': 'P0', 'ENEMY': 'P0', 'FRIEND': 'P0', 'POISON': 'P0', 'TURN_NORTH': 'P0', 'TURN_SOUTH': 'P0', 'TURN_EAST': 'P0', 'TURN_WEST': 'P0', 'S.TURN_NORTH': 'P0' });
export const number = apd(Object.fromEntries([...Array(10).keys()].flatMap((d) => [[`POP_${d}`, 'P0'], [`B_POP_${d}`, 'P0']])));
export const files: Record<string, ApdModel> = { char_00a: hero, char_00b: heroB, char_00e: heroE, char_01a: slime, char_02a: hero, char_02b: walkerB, char_04a: hero, char_04b: flyerB, char_09a: chest, healing, system, number };
export const provider = { apd: (name: string) => files[name] ?? null };

export const entry = { event: 1, label: 'x', map: 'stage49', roster: 49, episode: '', objective: '', heal: true };
export function state(): BattleState {
  const map = flatMap(9);
  const h = unit({ slot: 0, c: 2, r: 4, race: 0 }), s = unit({ slot: 10, c: 6, r: 4, race: 1, side: 4, id: 8, hp: 12, hpMax: 12 });
  return { entry, map, grid: new BattleGrid(map), units: units(h, s), turn: 1, phase: { kind: 'player', sel: { mode: 'idle' } }, rng: fixedRng([0]), lastPath: [], inventory: emptyInventory() };
}
export const mapModel = (s: BattleState) => new MapModel(s.map, [], null);
/** item 7 uses magic 1 whose effect APD is "healing"; item 8 uses magic 2 whose effect is "0" (none). */
export const itemTables = tables();
itemTables.item[7] = { ...itemTables.item[7]!, use_effect: 1 };
itemTables.item[8] = { ...itemTables.item[8]!, use_effect: 2 };
itemTables.magic[1] = { ...itemTables.magic[1]!, effect: 'HEALING' };
itemTables.magic[2] = { ...itemTables.magic[2]!, effect: '0' };

