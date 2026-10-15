import { AssetError, AssetLoader } from '../assets/loader';
import { VIEW_H, VIEW_W } from '../iso/grid';
import { MapModel } from '../map/mapModel';
import { AnimPlayer } from '../sprite/animPlayer';
import { ApdModel } from '../sprite/apdModel';
import { Renderer, type PlacedSprite, type Scene } from '../render/renderer';
import { clampCamera, fitScale } from './scale';
import { startViewer } from './startup';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>('view');
const renderer = new Renderer(canvas);
const loader = new AssetLoader();
const scene: Scene = { map: null, sprites: [], camera: { x: 0, y: 0 }, overlay: { grid: true, height: false, land: false, blocked: false }, seeThrough: false };
let apd: ApdModel | null = null;
let hover: { c: number; r: number } | null = null;

function showError(e: unknown): void {
  const msg = e instanceof AssetError ? e.message : e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  $('error').textContent = msg;
  console.error(e);
}

function resize(): void {
  const stage = $('stage');
  const k = fitScale(stage.clientWidth - 16, stage.clientHeight - 16);
  canvas.style.width = `${VIEW_W * k}px`;
  canvas.style.height = `${VIEW_H * k}px`;
}

async function loadMap(name: string): Promise<void> {
  $('error').textContent = '';
  const data = await loader.map(name);
  const layers = await Promise.all(data.layers.map((n) => loader.image('map', n)));
  const bg = data.bg ? await loader.image('map', data.bg).catch((e: unknown) => { showError(e); return null; }) : null;
  const model = new MapModel(data, layers, bg);
  await renderer.prepareMap(model);
  scene.map = model;
  scene.sprites = [];
  // Spec §13: the meaning of `start` is unresolved; (start*32, start*16) clamps to (0, 0) on most maps and
  // shows an empty corner (stage02), so the viewer centers the map instead.
  scene.camera = clampCamera(data.pixelSize[0] / 2 - VIEW_W / 2, data.pixelSize[1] / 2 - VIEW_H / 2, data.pixelSize[0], data.pixelSize[1]);
}

async function loadApd(name: string): Promise<void> {
  const data = await loader.apd(name);
  const sheets = await Promise.all(data.sheets.map((n) => loader.image('sprite', n)));
  const model = new ApdModel(name, data, sheets);
  await renderer.prepareApd(model);
  apd = model;
  const animSel = $<HTMLSelectElement>('anim');
  animSel.replaceChildren(...model.animNames().map((n) => Object.assign(document.createElement('option'), { value: n, textContent: n })));
  if (model.errors.length) showError(model.errors.map((e) => e.message).join('\n'));
}

function placeSprite(c: number, r: number): void {
  if (!apd) return;
  const tl = apd.anim($<HTMLSelectElement>('anim').value);
  if (!tl) return;
  const player = new AnimPlayer(tl, { loop: $<HTMLInputElement>('loop').checked });
  scene.sprites.push({ model: apd, player, c, r } satisfies PlacedSprite);
}

function canvasPoint(ev: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: ((ev.clientX - rect.left) / rect.width) * VIEW_W + scene.camera.x, y: ((ev.clientY - rect.top) / rect.height) * VIEW_H + scene.camera.y };
}

function updateStatus(): void {
  const map = scene.map;
  const cell = map && hover ? map.cellAt(hover.c, hover.r) : null;
  const frames = scene.sprites.map((s) => `${s.player.timeline.name}#${s.player.stepIndex}/${s.player.frame.pattern}`).join(' ');
  $('status').textContent = cell
    ? `cell (${cell.c}, ${cell.r}) h=${cell.cell.h} land=${cell.cell.land} blocked=${cell.cell.blocked} flag2=${cell.cell.flag2} objs=${cell.cell.objs.length}\ncam (${scene.camera.x}, ${scene.camera.y})\n${frames}`
    : `cam (${scene.camera.x}, ${scene.camera.y})\n${frames}`;
}

function frame(now: number): void {
  for (const sp of scene.sprites) sp.player.update(now);
  renderer.draw(scene);
  updateStatus();
  requestAnimationFrame(frame);
}

function bind(): void {
  const mapSel = $<HTMLSelectElement>('map'), spriteSel = $<HTMLSelectElement>('sprite');
  mapSel.addEventListener('change', () => loadMap(mapSel.value).catch(showError));
  spriteSel.addEventListener('change', () => loadApd(spriteSel.value).catch(showError));
  $('clear').addEventListener('click', () => { scene.sprites = []; });
  for (const key of ['grid', 'height', 'land', 'blocked'] as const) {
    $<HTMLInputElement>(key).addEventListener('change', (e) => { scene.overlay[key] = (e.target as HTMLInputElement).checked; });
  }
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  canvas.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: scene.camera.x, cy: scene.camera.y }; });
  window.addEventListener('mouseup', (e) => {
    if (!drag) return;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3;
    drag = null;
    if (moved || !scene.map) return;
    const pt = canvasPoint(e);
    const cell = scene.map.pick(pt.x, pt.y);
    if (cell) placeSprite(cell.c, cell.r);
  });
  canvas.addEventListener('mousemove', (e) => {
    const map = scene.map;
    if (!map) return;
    if (drag) {
      const k = canvas.getBoundingClientRect().width / VIEW_W;
      scene.camera = clampCamera(drag.cx - (e.clientX - drag.x) / k, drag.cy - (e.clientY - drag.y) / k, map.data.pixelSize[0], map.data.pixelSize[1]);
      return;
    }
    const pt = canvasPoint(e);
    const cell = map.pick(pt.x, pt.y);
    hover = cell ? { c: cell.c, r: cell.r } : null;
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') scene.seeThrough = true;
    const map = scene.map;
    if (!map) return;
    const step = e.shiftKey ? 64 : 16;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = d[e.key];
    if (m) { scene.camera = clampCamera(scene.camera.x + m[0], scene.camera.y + m[1], map.data.pixelSize[0], map.data.pixelSize[1]); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') scene.seeThrough = false; });
  window.addEventListener('resize', resize);
}

bind();
resize();
void startViewer({
  index: () => loader.index(),
  populate: (index, defaults) => {
    const option = (v: string) => Object.assign(document.createElement('option'), { value: v, textContent: v });
    const mapSel = $<HTMLSelectElement>('map'), spriteSel = $<HTMLSelectElement>('sprite');
    mapSel.replaceChildren(...index.maps.map(option));
    spriteSel.replaceChildren(...index.sprites.map(option));
    if (defaults.map) mapSel.value = defaults.map;
    if (defaults.sprite) spriteSel.value = defaults.sprite;
  },
  loadMap,
  loadApd,
  startLoop: () => requestAnimationFrame(frame),
  onError: showError,
});
