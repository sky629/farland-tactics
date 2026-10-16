import type { ItemData } from '../data/types';
import { isEquipment } from './inventory';
import type { Unit } from './unit';

export type EquipSlot = 'weapon' | 'armor' | 0 | 1;   // 0/1 = accessory index

/** [assumed from data] slot 0/1/2 items whose race_mask carries the unit's race bit; item 0 (none) always fits. */
export function canEquip(unit: Unit, id: number, items: ItemData[]): boolean {
  const item = items[id];
  if (!item || !isEquipment(item)) return false;
  return id === 0 || ((item.race_mask >> unit.race) & 1) === 1;
}

/** Equip the bag item at `bagIndex`; the displaced equipment takes its bag slot. */
export function equip(unit: Unit, bagIndex: number, items: ItemData[]): boolean {
  const id = unit.bag[bagIndex];
  if (id === undefined || id === 0 || !canEquip(unit, id, items)) return false;
  const slot = items[id]!.slot;
  let displaced: number;
  if (slot === 0) { displaced = unit.weapon; unit.weapon = id; }
  else if (slot === 1) { displaced = unit.armor; unit.armor = id; }
  else { const i = unit.acc[0] === 0 ? 0 : unit.acc[1] === 0 ? 1 : 0; displaced = unit.acc[i]; unit.acc[i] = id; }
  unit.bag[bagIndex] = displaced;
  return true;
}

/** Move a piece of equipment back into an empty bag slot. */
export function unequip(unit: Unit, where: EquipSlot): boolean {
  const current = where === 'weapon' ? unit.weapon : where === 'armor' ? unit.armor : unit.acc[where];
  if (current === 0) return false;
  const free = unit.bag.indexOf(0);
  if (free < 0) return false;
  unit.bag[free] = current;
  if (where === 'weapon') unit.weapon = 0;
  else if (where === 'armor') unit.armor = 0;
  else unit.acc[where] = 0;
  return true;
}
