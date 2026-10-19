/** Names the interface shows: the speaker table of the scripts (party and story characters by unit id), status names, item names. */
import { isTreasure, type Unit } from '../battle/unit';
import type { ItemData, Tables } from '../data/types';

export const SPEAKER_NAMES: Record<number, string> = {
  1: '카린', 2: '알', 3: '아리스', 4: '사라', 5: '라딧슈', 6: '소피아', 7: '루루', 9: '???', 10: 'T.T.', 11: '손', 12: '마크도갈', 13: '가스톤',
  15: '마스터', 16: '근육 아저씨', 17: '숍언니', 18: '화난 카린', 19: '곤란한 아리스', 20: '카트린느', 21: '베히모스', 22: '듀마', 23: '존', 24: '돗펠원화',
  25: '앨비스', 26: '손.바이스', 27: '히드라', 28: '코카트리스', 29: '길드 마스터',
};
export const STATUS_NAMES: Record<number, string> = { 0: '정상', 1: '사망', 2: '독', 3: '수면', 4: '석화', 5: '동결', 6: '침묵', 7: '매혹', 8: '홀드', 9: '은신', 11: '부유' };

export const itemName = (item: ItemData): string => item.name.replace(/_/g, ' ');

/** A story character's name, else the race (a drop keeps its foe's id but is an object now). */
export function unitName(u: Unit, tables: Tables): string {
  return (!isTreasure(u) && u.id !== 8 && u.id < 30 && SPEAKER_NAMES[u.id]) || tables.race[u.race]?.name.replace(/_/g, ' ') || `종족 ${u.race}`;
}
