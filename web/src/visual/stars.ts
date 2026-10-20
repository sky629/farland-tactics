/**
 * FUN_00405920: the ending's star fields. Table 0x449690 holds four (init, update, draw) routines over bmp\star.bmp (128×16 —
 * eight 16×16 frames, small → big); the game object gets a 640×480 surface cleared to key 252 so only the stars show. Eighty
 * stars; the update runs once every 20 ms (0x44df70..: last + 20 ≤ now). Kinds 0–2 project (x, y, z) from a centre:
 * sx = ⌊x·100/(z+50)⌋ + cx, sy = ⌊y·100/(z+50)⌋ + cy, frame 7 − min(⌊(z−100)/25⌋, 7) (big when near); a star drawn off the
 * 640×480 screen is set to z = 400 so the next update respawns it. Kind 3 (unused by the scenes) drifts 16-px stars upward.
 */
export type StarKind = 0 | 1 | 2 | 3;
export interface StarBlit { frame: number; x: number; y: number }
export const STAR_COUNT = 80, STAR_TICK_MS = 20, STAR_CELL = 16, STAR_KEY = 252;
const MAX_CATCH_UP = 50;                                                       // a hidden tab does not replay a minute of ticks

type Rnd = (n: number) => number;                                              // 0 ≤ r < n (FUN_004337a0)
interface Star { x: number; y: number; z: number; v: number }
interface Perspective { init: [number, number, number, number]; respawn: [number, number, number, number]; dz: number; cx: number; cy: number; bottom: boolean }

/**
 * The three perspective kinds — 0: 0x4011f0/401080/4010f0, 1: 0x4013b0/401240/4012b0, 2: 0x401560/401400/401470. `init` and
 * `respawn` are (x range, x offset, y range, y offset); dz > 0 recedes and respawns past z 400 (z −= 300), dz < 0 nears and
 * respawns under z 100 (z += 300); `bottom` = the draw also checks sy > 480.
 */
const PERSPECTIVE: Record<0 | 1 | 2, Perspective> = {
  0: { init: [1280, -640, 960, -480], respawn: [1920, -960, 1440, -720], dz: 50, cx: 300, cy: 300, bottom: true },
  1: { init: [1280, -640, 960, -480], respawn: [1920, -960, 1440, -720], dz: 20, cx: 10, cy: 400, bottom: true },
  2: { init: [1280, -640, 960, -1280], respawn: [1920, -960, 1440, -1520], dz: -50, cx: 320, cy: 800, bottom: false },
};

export class StarField {
  private readonly stars: Star[] = [];
  private last: number | null = null;
  constructor(readonly kind: StarKind, private readonly rnd: Rnd = (n) => Math.floor(Math.random() * n)) {
    for (let i = 0; i < STAR_COUNT; i++) this.stars.push(this.spawn(true));
  }
  private spawn(initial: boolean): Star {
    const r = this.rnd;
    if (this.kind === 3) return { x: r(640), y: r(480), z: 0, v: r(3) + 4 };     // 0x4016a0: speed 4..6 doubles as the frame
    const p = PERSPECTIVE[this.kind], [xr, xo, yr, yo] = initial ? p.init : p.respawn;
    return { x: r(xr) + xo, y: r(yr) + yo, z: initial ? r(300) : 0, v: 0 };
  }
  /** Runs the 20 ms ticks that have passed since the last call; the first call only starts the clock. */
  tick(now: number): void {
    if (this.last === null) { this.last = now; return; }
    const n = Math.floor((now - this.last) / STAR_TICK_MS);
    if (n >= MAX_CATCH_UP) this.last = now; else this.last += n * STAR_TICK_MS;
    for (let i = 0; i < Math.min(n, MAX_CATCH_UP); i++) this.step();
  }
  private step(): void {
    for (const s of this.stars) {
      if (this.kind === 3) { s.y += s.v * 8 - 106; if (s.y < 0) s.y += 480; continue; }   // 0x4015b0: up 58–74 px, wrapping
      const p = PERSPECTIVE[this.kind];
      s.z += p.dz;
      if (p.dz > 0 ? s.z > 400 : s.z < 100) { const f = this.spawn(false); s.x = f.x; s.y = f.y; s.z += p.dz > 0 ? -300 : 300; }
    }
  }
  /** The blits of one frame: strip frame `frame` at screen (x, y). The original draws every star (clipped) and marks the off-screen ones. */
  blits(): StarBlit[] {
    return this.stars.map((s) => {
      if (this.kind === 3) return { frame: s.v, x: s.x, y: s.y };
      const p = PERSPECTIVE[this.kind], d = s.z + 50;
      const x = Math.trunc((s.x * 100) / d) + p.cx, y = Math.trunc((s.y * 100) / d) + p.cy;
      const frame = 7 - Math.min(7, Math.max(0, Math.trunc((s.z - 100) / 25)));   // z < 100 gives frames past the strip in the original (idiv of a negative) — clamped to the big star [추정]
      if (x < 0 || y < 0 || x > 640 || (p.bottom && y > 480)) s.z = 400;
      return { frame, x, y };
    });
  }
}
