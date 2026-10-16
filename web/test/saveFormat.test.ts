import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyRoster } from '../src/battle/battle';
import type { RosterUnit } from '../src/data/types';
import { FLAG_COUNT, newCampaign } from '../src/game/campaign';
import { decodeSave, decodeUnit, encodeSave, encodeUnit, HEADER_SIZE, SAVE_SIZE, SaveError, saveSummary, UNIT_SIZE } from '../src/save/format';
import { fixedRng, tables, unit } from './helpers/battleFixtures';

const party: RosterUnit[] = [
  { unit_id: 1, race: 0, level: 2, dir: 0, c: 2, r: 4, status: 0, side: 0, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0 },
  { unit_id: 2, race: 0, level: 2, dir: 1, c: 2, r: 5, status: 0, side: 0, weapon: 1, armor: 5, drop_item: 0, drop_gold: 0 },
];
const slime: RosterUnit = { unit_id: 8, race: 1, level: 1, dir: 2, c: 6, r: 4, status: 0, side: 4, weapon: 1, armor: 0, drop_item: 7, drop_gold: 50 };

function campaign() {
  const c = newCampaign();
  applyRoster(c.units, [...party, slime], tables(), fixedRng([0]));
  c.stage = 1; c.turn = 3; c.episode = '첫업무'; c.message = '슬라임을_전멸시켜라!?'; c.bgm = 6;
  c.flags[0] = 1; c.flags[2] = 2; c.flags[10] = 7;
  c.townFlags[1] = 1; c.townFlags[2] = 1; c.townSet = 2; c.townExtra = true;
  c.inventory.items.push({ id: 7, count: 3 }, { id: 8, count: 2 });
  c.units[0]!.bag = [3, 0, 0, 0]; c.units[0]!.spells = [1, 2]; c.units[0]!.exp = 123; c.units[0]!.hp = 20;
  c.units[1]!.buff.str = 2; c.units[1]!.statusCounter = 40; c.units[1]!.moved = true;
  return c;
}

describe('save file format (file_formats.md §6, §7)', () => {
  it('has 24 script flags like the original header', () => {
    expect(FLAG_COUNT).toBe(24);
    expect(newCampaign().flags).toHaveLength(24);
  });
  it('encodes a 6848-byte file with the header fields at the original offsets', () => {
    const c = campaign();
    const bytes = encodeSave(c, new Date(2026, 9, 16, 13, 45, 30));
    expect(bytes.length).toBe(SAVE_SIZE);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(v.getUint32(0, true)).toBe(HEADER_SIZE);
    expect(v.getUint16(4, true)).toBe(1);                                      // stage
    expect(v.getInt16(38, true)).toBe(3);                                      // turn
    expect(v.getUint16(40, true)).toBe(1);                                     // Flag[0]
    expect(v.getUint16(40 + 2 * 10, true)).toBe(7);                            // Flag[10]
    expect(v.getUint16(90, true)).toBe(2026);                                  // SYSTEMTIME.wYear
    expect(v.getUint16(92, true)).toBe(10);                                    // wMonth
    expect(v.getUint16(96, true)).toBe(16);                                    // wDay
    expect(v.getUint16(106, true)).toBe(6);                                    // bgm
    expect(v.getUint32(108, true)).toBe(200);                                  // gold
    expect(v.getUint16(112, true)).toBe(7); expect(v.getUint16(114, true)).toBe(3);   // first stack (id, count)
    expect(v.getUint16(HEADER_SIZE, true)).toBe(1);                            // unit 0 id
    expect(v.getUint32(HEADER_SIZE + 50 * UNIT_SIZE, true)).toBe(180);         // town block length
    expect(v.getUint32(HEADER_SIZE + 50 * UNIT_SIZE + 88 + 4 * 1, true)).toBe(1);   // townFlags[1]
    expect(v.getUint32(HEADER_SIZE + 50 * UNIT_SIZE + 168, true)).toBe(1);     // night set
    expect(v.getUint32(HEADER_SIZE + 50 * UNIT_SIZE + 172, true)).toBe(1);     // extra
  });
  it('round-trips the campaign: units, flags, inventory, town state, titles', () => {
    const c = campaign();
    const back = decodeSave(encodeSave(c, new Date()));
    expect(back.stage).toBe(1); expect(back.turn).toBe(3); expect(back.episode).toBe('첫업무'); expect(back.message).toBe('슬라임을_전멸시켜라!?'); expect(back.bgm).toBe(6);
    expect(back.flags).toEqual(c.flags);
    expect(back.inventory).toEqual({ items: [{ id: 7, count: 3 }, { id: 8, count: 2 }], gold: 200 });
    expect(back.townFlags).toEqual(c.townFlags); expect(back.townSet).toBe(2); expect(back.townExtra).toBe(true);
    const u0 = back.units[0]!, u1 = back.units[1]!, e = back.units[10]!;
    expect(u0).toMatchObject({ slot: 0, id: 1, race: 0, level: 2, dir: 0, c: 2, r: 4, side: 0, weapon: 1, bag: [3, 0, 0, 0], spells: [1, 2], exp: 123, hp: 20, hpMax: c.units[0]!.hpMax });
    expect(u1).toMatchObject({ dir: 1, armor: 5, moved: true, statusCounter: 40 });
    expect(u1.buff.str).toBe(2);
    expect(e).toMatchObject({ slot: 10, id: 8, race: 1, side: 4, dir: 2, dropItem: 7, dropGold: 50 });
    expect(back.units[11]).toBeNull();
    expect(back.units.filter(Boolean)).toHaveLength(3);
  });
  it('rejects a wrong size or header', () => {
    expect(() => decodeSave(new Uint8Array(100))).toThrow(SaveError);
    const bad = encodeSave(campaign(), new Date()); new DataView(bad.buffer).setUint32(0, 467, true);
    expect(() => decodeSave(bad)).toThrow(SaveError);
    expect(() => saveSummary(new Uint8Array(6848))).toThrow(SaveError);
  });
  it('encodeUnit keeps at most 10 spells and warns about the rest', () => {
    const u = unit({ slot: 0, id: 1, spells: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] });
    const buf = new DataView(new ArrayBuffer(UNIT_SIZE)); const warns: string[] = [];
    encodeUnit(u, buf, 0, (s) => warns.push(s));
    expect(decodeUnit(buf, 0, 0)!.spells).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(warns).toHaveLength(1);
    expect(decodeUnit(new DataView(new ArrayBuffer(UNIT_SIZE)), 0, 3)).toBeNull();   // id 0 = empty slot
  });
  it('summarises the header without decoding the units', () => {
    const s = saveSummary(encodeSave(campaign(), new Date(2026, 9, 16, 1, 2, 3)));
    expect(s).toMatchObject({ stage: 1, title: '첫업무', turn: 3, bgm: 6, gold: 200, message: '슬라임을_전멸시켜라!?' });
    expect(s.date?.getFullYear()).toBe(2026);
  });
  const real = '../extracted/FarlandTactics2/save/save09.dat';
  (existsSync(real) ? it : it.skip)('reads a save written by the original game (first battle autosave)', () => {
    const bytes = new Uint8Array(readFileSync(real));
    expect(saveSummary(bytes)).toMatchObject({ stage: 1, title: '첫업무', gold: 200, message: '슬라임을_전멸시켜라!?' });
    const c = decodeSave(bytes);
    expect(c.units[0]).toMatchObject({ id: 1, level: 2, hp: 27 });
    expect(c.turn).toBeGreaterThanOrEqual(0);
    expect(c.units.filter(Boolean).length).toBeGreaterThan(2);
  });
});
