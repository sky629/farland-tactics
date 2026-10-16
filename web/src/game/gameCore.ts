import type { MapData } from '../assets/types';
import { Battle, placeUnplacedParty } from '../battle/battle';
import { BattleGrid, type Dir } from '../battle/grid';
import type { BattleEvent, Command } from '../battle/types';
import type { Unit } from '../battle/unit';
import type { Effects } from '../field/effects';
import type { Presenter } from '../field/presenter';
import { VIEW_H, VIEW_W } from '../iso/grid';
import type { Host, ModalKind, Resources, Restore, Tint, Where } from '../script/host';
import { ScriptVm } from '../script/vm';
import { townLabel } from '../town/town';
import { clampCamera } from '../viewer/scale';
import { newCampaign, type Campaign } from './campaign';

/** What the game needs from the screen, without the DOM: the field presenter, overlay effects, the map, dialogue and the town picture. */
export interface Stage {
  readonly presenter: Presenter; readonly effects: Effects;
  camera: { x: number; y: number };
  loadMap(n: number): void; mapReady(): boolean; mapData(): MapData | null; cellOf(c: number, r: number): { x: number; y: number } | null; pixelSize(): [number, number] | null;
  openWindow(where: Where, speaker: number, face: string | null): void; closeWindow(where: Where): void; text(where: Where, line: string, name: string | null): void;
  openModal(kind: ModalKind, payload: unknown): void; takeModalResult(): number | null; closeAll(): void; showEpisode(title: string): void;
  bitmap(name: string): CanvasImageSource | null;
  showTown(set: 1 | 2 | 3, extra: boolean, flags: number[]): void; hideTown(): void;
  takeClick(): boolean;
  log(kind: 'warn' | 'info', text: string): void;
}

export type Mode = 'title' | 'script' | 'town' | 'battle' | 'ended';

/** The story controller: mode machine (title → script ⇄ town ⇄ battle), the VM's Host, and the battle loop (story_flow.md §1, §4). */
export class GameCore implements Host {
  campaign: Campaign;
  vm: ScriptVm;
  battle: Battle | null = null;
  mode: Mode = 'title';
  result: 'victory' | 'defeat' | null = null;
  lastEvents: BattleEvent[] = [];
  private prevMode: Mode = 'title';
  private now = 0;
  private lastMap = 0;
  private lastRoster = 0;
  private pendingBattle = false;

  constructor(private readonly res: Resources, readonly stage: Stage) {
    this.campaign = newCampaign();
    this.vm = new ScriptVm(res, this.campaign, this);
  }

  /** FUN_004239b0 new game: fresh campaign, EVENT00 `begin`. */
  newGame(): void {
    this.campaign = newCampaign();
    this.vm = new ScriptVm(this.res, this.campaign, this);
    this.battle = null; this.result = null; this.prevMode = 'title'; this.pendingBattle = false;
    this.stage.presenter.sync(this.campaign);
    if (!this.startScript(0, 'begin')) this.mode = 'ended';
  }

  /** Run a label; remembers where to return when the script ends with nothing else to say. */
  startScript(stage: number, label: string): boolean {
    const ok = this.vm.run(stage, label);
    if (ok) { if (this.mode !== 'script') this.prevMode = this.mode; this.mode = 'script'; }
    return ok;
  }

  frame(now: number): void {
    this.now = now;
    const size = this.stage.pixelSize();
    this.stage.camera = this.stage.effects.update(now, this.stage.camera, (x, y) => (size ? clampCamera(x, y, size[0], size[1]) : { x, y }));
    this.stage.presenter.update(now);
    if (this.mode === 'script') this.vm.step(now);
    else if (this.mode === 'battle' && this.battle) this.battleFrame();
    this.followFocus(size);
  }

  private battleFrame(): void {
    const p = this.stage.presenter, b = this.battle!;
    if (p.busy) return;
    p.sync(b.state);
    if (b.state.phase.kind === 'enemy') this.handle(b.reduce({ type: 'enemyStep' }));
    else if (b.state.phase.kind === 'end') this.result = b.state.phase.result;
  }

  private followFocus(size: [number, number] | null): void {
    const f = this.stage.presenter.focus;
    if (!f || !size) return;
    const cell = this.stage.cellOf(f[0], f[1]);
    const cam = this.stage.camera;
    if (cell && (cell.x < cam.x + 64 || cell.x > cam.x + VIEW_W - 64 || cell.y < cam.y + 64 || cell.y > cam.y + VIEW_H - 64)) this.stage.camera = clampCamera(cell.x - VIEW_W / 2, cell.y - VIEW_H / 2, size[0], size[1]);
  }

  /** Battle input from the panel or a map click. */
  dispatch(cmd: Command): void {
    if (this.mode !== 'battle' || !this.battle || this.stage.presenter.busy) return;
    this.handle(this.battle.reduce(cmd));
  }

  private handle(events: BattleEvent[]): void {
    this.stage.presenter.enqueue(events);
    this.lastEvents = events;
  }

  /** A click on facility `i` of the town screen (FUN_0042b080 WM_COMMAND 0..14). */
  townSelect(i: number): void {
    if (this.mode !== 'town') return;
    if ((this.campaign.townFlags[i] ?? 0) === 0) return;
    const target = townLabel(this.res, this.campaign.stage, i);
    if (!target) { this.stage.log('warn', `town: no script for facility ${i}`); return; }
    this.stage.hideTown();
    this.startScript(target.stage, target.label);
  }

  private startBattle(): void {
    const map = this.stage.mapData();
    if (!map) { this.stage.log('warn', 'BATTLE_START without a loaded map'); this.mode = 'ended'; return; }
    const grid = new BattleGrid(map);
    placeUnplacedParty(this.campaign.units, grid);
    const entry = { event: this.campaign.stage, label: 'script', map: `stage${String(this.lastMap).padStart(2, '0')}`, roster: this.lastRoster, episode: this.campaign.episode, objective: '', heal: false };
    this.battle = new Battle({ entry, map, grid, units: this.campaign.units, turn: 1, phase: { kind: 'player', sel: { mode: 'idle' } }, rng: this.res.rng, lastPath: [], inventory: this.campaign.inventory }, this.res.tables);
    this.pendingBattle = false; this.result = null;
    this.stage.presenter.sync(this.battle.state);
    const first = this.campaign.units.find((u) => u && u.side === 0);
    if (first) this.cameraUnit(first);
  }

  private setCamera(x: number, y: number): void {
    const size = this.stage.pixelSize();
    this.stage.camera = size ? clampCamera(x, y, size[0], size[1]) : { x, y };
  }
  private syncUnits(): void { this.stage.presenter.sync(this.battle ? this.battle.state : this.campaign); }

  // ---- Host ----
  fade(dir: 'in' | 'out', step: number): void { this.stage.effects.fade(dir, step, this.now); }
  fadeBusy(): boolean { return this.stage.effects.fadeBusy(); }
  showImage(name: string, step: number): void { this.stage.effects.showImage(this.stage.bitmap(name), step, this.now); }
  hideImage(): void { this.stage.effects.hideImage(); }
  clearScreen(): void { this.stage.effects.clearScreen(); }
  tint(kind: Tint, n: number, pct?: number): void { this.stage.effects.tint(kind, n, pct); }
  shake(n: number): void { this.stage.effects.shake(n); }
  cameraTile(x: number, y: number): void { const c = this.stage.cellOf(x, y); if (c) this.setCamera(c.x - VIEW_W / 2, c.y - VIEW_H / 2); }
  cameraUnit(u: Unit): void { this.cameraTile(u.c, u.r); }
  cameraScroll(dx: number, dy: number, tx: number, ty: number, ms: number): void { this.stage.effects.startScroll(dx, dy, tx, ty, ms, (c, r) => this.stage.cellOf(c, r)); }
  scrollBusy(): boolean { return this.stage.effects.scrollBusy(); }
  openWindow(where: Where, speaker: number, face: string | null): void { this.stage.openWindow(where, speaker, face); }
  closeWindow(where: Where): void { this.stage.closeWindow(where); }
  text(where: Where, line: string, name: string | null): void { this.stage.text(where, line, name); }
  takeClick(): boolean { return this.stage.takeClick(); }
  openModal(kind: ModalKind, payload: unknown): void { this.stage.openModal(kind, payload); }
  modalResult(): number | null { return this.stage.takeModalResult(); }
  showEpisode(title: string): void { this.stage.showEpisode(title); }
  anim(): void { this.syncUnits(); }
  unitBusy(u: Unit): boolean { return this.stage.presenter.unitBusy(u.slot); }
  moveUnit(u: Unit, dirs: Dir[], animBase: string): void { this.stage.presenter.moveUnit(u.slot, dirs, animBase); }
  marker(): void { this.syncUnits(); }
  sweat(u: Unit): void { this.stage.presenter.sweat(u.slot); }
  appear(): void { this.syncUnits(); }
  vanish(): void { this.syncUnits(); }
  showOnly(): void { this.syncUnits(); }
  setVisible(): void { this.syncUnits(); }
  allVisible(): void { this.syncUnits(); }
  resetSprites(): void { this.syncUnits(); }
  loadMap(n: number): void { this.lastMap = n; this.stage.loadMap(n); }
  mapBusy(): boolean { return !this.stage.mapReady(); }
  unitsChanged(): void { this.syncUnits(); }
  music(n: number): void { this.stage.log('info', `music ${n}`); }
  musicFade(ms: number, on: boolean): void { this.stage.log('info', `music fade ${on ? 'in' : 'out'} ${ms}`); }
  musicFadeBusy(): boolean { return false; }
  sound(name: string): void { this.stage.log('info', `sound ${name}`); }
  playVisual(n: number): void { this.stage.log('info', `visual scene ${n} skipped`); }
  save(slot: number): void { this.stage.log('info', `save ${slot} (not yet)`); }
  quitComplete(): void { this.mode = 'ended'; this.stage.log('info', 'game complete'); }
  writeCompleteFlag(): void { this.stage.log('info', 'complete flag'); }
  enterBattle(): void { this.pendingBattle = true; }
  resumeBattle(): void { /* plan B Task 4: perform the held action */ }
  enterTown(): void { /* the switch happens in scriptEnded('town') */ }
  fieldMode(): void { /* the VM records the restore mode */ }
  enemyPhase(): boolean { return this.battle?.state.phase.kind === 'enemy'; }
  scriptEnded(restore: Restore): void {
    this.stage.closeAll();
    if (restore === 'town') { this.toTown(); return; }
    if (restore === 'battle' || this.pendingBattle) { if (!this.battle || this.pendingBattle) this.startBattle(); if (this.battle) this.toBattle(); return; }
    if (this.prevMode === 'battle' && this.battle) { this.toBattle(); return; }
    if (this.prevMode === 'town') { this.toTown(); return; }
    this.mode = 'ended';
    this.stage.log('warn', 'script ended with nowhere to return');
  }
  log(kind: 'warn' | 'info', text: string): void { this.stage.log(kind, text); }

  private toTown(): void { this.mode = 'town'; this.stage.showTown(this.campaign.townSet, this.campaign.townExtra, this.campaign.townFlags); }
  private toBattle(): void {
    const b = this.battle!;
    if (b.state.phase.kind === 'player') b.state.phase = { kind: 'player', sel: { mode: 'idle' } };
    this.stage.presenter.sync(b.state);
    this.mode = 'battle';
  }
}
