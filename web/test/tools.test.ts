import { describe, expect, it } from 'vitest';
import { goldButton, turnUndoButton } from '../src/ui/win/tools';
import { fakeDocument, type FakeElement } from './helpers/fakeDom';

describe('the web\'s tool buttons at the right of the menu bar', () => {
  it('턴 되돌리기 asks for an undo on click while enabled; set(false) greys it and swallows the click', () => {
    let undos = 0;
    const b = turnUndoButton(fakeDocument([]), () => { undos++; });
    const el = b.el as unknown as FakeElement;
    expect(el.textContent).toBe('턴 되돌리기');
    b.set(true); el.click();
    expect(undos).toBe(1);
    b.set(false);
    expect(el.disabled).toBe(true);
    el.click();
    expect(undos).toBe(1);
  });
  it('돈 추가 shows the purse with thousands separators and asks for the gold on click', () => {
    let adds = 0;
    const b = goldButton(fakeDocument([]), () => { adds++; });
    const el = b.el as unknown as FakeElement;
    b.set(true, 200);
    expect(el.textContent).toBe('돈 추가 · 200G');
    el.click();
    expect(adds).toBe(1);
    b.set(true, 1200);
    expect(el.textContent).toBe('돈 추가 · 1,200G');
    b.set(false, 999999);
    expect(el.disabled).toBe(true);
    expect(el.textContent).toBe('돈 추가 · 999,999G');
  });
});
