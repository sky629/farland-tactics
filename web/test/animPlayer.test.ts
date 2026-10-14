import { describe, expect, it } from 'vitest';
import { AnimPlayer } from '../src/sprite/animPlayer';
import type { Frame, Timeline } from '../src/sprite/animScript';

const fr = (pattern: number, ms: number): Frame => ({ pattern, flipH: false, flipV: false, ms, trigger: null, triggerSharp: false, mark: 0 });
const step = (frames: Frame[], dx = 0, dy = 0) => ({ frames, dx, dy, totalMs: frames.reduce((a, f) => a + f.ms, 0) });
const tl = (...steps: ReturnType<typeof step>[]): Timeline => ({ name: 'T', steps });

describe('AnimPlayer', () => {
  it('a static anim (1 step, 1 frame, no move) never changes', () => {
    const p = new AnimPlayer(tl(step([fr(3, 200)])), { loop: true });
    expect(p.update(0)).toEqual([]);
    expect(p.update(5000)).toEqual([]);
    expect(p.frame.pattern).toBe(3);
    expect(p.offset).toEqual({ x: 0, y: 0 });
  });

  it('the first update only records the start time; frames advance one at a time', () => {
    const p = new AnimPlayer(tl(step([fr(0, 100), fr(1, 100), fr(2, 100)])));
    expect(p.update(0)).toEqual([]);
    expect(p.update(50)).toEqual([]);
    expect(p.update(100)).toEqual([{ type: 'frame', frame: fr(1, 100) }]);
    expect(p.update(1000)).toEqual([{ type: 'frame', frame: fr(2, 100) }]);   // no catch-up: only one frame
  });

  it('ends without loop, keeps showing the last frame and the last offset', () => {
    const p = new AnimPlayer(tl(step([fr(0, 100), fr(1, 100)], 20, 0)));
    p.update(0); p.update(100);
    expect(p.offset).toEqual({ x: 10, y: 0 });        // elapsed 100 of 200 → 20 * 0.5
    expect(p.update(200)).toEqual([{ type: 'end' }]);
    expect(p.finished).toBe(true);
    expect(p.frame.pattern).toBe(1);
    expect(p.offset).toEqual({ x: 10, y: 0 });
    expect(p.update(300)).toEqual([]);
  });

  it('commits the step move at step end and interpolates by elapsed frame time', () => {
    const p = new AnimPlayer(tl(step([fr(0, 100), fr(1, 100)], 20, 0), step([fr(2, 100)], 0, 8)), { loop: true });
    p.update(0);
    p.update(100); expect(p.offset).toEqual({ x: 10, y: 0 });
    expect(p.update(200)).toEqual([{ type: 'step', step: 1 }, { type: 'frame', frame: fr(2, 100) }]);
    expect(p.offset).toEqual({ x: 20, y: 0 });        // committed 20, new step elapsed 0
    p.update(300);                                     // wrap: reset committed (no keepOffset), then add the finished step (0, 8)
    expect(p.stepIndex).toBe(0);
    expect(p.offset).toEqual({ x: 0, y: 8 });
  });

  it('mirrorH negates x movement and mirrorV negates y movement', () => {
    const p = new AnimPlayer(tl(step([fr(0, 100), fr(1, 100)], 20, 10)), { loop: true, mirrorH: true, mirrorV: true });
    p.update(0); p.update(100);
    expect(p.offset).toEqual({ x: -10, y: -5 });
  });

  it('truncates toward zero like __ftol', () => {
    const p = new AnimPlayer(tl(step([fr(0, 100), fr(1, 100), fr(2, 100)], -5, 0)), { loop: true });
    p.update(0); p.update(100);
    expect(p.offset.x).toBe(-1);                       // -5 * 100/300 = -1.66 → -1
  });

  it('a step whose total time is 0 has speed 0 and a finite offset', () => {
    const p = new AnimPlayer(tl(step([fr(0, 0), fr(1, 0)], 16, 0)), { loop: true });
    p.update(0);
    expect(p.update(0)).toEqual([{ type: 'frame', frame: fr(1, 0) }]);
    expect(p.offset).toEqual({ x: 0, y: 0 });
    p.update(0);
    expect(p.offset).toEqual({ x: 16, y: 0 });         // committed after wrap
  });

  it('keepOffset keeps the committed offset when the anim ends', () => {
    const p = new AnimPlayer(tl(step([fr(0, 100)], 7, 0), step([fr(1, 100)], 3, 0)), { keepOffset: true });
    p.update(0); p.update(100);
    expect(p.offset).toEqual({ x: 7, y: 0 });
    p.update(200);
    expect(p.finished).toBe(true);
    expect(p.offset).toEqual({ x: 7, y: 0 });          // last step's move is not committed at the end (original order)
  });
});
