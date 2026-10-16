import { FADE_STEP_MS } from '../field/effects';
import type { Backdrop } from '../render/renderer';
import type { Cmd, SceneDef, TilesCmd, VisualImages } from './timeline';

export interface VisualFrame { backdrop: Backdrop[]; fade: { color: 'black'; alpha: number } | null; done: boolean }

interface Obj { slot: number; sx: number; sy: number; w: number; h: number; dx: number; dy: number; clip: { x: number; y: number; w: number; h: number } | null; visible: boolean }
interface Move { from: [number, number]; to: [number, number]; start: number; ms: number }
interface Effect { def: TilesCmd; start: number | null }
type Fade = { from: number; to: number; start: number; ms: number };

const OBJECTS = 10;

/**
 * Plays a SceneDef: commands run in order, `wait*` commands hold until their condition is true, parts follow each other,
 * `end` (or running out of commands) finishes the scene. Two clocks as in the original: the part clock (reset at each
 * part start and by `resetClock`) for `wait`, the scene clock for `waitUntil`. Tile effects are approximations [추정]:
 * kind 3 reveals cells in grid order, kind 4 hides them in grid order, kind 0 cycles through its slots.
 */
export class VisualPlayer {
  onSound?: (name: string) => void;
  private def: SceneDef | null = null;
  private images: VisualImages = { get: () => null };
  private part = 0;
  private i = 0;
  private sceneStart = 0;
  private partStart = 0;
  private finished = false;
  private skipped = false;
  private order: number[] = [];
  private readonly objs = new Map<number, Obj>();
  private readonly moves = new Map<number, Move>();
  private readonly effects = new Map<number, Effect>();
  private fadeState: Fade | null = null;
  private fadeLevel = 0;                                                       // 0 clear … 1 black when no fade runs

  get playing(): boolean { return this.def !== null && !this.finished; }

  start(def: SceneDef, part: number, images: VisualImages, now: number): void {
    this.def = def; this.images = images; this.part = part; this.i = 0;
    this.sceneStart = now; this.partStart = now;
    this.finished = part >= def.parts.length; this.skipped = false;
    this.order = Array.from({ length: OBJECTS }, (_, k) => k);
    this.objs.clear(); this.moves.clear(); this.effects.clear();
    this.fadeState = null; this.fadeLevel = 0;
  }

  /** A click or Enter: the scene ends now (the original's cancel flag DAT_0044a63c). */
  skip(): void { if (this.def && !this.finished) { this.finished = true; this.skipped = true; } }

  update(now: number): VisualFrame {
    if (!this.def) return { backdrop: [], fade: null, done: true };
    if (!this.finished) this.run(now);
    if (this.skipped) return { backdrop: [], fade: null, done: true };
    return { backdrop: this.compose(now), fade: this.fadeAt(now), done: this.finished };
  }

  // ---- command loop ----
  private run(now: number): void {
    const def = this.def!;
    while (!this.finished) {
      const cmds = def.parts[this.part];
      if (!cmds || this.i >= cmds.length) {
        this.part++; this.i = 0; this.partStart = now;
        if (this.part >= def.parts.length) this.finished = true;
        continue;
      }
      if (!this.exec(cmds[this.i]!, now)) return;
      this.i++;
    }
  }

  /** Runs one command; false when it is a wait whose condition is not yet true. */
  private exec(c: Cmd, now: number): boolean {
    switch (c.op) {
      case 'order': this.order = [...c.ids, ...this.order.filter((id) => !c.ids.includes(id))]; return true;
      case 'show': this.objs.set(c.obj, { slot: c.slot, sx: c.sx, sy: c.sy, w: c.w, h: c.h, dx: c.dx, dy: c.dy, clip: this.objs.get(c.obj)?.clip ?? null, visible: true }); this.moves.delete(c.obj); return true;
      case 'hide': { const o = this.objs.get(c.obj); if (o) o.visible = false; return true; }
      case 'clip': { const o = this.objs.get(c.obj); if (o) o.clip = { x: c.x, y: c.y, w: c.w, h: c.h }; return true; }
      case 'move': this.moves.set(c.obj, { from: c.from, to: c.to, start: now, ms: c.ms }); return true;
      case 'waitMove': { const m = this.moves.get(c.obj); return !m || now - m.start >= m.ms; }
      case 'fade': {
        const to = c.dir === 'in' ? 0 : 1, from = c.dir === 'in' ? 1 : this.fadeLevel;
        if (c.steps <= 0) { this.fadeState = null; this.fadeLevel = to; return true; }
        this.fadeState = { from, to, start: now, ms: c.steps * FADE_STEP_MS };
        return true;
      }
      case 'waitFade': return !this.fadeState || now - this.fadeState.start >= this.fadeState.ms;
      case 'wait': return now - this.partStart >= c.ms;
      case 'resetClock': this.partStart = now; return true;
      case 'waitUntil': return now - this.sceneStart >= c.ms;
      case 'tiles': this.effects.set(c.obj, { def: c, start: null }); return true;
      case 'effect': { const e = this.effects.get(c.obj); if (e) e.start = c.on ? now : null; if (!c.on) this.effects.delete(c.obj); return true; }
      case 'waitEffect': { const e = this.effects.get(c.obj); return !e || e.start === null || now - e.start >= e.def.ms; }
      case 'sound': this.onSound?.(c.name); return true;
      case 'end': this.finished = true; return true;
    }
  }

  // ---- picture ----
  private compose(now: number): Backdrop[] {
    const out: Backdrop[] = [];
    for (const id of this.order) {
      const o = this.objs.get(id);
      if (o && o.visible) { const b = this.piece(o, id, now); if (b) out.push(b); }
      const e = this.effects.get(id);
      if (e) out.push(...this.cells(e, now));
    }
    return out;
  }

  private piece(o: Obj, id: number, now: number): Backdrop | null {
    const img = this.images.get(o.slot);
    if (!img) return null;
    let [dx, dy] = [o.dx, o.dy];
    const m = this.moves.get(id);
    if (m) { const t = Math.min(Math.max((now - m.start) / m.ms, 0), 1); dx = m.from[0] + (m.to[0] - m.from[0]) * t; dy = m.from[1] + (m.to[1] - m.from[1]) * t; }
    let sx = o.sx, sy = o.sy, w = Math.min(o.w, img.w - o.sx), h = Math.min(o.h, img.h - o.sy);
    if (o.clip) {                                                              // keep the part of the destination inside the window
      const x0 = Math.max(dx, o.clip.x), y0 = Math.max(dy, o.clip.y), x1 = Math.min(dx + w, o.clip.x + o.clip.w), y1 = Math.min(dy + h, o.clip.y + o.clip.h);
      if (x1 <= x0 || y1 <= y0) return null;
      sx += x0 - dx; sy += y0 - dy; w = x1 - x0; h = y1 - y0; dx = x0; dy = y0;
    }
    if (w <= 0 || h <= 0) return null;
    return { image: img.image, sx, sy, w, h, dx: Math.round(dx), dy: Math.round(dy) };
  }

  private cells(e: Effect, now: number): Backdrop[] {
    const d = e.def;
    const t = e.start === null ? 0 : Math.min(Math.max((now - e.start) / d.ms, 0), 1);
    if (d.kind === 0) {                                                        // one image at a time, in slot order
      const k = Math.min(d.slots.length - 1, Math.floor(t * d.slots.length));
      const img = this.images.get(d.slots[k]!);
      return img ? [{ image: img.image, sx: 0, sy: 0, w: img.w, h: img.h, dx: d.x, dy: d.y }] : [];
    }
    const img = this.images.get(d.slots[0]!);
    if (!img) return [];
    const cols = Math.max(1, Math.ceil(img.w / d.cw)), rows = Math.max(1, Math.ceil(img.h / d.ch)), n = cols * rows;
    const shown = d.kind === 3 ? Math.round(t * n) : n - Math.round(t * n);  // kind 3 reveals, kind 4 hides
    const out: Backdrop[] = [];
    for (let k = 0; k < shown; k++) {
      const cx = (k % cols) * d.cw, cy = Math.floor(k / cols) * d.ch;
      out.push({ image: img.image, sx: cx, sy: cy, w: Math.min(d.cw, img.w - cx), h: Math.min(d.ch, img.h - cy), dx: d.x + cx, dy: d.y + cy });
    }
    return out;
  }

  private fadeAt(now: number): VisualFrame['fade'] {
    const f = this.fadeState;
    if (f) {
      const t = Math.min(Math.max((now - f.start) / f.ms, 0), 1);
      this.fadeLevel = f.from + (f.to - f.from) * t;
      if (t >= 1) this.fadeState = null;
    }
    const alpha = Math.round(this.fadeLevel * 1000) / 1000;
    return alpha > 0 ? { color: 'black', alpha } : null;
  }
}
