/**
 * Scene 12 (PLAY_VISUAL 32, ending): FUN_00406d90 → FUN_00406dc0, setup FUN_00407340.
 * Three captions (ved00a/b/c) fade in and out on black at 2/10, 14/20, 24/31 s; from 33 s the seven credit pictures ved01a..g
 * drift across the screen on the table 0x449708 schedule (FUN_00407280 → FUN_0041c6c0) while the staff roll text runs
 * (FUN_0041bfa0); at 180 s ved01h and ved01i close the ending until 200 s.
 */
import type { Cmd, SceneDef } from '../timeline';

const caption = (slot: number, w: number, h: number, dx: number, dy: number, inAt: number, outAt: number): Cmd[] => [
  { op: 'waitFade' }, { op: 'waitUntil', ms: inAt }, { op: 'show', obj: 0, slot, sx: 0, sy: 0, w, h, dx, dy }, { op: 'fade', dir: 'in', steps: 16 },
  { op: 'waitFade' }, { op: 'waitUntil', ms: outAt }, { op: 'fade', dir: 'out', steps: 16 },
];
/**
 * Table 0x449708 (slot, start s, x, y) → FUN_0041c6c0(3, slot, 0x20, 0xd0, x+320, y+240, 320−x, 240−y, 17000, 4000): the picture's
 * centre starts at (x+320, y+240) and moves by (2x, 2y) over 17 s; 4000/128 = 31 palette steps fade it in, the fade-out starts
 * at 17 − 4 = 13 s. The part clock was reset at 33 s, so the pictures start at 38, 58, …, 158 s.
 */
const CREDITS: [number, number, number, number][] = [[11, 5, -120, -60], [12, 25, -45, -90], [13, 45, 45, -90], [14, 65, 120, -60], [15, 85, 120, 60], [16, 105, 45, 90], [17, 125, -45, 90]];
const credit = ([slot, startS, x, y]: [number, number, number, number]): Cmd[] => [
  { op: 'wait', ms: startS * 1000 },
  { op: 'show', obj: 3, slot, sx: 0, sy: 0, w: 440, h: 360, dx: x + 320 - 220, dy: y + 240 - 180 },
  { op: 'move', obj: 3, by: [2 * x, 2 * y], ms: 17000 }, { op: 'alpha', obj: 3, from: 0, to: 1, ms: 31 * 30 },
  { op: 'wait', ms: startS * 1000 + 13000 }, { op: 'alpha', obj: 3, from: 1, to: 0, ms: 4000 },
];

export const scene12: SceneDef = { id: 12, parts: [[
  { op: 'order', ids: [0, 3, 4] }, { op: 'fade', dir: 'out', steps: 0 },
  ...caption(0, 592, 48, 24, 216, 2000, 10000),
  ...caption(1, 448, 96, 96, 192, 14000, 20000),
  ...caption(2, 400, 64, 120, 200, 24000, 31000),
  { op: 'waitFade' }, { op: 'waitUntil', ms: 33000 }, { op: 'hide', obj: 0 },
  { op: 'resetClock' }, ...CREDITS.flatMap(credit), { op: 'waitAlpha', obj: 3 }, { op: 'hide', obj: 3 },
  { op: 'waitUntil', ms: 180000 },
  { op: 'show', obj: 0, slot: 20, sx: 0, sy: 0, w: 640, h: 360, dx: 0, dy: 60 }, { op: 'show', obj: 3, slot: 21, sx: 0, sy: 0, w: 640, h: 170, dx: 0, dy: 310 },
  { op: 'fade', dir: 'in', steps: 16 },
  { op: 'waitUntil', ms: 200000 },
  { op: 'end' },
]] };
