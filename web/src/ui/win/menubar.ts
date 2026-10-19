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
