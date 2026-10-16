import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { canStop, computeMoveRange, markTargets, pathTo, RangeTable } from '../src/battle/moveRange';
import { flatMap, RACE, tables, unit, units } from './helpers/battleFixtures';

const race = RACE();   // cost_land1 = 5, climb 4, drop 4

describe('RangeTable', () => {
  it('maps a 21×21 window around the center and reports outside as -1 / 0', () => {
    const t = new RangeTable(10, 10);
    expect(t.index(10, 10)).toBe(10 * 21 + 10);
    expect(t.index(0, 20)).toBe(0 * 21 + 20);
    expect(t.index(21, 10)).toBe(-1);
    t.setMove(12, 9, 7);
    expect(t.moveAt(12, 9)).toBe(7);
    expect(t.moveAt(99, 99)).toBe(0);
  });
});

describe('computeMoveRange (FUN_00439690 / FUN_00439b40)', () => {
  it('spends land cost per step from a budget of 30', () => {
    const grid = new BattleGrid(flatMap(7));
    const u = unit({ slot: 0, c: 3, r: 3 });
    const t = computeMoveRange(grid, units(u), u, race);
    expect(t.moveAt(3, 3)).toBe(30);
    expect(t.moveAt(4, 3)).toBe(25);
    expect(t.moveAt(6, 3)).toBe(15);
    expect(t.moveAt(6, 5)).toBe(5);     // distance 5
    expect(t.moveAt(6, 6)).toBe(0);     // distance 6 → 30 − 30 = 0 → not reachable
  });
  it('detours around blocked cells and ignores height within climb/drop limits', () => {
    const grid = new BattleGrid(flatMap(7, (c, r) => (c === 4 && r === 3 ? { blocked: 1 } : c === 2 && r === 3 ? { h: 5 } : c === 3 && r === 2 ? { h: 4 } : {})));
    const u = unit({ slot: 0, c: 3, r: 3 });
    const t = computeMoveRange(grid, units(u), u, race);
    expect(t.moveAt(4, 3)).toBe(0);
    expect(t.moveAt(5, 3)).toBe(10);    // four steps around the block
    expect(t.moveAt(2, 3)).toBe(0);     // climb 5 > 4
    expect(t.moveAt(3, 2)).toBe(25);    // climb 4 allowed
  });
  it('a cell next to a hostile unit keeps only 1 move point (ZOC); flag2 and occupied cells count as land 0 (impassable on foot)', () => {
    const grid = new BattleGrid(flatMap(7, (c, r) => (c === 3 && r === 4 ? { flag2: 1 } : {})));
    const u = unit({ slot: 0, c: 3, r: 3 });
    const e = unit({ slot: 10, c: 5, r: 3, side: 4 }), ally = unit({ slot: 1, c: 2, r: 3 }), chest = unit({ slot: 20, c: 3, r: 2, id: 8, side: 7 });
    const t = computeMoveRange(grid, units(u, e, ally, chest), u, race);
    expect(t.moveAt(4, 3)).toBe(1);
    expect(t.moveAt(3, 4)).toBe(0);     // flag2 → land 0 → cost 99 for a ground race
    expect(t.moveAt(2, 3)).toBe(0);     // an ally blocks the cell (FUN_0041f410: occupied → land 0)
    expect(t.moveAt(1, 3)).toBe(10);    // reached around the ally in four steps via (3,2) → (2,2) → (1,2)
    expect(t.moveAt(3, 2)).toBe(25);    // a treasure object (side 7) does not block
    expect(t.moveAt(5, 3)).toBe(0);     // the enemy's own cell is land 0 as well
    const bird = computeMoveRange(grid, units(u, e, ally, chest), { ...u, race: 2 }, RACE({ cost_land0: 4 }));
    expect(bird.moveAt(3, 4)).toBe(26); // flying races pay cost_land0 on flag2 cells
  });
  it('a unit that already moved, is incapacitated, or has side 3 only owns its cell', () => {
    const grid = new BattleGrid(flatMap(5));
    for (const u of [unit({ slot: 0, c: 2, r: 2, moved: true }), unit({ slot: 0, c: 2, r: 2, status: 3 }), unit({ slot: 10, c: 2, r: 2, side: 3 })]) {
      const t = computeMoveRange(grid, units(u), u, race);
      expect(t.moveAt(2, 2)).toBe(30);
      expect(t.moveAt(3, 2)).toBe(0);
    }
  });
  it('flying races ignore height limits and enter land 0', () => {
    const grid = new BattleGrid(flatMap(5, (c, r) => (c === 3 && r === 2 ? { h: 20, land: 0 } : {})));
    const u = unit({ slot: 0, c: 2, r: 2, race: 2 });
    const t = computeMoveRange(grid, units(u), u, RACE({ cost_land0: 4 }));
    expect(t.moveAt(3, 2)).toBe(26);
  });
});

describe('markTargets', () => {
  it('marks hostile units in weapon range as kind 1 and skips allies', () => {
    const grid = new BattleGrid(flatMap(7));
    const u = unit({ slot: 0, c: 3, r: 3, weapon: 1 });
    const e = unit({ slot: 10, c: 4, r: 3, side: 4 }), far = unit({ slot: 11, c: 5, r: 3, side: 4 }), a = unit({ slot: 1, c: 3, r: 4 });
    const t = computeMoveRange(grid, units(u, e, far, a), u, race);
    expect(markTargets(t, grid, units(u, e, far, a), u, 0, tables())).toBe(1);
    expect(t.kindAt(4, 3)).toBe(1);
    expect(t.kindAt(5, 3)).toBe(0);
    expect(t.kindAt(3, 4)).toBe(0);
  });
  it('keeps the original quirk: a melee target more than 4 high ends the scan before later targets', () => {
    const grid = new BattleGrid(flatMap(7, (c, r) => (c === 4 && r === 3 ? { h: 6 } : {})));
    const u = unit({ slot: 0, c: 3, r: 3, weapon: 1 });
    const high = unit({ slot: 10, c: 4, r: 3, side: 4 }), low = unit({ slot: 11, c: 2, r: 3, side: 4 });
    const t = computeMoveRange(grid, units(u, high, low), u, race);
    expect(markTargets(t, grid, units(u, high, low), u, 0, tables())).toBe(0);
    expect(t.kindAt(2, 3)).toBe(0);
    const bowman = unit({ slot: 0, c: 3, r: 3, weapon: 2 });
    const t2 = computeMoveRange(grid, units(bowman, high, low), bowman, race);
    expect(markTargets(t2, grid, units(bowman, high, low), bowman, 0, tables())).toBe(2);
  });
  it('line weapons need a shared row or column; nothing is marked after acting', () => {
    const grid = new BattleGrid(flatMap(7));
    const u = unit({ slot: 0, c: 3, r: 3, weapon: 3 });
    const diag = unit({ slot: 10, c: 4, r: 4, side: 4 }), inline = unit({ slot: 11, c: 3, r: 5, side: 4 });
    const t = computeMoveRange(grid, units(u, diag, inline), u, race);
    expect(markTargets(t, grid, units(u, diag, inline), u, 0, tables())).toBe(1);
    expect(t.kindAt(3, 5)).toBe(1);
    expect(markTargets(new RangeTable(3, 3), grid, units(u, inline), { ...u, acted: true }, 0, tables())).toBe(0);
  });
  it('magic shape 1 marks every floor cell in range as kind 1 (enemies) or 2 (allies); shape 2 walks four lines', () => {
    const grid = new BattleGrid(flatMap(13, (c, r) => (c === 6 && r === 9 ? { blocked: 1 } : {})));
    const u = unit({ slot: 0, c: 6, r: 6 });
    const t = new RangeTable(6, 6);
    markTargets(t, grid, units(u), u, 1, tables());          // burst: range 2..6
    expect(t.kindAt(6, 6)).toBe(0);
    expect(t.kindAt(7, 6)).toBe(0);
    expect(t.kindAt(8, 6)).toBe(1);
    expect(t.kindAt(6, 9)).toBe(0);                            // blocked
    expect(t.kindAt(6, 12)).toBe(1);
    const heal = new RangeTable(6, 6);
    markTargets(heal, grid, units(u), u, 2, tables());
    expect(heal.kindAt(6, 6)).toBe(2);
    const line = new RangeTable(6, 6);
    expect(markTargets(line, grid, units(u), u, 3, tables())).toBe(12);   // range 1..4 → steps 1..3 in 4 directions
    expect(line.kindAt(6, 9)).toBe(1);                         // shape 2 does not check blocked
    expect(line.kindAt(7, 7)).toBe(0);
  });
});

describe('markTargets: map-wide spells', () => {
  it('shape 4 marks only the caster\'s own cell, which confirms the spell', () => {
    const grid = new BattleGrid(flatMap(9));
    const u = unit({ slot: 0, c: 4, r: 4 });
    const t = new RangeTable(4, 4);
    expect(markTargets(t, grid, units(u), u, 6, tables())).toBe(1);
    expect(t.kindAt(4, 4)).toBe(1);
    expect([...t.cells()]).toHaveLength(1);
  });
});

describe('pathTo (FUN_00438960) and canStop', () => {
  it('walks back along increasing move points and prefers the previous direction on ties', () => {
    const grid = new BattleGrid(flatMap(7));
    const u = unit({ slot: 0, c: 3, r: 3 });
    const t = computeMoveRange(grid, units(u), u, race);
    expect(pathTo(t, grid, u, race, [5, 3])).toEqual([1, 1]);
    expect(pathTo(t, grid, u, race, [3, 3])).toEqual([]);
    const p = pathTo(t, grid, u, race, [5, 5]);
    expect(p).toHaveLength(4);
    expect(p.filter((d) => d === 1)).toHaveLength(2);
  });
  it('routes around a blocked cell; the blocked cell itself is not a stop', () => {
    const grid = new BattleGrid(flatMap(7, (c, r) => (c === 4 && r === 3 ? { blocked: 1 } : {})));
    const u = unit({ slot: 0, c: 3, r: 3 });
    const t = computeMoveRange(grid, units(u), u, race);
    const p = pathTo(t, grid, u, race, [5, 3]);
    expect(p).toHaveLength(4);
    expect(p.includes(0) || p.includes(3)).toBe(true);
    expect(canStop(t, units(u), u, 4, 3)).toBe(false);        // pathTo is only called for cells canStop accepts
  });
  it('canStop needs move points and an empty cell, own cell or a treasure object', () => {
    const grid = new BattleGrid(flatMap(7));
    const u = unit({ slot: 0, c: 3, r: 3 });
    const ally = unit({ slot: 1, c: 4, r: 3 }), chest = unit({ slot: 20, c: 3, r: 4, id: 8, side: 7, race: 8 });
    const all = units(u, ally, chest);
    const t = computeMoveRange(grid, all, u, race);
    expect(canStop(t, all, u, 3, 3)).toBe(true);
    expect(canStop(t, all, u, 4, 3)).toBe(false);
    expect(canStop(t, all, u, 3, 4)).toBe(true);
    expect(canStop(t, all, u, 0, 0)).toBe(false);
  });
});
