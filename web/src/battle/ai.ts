import type { MagicData, Tables } from '../data/types';
import { dirTo, dist, hostile, incap, liveUnits, stepCell, unitAt, unitsWithin, type Dir } from './grid';
import { computeMoveRange, pathTo } from './moveRange';
import { canAttack, magicRadius } from './targets';
import type { BattleState } from './types';
import type { Unit } from './unit';

export interface AiDecision { dest: [number, number]; path: Dir[]; action: number | null; cell: [number, number] | null; faceDir: Dir | null }

export const AI_R = 4;                                       // DAT_0044a058
export const LAND_BONUS = [0, 10, 15, 20, 40, 15, 20, 10];   // DAT_0044ab00
const HALF = 10;
const trunc = Math.trunc;

interface CellScore { c: number; r: number; move: number; attack: number; attackTarget: Unit | null; magic: number; magicId: number; target: [number, number] | null }

const CURE_SCORE: Record<number, number> = { 2: 60, 8: 60, 3: 50, 4: 80, 5: 70, 7: 80 };
const REDUNDANT: Record<number, number> = { 5: 8, 11: 8, 12: 8, 24: 3, 50: 2, 52: 7, 78: 5 };
const LINE_REDUNDANT: Record<number, number> = { 72: 5, 73: 2, 74: 8, 75: 4 };

/** FUN_00411b10 + FUN_004118b0: score every reachable cell, pick the best, then decide attack / magic / facing. */
export function chooseAction(state: BattleState, u: Unit, tables: Tables): AiDecision {
  const { grid, units } = state;
  const race = tables.race[u.race]!;
  const weapon = tables.item[u.weapon]!;
  let mode = u.side === 0 ? 4 : u.side;
  if (mode !== 6 && (u.acted || incap(u.status))) mode = 5;
  const table = computeMoveRange(grid, units, u, race, tables.item);
  const canMove = !u.moved && !incap(u.status);
  const canAct = !u.acted && !incap(u.status);
  const enemies = liveUnits(units).filter((v) => v !== u && v.status !== 9 && hostile(u, v) && v.status !== 1 && v.side !== 7);
  const nearestEnemyDist = (c: number, r: number) => enemies.reduce((m, v) => Math.min(m, dist(v.c, v.r, c, r)), 999);

  const scores: CellScore[] = [];
  for (let dy = -HALF; dy <= HALF; dy++) {
    for (let dx = -HALF; dx <= HALF; dx++) {
      const c = u.c + dx, r = u.r + dy, own = dx === 0 && dy === 0;
      const s: CellScore = { c, r, move: 0, attack: 0, attackTarget: null, magic: 0, magicId: 0, target: null };
      scores.push(s);
      const cell = grid.cell(c, r);
      const occupant = unitAt(units, c, r);
      if (!cell || table.moveAt(c, r) === 0 || (occupant && occupant !== u)) { s.move = -9999; continue; }
      if (!canMove && !own) continue;
      if (own && mode === 2) s.move = 10;
      if (own && mode === 5) {
        s.move = 10;
        if (unitsWithin(units, c, r, 1, AI_R).some((v) => hostile(v, u) && !incap(v.status))) s.move = 0;
      }
      s.move += trunc((LAND_BONUS[cell.land] ?? 0) / (mode === 5 ? 5 : 10));
      let acc = 0, adjacent = 0;
      for (const v of unitsWithin(units, c, r, 1, AI_R)) {
        if (mode !== 6 && hostile(u, v) && !incap(v.status)) { s.move -= trunc(acc / 2); acc += 3; adjacent++; }
      }
      if (mode === 5 || adjacent === 0) {
        let dmin = nearestEnemyDist(c, r);
        if (mode === 6) dmin *= 2;
        s.move += mode === 5 ? dmin : AI_R - dmin;
      }
      if (canAct) {
        const cands = unitsWithin(units, c, r, weapon.range_min, weapon.range_max);
        if (cands.length > 0) {
          let base = mode === 5 ? 5 : mode === 6 ? 40 : 20;
          if (mode === 2 && own) { base += 10; s.move = 0; }
          for (const v of cands) {
            if (!canAttack(grid, c, r, u, v, weapon)) continue;
            let bonus = 8;
            const d = dirTo(c, r, v.c, v.r);
            if (d !== v.dir) bonus = (d ^ 3) === v.dir ? 0 : 4;
            if (v.status === 7) base = 5;
            if (mode === 5) bonus >>= 2;
            if (u.side === 0 && ((v.c === c && u.c === c) || (v.r === r && u.r === r)) && dist(u.c, u.r, c, r) > 2) bonus += 40;
            const score = base + bonus;
            if (score > s.attack) { s.attack = score; s.attackTarget = v; }
          }
        }
        u.spells.forEach((m, i) => scoreMagic(s, u, m, i * 10, mode, own, state, tables));
      }
    }
  }
  let best: CellScore | null = null, bestDist = 999;
  const totalOf = (s: CellScore) => s.move + Math.max(s.attack, s.magic);
  for (const s of scores) {
    if (s.move === -9999) continue;
    const total = totalOf(s);
    const d = Math.abs(s.c - u.c) + Math.abs(s.r - u.r);
    if (!best || total > totalOf(best) || (total === totalOf(best) && d < bestDist)) { best = s; bestDist = d; }
  }
  const dest: [number, number] = best ? [best.c, best.r] : [u.c, u.r];
  const path = dest[0] === u.c && dest[1] === u.r ? [] : pathTo(table, grid, u, race, dest, tables.item);
  if (!best || best.magicId === 0 || best.magic <= best.attack) {
    if (best?.attackTarget) return { dest, path, action: 0, cell: [best.attackTarget.c, best.attackTarget.r], faceDir: null };
    let near: Unit | null = null;
    for (const v of enemies) if (!near || dist(v.c, v.r, dest[0], dest[1]) < dist(near.c, near.r, dest[0], dest[1])) near = v;
    return { dest, path, action: null, cell: null, faceDir: near ? dirTo(dest[0], dest[1], near.c, near.r) : null };
  }
  return { dest, path, action: best.magicId, cell: best.target, faceDir: null };
}

/** Magic scoring for one spell slot from cell (s.c, s.r). `pen` = slot index × 10. */
function scoreMagic(s: CellScore, u: Unit, m: number, pen: number, mode: number, own: boolean, state: BattleState, tables: Tables): void {
  const { grid, units } = state;
  if (m === 0 || u.status === 6 || m === 31) return;
  const M = tables.magic[m];
  if (!M || u.mp < Math.abs(M.mp_cost)) return;
  const campOk = (v: Unit) => (v.status !== 1 && v.side !== 7) || M.target === 2 || hostile(u, v) === (M.target === 0);
  let rmin = 0, rmax = 0, tmin = 0, tmax = 0;
  switch (M.shape) {
    case 0: rmin = M.range_min; rmax = M.range_max; break;
    case 1: rmin = M.range_min; rmax = M.range_max; tmax = magicRadius(u, M); break;
    case 3: tmin = M.range_min; tmax = M.range_max; break;
    case 4: tmax = 9999; break;
    case 2: scoreLine(s, u, m, M, mode, state); return;
    default: return;
  }
  for (let ty = s.r - rmax; ty <= s.r + rmax; ty++) {
    for (let tx = s.c - rmax; tx <= s.c + rmax; tx++) {
      const cell = grid.cell(tx, ty);
      const d = dist(tx, ty, s.c, s.r);
      if (!cell || cell.blocked !== 0 || d < rmin || d > rmax) continue;
      const victims = unitsWithin(units, tx, ty, tmin, tmax);
      if (victims.length === 0) continue;
      let sc = 0;
      for (const v of victims) {
        if (!campOk(v)) continue;
        const onCell = v.c === tx && v.r === ty;
        if (m === 13 || m === 45) {
          if (!hostile(u, v) && v.status !== 0) sc = CURE_SCORE[v.status] ?? 0;
          if (sc > 0 && onCell) sc += 1;
        } else if (m === 32 || m === 40) {
          if (!hostile(u, v) && v.status !== 1 && v.side !== 7 && v.hp < v.hpMax) sc += trunc(((v.hpMax - v.hp) * 100) / v.hpMax);
          if (sc > 0 && onCell) sc += 1;
        } else if (m === 41) {
          if (!hostile(u, v) && (v.status === 1 || v.side === 7)) sc = 100;
        } else if (m === 55 || m === 81) {
          if (u.hp < u.hpMax && v.status !== 1 && v.side !== 7 && hostile(u, v)) sc = sc - u.hp + (u.hpMax - trunc(v.mgr / 10));
        } else if (!hostile(u, v)) {
          sc -= mode === 6 ? 10 : 20;
        } else {
          sc += 30 + (mode === 6 ? 20 : 0);
          if (onCell) sc += 1;
          if (REDUNDANT[m] === v.status) sc -= 20;
        }
      }
      if (sc > 0 && own) sc += 5;
      if (sc - pen > s.magic) { s.magic = sc - pen; s.magicId = m; s.target = [tx, ty]; }
    }
  }
}

/** Shape 2 (line) scoring: per direction sum over aligned units; the best direction's last unit is the target. */
function scoreLine(s: CellScore, u: Unit, m: number, M: MagicData, mode: number, state: BattleState): void {
  if (m === 62) return;
  const { grid, units } = state;
  const sums: [number, number, number, number] = [0, 0, 0, 0];
  const last: [Unit | null, Unit | null, Unit | null, Unit | null] = [null, null, null, null];
  for (const v of unitsWithin(units, s.c, s.r, M.range_min, M.range_max)) {
    if (v.status === 1 || v.side === 7 || v === u) continue;
    if (!(M.target === 2 || hostile(u, v) === (M.target === 0))) continue;
    if (v.c !== s.c && v.r !== s.r) continue;
    const d = dirTo(s.c, s.r, v.c, v.r);
    if (!hostile(u, v)) { sums[d] -= 40; last[d] = v; continue; }
    if (m === 77) {
      let c = s.c, r = s.r, blocked = false, steps = dist(s.c, s.r, v.c, v.r);
      while (steps-- > 0) {
        const [nc, nr] = stepCell(c, r, d);
        if (grid.height(nc, nr) > grid.height(c, r)) { blocked = true; break; }
        c = nc; r = nr;
      }
      if (blocked) continue;
    }
    sums[d] += mode === 6 ? 40 : 20;
    if (LINE_REDUNDANT[m] === v.status) sums[d] -= 20;
    last[d] = v;
  }
  let bestDir = -1;
  for (let d = 0; d < 4; d++) if (sums[d]! > 0 && (bestDir < 0 || sums[d]! > sums[bestDir]!)) bestDir = d;
  if (bestDir >= 0 && sums[bestDir]! > s.magic) {
    const v = last[bestDir]!;
    s.magic = sums[bestDir]!; s.magicId = m; s.target = [v.c, v.r];
  }
}
