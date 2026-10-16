import type { Command, BattleState } from '../battle/types';

/** What a click on a map cell means in the current selection state (game.html and play.html share this). */
export function cellCommand(state: BattleState, cell: [number, number]): Command | null {
  if (state.phase.kind !== 'player') return null;
  const sel = state.phase.sel;
  const u = state.units.find((x) => x && x.c === cell[0] && x.r === cell[1]) ?? null;
  switch (sel.mode) {
    case 'idle': return u && u.side === 0 ? { type: 'select', slot: u.slot } : null;
    case 'menu': return u && u.side === 0 && u.slot !== sel.slot ? { type: 'select', slot: u.slot } : null;
    case 'move': return { type: 'move', c: cell[0], r: cell[1] };
    case 'target': return { type: 'act', c: cell[0], r: cell[1] };
    case 'face': {
      const me = state.units[sel.slot]!;
      const d = Math.abs(cell[0] - me.c) + Math.abs(cell[1] - me.r);
      if (d === 0) return { type: 'face', dir: me.dir };
      if (d === 1) return { type: 'face', dir: cell[0] > me.c ? 1 : cell[0] < me.c ? 2 : cell[1] > me.r ? 0 : 3 };
      return null;
    }
  }
}
