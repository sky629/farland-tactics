import type { RosterUnit } from '../../src/data/types';
import type { Resources } from '../../src/script/host';
import { loadProgram, type Arg, type Instr, type Program } from '../../src/script/program';
import { fixedRng, tables } from './battleFixtures';

/** Build a program from rows: a string is a label for the next instruction, an array is [op, ...args]. Offsets are synthetic. */
export function prog(stage: number, rows: (string | [string, ...Arg[]])[]): Program {
  const symbols: Record<string, number> = {}; const code: Instr[] = []; const pending: string[] = [];
  for (const row of rows) {
    if (typeof row === 'string') { pending.push(row); continue; }
    const at = code.length * 4;
    for (const l of pending) symbols[l] = at;
    pending.length = 0;
    const [op, ...args] = row;
    code.push({ at, op, args });
  }
  for (const l of pending) symbols[l] = Math.max(code.length - 1, 0) * 4;
  return loadProgram(stage, { symbols, code });
}

export const res = (programs: Program[], rosters: Record<number, RosterUnit[]> = {}): Resources =>
  ({ program: (n) => programs.find((p) => p.stage === n) ?? null, roster: (n) => rosters[n] ?? null, tables: tables(), rng: fixedRng([0]) });
