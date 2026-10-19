import { describe, expect, it } from 'vitest';
import { countOf, emptyInventory } from '../src/battle/inventory';
import { Dialogue, parseTextTags, type ModalContext } from '../src/ui/dialogue';
import { newCampaign } from '../src/game/campaign';
import { BROKEN_SUMMARY, encodeSave, saveSummary, type SaveSummary } from '../src/save/format';
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
  it('message closes with 0; ask and save need the original dialogs attached (dialog 126 / 143 — browser-verified)', () => {
    const { root, dlg, ctx } = setup();
    dlg.openModal('message', '잘 있거라', ctx);
    root.find('닫기')!.click();
    expect(dlg.takeModalResult()).toBe(0);
    expect(() => dlg.openModal('ask', '사겠는가?', ctx)).toThrow(/dialogs not attached/);
    expect(() => dlg.openModal('save', -1, ctx)).toThrow(/dialogs not attached/);
  });
  it('result modal: gold, then the EXP pool shared out — opens on the equalizing split, 균등 splits evenly, ± moves ten points within the pool, 확인 adds the shares to the units → 0', () => {
    const { root, dlg, ctx } = setup();
    ctx.party = [unit({ slot: 0, id: 1, exp: 44 }), unit({ slot: 1, id: 2, exp: 59 })];
    dlg.openModal('result', { gold: 120, pool: 200 }, ctx);
    expect(root.find('120 Gold')).not.toBeNull();
    expect(root.find('경험치 200')).not.toBeNull();
    expect(root.find('+108')).not.toBeNull();                                  // 44 → 59, then 185 split 93/92 (dialog 0xA2's opening split)
    expect(root.find('+92')).not.toBeNull();
    root.find('균등')!.click();
    expect(root.find('+100')).not.toBeNull();
    root.find('+10')!.click();                                                 // the pool is spent: a share cannot grow past it
    expect(root.find('+110')).toBeNull();
    root.find('−10')!.click();                                                 // first unit gives ten back …
    expect(root.find('+90')).not.toBeNull();
    root.find('+10')!.click();                                                 // … and takes them again
    expect(root.find('+90')).toBeNull();
    root.find('확인')!.click();
    expect(ctx.party[0]!.exp).toBe(144);
    expect(ctx.party[1]!.exp).toBe(159);
    expect(dlg.takeModalResult()).toBe(0);
  });
  it('shop modal lists items with price and owned count; 구매 buys through shop.buy; 돌아오기 → 1', () => {
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
    expect(root.find('유니트 일람')).not.toBeNull();                              // dialog 150's third button opens the unit list (dialog 107, browser-verified)
    root.find('돌아오기')!.click();
    expect(dlg.takeModalResult()).toBe(1);
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
