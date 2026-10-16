import { describe, expect, it } from 'vitest';
import { addGold, countOf, emptyInventory, giveItem, GOLD_MAX, INVENTORY_SLOTS, STACK_MAX, takeItem, usableItems } from '../src/battle/inventory';
import { ITEM, tables, unit } from './helpers/battleFixtures';

const items = tables().item;   // 1 sword, 5 armor (equipment); 7 herb, 8 antidote (usable); 9 dud (no use effect)

describe('inventory (FUN_0041ecc0 / FUN_0041eda0 / FUN_0041f310 / FUN_0041ec90)', () => {
  it('stacks consumables, caps a stack at 9999 and the table at 80 kinds', () => {
    const inv = emptyInventory();
    expect(giveItem(inv, null, 7, 3, items)).toBe(true);
    expect(giveItem(inv, null, 7, 2, items)).toBe(true);
    expect(countOf(inv, 7)).toBe(5);
    expect(giveItem(inv, null, 7, STACK_MAX, items)).toBe(false);
    expect(countOf(inv, 7)).toBe(5);
    const many = Array.from({ length: INVENTORY_SLOTS + 2 }, (_, i) => ITEM({ name: `c${i}`, slot: 3 }));
    const big = emptyInventory();
    for (let id = 1; id <= INVENTORY_SLOTS; id++) expect(giveItem(big, null, id, 1, many)).toBe(true);
    expect(giveItem(big, null, INVENTORY_SLOTS + 1, 1, many)).toBe(false);
    expect(giveItem(big, null, 0, 1, many)).toBe(false);          // id 0 is "none"
    expect(big.items).toHaveLength(INVENTORY_SLOTS);
  });
  it("equipment goes into the unit's 4-slot bag and needs a unit", () => {
    const inv = emptyInventory();
    const u = unit({ slot: 0 });
    expect(giveItem(inv, null, 1, 1, items)).toBe(false);
    for (let i = 0; i < 4; i++) expect(giveItem(inv, u, 1, 1, items)).toBe(true);
    expect(u.bag).toEqual([1, 1, 1, 1]);
    expect(giveItem(inv, u, 5, 1, items)).toBe(false);
    expect(inv.items).toEqual([]);
  });
  it('takeItem removes consumables only and drops an empty stack; gold is clamped to 0..999999', () => {
    const inv = emptyInventory();
    giveItem(inv, null, 7, 2, items); giveItem(inv, null, 8, 1, items);
    takeItem(inv, 7, 1, items); takeItem(inv, 8, 5, items); takeItem(inv, 1, 1, items);
    expect(inv.items).toEqual([{ id: 7, count: 1 }]);
    addGold(inv, 500); addGold(inv, -900);
    expect(inv.gold).toBe(0);
    addGold(inv, GOLD_MAX + 5);
    expect(inv.gold).toBe(GOLD_MAX);
  });
  it('usableItems lists held consumables that have a use effect', () => {
    const inv = emptyInventory();
    giveItem(inv, null, 7, 1, items); giveItem(inv, null, 9, 1, items);
    expect(usableItems(inv, items)).toEqual([{ id: 7, count: 1 }]);
  });
});
