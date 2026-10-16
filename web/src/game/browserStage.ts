import type { AssetLoader } from '../assets/loader';
import { BitmapCache } from '../assets/bitmaps';
import { AudioGate } from '../audio/gate';
import { MusicPlayer } from '../audio/music';
import { SoundPlayer } from '../audio/sound';
import { SpessaSynth } from '../audio/spessa';
import { WebAudioOut } from '../audio/webAudio';
import type { MapData } from '../assets/types';
import type { Selection } from '../battle/types';
import type { Unit } from '../battle/unit';
import type { Tables } from '../data/types';
import { Effects } from '../field/effects';
import { Presenter } from '../field/presenter';
import { VIEW_H, VIEW_W } from '../iso/grid';
import { MapModel } from '../map/mapModel';
import type { Backdrop, Renderer } from '../render/renderer';
import type { ModalKind, Where } from '../script/host';
import { IndexedBitmaps } from '../gfx/indexed';
import { HOTSPOTS, hitTest, layerFrame, townLayerKey, townLayers } from '../town/town';
import type { Dialogue, ModalContext } from '../ui/dialogue';
import { clampCamera } from '../viewer/scale';
import type { Stage } from './gameCore';
import type { VisualRecord } from '../data/types';
import { VisualPlayer } from '../visual/player';
import type { SceneDef, VisualImage } from '../visual/timeline';
import type { VisualFrame } from '../visual/player';
import type { SpriteCache } from './spriteCache';

type Phase = { kind: 'player'; sel: Selection } | { kind: 'enemy'; queue: number[] } | { kind: 'end'; result: 'victory' | 'defeat' };
const OVERLAY_OFF = { grid: false, height: false, land: false, blocked: false };
const nn = (n: number): string => String(n).padStart(2, '0');

/** What the page tells the stage each frame: who owns a canvas click (battle cells or the story's WAIT_CLICK) and what the modals may touch. */
export interface StageHooks {
  onCell(cell: [number, number]): void;        // battle mode: a map cell was clicked
  onTownClick(i: number): void;                // town mode: facility i was clicked
  onTownMenu(): void;                          // town mode: right click → party menu (spec §9)
  onCancel(): void;                            // right click / Escape
  modalContext(): ModalContext;
  writeSave(slot: number, bytes: Uint8Array): void;
  log(kind: 'warn' | 'info', text: string): void;
}

/**
 * The real Stage: canvas + renderer for the field and the town picture, the Dialogue overlay for text and modals,
 * asset loading for maps and bitmaps. Mode-specific routing of clicks is decided by the page through `cellMode`.
 */
/** The audio side exists only after the first user gesture (browser autoplay policy). */
interface Audio { out: WebAudioOut; synth: SpessaSynth }

export class BrowserStage implements Stage {
  readonly presenter: Presenter;
  readonly effects = new Effects();
  camera = { x: 0, y: 0 };
  private audio: Audio | null = null;
  private readonly gate = new AudioGate();
  private lastNow = 0;
  /** true while the battle owns clicks (cells); false while a script may be waiting for a click. */
  cellMode = false;
  seeThrough = false;
  private mapModel: MapModel | null = null;
  private loading: string | null = null;
  private town: { set: 1 | 2 | 3; extra: boolean; flags: number[]; hover: number | null; showAll: boolean } | null = null;
  /** Town sheets as keyed bitmaps (layer 0 opaque, 1..4 color-keyed); null while loading or missing. */
  private readonly sheets = new Map<string, { bmp: IndexedBitmaps; key: number | null } | null>();
  private drag: { x: number; y: number; cx: number; cy: number } | null = null;
  /** Visual scenes: the player, the slot → bitmap names per scene, and keyed images per (name, key). */
  private readonly player = new VisualPlayer();
  private readonly visualNames = new Map<number, Map<number, string>>();
  private readonly visualImages = new Map<string, VisualImage | null>();
  private visualScene = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly renderer: Renderer, private readonly assets: AssetLoader,
    private readonly bitmaps: BitmapCache, private readonly dialogue: Dialogue, sprites: SpriteCache, tables: Tables, private readonly hooks: StageHooks,
    private readonly audioAssets: { wave: Set<string>; midi: Set<number> } = { wave: new Set(), midi: new Set() }, visualList: VisualRecord[] = []) {
    this.presenter = new Presenter(sprites, tables);
    for (const r of visualList) { if (!this.visualNames.has(r.scene)) this.visualNames.set(r.scene, new Map()); this.visualNames.get(r.scene)!.set(r.slot, r.name); }
    this.player.onSound = (name) => this.playSound(name);
    this.bind();
  }

  // ---- drawing ----
  /** One frame: town layers, or the field with the presenter's sprites; the script effects on top. */
  draw(now: number, units: (Unit | null)[], phase: Phase): void {
    this.lastNow = now;
    this.gate.update(now);
    const fx = this.effects.snapshot(now);
    if (this.player.playing) {                                                 // the scene owns the screen; the script's fade state waits underneath
      const f = this.player.update(now);
      this.renderer.draw({ map: null, sprites: [], camera: { x: 0, y: 0 }, overlay: OVERLAY_OFF, seeThrough: false, fx: { fade: f.fade, tint: null, image: null, shake: null }, backdrop: f.backdrop });
      if (f.done) this.endVisual(f, now);
      return;
    }
    if (this.town) { this.renderer.draw({ map: null, sprites: [], camera: { x: 0, y: 0 }, overlay: OVERLAY_OFF, seeThrough: false, fx, backdrop: this.townBackdrop(now) }); return; }
    if (!this.mapModel) { this.renderer.draw({ map: null, sprites: [], camera: this.camera, overlay: OVERLAY_OFF, seeThrough: false, fx }); return; }
    const { sprites, texts } = this.presenter.scene(this.mapModel, { units, phase });
    const camera = fx.shake ? this.clampTo(this.camera.x + fx.shake.x, this.camera.y + fx.shake.y) : this.camera;   // shake never touches the logical camera
    this.renderer.draw({ map: this.mapModel, sprites, camera, overlay: OVERLAY_OFF, seeThrough: this.seeThrough, texts, fx });
  }

  private sheet(name: string, layer: number): CanvasImageSource | null {
    if (!this.sheets.has(name)) {
      this.sheets.set(name, null);
      void (async () => {
        try {
          const img = await this.assets.image('bmp', name);
          const key = townLayerKey(img, layer);
          const bmp = new IndexedBitmaps(img);
          await bmp.prepare(key);
          this.sheets.set(name, { bmp, key });
        } catch (e) { this.hooks.log('warn', `${name}: ${e instanceof Error ? e.message : String(e)}`); }
      })();
    }
    const s = this.sheets.get(name);
    return s ? s.bmp.get(s.key) : null;
  }

  private townBackdrop(now: number): Backdrop[] {
    const t = this.town!;
    const out: Backdrop[] = [];
    townLayers(t.set, t.extra).forEach((name, i) => {
      const image = this.sheet(name, i);
      if (!image) return;
      if (i === 0) out.push({ image, sx: 0, sy: 0, w: VIEW_W, h: VIEW_H, dx: 0, dy: 0 });
      else if (i === 3) {
        HOTSPOTS.forEach((h, k) => {
          if ((t.flags[k] ?? 0) === 0 || !(t.showAll || t.hover === k)) return;
          const [l, tp, r, b] = h.highlight;
          out.push({ image, sx: l, sy: tp, w: r - l, h: b - tp, dx: l, dy: tp });
        });
      } else out.push({ image, ...layerFrame(i as 1 | 2 | 4, now) });
    });
    return out;
  }

  // ---- input ----
  private canvasPoint(ev: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: ((ev.clientX - rect.left) / rect.width) * VIEW_W, y: ((ev.clientY - rect.top) / rect.height) * VIEW_H };
  }
  private cellAt(p: { x: number; y: number }): [number, number] | null {
    const cell = this.mapModel?.pick(p.x + this.camera.x, p.y + this.camera.y) ?? null;
    return cell ? [cell.c, cell.r] : null;
  }
  private clampTo(x: number, y: number): { x: number; y: number } {
    const size = this.pixelSize();
    return size ? clampCamera(x, y, size[0], size[1]) : { x, y };
  }

  private bind(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this.town) this.hooks.onTownMenu(); else this.hooks.onCancel(); });
    c.addEventListener('mousedown', (e) => { if (e.button === 0 && !this.town) this.drag = { x: e.clientX, y: e.clientY, cx: this.camera.x, cy: this.camera.y }; });
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      const drag = this.drag; this.drag = null;
      if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) return;
      if (e.target !== c) return;
      if (this.player.playing) { this.player.skip(); return; }
      const p = this.canvasPoint(e);
      if (this.town) {
        const i = hitTest(p.x, p.y, this.town.flags);
        if (i === null) this.town.showAll = !this.town.showAll;             // empty spot: toggle every highlight (0x9c63)
        else this.hooks.onTownClick(i);
        return;
      }
      if (this.cellMode) { const cell = this.cellAt(p); if (cell) this.hooks.onCell(cell); }
      else this.dialogue.noteClick();
    });
    c.addEventListener('mousemove', (e) => {
      const p = this.canvasPoint(e);
      if (this.town) { this.town.hover = hitTest(p.x, p.y, this.town.flags); c.style.cursor = this.town.hover === null ? 'default' : 'pointer'; return; }
      c.style.cursor = 'default';
      if (this.drag) {
        const k = c.getBoundingClientRect().width / VIEW_W;
        this.camera = this.clampTo(this.drag.cx - (e.clientX - this.drag.x) / k, this.drag.cy - (e.clientY - this.drag.y) / k);
        return;
      }
      this.presenter.hover = this.cellMode ? this.cellAt(p) : null;
    });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Shift') this.seeThrough = true;
      if (e.key === 'Escape') this.hooks.onCancel();
      if (e.key === 'Enter' && this.player.playing) { this.player.skip(); return; }
      if (e.key === 'Enter' && !this.cellMode && !this.town) this.dialogue.noteClick();
      const step = e.shiftKey ? 64 : 16;
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const m = d[e.key];
      if (m && this.mapModel && !this.town) { this.camera = this.clampTo(this.camera.x + m[0], this.camera.y + m[1]); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') this.seeThrough = false; });
    window.addEventListener('blur', () => { this.seeThrough = false; });
  }

  // ---- Stage: map ----
  loadMap(n: number): void {
    const name = `stage${nn(n)}`;
    this.mapModel = null; this.loading = name;
    void (async () => {
      try {
        const map = await this.assets.map(name);
        const layers = await Promise.all(map.layers.map((l) => this.assets.image('map', l)));
        const bg = map.bg ? await this.assets.image('map', map.bg).catch((e: unknown) => { this.hooks.log('warn', String(e)); return null; }) : null;
        const model = new MapModel(map, layers, bg);
        await this.renderer.prepareMap(model);
        if (this.loading === name) { this.mapModel = model; this.loading = null; }
      } catch (e) {
        if (this.loading === name) this.loading = null;                        // mapReady() turns true with no map: the core reports it
        this.hooks.log('warn', `${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }
  mapReady(): boolean { return this.loading === null; }
  mapData(): MapData | null { return this.mapModel?.data ?? null; }
  cellOf(c: number, r: number): { x: number; y: number } | null { const p = this.mapModel?.cellAt(c, r); return p ? { x: p.x, y: p.y } : null; }
  pixelSize(): [number, number] | null { return this.mapModel ? [this.mapModel.data.pixelSize[0], this.mapModel.data.pixelSize[1]] : null; }

  // ---- Stage: dialogue ----
  openWindow(where: Where, speaker: number, face: string | null): void { this.dialogue.openWindow(where, speaker, face); }
  closeWindow(where: Where): void { this.dialogue.closeWindow(where); }
  text(where: Where, line: string, name: string | null): void { this.dialogue.text(where, line, name); }
  openModal(kind: ModalKind, payload: unknown): void { this.dialogue.openModal(kind, payload, this.hooks.modalContext()); }
  takeModalResult(): number | null { return this.dialogue.takeModalResult(); }
  closeAll(): void { this.dialogue.closeAll(); }
  showEpisode(title: string): void { this.dialogue.showEpisode(title); }
  takeClick(): boolean { return this.dialogue.takeClick(); }

  // ---- Stage: sound ----
  /**
   * First user gesture, synchronously: the AudioContext, the effects bus and the sound player exist before this returns, so
   * the sounds of the very next frame play; the MIDI synthesizer loads its soundfont in the background and the gate holds the
   * music until then (AudioGate).
   */
  unlockAudio(): void {
    if (this.audio) return;
    const log = (k: 'warn' | 'info', t: string) => this.hooks.log(k, t);
    let ctx: AudioContext;
    try { ctx = new AudioContext(); } catch (e) { log('warn', `소리를 켤 수 없다: ${e instanceof Error ? e.message : String(e)}`); this.gate.synthSettled(); return; }
    const out = new WebAudioOut(ctx), synth = new SpessaSynth(ctx, 'assets', log);
    this.audio = { out, synth };
    this.gate.unlock({ sounds: new SoundPlayer(out, this.audioAssets.wave, log), music: new MusicPlayer(synth, log) });
    void ctx.resume();
    void synth.init(this.audioAssets.midi).finally(() => this.gate.synthSettled());
  }
  /** The browser tab came back: resume a suspended context. */
  resumeAudio(): void { void this.audio?.out.ctx.resume(); }
  setVolumes(music: number, sound: number): void { this.gate.setVolumes(music, sound); }
  get musicReady(): boolean { return this.audio?.synth.ready ?? false; }
  /** true once the synthesizer init settled (so the page can show the soundfont notice exactly once). */
  get audioTried(): boolean { return this.gate.settled; }
  get currentMusic(): number { return this.gate.current; }
  playSound(name: string): void { this.gate.playSound(name); }
  playMusic(n: number): void { this.gate.playMusic(n); }
  stopMusic(): void { this.gate.stopMusic(); }
  fadeMusic(ms: number, on: boolean): void { this.gate.fadeMusic(ms, on, this.lastNow); }
  musicFadeBusy(): boolean { return this.gate.fadeBusy(); }

  // ---- Stage: visual scenes ----
  startVisual(def: SceneDef, part: number): void {
    if (!this.visualNames.has(def.id)) { this.hooks.log('warn', `비주얼 씬 ${def.id}: 장면 목록(visual.json)에 그림이 없다 — 변환기를 다시 돌린다`); return; }   // without it the scene would be minutes of black
    this.visualScene = def.id;
    this.visualImages.clear();                                                 // the original frees each part's images (FUN_00401000)
    this.player.start(def, part, { get: (slot, key) => this.visualImage(slot, key) }, this.lastNow);
  }
  /**
   * The scene is over: its last picture stays as the script's SHOW_IMAGE picture until HIDE_IMAGE (every PLAY_VISUAL is
   * followed by one), and the script's fade matches the scene's end — black after a fade-out or a skip, clear otherwise.
   */
  private endVisual(f: VisualFrame, now: number): void {
    const black = this.player.skipped || (f.fade?.alpha ?? 0) >= 1;
    if (!black && f.backdrop.length > 0) {
      const snap = document.createElement('canvas'); snap.width = VIEW_W; snap.height = VIEW_H;
      const g = snap.getContext('2d')!;
      for (const b of f.backdrop) g.drawImage(b.image, b.sx, b.sy, b.w, b.h, b.dx, b.dy, b.w, b.h);
      this.effects.showImage(snap, 0, now);                                   // also ends the fade the script left before the scene
    } else {
      this.effects.hideImage();
      this.effects.fade('out', 0, now);
    }
  }
  visualDone(): boolean { return !this.player.playing; }
  get visualPlaying(): boolean { return this.player.playing; }
  /** Slot image of the current scene with the object's color key; null while it loads or when the list has no such slot. */
  private visualImage(slot: number, key: number | null): VisualImage | null {
    const name = this.visualNames.get(this.visualScene)?.get(slot);
    if (!name) return null;
    const id = `${name}/${key ?? 'opaque'}`;
    if (!this.visualImages.has(id)) {
      this.visualImages.set(id, null);
      void (async () => {
        try {
          const img = await this.assets.image('bmp', name);
          const bmp = new IndexedBitmaps(img);
          await bmp.prepare(key);
          this.visualImages.set(id, { image: bmp.get(key), w: img.width, h: img.height });
        } catch (e) { this.hooks.log('warn', `${name}: ${e instanceof Error ? e.message : String(e)}`); }
      })();
    }
    return this.visualImages.get(id) ?? null;
  }

  // ---- Stage: pictures and town ----
  bitmap(name: string): CanvasImageSource | null { return this.bitmaps.get(name); }
  showTown(set: 1 | 2 | 3, extra: boolean, flags: number[]): void {
    this.town = { set, extra, flags, hover: null, showAll: false };
    townLayers(set, extra).forEach((name, i) => this.sheet(name, i));          // start loading
  }
  hideTown(): void { this.town = null; this.canvas.style.cursor = 'default'; }
  writeSave(slot: number, bytes: Uint8Array): void { this.hooks.writeSave(slot, bytes); }
  log(kind: 'warn' | 'info', text: string): void { this.hooks.log(kind, text); }
}
