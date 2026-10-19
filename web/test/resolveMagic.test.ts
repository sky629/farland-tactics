import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { resolveAction, resolveMagic, type ResolveContext } from '../src/battle/resolve';
import type { MagicData } from '../src/data/types';
import { fixedRng, flatMap, MAGIC, tables, unit, units } from './helpers/battleFixtures';

/** Real magic indices matter: 1 burst (fire), 3 heat blade, 5 flash (dmg+hold), 9 ifrit (fire), 13 restore, 24 lullaby, 25 cheering, 31 order, 35 levitate, 40 healing, 41 resurrection, 55 lifesteal, 64 sacrifice, 14 macabre dance. */
function magicTable(): MagicData[] {
  const m = Array.from({ length: 84 }, (_, i) => MAGIC({ name: `m${i}`, mp_cost: 6 }));
  m[1] = MAGIC({ name: 'burst', elem0: 5 });
  m[3] = MAGIC({ name: 'heat blade', elem0: 1, target: 1 });
  m[5] = MAGIC({ name: 'flash', elem0: 8 });
  m[9] = MAGIC({ name: 'ifrit', elem0: 20 });
  m[13] = MAGIC({ name: 'restore', elem2: 1, target: 1 });
  m[14] = MAGIC({ name: 'macabre', mp_cost: 0, elem0: 0, target: 1 });
  m[24] = MAGIC({ name: 'lullaby', elem0: 0, elem1: 3 });
  m[25] = MAGIC({ name: 'cheering', elem2: 1, target: 1 });
  m[31] = MAGIC({ name: 'order', elem1: 2 });
  m[35] = MAGIC({ name: 'levitate', elem1: 1, target: 1 });
  m[40] = MAGIC({ name: 'healing', elem0: 0, elem2: 1, target: 1 });
  m[41] = MAGIC({ name: 'resurrection', elem2: 10, target: 1 });
  m[55] = MAGIC({ name: 'lifesteal', elem2: -5 });
  m[64] = MAGIC({ name: 'sacrifice', elem2: 10, target: 1 });
  m[82] = MAGIC({ name: 'summon', elem2: -10, target: 2, shape: 3, range_min: 1, range_max: 15, mp_cost: 100 });
  return m;
}
const grid = new BattleGrid(flatMap(9));
const ctx = (rng: number[]): ResolveContext => ({ tables: tables({ magic: magicTable() }), grid, units: units(), rng: fixedRng(rng), dash: false });
const caster = (over = {}) => unit({ slot: 0, c: 4, r: 4, dir: 1, wis: 10, agi: 10, mp: 20, ...over });
const foe = (over = {}) => unit({ slot: 10, c: 6, r: 4, dir: 2, mgr: 10, agi: 10, hp: 30, side: 4, id: 8, ...over });

describe('resolveMagic (FUN_0043b4a0 magic cases)', () => {
  it('천사소환 (82) hurts nobody: FUN_0043b4a0 case 0x52 only marks the summon (popup 90000) and skips the damage path', () => {
    const t = foe({ mgr: 0 });
    expect(resolveMagic(caster({ wis: 100 }), t, 82, ctx([]))).toMatchObject({ kind: 'none', value: 0 });
    expect(t.hp).toBe(30);
  });
  it('a summon (FUN_0043e3b0 case 0x52) stands every hidden non-party unit up on a free cell within 8 of the caster', () => {
    const a = caster(), t = foe(), hidden = unit({ slot: 11, c: 0, r: 0, status: 9, side: 6, id: 8 }), object = unit({ slot: 12, c: 0, r: 0, status: 9, side: 7, id: 8 });
    const c = { ...ctx([3, 12, 9, 9]), units: units(a, t, hidden, object) };
    resolveAction(a, 82, [t], c);
    expect(hidden.status).toBe(0);
    expect(Math.abs(hidden.c - a.c) <= 8 && Math.abs(hidden.r - a.r) <= 8 && !(hidden.c === a.c && hidden.r === a.r) && !(hidden.c === t.c && hidden.r === t.r)).toBe(true);
    expect([object.status, object.c, object.r]).toEqual([9, 0, 0]);                 // objects (side 7) are not summoned
  });
  it('damage = power + wis − mgr, no rolls, no facing or height bonus', () => {
    const t = foe({ dir: 1 });
    const rng = fixedRng([0]);
    const hit = resolveMagic(caster(), t, 1, { ...ctx([]), rng });
    expect(hit).toMatchObject({ kind: 'damage', value: 5, popup: '5', crit: false });
    expect(t.hp).toBe(25);
    expect(rng.calls).toBe(0);
  });
  it('fire magic thaws a frozen target before damaging it', () => {
    const t = foe({ status: 5 });
    resolveMagic(caster(), t, 9, ctx([]));
    expect(t.status).toBe(0);
    expect(t.hp).toBe(30 - 20);
  });
  it('healing restores min(wisTot, missing HP); resurrection needs a dead target and gives half', () => {
    const ally = unit({ slot: 1, c: 5, r: 4, hp: 10, hpMax: 30 });
    expect(resolveMagic(caster(), ally, 40, ctx([]))).toMatchObject({ kind: 'heal', value: 10, popup: '10' });
    expect(ally.hp).toBe(20);
    const dead = unit({ slot: 2, c: 5, r: 5, hp: 0, hpMax: 30, status: 1 });
    expect(resolveMagic(caster({ wis: 50 }), dead, 41, ctx([])).kind).toBe('cure');
    expect([dead.hp, dead.status]).toEqual([25, 0]);
    expect(resolveMagic(caster(), unit({ slot: 3, c: 5, r: 3, hp: 5 }), 41, ctx([])).kind).toBe('miss');
  });
  it('status magic: chance = pow·bonus·m / res; success sets the status and counter 100', () => {
    const t = foe();                                   // pow 20, res 20, bonus 30, m 1 (front) → 30 %
    expect(resolveMagic(caster(), t, 24, ctx([29])).kind).toBe('status');
    expect([t.status, t.statusCounter]).toEqual([3, 100]);
    const t2 = foe();
    expect(resolveMagic(caster(), t2, 24, ctx([30])).kind).toBe('none');
    expect(t2.status).toBe(0);
    const named = foe({ id: 20 });
    expect(resolveMagic(caster(), named, 24, ctx([0])).kind).toBe('none');   // immune
  });
  it('damage-plus-status magic applies the status roll and then the damage', () => {
    const t = foe();
    const hit = resolveMagic(caster(), t, 5, ctx([0]));                // flash: hold, then 8 damage
    expect(hit).toMatchObject({ kind: 'damage', value: 8, statusAfter: 8 });
    expect(t.hp).toBe(22);
  });
  it('order turns the target, levitate needs a ground race and sets the counter from the caster level', () => {
    const t = foe({ dir: 2 });
    resolveMagic(caster({ dir: 3 }), t, 31, ctx([0]));
    expect(t.dir).toBe(3);
    const ally = unit({ slot: 1, c: 5, r: 4 });
    resolveMagic(caster({ level: 4 }), ally, 35, ctx([]));
    expect([ally.status, ally.statusCounter]).toEqual([11, 40]);
    const bird = unit({ slot: 2, c: 5, r: 5, race: 2 });
    expect(resolveMagic(caster(), bird, 35, ctx([])).kind).toBe('none');
  });
  it('buffs are capped; cheering restores move and act; macabre dance sets the caster flag', () => {
    const a = caster({ str: 40 });
    expect(resolveMagic(a, a, 3, ctx([]))).toMatchObject({ kind: 'buff', popup: 'str_up!' });
    expect(a.buff.str).toBe(5);                        // min(0 + 4 + 1, 10)
    for (let i = 0; i < 5; i++) resolveMagic(a, a, 3, ctx([]));
    expect(a.buff.str).toBe(10);
    const tired = unit({ slot: 1, c: 5, r: 4, moved: true, acted: true });
    resolveMagic(a, tired, 25, ctx([]));
    expect([tired.moved, tired.acted]).toEqual([false, false]);
    resolveMagic(a, a, 14, ctx([]));
    expect(a.special).toBe(true);
  });
  it('restore cures any status except death ("well"); sacrifice kills the caster and revives the target', () => {
    const poisoned = unit({ slot: 1, c: 5, r: 4, status: 2 });
    expect(resolveMagic(caster(), poisoned, 13, ctx([]))).toMatchObject({ kind: 'cure', popup: 'well' });
    expect(poisoned.status).toBe(0);
    const a = caster({ wis: 20 }), dead = unit({ slot: 1, c: 5, r: 4, hp: 0, status: 1, hpMax: 30 });
    resolveMagic(a, dead, 64, ctx([]));
    expect([a.hp, a.status, dead.hp, dead.status]).toEqual([0, 1, 10, 0]);
  });
  it('resolveAction: lifesteal damages the targets and heals the caster by the first damage', () => {
    const a = caster({ hp: 10, hpMax: 30, wis: 20 });
    const t = foe();                                   // power 5 + 20 − 10 = 15
    const hits = resolveAction(a, 55, [t, a], ctx([]));
    expect(hits.map((h) => [h.target, h.kind, h.value])).toEqual([[10, 'damage', 15], [0, 'heal', 15]]);
    expect(a.hp).toBe(25);
  });
});
