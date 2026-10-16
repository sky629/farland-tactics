/** A playing sound; `done` turns true when it ends or is stopped. */
export interface Voice { stop(): void; readonly done: boolean }

/** What the sound player needs from the browser (Web Audio) or from a test double. */
export interface AudioOut {
  now(): number;
  /** Decoded buffer for `assets/wave/<name>.wav`, null when it cannot be loaded. */
  decode(name: string): Promise<unknown | null>;
  play(buffer: unknown, gain: number): Voice;
  setGain(kind: 'music' | 'sound', v: number): void;
}

/** A MIDI synthesizer as the music player sees it (spessasynth in the browser, a recorder in tests). */
export interface Synth {
  readonly ready: boolean;
  play(song: number, loop: boolean): void;
  stop(): void;
  setGain(v: number): void;
}
