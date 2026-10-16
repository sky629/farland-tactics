import { describe, expect, it } from 'vitest';
import { Presenter, POPUP_MS, STEP_MS } from '../src/field/presenter';
import { tables, unit } from './helpers/battleFixtures';
import { chest, healing, hero, heroB, heroE, itemTables, mapModel, number, provider, slime, state } from './helpers/presenterFixtures';

describe('Presenter', () => {
  it('draws body, shadow and no icon for a healthy unit; nothing for an unknown APD', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    p.sync(s);
    const { sprites } = p.scene(mapModel(s), s);
    const hero0 = sprites.filter((sp) => sp.c === 2 && sp.r === 4);
    expect(hero0.map((sp) => sp.layer).sort()).toEqual([2, 4]);
    s.units[0]!.race = 3;                                      // char_03a is not provided
    p.sync(s);
    expect(p.scene(mapModel(s), s).sprites.filter((sp) => sp.c === 2 && sp.r === 4)).toHaveLength(0);
  });
  it('a moved event walks the snapshot one cell per STEP_MS with a pixel offset in between', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    p.sync(s);
    s.units[0]!.c = 5; s.units[0]!.moved = true;               // the rules already moved the unit
    p.enqueue([{ type: 'moved', slot: 0, path: [1, 1, 1], to: [5, 4] }]);
    expect(p.busy).toBe(true);
    p.update(0);
    p.update(STEP_MS / 2);
    const mid = p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.model === heroB)!;   // walking → the "b" file
    expect(mid.c).toBe(2);
    expect(mid.offset!.x).toBe(16);                            // half a cell east = 32 px / 2
    expect(p.focus).toEqual([3, 4]);                           // the camera follows the step in progress
    p.update(STEP_MS * 3 + 1);
    p.update(STEP_MS * 3 + 2);
    expect(p.busy).toBe(false);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.model === hero)).toMatchObject({ c: 5, r: 4 });
    expect(p.focus).toBeNull();                                // released once the queue drains, so the player can scroll away
  });
  it('body sprites are mirrored for east/west facing', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    s.units[0]!.dir = 1;
    p.sync(s);
    const body = () => p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.model === hero)!;
    expect(body().flipH).toBe(true);
    expect(body().player.timeline.name).toBe('F.STAND');
    s.units[0]!.dir = 3;
    p.sync(s);
    expect(body().flipH).toBe(false);
    expect(body().player.timeline.name).toBe('B.STAND');
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 2)!.flipH).toBeFalsy();   // shadows never flip
  });
  it('a move plays RUN1/RUN2 from the "b" file, alternating per step and facing each step', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    p.sync(s);
    s.units[0]!.c = 4; s.units[0]!.r = 3; s.units[0]!.dir = 3; s.units[0]!.moved = true;
    p.enqueue([{ type: 'moved', slot: 0, path: [1, 1, 3], to: [4, 3] }]);
    const body = () => p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4)!;
    p.update(0);
    p.update(STEP_MS / 2);
    expect(body()).toMatchObject({ model: heroB, flipH: true });
    expect(body().player.timeline.name).toBe('F.RUN1');
    p.update(STEP_MS * 1.5);
    expect(body().player.timeline.name).toBe('F.RUN2');
    p.update(STEP_MS * 2.5);
    expect(body()).toMatchObject({ model: heroB, flipH: false });
    expect(body().player.timeline.name).toBe('B.RUN1');
    p.update(STEP_MS * 3 + 1);
    p.update(STEP_MS * 3 + 2);
    expect(p.busy).toBe(false);
    expect(body()).toMatchObject({ model: hero, flipH: false });
    expect(body().player.timeline.name).toBe('B.STAND');
  });
  it('a race whose "b" file has WALK but no RUN walks, a flyer with only FLY flies; one without a "b" file keeps standing while it slides', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    s.units[0]!.race = 2;
    p.sync(s);
    p.enqueue([{ type: 'moved', slot: 0, path: [1], to: [3, 4] }, { type: 'moved', slot: 10, path: [2], to: [5, 4] }]);
    p.update(0);
    p.update(STEP_MS / 2);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.c === 2)!.player.timeline.name).toBe('F.WALK1');
    const flyer = new Presenter(provider, tables());
    const fs = state(); fs.units[0]!.race = 4; flyer.sync(fs);
    flyer.enqueue([{ type: 'moved', slot: 0, path: [1, 1], to: [4, 4] }]);
    flyer.update(0); flyer.update(STEP_MS * 1.5);
    expect(flyer.scene(mapModel(fs), fs).sprites.find((sp) => sp.layer === 4 && sp.c === 3)!.player.timeline.name).toBe('F.FLY2');
    p.update(STEP_MS * 1.5);
    const slimeBody = p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.model === slime)!;
    expect(slimeBody.player.timeline.name).toBe('B.STAND');
    expect(slimeBody.flipH).toBe(true);
  });
  it('the attack anim comes from the "b" file and spell casting from the "e" file, mirrored with the actor', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    s.units[0]!.c = 5; s.units[0]!.dir = 1;
    p.sync(s);
    p.enqueue([{ type: 'action', slot: 0, action: 0, cell: [6, 4], hits: [] }, { type: 'action', slot: 0, action: 1, cell: [6, 4], hits: [] }]);
    p.update(0);
    p.update(100);
    const body = () => p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.c === 5)!;
    expect(body()).toMatchObject({ model: heroB, flipH: true });
    expect(body().player.timeline.name).toBe('F.ATTACK1');
    p.update(300 + 1);   // attack (300 ms) done → CAST1A starts
    p.update(300 + 50);
    expect(body()).toMatchObject({ model: heroE, flipH: true });
    expect(body().player.timeline.name).toBe('F.CAST1A');
  });
  it('an item action plays no cast anim: the effect APD of its use_effect magic appears on the target and the body keeps standing', () => {
    const s = state();
    const p = new Presenter(provider, itemTables);
    p.sync(s);
    p.enqueue([{ type: 'action', slot: 0, action: 1007, cell: [2, 4], hits: [{ target: 0, kind: 'heal', value: 20, crit: false, popup: '20', statusAfter: 0 }] }]);
    p.update(0); p.update(50);
    const sprites = p.scene(mapModel(s), s).sprites;
    expect(sprites.find((sp) => sp.model === healing)).toMatchObject({ c: 2, r: 4, layer: 5 });
    expect(sprites.find((sp) => sp.layer === 4 && sp.c === 2)!.player.timeline.name).toBe('F.STAND');
    let now = 50;
    while (p.busy && now < 10_000) { p.update(now); now += 50; }
    expect(p.busy).toBe(false);
  });
  it('an item without an effect APD still settles', () => {
    const s = state();
    const p = new Presenter(provider, itemTables);
    p.sync(s);
    p.enqueue([{ type: 'action', slot: 0, action: 1008, cell: [2, 4], hits: [{ target: 0, kind: 'miss', value: 0, crit: false, popup: 'miss!', statusAfter: 0 }] }]);
    let now = 0;
    while (p.busy && now < 10_000) { p.update(now); now += 50; }
    expect(now).toBeLessThan(10_000);
  });
  it('pickup and bagFull show a text popup over the unit; revealed turns a hidden chest into a standing one', () => {
    const s = state();
    s.units[20] = unit({ slot: 20, c: 3, r: 4, race: 9, side: 7, id: 8, status: 9 });
    const p = new Presenter(provider, tables());
    p.sync(s);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.model === chest)!.player.timeline.name).toBe('F.HIDE');
    p.enqueue([{ type: 'revealed', slot: 20 }, { type: 'pickup', slot: 0, item: 7, gold: 0 }, { type: 'bagFull', slot: 0, item: 1 }, { type: 'pickup', slot: 0, item: 0, gold: 50 }]);
    p.update(0); p.update(1);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.model === chest)!.player.timeline.name).toBe('F.STAND');
    const texts = (): string[] => p.scene(mapModel(s), s).texts.map((x) => x.text);
    p.update(100);
    expect(texts()).toEqual(['herb 획득']);
    p.update(POPUP_MS + 60);
    expect(texts()).toEqual(['더 가질 수 없다']);
    p.update(POPUP_MS * 2 + 70);
    expect(texts()).toEqual(['50 Gold']);
  });
  it('an action plays the attack anim, then the reaction anim with a number popup, then settles', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    s.units[0]!.c = 5; s.units[0]!.dir = 1;
    p.sync(s);
    s.units[10]!.hp = 4;
    p.enqueue([{ type: 'action', slot: 0, action: 0, cell: [6, 4], hits: [{ target: 10, kind: 'damage', value: 8, crit: false, popup: '8', statusAfter: 0 }] }]);
    p.update(0);
    expect(p.busy).toBe(true);
    p.update(100);
    expect(p.scene(mapModel(s), s).sprites.some((sp) => sp.model === number)).toBe(false);   // still attacking (300 ms)
    p.update(350);
    const popups = p.scene(mapModel(s), s).sprites.filter((sp) => sp.model === number);
    expect(popups).toHaveLength(1);                            // one digit "8"
    expect(popups[0]).toMatchObject({ c: 6, r: 4, layer: 5 });
    p.update(300 + POPUP_MS + 1);
    p.update(300 + POPUP_MS + 2);
    expect(p.busy).toBe(false);
  });
  it('falls back to STAND when the body APD lacks RUN and ATTACK and still finishes the queue', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    p.sync(s);
    s.units[10]!.c = 3;
    p.enqueue([
      { type: 'moved', slot: 10, path: [2, 2, 2], to: [3, 4] },
      { type: 'action', slot: 10, action: 0, cell: [2, 4], hits: [{ target: 0, kind: 'miss', value: 0, crit: false, popup: 'miss!', statusAfter: 0 }] },
    ]);
    let now = 0;
    while (p.busy && now < 10_000) { p.update(now); now += 50; }
    expect(p.busy).toBe(false);
    expect(now).toBeLessThan(10_000);
    p.update(now);
    expect(p.scene(mapModel(s), s).texts).toEqual([]);          // the "miss!" text has expired
  });
  it('a dead unit shows its death pose only after the hit step and removal hides it', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    s.units[0]!.c = 5; s.units[0]!.dir = 1;
    p.sync(s);
    s.units[10] = null;
    p.enqueue([
      { type: 'action', slot: 0, action: 0, cell: [6, 4], hits: [{ target: 10, kind: 'damage', value: 12, crit: true, popup: '12', statusAfter: 1 }] },
      { type: 'died', slot: 10 }, { type: 'removed', slot: 10 },
    ]);
    p.update(0); p.update(100);
    expect(p.scene(mapModel(s), s).sprites.some((sp) => sp.model === slime)).toBe(true);
    let now = 100;
    while (p.busy && now < 10_000) { p.update(now); now += 50; }
    expect(p.scene(mapModel(s), s).sprites.some((sp) => sp.model === slime)).toBe(false);
  });
});
