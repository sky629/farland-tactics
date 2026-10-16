import type { FxSnapshot } from '../field/effects';
import { IndexedBitmaps } from '../gfx/indexed';
import { TILE_H, TILE_W, VIEW_H, VIEW_W } from '../iso/grid';
import { bgPosition, type MapModel, type PlacedCell } from '../map/mapModel';
import type { ScreenText } from '../visual/timeline';
import type { ScreenSprite } from '../visual/player';
import type { AnimPlayer } from '../sprite/animPlayer';
import type { ApdModel, DrawCommand } from '../sprite/apdModel';
import { rectVisible } from './culling';

export interface PlacedSprite { model: ApdModel; player: AnimPlayer; c: number; r: number; layer: number; offset?: { x: number; y: number }; flipH?: boolean }
export interface Overlay { grid: boolean; height: boolean; land: boolean; blocked: boolean }
export interface SceneText { x: number; y: number; text: string }   // map pixels, centered
export interface Backdrop { image: CanvasImageSource; sx: number; sy: number; w: number; h: number; dx: number; dy: number; alpha?: number }   // screen-space image pieces (town layers, visual scenes); alpha < 1 = a dissolve
export interface Scene { map: MapModel | null; sprites: PlacedSprite[]; camera: { x: number; y: number }; overlay: Overlay; seeThrough: boolean; texts?: SceneText[]; fx?: FxSnapshot; backdrop?: Backdrop[]; screenSprites?: ScreenSprite[]; screenTexts?: ScreenText[] }

/** Within one diagonal row the original sorts by the sprite's layer field (+0x48); equal layers keep placement order. */
export function sortRow(sprites: PlacedSprite[]): PlacedSprite[] {
  return sprites.map((s, i) => [s, i] as const).sort((a, b) => a[0].layer - b[0].layer || a[1] - b[1]).map(([s]) => s);
}

type Camera = { x: number; y: number };
interface MapGfx { layers: IndexedBitmaps[]; keys: number[]; bg: IndexedBitmaps | null }

const LAND_COLORS = ['rgba(0,0,0,0)', 'rgba(80,200,80,.35)', 'rgba(60,120,220,.35)', 'rgba(200,170,60,.35)',
  'rgba(160,100,60,.35)', 'rgba(120,120,120,.35)', 'rgba(200,80,200,.35)', 'rgba(80,200,200,.35)'];

/** Draws a Scene into a 640×480 canvas in the original's order (FUN_0042a990): per row s = c + r, back objects → sprites → front objects. */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scratch = document.createElement('canvas');
  private readonly mapBitmaps = new WeakMap<MapModel, MapGfx>();
  private readonly apdBitmaps = new WeakMap<ApdModel, IndexedBitmaps[]>();
  private checker: CanvasPattern | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
  }

  /** Build the (layer, key) bitmaps of a map once. */
  async prepareMap(model: MapModel): Promise<void> {
    if (this.mapBitmaps.has(model)) return;
    const layers = model.layers.map((img) => new IndexedBitmaps(img));
    await Promise.all(layers.map((b, i) => b.prepare(model.layerKeys[i]!)));
    const bg = model.bg ? new IndexedBitmaps(model.bg) : null;
    if (bg) await bg.prepare(null);
    this.mapBitmaps.set(model, { layers, keys: model.layerKeys, bg });
  }

  /** Build the (sheet, key) bitmaps a sprite file needs. */
  async prepareApd(model: ApdModel): Promise<void> {
    if (this.apdBitmaps.has(model)) return;
    const sheets = model.sheets.map((img) => new IndexedBitmaps(img));
    const jobs: Promise<void>[] = [];
    for (const [sheet, keys] of model.keysBySheet()) for (const key of keys) jobs.push(sheets[sheet]!.prepare(key));
    await Promise.all(jobs);
    this.apdBitmaps.set(model, sheets);
  }

  draw(scene: Scene): void {
    const { ctx } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    for (const b of scene.backdrop ?? []) {
      if (b.alpha !== undefined) ctx.globalAlpha = b.alpha;
      ctx.drawImage(b.image, b.sx, b.sy, b.w, b.h, b.dx, b.dy, b.w, b.h);
      if (b.alpha !== undefined) ctx.globalAlpha = 1;
    }
    for (const s of scene.screenSprites ?? []) this.drawSpriteOrigin(s.model, s.player, false, s.x + s.player.offset.x, s.y + s.player.offset.y);
    if (scene.screenTexts?.length) this.drawScreenTexts(scene.screenTexts);
    const map = scene.map;
    if (map) {
      const gfx = this.mapBitmaps.get(map);
      if (!gfx) throw new Error('map bitmaps not prepared; call prepareMap first');
      const cam = scene.camera;
      if (gfx.bg) { const p = bgPosition(map.data, cam); ctx.drawImage(gfx.bg.get(null), p.x, p.y); }

      const spritesByRow = new Map<number, PlacedSprite[]>();
      for (const sp of scene.sprites) {
        const s = sp.c + sp.r;
        if (!spritesByRow.has(s)) spritesByRow.set(s, []);
        spritesByRow.get(s)!.push(sp);
      }
      for (const row of map.rows) {
        for (const p of row.cells) this.drawObjects(gfx, p, cam, false, false);
        for (const sp of sortRow(spritesByRow.get(row.s) ?? [])) this.drawSprite(map, sp, cam);
        for (const p of row.cells) this.drawObjects(gfx, p, cam, true, scene.seeThrough);
      }
      this.drawTexts(scene.texts ?? [], cam);
      this.drawOverlay(map, scene.overlay, cam);
    }
    const fx = scene.fx;
    if (!fx) return;
    if (fx.image) ctx.drawImage(fx.image, 0, 0, VIEW_W, VIEW_H);                 // SHOW_IMAGE covers the whole screen
    if (fx.tint) { ctx.globalAlpha = fx.tint.alpha; ctx.fillStyle = fx.tint.color; ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.globalAlpha = 1; }
    if (fx.fade) { ctx.globalAlpha = fx.fade.alpha; ctx.fillStyle = fx.fade.color === 'white' ? '#fff' : '#000'; ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.globalAlpha = 1; }
  }

  /** FUN_0042d1e0: the objects of one cell, back (front == 0) or front (front != 0). Mode 4 = checkerboard see-through. */
  private drawObjects(gfx: MapGfx, p: PlacedCell, cam: Camera, front: boolean, seeThrough: boolean): void {
    for (const o of p.cell.objs) {
      if ((o.front !== 0) !== front) continue;
      const w = o.right - o.left, h = o.bottom - o.top;
      const x = p.x + o.ox - cam.x, y = p.y + o.oy - cam.y;
      if (!rectVisible(x, y, w, h, 0, 0)) continue;
      const bmp = gfx.layers[o.layer]!.get(gfx.keys[o.layer]!);
      if (seeThrough) this.drawCheckered(bmp, o.left, o.top, w, h, x, y);
      else this.ctx.drawImage(bmp, o.left, o.top, w, h, x, y, w, h);
    }
  }

  /** FUN_0042a560 / FUN_0042a610: sprite origin = cell anchor + animation offset; each image at origin + (dx, dy). */
  private drawSprite(map: MapModel, sp: PlacedSprite, cam: Camera): void {
    const cell = map.cellAt(sp.c, sp.r);
    if (!cell) return;
    this.drawSpriteOrigin(sp.model, sp.player, sp.flipH ?? false, cell.x + sp.player.offset.x + (sp.offset?.x ?? 0) - cam.x, cell.y + sp.player.offset.y + (sp.offset?.y ?? 0) - cam.y);
  }

  /** The current frame of a player drawn with its origin at screen (ox, oy); nothing when the APD's bitmaps are not prepared. */
  private drawSpriteOrigin(model: ApdModel, player: AnimPlayer, flip: boolean, ox: number, oy: number): void {
    const sheets = this.apdBitmaps.get(model);
    if (!sheets) return;
    const frame = player.frame;
    const b = model.bounds(frame, flip);
    if (!rectVisible(ox + b.left, oy + b.top, b.right - b.left, b.bottom - b.top, 0, 0)) return;
    for (const c of model.commands(frame, flip)) this.drawCommand(sheets[c.sheet]!.get(c.key), c, ox + c.dx, oy + c.dy);
  }

  private drawCommand(bmp: ImageBitmap, c: DrawCommand, x: number, y: number): void {
    const { ctx } = this;
    if (!c.flipH && !c.flipV) {
      ctx.drawImage(bmp, c.sx, c.sy, c.w, c.h, x, y, c.w, c.h);
      return;
    }
    ctx.save();
    ctx.translate(c.flipH ? x + c.w : x, c.flipV ? y + c.h : y);
    ctx.scale(c.flipH ? -1 : 1, c.flipV ? -1 : 1);
    ctx.drawImage(bmp, c.sx, c.sy, c.w, c.h, 0, 0, c.w, c.h);
    ctx.restore();
  }

  /** Staff-roll lines: white on a black shadow (staff.lst FONTCOL 243 / DECOCOL 244), 명조 = serif, 고딕 = sans. */
  private drawScreenTexts(texts: ScreenText[]): void {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const t of texts) {
      ctx.font = `${t.bold ? 'bold ' : ''}${t.size}px ${t.font === 'mincho' ? "'Noto Serif KR', 'Apple Myungjo', 'Batang', serif" : "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"}`;
      ctx.fillStyle = '#000'; ctx.fillText(t.text, t.x + 1, t.y + 1);
      ctx.fillStyle = '#fff'; ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }

  /** Mode 4 of FUN_0042d1e0: pixels whose (screenX + screenY) is odd are dropped. */
  private drawCheckered(bmp: ImageBitmap, sx: number, sy: number, w: number, h: number, x: number, y: number): void {
    const sc = this.scratch;
    if (sc.width < w || sc.height < h) {
      sc.width = Math.max(sc.width, w);
      sc.height = Math.max(sc.height, h);
    }
    const g = sc.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    g.drawImage(bmp, sx, sy, w, h, 0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const pattern = this.checkerPattern(g);
    pattern.setTransform(new DOMMatrix().translate(((x + y) & 1) === 0 ? 0 : 1, 0));
    g.fillStyle = pattern;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(sc, 0, 0, w, h, x, y, w, h);
  }

  private checkerPattern(g: CanvasRenderingContext2D): CanvasPattern {
    if (this.checker) return this.checker;
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    const cg = c.getContext('2d')!;
    cg.fillStyle = '#fff';
    cg.fillRect(0, 0, 1, 1);
    cg.fillRect(1, 1, 1, 1);          // keep pixels where (u + v) is even
    this.checker = g.createPattern(c, 'repeat')!;
    return this.checker;
  }

  private drawTexts(texts: SceneText[], cam: Camera): void {
    if (texts.length === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    for (const t of texts) { ctx.strokeText(t.text, t.x - cam.x, t.y - cam.y); ctx.fillText(t.text, t.x - cam.x, t.y - cam.y); }
    ctx.restore();
  }

  private drawOverlay(map: MapModel, ov: Overlay, cam: Camera): void {
    if (!ov.grid && !ov.height && !ov.land && !ov.blocked) return;
    const { ctx } = this;
    ctx.save();
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    for (const row of map.rows) {
      for (const p of row.cells) {
        const x = p.x - cam.x, y = p.y - cam.y;
        if (!rectVisible(x - TILE_W / 2, y - TILE_H / 2, TILE_W, TILE_H, 0, 0)) continue;
        ctx.beginPath();
        ctx.moveTo(x - TILE_W / 2, y);
        ctx.lineTo(x, y - TILE_H / 2);
        ctx.lineTo(x + TILE_W / 2, y);
        ctx.lineTo(x, y + TILE_H / 2);
        ctx.closePath();
        if (ov.land) { ctx.fillStyle = LAND_COLORS[p.cell.land] ?? 'rgba(255,255,255,.3)'; ctx.fill(); }
        if (ov.blocked && p.cell.blocked) { ctx.fillStyle = 'rgba(255,40,40,.45)'; ctx.fill(); }
        if (ov.grid) { ctx.strokeStyle = 'rgba(80,255,80,.8)'; ctx.stroke(); }
        if (ov.height && p.cell.h) { ctx.fillStyle = '#fff'; ctx.fillText(String(p.cell.h), x, y + 4); }
      }
    }
    ctx.restore();
  }
}
