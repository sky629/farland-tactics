import type { Inventory } from '../battle/inventory';
import { EXP_CAP } from '../battle/outcome';
import type { Unit } from '../battle/unit';
import type { Tables } from '../data/types';
import type { SaveSummary } from '../save/format';
import type { ModalKind, Where } from '../script/host';
import { unitName } from './panel';
import type { DialogHost } from './win/dialog';
import { confirm } from './win/screens/confirm';
import { pickSave } from './win/screens/saves';
import { unitList } from './win/screens/unitList';
import { expShareDialog } from './win/screens/expShare';
import { shopDialog } from './win/screens/shop';

/** One piece of a TEXT line with the size/color the `[Snn]`/`[Cnn]` tags before it set (null = default). */
export interface TextRun { text: string; size: number | null; color: number | null }

export function parseTextTags(line: string): TextRun[] {
  const runs: TextRun[] = [];
  let size: number | null = null, color: number | null = null, last = 0;
  const re = /\[([SC])(\d+)\]/g;
  const flush = (end: number) => { if (end > last) runs.push({ text: line.slice(last, end), size, color }); };
  for (let m = re.exec(line); m; m = re.exec(line)) {
    flush(m.index);
    if (m[1] === 'S') size = Number(m[2]); else color = Number(m[2]);
    last = m.index + m[0].length;
  }
  flush(line.length);
  return runs;
}

/** What the modals need from the game: item/race names, the shared inventory, the party for equipment purchases. */
export interface ModalContext { tables: Tables; inventory: Inventory; party: (Unit | null)[]; saves?: (SaveSummary | null)[] }



/**
 * HTML overlay for the story scripts (spec §10): two dialogue windows, a modal box (message / ask / shop / result / save)
 * and the episode title. Only DOM glue lives here; clicks on the overlay are counted for WAIT_CLICK.
 */
export class Dialogue {
  readonly windows: Record<Where, HTMLElement>;
  readonly modal: HTMLElement;
  readonly episode: HTMLElement;
  private readonly parts: Record<Where, { face: HTMLImageElement; name: HTMLElement; lines: HTMLElement }>;
  private clicks = 0;
  private result: number | null = null;
  private dialogs: DialogHost | null = null;   // the original's dialog boxes (ask 126, save 143) once the templates are loaded
  private episodeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly doc: Document, root: HTMLElement, private readonly faceUrl: (speaker: number, letter: string) => string | null) {
    const win = (where: Where) => {
      const box = this.el('div', `win ${where}`); box.hidden = true;
      const face = this.el('img', 'face') as HTMLImageElement; face.hidden = true;
      const body = this.el('div', 'body');
      const name = this.el('div', 'name'), lines = this.el('div', 'lines');
      body.append(name, lines); box.append(face, body); root.appendChild(box);
      return { box, face, name, lines };
    };
    const top = win('top'), bottom = win('bottom');
    this.windows = { top: top.box, bottom: bottom.box };
    this.parts = { top, bottom };
    this.modal = this.el('div', 'modal'); this.modal.hidden = true; root.appendChild(this.modal);
    this.episode = this.el('div', 'episode'); this.episode.hidden = true; root.appendChild(this.episode);
    root.addEventListener('click', () => { this.clicks++; });
  }

  private el(tag: string, className: string, text = ''): HTMLElement {
    const e = this.doc.createElement(tag);
    e.className = className;
    if (text) e.textContent = text;
    return e;
  }
  private button(label: string, onClick: () => void): HTMLElement {
    const b = this.el('button', 'btn', label);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
    return b;
  }

  /** The dialog templates and the frame layer for the Win95 boxes; ASK and SAVE_GAME wait until they are attached. */
  attach(host: DialogHost): void { this.dialogs = host; }
  face(where: Where): HTMLImageElement { return this.parts[where].face; }
  lines(where: Where): HTMLElement { return this.parts[where].lines; }

  openWindow(where: Where, speaker: number, faceLetter: string | null): void {
    const p = this.parts[where];
    const url = faceLetter && speaker < 30 ? this.faceUrl(speaker, faceLetter) : null;
    p.face.hidden = url === null;
    if (url) p.face.src = url;
    p.name.textContent = '';
    p.lines.replaceChildren();
    this.windows[where].hidden = false;
  }
  closeWindow(where: Where): void { this.windows[where].hidden = true; }

  text(where: Where, line: string, speakerName: string | null): void {
    const p = this.parts[where];
    if (speakerName) p.name.textContent = speakerName;
    const node = this.el('div', 'line');
    for (const run of parseTextTags(line)) {
      const span = this.el('span', run.color === null ? '' : `c${run.color}`, run.text);
      if (run.size !== null) span.style.fontSize = `${run.size / 16}em`;           // [Snn] is in 640×480 pixels; the overlay scales with the canvas
      node.appendChild(span);
    }
    p.lines.appendChild(node);
    this.windows[where].hidden = false;
  }

  openModal(kind: ModalKind, payload: unknown, ctx: ModalContext): void {
    this.result = null;
    const box = this.modal;
    box.replaceChildren();
    const close = (value: number) => (): void => { this.result = value; box.hidden = true; };
    switch (kind) {
      case 'message': box.append(this.el('div', 'text', String(payload)), this.button('닫기', close(0))); break;
      case 'ask': { if (!this.dialogs) throw new Error('dialogs not attached'); void confirm(this.dialogs, String(payload)).then((yes) => { this.result = yes ? 1 : 0; }); return; }   // dialog 126 확인
      case 'save': { if (!this.dialogs) throw new Error('dialogs not attached'); void pickSave(this.dialogs, ctx.saves ?? [], 'save').then((p) => { this.result = p && 'slot' in p ? p.slot : -1; }); return; }   // dialog 143 데이터 선택
      case 'result': {                                                       // dialog 162 경험치 배분: the shares go onto the units, then the VM levels them up
        if (!this.dialogs) throw new Error('dialogs not attached');
        const party = ctx.party.filter((u): u is Unit => u !== null && u.status !== 9), pool = (payload as { pool: number }).pool;
        void expShareDialog(this.dialogs, party.map((u) => ({ exp: u.exp, name: unitName(u, ctx.tables) })), pool).then((shares) => { party.forEach((u, i) => { u.exp = Math.min(u.exp + (shares[i] ?? 0), EXP_CAP); }); this.result = 0; });
        return;
      }
      case 'shop': { if (!this.dialogs) throw new Error('dialogs not attached'); void shopDialog(this.dialogs, payload as number[], ctx).then(() => { this.result = 1; }); return; }   // dialogs 150/151/152
    }
    box.hidden = false;
  }

  takeModalResult(): number | null { const r = this.result; this.result = null; return r; }

  showEpisode(title: string): void {
    this.episode.textContent = title;
    this.episode.hidden = false;
    if (this.episodeTimer) clearTimeout(this.episodeTimer);
    this.episodeTimer = setTimeout(() => { this.episode.hidden = true; }, 2500);
  }

  closeAll(): void {
    this.windows.top.hidden = true; this.windows.bottom.hidden = true;
    this.modal.hidden = true; this.episode.hidden = true;
    this.result = null;
  }

  /** One WAIT_CLICK release per click (a double click releases two waits, not three). */
  noteClick(): void { this.clicks++; }
  takeClick(): boolean { if (this.clicks > 0) { this.clicks--; return true; } return false; }
}
