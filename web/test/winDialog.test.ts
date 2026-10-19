import { describe, expect, it } from 'vitest';
import { savesRows } from '../src/ui/win/screens/saves';
import { BROKEN_SUMMARY, type SaveSummary } from '../src/save/format';

const at = (stage: number, turn: number, title: string): SaveSummary => ({ stage, title, turn, date: null, bgm: 0, gold: 150, message: '' });

describe('data select dialog 143 (불러오기·저장하기)', () => {
  it('rows follow the original formats: "%2d: %2d일째  Turn%-3d %s" and "%2d:           미등록"; empty and corrupt slots cannot be loaded', () => {
    const rows = savesRows([at(3, 2, '어트랙터'), null, BROKEN_SUMMARY, at(5, -1, '시티 어드벤쳐'), at(4, 0, '첫업무')], 'load');
    expect(rows[0]).toEqual({ slot: 0, text: ' 1:  3일째  Turn2   어트랙터', enabled: true });
    expect(rows[1]).toEqual({ slot: 1, text: ' 2:           미등록', enabled: false });
    expect(rows[2]).toEqual({ slot: 2, text: ' 3:           손상됨', enabled: false });
    expect(rows[3]).toEqual({ slot: 3, text: ' 4:  5일째  어트랙터  시티 어드벤쳐', enabled: true });   // a town save (turn −1): "%2d: %2d일째  어트랙터  %s"
    expect(rows[4]).toEqual({ slot: 4, text: ' 5:  4일째  Turn0   첫업무', enabled: true });          // the BATTLE_START autosave counts 0 finished rounds: still a battle save
  });
  it('in save mode an empty slot is a target, a corrupt one too (it is overwritten)', () => {
    const rows = savesRows([null, BROKEN_SUMMARY], 'save');
    expect(rows.map((r) => r.enabled)).toEqual([true, true]);
  });
});
