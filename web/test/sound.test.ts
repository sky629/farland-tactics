import { describe, expect, it } from 'vitest';
import { SoundPlayer } from '../src/audio/sound';
import type { AudioOut, Voice } from '../src/audio/types';

class FakeVoice implements Voice { done = false; stopped = false; stop(): void { this.stopped = true; this.done = true; } }
class FakeOut implements AudioOut {
  voices: { name: string; voice: FakeVoice }[] = [];
  decoded: string[] = [];
  volume = 1;
  async decode(name: string): Promise<unknown | null> { this.decoded.push(name); return name === 'missing' ? null : { name }; }
  play(buffer: unknown): Voice { const v = new FakeVoice(); this.voices.push({ name: (buffer as { name: string }).name, voice: v }); return v; }
  setVolume(v: number): void { this.volume = v; }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SoundPlayer (FUN_0040d950 channel rules)', () => {
  it('takes the first free channel; the 17th sound cuts channel 0; finished voices free their channel', async () => {
    const out = new FakeOut(), log: string[] = [];
    const p = new SoundPlayer(out, new Set(['a', 'b', 'hit']), (k, s) => log.push(`${k}:${s}`));
    for (let i = 0; i < 16; i++) p.play('a');                                    // one file: voices start in channel order
    await flush();
    expect(out.voices).toHaveLength(16);
    p.play('hit'); await flush();
    expect(out.voices).toHaveLength(17);
    expect(out.voices[0]!.voice.stopped).toBe(true);                           // channel 0 was cut for the new sound
    out.voices[3]!.voice.done = true;                                          // channel 3 finished
    p.play('a'); await flush();
    expect(out.voices[17]!.name).toBe('a');
    expect(p.channelOf(out.voices[17]!.voice)).toBe(3);
    expect(log).toEqual([]);
  });
  it('"*name" always plays on channel 0 and stops what was there; "" only stops channel 0', async () => {
    const out = new FakeOut();
    const p = new SoundPlayer(out, new Set(['door', 'hit']), () => {});
    p.play('door'); p.play('hit'); await flush();
    p.play('*door'); await flush();
    expect(out.voices[0]!.voice.stopped).toBe(true);
    expect(out.voices[1]!.voice.stopped).toBe(false);
    expect(p.channelOf(out.voices[2]!.voice)).toBe(0);
    p.play(''); await flush();
    expect(out.voices[2]!.voice.stopped).toBe(true);
    expect(out.voices).toHaveLength(3);
  });
  it('decodes each file once, warns once for an unknown name, and sets the volume on the effects bus', async () => {
    const out = new FakeOut(), log: string[] = [];
    const p = new SoundPlayer(out, new Set(['hit', 'missing']), (k, s) => log.push(`${k}:${s}`));
    p.volume = 0.5;
    p.play('hit'); p.play('hit'); p.play('nope'); p.play('nope'); p.play('missing'); await flush();
    expect(out.decoded).toEqual(['hit', 'missing']);
    expect(out.voices).toHaveLength(2);
    expect(out.volume).toBe(0.5);                                              // the bus, so running sounds follow the slider too
    expect(log.filter((l) => l.startsWith('warn'))).toHaveLength(2);           // 'nope' once, 'missing' (decode failed) once
    p.play('nope'); p.play('missing'); await flush();
    expect(log.filter((l) => l.startsWith('warn'))).toHaveLength(2);
  });
  it('stopAll cuts every channel', async () => {
    const out = new FakeOut();
    const p = new SoundPlayer(out, new Set(['a']), () => {});
    p.play('a'); p.play('a'); await flush();
    p.stopAll();
    expect(out.voices.every((v) => v.voice.stopped)).toBe(true);
  });
});
