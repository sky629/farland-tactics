import { describe, expect, it } from 'vitest';
import { expShareModel } from '../src/ui/win/screens/expShare';

describe('EXP share dialog 162 (경험치 배분: bars 1104.., labels 1114.. "exp(+share)", 1110 the pool left, 1109 밸런스 배분, 1108 균등배분, 1 결정)', () => {
  it('opens on the equalizing split and labels each unit "exp(+share)"', () => {
    const m = expShareModel([{ exp: 100 }, { exp: 300 }], 400);
    expect(m.shares).toEqual([300, 100]);
    expect(m.label(0)).toBe('100(+300)');
    expect(m.left()).toBe(0);
  });
  it('a bar cannot take more than the others leave; 균등 splits evenly; 밸런스 goes back to the equalizing split', () => {
    const m = expShareModel([{ exp: 100 }, { exp: 300 }], 400);
    m.set(1, 0); m.set(0, 1000);
    expect(m.shares).toEqual([400, 0]);
    m.even(); expect(m.shares).toEqual([200, 200]);
    m.balance(); expect(m.shares).toEqual([300, 100]);
    expect(m.text()).toBe('경험치  0');
  });
});
