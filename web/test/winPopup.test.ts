import { describe, expect, it } from 'vitest';
import { emptyInventory, giveItem } from '../src/battle/inventory';
import { unitPopupItems } from '../src/ui/win/popup';
import type { Unit } from '../src/battle/unit';
import { tables, unit } from './helpers/battleFixtures';

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
});
