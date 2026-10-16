import { findLabel } from '../script/program';
import type { Resources } from '../script/host';

/** story_flow.md §3.2: the 15 facilities of the town screen (table 0x44b270). */
export interface Hotspot { label: string; name: string; click: [number, number, number, number]; highlight: [number, number, number, number] }
export const HOTSPOTS: Hotspot[] = [
  { label: 'outfield', name: '거리 밖으로', click: [572, 0, 639, 70], highlight: [532, 40, 606, 74] },
  { label: 'inn', name: '여관', click: [434, 186, 480, 212], highlight: [468, 168, 514, 204] },
  { label: 'guild', name: '길드', click: [284, 208, 310, 238], highlight: [296, 178, 354, 214] },
  { label: 'weapon', name: '무기상점', click: [148, 240, 170, 260], highlight: [156, 218, 218, 254] },
  { label: 'store', name: '잡화상점', click: [284, 434, 308, 462], highlight: [298, 410, 358, 444] },
  { label: 'church', name: '교회', click: [402, 90, 420, 112], highlight: [410, 66, 456, 102] },
  { label: 'cemetery', name: '묘지', click: [446, 0, 534, 68], highlight: [488, 0, 532, 34] },
  { label: 'harbor', name: '항구', click: [512, 350, 578, 378], highlight: [542, 328, 582, 362] },
  { label: 'cafe', name: '카페「Love&&Peace」', click: [22, 322, 122, 366], highlight: [66, 304, 212, 340] },
  { label: 'macdogal', name: '마크도갈 집', click: [120, 26, 232, 96], highlight: [168, 24, 262, 58] },
  { label: 'smith', name: '대장간', click: [16, 252, 34, 270], highlight: [26, 226, 86, 260] },
  { label: 'depot', name: '창고', click: [398, 288, 440, 324], highlight: [420, 280, 466, 314] },
  { label: 'lighthouse', name: '등대', click: [558, 288, 578, 310], highlight: [570, 262, 616, 296] },
  { label: 'farm', name: '밭', click: [364, 138, 452, 192], highlight: [406, 130, 448, 164] },
  { label: 'backdoor', name: '뒷문', click: [228, 190, 260, 222], highlight: [248, 166, 294, 202] },
];

/** FUN_0042b080 WM_LBUTTONDOWN: the first active facility whose click rect holds the point (PtInRect: right/bottom exclusive). */
export function hitTest(x: number, y: number, flags: number[]): number | null {
  for (let i = 0; i < HOTSPOTS.length; i++) {
    const [l, t, r, b] = HOTSPOTS[i]!.click;
    if ((flags[i] ?? 0) !== 0 && x >= l && x < r && y >= t && y < b) return i;
  }
  return null;
}

/** FUN_0042ad70: `Town%02d` sheets of a set — base 0/10/20 + layer 0..3; the 128×128 extra layer (4) exists only for the night set with TOWN_EXTRA. */
export function townLayers(set: 1 | 2 | 3, extra: boolean): string[] {
  const base = set === 3 ? 20 : set === 2 ? 10 : 0;
  const n = set === 2 && extra ? 5 : 4;
  return Array.from({ length: n }, (_, i) => `town${String(base + i).padStart(2, '0')}`);
}

/** FUN_0042b740: the two animation counters advance together, at most once per 50 ms. */
export const TOWN_TICK_MS = 50;
/** Counter 2 runs 0..29 but skips 2 and 4 after each wrap (28 values a cycle). */
const COUNTER2 = [0, 1, 3, ...Array.from({ length: 25 }, (_, i) => 5 + i)];

export interface SheetFrame { sx: number; sy: number; w: number; h: number; dx: number; dy: number }

/**
 * story_flow.md §3.1: layers 1 and 2 show frame k = (counter1 % 15) / 3 of a 2-column × 3-row sheet;
 * layer 4 shows frame j = 5 − |counter2 − 5| while counter2 < 11 (a 0→5→0 swing), else frame 0.
 */
export function layerFrame(layer: 1 | 2 | 4, now: number): SheetFrame {
  const tick = Math.floor(now / TOWN_TICK_MS);
  if (layer === 4) {
    const c = COUNTER2[tick % COUNTER2.length]!;
    const j = c < 11 ? 5 - Math.abs(c - 5) : 0;
    return { sx: (j % 3) * 128, sy: Math.floor(j / 3) * 128, w: 128, h: 128, dx: 496, dy: 160 };
  }
  const k = Math.floor((tick % 15) / 3);
  const [w, h, dx, dy] = layer === 1 ? [112, 64, 528, 0] : [288, 160, 352, 320];
  return { sx: Math.floor(k / 3) * w, sy: (k % 3) * h, w, h, dx, dy };
}

/** FUN_0042b080: a facility's label is looked up in the stage file first, then in EVENT00. */
export function townLabel(res: Resources, stage: number, i: number): { stage: number; label: string } | null {
  const spot = HOTSPOTS[i];
  if (!spot) return null;
  for (const s of [stage, 0]) { const p = res.program(s); if (p && findLabel(p, spot.label) !== null) return { stage: s, label: spot.label }; }
  return null;
}
