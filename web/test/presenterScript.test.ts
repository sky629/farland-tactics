import { describe, expect, it } from 'vitest';
import { Presenter, STEP_MS } from '../src/field/presenter';
import { tables, unit } from './helpers/battleFixtures';
import { apd, files, heroB, mapModel, provider, state } from './helpers/presenterFixtures';

const npc = apd({ 'F.EVENT01': 'S100 P0 P0 P0', 'F.STAND': 'P0', 'F.SET': 'P0', 'F.EVENT04': 'S50 P0 M12,-16\nS50 P0 M12,-10' });
const npc3 = apd({ 'F.EVENT01': 'S100 P0' });
files.npc_02 = npc; files.npc_03 = npc3;

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
