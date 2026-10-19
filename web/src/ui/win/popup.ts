/**
 * The battle's right-click popup, as FT2.exe builds it (FUN_00430c80, strings 0x44bb64..0x44bbbc): above the 맵 menu's own items
 * it inserts, for the party unit under the cursor,
 *   "%s의 행동\t(HP:%d/%d)"            — the unit acts (greyed once it has moved, or while incapacitated)
 *   "%s의 마법/특기\t(MP:%d/%d)" ▸      — one entry per spell "%s(%s)\tMP:%d" (greyed below the MP), the whole list greyed once acted or silenced
 *   "도구를 사용하다(&U)" ▸             — one entry per usable stack "%s\t%3d개", greyed once acted
 *   a separator.
 * Attacks are not a menu item: the original attacks by clicking the target ("공격할 상대 또는 이동할 곳을 클릭해 주십시오").
 * The tab in the format strings is Win32's right-aligned column; here it is the item's `accel` text.
 */
import { usableItems, type Inventory } from '../../battle/inventory';
import type { Command } from '../../battle/types';
import type { Unit } from '../../battle/unit';
import type { Tables } from '../../data/types';
import { unitName } from '../names';
import { buildMenuList, mnemonicItem, type MenuItem } from './menubar';
import { FACILITY_BASE } from './commands';

export interface PopupItem extends MenuItem { cmd?: Command; items?: PopupItem[] }

const HELPLESS = new Set([1, 3, 4, 5, 8, 9]);                                 // dead, asleep, stone, frozen, held, hidden: the original's grey list

export function unitPopupItems(u: Unit, inv: Inventory, tables: Tables): PopupItem[] {
  const name = unitName(u, tables), helpless = HELPLESS.has(u.status);
  const spells = u.spells.filter((m) => m !== 0 && tables.magic[m] !== undefined).map((m): PopupItem => {
    const magic = tables.magic[m]!, cost = Math.abs(magic.mp_cost);
    return { label: `${magic.name}(${magic.short})`, ul: -1, key: null, accel: `MP:${cost}`, id: 5000 + m, enabled: u.mp >= cost, separator: false, cmd: { type: 'beginTarget', action: m } };
  });
  const items = usableItems(inv, tables.item).map((s): PopupItem => ({ label: tables.item[s.id]!.name, ul: -1, key: null, accel: `${String(s.count).padStart(3, ' ')}개`, id: 6000 + s.id, enabled: true, separator: false, cmd: { type: 'beginTarget', action: 1000 + s.id } }));
  const tool = mnemonicItem('도구를 사용하다(&U)');
  return [
    { label: `${name}의 행동`, ul: -1, key: null, accel: `(HP:${u.hp}/${u.hpMax})`, id: 102, enabled: !u.moved && !helpless, separator: false, cmd: { type: 'beginMove' } },
    { label: `${name}의 마법/특기`, ul: -1, key: null, accel: `(MP:${u.mp}/${u.mpMax})`, id: null, enabled: !u.acted && !helpless && u.status !== 6 && spells.length > 0, separator: false, items: spells },
    { ...tool, id: null, enabled: !u.acted && !helpless && items.length > 0, separator: false, items },
    { label: '-', ul: -1, key: null, accel: null, id: null, enabled: false, separator: true },
  ];
}

/**
 * The town's right-click popup (FUN_0042b620): '이동하다(&M)' ▸ the facilities the town flags open (hotspot table order, command
 * 7000 + index), then a separator; the caller appends the 시스템 popup's items (갈 수 있는 장소 표시, 유니트 일람, 전 화면 표시, 시스템 ▸).
 */
export function townPopupItems(hotspots: { name: string }[], flags: number[]): PopupItem[] {
  const open = hotspots.map((h, i) => ({ h, i })).filter(({ i }) => (flags[i] ?? 0) !== 0);
  const places: PopupItem[] = open.map(({ h, i }) => ({ label: h.name, ul: -1, key: null, accel: null, id: FACILITY_BASE + i, enabled: true, separator: false }));
  return [
    { ...mnemonicItem('이동하다(&M)'), id: null, enabled: places.length > 0, separator: false, items: places },
    { label: '-', ul: -1, key: null, accel: null, id: null, enabled: false, separator: true },
  ];
}

/** Every enabled leaf with an id, by id — what a click in the popup can pick (a unit entry with a battle command, a menu item, a facility). */
export function pickable(items: PopupItem[]): Map<number, PopupItem> {
  const out = new Map<number, PopupItem>();
  const walk = (list: PopupItem[]) => { for (const it of list) { if (it.items) walk(it.items); else if (it.id !== null && it.enabled && !it.separator) out.set(it.id, it); } };
  walk(items);
  return out;
}

/** A popup menu at a point of the game frame; resolves with the picked item, or null on Esc, a click elsewhere or a right click. */
export class PopupMenu {
  private box: HTMLElement | null = null;
  private settle: ((v: PopupItem | null) => void) | null = null;
  constructor(private readonly layer: HTMLElement) {}
  get isOpen(): boolean { return this.box !== null; }
  open(x: number, y: number, items: PopupItem[]): Promise<PopupItem | null> {
    this.close(null);
    const doc = this.layer.ownerDocument;
    const picks = pickable(items);
    const box = buildMenuList(doc, items, (id) => this.close(picks.get(id) ?? null));
    box.style.left = `${x}px`; box.style.top = `${y}px`;
    this.layer.appendChild(box); this.box = box;
    const w = box.offsetWidth, h = box.offsetHeight, W = this.layer.clientWidth, H = this.layer.clientHeight;   // keep it inside the frame
    if (x + w > W) box.style.left = `${Math.max(0, W - w)}px`;
    if (y + h > H) box.style.top = `${Math.max(0, H - h)}px`;
    const onDown = (e: MouseEvent) => { if (this.box && !this.box.contains(e.target as Node)) this.close(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { this.close(null); e.stopPropagation(); } };
    doc.addEventListener('mousedown', onDown, true); doc.addEventListener('keydown', onKey, true);
    return new Promise((resolve) => { this.settle = (v) => { doc.removeEventListener('mousedown', onDown, true); doc.removeEventListener('keydown', onKey, true); resolve(v); }; });
  }
  close(value: PopupItem | null): void { this.box?.remove(); this.box = null; const s = this.settle; this.settle = null; s?.(value); }
}
