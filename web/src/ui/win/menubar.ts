/**
 * The original's menu bar (RT_MENU 103, assets/data/menu.json): the bar holds the 맵 popup — 표시 ▸ (유니트 일람 F2, 전체 맵 F3,
 * 전체 화면 F4, 클리어 조건), 턴 종료 F10, 시스템 ▸ (불러오기 F1, 저장하기 F5, 환경설정 F11, 게임종료). The other top-level popups
 * of the resource (도구, 팔기, 마법1, 마법2, 시스템, 디버그) are the code-made popups the game opens at the cursor; 디버그 shows
 * only in the developer mode. Labels, mnemonics and accelerators are read off the resource strings (layout.ts mnemonic).
 */
import type { MenuItemTemplate, MenuTemplate } from '../../data/types';
import { mnemonic } from './layout';

export type { MenuTemplate };
export interface MenuItem { label: string; ul: number; key: string | null; accel: string | null; id: number | null; enabled: boolean; separator: boolean; items?: MenuItem[] }
export interface MenuPopup { label: string; ul: number; key: string | null; items: MenuItem[] }
export interface MenuBarModel { bar: MenuPopup[]; popups: Record<string, MenuPopup> }

const MF_GRAYED = 0x1, MF_DISABLED = 0x2;
const DEV_POPUPS = new Set(['디버그']);

function item(t: MenuItemTemplate, enabled: Record<number, boolean>): MenuItem {
  if (t.items === undefined && t.text === '' && (t.id === 0 || t.id === null)) return { label: '-', ul: -1, key: null, accel: null, id: null, enabled: false, separator: true };
  const mn = mnemonic(t.text);
  const on = (t.flags & (MF_GRAYED | MF_DISABLED)) === 0 && (t.id === null || (enabled[t.id] ?? true));
  return { label: mn.label, ul: mn.ul, key: mn.key, accel: mn.accel, id: t.id, enabled: on, separator: false, ...(t.items ? { items: t.items.map((c) => item(c, enabled)) } : {}) };
}

export function menuModel(menu: MenuTemplate, enabled: Record<number, boolean>, dev: boolean): MenuBarModel {
  const popups = menu.items.filter((t) => t.items !== undefined).map((t) => { const mn = mnemonic(t.text); return { label: mn.label, ul: mn.ul, key: mn.key, items: t.items!.map((c) => item(c, enabled)) }; });
  const [bar, ...rest] = popups;
  const out: MenuBarModel = { bar: bar ? [bar] : [], popups: {} };
  for (const p of rest) if (dev || !DEV_POPUPS.has(p.label)) out.popups[p.label] = p;
  return out;
}

/** The command id of the accelerator a key press names ('F10' → 40009; Ctrl+Z → 40026), or null. ALT+F4 belongs to the browser. */
export function accelOf(m: MenuBarModel, key: string, ctrl: boolean): number | null {
  const want = (ctrl ? `ctrl+${key}` : key).toLowerCase();
  const find = (items: MenuItem[]): number | null => {
    for (const i of items) {
      if (i.accel !== null && i.id !== null && i.accel.toLowerCase() === want) return i.id;
      if (i.items) { const r = find(i.items); if (r !== null) return r; }
    }
    return null;
  };
  return find([...m.bar, ...Object.values(m.popups)].flatMap((p) => p.items));
}

/** The label with its mnemonic letter underlined, as Win95 draws it. */
export function labelNodes(doc: Document, label: string, ul: number): Node[] {
  if (ul < 0) return [doc.createTextNode(label)];
  const u = doc.createElement('u'); u.textContent = label[ul]!;
  return [doc.createTextNode(label.slice(0, ul)), u, doc.createTextNode(label.slice(ul + 1))];
}

/** A popup list of items (submenus open to the right on hover); `pick` gets the command id of an enabled leaf. */
export function buildMenuList(doc: Document, items: MenuItem[], pick: (id: number) => void): HTMLElement {
  const box = doc.createElement('div'); box.className = 'w95 w95-popup';
  for (const it of items) {
    if (it.separator) { const sep = doc.createElement('div'); sep.className = 'w95-sep'; box.appendChild(sep); continue; }
    const row = doc.createElement('div'); row.className = `w95-item${it.enabled ? '' : ' disabled'}`;
    const label = doc.createElement('span'); label.append(...labelNodes(doc, it.label, it.ul)); row.appendChild(label);
    if (it.accel) { const a = doc.createElement('span'); a.className = 'accel'; a.textContent = it.accel; row.appendChild(a); }
    if (it.items) {
      const arrow = doc.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '▶'; row.appendChild(arrow);
      let sub: HTMLElement | null = null;
      row.addEventListener('mouseenter', () => { if (!sub && it.enabled) { sub = buildMenuList(doc, it.items!, pick); row.appendChild(sub); row.classList.add('open'); } });
      row.addEventListener('mouseleave', () => { if (sub) { sub.remove(); sub = null; row.classList.remove('open'); } });
    } else if (it.enabled && it.id !== null) {
      const id = it.id;
      row.addEventListener('mouseup', (e) => { e.stopPropagation(); pick(id); });
    }
    box.appendChild(row);
  }
  return box;
}

/** The menu bar in the DOM: click a bar item to drop its popup; Esc, a click elsewhere or a pick closes it. */
export class MenuBar {
  private openIdx = -1;
  private dropdown: HTMLElement | null = null;
  constructor(private readonly root: HTMLElement, private model: MenuBarModel, private readonly onCommand: (id: number) => void) {
    root.classList.add('w95', 'w95-menubar');
    this.render();
    root.ownerDocument.addEventListener('mousedown', (e) => { if (!root.contains(e.target as Node)) this.close(); });
    root.ownerDocument.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.openIdx >= 0) { this.close(); e.stopPropagation(); } });
  }
  /** A new enabled/disabled state: rebuilt (the open dropdown too). */
  setModel(model: MenuBarModel): void { this.model = model; const open = this.openIdx; this.render(); if (open >= 0) this.show(open); }
  get isOpen(): boolean { return this.openIdx >= 0; }
  close(): void { this.dropdown?.remove(); this.dropdown = null; this.openIdx = -1; for (const el of this.root.children) el.classList.remove('open'); }
  private render(): void {
    this.close();
    const doc = this.root.ownerDocument;
    this.root.replaceChildren(...this.model.bar.map((p, i) => {
      const el = doc.createElement('span'); el.className = 'w95-menu'; el.append(...labelNodes(doc, p.label, p.ul));
      el.addEventListener('mousedown', (e) => { e.preventDefault(); if (this.openIdx === i) this.close(); else this.show(i); });
      el.addEventListener('mouseenter', () => { if (this.openIdx >= 0 && this.openIdx !== i) this.show(i); });
      return el;
    }));
  }
  private show(i: number): void {
    this.close();
    const popup = this.model.bar[i]; if (!popup) return;
    const el = this.root.children[i] as HTMLElement;
    el.classList.add('open'); this.openIdx = i;
    const list = buildMenuList(this.root.ownerDocument, popup.items, (id) => { this.close(); this.onCommand(id); });
    list.style.left = `${el.offsetLeft}px`; list.style.top = `${this.root.offsetHeight}px`;
    this.root.appendChild(list); this.dropdown = list;
  }
}
