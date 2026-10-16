import { FADE_STEP_MS } from '../field/effects';
import { VIEW_H, VIEW_W } from '../iso/grid';
import type { Backdrop } from '../render/renderer';
import type { SpriteProvider } from '../field/presenter';
import { AnimPlayer } from '../sprite/animPlayer';
import type { ApdModel } from '../sprite/apdModel';
import type { AnimCmd, Cmd, Frame, SceneDef, ScreenText, TextLine, VisualImages } from './timeline';

/** An APD animation at a screen point (the opening's characters). */
export interface ScreenSprite { model: ApdModel; player: AnimPlayer; x: number; y: number }
export interface VisualFrame { backdrop: Backdrop[]; sprites: ScreenSprite[]; texts: ScreenText[]; fade: { color: 'black' | 'white'; alpha: number } | null; done: boolean }

interface Obj { slot: number; sx: number; sy: number; w: number; h: number; dx: number; dy: number; base: [number, number]; key: number | null; clip: { x: number; y: number; w: number; h: number } | null; visible: boolean; alpha: { from: number; to: number; start: number; ms: number } | null }
const COLOR_KEY = 249;                                                        // FUN_00401880: objects 1..9; object 0 is opaque
interface Move { from: [number, number] | null; by: [number, number]; start: number; ms: number; at: { pos: [number, number]; src: [number, number] } }
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
  private partIndex = 0;
  private i = 0;
  private list: Cmd[] = [];
  private deadline: { ms: number; outro: Cmd[] } | null = null;
  private inOutro = false;
  private sceneStart = 0;
  private partStart = 0;
  private finished = false;
  private wasSkipped = false;
  private order: number[] = [];
  private readonly objs = new Map<number, Obj>();
  private readonly moves = new Map<number, Move>();
  private readonly effects = new Map<number, Effect>();
  private fadeState: Fade | null = null;
  private fadeLevel = 0;                                                       // 0 clear … 1 covered when no fade runs
  private fadeColor: 'black' | 'white' = 'black';
  private lines: TextLine[] = [];
  private roll: { start: number; ms: number } | null = null;
  private provider: SpriteProvider | null = null;
  private readonly sprites = new Map<number, { apd: string; anim: string; x: number; y: number; times: number; model: ApdModel | null; player: AnimPlayer | null; played: number }>();

  get playing(): boolean { return this.def !== null && !this.finished; }
  /** Index of the part being played (tests, debugging). */
  get part(): number { return this.partIndex; }
  /** true when the scene ended by skip() rather than by itself. */
  get skipped(): boolean { return this.wasSkipped; }

  start(def: SceneDef, part: number, images: VisualImages, now: number, lines: TextLine[] = [], sprites: SpriteProvider | null = null): void {
    this.def = def; this.images = images; this.lines = lines; this.roll = null; this.provider = sprites;
    this.sceneStart = now;
    this.finished = part >= def.parts.length; this.wasSkipped = false;
    this.fadeState = null; this.fadeLevel = 0; this.fadeColor = 'black';
    this.beginPart(part, now);
  }

  /** Every part's setup starts with FUN_00402190 + FUN_00401880: part clock, objects, effects and moves start over. */
  private beginPart(part: number, now: number): void {
    this.partIndex = part; this.i = 0; this.partStart = now;
    this.list = this.def?.parts[part] ?? []; this.deadline = null; this.inOutro = false;
    this.order = Array.from({ length: OBJECTS }, (_, k) => k);
    this.objs.clear(); this.moves.clear(); this.effects.clear(); this.sprites.clear();
  }

  /** A click or Enter: the scene ends now (the original's cancel flag DAT_0044a63c). */
  skip(): void { if (this.def && !this.finished) { this.finished = true; this.wasSkipped = true; } }

  update(now: number): VisualFrame {
    if (!this.def) return { backdrop: [], sprites: [], texts: [], fade: null, done: true };
    if (!this.finished) this.run(now);
    if (this.wasSkipped) return { backdrop: [], sprites: [], texts: [], fade: null, done: true };
    return { backdrop: this.compose(now), sprites: this.spriteFrames(now), texts: this.rollTexts(now), fade: this.fadeAt(now), done: this.finished };
  }

  // ---- command loop ----
  private run(now: number): void {
    const def = this.def!;
    while (!this.finished) {
      if (this.deadline && !this.inOutro && now - this.sceneStart >= this.deadline.ms) { this.inOutro = true; this.list = this.deadline.outro; this.i = 0; }
      if (this.i >= this.list.length) {
        if (this.deadline && !this.inOutro) return;                            // the original idles in its last sub-step until FUN_00402050 fires
        if (this.partIndex + 1 >= def.parts.length) { this.finished = true; break; }
        this.beginPart(this.partIndex + 1, now);
        continue;
      }
      if (!this.exec(this.list[this.i]!, now)) return;
      this.i++;
    }
  }

  /** Runs one command; false when it is a wait whose condition is not yet true. */
  private exec(c: Cmd, now: number): boolean {
    switch (c.op) {
      case 'order': this.order = [...c.ids]; return true;
      case 'show': this.showOn(c.obj, c, c.dx, c.dy); this.moves.delete(c.obj); this.obj(c.obj).alpha = null; return true;   // a new picture starts opaque; a dissolve follows explicitly
      case 'hide': { const o = this.objs.get(c.obj); if (o) o.visible = false; return true; }
      case 'pos': this.obj(c.obj).base = [c.x, c.y]; return true;
      case 'key': this.obj(c.obj).key = c.key; return true;
      case 'clip': { const o = this.objs.get(c.obj); if (o) o.clip = { x: c.x, y: c.y, w: c.w, h: c.h }; return true; }
      case 'move': { const o = this.obj(c.obj); this.settleMove(c.obj, now); this.moves.set(c.obj, { from: c.from ?? null, by: c.by, start: now, ms: c.ms, at: { pos: [o.dx, o.dy], src: [o.sx, o.sy] } }); return true; }
      case 'waitMove': { const m = this.moves.get(c.obj); return !m || now - m.start >= m.ms; }
      case 'alpha': this.obj(c.obj).alpha = { from: c.from, to: c.to, start: now, ms: c.ms }; return true;
      case 'waitAlpha': { const a = this.objs.get(c.obj)?.alpha; return !a || now - a.start >= a.ms; }
      case 'fade': {
        this.fadeColor = c.color ?? 'black';
        const to = c.dir === 'in' ? 0 : 1, from = c.dir === 'in' ? 1 : this.fadeLevel;
        if (c.steps <= 0) { this.fadeState = null; this.fadeLevel = to; return true; }
        this.fadeState = { from, to, start: now, ms: c.steps * FADE_STEP_MS };
        return true;
      }
      case 'waitFade': return !this.fadeState || now - this.fadeState.start >= this.fadeState.ms;
      case 'wait': return now - this.partStart >= c.ms;
      case 'resetClock': this.partStart = now; return true;
      case 'deadline': this.deadline = { ms: c.ms, outro: c.outro }; return true;
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
      case 'sprite': this.sprites.set(c.id, { apd: c.apd, anim: c.anim, x: c.x, y: c.y, times: Math.max(c.times, 1), model: null, player: null, played: 0 }); return true;
      case 'textRoll': this.roll = { start: now, ms: Math.max(c.ms, 1) }; return true;
      case 'waitText': return !this.roll || now - this.roll.start >= this.roll.ms;
      case 'end': this.finished = true; return true;
    }
  }

  private obj(id: number): Obj {
    let o = this.objs.get(id);
    if (!o) { o = { slot: -1, sx: 0, sy: 0, w: 0, h: 0, dx: 0, dy: 0, base: [0, 0], key: id === 0 ? null : COLOR_KEY, clip: null, visible: false, alpha: null }; this.objs.set(id, o); }
    return o;
  }
  private showOn(id: number, f: Frame | { slot: number; sx: number; sy: number; w: number; h: number }, dx: number, dy: number): void {
    const o = this.obj(id);
    o.slot = f.slot; o.sx = f.sx; o.sy = f.sy; o.w = f.w; o.h = f.h; o.dx = dx; o.dy = dy; o.visible = true;
  }
  /** Where a move has brought the object by `now`: position or source window (see piece). */
  private moved(id: number, o: Obj, m: Move, now: number): { pos: [number, number]; src: [number, number] } {
    const t = Math.min(Math.max((now - m.start) / m.ms, 0), 1);
    const img = this.images.get(o.slot, o.key);
    const pansSource = img !== null && (img.w > VIEW_W || img.h > VIEW_H);      // a memory bitmap: the window over it moves [관찰 p4/p17]
    const from = m.from ?? (pansSource ? m.at.src : m.at.pos);
    const x = from[0] + m.by[0] * t, y = from[1] + m.by[1] * t;
    return pansSource ? { pos: [o.dx, o.dy], src: [x, y] } : { pos: [x, y], src: [o.sx, o.sy] };
  }
  /** A finished or replaced move leaves the object where it brought it. */
  private settleMove(id: number, now: number): void {
    const m = this.moves.get(id), o = this.objs.get(id);
    if (!m || !o) return;
    const r = this.moved(id, o, m, now);
    [o.dx, o.dy] = r.pos; [o.sx, o.sy] = r.src;
    this.moves.delete(id);
  }

  /** The frame an effect shows at `now` goes onto its object (FUN_0041d640). */
  private applyFrame(e: Effect, now: number): void {
    const d = e.def;
    let t = now - e.start!;
    if (d.loop && e.total > 0) t %= e.total;
    let i = 0;
    while (i < d.frames.length - 1 && t >= d.frames[i]!.ms) { t -= d.frames[i]!.ms; i++; }
    const f = d.frames[i];
    if (f) this.showOn(d.obj, f, f.x ?? d.x, f.y ?? d.y);
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
    const img = this.images.get(o.slot, o.key);
    if (!img) return null;
    let [dx, dy] = [o.dx, o.dy], [sx, sy] = [o.sx, o.sy];
    const m = this.moves.get(id);
    if (m) { const r = this.moved(id, o, m, now); [dx, dy] = r.pos; [sx, sy] = r.src; }
    dx += o.base[0]; dy += o.base[1];
    let w = o.w, h = o.h;
    if (sx < 0) { dx -= sx; w += sx; sx = 0; }                                   // the window past the image's edge leaves a gap
    if (sy < 0) { dy -= sy; h += sy; sy = 0; }
    w = Math.min(w, img.w - sx); h = Math.min(h, img.h - sy);
    if (o.clip) {                                                              // keep the part of the destination inside the window
      const x0 = Math.max(dx, o.clip.x), y0 = Math.max(dy, o.clip.y), x1 = Math.min(dx + w, o.clip.x + o.clip.w), y1 = Math.min(dy + h, o.clip.y + o.clip.h);
      if (x1 <= x0 || y1 <= y0) return null;
      sx += x0 - dx; sy += y0 - dy; w = x1 - x0; h = y1 - y0; dx = x0; dy = y0;
    }
    if (w <= 0 || h <= 0) return null;
    const alpha = this.alphaOf(o, now);
    if (alpha <= 0) return null;
    const piece: Backdrop = { image: img.image, sx, sy, w, h, dx: Math.round(dx), dy: Math.round(dy) };
    if (alpha < 1) piece.alpha = alpha;
    return piece;
  }

  /** Screen sprites: the APD arrives whenever the provider has it; the anim then starts from its first frame and repeats `times`. */
  private spriteFrames(now: number): ScreenSprite[] {
    const out: ScreenSprite[] = [];
    for (const s of this.sprites.values()) {
      if (!s.model) {
        s.model = this.provider?.apd(s.apd) ?? null;
        const tl = s.model?.anim(s.anim);
        if (!s.model || !tl) { s.model = null; continue; }
        s.player = new AnimPlayer(tl);
      }
      const player = s.player!;
      player.update(now);
      if (player.finished && s.played + 1 < s.times) { s.played++; s.player = new AnimPlayer(s.model.anim(s.anim)!); s.player.update(now); }
      out.push({ model: s.model, player: s.player!, x: s.x, y: s.y });
    }
    return out;
  }

  /** The staff roll: the whole list climbs from y = screen bottom to −height over the roll's time; only lines on screen are emitted. */
  private rollTexts(now: number): ScreenText[] {
    const r = this.roll;
    if (!r || this.lines.length === 0) return [];
    const height = this.lines.reduce((s, l) => s + ('space' in l ? l.space : l.size + l.gap), 0);
    const t = Math.min(Math.max((now - r.start) / r.ms, 0), 1);
    let y = VIEW_H - (VIEW_H + height) * t;
    const out: ScreenText[] = [];
    for (const l of this.lines) {
      if ('space' in l) { y += l.space; continue; }
      if (y + l.size > 0 && y < VIEW_H) out.push({ text: l.text, x: VIEW_W / 2, y: Math.round(y), size: l.size, font: l.font, bold: l.bold });
      y += l.size + l.gap;
    }
    return out;
  }

  private alphaOf(o: Obj, now: number): number {
    const a = o.alpha;
    if (!a) return 1;
    const t = a.ms <= 0 ? 1 : Math.min(Math.max((now - a.start) / a.ms, 0), 1);
    return Math.round((a.from + (a.to - a.from) * t) * 1000) / 1000;
  }

  private fadeAt(now: number): VisualFrame['fade'] {
    const f = this.fadeState;
    if (f) {
      const t = Math.min(Math.max((now - f.start) / f.ms, 0), 1);
      this.fadeLevel = f.from + (f.to - f.from) * t;
      if (t >= 1) this.fadeState = null;
    }
    const alpha = Math.round(this.fadeLevel * 1000) / 1000;
    return alpha > 0 ? { color: this.fadeColor, alpha } : null;
  }
}
