/**
 * Scene 7 (PLAY_VISUAL 27): FUN_00406300 → FUN_00406330, setup FUN_00406390.
 * No fade (steps 0); object 3 runs through the full-screen images v07b00..06 at 150 ms each, once; ends 3 s after the start.
 */
import { slides, type SceneDef } from '../timeline';

export const scene07: SceneDef = { id: 7, parts: [[
  { op: 'order', ids: [0, 3] },
  { op: 'hide', obj: 0 },
  { op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 },
  { op: 'anim', fx: 0, obj: 3, x: 0, y: 0, frames: slides([1, 2, 3, 4, 5, 6, 7], 640, 480, 150), loop: false },
  { op: 'effect', fx: 0, on: true },
  { op: 'fade', dir: 'in', steps: 0 },
  { op: 'waitEffect', fx: 0 }, { op: 'waitUntil', ms: 3000 },
  { op: 'end' },
]] };
