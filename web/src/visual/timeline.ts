/**
 * Visual scene timelines (analysis/visual_scenes.md): the original's mode-8 primitives as commands. A scene is a list of
 * parts; each part is a command list executed in order. Objects are the original's 10 drawables (object 0 opaque, the
 * others color-keyed 249); image slots are vsllst records of the scene.
 */
export type TilesCmd = { op: 'tiles'; obj: number; kind: 0 | 3 | 4; x: number; y: number; cw: number; ch: number; slots: number[]; ms: number };
export type Cmd =
  | { op: 'order'; ids: number[] }                                                                 // FUN_00419e40: draw order, first drawn first
  | { op: 'show'; obj: number; slot: number; sx: number; sy: number; w: number; h: number; dx: number; dy: number }   // FUN_00419c70
  | { op: 'hide'; obj: number }                                                                    // FUN_00419fe0
  | { op: 'clip'; obj: number; x: number; y: number; w: number; h: number }                        // FUN_00419f10: screen-space window [추정]
  | { op: 'move'; obj: number; from: [number, number]; to: [number, number]; ms: number }         // FUN_0041a2b0 / FUN_0041a380
  | { op: 'waitMove'; obj: number }                                                                // FUN_0041a270
  | { op: 'fade'; dir: 'in' | 'out'; steps: number }                                               // FUN_00419a20(steps, 1) in; (steps, 2|4) out [추정: to black]
  | { op: 'waitFade' }                                                                             // FUN_00419aa0 / thunk_FUN_004184d0
  | { op: 'wait'; ms: number }                                                                     // FUN_004024f0: part clock ≥ ms (DAT_00449688)
  | { op: 'resetClock' }                                                                           // DAT_00449674 = now
  | { op: 'waitUntil'; ms: number }                                                                // FUN_0041dbc0 / FUN_00402050: scene clock ≥ ms
  | TilesCmd                                                                                       // FUN_0041aac0 (one slot) / FUN_0041aa20 (slot list)
  | { op: 'effect'; obj: number; on: boolean }                                                     // FUN_0041a890
  | { op: 'waitEffect'; obj: number }                                                              // FUN_0041a910
  | { op: 'sound'; name: string }                                                                  // FUN_0041dc50 + FUN_0041dca0(ch, 1)
  | { op: 'end' };                                                                                 // FUN_00402070

export interface SceneDef { id: number; parts: Cmd[][] }
export interface VisualImage { image: CanvasImageSource; w: number; h: number }
/** Slot images of the current scene; null while loading or when the bitmap is missing. */
export interface VisualImages { get(slot: number): VisualImage | null }

/** Table 0x449058: when each opening part ends, in ms since the scene started (part 17 ends by itself). */
export const OPENING_PART_END_MS: number[] = [9000, 24000, 32000, 45000, 53000, 57000, 62000, 66000, 71000, 76000, 85000, 93000, 97000, 103000, 108000, 128000, 139000];

/** Table 0x449598 (analysis/save_sound_visual.md §3.1): PLAY_VISUAL 0..17 → opening part n; 21..33 → scenes 1..13. */
export function dispatch(n: number): { scene: number; part: number } | null {
  if (n >= 0 && n <= 17) return { scene: 0, part: n };
  if (n >= 21 && n <= 33) return { scene: n - 20, part: 0 };
  return null;
}
