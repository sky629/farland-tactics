import { describe, expect, it } from 'vitest';
import type { ApdData } from '../src/assets/types';
import { AnimScriptError, compileAll, compileAnim, type Frame } from '../src/sprite/animScript';

function apd(scripts: Record<string, string>, nPatterns = 50): ApdData {
  return {
    version: 3, sheets: ['s'], images: [{ sheet: 0, key: 253, x: 0, y: 0, w: 8, h: 8, ox: 0, oy: 0 }],
    patterns: Array.from({ length: nPatterns }, () => ({ yOffset: 0, images: [0] })),
    anims: Object.entries(scripts).map(([name, script]) => ({ name, script })),
  };
}
const f = (pattern: number, ms = 200, extra: Partial<Frame> = {}): Frame =>
  ({ pattern, flipH: false, flipV: false, ms, trigger: null, triggerSharp: false, mark: 0, ...extra });
const compile = (script: string, nPatterns = 50) => compileAnim(apd({ X: script }, nPatterns), 0);

describe('compileAnim – frames', () => {
  it('P range and list, default 200 ms (corpus F.STAND)', () => {
    const t = compile('S200\r\nP1-3,2');
    expect(t.steps).toHaveLength(1);
    expect(t.steps[0]!.frames).toEqual([f(1), f(2), f(3), f(2)]);
    expect(t.steps[0]).toMatchObject({ dx: 0, dy: 0, totalMs: 800 });
  });
  it('S changes the duration of following frames; trailing comma and CRLF are separators (corpus F.DEFENSE)', () => {
    const t = compile('S200\r\nP0,\r\nS400\r\nP4');
    expect(t.steps[0]!.frames).toEqual([f(0, 200), f(4, 400)]);
    expect(t.steps[0]!.totalMs).toBe(600);
  });
  it('descending range', () => {
    expect(compile('P5-3').steps[0]!.frames.map((x) => x.pattern)).toEqual([5, 4, 3]);
  });
  it('range to the same pattern adds nothing', () => {
    expect(compile('P5-5').steps[0]!.frames).toHaveLength(1);
  });
  it('marks and triggers attach to the number they precede; a range gives them to its last frame (corpus char_31B)', () => {
    const frames = compile('S150\r\nP13-A(6)16-B(6)22').steps[0]!.frames;
    expect(frames.map((x) => x.pattern)).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    expect(frames[3]).toEqual(f(16, 150, { mark: 1, trigger: 6 }));
    expect(frames[9]).toEqual(f(22, 150, { mark: 2, trigger: 6 }));
    expect(frames[4]).toEqual(f(17, 150));
  });
  it('trigger resets after every number; N truncates (corpus char_27B)', () => {
    const step = compile('S50\r\nPA(2)16,15,(2)14-12\r\nN4\r\nM16,32').steps[0]!;
    expect(step.frames).toEqual([f(16, 50, { mark: 1, trigger: 2 }), f(15, 50), f(14, 50, { trigger: 2 }), f(13, 50)]);
    expect(step).toMatchObject({ dx: 16, dy: 32, totalMs: 200 });
  });
  it('(#n) sets triggerSharp', () => {
    expect(compile('P(#3)7').steps[0]!.frames[0]).toEqual(f(7, 200, { trigger: 3, triggerSharp: true }));
  });
  it('N cycles frames to fill (corpus F.LIFT)', () => {
    const t = compile('S50 P6 N8 M0,-8\r\nS50 P6 N8 M0,-16');
    expect(t.steps).toHaveLength(2);
    expect(t.steps[0]!.frames).toHaveLength(8);
    expect(t.steps[0]!.frames.every((x) => x.pattern === 6 && x.ms === 50)).toBe(true);
    expect(t.steps[0]).toMatchObject({ dx: 0, dy: -8, totalMs: 400 });
    expect(t.steps[1]).toMatchObject({ dx: 0, dy: -16 });
  });
  it('N cycles a multi-frame list in order', () => {
    expect(compile('P1,2 N5').steps[0]!.frames.map((x) => x.pattern)).toEqual([1, 2, 1, 2, 1]);
  });
});

describe('compileAnim – steps and movement', () => {
  it('M-only steps repeat the previous frames (corpus F.S/DAMAGE)', () => {
    const t = compile('P21\r\nM4,2\r\nM-6,-3\r\nM3,2\r\nM-1,-1\r\nM0,0');
    expect(t.steps).toHaveLength(5);
    expect(t.steps.map((s) => [s.dx, s.dy])).toEqual([[4, 2], [-6, -3], [3, 2], [-1, -1], [0, 0]]);
    expect(t.steps.every((s) => s.frames.length === 1 && s.frames[0]!.pattern === 21)).toBe(true);
  });
  it('an empty trailing step is dropped', () => {
    expect(compile('P1 M0,0\r\n').steps).toHaveLength(1);
  });
  it("M with '-' in place of the comma reads as a negative second number (corpus char_28b M32-16, char_68v M0-40)", () => {
    expect(compile('P1 M32-16').steps[0]).toMatchObject({ dx: 32, dy: -16 });
    expect(compile('P1 M0-40').steps[0]).toMatchObject({ dx: 0, dy: -40 });
  });
  it('HP flips the whole list, H before a number flips that frame, HM negates dx, VM negates dy', () => {
    expect(compile('HP1-2').steps[0]!.frames.every((x) => x.flipH && !x.flipV)).toBe(true);
    const mixed = compile('P1,H2,V3').steps[0]!.frames;
    expect(mixed.map((x) => [x.flipH, x.flipV])).toEqual([[false, false], [true, false], [false, true]]);
    expect(compile('P1 HM4,2').steps[0]).toMatchObject({ dx: -4, dy: 2 });
    expect(compile('P1 VM4,2').steps[0]).toMatchObject({ dx: 4, dy: -2 });
    expect(compile('HP1,H2').steps[0]!.frames.map((x) => x.flipH)).toEqual([true, false]);   // XOR
  });
});

describe('compileAnim – includes', () => {
  const data = apd({
    'F.ATTACK1': 'S100 P0-1 M8,0',
    'F.ATTACK2': 'S100 P2 M0,4',
    'F.ATTACK6': '@F.ATTACK1, @F.ATTACK2,\r\n@F.ATTACK1',
    'B.MIRROR': 'H@F.ATTACK1',
    SELF: '@SELF',
  });
  it('@ appends the steps of another animation (corpus char_01b F.ATTACK6)', () => {
    const t = compileAnim(data, 2);
    expect(t.steps.map((s) => [s.frames.map((x) => x.pattern), s.dx, s.dy])).toEqual([[[0, 1], 8, 0], [[2], 0, 4], [[0, 1], 8, 0]]);
    expect(t.steps[0]!.frames[0]!.ms).toBe(100);
  });
  it('H@ flips the included frames and negates dx', () => {
    const t = compileAnim(data, 3);
    expect(t.steps[0]!.frames.every((x) => x.flipH)).toBe(true);
    expect(t.steps[0]).toMatchObject({ dx: -8, dy: 0 });
  });
  it('resolves names case-insensitively', () => {
    expect(compileAnim(apd({ A: '@b', b: 'P1' }), 0).steps).toHaveLength(1);
  });
  it('rejects self include', () => {
    expect(() => compileAnim(data, 4)).toThrow(/recursive/);
  });
});

describe('compileAnim – errors', () => {
  const err = (script: string, re: RegExp, n = 50) => expect(() => compile(script, n)).toThrow(re);
  it('unknown character', () => err('P1 Q2', /unknown character "Q"/));
  it('pattern out of range names the limit', () => err('P7', /pattern 7 out of range \(5\)/, 5));
  it('range without a start', () => err('P-3', /range without a start/));
  it('first step with only M', () => err('M1,1', /no previous step/));
  it('@ after frames in the same step', () => expect(() => compileAnim(apd({ A: 'P0 @B', B: 'P1' }), 0)).toThrow(/after frames/));
  it('unknown include target', () => expect(() => compileAnim(apd({ A: '@NOPE' }), 0)).toThrow(/no such animation/));
  it('empty script has no frames', () => err('', /no frames/));
  it('carries the anim name and offset', () => {
    expect.assertions(3);
    try { compile('P1 Q'); } catch (e) {
      expect(e).toBeInstanceOf(AnimScriptError);
      expect((e as AnimScriptError).anim).toBe('X');
      expect((e as AnimScriptError).offset).toBe(3);
    }
  });
});

describe('compileAll', () => {
  it('keeps compiling other anims after an error and keys by upper-case name', () => {
    const { timelines, errors } = compileAll(apd({ 'f.stand': 'P1', BAD: 'P-1', 'B.STAND': 'P2' }));
    expect([...timelines.keys()]).toEqual(['F.STAND', 'B.STAND']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.anim).toBe('BAD');
  });
});
