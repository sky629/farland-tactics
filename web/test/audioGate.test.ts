import { describe, expect, it } from 'vitest';
import { AudioGate } from '../src/audio/gate';
import { MusicPlayer } from '../src/audio/music';
import { SoundPlayer } from '../src/audio/sound';
import type { AudioOut, Synth, Voice } from '../src/audio/types';

class FakeOut implements AudioOut {
  voices: string[] = [];
  volume = 1;
  async decode(name: string): Promise<unknown | null> { return { name }; }
  play(buffer: unknown): Voice { this.voices.push((buffer as { name: string }).name); return { done: false, stop() { /* test */ } }; }
  setVolume(v: number): void { this.volume = v; }
}
class FakeSynth implements Synth {
  ready = false;
  calls: [string, ...unknown[]][] = [];
  play(song: number, loop: boolean): void { this.calls.push(['play', song, loop]); }
  stop(): void { this.calls.push(['stop']); }
  setGain(v: number): void { this.calls.push(['gain', v]); }
}
const flush = () => new Promise((r) => setTimeout(r, 0));
function rig() {
  const out = new FakeOut(), synth = new FakeSynth(), log: string[] = [];
  const sounds = new SoundPlayer(out, new Set(['a']), (k, t) => log.push(`${k}:${t}`));
  const music = new MusicPlayer(synth, (k, t) => log.push(`${k}:${t}`));
  return { out, synth, log, sounds, music, gate: new AudioGate() };
}

describe('AudioGate (sound before it can be heard)', () => {
  it('before the gesture SOUND is dropped and the last MUSIC waits; after unlock sounds play while the synthesizer still loads', async () => {
    const r = rig();
    r.gate.playSound('a'); r.gate.playMusic(3); r.gate.playMusic(5);
    await flush();
    expect(r.out.voices).toEqual([]);
    expect(r.gate.current).toBe(5);
    r.gate.unlock({ sounds: r.sounds, music: r.music });
    r.gate.playSound('a'); await flush();
    expect(r.out.voices).toEqual(['a']);                                       // effects do not wait for the soundfont
    expect(r.synth.calls).toEqual([]);                                         // the song waits
    r.synth.ready = true; r.gate.synthSettled();
    expect(r.synth.calls).toContainEqual(['play', 5, true]);
    expect(r.gate.settled).toBe(true);
    expect(r.gate.current).toBe(5);
  });
  it('a fade-out before the synthesizer is ready discards the waiting song and is never busy', () => {
    const r = rig();
    r.gate.unlock({ sounds: r.sounds, music: r.music });
    r.gate.playMusic(2); r.gate.fadeMusic(2000, false, 0);
    expect(r.gate.fadeBusy()).toBe(false);
    expect(r.gate.current).toBe(-1);
    r.synth.ready = true; r.gate.synthSettled();
    expect(r.synth.calls.filter((c) => c[0] === 'play')).toEqual([]);
  });
  it('stop before the synthesizer is ready discards the waiting song; a fade-in keeps it', () => {
    const a = rig();
    a.gate.unlock({ sounds: a.sounds, music: a.music });
    a.gate.playMusic(4); a.gate.stopMusic();
    a.synth.ready = true; a.gate.synthSettled();
    expect(a.synth.calls.filter((c) => c[0] === 'play')).toEqual([]);
    const b = rig();
    b.gate.unlock({ sounds: b.sounds, music: b.music });
    b.gate.playMusic(2); b.gate.fadeMusic(2000, true, 0);
    b.synth.ready = true; b.gate.synthSettled();
    expect(b.synth.calls).toContainEqual(['play', 2, true]);
  });
  it('volumes set before the gesture apply at unlock', () => {
    const r = rig();
    r.gate.setVolumes(0.5, 0.25);
    r.gate.unlock({ sounds: r.sounds, music: r.music });
    expect(r.music.volume).toBe(0.5);
    expect(r.out.volume).toBe(0.25);
  });
  it('once settled, calls go straight to the players', () => {
    const r = rig();
    r.gate.unlock({ sounds: r.sounds, music: r.music });
    r.synth.ready = true; r.gate.synthSettled();
    r.gate.playMusic(1);
    expect(r.synth.calls).toContainEqual(['play', 1, true]);
    r.gate.fadeMusic(1000, false, 0);
    expect(r.gate.fadeBusy()).toBe(true);
    r.gate.update(1000);
    expect(r.gate.fadeBusy()).toBe(false);
    expect(r.gate.current).toBe(-1);
  });
  it('when the synthesizer failed, the waiting song reaches the player, which warns once', () => {
    const r = rig();
    r.gate.unlock({ sounds: r.sounds, music: r.music });
    r.gate.playMusic(2);
    r.gate.synthSettled();                                                     // ready stays false
    expect(r.synth.calls.filter((c) => c[0] === 'play')).toEqual([]);
    expect(r.log.filter((l) => l.startsWith('warn'))).toHaveLength(1);
    r.gate.playMusic(3);
    expect(r.log.filter((l) => l.startsWith('warn'))).toHaveLength(1);
  });
});
