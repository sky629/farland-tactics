export const TILE_W = 64;
export const TILE_H = 32;
export const HEIGHT_STEP = 8;
export const VIEW_W = 640;
export const VIEW_H = 480;

export interface GridGeometry { w: number; h: number; originX: number; originY: number }

/** Diagonal grid size: c and r both run 0..N-1 (FUN_0042d960). */
export function gridSize(g: GridGeometry): number {
  return g.w + g.h - 1;
}

/** Center of the 64×32 diamond of cell (c, r) in map pixels (FUN_0042dd00). */
export function cellAnchor(g: GridGeometry, c: number, r: number, height: number): { x: number; y: number } {
  return { x: (c - r) * (TILE_W / 2) + g.originX, y: (c + r) * (TILE_H / 2) + g.originY - height * HEIGHT_STEP };
}

export function inDiamond(px: number, py: number, ax: number, ay: number): boolean {
  return Math.abs(px - ax) / (TILE_W / 2) + Math.abs(py - ay) / (TILE_H / 2) <= 1;
}

/** Cells of diagonal row s (= c + r), c ascending. Rows run 0..2N-2 (FUN_0042cde0 loop bounds). */
export function rowCells(N: number, s: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let c = Math.max(0, s - (N - 1)); c <= Math.min(N - 1, s); c++) out.push([c, s - c]);
  return out;
}
