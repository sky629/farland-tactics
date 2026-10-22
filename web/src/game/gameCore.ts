import { isTreasure } from '../battle/unit';
import type { MapData } from '../assets/types';
import { Battle, placeUnplacedParty } from '../battle/battle';
import { BattleGrid, hostile, type Dir } from '../battle/grid';
import type { BattleEvent, Command } from '../battle/types';
import type { Unit } from '../battle/unit';
import type { Effects } from '../field/effects';
import type { Presenter } from '../field/presenter';
import { VIEW_H, VIEW_W } from '../iso/grid';
import type { Host, ModalKind, Resources, Restore, Tint, Where } from '../script/host';
import { findLabel } from '../script/program';
import { ScriptVm, scriptText } from '../script/vm';

const TURN_HISTORY = 20;                                                       // turn starts kept for 턴 되돌리기
import { townLabel } from '../town/town';
import { clampCamera } from '../viewer/scale';
import { scenes } from '../visual/scenes';
import { dispatch, type SceneDef } from '../visual/timeline';
import { decodeSave, encodeSave, SaveError } from '../save/format';
import { newCampaign, type Campaign } from './campaign';

/** What the game needs from the screen, without the DOM: the field presenter, overlay effects, the map, dialogue and the town picture. */
export interface Stage {
  readonly presenter: Presenter; readonly effects: Effects;
  camera: { x: number; y: number };
  /** LOAD_MAP n: load `stage%02d`; n < 0 unloads the map at once (FUN_0042d5d0 frees the map and returns 1 for a negative number). */
  loadMap(n: number): void; mapReady(): boolean; mapData(): MapData | null; cellOf(c: number, r: number): { x: number; y: number } | null; pixelSize(): [number, number] | null;
  openWindow(where: Where, speaker: number, face: string | null): void; closeWindow(where: Where): void; text(where: Where, line: string, name: string | null): void;
  openModal(kind: ModalKind, payload: unknown): void; takeModalResult(): number | null; closeAll(): void; showEpisode(title: string): void;
  bitmap(name: string): CanvasImageSource | null;
  showTown(set: 1 | 2 | 3, extra: boolean, flags: number[]): void; hideTown(): void;
  takeClick(): boolean;
  writeSave(slot: number, bytes: Uint8Array): void;   // the page stores it (IndexedDB) and refreshes its slot list
  playSound(name: string): void; playMusic(n: number): void; stopMusic(): void; fadeMusic(ms: number, on: boolean): void; musicFadeBusy(): boolean;
  startVisual(def: SceneDef, part: number): void; visualDone(): boolean;   // a scene plays on the stage; a click there skips it
  log(kind: 'warn' | 'info', text: string): void;
}

export type Mode = 'title' | 'script' | 'town' | 'battle' | 'ended';

/** Story work queued behind the battle presentation (story_flow.md §5): a pre-action script, per-target labels, the settle step, level-up and end labels. */
type Hook =
  | { kind: 'script'; stage: number; label: string }
  | { kind: 'target'; slot: number; actor: number }
  | { kind: 'settle' }
  | { kind: 'levelup'; actor: number }
  | { kind: 'end'; result: 'victory' | 'defeat' };

const nn = (id: number): string => String(id).padStart(2, '0');

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
  private completed = false;                                                   // WRITE_COMPLETE_FLAG seen: the next script end is the ending
  /** The original's INI CompleteFlag: the menus offer BGM 선택 once it is set. */
  get complete(): boolean { return this.completed; }
  private hooks: Hook[] = [];

  constructor(private readonly res: Resources, readonly stage: Stage) {
    this.campaign = newCampaign();
    this.vm = new ScriptVm(res, this.campaign, this);
  }

  /** FUN_004239b0 new game: fresh campaign, EVENT00 `begin`. */
  newGame(): void {
    this.campaign = newCampaign();
    this.vm = new ScriptVm(this.res, this.campaign, this);
    this.battle = null; this.result = null; this.prevMode = 'title'; this.pendingBattle = false; this.completed = false; this.hooks = [];
    this.stage.closeAll(); this.stage.hideTown();                               // a second new game in one page (after a game over): no town, window or box of the last one
    this.stage.presenter.sync(this.campaign);
    if (!this.startScript(0, 'begin')) this.mode = 'ended';
  }

  /** The campaign as the original save file (file_formats.md §6). */
  saveBytes(): Uint8Array {
    if (this.battle) this.campaign.turn = this.battle.state.turn - 1;         // the header counts finished rounds (0 at BATTLE_START); the Battle counts the current one
    return encodeSave(this.campaign, new Date(), (w) => this.stage.log('warn', w));
  }

  /** FUN_004239b0 load: replace the campaign, drop battle and screens, run `Restart` (EVENT00 while in town, else the stage file), resume the music. */
  loadGame(bytes: Uint8Array): boolean {
    let c: Campaign;
    try { c = decodeSave(bytes, this.res.tables, (w) => this.stage.log('warn', w)); } catch (e) { this.stage.log('warn', e instanceof SaveError ? e.message : String(e)); return false; }
    this.campaign = c;
    this.vm = new ScriptVm(this.res, c, this);
    this.battle = null; this.result = null; this.hooks = []; this.pendingBattle = false; this.completed = false;
    this.turnStarts = [bytes];                                                 // a loaded save is where 턴 되돌리기 stops
    this.stage.closeAll(); this.stage.hideTown();
    this.mode = 'title'; this.prevMode = 'title';
    this.stage.presenter.sync(c);
    const stage = c.turn < 0 ? 0 : c.stage;
    if (!this.startScript(stage, 'Restart')) { this.stage.log('warn', `세이브를 이어갈 Restart 라벨이 event${String(stage).padStart(2, '0')} 에 없다`); this.mode = 'title'; return false; }
    if (c.bgm > 0) this.music(c.bgm);
    return true;
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
    if (this.mode === 'script') { if (!this.stage.presenter.busy) this.stage.presenter.sync(this.campaign); this.vm.step(now); }   // SET_DIR & co. have no host call
    else if (this.mode === 'battle' && this.battle) this.battleFrame();
    this.followFocus(size);
    this.stage.presenter.scriptMode = this.mode === 'script';                    // the frame is drawn after this: waiting party units stand in SET while a script runs
  }

  private battleFrame(): void {
    const p = this.stage.presenter, b = this.battle!;
    if (p.busy) return;
    if (this.hooks.length > 0) { this.processHooks(); if (this.mode !== 'battle' || p.busy || this.hooks.length > 0) return; }
    p.sync(b.state);
    if (b.state.phase.kind === 'enemy') this.handle(b.reduce({ type: 'enemyStep' }));
  }

  /** Runs queued hooks until one starts a script or the presenter has something to play. */
  private processHooks(): void {
    const b = this.battle!, c = this.campaign;
    while (this.hooks.length > 0 && this.mode === 'battle' && !this.stage.presenter.busy) {
      const h = this.hooks.shift()!;
      switch (h.kind) {
        case 'script': this.startScript(h.stage, h.label); break;
        case 'target': this.targetHook(h.slot, h.actor); break;
        case 'settle': this.handle(b.settle()); break;
        case 'levelup': { const a = c.units[h.actor]; if (a) { c.actor = a.slot; this.runLabel(0, `levelup${nn(a.id)}`); } break; }
        case 'end': if (h.result === 'victory') this.runLabel(c.stage, 'COMPLETE'); else this.runLabel(0, 'GAMEOVER'); break;
      }
    }
  }

  /** FUN_0043a2e0 case 4 for one target: BEAT/AFTER of the target (or ASSIST of a helping party unit), else WIN of a party actor that felled it. */
  private targetHook(slot: number, actorSlot: number): void {
    const c = this.campaign, t = c.units[slot], a = c.units[actorSlot] ?? null;
    if (!t) return;
    c.battleTarget = t.slot; c.actor = a?.slot ?? null;
    if (t.id !== 8 && !isTreasure(t)) {                                          // a drop keeps its foe's id (removeFallen) but has no story hooks of its own
      const own = t === a || !a || a.side !== 0 || t.side !== 0;
      const label = own ? `${t.status === 1 ? 'BEAT' : 'AFTER'}${nn(t.id)}` : `ASSIST${nn(a.id)}`;
      if (this.runLabel(c.stage, label)) return;
    }
    if (t.status === 1 && a && a.side === 0) this.runLabel(c.stage, `WIN${nn(a.id)}`);
  }

  /** FUN_0043af00: a `battle%02d` label (first hostile target's id, or the actor's when that target is a party unit) runs before the action. */
  private beforeAction(a: Unit, targets: Unit[]): boolean {
    const t = targets.find((x) => hostile(a, x));
    if (!t) return false;
    const label = `battle${nn(t.side !== 0 ? t.id : a.id)}`;
    if (!this.hasLabel(this.campaign.stage, label)) return false;
    this.campaign.battleTarget = t.slot; this.campaign.actor = a.slot;
    this.hooks.unshift({ kind: 'script', stage: this.campaign.stage, label });
    return true;
  }

  private hasLabel(stage: number, label: string): boolean {
    const p = this.res.program(stage);
    return p !== null && findLabel(p, label) !== null;
  }
  private runLabel(stage: number, label: string): boolean {
    return this.hasLabel(stage, label) && this.startScript(stage, label);
  }

  private queueHooks(events: BattleEvent[]): void {
    for (const e of events) {
      if (e.type === 'action') {
        const seen = new Set<number>();
        for (const h of e.hits) if (!seen.has(h.target)) { seen.add(h.target); this.hooks.push({ kind: 'target', slot: h.target, actor: e.slot }); }
        this.hooks.push({ kind: 'settle' });
      } else if (e.type === 'levelUp' && !this.hooks.some((h) => h.kind === 'levelup' && h.actor === e.slot)) this.hooks.push({ kind: 'levelup', actor: e.slot });   // once per unit however many levels the blow gave (the original grows N times, then runs levelup%02d once)
      else if (e.type === 'end') { this.result = e.result; this.hooks.push({ kind: 'end', result: e.result }); }   // before the hook runs the COMPLETE/GAMEOVER script
    }
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
    if (this.mode !== 'battle' || !this.battle || this.stage.presenter.busy || this.hooks.length > 0) return;
    this.handle(this.battle.reduce(cmd));
  }

  private handle(events: BattleEvent[]): void {
    this.stage.presenter.enqueue(events);
    this.lastEvents = events;
    this.queueHooks(events);
    if (events.some((e) => e.type === 'roundStart')) this.save(31);          // turn-end autosave (story_flow.md §4)
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

  /**
   * A Battle over the campaign units. `fresh` = BATTLE_START (place the party, round 1, autosave slot 30);
   * otherwise a FIELD_MODE return with no Battle alive (a loaded mid-battle save): continue from the saved round, no autosave.
   */
  private createBattle(fresh: boolean): void {
    const map = this.stage.mapData();
    if (!map) { this.stage.log('warn', `${fresh ? 'BATTLE_START' : 'FIELD_MODE'} without a loaded map`); this.mode = 'ended'; return; }
    const grid = new BattleGrid(map);
    if (fresh) placeUnplacedParty(this.campaign.units, grid);
    const entry = { event: this.campaign.stage, label: 'script', map: `stage${String(this.lastMap).padStart(2, '0')}`, roster: this.lastRoster, episode: this.campaign.episode, objective: scriptText(this.campaign.message), heal: false };   // 클리어 조건 shows the script's last MESSAGE (saved in the header too)
    const turn = Math.max(this.campaign.turn, 0) + 1;                          // the header counts finished rounds
    this.battle = new Battle({ entry, map, grid, units: this.campaign.units, turn, phase: { kind: 'player', sel: { mode: 'idle' } }, rng: this.res.rng, lastPath: [], inventory: this.campaign.inventory }, this.res.tables,
      { beforeAction: (a, _action, targets) => this.beforeAction(a, targets), deferSettle: true });
    this.pendingBattle = false; this.result = null; this.hooks = [];
    this.stage.presenter.sync(this.battle.state);
    const first = this.campaign.units.find((u) => u && u.side === 0);
    if (first) this.cameraUnit(first);
    if (fresh) this.save(30);                                                  // FUN_00423820(30): autosave at battle start only
  }

  private setCamera(x: number, y: number): void {
    const size = this.stage.pixelSize();
    this.stage.camera = size ? clampCamera(x, y, size[0], size[1]) : { x, y };
  }
  private syncUnits(): void { this.stage.presenter.sync(this.battle ? this.battle.state : this.campaign); }

  // ---- Host ----
  fade(dir: 'in' | 'out', step: number): void { this.stage.effects.fade(dir, step, this.now); }
  fadeBusy(): boolean { return this.stage.effects.fadeBusy(); }
  showImage(name: string, step: number): void { this.stage.effects.showImage(() => this.stage.bitmap(name), step, this.now); }
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
  moveTo(u: Unit, anim: string): void {
    this.stage.presenter.moveTo(u.slot, anim, (dx, dy) => {                   // the knock-back stays where the anim left the unit
      const sp = u.sprite ?? (u.sprite = {});
      const o = sp.offset ?? { x: 0, y: 0 };
      sp.offset = { x: o.x + dx, y: o.y + dy };
      this.syncUnits();
    });
  }
  marker(): void { this.syncUnits(); }
  sweat(u: Unit): void { this.stage.presenter.sweat(u.slot); }
  appear(): void { this.syncUnits(); }
  vanish(): void { this.syncUnits(); }
  showOnly(): void { this.syncUnits(); }
  setVisible(): void { this.syncUnits(); }
  allVisible(): void { this.syncUnits(); }
  resetSprites(): void { this.syncUnits(); }
  loadMap(n: number): void { this.lastMap = n; this.stage.loadMap(n); this.stage.camera = { x: 0, y: 0 }; }   // FUN_0042d5d0 zeroes the scroll with the map: a scenery cut without a camera command shows the map's top-left
  mapBusy(): boolean { return !this.stage.mapReady(); }
  unitsChanged(): void { this.syncUnits(); }
  music(n: number): void { if (n < 0) this.stage.stopMusic(); else this.stage.playMusic(n); }
  musicFade(ms: number, on: boolean): void { this.stage.fadeMusic(ms, on); }
  musicFadeBusy(): boolean { return this.stage.musicFadeBusy(); }
  sound(name: string): void { this.stage.playSound(name); }
  /** PLAY_VISUAL n: table 0x449598 picks the scene and its first part; the VM waits on visualBusy() until the stage is done. */
  playVisual(n: number): void {
    const d = dispatch(n), def = d ? scenes[d.scene] : undefined;
    if (!d || !def) { this.stage.log('warn', `PLAY_VISUAL ${n}: 전사된 장면이 없다`); return; }
    this.stage.startVisual(def, d.part);
  }
  visualBusy(): boolean { return !this.stage.visualDone(); }
  save(slot: number): void {
    if (slot < 0) return;
    const bytes = this.saveBytes();
    this.stage.writeSave(slot, bytes); this.stage.log('info', `save ${String(slot).padStart(2, '0')}`);
    if (slot === 30) this.turnStarts = [bytes];                                 // the battle start is the floor of 턴 되돌리기
    else if (slot === 31) { this.turnStarts.push(bytes); if (this.turnStarts.length > TURN_HISTORY) this.turnStarts.splice(0, this.turnStarts.length - TURN_HISTORY); }
  }

  /** 턴 되돌리기 (web-only): the state at each turn's start — the battle-start autosave, then every turn-end autosave — newest last. */
  private turnStarts: Uint8Array[] = [];
  /** Possible in a battle during the player's phase with nothing in flight, when the party did something this turn or an earlier turn start is kept. */
  canUndoTurn(): boolean {
    const b = this.battle;
    if (this.mode !== 'battle' || !b || b.state.phase.kind !== 'player' || this.stage.presenter.busy || this.hooks.length > 0) return false;
    return this.partyActed() || this.turnStarts.length > 1;
  }
  private partyActed(): boolean { return this.battle!.state.units.some((u) => u !== null && u.side === 0 && (u.moved || u.acted)); }
  /** Back to the start of this turn; with nothing done this turn, to the start of the previous one. The reload runs the stage's Restart like a loaded save. */
  undoTurn(): boolean {
    if (!this.canUndoTurn()) return false;
    const stack = this.turnStarts;
    if (!this.partyActed()) stack.pop();
    const ok = this.loadGame(stack[stack.length - 1]!);
    this.turnStarts = stack;                                                   // loadGame made the snapshot the new floor; the history stays
    return ok;
  }
  quitComplete(): void { this.battle = null; this.mode = 'ended'; this.stage.log('info', 'game complete'); }
  /** INI CompleteFlag in the original; here it marks the ending: event17 writes it, shows the title picture and ENDs. */
  writeCompleteFlag(): void { this.completed = true; }
  enterBattle(): void { this.pendingBattle = true; }
  resumeBattle(): void { if (this.battle) this.handle(this.battle.resume()); }
  enterTown(): void { /* the switch happens in scriptEnded('town') */ }
  fieldMode(): void { /* the VM records the restore mode */ }
  enemyPhase(): boolean { return this.battle?.state.phase.kind === 'enemy'; }
  scriptEnded(restore: Restore): void {
    this.stage.closeAll();
    if (this.completed) { this.quitComplete(); return; }
    if (restore === 'town') { this.toTown(); return; }
    if (this.pendingBattle) { this.createBattle(true); if (this.battle) this.toBattle(); return; }   // BATTLE_START: a new battle, whatever came before
    const over = this.battle?.state.phase.kind === 'end';                      // a finished battle is revisited only for the hooks still queued (levelup → COMPLETE)
    if (over && this.hooks.length === 0 && this.result === 'defeat') {         // the GAMEOVER script (event00: title picture, END) has ended
      this.battle = null; this.mode = 'ended'; this.stage.log('info', 'game over'); return;
    }
    if (restore === 'battle' || (this.prevMode === 'battle' && this.battle)) {
      if (!this.battle) this.createBattle(false);                              // FIELD_MODE after a load: resume, do not restart
      if (this.battle && (!over || this.hooks.length > 0)) { this.toBattle(); return; }
    }
    if (this.prevMode === 'town') { this.toTown(); return; }
    this.mode = 'ended';
    this.stage.log('warn', 'script ended with nowhere to return');
  }
  log(kind: 'warn' | 'info', text: string): void { this.stage.log(kind, text); }

  private toTown(): void {
    this.battle = null; this.hooks = [];                                       // TOWN leaves the field (turn −1)
    this.mode = 'town';
    this.stage.showTown(this.campaign.townSet, this.campaign.townExtra, this.campaign.townFlags);
  }
  private toBattle(): void {
    this.stage.presenter.sync(this.battle!.state);
    this.mode = 'battle';
  }
}
