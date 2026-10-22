/**
 * Menu command ids → what the page does. The ids are the resource's (menu 103) and the code-made popups' (FUN_0042b620 gives the
 * facilities 7000 + index here; FUN_00430c80's unit entries carry battle commands instead and never reach this table).
 */
export type MenuAction = 'endTurn' | 'unitList' | 'fullscreen' | 'objective' | 'load' | 'save' | 'settings' | 'quit' | 'fullMap' | 'showPlaces' | 'bgm' | 'undoTurn' | { facility: number };

const BY_ID: Record<number, MenuAction> = {
  40009: 'endTurn', 40010: 'unitList', 40003: 'fullscreen', 40032: 'objective', 40028: 'load', 40029: 'save', 40012: 'settings', 40004: 'quit',
  40030: 'fullMap', 40035: 'showPlaces', 107: 'bgm',
  40026: 'undoTurn',                                                            // the 디버그 popup's 턴 회복 (Ctrl+Z): the web's 턴 되돌리기
};
export const FACILITY_BASE = 7000;

export function menuAction(id: number): MenuAction | null {
  if (id >= FACILITY_BASE && id < FACILITY_BASE + 100) return { facility: id - FACILITY_BASE };
  return BY_ID[id] ?? null;
}
