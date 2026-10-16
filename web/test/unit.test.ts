import { describe, expect, it } from 'vitest';
import { createUnit, growUnit, itemsOf, rebuildSpells } from '../src/battle/unit';
import { fixedRng, MAGIC, RACE, tables, unit } from './helpers/battleFixtures';

const rec = { unit_id: 1, race: 0, level: 2, dir: 2, c: 36, r: 19, status: 0, side: 0, weapon: 1, armor: 5, drop_item: 0, drop_gold: 0 };

describe('createUnit (FUN_0041fae0)', () => {
  it('copies the record, applies race base stats and one deterministic growth for level 2', () => {
    const u = createUnit(rec, 0, tables(), fixedRng([0]));
    expect(u).toMatchObject({ slot: 0, id: 1, race: 0, level: 2, dir: 2, c: 36, r: 19, side: 0, weapon: 1, armor: 5, acc: [0, 0] });
    expect([u.hpMax, u.hp, u.mpMax, u.mp]).toEqual([27, 27, 27, 27]);
    expect([u.str, u.def, u.wis, u.mgr, u.agi]).toEqual([23, 18, 27, 17, 22]);
    expect(u.exp).toBe(100);
    expect(u.spells).toEqual([1, 3, 4, 5]);             // every fixture magic with learn_mask bit 0 and learn_level ≤ 2 (heal has mask 2)
    expect([u.moved, u.acted]).toEqual([true, true]);   // BATTLE_START clears them
  });
  it('randomizes growth for non-party units with two draws per stat (bound check, then value)', () => {
    const rng = fixedRng([2]);                          // rand(3) = 2 → +1 every draw
    const u = createUnit({ ...rec, unit_id: 8, race: 1, level: 3, side: 4, weapon: 1, armor: 0 }, 10, tables(), rng);
    expect(u.hpMax).toBe(12 + (4 + 1) * 2);
    expect(u.str).toBe(20 + (5 + 1) * 2);
    expect(rng.calls).toBe(7 * 2 * 2);                  // 7 stats × 2 draws × 2 levels
    expect(u.spells).toEqual([]);                       // race spells all 0
  });
  it('status 1 → hp 0; other status → counter 100; monsters take race spells', () => {
    const t = tables({ race: [RACE(), RACE({ spell0: 1, spell1: 5 }), RACE()] });
    expect(createUnit({ ...rec, status: 1 }, 0, t, fixedRng([0])).hp).toBe(0);
    const m = createUnit({ ...rec, unit_id: 8, race: 1, side: 4, status: 3, level: 1 }, 10, t, fixedRng([0]));
    expect(m.statusCounter).toBe(100);
    expect(m.spells).toEqual([1, 5]);
  });
  it('side 7 objects keep zero stats', () => {
    const o = createUnit({ ...rec, unit_id: 8, race: 1, side: 7, level: 1, drop_item: 118 }, 11, tables(), fixedRng([0]));
    expect([o.hpMax, o.str, o.dropItem]).toEqual([0, 0, 118]);
  });
});

describe('growUnit / rebuildSpells (FUN_0041f7c0)', () => {
  it('caps stats at 999 and refills HP/MP unless dead', () => {
    const u = unit({ slot: 0, hpMax: 998, hp: 5, str: 999 });
    growUnit(u, RACE({ hp_up: 5, str_up: 5 }), false, fixedRng([0]), tables().magic);
    expect([u.hpMax, u.hp, u.str]).toEqual([999, 999, 999]);
    const dead = unit({ slot: 0, status: 1, hp: 0 });
    growUnit(dead, RACE(), false, fixedRng([0]), tables().magic);
    expect(dead.hp).toBe(0);
  });
  it('rebuilds party spells from learn_mask and learn_level and reports the ones learned at this level', () => {
    const magic = [MAGIC({ name: 'none', mp_cost: 0 }), MAGIC({ learn_level: 1, learn_mask: 1 }), MAGIC({ learn_level: 3, learn_mask: 1 }), MAGIC({ learn_level: 2, learn_mask: 2 })];
    const u = unit({ slot: 0, id: 1, level: 3 });
    expect(growUnit(u, RACE(), false, fixedRng([0]), magic)).toEqual([2]);
    expect(u.spells).toEqual([1, 2]);
    expect(rebuildSpells(unit({ slot: 1, id: 2, level: 2 }), magic)).toEqual([3]);
  });
  it('itemsOf returns weapon, armor and both accessories', () => {
    const t = tables();
    expect(itemsOf(unit({ slot: 0, weapon: 1, armor: 5 }), t.item).map((i) => i.name)).toEqual(['sword', 'armor', 'none', 'none']);
  });
});
