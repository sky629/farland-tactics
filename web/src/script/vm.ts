import { applyRoster, startBattle } from '../battle/battle';
import { dirTo, stepCell, type Dir } from '../battle/grid';
import { addGold, giveItem, takeItem } from '../battle/inventory';
import { growUnit, type Unit } from '../battle/unit';
import type { Campaign } from '../game/campaign';
import { createScriptUnit, findUnit, removeDead, removeScriptUnits } from '../game/campaign';
import { SPEAKER_NAMES } from '../ui/panel';
import type { Host, ModalKind, Resources, Restore, Where } from './host';
import { face, findLabel, list, num, str, type Instr, type Program } from './program';

export type StepResult = 'running' | 'waiting' | 'ended';
type Flow = 'next' | 'wait' | 'jumped' | 'end';
const MAX_PER_FRAME = 1000;
const stageName = (n: number) => `event${String(n).padStart(2, '0')}`;
const PATH_DIR: Record<string, Dir> = { s: 0, e: 1, w: 2, n: 3 };
/** Instructions whose first operand is a unit; with id 0 the original reads nothing more and does nothing. */
const UNIT_FIRST = new Set(['NOP_UNIT', 'SET_POS', 'SET_DIR', 'FACE_UNIT', 'ALL_FACE', 'REMOVE_UNIT', 'RESPRITE_UNIT', 'ANIM', 'MOVE_PATH', 'MOVE_TO', 'WAIT_UNIT', 'WAIT_UNIT2', 'CAMERA_UNIT',
  'SPRITE_OFFSET', 'SPRITE_RAISE', 'SPRITE_LAYER', 'MARKER', 'SWEAT', 'SPRITE_APPEAR', 'SPRITE_VANISH', 'SET_VISIBLE', 'SHOW_ONLY', 'SET_ACT_FLAGS', 'SET_STATUS8', 'UNIT_TO_ID8', 'KILL', 'REVIVE',
  'TEST_ACTIVE', 'TEST_IS_ACTOR', 'GIVE_ITEM_TO', 'ATTACH_SPRITE']);

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
  private resultPayload: unknown = null;
  private resumeAfterEnd = false;

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
    if (this.resumeAfterEnd) { this.resumeAfterEnd = false; this.host.resumeBattle(); }   // END_RESUME: END processing first, then the held action
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
      case 'END_RESUME': this.resumeAfterEnd = true; return 'end';
      case 'JUMP': return this.jump(str(a[0]) ?? '');
      case 'JUMP_IF_RESULT': return (this.state.result !== 0) === (idx(0) !== 0) ? this.jump(str(a[1]) ?? '') : 'next';
      case 'JUMP_IF_LESS': return (this.state.less !== 0) === (idx(0) !== 0) ? this.jump(str(a[1]) ?? '') : 'next';
      case 'CALL': this.state.callReturn = { program: this.state.program!, pc: this.state.pc + 1 }; return this.jump(str(a[0]) ?? '');
      case 'RETURN': { const r = this.state.callReturn; if (!r) return 'end'; this.state.callReturn = null; this.state.program = r.program; this.state.pc = r.pc; return 'jumped'; }
      case 'LOAD_SCRIPT': return this.run(idx(0), str(a[1]) ?? '') ? 'jumped' : 'end';   // another file; the stage variable is untouched (town scripts live in EVENT00)
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
      case 'WAIT_CLICK': {                                                   // arms on its first frame: clicks from before it do not count
        const ms = idx(0);
        if (!this.wait || this.wait.pc !== this.state.pc) { while (this.host.takeClick()) { /* drop */ } this.wait = { pc: this.state.pc, until: ms > 0 ? now + ms : Infinity }; return 'wait'; }
        if (this.host.takeClick() || now >= this.wait.until) { this.wait = null; return 'next'; }
        return 'wait';
      }
      case 'TIMER_START': this.timer = now; return 'next';
      case 'WAIT_TIMER': return now - this.timer < idx(0) * 1000 ? 'wait' : 'next';
      // screen
      case 'FADE_IN': { if (!this.wait || this.wait.pc !== this.state.pc) { this.host.fade('in', idx(0)); this.wait = { pc: this.state.pc, until: 0 }; } if (this.host.fadeBusy()) return 'wait'; this.wait = null; return 'next'; }   // the original yields until the fade completes
      case 'FADE_OUT': this.host.fade('out', idx(0)); return 'next';
      case 'SHOW_IMAGE': this.host.showImage((str(a[0]) ?? '').toLowerCase(), idx(1)); return 'next';
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
      case 'SOUND': this.host.sound((str(a[0]) ?? '').toLowerCase()); return 'next';
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
      case 'EPISODE': this.c.episode = scriptText(str(a[0]) ?? ''); if (idx(1) !== 0) this.host.showEpisode(this.c.episode); return 'next';
      case 'MESSAGE': { this.c.message = scriptText(str(a[0]) ?? ''); return this.modal('message', this.c.message).done ? 'next' : 'wait'; }
      case 'ASK': { const m = this.modal('ask', str(a[0]) ?? ''); if (!m.done) return 'wait'; this.state.result = m.result !== 0 ? 1 : 0; return 'next'; }
      case 'SHOP': return this.modal('shop', list(a[0])).done ? 'next' : 'wait';
      case 'SAVE_GAME': { const m = this.modal('save', i(0) ?? -1); if (!m.done) return 'wait'; this.host.save(m.result); return 'next'; }
      case 'GAME_COMPLETE_QUIT': this.host.quitComplete(); return 'end';
      case 'WRITE_COMPLETE_FLAG': this.host.writeCompleteFlag(); return 'next';
      case 'TOWN': this.c.turn = -1; this.state.restore = 'town'; this.host.enterTown(); return 'end';
      case 'TEST_ENEMY_PHASE': this.state.result = this.host.enemyPhase() ? 1 : 0; return 'next';
      default:
        if (ins.op.startsWith('END(') || ins.op.startsWith('UNKNOWN')) return 'end';   // the original's switch default ends the script
        return this.execUnits(ins, now);
    }
  }

  /** Unit, sprite, map, item and battle instructions (event_script_format.md §3–§4, story_flow.md). */
  protected execUnits(ins: Instr, now: number): Flow {
    void now;
    const a = ins.args;
    const i = (k: number) => num(a[k]);
    const idx = (k: number) => i(k) ?? 0;
    const items = this.res.tables.item;
    const unitArg = (k: number): Unit | null | 'skip' => { const id = i(k); if (id === null || id === 0) return 'skip'; return findUnit(this.c, id); };
    const first = unitArg(0);
    if (first === 'skip' && UNIT_FIRST.has(ins.op)) return 'next';
    if (first === null && UNIT_FIRST.has(ins.op) && ins.op !== 'ATTACH_SPRITE') { this.host.log('warn', `${ins.op}: unit ${idx(0)} not found`); return 'next'; }   // the original would misparse here; we skip loudly
    const un = first === 'skip' ? null : first;
    const sprite = (u: Unit, patch: Partial<NonNullable<Unit['sprite']>>) => { u.sprite = { ...u.sprite, ...patch }; };
    switch (ins.op) {
      case 'NOP_UNIT': return 'next';
      case 'SET_POS': if (un) { un.c = i(1) ?? un.c; un.r = i(2) ?? un.r; this.host.unitsChanged(); } return 'next';
      case 'SET_DIR': { const d = i(1) ?? 4; if (un && d >= 0 && d <= 3) un.dir = d as Dir; return 'next'; }
      case 'FACE_UNIT': { const b = unitArg(1); if (un && b && b !== 'skip' && (un.c !== b.c || un.r !== b.r)) b.dir = dirTo(b.c, b.r, un.c, un.r); return 'next'; }
      case 'ALL_FACE': if (un) for (const v of this.c.units) if (v && v !== un && (v.c !== un.c || v.r !== un.r)) v.dir = dirTo(v.c, v.r, un.c, un.r); return 'next';
      case 'REMOVE_UNIT': if (un) { this.c.units[un.slot] = null; this.host.unitsChanged(); } return 'next';
      case 'REMOVE_SCRIPT_UNITS': removeScriptUnits(this.c); this.host.unitsChanged(); return 'next';
      case 'REMOVE_DEAD': removeDead(this.c); this.host.unitsChanged(); return 'next';
      case 'LOAD_SPRITE': { const apd = (str(a[0]) ?? '').toLowerCase(); const id = idx(1); this.c.lastSprite = apd; if (!createScriptUnit(this.c, id, 7, idx(2), idx(3), apd, id < 4000 ? 3 : 5)) this.host.log('warn', 'no free unit slot'); this.host.unitsChanged(); return 'next'; }
      case 'SPRITE_REUSE': { const id = idx(0); if (this.c.lastSprite) createScriptUnit(this.c, id, 7, idx(1), idx(2), this.c.lastSprite, id < 4000 ? 3 : 5); this.host.unitsChanged(); return 'next'; }
      case 'ATTACH_SPRITE': { const apd = this.c.lastSprite; if (!apd) return 'next'; const target = un ?? createScriptUnit(this.c, idx(0), 7, 0, 0, apd, 3); if (target) sprite(target, { apd }); this.host.unitsChanged(); return 'next'; }
      case 'RESPRITE_UNIT': if (un) { const apd = `char_${String(un.race).padStart(2, '0')}${str(a[1]) ?? 'a'}`; sprite(un, { apd }); this.c.lastSprite = apd; this.host.unitsChanged(); } return 'next';
      case 'ANIM': if (un) { const raw = str(a[1]) ?? ''; const force = raw.startsWith('*'); const name = force ? raw.slice(1) : raw; const loop = idx(2) === 0; sprite(un, { anim: { name, loop, force } }); this.host.anim(un, name, loop, force); } return 'next';
      case 'MOVE_PATH': if (un) { const base = str(a[1]) ?? 'run'; const dirs = [...(str(a[2]) ?? '').toLowerCase()].map((ch) => PATH_DIR[ch]).filter((d): d is Dir => d !== undefined); for (const d of dirs) [un.c, un.r] = stepCell(un.c, un.r, d); if (dirs.length > 0) un.dir = dirs[dirs.length - 1]!; this.host.moveUnit(un, dirs, base); } return 'next';
      case 'MOVE_TO': if (un) this.host.moveTo(un, str(a[1]) ?? ''); return 'next';
      case 'WAIT_UNIT': return un && this.host.unitBusy(un, true) ? 'wait' : 'next';
      case 'WAIT_UNIT2': return un && this.host.unitBusy(un, false) ? 'wait' : 'next';
      case 'CAMERA_UNIT': if (un) this.host.cameraUnit(un); return 'next';
      case 'SPRITE_OFFSET': if (un) sprite(un, { offset: { x: idx(1), y: idx(2) } }); return 'next';
      case 'SPRITE_RAISE': if (un) sprite(un, { offset: { x: un.sprite?.offset?.x ?? 0, y: (un.sprite?.offset?.y ?? 0) - 32 } }); return 'next';
      case 'SPRITE_LAYER': if (un) sprite(un, { layer: idx(1) !== 0 ? 5 : 1 }); return 'next';
      case 'MARKER': if (un) { const on = idx(1) !== 0; sprite(un, { marker: on }); this.host.marker(un, on); } return 'next';
      case 'HIDE_MARKERS': for (const v of this.c.units) if (v?.sprite?.marker) { v.sprite.marker = false; this.host.marker(v, false); } return 'next';
      case 'SWEAT': if (un) this.host.sweat(un); return 'next';
      case 'SPRITE_APPEAR': if (un) { sprite(un, { hidden: false }); this.host.appear(un, idx(1)); } return 'next';
      case 'SPRITE_VANISH': if (un) { sprite(un, { hidden: true }); this.host.vanish(un, idx(1)); } return 'next';
      case 'SET_VISIBLE': if (un) { const on = idx(1) !== 0; if (on && un.status === 9) un.status = 0; sprite(un, { hidden: !on }); this.host.setVisible(un, on); } return 'next';
      case 'ALL_VISIBLE': { const on = idx(0) !== 0; for (const v of this.c.units) if (v) { if (on && v.status === 9) v.status = 0; sprite(v, { hidden: !on }); } this.host.allVisible(on); return 'next'; }
      case 'SHOW_ONLY': if (un) { for (const v of this.c.units) if (v) sprite(v, { hidden: v !== un }); this.host.showOnly(un); } return 'next';
      case 'RESET_SPRITES': for (const v of this.c.units) if (v) { v.sprite = undefined; v.moved = true; v.acted = true; } this.host.resetSprites(); return 'next';
      case 'UNLOCK_ANIMS': case 'LOCK_ANIMS': return 'next';
      case 'SET_ACT_FLAGS': if (un) { const on = idx(1) !== 0; un.moved = on; un.acted = on; } return 'next';
      case 'SET_STATUS8': if (un) un.status = 8; return 'next';
      case 'UNIT_TO_ID8': if (un) { un.id = 8; un.hp = 0; un.status = 1; } return 'next';
      case 'KILL': if (un) { un.hp = 0; un.mp = 0; un.status = 1; sprite(un, { hidden: true }); this.host.unitsChanged(); } return 'next';
      case 'REVIVE': if (un) { un.hp = un.hpMax; un.status = 0; } return 'next';
      case 'HEAL_ALL': for (const v of this.c.units) if (v) { v.hp = v.hpMax; v.mp = Math.trunc(v.mpMax / 2); if (v.status !== 9) v.status = 0; v.special = false; } return 'next';
      case 'DOPPEL_COPY': {
        const actor = this.c.actor === null ? null : this.c.units[this.c.actor]; const t = findUnit(this.c, 24);
        if (actor && actor.side === 0 && t) {
          t.race = actor.race; t.status = actor.status; if (t.c !== actor.c || t.r !== actor.r) t.dir = dirTo(t.c, t.r, actor.c, actor.r);
          t.hpMax = actor.hpMax; t.hp = Math.min(t.hp, actor.hpMax); t.mpMax = actor.mpMax; t.mp = Math.trunc(t.mpMax / 2); t.exp = actor.exp;
          t.str = actor.str; t.def = actor.def; t.wis = actor.wis; t.mgr = actor.mgr; t.agi = actor.agi; t.spells = [...actor.spells];
        }
        return 'next';
      }
      case 'TARGET_CLASS40': { const t = findUnit(this.c, 24); if (t) t.race = 0x40; return 'next'; }
      case 'TEST_ACTIVE': this.state.result = un && un.status !== 1 && un.side !== 7 ? 1 : 0; return 'next';
      case 'TEST_IS_ACTOR': { const actor = this.c.actor === null ? null : this.c.units[this.c.actor]; this.state.result = un && actor === un ? 1 : 0; if (this.state.result === 0) { const t = findUnit(this.c, 24); if (t) t.hp = 1; } return 'next'; }
      case 'TEST_UNITS_1_2': { const ok = (id: number) => { const v = findUnit(this.c, id); return v !== null && ![1, 3, 4, 5, 8, 9].includes(v.status) ? 1 : 0; }; this.state.result = ok(1) | ok(2); return 'next'; }
      // items and gold
      case 'GIVE_ITEM': giveItem(this.c.inventory, findUnit(this.c, 1), idx(0), i(1) ?? 1, items); return 'next';
      case 'TAKE_ITEM': takeItem(this.c.inventory, idx(0), i(1) ?? 1, items); return 'next';
      case 'GIVE_ITEM_TO': if (un) this.state.result = giveItem(this.c.inventory, un, idx(1), 1, items) ? 1 : 0; return 'next';
      case 'ADD_GOLD': addGold(this.c.inventory, idx(0)); return 'next';
      // map and battle
      case 'LOAD_MAP': { if (!this.wait || this.wait.pc !== this.state.pc) { this.host.loadMap(idx(0)); this.wait = { pc: this.state.pc, until: 0 }; } if (this.host.mapBusy()) return 'wait'; this.wait = null; return 'next'; }
      case 'LOAD_UNITS': { const n = idx(0); const recs = this.res.roster(n); if (!recs) { this.host.log('warn', `roster ${n} missing`); return 'next'; } applyRoster(this.c.units, recs, this.res.tables, this.res.rng); this.host.unitsChanged(); return 'next'; }
      case 'BATTLE_START': case 'BATTLE_START_HEAL':
        startBattle(this.c.units, ins.op === 'BATTLE_START_HEAL');
        this.c.turn = 0; this.state.restore = 'battle'; this.host.enterBattle(); return 'next';
      case 'BATTLE_RESULT': {
        if (!this.modalOpen) {
          const gold = idx(0);
          if (gold > 0) addGold(this.c.inventory, gold);
          const levelUps: { slot: number; from: number; to: number }[] = [];
          for (const v of this.c.units.slice(0, 10)) if (v) {
            const from = v.level;
            while (v.level * 100 <= v.exp && v.level < 99) { v.level++; growUnit(v, this.res.tables.race[v.race]!, true, this.res.rng, this.res.tables.magic); }
            if (v.level !== from) levelUps.push({ slot: v.slot, from, to: v.level });
          }
          this.resultPayload = { gold, param: idx(1), levelUps };
        }
        return this.modal('result', this.resultPayload).done ? 'next' : 'wait';
      }
      default:
        this.host.log('warn', `${ins.op} is not implemented; skipped`);
        return 'next';
    }
  }
}
