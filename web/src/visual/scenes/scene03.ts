/**
 * Scene 3 (PLAY_VISUAL 23): FUN_00405980 → FUN_004059b0, setup FUN_00405b00.
 * Background v03a; object 3 plays the 5×2 sheet v03b (80×176, 200 ms) at (288,160) with wave rocket1; then the background
 * runs through v03c00..04 (200 ms each) with rocket2; 1.5 s later a 16-step fade-out. Channel stops (FUN_0041dca0(ch,0))
 * are not reproduced: the sounds are short [추정].
 */
import { sheet, slides, type SceneDef } from '../timeline';

export const scene03: SceneDef = { id: 3, parts: [[
  { op: 'order', ids: [0, 3] },
  { op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 },
  { op: 'anim', fx: 0, obj: 3, x: 288, y: 160, frames: sheet(1, 400, 352, 80, 176, 200), loop: false },
  { op: 'anim', fx: 1, obj: 0, x: 0, y: 0, frames: slides([2, 3, 4, 5, 6], 640, 480, 200), loop: false },
  { op: 'fade', dir: 'in', steps: 8 },
  { op: 'waitFade' },
  { op: 'sound', name: 'rocket1' }, { op: 'effect', fx: 0, on: true },
  { op: 'waitEffect', fx: 0 },
  { op: 'sound', name: 'rocket2' }, { op: 'hide', obj: 3 }, { op: 'effect', fx: 0, on: false }, { op: 'effect', fx: 1, on: true },
  { op: 'waitEffect', fx: 1 },
  { op: 'resetClock' }, { op: 'wait', ms: 1500 },
  { op: 'fade', dir: 'out', steps: 16 },
  { op: 'waitFade' },
  { op: 'end' },
]] };
