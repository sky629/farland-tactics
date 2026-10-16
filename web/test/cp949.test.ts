import { describe, expect, it } from 'vitest';
import { decodeCp949, encodeCp949 } from '../src/save/cp949';

describe('CP949 strings of the save header', () => {
  it('round-trips Korean, ASCII and the underscore the scripts use for spaces, NUL-padded to the field size', () => {
    const bytes = encodeCp949('첫업무_1', 32);
    expect(bytes.length).toBe(32);
    expect(bytes[8]).toBe(0);                                                  // 3 × 2 B + '_' + '1' = 8 B, then NUL
    expect(decodeCp949(bytes)).toBe('첫업무_1');
  });
  it('decodes the original encoding of a 2015 save title', () => {
    expect(decodeCp949(new Uint8Array([0xc3, 0xb9, 0xbe, 0xf7, 0xb9, 0xab, 0]))).toBe('첫업무');
  });
  it('truncates at a character boundary and always leaves a NUL', () => {
    const bytes = encodeCp949('가나다라', 5);
    expect(bytes.length).toBe(5);
    expect(decodeCp949(bytes)).toBe('가나');                                   // 4 B + NUL
  });
  it('replaces characters CP949 cannot encode with ?', () => {
    expect(decodeCp949(encodeCp949('a€b', 8))).toBe('a?b');
  });
});
