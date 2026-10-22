/** The web's tool buttons at the right end of the menu bar (beside the 배속 badge): small raised Win95 buttons; disabled = engraved grey. */
export interface ToolButton { el: HTMLElement; set(enabled: boolean): void; text(label: string): void }

export function toolButton(doc: Document, cls: string, label: string, title: string, onClick: () => void): ToolButton {
  const el = doc.createElement('button') as HTMLButtonElement;
  el.className = `w95 w95-tool ${cls}`; el.textContent = label; el.title = title; el.setAttribute?.('type', 'button');
  el.addEventListener('click', () => { if (!el.disabled) onClick(); });
  return { el, set: (enabled) => { el.disabled = !enabled; }, text: (t) => { el.textContent = t; } };
}

/** 턴 되돌리기: back to the start of this turn, or one turn further when nothing was done yet. */
export function turnUndoButton(doc: Document, onUndo: () => void): ToolButton {
  return toolButton(doc, 'w95-undo', '턴 되돌리기', '이 턴의 처음으로 되돌린다. 아무것도 하지 않은 상태에서 누르면 이전 턴으로 간다 (Ctrl+Z)', onUndo);
}

export const GOLD_STEP = 10000;

/** 돈 추가: GOLD_STEP into the party purse per click; the label shows the purse. */
export function goldButton(doc: Document, onAdd: () => void): { el: HTMLElement; set(enabled: boolean, gold: number): void } {
  const b = toolButton(doc, 'w95-gold', '돈 추가', `소지금을 ${GOLD_STEP.toLocaleString('ko-KR')} 늘린다 (최대 999,999)`, onAdd);
  return { el: b.el, set: (enabled, gold) => { b.set(enabled); b.text(`돈 추가 · ${gold.toLocaleString('ko-KR')}G`); } };
}
