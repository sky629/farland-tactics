import { describe, expect, it } from 'vitest';
import type { IndexedImage } from '../src/assets/png';
import { indexedToRgba } from '../src/gfx/indexed';

function image(): IndexedImage {
  const palette = new Uint8Array(768);
  palette.set([10, 20, 30], 0);          // index 0
  palette.set([255, 0, 255], 253 * 3);   // index 253 magenta (a typical key)
  return { width: 2, height: 1, indices: new Uint8Array([0, 253]), palette };
}

describe('indexedToRgba', () => {
  it('copies palette colors with alpha 255 when there is no key', () => {
    const rgba = indexedToRgba(image(), null);
    expect(Array.from(rgba)).toEqual([10, 20, 30, 255, 255, 0, 255, 255]);
  });
  it('makes only the key index transparent', () => {
    const rgba = indexedToRgba(image(), 253);
    expect(Array.from(rgba.subarray(0, 4))).toEqual([10, 20, 30, 255]);
    expect(rgba[7]).toBe(0);
  });
  it('leaves other reserved indices opaque (key 255 must not hide index 253)', () => {
    const rgba = indexedToRgba(image(), 255);
    expect(rgba[7]).toBe(255);
  });
});
