import { describe, expect, it } from 'vitest';
import { clampCamera, fitScale } from '../src/viewer/scale';

describe('fitScale', () => {
  it('picks the largest integer scale that fits', () => {
    expect(fitScale(1920, 1080)).toBe(2);
    expect(fitScale(2000, 1500)).toBe(3);
    expect(fitScale(1279, 960)).toBe(1);
  });
  it('never goes below 1', () => {
    expect(fitScale(320, 200)).toBe(1);
  });
});

describe('clampCamera', () => {
  it('keeps the viewport inside the map pixel area', () => {
    expect(clampCamera(-10, -11, 1344, 896)).toEqual({ x: 0, y: 0 });
    expect(clampCamera(5000, 5000, 1344, 896)).toEqual({ x: 1344 - 640, y: 896 - 480 });
    expect(clampCamera(100, 50, 1344, 896)).toEqual({ x: 100, y: 50 });
  });
  it('is always (0, 0) for a 640×480 map', () => {
    expect(clampCamera(64, 48, 640, 480)).toEqual({ x: 0, y: 0 });
  });
  it('rounds to whole map pixels (dragging at 2× or 3× scale produces fractions)', () => {
    expect(clampCamera(10.5, 20.4, 1344, 896)).toEqual({ x: 11, y: 20 });
    expect(clampCamera(703.6, 415.5, 1344, 896)).toEqual({ x: 704, y: 416 });
  });
});

describe('frameScale', () => {
  it('is the largest integer scale at which the 640×480 surface plus the menu bar fits', async () => {
    const { frameScale, MENU_BAR_H } = await import('../src/viewer/scale');
    expect(MENU_BAR_H).toBe(19);
    expect(frameScale(1280, 998)).toBe(2);                                  // 2 × 499 = 998 fits exactly
    expect(frameScale(1280, 997)).toBe(1);                                  // one row short of two rows of menu bar
    expect(frameScale(640, 499)).toBe(1);
    expect(frameScale(100, 100)).toBe(1);                                   // never below 1: the page scrolls instead
  });
});
