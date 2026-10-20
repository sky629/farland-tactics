import { describe, expect, it } from 'vitest';
import { emptyInventory, giveItem } from '../src/battle/inventory';
import { buyTotal, maxCount, shopRows, whoCanTake } from '../src/ui/win/screens/shop';
import { STACK_MAX } from '../src/battle/inventory';
import { tables, unit } from './helpers/battleFixtures';

const t = tables();

describe('shop dialogs 150 물품목록 · 151 몇개 삽니까? · 152 누가 사나?', () => {
  it('rows show name, price and the count owned (header "명칭 … 가격 … 갯수")', () => {
    const inv = emptyInventory(); giveItem(inv, null, 7, 2, t.item);
    expect(shopRows([7, 1], inv, t)).toEqual([{ id: 7, text: `${t.item[7]!.name}\t${t.item[7]!.price}\t2` }, { id: 1, text: `${t.item[1]!.name}\t${t.item[1]!.price}\t0` }]);
  });
  it('151 totals price × count and refuses what the purse cannot pay', () => {
    const sword = { ...t.item[1]!, price: 100 };
    expect(buyTotal(sword, 3, 1000)).toEqual({ total: 300, ok: true });
    expect(buyTotal(sword, 3, 10)).toEqual({ total: 300, ok: false });
    expect(buyTotal(sword, 0, 10).ok).toBe(false);
  });
  it('the count asked for is capped by the stack room (STACK_MAX) or one piece of equipment', () => {
    const inv = emptyInventory(); giveItem(inv, null, 7, 10, t.item);
    expect(maxCount(t.item[7]!, inv, 7)).toBe(STACK_MAX - 10);
    expect(maxCount(t.item[1]!, inv, 1)).toBe(1);
  });
  it('152 offers the party members with a free bag slot for a piece of equipment', () => {
    const party = [unit({ slot: 0, bag: [1, 2, 3, 4] }), unit({ slot: 1, bag: [1, 0, 0, 0] })];
    expect(whoCanTake(party).map((u) => u.slot)).toEqual([1]);
  });
});
