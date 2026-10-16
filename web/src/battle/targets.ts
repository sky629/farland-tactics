import type { ItemData, MagicData, Tables } from '../data/types';
import { dirTo, dist, hostile, stepCell, unitAt, type BattleGrid, type Dir } from './grid';
import type { Unit } from './unit';

/** FUN_0043e350: shape-1 radius from level − learn_level. */
export function magicRadius(unit: Unit, magic: MagicData): number {
  const d = unit.level - magic.learn_level;
  return d >= 20 ? 2 : d >= 10 ? 1 : 0;
}

/** FUN_00412a80: hostile, alive, not an object; melee needs |Δh| ≤ 4 (bows ignore height); line weapons need a shared row or column. */
export function canAttack(grid: BattleGrid, fromC: number, fromR: number, actor: Unit, target: Unit, weapon: ItemData): boolean {
  if (!hostile(actor, target) || target.status === 1 || target.side === 7) return false;
  if (weapon.weapon_type !== 3 && Math.abs(grid.height(fromC, fromR) - grid.height(target.c, target.r)) > 4) return false;
  if (weapon.weapon_type === 1 && target.c !== fromC && target.r !== fromR) return false;
  return true;
}

const perpendicular = (d: Dir): [Dir, Dir] => (d === 0 || d === 3 ? [1, 2] : [0, 3]);
const alive = (u: Unit) => u.status !== 1 && u.side !== 7;
const campOk = (actor: Unit, u: Unit, magic: MagicData) => magic.target === 2 || hostile(actor, u) === (magic.target === 0);

/** FUN_00438d70: the units an action at `cell` affects. The actor already faces `cell`. */
export function targetsOf(grid: BattleGrid, units: (Unit | null)[], actor: Unit, action: number, cell: [number, number], tables: Tables): Unit[] {
  const out: Unit[] = [];
  const hA = grid.height(actor.c, actor.r);
  if (action >= 1000) { const u = unitAt(units, cell[0], cell[1]); return u ? [u] : []; }   // consumable: the unit on the chosen cell
  if (action === 0) {
    const w = tables.item[actor.weapon]!;
    if (w.weapon_type === 1) {
      let c = actor.c, r = actor.r;
      for (let step = 1; step <= w.range_max; step++) {
        [c, r] = stepCell(c, r, actor.dir);
        if (step < w.range_min) continue;
        const u = unitAt(units, c, r);
        if (u && alive(u) && Math.abs(grid.height(c, r) - hA) <= 4) out.push(u);
      }
    } else if (w.weapon_type === 2) {
      for (const d of [actor.dir, ...perpendicular(actor.dir)]) {
        const [c, r] = stepCell(actor.c, actor.r, d);
        const u = unitAt(units, c, r);
        if (u && alive(u) && Math.abs(grid.height(c, r) - hA) <= 4) out.push(u);
      }
    } else {
      const u = unitAt(units, cell[0], cell[1]);
      if (u) out.push(u);
    }
    return out;
  }
  const m = tables.magic[action]!;
  if (m.shape === 2) {
    let c = actor.c, r = actor.r, prevH = hA;
    for (let step = 1; step <= m.range_max; step++) {
      [c, r] = stepCell(c, r, actor.dir);
      const cellData = grid.cell(c, r);
      if (!cellData) break;
      const dh = cellData.h - prevH;
      if (action === 60 && (cellData.flag2 !== 0 || dh !== 0)) break;
      if (action === 62 && cellData.h - hA > 0) break;
      if (action === 77 && (cellData.flag2 !== 0 || dh > 0)) break;
      if (step >= m.range_min) {
        const u = unitAt(units, c, r);
        if (u && alive(u) && campOk(actor, u, m)) {
          out.push(u);
          if (action === 62) break;      // the original stops after a hit unless the line dropped 5 or more
        }
      }
      prevH = cellData.h;
    }
  } else {
    let center = cell, min = 0, max = 0;
    if (m.shape === 1) max = magicRadius(actor, m);
    else if (m.shape === 3 || m.shape === 5) { center = [actor.c, actor.r]; min = m.range_min; max = m.range_max; }
    else if (m.shape === 4) max = 9999;
    for (const u of units) {
      if (!u || u.id === 0 || (u.status === 9 && u.id !== 8) || (u.side === 7 && action !== 41 && action !== 64)) continue;
      if (!campOk(actor, u, m)) continue;
      const d = dist(u.c, u.r, center[0], center[1]);
      if (d < min || d > max) continue;
      if (m.shape === 5) {
        if (u.c !== center[0] && u.r !== center[1]) continue;
        const dd = dirTo(center[0], center[1], u.c, u.r);
        if (dd !== actor.dir && dd !== (actor.dir ^ 3)) continue;
      }
      if (action === 41) { if (u.status === 1 || u.side === 7) out.push(u); }
      else if (action === 64 || alive(u)) out.push(u);
    }
  }
  if (action === 55 || action === 81) out.push(actor);
  return out;
}
