import { describe, expect, it } from 'vitest';
import { countOf, emptyInventory } from '../src/battle/inventory';
import { Dialogue, parseTextTags, type ModalContext } from '../src/ui/dialogue';
import { newCampaign } from '../src/game/campaign';
import { encodeSave, saveSummary, type SaveSummary } from '../src/save/format';
import { tables, unit } from './helpers/battleFixtures';
import { FakeElement, fakeDocument } from './helpers/fakeDom';

function setup() {
  const doc = fakeDocument([]);
  const root = new FakeElement('div', 'overlay');
  const dlg = new Dialogue(doc, root as unknown as HTMLElement, (spk, letter) => (spk === 1 ? `/assets/bmp/face01${letter}.png` : null));
  const ctx: ModalContext = { tables: tables(), inventory: emptyInventory(), party: [unit({ slot: 0, id: 1 })] };
  ctx.inventory.gold = 100;
  return { doc, root, dlg, ctx };
}
const el = (x: unknown) => x as FakeElement;

describe('parseTextTags', () => {
  it('splits [Snn] size and [Cnn] color tags into runs that carry the current size and color', () => {
    expect(parseTextTags('[S32]변태 각오해!![S16]」')).toEqual([{ text: '변태 각오해!!', size: 32, color: null }, { text: '」', size: 16, color: null }]);
    expect(parseTextTags('[C3]빨강 글')).toEqual([{ text: '빨강 글', size: null, color: 3 }]);
    expect(parseTextTags('그냥 글')).toEqual([{ text: '그냥 글', size: null, color: null }]);
    expect(parseTextTags('')).toEqual([]);
  });
});

describe('Dialogue', () => {
  it('opens a window with the speaker face, shows the name once and one node per text line; closing hides it', () => {
    const { root, dlg } = setup();
    dlg.openWindow('bottom', 1, 'b');
    dlg.text('bottom', '아프다', '카린');
    dlg.text('bottom', '[S32]정말!', null);
    const win = el(dlg.windows.bottom);
    expect(win.hidden).toBe(false);
    expect(root.find('카린')).not.toBeNull();
    expect(root.find('아프다')).not.toBeNull();
    expect(root.find('정말!')!.style['fontSize']).toBe('2em');
    expect(el(dlg.face('bottom')).src).toBe('/assets/bmp/face01b.png');
    expect(el(dlg.lines('bottom')).children.length).toBe(2);
    dlg.openWindow('bottom', 2, 'a');                                          // re-opening clears the lines (no face for an unknown speaker)
    expect(el(dlg.lines('bottom')).children.length).toBe(0);
    expect(el(dlg.face('bottom')).hidden).toBe(true);
    dlg.closeWindow('bottom');
    expect(win.hidden).toBe(true);
  });
  it('counts overlay clicks one by one: two clicks release two waits, not three', () => {
    const { root, dlg } = setup();
    expect(dlg.takeClick()).toBe(false);
    root.click(); root.click();
    expect(dlg.takeClick()).toBe(true);
    expect(dlg.takeClick()).toBe(true);
    expect(dlg.takeClick()).toBe(false);
  });
  it('ask modal: 예 → 1, 아니오 → 0; the result is read once', () => {
    const { root, dlg, ctx } = setup();
    dlg.openModal('ask', '사겠는가?', ctx);
    expect(dlg.takeModalResult()).toBeNull();
    root.find('예')!.click();
    expect(dlg.takeModalResult()).toBe(1);
    expect(dlg.takeModalResult()).toBeNull();
    expect(el(dlg.modal).hidden).toBe(true);
    dlg.openModal('ask', '또?', ctx);
    root.find('아니오')!.click();
    expect(dlg.takeModalResult()).toBe(0);
  });
  it('message closes with 0, a cancelled save answers −1, result lists gold and level-ups', () => {
    const { root, dlg, ctx } = setup();
    dlg.openModal('message', '잘 있거라', ctx);
    root.find('닫기')!.click();
    expect(dlg.takeModalResult()).toBe(0);
    dlg.openModal('save', -1, ctx);                                            // no slot list given: all 32 empty
    root.find('취소')!.click();
    expect(dlg.takeModalResult()).toBe(-1);
    dlg.openModal('result', { gold: 120, param: 0, levelUps: [{ slot: 0, from: 2, to: 3 }] }, ctx);
    expect(root.find('120 Gold')).not.toBeNull();
    root.find('닫기')!.click();
    expect(dlg.takeModalResult()).toBe(0);
  });
  it('shop modal lists items with price and owned count; 구매 buys through shop.buy; 유니트 일람 opens the party and comes back; 돌아오기 → 1', () => {
    const { root, dlg, ctx } = setup();
    ctx.tables.item[1]!.price = 30; ctx.tables.item[7]!.price = 10;
    dlg.openModal('shop', [1, 7], ctx);
    expect(root.find('sword')).not.toBeNull();
    expect(root.find('10 Gold')).not.toBeNull();
    root.find('구매 herb')!.click();                                             // a consumable goes to the shared inventory
    expect(countOf(ctx.inventory, 7)).toBe(1);
    expect(root.find('보유 1')).not.toBeNull();
    root.find('구매 sword')!.click();                                            // equipment goes to the selected party unit's bag
    expect(ctx.party[0]!.bag).toContain(1);
    expect(ctx.inventory.gold).toBe(60);
    expect(root.find('샀다.')).not.toBeNull();
    for (let i = 0; i < 7; i++) root.find('구매 herb')!.click();                 // 60 Gold buys six more; the seventh fails
    expect(root.find('골드가 부족하다.')).not.toBeNull();
    expect(dlg.takeModalResult()).toBeNull();
    root.find('유니트 일람')!.click();                                            // dialog 150's third button: the party list
    expect(root.find('파티')).not.toBeNull();
    root.find('닫기')!.click();                                                  // back to the shop, not out of it
    expect(root.find('상점')).not.toBeNull();
    expect(dlg.takeModalResult()).toBeNull();
    root.find('돌아오기')!.click();
    expect(dlg.takeModalResult()).toBe(1);
  });
  it('party menu lists each member with equipment and bag; 장착 and 해제 move items between them', () => {
    const { root, dlg, ctx } = setup();
    const u = ctx.party[0]!; u.weapon = 1; u.armor = 0; u.acc = [0, 0]; u.bag = [3, 0, 0, 0];   // sword equipped, pike in the bag
    dlg.openParty(ctx);
    expect(el(dlg.modal).hidden).toBe(false);
    expect(root.find('무기: sword')).not.toBeNull();
    root.find('장착 pike')!.click();
    expect(u.weapon).toBe(3);
    expect(u.bag[0]).toBe(1);
    root.find('해제 무기')!.click();
    expect(u.weapon).toBe(0);
    expect(u.bag).toContain(3);
    root.find('닫기')!.click();
    expect(el(dlg.modal).hidden).toBe(true);
  });
  const slotList = (): (SaveSummary | null)[] => {
    const list = new Array<SaveSummary | null>(32).fill(null);
    const c = newCampaign(); c.episode = '첫업무'; c.stage = 1; c.inventory.gold = 350;
    list[2] = saveSummary(encodeSave(c, new Date(2026, 9, 16, 9, 30)));
    return list;
  };
  it('save slot modal: an empty slot answers its number; a used slot asks to overwrite first; 취소 → −1', () => {
    const { root, dlg, ctx } = setup();
    ctx.saves = slotList();
    dlg.openModal('save', -1, ctx);
    expect(root.find('02 첫업무')).not.toBeNull();
    expect(root.find('350 Gold')).not.toBeNull();
    root.find('00 비어 있음')!.click();
    expect(dlg.takeModalResult()).toBe(0);
    dlg.openModal('save', -1, ctx);
    root.find('02 첫업무')!.click();
    expect(dlg.takeModalResult()).toBeNull();                                  // not yet: confirm overwrite
    root.find('덮어쓰기')!.click();
    expect(dlg.takeModalResult()).toBe(2);
    dlg.openModal('save', -1, ctx);
    root.find('취소')!.click();
    expect(dlg.takeModalResult()).toBe(-1);
  });
  it('load modal: only used slots can be picked, each has 내보내기, and a file can be imported', () => {
    const { root, dlg } = setup();
    const picked: number[] = [], exported: number[] = [];
    dlg.openLoad(slotList(), { onPick: (s) => picked.push(s), onExport: (s) => exported.push(s), onImport: () => {} });
    expect(el(root.find('00 비어 있음')!).disabled).toBe(true);
    root.find('02 첫업무')!.click();
    expect(picked).toEqual([2]);
    root.find('내보내기')!.click();
    expect(exported).toEqual([2]);
    expect(root.find('가져오기')).not.toBeNull();
    root.find('닫기')!.click();
    expect(el(dlg.modal).hidden).toBe(true);
  });
  it('the party menu offers 저장, which opens the slot picker through the page callback; the load modal can delete a slot', () => {
    const { root, dlg, ctx } = setup();
    let saved = 0;
    dlg.openParty(ctx, { onSave: () => { saved++; } });
    root.find('저장')!.click();
    expect(saved).toBe(1);
    const picked: number[] = [], deleted: number[] = [];
    dlg.openSaveSlots(slotList(), (s) => picked.push(s));
    root.find('00 비어 있음')!.click();
    expect(picked).toEqual([0]);
    dlg.openLoad(slotList(), { onPick: () => {}, onExport: () => {}, onImport: () => {}, onDelete: (s) => deleted.push(s) });
    root.find('삭제')!.click();
    expect(deleted).toEqual([2]);
  });
  it('closeAll hides windows, modal and episode title', () => {
    const { dlg, ctx } = setup();
    dlg.openWindow('top', 1, null); dlg.openModal('message', 'x', ctx); dlg.showEpisode('제1화');
    expect(el(dlg.episode).hidden).toBe(false);
    dlg.closeAll();
    expect(el(dlg.windows.top).hidden).toBe(true);
    expect(el(dlg.modal).hidden).toBe(true);
    expect(el(dlg.episode).hidden).toBe(true);
    expect(dlg.takeModalResult()).toBeNull();
  });
});
