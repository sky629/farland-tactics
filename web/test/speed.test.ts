import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/play/clock';
import { accelOf, menuModel, type MenuTemplate } from '../src/ui/win/menubar';
import { addSpeedMenu, nextSpeed, SPEED_IDS, speedBadge, speedOfId } from '../src/ui/win/speed';
import { fakeDocument } from './helpers/fakeDom';
import menu103 from './helpers/menu103.json';

const menu = menu103 as MenuTemplate;

describe('GameClock: game time from the frame timestamps', () => {
  it('starts at 0 and advances by the real interval times the speed', () => {
    const c = new GameClock();
    expect(c.at(1000)).toBe(0);
    expect(c.at(1016)).toBe(16);
    c.speed = 2;
    expect(c.at(1032)).toBe(48);                 // 16 real ms count double
    c.speed = 4;
    expect(c.at(1042)).toBe(88);                 // 10 real ms count fourfold; no jump when the speed changes
    c.speed = 1;
    expect(c.at(1042)).toBe(88);
    expect(c.at(1000)).toBe(88);                 // a timestamp that runs backwards adds nothing
    expect(c.at(1010)).toBe(98);
  });
  it('the speeds cycle 1 → 2 → 4 → 1 and the menu ids map back', () => {
    expect(nextSpeed(1)).toBe(2); expect(nextSpeed(2)).toBe(4); expect(nextSpeed(4)).toBe(1);
    expect(speedOfId(SPEED_IDS[2])).toBe(2);
    expect(speedOfId(40012)).toBeNull();
  });
});

describe('the 배속 submenu', () => {
  it('sits after 환경설정 in every 시스템 menu (the bar\'s and the right-click popup\'s), with the current speed checked; F6 is the page\'s own key', () => {
    const m = menuModel(menu, {}, false);
    addSpeedMenu(m, 2);
    const sys = m.bar[0]!.items.find((i) => i.label === '시스템(S)')!.items!;
    const at = sys.findIndex((i) => i.id === 40012);
    expect(sys[at + 1]).toMatchObject({ label: '배속(X)', key: 'x', enabled: true });
    expect(sys[at + 1]!.items!.map((i) => [i.label, i.id, i.checked])).toEqual([['1배(1)', SPEED_IDS[1], false], ['2배(2)', SPEED_IDS[2], true], ['4배(4)', SPEED_IDS[4], false]]);
    expect(sys[at + 2]).toMatchObject({ id: 40004 });                                  // 게임종료 follows
    const popupSys = m.popups['시스템']!.items.find((i) => i.label === '시스템(S)')!.items!;
    expect(popupSys.some((i) => i.label === '배속(X)')).toBe(true);
    expect(accelOf(m, 'F6', false)).toBeNull();
  });
});

describe('the 배속 badge in the game window', () => {
  it('shows the current speed and a click asks for the next one; set() redraws it', () => {
    let cycles = 0;
    const b = speedBadge(fakeDocument([]), 2, () => { cycles++; });
    expect(b.el.textContent).toBe('배속 2배');
    b.el.click();
    expect(cycles).toBe(1);
    b.set(4);
    expect(b.el.textContent).toBe('배속 4배');
  });
});
