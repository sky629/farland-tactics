import { stepCell, type Dir } from '../battle/grid';
import { canStop } from '../battle/moveRange';
import type { Selection } from '../battle/types';
import type { Unit } from '../battle/unit';
import { LAYER } from './unitSprites';

export interface OverlaySprite { c: number; r: number; anim: string; layer: number }

export const TURN_ANIM: Record<Dir, string> = { 0: 'TURN_SOUTH', 1: 'TURN_EAST', 2: 'TURN_WEST', 3: 'TURN_NORTH' };

/** system.apd tiles: MOVE on stoppable cells (menu/move), ATTACK on target cells, TURN_* arrows while facing, one cursor under the mouse (FUN_00438c70 kinds). */
export function overlaySprites(sel: Selection, units: (Unit | null)[], hover: [number, number] | null): OverlaySprite[] {
  const out: OverlaySprite[] = [];
  let cursor = 'CURSOR';
  if (sel.mode === 'menu' || sel.mode === 'move') {
    const u = units[sel.slot];
    if (u) {
      for (const cell of sel.range.cells()) {
        if ((cell.c !== u.c || cell.r !== u.r) && canStop(sel.range, units, u, cell.c, cell.r)) out.push({ c: cell.c, r: cell.r, anim: 'MOVE', layer: LAYER.ground });
      }
      if (hover && canStop(sel.range, units, u, hover[0], hover[1])) cursor = 'FRIEND';
    }
  } else if (sel.mode === 'target') {
    for (const cell of sel.range.cells()) if (cell.kind !== 0) out.push({ c: cell.c, r: cell.r, anim: 'ATTACK', layer: LAYER.ground });
    if (hover) {
      const k = sel.range.kindAt(hover[0], hover[1]);
      if (k === 1) cursor = 'ENEMY';
      else if (k === 2) cursor = 'FRIEND';
    }
  } else if (sel.mode === 'face') {
    const u = units[sel.slot];
    if (u) {
      for (const d of [0, 1, 2, 3] as Dir[]) {
        const [c, r] = stepCell(u.c, u.r, d);
        const hovered = hover !== null && hover[0] === c && hover[1] === r;
        out.push({ c, r, anim: (hovered ? 'S.' : '') + TURN_ANIM[d], layer: LAYER.icon });
      }
    }
    return out;
  }
  if (hover) out.push({ c: hover[0], r: hover[1], anim: cursor, layer: LAYER.ground });
  return out;
}
