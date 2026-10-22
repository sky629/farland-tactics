import { describe, expect, it } from 'vitest';
import { emptyInventory, giveItem } from '../src/battle/inventory';
import { buildMenuList } from '../src/ui/win/menubar';
import { pickable, unitPopupItems, type PopupItem } from '../src/ui/win/popup';
import type { Unit } from '../src/battle/unit';
import { tables, unit } from './helpers/battleFixtures';
import { fakeDocument, type FakeElement } from './helpers/fakeDom';

const t = tables();
const karin = (over: Partial<Unit>) => unit({ slot: 0, id: 1, hp: 40, hpMax: 64, mp: 20, mpMax: 30, ...over });

describe('the battle right-click popup (FUN_00430c80: inserted above the 맵 menu)', () => {
  it('names the unit\'s action with its HP, its spells with MP and the item list, then a separator', () => {
    const items = unitPopupItems(karin({ spells: [1, 0], moved: false, acted: false }), emptyInventory(), t);
    expect(items.map((i) => [i.label, i.accel, i.enabled])).toEqual([
      ['카린의 행동', '(HP:40/64)', true],
      ['카린의 마법/특기', '(MP:20/30)', true],
      ['도구를 사용하다(U)', null, false],                                      // nothing usable in the bag
      ['-', null, false],
    ]);
    expect(items[0]!.cmd).toEqual({ type: 'beginMove' });
    expect(items[1]!.items![0]).toMatchObject({ label: `${t.magic[1]!.name}(${t.magic[1]!.short})`, accel: `MP:${Math.abs(t.magic[1]!.mp_cost)}`, enabled: true, cmd: { type: 'beginTarget', action: 1 } });
    expect(items[2]!.key).toBe('u');
    expect(items[3]!.separator).toBe(true);
  });
  it('a greyed entry says why (the row\'s tooltip): no spell learnt, nothing usable, already moved or acted, silenced, helpless', () => {
    const hints = (u: Unit, inv = emptyInventory()) => unitPopupItems(u, inv, t).map((i) => i.hint);
    expect(hints(karin({ spells: [] }))).toEqual([undefined, '배운 마법이 없습니다', '쓸 수 있는 도구가 없습니다', undefined]);
    expect(hints(karin({ spells: [1], acted: true })).slice(1, 3)).toEqual(['이미 행동했습니다', '이미 행동했습니다']);
    expect(hints(karin({ spells: [1], moved: true }))[0]).toBe('이미 이동했습니다');
    expect(hints(karin({ spells: [1], status: 6 }))[1]).toBe('침묵 상태입니다');
    expect(hints(karin({ spells: [1], status: 1 }))[0]).toBe('행동할 수 없는 상태입니다');
    const box = buildMenuList(fakeDocument([]), unitPopupItems(karin({ spells: [] }), emptyInventory(), t), () => {}) as unknown as FakeElement;
    const rows = box.children.filter((c) => c.className.includes('w95-item')) as (FakeElement & { title?: string })[];
    expect(rows.map((r) => r.title)).toEqual([undefined, '배운 마법이 없습니다', '쓸 수 있는 도구가 없습니다']);
  });
  it('greys the action once moved, the spells once acted or silenced or beyond the MP, the items once acted', () => {
    expect(unitPopupItems(karin({ spells: [1], moved: true }), emptyInventory(), t)[0]!.enabled).toBe(false);
    expect(unitPopupItems(karin({ spells: [1], acted: true }), emptyInventory(), t)[1]!.enabled).toBe(false);
    expect(unitPopupItems(karin({ spells: [1], status: 6 }), emptyInventory(), t)[1]!.enabled).toBe(false);
    expect(unitPopupItems(karin({ spells: [1], mp: 0 }), emptyInventory(), t)[1]!.items![0]!.enabled).toBe(false);
    const inv = emptyInventory(); giveItem(inv, null, 7, 3, t.item);           // item 7: the herb of the fixture tables
    const items = unitPopupItems(karin({ acted: true }), inv, t);
    expect(items[2]).toMatchObject({ enabled: false });
    expect(items[2]!.items![0]).toMatchObject({ label: t.item[7]!.name, accel: '  3개', cmd: { type: 'beginTarget', action: 1007 } });   // '%s\t%3d개'
  });
  it('a sleeping or stoned unit (status 3/4/5/8/9/1) can do nothing', () => {
    for (const status of [1, 3, 4, 5, 8, 9]) expect(unitPopupItems(karin({ spells: [1], status }), emptyInventory(), t).slice(0, 3).every((i) => !i.enabled)).toBe(true);
  });
  it('every enabled item with an id can be picked — the 맵 menu items appended to the popup carry no battle command', () => {
    const items: PopupItem[] = [
      { label: '알의 행동', ul: -1, key: null, accel: null, id: 102, enabled: true, separator: false, cmd: { type: 'beginMove' } },
      { label: '표시(D)', ul: -1, key: 'd', accel: null, id: null, enabled: true, separator: false, items: [{ label: '유니트 일람(L)', ul: -1, key: 'l', accel: 'F2', id: 40010, enabled: true, separator: false }] },
      { label: '턴 종료(T)', ul: -1, key: 't', accel: 'F10', id: 40009, enabled: false, separator: false },
    ];
    const p = pickable(items);
    expect([...p.keys()]).toEqual([102, 40010]);                              // the greyed 턴 종료 is not pickable
    expect(p.get(40010)!.label).toBe('유니트 일람(L)');
  });
});
