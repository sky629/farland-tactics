import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';
import workletUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import type { Synth } from './types';

const nn = (n: number): string => String(n).padStart(2, '0');
const INIT_TIMEOUT_MS = 20000;

/** SF2/SF3 files are RIFF containers; a dev server's index.html fallback or a truncated download is not one. */
export function isSoundfont(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 12) return false;
  const b = new Uint8Array(bytes, 0, 4);
  return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;   // 'RIFF'
}
const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what}: ${ms / 1000}초 안에 끝나지 않음`)), ms))]);

/**
 * MIDI through spessasynth_lib (AudioWorklet) with the GM soundfont at assets/sf2/gm.sf3.
 * `ready` stays false — and every call is a no-op — when the soundfont or the worklet is missing; the MusicPlayer logs once.
 */
export type SynthFailure = 'soundfont' | 'synth' | null;
/** The panel note after init settled: what is missing and what to do; null when music plays. */
export function synthNotice(failure: SynthFailure): string | null {
  if (failure === 'soundfont') return '음악 없음: 사운드폰트가 없다. python3 -I tools/ft2_soundfont.py web/public/assets 를 실행한 뒤 새로고침.';
  if (failure === 'synth') return '음악 없음: 이 브라우저에서 MIDI 합성기를 만들지 못했다(AudioWorklet). 효과음은 난다.';
  return null;
}

export class SpessaSynth implements Synth {
  ready = false;
  failure: SynthFailure = null;
  private synth: WorkletSynthesizer | null = null;
  private seq: Sequencer | null = null;
  private gain = 1;
  private token = 0;
  private known = new Set<number>();
  private readonly files = new Map<number, Promise<ArrayBuffer | null>>();

  constructor(private readonly ctx: AudioContext, private readonly base: string, private readonly log: (kind: 'warn' | 'info', text: string) => void) {}

  /** Loads the soundfont and the worklet; false (with one warning) when either is unavailable. */
  async init(knownSongs: Set<number>): Promise<boolean> {
    this.known = knownSongs;
    try {
      const sf = await fetch(`${this.base}/sf2/gm.sf3`);
      const bank = sf.ok ? await sf.arrayBuffer() : null;
      if (!bank || !isSoundfont(bank)) { this.failure = 'soundfont'; this.log('warn', '음악: 사운드폰트가 없다 — python3 -I tools/ft2_soundfont.py web/public/assets 로 받는다'); return false; }
      await this.ctx.audioWorklet.addModule(workletUrl);
      const synth = new WorkletSynthesizer(this.ctx);
      synth.connect(this.ctx.destination);                                     // the worklet is not connected by default
      await withTimeout(synth.isReady, INIT_TIMEOUT_MS, '음악 합성기 준비');
      await withTimeout(synth.soundBankManager.addSoundBank(bank, 'gm'), INIT_TIMEOUT_MS, '사운드폰트 로드');
      synth.setSystemParameter('gain', this.gain);
      this.synth = synth;
      this.seq = new Sequencer(synth, { skipToFirstNoteOn: false });
      this.ready = true;
      return true;
    } catch (e) {
      this.failure = 'synth';
      this.log('warn', `음악 합성기를 만들지 못했다: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  play(song: number, loop: boolean): void {
    if (!this.seq) return;
    if (!this.known.has(song)) { this.log('warn', `음악 bgm${nn(song)}.mid 가 자산에 없다`); return; }
    const token = ++this.token;
    void this.file(song).then((buf) => {
      if (!buf || token !== this.token || !this.seq) return;
      this.seq.loadNewSongList([{ binary: buf, fileName: `bgm${nn(song)}.mid` }]);
      this.seq.loopCount = loop ? Infinity : 0;
      this.seq.play();
    });
  }

  stop(): void {
    this.token++;
    this.seq?.pause();
    this.synth?.stopAll(true);
  }

  setGain(v: number): void { this.gain = v; this.synth?.setSystemParameter('gain', v); }

  private file(song: number): Promise<ArrayBuffer | null> {
    let p = this.files.get(song);
    if (!p) {
      p = fetch(`${this.base}/midi/bgm${nn(song)}.mid`).then(async (r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
      this.files.set(song, p);
    }
    return p;
  }
}
