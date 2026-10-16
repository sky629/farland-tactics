import { describe, expect, it } from 'vitest';
import { isSoundfont } from '../src/audio/spessa';

describe('soundfont response check', () => {
  it('accepts RIFF files (SF2/SF3) and rejects HTML or short bodies (the dev server answers missing files with index.html)', () => {
    const riff = new TextEncoder().encode('RIFF\0\0\0\0sfbk....').buffer;
    expect(isSoundfont(riff)).toBe(true);
    expect(isSoundfont(new TextEncoder().encode('<!doctype html><html>…</html>').buffer)).toBe(false);
    expect(isSoundfont(new ArrayBuffer(3))).toBe(false);
  });
});
