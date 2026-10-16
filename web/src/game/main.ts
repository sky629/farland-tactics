import { AssetError, AssetLoader } from '../assets/loader';
import { Battle } from '../battle/battle';
import type { BattleEvent, Command } from '../battle/types';
import type { Unit } from '../battle/unit';
import { DataError, DataLoader } from '../data/loader';
import type { BattleEntry, Tables } from '../data/types';
import { Presenter, type SpriteProvider } from '../field/presenter';
import { VIEW_H, VIEW_W } from '../iso/grid';
import { MapModel } from '../map/mapModel';
import { Renderer, type Scene } from '../render/renderer';
import { ApdModel } from '../sprite/apdModel';
import { Panel } from '../ui/panel';
import { clampCamera, fitScale } from '../viewer/scale';

const $ = <T extends HTMLElement>(id: string): T => { const el = document.getElementById(id); if (!el) throw new Error(`missing element #${id}`); return el as T; };

/** Loads APDs on demand; returns null until a sprite file is ready or when it does not exist. */
class SpriteCache implements SpriteProvider {
  private readonly models = new Map<string, ApdModel | null>();
  private readonly pending = new Set<string>();
  constructor(private readonly loader: AssetLoader, private readonly renderer: Renderer, private readonly known: Set<string>, private readonly onError: (e: unknown) => void) {}
  apd(name: string): ApdModel | null {
    if (this.models.has(name)) return this.models.get(name)!;
    if (!this.known.has(name)) { this.models.set(name, null); return null; }
    if (!this.pending.has(name)) {
      this.pending.add(name);
      void (async () => {
        try {
          const data = await this.loader.apd(name);
          const sheets = await Promise.all(data.sheets.map((s) => this.loader.image('sprite', s)));
          const model = new ApdModel(name, data, sheets);
          await this.renderer.prepareApd(model);
          this.models.set(name, model);
        } catch (e) { this.models.set(name, null); this.onError(e); }
      })();
    }
    return null;
  }
}

const canvas = $<HTMLCanvasElement>('view');
const renderer = new Renderer(canvas);
const assets = new AssetLoader();
const data = new DataLoader();
let tables: Tables | null = null;
let battle: Battle | null = null;
let presenter: Presenter | null = null;
let mapModel: MapModel | null = null;
let sprites: SpriteCache | null = null;
let panel: Panel | null = null;
let camera = { x: 0, y: 0 };
let seeThrough = false;
let hoverUnit: Unit | null = null;

const showError = (e: unknown) => { const msg = e instanceof AssetError || e instanceof DataError ? e.message : e instanceof Error ? `${e.name}: ${e.message}` : String(e); $('error').textContent = msg; console.error(e); };

function resize(): void {
  const stage = $('stage');
  const k = fitScale(stage.clientWidth - 16, stage.clientHeight - 16);
  canvas.style.width = `${VIEW_W * k}px`; canvas.style.height = `${VIEW_H * k}px`;
}

function dispatch(cmd: Command): void {
  if (!battle || !presenter || !panel) return;
  if (presenter.busy) return;
  handle(battle.reduce(cmd));
}

function handle(events: BattleEvent[]): void {
  if (!battle || !presenter || !panel) return;
  presenter.enqueue(events);
  panel.logEvents(battle.state, events);
  $('error').textContent = '';
}

async function startBattle(entry: BattleEntry, seed: number): Promise<void> {
  if (!tables || !panel) return;
  try {
    const [roster1, roster, map] = await Promise.all([data.roster(1), data.roster(entry.roster), assets.map(entry.map)]);
    const layers = await Promise.all(map.layers.map((n) => assets.image('map', n)));
    const bg = map.bg ? await assets.image('map', map.bg).catch((e: unknown) => { showError(e); return null; }) : null;
    mapModel = new MapModel(map, layers, bg);
    await renderer.prepareMap(mapModel);
    battle = Battle.start(entry, map, roster1, roster, tables, seed);
    presenter = new Presenter(sprites!, tables);
    presenter.sync(battle.state);
    const first = battle.state.units.find((u) => u && u.side === 0);
    const cell = first ? mapModel.cellAt(first.c, first.r) : null;
    camera = clampCamera((cell?.x ?? 0) - VIEW_W / 2, (cell?.y ?? 0) - VIEW_H / 2, map.pixelSize[0], map.pixelSize[1]);
    panel.showResult(null);
    panel.log(`전투 시작: ${entry.episode} (시드 ${seed})`);
    $('error').textContent = '';
  } catch (e) { showError(e); }
}

function canvasCell(ev: MouseEvent): [number, number] | null {
  if (!mapModel) return null;
  const rect = canvas.getBoundingClientRect();
  const px = ((ev.clientX - rect.left) / rect.width) * VIEW_W + camera.x, py = ((ev.clientY - rect.top) / rect.height) * VIEW_H + camera.y;
  const cell = mapModel.pick(px, py);
  return cell ? [cell.c, cell.r] : null;
}

function onClick(cell: [number, number]): void {
  if (!battle) return;
  const s = battle.state;
  if (s.phase.kind !== 'player') return;
  const sel = s.phase.sel;
  const u = s.units.find((x) => x && x.c === cell[0] && x.r === cell[1]) ?? null;
  switch (sel.mode) {
    case 'idle': if (u && u.side === 0) dispatch({ type: 'select', slot: u.slot }); break;
    case 'menu': if (u && u.side === 0 && u.slot !== sel.slot) dispatch({ type: 'select', slot: u.slot }); break;
    case 'move': dispatch({ type: 'move', c: cell[0], r: cell[1] }); break;
    case 'target': dispatch({ type: 'act', c: cell[0], r: cell[1] }); break;
    case 'face': {
      const me = s.units[sel.slot]!;
      const d = Math.abs(cell[0] - me.c) + Math.abs(cell[1] - me.r);
      if (d === 0) dispatch({ type: 'face', dir: me.dir });
      else if (d === 1) dispatch({ type: 'face', dir: cell[0] > me.c ? 1 : cell[0] < me.c ? 2 : cell[1] > me.r ? 0 : 3 });
      break;
    }
  }
}

function frame(now: number): void {
  if (battle && presenter && mapModel && panel) {
    presenter.update(now);
    const s = battle.state;
    if (!presenter.busy) {
      presenter.sync(s);
      if (s.phase.kind === 'enemy') handle(battle.reduce({ type: 'enemyStep' }));
      else if (s.phase.kind === 'end') panel.showResult(s.phase.result);
    }
    if (presenter.focus) {
      const cell = mapModel.cellAt(presenter.focus[0], presenter.focus[1]);
      if (cell && (cell.x < camera.x + 64 || cell.x > camera.x + VIEW_W - 64 || cell.y < camera.y + 64 || cell.y > camera.y + VIEW_H - 64)) {
        camera = clampCamera(cell.x - VIEW_W / 2, cell.y - VIEW_H / 2, s.map.pixelSize[0], s.map.pixelSize[1]);
      }
    }
    const { sprites: placed, texts } = presenter.scene(mapModel, s);
    const scene: Scene = { map: mapModel, sprites: placed, camera, overlay: { grid: false, height: false, land: false, blocked: false }, seeThrough, texts };
    renderer.draw(scene);
    panel.update(s, hoverUnit);
  } else {
    renderer.draw({ map: null, sprites: [], camera, overlay: { grid: false, height: false, land: false, blocked: false }, seeThrough: false });
  }
  requestAnimationFrame(frame);
}

function bind(): void {
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); dispatch({ type: 'cancel' }); });
  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) drag = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y }; });
  window.addEventListener('mouseup', (e) => {
    if (!drag || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3;
    drag = null;
    if (moved) return;
    const cell = canvasCell(e);
    if (cell) onClick(cell);
  });
  canvas.addEventListener('mousemove', (e) => {
    if (drag && battle) {
      const k = canvas.getBoundingClientRect().width / VIEW_W;
      camera = clampCamera(drag.cx - (e.clientX - drag.x) / k, drag.cy - (e.clientY - drag.y) / k, battle.state.map.pixelSize[0], battle.state.map.pixelSize[1]);
      return;
    }
    const cell = canvasCell(e);
    if (presenter) presenter.hover = cell;
    hoverUnit = cell && battle ? battle.state.units.find((u) => u && u.c === cell[0] && u.r === cell[1]) ?? null : null;
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') seeThrough = true;
    if (e.key === 'Escape') dispatch({ type: 'cancel' });
    if (e.key === 'Enter' && battle?.state.phase.kind === 'player' && battle.state.phase.sel.mode === 'face') dispatch({ type: 'face', dir: battle.state.units[battle.state.phase.sel.slot]!.dir });
    if (!battle || (e.target as HTMLElement).tagName === 'INPUT') return;
    const step = e.shiftKey ? 64 : 16;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = d[e.key];
    if (m) { camera = clampCamera(camera.x + m[0], camera.y + m[1], battle.state.map.pixelSize[0], battle.state.map.pixelSize[1]); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') seeThrough = false; });
  window.addEventListener('blur', () => { seeThrough = false; });
  window.addEventListener('resize', resize);
}

async function boot(): Promise<void> {
  bind();
  resize();
  requestAnimationFrame(frame);
  try {
    const index = await assets.index();
    if (!(index as { data?: boolean }).data) throw new AssetError('assets/index.json', 'no data tables: run tools/ft2_export.py again');
    tables = await data.tables();
    sprites = new SpriteCache(assets, renderer, new Set(index.sprites), showError);
    panel = new Panel(document, { onStart: (entry, seed) => void startBattle(entry, seed), onCommand: dispatch }, tables);
    panel.setBattles(await data.battles());
    ($('seed') as HTMLInputElement).value = String(Date.now() % 100000);
  } catch (e) { showError(e); }
}

/** Debug hook for scripted browser checks: window.__ft2().dispatch({ type: 'select', slot: 0 }) etc. */
(window as unknown as { __ft2: () => unknown }).__ft2 = () => ({ battle, presenter, mapModel, camera, dispatch, cellScreen: (c: number, r: number) => {
  const cell = mapModel?.cellAt(c, r);
  if (!cell) return null;
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + ((cell.x - camera.x) / VIEW_W) * rect.width, y: rect.top + ((cell.y - camera.y) / VIEW_H) * rect.height };
} });

void boot();
