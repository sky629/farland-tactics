/**
 * Dialog 143 "데이터 선택" (불러오기 F1 · 저장하기 F5): the 32 slots in listbox 1060, 결정(1) · 취소(2) · 처음부터(8000, loading only),
 * the hint in static 1062. Row formats are the original's (strings 0x44a64c..): "%2d: %2d일째  Turn%-3d %s" for a battle save,
 * "%2d: %2d일째  어트랙터  %s" for a town one, "%2d:           미등록" for an empty slot; a broken slot shows 손상됨.
 */
import type { SaveSummary } from '../../../save/format';
import { DialogBox, type DialogHost } from '../dialog';

export type SaveMode = 'load' | 'save';
export type SavePick = { slot: number } | { fresh: true } | { again: true } | null;   // again: a tool changed the slots — show the list afresh

const pad2 = (n: number) => String(n).padStart(2, ' ');

export function savesRows(saves: (SaveSummary | null)[], mode: SaveMode): { slot: number; text: string; enabled: boolean }[] {
  return saves.map((s, i) => {
    const no = pad2(i + 1);
    if (s === null) return { slot: i, text: `${no}:           미등록`, enabled: mode === 'save' };
    if (s.broken) return { slot: i, text: `${no}:           손상됨`, enabled: mode === 'save' };
    const where = s.turn >= 0 ? `Turn${String(s.turn).padEnd(3, ' ')} ` : '어트랙터  ';   // the header counts finished rounds: 0 at BATTLE_START, −1 in town
    return { slot: i, text: `${no}: ${pad2(s.stage)}일째  ${where}${s.title}`, enabled: true };
  });
}

/** Web-only tools under the original controls (loading only): export a slot as save%02d.dat, import a .dat, delete a slot. */
export interface SaveFileTools { onExport(slot: number): void; onImport(file: File): Promise<void>; onDelete(slot: number): Promise<void> }

export function pickSave(host: DialogHost, saves: (SaveSummary | null)[], mode: SaveMode, tools?: SaveFileTools): Promise<SavePick> {
  const box = new DialogBox<SavePick>(host, 143, { cancel: () => null }, tools ? 22 : 0);
  let chosen: number | null = null;
  box.setText(1062, mode === 'load' ? '로드할 데이터를 지정해 주십시오' : '세이브할 장소를 지정해 주십시오');
  box.setEnabled(1, false);
  box.setList(1060, savesRows(saves, mode), (i) => { chosen = i; box.setEnabled(1, true); }, (i) => box.close({ slot: i }));
  box.onClick(1, () => { if (chosen !== null) box.close({ slot: chosen }); });
  box.onClick(2, () => box.close(null));
  if (mode === 'load') box.onClick(8000, () => box.close({ fresh: true })); else box.hide(8000);
  if (tools) {
    const doc = host.layer.ownerDocument, strip = doc.createElement('div'); strip.className = 'w95-strip';
    const btn = (text: string, fn: () => void) => { const b = doc.createElement('button'); b.className = 'w95-btn'; b.textContent = text; b.addEventListener('click', fn); return b; };
    const file = doc.createElement('input'); file.type = 'file'; file.accept = '.dat'; file.hidden = true;
    file.addEventListener('change', () => { const f = file.files?.[0]; if (f) void tools.onImport(f).then(() => box.close({ again: true })); });
    const exp = btn('내보내기', () => { if (chosen !== null && saves[chosen]) tools.onExport(chosen); }), del = btn('삭제', () => { if (chosen !== null && saves[chosen]) void tools.onDelete(chosen).then(() => box.close({ again: true })); });
    strip.append(exp, btn('가져오기…', () => file.click()), del, file);
    box.extra(strip);
  }
  return box.show();
}
