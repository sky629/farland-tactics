import { describe, expect, it } from 'vitest';
import { savesRows, SAVE_ROW } from '../src/ui/win/screens/saves';
import { titleChoice } from '../src/ui/win/screens/title';
import { BROKEN_SUMMARY, type SaveSummary } from '../src/save/format';

const at = (stage: number, turn: number, title: string): SaveSummary => ({ stage, title, turn, date: null, bgm: 0, gold: 150, message: '' });

describe('data select dialog 143 (불러오기·저장하기)', () => {
  it('rows follow the original formats: "%2d: %2d일째  Turn%-3d %s" and "%2d:           미등록"; empty and corrupt slots cannot be loaded', () => {
    const rows = savesRows([at(3, 2, '어트랙터'), null, BROKEN_SUMMARY, at(5, 0, '시티 어드벤쳐')], 'load');
    expect(rows[0]).toEqual({ slot: 0, text: ' 1:  3일째  Turn2   어트랙터', enabled: true });
    expect(rows[1]).toEqual({ slot: 1, text: ' 2:           미등록', enabled: false });
    expect(rows[2]).toEqual({ slot: 2, text: ' 3:           손상됨', enabled: false });
    expect(rows[3]).toEqual({ slot: 3, text: ' 4:  5일째  어트랙터  시티 어드벤쳐', enabled: true });   // a town save: "%2d: %2d일째  어트랙터  %s"
    expect(SAVE_ROW).toBe('%2d: %2d일째  Turn%-3d %s');
  });
  it('in save mode an empty slot is a target, a corrupt one too (it is overwritten)', () => {
    const rows = savesRows([null, BROKEN_SUMMARY], 'save');
    expect(rows.map((r) => r.enabled)).toEqual([true, true]);
  });
});
describe('title dialog 124 (스테이지 선택)', () => {
  it('maps 게임 개시 to a new game and 불러오기 to loading', () => { expect(titleChoice(1)).toBe('new'); expect(titleChoice(2)).toBe('load'); expect(titleChoice(0)).toBeNull(); });
});
