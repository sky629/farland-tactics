import { describe, expect, it } from 'vitest';
import { startBattle } from '../src/battle/battle';
import { unit } from './helpers/battleFixtures';

describe('BATTLE_START / BATTLE_START_HEAL (FT2.exe 0x4085f0 opcodes 0x35 / 0x1d)', () => {
  it('BATTLE_START brings every fallen unit back with 1 HP, clears every status but hidden, and resets flags and buffs', () => {
    const dead = unit({ slot: 0, id: 1, hp: 0, status: 1 });
    const poisoned = unit({ slot: 1, id: 2, hp: 12, status: 2 });
    const hidden = unit({ slot: 2, id: 3, hp: 20, status: 9 });
    const foe = unit({ slot: 10, id: 8, side: 4, hp: 0, status: 1 });
    poisoned.buff.str = 5; poisoned.moved = true; poisoned.acted = true; poisoned.special = true;
    startBattle([dead, poisoned, hidden, foe], false);
    expect([dead.hp, dead.status]).toEqual([1, 0]);
    expect([poisoned.hp, poisoned.status]).toEqual([12, 0]);
    expect([hidden.hp, hidden.status]).toEqual([20, 9]);
    expect([foe.hp, foe.status]).toEqual([1, 0]);
    expect(poisoned.buff.str).toBe(0);
    expect([poisoned.moved, poisoned.acted, poisoned.special]).toEqual([false, false, false]);
  });
  it('BATTLE_START_HEAL gives everyone full HP, half MP and status 0 — a fallen unit too (FUN_0040a5c0 case 0x28 clears every status but 9 before the revival step)', () => {
    const dead = unit({ slot: 0, id: 1, hp: 0, status: 1, hpMax: 40, mpMax: 30, mp: 0 });
    const hurt = unit({ slot: 1, id: 2, hp: 3, hpMax: 50, mpMax: 10, mp: 10 });
    startBattle([dead, hurt], true);
    expect([dead.hp, dead.mp, dead.status]).toEqual([40, 15, 0]);
    expect([hurt.hp, hurt.mp]).toEqual([50, 5]);
  });
  it('objects (side 7) are left alone: a hidden chest with 0 HP stays hidden for the adjacency reveal', () => {
    const chest = unit({ slot: 12, id: 8, side: 7, race: 8, hp: 0, hpMax: 0, status: 9 });
    startBattle([chest], true);
    expect([chest.hp, chest.status]).toEqual([0, 9]);
  });
});
