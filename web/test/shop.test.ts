import { describe, expect, it } from 'vitest';
import { emptyInventory, giveItem } from '../src/battle/inventory';
import { buy, sell } from '../src/battle/shop';
import { tables, unit } from './helpers/battleFixtures';

const items = tables().item.map((it, i) => (i === 7 ? { ...it, price: 30 } : i === 1 ? { ...it, price: 100 } : it));

describe('shop purchase (price from item.dat; payment order assumed)', () => {
  it('charges the price and hands the item over; refuses without gold or room', () => {
    const inv = emptyInventory(); inv.gold = 120;
    const u = unit({ slot: 0 });
    expect(buy(inv, u, 7, items)).toBe('ok');
    expect(buy(inv, u, 1, items)).toBe('no gold');
    inv.gold = 100; u.bag = [1, 1, 1, 1];
    expect(buy(inv, u, 1, items)).toBe('full');
    expect(inv.gold).toBe(100);
    u.bag = [0, 0, 0, 0];
    expect(buy(inv, u, 1, items)).toBe('ok');
    expect(inv).toMatchObject({ gold: 0, items: [{ id: 7, count: 1 }] });
    expect(u.bag[0]).toBe(1);
    expect(buy(inv, u, 999, items)).toBe('unknown item');
    giveItem(inv, null, 7, 1, items);
    expect(buy(inv, null, 7, items)).toBe('no gold');
  });
});

describe('sell (menu 103 "팔기", dialogs 118 "더블클릭하면 매각할 수 있습니다" / 153 "몇개 팔았습니까?")', () => {
  it('a bag piece sells for half its price and leaves the bag; an empty slot sells nothing', () => {
    const inv = emptyInventory();
    const u = unit({ slot: 0, bag: [1, 0, 0, 0] });                            // item 1: the 100-gold sword above
    expect(sell(inv, u, 0, items)).toBe('ok');
    expect([u.bag[0], inv.gold]).toEqual([0, 50]);
    expect(sell(inv, u, 1, items)).toBe('nothing');                           // an empty bag slot
  });
});
