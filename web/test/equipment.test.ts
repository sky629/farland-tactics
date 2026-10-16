import { describe, expect, it } from 'vitest';
import { canEquip, equip, unequip } from '../src/battle/equipment';
import { ITEM, tables, unit } from './helpers/battleFixtures';

const items = [...tables().item, ITEM({ name: 'elf bow', weapon_type: 3, race_mask: 1 << 2 }), ITEM({ name: 'ring', slot: 2 })];   // 10 elf bow (race 2 only), 11 ring

describe('equipment [assumed from item.dat fields]', () => {
  it('canEquip needs an equipment slot and the race bit; item 0 always fits; consumables never do', () => {
    expect(canEquip(unit({ slot: 0, race: 0 }), 1, items)).toBe(true);
    expect(canEquip(unit({ slot: 0, race: 0 }), 10, items)).toBe(false);
    expect(canEquip(unit({ slot: 0, race: 2 }), 10, items)).toBe(true);
    expect(canEquip(unit({ slot: 0 }), 0, items)).toBe(true);
    expect(canEquip(unit({ slot: 0 }), 7, items)).toBe(false);
  });
  it('equip swaps the bag item with the equipped one; accessories fill the first empty of two slots', () => {
    const u = unit({ slot: 0, weapon: 1, bag: [3, 11, 11, 0] });
    expect(equip(u, 0, items)).toBe(true);
    expect(u).toMatchObject({ weapon: 3, bag: [1, 11, 11, 0] });
    expect(equip(u, 1, items)).toBe(true);
    expect(equip(u, 2, items)).toBe(true);
    expect(u.acc).toEqual([11, 11]);
    expect(u.bag).toEqual([1, 0, 0, 0]);
    expect(equip(u, 3, items)).toBe(false);                                         // empty bag slot
    expect(equip(unit({ slot: 0, race: 0, bag: [10, 0, 0, 0] }), 0, items)).toBe(false);   // wrong race
  });
  it('unequip moves equipment into an empty bag slot and fails when the bag is full or the slot is empty', () => {
    const u = unit({ slot: 0, weapon: 1, armor: 5, acc: [11, 0], bag: [0, 0, 0, 0] });
    expect(unequip(u, 'weapon')).toBe(true);
    expect(unequip(u, 0)).toBe(true);
    expect(u).toMatchObject({ weapon: 0, acc: [0, 0], bag: [1, 11, 0, 0] });
    expect(unequip(u, 1)).toBe(false);
    u.bag = [1, 1, 1, 1];
    expect(unequip(u, 'armor')).toBe(false);
    expect(u.armor).toBe(5);
  });
});
