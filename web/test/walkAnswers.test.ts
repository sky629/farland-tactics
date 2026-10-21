import { describe, expect, it } from 'vitest';
import { applyAnswer, type AnswerBox } from '../src/dev/walkAnswers';

/** A box that records which control was pressed and what the bars were set to. */
function box(ids: number[], bars = 0): AnswerBox & { pressed: number[]; barValues: number[] } {
  const b = { pressed: [] as number[], barValues: Array<number>(bars).fill(-1), template: '162',
    control: (id: number) => ids.includes(id) ? { click: () => { b.pressed.push(id); } } : null,
    bars: () => b.barValues.map((_, i) => ({ set: (v: number) => { b.barValues[i] = v; } })) };
  return b;
}

describe('applyAnswer: the walker\'s answer through the real controls (spec §5.3)', () => {
  it('ask: yes presses 6, no presses 7', () => {
    const yes = box([6, 7]); expect(applyAnswer({ kind: 'ask', value: 1 }, yes, null)).toBe(true); expect(yes.pressed).toEqual([6]);
    const no = box([6, 7]); expect(applyAnswer({ kind: 'ask', value: 0 }, no, null)).toBe(true); expect(no.pressed).toEqual([7]);
  });
  it('save presses 2 (취소), shop presses 1078 (돌아오기)', () => {
    const s = box([1, 2]); expect(applyAnswer({ kind: 'save', value: -1 }, s, null)).toBe(true); expect(s.pressed).toEqual([2]);
    const sh = box([1078]); expect(applyAnswer({ kind: 'shop', value: 0 }, sh, null)).toBe(true); expect(sh.pressed).toEqual([1078]);
  });
  it('result sets every bar to 0, then presses 결정 (1): the pool is already on the unit the walker chose', () => {
    const r = box([1, 1108, 1109], 3);
    expect(applyAnswer({ kind: 'result', value: 0 }, r, null)).toBe(true);
    expect(r.barValues).toEqual([0, 0, 0]);
    expect(r.pressed).toEqual([1]);
  });
  it('message clicks the message box\'s button; a missing box or button answers nothing', () => {
    let clicked = 0;
    expect(applyAnswer({ kind: 'message', value: 0 }, null, { click: () => { clicked++; } })).toBe(true); expect(clicked).toBe(1);
    expect(applyAnswer({ kind: 'message', value: 0 }, null, null)).toBe(false);
    expect(applyAnswer({ kind: 'ask', value: 1 }, null, null)).toBe(false);
    expect(applyAnswer({ kind: 'ask', value: 1 }, box([2]), null)).toBe(false);
  });
});
