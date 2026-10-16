import { describe, expect, it } from 'vitest';
import { applyRoster, Battle, createParty, isDash } from '../src/battle/battle';
import { BattleGrid } from '../src/battle/grid';
import { countOf, emptyInventory, giveItem } from '../src/battle/inventory';
import type { BattleEvent, Command } from '../src/battle/types';
import { DataError } from '../src/data/loader';
import type { RosterUnit } from '../src/data/types';
import { fixedRng, flatMap, tables, unit } from './helpers/battleFixtures';

const entry = { event: 1, label: 'outfield', map: 'stage49', roster: 49, episode: '첫업무', objective: '!', heal: true };
const t = tables();
const rec = (over: Partial<RosterUnit>): RosterUnit => ({ unit_id: 1, race: 0, level: 2, dir: 2, c: 1, r: 1, status: 0, side: 0, weapon: 1, armor: 5, drop_item: 0, drop_gold: 0, ...over });
const roster1 = [rec({ unit_id: 1 }), rec({ unit_id: 2, race: 0, c: 1, r: 2, weapon: 1, armor: 0 })];
/** two heroes at the left, two slimes at the right of a 9×9 map. */
const roster = [rec({ unit_id: 1, level: 3, c: 2, r: 4, weapon: 0, armor: 0 }), rec({ unit_id: 2, c: 2, r: 5, weapon: 0, armor: 0 }),
  rec({ unit_id: 8, race: 1, level: 1, side: 4, c: 6, r: 4, weapon: 1 }), rec({ unit_id: 8, race: 1, level: 1, side: 4, c: 7, r: 6, weapon: 1 })];
const start = (seed = 1, map = flatMap(9), ros = roster) => Battle.start(entry, map, roster1, ros, t, seed);
const types = (events: BattleEvent[]) => events.map((e) => e.type);

describe('deaths outside an action (status ticks)', () => {
  it('enemies killed by poison at the start of their phase are removed or become drops, and the battle ends', () => {
    const b = start();
    const e1 = b.state.units[10]!, e2 = b.state.units[11]!;
    e1.status = 2; e1.hp = 1; e2.status = 2; e2.hp = 1; e2.dropGold = 5;
    const ev = b.reduce({ type: 'endTurn' });
    expect(b.state.units[10]).toBeNull();
    expect(b.state.units[11]).toMatchObject({ side: 7, race: 9, id: 8 });
    expect(b.state.phase).toEqual({ kind: 'end', result: 'victory' });
    expect(types(ev).slice(-1)).toEqual(['end']);
    expect(types(ev).filter((t) => t === 'died')).toHaveLength(2);
  });
  it('a poisoned last party member who dies at the end of the enemy phase loses the battle', () => {
    const b = start(1, flatMap(9), roster.filter((r) => r.unit_id !== 2));
    const hero = b.state.units[0]!; hero.status = 2; hero.hp = 1;
    for (const s of [10, 11]) { b.state.units[s]!.status = 3; b.state.units[s]!.statusCounter = 999; }   // asleep, never cured
    const ev = b.reduce({ type: 'endTurn' });
    expect(hero.status).toBe(1);
    expect(b.state.phase).toEqual({ kind: 'end', result: 'defeat' });
    expect(types(ev).slice(-1)).toEqual(['end']);
    expect(types(ev)).not.toContain('roundStart');
  });
});

describe('map-wide spells and menu ranges', () => {
  it('a shape-4 spell is confirmed on the caster\'s cell and hits every enemy on the map', () => {
    const b = start();
    const hero = b.state.units[0]!; hero.spells = [6]; hero.mp = 20;
    b.reduce({ type: 'select', slot: 0 });
    expect(b.reduce({ type: 'beginTarget', action: 6 })).toEqual([]);
    const ev = b.reduce({ type: 'act', c: hero.c, r: hero.r });
    const action = ev.find((e) => e.type === 'action');
    expect(action && action.type === 'action' ? action.hits.map((h) => h.target).sort() : null).toEqual([10, 11]);
  });
  it('cancelling a target selection restores the move range of the menu', () => {
    const b = start();
    const hero = b.state.units[0]!; hero.spells = [1]; hero.mp = 20;
    b.reduce({ type: 'select', slot: 0 });
    expect(b.reduce({ type: 'beginTarget', action: 1 })).toEqual([]);
    b.reduce({ type: 'cancel' });
    const sel = b.state.phase.kind === 'player' ? b.state.phase.sel : null;
    expect(sel?.mode).toBe('menu');
    expect(sel && sel.mode === 'menu' ? sel.range.moveAt(hero.c + 1, hero.r) : 0).toBeGreaterThan(0);
  });
});

describe('treasure pickup (battle_rules §4.4)', () => {
  const chest = (over: Partial<RosterUnit>) => rec({ unit_id: 8, race: 9, side: 7, level: 1, c: 3, r: 4, ...over });
  const moveHero = (b: Battle, c: number, r: number) => { b.reduce({ type: 'select', slot: 0 }); b.reduce({ type: 'beginMove' }); return b.reduce({ type: 'move', c, r }); };
  it('standing on a gold chest adds the gold and removes the chest', () => {
    const b = start(1, flatMap(9), [...roster, chest({ drop_gold: 50 })]);
    const ev = moveHero(b, 3, 4);
    expect(types(ev)).toEqual(['moved', 'pickup', 'removed']);
    expect(ev[1]).toEqual({ type: 'pickup', slot: 0, item: 0, gold: 50 });
    expect(b.state.inventory.gold).toBe(50);
    expect(b.state.units[12]).toBeNull();
  });
  it('an item chest goes to the party inventory, equipment into the bag of the unit that stepped on it', () => {
    const b = start(1, flatMap(9), [...roster, chest({ drop_item: 7 }), chest({ drop_item: 1, c: 2, r: 3 })]);
    moveHero(b, 3, 4);
    expect(countOf(b.state.inventory, 7)).toBe(1);
    const b2 = start(1, flatMap(9), [...roster, chest({ drop_item: 1 })]);
    moveHero(b2, 3, 4);
    expect(b2.state.units[0]!.bag).toEqual([1, 0, 0, 0]);
  });
  it('a full bag leaves the treasure where it is', () => {
    const b = start(1, flatMap(9), [...roster, chest({ drop_item: 1 })]);
    b.state.units[0]!.bag = [1, 1, 1, 1];
    const ev = moveHero(b, 3, 4);
    expect(types(ev)).toEqual(['moved', 'bagFull']);
    expect(b.state.units[12]).toMatchObject({ side: 7, c: 3, r: 4 });
    expect(b.state.units[0]).toMatchObject({ c: 3, r: 4 });
  });
  it('a hidden story object (not a chest) is neither taken nor destroyed when stepped on', () => {
    const b = start(1, flatMap(9), [...roster, chest({ unit_id: 14, status: 9 })]);        // a hidden NPC object (e.g. 잃어버린 어린이) at (3,4)
    const ev = moveHero(b, 3, 4);
    expect(types(ev)).toEqual(['moved']);
    expect(b.state.units[12]).toMatchObject({ id: 14, side: 7, status: 9 });
    expect(b.state.inventory.gold).toBe(0);
  });
  it('a hidden chest next to the destination is revealed', () => {
    const b = start(1, flatMap(9), [...roster, chest({ drop_gold: 5, c: 4, r: 4, status: 9 })]);
    const ev = moveHero(b, 3, 4);
    expect(types(ev)).toEqual(['moved', 'revealed']);
    expect(b.state.units[12]!.status).toBe(0);
  });
});

describe('items in battle (spec §5.3)', () => {
  const withHerbs = (n = 2) => { const inv = emptyInventory(); giveItem(inv, null, 7, n, t.item); giveItem(inv, null, 9, 1, t.item); return Battle.start(entry, flatMap(9), roster1, roster, t, 1, inv); };
  it('uses a held consumable on itself: target cell, effect, one consumed, acted', () => {
    const b = withHerbs();
    const hero = b.state.units[0]!; hero.hp = 1;
    b.reduce({ type: 'select', slot: 0 });
    expect(b.reduce({ type: 'beginTarget', action: 1007 })).toEqual([]);
    const sel = b.state.phase.kind === 'player' ? b.state.phase.sel : null;
    expect(sel && sel.mode === 'target' ? sel.range.kindAt(hero.c, hero.r) : 0).toBe(2);
    const ev = b.reduce({ type: 'act', c: hero.c, r: hero.r });
    expect(ev[0]).toMatchObject({ type: 'action', action: 1007, hits: [expect.objectContaining({ target: 0, kind: 'heal', value: 20 })] });
    expect(hero).toMatchObject({ hp: 21, acted: true, moved: false });
    expect(countOf(b.state.inventory, 7)).toBe(1);
  });
  it('rejects items the party does not hold or cannot use', () => {
    const b = withHerbs();
    b.reduce({ type: 'select', slot: 0 });
    expect(b.reduce({ type: 'beginTarget', action: 1008 })).toEqual([{ type: 'rejected', reason: 'no such item' }]);
    expect(b.reduce({ type: 'beginTarget', action: 1009 })).toEqual([{ type: 'rejected', reason: 'no such item' }]);
  });
  it('a revive item targets a fallen ally and brings it back', () => {
    const inv = emptyInventory(); giveItem(inv, null, 7, 1, t.item);
    const items = t.item.map((it, i) => (i === 7 ? { ...it, status_code: 1 } : it));             // make the herb a revive item for this test
    const b = Battle.start(entry, flatMap(9), roster1, roster, { ...t, item: items }, 1, inv);
    const ally = b.state.units[1]!; ally.hp = 0; ally.status = 1;
    b.reduce({ type: 'select', slot: 0 });
    b.reduce({ type: 'beginTarget', action: 1007 });
    const sel = b.state.phase.kind === 'player' ? b.state.phase.sel : null;
    expect(sel && sel.mode === 'target' ? sel.range.kindAt(ally.c, ally.r) : 0).toBe(2);
    b.reduce({ type: 'act', c: ally.c, r: ally.r });
    expect(ally).toMatchObject({ status: 0, hp: 20 });
  });
  it('the last of an item disappears after use', () => {
    const b = withHerbs(1);
    const hero = b.state.units[0]!; hero.hp = 1;
    b.reduce({ type: 'select', slot: 0 }); b.reduce({ type: 'beginTarget', action: 1007 }); b.reduce({ type: 'act', c: hero.c, r: hero.r });
    expect(b.state.inventory.items.find((s) => s.id === 7)).toBeUndefined();
  });
  it('cancelling item targeting consumes nothing', () => {
    const b = withHerbs();
    b.reduce({ type: 'select', slot: 0 }); b.reduce({ type: 'beginTarget', action: 1007 }); b.reduce({ type: 'cancel' });
    expect(b.state.phase.kind === 'player' && b.state.phase.sel.mode).toBe('menu');
    expect(countOf(b.state.inventory, 7)).toBe(2);
  });
  it('a battle started without an inventory has an empty one', () => {
    expect(start().state.inventory).toEqual({ items: [], gold: 0 });
  });
});

describe('party rules (spec §11)', () => {
  it('createParty builds slots 0.. from roster 1 with equipment; applyRoster keeps stats and moves the party', () => {
    const units = createParty(roster1, t, fixedRng([0]));
    expect(units[0]).toMatchObject({ id: 1, weapon: 1, armor: 5, level: 2 });
    expect(units[1]).toMatchObject({ id: 2, slot: 1 });
    applyRoster(units, roster, t, fixedRng([0]));
    expect(units[0]).toMatchObject({ c: 2, r: 4, weapon: 1, armor: 5, level: 2 });     // position only
    expect(units[10]).toMatchObject({ id: 8, race: 1, side: 4, c: 6, r: 4 });
    expect(units[11]).toMatchObject({ slot: 11, c: 7, r: 6 });
  });
  it('Battle.start syncs party levels up to the roster level, drops party members missing from the roster, heals and clears flags', () => {
    const b = start();
    expect(b.state.units[0]).toMatchObject({ level: 3, moved: false, acted: false });
    expect(b.state.units[0]!.hp).toBe(b.state.units[0]!.hpMax);
    expect(b.state.units[0]!.mp).toBe(Math.trunc(b.state.units[0]!.mpMax / 2));
    const solo = Battle.start(entry, flatMap(9), roster1, roster.filter((r) => r.unit_id !== 2), t, 1);
    expect(solo.state.units[1]).toBeNull();
    expect(solo.state.phase).toEqual({ kind: 'player', sel: { mode: 'idle' } });
  });
  it('(0, 0) placeholders: party units are placed next to the placed party, non-party units are dropped', () => {
    const map = flatMap(9); map.cellAt[0] = -1;                                         // (0, 0) does not exist, as on the real maps
    const ros = roster.map((r) => (r.unit_id === 2 ? { ...r, c: 0, r: 0 } : r));
    ros.push({ ...roster[2]!, c: 0, r: 0 });                                             // a reinforcement the script would place later
    const b = Battle.start(entry, map, roster1, ros, t, 1);
    const hero2 = b.state.units[1]!;
    expect(b.state.grid.cell(hero2.c, hero2.r)).not.toBeNull();
    expect(Math.abs(hero2.c - 2) + Math.abs(hero2.r - 4)).toBeLessThanOrEqual(1);   // around hero 1 at (2,4)
    expect([hero2.c, hero2.r]).not.toEqual([2, 4]);
    expect(b.state.units[12]).toBeNull();
    expect(b.state.units[10]).not.toBeNull();
  });
  it('rejects a roster unit placed on a missing cell', () => {
    const map = flatMap(9);
    map.cellAt[6 * 9 + 4] = -1;
    expect(() => start(1, map)).toThrow(DataError);
    expect(() => start(1, map)).toThrow(/\(6, 4\)/);
  });
});

describe('isDash (FUN_0043afd0)', () => {
  const grid = new BattleGrid(flatMap(9, (c, r) => (c === 4 && r === 4 ? { h: 3 } : {})));
  const hero = unit({ slot: 0, c: 5, r: 4, side: 0 });
  it('needs a party unit, three straight steps in the attack direction, flat ground and no special flag', () => {
    expect(isDash(grid, hero, [1, 1, 1], [6, 4], t.item[1]!)).toBe(false);    // passes over h 3 at (4,4)
    expect(isDash(grid, { ...hero, r: 2 }, [1, 1, 1], [6, 2], t.item[1]!)).toBe(true);
    expect(isDash(grid, { ...hero, r: 2 }, [1, 1], [6, 2], t.item[1]!)).toBe(false);
    expect(isDash(grid, { ...hero, r: 2 }, [1, 1, 1], [5, 3], t.item[1]!)).toBe(false);   // attack not in the run direction
    expect(isDash(grid, { ...hero, r: 2, special: true }, [1, 1, 1], [6, 2], t.item[1]!)).toBe(false);
    expect(isDash(grid, { ...hero, r: 2, side: 4 }, [1, 1, 1], [6, 2], t.item[1]!)).toBe(false);
    expect(isDash(grid, { ...hero, r: 2 }, [1, 1, 1], [7, 2], t.item[2]!)).toBe(false);   // bow needs an adjacent target
  });
});

describe('Battle.reduce — player phase', () => {
  it('select → beginMove → move → beginTarget → act → face runs one unit through its turn', () => {
    const b = start(1);
    expect(types(b.reduce({ type: 'select', slot: 0 }))).toEqual(['selected']);
    expect(b.state.phase).toMatchObject({ kind: 'player', sel: { mode: 'menu', slot: 0 } });
    expect(types(b.reduce({ type: 'beginMove' }))).toEqual([]);
    const moved = b.reduce({ type: 'move', c: 5, r: 4 });
    expect(moved).toEqual([{ type: 'moved', slot: 0, path: [1, 1, 1], to: [5, 4] }]);
    expect(b.state.units[0]).toMatchObject({ c: 5, r: 4, dir: 1, moved: true });
    expect(types(b.reduce({ type: 'beginTarget', action: 0 }))).toEqual([]);
    expect(b.state.phase).toMatchObject({ sel: { mode: 'target', action: 0 } });
    const acted = b.reduce({ type: 'act', c: 6, r: 4 });
    expect(acted[0]).toMatchObject({ type: 'action', slot: 0, action: 0, cell: [6, 4] });
    expect(b.state.units[0]!.acted).toBe(true);
    expect(b.state.phase).toMatchObject({ sel: { mode: 'face', slot: 0 } });
    expect(b.reduce({ type: 'face', dir: 3 })).toEqual([{ type: 'faced', slot: 0, dir: 3 }]);
    expect(b.state.units[0]!.dir).toBe(3);
    expect(b.state.phase).toMatchObject({ sel: { mode: 'idle' } });
  });
  it('rejects commands the rules forbid without changing state', () => {
    const b = start(1);
    expect(b.reduce({ type: 'select', slot: 10 })).toEqual([{ type: 'rejected', reason: 'not a party unit' }]);
    expect(b.reduce({ type: 'move', c: 3, r: 4 })).toEqual([{ type: 'rejected', reason: 'no unit selected' }]);
    b.reduce({ type: 'select', slot: 0 });
    expect(b.reduce({ type: 'move', c: 3, r: 4 })).toEqual([{ type: 'rejected', reason: 'not moving' }]);
    b.reduce({ type: 'beginMove' });
    expect(b.reduce({ type: 'move', c: 2, r: 5 })).toEqual([{ type: 'rejected', reason: 'cannot stop there' }]);   // ally stands there
    b.reduce({ type: 'move', c: 3, r: 4 });
    expect(b.reduce({ type: 'beginMove' })).toEqual([{ type: 'rejected', reason: 'already moved' }]);
    expect(b.reduce({ type: 'beginTarget', action: 0 })).toEqual([{ type: 'rejected', reason: 'no target in range' }]);
    expect(b.reduce({ type: 'beginTarget', action: 2 })).toEqual([{ type: 'rejected', reason: 'unknown spell' }]);   // heal (learn_mask 2) belongs to id 2
    b.reduce({ type: 'wait' });
    expect(b.state.phase).toMatchObject({ sel: { mode: 'face' } });
    expect(b.reduce({ type: 'cancel' })).toEqual([{ type: 'rejected', reason: 'choose a direction' }]);
    b.reduce({ type: 'face', dir: 0 });
    expect(b.reduce({ type: 'select', slot: 0 })).toEqual([{ type: 'rejected', reason: 'unit finished' }]);
  });
  it('move is rejected when the range has no reachable cell', () => {
    const map = flatMap(9, (c, r) => ((Math.abs(c - 2) + Math.abs(r - 4) === 1) ? { blocked: 1 } : {}));
    const b = start(1, map, roster.map((r) => (r.unit_id === 2 ? { ...r, c: 0, r: 0 } : r)));
    b.reduce({ type: 'select', slot: 0 });
    expect(b.reduce({ type: 'beginMove' })).toEqual([{ type: 'rejected', reason: 'nowhere to move' }]);
  });
  it('cancel steps back: target → menu → idle; the enemy phase refuses player commands', () => {
    const b = start(1);
    b.reduce({ type: 'select', slot: 0 });
    b.reduce({ type: 'beginMove' });
    expect(b.reduce({ type: 'cancel' })).toEqual([]);
    expect(b.state.phase).toMatchObject({ sel: { mode: 'menu' } });
    expect(b.reduce({ type: 'cancel' })).toEqual([{ type: 'deselected' }]);
    b.reduce({ type: 'endTurn' });
    expect(b.state.phase.kind).toBe('enemy');
    expect(b.reduce({ type: 'select', slot: 0 })).toEqual([{ type: 'rejected', reason: 'enemy phase' }]);
  });
});

describe('Battle.reduce — enemy phase and rounds', () => {
  it('endTurn queues every hostile enemy; enemySteps run them and a new round starts', () => {
    const b = start(1);
    const ev = b.reduce({ type: 'endTurn' });
    expect(ev[0]).toEqual({ type: 'phase', kind: 'enemy' });
    expect(b.state.phase).toEqual({ kind: 'enemy', queue: [10, 11] });
    const step1 = b.reduce({ type: 'enemyStep' });
    expect(step1.some((e) => e.type === 'moved')).toBe(true);
    expect(b.state.units[10]!.moved).toBe(true);
    expect(b.state.phase).toEqual({ kind: 'enemy', queue: [11] });
    const step2 = b.reduce({ type: 'enemyStep' });                  // last queued unit → the round ends in the same batch
    expect(types(step2).slice(-2)).toEqual(['roundStart', 'phase']);
    expect(b.state.turn).toBe(2);
    expect(b.state.units[0]!.moved).toBe(false);
    expect(b.reduce({ type: 'enemyStep' })).toEqual([{ type: 'rejected', reason: 'player phase' }]);
  });
  it('all party units finished → the enemy phase begins by itself', () => {
    const b = start(1);
    for (const slot of [0, 1]) { b.reduce({ type: 'select', slot }); b.reduce({ type: 'wait' }); b.reduce({ type: 'face', dir: 1 }); }
    expect(b.state.phase.kind).toBe('enemy');
  });
  it('killing the last enemy ends the battle with victory and later commands are rejected', () => {
    const b = Battle.start(entry, flatMap(9), roster1, [roster[0]!, roster[1]!, { ...roster[2]!, c: 3, r: 4 }], t, 1);
    const slime = b.state.units[10]!;
    slime.hp = 1;
    b.state.rng = fixedRng([99]);                                   // no critical, no evade
    b.reduce({ type: 'select', slot: 0 });
    b.reduce({ type: 'beginTarget', action: 0 });
    const ev = b.reduce({ type: 'act', c: 3, r: 4 });
    expect(ev.some((e) => e.type === 'end' && e.result === 'victory')).toBe(true);
    expect(b.state.phase).toEqual({ kind: 'end', result: 'victory' });
    expect(b.reduce({ type: 'select', slot: 1 })).toEqual([{ type: 'rejected', reason: 'battle over' }]);
  });
  it('the same seed and commands produce the same events', () => {
    const script: Command[] = [{ type: 'select', slot: 0 }, { type: 'beginMove' }, { type: 'move', c: 5, r: 4 }, { type: 'beginTarget', action: 0 },
      { type: 'act', c: 6, r: 4 }, { type: 'face', dir: 1 }, { type: 'endTurn' }, { type: 'enemyStep' }, { type: 'enemyStep' }, { type: 'enemyStep' }];
    const run = () => { const b = start(42); return JSON.stringify(script.flatMap((c) => b.reduce(c))); };
    expect(run()).toBe(run());
  });
});
