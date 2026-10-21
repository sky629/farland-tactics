/**
 * play.html?walk=1 — the browser auto-play (docs/superpowers/specs/2026-10-20-browser-walk-design.md). The campaign Walker
 * (dev/walker.ts) plays the real page: a virtual clock advances 1000/60 ms a frame without waiting (and holds while assets load),
 * modals are answered through the real dialog buttons, and the frames worth a picture (dev/walkChecks.ts) are offered to a
 * harvester — an ego-browser script — through window.__walk: the loop pauses at each until resume(). Parameters: seed (RNG,
 * default 7), from (a save URL to start at), stop (end after that many battles), shots=0 (never pause for pictures).
 */
import { Rng } from '../battle/rng';
import { PARTY_SLOTS, type Unit } from '../battle/unit';
import type { Tables } from '../data/types';
import { blankFlag, blankRatio, momentsBetween, overflowing, StuckWatch, type WalkSnapshot } from '../dev/walkChecks';
import { Walker, type WalkModalKind, type WalkWorld } from '../dev/walker';
import type { BrowserStage } from '../game/browserStage';
import type { GameCore } from '../game/gameCore';
import { VIEW_W } from '../iso/grid';
import type { Resources } from '../script/host';
import type { Dialogue } from '../ui/dialogue';
import type { Dialogs } from '../ui/win/dialog';

export interface WalkContext {
  tick(now: number): void; draw(now: number): void; core: GameCore; stage: BrowserStage; dialogs: Dialogs; dialogue: Dialogue; res: Resources; tables: Tables; params: URLSearchParams;
  onLog(fn: (kind: 'warn' | 'info', text: string) => void): void;
}
export interface WalkShot { id: number; tag: string; file: string; t: number; stage: number; battle: number; turn: number | null; mode: string; flags: string[] }
export interface WalkManifest {
  run: { seed: number; from: string | null; startedAt: string; frames: number; simulatedMs: number; done: boolean; stopped: string | null };
  shots: WalkShot[]; counts: Record<string, number>; log: string[]; console: { kind: 'error' | 'warn'; text: string }[];
}
export interface WalkWindow { pending: { id: number; file: string; tag: string } | null; done: boolean; resume(): void; manifest(): WalkManifest; frameRect(): { x: number; y: number; width: number; height: number } }

const FRAME_MS = 1000 / 60;
const FLAGS_PER_CHAPTER = 3;                                                   // pictures of one flag kind per chapter; the rest are counted
const ASSET_WAIT_MS = 20, ASSET_WAIT_MAX_MS = 30_000;

const yieldNow = (() => { const ch = new MessageChannel(); let wake: (() => void) | null = null; ch.port1.onmessage = () => { const w = wake; wake = null; w?.(); }; return () => new Promise<void>((r) => { wake = r; ch.port2.postMessage(0); }); })();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const $ = (id: string): HTMLElement => { const el = document.getElementById(id); if (!el) throw new Error(`#${id} missing`); return el; };

export function startWalk(ctx: WalkContext): void { void run(ctx); }

async function run(ctx: WalkContext): Promise<void> {
  const { tick, draw, core, stage, dialogs, dialogue, res, tables, params } = ctx;
  const seed = Number(params.get('seed') ?? 7), fromUrl = params.get('from'), stopBattles = Number(params.get('stop') ?? 999), pauseForShots = params.get('shots') !== '0';
  const shots: WalkShot[] = [], walkLog: string[] = [], consoleList: WalkManifest['console'] = [], counts: Record<string, number> = {};
  const count = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  let frames = 0, now = 0, chapterNo = 0, shotId = 0, stopped: string | null = null, resumeFn: (() => void) | null = null;
  const pendingFlags: string[] = [], flagged = new Map<string, number>();
  const flag = (kind: string) => { count(`flag-${kind}`); const key = `${chapterNo}:${kind}`, n = flagged.get(key) ?? 0; flagged.set(key, n + 1); if (n < FLAGS_PER_CHAPTER) pendingFlags.push(`flag-${kind}`); };
  const view = $('view') as HTMLCanvasElement, screen = $('screen'), frameEl = $('frame');
  const sample = document.createElement('canvas'); sample.width = 32; sample.height = 24;
  const sctx = sample.getContext('2d', { willReadFrequently: true });
  if (!sctx) throw new Error('2D canvas context unavailable');

  // ---- the walker's world: the real page
  const saved = new Map<number, Uint8Array>();
  const origWrite = stage.writeSave.bind(stage);
  stage.writeSave = (slot, bytes) => { saved.set(slot, bytes); origWrite(slot, bytes); };
  const answers: { kind: WalkModalKind; value: number }[] = [];
  let messages = 0, lastTemplate: string | null = null;
  const origOpen = stage.openModal.bind(stage);
  stage.openModal = (kind, payload) => {
    origOpen(kind, payload);
    if (kind === 'message') { messages++; lastTemplate = 'message'; } else lastTemplate = dialogs.top?.dataset['template'] ?? null;
    walker.onModal(kind as WalkModalKind, payload);                            // the answer is queued and applied after the box's picture
  };
  const world: WalkWorld = {
    click: () => dialogue.noteClick(),
    answer: (kind, value) => { answers.push({ kind, value }); },
    presenterBusy: () => stage.presenter.busy,
    autosave: (n) => saved.get(n) ?? null,
    reseed: (s) => { res.rng = Rng.fromSeed(s); },
    log: (line) => { walkLog.push(line); if (line.startsWith('warn')) { consoleList.push({ kind: 'warn', text: line }); flag('warn'); } },
  };
  const press = (box: HTMLElement | null, id: number): boolean => { const b = box?.querySelector<HTMLElement>(`[data-id="${id}"]`); if (!b) return false; b.click(); return true; };
  /** The walker's answer through the real controls (spec §5.3). The EXP pool is already on the unit the walker chose, so dialog 162 gets every bar at 0 before 결정. */
  const applyAnswer = (a: { kind: WalkModalKind; value: number }): void => {
    const top = dialogs.top;
    let ok = false;
    switch (a.kind) {
      case 'message': { const b = dialogue.modal.querySelector<HTMLElement>('button'); if (b) { b.click(); ok = true; } break; }
      case 'ask': ok = press(top, a.value ? 6 : 7); break;
      case 'save': ok = press(top, 2); break;
      case 'shop': ok = press(top, 1078); break;
      case 'result': {
        for (const bar of top?.querySelectorAll<HTMLInputElement>('input.w95-bar') ?? []) { bar.value = '0'; bar.dispatchEvent(new Event('input', { bubbles: true })); }
        ok = press(top, 1); break;
      }
    }
    if (!ok) world.log(`warn:walk no dialog to answer for ${a.kind} (template ${top?.dataset['template'] ?? 'none'})`);
  };

  // ---- errors and warnings of the page
  window.addEventListener('error', (e) => { consoleList.push({ kind: 'error', text: String(e.message) }); flag('error'); });
  window.addEventListener('unhandledrejection', (e) => { consoleList.push({ kind: 'error', text: String((e as PromiseRejectionEvent).reason) }); flag('error'); });
  const consoleError = console.error.bind(console);
  console.error = (...a: unknown[]) => { consoleList.push({ kind: 'error', text: a.map(String).join(' ') }); flag('error'); consoleError(...a); };

  // ---- the game
  const from = fromUrl ? new Uint8Array(await (await fetch(fromUrl)).arrayBuffer()) : null;
  const walker = new Walker(core, tables, world, { from, stopBattles });
  ctx.onLog((kind, text) => { walker.onLog(kind, text); if (kind === 'warn') { consoleList.push({ kind: 'warn', text }); flag('warn'); } });
  if (!from) core.newGame();

  // ---- the harvester's window
  const win: WalkWindow = {
    pending: null, done: false,
    resume: () => { const r = resumeFn; resumeFn = null; r?.(); },
    manifest: () => ({ run: { seed, from: fromUrl, startedAt, frames, simulatedMs: Math.round(now), done: win.done, stopped }, shots, counts, log: walkLog, console: consoleList }),
    frameRect: () => { const r = frameEl.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; },
  };
  const startedAt = new Date().toISOString();
  (window as unknown as { __walk: WalkWindow }).__walk = win;
  const capture = async (tag: string, flags: string[]): Promise<void> => {
    shotId++;
    const file = `${String(shotId).padStart(4, '0')}-${tag}.png`, b = core.battle;
    shots.push({ id: shotId, tag, file, t: Math.round(now), stage: core.campaign.stage, battle: chapterNo, turn: b?.state.turn ?? null, mode: core.mode, flags });
    count(tag.replace(/-\d+$/, ''));
    if (!pauseForShots) return;
    await nextPaint();
    win.pending = { id: shotId, file, tag };
    await new Promise<void>((r) => { resumeFn = r; });
    win.pending = null;
  };

  // ---- observation
  let lastMap: object | null = null, mapGen = 0;
  const snapshot = (): WalkSnapshot => {
    const b = core.battle, fx = stage.effects.snapshot(now), map = stage.mapData();
    if (map !== null && map !== lastMap) mapGen++;
    lastMap = map;
    return { t: now, mode: core.mode, mapGen, turn: b?.state.turn ?? null, phase: b?.state.phase.kind ?? null, selMode: b && b.state.phase.kind === 'player' ? b.state.phase.sel.mode : null, town: stage.townFlags !== null, visualPart: stage.visualPart, visualPlaying: stage.visualPlaying, dialogsOpened: dialogs.openedCount + messages, dialogTemplate: lastTemplate, fadeAlpha: fx.fade?.alpha ?? 0, pc: core.vm.state.pc };
  };
  const blank = (cur: WalkSnapshot): boolean => { sctx.drawImage(view, 0, 0, 32, 24); return blankFlag(blankRatio(sctx.getImageData(0, 0, 32, 24).data), cur.fadeAlpha, cur.visualPlaying); };
  const overflow = (): boolean => {
    const boxes = [...document.querySelectorAll<HTMLElement>('#win .w95-dialog, #win .w95-popup, #win .w95-window')].filter((el) => !el.hidden);
    return boxes.length > 0 && overflowing(boxes.map((el) => el.getBoundingClientRect()), screen.getBoundingClientRect()) > 0;
  };
  const loading = (): boolean => stage.pendingLoads > 0 || [...document.querySelectorAll<HTMLImageElement>('#win img, #dialogue img')].some((i) => !i.complete);
  const stuck = new StuckWatch();
  let prev: WalkSnapshot | null = null, lastTick = 0;
  const frameStep = async (): Promise<void> => { now += FRAME_MS; frames++; tick(now); await yieldNow(); };

  /** Once a battle: the screens a player opens — F2 유니트 일람 (its tabs), F3 전체 맵, the right-click popup on a party unit. Real input paths, Esc closes. */
  const uiTour = async (): Promise<void> => {
    const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('F2'); await frameStep(); await capture('ui-unitlist-1', []);
    const tabs = [...(dialogs.top?.querySelectorAll<HTMLElement>('.w95-tab') ?? [])];
    for (let i = 1; i < tabs.length && i < 4; i++) { tabs[i]!.click(); await frameStep(); await capture(`ui-unitlist-${i + 1}`, []); }
    key('Escape'); await frameStep();
    key('F3'); await frameStep(); await capture('ui-fullmap', []); key('F3'); await frameStep();
    const s = core.battle?.state, u = s ? s.units.find((v): v is Unit => v !== null && v.slot < PARTY_SLOTS && v.hp > 0 && v.status !== 9) ?? null : null;
    const p = u ? stage.cellOf(u.c, u.r) : null;
    if (u && p) {
      const r = view.getBoundingClientRect(), k = r.width / VIEW_W;
      view.dispatchEvent(new MouseEvent('contextmenu', { clientX: r.left + (p.x - stage.camera.x) * k, clientY: r.top + (p.y - stage.camera.y - 8) * k, bubbles: true, cancelable: true }));
      await frameStep(); await capture('ui-popup', []); key('Escape'); await frameStep();
    }
  };

  // ---- the loop
  /** The virtual clock holds while assets load; the frame is drawn again once they are here (the first draw was without them). */
  const settle = async (): Promise<void> => {
    if (!loading()) return;
    let waited = 0;
    while (loading() && waited < ASSET_WAIT_MAX_MS) { await sleep(ASSET_WAIT_MS); waited += ASSET_WAIT_MS; }
    if (waited >= ASSET_WAIT_MAX_MS) world.log('warn:walk asset wait timed out');
    draw(now);
  };
  for (;;) {
    await settle();
    while (answers.length > 0) applyAnswer(answers.shift()!);
    const r = walker.step(now);
    if (r === 'stop') { stopped = walker.summary().stopped; break; }
    if (r === 'frame') { now += FRAME_MS; frames++; tick(now); await settle(); }
    const cur = snapshot();
    const moments = momentsBetween(prev, cur, lastTick); prev = cur;
    if (moments.includes('tick')) lastTick = now;
    if (moments.includes('battle-start')) chapterNo++;
    if (blank(cur)) flag('blank');
    if (overflow()) flag('overflow');
    if (stuck.update(cur)) { flag('stuck'); stopped = 'stuck'; }
    const flags = pendingFlags.splice(0);
    for (const m of [...moments, ...flags]) await capture(m, flags);
    if (moments.includes('battle-start')) { await uiTour(); prev = snapshot(); }   // the tour's own boxes are not moments
    if (stopped) break;
    if (walker.finished) { await capture('end', []); break; }
    await yieldNow();
  }
  win.done = true;
  console.info(`walk: done — ${shots.length} pictures, ${frames} frames, ${Math.round(now / 1000)} s simulated, stopped ${stopped ?? 'no'}; ${JSON.stringify(counts)}`);
}
