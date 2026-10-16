/**
 * Scene 0 — the opening movie (PLAY_VISUAL 0..17 start at part n): FUN_00401c60 drives 18 part functions
 * FUN_00401ee0, 4021c0, 402470, 4026e0, 4028b0, 402e20, 402fd0, 403230, 403380, 4035e0, 403750, 403ad0, 403d30, 403ef0,
 * 404160, 404330, 4047e0, 4049d0 (setups FUN_004020b0, 402210, 402510, 402800, 402ae0, 402e70, 403100, 403280, 4034b0,
 * 403630, 403830, 403c00, 403d80, 404020, 4041b0, 4045e0, 404850, 404e50). Every part ends when the scene clock passes
 * table 0x449058 (`deadline`), fading to the stored palette [추정: black]; part 17 ends by itself.
 *
 * Characters are APD anims (FUN_0041c0e0 file, FUN_0041c240 place, FUN_0041c300 play n times) at screen points [추정: the point
 * is the sprite origin]. Approximations [추정]: dissolves (FUN_0041a0b0/a1a0/a200) are opacity ramps; FUN_0041aa20 repeat 2
 * plays once.
 */
import { OPENING_PART_END_MS as E, sheet, slides, type Cmd, type Frame, type SceneDef } from '../timeline';

const part = (k: number, fadeSteps: number, cmds: Cmd[]): Cmd[] => [{ op: 'deadline', ms: E[k]!, outro: [{ op: 'fade', dir: 'out', steps: fadeSteps }, { op: 'waitFade' }] }, ...cmds];
const full = (obj: number, slot: number): Cmd => ({ op: 'show', obj, slot, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 });
const show = (obj: number, slot: number, w: number, h: number, dx: number, dy: number): Cmd => ({ op: 'show', obj, slot, sx: 0, sy: 0, w, h, dx, dy });
const fr = (slot: number, w: number, h: number, ms: number, x: number, y: number): Frame => ({ slot, sx: 0, sy: 0, w, h, ms, x, y });
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const sprite = (id: number, apdName: string, anim: string, x: number, y: number, times = 1): Cmd => ({ op: 'sprite', id, apd: apdName, anim, x, y, times });
/** The split-screen wipe of parts 6/8/11/13: the background slides 300 ms while the half-screen picture dissolves in (FUN_0041a0b0 500 ms, started in the same step). */
const wipe = (bgBy: [number, number]): Cmd[] => [{ op: 'move', obj: 0, by: bgBy, ms: 300 }, { op: 'alpha', obj: 4, from: 0, to: 1, ms: 500 }, { op: 'waitMove', obj: 0 }];
/** A picture prepared for a dissolve: shown but still invisible. */
const hidden = (obj: number): Cmd => ({ op: 'alpha', obj, from: 0, to: 0, ms: 0 });

export const scene00: SceneDef = { id: 0, parts: [
  // p0: VOP01 logo 288×96 centered, 16-step fade in (FUN_004020b0)
  part(0, 16, [{ op: 'order', ids: [0, 3] }, show(0, 0, 288, 96, 176, 192), { op: 'fade', dir: 'in', steps: 16 }]),
  // p1: four layers drifting apart; object 5 loops vop02d00..07 (FUN_00402210)
  part(1, 2, [
    { op: 'order', ids: [0, 3, 4, 5] },
    full(0, 1), show(3, 2, 640, 384, 0, 96), show(4, 3, 640, 272, 0, 208), show(5, 4, 144, 272, 336, 96),
    { op: 'move', obj: 0, from: [0, 0], by: [0, -16], ms: 2000 }, { op: 'move', obj: 3, from: [0, 96], by: [0, 24], ms: 2000 },
    { op: 'move', obj: 4, from: [0, 208], by: [0, 40], ms: 2000 }, { op: 'move', obj: 5, by: [0, 40], ms: 2000 },
    { op: 'anim', fx: 0, obj: 5, x: 344, y: 96, frames: slides(range(4, 11), 144, 272, 150), loop: true }, { op: 'effect', fx: 0, on: true },
    { op: 'fade', dir: 'in', steps: 8 },
  ]),
  // p2: vop03a with the vop03b00..11 loop on object 3 (key 253) and a small vop03c00..04 burst at 5 s (FUN_00402510)
  part(2, 16, [
    { op: 'order', ids: [0, 3, 4] }, { op: 'key', obj: 3, key: 253 },
    full(0, 12), show(3, 13, 568, 368, 0, 0),
    { op: 'anim', fx: 0, obj: 3, x: 0, y: 0, frames: slides(range(13, 24), 568, 368, 100), loop: true }, { op: 'effect', fx: 0, on: true },
    { op: 'anim', fx: 1, obj: 4, x: 360, y: 0, frames: slides([133, 134, 136, 137, 138], 40, 56, 200), loop: false },
    { op: 'fade', dir: 'in', steps: 2 },
    { op: 'wait', ms: 5000 }, { op: 'effect', fx: 1, on: true },
  ]),
  // p3: vop04a, then at 42 s a 1-step cut to vop04b fading in over 3 steps (FUN_00402800)
  part(3, 4, [
    { op: 'order', ids: [0] }, full(0, 25), { op: 'fade', dir: 'in', steps: 16 },
    { op: 'waitUntil', ms: 42000 }, { op: 'fade', dir: 'out', steps: 1 }, { op: 'waitFade' },
    full(0, 26), { op: 'fade', dir: 'in', steps: 3 },
  ]),
  // p4: a 7.5 s pan over vop05a (1800×899) while object 3 grows through vop05b00..17 and flies off (FUN_00402ae0)
  part(4, 3, [
    { op: 'order', ids: [0, 3] },
    { op: 'show', obj: 0, slot: 27, sx: 1160, sy: 400, w: 640, h: 480, dx: 0, dy: 0 },
    { op: 'move', obj: 0, from: [1160, 400], by: [-1160, -400], ms: 7500 },
    { op: 'anim', fx: 0, obj: 3, x: 0, y: 0, loop: false, frames: [
      fr(28, 480, 96, 100, 160, 386), fr(29, 440, 144, 100, 200, 312), fr(30, 400, 176, 100, 232, 160), fr(31, 288, 208, 100, 172, 64),
      fr(32, 216, 232, 120, 104, 24), fr(33, 168, 224, 120, 64, 16), fr(34, 144, 224, 150, 40, 16)] },
    { op: 'anim', fx: 1, obj: 3, x: 16, y: 0, frames: slides([35, 36, 37, 38, 39, 39, 39, 39, 39, 39, 38, 37, 36, 35], 160, 240, 70), loop: false },
    { op: 'anim', fx: 2, obj: 3, x: 16, y: 0, frames: slides(range(40, 45), 160, 240, 100), loop: false },
    { op: 'anim', fx: 3, obj: 3, x: 16, y: 0, frames: slides(range(41, 45), 160, 240, 100), loop: true },
    { op: 'anim', fx: 4, obj: 3, x: 16, y: 0, frames: slides([...range(41, 45), ...range(41, 45)], 160, 240, 70), loop: false },
    { op: 'fade', dir: 'in', steps: 3 },
    { op: 'wait', ms: 2000 }, { op: 'effect', fx: 0, on: true },
    { op: 'waitEffect', fx: 0 }, { op: 'move', obj: 3, from: [0, 0], by: [216, 100], ms: 1000 }, { op: 'effect', fx: 1, on: true },
    { op: 'waitMove', obj: 3 }, { op: 'waitEffect', fx: 1 }, { op: 'effect', fx: 2, on: true },
    { op: 'waitEffect', fx: 2 }, { op: 'effect', fx: 3, on: true },
    { op: 'wait', ms: 6000 }, { op: 'move', obj: 3, from: [216, 100], by: [-500, 50], ms: 1500 }, { op: 'effect', fx: 3, on: false }, { op: 'effect', fx: 4, on: true },
    { op: 'wait', ms: 7000 }, { op: 'fade', dir: 'out', steps: 3 },
    { op: 'waitEffect', fx: 4 }, { op: 'effect', fx: 1, on: true },
  ]),
  // p5: vop06a with the vop06b sign and two characters (FUN_00402e70)
  part(5, 2, [{ op: 'order', ids: [0, 3] }, full(0, 46), show(3, 47, 320, 176, 64, 0), sprite(0, 'vop06a', 'OP_EVENT1', 128, 120), sprite(1, 'vop06b', 'OP_EVENT1', 320, 288), { op: 'fade', dir: 'in', steps: 4 }]),
  // p6: vop07a; after 1 s the picture slides left while the left-half vop07z appears (FUN_00403100)
  part(6, 8, [{ op: 'order', ids: [0, 4] }, full(0, 48), show(4, 126, 320, 480, 0, 0), hidden(4), { op: 'fade', dir: 'in', steps: 4 }, { op: 'waitFade' }, { op: 'wait', ms: 1000 }, ...wipe([-40, 0])]),
  // p7: vop08a with its character (FUN_00403280)
  part(7, 2, [{ op: 'order', ids: [0] }, full(0, 49), sprite(0, 'vop08a', 'OP_EVENT1', 320, 224), { op: 'fade', dir: 'in', steps: 4 }]),
  // p8: vop09a; after 1 s it nudges up while the top strip vop09z appears (FUN_004034b0)
  part(8, 8, [{ op: 'order', ids: [0, 4] }, full(0, 50), show(4, 127, 640, 240, 0, 0), hidden(4), { op: 'fade', dir: 'in', steps: 4 }, { op: 'waitFade' }, { op: 'wait', ms: 1000 }, ...wipe([0, -16])]),
  // p9: vop10a with two characters (FUN_00403630)
  part(9, 2, [{ op: 'order', ids: [0] }, full(0, 51), sprite(0, 'vop10a', 'OP_EVENT1', 288, 208), sprite(1, 'vop10a', 'OP_EVENT2', 320, 224, 3), { op: 'fade', dir: 'in', steps: 4 }]),
  // p10: sky vop11a, looping sea vop11b00..05, strip vop11c and the vop11d figure sequence (FUN_00403830)
  part(10, 4, [
    { op: 'order', ids: [0, 3, 4, 5] },
    show(0, 52, 640, 224, 0, 0), show(3, 53, 640, 208, 0, 224), show(4, 59, 640, 48, 0, 432), show(5, 60, 336, 240, 208, 240),
    { op: 'anim', fx: 0, obj: 3, x: 0, y: 224, frames: slides(range(53, 58), 640, 208, 200), loop: true },
    { op: 'anim', fx: 1, obj: 5, x: 208, y: 240, frames: slides([60, 61, 62, 63, 61], 336, 240, 200), loop: true },
    { op: 'anim', fx: 2, obj: 5, x: 208, y: 240, frames: slides([60, 64, 65, 66], 336, 240, 200), loop: false },
    { op: 'anim', fx: 3, obj: 5, x: 208, y: 240, frames: slides([67, 68, 67, 135], 336, 240, 200), loop: true },
    { op: 'effect', fx: 0, on: true }, { op: 'effect', fx: 1, on: true },
    { op: 'fade', dir: 'in', steps: 16 },
    { op: 'waitFade' }, { op: 'wait', ms: 5000 }, { op: 'effect', fx: 1, on: false }, { op: 'effect', fx: 2, on: true },
    { op: 'waitEffect', fx: 2 }, { op: 'effect', fx: 2, on: false }, { op: 'effect', fx: 3, on: true },
  ]),
  // p11: vop12a; after 3 s it slides left while vop12z appears (FUN_00403c00)
  part(11, 8, [{ op: 'order', ids: [0, 4] }, full(0, 69), show(4, 128, 320, 480, 0, 0), hidden(4), { op: 'fade', dir: 'in', steps: 8 }, { op: 'waitFade' }, { op: 'wait', ms: 3000 }, ...wipe([-160, 0])]),
  // p12: vop13a with four characters (FUN_00403d80)
  part(12, 2, [{ op: 'order', ids: [0] }, full(0, 70), sprite(0, 'vop13a', 'OP_EVENT1', 288, 272, 3), sprite(1, 'vop13a', 'OP_EVENT2', 352, 240), sprite(2, 'vop13a', 'OP_EVENT3', 224, 304), sprite(3, 'vop13a', 'OP_EVENT4', 224, 240), { op: 'fade', dir: 'in', steps: 4 }]),
  // p13: vop14a fades in from white; after 1 s it slides right while the right-half vop14z appears (FUN_00404020)
  part(13, 4, [{ op: 'order', ids: [0, 4] }, full(0, 80), show(4, 129, 320, 480, 320, 0), hidden(4), { op: 'fade', dir: 'in', steps: 4, color: 'white' }, { op: 'waitFade' }, { op: 'wait', ms: 1000 }, ...wipe([200, 0])]),
  // p14: vop15a with the cloud strip vop15b drifting right for 30 s at base y 280 and two characters (FUN_004041b0)
  part(14, 2, [
    { op: 'order', ids: [0, 3] }, full(3, 81), { op: 'pos', obj: 0, x: 0, y: 280 }, show(0, 82, 640, 204, 0, 0),
    { op: 'move', obj: 0, from: [0, 0], by: [640, 0], ms: 30000 }, sprite(0, 'vop15a', 'OP_EVENT1', 304, 248), sprite(1, 'vop15a', 'OP_EVENT2', 240, 248), { op: 'fade', dir: 'in', steps: 4 },
  ]),
  // p15: vop16a, then vop16b over it at 111 s, the left half vop16z00 at 119 s and the right half vop16z01 at 123.5 s (FUN_004045e0)
  part(15, 4, [
    { op: 'order', ids: [0, 3, 4, 5] }, full(0, 83), full(3, 84), hidden(3), show(4, 130, 320, 480, 0, 0), hidden(4), show(5, 131, 320, 480, 320, 0), hidden(5), { op: 'fade', dir: 'in', steps: 4 },
    { op: 'waitUntil', ms: 111000 }, { op: 'alpha', obj: 3, from: 0, to: 1, ms: 1000 },
    { op: 'waitUntil', ms: 119000 }, { op: 'hide', obj: 0 }, { op: 'alpha', obj: 4, from: 0, to: 1, ms: 500 },
    { op: 'waitUntil', ms: 123500 }, { op: 'alpha', obj: 4, from: 1, to: 0, ms: 500 }, { op: 'waitUntil', ms: 123800 }, { op: 'alpha', obj: 5, from: 0, to: 1, ms: 500 },   // the original moves 300 ms between the two dissolves
  ]),
  // p16: a 30 s three-layer panorama pan over vop17a/b/c (FUN_00404850)
  part(16, 4, [
    { op: 'order', ids: [0, 3, 4] },
    { op: 'show', obj: 0, slot: 90, sx: 640, sy: 0, w: 640, h: 272, dx: 0, dy: 0 },
    { op: 'show', obj: 3, slot: 91, sx: 968, sy: 0, w: 640, h: 480, dx: 0, dy: 0 },
    { op: 'show', obj: 4, slot: 92, sx: 464, sy: 0, w: 640, h: 480, dx: 0, dy: 0 },
    { op: 'move', obj: 0, from: [640, 0], by: [-640, 0], ms: 30000 }, { op: 'move', obj: 3, from: [968, 0], by: [-968, 0], ms: 30000 }, { op: 'move', obj: 4, from: [464, 0], by: [-500, 0], ms: 20000 },
    { op: 'fade', dir: 'in', steps: 6 }, { op: 'waitMove', obj: 0 },
  ]),
  // p17: vop18a with two figure sequences, then the scrolling credits vop18d (640×1920), the split with vop18z, vop18f and the
  // vop18g00..11 finale (FUN_00404e50 / FUN_004049d0)
  [
    { op: 'order', ids: [0, 3, 4, 5, 1] }, full(0, 93), show(4, 102, 280, 336, 160, 0),
    { op: 'anim', fx: 0, obj: 3, x: 88, y: 0, frames: slides(range(94, 100), 146, 183, 200), loop: false },
    { op: 'anim', fx: 1, obj: 4, x: 160, y: 0, loop: false, frames: [fr(101, 280, 344, 150, 160, 0), fr(102, 480, 344, 150, 160, 0), fr(103, 440, 344, 150, 160, 0), fr(104, 440, 344, 150, 160, 0), fr(105, 408, 344, 150, 160, 0), fr(106, 376, 360, 150, 160, 0), fr(107, 360, 384, 150, 160, 0)] },
    { op: 'anim', fx: 3, obj: 3, x: 0, y: 0, loop: false, frames: [
      fr(114, 416, 472, 100, 224, 8), fr(115, 424, 472, 100, 216, 8), fr(116, 448, 464, 100, 192, 16), fr(117, 480, 480, 100, 160, 0), fr(118, 592, 480, 100, 48, 0), fr(119, 608, 480, 100, 32, 0),
      fr(120, 640, 416, 100, 0, 64), fr(121, 640, 400, 100, 0, 80), fr(122, 576, 448, 100, 0, 32), fr(123, 464, 408, 100, 0, 72), fr(124, 272, 384, 100, 0, 96), fr(125, 168, 272, 100, 0, 208)] },
    { op: 'fade', dir: 'in', steps: 8 },
    { op: 'waitFade' }, { op: 'effect', fx: 0, on: true }, { op: 'effect', fx: 1, on: true },
    { op: 'waitEffect', fx: 1 }, { op: 'effect', fx: 0, on: false }, { op: 'hide', obj: 3 }, { op: 'hide', obj: 4 },
    { op: 'show', obj: 0, slot: 108, sx: 0, sy: 1440, w: 640, h: 480, dx: 0, dy: 0 },
    { op: 'wait', ms: 4000 }, { op: 'move', obj: 0, from: [0, 1440], by: [0, -1440], ms: 9000 },
    { op: 'waitMove', obj: 0 }, { op: 'wait', ms: 16000 }, { op: 'move', obj: 0, from: [0, 0], by: [-156, 0], ms: 500 },
    { op: 'waitMove', obj: 0 }, show(1, 132, 320, 480, 0, 0), { op: 'alpha', obj: 1, from: 0, to: 1, ms: 500 },
    { op: 'wait', ms: 22000 }, { op: 'alpha', obj: 1, from: 1, to: 0, ms: 500 }, full(0, 113), { op: 'show', obj: 3, slot: 108, sx: 0, sy: 0, w: 640, h: 480, dx: 156, dy: 0 },
    { op: 'wait', ms: 24000 }, { op: 'hide', obj: 3 }, { op: 'key', obj: 3, key: 253 }, show(3, 114, 416, 472, 224, 8), { op: 'effect', fx: 3, on: true },
    { op: 'waitEffect', fx: 3 }, { op: 'hide', obj: 3 }, { op: 'fade', dir: 'out', steps: 4 }, { op: 'waitFade' },
    { op: 'end' },
  ],
] };
