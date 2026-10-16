import type { Campaign } from '../game/campaign';
import { findUnit } from '../game/campaign';
import { SPEAKER_NAMES } from '../ui/panel';
import type { Host, ModalKind, Resources, Restore, Where } from './host';
import { face, findLabel, list, num, str, type Instr, type Program } from './program';

export type StepResult = 'running' | 'waiting' | 'ended';
type Flow = 'next' | 'wait' | 'jumped' | 'end';
const MAX_PER_FRAME = 1000;
const stageName = (n: number) => `event${String(n).padStart(2, '0')}`;

/** TEXT markup: '_' is a space; '*' is stripped [추정]; [Snn]/[Cnn] tags stay for the dialogue renderer. */
export const scriptText = (s: string): string => s.replace(/_/g, ' ').replace(/\*/g, '');

/** Interprets one event program a frame at a time (event_script_format.md §2–§5). */
export class ScriptVm {
  readonly state: { pc: number; program: Program | null; result: number; less: number; callReturn: { program: Program; pc: number } | null; restore: Restore; pendingStage: number | null } =
    { pc: 0, program: null, result: 0, less: 0, callReturn: null, restore: 'previous', pendingStage: null };
  protected wait: { pc: number; until: number } | null = null;
  protected modalOpen = false;
  private timer = 0;
  private window: { where: Where; speaker: number; firstLine: boolean } | null = null;

  constructor(protected readonly res: Resources, protected readonly c: Campaign, protected readonly host: Host) {}

  /** FUN_004083b0: load the stage file and jump to the label; false when either is missing. */
  run(stage: number, label: string): boolean {
    const program = this.res.program(stage);
    if (!program) { this.host.log('warn', `${stageName(stage)}: no such program`); return false; }
    const pc = findLabel(program, label);
    if (pc === null) { this.host.log('warn', `${stageName(stage)}: no label ${label}`); return false; }
    this.state.program = program; this.state.pc = pc; this.wait = null; this.modalOpen = false; this.window = null;
    return true;
  }

  get running(): boolean { return this.state.program !== null; }

  step(now: number): StepResult {
    for (let n = 0; n < MAX_PER_FRAME; n++) {
      const p = this.state.program;
      if (!p) return 'ended';
      const ins = p.code[this.state.pc];
      if (!ins) return this.end();
      const r = this.exec(ins, now);
      if (r === 'wait') return 'waiting';
      if (r === 'end') return this.end();
      if (r === 'next') this.state.pc++;
    }
    return 'running';
  }

  private end(): StepResult {
    if (this.state.pendingStage !== null) {
      const stage = this.state.pendingStage; this.state.pendingStage = null;
      this.c.stage = stage;
      if (this.run(stage, 'begin')) return 'running';
    }
    this.state.program = null;
    this.host.scriptEnded(this.state.restore);
    this.state.restore = 'previous';
    return 'ended';
  }

  private jump(label: string): Flow {
    const p = this.state.program!;
    const pc = findLabel(p, label);
    if (pc === null) { this.host.log('warn', `${stageName(p.stage)}: no label ${label}`); return 'end'; }
    this.state.pc = pc;
    return 'jumped';
  }

  /** Hold this instruction until `until`; the first call arms the timer. */
  protected waitUntil(now: number, until: () => number): Flow {
    if (!this.wait || this.wait.pc !== this.state.pc) this.wait = { pc: this.state.pc, until: until() };
    if (now < this.wait.until) return 'wait';
    this.wait = null;
    return 'next';
  }

  protected modal(kind: ModalKind, payload: unknown): { done: boolean; result: number } {
    if (!this.modalOpen) { this.host.openModal(kind, payload); this.modalOpen = true; }
    const r = this.host.modalResult();
    if (r === null) return { done: false, result: 0 };
    this.modalOpen = false;
    return { done: true, result: r };
  }

  /** event_script_format.md §6: speaker 14 is the named stranger, < 30 the character table, otherwise the unit's race name. */
  private speakerName(spk: number): string | null {
    if (spk === 14) return scriptText(this.c.speakerName);
    if (spk < 30) return SPEAKER_NAMES[spk] ?? null;
    const u = findUnit(this.c, spk);
    return u ? this.res.tables.race[u.race]?.name.replace(/_/g, ' ') ?? null : null;
  }

  protected exec(ins: Instr, now: number): Flow {
    const a = ins.args;
    const f = this.c.flags;
    const i = (k: number) => num(a[k]);
    const idx = (k: number) => i(k) ?? 0;
    switch (ins.op) {
      case 'END': case 'DB': return 'end';
      case 'END_RESUME': this.host.resumeBattle(); return 'end';
      case 'JUMP': return this.jump(str(a[0]) ?? '');
      case 'JUMP_IF_RESULT': return (this.state.result !== 0) === (idx(0) !== 0) ? this.jump(str(a[1]) ?? '') : 'next';
      case 'JUMP_IF_LESS': return (this.state.less !== 0) === (idx(0) !== 0) ? this.jump(str(a[1]) ?? '') : 'next';
      case 'CALL': this.state.callReturn = { program: this.state.program!, pc: this.state.pc + 1 }; return this.jump(str(a[0]) ?? '');
      case 'RETURN': { const r = this.state.callReturn; if (!r) return 'end'; this.state.callReturn = null; this.state.program = r.program; this.state.pc = r.pc; return 'jumped'; }
      case 'LOAD_SCRIPT': { const stage = idx(0); this.c.stage = stage; return this.run(stage, str(a[1]) ?? '') ? 'jumped' : 'end'; }
      case 'NEXT_STAGE': f.fill(0); for (let s = 10; s < this.c.units.length; s++) this.c.units[s] = null; this.state.pendingStage = this.c.stage + 1; return 'next';
      case 'FIELD_MODE': this.state.restore = 'battle'; this.host.fieldMode(); return 'next';
      case 'FLAG_SET': f[idx(0)] = idx(1); return 'next';
      case 'FLAG_ADD': f[idx(0)] = (f[idx(0)] ?? 0) + idx(1); return 'next';
      case 'FLAG_SUB': f[idx(0)] = (f[idx(0)] ?? 0) - idx(1); return 'next';
      case 'FLAG_CMP': { const v = f[idx(0)] ?? 0, w = idx(1); this.state.result = v === w ? 1 : 0; this.state.less = v < w ? 1 : 0; return 'next'; }
      case 'FLAGS_CLEAR': f.fill(0); return 'next';
      case 'FLAG_BIT_SET': f[idx(0)] = (f[idx(0)] ?? 0) | (1 << idx(1)); return 'next';
      case 'FLAG_BIT_CLR': f[idx(0)] = (f[idx(0)] ?? 0) & ~(1 << idx(1)); return 'next';
      case 'FLAG_BIT_TOGGLE': f[idx(0)] = (f[idx(0)] ?? 0) ^ (1 << idx(1)); return 'next';
      case 'FLAG_BIT_TEST': this.state.result = ((f[idx(0)] ?? 0) & (1 << idx(1))) !== 0 ? 1 : 0; return 'next';
      case 'STAGE_FROM_FLAG': this.c.stage = f[idx(0)] ?? 0; return 'next';
      case 'FLAG_FROM_TOWN': f[idx(0)] = this.c.townSet; return 'next';
      case 'TOWN_FLAG_SET': this.c.townFlags[idx(0)] = idx(1); return 'next';
      case 'TOWN_SET': { const s = idx(0); if (s === 1 || s === 2 || s === 3) this.c.townSet = s; return 'next'; }
      case 'TOWN_EXTRA': this.c.townExtra = idx(0) !== 0; return 'next';
      case 'RESET_PAL_STAGE0': this.host.tint('reset', 0); this.c.stage = 0; return 'next';
      // waits
      case 'WAIT': return this.waitUntil(now, () => now + idx(0));
      case 'WAIT_FADE': return this.host.fadeBusy() ? 'wait' : 'next';
      case 'WAIT_SCROLL': return this.host.scrollBusy() ? 'wait' : 'next';
      case 'WAIT_MUSIC_FADE': return this.host.musicFadeBusy() ? 'wait' : 'next';
      case 'WAIT_CLICK': { const ms = idx(0); if (this.host.takeClick()) { this.wait = null; return 'next'; } if (ms <= 0) return 'wait'; return this.waitUntil(now, () => now + ms); }
      case 'TIMER_START': this.timer = now; return 'next';
      case 'WAIT_TIMER': return now - this.timer < idx(0) * 1000 ? 'wait' : 'next';
      // screen
      case 'FADE_IN': this.host.fade('in', idx(0)); return 'next';
      case 'FADE_OUT': this.host.fade('out', idx(0)); return 'next';
      case 'SHOW_IMAGE': this.host.showImage(str(a[0]) ?? '', idx(1)); return 'next';
      case 'HIDE_IMAGE': this.host.hideImage(); return 'next';
      case 'CLEAR_SCREEN': this.host.clearScreen(); return 'next';
      case 'DIM_SCENE': this.host.tint('dim', idx(0)); return 'next';
      case 'DIM_UI': this.host.tint('dimUi', idx(0), i(1) ?? 100); return 'next';
      case 'FLASH_WHITE': this.host.tint('white', idx(0)); return 'next';
      case 'CLEAR_TEXTPAL': this.host.tint('textpal', idx(0)); return 'next';
      case 'CLEAR_FACEPAL': this.host.tint('facepal', idx(0)); return 'next';
      case 'TINT_SUNSET': this.host.tint('sunset', idx(0)); return 'next';
      case 'TINT_NIGHT': this.host.tint('night', idx(0)); return 'next';
      case 'TINT_DUSK': this.host.tint('dusk', idx(0)); return 'next';
      case 'TINT_UI_DARK': this.host.tint('uiDark', 0); return 'next';
      case 'BLACK_SPRITES': this.host.tint('black', idx(0)); return 'next';
      case 'UI_HALF_A': this.host.tint('uiHalfA', 0); return 'next';
      case 'UI_HALF_B': this.host.tint('uiHalfB', 0); return 'next';
      case 'SHAKE': this.host.shake(idx(0)); return 'next';
      case 'CAMERA_TILE': this.host.cameraTile(idx(0), idx(1)); return 'next';
      case 'CAMERA_SCROLL': this.host.cameraScroll(idx(0), idx(1), idx(2), idx(3), idx(4)); return 'next';
      // sound (the page stubs these until sub-project 5)
      case 'MUSIC': this.host.music(i(0) ?? -1); return 'next';
      case 'MUSIC_FADE': this.host.musicFade(idx(0), idx(1) !== 0); return 'next';
      case 'SOUND': this.host.sound(str(a[0]) ?? ''); return 'next';
      case 'PLAY_VISUAL': this.host.playVisual(idx(0)); return 'next';
      // dialogue
      case 'MSG_TOP': case 'MSG_BOTTOM': {
        const where: Where = ins.op === 'MSG_TOP' ? 'top' : 'bottom';
        const fc = face(a[0]);
        if (!fc || fc[0] === 0) { this.host.closeWindow(where); if (this.window?.where === where) this.window = null; return 'next'; }
        this.host.openWindow(where, fc[0], fc[1]);
        this.window = { where, speaker: fc[0], firstLine: true };
        return 'next';
      }
      case 'TEXT': {
        const w = this.window ?? { where: 'bottom' as Where, speaker: 0, firstLine: false };
        this.host.text(w.where, scriptText(str(a[0]) ?? ''), w.firstLine ? this.speakerName(w.speaker) : null);
        w.firstLine = false;
        return 'next';
      }
      case 'SET_SPEAKER_NAME': this.c.speakerName = str(a[0]) ?? ''; return 'next';
      case 'EPISODE': { this.c.episode = scriptText(str(a[0]) ?? ''); if (idx(1) === 0) return 'next'; return this.modal('episode', this.c.episode).done ? 'next' : 'wait'; }
      case 'MESSAGE': { this.c.message = scriptText(str(a[0]) ?? ''); return this.modal('message', this.c.message).done ? 'next' : 'wait'; }
      case 'ASK': { const m = this.modal('ask', str(a[0]) ?? ''); if (!m.done) return 'wait'; this.state.result = m.result !== 0 ? 1 : 0; return 'next'; }
      case 'SHOP': return this.modal('shop', list(a[0])).done ? 'next' : 'wait';
      case 'SAVE_GAME': { const m = this.modal('save', i(0) ?? -1); if (!m.done) return 'wait'; this.host.save(m.result); return 'next'; }
      case 'GAME_COMPLETE_QUIT': this.host.quitComplete(); return 'end';
      case 'WRITE_COMPLETE_FLAG': this.host.writeCompleteFlag(); return 'next';
      case 'TOWN': this.c.turn = -1; this.state.restore = 'town'; this.host.enterTown(); return 'end';
      case 'TEST_ENEMY_PHASE': this.state.result = this.host.enemyPhase() ? 1 : 0; return 'next';
      default: return this.execUnits(ins, now);
    }
  }

  /** Unit, sprite, map, item and battle instructions (plan A Task 5). */
  protected execUnits(ins: Instr, now: number): Flow {
    void now;
    this.host.log('warn', `${ins.op} is not implemented; skipped`);
    return 'next';
  }
}
