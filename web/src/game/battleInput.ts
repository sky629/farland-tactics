import type { Command, BattleState } from '../battle/types';

/**
 * What a click on a map cell means in the current selection state — the original's grammar ("공격할 상대 또는 이동할 곳을 클릭해
 * 주십시오", strings 0x44ba6c..0x44ba80): a selected party unit attacks the enemy you click, walks to the cell you click, and
 * waits (turns to face) when you click its own cell. Several engine commands may follow one click; the caller stops at a rejection.
 * game.html and play.html share this.
 */
export function cellCommands(state: BattleState, cell: [number, number]): Command[] {
  if (state.phase.kind !== 'player') return [];
  const sel = state.phase.sel;
  const u = state.units.find((x) => x && x.c === cell[0] && x.r === cell[1]) ?? null;
  const own = u !== null && u.side === 0, hostile = u !== null && u.side !== 0 && u.side !== 7;
  switch (sel.mode) {
    case 'idle': return own ? [{ type: 'select', slot: u.slot }, { type: 'beginMove' }] : [];
    case 'menu': {
      if (own && u.slot !== sel.slot) return [{ type: 'select', slot: u.slot }, { type: 'beginMove' }];
      if (own) return [{ type: 'wait' }];
      if (hostile) return [{ type: 'beginTarget', action: 0 }, { type: 'act', c: cell[0], r: cell[1] }];
      return [{ type: 'beginMove' }, { type: 'move', c: cell[0], r: cell[1] }];
    }
    case 'move': {
      if (own && u.slot === sel.slot) return [{ type: 'cancel' }, { type: 'wait' }];
      if (hostile) return [{ type: 'cancel' }, { type: 'beginTarget', action: 0 }, { type: 'act', c: cell[0], r: cell[1] }];
      return [{ type: 'move', c: cell[0], r: cell[1] }];
    }
    case 'target': return [{ type: 'act', c: cell[0], r: cell[1] }];
    case 'face': {
      const me = state.units[sel.slot]!;
      const d = Math.abs(cell[0] - me.c) + Math.abs(cell[1] - me.r);
      if (d === 0) return [{ type: 'face', dir: me.dir }];
      if (d === 1) return [{ type: 'face', dir: cell[0] > me.c ? 1 : cell[0] < me.c ? 2 : cell[1] > me.r ? 0 : 3 }];
      return [];
    }
  }
}
