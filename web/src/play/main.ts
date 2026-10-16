import { BitmapCache } from '../assets/bitmaps';
import { AssetError, AssetLoader } from '../assets/loader';
import { Rng } from '../battle/rng';
import type { BattleEvent } from '../battle/types';
import { PARTY_SLOTS } from '../battle/unit';
import { DataError, DataLoader } from '../data/loader';
import type { RosterUnit, Tables } from '../data/types';
import { cellCommand } from '../game/battleInput';
import { BrowserStage } from '../game/browserStage';
import { GameCore } from '../game/gameCore';
import { SpriteCache } from '../game/spriteCache';
import { VIEW_H, VIEW_W } from '../iso/grid';
import { Renderer } from '../render/renderer';
import type { SaveSummary } from '../save/format';
import { IdbBackend, MemoryBackend, SaveStore } from '../save/store';
import type { Resources } from '../script/host';
import type { Program } from '../script/program';
import { Dialogue } from '../ui/dialogue';
import { Panel } from '../ui/panel';
import { fitScale } from '../viewer/scale';

const $ = <T extends HTMLElement>(id: string): T => { const el = document.getElementById(id); if (!el) throw new Error(`missing element #${id}`); return el as T; };
const nn = (n: number): string => String(n).padStart(2, '0');
const IDLE = { kind: 'player', sel: { mode: 'idle' } } as const;

const canvas = $<HTMLCanvasElement>('view');
const renderer = new Renderer(canvas);
const assets = new AssetLoader();
const data = new DataLoader();
let core: GameCore | null = null;
let stage: BrowserStage | null = null;
let panel: Panel | null = null;
let shownEvents: BattleEvent[] | null = null;
let saves: SaveStore | null = null;
let saveList: (SaveSummary | null)[] = [];
const refreshSaves = async (): Promise<void> => { if (saves) saveList = await saves.summaries(); };

const showError = (e: unknown) => { const msg = e instanceof AssetError || e instanceof DataError ? e.message : e instanceof Error ? `${e.name}: ${e.message}` : String(e); $('error').textContent = msg; console.error(e); };
const log = (kind: 'warn' | 'info', text: string) => { panel?.log(kind === 'warn' ? `⚠ ${text}` : text); if (kind === 'warn') console.warn(text); else console.info(text); };

function resize(): void {
  const host = $('stage');
  const k = fitScale(host.clientWidth - 16, host.clientHeight - 16);
  $('screen').style.width = `${VIEW_W * k}px`; $('screen').style.height = `${VIEW_H * k}px`; $('screen').style.fontSize = `${16 * k}px`;
  canvas.style.width = `${VIEW_W * k}px`; canvas.style.height = `${VIEW_H * k}px`;
}

let lastFrameError = '';
function frame(now: number): void {
  try {
    if (core && stage && panel) {
      core.frame(now);
      stage.cellMode = core.mode === 'battle';
      const b = core.battle;
      stage.draw(now, core.campaign.units, b?.state.phase ?? IDLE);
      if (b) {
        if (core.lastEvents !== shownEvents) { shownEvents = core.lastEvents; panel.logEvents(b.state, shownEvents); }
        const h = stage.presenter.hover;
        panel.update(b.state, h ? b.state.units.find((u) => u && u.c === h[0] && u.r === h[1]) ?? null : null);
        panel.showResult(core.result);
      }
    } else renderer.draw({ map: null, sprites: [], camera: { x: 0, y: 0 }, overlay: { grid: false, height: false, land: false, blocked: false }, seeThrough: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);                  // one bad frame must not stop the game
    if (msg !== lastFrameError) { lastFrameError = msg; showError(e); }
  }
  requestAnimationFrame(frame);
}

/** Every roster a LOAD_UNITS instruction names, so the VM can apply them synchronously. */
function rosterIds(programs: Program[]): number[] {
  const ids = new Set<number>();
  for (const p of programs) for (const ins of p.code) if (ins.op === 'LOAD_UNITS' && typeof ins.args[0] === 'number') ids.add(ins.args[0]);
  return [...ids];
}

async function boot(): Promise<void> {
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
  try {
    const index = await assets.index();
    if (!(index as { data?: boolean }).data || !index.events || !index.bmp) throw new AssetError('assets/index.json', 'no story data: run tools/ft2_export.py again');
    const tables: Tables = await data.tables();
    const programs = await Promise.all(index.events.map((n) => data.event(n)));
    const rosters = new Map<number, RosterUnit[]>();
    await Promise.all(rosterIds(programs).map(async (n) => { try { rosters.set(n, await data.roster(n)); } catch (e) { showError(e); } }));
    const byStage = new Map(programs.map((p) => [p.stage, p]));
    const res: Resources = { program: (n) => byStage.get(n) ?? null, roster: (n) => rosters.get(n) ?? null, tables, rng: Rng.fromSeed(Date.now() % 1_000_000) };
    const memory = (why: string) => { log('warn', `IndexedDB 를 열 수 없어 세이브는 이 페이지에만 남는다 (${why})`); return new MemoryBackend(); };
    const opening = IdbBackend.open().catch((e: unknown) => memory(e instanceof Error ? e.message : String(e)));
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
    saves = new SaveStore((await Promise.race([opening, timeout])) ?? memory('2초 안에 열리지 않음'));   // a hanging open must not keep the title dead
    const bmpSet = new Set(index.bmp);
    const bitmaps = new BitmapCache('assets', bmpSet, (name) => log('warn', `bitmap ${name} failed to load`));
    const dialogue = new Dialogue(document, $('dialogue'), (spk, letter) => { const name = `face${nn(spk)}${letter}`; return bmpSet.has(name) ? `assets/bmp/${name}.png` : null; });
    const sprites = new SpriteCache(assets, renderer, new Set(index.sprites), showError);
    stage = new BrowserStage(canvas, renderer, assets, bitmaps, dialogue, sprites, tables, {
      onCell: (cell) => { if (core?.battle) { const cmd = cellCommand(core.battle.state, cell); if (cmd) core.dispatch(cmd); } },
      onTownClick: (i) => core?.townSelect(i),
      onTownMenu: () => dialogue.openParty({ tables, inventory: core!.campaign.inventory, party: core!.campaign.units.slice(0, PARTY_SLOTS) }, { onSave: () => dialogue.openSaveSlots(saveList, (slot) => core!.save(slot)) }),
      onCancel: () => core?.dispatch({ type: 'cancel' }),
      modalContext: () => ({ tables, inventory: core!.campaign.inventory, party: core!.campaign.units.slice(0, PARTY_SLOTS), saves: saveList }),
      writeSave: (slot, bytes) => { void saves?.write(slot, bytes).then(refreshSaves).catch(showError); },
      log,
    });
    core = new GameCore(res, stage);
    panel = new Panel(document, { onStart: () => {}, onCommand: (cmd) => core?.dispatch(cmd) }, tables);
    $('newGame').addEventListener('click', () => { $('title').hidden = true; $('error').textContent = ''; core!.newGame(); });
    await refreshSaves();
    const loadHandlers = {
      onPick: async (slot: number) => { const bytes = await saves!.read(slot); if (bytes && core!.loadGame(bytes)) { $('title').hidden = true; $('error').textContent = ''; } },
      onExport: async (slot: number) => {
        const bytes = await saves!.read(slot);
        if (!bytes) return;
        const url = URL.createObjectURL(new Blob([bytes.slice().buffer]));
        const a = Object.assign(document.createElement('a'), { href: url, download: SaveStore.fileName(slot) });
        a.click(); URL.revokeObjectURL(url);
      },
      onImport: async (file: File) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const into = async (slot: number) => {
          try {
            const sum = await saves!.importBytes(slot, bytes);
            await refreshSaves();
            log('info', `${SaveStore.fileName(slot)} ← ${file.name} (${sum.title})`);
            dialogue.openLoad(saveList, loadHandlers);
          } catch (e) { showError(e); }
        };
        const free = saveList.findIndex((s) => s === null);
        if (free >= 0) await into(free);
        else dialogue.openSaveSlots(saveList, (slot) => void into(slot));     // every slot used: pick one to overwrite
      },
      onDelete: async (slot: number) => { await saves!.remove(slot); await refreshSaves(); dialogue.openLoad(saveList, loadHandlers); },
    };
    $('loadGame').addEventListener('click', () => { void refreshSaves().then(() => dialogue.openLoad(saveList, loadHandlers)); });
    void bitmaps.load('title');
  } catch (e) { showError(e); }
}

/** Debug hook for scripted browser checks: window.__ft2().core.mode, .campaign.flags, .vm.state … */
(window as unknown as { __ft2: () => unknown }).__ft2 = () => ({ core, campaign: core?.campaign, vm: core?.vm, battle: core?.battle, stage, mode: core?.mode, saves, saveList });

void boot();
