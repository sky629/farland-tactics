import { describe, expect, it } from 'vitest';
import { LoadTable } from '../src/assets/loadTable';

describe('LoadTable', () => {
  it('a name is pending from start to done, then holds its value', () => {
    const t = new LoadTable<string>();
    expect(t.start('a')).toBe(true);
    expect(t.pending).toBe(1);
    expect(t.get('a')).toBeNull();
    t.done('a', 'A');
    expect(t.pending).toBe(0);
    expect(t.get('a')).toBe('A');
    expect(t.start('a')).toBe(false);                                        // started once
  });
  it('a failed name is not pending and is not retried', () => {
    const t = new LoadTable<string>();
    t.start('b'); t.fail('b');
    expect(t.pending).toBe(0);
    expect(t.get('b')).toBeNull();
    expect(t.start('b')).toBe(false);
  });
  it('clear forgets everything', () => {
    const t = new LoadTable<string>();
    t.start('c'); t.clear();
    expect(t.pending).toBe(0);
    expect(t.start('c')).toBe(true);
  });
});
