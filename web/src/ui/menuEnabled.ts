/** Which unit commands are open in the current selection state: the player's popup, the menu bar's 턴 종료 and the dev panel's buttons all read this. */
import type { BattleState } from '../battle/types';
import type { ItemData } from '../data/types';
import { usableItems } from '../battle/inventory';
import { hasMoveTarget } from '../battle/moveRange';

export interface MenuEnabled { move: boolean; attack: boolean; magic: boolean; item: boolean; wait: boolean; endTurn: boolean }

/** Which buttons the rules would accept right now (spec §10.2). */
export function menuEnabled(state: BattleState, items: ItemData[] = []): MenuEnabled {
  const none = { move: false, attack: false, magic: false, item: false, wait: false, endTurn: false };
  if (state.phase.kind !== 'player') return none;
  const sel = state.phase.sel;
  if (sel.mode !== 'menu') return { ...none, endTurn: true };
  const u = state.units[sel.slot];
  if (!u) return { ...none, endTurn: true };
  return { move: !u.moved && hasMoveTarget(sel.range, state.units, u), attack: !u.acted, magic: !u.acted && u.spells.length > 0 && u.status !== 6, item: !u.acted && usableItems(state.inventory, items).length > 0, wait: true, endTurn: true };
}
