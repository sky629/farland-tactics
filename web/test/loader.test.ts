import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetError, AssetLoader } from '../src/assets/loader';
import { makePng, PAL4 } from './helpers/makePng';

function stubFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const make = routes[url];
    return make ? make() : new Response('not found', { status: 404 });
  }));
  return calls;
}
const json = (x: unknown) => () => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('AssetLoader', () => {
  it('loads and validates map JSON', async () => {
    stubFetch({ 'assets/map/stage02.json': json({ w: 1, h: 1, bg: null, layers: [], start: [0, 0], origin: [0, 0], pixelSize: [640, 480], cells: [], cellAt: [] }) });
    const m = await new AssetLoader().map('stage02');
    expect(m.pixelSize).toEqual([640, 480]);
  });
  it('turns HTTP errors into AssetError naming the asset path', async () => {
    stubFetch({});
    await expect(new AssetLoader().map('stage99')).rejects.toThrow(AssetError);
    await expect(new AssetLoader().map('stage99')).rejects.toThrow('assets/map/stage99.json: HTTP 404');
  });
  it('turns a bad JSON shape into AssetError', async () => {
    stubFetch({ 'assets/sprite/x.json': json({ version: 3, sheets: 'oops' }) });
    await expect(new AssetLoader().apd('x')).rejects.toThrow(/sheets/);
  });
  it('decodes PNG images and caches them per (kind, name)', async () => {
    const png = makePng(2, 1, [0, 3], PAL4);
    const calls = stubFetch({ 'assets/sprite/char_01a.png': () => new Response(png, { status: 200 }) });
    const loader = new AssetLoader();
    const [a, b] = await Promise.all([loader.image('sprite', 'char_01a'), loader.image('sprite', 'char_01a')]);
    expect(a).toBe(b);
    expect(Array.from(a.indices)).toEqual([0, 3]);
    expect(calls).toEqual(['assets/sprite/char_01a.png']);
  });
  it('reads the index', async () => {
    stubFetch({ 'assets/index.json': json({ format: 1, maps: ['stage02'], sprites: [] }) });
    expect((await new AssetLoader().index()).maps).toEqual(['stage02']);
  });
});
