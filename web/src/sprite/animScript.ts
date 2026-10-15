import type { ApdData } from '../assets/types';

export interface Frame { pattern: number; flipH: boolean; flipV: boolean; ms: number; trigger: number | null; triggerSharp: boolean; mark: 0 | 1 | 2 | 3 | 4 }
export interface Step { frames: Frame[]; dx: number; dy: number; totalMs: number }
export interface Timeline { name: string; steps: Step[] }

export class AnimScriptError extends Error {
  override name = 'AnimScriptError';
  constructor(readonly anim: string, readonly offset: number, message: string) {
    super(`${anim}@${offset}: ${message}`);
  }
}

const DEFAULT_MS = 200;
const MAX_INCLUDE_DEPTH = 8;
const FLIP_H = 1;
const FLIP_V = 2;

type Mode = 'none' | 'P' | 'M' | 'N' | 'S';

interface StepBuild { frames: Frame[]; n: number | null; dx: number; dy: number }

const newStep = (): StepBuild => ({ frames: [], n: null, dx: 0, dy: 0 });

/** Compile one animation script of an APD file into a timeline (FUN_00424c80 and helpers). */
export function compileAnim(apd: ApdData, animIndex: number, depth = 0): Timeline {
  const anim = apd.anims[animIndex];
  if (!anim) throw new RangeError(`anim index ${animIndex} out of range`);
  const s = anim.script;
  const steps: Step[] = [];
  let cur = newStep();
  let mode: Mode = 'none';
  let ms = DEFAULT_MS;
  let tokenFlip = 0;   // H/V right before P or M
  let elemFlip = 0;    // H/V right before a number
  let mark: Frame['mark'] = 0;
  let range = false;   // '-' seen since the last number (P context)
  let negative = false;  // '-' seen since the last number (M context)
  let trigger: number | null = null;
  let sharp = false;
  let mIndex = 0;
  let i = 0;

  const fail = (message: string) => new AnimScriptError(anim.name, i, message);

  /** Flip bits from 'H'/'V' characters immediately before position pos (FUN_00425100 looks at pos-1 and pos-2). */
  const flipsBefore = (pos: number): number => {
    let bits = 0;
    for (const back of [1, 2]) {
      const ch = s[pos - back];
      if (ch === 'H') bits |= FLIP_H;
      else if (ch === 'V') bits |= FLIP_V;
      else break;
    }
    return bits;
  };

  const frameOf = (pattern: number, flip: number, withMeta: boolean): Frame => ({
    pattern, flipH: (flip & FLIP_H) !== 0, flipV: (flip & FLIP_V) !== 0, ms,
    trigger: withMeta ? trigger : null, triggerSharp: withMeta ? sharp : false, mark: withMeta ? mark : 0,
  });

  const checkPattern = (p: number) => {
    if (p >= apd.patterns.length) throw fail(`pattern ${p} out of range (${apd.patterns.length})`);
  };

  // FUN_004253a0: one P number → one frame, or a range fill ending at this number.
  const emitPattern = (v: number) => {
    checkPattern(v);
    const flip = elemFlip ^ tokenFlip;
    if (!range) { cur.frames.push(frameOf(v, flip, true)); return; }
    const last = cur.frames[cur.frames.length - 1];
    if (!last) throw fail('range without a start pattern');
    if (last.pattern === v) return;
    const dir = v > last.pattern ? 1 : -1;
    for (let p = last.pattern + dir; p !== v; p += dir) cur.frames.push(frameOf(p, flip, false));
    cur.frames.push(frameOf(v, flip, true));
  };

  // FUN_00425190: close the step. M-only steps copy the previous step; N cycles or truncates.
  const endStep = (final: boolean) => {
    if (cur.frames.length === 0) {
      if (final) return;
      const prev = steps[steps.length - 1];
      if (!prev) throw fail('step without frames and no previous step');
      cur.frames = prev.frames.map((fr) => ({ ...fr }));
      if (cur.n === null) cur.n = prev.frames.length;
    }
    let frames = cur.frames;
    if (cur.n !== null && cur.n > 0) {
      if (cur.n < frames.length) frames = frames.slice(0, cur.n);
      else {
        const base = frames.slice();
        for (let k = 0; frames.length < cur.n; k = (k + 1) % base.length) frames.push({ ...base[k]! });
      }
    }
    const totalMs = frames.reduce((acc, fr) => acc + fr.ms, 0);
    steps.push({ frames, dx: cur.dx, dy: cur.dy, totalMs });
    cur = newStep();
  };

  // FUN_00425560: include the steps of another animation of this file.
  const include = (name: string, flip: number) => {
    if (cur.frames.length > 0) throw fail(`@${name} after frames in the same step`);
    const target = apd.anims.findIndex((a) => a.name.toUpperCase() === name.toUpperCase());
    if (target < 0) throw fail(`@${name}: no such animation`);
    if (target === animIndex || depth >= MAX_INCLUDE_DEPTH) throw fail(`@${name}: recursive include`);
    const inner = compileAnim(apd, target, depth + 1);
    const fh = (flip & FLIP_H) !== 0, fv = (flip & FLIP_V) !== 0;
    for (const st of inner.steps) {
      steps.push({
        frames: st.frames.map((fr) => ({ ...fr, flipH: fr.flipH !== fh, flipV: fr.flipV !== fv })),
        dx: fh ? -st.dx : st.dx, dy: fv ? -st.dy : st.dy, totalMs: st.totalMs,
      });
    }
  };

  const resetAfterNumber = () => { trigger = null; sharp = false; mark = 0; range = false; negative = false; };

  while (i < s.length) {
    const ch = s[i]!;
    if (ch >= '0' && ch <= '9') {
      let j = i, v = 0;
      while (j < s.length && s[j]! >= '0' && s[j]! <= '9') { v = v * 10 + (s.charCodeAt(j) - 48); j++; }
      elemFlip = flipsBefore(i);
      switch (mode) {
        case 'P': emitPattern(v); break;
        case 'M': {
          let val = negative ? -v : v;
          if (mIndex === 0) { if (tokenFlip & FLIP_H) val = -val; cur.dx = val; mIndex = 1; }
          else { if (tokenFlip & FLIP_V) val = -val; cur.dy = val; endStep(false); mode = 'none'; }
          break;
        }
        case 'N': cur.n = v; break;
        case 'S': ms = v; break;
        default: throw fail(`number ${v} without a command`);
      }
      resetAfterNumber();
      i = j;
      continue;
    }
    switch (ch) {
      case ' ': case ',': elemFlip = 0; break;   // FUN_00424c80 separators clear only the H/V element bits (AND 0x0c); range, mark and sign stay until the next number
      case '\r': case '\n': case 'H': case 'V': break;
      case 'A': mark = 1; break;
      case 'B': mark = 2; break;
      case 'C': mark = 3; break;
      case 'D': mark = 4; break;
      case '-': range = true; negative = true; break;
      case '(': {
        const close = s.indexOf(')', i);
        if (close < 0) throw fail('unterminated trigger');
        let body = s.slice(i + 1, close);
        sharp = body.startsWith('#');
        if (sharp) body = body.slice(1);
        if (!/^\d+$/.test(body)) throw fail(`bad trigger "(${s.slice(i + 1, close)})"`);
        trigger = Number(body);
        i = close + 1;
        continue;
      }
      case 'P': mode = 'P'; tokenFlip = flipsBefore(i); break;
      case 'M': mode = 'M'; tokenFlip = flipsBefore(i); mIndex = 0; break;
      case 'N': mode = 'N'; break;
      case 'S': mode = 'S'; break;
      case '@': {
        const flip = flipsBefore(i);
        let j = i + 1;
        while (j < s.length && !' ,\r\n'.includes(s[j]!)) j++;
        include(s.slice(i + 1, j), flip);
        i = j;
        continue;
      }
      default: throw fail(`unknown character "${ch}"`);
    }
    i++;
  }
  endStep(true);
  if (steps.every((st) => st.frames.length === 0)) throw fail('no frames');
  return { name: anim.name, steps };
}

/** Compile every animation of a file; one failing script does not stop the others. */
export function compileAll(apd: ApdData): { timelines: Map<string, Timeline>; errors: AnimScriptError[] } {
  const timelines = new Map<string, Timeline>();
  const errors: AnimScriptError[] = [];
  apd.anims.forEach((a, index) => {
    try { timelines.set(a.name.toUpperCase(), compileAnim(apd, index)); }
    catch (e) { if (e instanceof AnimScriptError) errors.push(e); else throw e; }
  });
  return { timelines, errors };
}
