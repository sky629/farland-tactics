import { VIEW_H, VIEW_W } from '../iso/grid';
import type { Tint } from '../script/host';

export const FADE_STEP_MS = 30;   // one palette step of the original ≈ 30 ms [추정, spec §15]
export type ImageSource = CanvasImageSource | (() => CanvasImageSource | null) | null;
export interface FxSnapshot { fade: { color: 'black' | 'white'; alpha: number } | null; tint: { color: string; alpha: number } | null; image: CanvasImageSource | null }
type Fade = { color: 'black' | 'white'; from: number; to: number; start: number; ms: number };
const TINTS: Partial<Record<Tint, { color: string; alpha: number }>> = {
  dim: { color: '#000', alpha: 0.4 }, sunset: { color: '#f80', alpha: 0.25 }, night: { color: '#024', alpha: 0.45 }, dusk: { color: '#630', alpha: 0.35 },
  black: { color: '#000', alpha: 0.9 }, uiDark: { color: '#000', alpha: 0.3 }, textpal: { color: '#000', alpha: 0.2 }, facepal: { color: '#000', alpha: 0.2 },
  uiHalfA: { color: '#fff', alpha: 0.3 }, uiHalfB: { color: '#fff', alpha: 0.3 },
};

/** The original's palette effects approximated as full-screen overlays, plus camera shake and scripted scrolling. */
export class Effects {
  private fadeState: Fade | null = null;
  private tintState: { color: string; alpha: number } | null = null;
  private image: ImageSource = null;
  private shakeAmp = 0;
  private scroll: { dx: number; dy: number; target: { x: number; y: number } | null; ms: number; last: number } | null = null;
  private lastNow = 0;

  /** FADE_IN / FADE_OUT: `step` palette steps; 0 = instant. */
  fade(dir: 'in' | 'out', step: number, now: number, color: 'black' | 'white' = 'black'): void {
    this.lastNow = now;
    const to = dir === 'out' ? 1 : 0;
    const from = this.fadeState ? this.alphaAt(now) : dir === 'out' ? 0 : 1;
    this.fadeState = { color, from, to, start: now, ms: Math.max(step, 0) * FADE_STEP_MS };
  }
  private alphaAt(now: number): number {
    const f = this.fadeState!;
    if (f.ms <= 0) return f.to;
    const t = Math.min(Math.max((now - f.start) / f.ms, 0), 1);
    return f.from + (f.to - f.from) * t;
  }
  fadeBusy(): boolean { return this.fadeState !== null && this.fadeState.ms > 0 && this.lastNow < this.fadeState.start + this.fadeState.ms; }

  /**
   * SHOW_IMAGE: the bitmap covers the screen; with a step it fades in from black, without one it shows at once and ends
   * any fade still on screen (the scripts chain FADE_OUT → SHOW_IMAGE n, 0). A resolver is read every frame, so a
   * bitmap still loading appears when ready; null = no such bitmap (black).
   */
  showImage(img: ImageSource, step: number, now: number): void {
    this.lastNow = now;
    this.image = img;
    this.fadeState = step > 0 ? { color: 'black', from: 1, to: 0, start: now, ms: step * FADE_STEP_MS } : null;
  }
  hideImage(): void { this.image = null; }
  clearScreen(): void { this.image = null; }

  tint(kind: Tint, n: number, pct?: number): void {
    if (kind === 'reset') { this.tintState = null; return; }
    if (kind === 'white') { this.fadeState = { color: 'white', from: 0, to: 1, start: this.lastNow, ms: Math.max(n, 0) * FADE_STEP_MS }; return; }
    if (kind === 'dimUi') { this.tintState = { color: '#000', alpha: 1 - Math.min(Math.max(pct ?? 100, 0), 100) / 100 }; return; }
    this.tintState = TINTS[kind] ?? null;
  }
  shake(n: number): void { this.shakeAmp = Math.max(n, 0); }

  /** CAMERA_SCROLL: every `ms` move the camera by (dx, dy); stop at the target cell (or the map edge when there is none). */
  startScroll(dx: number, dy: number, tx: number, ty: number, ms: number, cellOf: (c: number, r: number) => { x: number; y: number } | null): void {
    const cell = tx === 0 && ty === 0 ? null : cellOf(tx, ty);
    this.scroll = { dx, dy, target: cell ? { x: cell.x - VIEW_W / 2, y: cell.y - VIEW_H / 2 } : null, ms: Math.max(ms, 1), last: -1 };
  }
  scrollBusy(): boolean { return this.scroll !== null; }

  /** Advance scripted scrolling and apply shake; returns the camera to draw with. */
  update(now: number, camera: { x: number; y: number }, clamp: (x: number, y: number) => { x: number; y: number }): { x: number; y: number } {
    this.lastNow = now;
    let cam = camera;
    const s = this.scroll;
    if (s) {
      if (s.last < 0) s.last = now;
      const ticks = Math.floor((now - s.last) / s.ms);
      if (ticks > 0) {
        s.last += ticks * s.ms;
        let { x, y } = cam;
        for (let k = 0; k < ticks && this.scroll; k++) {
          const nx = x + s.dx, ny = y + s.dy;
          const reached = (v: number, target: number, d: number) => (d > 0 ? v >= target : d < 0 ? v <= target : true);
          if (s.target && reached(nx, s.target.x, s.dx) && reached(ny, s.target.y, s.dy)) { x = s.target.x; y = s.target.y; this.scroll = null; }
          else { x = nx; y = ny; }
        }
        cam = clamp(x, y);
        if (this.scroll && !s.target && (cam.x !== x || cam.y !== y)) this.scroll = null;      // no target: stop at the map edge
      }
    }
    if (this.shakeAmp > 0) {
      const phase = Math.floor(now / 50);
      cam = { x: cam.x + ((phase & 1) !== 0 ? this.shakeAmp : -this.shakeAmp), y: cam.y + ((phase & 2) !== 0 ? this.shakeAmp : -this.shakeAmp) };
    }
    return cam;
  }

  snapshot(now: number): FxSnapshot {
    this.lastNow = now;
    let fade: FxSnapshot['fade'] = null;
    if (this.fadeState) {
      const alpha = this.alphaAt(now);
      if (!this.fadeBusy() && alpha <= 0) this.fadeState = null;
      else fade = { color: this.fadeState.color, alpha: Math.round(alpha * 1000) / 1000 };
    }
    return { fade, tint: this.tintState, image: typeof this.image === 'function' ? this.image() : this.image };
  }
}
