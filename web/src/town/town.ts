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

/** FUN_0042b080: a facility's label is looked up in the stage file first, then in EVENT00. */
export function townLabel(res: Resources, stage: number, i: number): { stage: number; label: string } | null {
  const spot = HOTSPOTS[i];
  if (!spot) return null;
  for (const s of [stage, 0]) { const p = res.program(s); if (p && findLabel(p, spot.label) !== null) return { stage: s, label: spot.label }; }
  return null;
}
