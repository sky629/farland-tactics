import { describe, expect, it } from 'vitest';
import { Effects, FADE_STEP_MS } from '../src/field/effects';

describe('Effects', () => {
  it('fades out to black over step × 30 ms and reports busy until done; step 0 is instant', () => {
    const fx = new Effects();
    fx.fade('out', 8, 1000);
    expect(fx.fadeBusy()).toBe(true);
    expect(fx.snapshot(1000).fade).toEqual({ color: 'black', alpha: 0 });
    expect(fx.snapshot(1000 + 4 * FADE_STEP_MS).fade?.alpha).toBeCloseTo(0.5);
    expect(fx.snapshot(1000 + 8 * FADE_STEP_MS).fade).toEqual({ color: 'black', alpha: 1 });
    expect(fx.fadeBusy()).toBe(false);
    fx.fade('in', 0, 2000);
    expect(fx.snapshot(2000).fade).toBeNull();
    expect(fx.fadeBusy()).toBe(false);
  });
  it('showImage with a step fades the image in from black; a missing image still completes its fade', () => {
    const fx = new Effects();
    fx.showImage(null, 4, 0);
    expect(fx.snapshot(0)).toMatchObject({ image: null, fade: { color: 'black', alpha: 1 } });
    expect(fx.snapshot(4 * FADE_STEP_MS).fade).toBeNull();
    expect(fx.fadeBusy()).toBe(false);
    const img = {} as CanvasImageSource;
    fx.showImage(img, 0, 500);
    expect(fx.snapshot(500)).toMatchObject({ image: img, fade: null });
    fx.hideImage();
    expect(fx.snapshot(501).image).toBeNull();
  });
  it('tints map to overlay colours and reset clears them; FLASH_WHITE fades to white', () => {
    const fx = new Effects();
    fx.tint('dim', 1);
    expect(fx.snapshot(0).tint).toEqual({ color: '#000', alpha: 0.4 });
    fx.tint('sunset', 1);
    expect(fx.snapshot(0).tint?.color).toBe('#f80');
    fx.tint('reset', 0);
    expect(fx.snapshot(0).tint).toBeNull();
    fx.tint('white', 4);
    expect(fx.snapshot(0).fade).toEqual({ color: 'white', alpha: 0 });
  });
  it('shake offsets the camera while active; scroll moves the camera toward the target cell and stops there', () => {
    const fx = new Effects();
    const clamp = (x: number, y: number) => ({ x, y });
    fx.shake(6);
    const shaken = fx.update(100, { x: 100, y: 100 }, clamp);
    expect(Math.abs(shaken.x - 100) + Math.abs(shaken.y - 100)).toBeGreaterThan(0);
    fx.shake(0);
    expect(fx.update(200, { x: 100, y: 100 }, clamp)).toEqual({ x: 100, y: 100 });
    fx.startScroll(16, 0, 5, 5, 100, () => ({ x: 480, y: 340 }));    // target cell centre → camera (160, 100) at 640×480
    expect(fx.scrollBusy()).toBe(true);
    let cam = { x: 100, y: 100 };
    for (let t = 300; t <= 1000; t += 100) cam = fx.update(t, cam, clamp);
    expect(cam.x).toBe(160);
    expect(fx.scrollBusy()).toBe(false);
  });
});
