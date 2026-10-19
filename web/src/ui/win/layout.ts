/**
 * The original's dialog boxes, laid out from their resource templates (assets/data/dialogs.json, tools/ft2_dialogs.py).
 *
 * A Win32 dialog template places controls in dialog units: 4 across per average character width of the dialog's font and
 * 8 down per character height (MapDialogRect). The web page measures its substitute for 굴림 and converts with the same
 * ratios, so the structure, coordinates, strings and ids are the original's; only the glyphs differ.
 */
import type { ControlTemplate, DialogTemplate } from '../../data/types';
export type { ControlTemplate, DialogTemplate };
export interface Metrics { charW: number; charH: number }
export interface Box { left: number; top: number; width: number; height: number }

/** Button kinds by the low style nibble (BS_*), the tab control, and statics as text. */
export type ControlKind = 'push' | 'default' | 'check' | 'radio' | 'group' | 'ownerdraw' | 'text' | 'edit' | 'list' | 'tab' | 'other';

export interface LaidControl extends Box {
  id: number | null; cls: string; kind: ControlKind; style: number;
  label: string; ul: number; key: string | null;                            // the text without its '&', the underlined index, the mnemonic key
  align: 'left' | 'center' | 'right';                                       // statics: SS_LEFT 0 / SS_CENTER 1 / SS_RIGHT 2
}
export interface DialogLayout { width: number; height: number; title: string; controls: LaidControl[] }

export const duToPx = (m: Metrics, x: number, y: number, cx: number, cy: number): Box => ({
  left: Math.round(x * m.charW / 4), top: Math.round(y * m.charH / 8),
  width: Math.max(1, Math.round(cx * m.charW / 4)), height: Math.max(1, Math.round(cy * m.charH / 8)),
});

/** '유니트 일람(&L)\tF2' → label '유니트 일람(L)', underline at 7, key 'l', accelerator 'F2'. */
export function mnemonic(text: string): { label: string; ul: number; key: string | null; accel: string | null } {
  const tab = text.indexOf('\t');
  const body = tab >= 0 ? text.slice(0, tab) : text, accel = tab >= 0 ? text.slice(tab + 1) : null;
  const amp = body.indexOf('&');
  if (amp < 0 || amp === body.length - 1) return { label: body, ul: -1, key: null, accel };
  return { label: body.slice(0, amp) + body.slice(amp + 1), ul: amp, key: body[amp + 1]!.toLowerCase(), accel };
}

const BUTTON_KINDS: Record<number, ControlKind> = { 0: 'push', 1: 'default', 2: 'check', 3: 'check', 4: 'radio', 5: 'check', 6: 'check', 7: 'group', 9: 'radio', 0xb: 'ownerdraw' };

function kindOf(c: ControlTemplate): ControlKind {
  switch (c.cls) {
    case 'button': return BUTTON_KINDS[c.style & 0xF] ?? 'push';
    case 'static': return 'text';
    case 'edit': return 'edit';
    case 'listbox': case 'combobox': return 'list';
    case 'SysTabControl32': return 'tab';
    default: return 'other';
  }
}

export function layoutDialog(t: DialogTemplate, m: Metrics): DialogLayout {
  const size = duToPx(m, 0, 0, t.cx, t.cy);
  const controls = t.items.map((c): LaidControl => {
    const box = duToPx(m, c.x, c.y, c.cx, c.cy), mn = mnemonic(c.text ?? '');
    const ss = c.style & 0x3;
    return { ...box, id: c.id, cls: c.cls, kind: kindOf(c), style: c.style, label: mn.label, ul: mn.ul, key: mn.key, align: c.cls === 'static' ? (ss === 1 ? 'center' : ss === 2 ? 'right' : 'left') : 'left' };
  });
  return { width: size.width, height: size.height, title: t.title, controls };
}
