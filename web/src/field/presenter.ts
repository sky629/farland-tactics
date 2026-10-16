import { dirTo, stepCell, type Dir } from '../battle/grid';
import type { BattleEvent, BattleState } from '../battle/types';
import type { Unit } from '../battle/unit';
import type { Tables } from '../data/types';
import { TILE_H, TILE_W } from '../iso/grid';
import type { MapModel } from '../map/mapModel';
import type { PlacedSprite, SceneText } from '../render/renderer';
import { AnimPlayer } from '../sprite/animPlayer';
import type { Timeline } from '../sprite/animScript';
import type { ApdModel } from '../sprite/apdModel';
import { overlaySprites } from './overlay';
import { bodyAnim, bodyApd, iconAnim, LAYER, pickTimeline, shadowAnim } from './unitSprites';

export interface SpriteProvider { apd(name: string): ApdModel | null }

export const STEP_MS = 160;
export const POPUP_MS = 400;
export const FALLBACK_MS = 400;
const WAIT_MS = 300;

type Item =
  | { kind: 'move'; slot: number; path: Dir[]; from: [number, number] | null }
  | { kind: 'anim'; slot: number; name: string; ms: number; player: AnimPlayer | null }
  | { kind: 'popup'; slot: number; text: string; digits: boolean }
  | { kind: 'wait'; ms: number }
  | { kind: 'apply'; fn: () => void };
interface Step { items: Item[]; start: number | null }

interface Visual { c: number; r: number; dir: Dir; offset: { x: number; y: number } }

const clone = (u: Unit): Unit => ({ ...u, acc: [...u.acc], buff: { ...u.buff }, elem: [...u.elem], spells: [...u.spells] });
const timelineMs = (t: Timeline) => t.steps.reduce((n, s) => n + s.totalMs, 0);
const step = (...items: Item[]): Step => ({ items, start: null });

/** Turns BattleEvents into a sequential queue of timed steps over a snapshot of the units; builds the renderer Scene.
 *  Steps start exactly when the previous one ends, so timing does not depend on the frame cadence. */
export class Presenter {
  hover: [number, number] | null = null;
  focus: [number, number] | null = null;
  private snapshot: (Unit | null)[] = [];
  private visuals = new Map<number, Visual>();
  private queue: Step[] = [];
  private players = new Map<string, AnimPlayer>();
  private now = 0;

  constructor(private readonly provider: SpriteProvider, private readonly tables: Tables) {}

  get busy(): boolean { return this.queue.length > 0; }

  /** Replace the snapshot with the rules' units (call when a battle starts and whenever the queue drains). */
  sync(state: BattleState): void {
    this.snapshot = state.units.map((u) => (u ? clone(u) : null));
    this.visuals.clear();
    for (const u of this.snapshot) if (u) this.visuals.set(u.slot, { c: u.c, r: u.r, dir: u.dir, offset: { x: 0, y: 0 } });
  }

  enqueue(events: BattleEvent[]): void {
    for (const e of events) this.queue.push(...this.stepsFor(e));
  }

  private stepsFor(e: BattleEvent): Step[] {
    switch (e.type) {
      case 'moved': return [step({ kind: 'move', slot: e.slot, path: e.path, from: null })];
      case 'faced': return [step({ kind: 'apply', fn: () => this.setDir(e.slot, e.dir) })];
      case 'action': {
        const steps: Step[] = [step({ kind: 'apply', fn: () => { const v = this.visuals.get(e.slot); if (v && (v.c !== e.cell[0] || v.r !== e.cell[1])) this.setDir(e.slot, dirTo(v.c, v.r, e.cell[0], e.cell[1])); } })];
        if (e.action === 0) steps.push(step(this.anim(e.slot, 'ATTACK1')));
        else {
          steps.push(step(this.anim(e.slot, 'CAST1A')), step(this.anim(e.slot, 'CAST1B')));
          const effect = this.tables.magic[e.action]?.effect.toLowerCase();
          const fx = effect ? this.provider.apd(effect) : null;
          if (fx && fx.animNames().length > 0) steps.push(step({ kind: 'anim', slot: -1, name: `${effect}:${fx.animNames()[0]!}:${e.cell[0]},${e.cell[1]}`, ms: 0, player: null }));
        }
        for (const h of e.hits) {
          const reaction = h.kind === 'miss' ? 'DEFENSE' : h.kind === 'damage' ? (h.statusAfter === 1 ? 'DOWN_DAMAGE' : h.crit ? 'UP_DAMAGE' : 'MIDDLE_DAMAGE') : null;
          const items: Item[] = [{ kind: 'apply', fn: () => this.applyHit(h.target, h.kind, h.value, h.statusAfter) }];
          if (reaction) items.push(this.anim(h.target, reaction));
          if (h.popup) items.push({ kind: 'popup', slot: h.target, text: h.popup, digits: /^\d+$/.test(h.popup) });
          if (h.crit) items.push({ kind: 'popup', slot: h.target, text: '크리티컬!', digits: false });
          steps.push(step(...items));
        }
        return steps;
      }
      case 'removed': return [step({ kind: 'apply', fn: () => { this.snapshot[e.slot] = null; this.visuals.delete(e.slot); } })];
      case 'exp': return e.gain > 0 ? [step({ kind: 'popup', slot: e.slot, text: `EXP +${e.gain}`, digits: false })] : [];
      case 'levelUp': return [step({ kind: 'popup', slot: e.slot, text: 'LEVEL UP!', digits: false })];
      case 'statusTick': {
        const text = e.status === 2 && !e.cured ? String(e.value) : e.cured ? (e.status === 11 ? 'landing!' : 'well') : '';
        const items: Item[] = [{ kind: 'apply', fn: () => this.applyTick(e.slot, e.status, e.value, e.cured) }];
        if (text) items.push({ kind: 'popup', slot: e.slot, text, digits: /^\d+$/.test(text) });
        return [step(...items)];
      }
      case 'phase': return e.kind === 'enemy' ? [step({ kind: 'wait', ms: WAIT_MS })] : [];
      default: return [];
    }
  }

  private anim(slot: number, token: string): Item { return { kind: 'anim', slot, name: token, ms: 0, player: null }; }

  private setDir(slot: number, dir: Dir): void {
    const v = this.visuals.get(slot), u = this.snapshot[slot];
    if (v) v.dir = dir;
    if (u) u.dir = dir;
  }

  private applyHit(slot: number, kind: string, value: number, statusAfter: number): void {
    const u = this.snapshot[slot];
    if (!u) return;
    if (kind === 'damage') u.hp = Math.max(u.hp - value, 0);
    else if (kind === 'heal') u.hp = Math.min(u.hp + value, u.hpMax);
    u.status = statusAfter;
  }

  private applyTick(slot: number, status: number, value: number, cured: boolean): void {
    const u = this.snapshot[slot];
    if (!u) return;
    if (status === 2) { u.hp = Math.max(u.hp - value, 0); if (u.hp === 0) u.status = 1; }
    else if (cured) u.status = 0;
  }

  /** Advance the queue. A step that ends before `now` finalizes and the next one starts at that exact end time. */
  update(now: number): void {
    this.now = now;
    for (const p of this.players.values()) p.update(now);
    let cursor: number | null = null;
    while (this.queue.length > 0) {
      const s = this.queue[0]!;
      if (s.start === null) { s.start = cursor ?? now; this.begin(s); }
      const end = this.stepEnd(s);
      if (now < end) { this.progress(s, now); return; }
      this.progress(s, end);
      this.finalize(s);
      this.queue.shift();
      cursor = end;
    }
  }

  private begin(s: Step): void {
    for (const item of s.items) {
      if (item.kind === 'apply') item.fn();
      else if (item.kind === 'move') { const v = this.visuals.get(item.slot); item.from = v ? [v.c, v.r] : null; }
      else if (item.kind === 'anim') {
        const tl = this.resolveAnim(item);
        item.ms = tl ? Math.max(timelineMs(tl), 1) : FALLBACK_MS;
        item.player = tl ? new AnimPlayer(tl, { loop: false }) : null;
        if (item.slot >= 0) { const v = this.visuals.get(item.slot); if (v) this.focus = [v.c, v.r]; }
      }
    }
  }

  private stepEnd(s: Step): number {
    const start = s.start ?? this.now;
    let end = start;
    for (const item of s.items) {
      const e = item.kind === 'move' ? start + item.path.length * STEP_MS : item.kind === 'anim' ? start + item.ms
        : item.kind === 'popup' ? start + POPUP_MS : item.kind === 'wait' ? start + item.ms : start;
      end = Math.max(end, e);
    }
    return end;
  }

  /** Interpolated visuals for the moment `now` inside step `s`. */
  private progress(s: Step, now: number): void {
    const start = s.start ?? now;
    for (const item of s.items) {
      if (item.kind === 'anim') item.player?.update(now);
      if (item.kind !== 'move' || !item.from) continue;
      const v = this.visuals.get(item.slot);
      if (!v) continue;
      const elapsed = now - start;
      const done = Math.min(Math.floor(elapsed / STEP_MS), item.path.length);
      let [c, r] = item.from;
      for (let i = 0; i < done; i++) [c, r] = stepCell(c, r, item.path[i]!);
      v.c = c; v.r = r;
      if (done < item.path.length) {
        const d = item.path[done]!;
        const [nc, nr] = stepCell(c, r, d);
        const t = (elapsed - done * STEP_MS) / STEP_MS;
        v.dir = d;
        v.offset = { x: Math.round((nc - c - (nr - r)) * (TILE_W / 2) * t), y: Math.round((nc - c + (nr - r)) * (TILE_H / 2) * t) };
        this.focus = [nc, nr];
      } else {
        v.offset = { x: 0, y: 0 };
        this.focus = [c, r];
      }
    }
  }

  private finalize(s: Step): void {
    for (const item of s.items) {
      if (item.kind !== 'move' || !item.from) continue;
      const v = this.visuals.get(item.slot), u = this.snapshot[item.slot];
      let [c, r] = item.from;
      for (const d of item.path) [c, r] = stepCell(c, r, d);
      const dir = item.path[item.path.length - 1];
      if (v) { v.c = c; v.r = r; v.offset = { x: 0, y: 0 }; if (dir !== undefined) v.dir = dir; }
      if (u) { u.c = c; u.r = r; if (dir !== undefined) u.dir = dir; }
      this.focus = [c, r];
    }
  }

  /** "ATTACK1" → "<F.|B.>ATTACK1" of the unit's body APD (with "#" preference); effects are "<apd>:<anim>:<c>,<r>". */
  private resolveAnim(item: Extract<Item, { kind: 'anim' }>): Timeline | null {
    if (item.slot < 0) {
      const [apdName, anim] = item.name.split(':');
      const model = this.provider.apd(apdName!);
      return model ? pickTimeline(model, anim!) ?? null : null;
    }
    const u = this.snapshot[item.slot], v = this.visuals.get(item.slot);
    if (!u || !v) return null;
    const model = this.provider.apd(bodyApd(u.race));
    if (!model) return null;
    const prefix = v.dir === 0 || v.dir === 1 ? 'F.' : 'B.';
    return pickTimeline(model, prefix + item.name) ?? pickTimeline(model, `${prefix}STAND`) ?? null;
  }

  private player(key: string, tl: Timeline, loop: boolean): AnimPlayer {
    let p = this.players.get(key);
    if (!p) { p = new AnimPlayer(tl, { loop }); p.update(this.now); this.players.set(key, p); }
    return p;
  }

  /** Units (snapshot), overlays (rules' selection), active one-shot anims, effects and popups. */
  scene(map: MapModel, state: BattleState): { sprites: PlacedSprite[]; texts: SceneText[] } {
    const sprites: PlacedSprite[] = [];
    const texts: SceneText[] = [];
    const head = this.queue[0];
    const items = head !== undefined && head.start !== null ? head.items : [];
    const overrides = new Map<number, AnimPlayer>();
    for (const item of items) if (item.kind === 'anim' && item.slot >= 0 && item.player) overrides.set(item.slot, item.player);
    const system = this.provider.apd('system');
    for (const u of this.snapshot) {
      if (!u) continue;
      const v = this.visuals.get(u.slot)!;
      const shown = { ...u, dir: v.dir };
      const body = bodyAnim(shown, this.tables.item);
      const model = this.provider.apd(bodyApd(u.race));
      if (body && model) {
        const tl = pickTimeline(model, body.name);
        const player = overrides.get(u.slot) ?? (tl ? this.player(`${u.slot}:${body.name}`, tl, true) : null);
        if (player) sprites.push({ model, player, c: v.c, r: v.r, layer: u.side === 7 ? LAYER.object : LAYER.unit, offset: v.offset });
        if (system) {
          const race = this.tables.race[u.race];
          const shadow = race ? shadowAnim(shown, race) : null;
          const stl = shadow ? pickTimeline(system, shadow) : undefined;
          if (stl) sprites.push({ model: system, player: this.player(`shadow:${shadow}`, stl, true), c: v.c, r: v.r, layer: LAYER.shadow, offset: v.offset });
          const icon = iconAnim(shown);
          const itl = icon ? pickTimeline(system, icon.name) : undefined;
          if (icon && itl) sprites.push({ model: system, player: this.player(`icon:${icon.name}`, itl, true), c: v.c, r: v.r, layer: LAYER.icon, offset: { x: v.offset.x, y: v.offset.y + icon.dy } });
        }
      }
    }
    if (system && state.phase.kind === 'player') {
      for (const o of overlaySprites(state.phase.sel, state.units, this.hover)) {
        const tl = pickTimeline(system, o.anim);
        if (tl) sprites.push({ model: system, player: this.player(`ov:${o.anim}`, tl, true), c: o.c, r: o.r, layer: o.layer });
      }
    }
    const start = head?.start ?? this.now;
    for (const item of items) {
      if (item.kind === 'anim' && item.slot < 0 && item.player) {
        const [apdName, , cell] = item.name.split(':');
        const model = this.provider.apd(apdName!);
        const [c, r] = cell!.split(',').map(Number) as [number, number];
        if (model) sprites.push({ model, player: item.player, c, r, layer: LAYER.icon });
      }
      if (item.kind === 'popup') this.popup(item, start, map, sprites, texts);
    }
    return { sprites, texts };
  }

  private popup(item: Extract<Item, { kind: 'popup' }>, start: number, map: MapModel, sprites: PlacedSprite[], texts: SceneText[]): void {
    const v = this.visuals.get(item.slot);
    if (!v) return;
    const rise = Math.round(16 * Math.min(Math.max(this.now - start, 0) / POPUP_MS, 1));
    const number = this.provider.apd('number');
    if (item.digits && number) {
      const digits = item.text.split('');
      const widths = digits.map((d) => { const tl = pickTimeline(number, `POP_${d}`); if (!tl) return 0; const b = number.bounds(tl.steps[0]!.frames[0]!); return b.right - b.left; });
      const total = widths.reduce((a, b) => a + b, 0);
      let x = -Math.trunc(total / 2);
      digits.forEach((d, i) => {
        const tl = pickTimeline(number, `POP_${d}`);
        if (tl) sprites.push({ model: number, player: this.player(`pop:${d}`, tl, true), c: v.c, r: v.r, layer: LAYER.icon, offset: { x: v.offset.x + x, y: v.offset.y - 40 - rise } });
        x += widths[i]!;
      });
      return;
    }
    const cell = map.cellAt(v.c, v.r);
    if (cell) texts.push({ x: cell.x + v.offset.x, y: cell.y + v.offset.y - 40 - rise, text: item.text });
  }
}
