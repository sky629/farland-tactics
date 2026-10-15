import { describe, expect, it, vi } from 'vitest';
import type { AssetIndex } from '../src/assets/types';
import { pickDefault, startViewer, type StartupDeps } from '../src/viewer/startup';

const index: AssetIndex = { format: 1, maps: ['stage01', 'stage02'], sprites: ['aid', 'char_01a'] };

function deps(over: Partial<StartupDeps> = {}): StartupDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    index: vi.fn(async () => { calls.push('index'); return index; }),
    populate: vi.fn((_i, d) => { calls.push(`populate ${d.map}/${d.sprite}`); }),
    loadMap: vi.fn(async (n: string) => { calls.push(`map ${n}`); }),
    loadApd: vi.fn(async (n: string) => { calls.push(`apd ${n}`); }),
    startLoop: vi.fn(() => { calls.push('loop'); }),
    onError: vi.fn((e: unknown) => { calls.push(`error ${(e as Error).message}`); }),
    ...over,
  };
}

describe('pickDefault', () => {
  it('prefers the named asset and falls back to the first one', () => {
    expect(pickDefault(['a', 'stage02'], 'stage02')).toBe('stage02');
    expect(pickDefault(['a', 'b'], 'stage02')).toBe('a');
    expect(pickDefault([], 'stage02')).toBeUndefined();
  });
});

describe('startViewer', () => {
  it('starts the render loop first, then loads the default map and sprite', async () => {
    const d = deps();
    await startViewer(d);
    expect(d.calls).toEqual(['loop', 'index', 'populate stage02/char_01a', 'map stage02', 'apd char_01a']);
  });
  it('keeps the loop running and still loads the sprite when the map fails', async () => {
    const d = deps({ loadMap: vi.fn(async () => { throw new Error('map boom'); }) });
    await startViewer(d);
    expect(d.startLoop).toHaveBeenCalledTimes(1);
    expect(d.loadApd).toHaveBeenCalledWith('char_01a');
    expect(d.calls).toContain('error map boom');
  });
  it('reports an index failure and still has the loop running', async () => {
    const d = deps({ index: vi.fn(async () => { throw new Error('no index'); }) });
    await startViewer(d);
    expect(d.calls).toEqual(['loop', 'error no index']);
  });
});
