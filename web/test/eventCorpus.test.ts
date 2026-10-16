import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/battle/rng';
import type { RosterUnit, Tables } from '../src/data/types';
import { newCampaign } from '../src/game/campaign';
import { FakeHost, type Resources } from '../src/script/host';
import { findLabel, loadProgram, str } from '../src/script/program';
import { ScriptVm } from '../src/script/vm';

const ASSETS = fileURLToPath(new URL('../public/assets/', import.meta.url));
const available = existsSync(join(ASSETS, 'data', 'event00.json'));
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(ASSETS, rel), 'utf-8')) as T;

describe.skipIf(!available)('event corpus', () => {
  const index = readJson<{ events: number[] }>('index.json');
  const programs = new Map(index.events.map((n) => [n, loadProgram(n, readJson(`data/event${String(n).padStart(2, '0')}.json`))]));
  const tables: Tables = { race: readJson('data/race.json'), item: readJson('data/item.json'), magic: readJson('data/magic.json') };
  const res: Resources = {
    program: (n) => programs.get(n) ?? null,
    roster: (n) => { const p = join(ASSETS, 'data', 'roster', `stage${String(n).padStart(3, '0')}.json`); return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf-8')) as RosterUnit[]) : null; },
    tables, rng: Rng.fromSeed(1),
  };
  it('loads all 20 files and every jump target exists in its file (LOAD_SCRIPT targets in theirs)', () => {
    expect(programs.size).toBe(20);
    const missing: string[] = [];
    for (const p of programs.values()) for (const ins of p.code) {
      if (ins.op === 'JUMP' || ins.op === 'CALL' || ins.op === 'JUMP_IF_RESULT' || ins.op === 'JUMP_IF_LESS') {
        const l = str(ins.args[ins.op === 'JUMP' || ins.op === 'CALL' ? 0 : 1]);
        if (l && findLabel(p, l) === null) missing.push(`${p.stage}:${ins.at}:${l}`);
      }
      if (ins.op === 'LOAD_SCRIPT') {
        const t = programs.get(Number(ins.args[0])); const l = str(ins.args[1]);
        if (!t || (l && findLabel(t, l) === null)) missing.push(`${p.stage}:${ins.at}:LOAD_SCRIPT ${String(ins.args[0])} ${l}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('every story file has a Restart label (a loaded save continues from it); the debug files 98/99 need none', () => {
    for (const p of programs.values()) if (p.stage < 98) expect(findLabel(p, 'Restart'), `event${p.stage}`).not.toBeNull();
  });
  it('every runtime label the game asks for exists where the game looks', () => {
    expect(findLabel(programs.get(0)!, 'begin')).not.toBeNull();
    expect(findLabel(programs.get(0)!, 'GAMEOVER')).not.toBeNull();
    expect(findLabel(programs.get(0)!, 'town')).not.toBeNull();
    for (const n of [1, 2, 3]) expect(findLabel(programs.get(n)!, 'begin')).not.toBeNull();
  });
  it('EVENT00 begin runs through the opening to TOWN with a fake host that clicks everything away', () => {
    const host = new FakeHost(); host.modal = 1;
    const c = newCampaign();
    const vm = new ScriptVm(res, c, host);
    expect(vm.run(0, 'begin')).toBe(true);
    let now = 0, steps = 0;
    while (vm.running && steps < 200_000) { host.clicks = 1; host.fading = false; const r = vm.step(now); now += 50; steps++; if (r === 'ended') break; }
    expect(vm.running).toBe(false);
    expect(host.calls).toContainEqual(['enterTown']);
    const warnings = host.calls.filter((x) => x[0] === 'log' && x[1] === 'warn').map((x) => String(x[2]));
    expect(warnings.filter((w) => !w.startsWith('MOVE_TO'))).toEqual([]);   // MOVE_TO (one use, meaning unknown) is skipped by decision (spec §6)
    expect(c.stage).toBe(1);
    expect(c.townSet).toBe(1);
  });
});
