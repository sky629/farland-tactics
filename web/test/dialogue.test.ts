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
