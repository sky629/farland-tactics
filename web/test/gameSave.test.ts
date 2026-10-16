import { describe, expect, it } from 'vitest';
import type { RosterUnit } from '../src/data/types';
import { GameCore } from '../src/game/gameCore';
import { newCampaign } from '../src/game/campaign';
import { applyRoster } from '../src/battle/battle';
import { encodeSave, saveSummary } from '../src/save/format';
import type { Program } from '../src/script/program';
import { fixedRng, tables } from './helpers/battleFixtures';
import { prog, res } from './helpers/scriptFixtures';
import { FakeStage } from './helpers/stageFixtures';

type Row = string | [string, ...(string | number | string[])[]];
const R = (unit_id: number, side: number, c: number, r: number, race = side === 0 ? 0 : 1): RosterUnit =>
  ({ unit_id, race, level: side === 0 ? 2 : 1, dir: 0, c, r, status: 0, side, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0 });
const roster = [R(1, 0, 2, 4), R(8, 4, 7, 7)];
let now = 0;
function make(event00: Row[], stage1: Row[] = [['END']], units = roster) {
  const stage = new FakeStage();
  const programs: Program[] = [prog(0, event00 as Parameters<typeof prog>[1]), prog(1, stage1 as Parameters<typeof prog>[1])];
  const core = new GameCore({ ...res(programs, { 5: units }), rng: fixedRng([99]) }, stage);
  return { stage, core };
}
function settle(core: GameCore, stage: FakeStage): void {
  for (let i = 0, quiet = 0; i < 400 && quiet < 2; i++) { core.frame(now += 50); quiet = !stage.presenter.busy && core.mode !== 'script' ? quiet + 1 : 0; }
}
const cmd = (core: GameCore, c: Parameters<GameCore['dispatch']>[0]) => { core.dispatch(c); core.frame(now += 50); };

describe('GameCore save and load (spec §6)', () => {
  it('BATTLE_START autosaves to slot 30 as a 6848-byte file of the current campaign', () => {
    const { core, stage } = make(['begin', ['FLAG_SET', 0, 1], ['STAGE_FROM_FLAG', 0], ['LOAD_UNITS', 5], ['LOAD_MAP', 49], ['BATTLE_START_HEAL'], ['END']]);
    core.newGame(); core.frame(0);
    expect(core.mode).toBe('battle');
    const bytes = stage.saves.get(30)!;
    expect(bytes?.length).toBe(6848);
    expect(saveSummary(bytes)).toMatchObject({ stage: 1, gold: 200, turn: 0 });
  });
  it('a new round (after the enemy phase) autosaves to slot 31', () => {
    const { core, stage } = make(['begin', ['LOAD_UNITS', 5], ['LOAD_MAP', 49], ['BATTLE_START_HEAL'], ['END']]);
    core.newGame(); core.frame(0);
    cmd(core, { type: 'select', slot: 0 }); cmd(core, { type: 'wait' }); cmd(core, { type: 'face', dir: 1 });
    settle(core, stage);
    expect(core.battle!.state.turn).toBe(2);
    expect(stage.saves.has(31)).toBe(true);
    expect(saveSummary(stage.saves.get(31)!).turn).toBe(1);                   // one round finished
  });
  it('loadGame restores the campaign and runs Restart from the stage file (turn ≥ 0) or EVENT00 (turn < 0), then plays the saved music', () => {
    const c = newCampaign();
    applyRoster(c.units, roster, tables(), fixedRng([0]));
    c.stage = 1; c.turn = 4; c.flags[2] = 2; c.inventory.gold = 777; c.bgm = 6; c.episode = '첫업무';
    const bytes = encodeSave(c, new Date());
    const a = make(['begin', ['END'], 'Restart', ['FLAG_SET', 9, 5], ['TOWN']], ['Restart', ['FLAG_SET', 9, 1], ['TOWN']]);
    expect(a.core.loadGame(bytes)).toBe(true);
    expect(a.core.mode).toBe('script');
    a.core.frame(0);
    expect(a.core.mode).toBe('town');
    expect(a.core.campaign.flags[9]).toBe(1);                                  // the stage file's Restart ran
    expect(a.core.campaign.flags[2]).toBe(2);
    expect(a.core.campaign.inventory.gold).toBe(777);
    expect(a.core.campaign.units[0]).toMatchObject({ id: 1, level: 2 });
    expect(a.core.campaign.episode).toBe('첫업무');
    expect(a.stage.calls).toContainEqual(['log', 'info', 'music 6']);
    c.turn = -1;
    const b = make(['begin', ['END'], 'Restart', ['FLAG_SET', 9, 5], ['TOWN']], ['Restart', ['FLAG_SET', 9, 1], ['TOWN']]);
    expect(b.core.loadGame(encodeSave(c, new Date()))).toBe(true);
    b.core.frame(0);
    expect(b.core.campaign.flags[9]).toBe(5);                                  // EVENT00's Restart
  });
  it('loading a save whose stage has no Restart label warns and returns to the title; a bad file is refused', () => {
    const c = newCampaign(); c.stage = 1; c.turn = 2;
    const { core, stage } = make(['begin', ['END']], [['END']]);
    expect(core.loadGame(encodeSave(c, new Date()))).toBe(false);
    expect(core.mode).toBe('title');
    expect(stage.calls.some((x) => x[0] === 'log' && x[1] === 'warn')).toBe(true);
    expect(core.loadGame(new Uint8Array(12))).toBe(false);
  });
  it('a mid-battle save resumes through FIELD_MODE: the Battle continues from the saved round, no slot-30 autosave, no new placement', () => {
    const c = newCampaign();
    applyRoster(c.units, roster, tables(), fixedRng([0]));
    c.stage = 1; c.turn = 12; c.units[0]!.c = 5; c.units[0]!.r = 6;
    const { core, stage } = make(['begin', ['END']], ['Restart', ['LOAD_MAP', 49], ['FIELD_MODE'], ['END']]);
    expect(core.loadGame(encodeSave(c, new Date()))).toBe(true);
    core.frame(0); core.frame(16);
    expect(core.mode).toBe('battle');
    expect(core.battle!.state.turn).toBe(13);                                  // header 12 finished rounds → round 13
    expect(core.battle!.state.phase).toEqual({ kind: 'player', sel: { mode: 'idle' } });
    expect(core.battle!.state.units[0]).toMatchObject({ c: 5, r: 6 });
    expect(stage.saves.has(30)).toBe(false);
    expect(saveSummary(core.saveBytes()).turn).toBe(12);
  });
  it('loadGame zeroes race and item ids the tables do not know, with a warning each', () => {
    const c = newCampaign();
    applyRoster(c.units, roster, tables(), fixedRng([0]));
    c.units[0]!.weapon = 999; c.units[0]!.bag = [777, 0, 0, 0]; c.units[10]!.race = 200; c.units[0]!.spells = [1, 555];
    const { core, stage } = make(['begin', ['END'], 'Restart', ['TOWN']]);
    c.turn = -1;
    expect(core.loadGame(encodeSave(c, new Date()))).toBe(true);
    expect(core.campaign.units[0]).toMatchObject({ weapon: 0, bag: [0, 0, 0, 0], spells: [1] });
    expect(core.campaign.units[10]!.race).toBe(0);
    expect(stage.calls.filter((x) => x[0] === 'log' && x[1] === 'warn').length).toBeGreaterThanOrEqual(4);
  });
  it('loading while a battle is on discards it: no hooks, no battle, selection gone', () => {
    const { core, stage } = make(['begin', ['LOAD_UNITS', 5], ['LOAD_MAP', 49], ['BATTLE_START_HEAL'], ['END'], 'Restart', ['TOWN']]);
    core.newGame(); core.frame(0);
    expect(core.battle).not.toBeNull();
    const c = newCampaign(); c.turn = -1;
    expect(core.loadGame(encodeSave(c, new Date()))).toBe(true);
    expect(core.battle).toBeNull();
    core.frame(16);
    expect(core.mode).toBe('town');
    expect(stage.calls).toContainEqual(['closeAll']);
  });
});
