export type Arg = number | string | null | Arg[];
export interface Instr { at: number; op: string; args: Arg[] }
/** One decoded event file (tools/ft2_export.py → data/eventNN.json). */
export interface Program { stage: number; symbols: Record<string, number>; code: Instr[]; byOffset: Map<number, number> }

export class ScriptError extends Error {
  override name = 'ScriptError';
  constructor(stage: number, message: string) { super(`event${String(stage).padStart(2, '0')}: ${message}`); }
}

const isArg = (a: unknown): a is Arg => a === null || typeof a === 'number' || typeof a === 'string' || (Array.isArray(a) && a.every(isArg));

export function loadProgram(stage: number, raw: unknown): Program {
  if (!raw || typeof raw !== 'object') throw new ScriptError(stage, 'not an object');
  const { symbols, code } = raw as { symbols?: unknown; code?: unknown };
  if (!symbols || typeof symbols !== 'object' || !Array.isArray(code)) throw new ScriptError(stage, 'needs symbols and code');
  const byOffset = new Map<number, number>();
  code.forEach((c, i) => {
    const ins = c as Partial<Instr>;
    if (typeof ins.at !== 'number' || typeof ins.op !== 'string' || !Array.isArray(ins.args) || !ins.args.every(isArg)) throw new ScriptError(stage, `instruction ${i} malformed`);
    byOffset.set(ins.at, i);
  });
  for (const [name, off] of Object.entries(symbols as Record<string, unknown>)) {
    if (typeof off !== 'number' || !byOffset.has(off)) throw new ScriptError(stage, `label ${name} points outside the code`);
  }
  return { stage, symbols: symbols as Record<string, number>, code: code as Instr[], byOffset };
}

/** FUN_004083b0: labels are matched without case; returns the code index. */
export function findLabel(p: Program, name: string): number | null {
  const want = name.toLowerCase();
  for (const [label, off] of Object.entries(p.symbols)) if (label.toLowerCase() === want) return p.byOffset.get(off) ?? null;
  return null;
}

export const num = (a: Arg | undefined): number | null => (typeof a === 'number' ? a : null);
export const str = (a: Arg | undefined): string | null => (typeof a === 'string' ? a : null);
export const list = (a: Arg | undefined): number[] => (Array.isArray(a) ? a.filter((x): x is number => typeof x === 'number') : []);
export const face = (a: Arg | undefined): [number, string | null] | null =>
  Array.isArray(a) && typeof a[0] === 'number' && (a[1] === null || typeof a[1] === 'string') ? [a[0], a[1]] : null;
