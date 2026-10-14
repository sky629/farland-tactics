import { describe, expect, it } from 'vitest';
import { assertApdData, assertMapData } from '../src/assets/types';

describe('assertMapData', () => {
  it('accepts a complete map', () => {
    const m = { w: 1, h: 1, bg: null, layers: [], start: [0, 0], origin: [0, 0], pixelSize: [640, 480], cells: [], cellAt: [] };
    expect(() => assertMapData(m, 'stage00')).not.toThrow();
  });
  it('names the missing field', () => {
    expect(() => assertMapData({ w: 1 }, 'stage00')).toThrow('stage00: missing field "h"');
  });
});

describe('assertApdData', () => {
  it('rejects a non-array field', () => {
    expect(() => assertApdData({ version: 3, sheets: 'oops', images: [], patterns: [], anims: [] }, 'char_01a')).toThrow('"sheets"');
  });
});
