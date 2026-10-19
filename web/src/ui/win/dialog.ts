/**
 * A Win95 dialog box built from one of the original's templates (assets/data/dialogs.json): the title bar, then every control
 * at its template position (layout.ts). Screens (screens/*.ts) bind the controls by their original ids and resolve a result.
 * A box is modal over the game frame: a transparent backdrop takes the clicks the original's main window would not get.
 * A tab control (SysTabControl32) hosts other templates as its pages, each with its own control set.
 */
import type { DialogTemplate } from '../../data/types';
import { layoutDialog, metricsFor, type DialogLayout, type LaidControl } from './layout';
import { labelNodes } from './menubar';

export const TITLE_H = 18;                                                     // the Win95 caption height in CSS px at scale 1
const TAB_H = 18;                                                              // the tab header row

export interface DialogHost { layer: HTMLElement; templates: Record<string, DialogTemplate> }
export interface ListRow { text: string; enabled?: boolean }

function template(host: DialogHost, id: number | string): DialogTemplate {
  const t = host.templates[String(id)];
  if (!t) throw new Error(`dialog template ${id} missing`);
  return t;
}

/** The controls of one laid-out template, addressed by their original ids. */
export class ControlSet {
  readonly body: HTMLElement;
  protected readonly byId = new Map<number, HTMLElement>();
  readonly layout: DialogLayout;
  constructor(protected readonly host: DialogHost, t: DialogTemplate) {
    const doc = host.layer.ownerDocument;
    this.layout = layoutDialog(t, metricsFor(t.font));
    this.body = doc.createElement('div'); this.body.className = 'w95-body';
    this.body.style.font = `${metricsFor(t.font).charH}px 'Gulim','굴림','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif`;   // the template's font size
    this.body.style.width = `${this.layout.width}px`; this.body.style.height = `${this.layout.height}px`;
    for (const c of this.layout.controls) {
      const el = this.make(doc, c);
      el.style.left = `${c.left}px`; el.style.top = `${c.top}px`; el.style.width = `${c.width}px`; el.style.height = `${c.height}px`;
      this.body.appendChild(el);
      if (c.id !== null) this.byId.set(c.id, el);
    }
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
  control<E extends HTMLElement = HTMLElement>(id: number): E { const el = this.byId.get(id); if (!el) throw new Error(`dialog control ${id} missing`); return el as E; }
  has(id: number): boolean { return this.byId.has(id); }
  setText(id: number, text: string): void { this.control(id).textContent = text; }
  onClick(id: number, fn: () => void): void { this.control(id).addEventListener('click', fn); }
  setEnabled(id: number, on: boolean): void { const el = this.control(id); if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) el.disabled = !on; else el.classList.toggle('disabled', !on); }
  hide(id: number): void { this.control(id).hidden = true; }
  /** Fills a listbox: one row per entry; a click selects (onPick), a double click confirms (onDouble), a right click opens a popup (onContext). A tab in a row is the original's column stop. */
  setList(id: number, rows: ListRow[], onPick: (i: number) => void, onDouble?: (i: number) => void, onContext?: (i: number, ev: MouseEvent) => void): void {
    const list = this.control(id), doc = list.ownerDocument;
    list.replaceChildren(...rows.map((r, i) => {
      const row = doc.createElement('div'); row.className = `w95-row${r.enabled === false ? ' disabled' : ''}`; row.setAttribute('role', 'option');
      const cols = r.text.split('\t');
      if (cols.length === 1) row.textContent = r.text;
      else { row.append(...cols.map((c, k) => { const sp = doc.createElement('span'); sp.className = k === 0 ? 'name' : 'col'; sp.textContent = c; return sp; })); row.classList.add('cols'); }
      if (r.enabled !== false) {
        row.addEventListener('click', () => { for (const x of list.children) x.classList.remove('selected'); row.classList.add('selected'); onPick(i); });
        if (onDouble) row.addEventListener('dblclick', () => onDouble(i));
        if (onContext) row.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); onContext(i, ev); });
      }
      return row;
    }));
  }
  /** A tab control hosting other templates as pages: the header row names them, one page shows at a time. Returns a control set per page. */
  setTabs(id: number, pages: { label: string; template: number }[]): ControlSet[] {
    const tabs = this.control(id), doc = tabs.ownerDocument;
    const header = doc.createElement('div'); header.className = 'w95-tabrow';
    const frame = doc.createElement('div'); frame.className = 'w95-tabpage w95-raised';
    frame.style.top = `${TAB_H}px`;
    const sets = pages.map((p) => new ControlSet(this.host, template(this.host, p.template)));
    const show = (k: number) => {
      frame.replaceChildren(sets[k]!.body);
      for (const [i, h] of [...header.children].entries()) h.classList.toggle('selected', i === k);
    };
    pages.forEach((p, k) => { const h = doc.createElement('span'); h.className = 'w95-tab'; h.textContent = p.label; h.addEventListener('click', () => show(k)); header.appendChild(h); });
    tabs.replaceChildren(header, frame);
    show(0);
    return sets;
  }
}

export class DialogBox<T> extends ControlSet {
  readonly el: HTMLElement;
  private readonly backdrop: HTMLElement;
  private settle: ((v: T) => void) | null = null;
  private readonly cancelValue: (() => T) | null;
  constructor(host: DialogHost, templateId: number | string, opts: { cancel?: () => T } = {}, extraH = 0) {
    super(host, template(host, templateId));
    const doc = host.layer.ownerDocument;
    this.cancelValue = opts.cancel ?? null;
    this.backdrop = doc.createElement('div'); this.backdrop.className = 'w95-backdrop';
    const box = doc.createElement('div'); box.className = 'w95 w95-dialog w95-raised'; box.setAttribute('role', 'dialog');
    box.style.width = `${this.layout.width + 6}px`; box.style.height = `${this.layout.height + TITLE_H + 6 + extraH}px`;
    const title = doc.createElement('div'); title.className = 'w95-title'; title.textContent = this.layout.title; box.appendChild(title);
    box.appendChild(this.body);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.cancelValue) { e.stopPropagation(); this.close(this.cancelValue()); }
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { const def = this.layout.controls.find((c) => c.kind === 'default'); if (def?.id !== null && def?.id !== undefined) { e.stopPropagation(); this.byId.get(def.id)?.click(); } }
    });
    this.el = box;
  }
  /** A web-only row under the template's controls (the save file tools): the box was made `extraH` taller for it. */
  extra(el: HTMLElement): void { el.style.top = `${this.layout.height}px`; this.body.appendChild(el); }
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
