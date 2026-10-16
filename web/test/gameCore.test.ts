import { describe, expect, it } from 'vitest';
import { GameCore } from '../src/game/gameCore';
import type { RosterUnit } from '../src/data/types';
import { prog, res } from './helpers/scriptFixtures';
import { FakeStage } from './helpers/stageFixtures';

const party: RosterUnit[] = [
  { unit_id: 1, race: 0, level: 2, dir: 0, c: 2, r: 4, status: 0, side: 0, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0 },
  { unit_id: 2, race: 0, level: 2, dir: 0, c: 2, r: 5, status: 0, side: 0, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0 },
];
const slime: RosterUnit = { unit_id: 8, race: 1, level: 1, dir: 0, c: 6, r: 4, status: 0, side: 4, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0 };

describe('GameCore', () => {
  it('newGame runs EVENT00 begin in script mode; images, windows and text reach the stage; a script with nowhere to return ends the game', () => {
    const stage = new FakeStage();
    const core = new GameCore(res([prog(0, ['begin', ['SHOW_IMAGE', 'vop99', 0], ['MSG_BOTTOM', [1, 'b']], ['TEXT', '아프다'], ['WAIT_CLICK', 0], ['END']])]), stage);
    core.newGame();
    expect(core.mode).toBe('script');
    expect(core.campaign.inventory.gold).toBe(200);
    core.frame(0);
    expect(stage.calls).toContainEqual(['bitmap', 'vop99']);
    expect(stage.calls).toContainEqual(['openWindow', 'bottom', 1, 'b']);
    expect(stage.calls).toContainEqual(['text', 'bottom', '아프다', '카린']);
    core.frame(16);
    expect(core.mode).toBe('script');
    stage.clicks = 1;
    core.frame(32);
    expect(core.mode).toBe('ended');
    expect(stage.calls.some((x) => x[0] === 'log' && x[1] === 'warn')).toBe(true);
  });
  it('TOWN enters town mode; a hotspot runs its label from the stage file, else from EVENT00; inactive hotspots do nothing', () => {
    const stage = new FakeStage();
    const core = new GameCore(res([
      prog(0, ['begin', ['FLAG_SET', 0, 1], ['STAGE_FROM_FLAG', 0], ['TOWN_FLAG_SET', 1, 1], ['TOWN_FLAG_SET', 2, 1], ['TOWN'], 'guild', ['FLAG_SET', 9, 2], ['END']]),
      prog(1, ['inn', ['FLAG_SET', 9, 1], ['END']]),
    ]), stage);
    core.newGame(); core.frame(0);
    expect(core.mode).toBe('town');
    expect(stage.calls.at(-1)).toEqual(['showTown', 1, false, core.campaign.townFlags]);
    core.townSelect(3);                                                        // weapon shop: flag 0 → ignored
    expect(core.mode).toBe('town');
    core.townSelect(1);                                                        // inn: stage 1 file
    expect(core.mode).toBe('script');
    core.frame(10);
    expect(core.campaign.flags[9]).toBe(1);
    expect(core.mode).toBe('town');
    core.townSelect(2);                                                        // guild: not in stage 1 → EVENT00
    core.frame(20);
    expect(core.campaign.flags[9]).toBe(2);
    expect(core.mode).toBe('town');
  });
  it('LOAD_MAP waits for the stage; BATTLE_START + END creates a Battle over the campaign units and inventory', () => {
    const stage = new FakeStage(); stage.ready = false;
    const core = new GameCore(res([prog(0, ['begin', ['LOAD_UNITS', 5], ['LOAD_MAP', 49], ['BATTLE_START_HEAL'], ['END']])], { 5: [...party, slime] }), stage);
    core.newGame(); core.frame(0);
    expect(core.mode).toBe('script');
    expect(core.battle).toBeNull();
    stage.ready = true;
    core.frame(16);
    expect(core.mode).toBe('battle');
    expect(core.battle!.state.units).toBe(core.campaign.units);
    expect(core.battle!.state.inventory).toBe(core.campaign.inventory);
    expect(core.battle!.state.units[0]).toMatchObject({ id: 1, c: 2, r: 4 });
    expect(core.battle!.state.units[10]).toMatchObject({ id: 8, side: 4 });
    expect(core.battle!.state.phase).toEqual({ kind: 'player', sel: { mode: 'idle' } });
    core.dispatch({ type: 'select', slot: 0 });
    expect(core.battle!.state.phase.kind === 'player' && core.battle!.state.phase.sel.mode).toBe('menu');
  });
});
