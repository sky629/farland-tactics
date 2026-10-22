import { describe, expect, it } from 'vitest';
import { Presenter, STEP_MS } from '../src/field/presenter';
import { RACE, tables, unit } from './helpers/battleFixtures';
import { apd, files, heroB, mapModel, provider, state } from './helpers/presenterFixtures';

const npc = apd({ 'F.EVENT01': 'S100 P0 P0 P0', 'F.STAND': 'P0', 'F.SET': 'P0', 'F.EVENT04': 'S50 P0 M12,-16\nS50 P0 M12,-10' });
const npc3 = apd({ 'F.EVENT01': 'S100 P0' });
const npcV = apd({ 'F.WALK1': 'S100 P0 P0', 'F.WALK2': 'S100 P0 P0', 'F.SET': 'P0' });
files.npc_02 = npc; files.npc_03 = npc3; files.npc_05 = npcV;

describe('Presenter: script sprites', () => {
  it('a unit with sprite.apd draws from that APD and plays sprite.anim; hidden units draw nothing', () => {
    const s = state();
    s.units[20] = unit({ slot: 20, id: 15, side: 1, c: 4, r: 4, race: 7, sprite: { apd: 'npc_02', layer: 3, anim: { name: 'f.event01', loop: false, force: true } } });
    const p = new Presenter(provider, tables());
    p.sync(s);
    const body = () => p.scene(mapModel(s), s).sprites.find((sp) => sp.c === 4 && sp.r === 4);
    expect(body()).toMatchObject({ model: npc, layer: 3 });
    expect(body()!.player.timeline.name).toBe('F.EVENT01');
    s.units[20]!.sprite!.hidden = true; p.sync(s);
    expect(body()).toBeUndefined();
  });
  it('a script sprite with no animation yet draws nothing: a new sprite record has anim −1 (FUN_00429630) and FUN_0042a560 skips it', () => {
    const s = state();
    s.units[20] = unit({ slot: 20, id: 100, side: 1, c: 4, r: 4, race: 7, sprite: { apd: 'npc_03', layer: 3 } });   // ATTACH_SPRITE before its ANIM (EVENT00's smoke)
    const p = new Presenter(provider, tables());
    p.sync(s);
    const body = () => p.scene(mapModel(s), s).sprites.find((sp) => sp.model === npc3);
    expect(body()).toBeUndefined();
    s.units[20]!.sprite!.anim = { name: 'f.event01', loop: true, force: false }; p.sync(s);
    expect(body()!.player.timeline.name).toBe('F.EVENT01');
  });
  it('an animation name the file does not have leaves the sprite as it was (FUN_00429a50 returns 0): the last pose stays until the record is recreated', () => {
    const s = state();
    s.units[20] = unit({ slot: 20, id: 15, side: 1, c: 4, r: 4, race: 7, dir: 2, sprite: { apd: 'npc_03', anim: { name: 'f.event01', loop: true, force: false } } });   // npc_03: F.EVENT01 only, no B.* and no STAND/SET
    const p = new Presenter(provider, tables());
    p.sync(s);
    const body = () => p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.c === 4);
    expect(body()!.player.timeline.name).toBe('F.EVENT01');
    s.units[20]!.sprite!.anim = { name: 'b.complete', loop: false, force: false }; p.sync(s);   // EVENT15 asks the 'n' file for an 'a' pose
    expect(body()!.player.timeline.name).toBe('F.EVENT01');
    s.units[20]!.sprite = { apd: 'npc_02', anim: { name: 'b.complete', loop: false, force: false } }; p.sync(s);   // RESPRITE: a new record at anim −1 … and npc_02 has no B.* either
    expect(body()).toBeUndefined();
    s.units[20] = null; p.sync(s);
    s.units[20] = unit({ slot: 20, id: 16, side: 1, c: 4, r: 4, race: 7, dir: 2, sprite: { apd: 'npc_03', anim: { name: 'b.complete', loop: false, force: false } } }); p.sync(s);   // another unit in the slot: no inherited pose
    expect(body()).toBeUndefined();
  });
  it('an attached record (ATTACH_SPRITE/LOAD_SPRITE) shows no body pose until a rebuild such as SET_DIR; a race-7 object never gets one (FUN_0041e350 returns at race 7)', () => {
    const s = state();
    s.units[0]!.sprite = { apd: 'npc_02', bare: true }; s.units[0]!.moved = true; s.units[0]!.acted = true;   // the hero in a letter file that has F.STAND and F.SET
    const p = new Presenter(provider, tables());
    p.scriptMode = true; p.sync(s);
    const hero = () => p.scene(mapModel(s), s).sprites.find((sp) => sp.model === npc && sp.c === 2);
    expect(hero()).toBeUndefined();
    s.units[0]!.sprite!.bare = false; p.sync(s);
    expect(hero()!.player.timeline.name).toBe('F.SET');
    s.units[20] = unit({ slot: 20, id: 15, side: 1, c: 4, r: 4, race: 7, sprite: { apd: 'npc_02' } }); p.sync(s);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.model === npc && sp.c === 4)).toBeUndefined();
  });
  it('a race-7 object gets neither a shadow nor a status icon (FUN_0041e350 returns before making them); a unit keeps its shadow while its body is bare', () => {
    const s = state();
    s.units[20] = unit({ slot: 20, id: 15, side: 1, c: 4, r: 4, race: 7, sprite: { apd: 'npc_02', anim: { name: 'f.event01', loop: true, force: false } } });
    s.units[0]!.sprite = { apd: 'npc_02', bare: true };
    const t = tables(); t.race[7] = RACE({ name: 'NPC', size: 3 });            // the real table gives the template class a LARGE shadow size
    const p = new Presenter(provider, t);
    p.sync(s);
    const at = (c: number) => p.scene(mapModel(s), s).sprites.filter((sp) => sp.c === c && sp.r === 4);
    expect(at(4).map((sp) => sp.player.timeline.name)).toEqual(['F.EVENT01']);
    expect(at(2).map((sp) => sp.player.timeline.name)).toEqual(['LARGE.M']);
  });
  it('a scripted unit walks with its own file\'s WALK and keeps the last walk frame afterwards (no rebuild until WAIT_UNIT)', () => {
    const s = state();
    s.units[0]!.sprite = { apd: 'npc_05', bare: true };
    const p = new Presenter(provider, tables());
    p.sync(s);
    s.units[0]!.c = 4; s.units[0]!.moved = true;                               // the VM already moved it; the visual walks there from (2,4)
    p.moveUnit(0, [1, 1], 'walk');
    p.update(0); p.update(STEP_MS / 2);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4)).toMatchObject({ model: npcV });
    p.update(STEP_MS * 2 + 1); p.update(STEP_MS * 2 + 2);
    expect(p.unitBusy(0)).toBe(false);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4)).toMatchObject({ model: npcV, c: 4 });
  });
  it('while a script runs, a party unit done moving and acting stands in its SET pose (the field shows COMPLETE)', () => {
    const s = state();
    s.units[0]!.moved = true; s.units[0]!.acted = true;
    const p = new Presenter(provider, tables());
    p.sync(s);
    const body = () => p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.c === 2)!.player.timeline.name;
    expect(body()).toBe('F.COMPLETE');
    p.scriptMode = true;
    expect(body()).toBe('F.SET');
  });
  it('when the slot gets another sprite file with a same-named anim, the player follows the new file (no stale timeline → pattern out of range)', () => {
    const s = state();
    s.units[20] = unit({ slot: 20, id: 15, side: 1, c: 4, r: 4, race: 7, sprite: { apd: 'npc_02', anim: { name: 'f.event01', loop: true, force: false } } });
    const p = new Presenter(provider, tables());
    p.sync(s);
    const body = () => p.scene(mapModel(s), s).sprites.find((sp) => sp.c === 4 && sp.r === 4)!;
    expect(body().player.timeline).toBe(npc.anim('F.EVENT01'));
    s.units[20] = unit({ slot: 20, id: 16, side: 1, c: 4, r: 4, race: 7, sprite: { apd: 'npc_03', anim: { name: 'f.event01', loop: true, force: false } } });
    p.sync(s);
    expect(body().model).toBe(npc3);
    expect(body().player.timeline).toBe(npc3.anim('F.EVENT01'));
  });
  it('moveTo plays the named anim once and reports the summed M offsets when it ends; the unit is busy meanwhile', () => {
    const s = state();
    s.units[20] = unit({ slot: 20, id: 2, side: 1, c: 4, r: 4, race: 7, dir: 0, sprite: { apd: 'npc_02' } });
    const p = new Presenter(provider, tables());
    p.sync(s);
    const got: [number, number][] = [];
    p.moveTo(20, 'f.event04', (dx, dy) => got.push([dx, dy]));
    expect(p.unitBusy(20)).toBe(true);
    p.update(0);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.c === 4 && sp.r === 4)!.player.timeline.name).toBe('F.EVENT04');
    p.update(50); p.update(101); p.update(102);
    expect(p.unitBusy(20)).toBe(false);
    expect(got).toEqual([[24, -26]]);
  });
  it('moveUnit walks the unit with the scripted base anim and unitBusy is true until it arrives', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    p.sync(s);
    s.units[0]!.c = 4; s.units[0]!.moved = true;
    p.moveUnit(0, [1, 1], 'walk');
    expect(p.unitBusy(0)).toBe(true);
    p.update(0); p.update(STEP_MS / 2);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.c === 2)).toMatchObject({ model: heroB });
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.c === 2)!.player.timeline.name).toBe('F.WALK1');
    p.update(STEP_MS * 2 + 1); p.update(STEP_MS * 2 + 2);
    expect(p.unitBusy(0)).toBe(false);
  });
  it('a sync while a walk is queued or in flight keeps that unit\'s walking visual: it still starts from its old cell', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    p.sync(s);
    s.units[0]!.c = 4; s.units[0]!.moved = true;                               // the rules (or the VM) already moved it
    p.moveUnit(0, [1, 1], 'walk');
    p.sync(s);                                                                 // an ANIM / LOAD_SPRITE right after MOVE_PATH re-syncs
    p.update(0); p.update(STEP_MS / 2);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.model === heroB)!.c).toBe(2);
    p.sync(s);                                                                 // and again mid-walk
    p.update(STEP_MS + 1);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.model === heroB)!.c).toBe(3);
    p.update(STEP_MS * 2 + 1); p.update(STEP_MS * 2 + 2);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4)!.c).toBe(4);
  });
  it('a marker draws LARGE.M under the unit and sweat shows F.SWEAT above it for a moment', () => {
    const s = state();
    s.units[0]!.sprite = { marker: true };
    const p = new Presenter(provider, tables());
    p.sync(s);
    expect(p.scene(mapModel(s), s).sprites.filter((sp) => sp.c === 2 && sp.r === 4 && sp.layer === 2)).toHaveLength(2);   // shadow + marker
    p.sweat(0);
    p.update(0); p.update(10);
    expect(p.scene(mapModel(s), s).sprites.some((sp) => sp.player.timeline.name === 'F.SWEAT')).toBe(true);
  });
});
