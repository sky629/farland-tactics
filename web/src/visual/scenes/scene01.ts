/**
 * Scene 1 (PLAY_VISUAL 21): FUN_00405270 → FUN_004052a0, setup FUN_00405340.
 * Background v01a; object 3 plays the 7×2 sheet v01b (144×176 frames, 100 ms) at (336,48) once; ends 6 s after the start.
 */
import { sheet, type SceneDef } from '../timeline';

export const scene01: SceneDef = { id: 1, parts: [[
  { op: 'order', ids: [0, 3] },
  { op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 },
  { op: 'anim', fx: 0, obj: 3, x: 336, y: 48, frames: sheet(1, 1008, 352, 144, 176, 100), loop: false },
  { op: 'fade', dir: 'in', steps: 8 },
  { op: 'waitFade' }, { op: 'wait', ms: 3000 },
  { op: 'effect', fx: 0, on: true },
  { op: 'waitEffect', fx: 0 }, { op: 'waitUntil', ms: 6000 },
  { op: 'end' },
]] };
