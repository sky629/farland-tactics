import { describe, expect, it } from 'vitest';
import { isSoundfont } from '../src/audio/spessa';

import { synthNotice } from '../src/audio/spessa';

describe('the music notice names the cause', () => {
  it('soundfont missing → the download command; synthesizer failed → the browser; ready → no notice', () => {
    expect(synthNotice('soundfont')).toContain('tools/ft2_soundfont.py');
    expect(synthNotice('synth')).toContain('합성기');
    expect(synthNotice(null)).toBeNull();
  });
});

describe('soundfont response check', () => {
  it('accepts RIFF files (SF2/SF3) and rejects HTML or short bodies (the dev server answers missing files with index.html)', () => {
    const riff = new TextEncoder().encode('RIFF\0\0\0\0sfbk....').buffer;
    expect(isSoundfont(riff)).toBe(true);
    expect(isSoundfont(new TextEncoder().encode('<!doctype html><html>…</html>').buffer)).toBe(false);
    expect(isSoundfont(new ArrayBuffer(3))).toBe(false);
  });
});
