import { afterEach, describe, expect, it, vi } from 'vitest';
import { BitmapCache } from '../src/assets/bitmaps';
import { AssetLoader } from '../src/assets/loader';
import { SpriteCache } from '../src/game/spriteCache';
import { Dialogs } from '../src/ui/win/dialog';

afterEach(() => { vi.unstubAllGlobals(); });

describe('inflight counters (the auto-play clock waits while assets load)', () => {
  it('AssetLoader.inflight counts fetches from start to settle', async () => {
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal('fetch', async () => { await gate; return new Response(new Uint8Array([0]), { status: 200 }); });
    const a = new AssetLoader('x');
    const p = a.image('bmp', 'a').catch(() => null);
    expect(a.inflight).toBe(1);
    release(); await p;
    expect(a.inflight).toBe(0);
  });
  it('BitmapCache.inflight is the number of images still loading', () => {
    const images: { onload: (() => void) | null }[] = [];
    vi.stubGlobal('Image', class { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_v: string) { images.push(this); } });
    const b = new BitmapCache('x', new Set(['a', 'b']));
    b.get('a'); b.get('b');
    expect(b.inflight).toBe(2);
    images[0]!.onload!();
    return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => expect(b.inflight).toBe(1));
  });
  it('SpriteCache.inflight counts APDs still loading and drops them when they settle', async () => {
    let resolveApd!: (v: never) => void;
    const loader = { apd: () => new Promise<never>((r) => { resolveApd = r; }), image: () => Promise.reject(new Error('no')) } as unknown as ConstructorParameters<typeof SpriteCache>[0];
    const s = new SpriteCache(loader, {} as ConstructorParameters<typeof SpriteCache>[1], new Set(['x']), () => {});
    s.apd('x');
    expect(s.inflight).toBe(1);
    resolveApd({ sheets: [] } as never);
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
    expect(s.inflight).toBe(0);
  });
});

describe('Dialogs.openedCount / top', () => {
  const layer = { ownerDocument: { addEventListener() {} }, addEventListener() {} } as unknown as HTMLElement;
  it('openedCount counts every box ever opened and never goes down; top is the newest open box', () => {
    const d = new Dialogs(layer, {});
    const a = { el: { id: 'a' }, cancel() {} } as unknown as Parameters<Dialogs['opened']>[0], b = { el: { id: 'b' }, cancel() {} } as unknown as Parameters<Dialogs['opened']>[0];
    expect(d.openedCount).toBe(0); expect(d.top).toBeNull();
    d.opened(a); d.opened(b);
    expect(d.openedCount).toBe(2); expect(d.top).toBe(b.el);
    d.closed(b);
    expect(d.openedCount).toBe(2); expect(d.top).toBe(a.el);
  });
});
