/**
 * Dialog 107 "유니트 일람" (F2, menu 40010): the party in listbox 1002, tab control 1022 with the original's tabs (strings 0x491d4..:
 * 능력 · 장비 · 마법 · 도구) laid out from their own templates — 117 (ability: portrait, name 1008, race 1010, level 1033, totals
 * 1014-1020, elements 1029-1031, EXP 1032), 119 (equipment: 무기 1035, 소지물 1036, 방패 1037, 장비1 1034, 장비2 1032), 121 (a header
 * list 1043 "명칭 … 마력" / "명칭 … 갯수" over list 1040) for 마법 and 도구 — and 118 (매각) in a shop. 이동(1004), live in a battle
 * and also a double-click on a row (dialog proc 0x422480), scrolls the view to the unit (FUN_0042dc70) and closes; 닫기(1005) closes.
 * The 능력 tab's owner-draw 1011 shows the unit's face bitmap (names.ts faceName). Right-clicking a piece in 장비 opens the equipment popup (strings
 * 0x44ad54..: 장비하다(&E) · 벗는다(&R) · %d에 판다(&S)); right-clicking a stack in 도구 opens the "팔기" popup and dialog 153.
 * Mapping of the five equipment lists to the engine's weapon · armor · acc[0] · acc[1] · bag is [추정] (the original screen is not recovered).
 */
import { canEquip, equip, unequip, type EquipSlot } from '../../../battle/equipment';
import { usableItems, type Inventory } from '../../../battle/inventory';
import { totals } from '../../../battle/resolve';
import { sell, sellStack } from '../../../battle/shop';
import { itemsOf, type Unit } from '../../../battle/unit';
import type { Tables } from '../../../data/types';
import { unitName } from '../../names';
import { DialogBox, type DialogHost } from '../dialog';
import { mnemonicItem, type MenuItem } from '../menubar';
import { PopupMenu, type PopupItem } from '../popup';

const dash = (name: string | undefined) => (name ? name.replace(/_/g, ' ') : '-');

export function abilityRows(u: Unit, tables: Tables): { id: number; text: string }[] {
  const tt = totals(u, itemsOf(u, tables.item));
  return [
    { id: 1008, text: unitName(u, tables) }, { id: 1010, text: tables.race[u.race]?.name.replace(/_/g, ' ') ?? `종족 ${u.race}` }, { id: 1033, text: String(u.level) },
    { id: 1014, text: `${u.hp}/${u.hpMax}` }, { id: 1015, text: `${u.mp}/${u.mpMax}` }, { id: 1016, text: String(tt.atk) }, { id: 1017, text: String(tt.def) },
    { id: 1018, text: String(tt.wis) }, { id: 1019, text: String(tt.mgr) }, { id: 1020, text: String(tt.agi) },
    { id: 1029, text: String(u.elem[0]) }, { id: 1030, text: String(u.elem[1]) }, { id: 1031, text: String(u.elem[2]) }, { id: 1032, text: String(u.exp) },
  ];
}

export function equipRows(u: Unit, tables: Tables): { 1035: string; 1037: string; 1034: string; 1032: string; 1036: string[] } {
  const n = (id: number) => (id === 0 ? '-' : dash(tables.item[id]?.name));
  return { 1035: n(u.weapon), 1037: n(u.armor), 1034: n(u.acc[0]), 1032: n(u.acc[1]), 1036: u.bag.map(n) };
}

export type EquipTarget = { bag: number } | { worn: EquipSlot };
export interface EquipPopupItem extends MenuItem { act: 'equip' | 'unequip' | 'sell' }

export function equipPopupItems(u: Unit, at: EquipTarget, tables: Tables): EquipPopupItem[] {
  if ('bag' in at) {
    const id = u.bag[at.bag] ?? 0, item = tables.item[id];
    if (id === 0 || !item) return [];
    return [
      { ...mnemonicItem('장비하다(&E)'), enabled: canEquip(u, id, tables.item), act: 'equip' },
      { ...mnemonicItem(`${Math.floor(item.price / 2)}에 판다(&S)`), act: 'sell' },
    ];
  }
  const worn = at.worn === 'weapon' ? u.weapon : at.worn === 'armor' ? u.armor : u.acc[at.worn];
  return worn === 0 ? [] : [{ ...mnemonicItem('벗는다(&R)'), enabled: u.bag.includes(0), act: 'unequip' }];
}

export const spellRows = (u: Unit, tables: Tables): { text: string; magic: number }[] =>
  u.spells.filter((m) => m !== 0 && tables.magic[m]).map((m) => ({ text: `${tables.magic[m]!.name.replace(/_/g, ' ')}\t${Math.abs(tables.magic[m]!.mp_cost)}`, magic: m }));

export const toolRows = (inv: Inventory, tables: Tables): { text: string; id: number; count: number }[] =>
  usableItems(inv, tables.item).map((s) => ({ text: `${tables.item[s.id]!.name.replace(/_/g, ' ')}\t${s.count}`, id: s.id, count: s.count }));

/** Dialog 153: how many of `id` to sell; the edit 1086 holds the count, 1087 the purse, 1088 the sum. */
function sellQuantity(host: DialogHost, inv: Inventory, id: number, tables: Tables): Promise<number> {
  const item = tables.item[id]!, have = inv.items.find((s) => s.id === id)?.count ?? 0, each = Math.floor(item.price / 2);
  const box = new DialogBox<number>(host, 153, { cancel: () => 0 });
  const edit = box.control<HTMLInputElement>(1086); edit.value = '1';
  const refresh = () => { const n = Math.max(0, Math.min(have, Math.trunc(Number(edit.value)) || 0)); box.setText(1087, String(inv.gold)); box.setText(1088, String(each * n)); box.setEnabled(1, n > 0); return n; };
  edit.addEventListener('input', refresh); refresh();
  box.onClick(1, () => box.close(refresh()));
  box.onClick(2, () => box.close(0));
  return box.show();
}

export interface UnitListContext {
  tables: Tables; inventory: Inventory; party: (Unit | null)[];
  sale?: boolean;                                                              // from the shop: the 매각 tab 118
  face?: (u: Unit) => string | null;                                           // the portrait bitmap's URL, if the unit has one
  onMove?: (u: Unit) => void;                                                  // 이동: given in a battle (mode 1), where the original enables the button
}

/** The unit list over the game frame; resolves when closed. `sale` (from the shop) adds the 매각 tab 118. */
export function unitList(host: DialogHost, ctx: UnitListContext): Promise<void> {
  const { tables, inventory: inv } = ctx, party = ctx.party.filter((u): u is Unit => u !== null && u.status !== 9);
  const box = new DialogBox<void>(host, 107, { cancel: () => undefined });
  const popup = new PopupMenu(host.layer);
  let current = party[0] ?? null;
  const move = () => { const u = current; if (u && ctx.onMove) { ctx.onMove(u); box.close(); } };
  box.setEnabled(1004, ctx.onMove !== undefined);
  box.onClick(1004, move);
  box.onClick(1005, () => box.close());
  const tabs = box.setTabs(1022, [
    { label: '능력', template: 117 }, { label: '장비', template: 119 }, { label: '마법', template: 121 }, { label: '도구', template: 121 }, ...(ctx.sale ? [{ label: '매각', template: 118 }] : []),
  ]);
  const render = () => {
    const u = current; if (!u) return;
    const [ability, gear, magic, tool, saleTab] = tabs;
    for (const r of abilityRows(u, tables)) ability!.setText(r.id, r.text);
    const portrait = ability!.control(1011), url = ctx.face?.(u) ?? null; portrait.replaceChildren();
    if (url) { const im = host.layer.ownerDocument.createElement('img'); im.src = url; im.className = 'w95-face'; portrait.appendChild(im); }
    const e = equipRows(u, tables);
    const worn = (id: number, where: EquipSlot) => gear!.setList(id, [{ text: e[id as 1035 | 1037 | 1034 | 1032] }], () => {}, (_i, ev) => { void openEquipPopup(u, { worn: where }, ev); });   // '더블클릭하면 메뉴가 나옵니다.' (static 1026 of the template)
    worn(1035, 'weapon'); worn(1037, 'armor'); worn(1034, 0); worn(1032, 1);
    gear!.setList(1036, e[1036].map((text) => ({ text })), () => {}, (i, ev) => { void openEquipPopup(u, { bag: i }, ev); });
    magic!.setList(1043, [{ text: '명칭\t마력' }], () => {}); magic!.setList(1040, spellRows(u, tables).map((r) => ({ text: r.text })), () => {});
    magic!.setText(1039, '');
    const tools = toolRows(inv, tables);
    tool!.setList(1043, [{ text: '명칭\t갯수' }], () => {}); tool!.setList(1040, tools.map((r) => ({ text: r.text })), () => {}, undefined, (i, ev) => { void openSellPopup(tools[i]!.id, ev); });
    tool!.setText(1039, '');
    if (saleTab) {
      saleTab.setList(1048, [{ text: '명칭\t갯수' }], () => {}); let pick = -1;
      saleTab.setList(1023, tools.map((r) => ({ text: r.text })), (i) => { pick = i; }, (i) => { void sellQuantity(host, inv, tools[i]!.id, tables).then((n) => { if (n > 0) sellStack(inv, tools[i]!.id, n, tables.item); render(); }); });
      saleTab.setText(1085, String(inv.gold));
      saleTab.control(1089).onclick = () => { if (pick >= 0 && tools[pick]) void sellQuantity(host, inv, tools[pick]!.id, tables).then((n) => { if (n > 0) sellStack(inv, tools[pick]!.id, n, tables.item); render(); }); };
    }
  };
  const openEquipPopup = async (u: Unit, at: EquipTarget, ev: MouseEvent) => {
    const items = equipPopupItems(u, at, tables); if (items.length === 0) return;
    const p = host.layer.getBoundingClientRect(), k = p.width / host.layer.clientWidth || 1;
    const pick = await popup.open((ev.clientX - p.left) / k, (ev.clientY - p.top) / k, items.map((i): PopupItem => ({ ...i, id: i.act === 'equip' ? 1 : i.act === 'unequip' ? 2 : 3 })));
    if (!pick) return;
    const act = (pick as EquipPopupItem).act;
    if (act === 'equip' && 'bag' in at) equip(u, at.bag, tables.item);
    else if (act === 'unequip' && 'worn' in at) unequip(u, at.worn);
    else if (act === 'sell' && 'bag' in at) sell(inv, u, at.bag, tables.item);
    render();
  };
  const openSellPopup = async (id: number, ev: MouseEvent) => {                 // menu 103's "도구" popup: 팔기(&S) → dialog 153
    const p = host.layer.getBoundingClientRect(), k = p.width / host.layer.clientWidth || 1;
    const pick = await popup.open((ev.clientX - p.left) / k, (ev.clientY - p.top) / k, [{ ...mnemonicItem('팔기(&S)'), id: 1025 }]);
    if (!pick) return;
    const n = await sellQuantity(host, inv, id, tables);
    if (n > 0) sellStack(inv, id, n, tables.item);
    render();
  };
  box.setList(1002, party.map((u) => ({ text: unitName(u, tables) })), (i) => { current = party[i] ?? null; render(); }, ctx.onMove ? () => move() : undefined);
  box.control(1002).firstElementChild?.classList.add('selected');
  render();
  return box.show();
}
