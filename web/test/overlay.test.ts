import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { computeMoveRange, markTargets, RangeTable } from '../src/battle/moveRange';
import { overlaySprites } from '../src/field/overlay';
import { flatMap, RACE, tables, unit, units } from './helpers/battleFixtures';

const grid = new BattleGrid(flatMap(7));
const hero = unit({ slot: 0, c: 3, r: 3 }), ally = unit({ slot: 1, c: 4, r: 3 }), foe = unit({ slot: 10, c: 3, r: 5, side: 4 });
const all = units(hero, ally, foe);

describe('overlaySprites', () => {
  it('menu/move: MOVE tiles on stoppable cells, cursor FRIEND over them and CURSOR elsewhere', () => {
    const range = computeMoveRange(grid, all, hero, RACE());
    const out = overlaySprites({ mode: 'move', slot: 0, range }, all, [3, 2]);
    const tiles = out.filter((o) => o.anim === 'MOVE');
    expect(tiles.some((o) => o.c === 4 && o.r === 3)).toBe(false);          // ally stands there
    expect(tiles.some((o) => o.c === 3 && o.r === 2)).toBe(true);
    expect(tiles.every((o) => o.layer === 1)).toBe(true);
    expect(out.find((o) => o.c === 3 && o.r === 2 && o.anim !== 'MOVE')!.anim).toBe('FRIEND');
    expect(overlaySprites({ mode: 'move', slot: 0, range }, all, [0, 6]).find((o) => o.c === 0 && o.r === 6)!.anim).toBe('CURSOR');
  });
  it('target: ATTACK tiles on marked cells, ENEMY cursor over an enemy cell', () => {
    const range = new RangeTable(3, 3);
    markTargets(range, grid, all, hero, 1, tables());                         // burst 2..6
    const out = overlaySprites({ mode: 'target', slot: 0, action: 1, range }, all, [3, 5]);
    expect(out.filter((o) => o.anim === 'ATTACK').length).toBeGreaterThan(10);
    expect(out.find((o) => o.c === 3 && o.r === 5 && o.anim !== 'ATTACK')!.anim).toBe('ENEMY');
  });
  it('face: four TURN arrows around the unit, the hovered one selected; idle shows only the cursor', () => {
    const out = overlaySprites({ mode: 'face', slot: 0 }, all, [3, 4]);
    expect(out.map((o) => o.anim).sort()).toEqual(['S.TURN_SOUTH', 'TURN_EAST', 'TURN_NORTH', 'TURN_WEST']);
    expect(out.find((o) => o.anim === 'TURN_NORTH')).toMatchObject({ c: 3, r: 2, layer: 5 });
    expect(overlaySprites({ mode: 'idle' }, all, [1, 1])).toEqual([{ c: 1, r: 1, anim: 'CURSOR', layer: 1 }]);
    expect(overlaySprites({ mode: 'idle' }, all, null)).toEqual([]);
  });
});
