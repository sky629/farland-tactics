/** The save header keeps its two strings in CP949 (Windows-949). Browsers and Node decode that table under the label 'euc-kr'. */
const decoder = new TextDecoder('euc-kr');

/** Bytes up to the first NUL → string. */
export function decodeCp949(bytes: Uint8Array): string {
  const n = bytes.indexOf(0);
  return decoder.decode(n < 0 ? bytes : bytes.subarray(0, n));
}

let reverse: Map<string, [number, number]> | null = null;

/** Every two-byte sequence the decoder accepts, inverted once on first use (about 17,000 characters). */
function table(): Map<string, [number, number]> {
  if (reverse) return reverse;
  reverse = new Map();
  const pair = new Uint8Array(2);
  for (let hi = 0x81; hi <= 0xfe; hi++) {
    for (let lo = 0x41; lo <= 0xfe; lo++) {
      pair[0] = hi; pair[1] = lo;
      const s = decoder.decode(pair);
      if (s.length === 1 && s !== '�' && !reverse.has(s)) reverse.set(s, [hi, lo]);
    }
  }
  return reverse;
}

/** String → `size` bytes, NUL-padded; truncates at a character boundary and keeps the last byte NUL; unencodable characters become '?'. */
export function encodeCp949(s: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let i = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) { if (i + 1 >= size) break; out[i++] = code; continue; }
    const p = table().get(ch);
    if (!p) { if (i + 1 >= size) break; out[i++] = 0x3f; continue; }
    if (i + 2 >= size) break;
    out[i++] = p[0]; out[i++] = p[1];
  }
  return out;
}
