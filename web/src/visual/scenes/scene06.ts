/**
 * Scene 6 (PLAY_VISUAL 26): FUN_00406050 → FUN_00406080, setup FUN_00406190.
 * Same background and sheet as scene 1 (effect 0 on object 3, with wave burst); object 4 at (144,224) loops v06c (3 frames)
 * until effect 0 is over, plays v06d once, then loops v06e until the scene ends 6 s after the start.
 */
import { sheet, type SceneDef } from '../timeline';

export const scene06: SceneDef = { id: 6, parts: [[
  { op: 'order', ids: [0, 3, 4] },
  { op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 },
  { op: 'anim', fx: 0, obj: 3, x: 336, y: 48, frames: sheet(1, 1008, 352, 144, 176, 100), loop: false },
  { op: 'anim', fx: 1, obj: 4, x: 144, y: 224, frames: sheet(2, 240, 112, 80, 112, 150), loop: true },
  { op: 'anim', fx: 2, obj: 4, x: 144, y: 224, frames: sheet(3, 80, 112, 80, 112, 150), loop: false },
  { op: 'anim', fx: 3, obj: 4, x: 144, y: 224, frames: sheet(4, 240, 112, 80, 112, 150), loop: true },
  { op: 'effect', fx: 1, on: true },
  { op: 'fade', dir: 'in', steps: 3 },
  { op: 'waitFade' }, { op: 'wait', ms: 2000 },
  { op: 'sound', name: 'burst' }, { op: 'effect', fx: 0, on: true },
  { op: 'waitEffect', fx: 0 },
  { op: 'effect', fx: 1, on: false }, { op: 'effect', fx: 2, on: true },
  { op: 'waitEffect', fx: 2 },
  { op: 'effect', fx: 3, on: true },
  { op: 'waitUntil', ms: 6000 },
  { op: 'end' },
]] };
