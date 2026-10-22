import { describe, expect, it } from 'vitest';
import { GameCore } from '../src/game/gameCore';
import type { RosterUnit } from '../src/data/types';
import { prog, res } from './helpers/scriptFixtures';
import { FakeStage } from './helpers/stageFixtures';
import { MapModel } from '../src/map/mapModel';

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
    stage.effects.snapshot(0);                                                 // the picture is resolved when drawn
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
  it('LOAD_MAP puts the camera at the new map\'s top-left (FUN_0042d5d0 zeroes the scroll): a scenery cut with no camera command shows the map, not the last camera\'s void', () => {
    const stage = new FakeStage();
    const core = new GameCore(res([prog(0, ['begin', ['LOAD_MAP', 9], ['CAMERA_TILE', 20, 10], ['WAIT', 1000], ['LOAD_MAP', 9], ['WAIT', 1000], ['END']])]), stage);
    core.newGame(); core.frame(0); core.frame(16);
    expect(stage.camera).toEqual({ x: 320, y: 240 });                           // CAMERA_TILE centred cell (20,10) = (640,480)
    core.frame(1100);
    expect(stage.calls.filter((c) => c[0] === 'loadMap')).toHaveLength(2);
    expect(stage.camera).toEqual({ x: 0, y: 0 });
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
  it('in script mode the presenter follows the units every idle frame: SET_DIR with no host call shows before the next click', () => {
    const stage = new FakeStage();
    const core = new GameCore(res([prog(0, ['begin', ['LOAD_UNITS', 5], ['LOAD_MAP', 49], ['SET_DIR', 1, 1], ['WAIT_CLICK', 0], ['END']])], { 5: party }), stage);
    core.newGame(); core.frame(0); core.frame(16);
    const mm = new MapModel(stage.mapData()!, [], null);
    const body = stage.presenter.scene(mm, { units: core.campaign.units, phase: { kind: 'player', sel: { mode: 'idle' } } }).sprites.find((sp) => sp.layer === 4 && sp.c === 2 && sp.r === 4);
    expect(body?.flipH).toBe(true);                                            // dir 1 (east) is drawn mirrored
  });
  it('MUSIC, MUSIC_FADE, WAIT_MUSIC_FADE and SOUND reach the stage; the fade wait holds while the stage says it is fading', () => {
    const stage = new FakeStage();
    const core = new GameCore(res([prog(0, ['begin', ['MUSIC', 6], ['SOUND', 'hit'], ['SOUND', '*door'], ['MUSIC_FADE', 500, 0], ['WAIT_MUSIC_FADE'], ['MUSIC', -1], ['END']])]), stage);
    stage.fading = true;
    core.newGame(); core.frame(0);
    expect(stage.calls).toContainEqual(['playMusic', 6]);
    expect(stage.calls).toContainEqual(['playSound', 'hit']);
    expect(stage.calls).toContainEqual(['playSound', '*door']);
    expect(stage.calls).toContainEqual(['fadeMusic', 500, false]);
    expect(stage.calls.some((x) => x[0] === 'stopMusic')).toBe(false);          // WAIT_MUSIC_FADE still waiting
    stage.fading = false;
    core.frame(16);
    expect(stage.calls).toContainEqual(['stopMusic']);
    expect(core.campaign.bgm).toBe(-1);
  });
  it('LOAD_MAP -1 unloads the map at once and the script goes on (FUN_0042d5d0 frees the map and returns 1 for a negative number)', () => {
    const stage = new FakeStage();
    const core = new GameCore(res([prog(0, ['begin', ['LOAD_MAP', 49], ['LOAD_MAP', -1], ['SOUND', 'hit'], ['WAIT_CLICK', 0], ['END']])]), stage);
    core.newGame(); core.frame(0);
    expect(stage.calls).toContainEqual(['loadMap', -1]);
    core.frame(16);
    expect(stage.mapData()).toBeNull();
    expect(stage.calls).toContainEqual(['playSound', 'hit']);
    expect(stage.calls.some((c) => c[0] === 'log' && c[1] === 'warn')).toBe(false);
  });
  it('the presenter knows while a script runs (SET poses, FUN_0041f580 bVar2): scriptMode is true in the script and false once the battle starts', () => {
    const stage = new FakeStage(); stage.ready = false;
    const core = new GameCore(res([prog(0, ['begin', ['LOAD_UNITS', 5], ['LOAD_MAP', 49], ['BATTLE_START_HEAL'], ['END']])], { 5: [...party, slime] }), stage);
    core.newGame(); core.frame(0);
    expect(core.mode).toBe('script');
    expect(stage.presenter.scriptMode).toBe(true);
    stage.ready = true; core.frame(16);
    expect(core.mode).toBe('battle');
    expect(stage.presenter.scriptMode).toBe(false);
  });
  it('the battle entry carries the story\'s objective — the script\'s MESSAGE text (underscores as spaces) with the EPISODE title: what 클리어 조건 shows', () => {
    const stage = new FakeStage();
    const core = new GameCore(res([prog(0, ['begin', ['LOAD_UNITS', 5], ['LOAD_MAP', 49], ['EPISODE', '첫업무', 0], ['MESSAGE', '슬라임을_전멸시켜라!?'], ['BATTLE_START_HEAL'], ['END']])], { 5: [...party, slime] }), stage);
    core.newGame(); core.frame(0);
    stage.modal = 0; core.frame(16); core.frame(32);
    expect(core.mode).toBe('battle');
    expect(core.battle!.state.entry).toMatchObject({ episode: '첫업무', objective: '슬라임을 전멸시켜라!?' });
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

describe('game over', () => {
  it('a lost battle runs the GAMEOVER label and its END ends the game with "game over" (event00 gameover: … SHOW_IMAGE title, END) instead of returning to the dead battle', () => {
    const stage = new FakeStage();
    const core = new GameCore(res([prog(0, ['begin', ['LOAD_UNITS', 5], ['LOAD_MAP', 49], ['BATTLE_START_HEAL'], ['END'], 'GAMEOVER', ['HIDE_IMAGE'], ['END']])], { 5: [...party, slime] }), stage);
    core.newGame(); core.frame(0); core.frame(16);
    expect(core.mode).toBe('battle');
    for (const u of core.battle!.state.units.slice(0, 2)) { u!.hp = 0; u!.status = 1; }                 // the whole party has fallen
    core.dispatch({ type: 'endTurn' });                                                                 // the enemy phase's end check finds no party → 'end' defeat
    expect(core.battle!.state.phase).toEqual({ kind: 'end', result: 'defeat' });
    for (let t = 32; t < 3000 && core.mode !== 'ended'; t += 16) core.frame(t);
    expect(core.mode).toBe('ended');
    expect(core.result).toBe('defeat');
    expect(core.battle).toBeNull();
    expect(stage.calls).toContainEqual(['log', 'info', 'game over']);
    expect(stage.calls.some((c) => c[0] === 'log' && c[1] === 'warn')).toBe(false);
  });
});

describe('victory', () => {
  it('a won battle runs COMPLETE; when that script starts the next battle (event03 complete → … → battle_start: FIELD_MODE, BATTLE_START_HEAL, END) the game goes on in the new battle', () => {
    const stage = new FakeStage();
    const core = new GameCore(res([prog(0, ['begin', ['LOAD_UNITS', 5], ['LOAD_MAP', 49], ['BATTLE_START_HEAL'], ['END'], 'COMPLETE', ['LOAD_UNITS', 5], ['FIELD_MODE'], ['BATTLE_START_HEAL'], ['END']])], { 5: [...party, slime] }), stage);
    core.newGame(); core.frame(0); core.frame(16);
    const first = core.battle!;
    const foe = first.state.units[10]!; foe.hp = 0; foe.status = 1;                                   // the last enemy has fallen
    core.dispatch({ type: 'endTurn' });
    expect(first.state.phase).toEqual({ kind: 'end', result: 'victory' });
    for (let t = 32; t < 3000 && !(core.mode === 'battle' && core.battle !== first); t += 16) core.frame(t);   // end hook → COMPLETE script → new battle
    expect(core.mode).toBe('battle');
    expect(core.battle).not.toBe(first);
    expect(core.battle!.state.phase).toEqual({ kind: 'player', sel: { mode: 'idle' } });
    expect(stage.calls.some((c) => c[0] === 'log' && String(c[2]).startsWith('game'))).toBe(false);
  });
});

describe('ending', () => {
  it('WRITE_COMPLETE_FLAG then END ends the game (event17 writes the flag, shows the title and ENDs; no GAME_COMPLETE_QUIT)', () => {
    const stage = new FakeStage();
    const core = new GameCore(res([prog(0, ['begin', ['WRITE_COMPLETE_FLAG'], ['SHOW_IMAGE', 'title', 1], ['WAIT_FADE'], ['HIDE_IMAGE'], ['END']])]), stage);
    core.newGame(); core.frame(0); core.frame(1000);
    expect(core.mode).toBe('ended');
    expect(stage.calls).toContainEqual(['log', 'info', 'game complete']);
    expect(stage.calls.some((c) => c[0] === 'log' && c[1] === 'warn')).toBe(false);
  });
});

describe('visual scenes (PLAY_VISUAL)', () => {
  it('PLAY_VISUAL 21 starts scene 1 on the stage and the VM waits until the scene is done', () => {
    const stage = new FakeStage();
    const core = new GameCore(res([prog(0, ['begin', ['PLAY_VISUAL', 21], ['SOUND', 'tumble'], ['WAIT_CLICK', 0], ['END']])]), stage);
    core.newGame(); core.frame(0);
    expect(stage.calls).toContainEqual(['startVisual', 1, 0]);
    core.frame(16);
    expect(stage.calls.some((c) => c[0] === 'playSound')).toBe(false);        // the script has not moved on
    stage.visual = null;                                                       // the scene ended (or was skipped by a click)
    core.frame(32);
    expect(stage.calls).toContainEqual(['playSound', 'tumble']);
    expect(core.mode).toBe('script');
  });
  it('PLAY_VISUAL 0 starts the opening at part 0 and PLAY_VISUAL 3 at part 3', () => {
    const stage = new FakeStage();
    const core = new GameCore(res([prog(0, ['begin', ['PLAY_VISUAL', 3], ['END']])]), stage);
    core.newGame(); core.frame(0);
    expect(stage.calls).toContainEqual(['startVisual', 0, 3]);
  });
  it('an unknown scene number logs and the script continues at once', () => {
    const stage = new FakeStage();
    const core = new GameCore(res([prog(0, ['begin', ['PLAY_VISUAL', 40], ['SOUND', 'tumble'], ['WAIT_CLICK', 0], ['END']])]), stage);
    core.newGame(); core.frame(0);
    expect(stage.calls.filter((c) => c[0] === 'startVisual')).toEqual([]);
    expect(stage.calls.some((c) => c[0] === 'log' && c[1] === 'warn' && String(c[2]).includes('PLAY_VISUAL 40'))).toBe(true);
    expect(stage.calls).toContainEqual(['playSound', 'tumble']);
  });
});
