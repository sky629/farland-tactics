import { describe, expect, it } from 'vitest';
import { createScriptUnit, findUnit, loadRoster, newCampaign, removeDead, removeScriptUnits } from '../src/game/campaign';
import type { RosterUnit } from '../src/data/types';
import { fixedRng, tables, unit } from './helpers/battleFixtures';

const rec = (over: Partial<RosterUnit>): RosterUnit => ({ unit_id: 8, race: 1, level: 1, dir: 0, c: 3, r: 3, status: 0, side: 4, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0, ...over });

describe('campaign', () => {
  it('a new game has 200 gold, turn −1, stage 0, cleared flags and no units', () => {
    const c = newCampaign();
    expect(c.inventory).toEqual({ items: [], gold: 200 });
    expect(c).toMatchObject({ turn: -1, stage: 0, townSet: 1, townExtra: false, battleTarget: null });
    expect(c.flags).toHaveLength(100);
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
  it('loadRoster replaces slots 10..49 with the roster records and leaves the party alone', () => {
    const c = newCampaign();
    c.units[0] = unit({ slot: 0, id: 1 });
    c.units[10] = unit({ slot: 10, id: 8, side: 4 });
    loadRoster(c, [rec({}), rec({ c: 4 }), rec({ unit_id: 1, side: 0, c: 5 })], tables(), fixedRng([0]));
    expect(c.units[0]).toMatchObject({ id: 1, c: 0 });
    expect(c.units[10]).toMatchObject({ id: 8, c: 3, side: 4 });
    expect(c.units[11]).toMatchObject({ c: 4 });
    expect(c.units[12]).toBeNull();                                        // party records do not create new units here
  });
});
