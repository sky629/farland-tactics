import type { MapCell, MapData } from '../assets/types';
import type { Unit } from './unit';

export type Dir = 0 | 1 | 2 | 3;
/** [dc, dr] per direction: 0 = +y (south), 1 = +x (east), 2 = −x (west), 3 = −y (north). x = c, y = r (unit words 4..7). */
export const DIR_DELTA: readonly [number, number][] = [[0, 1], [1, 0], [-1, 0], [0, -1]];

export const dist = (ac: number, ar: number, bc: number, br: number): number => Math.abs(ac - bc) + Math.abs(ar - br);

/** FUN_0041f4d0: |dx| > |dy| ? (dx > 0 ? 1 : 2) : (dy >= 0 ? 0 : 3). */
export function dirTo(ac: number, ar: number, bc: number, br: number): Dir {
  const dx = bc - ac, dy = br - ar;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 2) : (dy >= 0 ? 0 : 3);
}

export const opposite = (d: Dir): Dir => (d ^ 3) as Dir;
export const stepCell = (c: number, r: number, d: Dir): [number, number] => [c + DIR_DELTA[d]![0], r + DIR_DELTA[d]![1]];

const INCAP = new Set([1, 3, 4, 5, 8, 9]);
export const incap = (status: number): boolean => INCAP.has(status);

/** FUN_0041f520: different camps (party vs non-party), never with side 1 or 7, inverted while the actor is charmed (7). */
export function hostile(a: Unit, b: Unit): boolean {
  if (a === b || a.side === 7 || b.side === 7 || a.side === 1 || b.side === 1) return false;
  const h = (a.side === 0) !== (b.side === 0);
  return a.status === 7 ? !h : h;
}

export class BattleGrid {
  readonly N: number;
  constructor(readonly map: MapData) {
    this.N = map.w + map.h - 1;
  }
  cell(c: number, r: number): MapCell | null {
    if (c < 0 || r < 0 || c >= this.N || r >= this.N) return null;
    const i = this.map.cellAt[c * this.N + r]!;
    return i < 0 ? null : this.map.cells[i]!;
  }
  height(c: number, r: number): number {
    return this.cell(c, r)?.h ?? 0;
  }
}

const visible = (u: Unit | null): u is Unit => u !== null && u.id !== 0 && (u.status !== 9 || u.id === 8);

export const liveUnits = (units: (Unit | null)[]): Unit[] => units.filter((u): u is Unit => u !== null);

/** FUN_0041f5f0 mode 5: the unit standing on (c, r); hidden units (status 9) are skipped unless id 8. */
export function unitAt(units: (Unit | null)[], c: number, r: number): Unit | null {
  return units.find((u) => visible(u) && u.c === c && u.r === r) ?? null;
}

/** FUN_0041f5f0 mode 7: units with min ≤ dist ≤ max from (c, r), slot order. */
export function unitsWithin(units: (Unit | null)[], c: number, r: number, min: number, max: number): Unit[] {
  return units.filter((u): u is Unit => visible(u) && dist(u.c, u.r, c, r) >= min && dist(u.c, u.r, c, r) <= max);
}
