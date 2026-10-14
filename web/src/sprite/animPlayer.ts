import type { Frame, Step, Timeline } from './animScript';

export interface PlayOptions { loop?: boolean; mirrorH?: boolean; mirrorV?: boolean; keepOffset?: boolean }
export type AnimEvent = { type: 'frame'; frame: Frame } | { type: 'step'; step: number } | { type: 'end' };

/** Plays a Timeline the way FT2.exe does (FUN_0042a210 / FUN_0042a3d0 / FUN_0042a450). */
export class AnimPlayer {
  private readonly opts: Required<PlayOptions>;
  private _stepIndex = 0;
  private frameIndex = 0;
  private frameStart: number | null = null;
  private elapsed = 0;                          // ms of frames entered in the current step (+0x14)
  private committed = { x: 0, y: 0 };           // (+0x2a, +0x2c)
  private _offset = { x: 0, y: 0 };             // (+0x36, +0x38)
  private _finished = false;

  constructor(readonly timeline: Timeline, options: PlayOptions = {}) {
    this.opts = { loop: false, mirrorH: false, mirrorV: false, keepOffset: false, ...options };
  }

  get stepIndex(): number { return this._stepIndex; }
  get step(): Step { return this.timeline.steps[this._stepIndex]!; }
  get frame(): Frame { return this.step.frames[this.frameIndex]!; }
  get offset(): { x: number; y: number } { return this._offset; }
  get finished(): boolean { return this._finished; }

  /** FUN_00429950: one step, one frame, no movement → a still image. */
  private get isStatic(): boolean {
    const st = this.timeline.steps;
    return st.length === 1 && st[0]!.frames.length === 1 && st[0]!.dx === 0 && st[0]!.dy === 0;
  }

  update(now: number): AnimEvent[] {
    if (this._finished || this.isStatic) return [];
    if (this.frameStart === null) { this.frameStart = now; return []; }
    if (now < this.frameStart + this.frame.ms) return [];
    const events: AnimEvent[] = [];
    this.frameStart = now;
    this.frameIndex++;
    if (this.frameIndex < this.step.frames.length) {
      this.elapsed += this.frame.ms;              // FUN_0042a3d0 adds the duration of the frame just entered
    } else {
      const done = this.step;
      this._stepIndex++;
      if (this._stepIndex >= this.timeline.steps.length) {
        if (!this.opts.keepOffset) this.committed = { x: 0, y: 0 };
        if (!this.opts.loop) {
          this._stepIndex--;
          this.frameIndex = done.frames.length - 1;
          this._finished = true;
          events.push({ type: 'end' });
          return events;                           // offset keeps its last value (FUN_0042a210 returns before recomputing)
        }
        this._stepIndex = 0;
      }
      this.committed = {
        x: this.committed.x + (this.opts.mirrorH ? -done.dx : done.dx),
        y: this.committed.y + (this.opts.mirrorV ? -done.dy : done.dy),
      };
      this.elapsed = 0;
      this.frameIndex = 0;
      events.push({ type: 'step', step: this._stepIndex });
    }
    this.recomputeOffset();
    events.push({ type: 'frame', frame: this.frame });
    return events;
  }

  private recomputeOffset(): void {
    const st = this.step;
    const sx = st.totalMs > 0 ? st.dx / st.totalMs : 0;
    const sy = st.totalMs > 0 ? st.dy / st.totalMs : 0;
    const mx = Math.trunc(this.elapsed * sx);
    const my = Math.trunc(this.elapsed * sy);
    this._offset = {
      x: this.committed.x + (this.opts.mirrorH ? -mx : mx),
      y: this.committed.y + (this.opts.mirrorV ? -my : my),
    };
  }
}
