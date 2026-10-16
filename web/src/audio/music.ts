import type { Synth } from './types';

/**
 * MUSIC / MUSIC_FADE / WAIT_MUSIC_FADE (analysis/save_sound_visual.md §2.1): one looping song at a time; the same number
 * does not restart it [추정]; a linear fade multiplies the volume, a fade-out ends in stop (FUN_00436500 semantics);
 * a new song cancels any fade (FUN_0042e8c0 clears DAT_0044b75c). Without a ready synthesizer every call is a logged no-op.
 */
export class MusicPlayer {
  private song = -1;
  private level = 1;                                                           // fade multiplier 0..1
  private fadeState: { from: number; to: number; start: number; ms: number } | null = null;
  private vol = 1;
  private warned = false;

  constructor(private readonly synth: Synth, private readonly log: (kind: 'warn' | 'info', text: string) => void) {}

  get current(): number { return this.song; }
  get volume(): number { return this.vol; }
  set volume(v: number) { this.vol = Math.min(Math.max(v, 0), 1); if (this.song >= 0) this.applyGain(); }

  play(n: number): void {
    if (n < 0) { this.stop(); return; }
    if (!this.synth.ready) { if (!this.warned) { this.warned = true; this.log('warn', '음악을 재생할 수 없다: 신디사이저 또는 사운드폰트가 없다'); } return; }
    this.fadeState = null; this.level = 1;                                     // every MUSIC clears the fade (FUN_0042e8c0)
    this.applyGain();
    if (n === this.song) return;                                               // the same song is not restarted [추정]
    this.song = n;
    this.synth.play(n, true);
  }

  stop(): void {
    if (this.song >= 0) this.synth.stop();
    this.song = -1; this.fadeState = null; this.level = 1;
  }

  /** MUSIC_FADE ms dir: dir on = 0 → 1 (fade in), off = current → 0 then stop; ms 0 is immediate. */
  fade(ms: number, on: boolean, now: number): void {
    if (this.song < 0) return;
    const from = on ? 0 : this.level, to = on ? 1 : 0;
    if (ms <= 0) { this.level = to; this.applyGain(); if (!on) this.stop(); return; }
    this.fadeState = { from, to, start: now, ms };
    this.level = from;
    this.applyGain();
  }
  fadeBusy(): boolean { return this.fadeState !== null; }

  update(now: number): void {
    const f = this.fadeState;
    if (!f) return;
    const t = Math.min(Math.max((now - f.start) / f.ms, 0), 1);
    this.level = f.from + (f.to - f.from) * t;
    this.applyGain();
    if (t >= 1) { this.fadeState = null; if (f.to === 0) this.stop(); }
  }

  private applyGain(): void { this.synth.setGain(Math.round(this.level * this.vol * 10000) / 10000); }
}
