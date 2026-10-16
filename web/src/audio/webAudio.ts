import type { AudioOut, Voice } from './types';

/** Web Audio implementation of AudioOut: one GainNode for all effects, WAV files fetched from assets/wave and decoded once. */
export class WebAudioOut implements AudioOut {
  private readonly soundGain: GainNode;

  constructor(readonly ctx: AudioContext, private readonly base = 'assets') {
    this.soundGain = ctx.createGain();
    this.soundGain.connect(ctx.destination);
  }

  now(): number { return this.ctx.currentTime * 1000; }

  async decode(name: string): Promise<AudioBuffer | null> {
    const r = await fetch(`${this.base}/wave/${name}.wav`);
    if (!r.ok) return null;
    return this.ctx.decodeAudioData(await r.arrayBuffer());
  }

  play(buffer: unknown, gain: number): Voice {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer as AudioBuffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.soundGain);
    const voice = { done: false, stop(): void { try { src.stop(); } catch { /* already ended */ } voice.done = true; } };
    src.onended = () => { voice.done = true; };
    src.start();
    return voice;
  }

  /** The music gain belongs to the synthesizer; only the effects bus is here. */
  setGain(kind: 'music' | 'sound', v: number): void { if (kind === 'sound') this.soundGain.gain.value = v; }
}
