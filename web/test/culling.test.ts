import { describe, expect, it } from 'vitest';
import { rectVisible } from '../src/render/culling';

describe('rectVisible', () => {
  it('is true when the rect overlaps the 640×480 viewport at the camera', () => {
    expect(rectVisible(0, 0, 64, 32, 0, 0)).toBe(true);
    expect(rectVisible(630, 470, 64, 32, 0, 0)).toBe(true);    // partially inside
    expect(rectVisible(1000, 1000, 64, 32, 400, 600)).toBe(true);
  });
  it('is false when the rect is fully outside', () => {
    expect(rectVisible(640, 0, 64, 32, 0, 0)).toBe(false);     // touching the right edge is outside
    expect(rectVisible(-64, 0, 64, 32, 0, 0)).toBe(false);
    expect(rectVisible(0, 0, 64, 32, 700, 0)).toBe(false);
  });
});
