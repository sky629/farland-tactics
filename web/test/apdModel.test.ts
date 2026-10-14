import { describe, expect, it } from 'vitest';
import type { IndexedImage } from '../src/assets/png';
import type { ApdData } from '../src/assets/types';
import { ApdDataError, ApdModel } from '../src/sprite/apdModel';
import type { Frame } from '../src/sprite/animScript';

const sheet = (width = 128, height = 64): IndexedImage => ({ width, height, indices: new Uint8Array(width * height), palette: new Uint8Array(768) });
const frame = (pattern: number, flipH = false, flipV = false): Frame => ({ pattern, flipH, flipV, ms: 200, trigger: null, triggerSharp: false, mark: 0 });

function data(overrides: Partial<ApdData> = {}): ApdData {
  return {
    version: 3, sheets: ['a', 'g'],
    images: [
      { sheet: 0, key: 253, x: 0, y: 0, w: 64, h: 64, ox: -32, oy: -56 },
      { sheet: 1, key: 255, x: 64, y: 0, w: 16, h: 8, ox: 4, oy: -70 },
    ],
    patterns: [{ yOffset: 0, images: [0] }, { yOffset: 32, images: [0, 1] }],
    anims: [{ name: 'F.STAND', script: 'P0' }, { name: 'BROKEN', script: 'P9' }],
    ...overrides,
  };
}

describe('ApdModel', () => {
  it('compiles the anims and collects per-anim errors', () => {
    const m = new ApdModel('char_01a', data(), [sheet(), sheet()]);
    expect(m.animNames()).toEqual(['F.STAND', 'BROKEN']);
    expect(m.anim('f.stand')?.steps[0]?.frames[0]?.pattern).toBe(0);
    expect(m.errors.map((e) => e.anim)).toEqual(['BROKEN']);
  });
  it('places images at origin + (ox, oy) and subtracts the pattern yOffset', () => {
    const m = new ApdModel('x', data(), [sheet(), sheet()]);
    expect(m.commands(frame(1))).toEqual([
      { sheet: 0, key: 253, sx: 0, sy: 0, w: 64, h: 64, dx: -32, dy: -56 - 32, flipH: false, flipV: false },
      { sheet: 1, key: 255, sx: 64, sy: 0, w: 16, h: 8, dx: 4, dy: -70 - 32, flipH: false, flipV: false },
    ]);
  });
  it('mirrors offsets as -(ox + w) and -(oy + h) when flipped (FUN_00428620)', () => {
    const m = new ApdModel('x', data(), [sheet(), sheet()]);
    const [c] = m.commands(frame(0, true, true));
    expect(c).toMatchObject({ dx: -(-32 + 64), dy: -(-56 + 64), flipH: true, flipV: true });
  });
  it('bounds is the union of the image rects', () => {
    const m = new ApdModel('x', data(), [sheet(), sheet()]);
    expect(m.bounds(frame(1))).toEqual({ left: -32, top: -102, right: 32, bottom: -24 });
  });
  it('uses key 255 for every image of a version < 2 file', () => {
    const m = new ApdModel('old', data({ version: 1 }), [sheet(), sheet()]);
    expect(m.keys).toEqual([255, 255]);
    expect(m.keysBySheet()).toEqual(new Map([[0, new Set([255])], [1, new Set([255])]]));
  });
  it('groups keys by sheet', () => {
    const m = new ApdModel('x', data(), [sheet(), sheet()]);
    expect(m.keysBySheet()).toEqual(new Map([[0, new Set([253])], [1, new Set([255])]]));
  });
  it('rejects a sheet count mismatch, an image outside its sheet and a pattern with a bad image index', () => {
    expect(() => new ApdModel('x', data(), [sheet()])).toThrow(ApdDataError);
    const outside = data(); outside.images[0]!.w = 999;
    expect(() => new ApdModel('x', outside, [sheet(), sheet()])).toThrow(/image 0 .* outside sheet 0/);
    const badPattern = data(); badPattern.patterns[0]!.images = [7];
    expect(() => new ApdModel('x', badPattern, [sheet(), sheet()])).toThrow(/pattern 0: image 7 out of range/);
  });
});
