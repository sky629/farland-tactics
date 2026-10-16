import { describe, expect, it } from 'vitest';
import type { ApdData } from '../src/assets/types';
import { BattleGrid } from '../src/battle/grid';
import type { BattleState } from '../src/battle/types';
import { Presenter, POPUP_MS, STEP_MS } from '../src/field/presenter';
import { MapModel } from '../src/map/mapModel';
import { ApdModel } from '../src/sprite/apdModel';
import { fixedRng, flatMap, tables, unit, units } from './helpers/battleFixtures';

/** One 8×8 image; every anim is 2 frames × 100 ms unless named otherwise. */
function apd(anims: Record<string, string>): ApdModel {
  const data: ApdData = { version: 3, sheets: ['s'], images: [{ sheet: 0, key: 255, x: 0, y: 0, w: 8, h: 8, ox: -4, oy: -8 }],
    patterns: [{ yOffset: 0, images: [0] }], anims: Object.entries(anims).map(([name, script]) => ({ name, script })) };
  return new ApdModel('x', data, [{ width: 8, height: 8, indices: new Uint8Array(64), palette: new Uint8Array(768) }]);
}
const hero = apd({ 'F.STAND': 'P0', 'B.STAND': 'P0', 'F.COMPLETE': 'P0', 'F.RUN1': 'S100 P0 P0', 'F.RUN2': 'S100 P0 P0', 'F.ATTACK1': 'S150 P0 P0', 'F.MIDDLE_DAMAGE': 'S100 P0 P0', 'F.DEAD': 'P0', 'F.DOWN_DAMAGE': 'P0', 'F.DEFENSE': 'S100 P0 P0' });
const slime = apd({ 'F.STAND': 'P0', 'B.STAND': 'P0', 'F.DOWN_DAMAGE': 'P0', 'F.MIDDLE_DAMAGE': 'S100 P0 P0', 'F.DEFENSE': 'S100 P0 P0' });
const system = apd({ 'LARGE.M': 'P0', 'HUGE.M': 'P0', 'MOVE': 'P0', 'ATTACK': 'P0', 'CURSOR': 'P0', 'ENEMY': 'P0', 'FRIEND': 'P0', 'POISON': 'P0', 'TURN_NORTH': 'P0', 'TURN_SOUTH': 'P0', 'TURN_EAST': 'P0', 'TURN_WEST': 'P0', 'S.TURN_NORTH': 'P0' });
const number = apd(Object.fromEntries([...Array(10).keys()].flatMap((d) => [[`POP_${d}`, 'P0'], [`B_POP_${d}`, 'P0']])));
const provider = { apd: (name: string) => (name === 'char_00a' ? hero : name === 'char_01a' ? slime : name === 'system' ? system : name === 'number' ? number : null) };

const entry = { event: 1, label: 'x', map: 'stage49', roster: 49, episode: '', objective: '', heal: true };
function state(): BattleState {
  const map = flatMap(9);
  const h = unit({ slot: 0, c: 2, r: 4, race: 0 }), s = unit({ slot: 10, c: 6, r: 4, race: 1, side: 4, id: 8, hp: 12, hpMax: 12 });
  return { entry, map, grid: new BattleGrid(map), units: units(h, s), turn: 1, phase: { kind: 'player', sel: { mode: 'idle' } }, rng: fixedRng([0]), lastPath: [] };
}
const mapModel = (s: BattleState) => new MapModel(s.map, [], null);

describe('Presenter', () => {
  it('draws body, shadow and no icon for a healthy unit; nothing for an unknown APD', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    p.sync(s);
    const { sprites } = p.scene(mapModel(s), s);
    const hero0 = sprites.filter((sp) => sp.c === 2 && sp.r === 4);
    expect(hero0.map((sp) => sp.layer).sort()).toEqual([2, 4]);
    s.units[0]!.race = 2;                                      // char_02a is not provided
    p.sync(s);
    expect(p.scene(mapModel(s), s).sprites.filter((sp) => sp.c === 2 && sp.r === 4)).toHaveLength(0);
  });
  it('a moved event walks the snapshot one cell per STEP_MS with a pixel offset in between', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    p.sync(s);
    s.units[0]!.c = 5; s.units[0]!.moved = true;               // the rules already moved the unit
    p.enqueue([{ type: 'moved', slot: 0, path: [1, 1, 1], to: [5, 4] }]);
    expect(p.busy).toBe(true);
    p.update(0);
    p.update(STEP_MS / 2);
    const mid = p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.model === hero)!;
    expect(mid.c).toBe(2);
    expect(mid.offset!.x).toBe(16);                            // half a cell east = 32 px / 2
    p.update(STEP_MS * 3 + 1);
    p.update(STEP_MS * 3 + 2);
    expect(p.busy).toBe(false);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.model === hero)).toMatchObject({ c: 5, r: 4 });
    expect(p.focus).toEqual([5, 4]);
  });
  it('an action plays the attack anim, then the reaction anim with a number popup, then settles', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    s.units[0]!.c = 5; s.units[0]!.dir = 1;
    p.sync(s);
    s.units[10]!.hp = 4;
    p.enqueue([{ type: 'action', slot: 0, action: 0, cell: [6, 4], hits: [{ target: 10, kind: 'damage', value: 8, crit: false, popup: '8', statusAfter: 0 }] }]);
    p.update(0);
    expect(p.busy).toBe(true);
    p.update(100);
    expect(p.scene(mapModel(s), s).sprites.some((sp) => sp.model === number)).toBe(false);   // still attacking (300 ms)
    p.update(350);
    const popups = p.scene(mapModel(s), s).sprites.filter((sp) => sp.model === number);
    expect(popups).toHaveLength(1);                            // one digit "8"
    expect(popups[0]).toMatchObject({ c: 6, r: 4, layer: 5 });
    p.update(300 + POPUP_MS + 1);
    p.update(300 + POPUP_MS + 2);
    expect(p.busy).toBe(false);
  });
  it('falls back to STAND when the body APD lacks RUN and ATTACK and still finishes the queue', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    p.sync(s);
    s.units[10]!.c = 3;
    p.enqueue([
      { type: 'moved', slot: 10, path: [2, 2, 2], to: [3, 4] },
      { type: 'action', slot: 10, action: 0, cell: [2, 4], hits: [{ target: 0, kind: 'miss', value: 0, crit: false, popup: 'miss!', statusAfter: 0 }] },
    ]);
    let now = 0;
    while (p.busy && now < 10_000) { p.update(now); now += 50; }
    expect(p.busy).toBe(false);
    expect(now).toBeLessThan(10_000);
    p.update(now);
    expect(p.scene(mapModel(s), s).texts).toEqual([]);          // the "miss!" text has expired
  });
  it('a dead unit shows its death pose only after the hit step and removal hides it', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    s.units[0]!.c = 5; s.units[0]!.dir = 1;
    p.sync(s);
    s.units[10] = null;
    p.enqueue([
      { type: 'action', slot: 0, action: 0, cell: [6, 4], hits: [{ target: 10, kind: 'damage', value: 12, crit: true, popup: '12', statusAfter: 1 }] },
      { type: 'died', slot: 10 }, { type: 'removed', slot: 10 },
    ]);
    p.update(0); p.update(100);
    expect(p.scene(mapModel(s), s).sprites.some((sp) => sp.model === slime)).toBe(true);
    let now = 100;
    while (p.busy && now < 10_000) { p.update(now); now += 50; }
    expect(p.scene(mapModel(s), s).sprites.some((sp) => sp.model === slime)).toBe(false);
  });
});
