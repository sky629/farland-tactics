import type { AudioOut, Voice } from './types';

export const CHANNELS = 16;

/** A channel reservation: taken at play() time, filled when the file is decoded, so two sounds in one frame never share a channel. */
class Slot implements Voice {
  voice: Voice | null = null;
  cancelled = false;
  get done(): boolean { return this.cancelled || (this.voice?.done ?? false); }
  stop(): void { this.cancelled = true; this.voice?.stop(); }
}

/**
 * FUN_0040d950: 16 channels. A name starting with `*` takes channel 0 (cutting whatever plays there); otherwise the
 * first free channel, or channel 0 when all are busy. An empty name stops channel 0. Files decode once; a name the
 * asset index lacks or a file that fails to decode warns once.
 */
export class SoundPlayer {
  volume = 1;
  private readonly channels: (Slot | null)[] = new Array<Slot | null>(CHANNELS).fill(null);
  private readonly cache = new Map<string, Promise<unknown | null>>();
  private readonly warned = new Set<string>();

  constructor(private readonly out: AudioOut, private readonly known: Set<string>, private readonly log: (kind: 'warn' | 'info', text: string) => void) {}

  play(raw: string): void {
    const fixed = raw.startsWith('*');
    const name = (fixed ? raw.slice(1) : raw).toLowerCase();
    if (name === '') { this.cut(0); return; }
    if (!this.known.has(name)) { this.warnOnce(name, `효과음 ${name}.wav 가 자산에 없다`); return; }
    const channel = fixed ? 0 : this.freeChannel();
    this.cut(channel);
    const slot = new Slot();
    this.channels[channel] = slot;
    void this.buffer(name).then((buf) => {
      if (slot.cancelled) return;
      if (!buf) { slot.cancelled = true; this.warnOnce(name, `효과음 ${name}.wav 를 읽지 못했다`); return; }
      slot.voice = this.out.play(buf, this.volume);
    });
  }

  stopAll(): void { for (let i = 0; i < CHANNELS; i++) this.cut(i); }

  /** The channel a started voice occupies (tests), −1 when it is not playing. */
  channelOf(voice: Voice): number { return this.channels.findIndex((s) => s !== null && s.voice === voice); }

  private freeChannel(): number {
    const i = this.channels.findIndex((s) => s === null || s.done);
    return i < 0 ? 0 : i;
  }
  private cut(channel: number): void { this.channels[channel]?.stop(); this.channels[channel] = null; }
  private buffer(name: string): Promise<unknown | null> {
    let p = this.cache.get(name);
    if (!p) { p = this.out.decode(name).catch(() => null); this.cache.set(name, p); }
    return p;
  }
  private warnOnce(name: string, text: string): void { if (!this.warned.has(name)) { this.warned.add(name); this.log('warn', text); } }
}
