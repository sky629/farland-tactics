/** The 턴 되돌리기 button beside the 배속 badge (web-only): back to the start of this turn, or one turn further when nothing was done yet. */
export function turnUndoButton(doc: Document, onUndo: () => void): { el: HTMLElement; set(enabled: boolean): void } {
  const el = doc.createElement('button');
  el.className = 'w95 w95-tool w95-undo'; el.textContent = '턴 되돌리기'; el.setAttribute?.('type', 'button');
  el.title = '이 턴의 처음으로 되돌린다. 아무것도 하지 않은 상태에서 누르면 이전 턴으로 간다 (Ctrl+Z)';
  el.addEventListener('click', () => { if (!(el as HTMLButtonElement).disabled) onUndo(); });
  return { el, set: (enabled) => { (el as HTMLButtonElement).disabled = !enabled; } };
}
