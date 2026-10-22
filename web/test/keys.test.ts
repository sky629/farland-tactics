import { describe, expect, it } from 'vitest';
import { accelKey, accelText } from '../src/ui/win/keys';
import { accelOf, menuModel, type MenuTemplate } from '../src/ui/win/menubar';
import menu103 from './helpers/menu103.json';

describe('number keys stand in for the function keys (a keyboard without an F row)', () => {
  it('1–6 are F1–F6, 0 is F10, 9 is F11; every other key is itself', () => {
    expect(['1', '2', '3', '4', '5', '6', '0', '9'].map(accelKey)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F10', 'F11']);
    expect(accelKey('7')).toBe('7');
    expect(accelKey('F2')).toBe('F2');
    expect(accelKey('z')).toBe('z');
  });
  it('the menu reaches the same commands through the digits', () => {
    const m = menuModel(menu103 as MenuTemplate, {}, false);
    expect(accelOf(m, accelKey('2'), false)).toBe(40010);
    expect(accelOf(m, accelKey('0'), false)).toBe(40009);
    expect(accelOf(m, accelKey('9'), false)).toBe(40012);
  });
  it('the accelerator column shows the digit beside the function key; other accelerators are unchanged', () => {
    expect(accelText('F1')).toBe('F1 · 1');
    expect(accelText('F10')).toBe('F10 · 0');
    expect(accelText('F11')).toBe('F11 · 9');
    expect(accelText('Ctrl+Z')).toBe('Ctrl+Z');
    expect(accelText('ALT+F4')).toBe('ALT+F4');
  });
});
