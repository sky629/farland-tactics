/**
 * The walker's answer to a modal, given through the box's real controls (spec §5.3): ask → 예(6)/아니오(7), save → 취소(2),
 * shop → 돌아오기(1078), result → every bar at 0 then 결정(1) — the EXP pool is already on the unit the walker chose, so the
 * dialog must add nothing — message → the message box's button. The page adapts its DOM to `AnswerBox`.
 */
import type { WalkModalKind } from './walker';

export interface AnswerBox { control(id: number): { click(): void } | null; bars(): { set(v: number): void }[]; template: string | null }

/** True when a control took the answer; false when no box or control was there to answer. */
export function applyAnswer(a: { kind: WalkModalKind; value: number }, top: AnswerBox | null, messageButton: { click(): void } | null): boolean {
  const press = (id: number): boolean => { const c = top?.control(id) ?? null; if (!c) return false; c.click(); return true; };
  switch (a.kind) {
    case 'message': if (!messageButton) return false; messageButton.click(); return true;
    case 'ask': return press(a.value ? 6 : 7);
    case 'save': return press(2);
    case 'shop': return press(1078);
    case 'result': for (const bar of top?.bars() ?? []) bar.set(0); return press(1);
  }
}
