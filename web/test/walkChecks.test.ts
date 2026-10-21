import { describe, expect, it } from 'vitest';
import { blankFlag, blankRatio, momentsBetween, overflowing, StuckWatch, type WalkSnapshot } from '../src/dev/walkChecks';

const snap = (over: Partial<WalkSnapshot> = {}): WalkSnapshot => ({ t: 0, mode: 'script', mapReady: false, turn: null, phase: null, selMode: null, town: false, visualPart: null, visualPlaying: false, dialogsOpened: 0, dialogTemplate: null, fadeAlpha: 0, pc: 0, ...over });

describe('momentsBetween: what a frame is worth a picture for', () => {
  it('the first frame sets the baseline and is no moment', () => {
    expect(momentsBetween(null, snap(), 0)).toEqual([]);
  });
  it('a map arriving and a dialog opening in the same frame are both moments, in that order', () => {
    const prev = snap(), cur = snap({ mapReady: true, dialogsOpened: 1, dialogTemplate: '126' });
    expect(momentsBetween(prev, cur, 0)).toEqual(['map', 'dialog-126']);
  });
  it('battle-start fires once at the first idle player phase of turn 1; battle-end at the first end phase', () => {
    const t1 = snap({ mode: 'battle', mapReady: true, turn: 1, phase: 'player', selMode: 'idle' });
    expect(momentsBetween(snap({ mode: 'battle', mapReady: true }), t1, 0)).toEqual(['battle-start']);
    expect(momentsBetween(t1, { ...t1, selMode: 'menu' }, 0)).toEqual([]);
    expect(momentsBetween({ ...t1, turn: 3 }, { ...t1, turn: 3, phase: 'end' }, 0)).toEqual(['battle-end']);
  });
  it('a town shown, a scene part changing, and the 10 s tick', () => {
    expect(momentsBetween(snap(), snap({ town: true }), 0)).toEqual(['town']);
    expect(momentsBetween(snap({ visualPart: 0, visualPlaying: true }), snap({ visualPart: 1, visualPlaying: true }), 0)).toEqual(['scene-1']);
    expect(momentsBetween(snap({ t: 9000 }), snap({ t: 10000 }), 0)).toEqual(['tick']);
    expect(momentsBetween(snap({ t: 9000 }), snap({ t: 9500 }), 0)).toEqual([]);
  });
});

describe('blank frames', () => {
  const solid = (n: number, rgb: [number, number, number]) => { const a = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { a[i * 4] = rgb[0]; a[i * 4 + 1] = rgb[1]; a[i * 4 + 2] = rgb[2]; a[i * 4 + 3] = 255; } return a; };
  it('blankRatio is the share of the most common colour', () => {
    const px = solid(100, [0, 0, 0]); px[4 * 99] = 255;                           // one red pixel among 100 black
    expect(blankRatio(px)).toBeCloseTo(0.99, 5);
    expect(blankRatio(solid(10, [7, 7, 7]))).toBe(1);
  });
  it('a one-colour frame is blank only outside a fade and outside a visual scene', () => {
    expect(blankFlag(0.995, 0, false)).toBe(true);
    expect(blankFlag(1, 1, false)).toBe(false);                                  // covered by the fade
    expect(blankFlag(1, 0, true)).toBe(false);                                   // a scene's black is its own
    expect(blankFlag(0.98, 0, false)).toBe(false);
  });
});

describe('overflowing dialogs', () => {
  const screen = { left: 0, top: 0, right: 640, bottom: 480 };
  it('counts the rectangles that leave the screen', () => {
    expect(overflowing([{ left: 10, top: 10, right: 300, bottom: 200 }], screen)).toBe(0);
    expect(overflowing([{ left: -1, top: 0, right: 10, bottom: 10 }, { left: 600, top: 400, right: 700, bottom: 420 }], screen)).toBe(2);
  });
});

describe('StuckWatch', () => {
  it('60 s of the same signature is stuck; any change resets', () => {
    const w = new StuckWatch();
    expect(w.update(snap({ t: 0, pc: 5 }))).toBe(false);
    expect(w.update(snap({ t: 59000, pc: 5 }))).toBe(false);
    expect(w.update(snap({ t: 60000, pc: 5 }))).toBe(true);
    expect(w.update(snap({ t: 60100, pc: 6 }))).toBe(false);
    expect(w.update(snap({ t: 120000, pc: 6, fadeAlpha: 0.5 }))).toBe(false);   // the fade moving counts as change
  });
  it('a visual scene waits on its own clock: 100 s of one part is fine, 230 s is stuck, a new part resets', () => {
    const w = new StuckWatch();
    w.update(snap({ t: 0, visualPlaying: true, visualPart: 0 }));
    expect(w.update(snap({ t: 100000, visualPlaying: true, visualPart: 0 }))).toBe(false);
    expect(w.update(snap({ t: 230000, visualPlaying: true, visualPart: 0 }))).toBe(true);
    expect(w.update(snap({ t: 230100, visualPlaying: true, visualPart: 1 }))).toBe(false);
  });
});
