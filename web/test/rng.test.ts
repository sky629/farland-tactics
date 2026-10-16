import { describe, expect, it } from 'vitest';
import { Rng } from '../src/battle/rng';

describe('Rng (FUN_004337a0 Wichmann–Hill 3-LCG)', () => {
  it('seed 12345 → state (12346, 1, 1) and the first ten rand(100) values', () => {
    const r = Rng.fromSeed(12345);
    expect(r.state).toEqual([12346, 1, 1]);
    expect(Array.from({ length: 10 }, () => r.rand(100))).toEqual([47, 76, 5, 1, 90, 51, 59, 48, 48, 20]);
  });
  it('rand(0) returns the raw sum of the three states', () => {
    const r = Rng.fromSeed(12345);
    expect(Array.from({ length: 5 }, () => r.rand(0))).toEqual([22947, 79776, 36505, 57701, 34890]);
  });
  it('seed 1: rand(3) × 8 and the end state', () => {
    const r = Rng.fromSeed(1);
    expect(Array.from({ length: 8 }, () => r.rand(3))).toEqual([0, 0, 1, 1, 0, 1, 2, 0]);
    expect(r.state).toEqual([11389, 29080, 21289]);
  });
  it('clone continues independently', () => {
    const a = Rng.fromSeed(7); a.rand(10);
    const b = a.clone();
    expect(b.rand(1000)).toBe(a.rand(1000));
  });
});
