import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { resolveAction, resolvePhysical, roll, totals, type ResolveContext } from '../src/battle/resolve';
import { fixedRng, flatMap, RACE, tables, unit, units } from './helpers/battleFixtures';

const grid = new BattleGrid(flatMap(9, (c, r) => (c === 2 && r === 4 ? { h: 2 } : {})));
const ctx = (rng: number[], over: Partial<ResolveContext> = {}): ResolveContext => ({ tables: tables(), grid, units: units(), rng: fixedRng(rng), dash: false, ...over });
/** attacker at (4,4) facing east, target at (5,4). */
const attacker = (over = {}) => unit({ slot: 0, c: 4, r: 4, dir: 1, str: 20, weapon: 1, ...over });
const target = (over = {}) => unit({ slot: 10, c: 5, r: 4, dir: 0, def: 10, hp: 30, side: 4, id: 8, ...over });

describe('totals and roll (FUN_0043dd90)', () => {
  it('sums weapon/accessory attack, armor/accessory defense and all four items for agi/wis/mgr', () => {
    const t = tables();
    const u = unit({ slot: 0, str: 20, def: 10, agi: 10, weapon: 1, armor: 5, buff: { str: 2, def: 0, wis: 0, mgr: 0, agi: 1 } });
    const items = [t.item[1]!, t.item[5]!, t.item[0]!, t.item[0]!] as const;
    expect(totals(u, items)).toEqual({ atk: 32, def: 15, wis: 10, mgr: 10, agi: 11 });
  });
  it('chance = agi(a) * m / agi(b): ×3 vs incapacitated, ×2 from behind, +50% from the side', () => {
    const a = unit({ slot: 0, agi: 10, dir: 1 });
    const front = unit({ slot: 10, agi: 10, dir: 2 }), side = unit({ slot: 11, agi: 10, dir: 0 }), back = unit({ slot: 12, agi: 10, dir: 1 }), asleep = unit({ slot: 13, agi: 10, dir: 2, status: 3 });
    const t = tables();
    expect(roll(a, front, 3, fixedRng([2]), t.item)).toBe(true);     // chance 3
    expect(roll(a, front, 3, fixedRng([3]), t.item)).toBe(false);
    expect(roll(a, side, 3, fixedRng([3]), t.item)).toBe(true);      // m = 3 + 1 = 4 → chance 4
    expect(roll(a, side, 3, fixedRng([4]), t.item)).toBe(false);
    expect(roll(a, back, 3, fixedRng([5]), t.item)).toBe(true);      // m = 6
    expect(roll(a, asleep, 3, fixedRng([8]), t.item)).toBe(true);    // m = 9
    expect(roll(a, asleep, 3, fixedRng([9]), t.item)).toBe(false);
    expect(roll(unit({ slot: 0, agi: 1 }), unit({ slot: 1, agi: 999 }), 3, fixedRng([0]), t.item)).toBe(true);   // chance floors at 1
  });
});

describe('resolvePhysical (FUN_0043b4a0 action 0)', () => {
  it('side hit: base = atk − def, ×1.15, no rolls succeed', () => {
    const t = target();
    const hit = resolvePhysical(attacker(), t, ctx([99, 99]));
    expect(hit).toMatchObject({ target: 10, kind: 'damage', value: 23, crit: false, popup: '23', statusAfter: 0 });
    expect(t.hp).toBe(7);
  });
  it('back (+25%) and front (+0%) multipliers depend on the target facing', () => {
    const back = target({ dir: 1 });
    resolvePhysical(attacker(), back, ctx([99, 99]));
    expect(back.hp).toBe(30 - 25);
    const front = target({ dir: 2 });
    resolvePhysical(attacker(), front, ctx([99, 99]));
    expect(front.hp).toBe(30 - 20);
  });
  it('height difference adds 2% per step and damage is at least 1 and at most the remaining HP', () => {
    const high = attacker({ c: 2, r: 4, dir: 1 });                   // h 2
    const t = target({ c: 3, r: 4 });
    resolvePhysical(high, t, ctx([99, 99]));
    expect(t.hp).toBe(30 - 23);                                       // (100+15+4)% of 20 = 23.8 → 23
    const tank = target({ def: 999, hp: 5 });
    resolvePhysical(attacker(), tank, ctx([99, 99]));
    expect(tank.hp).toBe(4);
  });
  it('critical (+80%) kills: HP 0 → status 1 (dead)', () => {
    const t = target();
    const hit = resolvePhysical(attacker(), t, ctx([0, 99]));        // crit roll 0 < 3, evade roll 99
    expect(hit).toMatchObject({ kind: 'damage', value: 30, crit: true, statusAfter: 1 });
    expect(t.status).toBe(1);
  });
  it('evade (roll with swapped arguments) → miss, the target turns toward the attacker', () => {
    const t = target({ dir: 0 });
    const hit = resolvePhysical(attacker(), t, ctx([99, 0]));
    expect(hit).toMatchObject({ kind: 'miss', value: 0, popup: 'miss!' });
    expect(t.hp).toBe(30);
    expect(t.dir).toBe(2);
  });
  it('a sleeping target wakes before the rolls and is therefore allowed to evade', () => {
    const t = target({ status: 3, statusCounter: 85 });
    resolvePhysical(attacker(), t, ctx([99, 0]));
    expect(t.status).toBe(0);
    expect(t.hp).toBe(30);
  });
  it('the special flag triples damage and skips both rolls', () => {
    const t = target();
    const rng = fixedRng([0]);
    resolvePhysical(attacker({ special: true }), t, ctx([], { rng }));
    expect(t.hp).toBe(0);
    expect(rng.calls).toBe(0);
  });
  it('dash grants the critical without a roll result but still rolls', () => {
    const t = target();
    const rng = fixedRng([99, 99]);
    const hit = resolvePhysical(attacker(), t, ctx([], { rng, dash: true }));
    expect(hit.crit).toBe(true);
    expect(rng.calls).toBe(2);
  });
  it('elements: the axis with the largest |A−D| is used; same sign lowers, opposite sign raises', () => {
    const tt = tables({ race: [RACE({ elem0: 10 }), RACE({ elem0: 10 }), RACE({ elem0: -5 })] });
    const same = target({ race: 1 });
    resolvePhysical(attacker(), same, ctx([99, 99], { tables: tt }));
    expect(same.hp).toBe(30 - 17);                                    // base 20 × 75% = 15 → ×1.15 = 17.25 → 17
    const opposite = target({ race: 2 });
    resolvePhysical(attacker(), opposite, ctx([99, 99], { tables: tt }));
    expect(opposite.hp).toBe(30 - 24);                                // |−5−10|/2 = 7% → 21 → ×1.15 = 24.15 → 24
  });
  it('weapon status effects roll at 20% and leave the counter untouched', () => {
    const t = target({ id: 8 });
    const hit = resolvePhysical(attacker({ weapon: 6 }), t, ctx([99, 99, 19]));
    expect(hit.statusAfter).toBe(2);
    expect(t.statusCounter).toBe(0);
    const named = target({ id: 20, side: 4 });                        // named enemy: immune
    resolvePhysical(attacker({ weapon: 6 }), named, ctx([99, 99, 0]));
    expect(named.status).toBe(0);
  });
  it('resolveAction(0) resolves every target in order', () => {
    const a = attacker(), t1 = target(), t2 = target({ slot: 11, c: 5, r: 5 });
    const hits = resolveAction(a, 0, [t1, t2], ctx([99, 99, 99, 99]));
    expect(hits.map((h) => h.target)).toEqual([10, 11]);
  });
});
