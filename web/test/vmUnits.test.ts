import { describe, expect, it } from 'vitest';
import { newCampaign } from '../src/game/campaign';
import { FakeHost } from '../src/script/host';
import { ScriptVm } from '../src/script/vm';
import { unit } from './helpers/battleFixtures';
import { prog, res } from './helpers/scriptFixtures';

const start = (rows: Parameters<typeof prog>[1], rosters: Parameters<typeof res>[1] = {}) => {
  const host = new FakeHost(); const c = newCampaign();
  c.units[0] = unit({ slot: 0, id: 1, c: 2, r: 2 }); c.units[1] = unit({ slot: 1, id: 2, c: 3, r: 2 });
  const vm = new ScriptVm(res([prog(0, rows)], rosters), c, host);
  vm.run(0, 'begin');
  return { host, c, vm };
};

describe('ScriptVm: units and sprites', () => {
  it('SET_POS/SET_DIR/FACE_UNIT move and turn units; SET_DIR 4 keeps the facing', () => {
    const { c, vm } = start(['begin', ['SET_POS', 1, 5, 2], ['SET_DIR', 1, 3], ['SET_DIR', 2, 4], ['FACE_UNIT', 1, 2], ['END']]);
    vm.step(0);
    expect(c.units[0]).toMatchObject({ c: 5, r: 2, dir: 3 });
    expect(c.units[1]!.dir).toBe(1);                                      // unit 2 at (3,2) faces unit 1 at (5,2): east
  });
  it('a unit id that resolves to nobody is skipped with a warning', () => {
    const { vm, host } = start(['begin', ['SET_POS', 77, 1, 1], ['ANIM', 78, 'x', 1], ['ATTACH_SPRITE', 79], ['END']]);
    vm.step(0);
    expect(host.calls.filter((x) => x[0] === 'log' && x[1] === 'warn').map((x) => x[2])).toEqual(['SET_POS: unit 77 not found', 'ANIM: unit 78 not found']);
  });
  it('REMOVE_UNIT of a unit that is already gone (killed and looted) is a silent no-op', () => {
    const { vm, host, c } = start(['begin', ['REMOVE_UNIT', 27], ['REMOVE_UNIT', 1], ['END']]);
    vm.step(0);
    expect(c.units[0]).toBeNull();                                          // the one that is there goes
    expect(host.calls.some((x) => x[0] === 'log' && x[1] === 'warn')).toBe(false);
  });
  it('MOVE_TO hands the unit and the animation name to the host (its M offsets are the knock-back path)', () => {
    const { vm, host } = start(['begin', ['MOVE_TO', 1, 'f.event04'], ['END']]);
    expect(vm.step(0)).toBe('ended');
    expect(host.calls).toContainEqual(['moveTo', 0, 'f.event04']);
    expect(host.calls.some((x) => x[0] === 'log' && x[1] === 'warn')).toBe(false);
  });
  it('LOAD_SPRITE/SHOW_IMAGE/SOUND names are lower-cased to match the exported asset names', () => {
    const { c, vm, host } = start(['begin', ['LOAD_SPRITE', 'NPC_02', 15, 1, 1], ['SHOW_IMAGE', 'SOFCOM', 0], ['SOUND', 'MAGIC07'], ['END']]);
    vm.step(0);
    expect(c.units.find((x) => x?.id === 15)!.sprite?.apd).toBe('npc_02');
    expect(host.calls).toContainEqual(['showImage', 'sofcom', 0]);
    expect(host.calls).toContainEqual(['sound', 'magic07']);
  });
  it('an instruction whose unit is 0 is skipped without reading the rest', () => {
    const { c, vm, host } = start(['begin', ['SET_DIR', 0], ['SET_POS', 0], ['FLAG_SET', 0, 1], ['END']]);
    expect(vm.step(0)).toBe('ended');
    expect(c.flags[0]).toBe(1);
    expect(host.calls.filter((x) => x[0] === 'log')).toHaveLength(0);
  });
  it('LOAD_SPRITE/SPRITE_REUSE/ATTACH_SPRITE create object units with the named APD; RESPRITE_UNIT swaps a letter file', () => {
    const { c, vm } = start(['begin', ['LOAD_SPRITE', 'npc_02', 15, 20, 30], ['SPRITE_REUSE', 16, 1, 1], ['ATTACH_SPRITE', 100], ['ATTACH_SPRITE', 1], ['RESPRITE_UNIT', 2, 'c'], ['END']]);
    vm.step(0);
    const u15 = c.units.find((u) => u?.id === 15)!, u16 = c.units.find((u) => u?.id === 16)!, u100 = c.units.find((u) => u?.id === 100)!;
    expect(u15).toMatchObject({ side: 1, c: 20, r: 30, sprite: { apd: 'npc_02', layer: 3 } });
    expect(u16.sprite?.apd).toBe('npc_02');
    expect(u100).toMatchObject({ race: 7, side: 1, sprite: { apd: 'npc_02' } });
    expect(c.units[0]!.sprite?.apd).toBe('npc_02');
    expect(c.units[1]!.sprite?.apd).toBe('char_00c');
    expect(c.lastSprite).toBe('char_00c');
  });
  it('ANIM, MOVE_PATH and WAIT_UNIT go through the host; MOVE_PATH updates the position and the last direction', () => {
    const { c, vm, host } = start(['begin', ['ANIM', 1, '*f.event01', 1], ['MOVE_PATH', 1, 'run', 'sseN'], ['WAIT_UNIT', 1], ['END']]);
    expect(host.calls).not.toContainEqual(['moveTo', 0, 'f.event04']);
    host.busyUnits.add(0);
    expect(vm.step(0)).toBe('waiting');
    expect(host.calls).toContainEqual(['anim', 0, 'f.event01', false, true]);
    expect(host.calls).toContainEqual(['moveUnit', 0, [0, 0, 1, 3], 'run']);
    expect(c.units[0]).toMatchObject({ c: 3, r: 3, dir: 3 });
    host.busyUnits.clear();
    expect(vm.step(1)).toBe('ended');
  });
  it('REMOVE_UNIT, SET_VISIBLE and KILL/REVIVE change the unit; SET_VISIBLE on a hidden unit clears status 9', () => {
    const { c, vm, host } = start(['begin', ['KILL', 1], ['REVIVE', 1], ['SET_VISIBLE', 2, 1], ['REMOVE_UNIT', 2], ['END']]);
    c.units[1]!.status = 9;
    vm.step(0);
    expect(c.units[0]).toMatchObject({ status: 0, hp: 30 });
    expect(host.calls).toContainEqual(['setVisible', 1, true]);
    expect(c.units[1]).toBeNull();
  });
  it('REMOVE_SCRIPT_UNITS and HEAL_ALL: script units go, everyone but the hidden is healed', () => {
    const { c, vm } = start(['begin', ['LOAD_SPRITE', 'x', 15, 1, 1], ['REMOVE_SCRIPT_UNITS'], ['HEAL_ALL'], ['END']]);
    c.units[0]!.hp = 1; c.units[0]!.mp = 0; c.units[1]!.status = 9;
    vm.step(0);
    expect(c.units.find((u) => u?.id === 15)).toBeUndefined();
    expect(c.units[0]).toMatchObject({ hp: 30, mp: 10, status: 0 });
    expect(c.units[1]!.status).toBe(9);
  });
});

describe('ScriptVm: map, items and battle', () => {
  it('LOAD_MAP waits for the host; LOAD_UNITS places the roster (moving known party members, creating new ones); BATTLE_START_HEAL resets the party and enters battle', () => {
    const roster = [
      { unit_id: 8, race: 1, level: 1, dir: 0, c: 6, r: 4, status: 0, side: 4, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0 },
      { unit_id: 1, race: 0, level: 1, dir: 2, c: 7, r: 7, status: 0, side: 0, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0 },     // existing party member: moved
      { unit_id: 3, race: 0, level: 1, dir: 0, c: 1, r: 1, status: 0, side: 0, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0 },     // new party member: created in slot 2
    ];
    const { c, vm, host } = start(['begin', ['LOAD_MAP', 49], ['LOAD_UNITS', 49], ['BATTLE_START_HEAL'], ['END']], { 49: roster });
    host.loading = true;
    expect(vm.step(0)).toBe('waiting');
    host.loading = false;
    c.units[0]!.hp = 3; c.units[0]!.moved = true;
    expect(vm.step(1)).toBe('ended');
    expect(c.units[10]).toMatchObject({ id: 8, side: 4, c: 6, r: 4 });
    expect(c.units[0]).toMatchObject({ id: 1, c: 7, r: 7, dir: 2, hp: 30, mp: 10, moved: false, acted: false });
    expect(c.units[2]).toMatchObject({ id: 3, side: 0, c: 1, r: 1 });
    expect(c.turn).toBe(0);
    expect(host.calls).toContainEqual(['enterBattle']);
    expect(host.calls.at(-1)).toEqual(['scriptEnded', 'battle']);
  });
  it('GIVE_ITEM/TAKE_ITEM/ADD_GOLD/GIVE_ITEM_TO touch the inventory and report through result', () => {
    const { c, vm } = start(['begin', ['GIVE_ITEM', 7, 3], ['TAKE_ITEM', 7, 1], ['ADD_GOLD', 150], ['GIVE_ITEM_TO', 2, 1], ['JUMP_IF_RESULT', 1, 'ok'], ['END'], 'ok', ['FLAG_SET', 0, 1], ['END']]);
    vm.step(0);
    expect(c.inventory).toMatchObject({ gold: 350, items: [{ id: 7, count: 2 }] });
    expect(c.units[1]!.bag[0]).toBe(1);
    expect(c.flags[0]).toBe(1);
  });
  it('TEST_ACTIVE and TEST_IS_ACTOR set result from the units', () => {
    const { c, vm } = start(['begin', ['TEST_ACTIVE', 2], ['JUMP_IF_RESULT', 0, 'dead'], ['TEST_IS_ACTOR', 1], ['JUMP_IF_RESULT', 1, 'actor'], ['END'], 'dead', ['FLAG_SET', 0, 1], ['END'], 'actor', ['FLAG_SET', 0, 2], ['END']]);
    c.units[1]!.status = 1; c.actor = 0;
    vm.step(0);
    expect(c.flags[0]).toBe(1);
  });
  it('TEST_IS_ACTOR for someone else stands the beaten target back up: HP 1, status 0 (FUN_0040a5c0 case 0x2e — a boss only its destined foe may fell)', () => {
    const { c, vm, host } = start(['begin', ['TEST_IS_ACTOR', 2], ['JUMP_IF_RESULT', 1, 'actor'], ['END'], 'actor', ['FLAG_SET', 0, 2], ['END']]);
    c.units[10] = unit({ slot: 10, id: 25, side: 3, c: 4, r: 2, hp: 0, status: 1 });
    c.actor = 0; c.battleTarget = 10;                                        // unit 1 struck the boss down; the hook asks whether it was unit 2
    vm.step(0);
    expect(c.flags[0]).toBe(0);
    expect(c.units[10]).toMatchObject({ hp: 1, status: 0 });
    expect(host.calls).toContainEqual(['unitsChanged']);
    expect(host.calls).toContainEqual(['log', 'info', 'TEST_IS_ACTOR: slot 10 stands back up at 1 HP']);   // the stage hears it: a player (or the walker) learns whose blow the script waits for
  });
  it('run() forgets a BATTLE_RESULT in progress: a script restarted during the EXP dialog (a load) does not reuse the old pool', () => {
    const { vm, host } = start(['begin', ['BATTLE_RESULT', 100, 200], ['END'], 'again', ['BATTLE_RESULT', 50, 70], ['END']]);
    host.modal = null;
    expect(vm.step(0)).toBe('waiting');
    vm.run(0, 'again');
    expect(vm.step(0)).toBe('waiting');
    expect(host.calls.filter((x) => x[0] === 'openModal' && x[1] === 'result').map((x) => x[2]).at(-1)).toEqual({ gold: 50, pool: 70 });
  });
  it('BATTLE_RESULT adds gold and hands the EXP pool to the result dialog; when it closes the party levels up on the EXP it got and a message lists the level-ups (FUN_0040a5c0 case 9)', () => {
    const { c, vm, host } = start(['begin', ['BATTLE_RESULT', 100, 200], ['END']]);
    c.units[0]!.exp = 250; c.units[0]!.level = 1;
    host.modal = null;
    expect(vm.step(0)).toBe('waiting');
    expect(c.inventory.gold).toBe(300);
    expect(host.calls).toContainEqual(['openModal', 'result', { gold: 100, pool: 200 }]);
    expect(c.units[0]!.level).toBe(1);                                         // nothing grows while the dialog is open
    c.units[0]!.exp += 200;                                                    // the dialog's OK: the player gave the whole pool to unit 0
    host.modal = 0;                                                            // the fake host answers every modal at once
    expect(vm.step(1)).toBe('ended');
    expect(c.units[0]!.level).toBe(5);                                         // 450 EXP → level 5, announced in a message after the dialog
    expect(host.calls.filter((x) => x[0] === 'openModal').at(-1)).toEqual(['openModal', 'message', '카린: 레벨 1 → 5']);
  });
  it('BATTLE_RESULT with nothing to level up closes without a message', () => {
    const { c, vm, host } = start(['begin', ['BATTLE_RESULT', 0, 50], ['END']]);
    host.modal = 0;
    expect(vm.step(0)).toBe('ended');
    expect(c.inventory.gold).toBe(200);
    expect(host.calls.filter((x) => x[0] === 'openModal')).toEqual([['openModal', 'result', { gold: 0, pool: 50 }]]);
  });
  it('the debug-only EXT99 ops are logged and skipped', () => {
    const { vm, host } = start(['begin', ['EXT99_4', 1, 'x'], ['END']]);
    expect(vm.step(0)).toBe('ended');
    expect(host.calls.filter((x) => x[0] === 'log' && x[1] === 'warn')).toHaveLength(1);
  });
});
