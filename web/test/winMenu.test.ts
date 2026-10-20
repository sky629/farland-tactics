import { describe, expect, it } from 'vitest';
import { accelOf, menuModel, type MenuTemplate } from '../src/ui/win/menubar';
import menu103 from './helpers/menu103.json';

const menu = menu103 as MenuTemplate;

describe('menu bar model from menu 103', () => {
  it('the bar is the 맵 popup; the other top-level popups are code-made popups, 디버그 only in dev', () => {
    const m = menuModel(menu, {}, false);
    expect(m.bar.map((p) => p.label)).toEqual(['맵']);
    expect(m.bar[0]!.items.map((i) => i.label)).toEqual(['표시(D)', '턴 종료(T)', '-', '시스템(S)']);
    expect(m.bar[0]!.items[0]!.items!.map((i) => [i.label, i.accel])).toEqual([['유니트 일람(L)', 'F2'], ['전체 맵(V)', 'F3'], ['전체 화면 ON/OFF(F)', 'F4'], ['클리어 조건(C)', null]]);
    expect(Object.keys(m.popups)).toEqual(['도구', '팔기', '마법1', '마법2', '시스템']);
    expect(Object.keys(menuModel(menu, {}, true).popups)).toContain('디버그');
  });
  it('accelerators follow the resource strings', () => {
    const m = menuModel(menu, {}, true);
    expect(accelOf(m, 'F10', false)).toBe(40009);
    expect(accelOf(m, 'F2', false)).toBe(40010);
    expect(accelOf(m, 'z', true)).toBe(40026);
    expect(accelOf(m, 'F6', false)).toBeNull();
    expect(accelOf(menuModel(menu, {}, false), 'z', true)).toBeNull();     // a dev-only accelerator is off outside dev
    expect(accelOf(menuModel(menu, { 40009: false }, true), 'F10', false)).toBeNull();   // a greyed item's accelerator does nothing, as in Win32
  });
  it('enabled flags land on the items; a separator is never enabled', () => {
    const m = menuModel(menu, { 40009: false }, false);
    expect(m.bar[0]!.items[1]).toMatchObject({ id: 40009, enabled: false, accel: 'F10', key: 't' });
    expect(m.bar[0]!.items[2]).toMatchObject({ separator: true, enabled: false });
    expect(m.bar[0]!.items[3]!.items![0]).toMatchObject({ id: 40028, enabled: true });
  });
});
describe('check marks (CheckMenuItem in the original)', () => {
  it('전체 맵 carries a check while its window is open; the others stay plain', () => {
    const m = menuModel(menu, {}, false, { 40030: true });
    const show = m.bar[0]!.items[0]!.items!;
    expect(show.find((i) => i.id === 40030)!.checked).toBe(true);
    expect(show.find((i) => i.id === 40010)!.checked).toBe(false);
  });
});
