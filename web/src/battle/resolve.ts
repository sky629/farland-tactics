import { elems, type ItemData, type MagicData, type RaceData, type Tables } from '../data/types';
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

/** battle_rules.md §3.5: status magic parameters. allow(s) = statuses the effect may be applied on. */
export const STATUS_MAGIC: Record<number, { status: number; axis: 0 | 1 | 2; k: number; allow: (s: number) => boolean }> = {};
const notIn = (...xs: number[]) => (s: number) => !xs.includes(s);
for (const m of [5, 51]) STATUS_MAGIC[m] = { status: 8, axis: 0, k: 30, allow: notIn(1, 4, 5, 8, 9) };
for (const m of [11, 12, 19, 72]) STATUS_MAGIC[m] = { status: 5, axis: 0, k: 30, allow: notIn(1, 4, 5, 9) };
STATUS_MAGIC[23] = { status: 6, axis: 1, k: 40, allow: (s) => !incap(s) };
STATUS_MAGIC[24] = { status: 3, axis: 1, k: 30, allow: (s) => !incap(s) };
for (const m of [26, 74, 79]) STATUS_MAGIC[m] = { status: 8, axis: 1, k: 30, allow: notIn(1, 4, 5, 8, 9) };
for (const m of [34, 73]) STATUS_MAGIC[m] = { status: 2, axis: 1, k: 40, allow: (s) => !incap(s) };
for (const m of [50, 75]) STATUS_MAGIC[m] = { status: 4, axis: 2, k: 20, allow: notIn(1, 4, 5, 9) };
STATUS_MAGIC[52] = { status: 7, axis: 2, k: 50, allow: (s) => !incap(s) };
STATUS_MAGIC[53] = { status: -1, axis: 2, k: 30, allow: (s) => !incap(s) };   // dark force: random status

/** Magic whose only effect is the status/turn change (no damage). */
export const STATUS_ONLY = new Set([23, 24, 28, 31, 35, 51, 52]);
const FIRE = new Set([1, 9, 71]);
const HEAL = new Set([22, 32, 40]);
const BUFF: Record<number, { key: keyof Unit['buff']; stat: 'str' | 'agi' | 'def' | 'mgr'; cap: number; popup: string }> = {
  3: { key: 'str', stat: 'str', cap: 4, popup: 'str_up!' }, 21: { key: 'agi', stat: 'agi', cap: 2, popup: 'agi_up!' },
  33: { key: 'def', stat: 'def', cap: 2, popup: 'def_up!' }, 44: { key: 'mgr', stat: 'mgr', cap: 2, popup: 'mgr_up!' },
};
const SPECIAL = new Set([14, 54, 63]);

function statusRoll(a: Unit, t: Unit, m: MagicData, axis: 0 | 1 | 2, k: number, ctx: ResolveContext): boolean {
  const tbl = ctx.tables;
  const ia = itemsOf(a, tbl.item), it = itemsOf(t, tbl.item);
  const ta = totals(a, ia), tt = totals(t, it);
  const res = Math.max(tt.mgr + tt.agi, 1);
  const pow = ta.wis + ta.agi;
  const s = sign(elems(m)[axis]) || 1;
  const bonus = Math.max(k + s * (elemTotal(a, tbl.race[a.race]!, ia, axis) - elemTotal(t, tbl.race[t.race]!, it, axis)), 1);
  const mul = incap(t.status) ? 3 : a.dir === t.dir ? 2 : t.dir !== (a.dir ^ 3) ? 1.5 : 1;
  const chance = Math.max(trunc((pow * bonus * mul) / res), 1);
  return ctx.rng.rand(100) < chance;
}

function darkForce(ctx: ResolveContext): number {
  const r = ctx.rng.rand(100);
  return r < 1 ? 4 : r < 5 ? 5 : r < 10 ? 7 : r < 20 ? 8 : r < 30 ? 2 : r < 40 ? 6 : r < 50 ? 3 : 0;
}

function magicDamage(a: Unit, t: Unit, m: MagicData, ctx: ResolveContext): number {
  const tbl = ctx.tables;
  const power = Math.abs(elems(m).find((v) => v !== 0) ?? 0);
  const atk = totals(a, itemsOf(a, tbl.item)).wis, def = totals(t, itemsOf(t, tbl.item)).mgr;
  let base = Math.max(power + atk - def, 1);
  base = elementAdjust(base, a, t, ctx, elems(m));
  const dmg = Math.min(base, t.hp);
  t.hp -= dmg;
  if (t.hp === 0) t.status = 1;
  return dmg;
}

/** FUN_0043b4a0 for action = magic index. Returns the Hit for `t`; mutates units. */
export function resolveMagic(a: Unit, t: Unit, index: number, ctx: ResolveContext): Hit {
  const tbl = ctx.tables;
  const m = tbl.magic[index]!;
  const wisTot = totals(a, itemsOf(a, tbl.item)).wis;
  if (FIRE.has(index) && t.status === 5) t.status = 0;
  if (HEAL.has(index)) {
    if (t.status === 1 || t.side === 7) return hit(t, 'miss', 0, 'miss!');
    const v = Math.min(wisTot, t.hpMax - t.hp); t.hp += v;
    return hit(t, 'heal', v, String(v));
  }
  if (index === 41) {
    if (t.status !== 1 && t.side !== 7) return hit(t, 'miss', 0, 'miss!');
    t.hp = Math.min(trunc(wisTot / 2), t.hpMax); t.status = 0;
    return hit(t, 'cure', t.hp, String(t.hp));
  }
  if (index === 64) {
    a.hp = 0; a.status = 1;
    t.hp = Math.min(trunc(wisTot / 2), t.hpMax); t.status = 0;
    return hit(t, 'cure', t.hp, String(t.hp));
  }
  if (index === 2 || index === 10 || index === 13 || index === 45 || index === 47) {
    const cures = index === 2 ? t.status === 5 : index === 10 ? t.status === 2 : t.status !== 1 && (t.status !== 0 || index === 47);
    if (!cures) return hit(t, 'none', 0, '');
    t.status = 0;
    if (index === 47) t.hp = t.hpMax;
    return hit(t, 'cure', 0, 'well');
  }
  if (index === 25) { t.moved = false; t.acted = false; return hit(t, 'buff', 0, ''); }
  if (SPECIAL.has(index)) { a.special = true; return hit(t, 'buff', 0, ''); }
  const buff = BUFF[index];
  if (buff) {
    const base = t[buff.stat];
    t.buff[buff.key] = Math.min(t.buff[buff.key] + trunc(base / 10) + 1, trunc(base / buff.cap));
    return hit(t, 'buff', t.buff[buff.key], buff.popup);
  }
  if (index === 28) { if (!incap(t.status)) { t.status = 6; t.statusCounter = 100; } return hit(t, 'status', 6, ''); }
  if (index === 31) {
    if (!incap(t.status) && statusRoll(a, t, m, 1, 60, ctx)) { t.dir = a.dir; return hit(t, 'status', 0, ''); }
    return hit(t, 'none', 0, '');
  }
  if (index === 35) {
    const race = tbl.race[t.race]!;
    const ok = t.status === 0 && race.cost_land0 === 99 && itemsOf(t, tbl.item).every((it) => it.status_code !== 11);
    if (!ok) return hit(t, 'none', 0, '');
    t.status = 11; t.statusCounter = a.level * 5 + 20;
    return hit(t, 'status', 11, 'fly_high!');
  }
  const sm = STATUS_MAGIC[index];
  let statusApplied = false;
  if (sm && statusOk(t) && sm.allow(t.status) && !(index === 50 && t.race === 50)) {
    if (statusRoll(a, t, m, sm.axis, sm.k, ctx)) {
      const s = sm.status === -1 ? darkForce(ctx) : sm.status;
      if (s !== 0) { t.status = s; t.statusCounter = 100; statusApplied = true; }
    }
  }
  if (STATUS_ONLY.has(index)) return hit(t, statusApplied ? 'status' : 'none', statusApplied ? t.status : 0, '');
  const dmg = magicDamage(a, t, m, ctx);
  return hit(t, 'damage', dmg, String(dmg));
}

const STAT_UP: Record<number, ['hpMax' | 'mpMax' | 'str' | 'def' | 'wis' | 'mgr', string]> = {
  155: ['hpMax', 'hp_up!'], 156: ['mpMax', 'mp_up!'], 157: ['str', 'str_up!'], 158: ['def', 'def_up!'], 159: ['wis', 'wis_up!'], 160: ['mgr', 'mgr_up!'],
};

/** battle_rules.md §4.2: one consumable (`id` = action − 1000) on one unit. HP/MP first, then the status rule; the popup prefers the HP number. */
export function resolveItem(t: Unit, id: number, ctx: ResolveContext): Hit {
  const item = ctx.tables.item[id]!;
  if ((t.status === 1 || t.side === 7) && item.status_code !== 1) return hit(t, 'miss', 0, 'miss!');
  const heal = Math.max(Math.min(item.hp_heal, t.hpMax - t.hp), 0), mp = Math.max(Math.min(item.mp_heal, t.mpMax - t.mp), 0);
  t.hp += heal; t.mp += mp;
  const value = heal > 0 ? heal : mp;
  const popup = value > 0 ? String(value) : '';
  const miss = () => (value > 0 ? hit(t, 'heal', value, popup) : hit(t, 'miss', 0, 'miss!'));
  const up = STAT_UP[id];
  if (up) { t[up[0]] = Math.min(t[up[0]] + 5, 999); return hit(t, 'buff', 5, up[1]); }
  const before = t.status;
  if (id === 6) { if (t.status === 0) return miss(); t.status = 0; }
  else if (id === 7) { if (t.status === 1 || t.status === 3) t.status = 0; }
  else if (id === 8 || id === 9) { if (t.status === 1 || t.status === 5) t.status = 0; }
  else if (id === 163) t.status = 0;
  else if (item.status_code !== 0) { if (t.status !== item.status_code) return miss(); t.status = 0; }
  if (t.status === before) return value > 0 ? hit(t, 'heal', value, popup) : hit(t, 'none', 0, '');
  return value > 0 ? hit(t, 'heal', value, popup) : hit(t, 'cure', 0, 'well');
}

/** One FUN_0043b4a0 call per target; lifesteal/drain heal the caster (last target) by the first damage dealt. */
export function resolveAction(actor: Unit, action: number, targets: Unit[], ctx: ResolveContext): Hit[] {
  if (action === 0) return targets.map((t) => resolvePhysical(actor, t, ctx));
  if (action >= 1000) return targets.map((t) => resolveItem(t, action - 1000, ctx));
  const hits: Hit[] = [];
  for (const t of targets) {
    if ((action === 55 || action === 81) && t === actor) {
      const first = hits.find((h) => h.kind === 'damage');
      const v = first ? Math.min(first.value, actor.hpMax - actor.hp) : 0;
      actor.hp += v;
      hits.push(hit(actor, 'heal', v, String(v)));
      continue;
    }
    hits.push(resolveMagic(actor, t, action, ctx));
  }
  return hits;
}
