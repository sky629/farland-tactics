import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { resolveAction, resolveItem, type ResolveContext } from '../src/battle/resolve';
import { targetsOf } from '../src/battle/targets';
import type { ItemData } from '../src/data/types';
import { fixedRng, flatMap, ITEM, tables, unit, units } from './helpers/battleFixtures';

/** Real item ids the rules key on (battle_rules.md §4.2), in an otherwise empty table. */
function realItems(): ItemData[] {
  const arr = Array.from({ length: 170 }, () => ITEM({ name: 'none', range_min: 0, range_max: 0 }));
  const set = (i: number, o: Partial<ItemData>) => { arr[i] = ITEM({ slot: 3, range_min: 0, range_max: 1, ...o }); };
  set(1, { name: '허브', hp_heal: 20, use_effect: 67 });
  set(2, { name: '해독초', status_code: 2, use_effect: 70 });
  set(6, { name: '치유약', hp_heal: 10, use_effect: 68 });
  set(7, { name: '깨어나는_약', hp_heal: 20, status_code: 1, use_effect: 69 });
  set(9, { name: '브랜디', hp_heal: 999, mp_heal: 80, status_code: 1, use_effect: 69 });
  set(155, { name: '머시룸', hp_heal: 999, use_effect: 67 });
  set(163, { name: '에리쿠사', hp_heal: 999, mp_heal: 999, status_code: 1, use_effect: 67 });
  return arr;
}
const t = tables({ item: realItems() });
const ctx = (...us: ReturnType<typeof unit>[]): ResolveContext => ({ tables: t, grid: new BattleGrid(flatMap(5)), units: units(...us), rng: fixedRng([0]), dash: false });

describe('resolveItem (battle_rules.md §4.2)', () => {
  it('heals HP up to the maximum and reports the healed amount; a dead target is a miss unless the item revives', () => {
    const a = unit({ slot: 0, hp: 20, hpMax: 30 });
    expect(resolveItem(a, 1, ctx(a))).toMatchObject({ kind: 'heal', value: 10, popup: '10' });
    expect(a.hp).toBe(30);
    const dead = unit({ slot: 1, hp: 0, status: 1 });
    expect(resolveItem(dead, 1, ctx(dead))).toMatchObject({ kind: 'miss', popup: 'miss!' });
    expect(dead.hp).toBe(0);
  });
  it('a cure item removes exactly its status ("well"); otherwise it misses', () => {
    const poisoned = unit({ slot: 0, status: 2 });
    expect(resolveItem(poisoned, 2, ctx(poisoned))).toMatchObject({ kind: 'cure', popup: 'well', statusAfter: 0 });
    const fine = unit({ slot: 0 });
    expect(resolveItem(fine, 2, ctx(fine))).toMatchObject({ kind: 'miss' });
  });
  it('치유약 heals a wounded unit and cures any status of a healthy one', () => {
    const wounded = unit({ slot: 0, hp: 5 });
    expect(resolveItem(wounded, 6, ctx(wounded))).toMatchObject({ kind: 'heal', value: 10, popup: '10' });
    const asleep = unit({ slot: 0, status: 3 });
    expect(resolveItem(asleep, 6, ctx(asleep))).toMatchObject({ kind: 'cure', popup: 'well' });
    expect(asleep.status).toBe(0);
    const fine = unit({ slot: 0 });
    expect(resolveItem(fine, 6, ctx(fine))).toMatchObject({ kind: 'miss' });
  });
  it('깨어나는 약 revives the dead with its HP heal; 브랜디 also thaws', () => {
    const dead = unit({ slot: 0, hp: 0, status: 1 });
    expect(resolveItem(dead, 7, ctx(dead))).toMatchObject({ kind: 'heal', value: 20, statusAfter: 0 });
    expect(dead).toMatchObject({ hp: 20, status: 0 });
    const frozen = unit({ slot: 0, status: 5, mp: 0, hp: 30 });
    expect(resolveItem(frozen, 9, ctx(frozen))).toMatchObject({ kind: 'heal', value: 20, popup: '20' });   // MP 20 healed (hp full)
    expect(frozen).toMatchObject({ status: 0, mp: 20 });
  });
  it('머시룸 raises HP max by 5 (cap 999); 에리쿠사 revives and fills HP/MP', () => {
    const u = unit({ slot: 0, hpMax: 996, hp: 996 });
    expect(resolveItem(u, 155, ctx(u))).toMatchObject({ kind: 'buff', value: 5, popup: 'hp_up!' });
    expect(u.hpMax).toBe(999);
    const dead = unit({ slot: 0, hp: 0, mp: 0, status: 1 });
    expect(resolveItem(dead, 163, ctx(dead))).toMatchObject({ kind: 'heal', value: 30, statusAfter: 0 });
    expect(dead).toMatchObject({ hp: 30, mp: 20, status: 0 });
  });
  it('resolveAction routes actions ≥ 1000 to the item rules and targetsOf picks the unit on the cell', () => {
    const a = unit({ slot: 0, c: 2, r: 2, hp: 1 }), b = unit({ slot: 1, c: 3, r: 2, hp: 1 });
    const c = ctx(a, b);
    expect(targetsOf(c.grid, c.units, a, 1001, [3, 2], t)).toEqual([b]);
    expect(targetsOf(c.grid, c.units, a, 1001, [4, 4], t)).toEqual([]);
    expect(resolveAction(a, 1001, [b], c)).toEqual([expect.objectContaining({ target: 1, kind: 'heal', value: 20 })]);
  });
});
