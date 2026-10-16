import { describe, expect, it } from 'vitest';
import { newCampaign } from '../src/game/campaign';
import { encodeSave, SaveError } from '../src/save/format';
import { MemoryBackend, SaveStore, SLOT_COUNT } from '../src/save/store';

const bytesFor = (title: string) => { const c = newCampaign(); c.episode = title; c.stage = 2; return encodeSave(c, new Date(2026, 0, 2)); };

describe('SaveStore', () => {
  it('writes, lists and reads 32 slots; empty slots are null', async () => {
    const store = new SaveStore(new MemoryBackend());
    expect(await store.summaries()).toHaveLength(SLOT_COUNT);
    await store.write(3, bytesFor('셋'));
    await store.write(30, bytesFor('자동'));
    const s = await store.summaries();
    expect(s[3]?.title).toBe('셋'); expect(s[30]?.title).toBe('자동'); expect(s[0]).toBeNull();
    expect((await store.read(3))?.length).toBe(6848);
    expect(await store.read(4)).toBeNull();
    await store.remove(3);
    expect((await store.summaries())[3]).toBeNull();
  });
  it('a slot whose bytes are not a save file is listed as broken, not as empty', async () => {
    const backend = new MemoryBackend();
    await backend.put(5, new Uint8Array(100));
    const s = await new SaveStore(backend).summaries();
    expect(s[5]).toMatchObject({ broken: true });
    expect(s[4]).toBeNull();
  });
  it('refuses bytes that are not a save file and slots outside 0..31', async () => {
    const store = new SaveStore(new MemoryBackend());
    await expect(store.write(1, new Uint8Array(10))).rejects.toBeInstanceOf(SaveError);
    await expect(store.write(32, bytesFor('x'))).rejects.toBeInstanceOf(RangeError);
    await expect(store.read(-1)).rejects.toBeInstanceOf(RangeError);
  });
  it('importBytes validates, stores and returns the summary; fileName follows the original pattern', async () => {
    const store = new SaveStore(new MemoryBackend());
    const sum = await store.importBytes(7, bytesFor('가져옴'));
    expect(sum.title).toBe('가져옴');
    expect((await store.summaries())[7]?.stage).toBe(2);
    expect(SaveStore.fileName(7)).toBe('save07.dat');
    expect(SaveStore.fileName(30)).toBe('save30.dat');
  });
});
