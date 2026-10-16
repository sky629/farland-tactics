import type { MusicPlayer } from './music';
import type { SoundPlayer } from './sound';

export interface GatedAudio { sounds: SoundPlayer; music: MusicPlayer }

/**
 * Sound before it can be heard (spec §7). Before the first user gesture there is no AudioContext: SOUND is dropped and
 * the last MUSIC waits. After the gesture the effects play at once while the synthesizer still loads its soundfont, so
 * MUSIC keeps waiting until init settles — then the song starts, or the MusicPlayer warns once. MUSIC -1, stop and a
 * fade-out discard the waiting song; a fade is never busy for a song that has not started.
 */
export class AudioGate {
  private audio: GatedAudio | null = null;
  private pending: number | null = null;
  private isSettled = false;
  private volumes = { music: 1, sound: 1 };

  /** true once the synthesizer init finished (ready or not): the page shows its notice then. */
  get settled(): boolean { return this.isSettled; }
  get current(): number { return this.live ? this.audio!.music.current : (this.pending ?? -1); }
  private get live(): boolean { return this.audio !== null && this.isSettled; }

  unlock(audio: GatedAudio): void {
    this.audio = audio;
    audio.music.volume = this.volumes.music; audio.sounds.volume = this.volumes.sound;
  }
  synthSettled(): void {
    this.isSettled = true;
    if (this.audio && this.pending !== null) this.audio.music.play(this.pending);
    this.pending = null;
  }

  playSound(name: string): void { this.audio?.sounds.play(name); }
  playMusic(n: number): void {
    if (this.live) this.audio!.music.play(n);
    else this.pending = n < 0 ? null : n;
  }
  stopMusic(): void { this.pending = null; if (this.live) this.audio!.music.stop(); }
  fadeMusic(ms: number, on: boolean, now: number): void {
    if (this.live) this.audio!.music.fade(ms, on, now);
    else if (!on) this.pending = null;
  }
  fadeBusy(): boolean { return this.live ? this.audio!.music.fadeBusy() : false; }
  update(now: number): void { if (this.live) this.audio!.music.update(now); }
  setVolumes(music: number, sound: number): void {
    this.volumes = { music, sound };
    if (this.audio) { this.audio.music.volume = music; this.audio.sounds.volume = sound; }
  }
}
