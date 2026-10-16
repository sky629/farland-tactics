import { describe, expect, it } from 'vitest';
import { VisualPlayer } from '../src/visual/player';
import { dispatch, sheet, slides, type Cmd, type SceneDef, type VisualImages } from '../src/visual/timeline';

const img = (w: number, h: number) => ({ image: { w, h } as unknown as CanvasImageSource, w, h });
const images = (sizes: Record<number, [number, number]>): VisualImages => ({ get: (slot) => (sizes[slot] ? img(...sizes[slot]!) : null) });
const keyed = (sizes: Record<number, [number, number]>, seen: (number | null)[]): VisualImages => ({ get: (slot, key) => { seen.push(key); return sizes[slot] ? img(...sizes[slot]!) : null; } });
const scene = (...parts: Cmd[][]): SceneDef => ({ id: 1, parts });

describe('VisualPlayer', () => {
  it('show draws one piece at its position, clipped to the image', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 }, { op: 'wait', ms: 100 }]), 0, images({ 0: [288, 96] }), 0);
    const f = p.update(0);
    expect(f.backdrop).toEqual([{ image: expect.anything(), sx: 0, sy: 0, w: 288, h: 96, dx: 0, dy: 0 }]);
    expect(f.done).toBe(false);
  });
  it('a missing image skips only its piece', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 }, { op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 10, h: 10, dx: 5, dy: 6 }, { op: 'wait', ms: 100 }]), 0, images({ 1: [10, 10] }), 0);
    expect(p.update(0).backdrop.map((b) => b.dx)).toEqual([5]);
  });
  it('order lists the objects that are drawn, first drawn first', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'order', ids: [3, 0] }, { op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 10, h: 10, dx: 0, dy: 0 }, { op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 10, h: 10, dx: 1, dy: 0 }, { op: 'show', obj: 5, slot: 1, sx: 0, sy: 0, w: 10, h: 10, dx: 2, dy: 0 }, { op: 'wait', ms: 1 }]), 0, images({ 0: [10, 10], 1: [10, 10] }), 0);
    expect(p.update(0).backdrop.map((b) => b.dx)).toEqual([1, 0]);           // object 5 is not in the list
  });
  it('pos adds a base position to the shown offset and to moves (FUN_00419ec0)', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'pos', obj: 3, x: 0, y: 72 }, { op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 400, h: 408, dx: -108, dy: 0 }, { op: 'wait', ms: 10 }, { op: 'move', obj: 3, from: [-192, 0], to: [-48, 0], ms: 1000 }, { op: 'waitMove', obj: 3 }, { op: 'end' }]), 0, images({ 1: [400, 408] }), 0);
    expect(p.update(0).backdrop[0]).toMatchObject({ dx: -108, dy: 72 });
    p.update(10);
    expect(p.update(510).backdrop[0]).toMatchObject({ dx: -120, dy: 72 });
  });
  it('move interpolates and waitMove holds until the end', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 10, h: 10, dx: 0, dy: 0 }, { op: 'move', obj: 3, from: [0, 0], to: [100, 50], ms: 1000 }, { op: 'waitMove', obj: 3 }, { op: 'end' }]), 0, images({ 1: [10, 10] }), 0);
    p.update(0);                                                               // the move starts in the frame that runs it
    expect(p.update(500).backdrop[0]).toMatchObject({ dx: 50, dy: 25 });
    expect(p.update(500).done).toBe(false);
    const f = p.update(1000);
    expect(f.backdrop[0]).toMatchObject({ dx: 100, dy: 50 });
    expect(f.done).toBe(true);
  });
  it('fade in goes from black to clear in steps × 30 ms', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'fade', dir: 'in', steps: 8 }, { op: 'waitFade' }, { op: 'end' }]), 0, images({}), 0);
    expect(p.update(0).fade).toEqual({ color: 'black', alpha: 1 });
    expect(p.update(120).fade).toEqual({ color: 'black', alpha: 0.5 });
    const f = p.update(240);
    expect(f.fade).toBeNull();
    expect(f.done).toBe(true);
  });
  it('fade out ends black and stays black', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'fade', dir: 'out', steps: 2 }, { op: 'waitFade' }, { op: 'wait', ms: 1000 }]), 0, images({}), 0);
    expect(p.update(0).fade).toBeNull();                                     // still clear at the first instant
    expect(p.update(30).fade).toEqual({ color: 'black', alpha: 0.5 });
    expect(p.update(60).fade).toEqual({ color: 'black', alpha: 1 });
    expect(p.update(500).fade).toEqual({ color: 'black', alpha: 1 });
  });
  it('wait reads the part clock, which resetClock restarts (DAT_00449688 / DAT_00449674)', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'wait', ms: 100 }, { op: 'wait', ms: 150 }, { op: 'resetClock' }, { op: 'wait', ms: 100 }, { op: 'end' }]), 0, images({}), 0);
    expect(p.update(149).done).toBe(false);
    expect(p.update(150).done).toBe(false);                                    // both waits pass at 150; the clock restarts there
    expect(p.update(249).done).toBe(false);
    expect(p.update(250).done).toBe(true);
  });
  it('waitUntil uses the scene clock', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'wait', ms: 100 }, { op: 'waitUntil', ms: 150 }], [{ op: 'waitUntil', ms: 300 }, { op: 'end' }]), 0, images({}), 1000);
    expect(p.update(1149).done).toBe(false);
    expect(p.update(1150).done).toBe(false);   // part 1 waits for 300 since the scene start
    expect(p.update(1300).done).toBe(true);
  });
  it('an animation steps through its sheet frames on its object; the object keeps the last frame (FUN_0041d6e0)', () => {
    const p = new VisualPlayer();
    const frames = sheet(1, 40, 10, 10, 10, 100);                              // 4 frames, 100 ms each
    expect(frames.map((f) => f.sx)).toEqual([0, 10, 20, 30]);
    p.start(scene([{ op: 'order', ids: [0, 3] }, { op: 'anim', fx: 0, obj: 3, x: 336, y: 48, frames, loop: false }, { op: 'effect', fx: 0, on: true }, { op: 'waitEffect', fx: 0 }, { op: 'wait', ms: 1000 }]), 0, images({ 1: [40, 10] }), 0);
    expect(p.update(0).backdrop).toEqual([{ image: expect.anything(), sx: 0, sy: 0, w: 10, h: 10, dx: 336, dy: 48 }]);
    expect(p.update(150).backdrop[0]).toMatchObject({ sx: 10 });
    expect(p.update(350).backdrop[0]).toMatchObject({ sx: 30 });
    expect(p.update(399).done).toBe(false);
    expect(p.update(900).backdrop[0]).toMatchObject({ sx: 30 });              // over, last frame stays
    expect(p.update(1000).done).toBe(true);
  });
  it('a looping animation repeats until effect off, which keeps the frame of that moment', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'anim', fx: 1, obj: 4, x: 0, y: 0, frames: sheet(2, 20, 10, 10, 10, 100), loop: true }, { op: 'effect', fx: 1, on: true }, { op: 'wait', ms: 500 }, { op: 'effect', fx: 1, on: false }, { op: 'waitEffect', fx: 1 }, { op: 'wait', ms: 900 }]), 0, images({ 2: [20, 10] }), 0);
    expect(p.update(0).backdrop[0]).toMatchObject({ sx: 0 });
    expect(p.update(150).backdrop[0]).toMatchObject({ sx: 10 });
    expect(p.update(450).backdrop[0]).toMatchObject({ sx: 0 });               // 4th step, wrapped
    expect(p.update(500).backdrop[0]).toMatchObject({ sx: 10 });              // stopped on frame 5 mod 2
    expect(p.update(800).backdrop[0]).toMatchObject({ sx: 10 });
  });
  it('a slide animation swaps whole images in slot order', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'anim', fx: 0, obj: 0, x: 0, y: 0, frames: slides([1, 2, 3], 640, 480, 200), loop: false }, { op: 'effect', fx: 0, on: true }, { op: 'waitEffect', fx: 0 }, { op: 'wait', ms: 1000 }]), 0, images({ 1: [10, 10], 2: [20, 10], 3: [30, 10] }), 0);
    expect(p.update(0).backdrop[0]!.w).toBe(10);      // slot 1 for the first 200 ms
    expect(p.update(250).backdrop[0]!.w).toBe(20);    // slot 2
    expect(p.update(600).backdrop[0]!.w).toBe(30);    // slot 3, and the effect is over
    expect(p.update(900).backdrop[0]!.w).toBe(30);    // stays on the last slot
  });
  it('waitEffect passes for an effect that was never started', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'anim', fx: 2, obj: 4, x: 0, y: 0, frames: sheet(3, 10, 10, 10, 10, 100), loop: false }, { op: 'waitEffect', fx: 2 }, { op: 'end' }]), 0, images({ 3: [10, 10] }), 0);
    expect(p.update(0).done).toBe(true);
    expect(p.update(0).backdrop).toEqual([]);                                  // defined only: nothing shown
  });
  it('object 0 is asked for opaquely, the others with key 249 unless key says otherwise (FUN_00401880 / FUN_00419da0)', () => {
    const p = new VisualPlayer(), seen: (number | null)[] = [];
    p.start(scene([{ op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 10, h: 10, dx: 0, dy: 0 }, { op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 10, h: 10, dx: 0, dy: 0 }, { op: 'key', obj: 3, key: 253 }, { op: 'wait', ms: 10 }]), 0, keyed({ 0: [10, 10], 1: [10, 10] }, seen), 0);
    p.update(0);
    expect(seen).toEqual([null, 253]);
  });
  it('clip limits a piece and hide removes it', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 }, { op: 'clip', obj: 3, x: 0, y: 0, w: 320, h: 480 }, { op: 'move', obj: 3, from: [-320, 0], to: [-320, 0], ms: 300 }, { op: 'wait', ms: 10 }, { op: 'hide', obj: 3 }, { op: 'wait', ms: 10 }]), 0, images({ 1: [640, 480] }), 0);
    const f = p.update(0);
    expect(f.backdrop[0]).toMatchObject({ dx: 0, dy: 0, sx: 320, sy: 0, w: 320, h: 480 });   // the right half shows in the clip window
    expect(p.update(10).backdrop).toHaveLength(0);
  });
  it('sound reports its name once', () => {
    const p = new VisualPlayer(); const heard: string[] = [];
    p.onSound = (n) => heard.push(n);
    p.start(scene([{ op: 'sound', name: 'v01' }, { op: 'wait', ms: 10 }]), 0, images({}), 0);
    p.update(0); p.update(5);
    expect(heard).toEqual(['v01']);
  });
  it('skip ends the scene once', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 10, h: 10, dx: 0, dy: 0 }, { op: 'wait', ms: 5000 }]), 0, images({ 0: [10, 10] }), 0);
    p.update(0);
    p.skip(); p.skip();
    const f = p.update(1);
    expect(f.done).toBe(true);
    expect(f.backdrop).toEqual([]);
    expect(p.playing).toBe(false);
  });
  it('start at a later part skips the earlier ones', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'wait', ms: 5000 }], [{ op: 'end' }]), 1, images({}), 0);
    expect(p.update(0).done).toBe(true);
  });
});

describe('dispatch', () => {
  it('maps the PLAY_VISUAL table 0x449598', () => {
    expect(dispatch(0)).toEqual({ scene: 0, part: 0 });
    expect(dispatch(17)).toEqual({ scene: 0, part: 17 });
    expect(dispatch(21)).toEqual({ scene: 1, part: 0 });
    expect(dispatch(33)).toEqual({ scene: 13, part: 0 });
    expect(dispatch(18)).toBeNull();
    expect(dispatch(34)).toBeNull();
  });
});
