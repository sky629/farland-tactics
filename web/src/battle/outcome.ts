import type { Tables } from '../data/types';
import { incap } from './grid';
import type { Hit } from './resolve';
import { growUnit, PARTY_SLOTS, type Unit } from './unit';
import type { BattleEvent, BattleState } from './types';

const trunc = Math.trunc;
const EXP_CAP = 9899;

/** FUN_0043a2e0 case 7: experience for one hit. `k` carries the halving series across the hits of one action. */
export function expGain(actor: Unit, target: Unit, hit: Hit, tables: Tables, k: { v: number }): number {
  const message = hit.kind !== 'damage' && hit.kind !== 'heal';
  if (target.side === 0 || message) {
    const gain = Math.max(k.v, 1);
    k.v = Math.max(trunc(k.v / 2), 1);
    return gain;
  }
  const v = hit.kind === 'heal' ? -hit.value : hit.value;
  const base = tables.race[target.race]!.exp_value;
  let gain = trunc((base * v) / Math.max(target.hpMax, 1));
  if (target.hp === 0) gain += base;
  if (target.id !== 8) gain *= 2;
  const pct = Math.max(100 + 20 * (target.level - actor.level), 10);
  gain = Math.max(trunc((pct * gain) / 100), 1);
  return target.slot < PARTY_SLOTS ? 0 : gain;
}

/** Party wiped (no unit able to act) → defeat; no live enemy (HP > 0, side ∉ {1, 7}, not hidden) → victory. */
export function checkEnd(state: BattleState): 'victory' | 'defeat' | null {
  const party = state.units.slice(0, PARTY_SLOTS).filter((u): u is Unit => u !== null);
  if (!party.some((u) => !incap(u.status))) return 'defeat';
  const enemies = state.units.slice(PARTY_SLOTS).filter((u): u is Unit => u !== null && u.hp > 0 && u.side !== 1 && u.side !== 7 && u.status !== 9);
  return enemies.length === 0 ? 'victory' : null;
}

/** A fallen non-party unit turns into a drop object (item → race 8, gold → race 9) or leaves its slot (FUN_0043a2e0 case 9). */
export function removeFallen(state: BattleState, t: Unit, events: BattleEvent[]): void {
  if (t.slot < PARTY_SLOTS) return;
  if (t.dropItem !== 0 || t.dropGold !== 0) {
    t.side = 7; t.race = t.dropItem !== 0 ? 8 : 9; t.status = 0; t.id = 8;
  } else {
    state.units[t.slot] = null;
    events.push({ type: 'removed', slot: t.slot });
  }
}

/** Ends the battle when checkEnd says so; returns the `end` event (empty while the battle goes on). */
export function endIfOver(state: BattleState): BattleEvent[] {
  const end = checkEnd(state);
  if (!end) return [];
  state.phase = { kind: 'end', result: end };
  return [{ type: 'end', result: end }];
}

/** FUN_0043a2e0 cases 4, 7, 8, 9, 10 after one action: deaths → EXP (before removal) → drops/removal → level-ups → end check. */
export function applyOutcome(state: BattleState, actor: Unit, hits: Hit[], tables: Tables): BattleEvent[] {
  const events: BattleEvent[] = [];
  const dead: Unit[] = [];
  for (const h of hits) {
    const t = state.units[h.target];
    if (t && t.status === 1 && t.hp === 0 && t.side !== 7 && !dead.includes(t)) { dead.push(t); events.push({ type: 'died', slot: t.slot }); }
  }
  let total = 0;
  if (actor.side === 0) {
    const k = { v: 7 };
    for (const h of hits) {
      const t = state.units[h.target];
      if (t) total += expGain(actor, t, h, tables, k);
    }
  }
  for (const t of dead) removeFallen(state, t, events);
  if (actor.side === 0) {
    actor.exp = Math.min(actor.exp + total, EXP_CAP);
    events.push({ type: 'exp', slot: actor.slot, gain: total });
    const newLevel = Math.min(trunc(actor.exp / 100) + 1, 99);
    while (actor.level < newLevel) {
      actor.level++;
      const learned = growUnit(actor, tables.race[actor.race]!, true, state.rng, tables.magic);
      events.push({ type: 'levelUp', slot: actor.slot, level: actor.level, learned });
    }
  }
  events.push(...endIfOver(state));
  return events;
}

const DECAY: Record<number, number> = { 3: 15, 5: 10, 6: 15, 7: 10, 8: 10, 11: 20 };

/** FUN_0043e1e0 for the units `pick` selects: poison damage; timed statuses decay and cure when counter < rand(100). */
export function statusTick(state: BattleState, pick: (u: Unit) => boolean): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (const u of state.units) {
    if (!u || !pick(u)) continue;
    if (u.status === 2) {
      const dmg = Math.min(trunc(u.hpMax / 10) + 1, u.hp);
      u.hp -= dmg;
      events.push({ type: 'statusTick', slot: u.slot, status: 2, value: dmg, cured: false });
      if (u.hp === 0) { u.status = 1; events.push({ type: 'died', slot: u.slot }); removeFallen(state, u, events); }
      continue;
    }
    const dec = DECAY[u.status];
    if (dec === undefined) continue;
    const c = Math.max(u.statusCounter - dec, 0);
    u.statusCounter = c;
    const cured = c < state.rng.rand(100);
    const status = u.status;
    if (cured) u.status = 0;
    events.push({ type: 'statusTick', slot: u.slot, status, value: c, cured });
  }
  return events;
}

/** FUN_00420230: new round — flags reset, MP += ceil(max/10), buffs decay toward zero, turn + 1. */
export function roundStart(state: BattleState): BattleEvent[] {
  for (const u of state.units) {
    if (!u) continue;
    u.moved = false; u.acted = false;
    u.mp = Math.min(u.mp + Math.ceil(u.mpMax / 10), u.mpMax);
    for (const k of ['str', 'def', 'wis', 'mgr', 'agi'] as const) {
      const v = u.buff[k];
      u.buff[k] = v > 0 ? v - 1 : v < 0 ? v + 1 : 0;
    }
  }
  state.turn += 1;
  return [{ type: 'roundStart', turn: state.turn }];
}
