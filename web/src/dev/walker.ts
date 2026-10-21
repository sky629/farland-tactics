/**
 * The campaign walker: the player of the headless campaign walk (web/test/campaignWalk.test.ts), as a module the browser's
 * auto-play page (play/walk.ts) drives too. It plays through GameCore (dispatch, townSelect, loadGame) and meets the screen only
 * through `WalkWorld`: a click for WAIT_CLICK, an answer for a modal, the presenter's busy flag, the autosaves it reloads, the
 * RNG it reseeds on a retry, and a log. The decision logic is the walk's — threat budgets, retries with stances, the turn-end
 * undo, the EXP ladder, the shopping list, the quarry of a boss that stands back up — unchanged; the class is a thin shell over
 * the procedure's own closure so the proven text stays as it was. Module-level state (REACH, LESSONS, boldness, rushing) means
 * one Walker at a time.
 */
import { chooseAction } from '../battle/ai';
import { dirTo, dist, hostile, incap, liveUnits, stepCell, unitAt, type Dir } from '../battle/grid';
import { canStop, computeMoveRange, levitates, markTargets, pathTo, RangeTable } from '../battle/moveRange';
import { isDash } from '../battle/battle';
import { targetsOf } from '../battle/targets';
import type { BattleState } from '../battle/types';
import { buy, sell } from '../battle/shop';
import { countOf } from '../battle/inventory';
import { EXP_CAP } from '../battle/outcome';
import { itemsOf } from '../battle/unit';
import { STATUS_MAGIC, STATUS_ONLY, statusOk, totals } from '../battle/resolve';
import { canEquip, equip } from '../battle/equipment';
import { isTreasure, PARTY_SLOTS, type Unit } from '../battle/unit';
import { costLand, type MagicData, type Tables } from '../data/types';
import type { GameCore } from '../game/gameCore';

export type WalkModalKind = 'message' | 'ask' | 'save' | 'result' | 'shop';
export interface WalkWorld {
  click(): void;                                   // WAIT_CLICK: one click
  answer(kind: WalkModalKind, value: number): void; // the modal's result
  presenterBusy(): boolean;                        // battle animation running: decisions wait
  autosave(slot: 30 | 31): Uint8Array | null;      // the latest autosave bytes of the slot
  reseed(seed: number): void;                      // a retry replays with another seed
  log(line: string): void;                         // the walker's own lines (`walk: …`, `warn:walk …`)
}
export interface WalkerOptions { maxRetries?: number; stopStage?: number; stopBattles?: number; from?: Uint8Array | null; onAutosave?: (n: number, bytes: Uint8Array) => void }
export type StepResult = 'frame' | 'skip' | 'stop';   // frame: call core.frame(now); skip: not this frame (a reload just happened); stop: the walk is over
export interface WalkSummary { stages: number[]; battles: number[]; towns: string[]; retries: string; strikes: string; picks: string; simulatedMs: number; log: string[]; turnLog: string[]; stopped: string | null; partial: boolean }

/** Walking distance from the nearest enemy to every cell, for a unit of this race: a breadth-first field over the cells it can step on. */
function enemyField(s: BattleState, u: Unit, tables: Tables, sources?: Unit[]): { dOf: (c: number, r: number) => number; enemies: Unit[]; walkable: (c: number, r: number) => boolean } {
  const { grid, units } = s;
  const race = tables.race[u.race]!;
  const cost = costLand(race);
  const fly = race.cost_land0 !== 99 || levitates(u, tables.item);
  const enemies = sources ?? liveUnits(units).filter((v) => v !== u && v.status !== 9 && v.status !== 1 && v.side !== 7 && hostile(u, v));   // `sources`: the field is measured from these units instead (a path to one target)
  const N = grid.N, field = new Int32Array(N * N).fill(-1), queue: number[] = [];
  for (const v of enemies) { field[v.c * N + v.r] = 0; queue.push(v.c * N + v.r); }
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi]!, c = Math.trunc(i / N), r = i % N, here = grid.cell(c, r)!;
    for (let d = 0; d < 4; d++) {
      const [nc, nr] = stepCell(c, r, d as Dir);
      const cell = grid.cell(nc, nr);
      if (!cell || field[nc * N + nr]! >= 0) continue;
      const k = cell.flag2 !== 0 ? cost[0]! : cost[cell.land] ?? 99;
      if (cell.blocked || k >= 99) continue;
      if (!fly) { const dh = here.h - cell.h; if (dh > race.climb_max || -dh > race.drop_max) continue; }   // the unit would step from (nc,nr) onto (c,r)
      field[nc * N + nr] = field[i]! + 1; queue.push(nc * N + nr);
    }
  }
  const far = (c: number, r: number) => 1000 + enemies.reduce((m, v) => Math.min(m, dist(v.c, v.r, c, r)), 999);   // no walkable way: fall back to the straight distance
  const dOf = (c: number, r: number) => { const f = field[c * N + r]!; return f < 0 ? far(c, r) : f; };
  return { dOf, enemies, walkable: (c: number, r: number) => field[c * N + r]! >= 0 };
}

/**
 * Where a party unit goes when the AI sees nothing to do this turn. The AI's own cell scoring (chooseAction, mode 4) rates
 * terrain up to +4 and closeness to the nearest enemy +1 per cell, so with the enemies far away it camps on a forest cell —
 * fine for a guard, but a player walks toward the fight. The player's tactic here is the usual one: advance as a group toward
 * the nearest enemy, stop `hold` cells short of them so that they must come to us and we strike first, casters one cell
 * further back; the caller lowers `hold` while the enemies refuse to come (guards). Returns null to stay.
 */
function approachCell(s: BattleState, u: Unit, tables: Tables, hold: number, floor: number, budget: number, horizon: 1 | 2): [number, number] | null {
  const { grid, units } = s;
  const { dOf, enemies } = enemyField(s, u, tables);
  if (enemies.length === 0) return null;
  const cap = Math.max(budget, threat(s, u, [u.c, u.r], null, tables, horizon));  // no step into more danger than we can take, or than we are in
  const line = Math.max(hold + (u.spells.some((m) => m !== 0) ? 1 : 0), floor);   // the group advances together: nobody runs more than two cells past the front
  const table = computeMoveRange(grid, units, u, tables.race[u.race]!, tables.item);
  let best: [number, number] | null = null, bestD = dOf(u.c, u.r), bestLeft = 0;
  for (const cell of table.cells()) {
    if (cell.move === 0 || (cell.c === u.c && cell.r === u.r) || !grid.cell(cell.c, cell.r) || !canStop(table, units, u, cell.c, cell.r)) continue;
    const d = dOf(cell.c, cell.r);
    if (d < line || threat(s, u, [cell.c, cell.r], null, tables, horizon) > cap) continue;
    if (d < bestD || (d === bestD && best !== null && cell.move > bestLeft)) { best = [cell.c, cell.r]; bestD = d; bestLeft = cell.move; }
  }
  return best;
}

const HEALS = new Set([13, 32, 40, 45]);                                     // 레스토어, 어스, 힐링, 리커버리: an enemy that undoes our work dies first

/** An enemy whose magic outweighs its arm: attack spells and WIS above STR (the necromancers and cockatrices; a grunt with a token spell is not one). */
const isCaster = (v: Unit, tables: Tables): boolean => v.spells.some((m) => m !== 0 && tables.magic[m]?.target === 0) && v.wis > v.str;

/** The walkthrough's rule of thumb: one target at a time — whoever can take a unit out of the fight (stone, sleep, hold) first, healers next, then the casters (their spells pass the swordsman's armour), the weakest last — among the enemies anyone can get at. */
function pickFocus(s: BattleState, tables: Tables): Unit | null {
  const party = liveUnits(s.units).filter((u) => u.slot < PARTY_SLOTS && u.hp > 0 && !incap(u.status));
  const foes = liveUnits(s.units).filter((v) => v.side !== 0 && v.side !== 1 && v.side !== 7 && v.hp > 0 && v.status !== 9 && party.some((u) => hostile(u, v)));
  if (party.length === 0 || foes.length === 0) return null;
  const near = (v: Unit) => Math.min(...party.map((u) => dist(u.c, u.r, v.c, v.r)));
  const urgency = (v: Unit) => (v.spells.some((m) => DISABLING.has(m)) ? 3 : v.spells.some((m) => HEALS.has(m)) ? 2 : isCaster(v, tables) ? 1 : 0);
  const cands = foes.filter((v) => near(v) <= 8);
  if (cands.length === 0) return null;
  return cands.sort((a, b) => urgency(b) - urgency(a) || a.hp - b.hp || near(a) - near(b))[0]!;
}

/** Whether the game's own target marking lets `u` strike `v` with its weapon from `from` (markTargets, with the original's quirk that any unit in range more than 4 high aborts the whole marking). */
function canStrike(s: BattleState, u: Unit, from: [number, number], v: Unit, tables: Tables): boolean {
  if (v.status === 1 || v.hp === 0) return false;                               // the marking lets a fallen unit through (a boss kept at 1 HP by its script), the blow is refused
  const probe = { ...u, c: from[0], r: from[1], moved: true }, range = new RangeTable(from[0], from[1]);
  return markTargets(range, s.grid, s.units, probe, 0, tables) > 0 && range.kindAt(v.c, v.r) === 1;
}

/** The facing of a blow from `(c, r)` on `v` (battle_rules §3.1): 2 from behind (+25 %), 1 from the side (+15 %), 0 face to face. */
const facing = (c: number, r: number, v: Unit): 0 | 1 | 2 => { const d = dirTo(c, r, v.c, v.r); return v.dir === d ? 2 : v.dir !== (d ^ 3) ? 1 : 0; };
const facingMult = [1, 1.15, 1.25] as const;
/**
 * A cell this unit can reach this turn (or its own) from which the weapon hits `v`, exposing it to at most `limit` other enemies;
 * the safest, then the farthest back. "Hits" is the game's own target marking (markTargets, with the original's quirk that any
 * unit in range more than 4 high aborts the whole marking), so what the walker picks is what the battle accepts.
 */
function attackCellFor(s: BattleState, u: Unit, v: Unit, tables: Tables, limit: number, floor: number): [number, number] | null {
  const { dOf } = enemyField(s, u, tables);
  const race = tables.race[u.race]!, weapon = tables.item[u.weapon]!;
  const table = u.moved ? null : computeMoveRange(s.grid, s.units, u, race, tables.item);
  let best: [number, number] | null = null, bestDash = false, bestFace = -1, bestT = Infinity, bestD = -1;
  const consider = (c: number, r: number) => {
    if (!(c === u.c && r === u.r) && dOf(c, r) < floor) return;                                   // not out in front of the group while they are coming
    if (!canStrike(s, u, [c, r], v, tables)) return;
    const t = threat(s, u, [c, r], [v.c, v.r], tables);
    if (t > limit) return;
    // the walkthrough's 대시 공격: the game's own path (pathTo) ending in three straight steps toward the target makes the blow a critical (+80 %)
    const dash = table !== null && !(c === u.c && r === u.r) && isDash(s.grid, { ...u, c, r }, pathTo(table, s.grid, u, race, [c, r], tables.item), [v.c, v.r], weapon);
    const face = facing(c, r, v), dd = dOf(c, r);                                                 // from behind (+25 %) over the side (+15 %) over the face
    if ((dash && !bestDash) || (dash === bestDash && (face > bestFace || (face === bestFace && (t < bestT || (t === bestT && dd > bestD)))))) { best = [c, r]; bestDash = dash; bestFace = face; bestT = t; bestD = dd; }
  };
  consider(u.c, u.r);
  if (table) for (const cell of table.cells()) if (cell.move > 0 && s.grid.cell(cell.c, cell.r) && canStop(table, s.units, u, cell.c, cell.r)) consider(cell.c, cell.r);
  return best;
}

/**
 * The cells each enemy could strike next turn: every cell it can stop on (its own move range, the game's own pathing) widened
 * by its longest reach — the weapon's range or the longest spell it has the MP for. Recomputed before each of our moves.
 */
interface Reach { melee: Set<number>; magic: Set<number>; far: Set<number>; farMagic: Set<number>; power: number; venom: number; curse: number; arm: number }   // this turn's reach, and two turns' (over-approximated by this turn's span)
// battle_rules §2.3/§3.5: a blow or spell that leaves a status costs more than its damage — poison bleeds HPmax/10 a turn, an
// incapacitation (sleep, petrify, freeze, hold, charm) hands the unit to the enemy. Counted as a share of the unit's full HP.
const DISABLING = new Set([5, 51, 11, 12, 19, 72, 24, 26, 74, 79, 50, 75, 52, 53]), POISONING = new Set([34, 73]);
const statusCost = (code: number): number => (code === 2 ? 1 : code === 0 ? 0 : 2);   // 1 = poisons, 2 = disables
let REACH = new Map<Unit, Reach>();
/** Where each party slot fell in this battle (the reload's lesson): those cells and their neighbours count as deadly for that unit on the replay. */
let LESSONS = new Map<number, [number, number][]>();
function enemyReach(s: BattleState, tables: Tables): Map<Unit, Reach> {
  const { grid, units } = s, N = grid.N, out = new Map<Unit, Reach>();
  const widen = (stops: [number, number][], radius: number) => {
    const set = new Set<number>();
    for (const [c, r] of stops) for (let dc = -radius; dc <= radius; dc++) for (let dr = -radius + Math.abs(dc); dr <= radius - Math.abs(dc); dr++) set.add((c + dc) * N + (r + dr));
    return set;
  };
  for (const e of liveUnits(units)) {
    if (e.side === 0 || e.side === 1 || e.side === 7 || e.hp === 0 || incap(e.status)) continue;
    const spells = e.status === 6 ? [] : e.spells.filter((m) => m !== 0).map((m) => tables.magic[m]).filter((m): m is MagicData => m !== undefined && m.target === 0 && Math.abs(m.mp_cost) <= e.mp);   // silenced (6): no spell this turn
    const table = computeMoveRange(grid, units, e, tables.race[e.race]!, tables.item), stops: [number, number][] = [[e.c, e.r]];
    for (const k of table.cells()) if (k.move > 0 && grid.cell(k.c, k.r) && canStop(table, units, e, k.c, k.r)) stops.push([k.c, k.r]);
    const reach = Math.max(0, ...spells.map((m) => m.range_max)), power = Math.max(0, ...spells.map((m) => Math.abs(m.elem0 || m.elem1 || m.elem2)));
    const arm = Math.max(tables.item[e.weapon]?.range_max ?? 1, 1), span = Math.max(0, ...stops.map(([c, r]) => dist(c, r, e.c, e.r)));
    const ids = e.status === 6 ? [] : e.spells.filter((m) => m !== 0 && Math.abs(tables.magic[m]?.mp_cost ?? 999) <= e.mp);
    const curse = ids.some((m) => DISABLING.has(m)) ? 2 : ids.some((m) => POISONING.has(m)) ? 1 : 0;
    out.set(e, { melee: widen(stops, arm), magic: reach > 0 ? widen(stops, reach) : new Set(), far: widen(stops, span + arm), farMagic: reach > 0 ? widen(stops, span + reach) : new Set(), power, venom: statusCost(tables.item[e.weapon]?.status_code ?? 0), curse, arm });
  }
  return out;
}
/**
 * The damage `u` can expect on `cell` next turn: every enemy that can reach it lands its better blow — the plain weapon blow or
 * the strongest spell it has the MP for (battle_rules §3.1, §3.3, no multipliers). The one standing on `target`, whom we are
 * about to fell, is not counted. This is what a player weighs: not how many are near, but whether the unit survives them.
 */
function threat(s: BattleState, u: Unit, cell: [number, number], target: [number, number] | null, tables: Tables, horizon: 1 | 2 = 1): number {
  const i = cell[0] * s.grid.N + cell[1], mine = totals(u, itemsOf(u, tables.item));
  let sum = LESSONS.get(u.slot)?.some(([c, r]) => dist(c, r, cell[0], cell[1]) <= 2) ? u.hpMax : 0;   // the unit fell here before: not again
  const blows: number[] = [];                                                  // melee blows: a cell has four sides, so at most the four heaviest land in one turn
  let venom = 0, curse = 0;
  for (const [e, rc] of REACH) {
    if (e === u) continue;
    const his = totals(e, itemsOf(e, tables.item)), melee = horizon === 2 ? rc.far : rc.melee, magic = horizon === 2 ? rc.farMagic : rc.magic;
    if (target && e.c === target[0] && e.r === target[1] && e.hp <= Math.trunc(Math.max(mine.atk - his.def, 1) * 0.9)) continue;   // the one our blow fells strikes no more; one it merely dents strikes back (the angel lord at 278 HP against a 35-damage blow)
    const high = Math.max(0, s.grid.height(e.c, e.r) - s.grid.height(cell[0], cell[1]));   // +2 %/level from above (battle_rules §3.1): a pit is no refuge
    const blow = melee.has(i) ? Math.max(his.atk - mine.def, 1) * (100 + 2 * high) / 100 : 0;
    const spell = magic.has(i) ? Math.max(rc.power + his.wis - mine.mgr, 1) : 0;
    if (melee.has(i)) venom = Math.max(venom, rc.venom); if (magic.has(i)) curse = Math.max(curse, rc.curse);
    if (spell > blow || rc.arm > 1) sum += Math.max(blow, spell); else blows.push(blow);
  }
  blows.sort((a, b) => b - a);
  let top = 0;
  for (let k = 0; k < Math.min(4, blows.length); k++) top += blows[k]!;
  // a status is one state, however many could inflict it: poison bleeds HPmax/10 a turn (counted once), an incapacitation hands the
  // unit two turns of unanswered blows and, with nobody near enough to cure it, the rest of the battle: a whole life. Only a budget of
  // Infinity (the hunt of the caster itself) lets a unit step into such reach
  return sum + top + (venom > 0 ? 0.15 * u.hpMax : 0) + (curse > 0 ? u.hpMax : 0);   // stone, sleep or a charm in reach: a whole life — the swordsman stoned at day 15's beds stood there for the whole battle, and a charmed one turns on his friends
}

/** battle_rules §3.3: |first non-zero element| + WIS − MGR, at least 1. */
const spellDamage = (w: Unit, m: MagicData, v: Unit, tables: Tables): number => Math.max(Math.abs(m.elem0 || m.elem1 || m.elem2) + totals(w, itemsOf(w, tables.item)).wis - totals(v, itemsOf(v, tables.item)).mgr, 1);

/**
 * What a cast is worth against `t`: the damage (a kill a third of the victim's HP more; a party unit in the blast counts double against),
 * or, for a spell whose damage is nothing and whose status takes the target's turns (플래시 holds, 라라바이 sleeps) or its spells (뮤트,
 * and 사이렌즈 on everyone), the turns it steals: 45 from a healer or caster (its spells pass every armour, its heals undo the party's
 * work) — a healer's silence only while it has someone to mend, a caster's only while a party unit stands in its spells' reach — 25 from a blade;
 * a silence on a party caster counts 30 against.
 */
function hitValue(s: BattleState, u: Unit, m: number, magic: MagicData, t: Unit, tables: Tables): number {
  const dmg = Math.min(spellDamage(u, magic, t, tables), t.hp);
  const silences = m === 28 || STATUS_MAGIC[m]?.status === 6, casts = t.spells.some((k) => k !== 0 && Math.abs(tables.magic[k]?.mp_cost ?? 0) <= t.mp);
  if (t.side === 0) {                                                          // a silenced friend heals and buffs nobody for a few turns — 30 against if its spells matter now, 5 if nothing it casts dents or mends anyone
    if (!silences) return -dmg * 2;
    if (!casts || t.status === 6 || t === u) return 0;
    const matters = t.spells.some((k) => HEALS.has(k)) || liveUnits(s.units).some((v) => hostile(t, v) && v.hp > 0 && v.status !== 9 && t.spells.some((k) => k !== 0 && tables.magic[k]?.target === 0 && spellDamage(t, tables.magic[k]!, v, tables) * 10 >= v.hpMax));
    return matters ? -30 : -5;
  }
  if (!hostile(u, t)) return 0;
  if (m !== 28 && STATUS_MAGIC[m] && !statusOk(t)) return STATUS_ONLY.has(m) ? 0 : Math.min(dmg, t.hp);   // a named foe (the bosses) takes no status (resolve.ts statusOk) — except 사이렌즈, whose silence falls on everyone (resolveMagic index 28): the spell is worth its damage alone
  if (silences) {                                                              // a silence steals only what the target would have cast this turn:
    if (t.status === 6 || !casts) return 0;
    const heals = t.spells.some((k) => HEALS.has(k)), def = totals(t, itemsOf(t, tables.item)).def;
    const burst = liveUnits(s.units).filter((w) => w.slot < PARTY_SLOTS && w.hp > 0 && !incap(w.status) && dist(w.c, w.r, t.c, t.r) <= 15).reduce((sum, w) => sum + Math.max(totals(w, itemsOf(w, tables.item)).atk - def, 1), 0);   // what the party's blades within two moves land in a turn (the swordsman waits beyond the boss's spells until the silence falls)
    if (heals && burst * 3 >= t.hp / 2) return Math.min(t.hp, burst * 3);      // a healer that mends itself whole every turn falls only to blows it cannot undo: three silenced turns of the party's blades, worth up to its life
    const hurt = liveUnits(s.units).some((v) => v !== t && v.side === t.side && v.hp > 0 && v.hp * 3 < v.hpMax * 2 && dist(v.c, v.r, t.c, t.r) <= 6);
    if (heals && (hurt || t.hp * 3 < t.hpMax * 2)) return 45;                  // a heal on a friend (or itself) down a third — the mending that undoes the party's blows
    const reach = REACH.get(t)?.magic;
    return reach && liveUnits(s.units).some((v) => v.slot < PARTY_SLOTS && v.hp > 0 && reach.has(v.c * s.grid.N + v.r)) ? 25 : 0;   // an attack spell that reaches one of ours
  }
  const sm = STATUS_MAGIC[m];
  if (sm && !incap(t.status) && sm.allow(t.status) && (STATUS_ONLY.has(m) || dmg * 10 < t.hp)) return casts ? 45 : 25;
  if (dmg >= t.hp) return dmg + t.hpMax * 0.3;
  const mended = liveUnits(s.units).some((v) => v !== t && v.side === t.side && v.hp > 0 && v.status !== 6 && !incap(v.status) && v.spells.some((k) => HEALS.has(k) && Math.abs(tables.magic[k]?.mp_cost ?? 0) <= v.mp) && dist(v.c, v.r, t.c, t.r) <= 6);
  return mended ? dmg * 0.3 : dmg;                                              // a wound an awake healer within reach mends back before the next turn is worth a third: silence or kill the healer first
}
/**
 * The mage's own choice: the attack spell and cell that deal the most damage to enemies (a kill is worth a third of the victim's HP
 * more, a party unit in the blast counts double against), from any reachable cell whose danger stays within `cap` and not beyond
 * `floor`. The enemy AI the walker borrows for proposals casts ally spells at enemies, raises chests and falls silent when
 * surrounded; a player looks at the board.
 */
function bestCast(s: BattleState, u: Unit, tables: Tables, cap: number, floor: number): { dest: [number, number]; action: number; cell: [number, number]; value: number } | null {
  // the silence (뮤트 23, 사이렌즈 28) is what fells a healer: while a hostile healer stands unsilenced within two moves (8 cells), its MP is kept back
  // from the other spells — not while the healer waits behind its guards (the angel lord behind nine angels): then every turn of the area spells counts
  const silencer = u.spells.find((m) => m === 28 || m === 23) ?? 0;
  const healerUp = silencer !== 0 && liveUnits(s.units).some((v) => hostile(u, v) && v.hp > 0 && v.status !== 6 && v.status !== 9 && dist(u.c, u.r, v.c, v.r) <= 8 && v.spells.some((k) => HEALS.has(k)));
  const reserve = healerUp ? Math.abs(tables.magic[silencer]!.mp_cost) : 0;
  const spells = u.spells.filter((m) => m !== 0 && tables.magic[m] !== undefined && tables.magic[m]!.target !== 1 && Math.abs(tables.magic[m]!.mp_cost) <= (m === silencer ? u.mp : u.mp - reserve));   // attack spells and the both-camp ones (사이렌즈)
  if (spells.length === 0 || u.status === 6) return null;
  const race = tables.race[u.race]!, { dOf } = enemyField(s, u, tables);
  const table = u.moved ? null : computeMoveRange(s.grid, s.units, u, race, tables.item);
  const stops: [number, number][] = [[u.c, u.r]];
  if (table) for (const k of table.cells()) if (k.move > 0 && s.grid.cell(k.c, k.r) && canStop(table, s.units, u, k.c, k.r)) stops.push([k.c, k.r]);
  const found: { dest: [number, number]; action: number; cell: [number, number]; value: number; danger: number }[] = [];
  for (const [c, r] of stops) {
    if (!(c === u.c && r === u.r) && dOf(c, r) < floor) continue;
    const danger = threat(s, u, [c, r], null, tables);
    if (danger > cap) continue;
    const probe = { ...u, c, r, moved: true };
    for (const m of spells) {
      const magic = tables.magic[m]!, range = new RangeTable(c, r);
      if (markTargets(range, s.grid, s.units, probe, m, tables) === 0) continue;
      for (const k of range.cells()) {
        if (k.kind === 0) continue;
        let value = 0;
        for (const t of targetsOf(s.grid, s.units, probe, m, [k.c, k.r], tables)) value += hitValue(s, u, m, magic, t, tables);
        if (value > 0) found.push({ dest: [c, r], action: m, cell: [k.c, k.r], value, danger });
      }
    }
  }
  if (found.length === 0) return null;
  const top = Math.max(...found.map((f) => f.value));                         // the safest cell among the casts worth at least 60 % of the best: a mage casts from the edge of its range
  return found.filter((f) => f.value >= top * 0.6).sort((a, b) => a.danger - b.danger || b.value - a.value)[0]!;
}
/** The scorer of bestCast for one given cast: damage to enemies (a kill +30 % of its HP), party units in the blast counting double against. */
function castValue(s: BattleState, u: Unit, from: [number, number], action: number, cell: [number, number], tables: Tables): number {
  const magic = tables.magic[action]; if (!magic) return 0;
  const probe = { ...u, c: from[0], r: from[1], moved: true };
  let value = 0;
  for (const t of targetsOf(s.grid, s.units, probe, action, cell, tables)) value += hitValue(s, u, action, magic, t, tables);
  return value;
}

/** battle_rules §3.4–3.5: what each support spell undoes — 멜트 the freeze, 퓨리피 the poison, 레스토어/리커버리 every status but death. */
const cures = (m: number, status: number): boolean => (m === 2 ? status === 5 : m === 10 ? status === 2 : m === 13 || m === 45 ? [2, 3, 4, 5, 6, 7, 8].includes(status) : false);
/**
 * The healer's own choice: the cure or heal worth most to the party this turn — a cure of the swordsman's poison (which bleeds him
 * a tenth of his HP a turn) or of anyone's sleep, stone or hold outranks a heal; a heal is worth the HP it restores, half again
 * for someone under half — from any reachable cell whose danger stays within `cap`. The borrowed enemy AI heals when it feels like it.
 */
function bestSupport(s: BattleState, u: Unit, tables: Tables, cap: number, floor: number, tank: Unit | null): { dest: [number, number]; action: number; cell: [number, number]; value: number } | null {
  const spells = u.spells.filter((m) => m !== 0 && tables.magic[m] !== undefined && tables.magic[m]!.target === 1 && (m === 40 || m === 3 || cures(m, 2)) && Math.abs(tables.magic[m]!.mp_cost) <= u.mp);
  if (spells.length === 0 || u.status === 6) return null;
  const race = tables.race[u.race]!, { dOf } = enemyField(s, u, tables), wis = totals(u, itemsOf(u, tables.item)).wis;
  // 히트블레이드 (BUFF 3: +STR/10+1 a cast, up to STR/4): worth casting on a blade whose next blow it turns into a kill — the winged one
  // against the mage on the bed, whom nothing else reaches (one blow short, the mage is healed whole by the next turn)
  const foes = liveUnits(s.units).filter((v) => v.side !== 0 && v.side !== 1 && v.side !== 7 && v.hp > 0 && v.status !== 9);
  const slays = (w: Unit, v: Unit) => v.hp <= Math.trunc(Math.max(totals(w, itemsOf(w, tables.item)).atk - totals(v, itemsOf(v, tables.item)).def, 1) * 0.9);
  const sharpened = (w: Unit): boolean => {
    const cap = Math.trunc(w.str / 4);
    if (w.buff.str >= cap || w.acted || incap(w.status)) return false;
    const keen = { ...w, buff: { ...w.buff, str: cap } };                       // the buff is cast to its cap over two or three turns: every step counts while the full buff makes the kill
    return foes.some((v) => hostile(w, v) && dist(w.c, w.r, v.c, v.r) <= 8 && slays(keen, v) && !slays(w, v));
  };
  const table = u.moved ? null : computeMoveRange(s.grid, s.units, u, race, tables.item);
  const stops: [number, number][] = [[u.c, u.r]];
  if (table) for (const k of table.cells()) if (k.move > 0 && s.grid.cell(k.c, k.r) && canStop(table, s.units, u, k.c, k.r)) stops.push([k.c, k.r]);
  const found: { dest: [number, number]; action: number; cell: [number, number]; value: number; danger: number }[] = [];
  for (const [c, r] of stops) {
    if (!(c === u.c && r === u.r) && dOf(c, r) < floor) continue;
    const danger = threat(s, u, [c, r], null, tables);
    if (danger > cap) continue;
    const probe = { ...u, c, r, moved: true };
    for (const m of spells) {
      const range = new RangeTable(c, r);
      if (markTargets(range, s.grid, s.units, probe, m, tables) === 0) continue;
      for (const k of range.cells()) {
        if (k.kind === 0) continue;
        let value = 0;
        for (const t of targetsOf(s.grid, s.units, probe, m, [k.c, k.r], tables)) {
          if (t.slot >= PARTY_SLOTS || t.hp === 0) continue;
          if (m === 40) { const heal = Math.min(wis, t.hpMax - t.hp); value += t.hp * 2 < t.hpMax ? heal * 1.5 : heal; }
          else if (m === 3) { if (t !== u && sharpened(t)) value += 45; }
          else if (cures(m, t.status)) value += 80 + (t === tank ? 40 : 0);
        }
        if (value > 0) found.push({ dest: [c, r], action: m, cell: [k.c, k.r], value, danger });
      }
    }
  }
  if (found.length === 0) return null;
  const top = Math.max(...found.map((f) => f.value));
  return found.filter((f) => f.value >= top * 0.6).sort((a, b) => a.danger - b.danger || b.value - a.value)[0]!;
}

/** The reachable cell (or the unit's own) nearest to `v` whose danger stays within `cap` and which still has a way to the enemy: the hunter's step. */
function towardCell(s: BattleState, u: Unit, v: Unit, tables: Tables, cap: number): [number, number] | null {
  const { walkable } = enemyField(s, u, tables);
  const path = enemyField(s, u, tables, [v]).dOf;                             // the walking distance to `v` itself: a pier or a bridge is followed round, where the straight distance would stall at the water's edge
  const table = computeMoveRange(s.grid, s.units, u, tables.race[u.race]!, tables.item);
  let best: [number, number] | null = null, bestD = path(u.c, u.r), bestT = threat(s, u, [u.c, u.r], null, tables);
  for (const k of table.cells()) {
    if (k.move === 0 || !s.grid.cell(k.c, k.r) || !canStop(table, s.units, u, k.c, k.r) || !walkable(k.c, k.r)) continue;
    const t = threat(s, u, [k.c, k.r], null, tables), dd = path(k.c, k.r);
    if (t > cap) continue;
    if (dd < bestD || (dd === bestD && t < bestT)) { best = [k.c, k.r]; bestD = dd; bestT = t; }
  }
  return best;
}

/** How many neighbouring cells a walking enemy could stand on (climb 4 / drop 6, land 0 and blocked cells closed): 1 is a dead end, 2 a corridor. */
function openness(s: BattleState, c: number, r: number): number {
  const here = s.grid.cell(c, r);
  if (!here) return 4;
  let n = 0;
  for (let d = 0; d < 4; d++) {
    const [nc, nr] = stepCell(c, r, d as Dir), cell = s.grid.cell(nc, nr);
    if (!cell || cell.blocked || cell.flag2 || cell.land === 0) continue;
    const dh = cell.h - here.h;
    if (dh <= 4 && -dh <= 6) n++;
  }
  return n;
}

/**
 * Where an exposed unit goes when it has nothing to do here: the reachable cell with the fewest enemies in reach, then the tightest
 * spot (a pocket or corridor — the walkthrough's "stick together" behind the armoured swordsman), then the farthest.
 */
function retreatCell(s: BattleState, u: Unit, tables: Tables, anchor: Unit | null, horizon: 1 | 2): [number, number] | null {
  const { grid, units } = s;
  const { dOf, enemies, walkable } = enemyField(s, u, tables);
  if (enemies.length === 0) return null;
  const table = computeMoveRange(grid, units, u, tables.race[u.race]!, tables.item);
  // second key: close to the anchor — the tank for the others, the healer for a hurt tank — (within heal range, not scattered into far pockets), else the tightest spot
  const key2 = (c: number, r: number) => (anchor && anchor !== u ? Math.max(0, dist(c, r, anchor.c, anchor.r) - 2) : openness(s, c, r));
  // a cell with no walking way back to the enemy (a drop no one climbs) is a trap, never a refuge
  const danger = (c: number, r: number) => (walkable(c, r) ? threat(s, u, [c, r], null, tables, horizon) : Infinity);
  let best: [number, number] | null = null, bestT = danger(u.c, u.r), bestK = key2(u.c, u.r), bestD = dOf(u.c, u.r);
  for (const cell of table.cells()) {
    if (cell.move === 0 || (cell.c === u.c && cell.r === u.r) || !grid.cell(cell.c, cell.r) || !canStop(table, units, u, cell.c, cell.r)) continue;
    const t = danger(cell.c, cell.r), k = key2(cell.c, cell.r), d = dOf(cell.c, cell.r);
    if (t < bestT || (t === bestT && (k < bestK || (k === bestK && d > bestD)))) { best = [cell.c, cell.r]; bestT = t; bestK = k; bestD = d; }
  }
  return best;
}

/**
 * The tank's place while the enemy is coming: the tightest reachable cell between the enemy and the others (not behind them, not
 * more than two cells in front), nearest to them. He plugs the pocket; the enemy can only come at him a few at a time.
 */
function plugCell(s: BattleState, u: Unit, others: Unit[], tables: Tables, budget: number): [number, number] | null {
  const { grid, units } = s;
  const { dOf, enemies } = enemyField(s, u, tables);
  if (enemies.length === 0 || others.length === 0) return null;
  const line = Math.min(...others.map((v) => dOf(v.c, v.r)));
  const table = computeMoveRange(grid, units, u, tables.race[u.race]!, tables.item);
  const near = (c: number, r: number) => Math.min(...others.map((v) => dist(c, r, v.c, v.r)));
  let best: [number, number] | null = null, bestZ = Infinity, bestO = Infinity, bestN = Infinity;
  const consider = (c: number, r: number) => {
    const d = dOf(c, r);
    if (d > line || d < line - 2) return;
    // first a plug the tank survives (expected damage within its budget; beyond it, the least), then the tightest, then the nearest to the others
    const z = Math.max(threat(s, u, [c, r], null, tables) - budget, 0), o = openness(s, c, r), n = near(c, r);
    if (z < bestZ || (z === bestZ && (o < bestO || (o === bestO && n < bestN)))) { best = [c, r]; bestZ = z; bestO = o; bestN = n; }
  };
  consider(u.c, u.r);
  for (const cell of table.cells()) if (cell.move > 0 && grid.cell(cell.c, cell.r) && canStop(table, units, u, cell.c, cell.r)) consider(cell.c, cell.r);
  return best;
}

/**
 * What a player does in a shop: for every party member, buy and equip the affordable weapon or armour with the biggest gain over
 * what is worn (the displaced piece goes to the 4-slot bag and is sold at once, half price); stop when nothing affordable improves anyone.
 */
function shopping(core: GameCore, ids: number[], tables: Tables, log: string[]): void {
  const inv = core.campaign.inventory, items = tables.item;
  const party = liveUnits(core.campaign.units).filter((u) => u.slot < PARTY_SLOTS);
  // a stock of consumables first (half the purse), gear next, the rest of the purse back to consumables:
  // 해독초 for the poisoned, 깨어나는 약 raises the fallen (the walkthrough's day-11 remedy), 치유약 the rest, then potions
  // a richer party stocks deeper: the wants double past 4000 gold and treble past 8000 — the last store is day 15's, and the dungeon
  // chains of days 15–17 (no HEAL between battles, the party raised at 1 HP) are fought from that bag
  const depth = Math.min(3, 1 + Math.floor(inv.gold / 4000));
  const WANTS = ([[2, 8], [7, 4], [6, 4], [5, 3], [8, 1], [1, 3]] as const).map(([id, want]) => [id, id === 2 ? want : want * depth] as const);
  const stock = (budget: number) => {
    for (const [id, want] of WANTS) {                                            // 해독초 first and in depth: poison re-applied every enemy phase is what kills the swordsman nothing else can touch (day 9)
      while (ids.includes(id) && countOf(inv, id) < want && items[id]!.price <= Math.min(budget, inv.gold)) { const r = buy(inv, null, id, items); if (r !== 'ok') { log.push(`walk: shop refused ${items[id]!.name}: ${r}`); return; } budget -= items[id]!.price; log.push(`walk: bought ${items[id]!.name} at stage ${core.campaign.stage}, ${inv.gold} gold left`); }
    }
  };
  stock(Math.floor(inv.gold / 2));
  // the weapon shop comes before the item shop in the town's round: where no consumable is on offer, gear may take only half the purse
  const keep = ids.some((id) => items[id] !== undefined && items[id]!.slot === 3) ? 0 : Math.floor(inv.gold / 2);
  // gear goes to whoever decides the battles: a point of ATK on the swordsman who strikes every turn (the duel of day 3 is his alone)
  // is worth more than a point of WIS on the mage — a gain is weighted by the unit's role (fighter 4, the flyer 3, healer 2, the mage 1, the rest ½)
  const fighter = [...party].sort((a, b) => b.str - a.str)[0], healer = party.filter((u) => u.spells.some((m) => HEALS.has(m))).sort((a, b) => b.level - a.level)[0];
  const mage = party.filter((u) => u.spells.some((m) => m !== 0 && tables.magic[m]?.target === 0)).sort((a, b) => b.wis - a.wis)[0];
  const flyer = party.find((u) => u !== fighter && tables.race[u.race]!.cost_land0 !== 99);   // the second blade: the one the pools raise after the fighter
  const weight = (u: Unit) => (u === fighter ? 4 : u === flyer ? 3 : u === healer ? 2 : u === mage ? 1 : 0.5);   // gear goes to the two blades only (weight ≥ 3 below): the others hide, and their gold is the party's potions and the blades' pikes
  // gear takes what the potions leave: the consumables still wanted (the stock list above) are reserved out of the purse first
  const reserve = WANTS.reduce((sum, [id, want]) => sum + Math.max(0, want - countOf(inv, id)) * (items[id]?.price ?? 0), 0);
  // a blade's bag holds four pieces and the original sells (menu 103 "도구 → 팔기"): a full bag parts with its cheapest piece first
  for (const u of party) {
    if (weight(u) < 3 || u.bag.indexOf(0) >= 0) continue;
    const i = u.bag.map((id, k) => [items[id]?.price ?? 0, k] as const).sort((a, b) => a[0] - b[0])[0]![1];
    const name = items[u.bag[i]!]!.name;
    if (sell(inv, u, i, items) === 'ok') log.push(`walk: sold ${name} of slot ${u.slot} at stage ${core.campaign.stage}, ${inv.gold} gold`);
  }
  let budget = Math.max(0, inv.gold - Math.max(keep, reserve));
  for (;;) {
    let best: { u: Unit; id: number; gain: number; value: number } | null = null;
    for (const u of party) {
      for (const id of ids) {
        const it = items[id];
        if (!it || weight(u) < 3 || !canEquip(u, id, items) || it.price > budget || u.bag.indexOf(0) < 0) continue;
        const stat = u === fighter || u === flyer || !u.spells.some((m) => m !== 0 && (tables.magic[m]?.target === 0 || HEALS.has(m))) ? 'atk' : 'wis';   // the two blades (and anyone without attack or healing spells) want ATK; a caster's weapon is its WIS (spell power, heal amount) — the winged one learns spells but lives by the pike
        const now = it.slot === 0 ? (items[u.weapon]?.[stat] ?? 0) : it.slot === 1 ? (items[u.armor]?.def ?? 0) : 0;
        const gain = it.slot === 0 ? it[stat] - now : it.slot === 1 ? it.def - now : 0;
        if (gain < 5 || gain * 4 < now) continue;                                              // a step worth a quarter of what is worn: a small step costs the price and returns half of the old piece
        const value = gain * weight(u) * (it.slot === 0 && weight(u) >= 3 ? 1.5 : 1);      // a blade's weapon before its armour: the one-blow kills of day 15 hang on ATK
        if (!best || value > best.value) best = { u, id, gain, value };
      }
    }
    if (!best) { stock(Math.floor(inv.gold / 2)); return; }                  // half of what is left: the rest waits for the next town's gear
    const r = buy(inv, best.u, best.id, items);
    if (r !== 'ok') { log.push(`walk: shop refused ${items[best.id]!.name} for slot ${best.u.slot}: ${r}`); return; }
    budget -= items[best.id]!.price;
    const bi = best.u.bag.indexOf(best.id);
    if (bi >= 0) equip(best.u, bi, items);
    log.push(`walk: bought ${items[best.id]!.name} for slot ${best.u.slot} at stage ${core.campaign.stage} (+${best.gain}), ${inv.gold} gold left`);
    if (bi >= 0 && best.u.bag[bi] !== 0) { const old = items[best.u.bag[bi]!]!.name; if (sell(inv, best.u, bi, items) === 'ok') { log.push(`walk: sold the replaced ${old} of slot ${best.u.slot}, ${inv.gold} gold`); } }   // the piece it replaced is sold on the spot
  }
}


  // A replay with the same plan ends the same way (the dice rarely decide a battle): a player who lost tries another way. Retry n
  // takes the n-th stance — the usual margin, a careful one, a bold one, a timid one, a reckless one — and every other retry advances
  // from the first turn instead of holding the line.
const STANCES = [1, 0.6, 1.6, 0.4, 2.4] as const;
let boldness = 1, rushing = false;

export class Walker {
  readonly onModal: (kind: WalkModalKind, payload: unknown) => void;
  readonly onLog: (kind: 'warn' | 'info', text: string) => void;
  readonly step: (now: number) => StepResult;
  readonly summary: () => WalkSummary;
  /** The game ended and not in defeat. */
  get finished(): boolean { return this.core.mode === 'ended' && this.core.result !== 'defeat'; }
  constructor(private readonly core: GameCore, tables: Tables, world: WalkWorld, opts: WalkerOptions = {}) {
    // developer knobs for iterating on one battle: WALK_SAVE_DIR writes every battle's BATTLE_START autosave there,
    // WALK_FROM starts from such a save instead of a new game, WALK_STOP_STAGE ends the walk once that stage is passed
    const { maxRetries: MAX_RETRIES = 40, stopStage = 99, stopBattles = 999, from = null, onAutosave } = opts;
    if (from) {
      if (!core.loadGame(from)) throw new Error('from: cannot load the save');
      // the save is this battle's BATTLE_START autosave: retries reload it (the world returns it until a new autosave is written)
    }
    const autosave = (n: 30 | 31): Uint8Array | null => world.autosave(n) ?? (n === 30 ? from : null);
    const log: string[] = []; const stages: number[] = []; const battles: number[] = []; const towns: string[] = [];
    let now = 0, seen = 0, lastStage = -1, lastMode = '';
    const HOLD = 7;                                                             // just outside a 6-cell move + melee reach: they come to us
    let hold = HOLD, holdTurn = -1, enemyPos = '', stalled = false;            // per battle: lowered by 2 each turn the enemies did not move at all (guards)
    let front = Infinity, focus: Unit | null = null, tank: Unit | null = null, topLevel = 0, mendTurns = 0, hpSig = '', quiet = 0, still = 0, lowFoeHp = Infinity, lastLow = 0;   // quiet: turns in which nobody lost HP; still: turns the enemy has not moved; lastLow: the turn the enemies' total HP last reached a new low (progress)   // mendTurns: turns spent with a single enemy left while the party heals up
    const junior = (v: Unit) => v.level + 3 <= topLevel;                      // three or more levels under the party's best: the one who should be taking the kills
    const dmgTo = (a: Unit, t: Unit) => Math.max(totals(a, itemsOf(a, tables.item)).atk - totals(t, itemsOf(t, tables.item)).def, 1);   // battle_rules §3.1 plain blow, before the multipliers
    const kills = (w: Unit, v: Unit, from?: [number, number] | null) => v.hp <= Math.trunc(dmgTo(w, v) * (from ? facingMult[facing(from[0], from[1], v)] : 1) * 0.9);   // with a margin for a lower stand (−2 %/level); from a known cell, with the facing bonus
    // the turn-end autosave (slot 31) is the player's undo: when someone falls, the turn is replayed from its start with that unit more cautious
    const turnSaves = new Map<number, Uint8Array>(), caution = new Map<number, number>(), undoAt = new Map<number, number>(); let undos = 0;
    const alive = new Set<number>();                                             // party slots seen alive, to log who fell when
    const turnLog: string[] = [];
    const precious = new Set<number>(); let lastState: BattleState | null = null;   // precious: slots whose fall alone ended a game (the story's protagonist) — kept out of the melee like the hiders
    // the script's own end (TEST_IS_ACTOR, vm.ts logs "stands back up"): a boss felled by the wrong hand stands back up at 1 HP. Seen once,
    // the lesson holds for the battle's retries: the blades who could still end it are `needed` — they keep out of the melee like the hiders
    // and come in for the finish (the walkthrough's day 16: ignore the angels, only Al's last blow wins); a hand proven wrong leaves `needed`.
    const needed = new Set<number>(), stoodUp = new Set<number>(); let lastActor = -1;   // lastActor: the party slot whose act was dispatched last
    const strikes = new Map<string, number>();                                 // `${stage}:${slot}` → blows struck: who the walker really lets fight
    let counted: unknown = null;                                                 // the Battle whose BATTLE_START autosave was counted
    let endSummary: string | null = null;                                       // the party as the last battle ended (taken at its `end`, before the next script moves anyone)
    const lastStrike = new Map<number, number>();                              // slot → the turn of its last blow (a tank idle for four turns turns bold)mped when a battle stalls
    const who = (v: Unit | null) => { if (!v) return 'nobody'; const t = totals(v, itemsOf(v, tables.item)); return `slot${v.slot}:id${v.id}:s${v.side}:st${v.status}:hp${v.hp}/${v.hpMax}:lv${v.level}:a${t.atk}:d${t.def}:w${t.wis}:m${t.mgr}`; };
    const summary = (st: BattleState) => liveUnits(st.units).filter((v) => v.hp > 0).map((v) => `${v.slot}:s${v.side}:${v.c},${v.r}:h${st.grid.height(v.c, v.r)}:hp${v.hp}:lv${v.level}:st${v.status}:mp${v.mp}`).join(' ');
    const townTries = new Map<string, number>(); const retries = new Map<string, number>();
    const autosaves: Uint8Array[] = [], fallbacks = new Map<string, number>();   // BATTLE_START autosave per battle number; how often a battle sent us back to the one before
    if (from) { battles.push(core.campaign.stage); autosaves[1] = autosave(30)!; }
    let townSave: Uint8Array | null = null, townBattles = 0, unflips = 0; const asksSince: string[] = []; const askFlip = new Set<string>();   // the player's own save and the choices made after it
    let frames = 0, lastNow = 0, stopped: string | null = null, flushed = 0;
    const flush = () => { for (; flushed < log.length; flushed++) world.log(log[flushed]!); };
    const stop = (why: string): StepResult => { stopped = why; flush(); return 'stop'; };
    this.onModal = (kind: WalkModalKind, payload: unknown): void => {
      const c: [string, WalkModalKind, unknown] = ['openModal', kind, payload];
      {



        if (c[0] === 'openModal') {
          if (c[1] === 'shop') { log.push(`walk: shop at stage ${core.campaign.stage}: ${JSON.stringify(c[2])}, ${core.campaign.inventory.gold} gold`); shopping(core, c[2] as number[], tables, log); world.answer('shop', 1); }                   // buy upgrades, then 돌아오기
          else if (c[1] === 'ask') { const key = `${core.campaign.stage}:${String(c[2])}`; asksSince.push(key); const ans = askFlip.has(key) ? 0 : 1; world.answer('ask', ans); log.push(`walk: ask ${key} → ${ans}`); }   // yes (the inn's "end the day?" moves the story on) unless this choice led nowhere
          else if (c[1] === 'result') {
            // the EXP pool. The bundled walkthrough (파랜드택틱스2 공략.docx) says the duel of stage 3 needs the swordsman to have had
            // nearly all the EXP so far (day 2, mission 3), the mine cart of stage 8 is the mage's alone (day 8), and "Al and Karin
            // at 25 or more" (character tips). So: the fighter until the duel is behind us, then the lower of fighter and attack
            // caster. The fallen count too: they stand up at the next battle.
            const { pool } = c[2] as { gold: number; pool: number };
            const party = liveUnits(core.campaign.units).filter((u) => u.slot < PARTY_SLOTS);
            const fighter = [...party].sort((a, b) => b.str - a.str)[0]!;
            // the fighter until the author's milestone ("Al 25+": the duel of day 3 is his alone, at level 17 his defence tops the hall of
            // day 5, at 22 the golems' blows of day 7), then the lower of the fighter and the flyer — the one whose wings reach what the
            // sword cannot (the lighthouse top of day 13, the mages on the beds of day 15: "라딧슈는 날개가 달려있음을 상기하자"). A fighter
            // kept near the enemies' level earns his own EXP on every kill (FUN_0043a2e0 case 7: +20 % per level the victim has on him,
            // 10 % at the floor); one levelled far past them earns nothing, and the pools poured into him are lost to the party.
            // The two climb a ladder together: the fighter to 28 (the duel of day 3, the hall of day 5 at 17, the golems of day 7 at 22, the
            // halls of day 15 at 30 — the pool of day 8 is his whether he stands at 24 or 25 then), then the flyer to 25 and straight on to 35 (the mages on the beds of day 15 fall only to a flyer of 35
            // with the mage's 히트블레이드 and a pike bought on day 15), then the fighter to 35, the flyer to 45, the fighter to 45. Past the
            // ladder the pools are the flyer's: nothing later asks more of the swordsman, and day 17 sends him away. The angel lord of day 16
            // (274 HP, heals himself whole) falls to 사이렌즈 and three turns of both blades, not to levels.
            const flyer = party.find((u) => u !== fighter && tables.race[u.race]!.cost_land0 !== 99) ?? null;
            const ladder: [Unit | null, number][] = [[fighter, 28], [flyer, 25], [flyer, 35], [fighter, 35], [flyer, 45], [fighter, 45]];
            const who = ladder.find(([u, lv]) => u !== null && u.level < lv)?.[0] ?? flyer ?? fighter;
            if (who) { who.exp = Math.min(who.exp + pool, EXP_CAP); log.push(`walk: ${pool} EXP at stage ${core.campaign.stage} → slot ${who.slot} lv${who.level} (now ${who.exp} EXP)`); }
            world.answer('result', 0);
          }
          else world.answer(kind, kind === 'save' ? -1 : 0);
        }
      }
      flush();
    };
    this.onLog = (kind: 'warn' | 'info', text: string): void => {
      const c: [string, string, string] = ['log', kind, text];
      {
        if (c[0] === 'log') log.push(`${String(c[1])}:${String(c[2])} @stage${core.campaign.stage} mode ${core.mode}`);
        if (c[0] === 'log' && c[2] === 'save 31' && core.battle) turnSaves.set(core.battle.state.turn, autosave(31)!);
        if (c[0] === 'log' && c[1] === 'info' && typeof c[2] === 'string' && c[2].startsWith('TEST_IS_ACTOR: slot ')) {   // the boss stood back up: not lastActor's blow to make
          const slot = parseInt(c[2].slice('TEST_IS_ACTOR: slot '.length), 10), v = core.campaign.units[slot];
          needed.delete(lastActor);
          if (v && !stoodUp.has(slot)) {
            stoodUp.add(slot);
            const hands = core.campaign.units.filter((w): w is Unit => w !== null && w.slot < PARTY_SLOTS && w.slot !== lastActor && w.status !== 9 && dmgTo(w, v) * 10 >= v.hpMax).map((w) => w.slot);
            for (const h of hands) needed.add(h);
            log.push(`walk: slot ${slot} stood back up after slot ${lastActor}'s blow — the script waits for another hand: ${hands.length > 0 ? `slot ${hands.join(', ')} kept out of the melee until the finish` : 'nobody else dents it'}`);
          }
        }
        if (c[0] === 'log' && c[2] === 'save 30' && core.battle !== null && core.battle !== counted) {   // the BATTLE_START autosave of a new battle — not the stage-11 script's own SAVE_GAME 30 right after it
          counted = core.battle;
          if (endSummary !== null) { log.push(`walk: battle ${battles.length} ended with ${endSummary}; last:\n${turnLog.slice(-3).join('\n')}`); endSummary = null; }
          battles.push(core.campaign.stage); autosaves[battles.length] = autosave(30)!;
          onAutosave?.(battles.length, autosaves[battles.length]!); needed.clear(); stoodUp.clear(); hold = HOLD; holdTurn = -1; enemyPos = ''; still = 0; quiet = 0; hpSig = ''; lowFoeHp = Infinity; lastLow = 0; LESSONS = new Map(); lastStrike.clear(); turnLog.length = 0; turnSaves.clear(); caution.clear(); undoAt.clear(); undos = 0; }   // BATTLE_START autosave: a new battle (a retry reloads it without one)
      }
      flush();
    };
    this.step = (now: number): StepResult => {
      frames++; lastNow = now;
      if (frames > 10_000_000 || this.finished || core.campaign.stage > stopStage || battles.length > stopBattles) return stop('limit');

      if (core.campaign.stage !== lastStage) { lastStage = core.campaign.stage; stages.push(lastStage); }
      if (core.mode === 'script') world.click();
      else if (core.mode === 'town') {
        if (lastMode !== 'town') { towns.push(`stage${core.campaign.stage}`); townSave = core.saveBytes(); townBattles = battles.length; asksSince.length = 0; }
        const flags = core.campaign.townFlags;
        const order = [2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0];        // guild first, the exit last; visits go round-robin — story flags advance by visiting places in turn
        const key = `${core.campaign.stage}:${battles.length}`;
        const visits = townTries.get(key) ?? 0;
        if (visits >= 120) {
          const flipped = [...askFlip].filter((k) => k.startsWith(`${core.campaign.stage}:`));
          if (flipped.length > 0 && unflips < 2) {                                // the "no" led nowhere (the inn's "set sail?" is not a branch): back to yes, the battle gets its retries again
            for (const k of flipped) askFlip.delete(k);
            unflips++; townTries.delete(key);
            log.push(`walk: town at stage ${core.campaign.stage} did not move on after answering no to ${flipped.join(', ')} — back to yes`);
            flush(); return 'skip';
          }
          log.push(`walk: town at stage ${core.campaign.stage} did not move on after ${visits} visits (town flags ${flags.join(',')}, flags ${core.campaign.flags.slice(0, 12).join(',')})`); return stop('town stalled');
        }
        const active = order.filter((i) => (flags[i] ?? 0) !== 0);
        if (active.length === 0) { log.push(`walk: town at stage ${core.campaign.stage} has no active facility`); return stop('no facility'); }
        const pick = active[visits % active.length]!;
        townTries.set(key, visits + 1);
        log.push(`walk: stage ${core.campaign.stage} town → facility ${pick} (flags ${core.campaign.flags.slice(0, 12).join(',')})`);
        core.townSelect(pick);
      } else if (core.mode === 'battle' && core.battle && !world.presenterBusy()) {
        const s = core.battle.state; lastState = s;
        if (s.phase.kind === 'end' && endSummary === null) endSummary = liveUnits(s.units).filter((v) => v.slot < PARTY_SLOTS && v.status !== 9).map((v) => `s${v.slot}:${v.hp}/${v.hpMax}${v.status ? `:st${v.status}` : ''}`).join(' ');
        if (s.turn !== holdTurn) {                                               // a new turn of ours: did anyone over there move since our last turn?
          turnLog.push(`t${s.turn} hold ${hold}: ${summary(s)}`); if (s.turn === 1) turnLog.push(`  roster ${liveUnits(s.units).map((v) => `${who(v)}:${v.c},${v.r}`).join(' ')}\n  bag ${s.inventory.items.filter((k) => k.count > 0).map((k) => `${k.id}×${k.count}`).join(' ')} gold ${s.inventory.gold}`); if (turnLog.length > 400) turnLog.splice(60, turnLog.length - 260);   // keep the opening and the last turns
          const fallen = liveUnits(s.units).filter((v) => v.slot < PARTY_SLOTS && v.hp === 0 && alive.has(v.slot));
          for (const v of fallen) { alive.delete(v.slot); log.push(`walk: slot ${v.slot} (lv${v.level} def${v.def}) fell before t${s.turn} at (${v.c},${v.r}) h${s.grid.height(v.c, v.r)}; enemies: ${liveUnits(s.units).filter((e) => e.side !== 0 && e.side !== 7 && e.hp > 0 && dist(e.c, e.r, v.c, v.r) <= 3).map((e) => `${e.slot}:s${e.side}:${e.c},${e.r}:h${s.grid.height(e.c, e.r)}`).join(' ')}`); }
          for (const v of liveUnits(s.units)) if (v.slot < PARTY_SLOTS && v.hp > 0) alive.add(v.slot);
          const foesNow = liveUnits(s.units).filter((v) => v.side !== 0 && v.side !== 1 && v.side !== 7 && v.hp > 0 && v.status !== 9);
          const mattered = fallen.filter((v) => precious.has(v.slot) || needed.has(v.slot) || v.spells.some((m) => m !== 0 && HEALS.has(m)) || foesNow.some((e) => hostile(v, e) && (dmgTo(v, e) * 10 >= e.hpMax || v.spells.some((m) => m !== 0 && tables.magic[m]?.target === 0 && spellDamage(v, tables.magic[m]!, e, tables) * 10 >= e.hpMax))));   // a reload is for a fall that costs the battle: one who dents a foe (blade or spell) or heals, not one who could do neither (the lv 9 recruit among lv 30 angels)
          let back: Uint8Array | undefined, backTurn = -1;                     // the player's reload: that turn again, the fallen more careful about where they stand; a turn replayed three times without avail → the turn before it (up to three back)
          if (mattered.length > 0) for (let k = 1; k <= 3 && !back; k++) { const t0 = s.turn - k; if ((undoAt.get(t0) ?? 0) < 3) { back = turnSaves.get(t0); backTurn = t0; } }
          if (back && undos < 12) {
            for (const v of fallen) { caution.set(v.slot, (caution.get(v.slot) ?? 0) + 1); LESSONS.set(v.slot, [...(LESSONS.get(v.slot) ?? []), [v.c, v.r]]); }
            undoAt.set(backTurn, (undoAt.get(backTurn) ?? 0) + 1); undos++;
            log.push(`walk: ${fallen.map((v) => `slot ${v.slot}`).join(', ')} fell — back to the start of turn ${backTurn} (undo ${undos})`);
            world.reseed(7000 + undos * 13 + s.turn);
            if (!core.loadGame(back)) { log.push('walk: reload failed'); return stop('reload failed'); }
            holdTurn = -1; enemyPos = ''; lastMode = 'script'; flush(); return 'skip';
          }
          const pos = liveUnits(s.units).filter((v) => v.slot >= PARTY_SLOTS && v.hp > 0 && v.side !== 1 && v.side !== 7).map((v) => `${v.slot}:${v.c},${v.r}`).join(' ');
          hold = pos !== enemyPos ? HOLD : Math.max(1, hold - 2); still = pos !== enemyPos ? 0 : still + 1;
          const foeHp = liveUnits(s.units).filter((v) => v.slot >= PARTY_SLOTS && v.side !== 1 && v.side !== 7 && v.status !== 9).reduce((a, v) => a + v.hp, 0);
          if (foeHp < lowFoeHp) { lowFoeHp = foeHp; lastLow = s.turn; }
          const sig = liveUnits(s.units).map((v) => v.hp).join(','); quiet = sig === hpSig ? quiet + 1 : 0; hpSig = sig;
          mendTurns = pos.split(' ').filter(Boolean).length === 1 ? mendTurns + 1 : 0;
          enemyPos = pos; holdTurn = s.turn;
          const party = liveUnits(s.units).filter((v) => v.slot < PARTY_SLOTS && v.hp > 0 && !incap(v.status));
          front = Math.min(Infinity, ...party.map((v) => enemyField(s, v, tables).dOf(v.c, v.r)));
          focus = pickFocus(s, tables);
          const maxAtk = Math.max(0, ...liveUnits(s.units).filter((v) => v.slot >= PARTY_SLOTS && v.hp > 0 && v.side !== 1 && v.side !== 7).map((v) => totals(v, itemsOf(v, tables.item)).atk));
          const hitsLeft = (v: Unit) => v.hp / Math.max(maxAtk - totals(v, itemsOf(v, tables.item)).def, 1);
          topLevel = Math.max(0, ...party.map((v) => v.level));
          tank = [...party].sort((a, b) => hitsLeft(b) - hitsLeft(a))[0] ?? null;   // the walkthrough's formation: whoever outlasts the strongest enemy's blows stands in front, everyone else behind
        }
        if (quiet > 40 || s.turn - lastLow > 40 || s.turn > 600) {               // a stalemate — nobody has lost HP for 40 turns, or the enemies' total HP has made no new low for 40 (they heal back what an ally deals) — a player reloads; a slow grind (the mine cart at 1 damage a cast) keeps making lows
          log.push(`walk: battle at stage ${core.campaign.stage} stalled at turn ${s.turn}; turns:\n${turnLog.slice(0, 6).join('\n')}\n…\n${turnLog.slice(-60).join('\n')}`);
          stalled = true;
        }
        if (s.phase.kind === 'player') {
          const sel = s.phase.sel;
          if (sel.mode === 'idle') {
            REACH = enemyReach(s, tables);
            const ready = s.units.slice(0, PARTY_SLOTS).filter((v): v is Unit => v !== null && v.side === 0 && v.hp > 0 && !incap(v.status) && !(v.moved && v.acted));
            // the seniors weaken first, the tank plugs the gap, the juniors finish: a kill is worth +20 %/level the victim stands above
            // the killer (expGain), so the party levels fastest when the low ones take the last blows — the walkthrough's day-4 advice
            const foesNow = liveUnits(s.units).filter((v) => v.side !== 0 && v.side !== 1 && v.side !== 7 && v.hp > 0 && v.status !== 9);
            const fights = (v: Unit) => v.spells.some((m) => m !== 0) || foesNow.some((f) => hostile(v, f) && dmgTo(v, f) * 10 >= f.hpMax);
            const rank = (v: Unit) => (!fights(v) ? 0 : junior(v) ? 3 : v === tank ? 2 : 1);   // those who only hide step aside first (they may stand in the tank's way), then the seniors, the tank, the juniors
            const u = [...ready].sort((a, b) => rank(a) - rank(b))[0]!;
            if (u) core.dispatch({ type: 'select', slot: u.slot });
            else core.dispatch({ type: 'endTurn' });
          } else if (sel.mode === 'menu') {
            const u = s.units[sel.slot]!;
            // a player opens the bag before anything else: an antidote when poisoned, a potion when low with no healer in reach
            const inv = s.inventory;
            const healerNear = liveUnits(s.units).some((v) => v.slot < PARTY_SLOTS && v !== u && v.hp > 0 && !incap(v.status) && v.spells.some((m) => HEALS.has(m)) && dist(v.c, v.r, u.c, u.r) <= 6);
            const low = u.hp * 2 < u.hpMax && (!healerNear || precious.has(u.slot) || u.hp * 4 < u.hpMax);   // the one whose fall ends the game, or one near death, does not wait for the healer's turn
            // any draught in the bag that restores HP (허브 20, 요정의 눈물 40, 호박 60, 회복약 100, the chests' 머시룸 and 에리쿠사 at 999 — everything): the smallest that covers the wound, else the largest
            const draughts = inv.items.filter((k) => k.count > 0 && tables.item[k.id]!.slot === 3 && tables.item[k.id]!.hp_heal > 0 && tables.item[k.id]!.use_effect === 67).map((k) => k.id).sort((x, y) => tables.item[x]!.hp_heal - tables.item[y]!.hp_heal);
            const draught = draughts.find((id) => tables.item[id]!.hp_heal >= u.hpMax - u.hp) ?? draughts.at(-1) ?? 0;
            const potion = u.status === 2 && countOf(inv, 2) > 0 ? 2 : u.status === 2 && countOf(inv, 6) > 0 ? 6 : low ? draught : 0;
            const bigCast = potion !== 0 && u.status !== 2 && !u.acted ? bestCast(s, u, tables, Infinity, 0) : null;   // a blast worth a hundred beats a sip of twenty (Son at 2 HP amid four enemies)
            if (potion && !u.acted && !(bigCast && bigCast.value >= 100)) {
              core.dispatch({ type: 'beginTarget', action: 1000 + potion });
              if (!core.lastEvents.some((e) => e.type === 'rejected')) { core.dispatch({ type: 'act', c: u.c, r: u.r }); if (!core.lastEvents.some((e) => e.type === 'rejected')) { turnLog.push(`  t${s.turn} slot${u.slot} uses item ${potion}`); flush(); return 'skip'; } }
              log.push(`warn:walk item ${potion} of slot ${u.slot} rejected: ${JSON.stringify(core.lastEvents.find((e) => e.type === 'rejected'))} @stage${core.campaign.stage}`);
              if (s.phase.kind === 'player' && s.phase.sel.mode === 'target') core.dispatch({ type: 'cancel' });
            }
            // … and wakes, cures or revives a friend next to it: 깨어나는 약 (7) lifts sleep and death (+20 HP), 치유약 (6) any other status, 해독초 (2) poison
            const sick = liveUnits(s.units).find((v) => v.slot < PARTY_SLOTS && v !== u && [1, 2, 3, 4, 5, 8].includes(v.status) && dist(v.c, v.r, u.c, u.r) <= 1);
            const revive = [7, 8, 9].find((id) => countOf(inv, id) > 0) ?? 0;     // 깨어나는 약, 보드카, 브랜디: each lifts death (battle_rules §4.2)
            const cure = !sick ? 0 : sick.status === 1 ? revive : sick.status === 3 ? (countOf(inv, 7) > 0 ? 7 : countOf(inv, 6) > 0 ? 6 : 0) : sick.status === 5 && revive > 7 ? revive : countOf(inv, 6) > 0 ? 6 : sick.status === 2 && countOf(inv, 2) > 0 ? 2 : 0;
            if (sick && cure && !u.acted) {
              core.dispatch({ type: 'beginTarget', action: 1000 + cure });
              if (!core.lastEvents.some((e) => e.type === 'rejected')) { core.dispatch({ type: 'act', c: sick.c, r: sick.r }); if (!core.lastEvents.some((e) => e.type === 'rejected')) { flush(); return 'skip'; } }
              if (s.phase.kind === 'player' && s.phase.sel.mode === 'target') core.dispatch({ type: 'cancel' });
            }
            const ai = chooseAction(s, u, tables);
            const here: [number, number] = [u.c, u.r], hereT = threat(s, u, here, null, tables);
            // how much damage a unit may let itself in for: what it survives with a margin — three tenths of its full HP while the enemy
            // is still coming or when its fall ends the game, else one and a half tenths. A player takes a hit to land a kill; two hits, no.
            const careful = hold === HOLD || precious.has(u.slot), risk = Math.max(0, u.hp - u.hpMax * (careful ? 0.3 : 0.15) * (1 + (caution.get(u.slot) ?? 0)) / boldness);
            // one who can neither cast nor dent anything (a tenth of a foe's HP per blow) keeps two enemy turns away — a seven-cell crab
            // gives no second chance; the fighters, mages and healers stand by the one-turn rule, or the swordsman fights unhealed
            const foesAll = liveUnits(s.units).filter((v) => v.side !== 0 && v.side !== 1 && v.side !== 7 && v.hp > 0 && v.status !== 9 && hostile(u, v));
            const contributes = (w: Unit) => w.spells.some((m) => m !== 0) || foesAll.some((v) => dmgTo(w, v) * 10 >= v.hpMax);
            const useful = contributes(u) && !caution.has(u.slot) && !needed.has(u.slot) && !precious.has(u.slot);   // one who already fell this battle (and was reloaded), one the script's end waits for, one whose fall ends the game: all keep out of the melee
            const horizon: 1 | 2 = tank !== null && u !== tank && !useful ? 2 : 1, hereT2 = horizon === 2 ? threat(s, u, here, null, tables, 2) : hereT;
            // focus fire: a weapon user who can get at the chosen target does so instead of whatever the AI scored
            let d: { dest: [number, number]; action: number | null; cell: [number, number] | null } = { dest: ai.dest, action: ai.action, cell: ai.cell };
            // while the enemy is still coming, nobody steps more than two cells past the others' front to strike; once they stand still,
            // we go to them. The front is the others', not one's own — a unit alone (the duel) or already in front may close in and charge
            const fellows = liveUnits(s.units).filter((v) => v.slot < PARTY_SLOTS && v !== u && v.hp > 0 && !incap(v.status));
            const fighting = (w: Unit) => contributes(w) && !caution.has(w.slot) && !needed.has(w.slot) && !precious.has(w.slot);   // those who only hide anchor nobody
            const ahead = Math.min(Infinity, ...fellows.filter(fighting).map((v) => enemyField(s, v, tables).dOf(v.c, v.r)));
            // a menace: an enemy whose weapon reaches one of the others (not the tank) next turn — a player cuts it down before the
            // mage far away, and the tank does not leave the line for that mage while a menace stands
            const wards = fellows.filter((w) => w !== tank), menace = (v: Unit) => wards.some((w) => REACH.get(v)?.melee.has(w.c * s.grid.N + w.r) ?? false);
            // an enemy no other party member can get at from any cell (the mages on the beds of day 15, the necromancer on the lighthouse:
            // only the winged one reaches them) — the one who can takes the kill at any exposure it survives. Reach is the ground's, not this
            // turn's: an angel at 2 HP is not lone because the winged one happens to be far away this turn
            const loneReach = (v: Unit) => !fellows.some((w) => { const { walkable } = enemyField(s, w, tables, [v]); return [0, 1, 2, 3].some((d) => { const [c, r] = stepCell(v.c, v.r, d as Dir); return s.grid.cell(c, r) !== undefined && walkable(c, r); }); });
            const floor = hold === HOLD && ahead !== Infinity ? ahead - 2 : 0;
            if (ai.action === null || ai.action === 0 || (ai.action < 1000 && tables.magic[ai.action]?.target !== 1)) {   // the blow in hand is weighed even when the AI would cast (the winged one's pike outdoes her lightning)
              const limit = Math.max(hereT, risk);                                     // no worse off than where we stand, or within what we can take
              // only enemies the blade can dent (a tenth of their HP): against the ghosts of day 12 (def 200) a swordsman's turn is better
              // spent standing in the mages' way than scratching for 1 — the walkthrough sends the magic at them and the sword at the necromancer
              const foes = liveUnits(s.units).filter((v) => v.side !== 0 && v.side !== 1 && v.side !== 7 && v.hp > 0 && v.status !== 9 && hostile(u, v) && dist(u.c, u.r, v.c, v.r) <= 8 && dmgTo(u, v) * 10 >= v.hpMax);
              // a senior leaves a kill that a junior still to act can take from a quiet cell; a junior goes for its kills first
              const mates = liveUnits(s.units).filter((v) => v.slot < PARTY_SLOTS && v.hp > 0 && v !== u && !v.acted && !incap(v.status));
              const spoken = (v: Unit) => !junior(u) && mates.some((w) => junior(w) && kills(w, v) && attackCellFor(s, w, v, tables, w.hp * 0.5, floor) !== null);
              const order = (v: Unit) => (spoken(v) ? 9 : 0) + (junior(u) && kills(u, v) ? -5 : 0) + (v === focus ? 0 : menace(v) ? 1 : v.spells.some((m) => HEALS.has(m)) ? 2 : 3);
              const prey0 = focus && (focus.spells.some((m) => HEALS.has(m)) || isCaster(focus, tables)) ? focus : null;   // the enemy's healer or caster
              const lim = (v: Unit) => ((tank !== null && u === tank && v === prey0) || (kills(u, v, attackCellFor(s, u, v, tables, Infinity, 0)) && loneReach(v)) ? Infinity : limit);   // the tank strikes the mage at any cost; a kill only the winged one can make (from the best cell it can reach), likewise
              const pick = foes.sort((a, b) => order(a) - order(b) || a.hp - b.hp).map((v) => ({ v, at: attackCellFor(s, u, v, tables, lim(v), floor) })).find((x) => x.at !== null);
              // the walker's cell (validated by the game's own marking, the safest, a dash when one exists) replaces the AI's; an AI
              // strike nobody could validate (the height quirk) is dropped
              if (pick) d = { dest: pick.at!, action: 0, cell: [pick.v.c, pick.v.r] };
              else if (d.action === 0 && d.cell) { const v = unitAt(s.units, d.cell[0], d.cell[1]); if (!v || !canStrike(s, u, d.dest, v, tables) || dmgTo(u, v) * 10 < v.hpMax) d = { dest: d.dest, action: null, cell: null }; }
            }
            const prey = focus && (focus.spells.some((m) => HEALS.has(m)) || isCaster(focus, tables)) && dmgTo(u, focus) * 10 >= focus.hpMax ? focus : null;   // the enemy's healer or caster, if the blade dents it
            // a fallen friend and a 깨어나는 약 in the bag: the nearest standing party member (not the tank while others stand) goes to raise them
            const curable = (v: Unit) => (v.status === 1 && v.hp === 0 && [7, 8, 9].some((id) => countOf(inv, id) > 0))
              || ([3, 4, 5, 8].includes(v.status) && (countOf(inv, 6) > 0 || (v.status === 3 && countOf(inv, 7) > 0) || (v.status === 5 && (countOf(inv, 8) > 0 || countOf(inv, 9) > 0))));
            const corpse = liveUnits(s.units).filter((v) => v.slot < PARTY_SLOTS && v !== u && curable(v)).sort((a, b) => (b === tank ? 1 : 0) - (a === tank ? 1 : 0) || dist(a.c, a.r, u.c, u.r) - dist(b.c, b.r, u.c, u.r))[0] ?? null;   // the tank first
            const standing = liveUnits(s.units).filter((v) => v.slot < PARTY_SLOTS && v.hp > 0 && !incap(v.status) && (v !== tank || liveUnits(s.units).filter((w) => w.slot < PARTY_SLOTS && w.hp > 0 && !incap(w.status)).length === 1));
            const reviver = corpse ? [...standing].sort((a, b) => dist(a.c, a.r, corpse.c, corpse.r) - dist(b.c, b.r, corpse.c, corpse.r))[0] ?? null : null;
            const reviving = reviver === u && corpse && dist(u.c, u.r, corpse.c, corpse.r) > 1 ? corpse : null;
            const stalk = () => (prey !== null && !u.moved ? towardCell(s, u, prey, tables, Math.max(hereT, u.hp - u.hpMax * 0.1)) : null);
            const treasureCell = (): [number, number] | null => {              // the nearest visible chest this unit can stop on this turn without exceeding its risk
              const chests = liveUnits(s.units).filter((v) => isTreasure(v) && v.status !== 9 && !(v.c === u.c && v.r === u.r)
                && !(v.dropItem !== 0 && tables.item[v.dropItem] !== undefined && tables.item[v.dropItem]!.slot !== 3 && u.bag.indexOf(0) < 0));   // a piece of gear needs a free bag slot ("더 가질 수 없다")
              if (chests.length === 0) return null;
              const table = computeMoveRange(s.grid, s.units, u, tables.race[u.race]!, tables.item);
              let best: [number, number] | null = null, bestD = Infinity;
              for (const v of chests) {
                if (table.moveAt(v.c, v.r) === 0 || !canStop(table, s.units, u, v.c, v.r) || threat(s, u, [v.c, v.r], null, tables) > risk) continue;
                const d = dist(u.c, u.r, v.c, v.r);
                if (d < bestD) { best = [v.c, v.r]; bestD = d; }
              }
              return best;
            };
            let hunting: [number, number] | null = null;                        // the tank closes on the enemy healer or caster: the one whose spells pass his armour, or undo his blows
            // a healer chooses its own cure or heal first (worth at least 40: a cure, or a real heal); then a mage chooses its own cast
            // (the AI's proposal stands only when it is a buff)
            const support = !u.acted ? bestSupport(s, u, tables, Math.max(hereT, risk), floor, tank) : null;
            if (support && support.value >= 40) d = { dest: support.dest, action: support.action, cell: support.cell };
            else if (!u.acted && (d.action === null || d.action === 0 || (d.action < 1000 && tables.magic[d.action]?.target !== 1))) {   // an attack or a both-camps spell (사이렌즈 silences friend and foe alike): weighed, never taken on the AI's word
              const cast = bestCast(s, u, tables, Math.max(hereT, risk), floor);
              const blowV = d.action === 0 && d.cell ? ((v) => (v ? Math.min(dmgTo(u, v), v.hp) + (kills(u, v) ? v.hpMax * 0.3 : 0) : 0))(unitAt(s.units, d.cell[0], d.cell[1])) : 0;   // what the blow in hand is worth, on the cast's scale
              if (cast && cast.value >= 10 && cast.value > blowV) d = { dest: cast.dest, action: cast.action, cell: cast.cell };   // the winged one's blade outdoes her lightning: she casts only when the cast is worth more
              else if (d.action !== null && d.action !== 0 && d.cell && castValue(s, u, d.dest, d.action, d.cell, tables) <= 0) d = { dest: d.dest, action: null, cell: null };   // a cast that hurts no enemy is not a turn (a 1-damage fireball still is: the mine cart is won that way)
            }
            // the AI attacks whenever it can; a player does not step into a crowd for one hit — a move that exposes the unit to more
            // enemies than it faces now, and to more than one, is dropped in favour of holding the line
            const stay = d.dest[0] === u.c && d.dest[1] === u.r, caster = u.spells.some((m) => m !== 0);
            // the AI scores an ally-only spell cast at an enemy (field_mode.md §5.2: the camp test is an OR) and a resurrection on a
            // chest (side 7 passes the original's filter); the resolver finds nobody worth it — a player does not waste the turn
            const hits = d.action !== null && d.action !== 0 && d.cell !== null ? targetsOf(s.grid, s.units, { ...u, c: d.dest[0], r: d.dest[1] }, d.action, d.cell, tables) : null;
            const idle = hits !== null && (hits.length === 0 || (d.action! < 1000 && tables.magic[d.action!]?.target === 1 && !hits.some((t) => t.slot < PARTY_SLOTS && (d.action !== 41 || t.status === 1))));
            let act = idle ? null : d.action, dest = d.dest, why = idle ? 'idle' : '';
            if (act !== null && !stay && enemyField(s, u, tables).dOf(d.dest[0], d.dest[1]) < floor) { act = null; why = 'floor'; }   // the AI's own move would outrun the group
            const squishy = tank !== null && u !== tank;
            const offensive = act === 0 || (act !== null && act < 1000 && tables.magic[act]?.target === 0);
            // the last blow waits: in a dungeon chain (BATTLE_START without HEAL) the next battle opens with the HP this one closes with — a player
            // heals and raises everyone before the last enemy falls, as long as someone can still mend (a healer with MP, a potion, a 깨어나는 약)
            const lastFoe = foesAll.length === 1 ? foesAll[0]! : null;
            const prize = act === 0 && d.cell ? unitAt(s.units, d.cell[0], d.cell[1]) : null;
            // the quarry of one the script waits for (needed): the boss that stood back up — its blows go there alone, and the kill is "lone" by definition
            const quarry = needed.has(u.slot) ? [...stoodUp].map((k) => s.units[k]).find((v): v is Unit => v !== null && v !== undefined && v.hp > 0 && v.status !== 9) ?? null : null;
            const daring = prize !== null && kills(u, prize, d.dest) && threat(s, u, d.dest, d.cell, tables) < u.hp * 0.9 && (loneReach(prize) || foesAll.length === 1 || prize === quarry);   // the kill nobody else can make, or the last one, at an exposure it survives
            if (lastFoe && offensive && mendTurns < 12) {
              const hurt = liveUnits(s.units).some((v) => v.slot < PARTY_SLOTS && v.status !== 9 && (v.hp * 2 < v.hpMax || v.status === 1));
              const mender = liveUnits(s.units).some((v) => v.slot < PARTY_SLOTS && v.hp > 0 && !incap(v.status) && v.spells.some((m) => HEALS.has(m) && Math.abs(tables.magic[m]!.mp_cost) <= v.mp))
                || inv.items.some((k) => k.count > 0 && tables.item[k.id]!.slot === 3 && tables.item[k.id]!.hp_heal > 0 && tables.item[k.id]!.use_effect === 67) || [7, 8, 9].some((id) => countOf(inv, id) > 0);
              const wouldEnd = act === 0 ? d.cell !== null && unitAt(s.units, d.cell[0], d.cell[1]) === lastFoe && kills(u, lastFoe)
                : hits !== null && hits.includes(lastFoe) && lastFoe.hp <= spellDamage(u, tables.magic[act!]!, lastFoe, tables);
              if (wouldEnd && hurt && mender) { act = null; why = 'mend'; }
            }
            if (quarry !== null && offensive && prize !== quarry && !(hits !== null && hits.includes(quarry))) { act = null; why = 'spared'; }   // the needed one spends no blow and no exposure on anyone but its quarry
            if (squishy && offensive && !daring && act !== null && threat(s, u, d.dest, d.cell, tables, horizon) > risk) {   // only the tank takes a contact it may not survive …
              const alt = useful ? retreatCell(s, u, tables, tank, horizon) ?? here : here;                       // … unless one who can fight has nowhere meaningfully safer (−30 %) to stand: then the blow is struck —
              const worth = act !== 0 && act !== null && act < 1000 && d.cell ? castValue(s, u, d.dest, act, d.cell, tables) : Infinity;   // if it is worth striking (not a 1-damage fireball)
              const altT = threat(s, u, alt, null, tables, horizon), destT = threat(s, u, d.dest, d.cell, tables, horizon);
              if (!useful || (worth < 10 && altT < destT) || altT < destT * 0.7) { act = null; why = 'contact'; }
            }
            const others = liveUnits(s.units).filter((v) => v.slot < PARTY_SLOTS && v.hp > 0 && v !== u && !incap(v.status));
            const healer = others.filter((v) => v.spells.some((m) => HEALS.has(m))).sort((a, b) => dist(a.c, a.r, u.c, u.r) - dist(b.c, b.r, u.c, u.r))[0] ?? null;
            // the tank's formation rules bend only its blows; a heal, a cure or a buff it has in mind goes ahead (the healer may be the sturdiest one standing)
            if (!squishy && tank !== null && others.length > 0 && !u.moved && (act === null || offensive) && boldness <= 1 && (u.hp * 5 < u.hpMax * 2 || (hereT >= u.hp && u.hp * 5 < u.hpMax * 3))) {   // a worn-down tank (under 40 %, or under 60 % with the next turn's damage above its HP) falls back to the healer
              act = null; why = 'worn'; dest = retreatCell(s, u, tables, healer, 1) ?? here;
            } else if (!squishy && tank !== null && hold === HOLD && others.some(fighting) && !u.moved && (act === null || act === 0)) {   // the tank: strike within two cells of the fighting others' front, else plug the gap — a cast it has in mind (weighed and budgeted by bestCast) stands: the winged one plugging a gap instead of blasting four angels left the swordsman to them for five turns
              const mates = others.filter(fighting), { dOf } = enemyField(s, u, tables), band = Math.min(...mates.map((v) => dOf(v.c, v.r))) - 2;
              // bold when the target is the enemy caster (his spells pass the armour: two blows end them, worth the risk) or when nothing has
              // bitten for eight turns (a standoff is lost by waiting): then the budget is all but a tenth of the HP, not the usual margin
              const v = d.cell ? unitAt(s.units, d.cell[0], d.cell[1]) : null, bold = (v !== null && v === prey) || s.turn - (lastStrike.get(u.slot) ?? 0) >= 4;
              const at = act === 0 && v ? attackCellFor(s, u, v, tables, v === prey ? Infinity : bold ? Math.max(hereT, u.hp - u.hpMax * 0.1) : risk, band) : null;
              hunting = at || foesAll.some(menace) ? null : stalk();                   // the hunt waits while an enemy can get at the others
              const safe = !at && !hunting && !bold && hereT > risk ? retreatCell(s, u, tables, healer, 1) : null;   // over budget with no blow within it: back to where it is survivable (near the healer), not deeper
              if (at) dest = at;
              else if (hunting && (hunting[0] !== u.c || hunting[1] !== u.r)) { act = null; why = 'hunt'; dest = hunting; }   // closing on the enemy caster comes before pulling back: its spells are what make every cell deadly
              else if (safe && threat(s, u, safe, null, tables) <= risk) { act = null; why = 'pullback'; dest = safe; }
              else { act = null; why = 'plug'; const plug = plugCell(s, u, mates, tables, risk); dest = plug ?? here; }
            }
            if (act !== null && !stay && !daring && threat(s, u, d.dest, d.cell, tables) > Math.max(hereT, risk)) {   // the step the AI wants exposes the unit to more than it faces now and can take
              const v = d.cell ? unitAt(s.units, d.cell[0], d.cell[1]) : null;
              if (act === 0 && v && canStrike(s, u, here, v, tables)) dest = here;   // strike from where we stand
              else if (hold === HOLD) { act = null; why = 'exposed'; }                                                                           // they are still coming: hold the line; once they stop, take the step
            }
            // a mage does not stand and cast where the next turn may finish it — if there is somewhere safer to go (on the mine cart there is not)
            const back = act !== null && caster && squishy && !u.moved && hereT > risk && dest[0] === u.c && dest[1] === u.r ? retreatCell(s, u, tables, tank, 1) : null;   // the tank holds its ground even if it knows a spell
            if (back) { act = null; why = 'back'; dest = back; }
            else if (act === null && hunting) dest = hunting;
            else if (act === null && !u.moved && quarry) {                        // the needed one closes on its quarry: at any exposure survived once the quarry's spells are silenced or spent, within the usual margin while it still casts, and out of reach while the way there is deadlier than that
              const spentQ = quarry.status === 6 || !quarry.spells.some((k) => k !== 0 && tables.magic[k]?.target === 0 && Math.abs(tables.magic[k]!.mp_cost) <= quarry.mp);
              const step = towardCell(s, u, quarry, tables, spentQ ? u.hp * 0.9 : risk);
              dest = step ?? (hereT2 > risk ? retreatCell(s, u, tables, tank, horizon) : null) ?? here; why = step ? 'quarry' : 'wary';
            }
            else if (act === null && !u.moved && lastFoe && (kills(u, lastFoe) || dmgTo(u, lastFoe) * 10 >= lastFoe.hpMax)) {   // the last enemy standing: the blow that ends it, or every blade that dents it, closes in — at any exposure survived once its spells are silenced or spent, within the usual margin while it still casts (the angel lord's 바니시 at range 9)
              const spent = lastFoe.status === 6 || !lastFoe.spells.some((k) => k !== 0 && tables.magic[k]?.target === 0 && Math.abs(tables.magic[k]!.mp_cost) <= lastFoe.mp);
              dest = towardCell(s, u, lastFoe, tables, spent ? u.hp * 0.9 : risk) ?? here; why = kills(u, lastFoe) ? 'finish' : 'close';
            }
            else if (act === null && !u.moved && treasureCell()) { dest = treasureCell()!; why = 'chest'; }   // a chest within reach, at no risk: gold for the potions the chains of day 15 burn, and the odd 머시룸
            else if (act === null && !u.moved && reviving) { dest = towardCell(s, u, reviving, tables, Math.max(risk, hereT2)) ?? here; why = 'revive'; }
            else if (act === null && !u.moved && (still >= 5 || s.turn - lastLow >= 8) && tank !== null) {   // a standoff (they hold their ground, or nothing we do bites for eight turns): the tank advances regardless, the others keep behind it
              const near = [...liveUnits(s.units).filter((v) => v.side !== 0 && v.side !== 1 && v.side !== 7 && v.hp > 0 && v.status !== 9 && hostile(u, v))].sort((a, b) => dist(a.c, a.r, u.c, u.r) - dist(b.c, b.r, u.c, u.r))[0];
              dest = (u === tank ? (near ? towardCell(s, u, near, tables, Infinity) : null) : towardCell(s, u, tank, tables, Math.max(risk, hereT2))) ?? here;
            }
            else if (act === null && !(!squishy && tank !== null && hold === HOLD && others.length > 0)) dest = u.moved ? here : (hereT2 > risk ? retreatCell(s, u, tables, tank, horizon) : approachCell(s, u, tables, hold, ahead === Infinity ? 0 : ahead - 2, risk, horizon)) ?? here;
            if (act === null && !u.moved && dest[0] === u.c && dest[1] === u.r && s.turn >= 148) {
              const { dOf } = enemyField(s, u, tables), table = computeMoveRange(s.grid, s.units, u, tables.race[u.race]!, tables.item);
              const cells = [...table.cells()].filter((k) => k.move > 0 && s.grid.cell(k.c, k.r) && canStop(table, s.units, u, k.c, k.r));
              turnLog.push(`  stuck slot${u.slot} dOf(here) ${dOf(u.c, u.r)} reachable ${cells.length} minDOf ${Math.min(...cells.map((k) => dOf(k.c, k.r)))} hold ${hold} front ${front} risk ${hereT}/${risk}`);
            }
            const dashing = act === 0 && d.cell && !u.moved && (dest[0] !== u.c || dest[1] !== u.r) && isDash(s.grid, { ...u, c: dest[0], r: dest[1] }, pathTo(computeMoveRange(s.grid, s.units, u, tables.race[u.race]!, tables.item), s.grid, u, tables.race[u.race]!, dest, tables.item), d.cell, tables.item[u.weapon]!);
            turnLog.push(`  t${s.turn} slot${u.slot} (${u.c},${u.r}) mv${u.moved ? 1 : 0} ai dest ${d.dest} action ${d.action} cell ${d.cell} → act ${act}${dashing ? ' DASH' : ''}${daring ? ' LONE' : ''}${why ? ` (${why}${prey ? ` prey slot${prey.slot}@${prey.c},${prey.r}` : ''})` : ''} dest ${dest} risk ${hereT}+${hereT2}/${Math.trunc(risk)} back ${back} idle ${idle}${d.cell ? ` there ${who(unitAt(s.units, d.cell[0], d.cell[1]))}` : ''}`);
            const rejected = () => core.lastEvents.find((e) => e.type === 'rejected');
            if (!u.moved && (dest[0] !== u.c || dest[1] !== u.r)) {
              core.dispatch({ type: 'beginMove' }); core.dispatch({ type: 'move', c: dest[0], r: dest[1] });
              const rej = rejected();
              if (rej) { log.push(`warn:walk move of slot ${u.slot} (${u.c},${u.r}) → (${dest[0]},${dest[1]}) rejected: ${JSON.stringify(rej)} @stage${core.campaign.stage}`); core.dispatch({ type: 'cancel' }); core.dispatch({ type: 'wait' }); }
            } else if (!u.acted && act !== null && d.cell) {
              core.dispatch({ type: 'beginTarget', action: act });
              let cell = d.cell;
              const sel2 = s.phase.kind === 'player' ? s.phase.sel : null;
              if (sel2 && sel2.mode === 'target' && sel2.range.kindAt(cell[0], cell[1]) === 0) {        // a self-centred spell (shape 3/4): the AI names the caster's cell, the player clicks any cell of the shown range
                const marked = [...sel2.range.cells()].find((k) => k.kind !== 0);
                if (marked) cell = [marked.c, marked.r];
              }
              if (!rejected()) { core.dispatch({ type: 'act', c: cell[0], r: cell[1] }); if (act === 0) { const k = `${core.campaign.stage}:${u.slot}`; strikes.set(k, (strikes.get(k) ?? 0) + 1); lastStrike.set(u.slot, s.turn); } lastActor = u.slot; turnLog.push(`    → ${core.lastEvents.map((e) => JSON.stringify(e).slice(0, 400)).join(' | ')}`); }
              const rej = rejected();
              if (rej) {
                const t = unitAt(s.units, cell[0], cell[1]);
                log.push(`warn:walk action ${act} of slot ${u.slot} (${u.c},${u.r} st${u.status}) at (${cell[0]},${cell[1]}) rejected: ${JSON.stringify(rej)}; there: ${t ? `slot ${t.slot} side ${t.side} st ${t.status} hp ${t.hp} h${s.grid.height(t.c, t.r)}` : 'nobody'}; here h${s.grid.height(u.c, u.r)} weapon ${u.weapon} canStrike ${t ? canStrike(s, u, [u.c, u.r], t, tables) : '-'} dest ${dest}; targetsOf ${targetsOf(s.grid, s.units, u, act, cell, tables).length} @stage${core.campaign.stage}`);
                if (s.phase.kind === 'player' && s.phase.sel.mode === 'target') core.dispatch({ type: 'cancel' });   // back to the menu …
                if (s.phase.kind === 'player' && s.phase.sel.mode === 'idle') core.dispatch({ type: 'select', slot: u.slot });
                core.dispatch({ type: 'wait' });                                                           // … and give the turn up rather than loop
              }
            } else core.dispatch({ type: 'wait' });
          } else if (sel.mode === 'face') core.dispatch({ type: 'face', dir: s.units[sel.slot]?.dir ?? 0 });
          else core.dispatch({ type: 'cancel' });
        }
      }
      if (stalled || (core.mode === 'ended' && core.result === 'defeat')) {
        if (!stalled) log.push(`walk: defeat; turns:\n${turnLog.join('\n')}`);
        if (!stalled && lastState) {                                             // a game over with the party still standing: the one who just fell is the story's own
          const fielded = liveUnits(lastState.units).filter((v) => v.slot < PARTY_SLOTS && v.status !== 9);
          const standing = fielded.filter((v) => v.hp > 0 && !incap(v.status)), lastRound = fielded.filter((v) => v.hp === 0 && alive.has(v.slot));
          if (standing.length > 0 && lastRound.length === 1 && !precious.has(lastRound[0]!.slot)) { precious.add(lastRound[0]!.slot); log.push(`walk: slot ${lastRound[0]!.slot} must not fall — kept out of reach from now on`); }
        }
        stalled = false;
        const key = `${battles.length}@stage${battles.at(-1)}`;
        const n = (retries.get(key) ?? 0) + 1; retries.set(key, n);
        if (n > MAX_RETRIES) {
          const back = battles.length - 1, fb = fallbacks.get(key) ?? 0;
          const ask = [...asksSince].reverse().find((k) => !askFlip.has(k));
          if (ask && townSave) {                                                 // a choice was made since the inn: a battle lost twenty times right after it is the choice's doing (event03's peeping) — change the answer first
            askFlip.add(ask); retries.delete(key); battles.length = townBattles;
            log.push(`walk: battle ${key} lost ${MAX_RETRIES} times → back to the town save, answering no to "${ask}"`);
            if (!core.loadGame(townSave)) { log.push('walk: reload failed'); return stop('reload failed'); }
            lastMode = 'script'; flush(); return 'skip';
          }
          if (back >= 1 && autosaves[back] && fb < 2 && battles[back - 1] === battles.at(-1)) {   // a chain in one stage: the battle before decides the HP we start with — play it again and end it healthier
            fallbacks.set(key, fb + 1); retries.delete(key); battles.length = back; needed.clear(); stoodUp.clear();
            world.reseed(5000 + fb * 31 + back);
            log.push(`walk: battle ${key} lost ${MAX_RETRIES} times → back to the battle before it`);
            if (!core.loadGame(autosaves[back]!)) { log.push('walk: reload failed'); return stop('reload failed'); }
            hold = HOLD; holdTurn = -1; enemyPos = ''; still = 0; quiet = 0; hpSig = ''; lowFoeHp = Infinity; lastLow = 0; LESSONS = new Map(); lastStrike.clear(); turnLog.length = 0; turnSaves.clear(); caution.clear(); undoAt.clear(); undos = 0; lastMode = 'script'; flush(); return 'skip';
          }
          log.push(`walk: battle ${key} lost ${MAX_RETRIES} times`); return stop('lost');
        }
        const save = autosave(30);
        if (!save) { log.push('walk: no BATTLE_START autosave to retry from'); return stop('no autosave'); }
        world.reseed(1000 + n * 17 + battles.length);
        boldness = STANCES[n % STANCES.length]!; rushing = n % 2 === 1;
        log.push(`walk: lost battle ${key}, retry ${n} (stance ×${boldness}${rushing ? ', advancing' : ''})`);
        if (!core.loadGame(save)) { log.push('walk: reload failed'); return stop('reload failed'); }
        hold = rushing ? 1 : HOLD; holdTurn = -1; enemyPos = ''; still = 0; quiet = 0; hpSig = ''; lowFoeHp = Infinity; lastLow = 0; LESSONS = new Map(); lastStrike.clear(); turnLog.length = 0; turnSaves.clear(); caution.clear(); undoAt.clear(); undos = 0;
        lastMode = 'script'; flush(); return 'skip';
      }
      lastMode = core.mode;
      flush();
      return 'frame';
    };



    this.summary = (): WalkSummary => {
      const log2 = [...log];
      const ins = core.vm.state.program?.code[core.vm.state.pc];
      log2.push(`walk: stopped in ${core.mode} at stage ${core.campaign.stage}, pc ${core.vm.state.pc} op ${ins?.op} ${JSON.stringify(ins?.args ?? [])} wait ${JSON.stringify((core.vm as unknown as { wait: unknown }).wait)} modalOpen ${(core.vm as unknown as { modalOpen: boolean }).modalOpen} presenter busy ${world.presenterBusy()}`);
      const retried = [...retries.entries()].map(([k, n]) => `${k} ×${n}`).join(', ');
      const picks = new Map<string, number>(); for (const l of log2) { const m = /^walk: stage (\d+) town → facility (\d+)/.exec(l); if (m) picks.set(`s${m[1]}f${m[2]}`, (picks.get(`s${m[1]}f${m[2]}`) ?? 0) + 1); }
      const byStage = (m: Map<string, number>) => [...m.entries()].sort().reduce((acc, [k, v]) => { const [st, sl] = k.split(':'); (acc[st!] ??= []).push(`s${sl}:${v}`); return acc; }, {} as Record<string, string[]>);
      return {
        stages: [...stages], battles: [...battles], towns: [...towns], retries: retried || 'none',
        strikes: Object.entries(byStage(strikes)).map(([st, v]) => `st${st}[${v.join(' ')}]`).join(' '),
        picks: [...picks.entries()].map(([k, n]) => `${k}×${n}`).join(' '),
        simulatedMs: lastNow, log: log2, turnLog: [...turnLog], stopped, partial: from !== null || stopStage < 99 || stopBattles < 999,
      };
    };
  }
}
