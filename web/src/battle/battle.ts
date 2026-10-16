import type { MapData } from '../assets/types';
import { DataError } from '../data/loader';
import type { BattleEntry, ItemData, RosterUnit, Tables } from '../data/types';
import { chooseAction } from './ai';
import { BattleGrid, dirTo, dist, hostile, incap, liveUnits, stepCell, type Dir } from './grid';
import { canStop, computeMoveRange, markTargets, pathTo, RangeTable } from './moveRange';
import { applyOutcome, roundStart, statusTick } from './outcome';
import { resolveAction } from './resolve';
import { Rng, type RandomSource } from './rng';
import { targetsOf } from './targets';
import type { BattleEvent, BattleState, Command, Selection } from './types';
import { createUnit, growUnit, MAX_SLOTS, PARTY_SLOTS, type Unit } from './unit';

const freeSlot = (units: (Unit | null)[], from: number, to: number): number => { for (let s = from; s < to; s++) if (!units[s]) return s; return -1; };

/** New-game party: the side-0 records of roster 1 go into slots 0..9 (equipment included). */
export function createParty(roster1: RosterUnit[], tables: Tables, rng: RandomSource): (Unit | null)[] {
  const units = new Array<Unit | null>(MAX_SLOTS).fill(null);
  for (const rec of roster1) {
    if (rec.side !== 0) continue;
    const slot = freeSlot(units, 0, PARTY_SLOTS);
    if (slot >= 0) units[slot] = createUnit(rec, slot, tables, rng);
  }
  return units;
}

/** LOAD_UNITS (FUN_0041fcf0 + FUN_0041fae0): clear slots 10..49, place every record; existing party units only move. */
export function applyRoster(units: (Unit | null)[], roster: RosterUnit[], tables: Tables, rng: RandomSource): void {
  for (let s = PARTY_SLOTS; s < MAX_SLOTS; s++) units[s] = null;
  for (const rec of roster) {
    if (rec.side === 0) {
      const existing = units.slice(0, PARTY_SLOTS).find((u) => u && u.id === rec.unit_id);
      if (existing) { existing.c = rec.c; existing.r = rec.r; existing.dir = (rec.dir & 3) as Dir; existing.status = rec.status; continue; }
    }
    const slot = rec.side === 0 ? freeSlot(units, 0, PARTY_SLOTS) : freeSlot(units, PARTY_SLOTS, MAX_SLOTS);
    if (slot >= 0) units[slot] = createUnit(rec, slot, tables, rng);
  }
}

/** Remake rule (spec §11.3): a party unit below the roster's level grows deterministically up to it. */
export function syncPartyLevels(units: (Unit | null)[], roster: RosterUnit[], tables: Tables, rng: RandomSource): void {
  for (const rec of roster) {
    if (rec.side !== 0) continue;
    const u = units.slice(0, PARTY_SLOTS).find((x) => x && x.id === rec.unit_id);
    if (!u) continue;
    while (u.level < rec.level) { u.level++; growUnit(u, tables.race[u.race]!, false, rng, tables.magic); }
  }
}

/** BATTLE_START(_HEAL): flags cleared, buffs and the special flag reset; with heal HP = max and MP = max/2. */
export function startBattle(units: (Unit | null)[], heal: boolean): void {
  for (const u of units) {
    if (!u) continue;
    u.moved = false; u.acted = false; u.special = false;
    u.buff = { str: 0, def: 0, wis: 0, mgr: 0, agi: 0 };
    if (heal && u.status !== 1) { u.hp = u.hpMax; u.mp = Math.trunc(u.mpMax / 2); }
  }
}

/** Remake rule (spec §11.5): 17 rosters leave party members at (0, 0) because the story script positions them; put each on the
 *  nearest free floor cell around the placed party (or around the map centre when nobody is placed). Non-party units are never moved;
 *  non-party (0, 0) placeholders are dropped by Battle.start. */
export function placeUnplacedParty(units: (Unit | null)[], grid: BattleGrid): void {
  const party = liveUnits(units).filter((u) => u.slot < PARTY_SLOTS);
  const placed = party.filter((u) => grid.cell(u.c, u.r));
  const unplaced = party.filter((u) => !grid.cell(u.c, u.r));
  if (unplaced.length === 0) return;
  const centre: [number, number] = placed.length > 0
    ? [Math.round(placed.reduce((s, u) => s + u.c, 0) / placed.length), Math.round(placed.reduce((s, u) => s + u.r, 0) / placed.length)]
    : [Math.trunc(grid.N / 2), Math.trunc(grid.N / 2)];
  const taken = new Set(liveUnits(units).filter((u) => grid.cell(u.c, u.r)).map((u) => `${u.c},${u.r}`));
  for (const u of unplaced) {
    let best: [number, number] | null = null, bestD = Infinity;
    for (let c = 0; c < grid.N; c++) {
      for (let r = 0; r < grid.N; r++) {
        const cell = grid.cell(c, r);
        if (!cell || cell.blocked !== 0 || cell.land === 0 || taken.has(`${c},${r}`)) continue;
        const d = dist(c, r, centre[0], centre[1]);
        if (d < bestD) { bestD = d; best = [c, r]; }
      }
    }
    if (!best) return;
    u.c = best[0]; u.r = best[1];
    taken.add(`${best[0]},${best[1]}`);
  }
}

/** FUN_0043afd0 dash: party unit, no special flag, last three steps straight toward the target, each step |Δh| ≤ 2, not levitating; bows need an adjacent target. */
export function isDash(grid: BattleGrid, unit: Unit, path: Dir[], target: [number, number], weapon: ItemData): boolean {
  if (unit.side !== 0 || unit.special || unit.status === 11 || path.length < 3) return false;
  const d = path[path.length - 1]!;
  if (path[path.length - 2] !== d || path[path.length - 3] !== d) return false;
  if (dirTo(unit.c, unit.r, target[0], target[1]) !== d) return false;
  if (weapon.weapon_type === 3 && dist(unit.c, unit.r, target[0], target[1]) !== 1) return false;
  let c = unit.c, r = unit.r;
  for (let i = 0; i < 3; i++) {
    const [pc, pr] = stepCell(c, r, (d ^ 3) as Dir);
    if (Math.abs(grid.height(pc, pr) - grid.height(c, r)) > 2) return false;
    c = pc; r = pr;
  }
  return true;
}

const reject = (reason: string): BattleEvent[] => [{ type: 'rejected', reason }];

export class Battle {
  constructor(readonly state: BattleState, private readonly tables: Tables) {}

  static start(entry: BattleEntry, map: MapData, roster1: RosterUnit[], roster: RosterUnit[], tables: Tables, seed: number): Battle {
    const rng = Rng.fromSeed(seed);
    const units = createParty(roster1, tables, rng);
    applyRoster(units, roster, tables, rng);
    const inRoster = new Set(roster.filter((r) => r.side === 0).map((r) => r.unit_id));
    for (let s = 0; s < PARTY_SLOTS; s++) if (units[s] && !inRoster.has(units[s]!.id)) units[s] = null;
    syncPartyLevels(units, roster, tables, rng);
    const grid = new BattleGrid(map);
    for (let s = PARTY_SLOTS; s < MAX_SLOTS; s++) { const u = units[s]; if (u && u.c === 0 && u.r === 0 && !grid.cell(0, 0)) units[s] = null; }   // (0, 0) = placed later by the story script
    placeUnplacedParty(units, grid);
    for (const u of liveUnits(units)) {
      if (!grid.cell(u.c, u.r)) throw new DataError(`roster/stage${String(entry.roster).padStart(3, '0')}.json`, `unit ${u.slot} (id ${u.id}) stands on a missing cell (${u.c}, ${u.r})`);
    }
    startBattle(units, entry.heal);
    return new Battle({ entry, map, grid, units, turn: 1, phase: { kind: 'player', sel: { mode: 'idle' } }, rng, lastPath: [] }, tables);
  }

  partyFinished(): boolean {
    return this.state.units.slice(0, PARTY_SLOTS).every((u) => !u || incap(u.status) || (u.moved && u.acted));
  }

  reduce(cmd: Command): BattleEvent[] {
    const s = this.state;
    if (s.phase.kind === 'end') return reject('battle over');
    if (s.phase.kind === 'enemy') return cmd.type === 'enemyStep' ? this.enemyStep() : reject('enemy phase');
    if (cmd.type === 'enemyStep') return reject('player phase');
    if (cmd.type === 'endTurn') return this.beginEnemyPhase();
    const sel = s.phase.sel;
    switch (cmd.type) {
      case 'select': return this.select(cmd.slot);
      case 'cancel': return this.cancel(sel);
      case 'beginMove': return this.beginMove(sel);
      case 'move': return this.move(sel, cmd.c, cmd.r);
      case 'beginTarget': return this.beginTarget(sel, cmd.action);
      case 'act': return this.act(sel, cmd.c, cmd.r);
      case 'wait': return this.wait(sel);
      case 'face': return this.face(sel, cmd.dir);
    }
  }

  private setSel(sel: Selection): void { this.state.phase = { kind: 'player', sel }; }

  private unitOf(sel: Selection): Unit | null {
    return sel.mode === 'idle' ? null : this.state.units[sel.slot] ?? null;
  }

  private rangeFor(u: Unit): RangeTable {
    const t = computeMoveRange(this.state.grid, this.state.units, u, this.tables.race[u.race]!, this.tables.item);
    markTargets(t, this.state.grid, this.state.units, u, 0, this.tables);
    return t;
  }

  private select(slot: number): BattleEvent[] {
    const u = this.state.units[slot];
    if (!u || slot >= PARTY_SLOTS || u.side !== 0) return reject('not a party unit');
    if (incap(u.status) || (u.moved && u.acted)) return reject('unit finished');
    this.state.lastPath = [];
    this.setSel({ mode: 'menu', slot, range: this.rangeFor(u) });
    return [{ type: 'selected', slot }];
  }

  private cancel(sel: Selection): BattleEvent[] {
    if (sel.mode === 'idle') return reject('nothing to cancel');
    if (sel.mode === 'face') return reject('choose a direction');
    if (sel.mode === 'menu') { this.setSel({ mode: 'idle' }); return [{ type: 'deselected' }]; }
    this.setSel({ mode: 'menu', slot: sel.slot, range: sel.range });
    return [];
  }

  private beginMove(sel: Selection): BattleEvent[] {
    const u = this.unitOf(sel);
    if (!u || sel.mode !== 'menu') return reject(u ? 'not in menu' : 'no unit selected');
    if (u.moved) return reject('already moved');
    const range = this.rangeFor(u);
    let any = false;
    for (const cell of range.cells()) if ((cell.c !== u.c || cell.r !== u.r) && canStop(range, this.state.units, u, cell.c, cell.r)) { any = true; break; }
    if (!any) return reject('nowhere to move');
    this.setSel({ mode: 'move', slot: u.slot, range });
    return [];
  }

  private move(sel: Selection, c: number, r: number): BattleEvent[] {
    const u = this.unitOf(sel);
    if (!u) return reject('no unit selected');
    if (sel.mode !== 'move') return reject('not moving');
    if ((c === u.c && r === u.r) || !canStop(sel.range, this.state.units, u, c, r)) return reject('cannot stop there');
    const path = pathTo(sel.range, this.state.grid, u, this.tables.race[u.race]!, [c, r], this.tables.item);
    if (path.length === 0) return reject('no path');
    u.c = c; u.r = r; u.dir = path[path.length - 1]!; u.moved = true;
    this.state.lastPath = path;
    this.setSel({ mode: 'menu', slot: u.slot, range: this.rangeFor(u) });
    return [{ type: 'moved', slot: u.slot, path, to: [c, r] }];
  }

  private beginTarget(sel: Selection, action: number): BattleEvent[] {
    const u = this.unitOf(sel);
    if (!u || sel.mode !== 'menu') return reject(u ? 'not in menu' : 'no unit selected');
    if (u.acted) return reject('already acted');
    if (action !== 0) {
      if (!u.spells.includes(action) || !this.tables.magic[action]) return reject('unknown spell');
      if (u.mp < Math.abs(this.tables.magic[action]!.mp_cost)) return reject('not enough MP');
      if (u.status === 6) return reject('silenced');
    }
    const range = new RangeTable(u.c, u.r);
    if (markTargets(range, this.state.grid, this.state.units, u, action, this.tables) === 0) return reject('no target in range');
    this.setSel({ mode: 'target', slot: u.slot, action, range });
    return [];
  }

  private act(sel: Selection, c: number, r: number): BattleEvent[] {
    const u = this.unitOf(sel);
    if (!u) return reject('no unit selected');
    if (sel.mode !== 'target') return reject('not targeting');
    if (sel.range.kindAt(c, r) === 0) return reject('not a target cell');
    const dir = c !== u.c || r !== u.r ? dirTo(u.c, u.r, c, r) : u.dir;
    const probe = { ...u, dir };                                                   // facing is applied only when the action goes ahead
    const targets = targetsOf(this.state.grid, this.state.units, probe, sel.action, [c, r], this.tables).map((t) => (t === probe ? u : t));
    if (targets.length === 0) return reject('no target there');
    u.dir = dir;
    const events = this.perform(u, sel.action, [c, r], targets, this.state.lastPath);
    if (this.state.phase.kind === 'player') this.setSel(u.status === 1 ? { mode: 'idle' } : { mode: 'face', slot: u.slot });
    return events;
  }

  /** Shared by player and AI: MP, dash, resolution, flags, outcome. */
  private perform(u: Unit, action: number, cell: [number, number], targets: Unit[], path: Dir[]): BattleEvent[] {
    const weapon = this.tables.item[u.weapon]!;
    if (action !== 0) u.mp -= Math.abs(this.tables.magic[action]!.mp_cost);
    const dash = action === 0 && isDash(this.state.grid, u, path, cell, weapon);
    const hits = resolveAction(u, action, targets, { tables: this.tables, grid: this.state.grid, units: this.state.units, rng: this.state.rng, dash });
    u.acted = true;
    const events: BattleEvent[] = [{ type: 'action', slot: u.slot, action, cell, hits }];
    events.push(...applyOutcome(this.state, u, hits, this.tables));
    return events;
  }

  private wait(sel: Selection): BattleEvent[] {
    const u = this.unitOf(sel);
    if (!u || sel.mode !== 'menu') return reject(u ? 'not in menu' : 'no unit selected');
    u.moved = true; u.acted = true;
    this.setSel({ mode: 'face', slot: u.slot });
    return [];
  }

  private face(sel: Selection, dir: Dir): BattleEvent[] {
    const u = this.unitOf(sel);
    if (!u || sel.mode !== 'face') return reject(u ? 'not choosing a direction' : 'no unit selected');
    u.dir = dir; u.moved = true; u.acted = true;
    this.setSel({ mode: 'idle' });
    const events: BattleEvent[] = [{ type: 'faced', slot: u.slot, dir }];
    if (this.partyFinished()) events.push(...this.beginEnemyPhase());
    return events;
  }

  private beginEnemyPhase(): BattleEvent[] {
    const s = this.state;
    const party = liveUnits(s.units).filter((u) => u.slot < PARTY_SLOTS);
    const queue = liveUnits(s.units).filter((u) => u.slot >= PARTY_SLOTS && u.side !== 1 && u.side !== 7 && u.hp > 0 && !incap(u.status) && party.some((p) => hostile(u, p))).map((u) => u.slot);
    s.phase = { kind: 'enemy', queue };
    const events: BattleEvent[] = [{ type: 'phase', kind: 'enemy' }, ...statusTick(s, (u) => u.slot >= PARTY_SLOTS)];
    return queue.length === 0 ? [...events, ...this.endEnemyPhase()] : events;
  }

  private endEnemyPhase(): BattleEvent[] {
    const s = this.state;
    const events = statusTick(s, (u) => u.slot < PARTY_SLOTS);
    events.push(...roundStart(s));
    s.phase = { kind: 'player', sel: { mode: 'idle' } };
    events.push({ type: 'phase', kind: 'player' });
    return events;
  }

  private enemyStep(): BattleEvent[] {
    const s = this.state;
    if (s.phase.kind !== 'enemy') return reject('player phase');
    let u: Unit | null = null;
    while (s.phase.queue.length > 0 && !u) {
      const cand = s.units[s.phase.queue.shift()!];
      if (cand && cand.hp > 0 && !incap(cand.status) && cand.side !== 7) u = cand;
    }
    if (!u) return this.endEnemyPhase();
    const events: BattleEvent[] = [];
    const d = chooseAction(s, u, this.tables);
    if (d.path.length > 0) {
      u.c = d.dest[0]; u.r = d.dest[1]; u.dir = d.path[d.path.length - 1]!;
      events.push({ type: 'moved', slot: u.slot, path: d.path, to: d.dest });
    }
    u.moved = true;
    if (d.action !== null && d.cell) {
      if (d.cell[0] !== u.c || d.cell[1] !== u.r) u.dir = dirTo(u.c, u.r, d.cell[0], d.cell[1]);
      const targets = targetsOf(s.grid, s.units, u, d.action, d.cell, this.tables);
      if (targets.length > 0) events.push(...this.perform(u, d.action, d.cell, targets, d.path));
      else u.acted = true;
    } else if (d.faceDir !== null) {
      u.dir = d.faceDir;
      events.push({ type: 'faced', slot: u.slot, dir: d.faceDir });
    }
    if (s.phase.kind === 'enemy' && s.phase.queue.length === 0) events.push(...this.endEnemyPhase());
    return events;
  }
}
