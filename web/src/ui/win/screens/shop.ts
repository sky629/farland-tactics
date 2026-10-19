/**
 * The shop (SHOP script command): dialog 150 "물품목록" — header list 1081, goods list 1082 "name  price  owned" (double click or
 * 사기 8001 buys), purse 1080, hint 1077 "사고싶은 물건을 더블클릭해 주십시오.", 유니트 일람 1079, 돌아오기 1078; dialog 151 "몇개 삽니까?"
 * — count edit 1073, purse 1076, sum 1077, 산다!(1) / 절약하자(2); dialog 152 "누가 사나?" — the party members with a free bag slot in
 * list 1099, the chosen one's bag in static 1100 "현재 소지품", 산다!(1) / 절약하자(2). Consumables go to the shared stacks, equipment
 * to a member's bag (shop.buy).
 */
import { countOf, isEquipment, type Inventory } from '../../../battle/inventory';
import { buy, type BuyResult } from '../../../battle/shop';
import type { Unit } from '../../../battle/unit';
import type { ItemData, Tables } from '../../../data/types';
import { unitName } from '../../panel';
import { DialogBox, type DialogHost } from '../dialog';
import { unitList } from './unitList';

export const BUY_TEXT: Record<BuyResult, string> = { ok: '', 'no gold': '골드가 부족하다.', full: '소유품이 꽉차서 가질수 없다', 'unknown item': '그런 물건은 없다.' };

export const shopRows = (ids: number[], inv: Inventory, tables: Tables): { id: number; text: string }[] =>
  ids.filter((id) => tables.item[id]).map((id) => ({ id, text: `${tables.item[id]!.name.replace(/_/g, ' ')}\t${tables.item[id]!.price}\t${countOf(inv, id)}` }));

export const buyTotal = (item: ItemData, count: number, gold: number): { total: number; ok: boolean } => ({ total: item.price * count, ok: count > 0 && item.price * count <= gold });

export const whoCanTake = (party: (Unit | null)[]): Unit[] => party.filter((u): u is Unit => u !== null && u.status !== 9 && u.bag.includes(0));

/** Dialog 151: how many; resolves 0 when declined. */
function howMany(host: DialogHost, item: ItemData, inv: Inventory, max: number): Promise<number> {
  const box = new DialogBox<number>(host, 151, { cancel: () => 0 });
  const edit = box.control<HTMLInputElement>(1073); edit.value = '1';
  box.setText(1098, item.name.replace(/_/g, ' '));
  const refresh = () => { const n = Math.max(0, Math.min(max, Math.trunc(Number(edit.value)) || 0)); const t = buyTotal(item, n, inv.gold); box.setText(1076, String(inv.gold)); box.setText(1077, String(t.total)); box.setEnabled(1, t.ok); return t.ok ? n : 0; };
  edit.addEventListener('input', refresh); refresh();
  box.onClick(1, () => box.close(refresh()));
  box.onClick(2, () => box.close(0));
  return box.show();
}

/** Dialog 152: who takes the piece; resolves null when declined. */
function whoTakes(host: DialogHost, party: (Unit | null)[], tables: Tables): Promise<Unit | null> {
  const box = new DialogBox<Unit | null>(host, 152, { cancel: () => null });
  const able = whoCanTake(party);
  let pick = able[0] ?? null;
  const bagText = (u: Unit | null) => (u ? u.bag.map((id) => (id ? tables.item[id]!.name.replace(/_/g, ' ') : '-')).join('\n') : '');
  box.setList(1099, able.map((u) => ({ text: unitName(u, tables) })), (i) => { pick = able[i] ?? null; box.setText(1100, bagText(pick)); }, () => box.close(pick));
  box.control(1099).firstElementChild?.classList.add('selected');
  box.setText(1100, bagText(pick));
  box.setEnabled(1, pick !== null);
  box.onClick(1, () => box.close(pick));
  box.onClick(2, () => box.close(null));
  return box.show();
}

export interface ShopContext { tables: Tables; inventory: Inventory; party: (Unit | null)[] }

/** Dialog 150; resolves when the player leaves (돌아오기). */
export function shopDialog(host: DialogHost, ids: number[], ctx: ShopContext): Promise<void> {
  const { tables, inventory: inv } = ctx;
  const box = new DialogBox<void>(host, 150, { cancel: () => undefined });
  let pick: number | null = null;
  const refresh = () => {
    box.setList(1081, [{ text: '명칭\t가격\t갯수' }], () => {});
    box.setList(1082, shopRows(ids, inv, tables).map((r) => ({ text: r.text })), (i) => { pick = ids[i] ?? null; }, (i) => { void purchase(ids[i]!); });
    box.setText(1080, String(inv.gold));
  };
  const purchase = async (id: number) => {
    const item = tables.item[id]; if (!item) return;
    const n = await howMany(host, item, inv, isEquipment(item) ? 1 : 99);
    if (n === 0) return;
    let result: BuyResult = 'ok';
    if (isEquipment(item)) { const who = await whoTakes(host, ctx.party, tables); if (!who) return; result = buy(inv, who, id, tables.item); }
    else for (let k = 0; k < n && result === 'ok'; k++) result = buy(inv, null, id, tables.item);
    box.setText(1077, result === 'ok' ? '사고싶은 물건을 더블클릭해 주십시오.' : BUY_TEXT[result]);
    refresh();
  };
  box.onClick(8001, () => { if (pick !== null) void purchase(pick); });
  box.onClick(1079, () => { void unitList(host, { ...ctx, sale: true }).then(refresh); });
  box.onClick(1078, () => box.close());
  refresh();
  return box.show();
}
