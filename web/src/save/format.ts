import type { Dir } from '../battle/grid';
import { MAX_SLOTS, PARTY_SLOTS, type Unit } from '../battle/unit';
import { FLAG_COUNT, newCampaign, type Campaign } from '../game/campaign';
import { decodeCp949, encodeCp949 } from './cp949';

/** `save\save%02d.dat`: header 468 B, 50 unit records of 124 B, town state block 180 B (file_formats.md §6, §7; FUN_00423820 / FUN_004239b0). */
export const HEADER_SIZE = 468;
export const UNIT_SIZE = 124;
export const TOWN_BLOCK = 180;
export const SAVE_SIZE = HEADER_SIZE + MAX_SLOTS * UNIT_SIZE + TOWN_BLOCK;   // 6848
const STACKS = 80;
const SPELL_WORDS = 10;
const TOWN_FLAGS = 15;
const UNITS_AT = HEADER_SIZE;
const TOWN_AT = HEADER_SIZE + MAX_SLOTS * UNIT_SIZE;

export class SaveError extends Error { override name = 'SaveError'; }

export interface SaveSummary { stage: number; title: string; turn: number; date: Date | null; bgm: number; gold: number; message: string }

function checked(bytes: Uint8Array): DataView {
  if (bytes.length !== SAVE_SIZE) throw new SaveError(`세이브 파일은 ${SAVE_SIZE} 바이트여야 한다 (${bytes.length})`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== HEADER_SIZE) throw new SaveError('파랜드 택틱스 2 세이브가 아니다 (헤더)');
  return v;
}

/** SYSTEMTIME (year, month, weekday, day, hour, minute, second, ms) at `off`; a zero year means "never written". */
function readTime(v: DataView, off: number): Date | null {
  const y = v.getUint16(off, true);
  if (y === 0) return null;
  return new Date(y, v.getUint16(off + 2, true) - 1, v.getUint16(off + 6, true), v.getUint16(off + 8, true), v.getUint16(off + 10, true), v.getUint16(off + 12, true), v.getUint16(off + 14, true));
}
function writeTime(v: DataView, off: number, d: Date): void {
  const w = [d.getFullYear(), d.getMonth() + 1, d.getDay(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()];
  w.forEach((x, i) => v.setUint16(off + 2 * i, x, true));
}

/** Header only — enough for a slot list. */
export function saveSummary(bytes: Uint8Array): SaveSummary {
  const v = checked(bytes);
  return { stage: v.getUint16(4, true), title: decodeCp949(bytes.subarray(6, 38)), turn: v.getInt16(38, true), date: readTime(v, 90), bgm: v.getInt16(106, true), gold: v.getUint32(108, true), message: decodeCp949(bytes.subarray(436, 468)) };
}

/** One 124-byte unit record (battle_rules.md §7). Party slots keep the bag in words 0xe..0x11, others the drop item and gold. Sprite handles (0x36..0x3d) are left 0. */
export function encodeUnit(u: Unit | null, v: DataView, off: number, warn: (s: string) => void): void {
  if (!u) return;
  const W = (i: number, x: number) => v.setUint16(off + 2 * i, x & 0xffff, true);
  const S = (i: number, x: number) => v.setInt16(off + 2 * i, x, true);
  const I = (i: number, x: number) => v.setInt32(off + 2 * i, x, true);
  W(0, u.id); W(1, u.race); W(2, u.level); W(3, u.dir); I(4, u.c); I(6, u.r); W(8, u.status); W(9, u.side);
  W(0xa, u.weapon); W(0xb, u.armor); W(0xc, u.acc[0]); W(0xd, u.acc[1]);
  if (u.slot < PARTY_SLOTS) for (let k = 0; k < 4; k++) W(0xe + k, u.bag[k] ?? 0);
  else { W(0xe, u.dropItem); W(0xf, u.dropGold); }
  W(0x12, u.hpMax); W(0x13, u.hp); W(0x14, u.mpMax); W(0x15, u.mp); W(0x16, u.exp);
  W(0x17, u.str); W(0x18, u.def); W(0x19, u.wis); W(0x1a, u.mgr); W(0x1b, u.agi);
  if (u.spells.length > SPELL_WORDS) warn(`unit ${u.slot} (id ${u.id}) knows ${u.spells.length} spells; the save keeps ${SPELL_WORDS}`);
  for (let k = 0; k < SPELL_WORDS; k++) W(0x1c + k, u.spells[k] ?? 0);
  S(0x26, u.buff.str); S(0x27, u.buff.def); S(0x28, u.buff.wis); S(0x29, u.buff.mgr); S(0x2a, u.buff.agi);
  S(0x2b, u.elem[0]); S(0x2c, u.elem[1]); S(0x2d, u.elem[2]);
  I(0x2e, u.moved ? 1 : 0); I(0x30, u.acted ? 1 : 0); I(0x32, u.special ? 1 : 0); I(0x34, u.statusCounter);
}

export function decodeUnit(v: DataView, off: number, slot: number): Unit | null {
  const W = (i: number) => v.getUint16(off + 2 * i, true);
  const S = (i: number) => v.getInt16(off + 2 * i, true);
  const I = (i: number) => v.getInt32(off + 2 * i, true);
  const id = W(0);
  if (id === 0) return null;
  const party = slot < PARTY_SLOTS;
  const spells: number[] = [];
  for (let k = 0; k < SPELL_WORDS; k++) { const s = W(0x1c + k); if (s !== 0) spells.push(s); }
  return {
    slot, id, race: W(1), level: W(2), dir: (W(3) & 3) as Dir, c: I(4), r: I(6), status: W(8), side: W(9),
    weapon: W(0xa), armor: W(0xb), acc: [W(0xc), W(0xd)],
    dropItem: party ? 0 : W(0xe), dropGold: party ? 0 : W(0xf), bag: party ? [W(0xe), W(0xf), W(0x10), W(0x11)] : [0, 0, 0, 0],
    hpMax: W(0x12), hp: W(0x13), mpMax: W(0x14), mp: W(0x15), exp: W(0x16), str: W(0x17), def: W(0x18), wis: W(0x19), mgr: W(0x1a), agi: W(0x1b),
    spells, buff: { str: S(0x26), def: S(0x27), wis: S(0x28), mgr: S(0x29), agi: S(0x2a) }, elem: [S(0x2b), S(0x2c), S(0x2d)],
    moved: I(0x2e) !== 0, acted: I(0x30) !== 0, special: I(0x32) !== 0, statusCounter: I(0x34),
  };
}

/** FUN_00423820: the three blocks the original writes. Unknown fields stay 0. */
export function encodeSave(c: Campaign, date: Date, warn: (s: string) => void = () => {}): Uint8Array {
  const bytes = new Uint8Array(SAVE_SIZE);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, HEADER_SIZE, true);
  v.setUint16(4, c.stage, true);
  bytes.set(encodeCp949(c.episode, 32), 6);
  v.setInt16(38, c.turn, true);
  for (let i = 0; i < FLAG_COUNT; i++) v.setUint16(40 + 2 * i, (c.flags[i] ?? 0) & 0xffff, true);
  writeTime(v, 90, date);
  v.setInt16(106, c.bgm, true);
  v.setUint32(108, c.inventory.gold, true);
  if (c.inventory.items.length > STACKS) warn(`${c.inventory.items.length} item stacks; the save keeps ${STACKS}`);
  c.inventory.items.slice(0, STACKS).forEach((st, i) => { v.setUint16(112 + 4 * i, st.id, true); v.setUint16(114 + 4 * i, st.count, true); });
  bytes.set(encodeCp949(c.message, 32), 436);
  for (let s = 0; s < MAX_SLOTS; s++) encodeUnit(c.units[s] ?? null, v, UNITS_AT + s * UNIT_SIZE, warn);
  v.setUint32(TOWN_AT, TOWN_BLOCK, true);
  for (let i = 0; i < TOWN_FLAGS; i++) v.setUint32(TOWN_AT + 88 + 4 * i, c.townFlags[i] ?? 0, true);
  v.setUint32(TOWN_AT + 168, c.townSet >= 2 ? 1 : 0, true);
  v.setUint32(TOWN_AT + 172, c.townExtra ? 1 : 0, true);
  v.setUint32(TOWN_AT + 176, c.townSet === 3 ? 1 : 0, true);
  return bytes;
}

/** FUN_004239b0 load: a fresh campaign filled from the file. Runtime-only fields (speaker name, hooks) start empty. */
export function decodeSave(bytes: Uint8Array): Campaign {
  const v = checked(bytes);
  const c = newCampaign();
  c.stage = v.getUint16(4, true);
  c.episode = decodeCp949(bytes.subarray(6, 38));
  c.turn = v.getInt16(38, true);
  for (let i = 0; i < FLAG_COUNT; i++) c.flags[i] = v.getUint16(40 + 2 * i, true);
  c.bgm = v.getInt16(106, true);
  c.inventory.gold = v.getUint32(108, true);
  c.inventory.items = [];
  for (let i = 0; i < STACKS; i++) {
    const id = v.getUint16(112 + 4 * i, true), count = v.getUint16(114 + 4 * i, true);
    if (id !== 0 && count > 0) c.inventory.items.push({ id, count });
  }
  c.message = decodeCp949(bytes.subarray(436, 468));
  for (let s = 0; s < MAX_SLOTS; s++) c.units[s] = decodeUnit(v, UNITS_AT + s * UNIT_SIZE, s);
  for (let i = 0; i < TOWN_FLAGS; i++) c.townFlags[i] = v.getUint32(TOWN_AT + 88 + 4 * i, true);
  const night = v.getUint32(TOWN_AT + 168, true) !== 0, dark = v.getUint32(TOWN_AT + 176, true) !== 0;
  c.townSet = dark ? 3 : night ? 2 : 1;
  c.townExtra = v.getUint32(TOWN_AT + 172, true) !== 0;
  return c;
}
