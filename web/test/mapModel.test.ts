import { describe, expect, it } from 'vitest';
import { bgPosition } from '../src/map/mapModel';
import type { IndexedImage } from '../src/assets/png';
import type { MapData } from '../src/assets/types';
import { layerKey, MapDataError, MapModel } from '../src/map/mapModel';

function sheet(topLeft: number, width = 64, height = 32): IndexedImage {
  const indices = new Uint8Array(width * height).fill(7);
  indices[0] = topLeft;
  return { width, height, indices, palette: new Uint8Array(768) };
}

/** 2×2 logical grid → N = 3, five cells: (1,0) (0,1) (1,1) (2,1) (1,2). Index = order in `cells`. */
function map(overrides: Partial<MapData> = {}): MapData {
  const N = 3;
  const cellAt = new Array<number>(N * N).fill(-1);
  const place = (c: number, r: number, i: number) => { cellAt[c * N + r] = i; };
  place(1, 0, 0); place(0, 1, 1); place(1, 1, 2); place(2, 1, 3); place(1, 2, 4);
  const empty = { blocked: 0, flag2: 0, land: 1, objs: [] };
  return {
    w: 2, h: 2, bg: null, layers: ['l0'], bgOrigin: [0, 0], bgParallax: [1, 1], origin: [64, 0], pixelSize: [640, 480],
    cells: [
      { h: 0, ...empty, objs: [{ layer: 0, front: 0, left: 0, top: 0, right: 64, bottom: 32, ox: -32, oy: -16 }] },
      { h: 0, ...empty }, { h: 0, ...empty }, { h: 0, ...empty }, { h: 2, ...empty },
    ],
    cellAt, ...overrides,
  };
}

describe('layerKey', () => {
  it('uses the top-left index when it is reserved (<=9 or >=246)', () => {
    expect(layerKey(sheet(253))).toBe(253);
    expect(layerKey(sheet(255))).toBe(255);
    expect(layerKey(sheet(5))).toBe(5);
  });
  it('falls back to 249 for an ordinary color', () => {
    expect(layerKey(sheet(67))).toBe(249);
    expect(layerKey(sheet(121))).toBe(249);
  });
});

describe('MapModel', () => {
  it('builds rows in c-ascending order with anchors', () => {
    const m = new MapModel(map(), [sheet(249)], null);
    expect(m.N).toBe(3);
    expect(m.rows.map((r) => r.cells.map((p) => [p.c, p.r]))).toEqual([[], [[0, 1], [1, 0]], [[1, 1]], [[1, 2], [2, 1]], []]);
    expect(m.cellAt(1, 1)).toMatchObject({ x: 64, y: 32 });          // (1-1)*32+64, (1+1)*16
    expect(m.cellAt(1, 2)).toMatchObject({ x: 32, y: 48 - 16 });     // height 2 → -16
    expect(m.cellAt(0, 0)).toBeNull();
    expect(m.layerKeys).toEqual([249]);
  });
  it('picks the front-most cell under a point and null outside', () => {
    const m = new MapModel(map(), [sheet(249)], null);
    expect(m.pick(64, 30)).toMatchObject({ c: 1, r: 1 });
    expect(m.pick(40, 34)).toMatchObject({ c: 1, r: 2 });            // raised (1,2) is drawn after (1,1) and (0,1), so it wins
    expect(m.pick(400, 400)).toBeNull();
  });
  it('accepts a map without background and without layers', () => {
    const data = map({ layers: [], cells: map().cells.map((c) => ({ ...c, objs: [] })) });
    const m = new MapModel(data, [], null);
    expect(m.bg).toBeNull();
    expect(m.rows[2]!.cells).toHaveLength(1);
  });
  it('rejects a layer count mismatch', () => {
    expect(() => new MapModel(map(), [], null)).toThrow(MapDataError);
  });
  it('rejects an object whose layer index is out of range', () => {
    const data = map();
    data.cells[0]!.objs[0]!.layer = 3;
    expect(() => new MapModel(data, [sheet(249)], null)).toThrow(/layer 3 out of range/);
  });
  it('rejects an object rect outside its layer sheet', () => {
    const data = map();
    data.cells[0]!.objs[0]!.bottom = 999;
    expect(() => new MapModel(data, [sheet(249)], null)).toThrow(/outside layer/);
  });
});

describe('bgPosition (FUN_00431900)', () => {
  it('the background sits at its map-pixel origin and scrolls with the camera when the divisors are 1', () => {
    const m = map({ bgOrigin: [128, 96], bgParallax: [1, 1] });
    expect(bgPosition(m, { x: 0, y: 0 })).toEqual({ x: 128, y: 96 });
    expect(bgPosition(m, { x: 50, y: 20 })).toEqual({ x: 78, y: 76 });
  });
  it('a divisor of 0 pins the background to the screen; larger divisors scroll it slower (integer division toward zero)', () => {
    expect(bgPosition(map({ bgOrigin: [-320, 64], bgParallax: [0, 0] }), { x: 400, y: 100 })).toEqual({ x: 0, y: 304 });
    expect(bgPosition(map({ bgOrigin: [0, 0], bgParallax: [2, 1] }), { x: 100, y: 0 })).toEqual({ x: 110, y: 0 });   // 320 + trunc(−420 / 2)
    expect(bgPosition(map({ bgOrigin: [0, 0], bgParallax: [2, 1] }), { x: -321, y: 0 })).toEqual({ x: 320, y: 0 });  // trunc(1 / 2) = 0
  });
});
