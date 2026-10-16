import type { ItemData } from '../data/types';
import type { Unit } from './unit';

export interface Stack { id: number; count: number }
/** The party's shared consumables and gold (battle_rules.md §4.3). */
export interface Inventory { items: Stack[]; gold: number }

export const INVENTORY_SLOTS = 80;
export const STACK_MAX = 9999;
export const GOLD_MAX = 999999;
export const BAG_SLOTS = 4;

export const emptyInventory = (): Inventory => ({ items: [], gold: 0 });
export const isEquipment = (item: ItemData): boolean => item.slot === 0 || item.slot === 1 || item.slot === 2;

/** FUN_0041f310 */
export function countOf(inv: Inventory, id: number): number {
  return inv.items.find((s) => s.id === id)?.count ?? 0;
}

/** FUN_0041ecc0: equipment goes into the unit's 4-slot bag; consumables stack in the shared table. */
export function giveItem(inv: Inventory, unit: Unit | null, id: number, n: number, items: ItemData[]): boolean {
  const item = items[id];
  if (!item || id === 0) return false;
  if (isEquipment(item)) {
    if (!unit) return false;
    const free = unit.bag.indexOf(0);
    if (free < 0) return false;
    unit.bag[free] = id;
    return true;
  }
  const stack = inv.items.find((s) => s.id === id);
  if (!stack && inv.items.length >= INVENTORY_SLOTS) return false;
  if ((stack?.count ?? 0) + n > STACK_MAX) return false;
  if (stack) stack.count += n;
  else inv.items.push({ id, count: n });
  return true;
}

/** FUN_0041eda0: consumables only; a stack at zero disappears. */
export function takeItem(inv: Inventory, id: number, n: number, items: ItemData[]): void {
  const item = items[id];
  if (!item || isEquipment(item)) return;
  const i = inv.items.findIndex((s) => s.id === id);
  if (i < 0) return;
  const stack = inv.items[i]!;
  if (stack.count + n >= 10000) return;
  stack.count -= n;
  if (stack.count < 1) inv.items.splice(i, 1);
}

/** FUN_0041ec90 */
export function addGold(inv: Inventory, delta: number): void {
  inv.gold = Math.min(Math.max(inv.gold + delta, 0), GOLD_MAX);
}

/** Battle-menu rule (FUN_00430c80): held consumables that have a use effect. */
export function usableItems(inv: Inventory, items: ItemData[]): Stack[] {
  return inv.items.filter((s) => { const it = items[s.id]; return s.count > 0 && it !== undefined && it.slot === 3 && it.use_effect !== 0; });
}
