import { describe, expect, it } from 'vitest';
import type { Unit } from '../src/battle/unit';
import { Walker, type WalkWorld } from '../src/dev/walker';
import { available, newGameCore } from './helpers/walkFixtures';

const stubWorld = (over: Partial<WalkWorld> = {}): WalkWorld => ({ click: () => {}, answer: () => {}, presenterBusy: () => false, autosave: () => null, reseed: () => {}, log: () => {}, ...over });

describe.skipIf(!available)('Walker (the campaign walk as a module)', () => {
  it('a new game: the first steps click the opening away and answer no modal; finished is false', () => {
    const calls: string[] = [];
    const { core, tables } = newGameCore();
    const w = new Walker(core, tables, stubWorld({ click: () => calls.push('click'), answer: (k, v) => calls.push(`answer ${k} ${v}`) }));
    let now = 0;
    for (let i = 0; i < 50; i++) { now += 50; if (w.step(now) === 'frame') core.frame(now); }
    expect(calls.filter((c) => c === 'click').length).toBeGreaterThan(0);
    expect(calls.some((c) => c.startsWith('answer'))).toBe(false);
    expect(w.finished).toBe(false);
  });
  it("from: the given save is this battle's autosave 30 (a retry reloads it) and the battle counts as number 1", () => {
    const { core, stage, tables, saveAt } = newGameCore();
    const bytes = saveAt(1);
    const w = new Walker(core, tables, stubWorld({ click: () => { stage.clicks = 1; } }), { from: bytes });
    expect(w.summary().battles).toEqual([core.campaign.stage]);
    let now = 0; for (let i = 0; i < 2000 && core.mode !== 'battle'; i++) { now += 50; if (w.step(now) === 'frame') core.frame(now); }   // the Restart label runs first, then BATTLE_START
    expect(core.mode).toBe('battle');
  });
  it("result: the EXP pool goes to one unit of the dialog's row set (status 9 excluded) and the answer is 0", () => {
    const answers: [string, number][] = [];
    const { core, tables, saveAt } = newGameCore();
    new Walker(core, tables, stubWorld(), { from: saveAt(1) });
    const party = core.campaign.units.filter((u): u is Unit => u !== null && u.slot < 10);
    const hidden = party[party.length - 1]!;
    hidden.status = 9; hidden.str = 999; hidden.level = 1;                    // the hidden member would be the ladder's fighter (the highest STR, under level 28)
    const before = hidden.exp;
    const w = new Walker(core, tables, stubWorld({ answer: (k, v) => answers.push([k, v]) }));
    w.onModal('result', { gold: 0, pool: 100 });
    expect(answers).toEqual([['result', 0]]);
    expect(hidden.exp).toBe(before);
  });
});
