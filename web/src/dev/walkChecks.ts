/**
 * The browser auto-play's eyes (spec 2026-10-20-browser-walk-design.md §5.5–5.6), as pure rules: which frames are worth a
 * picture (`momentsBetween`), when a frame is blank (`blankRatio`, `blankFlag`), how many Win95 boxes left the screen
 * (`overflowing`), and when nothing has happened for too long (`StuckWatch`). play/walk.ts feeds them one snapshot per frame.
 */
export interface WalkSnapshot {
  t: number;                 // virtual ms
  mode: string;              // GameCore.mode
  mapReady: boolean;
  turn: number | null;       // battle turn, null outside a battle
  phase: string | null;      // battle phase kind
  selMode: string | null;    // the player selection mode
  town: boolean;             // the town picture is showing
  visualPart: number | null; // the visual scene's part while one plays
  visualPlaying: boolean;
  dialogsOpened: number;     // Dialogs.openedCount
  dialogTemplate: string | null;   // the newest box's template id
  fadeAlpha: number;         // 0 clear … 1 covered
  pc: number;                // the VM's program counter
}

export const TICK_MS = 10_000;

/** The pictures the frame `cur` earns, given the frame before it and the virtual time of the last 10 s tick. The first frame is the baseline. */
export function momentsBetween(prev: WalkSnapshot | null, cur: WalkSnapshot, lastTickT: number): string[] {
  if (!prev) return [];
  const out: string[] = [];
  if (!prev.mapReady && cur.mapReady) out.push('map');
  if (cur.turn === 1 && cur.phase === 'player' && cur.selMode === 'idle' && !(prev.turn === 1 && prev.phase === 'player')) out.push('battle-start');
  if (cur.phase === 'end' && prev.phase !== 'end') out.push('battle-end');
  if (!prev.town && cur.town) out.push('town');
  if (cur.visualPart !== null && cur.visualPart !== prev.visualPart) out.push(`scene-${cur.visualPart}`);
  if (cur.dialogsOpened > prev.dialogsOpened) out.push(`dialog-${cur.dialogTemplate ?? '?'}`);
  if (cur.t - lastTickT >= TICK_MS) out.push('tick');
  return out;
}

/** The share (0..1) of the most common colour among RGBA sample pixels. */
export function blankRatio(rgba: Uint8ClampedArray): number {
  const n = rgba.length >> 2;
  if (n === 0) return 0;
  const counts = new Map<number, number>();
  let best = 0;
  for (let i = 0; i < n; i++) {
    const key = (rgba[i * 4]! << 16) | (rgba[i * 4 + 1]! << 8) | rgba[i * 4 + 2]!;
    const c = (counts.get(key) ?? 0) + 1; counts.set(key, c);
    if (c > best) best = c;
  }
  return best / n;
}

/** A frame of one colour is blank unless a fade covers it or a visual scene (whose black is its own) plays. */
export function blankFlag(ratio: number, fadeAlpha: number, visualPlaying: boolean): boolean {
  return ratio >= 0.99 && fadeAlpha < 1 && !visualPlaying;
}

export interface Rect { left: number; top: number; right: number; bottom: number }
/** How many rectangles leave the screen rectangle on any side. */
export function overflowing(rects: Rect[], screen: Rect): number {
  return rects.filter((r) => r.left < screen.left || r.top < screen.top || r.right > screen.right || r.bottom > screen.bottom).length;
}

/** Nothing has changed for `limitMs` of virtual time (a scene part for `sceneLimitMs`, the longest part being 200 s). */
export class StuckWatch {
  private sig = '';
  private since = 0;
  constructor(private readonly limitMs = 60_000, private readonly sceneLimitMs = 220_000) {}
  update(s: WalkSnapshot): boolean {
    const sig = s.visualPlaying ? `scene:${s.visualPart}` : `${s.mode}|${s.pc}|${s.turn}|${s.dialogsOpened}|${s.fadeAlpha.toFixed(2)}`;
    if (sig !== this.sig) { this.sig = sig; this.since = s.t; return false; }
    return s.t - this.since >= (s.visualPlaying ? this.sceneLimitMs : this.limitMs);
  }
}
