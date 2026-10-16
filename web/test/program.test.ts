import { describe, expect, it } from 'vitest';
import { face, findLabel, list, loadProgram, num, ScriptError, str } from '../src/script/program';

const raw = {
  symbols: { begin: 10, Next: 20 },
  code: [
    { at: 10, op: 'FLAG_SET', args: [2, 0] },
    { at: 14, op: 'MSG_TOP', args: [[15, 'a']] },
    { at: 18, op: 'SHOP', args: [[1, 5]] },
    { at: 20, op: 'END', args: [] },
  ],
};

describe('program', () => {
  it('loads a decoded event file, indexes offsets and finds labels case-insensitively', () => {
    const p = loadProgram(3, raw);
    expect(p.stage).toBe(3);
    expect(findLabel(p, 'BEGIN')).toBe(0);
    expect(findLabel(p, 'next')).toBe(3);
    expect(findLabel(p, 'nowhere')).toBeNull();
    expect(p.byOffset.get(18)).toBe(2);
  });
  it('rejects a malformed file with a ScriptError naming the problem', () => {
    expect(() => loadProgram(3, { symbols: {}, code: [{ at: 1, op: 5, args: [] }] })).toThrow(ScriptError);
    expect(() => loadProgram(3, null)).toThrow(/event03/);
    expect(() => loadProgram(3, { symbols: { x: 99 }, code: [] })).toThrow(/label x/);
  });
  it('argument helpers return null for a missing argument instead of throwing', () => {
    const p = loadProgram(0, raw);
    expect(num(p.code[0]!.args[0])).toBe(2);
    expect(num(p.code[0]!.args[5])).toBeNull();
    expect(face(p.code[1]!.args[0])).toEqual([15, 'a']);
    expect(list(p.code[2]!.args[0])).toEqual([1, 5]);
    expect(str('abc')).toBe('abc');
    expect(str(3)).toBeNull();
  });
});
