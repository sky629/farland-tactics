import { describe, expect, it } from 'vitest';
import { equalizeShare, evenShare } from '../src/game/expShare';

describe('EXP share (BATTLE_RESULT dialog 0xA2, FT2.exe 0x40c166 / 0x40c0e4)', () => {
  it('even split gives floor(pool / n) to everyone and one more to the first units for the remainder', () => {
    expect(evenShare(3, 200)).toEqual([67, 67, 66]);
    expect(evenShare(2, 200)).toEqual([100, 100]);
    expect(evenShare(0, 200)).toEqual([]);
  });
  it('equalizing raises the lowest units to the next one before splitting the rest evenly in EXP order', () => {
    expect(equalizeShare([44, 59], 200)).toEqual([108, 92]);                 // 44 → 59 costs 15, then 185 split 93/92 — the lower unit gets the odd point
    expect(equalizeShare([300, 100, 150], 100)).toEqual([0, 75, 25]);       // 100 → 150 costs 50, then the two low units split 50
    expect(equalizeShare([10], 50)).toEqual([50]);
    expect(equalizeShare([], 50)).toEqual([]);
  });
  it('a pool too small for a full levelling step still goes one point each to the lowest units', () => {
    expect(equalizeShare([0, 100, 100], 2)).toEqual([2, 0, 0]);             // 0 → 100 costs 100 > pool: the pool goes to the lowest
    expect(equalizeShare([0, 0, 100], 3)).toEqual([2, 1, 0]);               // two lowest: floor(3/2) = 1 each, remainder 1 to the first
  });
});
