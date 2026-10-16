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
