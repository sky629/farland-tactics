import { elems, type ItemData, type RaceData, type Tables } from '../data/types';
import { dirTo, incap, type BattleGrid } from './grid';
import type { RandomSource } from './rng';
import { itemsOf, type Unit } from './unit';

export interface Hit { target: number; kind: 'damage' | 'heal' | 'miss' | 'status' | 'cure' | 'buff' | 'none'; value: number; crit: boolean; popup: string; statusAfter: number }
export interface ResolveContext { tables: Tables; grid: BattleGrid; units: (Unit | null)[]; rng: RandomSource; dash: boolean }

type Items = readonly [ItemData, ItemData, ItemData, ItemData];
const trunc = Math.trunc;
const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** battle_rules.md §2.2: armor contributes no attack, weapons no defense; agi/wis/mgr sum all four items. */
export function totals(u: Unit, items: Items): { atk: number; def: number; wis: number; mgr: number; agi: number } {
  const [w, a, x, y] = items;
  return {
    atk: u.str + w.atk + x.atk + y.atk + u.buff.str,
    def: u.def + a.def + x.def + y.def + u.buff.def,
    wis: u.wis + w.wis + a.wis + x.wis + y.wis + u.buff.wis,
    mgr: u.mgr + w.mgr + a.mgr + x.mgr + y.mgr + u.buff.mgr,
    agi: u.agi + w.agi + a.agi + x.agi + y.agi + u.buff.agi,
  };
}

/** A_i(u) = race.e_i + Σ items.e_i + unit.e_i. */
export function elemTotal(u: Unit, race: RaceData, items: Items, axis: 0 | 1 | 2): number {
  return elems(race)[axis] + items.reduce((s, it) => s + elems(it)[axis], 0) + u.elem[axis];
}

/** FUN_0043dd90(a, b, base): facing multiplier then chance = agi(a)·m / agi(b), floor 1 %. */
export function roll(a: Unit, b: Unit, base: number, rng: RandomSource, items: ItemData[]): boolean {
  let m = Math.max(base, 1);
  if (incap(b.status)) m *= 3;
  else if (a.dir === b.dir) m *= 2;
  else if (b.dir !== (a.dir ^ 3)) m += trunc(m / 2);
  const agiA = totals(a, itemsOf(a, items)).agi, agiB = totals(b, itemsOf(b, items)).agi;
  const chance = Math.max(trunc((agiA * m) / Math.max(agiB, 1)), 1);
  return rng.rand(100) < chance;
}

/** Named enemies (id ≠ 8, non-party) are immune to status effects. */
export const statusOk = (t: Unit): boolean => t.side === 0 || t.id === 8;

/** Elemental percentage on `base` for the attacker's strongest axis (battle_rules.md §2.2). `ownElem` = race or weapon/magic vector that must share the attacker's sign. */
export function elementAdjust(base: number, attacker: Unit, target: Unit, ctx: ResolveContext, ownElem: [number, number, number]): number {
  const t = ctx.tables;
  const ia = itemsOf(attacker, t.item), it = itemsOf(target, t.item);
  const ra = t.race[attacker.race]!, rt = t.race[target.race]!;
  let best: 0 | 1 | 2 | null = null, bestDiff = -1;
  for (const axis of [0, 1, 2] as const) {
    const A = elemTotal(attacker, ra, ia, axis), D = elemTotal(target, rt, it, axis);
    if (A === 0 || D === 0) continue;
    if (sign(A) !== sign(elems(ra)[axis]) && sign(A) !== sign(ownElem[axis])) continue;
    if (Math.abs(A - D) > bestDiff) { bestDiff = Math.abs(A - D); best = axis; }
  }
  if (best === null) return base;
  const A = elemTotal(attacker, ra, ia, best), D = elemTotal(target, rt, it, best);
  const pct = sign(A) === sign(D) ? -trunc((Math.abs(D) - Math.abs(A) + 100) / 4) : trunc(Math.abs(D - A) / 2);
  return Math.max(trunc(((100 + pct) * base) / 100), 1);
}

const hit = (target: Unit, kind: Hit['kind'], value: number, popup: string, crit = false): Hit => ({ target: target.slot, kind, value, crit, popup, statusAfter: target.status });

function applyWeaponStatus(a: Unit, t: Unit, ctx: ResolveContext): void {
  const st = ctx.tables.item[a.weapon]!.status_code;
  if (st === 0 || t.status === 1 || !statusOk(t) || !roll(a, t, 20, ctx.rng, ctx.tables.item)) return;
  const s = t.status;
  const ok = (st === 2 || st === 3 || st === 6 || st === 7) ? !incap(s)
    : (st === 4 || st === 5) ? ![1, 4, 5, 9].includes(s)
      : st === 8 ? ![1, 4, 5, 8, 9].includes(s) : false;
  if (ok) t.status = st;                       // the duration counter is NOT set (original quirk)
}

/** FUN_0043b4a0 action 0 + FUN_0043afd0 dash: wake → crit roll → evade roll (arguments swapped) → damage → weapon status. */
export function resolvePhysical(a: Unit, t: Unit, ctx: ResolveContext): Hit {
  const tbl = ctx.tables;
  if (t.status === 3) t.status = 0;
  let crit = ctx.dash;
  if (!a.special && roll(a, t, 3, ctx.rng, tbl.item)) crit = true;
  if (!a.special && !incap(t.status) && roll(t, a, 3, ctx.rng, tbl.item)) {
    t.dir = dirTo(t.c, t.r, a.c, a.r);
    return hit(t, 'miss', 0, 'miss!');
  }
  const ia = itemsOf(a, tbl.item), it = itemsOf(t, tbl.item);
  let base = Math.max(totals(a, ia).atk - totals(t, it).def, 1);
  base = elementAdjust(base, a, t, ctx, elems(ia[0]));
  let mult = a.special ? 300 : 100;
  if (crit) mult += 80;
  const d = dirTo(a.c, a.r, t.c, t.r);
  if (t.dir === d) mult += 25;
  else if (t.dir !== (d ^ 3)) mult += 15;
  mult += (ctx.grid.height(a.c, a.r) - ctx.grid.height(t.c, t.r)) * 2;
  const dmg = Math.min(Math.max(trunc((mult * base) / 100), 1), t.hp);
  t.hp -= dmg;
  if (t.hp === 0) t.status = 1;
  else applyWeaponStatus(a, t, ctx);
  return hit(t, 'damage', dmg, String(dmg), crit);
}

/** One FUN_0043b4a0 call per target. Task 9 adds the magic branch. */
export function resolveAction(actor: Unit, action: number, targets: Unit[], ctx: ResolveContext): Hit[] {
  if (action === 0) return targets.map((t) => resolvePhysical(actor, t, ctx));
  throw new Error(`action ${action} not supported yet`);
}
