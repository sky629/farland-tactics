import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/battle/rng';
import { incap } from '../src/battle/grid';
import type { RosterUnit, Tables } from '../src/data/types';
import { GameCore } from '../src/game/gameCore';
import type { Resources } from '../src/script/host';
import { loadProgram } from '../src/script/program';
import { FakeStage } from './helpers/stageFixtures';

const ASSETS = fileURLToPath(new URL('../public/assets/', import.meta.url));
const available = existsSync(join(ASSETS, 'data', 'event00.json'));
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(ASSETS, rel), 'utf-8')) as T;

/**
 * Walks the whole campaign headlessly with a FakeStage: clicks every WAIT_CLICK away, answers modals (ASK → yes,
 * shops/saves → cancel), skips visual scenes, picks the town facility that moves the story on, and wins every battle at
 * once (enemies fall before the first turn). What it proves: every stage file loads, every map and roster the story needs
 * exists, the hooks chain (BATTLE_START → settle → COMPLETE → next stage) runs to the ending without a warning.
 */
describe.skipIf(!available)('campaign walk (headless)', () => {
  const index = readJson<{ events: number[] }>('index.json');
  const programs = new Map(index.events.map((n) => [n, loadProgram(n, readJson(`data/event${String(n).padStart(2, '0')}.json`))]));
  const tables: Tables = { race: readJson('data/race.json'), item: readJson('data/item.json'), magic: readJson('data/magic.json') };
  const res: Resources = {
    program: (n) => programs.get(n) ?? null,
    roster: (n) => { const p = join(ASSETS, 'data', 'roster', `stage${String(n).padStart(3, '0')}.json`); return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf-8')) as RosterUnit[]) : null; },
    tables, rng: Rng.fromSeed(7),
  };

  it('a new game reaches the ending: every stage, town and battle in order, without warnings', () => {
    const stage = new FakeStage();
    const core = new GameCore(res, stage);
    core.newGame();
    const log: string[] = []; const stages: number[] = []; const battles: number[] = []; const towns: string[] = [];
    let now = 0, seen = 0, lastStage = -1, lastMode = '';
    const townTries = new Map<string, number>();
    for (let frame = 0; frame < 400_000 && core.mode !== 'ended'; frame++) {
      now += 50;
      // react to what the stage was asked since the last frame
      for (; seen < stage.calls.length; seen++) {
        const c = stage.calls[seen]!;
        if (c[0] === 'openModal') stage.modal = c[1] === 'ask' ? 1 : c[1] === 'shop' || c[1] === 'save' ? -1 : 0;   // ASK: yes (the inn's "end the day?" moves the story on)
        if (c[0] === 'log') log.push(`${String(c[1])}:${String(c[2])} @stage${core.campaign.stage} mode ${core.mode}`);
      }
      if (stage.visual) stage.visual = null;                                  // the scene is over at once
      if (core.campaign.stage !== lastStage) { lastStage = core.campaign.stage; stages.push(lastStage); }
      if (core.mode === 'script') { stage.clicks = 1; stage.fading = false; }
      else if (core.mode === 'town') {
        if (lastMode !== 'town') towns.push(`stage${core.campaign.stage}`);
        const flags = core.campaign.townFlags;
        const order = [2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0];        // guild first, the exit last; visits go round-robin — story flags advance by visiting places in turn
        const key = `${core.campaign.stage}:${battles.length}`;
        const visits = townTries.get(key) ?? 0;
        if (visits >= 120) { log.push(`walk: town at stage ${core.campaign.stage} did not move on after ${visits} visits (town flags ${flags.join(',')}, flags ${core.campaign.flags.slice(0, 12).join(',')})`); break; }
        const active = order.filter((i) => (flags[i] ?? 0) !== 0);
        if (active.length === 0) { log.push(`walk: town at stage ${core.campaign.stage} has no active facility`); break; }
        const pick = active[visits % active.length]!;
        townTries.set(key, visits + 1);
        log.push(`walk: stage ${core.campaign.stage} town → facility ${pick} (flags ${core.campaign.flags.slice(0, 12).join(',')})`);
        core.townSelect(pick);
      } else if (core.mode === 'battle' && core.battle && !stage.presenter.busy && core.battle.state.phase.kind === 'player') {
        if (lastMode !== 'battle') battles.push(core.campaign.stage);
        for (const u of core.battle.state.units) if (u && u.side !== 0 && u.side !== 1 && u.side !== 7 && !incap(u.status)) { u.hp = 0; u.status = 1; }
        (core as unknown as { handle(e: unknown): void }).handle(core.battle.settle());
      }
      lastMode = core.mode;
      core.frame(now);
    }
    for (; seen < stage.calls.length; seen++) { const c = stage.calls[seen]!; if (c[0] === 'log') log.push(`${String(c[1])}:${String(c[2])} @stage${core.campaign.stage} mode ${core.mode}`); }
    const ins = core.vm.state.program?.code[core.vm.state.pc];
    log.push(`walk: stopped in ${core.mode} at stage ${core.campaign.stage}, pc ${core.vm.state.pc} op ${ins?.op} ${JSON.stringify(ins?.args ?? [])} wait ${JSON.stringify((core.vm as unknown as { wait: unknown }).wait)} modalOpen ${(core.vm as unknown as { modalOpen: boolean }).modalOpen} presenter busy ${stage.presenter.busy} visual ${JSON.stringify(stage.visual)} map ${stage.mapReady()}`);
    const warnings = log.filter((l) => l.startsWith('warn'));
    console.info(`stages ${stages.join(' → ')}\nbattles at ${battles.join(',')}\ntowns ${towns.length}\nmode ${core.mode} at stage ${core.campaign.stage}, ${Math.round(now / 1000)} s simulated\nlog:\n${log.filter((l) => !l.startsWith('walk: stage')).join('\n')}\nlast town picks: ${log.filter((l) => l.startsWith('walk: stage')).slice(-12).join(' | ')}`);
    expect(warnings).toEqual([]);
    expect(core.mode).toBe('ended');
    expect(log.filter((l) => l.includes('game complete'))).toHaveLength(1);
    expect(stages).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(battles).toHaveLength(33);                                           // the battle catalog has 33 entries (field_mode.md)
  });
});
