/**
 * Scene 12 (PLAY_VISUAL 32, ending): FUN_00406d90 → FUN_00406dc0, setup FUN_00407340.
 * Three captions (ved00a/b/c) fade in and out on black at 2/10, 14/20, 24/31 s; from 33 s the staff roll (FUN_00407280 over
 * table 0x449708 with FUN_0041c6c0) — here the seven credit pictures ved01a..g, each 17 s on screen with a 4 s change
 * [추정: the original slides text in]; at 180 s ved01h and ved01i close the ending until 200 s.
 */
import type { Cmd, SceneDef } from '../timeline';

const caption = (slot: number, w: number, h: number, dx: number, dy: number, inAt: number, outAt: number): Cmd[] => [
  { op: 'waitFade' }, { op: 'waitUntil', ms: inAt }, { op: 'show', obj: 0, slot, sx: 0, sy: 0, w, h, dx, dy }, { op: 'fade', dir: 'in', steps: 16 },
  { op: 'waitFade' }, { op: 'waitUntil', ms: outAt }, { op: 'fade', dir: 'out', steps: 16 },
];
/** One staff-roll entry: 17 s on screen plus a 4 s change, as FUN_0041c6c0's (17000, 4000); seven of them fill 33..180 s. */
const credit = (slot: number): Cmd[] => [
  { op: 'resetClock' }, { op: 'show', obj: 3, slot, sx: 0, sy: 0, w: 440, h: 360, dx: 100, dy: 60 }, { op: 'fade', dir: 'in', steps: 16 },
  { op: 'wait', ms: 17000 }, { op: 'fade', dir: 'out', steps: 16 }, { op: 'wait', ms: 21000 },
];

export const scene12: SceneDef = { id: 12, parts: [[
  { op: 'order', ids: [0, 3, 4] }, { op: 'fade', dir: 'out', steps: 0 },
  ...caption(0, 592, 48, 24, 216, 2000, 10000),
  ...caption(1, 448, 96, 96, 192, 14000, 20000),
  ...caption(2, 400, 64, 120, 200, 24000, 31000),
  { op: 'waitFade' }, { op: 'waitUntil', ms: 33000 }, { op: 'hide', obj: 0 },
  ...[11, 12, 13, 14, 15, 16, 17].flatMap(credit),
  { op: 'waitUntil', ms: 180000 },
  { op: 'show', obj: 0, slot: 20, sx: 0, sy: 0, w: 640, h: 360, dx: 0, dy: 60 }, { op: 'show', obj: 3, slot: 21, sx: 0, sy: 0, w: 640, h: 170, dx: 0, dy: 310 },
  { op: 'fade', dir: 'in', steps: 16 },
  { op: 'waitUntil', ms: 200000 },
  { op: 'end' },
]] };
