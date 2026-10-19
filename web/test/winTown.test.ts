import { describe, expect, it } from 'vitest';
import { menuAction } from '../src/ui/win/commands';
import { townPopupItems } from '../src/ui/win/popup';

describe('the town right-click popup (FUN_0042b620: "이동하다(&M)" ▸ the open facilities, over the 시스템 popup)', () => {
  it('lists only the facilities the town flags open, in table order, each sending its index', () => {
    const items = townPopupItems([{ name: '거리 밖으로' }, { name: '여관' }, { name: '길드' }], [1, 0, 1]);
    expect(items[0]).toMatchObject({ label: '이동하다(M)', key: 'm', enabled: true });
    expect(items[0]!.items!.map((i) => [i.label, i.id])).toEqual([['거리 밖으로', 7000], ['길드', 7002]]);
    expect(items[1]).toMatchObject({ separator: true });
  });
  it('with no open facility the entry is greyed', () => {
    expect(townPopupItems([{ name: '여관' }], [0])[0]!.enabled).toBe(false);
  });
});
describe('menu command ids → actions (menu 103 and the code-made popups)', () => {
  it('maps the resource ids', () => {
    expect(menuAction(40009)).toBe('endTurn'); expect(menuAction(40010)).toBe('unitList'); expect(menuAction(40003)).toBe('fullscreen');
    expect(menuAction(40032)).toBe('objective'); expect(menuAction(40028)).toBe('load'); expect(menuAction(40029)).toBe('save');
    expect(menuAction(40012)).toBe('settings'); expect(menuAction(40004)).toBe('quit'); expect(menuAction(40030)).toBe('fullMap');
    expect(menuAction(40035)).toBe('showPlaces'); expect(menuAction(107)).toBe('bgm');
    expect(menuAction(7003)).toEqual({ facility: 3 });
    expect(menuAction(1)).toBeNull();
  });
});
