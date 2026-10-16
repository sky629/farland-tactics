export interface RandomSource { rand(n: number): number }

/** FT2.exe FUN_004337a0: three multiplicative congruential generators (Wichmann–Hill), summed. rand(n) is 0..n-1 for n > 0. */
export class Rng implements RandomSource {
  constructor(private s1: number, private s2: number, private s3: number) {}

  /** Remake seeding (the original seeds from the clock): spread one integer over the three states, each ≥ 1. */
  static fromSeed(seed: number): Rng {
    const s = Math.abs(Math.trunc(seed));
    return new Rng(1 + (s % 30268), 1 + (Math.trunc(s / 30268) % 30306), 1 + (Math.trunc(s / (30268 * 30306)) % 30322));
  }

  get state(): [number, number, number] { return [this.s1, this.s2, this.s3]; }

  clone(): Rng { return new Rng(this.s1, this.s2, this.s3); }

  rand(n: number): number {
    this.s1 = (this.s1 % 177) * 171 - Math.trunc(this.s1 / 177) * 2;
    this.s2 = (this.s2 % 176) * 172 - Math.trunc(this.s2 / 176) * 35;
    this.s3 = (this.s3 % 178) * 170 - Math.trunc(this.s3 / 178) * 63;
    if (this.s1 < 0) this.s1 += 30269;
    if (this.s2 < 0) this.s2 += 30307;
    if (this.s3 < 0) this.s3 += 30323;
    const v = this.s1 + this.s2 + this.s3;
    return n > 0 ? v % n : v;
  }
}
