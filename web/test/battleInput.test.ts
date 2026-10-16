import { describe, expect, it } from 'vitest';
import { cellCommand } from '../src/game/battleInput';
import { BattleGrid } from '../src/battle/grid';
import { emptyInventory } from '../src/battle/inventory';
import { RangeTable } from '../src/battle/moveRange';
import type { BattleState, Selection } from '../src/battle/types';
import { fixedRng, flatMap, unit, units } from './helpers/battleFixtures';

const entry = { event: 1, label: 'x', map: 'stage49', roster: 49, episode: '', objective: '', heal: true };
const withSel = (sel: Selection): BattleState => {
  const map = flatMap(7);
  return { entry, map, grid: new BattleGrid(map), units: units(unit({ slot: 0, c: 3, r: 3 }), unit({ slot: 1, c: 5, r: 5 }), unit({ slot: 10, side: 4, id: 8, c: 4, r: 3 })), turn: 1, phase: { kind: 'player', sel }, rng: fixedRng([0]), lastPath: [], inventory: emptyInventory() };
};
const range = new RangeTable(3, 3);

describe('cellCommand (the battle page click mapping)', () => {
  it('idle: clicking a party unit selects it; clicking an enemy or the ground does nothing', () => {
    expect(cellCommand(withSel({ mode: 'idle' }), [3, 3])).toEqual({ type: 'select', slot: 0 });
    expect(cellCommand(withSel({ mode: 'idle' }), [4, 3])).toBeNull();
    expect(cellCommand(withSel({ mode: 'idle' }), [0, 0])).toBeNull();
  });
  it('menu: another party unit reselects; move/target send the cell; face picks a direction or keeps it', () => {
    expect(cellCommand(withSel({ mode: 'menu', slot: 0, range }), [5, 5])).toEqual({ type: 'select', slot: 1 });
    expect(cellCommand(withSel({ mode: 'menu', slot: 0, range }), [3, 3])).toBeNull();
    expect(cellCommand(withSel({ mode: 'move', slot: 0, range }), [2, 3])).toEqual({ type: 'move', c: 2, r: 3 });
    expect(cellCommand(withSel({ mode: 'target', slot: 0, action: 0, range }), [4, 3])).toEqual({ type: 'act', c: 4, r: 3 });
    expect(cellCommand(withSel({ mode: 'face', slot: 0 }), [4, 3])).toEqual({ type: 'face', dir: 1 });
    expect(cellCommand(withSel({ mode: 'face', slot: 0 }), [3, 2])).toEqual({ type: 'face', dir: 3 });
    expect(cellCommand(withSel({ mode: 'face', slot: 0 }), [3, 3])).toEqual({ type: 'face', dir: 0 });
    expect(cellCommand(withSel({ mode: 'face', slot: 0 }), [6, 6])).toBeNull();
  });
  it('does nothing outside the player phase', () => {
    const s = withSel({ mode: 'idle' }); s.phase = { kind: 'enemy', queue: [] };
    expect(cellCommand(s, [3, 3])).toBeNull();
  });
});
