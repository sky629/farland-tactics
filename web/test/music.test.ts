import { describe, expect, it } from 'vitest';
import { MusicPlayer } from '../src/audio/music';
import type { Synth } from '../src/audio/types';

class FakeSynth implements Synth {
  ready = true;
  calls: [string, ...unknown[]][] = [];
  gain = -1;
  play(song: number, loop: boolean): void { this.calls.push(['play', song, loop]); }
  stop(): void { this.calls.push(['stop']); }
  setGain(v: number): void { this.gain = v; this.calls.push(['gain', v]); }
}

describe('MusicPlayer (MUSIC / MUSIC_FADE / WAIT_MUSIC_FADE)', () => {
  it('plays a song once, looping, at full gain; the same song again is ignored; a negative number stops', () => {
    const s = new FakeSynth(), m = new MusicPlayer(s, () => {});
    m.play(6);
    expect(s.calls).toEqual([['gain', 1], ['play', 6, true]]);
    m.play(6);
    expect(s.calls.filter((c) => c[0] === 'play')).toHaveLength(1);           // not restarted (the gain is re-applied)
    expect(m.current).toBe(6);
    m.play(-1);
    expect(s.calls.at(-1)).toEqual(['stop']);
    expect(m.current).toBe(-1);
  });
  it('fades linearly; a fade-out ends in stop; WAIT_MUSIC_FADE sees fadeBusy until then', () => {
    const s = new FakeSynth(), m = new MusicPlayer(s, () => {});
    m.play(3);
    expect(m.fadeBusy()).toBe(false);
    m.fade(1000, false, 0);
    expect(m.fadeBusy()).toBe(true);
    m.update(500);
    expect(s.gain).toBeCloseTo(0.5, 5);
    m.update(1000);
    expect(s.gain).toBe(0);
    expect(s.calls.at(-1)).toEqual(['stop']);
    expect(m.fadeBusy()).toBe(false);
    expect(m.current).toBe(-1);
  });
  it('fade-in restores the gain; ms 0 is immediate; the volume scales every gain', () => {
    const s = new FakeSynth(), m = new MusicPlayer(s, () => {});
    m.volume = 0.5;
    m.play(2);
    expect(s.gain).toBe(0.5);
    m.fade(0, false, 0);
    expect(s.gain).toBe(0);
    expect(m.fadeBusy()).toBe(false);
    expect(m.current).toBe(-1);                                                // an immediate fade-out stops the song
    m.play(2);
    m.fade(400, true, 100); m.update(300);
    expect(s.gain).toBeCloseTo(0.25, 5);
    m.update(500);
    expect(s.gain).toBe(0.5);
    expect(m.fadeBusy()).toBe(false);
  });
  it('a new song cancels a running fade and starts at full gain', () => {
    const s = new FakeSynth(), m = new MusicPlayer(s, () => {});
    m.play(3); m.fade(2000, false, 0); m.update(1000);
    expect(s.gain).toBeCloseTo(0.5, 5);
    m.play(7);
    expect(m.fadeBusy()).toBe(false);
    expect(s.gain).toBe(1);
    expect(s.calls.at(-1)).toEqual(['play', 7, true]);
    m.update(3000);
    expect(m.current).toBe(7);                                                 // the old fade did not stop the new song
  });
  it('the same song during a fade-out cancels the fade and keeps playing', () => {
    const s = new FakeSynth(), m = new MusicPlayer(s, () => {});
    m.play(6); m.fade(2000, false, 0); m.update(1000);
    expect(s.gain).toBeCloseTo(0.5, 5);
    m.play(6);
    expect(m.fadeBusy()).toBe(false);
    expect(s.gain).toBe(1);
    expect(s.calls.filter((c) => c[0] === 'play')).toHaveLength(1);           // not restarted
    m.update(3000);
    expect(m.current).toBe(6);
  });
  it('without a ready synth, MUSIC logs once and nothing plays; fades are no-ops that never block', () => {
    const s = new FakeSynth(), log: string[] = []; s.ready = false;
    const m = new MusicPlayer(s, (k, t) => log.push(`${k}:${t}`));
    m.play(1); m.play(2);
    expect(s.calls).toEqual([]);
    expect(log).toHaveLength(1);
    m.fade(500, false, 0);
    expect(m.fadeBusy()).toBe(false);
  });
});
