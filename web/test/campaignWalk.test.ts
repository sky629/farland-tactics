/**
 * Walks the whole campaign headlessly: the Walker (src/dev/walker.ts) plays, this harness is its world on a MapStage — it clicks
 * every WAIT_CLICK away, answers modals, ends scenes and fades at once, keeps the autosaves, and reports. The browser's auto-play
 * page (play/walk.ts) is the other world of the same Walker. Developer knobs: WALK_SAVE_DIR writes every battle's BATTLE_START
 * autosave there, WALK_FROM starts from such a save instead of a new game, WALK_STOP_STAGE / WALK_STOP_BATTLES end the walk early.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/battle/rng';
import { Walker, type WalkModalKind, type WalkWorld } from '../src/dev/walker';
import { GameCore } from '../src/game/gameCore';
import { available, MapStage, walkResources } from './helpers/walkFixtures';

describe.skipIf(!available)('campaign walk (headless)', () => {
  it('a new game reaches the ending: every stage, town and battle in order, battles played by the AI with retries, without warnings', () => {
    const { res, tables } = walkResources();
    const stage = new MapStage();
    const core = new GameCore(res, stage);
    core.newGame();
    const saveDir = process.env.WALK_SAVE_DIR, fromPath = process.env.WALK_FROM, stopStage = Number(process.env.WALK_STOP_STAGE ?? 99), stopBattles = Number(process.env.WALK_STOP_BATTLES ?? 999);
    const from = fromPath ? new Uint8Array(readFileSync(fromPath)) : null;
    if (from) stage.saves.set(30, from);                                        // the save is this battle's BATTLE_START autosave: retries reload it
    const world: WalkWorld = {
      click: () => { stage.clicks = 1; },
      answer: (_kind, v) => { stage.modal = v; },
      presenterBusy: () => stage.presenter.busy,
      autosave: (n) => stage.saves.get(n) ?? null,
      reseed: (seed) => { res.rng = Rng.fromSeed(seed); },
      log: () => {},
    };
    const onAutosave = saveDir ? (n: number, bytes: Uint8Array) => writeFileSync(join(saveDir, `battle-${String(n).padStart(2, '0')}-stage${String(core.campaign.stage).padStart(2, '0')}.bin`), bytes) : undefined;
    const walker = new Walker(core, tables, world, { stopStage, stopBattles, from, onAutosave });
    let now = 0, seen = 0;
    for (let frame = 0; frame < 10_000_000; frame++) {
      now += 50;
      for (; seen < stage.calls.length; seen++) {                              // what the stage was asked since the last frame
        const c = stage.calls[seen]!;
        if (c[0] === 'openModal') walker.onModal(c[1] as WalkModalKind, c[2]);
        if (c[0] === 'log') walker.onLog(c[1] as 'warn' | 'info', String(c[2]));
      }
      if (stage.visual) stage.visual = null;                                  // the scene is over at once
      if (core.mode === 'script') stage.fading = false;                       // and so is a music fade
      const r = walker.step(now);
      if (r === 'stop') break;
      if (r === 'skip') continue;
      core.frame(now);
    }
    for (; seen < stage.calls.length; seen++) { const c = stage.calls[seen]!; if (c[0] === 'log') walker.onLog(c[1] as 'warn' | 'info', String(c[2])); }
    const sum = walker.summary();
    const warnings = sum.log.filter((l) => l.startsWith('warn'));
    console.info(`picks ${sum.picks}`);
    console.info(`strikes ${sum.strikes}`);
    console.info(`stages ${sum.stages.join(' → ')}\nbattles at ${sum.battles.join(',')}\ntowns ${sum.towns.length}, retries ${sum.retries}\nmode ${core.mode} at stage ${core.campaign.stage}, ${Math.round(now / 1000)} s simulated\nlog:\n${sum.log.filter((l) => !l.startsWith('walk: stage')).join('\n')}\nlast lines:\n${sum.log.slice(-30).join('\n')}`);
    expect(warnings).toEqual([]);
    if (sum.partial) { console.info(`last battle's turns:\n${sum.turnLog.join('\n')}`); return; }   // a developer's partial walk: the report above is the result
    expect(core.mode).toBe('ended');
    expect(sum.log.filter((l) => l.includes('game complete'))).toHaveLength(1);
    expect([...new Set(sum.stages)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);   // a game over passes through stage 0 (the GAMEOVER script) on the way back
    expect(sum.battles).toHaveLength(33);                                       // the battle catalog has 33 entries (field_mode.md)
  }, 6 * 3_600_000);                                                              // a real play of the whole campaign: about 40 s (the retries of the late battles decide it); vitest's 5 s default would fail the test after the fact
});
