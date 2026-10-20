/**
 * Visual scene timelines (analysis/visual_scenes.md): the original's mode-8 primitives as commands. A scene is a list of
 * parts; each part is a command list executed in order. Objects are the original's 10 drawables (object 0 opaque, the
 * others color-keyed 249); image slots are vsllst records of the scene.
 */
import type { StarKind } from './stars';

/** One animation frame: image slot, source rect, how long it stays (FUN_0041a970 particle record). */
export interface Frame { slot: number; sx: number; sy: number; w: number; h: number; ms: number; x?: number; y?: number }   // x/y override the anim's position
/** FUN_0041aac0 / FUN_0041aa20: effect `fx` (0..7) animates object `obj` at (x, y) through `frames`; loop = repeat 0 (until `effect off`), else once. */
export type AnimCmd = { op: 'anim'; fx: number; obj: number; x: number; y: number; frames: Frame[]; loop: boolean };
export type Cmd =
  | { op: 'order'; ids: number[] }                                                                 // FUN_00419e40: draw order, first drawn first
  | { op: 'show'; obj: number; slot: number; sx: number; sy: number; w: number; h: number; dx: number; dy: number }   // FUN_00419c70
  | { op: 'hide'; obj: number }                                                                    // FUN_00419fe0
  | { op: 'pos'; obj: number; x: number; y: number }                                               // FUN_00419ec0: base position added to the shown offset
  | { op: 'key'; obj: number; key: number | null }                                                 // FUN_00419da0: color key (null = opaque); reset gives object 0 null, the others 249
  | { op: 'clip'; obj: number; x: number; y: number; w: number; h: number }                        // FUN_00419f10: screen-space window [추정]
  | { op: 'move'; obj: number; from?: [number, number]; by: [number, number]; ms: number }        // FUN_0041a2b0 / FUN_0041a380: from `from` (slot given) or where it is (slot −1), by a delta; images larger than the screen pan their source window
  | { op: 'waitMove'; obj: number }                                                                // FUN_0041a270
  | { op: 'alpha'; obj: number; from: number; to: number; ms: number }                             // FUN_0041a0b0 dissolve / FUN_0041c6c0 picture fade as an opacity ramp [추정]
  | { op: 'waitAlpha'; obj: number }
  | { op: 'fade'; dir: 'in' | 'out'; steps: number; color?: 'black' | 'white' }                   // FUN_00419a20(steps, 1) in; (steps, 2|4) out [추정: to black]; white = palette set to white first (FUN_004198d0(255,255,255))
  | { op: 'waitFade' }                                                                             // FUN_00419aa0 / thunk_FUN_004184d0
  | { op: 'wait'; ms: number }                                                                     // FUN_004024f0: part clock ≥ ms (DAT_00449688)
  | { op: 'resetClock' }                                                                           // DAT_00449674 = now
  | { op: 'deadline'; ms: number; outro: Cmd[] }                                                   // FUN_00402050(part): at scene clock ≥ ms the part stops and runs `outro` (its fade), whatever it was doing
  | { op: 'waitUntil'; ms: number }                                                                // FUN_0041dbc0 / FUN_00402050: scene clock ≥ ms
  | AnimCmd
  | { op: 'effect'; fx: number; on: boolean }                                                      // FUN_0041a890
  | { op: 'stars'; obj: number; kind: StarKind }                                                 // FUN_00405920(obj, k, 0xf0, 2): star field k (stars.ts) drawn as object obj
  | { op: 'waitEffect'; fx: number }                                                               // FUN_0041a910: running and not finished
  | { op: 'sound'; name: string }                                                                  // FUN_0041dc50 + FUN_0041dca0(ch, 1)
  | { op: 'sprite'; id: number; apd: string; anim: string; x: number; y: number; times: number }   // FUN_0041c0e0 (file) + FUN_0041c240 (place) + FUN_0041c300 (play n times): an APD anim at a screen point [추정: the point is the sprite origin]
  | { op: 'textRoll'; ms: number }                                                                 // FUN_0041bfa0: the staff roll (start()'s lines) climbs from the bottom edge to above the top in ms [추정 speed]
  | { op: 'waitText' }                                                                             // FUN_0041bf90
  | { op: 'end' };                                                                                 // FUN_00402070

export interface SceneDef { id: number; parts: Cmd[][] }
/** One line of the staff roll (data/staff.json from DATA/staff.lst): text with its font, or a blank gap. */
export type TextLine = { text: string; size: number; font: 'mincho' | 'gotic'; bold: boolean; gap: number } | { space: number };
/** A text item of a frame: centred at x, baseline-top at y, in screen pixels. */
export interface ScreenText { text: string; x: number; y: number; size: number; font: 'mincho' | 'gotic'; bold: boolean }

/** FUN_0041aac0: a sheet of `sheetW`×`sheetH` cut into `cw`×`ch` cells, row by row, `ms` per cell. */
export function sheet(slot: number, sheetW: number, sheetH: number, cw: number, ch: number, ms: number): Frame[] {
  const out: Frame[] = [];
  for (let y = 0; y < sheetH; y += ch) for (let x = 0; x < sheetW; x += cw) out.push({ slot, sx: x, sy: y, w: cw, h: ch, ms });
  return out;
}
/** FUN_0041aa20: whole images (source rect (0,0,w,h) of each slot) shown one after another, `ms` each. */
export function slides(slots: number[], w: number, h: number, ms: number): Frame[] {
  return slots.map((slot) => ({ slot, sx: 0, sy: 0, w, h, ms }));
}
export interface VisualImage { image: CanvasImageSource; w: number; h: number }
/** Slot images of the current scene, and named bitmaps (bmp\%s.bmp — the star strip) with a color key; null while loading or missing. */
export interface VisualImages { get(slot: number, key: number | null): VisualImage | null; bitmap(name: string, key: number | null): VisualImage | null }

/** Table 0x449058: when each opening part ends, in ms since the scene started (part 17 ends by itself). */
export const OPENING_PART_END_MS: number[] = [9000, 24000, 32000, 45000, 53000, 57000, 62000, 66000, 71000, 76000, 85000, 93000, 97000, 103000, 108000, 128000, 139000];

/** Table 0x449598 (analysis/save_sound_visual.md §3.1): PLAY_VISUAL 0..17 → opening part n; 21..33 → scenes 1..13. */
export function dispatch(n: number): { scene: number; part: number } | null {
  if (n >= 0 && n <= 17) return { scene: 0, part: n };
  if (n >= 21 && n <= 33) return { scene: n - 20, part: 0 };
  return null;
}
