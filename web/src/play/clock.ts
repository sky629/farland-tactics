/**
 * 배속 (web-only): the page's frame timestamps become game time at 1×, 2× or 4×. Everything that runs on the game clock — walks,
 * battle animation, fades, WAIT, town animation, visual scenes — speeds up with it; clicks, dialog boxes and the music's tempo do not.
 */
import type { Speed } from '../ui/win/speed';

export class GameClock {
  speed: Speed = 1;
  private last: number | null = null;
  private game = 0;

  /** The game time of a frame stamped `real` (ms): each real interval counts `speed` times; a stamp that runs backwards adds nothing. */
  at(real: number): number {
    if (this.last !== null) this.game += Math.max(0, real - this.last) * this.speed;
    this.last = real;
    return this.game;
  }
}
