import { describe, expect, it } from 'vitest';
import { decodeIndexedPng, PngFormatError } from '../src/assets/png';
import { makePng, PAL4 } from './helpers/makePng';

describe('decodeIndexedPng', () => {
  it('returns indices and a 768-byte palette', async () => {
    const img = await decodeIndexedPng(makePng(3, 2, [0, 1, 2, 3, 2, 1], PAL4));
    expect(img.width).toBe(3); expect(img.height).toBe(2);
    expect(Array.from(img.indices)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(img.palette.length).toBe(768);                 // short palette (4 colors) padded with zeros
    expect(Array.from(img.palette.subarray(9, 12))).toEqual([255, 0, 255]);
    expect(img.palette[767]).toBe(0);
  });
  it('joins several IDAT chunks', async () => {
    const img = await decodeIndexedPng(makePng(4, 4, Array.from({ length: 16 }, (_, i) => i % 4), PAL4, { idatSplit: 5 }));
    expect(img.indices[15]).toBe(3);
  });
  it('rejects a non-indexed color type', async () => {
    await expect(decodeIndexedPng(makePng(1, 1, [0], PAL4, { colorType: 2 }))).rejects.toThrow(PngFormatError);
    await expect(decodeIndexedPng(makePng(1, 1, [0], PAL4, { colorType: 2 }))).rejects.toThrow('color type 2');
  });
  it('rejects a row filter other than 0', async () => {
    await expect(decodeIndexedPng(makePng(2, 1, [0, 1], PAL4, { filter: 1 }))).rejects.toThrow('filter 1');
  });
  it('rejects a buffer without the PNG signature', async () => {
    await expect(decodeIndexedPng(new Uint8Array([1, 2, 3]).buffer)).rejects.toThrow(PngFormatError);
  });
});
