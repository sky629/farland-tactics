import { describe, expect, it } from 'vitest';
import { cellCommands } from '../src/game/battleInput';
import type { BattleState } from '../src/battle/types';
import { unit } from './helpers/battleFixtures';

// a 9×9 flat field with Karin (slot 0) at (2,2), Al (slot 1) at (3,2) and a slime (slot 10, side 4) at (2,3)
const party = [unit({ slot: 0, id: 1, c: 2, r: 2 }), unit({ slot: 1, id: 2, c: 3, r: 2 })];
const foe = unit({ slot: 10, id: 8, side: 4, race: 1, c: 2, r: 3 });
const state = (sel: unknown): BattleState => ({ units: [...party, ...Array(8).fill(null), foe], phase: { kind: 'player', sel } } as unknown as BattleState);

describe('what a click means (the original: a selected unit attacks the enemy you click and walks to the cell you click)', () => {
  it('idle: clicking a party unit selects it and shows its move range at once', () => {
    expect(cellCommands(state({ mode: 'idle' }), [2, 2])).toEqual([{ type: 'select', slot: 0 }, { type: 'beginMove' }]);
    expect(cellCommands(state({ mode: 'idle' }), [2, 3])).toEqual([]);          // an enemy: nothing without a selection
  });
  it('with a unit selected: an enemy → attack, its own cell → wait (face), another party unit → select that one, elsewhere → move', () => {
    expect(cellCommands(state({ mode: 'menu', slot: 0 }), [2, 3])).toEqual([{ type: 'beginTarget', action: 0 }, { type: 'act', c: 2, r: 3 }]);
    expect(cellCommands(state({ mode: 'menu', slot: 0 }), [2, 2])).toEqual([{ type: 'wait' }]);
    expect(cellCommands(state({ mode: 'menu', slot: 0 }), [3, 2])).toEqual([{ type: 'select', slot: 1 }, { type: 'beginMove' }]);
    expect(cellCommands(state({ mode: 'menu', slot: 0 }), [5, 5])).toEqual([{ type: 'beginMove' }, { type: 'move', c: 5, r: 5 }]);
  });
  it('while the move range shows: an enemy → leave the range and attack, own cell → wait, elsewhere → move', () => {
    expect(cellCommands(state({ mode: 'move', slot: 0 }), [2, 3])).toEqual([{ type: 'cancel' }, { type: 'beginTarget', action: 0 }, { type: 'act', c: 2, r: 3 }]);
    expect(cellCommands(state({ mode: 'move', slot: 0 }), [2, 2])).toEqual([{ type: 'cancel' }, { type: 'wait' }]);
    expect(cellCommands(state({ mode: 'move', slot: 0 }), [5, 5])).toEqual([{ type: 'move', c: 5, r: 5 }]);
  });
  it('a target or a facing is one click', () => {
    expect(cellCommands(state({ mode: 'target', slot: 0 }), [2, 3])).toEqual([{ type: 'act', c: 2, r: 3 }]);
    expect(cellCommands(state({ mode: 'face', slot: 0 }), [3, 2])).toEqual([{ type: 'face', dir: 1 }]);
    expect(cellCommands(state({ mode: 'face', slot: 0 }), [7, 7])).toEqual([]);
  });
});
