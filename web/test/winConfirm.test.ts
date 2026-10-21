import { describe, expect, it } from 'vitest';
import { askPrompt } from '../src/ui/win/screens/confirm';

describe('ASK → dialog 126/163 (event_script_format.md: a "+" prefix picks resource 0xA3, the small 확인 box)', () => {
  it('a "+" question goes to 163 without the prefix, underscores as spaces', () => {
    expect(askPrompt('+일을_받아들이겠습니까?')).toEqual({ text: '일을 받아들이겠습니까?', template: 163 });
  });
  it('a plain question goes to 126, its script text shown as the script shows it', () => {
    expect(askPrompt('정말_그만둡니까?*')).toEqual({ text: '정말 그만둡니까?', template: 126 });
  });
});
