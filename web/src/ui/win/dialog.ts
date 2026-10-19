/**
 * A Win95 dialog box built from one of the original's templates (assets/data/dialogs.json): the title bar, then every control
 * at its template position (layout.ts). Screens (screens/*.ts) bind the controls by their original ids and resolve a result.
 * A box is modal over the game frame: a transparent backdrop takes the clicks the original's main window would not get.
 */
import type { DialogTemplate } from '../../data/types';
import { layoutDialog, type LaidControl, type Metrics } from './layout';
import { labelNodes } from './menubar';

export const TITLE_H = 18;                                                     // the Win95 caption height in CSS px at scale 1

export interface DialogHost { layer: HTMLElement; templates: Record<string, DialogTemplate> }

/** Dialog units follow the dialog font: the average character width (as Win32's tmAveCharWidth: the alphabet's mean) and the line height. */
export function measureFont(doc: Document, font: [number, string] | null): Metrics {
  const pt = font?.[0] ?? 9, px = Math.round(pt * 96 / 72);
  const probe = doc.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${px}px 'Gulim','굴림','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;line-height:normal`;
  probe.textContent = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  doc.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 52 || px * 0.5, h = probe.getBoundingClientRect().height || px * 1.2;
  probe.remove();
  return { charW: w, charH: h };
}

export class DialogBox<T> {
  readonly el: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly byId = new Map<number, HTMLElement>();
  private settle: ((v: T) => void) | null = null;
  private cancelValue: (() => T) | null = null;
  readonly layout;
  constructor(private readonly host: DialogHost, templateId: number | string, opts: { cancel?: () => T } = {}, extraH = 0) {
    const t = host.templates[String(templateId)];
    if (!t) throw new Error(`dialog template ${templateId} missing`);
    const doc = host.layer.ownerDocument;
    this.layout = layoutDialog(t, measureFont(doc, t.font));
    this.cancelValue = opts.cancel ?? null;
    this.backdrop = doc.createElement('div'); this.backdrop.className = 'w95-backdrop';
    const box = doc.createElement('div'); box.className = 'w95 w95-dialog w95-raised'; box.setAttribute('role', 'dialog');
    box.style.width = `${this.layout.width + 6}px`; box.style.height = `${this.layout.height + TITLE_H + 6 + extraH}px`;
    const title = doc.createElement('div'); title.className = 'w95-title'; title.textContent = this.layout.title; box.appendChild(title);
    const body = doc.createElement('div'); body.className = 'w95-body'; box.appendChild(body);
    for (const c of this.layout.controls) {
      const el = this.make(doc, c);
      el.style.left = `${c.left}px`; el.style.top = `${c.top}px`; el.style.width = `${c.width}px`; el.style.height = `${c.height}px`;
      body.appendChild(el);
      if (c.id !== null) this.byId.set(c.id, el);
    }
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.cancelValue) { e.stopPropagation(); this.close(this.cancelValue()); }
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { const def = this.layout.controls.find((c) => c.kind === 'default'); if (def?.id !== null && def?.id !== undefined) { e.stopPropagation(); this.byId.get(def.id)?.click(); } }
    });
    this.el = box;
  }
  private make(doc: Document, c: LaidControl): HTMLElement {
    switch (c.kind) {
      case 'push': case 'default': { const b = doc.createElement('button'); b.className = `w95-btn${c.kind === 'default' ? ' default' : ''}`; b.append(...labelNodes(doc, c.label, c.ul)); return b; }
      case 'check': case 'radio': { const l = doc.createElement('label'); l.className = 'w95-check'; const i = doc.createElement('input'); i.type = c.kind === 'radio' ? 'radio' : 'checkbox'; l.append(i, doc.createTextNode(c.label)); return l; }
      case 'group': { const g = doc.createElement('fieldset'); g.className = 'w95-group'; if (c.label) { const lg = doc.createElement('legend'); lg.textContent = c.label; g.appendChild(lg); } return g; }
      case 'edit': { const i = doc.createElement('input'); i.className = 'w95-edit w95-sunken'; return i; }
      case 'list': { const d = doc.createElement('div'); d.className = 'w95-list w95-sunken'; d.setAttribute('role', 'listbox'); d.tabIndex = 0; return d; }
      case 'tab': { const d = doc.createElement('div'); d.className = 'w95-tabs'; return d; }
      case 'ownerdraw': { const d = doc.createElement('div'); d.className = 'w95-owner'; d.dataset['label'] = c.label; return d; }
      default: { const s = doc.createElement('span'); s.className = `w95-static ${c.align}`; s.textContent = c.label; return s; }
    }
  }
  /** A web-only row under the template's controls (the save file tools): the box was made `extraH` taller for it. */
  extra(el: HTMLElement): void { el.style.top = `${this.layout.height}px`; this.el.querySelector('.w95-body')!.appendChild(el); }
  control<E extends HTMLElement = HTMLElement>(id: number): E { const el = this.byId.get(id); if (!el) throw new Error(`dialog control ${id} missing`); return el as E; }
  has(id: number): boolean { return this.byId.has(id); }
  setText(id: number, text: string): void { this.control(id).textContent = text; }
  onClick(id: number, fn: () => void): void { this.control(id).addEventListener('click', fn); }
  setEnabled(id: number, on: boolean): void { const el = this.control(id); if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) el.disabled = !on; else el.classList.toggle('disabled', !on); }
  hide(id: number): void { this.control(id).hidden = true; }
  /** Fills a listbox: one row per entry; a click selects (onPick), a double click confirms (onDouble). */
  setList(id: number, rows: { text: string; enabled?: boolean }[], onPick: (i: number) => void, onDouble?: (i: number) => void): void {
    const list = this.control(id), doc = list.ownerDocument;
    list.replaceChildren(...rows.map((r, i) => {
      const row = doc.createElement('div'); row.className = `w95-row${r.enabled === false ? ' disabled' : ''}`; row.textContent = r.text; row.setAttribute('role', 'option');
      if (r.enabled !== false) {
        row.addEventListener('click', () => { for (const x of list.children) x.classList.remove('selected'); row.classList.add('selected'); onPick(i); });
        if (onDouble) row.addEventListener('dblclick', () => onDouble(i));
      }
      return row;
    }));
  }
  show(): Promise<T> {
    const layer = this.host.layer;
    layer.append(this.backdrop, this.el);
    const W = layer.clientWidth, H = layer.clientHeight;                       // centred in the frame, like the original's dialogs over its window
    this.el.style.left = `${Math.max(0, Math.round((W - this.el.offsetWidth) / 2))}px`; this.el.style.top = `${Math.max(0, Math.round((H - this.el.offsetHeight) / 2))}px`;
    (this.el.querySelector('.w95-btn.default') as HTMLElement | null ?? this.el.querySelector('button') as HTMLElement | null)?.focus();
    return new Promise((resolve) => { this.settle = resolve; });
  }
  close(value: T): void { this.el.remove(); this.backdrop.remove(); const s = this.settle; this.settle = null; s?.(value); }
}
