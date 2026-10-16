/**
 * Scene 10 (PLAY_VISUAL 30): FUN_00406810 → FUN_00406840, setup FUN_004068a0.
 * A 4 s parallax pan: v10a (back) from −128 by −32, v10b (middle, base y 72) from −192 by −48, v10c (front) from 80 by −144.
 */
import type { SceneDef } from '../timeline';

export const scene10: SceneDef = { id: 10, parts: [[
  { op: 'order', ids: [0, 3, 4] },
  { op: 'pos', obj: 3, x: 0, y: 72 },
  { op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 400, h: 480, dx: -64, dy: 0 },
  { op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 400, h: 408, dx: -108, dy: 0 },
  { op: 'show', obj: 4, slot: 2, sx: 0, sy: 0, w: 592, h: 480, dx: 80, dy: 0 },
  { op: 'move', obj: 0, from: [-128, 0], by: [-32, 0], ms: 4000 },
  { op: 'move', obj: 3, from: [-192, 0], by: [-48, 0], ms: 4000 },
  { op: 'move', obj: 4, from: [80, 0], by: [-144, 0], ms: 4000 },
  { op: 'fade', dir: 'in', steps: 8 },
  { op: 'waitMove', obj: 4 },
  { op: 'end' },
]] };
