import { describe, expect, it } from 'vitest';
import { emptyInventory, giveItem } from '../src/battle/inventory';
import { BattleGrid } from '../src/battle/grid';
import { RangeTable } from '../src/battle/moveRange';
import type { BattleState } from '../src/battle/types';
import { describeHit, Panel } from '../src/ui/panel';
import { unitName } from '../src/ui/names';
import { menuEnabled } from '../src/ui/menuEnabled';
import { fixedRng, flatMap, tables, unit, units } from './helpers/battleFixtures';
import { fakeDocument, type FakeElement } from './helpers/fakeDom';

const entry = { event: 1, label: 'x', map: 'stage49', roster: 49, episode: '', objective: '', heal: true };
const base = (phase: BattleState['phase'], us = units(unit({ slot: 0, spells: [1] }), unit({ slot: 10, side: 4, id: 8, race: 1 }))): BattleState => {
  const map = flatMap(5);
  return { entry, map, grid: new BattleGrid(map), units: us, turn: 1, phase, rng: fixedRng([0]), lastPath: [], inventory: emptyInventory() };
};

describe('menuEnabled', () => {
  it('idle: only end turn; menu: move/attack/magic/wait by flags; enemy phase: nothing', () => {
    const items = tables().item;
    expect(menuEnabled(base({ kind: 'player', sel: { mode: 'idle' } }), items)).toEqual({ move: false, attack: false, magic: false, item: false, wait: false, endTurn: true });
    const range = new RangeTable(0, 0); range.setMove(0, 0, 30); range.setMove(1, 0, 25);
    expect(menuEnabled(base({ kind: 'player', sel: { mode: 'menu', slot: 0, range } }), items)).toEqual({ move: true, attack: true, magic: true, item: false, wait: true, endTurn: true });
    const moved = units(unit({ slot: 0, moved: true, acted: true, spells: [] }));
    expect(menuEnabled(base({ kind: 'player', sel: { mode: 'menu', slot: 0, range } }, moved), items)).toEqual({ move: false, attack: false, magic: false, item: false, wait: true, endTurn: true });
    expect(menuEnabled(base({ kind: 'enemy', queue: [] }), items)).toEqual({ move: false, attack: false, magic: false, item: false, wait: false, endTurn: false });
  });
});

describe('menuEnabled: move needs somewhere to go', () => {
  it('move is disabled when the selection range has no cell to stop on (plan Review Focus 2)', () => {
    const range = new RangeTable(0, 0); range.setMove(0, 0, 30);                    // only the own cell
    expect(menuEnabled(base({ kind: 'player', sel: { mode: 'menu', slot: 0, range } })).move).toBe(false);
    range.setMove(1, 0, 25);
    expect(menuEnabled(base({ kind: 'player', sel: { mode: 'menu', slot: 0, range } })).move).toBe(true);
    const blocked = units(unit({ slot: 0, spells: [1] }), unit({ slot: 1, c: 1, r: 0 }));  // the only reachable cell is occupied
    expect(menuEnabled(base({ kind: 'player', sel: { mode: 'menu', slot: 0, range } }, blocked)).move).toBe(false);
  });
});

describe('Panel spell list', () => {
  const ids = ['battle', 'seed', 'start', 'turn', 'unit', 'move', 'attack', 'magic', 'wait', 'endTurn', 'spells', 'log', 'result', 'error', 'objective', 'item', 'items', 'inventory'];
  it('keeps the same spell buttons across frames so a click can land, and refreshes only their enabled state', () => {
    const doc = fakeDocument(ids);
    const sent: unknown[] = [];
    const panel = new Panel(doc, { onStart: () => {}, onCommand: (c) => sent.push(c) }, tables());
    const range = new RangeTable(0, 0); range.setMove(0, 0, 30);
    const s = base({ kind: 'player', sel: { mode: 'menu', slot: 0, range } }, units(unit({ slot: 0, spells: [1, 2] }), unit({ slot: 10, side: 4, id: 8, race: 1 })));
    panel.update(s, null);
    const spells = doc.getElementById('spells') as unknown as FakeElement;
    const first = [...spells.children];
    expect(first).toHaveLength(2);
    panel.update(s, null);
    expect(spells.children[0]).toBe(first[0]);
    expect(spells.children[1]).toBe(first[1]);
    s.units[0]!.mp = 0;
    panel.update(s, null);
    expect(spells.children[0]).toBe(first[0]);
    expect(first.map((b) => b.disabled)).toEqual([true, true]);
    first[0]!.click();
    expect(sent).toEqual([{ type: 'beginTarget', action: 1 }]);
    s.units[0]!.spells = [2];                                                        // a different spell list rebuilds the buttons
    panel.update(s, null);
    expect(spells.children).toHaveLength(1);
    expect(spells.children[0]).not.toBe(first[1]);
  });
});

describe('menuEnabled.item and the item list', () => {
  const ids = ['battle', 'seed', 'start', 'turn', 'unit', 'move', 'attack', 'magic', 'wait', 'endTurn', 'spells', 'log', 'result', 'error', 'objective', 'item', 'items', 'inventory'];
  it('item is enabled only while a usable consumable is held and the unit has not acted', () => {
    const range = new RangeTable(0, 0); range.setMove(0, 0, 30);
    const s = base({ kind: 'player', sel: { mode: 'menu', slot: 0, range } });
    expect(menuEnabled(s, tables().item).item).toBe(false);
    giveItem(s.inventory, null, 9, 1, tables().item);                            // no use effect
    expect(menuEnabled(s, tables().item).item).toBe(false);
    giveItem(s.inventory, null, 7, 1, tables().item);
    expect(menuEnabled(s, tables().item).item).toBe(true);
    s.units[0]!.acted = true;
    expect(menuEnabled(s, tables().item).item).toBe(false);
  });
  it('item buttons keep their identity across frames, send beginTarget 1000+id, and the inventory text lists gold, stacks and bags', () => {
    const doc = fakeDocument(ids);
    const sent: unknown[] = [];
    const panel = new Panel(doc, { onStart: () => {}, onCommand: (c) => sent.push(c) }, tables());
    const range = new RangeTable(0, 0); range.setMove(0, 0, 30);
    const s = base({ kind: 'player', sel: { mode: 'menu', slot: 0, range } });
    s.inventory.gold = 300; giveItem(s.inventory, null, 7, 3, tables().item); giveItem(s.inventory, s.units[0]!, 1, 1, tables().item);
    panel.update(s, null);
    const list = doc.getElementById('items') as unknown as FakeElement;
    expect(list.children.map((b) => b.textContent)).toEqual(['herb ×3']);
    const first = list.children[0]!;
    panel.update(s, null);
    expect(list.children[0]).toBe(first);
    first.click();
    expect(sent).toEqual([{ type: 'beginTarget', action: 1007 }]);
    const inv = doc.getElementById('inventory') as unknown as FakeElement;
    expect(inv.textContent).toBe('골드 300\n소모품: herb ×3\n카린: sword, -, -, -');
    s.inventory.items[0]!.count = 2;
    panel.update(s, null);
    expect(list.children[0]).not.toBe(first);
    expect(list.children[0]!.textContent).toBe('herb ×2');
  });
});

describe('unitName / describeHit', () => {
  const t = tables();
  it('names party characters from the speaker table and others by race', () => {
    expect(unitName(unit({ slot: 0, id: 1 }), t)).toBe('카린');
    expect(unitName(unit({ slot: 0, id: 2 }), t)).toBe('알');
    expect(unitName(unit({ slot: 10, id: 8, race: 1 }), t)).toBe('slime');
    expect(unitName(unit({ slot: 12, id: 27, side: 7, race: 9 }), t)).toBe('종족 9');   // the spoils of a named foe keep its id (removeFallen) but are an object now (side 7, race 9 = gold), not 히드라
  });
  it('writes one log line per hit', () => {
    const a = unit({ slot: 0, id: 1 }), e = unit({ slot: 10, id: 8, race: 1 });
    const us = units(a, e);
    expect(describeHit(a, { target: 10, kind: 'damage', value: 12, crit: true, popup: '12', statusAfter: 1 }, us, t)).toBe('카린 → slime: 12 (크리티컬) 쓰러짐');
    expect(describeHit(a, { target: 10, kind: 'miss', value: 0, crit: false, popup: 'miss!', statusAfter: 0 }, us, t)).toBe('카린 → slime: 빗나감');
    expect(describeHit(a, { target: 0, kind: 'heal', value: 7, crit: false, popup: '7', statusAfter: 0 }, us, t)).toBe('카린 → 카린: 회복 7');
    expect(describeHit(a, { target: 10, kind: 'status', value: 3, crit: false, popup: '', statusAfter: 3 }, us, t)).toBe('카린 → slime: 수면');
  });
});
