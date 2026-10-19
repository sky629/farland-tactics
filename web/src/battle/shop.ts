import type { ItemData } from '../data/types';
import { addGold, giveItem, type Inventory } from './inventory';
import type { Unit } from './unit';

export type BuyResult = 'ok' | 'no gold' | 'full' | 'unknown item';

/** Shop purchase: the price field of item.dat (+0x14); the item is handed over like GIVE_ITEM. Payment after the hand-over is assumed. */
export function buy(inv: Inventory, unit: Unit | null, id: number, items: ItemData[]): BuyResult {
  const item = items[id];
  if (!item || id === 0) return 'unknown item';
  if (inv.gold < item.price) return 'no gold';
  if (!giveItem(inv, unit, id, 1, items)) return 'full';
  addGold(inv, -item.price);
  return 'ok';
}

export type SellResult = 'ok' | 'nothing';

/**
 * Selling (FT2.exe menu 103 "도구 → 팔기", dialog 118 "더블클릭하면 매각할 수 있습니다": the unit list's sale tab lists the unit's bag): the piece
 * at bag index `which` leaves the bag for half its price (the original's sale-price formula is not recovered: half is the assumption,
 * see analysis/story_flow.md §8).
 */
export function sell(inv: Inventory, unit: Unit, which: number, items: ItemData[]): SellResult {
  const id = unit.bag[which] ?? 0;
  const item = items[id];
  if (id === 0 || !item) return 'nothing';
  unit.bag[which] = 0;
  addGold(inv, Math.floor(item.price / 2));
  return 'ok';
}
