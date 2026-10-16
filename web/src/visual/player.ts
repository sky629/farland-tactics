import { FADE_STEP_MS } from '../field/effects';
import type { Backdrop } from '../render/renderer';
import type { AnimCmd, Cmd, Frame, SceneDef, VisualImages } from './timeline';

export interface VisualFrame { backdrop: Backdrop[]; fade: { color: 'black'; alpha: number } | null; done: boolean }

interface Obj { slot: number; sx: number; sy: number; w: number; h: number; dx: number; dy: number; base: [number, number]; clip: { x: number; y: number; w: number; h: number } | null; visible: boolean }
interface Move { from: [number, number]; to: [number, number]; start: number; ms: number }
interface Effect { def: AnimCmd; start: number | null; total: number }
type Fade = { from: number; to: number; start: number; ms: number };

const OBJECTS = 10;

/**
 * Plays a SceneDef: commands run in order, `wait*` commands hold until their condition is true, parts follow each other,
 * `end` (or running out of commands) finishes the scene. Two clocks as in the original: the part clock (reset at each
 * part start and by `resetClock`) for `wait`, the scene clock for `waitUntil`. An effect is a frame animation on an
 * object (FUN_0041d6e0 steps the frame when its ms have passed, FUN_0041d640 shows it on the object): once, or looping
 * until `effect off`; the object keeps the last frame shown.
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
      case 'order': this.order = [...c.ids]; return true;
      case 'show': this.showOn(c.obj, c, c.dx, c.dy); this.moves.delete(c.obj); return true;
      case 'hide': { const o = this.objs.get(c.obj); if (o) o.visible = false; return true; }
      case 'pos': this.obj(c.obj).base = [c.x, c.y]; return true;
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
      case 'anim': this.effects.set(c.fx, { def: c, start: null, total: c.frames.reduce((s, f) => s + f.ms, 0) }); return true;
      case 'effect': {
        const e = this.effects.get(c.fx);
        if (!e) return true;
        if (c.on) { e.start = now; this.applyFrame(e, now); }
        else { if (e.start !== null) this.applyFrame(e, now); this.effects.delete(c.fx); }
        return true;
      }
      case 'waitEffect': { const e = this.effects.get(c.fx); return !e || e.start === null || (!e.def.loop && now - e.start >= e.total); }
      case 'sound': this.onSound?.(c.name); return true;
      case 'end': this.finished = true; return true;
    }
  }

  private obj(id: number): Obj {
    let o = this.objs.get(id);
    if (!o) { o = { slot: -1, sx: 0, sy: 0, w: 0, h: 0, dx: 0, dy: 0, base: [0, 0], clip: null, visible: false }; this.objs.set(id, o); }
    return o;
  }
  private showOn(id: number, f: Frame | { slot: number; sx: number; sy: number; w: number; h: number }, dx: number, dy: number): void {
    const o = this.obj(id);
    o.slot = f.slot; o.sx = f.sx; o.sy = f.sy; o.w = f.w; o.h = f.h; o.dx = dx; o.dy = dy; o.visible = true;
  }
  /** The frame an effect shows at `now` goes onto its object (FUN_0041d640). */
  private applyFrame(e: Effect, now: number): void {
    const d = e.def;
    let t = now - e.start!;
    if (d.loop && e.total > 0) t %= e.total;
    let i = 0;
    while (i < d.frames.length - 1 && t >= d.frames[i]!.ms) { t -= d.frames[i]!.ms; i++; }
    const f = d.frames[i];
    if (f) this.showOn(d.obj, f, d.x, d.y);
  }

  // ---- picture ----
  private compose(now: number): Backdrop[] {
    for (const [fx, e] of this.effects) {
      if (e.start === null) continue;
      this.applyFrame(e, now);
      if (!e.def.loop && now - e.start >= e.total) this.effects.delete(fx);   // over: the object keeps the last frame
    }
    const out: Backdrop[] = [];
    for (const id of this.order) {
      const o = this.objs.get(id);
      if (o && o.visible) { const b = this.piece(o, id, now); if (b) out.push(b); }
    }
    return out;
  }

  private piece(o: Obj, id: number, now: number): Backdrop | null {
    const img = this.images.get(o.slot);
    if (!img) return null;
    let [dx, dy] = [o.dx, o.dy];
    const m = this.moves.get(id);
    if (m) { const t = Math.min(Math.max((now - m.start) / m.ms, 0), 1); dx = m.from[0] + (m.to[0] - m.from[0]) * t; dy = m.from[1] + (m.to[1] - m.from[1]) * t; }
    dx += o.base[0]; dy += o.base[1];
    let sx = o.sx, sy = o.sy, w = Math.min(o.w, img.w - o.sx), h = Math.min(o.h, img.h - o.sy);
    if (o.clip) {                                                              // keep the part of the destination inside the window
      const x0 = Math.max(dx, o.clip.x), y0 = Math.max(dy, o.clip.y), x1 = Math.min(dx + w, o.clip.x + o.clip.w), y1 = Math.min(dy + h, o.clip.y + o.clip.h);
      if (x1 <= x0 || y1 <= y0) return null;
      sx += x0 - dx; sy += y0 - dy; w = x1 - x0; h = y1 - y0; dx = x0; dy = y0;
    }
    if (w <= 0 || h <= 0) return null;
    return { image: img.image, sx, sy, w, h, dx: Math.round(dx), dy: Math.round(dy) };
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
