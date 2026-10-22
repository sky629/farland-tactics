/**
 * Number keys stand in for the function keys, for a keyboard without an F row: 1–6 → F1–F6, 0 → F10, 9 → F11 (the original's
 * accelerators are F1 불러오기, F2 유니트 일람, F3 전체 맵, F4 전체 화면, F5 저장하기, F10 턴 종료, F11 환경설정; F6 배속 is the web's).
 */
const F_OF_DIGIT: Record<string, string> = { '1': 'F1', '2': 'F2', '3': 'F3', '4': 'F4', '5': 'F5', '6': 'F6', '0': 'F10', '9': 'F11' };
const DIGIT_OF_F = Object.fromEntries(Object.entries(F_OF_DIGIT).map(([d, f]) => [f, d])) as Record<string, string>;

/** The key a KeyboardEvent names, with a digit read as its function key. */
export function accelKey(key: string): string { return F_OF_DIGIT[key] ?? key; }

/** The accelerator column of a menu item: a bare function key shows its digit too ("F1 · 1"); combinations stay as the resource wrote them. */
export function accelText(accel: string): string { const d = DIGIT_OF_F[accel]; return d === undefined ? accel : `${accel} · ${d}`; }
