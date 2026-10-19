import { BitmapCache } from '../assets/bitmaps';
import { synthNotice } from '../audio/spessa';
import { AssetError, AssetLoader } from '../assets/loader';
import { Rng } from '../battle/rng';
import type { BattleEvent } from '../battle/types';
import { PARTY_SLOTS } from '../battle/unit';
import { DataError, DataLoader } from '../data/loader';
import type { RosterUnit, Tables } from '../data/types';
import { cellCommands } from '../game/battleInput';
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
import { menuEnabled } from '../ui/menuEnabled';
import '../ui/win/theme.css';
import { accelOf, MenuBar, menuModel, type MenuTemplate } from '../ui/win/menubar';
import { PopupMenu, unitPopupItems, type PopupItem } from '../ui/win/popup';
import type { DialogHost } from '../ui/win/dialog';
import { confirm } from '../ui/win/screens/confirm';
import { pickSave } from '../ui/win/screens/saves';
import { titleDialog } from '../ui/win/screens/title';
import { unitList } from '../ui/win/screens/unitList';
import { frameScale, MENU_BAR_H } from '../viewer/scale';

const $ = <T extends HTMLElement>(id: string): T => { const el = document.getElementById(id); if (!el) throw new Error(`missing element #${id}`); return el as T; };
const nn = (n: number): string => String(n).padStart(2, '0');
const IDLE = { kind: 'player', sel: { mode: 'idle' } } as const;

const canvas = $<HTMLCanvasElement>('view');
const renderer = new Renderer(canvas);
const assets = new AssetLoader();
const data = new DataLoader();
let core: GameCore | null = null;
let stage: BrowserStage | null = null;
let panel: Panel | null = null;                                               // the developer's side panel (?dev=1): logs, raw unit data, errors
let menuBar: MenuBar | null = null; let menuSig = ''; let popup: PopupMenu | null = null;
const dev = new URLSearchParams(location.search).get('dev') === '1';
let shownEvents: BattleEvent[] | null = null;
let saves: SaveStore | null = null;
let saveList: (SaveSummary | null)[] = [];
const refreshSaves = async (): Promise<void> => { if (saves) saveList = await saves.summaries(); };

const showError = (e: unknown) => { const msg = e instanceof AssetError || e instanceof DataError ? e.message : e instanceof Error ? `${e.name}: ${e.message}` : String(e); $('error').textContent = msg; console.error(e); };
const log = (kind: 'warn' | 'info', text: string) => { panel?.log(kind === 'warn' ? `⚠ ${text}` : text); if (kind === 'warn') console.warn(text); else console.info(text); };

/** The game window (menu bar + 640×480 surface) scales as one by an integer factor; the dialogue and Win95 chrome inside scale with it. */
function resize(): void {
  const host = $('stage');
  const k = frameScale(host.clientWidth - 16, host.clientHeight - 16);
  $('frameBox').style.width = `${VIEW_W * k}px`; $('frameBox').style.height = `${(VIEW_H + MENU_BAR_H) * k}px`;
  $('frame').style.transform = `scale(${k})`;
}

/** Menu 103 → actions. Items without an action yet are disabled in `menuFlags`. */
function menuCommand(id: number): void {
  if (!core || !stage) return;
  switch (id) {
    case 40009: if (core.battle && dialogHost) void confirm(dialogHost, '턴을 종료해도 좋습니까?').then((yes) => { if (yes && core?.battle) core.dispatch({ type: 'endTurn' }); }); break;   // 턴 종료 F10 — the original asks (string 0x44ba98)
    case 40028: void openLoadDialog(); break;                                                             // 불러오기 F1
    case 40029: if (dialogHost) void refreshSaves().then(() => pickSave(dialogHost!, saveList, 'save')).then((p) => { if (p && 'slot' in p) core?.save(p.slot); }); break;   // 저장하기 F5
    case 40004: if (dialogHost) void confirm(dialogHost, '게임을 종료합니까?').then((yes) => { if (yes) location.reload(); }); break;   // 게임종료 (the web's exit is the title page)
    case 40010: if (dialogHost) void unitList(dialogHost, { tables: tablesRef!, inventory: core.campaign.inventory, party: core.campaign.units.slice(0, PARTY_SLOTS) }); break;   // 유니트 일람 F2 (dialog 107)
    case 40003: if (document.fullscreenElement) void document.exitFullscreen(); else void $('stage').requestFullscreen?.(); break;   // 전체 화면 F4
    case 40032: if (core.battle) dialogueRef?.openModal('message', `${core.battle.state.entry.episode} — ${core.battle.state.entry.objective}`, { tables: tablesRef!, inventory: core.campaign.inventory, party: core.campaign.units.slice(0, PARTY_SLOTS) }); break;   // 클리어 조건
    default: break;
  }
}
/** Which menu items are live right now: 턴 종료 only in our battle phase; 클리어 조건 only in a battle; the rest of the system menu waits for its dialogs. */
function menuFlags(): Record<number, boolean> {
  const b = core?.battle ?? null;
  return { 40009: b !== null && menuEnabled(b.state, tablesRef?.item ?? []).endTurn, 40032: b !== null, 40030: false, 40012: false };
}
let dialogueRef: Dialogue | null = null; let tablesRef: Tables | null = null; let menuRef: MenuTemplate | null = null; let dialogHost: DialogHost | null = null;

/** Dialog 143 in load mode with the web's save-file tools; a pick loads, 처음부터 starts a new game. Returns whether the title should stay. */
async function openLoadDialog(): Promise<boolean> {
  if (!dialogHost || !saves || !core || !stage) return true;
  await refreshSaves();
  const p = await pickSave(dialogHost, saveList, 'load', {
    onExport: (slot) => { void saves!.read(slot).then((bytes) => { if (!bytes) return; const url = URL.createObjectURL(new Blob([bytes.slice().buffer])); const a = Object.assign(document.createElement('a'), { href: url, download: SaveStore.fileName(slot) }); a.click(); URL.revokeObjectURL(url); }); },
    onImport: (file) => { void importSave(file); },
    onDelete: (slot) => { void saves!.remove(slot).then(refreshSaves).then(() => openLoadDialog()).then((stay) => { if (stay && core?.mode === 'ended') void showTitle(); }); },
  });
  if (!p) return true;
  if ('fresh' in p) { startNew(); return false; }
  stage.unlockAudio();
  const bytes = await saves.read(p.slot);
  if (bytes && core.loadGame(bytes)) { $('title').hidden = true; $('error').textContent = ''; return false; }
  return true;
}
async function importSave(file: File): Promise<void> {
  if (!saves || !dialogHost) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const free = saveList.findIndex((s) => s === null);
  const into = free >= 0 ? { slot: free } : await pickSave(dialogHost, saveList, 'save');   // every slot used: pick one to overwrite
  if (!into || !('slot' in into)) return;
  try { const sum = await saves.importBytes(into.slot, bytes); await refreshSaves(); log('info', `${SaveStore.fileName(into.slot)} ← ${file.name} (${sum.title})`); } catch (e) { showError(e); }
  if (core?.mode === 'ended') void showTitle();
}
function startNew(): void { stage!.unlockAudio(); $('title').hidden = true; $('error').textContent = ''; core!.newGame(); }
/** The title picture with dialog 124 over it: 게임 개시 or 불러오기 (back to the dialog when loading is cancelled). */
async function showTitle(): Promise<void> {
  if (!dialogHost) return;
  $('title').hidden = false;
  for (;;) {
    const c = await titleDialog(dialogHost);
    if (c === 'new') { startNew(); return; }
    if (!(await openLoadDialog())) return;
  }
}

let lastFrameError = '';
/** Volume controls: 0..100 sliders and a mute box, remembered per browser. */
function bindAudioControls(): void {
  const music = $<HTMLInputElement>('volMusic'), sound = $<HTMLInputElement>('volSound'), mute = $<HTMLInputElement>('mute');
  try { const saved = JSON.parse(localStorage.getItem('ft2.audio') ?? 'null') as { music?: number; sound?: number; mute?: boolean } | null; if (saved) { music.value = String(saved.music ?? 80); sound.value = String(saved.sound ?? 80); mute.checked = saved.mute ?? false; } } catch { /* storage unavailable */ }
  const apply = () => {
    const m = mute.checked ? 0 : Number(music.value) / 100, sn = mute.checked ? 0 : Number(sound.value) / 100;
    stage?.setVolumes(m, sn);
    try { localStorage.setItem('ft2.audio', JSON.stringify({ music: Number(music.value), sound: Number(sound.value), mute: mute.checked })); } catch { /* storage unavailable */ }
  };
  for (const el of [music, sound, mute]) el.addEventListener('input', apply);
  apply();
}

let audioNoted = false;
let endedShown = false;
function frame(now: number): void {
  try {
    if (core && stage) {
      core.frame(now);
      if (menuBar && menuRef) { const flags = menuFlags(), sig = JSON.stringify(flags); if (sig !== menuSig) { menuSig = sig; menuBar.setModel(menuModel(menuRef, flags, dev)); } }
      if (core.mode === 'ended' && !endedShown) { endedShown = true; stage.hideTown(); void showTitle(); }   // the ending (or a game over with nowhere to go) returns to the title
      if (core.mode !== 'ended') endedShown = false;
      if (!audioNoted && stage.audioTried) { audioNoted = true; const note = $('audioNote'); const text = synthNotice(stage.musicFailure); note.hidden = text === null; note.textContent = text ?? ''; }
      stage.cellMode = core.mode === 'battle';
      const b = core.battle;
      stage.draw(now, core.campaign.units, b?.state.phase ?? IDLE);
      if (b) {
        if (core.lastEvents !== shownEvents) { shownEvents = core.lastEvents; panel?.logEvents(b.state, shownEvents); }
        const h = stage.presenter.hover;
        panel?.update(b.state, h ? b.state.units.find((u) => u && u.c === h[0] && u.r === h[1]) ?? null : null);
        panel?.showResult(core.result);
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
    const tables: Tables = await data.tables(); tablesRef = tables;
    $('panel').hidden = !dev;
    const programs = await Promise.all(index.events.map((n) => data.event(n)));
    if (!index.wave || !index.midi) log('warn', '자산 목록이 오래됐다(wave/midi 없음): python3 -I tools/ft2_export.py 를 다시 돌리면 소리가 난다');
    const visualList = await data.visual().catch((e: unknown) => { showError(e); return []; });
    const staff = await data.staff().catch((e: unknown) => { showError(e); return []; });
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
      onCell: (cell) => { if (!core?.battle) return; for (const cmd of cellCommands(core.battle.state, cell)) { core.dispatch(cmd); if (core.lastEvents.some((e) => e.type === 'rejected')) break; } },   // one click may be several commands: stop at the first the rules refuse
      onTownClick: (i) => core?.townSelect(i),
      onTownMenu: () => { if (dialogHost) void unitList(dialogHost, { tables, inventory: core!.campaign.inventory, party: core!.campaign.units.slice(0, PARTY_SLOTS) }); },   // the town's right click opens the original's 시스템 popup in Task 8; the unit list stands in until then
      onCancel: () => core?.dispatch({ type: 'cancel' }),
      onBattleMenu: (cell, at) => {                                           // the original's right-click popup: the unit's entries over the 맵 menu's own
        if (!core?.battle || !popup || !menuRef) return;
        const s = core.battle.state, u = cell ? s.units.find((v) => v && v.side === 0 && v.c === cell[0] && v.r === cell[1]) ?? null : null;
        const items: PopupItem[] = [...(u ? unitPopupItems(u, s.inventory, tables) : []), ...menuModel(menuRef, menuFlags(), dev).bar[0]!.items];
        void popup.open(at.x, at.y, items).then((pick) => {
          if (!pick || !core?.battle) return;
          if (pick.cmd && u) {
            const sel = core.battle.state.phase.kind === 'player' ? core.battle.state.phase.sel : null;
            if (!sel || sel.mode === 'idle' || sel.slot !== u.slot) { if (sel && sel.mode !== 'idle') core.dispatch({ type: 'cancel' }); core.dispatch({ type: 'select', slot: u.slot }); }
            core.dispatch(pick.cmd);
          } else if (pick.id !== null) menuCommand(pick.id);
        });
      },
      modalContext: () => ({ tables, inventory: core!.campaign.inventory, party: core!.campaign.units.slice(0, PARTY_SLOTS), saves: saveList }),
      writeSave: (slot, bytes) => { void saves?.write(slot, bytes).then(refreshSaves).catch(showError); },
      log,
    }, { wave: new Set(index.wave ?? []), midi: new Set(index.midi ?? []) }, visualList, staff);
    core = new GameCore(res, stage); dialogueRef = dialogue;
    if (dev) panel = new Panel(document, { onStart: () => {}, onCommand: (cmd) => core?.dispatch(cmd) }, tables);
    bindAudioControls();
    const ui = await data.ui().catch((e: unknown) => { showError(e); return null; });
    if (ui) {
      const model = menuModel(ui.menu, menuFlags(), dev); menuRef = ui.menu; menuSig = JSON.stringify(menuFlags());
      menuBar = new MenuBar($('menubar'), model, menuCommand); popup = new PopupMenu($('win'));
      dialogHost = { layer: $('win'), templates: ui.dialogs }; dialogue.attach(dialogHost);
      document.addEventListener('keydown', (e) => {                            // the original's accelerators: F1 불러오기, F2 유니트 일람, F4 전체 화면, F5 저장, F10 턴 종료 …
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
        const id = accelOf(menuModel(ui.menu, menuFlags(), dev), e.key, e.ctrlKey || e.metaKey);
        if (id !== null) { e.preventDefault(); menuCommand(id); }
      });
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) stage?.resumeAudio(); });
    await refreshSaves();
    void showTitle();
    void bitmaps.load('title');
  } catch (e) { showError(e); }
}

/** Debug hook for scripted browser checks: window.__ft2().core.mode, .campaign.flags, .vm.state … */
(window as unknown as { __ft2: () => unknown }).__ft2 = () => ({ core, campaign: core?.campaign, vm: core?.vm, battle: core?.battle, stage, mode: core?.mode, saves, saveList, music: stage ? { ready: stage.musicReady, current: stage.currentMusic } : null, visual: stage?.visualPlaying ?? false });

void boot();
