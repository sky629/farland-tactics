import type { ItemData } from '../data/types';
import { addGold, giveItem, isEquipment, takeItem, type Inventory } from './inventory';
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

/**
 * Dialog 153 "몇개 팔았습니까?" (reached from the unit list's 도구 tab, popup "팔기"): `count` of the shared stack `id` leave for half the
 * price each; a piece of equipment is not a stack (it sells from the 장비 tab, "%d에 판다"), and the count cannot exceed the stack.
 */
export function sellStack(inv: Inventory, id: number, count: number, items: ItemData[]): SellResult {
  const item = items[id], stack = inv.items.find((s) => s.id === id);
  if (!item || isEquipment(item) || !stack || count < 1 || count > stack.count) return 'nothing';
  takeItem(inv, id, count, items);
  addGold(inv, Math.floor(item.price / 2) * count);
  return 'ok';
}
