import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { canAttack, magicRadius, targetsOf } from '../src/battle/targets';
import { flatMap, MAGIC, tables, unit, units } from './helpers/battleFixtures';

const t = tables();
const grid = new BattleGrid(flatMap(9, (c, r) => (c === 6 && r === 4 ? { h: 6 } : {})));

describe('magicRadius (FUN_0043e350)', () => {
  it('grows with level − learn_level: ≥20 → 2, ≥10 → 1, else 0', () => {
    expect(magicRadius(unit({ slot: 0, level: 2 }), MAGIC({ learn_level: 1 }))).toBe(0);
    expect(magicRadius(unit({ slot: 0, level: 11 }), MAGIC({ learn_level: 1 }))).toBe(1);
    expect(magicRadius(unit({ slot: 0, level: 25 }), MAGIC({ learn_level: 5 }))).toBe(2);
  });
});

describe('canAttack (FUN_00412a80)', () => {
  const a = unit({ slot: 0, c: 4, r: 4, dir: 1 });
  it('needs a hostile living non-object target; melee refuses |Δh| > 4; line weapons need alignment', () => {
    const e = unit({ slot: 10, c: 5, r: 4, side: 4 });
    expect(canAttack(grid, 4, 4, a, e, t.item[1]!)).toBe(true);
    expect(canAttack(grid, 4, 4, a, unit({ slot: 1, c: 5, r: 4 }), t.item[1]!)).toBe(false);
    expect(canAttack(grid, 4, 4, a, { ...e, status: 1 }, t.item[1]!)).toBe(false);
    expect(canAttack(grid, 5, 4, a, { ...e, c: 6 }, t.item[1]!)).toBe(false);     // target on h 6
    expect(canAttack(grid, 5, 4, a, { ...e, c: 6 }, t.item[2]!)).toBe(true);      // bow ignores height
    expect(canAttack(grid, 4, 4, a, { ...e, c: 5, r: 5 }, t.item[3]!)).toBe(false); // pike needs same row/col
    expect(canAttack(grid, 4, 4, a, { ...e, c: 5, r: 4 }, t.item[3]!)).toBe(true);
  });
});

describe('targetsOf (FUN_00438d70)', () => {
  it('single weapons hit the unit on the clicked cell; bows too', () => {
    const a = unit({ slot: 0, c: 4, r: 4, dir: 1, weapon: 1 });
    const e = unit({ slot: 10, c: 5, r: 4, side: 4 });
    expect(targetsOf(grid, units(a, e), a, 0, [5, 4], t)).toEqual([e]);
    expect(targetsOf(grid, units(a, e), a, 0, [6, 6], t)).toEqual([]);
  });
  it('line weapons hit everything in the facing line within range, dropping dead, objects and |Δh| > 4', () => {
    const a = unit({ slot: 0, c: 4, r: 4, dir: 1, weapon: 3 });                   // pike 1..2
    const e1 = unit({ slot: 10, c: 5, r: 4, side: 4 }), e2 = unit({ slot: 11, c: 6, r: 4, side: 4 });   // e2 stands on h 6
    const ally = unit({ slot: 1, c: 5, r: 4 });
    expect(targetsOf(grid, units(a, e1, e2), a, 0, [5, 4], t)).toEqual([e1]);
    expect(targetsOf(grid, units(a, ally), a, 0, [5, 4], t)).toEqual([ally]);     // friendly fire is possible
    expect(targetsOf(grid, units(a, { ...e1, status: 1 }), a, 0, [5, 4], t)).toEqual([]);
  });
  it('T-shaped weapons hit front, left and right of the actor', () => {
    const a = unit({ slot: 0, c: 4, r: 4, dir: 0, weapon: 4 });                   // facing +r
    const front = unit({ slot: 10, c: 4, r: 5, side: 4 }), left = unit({ slot: 11, c: 3, r: 4, side: 4 }), right = unit({ slot: 12, c: 5, r: 4, side: 4 }), behind = unit({ slot: 13, c: 4, r: 3, side: 4 });
    expect(targetsOf(grid, units(a, front, left, right, behind), a, 0, [4, 5], t).map((u) => u.slot).sort()).toEqual([10, 11, 12]);
  });
  it('magic shape 0/1 takes units around the clicked cell within the radius, filtered by target camp', () => {
    const a = unit({ slot: 0, c: 4, r: 4, level: 11 });
    const e1 = unit({ slot: 10, c: 7, r: 4, side: 4 }), e2 = unit({ slot: 11, c: 7, r: 5, side: 4 }), ally = unit({ slot: 1, c: 7, r: 3 });
    const magic = t.magic.slice(); magic[1] = MAGIC({ shape: 1, range_min: 2, range_max: 6 }); magic[2] = MAGIC({ shape: 1, target: 1, range_min: 0, range_max: 6 });
    const tt = { ...t, magic };
    expect(targetsOf(grid, units(a, e1, e2, ally), a, 1, [7, 4], tt).map((u) => u.slot).sort()).toEqual([10, 11]);   // radius 1 at level 11
    expect(targetsOf(grid, units(a, e1, e2, ally), { ...a, level: 2 }, 1, [7, 4], tt)).toEqual([e1]);
    expect(targetsOf(grid, units(a, e1, e2, ally), a, 2, [7, 3], tt)).toEqual([ally]);
  });
  it('shape 3 centers on the caster, shape 4 takes the whole map, resurrection takes only the dead', () => {
    const a = unit({ slot: 0, c: 4, r: 4 });
    const near = unit({ slot: 10, c: 5, r: 4, side: 4 }), far = unit({ slot: 11, c: 8, r: 8, side: 4 }), dead = unit({ slot: 1, c: 2, r: 2, status: 1, hp: 0 });
    const magic = t.magic.slice(); magic[4] = MAGIC({ shape: 3, range_min: 1, range_max: 2 }); magic[28] = MAGIC({ shape: 4 }); magic[41] = MAGIC({ shape: 1, target: 1, range_min: 0, range_max: 6 });
    const tt = { ...t, magic };
    expect(targetsOf(grid, units(a, near, far, dead), a, 4, [4, 4], tt)).toEqual([near]);
    expect(targetsOf(grid, units(a, near, far, dead), a, 28, [4, 4], tt).map((u) => u.slot)).toEqual([10, 11]);
    expect(targetsOf(grid, units(a, near, far, dead), a, 41, [2, 2], tt)).toEqual([dead]);
  });
  it('shape 2 walks the facing line and stops at the first unit for magic 62; drain adds the caster last', () => {
    const a = unit({ slot: 0, c: 4, r: 5, dir: 1 });                             // row 5: flat (row 4 has the raised cell at c 6)
    const e1 = unit({ slot: 10, c: 6, r: 5, side: 4 }), e2 = unit({ slot: 11, c: 7, r: 5, side: 4 });
    const magic = t.magic.slice(); magic[3] = MAGIC({ shape: 2, range_min: 1, range_max: 4 }); magic[62] = MAGIC({ shape: 2, range_min: 1, range_max: 4 }); magic[55] = MAGIC({ shape: 0, range_min: 1, range_max: 3 });
    const tt = { ...t, magic };
    expect(targetsOf(grid, units(a, e1, e2), a, 3, [5, 5], tt).map((u) => u.slot)).toEqual([10, 11]);
    expect(targetsOf(grid, units(a, e1, e2), a, 62, [5, 5], tt).map((u) => u.slot)).toEqual([10]);
    expect(targetsOf(grid, units(a, e1), a, 55, [6, 5], tt).map((u) => u.slot)).toEqual([10, 0]);
    expect(targetsOf(grid, units(unit({ slot: 0, c: 4, r: 4, dir: 1 }), unit({ slot: 10, c: 6, r: 4, side: 4 })), unit({ slot: 0, c: 4, r: 4, dir: 1 }), 62, [5, 4], tt)).toEqual([]);   // 62 stops where the ground rises
  });
});
