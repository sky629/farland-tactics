/**
 * EXP distribution of the battle-result dialog (FT2.exe dialog 0xA2, EXT BATTLE_RESULT gold, pool). The script hands the party a
 * pool of experience; the dialog starts with the equalizing split (WM_COMMAND 0x455 at 0x40c166), offers an even split (0x454 at
 * 0x40c0e4), lets the player drag each unit's share, and OK adds the shares to the units (0x40c09f). Shares are whole points.
 */

/** floor(pool / n) each, the remainder one point each to the first units (0x40c0e4). */
export function evenShare(n: number, pool: number): number[] {
  if (n <= 0) return [];
  const each = Math.trunc(pool / n), rest = pool - each * n;
  return Array.from({ length: n }, (_, i) => each + (i < rest ? 1 : 0));
}

/**
 * Equalizing split (0x40c166): units sorted by EXP (lowest first; equal EXP keeps slot order), the k lowest units are raised
 * together toward the next unit's EXP while the pool allows (min(gap, floor(pool / k)) each; a pool smaller than k goes one point
 * each to the lowest), then what is left is split evenly in that order.
 */
export function equalizeShare(exps: number[], pool: number): number[] {
  const n = exps.length;
  const alloc = new Array<number>(n).fill(0);
  if (n === 0 || pool <= 0) return alloc;
  const order = exps.map((_, i) => i).sort((a, b) => exps[a]! - exps[b]! || a - b);
  let left = pool;
  for (let k = 1; k < n && left > 0; k++) {
    const gap = exps[order[k]!]! - exps[order[k - 1]!]!;
    const each = Math.min(gap, Math.trunc(left / k));
    for (let m = 0; m < k; m++) alloc[order[m]!]! += each;
    left -= each * k;
    if (left < k) { for (let m = 0; m < k && left > 0; m++, left--) alloc[order[m]!]! += 1; }
  }
  if (left > 0) {
    const each = Math.trunc(left / n); left -= each * n;
    for (let m = 0; m < n; m++) alloc[order[m]!]! += each + (m < left ? 1 : 0);
  }
  return alloc;
}
