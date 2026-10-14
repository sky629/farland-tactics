import type { IndexedImage } from '../assets/png';
import type { MapCell, MapData } from '../assets/types';
import { cellAnchor, gridSize, inDiamond, rowCells, type GridGeometry } from '../iso/grid';

export class MapDataError extends Error {
  override name = 'MapDataError';
}

export const DEFAULT_LAYER_KEY = 249;

/** Color key of a map layer sheet (FUN_00431460): the top-left pixel, unless it is an ordinary color 10..245 → 249. */
export function layerKey(img: IndexedImage): number {
  const p = img.indices[0] ?? DEFAULT_LAYER_KEY;
  return p >= 10 && p <= 245 ? DEFAULT_LAYER_KEY : p;
}

export interface PlacedCell { c: number; r: number; index: number; cell: MapCell; x: number; y: number }
export interface MapRow { s: number; cells: PlacedCell[] }

export class MapModel {
  readonly N: number;
  readonly geometry: GridGeometry;
  readonly rows: MapRow[] = [];
  readonly layerKeys: number[];
  private readonly byPos = new Map<number, PlacedCell>();

  constructor(readonly data: MapData, readonly layers: IndexedImage[], readonly bg: IndexedImage | null) {
    if (layers.length !== data.layers.length) {
      throw new MapDataError(`expected ${data.layers.length} layer images, got ${layers.length}`);
    }
    this.geometry = { w: data.w, h: data.h, originX: data.origin[0], originY: data.origin[1] };
    this.N = gridSize(this.geometry);
    if (data.cellAt.length !== this.N * this.N) {
      throw new MapDataError(`cellAt has ${data.cellAt.length} entries, expected ${this.N * this.N}`);
    }
    this.layerKeys = layers.map(layerKey);
    for (let s = 0; s <= 2 * this.N - 2; s++) {
      const cells: PlacedCell[] = [];
      for (const [c, r] of rowCells(this.N, s)) {
        const index = data.cellAt[c * this.N + r]!;
        if (index < 0) continue;
        const cell = data.cells[index];
        if (!cell) throw new MapDataError(`cellAt points to cell ${index} but there are ${data.cells.length}`);
        for (const o of cell.objs) {
          const img = layers[o.layer];
          if (!img) throw new MapDataError(`cell ${index}: object layer ${o.layer} out of range`);
          if (o.left < 0 || o.top < 0 || o.right > img.width || o.bottom > img.height) {
            throw new MapDataError(`cell ${index}: object rect outside layer ${o.layer} (${img.width}×${img.height})`);
          }
        }
        const { x, y } = cellAnchor(this.geometry, c, r, cell.h);
        const placed = { c, r, index, cell, x, y };
        cells.push(placed);
        this.byPos.set(c * this.N + r, placed);
      }
      this.rows.push({ s, cells });
    }
  }

  cellAt(c: number, r: number): PlacedCell | null {
    return this.byPos.get(c * this.N + r) ?? null;
  }

  /** Front-most cell (last in draw order) whose height-adjusted diamond contains the map-pixel point. */
  pick(px: number, py: number): PlacedCell | null {
    let hit: PlacedCell | null = null;
    for (const row of this.rows) for (const p of row.cells) if (inDiamond(px, py, p.x, p.y)) hit = p;
    return hit;
  }
}
