/**
 * Scene 11 (PLAY_VISUAL 31): FUN_00406a30 → FUN_00406a60, setup FUN_00406b90.
 * The scene-10 layers (v10a, v11b) hold still; at 2 s object 4 (224,0) plays v11d00..10 (100 ms each) and at 3 s object 1
 * (104, base y 88) plays the faces v11c00..02 (150 ms each); 1 s after both end, a 16-step fade-out (FUN_004199b0 range
 * fade to the stored palette [추정: to black]).
 */
import { slides, type SceneDef } from '../timeline';

export const scene11: SceneDef = { id: 11, parts: [[
  { op: 'order', ids: [0, 3, 1, 4] },
  { op: 'pos', obj: 3, x: 0, y: 72 },
  { op: 'pos', obj: 1, x: 0, y: 88 },
  { op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 400, h: 480, dx: -96, dy: 0 },
  { op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 400, h: 408, dx: -144, dy: 0 },
  { op: 'show', obj: 1, slot: 10, sx: 0, sy: 0, w: 128, h: 120, dx: 104, dy: 0 },
  { op: 'show', obj: 4, slot: 20, sx: 0, sy: 0, w: 416, h: 480, dx: 224, dy: 0 },
  { op: 'anim', fx: 0, obj: 4, x: 224, y: 0, frames: slides([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30], 416, 480, 100), loop: false },
  { op: 'anim', fx: 1, obj: 1, x: 104, y: 0, frames: slides([10, 11, 12], 128, 120, 150), loop: false },
  { op: 'fade', dir: 'in', steps: 0 },
  { op: 'wait', ms: 2000 },
  { op: 'effect', fx: 0, on: true },
  { op: 'wait', ms: 3000 },
  { op: 'effect', fx: 1, on: true },
  { op: 'waitEffect', fx: 1 },
  { op: 'effect', fx: 1, on: false },
  { op: 'waitEffect', fx: 0 },
  { op: 'resetClock' }, { op: 'wait', ms: 1000 },
  { op: 'fade', dir: 'out', steps: 16 },
  { op: 'waitFade' },
  { op: 'end' },
]] };
