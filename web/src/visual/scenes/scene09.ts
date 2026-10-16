/**
 * Scene 9 (PLAY_VISUAL 29): FUN_00406650 → FUN_00406680, setup FUN_004066e0.
 * Background v09a; object 3 at (0,27) loops the 640×185 strips v09b00, v09b02, v09b01 (200 ms each) until the 8-step
 * fade-out 8 s after the start.
 */
import { slides, type SceneDef } from '../timeline';

export const scene09: SceneDef = { id: 9, parts: [[
  { op: 'order', ids: [0, 3] },
  { op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 },
  { op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 640, h: 185, dx: 0, dy: 27 },
  { op: 'anim', fx: 0, obj: 3, x: 0, y: 27, frames: slides([1, 3, 2], 640, 185, 200), loop: true },
  { op: 'effect', fx: 0, on: true },
  { op: 'fade', dir: 'in', steps: 8 },
  { op: 'waitUntil', ms: 8000 },
  { op: 'fade', dir: 'out', steps: 8 },
  { op: 'waitFade' },
  { op: 'end' },
]] };
