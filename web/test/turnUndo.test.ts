import { describe, expect, it } from 'vitest';
import { turnUndoButton } from '../src/ui/win/turnUndo';
import { fakeDocument, type FakeElement } from './helpers/fakeDom';

describe('the 턴 되돌리기 button beside the 배속 badge', () => {
  it('asks for an undo on click while enabled; set(false) greys it and swallows the click', () => {
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
});
