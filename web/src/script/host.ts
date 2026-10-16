import type { Dir } from '../battle/grid';
import type { RandomSource } from '../battle/rng';
import type { Unit } from '../battle/unit';
import type { RosterUnit, Tables } from '../data/types';
import type { Program } from './program';

/** Synchronous access to preloaded programs and rosters (the page loads them before a script runs). */
export interface Resources { program(stage: number): Program | null; roster(n: number): RosterUnit[] | null; tables: Tables; rng: RandomSource }

export type Where = 'top' | 'bottom';
export type Tint = 'dim' | 'sunset' | 'night' | 'dusk' | 'white' | 'uiDark' | 'uiHalfA' | 'uiHalfB' | 'textpal' | 'facepal' | 'black' | 'dimUi' | 'reset';
export type ModalKind = 'message' | 'ask' | 'shop' | 'result' | 'save';
export type Restore = 'battle' | 'town' | 'previous';

/** Every side effect a script can have (spec §7). The VM never touches the DOM or the canvas itself. */
export interface Host {
  fade(dir: 'in' | 'out', step: number): void; fadeBusy(): boolean;
  showImage(name: string, step: number): void; hideImage(): void; clearScreen(): void;
  tint(kind: Tint, n: number, pct?: number): void; shake(n: number): void;
  cameraTile(x: number, y: number): void; cameraUnit(u: Unit): void; cameraScroll(dx: number, dy: number, tx: number, ty: number, ms: number): void; scrollBusy(): boolean;
  openWindow(where: Where, speaker: number, faceLetter: string | null): void; closeWindow(where: Where): void;
  text(where: Where, line: string, speakerName: string | null): void;
  takeClick(): boolean;
  openModal(kind: ModalKind, payload: unknown): void; modalResult(): number | null;
  showEpisode(title: string): void;                        // EPISODE n≠0: centred title, no wait (FUN_0040d4c0)
  anim(u: Unit, name: string, loop: boolean, force: boolean): void; unitBusy(u: Unit, withEffects: boolean): boolean;
  moveUnit(u: Unit, dirs: Dir[], animBase: string): void;
  moveTo(u: Unit, anim: string): void;                     // EXT MOVE_TO: the anim's M offsets carry the unit (FUN_004383d0)
  marker(u: Unit, on: boolean): void; sweat(u: Unit): void; appear(u: Unit, ms: number): void; vanish(u: Unit, ms: number): void;
  showOnly(u: Unit): void; setVisible(u: Unit, on: boolean): void; allVisible(on: boolean): void;
  resetSprites(): void; loadMap(n: number): void; mapBusy(): boolean; unitsChanged(): void;
  music(n: number): void; musicFade(ms: number, on: boolean): void; musicFadeBusy(): boolean; sound(name: string): void;
  playVisual(n: number): void; visualBusy(): boolean; save(slot: number): void; quitComplete(): void; writeCompleteFlag(): void;
  enterBattle(): void; resumeBattle(): void; enterTown(): void; fieldMode(): void; enemyPhase(): boolean;
  scriptEnded(restore: Restore): void;
  log(kind: 'warn' | 'info', text: string): void;
}

/** Records every call; waits are driven by its public fields. */
export class FakeHost implements Host {
  calls: [string, ...unknown[]][] = [];
  clicks = 0;
  fading = false;
  scrolling = false;
  loading = false;
  musicFading = false;
  busyUnits = new Set<number>();
  modal: number | null = 0;          // what modalResult() returns; null keeps a modal open
  enemy = false;
  private rec(name: string, ...args: unknown[]): void { this.calls.push([name, ...args]); }
  fade(dir: 'in' | 'out', step: number): void { this.rec('fade', dir, step); this.fading = step > 0; }   // a fade starts busy; tests clear `fading` to finish it
  fadeBusy(): boolean { return this.fading; }
  showImage(name: string, step: number): void { this.rec('showImage', name, step); }
  hideImage(): void { this.rec('hideImage'); }
  clearScreen(): void { this.rec('clearScreen'); }
  tint(kind: Tint, n: number, pct?: number): void { this.rec('tint', kind, n, pct); }
  shake(n: number): void { this.rec('shake', n); }
  cameraTile(x: number, y: number): void { this.rec('cameraTile', x, y); }
  cameraUnit(u: Unit): void { this.rec('cameraUnit', u.slot); }
  cameraScroll(dx: number, dy: number, tx: number, ty: number, ms: number): void { this.rec('cameraScroll', dx, dy, tx, ty, ms); }
  scrollBusy(): boolean { return this.scrolling; }
  openWindow(where: Where, speaker: number, faceLetter: string | null): void { this.rec('openWindow', where, speaker, faceLetter); }
  closeWindow(where: Where): void { this.rec('closeWindow', where); }
  text(where: Where, line: string, speakerName: string | null): void { this.rec('text', where, line, speakerName); }
  takeClick(): boolean { if (this.clicks > 0) { this.clicks--; return true; } return false; }
  openModal(kind: ModalKind, payload: unknown): void { this.rec('openModal', kind, payload); }
  modalResult(): number | null { return this.modal; }
  showEpisode(title: string): void { this.rec('showEpisode', title); }
  anim(u: Unit, name: string, loop: boolean, force: boolean): void { this.rec('anim', u.slot, name, loop, force); }
  unitBusy(u: Unit, withEffects: boolean): boolean { void withEffects; return this.busyUnits.has(u.slot); }
  moveUnit(u: Unit, dirs: Dir[], animBase: string): void { this.rec('moveUnit', u.slot, dirs, animBase); }
  moveTo(u: Unit, anim: string): void { this.rec('moveTo', u.slot, anim); }
  marker(u: Unit, on: boolean): void { this.rec('marker', u.slot, on); }
  sweat(u: Unit): void { this.rec('sweat', u.slot); }
  appear(u: Unit, ms: number): void { this.rec('appear', u.slot, ms); }
  vanish(u: Unit, ms: number): void { this.rec('vanish', u.slot, ms); }
  showOnly(u: Unit): void { this.rec('showOnly', u.slot); }
  setVisible(u: Unit, on: boolean): void { this.rec('setVisible', u.slot, on); }
  allVisible(on: boolean): void { this.rec('allVisible', on); }
  resetSprites(): void { this.rec('resetSprites'); }
  loadMap(n: number): void { this.rec('loadMap', n); }
  mapBusy(): boolean { return this.loading; }
  unitsChanged(): void { this.rec('unitsChanged'); }
  music(n: number): void { this.rec('music', n); }
  musicFade(ms: number, on: boolean): void { this.rec('musicFade', ms, on); }
  musicFadeBusy(): boolean { return this.musicFading; }
  sound(name: string): void { this.rec('sound', name); }
  playVisual(n: number): void { this.rec('playVisual', n); }
  visualBusy(): boolean { return false; }
  save(slot: number): void { this.rec('save', slot); }
  quitComplete(): void { this.rec('quitComplete'); }
  writeCompleteFlag(): void { this.rec('writeCompleteFlag'); }
  enterBattle(): void { this.rec('enterBattle'); }
  resumeBattle(): void { this.rec('resumeBattle'); }
  enterTown(): void { this.rec('enterTown'); }
  fieldMode(): void { this.rec('fieldMode'); }
  enemyPhase(): boolean { return this.enemy; }
  scriptEnded(restore: Restore): void { this.rec('scriptEnded', restore); }
  log(kind: 'warn' | 'info', text: string): void { this.rec('log', kind, text); }
}
