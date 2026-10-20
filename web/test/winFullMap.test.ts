import { describe, expect, it } from 'vitest';
import { fullMapMarkers, mapPointOf } from '../src/ui/win/fullMap';
import { unit } from './helpers/battleFixtures';

describe('전체맵 window (FUN_00436c40 / FUN_0042c290 / FUN_00436900)', () => {
  const size: [number, number] = [1280, 960];
  const cellOf = (c: number, r: number) => ({ x: (c - r) * 32 + 640, y: (c + r) * 16 });
  it('marks every unit on the map scaled to the client area — party and others apart, no hidden units, no story objects but chests', () => {
    const units = [
      unit({ slot: 0, id: 1, c: 10, r: 10 }), unit({ slot: 12, id: 40, side: 1, c: 2, r: 4 }), unit({ slot: 13, id: 41, side: 1, status: 9, c: 3, r: 3 }),
      unit({ slot: 20, id: 5, side: 7, c: 5, r: 5 }), unit({ slot: 21, id: 8, side: 7, c: 6, r: 6 }), null,
    ];
    expect(fullMapMarkers(units, cellOf, size, 320, 240)).toEqual([
      { x: 160, y: 80, party: true },                                            // (640, 320) · (320/1280, 240/960)
      { x: 144, y: 24, party: false },                                           // (576, 96)
      { x: 160, y: 48, party: false },                                           // the chest (id 8) at (640, 192)
    ]);
  });
  it('a click in the window names the map point under it; negative coordinates clamp to 0 (the view then centres there)', () => {
    expect(mapPointOf(160, 120, 320, 240, size)).toEqual({ x: 640, y: 480 });
    expect(mapPointOf(-5, 300, 320, 240, size)).toEqual({ x: 0, y: 1200 });
  });
});
