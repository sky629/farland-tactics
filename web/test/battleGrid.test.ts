import { describe, expect, it } from 'vitest';
import { BattleGrid, dirTo, dist, hostile, incap, opposite, stepCell, unitAt, unitsWithin } from '../src/battle/grid';
import { flatMap, unit, units } from './helpers/battleFixtures';

describe('geometry (FUN_0041f2e0 / FUN_0041f4d0 / FUN_0041f340)', () => {
  it('Manhattan distance and direction with the |dx|>|dy| rule', () => {
    expect(dist(0, 0, 3, -2)).toBe(5);
    expect(dirTo(0, 0, 3, 1)).toBe(1);   // +x wins
    expect(dirTo(0, 0, -3, 1)).toBe(2);
    expect(dirTo(0, 0, 1, 1)).toBe(0);   // tie → y axis, dy >= 0 → 0
    expect(dirTo(0, 0, 1, -1)).toBe(3);
    expect(dirTo(0, 0, 0, 0)).toBe(0);
  });
  it('opposite is d ^ 3 and stepCell follows DIR_DELTA', () => {
    expect([0, 1, 2, 3].map((d) => opposite(d as 0 | 1 | 2 | 3))).toEqual([3, 2, 1, 0]);
    expect(stepCell(5, 5, 0)).toEqual([5, 6]);
    expect(stepCell(5, 5, 1)).toEqual([6, 5]);
    expect(stepCell(5, 5, 2)).toEqual([4, 5]);
    expect(stepCell(5, 5, 3)).toEqual([5, 4]);
  });
});

describe('hostile (FUN_0041f520) and incap', () => {
  const ally = unit({ slot: 0, side: 0 }), ally2 = unit({ slot: 1, side: 0 }), enemy = unit({ slot: 10, side: 4 });
  it('party vs non-party are hostile; same camp, side 1 and side 7 are not', () => {
    expect(hostile(ally, enemy)).toBe(true);
    expect(hostile(enemy, ally)).toBe(true);
    expect(hostile(ally, ally2)).toBe(false);
    expect(hostile(unit({ slot: 11, side: 4 }), unit({ slot: 12, side: 6 }))).toBe(false);   // both non-party
    expect(hostile(ally, unit({ slot: 13, side: 1 }))).toBe(false);
    expect(hostile(ally, unit({ slot: 14, side: 7 }))).toBe(false);
    expect(hostile(ally, ally)).toBe(false);
  });
  it('a charmed actor inverts the test', () => {
    expect(hostile(unit({ slot: 0, side: 0, status: 7 }), enemy)).toBe(false);
    expect(hostile(unit({ slot: 0, side: 0, status: 7 }), ally2)).toBe(true);
  });
  it('incapacitating statuses are 1, 3, 4, 5, 8, 9', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11].filter(incap)).toEqual([1, 3, 4, 5, 8, 9]);
  });
});

describe('BattleGrid and unit lookup', () => {
  const grid = new BattleGrid(flatMap(5, (c, r) => (c === 2 && r === 2 ? { h: 3 } : {})));
  it('returns cells inside the grid and null outside', () => {
    expect(grid.N).toBe(5);
    expect(grid.cell(2, 2)?.h).toBe(3);
    expect(grid.height(2, 2)).toBe(3);
    expect(grid.cell(5, 0)).toBeNull();
    expect(grid.cell(-1, 0)).toBeNull();
    expect(grid.height(-1, 0)).toBe(0);
  });
  it('finds units by position and by distance range in slot order, skipping hidden units', () => {
    const a = unit({ slot: 0, c: 1, r: 1 }), b = unit({ slot: 10, c: 3, r: 1, side: 4 }), hidden = unit({ slot: 11, c: 1, r: 3, status: 9, side: 4 });
    const all = units(a, b, hidden);
    expect(unitAt(all, 3, 1)).toBe(b);
    expect(unitAt(all, 1, 3)).toBeNull();
    expect(unitsWithin(all, 1, 1, 1, 2)).toEqual([b]);
    expect(unitsWithin(all, 1, 1, 0, 0)).toEqual([a]);
  });
});
