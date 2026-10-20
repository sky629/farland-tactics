import { describe, expect, it } from 'vitest';
import { emptyInventory, giveItem } from '../src/battle/inventory';
import type { Unit } from '../src/battle/unit';
import { faceName } from '../src/ui/names';
import { abilityRows, equipPopupItems, equipRows, spellRows, toolRows } from '../src/ui/win/screens/unitList';
import { tables, unit } from './helpers/battleFixtures';

const t = tables();
const karin = (over: Partial<Unit> = {}) => unit({ slot: 0, id: 1, race: 0, level: 15, hp: 40, hpMax: 64, mp: 3, mpMax: 30, exp: 23, weapon: 1, armor: 5, acc: [0, 0], bag: [3, 0, 0, 0], elem: [1, 0, 0], spells: [1, 0], ...over });

describe('유니트 일람 107 — 능력 tab 117', () => {
  it('fills the original control ids: name, race, level, the seven totals, the elements and the EXP', () => {
    const rows = Object.fromEntries(abilityRows(karin(), t).map((r) => [r.id, r.text]));
    expect(rows[1008]).toBe('카린');
    expect(rows[1010]).toBe('test');                                            // the race name
    expect(rows[1033]).toBe('15');
    expect(rows[1014]).toBe('40/64'); expect(rows[1015]).toBe('3/30');
    expect(rows[1016]).toBe(String(karin().str + t.item[1]!.atk));             // 공격력 = STR + weapon ATK (totals)
    expect(rows[1017]).toBe(String(karin().def + t.item[5]!.def));
    expect([rows[1029], rows[1030], rows[1031]]).toEqual(['1', '0', '0']);
    expect(rows[1032]).toBe('23');
  });
});
describe('장비 tab 119 and its popup', () => {
  it('names the worn pieces (무기 1035 · 방패 1037 · 장비1 1034 · 장비2 1032) and lists the bag (소지물 1036)', () => {
    const e = equipRows(karin(), t);
    expect(e[1035]).toBe('sword'); expect(e[1037]).toBe('armor'); expect(e[1034]).toBe('-'); expect(e[1032]).toBe('-');
    expect(e[1036]).toEqual(['pike', '-', '-', '-']);
  });
  it('the popup on a bag piece: 장비하다(E) when it fits, %d에 판다(S) at half price; on a worn piece: 벗는다(R)', () => {
    const bag = equipPopupItems(karin(), { bag: 0 }, t);
    expect(bag.map((i) => [i.label, i.key, i.enabled])).toEqual([['장비하다(E)', 'e', true], [`${Math.floor(t.item[3]!.price / 2)}에 판다(S)`, 's', true]]);
    const worn = equipPopupItems(karin(), { worn: 'weapon' }, t);
    expect(worn.map((i) => [i.label, i.key])).toEqual([['벗는다(R)', 'r']]);
    expect(equipPopupItems(karin({ bag: [0, 0, 0, 0] }), { bag: 0 }, t)).toEqual([]);   // an empty slot has no popup
  });
});
describe('마법 tab and 도구 tab (dialog 121 with the list headers "명칭 … 마력" / "명칭 … 갯수")', () => {
  it('spells list name and MP; tools list the shared consumables with counts', () => {
    expect(spellRows(karin(), t)).toEqual([{ text: `${t.magic[1]!.name}\t${Math.abs(t.magic[1]!.mp_cost)}`, magic: 1 }]);
    const inv = emptyInventory(); giveItem(inv, null, 7, 3, t.item);
    expect(toolRows(inv, t)).toEqual([{ text: `${t.item[7]!.name}\t3`, id: 7, count: 3 }]);
  });
});
describe('portraits (117 owner-draw 1011, 162 buttons 1121..)', () => {
  it('a party member shows face%02da of its speaker id (1..7); other units have none', () => {
    expect(faceName(karin())).toBe('face01a');
    expect(faceName(unit({ slot: 12, id: 40, race: 3 }))).toBeNull();
  });
});
