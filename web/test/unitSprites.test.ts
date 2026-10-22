import { describe, expect, it } from 'vitest';
import type { ApdData } from '../src/assets/types';
import { animApd, bodyAnim, bodyApd, facing, iconAnim, LAYER, pickTimeline, shadowAnim } from '../src/field/unitSprites';
import { ApdModel } from '../src/sprite/apdModel';
import { ITEM, RACE, unit } from './helpers/battleFixtures';

const items = [ITEM({ name: 'none' }), ITEM({ name: 'sword' }), ITEM({ name: 'wings', slot: 2, status_code: 11 })];

describe('bodyApd / bodyAnim (FUN_0041e350)', () => {
  it('names the APD by race and the anim by facing prefix, state token and flip', () => {
    expect(bodyApd(10)).toBe('char_10a');
    expect(bodyAnim(unit({ slot: 0, dir: 0 }), items)).toEqual({ name: 'F.STAND', flipH: false });
    expect(bodyAnim(unit({ slot: 0, dir: 1 }), items)).toEqual({ name: 'F.STAND', flipH: true });
    expect(bodyAnim(unit({ slot: 0, dir: 2 }), items)).toEqual({ name: 'B.STAND', flipH: true });
    expect(bodyAnim(unit({ slot: 0, dir: 3 }), items)).toEqual({ name: 'B.STAND', flipH: false });
    expect(bodyAnim(unit({ slot: 0, dir: 1, race: 0x17 }), items)!.flipH).toBe(false);
  });
  it('finished party units stand COMPLETE; finished enemies STAND; dead party DEAD, dead enemies DOWN_DAMAGE', () => {
    expect(bodyAnim(unit({ slot: 0, moved: true, acted: true }), items)!.name).toBe('F.COMPLETE');
    expect(bodyAnim(unit({ slot: 10, side: 4, moved: true, acted: true }), items)!.name).toBe('F.STAND');
    expect(bodyAnim(unit({ slot: 0, status: 1 }), items)!.name).toBe('F.DEAD');
  });
  it('while a script runs (FUN_0041f580 bVar2) a party unit done moving and acting shows SET whatever its status; the rest keep the field rule', () => {
    expect(bodyAnim(unit({ slot: 0, id: 1, moved: true, acted: true }), items, true)!.name).toBe('F.SET');
    expect(bodyAnim(unit({ slot: 0, id: 1, moved: true, acted: true, status: 1 }), items, true)!.name).toBe('F.SET');
    expect(bodyAnim(unit({ slot: 0, id: 1, moved: true, acted: true, status: 9 }), items, true)).toBeNull();
    expect(bodyAnim(unit({ slot: 0, id: 8, moved: true, acted: true }), items, true)!.name).toBe('F.COMPLETE');   // a nameless party unit (id 8)
    expect(bodyAnim(unit({ slot: 0, moved: true }), items, true)!.name).toBe('F.STAND');                        // still has its action
    expect(bodyAnim(unit({ slot: 10, side: 4, moved: true, acted: true }), items, true)!.name).toBe('F.STAND');   // an enemy
    expect(bodyAnim(unit({ slot: 0, moved: true, acted: true, race: 0x17 }), items, true)!.name).toBe('F.COMPLETE');   // the behemoth never SETs
    expect(bodyAnim(unit({ slot: 0, moved: true, acted: true }), items)!.name).toBe('F.COMPLETE');               // the field: no script
    expect(bodyAnim(unit({ slot: 10, side: 4, status: 1 }), items)!.name).toBe('F.DOWN_DAMAGE');
  });
  it('status tokens: petrified S/DAMAGE, frozen A/DAMAGE, levitating LEVITATE (also via a status-11 item), hidden → none, others DOWN_DAMAGE', () => {
    expect(bodyAnim(unit({ slot: 0, status: 4 }), items)!.name).toBe('F.S/DAMAGE');
    expect(bodyAnim(unit({ slot: 0, status: 5 }), items)!.name).toBe('F.A/DAMAGE');
    expect(bodyAnim(unit({ slot: 0, status: 11 }), items)!.name).toBe('F.LEVITATE');
    expect(bodyAnim(unit({ slot: 0, acc: [2, 0] }), items)!.name).toBe('F.LEVITATE');
    expect(bodyAnim(unit({ slot: 10, side: 4, status: 9 }), items)).toBeNull();
    expect(bodyAnim(unit({ slot: 10, side: 7, status: 9 }), items)!.name).toBe('F.HIDE');
    expect(bodyAnim(unit({ slot: 0, status: 2 }), items)!.name).toBe('F.DOWN_DAMAGE');
    expect(bodyAnim(unit({ slot: 0, status: 6 }), items)!.name).toBe('F.STAND');
  });
});

describe('animApd / facing (char_<race><letter>.apd, string pool 0x44a3e0)', () => {
  it('idle and reaction tokens live in the "a" file, moves and attacks in "b", spell casting in "e"', () => {
    for (const t of ['STAND', 'COMPLETE', 'DEAD', 'DEFENSE', 'MIDDLE_DAMAGE', 'UP_DAMAGE', 'DOWN_DAMAGE', 'S/DAMAGE', 'A/DAMAGE', 'LEVITATE', 'HIDE']) expect(animApd(0, t)).toBe('char_00a');
    for (const t of ['RUN1', 'RUN2', 'WALK1', 'ATTACK1', 'DASH_ATTACK1', 'JUMP1', 'DOWN1', 'DOWN2', 'FLY1', 'TAKE_OFF1', 'TOUCH_DOWN2']) expect(animApd(10, t)).toBe('char_10b');
    expect(animApd(3, 'CAST1A')).toBe('char_03e');
    expect(animApd(3, 'CAST1B')).toBe('char_03e');
    expect(bodyApd(3)).toBe(animApd(3, 'STAND'));
  });
  it('facing: F. for south/east, B. for west/north; east and west are mirrored except races 0x17 and 0x49', () => {
    expect(facing(0, 0)).toEqual({ prefix: 'F.', flipH: false });
    expect(facing(1, 0)).toEqual({ prefix: 'F.', flipH: true });
    expect(facing(2, 0)).toEqual({ prefix: 'B.', flipH: true });
    expect(facing(3, 0)).toEqual({ prefix: 'B.', flipH: false });
    expect(facing(1, 0x17)).toEqual({ prefix: 'F.', flipH: false });
    expect(facing(2, 0x49)).toEqual({ prefix: 'B.', flipH: false });
  });
});

describe('shadowAnim / iconAnim (system.apd)', () => {
  it('shadow size follows race.size, +1 when down, −1 when levitating, none for hidden or size 0', () => {
    expect(shadowAnim(unit({ slot: 0 }), RACE({ size: 3 }))).toBe('LARGE.M');
    expect(shadowAnim(unit({ slot: 0, status: 1 }), RACE({ size: 3 }))).toBe('HUGE.M');
    expect(shadowAnim(unit({ slot: 0, status: 11 }), RACE({ size: 3 }))).toBe('MIDDLE.M');
    expect(shadowAnim(unit({ slot: 0, status: 11 }), RACE({ size: 1 }))).toBeNull();
    expect(shadowAnim(unit({ slot: 0, status: 9 }), RACE({ size: 3 }))).toBeNull();
    expect(shadowAnim(unit({ slot: 0 }), RACE({ size: 0 }))).toBeNull();
    expect(shadowAnim(unit({ slot: 0 }), RACE({ size: 1 }))).toBe('SMALL.M');
  });
  it('status icons sit 56 px above the unit, 16 px for the dead; only party units show DEAD', () => {
    expect(iconAnim(unit({ slot: 0, status: 2 }))).toEqual({ name: 'POISON', dy: -56 });
    expect(iconAnim(unit({ slot: 0, status: 3 }))).toEqual({ name: 'SLEEP', dy: -56 });
    expect(iconAnim(unit({ slot: 0, status: 6 }))).toEqual({ name: 'MUTE', dy: -56 });
    expect(iconAnim(unit({ slot: 0, status: 7 }))).toEqual({ name: 'CHARM', dy: -56 });
    expect(iconAnim(unit({ slot: 0, status: 1 }))).toEqual({ name: 'DEAD', dy: -16 });
    expect(iconAnim(unit({ slot: 10, side: 4, status: 1 }))).toBeNull();
    expect(iconAnim(unit({ slot: 0 }))).toBeNull();
    expect(LAYER).toEqual({ ground: 1, shadow: 2, object: 3, unit: 4, icon: 5 });
  });
});

describe('pickTimeline', () => {
  it('prefers the "#" variant and falls back to the plain name', () => {
    const data: ApdData = { version: 3, sheets: ['s'], images: [{ sheet: 0, key: 255, x: 0, y: 0, w: 8, h: 8, ox: 0, oy: 0 }], patterns: [{ yOffset: 0, images: [0] }],
      anims: [{ name: 'F.STAND', script: 'P0' }, { name: 'F.STAND#', script: 'P0 P0' }, { name: 'B.STAND', script: 'P0' }] };
    const model = new ApdModel('x', data, [{ width: 8, height: 8, indices: new Uint8Array(64), palette: new Uint8Array(768) }]);
    expect(pickTimeline(model, 'F.STAND')!.name).toBe('F.STAND#');
    expect(pickTimeline(model, 'B.STAND')!.name).toBe('B.STAND');
    expect(pickTimeline(model, 'F.RUN1')).toBeUndefined();
  });
});
