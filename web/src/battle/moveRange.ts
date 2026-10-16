import { costLand, type RaceData, type Tables } from '../data/types';
import { dist, hostile, incap, opposite, stepCell, unitAt, unitsWithin, type BattleGrid, type Dir } from './grid';
import type { Unit } from './unit';

export const RANGE_SIZE = 21;
const HALF = 10;
export const MOVE_BUDGET = 30;
export type TargetKind = 0 | 1 | 2;   // 1 = attack/enemy cell, 2 = friend cell (FUN_00439690)

/** 21×21 window of (remaining move, target kind) around the acting unit (DAT_0044c4b0). */
export class RangeTable {
  readonly move = new Int16Array(RANGE_SIZE * RANGE_SIZE);
  readonly kind = new Uint8Array(RANGE_SIZE * RANGE_SIZE);
  constructor(readonly cx: number, readonly cy: number) {}

  index(c: number, r: number): number {
    const dx = c - this.cx + HALF, dy = r - this.cy + HALF;
    return dx < 0 || dy < 0 || dx >= RANGE_SIZE || dy >= RANGE_SIZE ? -1 : dx * RANGE_SIZE + dy;
  }
  moveAt(c: number, r: number): number { const i = this.index(c, r); return i < 0 ? 0 : this.move[i]!; }
  kindAt(c: number, r: number): TargetKind { const i = this.index(c, r); return i < 0 ? 0 : (this.kind[i] as TargetKind); }
  setMove(c: number, r: number, v: number): void { const i = this.index(c, r); if (i >= 0) this.move[i] = v; }
  setKind(c: number, r: number, k: TargetKind): void { const i = this.index(c, r); if (i >= 0) this.kind[i] = k; }

  *cells(): Iterable<{ c: number; r: number; move: number; kind: TargetKind }> {
    for (let dx = 0; dx < RANGE_SIZE; dx++) {
      for (let dy = 0; dy < RANGE_SIZE; dy++) {
        const i = dx * RANGE_SIZE + dy;
        if (this.move[i] !== 0 || this.kind[i] !== 0) yield { c: this.cx + dx - HALF, r: this.cy + dy - HALF, move: this.move[i]!, kind: this.kind[i] as TargetKind };
      }
    }
  }
}

const flies = (race: RaceData, u: Unit) => race.cost_land0 !== 99 || u.status === 11;

/** FUN_00439690(unit, 0) + FUN_00439b40: budget 30, land cost per cell, climb/drop limits, ZOC (file_formats.md §8). */
export function computeMoveRange(grid: BattleGrid, units: (Unit | null)[], unit: Unit, race: RaceData): RangeTable {
  const t = new RangeTable(unit.c, unit.r);
  t.setMove(unit.c, unit.r, MOVE_BUDGET);
  if (unit.side === 3 || unit.moved || incap(unit.status)) return t;
  const cost = costLand(race);
  const fly = flies(race, unit);
  const inZoc = (c: number, r: number, h: number) => units.some((v) => v && v !== unit && hostile(unit, v) && !incap(v.status)
    && dist(v.c, v.r, c, r) === 1 && Math.abs(grid.height(v.c, v.r) - h) < 8);
  const visit = (c: number, r: number, remaining: number): void => {
    if (remaining < 2) return;
    const hc = grid.height(c, r);
    for (let d = 0; d < 4; d++) {
      const [nc, nr] = stepCell(c, r, d as Dir);
      const cell = grid.cell(nc, nr);
      if (!cell || t.index(nc, nr) < 0) continue;
      let k = cell.blocked ? 99 : cell.flag2 !== 0 || unitAt(units, nc, nr) ? 0 : cost[cell.land] ?? 99;
      if (unit.status === 11 && cell.land === 0 && !cell.blocked) k = race.cost_land1;
      if (unit.status === 10) k -= 1;
      if (k >= 99) continue;
      if (!fly) {
        const dh = cell.h - hc;
        if (dh > race.climb_max || -dh > race.drop_max) continue;
      }
      let left = remaining - k;
      if (left < 1 || left <= t.moveAt(nc, nr)) continue;
      if (inZoc(nc, nr, cell.h)) left = 1;
      t.setMove(nc, nr, left);
      visit(nc, nr, left);
    }
  };
  visit(unit.c, unit.r, MOVE_BUDGET);
  return t;
}

/** FUN_00439690: action 0 marks physical targets (with the original early-return height quirk); a magic index marks its range. Returns the count. */
export function markTargets(t: RangeTable, grid: BattleGrid, units: (Unit | null)[], unit: Unit, action: number, tables: Tables): number {
  let n = 0;
  if (action === 0) {
    if (unit.acted) return 0;
    const w = tables.item[unit.weapon]!;
    for (const v of unitsWithin(units, unit.c, unit.r, w.range_min, w.range_max)) {
      if (w.weapon_type !== 3 && Math.abs(grid.height(unit.c, unit.r) - grid.height(v.c, v.r)) > 4) return n;   // original: whole function returns
      if (hostile(unit, v) && t.index(v.c, v.r) >= 0 && (w.weapon_type !== 1 || v.c === unit.c || v.r === unit.r)) {
        t.setKind(v.c, v.r, 1);
        n++;
      }
    }
    return n;
  }
  const m = tables.magic[action]!;
  const kind: TargetKind = m.target === 1 ? 2 : 1;
  if (m.shape === 0 || m.shape === 1 || m.shape === 3) {
    for (let dx = -HALF; dx <= HALF; dx++) {
      for (let dy = -HALF; dy <= HALF; dy++) {
        const c = unit.c + dx, r = unit.r + dy, d = Math.abs(dx) + Math.abs(dy);
        const cell = grid.cell(c, r);
        if (cell && cell.blocked === 0 && d >= m.range_min && d <= m.range_max) { t.setKind(c, r, kind); n++; }
      }
    }
  } else if (m.shape === 2 || m.shape === 5) {
    for (let d = 0; d < 4; d++) {
      let c = unit.c, r = unit.r, prev = grid.cell(c, r);
      for (let step = 1; step < m.range_max; step++) {
        [c, r] = stepCell(c, r, d as Dir);
        const cell = grid.cell(c, r);
        if (!cell) break;
        if (step >= m.range_min) {
          if (action === 60 && (cell.flag2 !== 0 || cell.h !== (prev?.h ?? 0))) break;
          if (action === 62 && (cell.flag2 !== 0 || cell.h > (prev?.h ?? 0))) break;
          if (t.index(c, r) >= 0) { t.setKind(c, r, kind); n++; }
        }
        prev = cell;
      }
    }
  }
  return n;
}

/** Movable destination: has move points and holds nobody, the unit itself, or a treasure object (FUN_00438c70). */
export function canStop(t: RangeTable, units: (Unit | null)[], unit: Unit, c: number, r: number): boolean {
  if (t.moveAt(c, r) === 0) return false;
  const v = unitAt(units, c, r);
  return !v || v === unit || (v.side === 7 && v.id === 8);
}

/** FUN_00438960: from dest back to the unit, always stepping to a neighbour with more move points (ties keep the previous direction). */
export function pathTo(t: RangeTable, grid: BattleGrid, unit: Unit, race: RaceData, dest: [number, number]): Dir[] {
  let [c, r] = dest;
  const back: Dir[] = [];
  let prevDir = -1;
  const limit = flies(race, unit) ? 99 : null;
  while (c !== unit.c || r !== unit.r) {
    if (back.length >= 30) return [];
    let best = -1, bestMove = t.moveAt(c, r);
    const hc = grid.height(c, r);
    for (let d = 0; d < 4; d++) {
      const [nc, nr] = stepCell(c, r, d as Dir);
      if (t.index(nc, nr) < 0 || !grid.cell(nc, nr)) continue;
      const hn = grid.height(nc, nr);
      if (hc - hn > (limit ?? race.climb_max) || hn - hc > (limit ?? race.drop_max)) continue;
      const mv = t.moveAt(nc, nr);
      if (mv > bestMove || (mv === bestMove && d === prevDir)) { best = d; bestMove = mv; }
    }
    if (best < 0) return [];
    back.push(opposite(best as Dir));
    [c, r] = stepCell(c, r, best as Dir);
    prevDir = best;
  }
  return back.reverse();
}
