import { describe, expect, it } from 'vitest';
import { createScriptUnit, findUnit, newCampaign, removeDead, removeScriptUnits } from '../src/game/campaign';
import { unit } from './helpers/battleFixtures';

describe('campaign', () => {
  it('a new game has 200 gold, turn −1, stage 0, cleared flags and no units', () => {
    const c = newCampaign();
    expect(c.inventory).toEqual({ items: [], gold: 200 });
    expect(c).toMatchObject({ turn: -1, stage: 0, townSet: 1, townExtra: false, battleTarget: null });
    expect(c.flags).toHaveLength(24);                                           // u16[24] in the save header
    expect(c.flags.every((f) => f === 0)).toBe(true);
    expect(c.townFlags).toHaveLength(16);
    expect(c.units.filter(Boolean)).toHaveLength(0);
  });
  it('findUnit resolves id 24 to the battle target, 0 to nothing and others by id', () => {
    const c = newCampaign();
    c.units[0] = unit({ slot: 0, id: 1 }); c.units[1] = unit({ slot: 1, id: 2 }); c.units[10] = unit({ slot: 10, id: 8, side: 4 });
    expect(findUnit(c, 2)).toBe(c.units[1]);
    expect(findUnit(c, 0)).toBeNull();
    expect(findUnit(c, 24)).toBeNull();
    c.battleTarget = 10;
    expect(findUnit(c, 24)).toBe(c.units[10]);
    expect(findUnit(c, 99)).toBeNull();
  });
  it('script units take free slots from 10, carry their APD and layer, and REMOVE_SCRIPT_UNITS clears exactly them', () => {
    const c = newCampaign();
    c.units[10] = unit({ slot: 10, id: 8, side: 4 });
    const u = createScriptUnit(c, 101, 7, 13, 22, 'char_01d', 3)!;
    expect(u).toMatchObject({ slot: 11, id: 101, side: 1, c: 13, r: 22, sprite: { apd: 'char_01d', layer: 3 } });
    createScriptUnit(c, 4000, 7, 1, 1, 'npc_02', 5);
    removeScriptUnits(c);
    expect(c.units[10]).not.toBeNull();
    expect(c.units[11]).toBeNull();
    expect(c.units[12]).toBeNull();
  });
  it('removeDead drops fallen generic enemies (id 8, 24, > 30) with 0 HP or a non-dead status', () => {
    const c = newCampaign();
    c.units[10] = unit({ slot: 10, id: 8, side: 4, hp: 0, status: 1 });
    c.units[11] = unit({ slot: 11, id: 31, side: 4, hp: 5, status: 3 });
    c.units[12] = unit({ slot: 12, id: 12, side: 4, hp: 0, status: 1 });   // named: kept
    c.units[13] = unit({ slot: 13, id: 8, side: 4, hp: 5, status: 1 });    // dead status with HP left: kept
    removeDead(c);
    expect([10, 11, 12, 13].map((s) => c.units[s] === null)).toEqual([true, true, false, false]);
  });
});
