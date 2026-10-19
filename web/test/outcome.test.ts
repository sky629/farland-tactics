import { describe, expect, it } from 'vitest';
import { Battle } from '../src/battle/battle';
import { emptyInventory } from '../src/battle/inventory';
import { BattleGrid } from '../src/battle/grid';
import { applyOutcome, checkEnd, expGain, roundStart, statusTick } from '../src/battle/outcome';
import type { Hit } from '../src/battle/resolve';
import { Rng, type RandomSource } from '../src/battle/rng';
import type { BattleState } from '../src/battle/types';
import { fixedRng, flatMap, RACE, tables, unit, units } from './helpers/battleFixtures';

const entry = { event: 1, label: 'outfield', map: 'stage49', roster: 49, episode: '', objective: '', heal: true };
function state(us: ReturnType<typeof units>, rng: RandomSource = Rng.fromSeed(1)): BattleState {
  const map = flatMap(9);
  return { entry, map, grid: new BattleGrid(map), units: us, turn: 1, phase: { kind: 'player', sel: { mode: 'idle' } }, rng, lastPath: [], inventory: emptyInventory() };
}
const dmg = (target: number, value: number, dead = false): Hit => ({ target, kind: 'damage', value, crit: false, popup: String(value), statusAfter: dead ? 1 : 0 });
const t = tables({ race: [RACE(), RACE({ name: 'slime', exp_value: 10, hp: 12 })] });

describe('expGain (FUN_0043a2e0 case 7)', () => {
  const actor = unit({ slot: 0, level: 2 });
  const slime = unit({ slot: 10, id: 8, race: 1, level: 1, side: 4, hpMax: 12, hp: 7 });
  it('damage share × race exp, level difference scaling, kill bonus, named enemy ×2', () => {
    expect(expGain(actor, slime, dmg(10, 5), t, { v: 7 })).toBe(3);              // 10×5/12 = 4 → 80 % → 3
    expect(expGain(actor, { ...slime, hp: 0 }, dmg(10, 7, true), t, { v: 7 })).toBe(12);   // 5 + 10 = 15 → 80 % → 12
    expect(expGain(actor, { ...slime, id: 20 }, dmg(10, 5), t, { v: 7 })).toBe(6);         // 4 × 2 = 8 → 80 % → 6
    expect(expGain(actor, { ...slime, level: 10 }, dmg(10, 5), t, { v: 7 })).toBe(10);     // 100 + 20·8 = 260 %
  });
  it('allies and message results take the halving series 7, 3, 1, 1; party targets give 0', () => {
    const k = { v: 7 };
    const ally = unit({ slot: 1 });
    expect(expGain(actor, ally, { ...dmg(1, 5), kind: 'heal' }, t, k)).toBe(7);
    expect(expGain(actor, slime, { ...dmg(10, 0), kind: 'miss' }, t, k)).toBe(3);
    expect(expGain(actor, slime, { ...dmg(10, 0), kind: 'miss' }, t, k)).toBe(1);
    expect(expGain(actor, slime, { ...dmg(10, 0), kind: 'miss' }, t, k)).toBe(1);
    expect(expGain(actor, unit({ slot: 2, side: 4 }), dmg(2, 5), t, { v: 7 })).toBe(0);   // a party slot that is hostile (charmed)
  });
});

describe('applyOutcome', () => {
  it('kills report deaths, EXP and level-ups; the corpses stay until settle converts drops into treasure objects and removes plain ones', () => {
    const actor = unit({ slot: 0, level: 1, exp: 95, hpMax: 30 });
    const chest = unit({ slot: 10, id: 8, race: 1, side: 4, hp: 0, status: 1, dropGold: 50, hpMax: 12 });
    const plain = unit({ slot: 11, id: 8, race: 1, side: 4, hp: 0, status: 1, hpMax: 12 });
    const named = unit({ slot: 12, id: 21, race: 1, side: 4, hp: 0, status: 1, hpMax: 12 });
    const s = state(units(actor, chest, plain, named));
    const events = applyOutcome(s, actor, [dmg(10, 12, true), dmg(11, 12, true), dmg(12, 12, true)], t);
    expect(events.map((e) => e.type)).toEqual(['died', 'died', 'died', 'exp', 'levelUp']);
    expect(events.find((e) => e.type === 'exp')).toMatchObject({ slot: 0, gain: 80 });   // per kill: 10×12/12 + 10 = 20, same level → 100 %; the named kill counts double
    expect(s.units[10]).toMatchObject({ side: 4, status: 1 });                            // still a corpse: the story hooks run first
    const settled = new Battle(s, t).settle();
    expect(s.units[10]).toMatchObject({ side: 7, race: 9, status: 0, id: 8 });
    expect(s.units[11]).toBeNull();
    expect(s.units[12]).toMatchObject({ id: 21, status: 1, side: 4 });                    // a named corpse stays (story_flow.md §5 case 9)
    expect(settled.map((e) => e.type)).toEqual(['removed', 'end']);
  });
  it('a drop item makes a chest (race 8) on settle and the battle is not over while a live enemy remains', () => {
    const actor = unit({ slot: 0, level: 5 });
    const dead = unit({ slot: 10, id: 8, race: 1, side: 4, hp: 0, status: 1, dropItem: 118, hpMax: 12 });
    const alive = unit({ slot: 11, id: 8, race: 1, side: 4, hp: 3, hpMax: 12 });
    const s = state(units(actor, dead, alive));
    const events = [...applyOutcome(s, actor, [dmg(10, 12, true)], t), ...new Battle(s, t).settle()];
    expect(s.units[10]).toMatchObject({ side: 7, race: 8 });
    expect(events.some((e) => e.type === 'end')).toBe(false);
  });
  it('a fallen named unit with a drop keeps its id (FUN_0043a2e0 case 9 sets only status, side and race), so the story finds it', () => {
    const actor = unit({ slot: 0, level: 5 });
    const dead = unit({ slot: 10, id: 27, race: 1, side: 4, hp: 0, status: 1, dropGold: 50, hpMax: 12 });
    const s = state(units(actor, dead));
    applyOutcome(s, actor, [dmg(10, 12, true)], t); new Battle(s, t).settle();
    expect(s.units[10]).toMatchObject({ side: 7, race: 9, status: 0, id: 27 });
  });
  it('party deaths stay as corpses and enemy actors earn nothing', () => {
    const enemy = unit({ slot: 10, id: 8, race: 1, side: 4 });
    const hero = unit({ slot: 0, hp: 0, status: 1 }), hero2 = unit({ slot: 1 });
    const s = state(units(hero, hero2, enemy));
    const events = applyOutcome(s, enemy, [dmg(0, 30, true)], t);
    expect(s.units[0]).toMatchObject({ status: 1 });
    expect(events.map((e) => e.type)).toEqual(['died']);
  });
});

describe('checkEnd, statusTick, roundStart', () => {
  it('victory when only objects remain; defeat when no party unit can act', () => {
    expect(checkEnd(state(units(unit({ slot: 0 }), unit({ slot: 10, side: 7, id: 8, race: 8 }))))).toBe('victory');
    expect(checkEnd(state(units(unit({ slot: 0 }), unit({ slot: 10, side: 1, id: 8 }))))).toBe('victory');
    expect(checkEnd(state(units(unit({ slot: 0, status: 3 }), unit({ slot: 10, side: 4, id: 8 }))))).toBe('defeat');
    expect(checkEnd(state(units(unit({ slot: 0 }), unit({ slot: 10, side: 4, id: 8 }))))).toBeNull();
  });
  it('poison bites HPmax/10+1; counters shrink and cure when below the roll; levitate lands', () => {
    const poisoned = unit({ slot: 10, side: 4, id: 8, status: 2, hp: 3, hpMax: 30 });
    const asleep = unit({ slot: 11, side: 4, id: 8, status: 3, statusCounter: 100 });
    const flying = unit({ slot: 12, side: 4, id: 8, status: 11, statusCounter: 10 });
    const s = state(units(poisoned, asleep, flying), fixedRng([90]));
    const events = statusTick(s, (u) => u.side !== 0);
    expect(poisoned).toMatchObject({ hp: 0, status: 1 });
    expect(s.units[10]).toBeNull();
    expect(asleep).toMatchObject({ status: 0, statusCounter: 85 });          // 85 < 90 → cured
    expect(flying).toMatchObject({ status: 0, statusCounter: 0 });
    expect(events).toEqual([
      { type: 'statusTick', slot: 10, status: 2, value: 3, cured: false },
      { type: 'died', slot: 10 },
      { type: 'removed', slot: 10 },                                             // a poison death leaves the field like any other
      { type: 'statusTick', slot: 11, status: 3, value: 85, cured: true },
      { type: 'statusTick', slot: 12, status: 11, value: 0, cured: true },
    ]);
  });
  it('roundStart clears flags, regenerates MP by ceil(max/10) and decays buffs toward zero', () => {
    const u = unit({ slot: 0, moved: true, acted: true, mp: 5, mpMax: 24, buff: { str: 3, def: 0, wis: -2, mgr: 0, agi: 1 } });
    const s = state(units(u));
    expect(roundStart(s)).toEqual([{ type: 'roundStart', turn: 2 }]);
    expect(u).toMatchObject({ moved: false, acted: false, mp: 8, buff: { str: 2, def: 0, wis: -1, mgr: 0, agi: 0 } });
    expect(s.turn).toBe(2);
  });
});
