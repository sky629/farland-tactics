import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MapData } from '../src/assets/types';
import { Battle } from '../src/battle/battle';
import { dist, hostile, liveUnits } from '../src/battle/grid';
import { canStop } from '../src/battle/moveRange';
import type { BattleEvent, Command } from '../src/battle/types';
import { validateRoster } from '../src/data/loader';
import type { BattleEntry, RosterUnit, Tables } from '../src/data/types';

const ASSETS = fileURLToPath(new URL('../public/assets/', import.meta.url));
const available = existsSync(join(ASSETS, 'data', 'battles.json'));
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(ASSETS, rel), 'utf-8')) as T;
const roster = (n: number) => readJson<RosterUnit[]>(`data/roster/stage${String(n).padStart(3, '0')}.json`);

describe.skipIf(!available)('battle corpus', () => {
  const tables: Tables = available ? { race: readJson('data/race.json'), item: readJson('data/item.json'), magic: readJson('data/magic.json') } : { race: [], item: [], magic: [] };
  const battles = available ? readJson<BattleEntry[]>('data/battles.json') : [];

  it('has 33 battles, 74 races, 180 items and 84 magics', () => {
    expect(battles).toHaveLength(33);
    expect([tables.race.length, tables.item.length, tables.magic.length]).toEqual([74, 180, 84]);
  });

  it('every battle starts, every roster validates, and one full enemy phase runs without throwing', () => {
    const roster1 = roster(1);
    for (const entry of battles) {
      const ros = roster(entry.roster);
      validateRoster(ros, tables, `roster ${entry.roster}`);
      const map = readJson<MapData>(`map/${entry.map}.json`);
      const b = Battle.start(entry, map, roster1, ros, tables, 7);
      expect(b.state.units.filter((u) => u && u.side === 0).length, entry.label).toBeGreaterThan(0);
      b.reduce({ type: 'endTurn' });
      let guard = 0;
      while (b.state.phase.kind === 'enemy' && guard++ < 60) b.reduce({ type: 'enemyStep' });
      expect(b.state.phase.kind, `${entry.event} ${entry.label}`).not.toBe('enemy');
    }
  });

  /** Reads the phase through a call so TypeScript does not narrow it across reduce() calls. */
  const phaseKind = (x: Battle): string => x.state.phase.kind;

  /** Simple policy: each hero attacks a reachable enemy if it can, else walks toward the nearest enemy, then faces east. */
  function play(seed: number): { events: BattleEvent[]; turns: number; result: string } {
    const entry = battles[0]!;
    const b = Battle.start(entry, readJson<MapData>(`map/${entry.map}.json`), roster(1), roster(entry.roster), tables, seed);
    const log: BattleEvent[] = [];
    const run = (c: Command) => { const ev = b.reduce(c); log.push(...ev); return ev; };
    let iter = 0;
    while (b.state.phase.kind === 'player' && b.state.turn <= 40) {
      const s = b.state;
      if (++iter > 2000) { const sel = s.phase.kind === 'player' ? s.phase.sel : null; throw new Error(`policy spins: turn ${s.turn} sel ${sel?.mode} units ${JSON.stringify(liveUnits(s.units).filter((u) => u.side === 0).map((u) => [u.slot, u.c, u.r, u.moved, u.acted, u.status]))} last ${JSON.stringify(log.slice(-6))}`); }
      const hero = liveUnits(s.units).find((u) => u.side === 0 && !(u.moved && u.acted) && u.status === 0);
      if (!hero) { run({ type: 'endTurn' }); }
      else {
        run({ type: 'select', slot: hero.slot });
        const tryAttack = (): boolean => {
          if (run({ type: 'beginTarget', action: 0 }).some((e) => e.type === 'rejected')) return false;
          const sel = b.state.phase.kind === 'player' ? b.state.phase.sel : null;
          if (!sel || sel.mode !== 'target') return false;
          const target = liveUnits(b.state.units).find((u) => hostile(hero, u) && sel.range.kindAt(u.c, u.r) === 1);
          if (!target) { run({ type: 'cancel' }); return false; }
          run({ type: 'act', c: target.c, r: target.r });
          return true;
        };
        if (!tryAttack() && !hero.moved) {
          run({ type: 'beginMove' });
          const sel = b.state.phase.kind === 'player' ? b.state.phase.sel : null;
          if (sel && sel.mode === 'move') {
            const enemies = liveUnits(b.state.units).filter((u) => hostile(hero, u));
            let best: [number, number] | null = null, bestD = 999;
            for (const cell of sel.range.cells()) {
              if (!canStop(sel.range, b.state.units, hero, cell.c, cell.r) || (cell.c === hero.c && cell.r === hero.r)) continue;
              const d = Math.min(...enemies.map((e) => dist(e.c, e.r, cell.c, cell.r)));
              if (d < bestD) { bestD = d; best = [cell.c, cell.r]; }
            }
            if (!best || run({ type: 'move', c: best[0], r: best[1] }).some((e) => e.type === 'rejected')) run({ type: 'cancel' });
            tryAttack();
          }
        }
        if (b.state.phase.kind === 'player' && b.state.phase.sel.mode === 'menu') run({ type: 'wait' });
        if (b.state.phase.kind === 'player' && b.state.phase.sel.mode === 'face') run({ type: 'face', dir: 1 });
      }
      let guard = 0;
      while (phaseKind(b) === 'enemy' && guard++ < 60) run({ type: 'enemyStep' });
    }
    return { events: log, turns: b.state.turn, result: b.state.phase.kind === 'end' ? b.state.phase.result : 'open' };
  }

  it('the first battle is played to an end by a simple policy, deterministically', () => {
    const a = play(7), b = play(7);
    expect(a.result).not.toBe('open');
    expect(a.turns).toBeLessThanOrEqual(40);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    console.info(`first battle: ${a.result} in ${a.turns} turns, ${a.events.length} events`);
  });
});
