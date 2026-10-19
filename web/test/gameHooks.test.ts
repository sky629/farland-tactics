import { describe, expect, it } from 'vitest';
import type { RosterUnit } from '../src/data/types';
import { GameCore } from '../src/game/gameCore';
import type { Program } from '../src/script/program';
import { fixedRng } from './helpers/battleFixtures';
import { prog, res } from './helpers/scriptFixtures';
import { FakeStage } from './helpers/stageFixtures';

type Row = string | [string, ...(string | number | string[])[]];
const R = (unit_id: number, side: number, c: number, r: number, race = side === 0 ? 0 : 1): RosterUnit =>
  ({ unit_id, race, level: side === 0 ? 2 : 1, dir: 0, c, r, status: 0, side, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0 });
const roster = [R(1, 0, 2, 4), R(2, 0, 5, 4), R(9, 4, 3, 4), R(8, 4, 6, 4)];   // heroes 1, 2 beside the named enemy 9 and the plain enemy 8

/** New game straight into a stage-1 battle; `stageRows` is the stage file, `event00Rows` is appended to EVENT00. */
function boot(stageRows: Row[], event00Rows: Row[] = [], units = roster) {
  const stage = new FakeStage();
  const programs: Program[] = [
    prog(0, ['begin', ['FLAG_SET', 0, 1], ['STAGE_FROM_FLAG', 0], ['LOAD_UNITS', 5], ['LOAD_MAP', 49], ['BATTLE_START_HEAL'], ['END'], ...event00Rows] as Parameters<typeof prog>[1]),
    prog(1, (stageRows.length > 0 ? stageRows : [['END']]) as Parameters<typeof prog>[1]),
  ];
  const core = new GameCore({ ...res(programs, { 5: units }), rng: fixedRng([99]) }, stage);   // 99: no critical, no evade (as battle.test.ts)
  core.newGame(); core.frame(0);
  expect(core.mode).toBe('battle');
  return { stage, core };
}
const byId = (core: GameCore, id: number) => core.campaign.units.find((u) => u !== null && u.id === id)!;
let now = 0;
/** Frames until the presenter is idle, no script runs and no hook is pending (two quiet frames in a row). */
function settle(core: GameCore, stage: FakeStage): void {
  for (let i = 0, quiet = 0; i < 400 && quiet < 2; i++) { core.frame(now += 50); quiet = !stage.presenter.busy && core.mode !== 'script' ? quiet + 1 : 0; }
}
/** Dispatch and let one frame pass: a command's own presentation must play before the next click lands. */
function cmd(core: GameCore, c: Parameters<GameCore['dispatch']>[0]): void { core.dispatch(c); core.frame(now += 50); }
function attack(core: GameCore, slot: number, target: { c: number; r: number }): void {
  cmd(core, { type: 'select', slot }); cmd(core, { type: 'beginTarget', action: 0 }); core.dispatch({ type: 'act', c: target.c, r: target.r });
}

describe('battle script hooks (story_flow.md §5)', () => {
  it('a killing blow runs BEAT%02d of the target from the stage file; WIN%02d of the actor runs only when no target label ran; id 8 has no target labels', () => {
    const { core, stage } = boot(['BEAT09', ['FLAG_SET', 1, 1], ['END'], 'WIN01', ['FLAG_SET', 2, 1], ['END'], 'BEAT08', ['FLAG_SET', 3, 1], ['END'], 'WIN02', ['FLAG_SET', 4, 1], ['END']]);
    const named = byId(core, 9), plain = byId(core, 8);
    named.hp = 1; plain.hp = 1;
    attack(core, 0, named);
    expect(core.mode).toBe('battle');                                          // no battle09 label: the blow lands at once
    settle(core, stage);
    expect(core.campaign.flags[1]).toBe(1);                                    // BEAT09 ran…
    expect(core.campaign.flags[2]).toBe(0);                                    // …so WIN01 did not
    expect(core.campaign.battleTarget).toBe(named.slot);
    expect(core.campaign.actor).toBe(0);
    expect(core.campaign.units[named.slot]).toBe(named);                      // a named corpse stays until a script converts or removes it
    expect(named.status).toBe(1);
    attack(core, 1, plain);
    settle(core, stage);
    expect(core.campaign.flags[3]).toBe(0);                                    // BEAT08 never runs
    expect(core.campaign.flags[4]).toBe(1);                                    // WIN02 does
    expect(core.campaign.units[plain.slot]).toBeNull();                        // a plain corpse is removed
    expect(core.mode).toBe('battle');
  });
  it('a non-lethal hit on an enemy runs AFTER%02d; a party unit helping another runs ASSIST%02d of the helper; the battle resumes with the facing step', () => {
    const { core, stage } = boot(['AFTER09', ['FLAG_SET', 1, 1], ['END'], 'ASSIST02', ['FLAG_SET', 2, 1], ['END']]);
    const named = byId(core, 9); named.hp = 999; named.hpMax = 999;
    attack(core, 0, named);
    settle(core, stage);
    expect(core.campaign.flags[1]).toBe(1);
    expect(named.status).toBe(0);
    expect(core.mode).toBe('battle');
    expect(core.battle!.state.phase).toEqual({ kind: 'player', sel: { mode: 'face', slot: 0 } });
    cmd(core, { type: 'face', dir: 0 });
    // hero 2 heals hero 1 with magic 2 (heal) from the fixture tables
    const hero2 = byId(core, 2); hero2.spells = [2]; hero2.mp = 99; hero2.c = 2; hero2.r = 5;
    byId(core, 1).hp = 1;
    cmd(core, { type: 'select', slot: 1 }); cmd(core, { type: 'beginTarget', action: 2 }); core.dispatch({ type: 'act', c: 2, r: 4 });
    expect(core.lastEvents[0]?.type).toBe('action');
    settle(core, stage);
    expect(core.campaign.flags[2]).toBe(1);
  });
  it('levelup%02d runs from EVENT00 after a level up, after the target hooks', () => {
    const { core, stage } = boot(['BEAT09', ['FLAG_SET', 1, 1], ['END']], ['levelup01', ['FLAG_CMP', 1, 1], ['JUMP_IF_RESULT', 0, 'no'], ['FLAG_SET', 6, 1], 'no', ['END']]);
    const named = byId(core, 9); named.hp = 1;
    byId(core, 1).exp = 199;
    attack(core, 0, named);
    settle(core, stage);
    expect(byId(core, 1).level).toBe(3);
    expect(core.campaign.flags[6]).toBe(1);                                    // levelup01 saw BEAT09's flag: target hooks came first
  });
  it('a level-up on the killing blow of the last enemy runs levelup%02d and then COMPLETE: the finished battle is revisited for its remaining hooks', () => {
    const { core, stage } = boot(['COMPLETE', ['FLAG_SET', 7, 1], ['TOWN']], ['levelup01', ['FLAG_SET', 6, 1], ['END']], [R(1, 0, 2, 4), R(9, 4, 3, 4)]);
    const last = byId(core, 9); last.hp = 1;
    byId(core, 1).exp = 199;
    attack(core, 0, last);
    settle(core, stage);
    expect(byId(core, 1).level).toBe(3);
    expect(core.campaign.flags[6]).toBe(1);                                    // levelup01 ran …
    expect(core.campaign.flags[7]).toBe(1);                                    // … and COMPLETE after it
    expect(core.mode).toBe('town');
    expect(stage.calls.some((c) => c[0] === 'log' && c[1] === 'warn')).toBe(false);
  });
  it('victory runs COMPLETE from the stage file; defeat runs GAMEOVER from EVENT00 after BEAT%02d of the fallen hero, and its END ends the game', () => {
    const a = boot(['COMPLETE', ['FLAG_SET', 7, 1], ['TOWN']], [], [R(1, 0, 2, 4), R(9, 4, 3, 4)]);
    byId(a.core, 9).hp = 1;
    attack(a.core, 0, byId(a.core, 9));
    settle(a.core, a.stage);
    expect(a.core.campaign.flags[7]).toBe(1);
    expect(a.core.mode).toBe('town');
    expect(a.core.battle).toBeNull();

    const b = boot(['BEAT01', ['FLAG_SET', 12, 1], ['END']], ['GAMEOVER', ['FLAG_SET', 8, 1], ['END']], [R(1, 0, 2, 4), R(9, 4, 3, 4)]);
    byId(b.core, 1).hp = 1;
    cmd(b.core, { type: 'select', slot: 0 }); cmd(b.core, { type: 'wait' }); cmd(b.core, { type: 'face', dir: 1 });   // hero passes → enemy phase
    settle(b.core, b.stage);
    expect(byId(b.core, 1).status).toBe(1);
    expect(b.core.campaign.flags[12]).toBe(1);
    expect(b.core.campaign.flags[8]).toBe(1);
    expect(b.core.mode).toBe('ended');                                        // no battle to go back to
    expect(b.core.battle).toBeNull();
    expect(b.core.result).toBe('defeat');
    expect(b.stage.calls).toContainEqual(['log', 'info', 'game over']);
  });
  it('victory without a COMPLETE label shows the result and stays in the battle', () => {
    const { core, stage } = boot([], [], [R(1, 0, 2, 4), R(9, 4, 3, 4)]);
    byId(core, 9).hp = 1;
    attack(core, 0, byId(core, 9));
    settle(core, stage);
    expect(core.mode).toBe('battle');
    expect(core.result).toBe('victory');
  });
  it('battle%02d runs before the blow (player: target id); END_RESUME then performs it and the target hooks follow', () => {
    const { core, stage } = boot(['battle09', ['FLAG_SET', 10, 1], ['END_RESUME'], 'BEAT09', ['FLAG_SET', 1, 1], ['END']]);
    const named = byId(core, 9); named.hp = 1;
    attack(core, 0, named);
    core.frame(now += 50);
    expect(core.mode).toBe('script');
    expect(named.hp).toBe(1);                                                  // held
    expect(core.campaign.battleTarget).toBe(named.slot);
    settle(core, stage);
    expect(core.campaign.flags[10]).toBe(1);
    expect(named.status).toBe(1);
    expect(core.campaign.flags[1]).toBe(1);
    expect(core.mode).toBe('battle');
  });
  it('battle%02d runs before an enemy attack too (actor id when the target is a party unit) and TEST_ENEMY_PHASE is true then', () => {
    const { core, stage } = boot(['battle09', ['TEST_ENEMY_PHASE'], ['JUMP_IF_RESULT', 0, 'skip'], ['FLAG_SET', 11, 1], 'skip', ['END_RESUME']], [], [R(1, 0, 2, 4), R(9, 4, 3, 4)]);
    const hero = byId(core, 1); hero.hp = 999; hero.hpMax = 999;
    cmd(core, { type: 'select', slot: 0 }); cmd(core, { type: 'wait' }); cmd(core, { type: 'face', dir: 1 });
    settle(core, stage);
    expect(core.campaign.flags[11]).toBe(1);
    expect(hero.hp).toBeLessThan(999);                                         // the held attack was performed after END_RESUME
    expect(core.mode).toBe('battle');
    expect(core.battle!.state.phase.kind).toBe('player');                      // the enemy phase ended afterwards
    expect(core.battle!.state.turn).toBe(2);
  });
});
