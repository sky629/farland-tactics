import { describe, expect, it } from 'vitest';
import { newCampaign } from '../src/game/campaign';
import { FakeHost } from '../src/script/host';
import type { Program } from '../src/script/program';
import { ScriptVm } from '../src/script/vm';
import { prog, res } from './helpers/scriptFixtures';

const setup = (programs: Program[]) => { const host = new FakeHost(); const c = newCampaign(); const vm = new ScriptVm(res(programs), c, host); return { host, c, vm }; };

describe('ScriptVm: flow and flags', () => {
  it('runs a label to END, ends with the restore mode, and sets flags with FLAG_* ops', () => {
    const { host, c, vm } = setup([prog(0, ['begin', ['FLAG_SET', 2, 5], ['FLAG_ADD', 2, 1], ['FLAG_SUB', 2, 2], ['FLAG_BIT_SET', 3, 4], ['FLAG_BIT_TOGGLE', 3, 4], ['FLAG_BIT_SET', 3, 1], ['FLAG_BIT_TEST', 3, 1], ['END']])]);
    expect(vm.run(0, 'BEGIN')).toBe(true);
    expect(vm.step(0)).toBe('ended');
    expect(c.flags[2]).toBe(4);
    expect(c.flags[3]).toBe(2);
    expect(vm.state.result).toBe(1);
    expect(host.calls.at(-1)).toEqual(['scriptEnded', 'previous']);
  });
  it('FLAG_CMP sets result and less; JUMP_IF_RESULT/LESS branch on them', () => {
    const { c, vm } = setup([prog(0, ['begin', ['FLAG_SET', 1, 3], ['FLAG_CMP', 1, 5], ['JUMP_IF_LESS', 1, 'small'], ['FLAG_SET', 9, 1], ['END'], 'small', ['FLAG_CMP', 1, 3], ['JUMP_IF_RESULT', 0, 'never'], ['FLAG_SET', 9, 2], ['END'], 'never', ['FLAG_SET', 9, 3], ['END']])]);
    vm.run(0, 'begin'); vm.step(0);
    expect(c.flags[9]).toBe(2);
  });
  it('a jump to a missing label ends the script with a warning', () => {
    const { host, vm } = setup([prog(0, ['begin', ['JUMP', 'ghost'], ['FLAG_SET', 0, 1], ['END']])]);
    vm.run(0, 'begin');
    expect(vm.step(0)).toBe('ended');
    expect(host.calls.some((x) => x[0] === 'log' && x[1] === 'warn' && String(x[2]).includes('ghost'))).toBe(true);
  });
  it('CALL keeps one return address', () => {
    const { c, vm } = setup([prog(0, ['begin', ['CALL', 'a'], ['FLAG_SET', 5, 1], ['END'], 'a', ['CALL', 'b'], ['FLAG_SET', 6, 1], ['RETURN'], 'b', ['FLAG_SET', 7, 1], ['RETURN']])]);
    vm.run(0, 'begin'); vm.step(0);
    expect(c.flags[7]).toBe(1);
    expect(c.flags[6]).toBe(1);   // RETURN from b lands in a (the only saved address)
    expect(c.flags[5]).toBe(0);   // a's RETURN has no address left → the script ends
  });
  it('LOAD_SCRIPT switches programs and keeps the flags; a missing target ends the script', () => {
    const { c, vm, host } = setup([prog(0, ['begin', ['FLAG_SET', 1, 7], ['LOAD_SCRIPT', 2, 'begin'], ['END']]), prog(2, ['begin', ['FLAG_ADD', 1, 1], ['LOAD_SCRIPT', 5, 'nowhere'], ['END']])]);
    vm.run(0, 'begin');
    expect(vm.step(0)).toBe('ended');
    expect(c.flags[1]).toBe(8);
    expect(c.stage).toBe(0);                                                // LOAD_SCRIPT changes the file, not the stage (STAGE_FROM_FLAG/NEXT_STAGE do)
    expect(host.calls.filter((x) => x[0] === 'log' && x[1] === 'warn')).toHaveLength(1);
  });
  it('run() returns false for an unknown stage or label', () => {
    const { vm } = setup([prog(0, ['begin', ['END']])]);
    expect(vm.run(7, 'begin')).toBe(false);
    expect(vm.run(0, 'nope')).toBe(false);
  });
});

describe('ScriptVm: waits, windows and modals', () => {
  it('WAIT holds the same instruction until the time passes; WAIT_FADE until the host finishes fading', () => {
    const { host, vm, c } = setup([prog(0, ['begin', ['WAIT', 1000], ['FADE_OUT', 8], ['WAIT_FADE'], ['FLAG_SET', 0, 1], ['END']])]);
    vm.run(0, 'begin');
    expect(vm.step(100)).toBe('waiting');
    expect(vm.step(900)).toBe('waiting');
    host.fading = true;
    expect(vm.step(1100)).toBe('waiting');
    expect(host.calls).toContainEqual(['fade', 'out', 8]);
    host.fading = false;
    expect(vm.step(1200)).toBe('ended');
    expect(c.flags[0]).toBe(1);
  });
  it('MSG_TOP/TEXT open a window, print the speaker name on the first line only, and close on speaker 0', () => {
    const { host, vm } = setup([prog(0, ['begin', ['MSG_BOTTOM', [1, 'b']], ['TEXT', '아프다...」'], ['TEXT', '두_번째'], ['MSG_BOTTOM', [0, null]], ['SET_SPEAKER_NAME', '수상한_남자'], ['MSG_TOP', [14, 'a']], ['TEXT', '...'], ['MSG_TOP', [31, null]], ['TEXT', 'x'], ['END']])]);
    vm.run(0, 'begin'); vm.step(0);
    const texts = host.calls.filter((x) => x[0] === 'text');
    expect(host.calls[0]).toEqual(['openWindow', 'bottom', 1, 'b']);
    expect(texts[0]).toEqual(['text', 'bottom', '아프다...」', '카린']);
    expect(texts[1]).toEqual(['text', 'bottom', '두 번째', null]);
    expect(host.calls).toContainEqual(['closeWindow', 'bottom']);
    expect(texts[2]).toEqual(['text', 'top', '...', '수상한 남자']);
    expect(texts[3]).toEqual(['text', 'top', 'x', null]);                 // speaker ≥ 30 without a unit → no name
  });
  it('WAIT_CLICK waits for a click; with a timeout it releases on time', () => {
    const { host, vm } = setup([prog(0, ['begin', ['WAIT_CLICK', 0], ['WAIT_CLICK', 500], ['END']])]);
    vm.run(0, 'begin');
    expect(vm.step(0)).toBe('waiting');
    host.clicks = 1;
    expect(vm.step(10)).toBe('waiting');      // the click released the first wait; the second has no click yet
    expect(vm.step(400)).toBe('waiting');
    expect(vm.step(520)).toBe('ended');
  });
  it('MESSAGE and ASK open a modal and wait for its result; ASK stores the answer in result', () => {
    const { host, vm, c } = setup([prog(0, ['begin', ['MESSAGE', '안녕'], ['ASK', '+계속?'], ['JUMP_IF_RESULT', 1, 'yes'], ['FLAG_SET', 0, 2], ['END'], 'yes', ['FLAG_SET', 0, 1], ['END']])]);
    vm.run(0, 'begin');
    host.modal = null;
    expect(vm.step(0)).toBe('waiting');
    expect(host.calls[0]).toEqual(['openModal', 'message', '안녕']);
    host.modal = 1;
    expect(vm.step(1)).toBe('ended');
    expect(host.calls).toContainEqual(['openModal', 'ask', '+계속?']);
    expect(c.flags[0]).toBe(1);
  });
  it('EPISODE stores the title and shows it when asked; SHOP waits on the modal', () => {
    const { host, vm, c } = setup([prog(0, ['begin', ['EPISODE', '첫_업무', 1], ['SHOP', [1, 5]], ['END']])]);
    vm.run(0, 'begin'); host.modal = null;
    expect(vm.step(0)).toBe('waiting');
    expect(c.episode).toBe('첫 업무');
    expect(host.calls).toContainEqual(['openModal', 'episode', '첫 업무']);
    host.modal = 1;
    expect(vm.step(1)).toBe('ended');
    expect(host.calls).toContainEqual(['openModal', 'shop', [1, 5]]);
  });
});
