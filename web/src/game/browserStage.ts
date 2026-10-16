import type { AssetLoader } from '../assets/loader';
import { BitmapCache } from '../assets/bitmaps';
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
  log(kind: 'warn' | 'info', text: string): void;
}

/**
 * The real Stage: canvas + renderer for the field and the town picture, the Dialogue overlay for text and modals,
 * asset loading for maps and bitmaps. Mode-specific routing of clicks is decided by the page through `cellMode`.
 */
export class BrowserStage implements Stage {
  readonly presenter: Presenter;
  readonly effects = new Effects();
  camera = { x: 0, y: 0 };
  /** true while the battle owns clicks (cells); false while a script may be waiting for a click. */
  cellMode = false;
  seeThrough = false;
  private mapModel: MapModel | null = null;
  private loading: string | null = null;
  private town: { set: 1 | 2 | 3; extra: boolean; flags: number[]; hover: number | null; showAll: boolean } | null = null;
  /** Town sheets as keyed bitmaps (layer 0 opaque, 1..4 color-keyed); null while loading or missing. */
  private readonly sheets = new Map<string, { bmp: IndexedBitmaps; key: number | null } | null>();
  private drag: { x: number; y: number; cx: number; cy: number } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly renderer: Renderer, private readonly assets: AssetLoader,
    private readonly bitmaps: BitmapCache, private readonly dialogue: Dialogue, sprites: SpriteCache, tables: Tables, private readonly hooks: StageHooks) {
    this.presenter = new Presenter(sprites, tables);
    this.bind();
  }

  // ---- drawing ----
  /** One frame: town layers, or the field with the presenter's sprites; the script effects on top. */
  draw(now: number, units: (Unit | null)[], phase: Phase): void {
    const fx = this.effects.snapshot(now);
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

  // ---- Stage: pictures and town ----
  bitmap(name: string): CanvasImageSource | null { return this.bitmaps.get(name); }
  showTown(set: 1 | 2 | 3, extra: boolean, flags: number[]): void {
    this.town = { set, extra, flags, hover: null, showAll: false };
    townLayers(set, extra).forEach((name, i) => this.sheet(name, i));          // start loading
  }
  hideTown(): void { this.town = null; this.canvas.style.cursor = 'default'; }
  log(kind: 'warn' | 'info', text: string): void { this.hooks.log(kind, text); }
}
