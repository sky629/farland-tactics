import { describe, expect, it } from 'vitest';
import { emptyInventory } from '../src/battle/inventory';
import { chooseAction } from '../src/battle/ai';
import { BattleGrid, dist } from '../src/battle/grid';
import { Rng } from '../src/battle/rng';
import type { BattleState } from '../src/battle/types';
import { flatMap, MAGIC, tables, unit, units } from './helpers/battleFixtures';

const entry = { event: 1, label: 'x', map: 'stage49', roster: 49, episode: '', objective: '', heal: true };
function state(map = flatMap(11), us = units()): BattleState {
  return { entry, map, grid: new BattleGrid(map), units: us, turn: 1, phase: { kind: 'enemy', queue: [] }, rng: Rng.fromSeed(1), lastPath: [], inventory: emptyInventory() };
}
const t = tables();

describe('chooseAction (FUN_004118b0 / FUN_00411b10)', () => {
  it('walks next to the nearest hero and attacks it', () => {
    const slime = unit({ slot: 10, id: 8, race: 1, side: 4, c: 5, r: 2, weapon: 1, moved: false, acted: false });
    const hero = unit({ slot: 0, c: 5, r: 6 });
    const d = chooseAction(state(flatMap(11), units(hero, slime)), slime, t);
    expect(dist(d.dest[0], d.dest[1], 5, 6)).toBe(1);
    expect(d.action).toBe(0);
    expect(d.cell).toEqual([5, 6]);
    expect(d.path.length).toBeGreaterThan(0);
  });
  it("prefers the hero's back when both adjacent cells are reachable", () => {
    const slime = unit({ slot: 10, id: 8, race: 1, side: 4, c: 5, r: 3, weapon: 1, moved: false, acted: false });
    const hero = unit({ slot: 0, c: 5, r: 5, dir: 0 });                 // faces +r: its back is (5,4)
    const d = chooseAction(state(flatMap(11), units(hero, slime)), slime, t);
    expect(d.dest).toEqual([5, 4]);
  });
  it('a unit that already acted (passive mode) moves away from enemies and does nothing', () => {
    const slime = unit({ slot: 10, id: 8, race: 1, side: 4, c: 5, r: 4, weapon: 1, moved: false, acted: true });
    const hero = unit({ slot: 0, c: 5, r: 6 });
    const d = chooseAction(state(flatMap(11), units(hero, slime)), slime, t);
    expect(dist(d.dest[0], d.dest[1], 5, 6)).toBeGreaterThan(2);
    expect(d.action).toBeNull();
  });
  it('stays and turns toward the nearest enemy when nothing is reachable', () => {
    const map = flatMap(11, (c, r) => (dist(c, r, 2, 2) === 1 ? { blocked: 1 } : {}));
    const slime = unit({ slot: 10, id: 8, race: 1, side: 4, c: 2, r: 2, weapon: 1, moved: false, acted: false });
    const hero = unit({ slot: 0, c: 9, r: 2 });
    const d = chooseAction(state(map, units(hero, slime)), slime, t);
    expect(d).toEqual({ dest: [2, 2], path: [], action: null, cell: null, faceDir: 1 });
  });
  it('a healer casts healing on a wounded ally instead of attacking', () => {
    const magic = t.magic.slice(); magic[40] = MAGIC({ name: 'healing', shape: 1, target: 1, elem0: 0, elem2: 1, range_min: 0, range_max: 6 });
    const tt = { ...t, magic };
    const healer = unit({ slot: 10, id: 8, race: 0, side: 4, c: 5, r: 5, weapon: 1, spells: [40], mp: 20, moved: false, acted: false });
    const wounded = unit({ slot: 11, id: 8, race: 1, side: 4, c: 7, r: 5, hp: 3, hpMax: 30 });
    const hero = unit({ slot: 0, c: 5, r: 9 });
    const d = chooseAction(state(flatMap(11), units(hero, healer, wounded)), healer, tt);
    expect(d.action).toBe(40);
    expect(d.cell).toEqual([7, 5]);
  });
  it('is deterministic', () => {
    const mk = () => { const slime = unit({ slot: 10, id: 8, race: 1, side: 4, c: 3, r: 3, weapon: 1, moved: false, acted: false }); return chooseAction(state(flatMap(11), units(unit({ slot: 0, c: 8, r: 8 }), slime)), slime, t); };
    expect(mk()).toEqual(mk());
  });
});
