import { describe, expect, it } from 'vitest';
import { VisualPlayer } from '../src/visual/player';
import { STAR_COUNT, StarField } from '../src/visual/stars';
import type { SceneDef, VisualImages } from '../src/visual/timeline';

const mid = (n: number) => n >> 1;                                            // every draw lands in the middle of its range

describe('the star fields of FUN_00405920 (table 0x449690 over bmp\\star.bmp)', () => {
  it('kind 0: eighty stars; one at the centre recedes 50 a tick, shrinks from frame 5 to 0 and respawns past z 400', () => {
    const f = new StarField(0, mid);
    expect(f.blits()).toHaveLength(STAR_COUNT);
    expect(f.blits()[0]).toEqual({ frame: 5, x: 300, y: 300 });                 // x = y = 0, z = 150: 7 − ⌊(150−100)/25⌋
    f.tick(0);
    const frames: number[] = [];
    for (let t = 20; t <= 120; t += 20) { f.tick(t); frames.push(f.blits()[0]!.frame); }
    expect(frames).toEqual([3, 1, 0, 0, 0, 5]);                                  // z 200 · 250 · 300 · 350 · 400, then 450 > 400 → back at z 150
  });
  it('kind 0: a star projected off the screen is drawn clipped and marked for respawn (z = 400) on the next tick', () => {
    const f = new StarField(0, () => 0);                                          // x = −640, y = −480, z = 0
    expect(f.blits()[0]).toEqual({ frame: 7, x: -980, y: -660 });                // frames past 7 (z < 75) read off the strip in the original — clamped here
    f.tick(0); f.tick(20);
    expect(f.blits()[0]).toEqual({ frame: 5, x: -180, y: -60 });                 // respawned at (−960, −720), z = 150
  });
  it('kind 2: stars under the centre (320, 800) come nearer 50 a tick, rise, respawn under z 100; only the top and sides bound them', () => {
    const f = new StarField(2, mid);
    expect(f.blits()[0]).toEqual({ frame: 5, x: 320, y: 400 });                 // y = −800, z = 150
    f.tick(0); f.tick(20);
    expect(f.blits()[0]).toEqual({ frame: 7, x: 320, y: 267 });                 // z = 100: ⌊−80000/150⌋ = −533
    f.tick(40);
    expect(f.blits()[0]).toEqual({ frame: 0, x: 320, y: 600 });                 // z 50 → respawn at y = −800, z = 350: below the screen, kept
  });
  it('kind 3: sixteen-pixel stars drift up 58–74 px a tick and wrap at the top edge', () => {
    const f = new StarField(3, mid);
    expect(f.blits()[0]).toEqual({ frame: 5, x: 320, y: 240 });                 // speed 1 + 4 = 5 → frame 5
    f.tick(0);
    const ys: number[] = [];
    for (let t = 20; t <= 80; t += 20) { f.tick(t); ys.push(f.blits()[0]!.y); }
    expect(ys).toEqual([174, 108, 42, 456]);                                     // −66 a tick; −24 wraps to 456
  });
  it('ticks follow the 20 ms grid: several per late frame, none for a shorter gap, a long pause capped', () => {
    const f = new StarField(0, mid);
    f.tick(1000); f.tick(1100);                                                  // five ticks: z 150 → 400
    expect(f.blits()[0]!.frame).toBe(0);
    f.tick(1105);
    expect(f.blits()[0]!.frame).toBe(0);
    f.tick(1120);
    expect(f.blits()[0]!.frame).toBe(5);
    f.tick(90000);
    expect(f.blits().every((b) => b.frame >= 0 && b.frame <= 7)).toBe(true);
  });
});

describe('VisualPlayer: a stars object (FUN_00405920 on object obj)', () => {
  const strip = { image: { w: 128, h: 16 } as unknown as CanvasImageSource, w: 128, h: 16 };
  const images = (loaded: boolean): VisualImages => ({ get: () => null, bitmap: (name, key) => (loaded && name === 'star' && key === 252 ? strip : null) });
  const scene = (): SceneDef => ({ id: 13, parts: [[{ op: 'order', ids: [0, 1] }, { op: 'stars', obj: 1, kind: 0 }, { op: 'wait', ms: 1000 }]] });
  it('draws the eighty 16×16 frames of the strip (key 252) in the object\'s place in the order', () => {
    const p = new VisualPlayer();
    p.start(scene(), 0, images(true), 0);
    const f = p.update(0);
    expect(f.backdrop).toHaveLength(STAR_COUNT);
    expect(f.backdrop.every((b) => b.image === strip.image && b.w === 16 && b.h === 16 && b.sy === 0 && b.sx % 16 === 0 && b.sx <= 112)).toBe(true);
  });
  it('draws no stars while the strip has not loaded', () => {
    const p = new VisualPlayer();
    p.start(scene(), 0, images(false), 0);
    expect(p.update(0).backdrop).toHaveLength(0);
  });
});
