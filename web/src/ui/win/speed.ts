/** 배속: the three speeds, their web-only menu ids, and the 배속 submenu added to the original's 시스템 menus (F6 cycles; the page handles the key). */
import type { MenuBarModel, MenuItem } from './menubar';

export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
export const SPEED_IDS: Record<Speed, number> = { 1: 50001, 2: 50002, 4: 50004 };   // the resource's ids are 40xxx, the facilities' 7000+
export const isSpeed = (x: unknown): x is Speed => (SPEEDS as readonly unknown[]).includes(x);
export const nextSpeed = (s: Speed): Speed => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]!;
export function speedOfId(id: number): Speed | null { return SPEEDS.find((s) => SPEED_IDS[s] === id) ?? null; }

/** Inserts 배속 ▸ 1배/2배/4배 (the current one checked) after 환경설정 in every 시스템 menu: the bar's and the right-click popup's. */
export function addSpeedMenu(m: MenuBarModel, speed: Speed): void {
  const sub = (): MenuItem => ({
    label: '배속(X)', ul: 3, key: 'x', accel: null, id: null, enabled: true, separator: false,
    items: SPEEDS.map((s) => ({ label: `${s}배(${s})`, ul: 3, key: String(s), accel: null, id: SPEED_IDS[s], enabled: true, separator: false, checked: s === speed })),
  });
  const visit = (items: MenuItem[]): void => {
    const at = items.findIndex((i) => i.id === 40012);
    if (at >= 0) items.splice(at + 1, 0, sub());
    for (const i of items) if (i.items) visit(i.items);
  };
  for (const p of [...m.bar, ...Object.values(m.popups)]) visit(p.items);
}
