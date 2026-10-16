/**
 * Scene 13 (PLAY_VISUAL 33, second ending): FUN_00407440 drives six parts FUN_00407510, 407680, 4078f0, 407a50, 407ed0,
 * 408140 (setups FUN_00407590, 4076e0, 407950, 407ca0, 407f30, 4081d0); each ends on the scene clock (10, 23, 29, 45, 53, 60 s).
 * Not reproduced [추정]: the captions of FUN_00405920 (parts 0, 1, 3 show text over black or the picture), the 4 s palette
 * cross-fades of part 3 (FUN_00419b80, here plain cuts), the final wave of part 5 (name unknown).
 */
import { slides, type Cmd, type SceneDef } from '../timeline';

const part = (endMs: number, fadeSteps: number, cmds: Cmd[]): Cmd[] => [{ op: 'deadline', ms: endMs, outro: [{ op: 'fade', dir: 'out', steps: fadeSteps }, { op: 'waitFade' }] }, ...cmds];
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** Parts 1 and 4: v05a/v05b pan down slowly while the v05d/v05e figures sink (FUN_004076e0 = FUN_00407f30). */
const pan: Cmd[] = [
  { op: 'order', ids: [0, 2, 3, 1, 4, 5, 6] },
  { op: 'show', obj: 5, slot: 10, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 }, { op: 'show', obj: 4, slot: 11, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 40 },
  { op: 'show', obj: 3, slot: 12, sx: 0, sy: 0, w: 224, h: 296, dx: 200, dy: -20 }, { op: 'show', obj: 1, slot: 13, sx: 0, sy: 0, w: 250, h: 296, dx: 400, dy: 0 },
  { op: 'move', obj: 3, by: [0, 40], ms: 15000 }, { op: 'move', obj: 1, by: [0, 60], ms: 15000 },
  { op: 'move', obj: 4, from: [0, -40], by: [0, 80], ms: 15000 }, { op: 'move', obj: 5, from: [0, -100], by: [0, 150], ms: 15000 },
  { op: 'fade', dir: 'in', steps: 2 },
];
/** Parts 2 and 5: v08b with the v08a portrait (FUN_00407950 = FUN_004081d0). */
const portrait: Cmd[] = [
  { op: 'order', ids: [0, 3, 4] }, { op: 'show', obj: 4, slot: 21, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 },
  { op: 'show', obj: 0, slot: 20, sx: 0, sy: 0, w: 328, h: 232, dx: 176, dy: 104 }, { op: 'fade', dir: 'in', steps: 2 },
];

export const scene13: SceneDef = { id: 13, parts: [
  part(10000, 2, [{ op: 'order', ids: [0, 3, 1, 4] }, { op: 'fade', dir: 'in', steps: 8 }]),
  part(23000, 2, pan),
  part(29000, 2, portrait),
  part(45000, 2, [
    { op: 'order', ids: [0, 3, 1, 4] }, { op: 'show', obj: 3, slot: 0, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 },
    { op: 'anim', fx: 0, obj: 3, x: 128, y: 0, frames: slides(range(31, 42), 384, 480, 50), loop: false },
    { op: 'anim', fx: 1, obj: 4, x: 160, y: 32, frames: slides(range(51, 62), 320, 448, 50), loop: false },
    { op: 'fade', dir: 'in', steps: 2 },
    { op: 'waitFade' }, { op: 'wait', ms: 4000 }, { op: 'show', obj: 3, slot: 30, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 },
    { op: 'wait', ms: 8000 }, { op: 'show', obj: 3, slot: 31, sx: 0, sy: 0, w: 384, h: 480, dx: 128, dy: 0 }, { op: 'show', obj: 4, slot: 51, sx: 0, sy: 0, w: 320, h: 448, dx: 160, dy: 32 },
    { op: 'waitUntil', ms: 40000 }, { op: 'effect', fx: 0, on: true }, { op: 'effect', fx: 1, on: true },
  ]),
  part(53000, 2, pan),
  [{ op: 'deadline', ms: 60000, outro: [{ op: 'fade', dir: 'out', steps: 16 }, { op: 'waitFade' }, { op: 'end' }] }, ...portrait, { op: 'wait', ms: 60000 }],
] };
