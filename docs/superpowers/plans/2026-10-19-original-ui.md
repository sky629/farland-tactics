# 원작 UI 재현 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 플레이 페이지의 인터페이스를 게임 창 안으로 옮긴다 — 원작의 메뉴 바·유닛 명령 팝업·대화상자 21개를 FT2.exe 리소스 데이터로 다시 만들고, HTML 옆 패널은 개발 도구로만 남긴다.

**Architecture:** `tools/ft2_dialogs.py`가 PE 리소스(RT_DIALOG·RT_MENU)를 JSON으로 내보낸다. `web/src/ui/win/`의 순수 레이아웃 함수가 dialog unit을 px로 바꾸고 컨트롤 트리를 만들며, DOM 위젯(Win95 룩 CSS)이 게임 프레임 안에 겹친다. `BrowserStage`는 패널 대신 메뉴·팝업·대화상자를 부른다. 게임 코어(`GameCore`, `Battle`)는 바뀌지 않는다.

**Tech Stack:** Python 3.9+ 표준 라이브러리(리소스 파서), TypeScript + Vite + Vitest(모델 테스트는 DOM 없이), CSS(Win95 토큰), Playwright/Chrome(브라우저 확인).

**Spec:** `docs/superpowers/specs/2026-10-19-original-ui-design.md`

## Global Constraints

- 자산은 저장소에 넣지 않는다: `data/dialogs.json`·`data/menu.json`은 `web/public/assets/`로 내보낸다(`.gitignore`).
- 원작 문자열·좌표·id는 리소스 그대로 쓴다. 코드에 대화상자 좌표를 적지 않는다.
- 두 설계를 남기지 않는다: 패널·`Dialogue`의 상점/저장/결과 오버레이가 대화상자로 옮겨지면 옛 코드·CSS·테스트를 같은 태스크에서 지운다.
- 게임 코어는 건드리지 않는다(`src/battle/**`, `src/game/gameCore.ts`, `src/script/**`). 캠페인 워크는 그대로 통과해야 한다.
- 모든 Vitest 모델 테스트는 DOM 없이 돈다(`environment: 'node'`). DOM 코드는 얇게 두고 브라우저로 확인한다.
- 원작 모양의 근거가 없는 것(전체 맵, 소유자 그리기 그림)은 [추정]으로 표시한다.

## Review Focus

1. 배율 변경(창 크기, F4 전체 화면) 중 열린 대화상자·팝업이 프레임 안에 남고 클릭 좌표가 맞아야 한다 — Task 3의 `frameScale` 테스트와 Task 8의 브라우저 확인.
2. Esc·오른쪽 클릭·바깥 클릭의 취소 의미가 팝업과 대화상자에서 같아야 한다(취소 = 결과 null, 선택 중이던 범위 취소) — Task 4·5의 결과 흐름 테스트.
3. 유니트 일람의 매각 탭에서 마지막 1개를 팔거나, 장착 중인 장비를 팔려 할 때 — Task 6 테스트(`sell`의 결과 코드마다 문구).
4. 저장 대화상자 143에서 빈 슬롯·손상 슬롯의 표시와 "처음부터"의 의미(새 게임) — Task 5 테스트.
5. 경험치 배분 162에서 막대 합이 풀을 넘지 못하고, 결정 전 취소가 없다(원작도 결정만) — Task 7 테스트.

---

### Task 1: 리소스 내보내기 — `tools/ft2_dialogs.py`

**Files:**
- Create: `tools/ft2_dialogs.py`, `tools/test_ft2_dialogs.py`
- Modify: `tools/ft2_export.py` (`export_data` 뒤에 `export_ui(game, out, report)` 호출, `index.json`에 `ui: true`)

**Interfaces:**
- Produces: `read_resources(exe: bytes) -> dict` → `{'dialogs': {id: Dialog}, 'menus': {id: Menu}}`; `Dialog = {ex, style, title, font: [pt, name] | None, cx, cy, items: [{id, cls, text, x, y, cx, cy, style}]}`; `Menu = {items: [{text, id, flags, items?}]}`; 클래스 원자 0x80~0x85는 `button/edit/static/listbox/scrollbar/combobox`, 문자열 클래스는 그대로(`SysTabControl32`), id 0xFFFF/−1은 `null`.
- Consumes: 없음.

- [x] **Step 1: 실패하는 테스트**

```python
# tools/test_ft2_dialogs.py
import struct, unittest
from ft2_dialogs import parse_dialog, parse_menu, dialog_json

def dlg(items, ex=False):
    # DLGTEMPLATE(style, exstyle, cdit, x, y, cx, cy) + menu 0 + class 0 + title + font(9, '굴림')
    head = struct.pack('<IIHhhhh', 0x40 | 0x80000000, 0, len(items), 0, 0, 100, 50) + b'\0\0' + b'\0\0' + '확인'.encode('utf-16le') + b'\0\0' + struct.pack('<H', 9) + '굴림'.encode('utf-16le') + b'\0\0'
    body = b''
    for cid, cls, text, x, y, cx, cy in items:
        while (len(head) + len(body)) % 4: body += b'\0'
        body += struct.pack('<IIhhhhH', 0x50010000, 0, x, y, cx, cy, cid) + struct.pack('<HH', 0xFFFF, cls) + text.encode('utf-16le') + b'\0\0' + b'\0\0'
    return head + body

class ParseDialog(unittest.TestCase):
    def test_controls_positions_and_classes(self):
        d = parse_dialog(dlg([(6, 0x80, '예(&Y)', 48, 32, 44, 16), (1058, 0x82, '', 48, 9, 96, 16)]))
        self.assertEqual((d['cx'], d['cy'], d['title'], d['font']), (100, 50, '확인', [9, '굴림']))
        self.assertEqual(d['items'][0], dict(id=6, cls='button', text='예(&Y)', x=48, y=32, cx=44, cy=16, style=0x50010000))
        self.assertEqual(d['items'][1]['cls'], 'static')

class ParseMenu(unittest.TestCase):
    def test_popup_and_items_with_end_flags(self):
        # MENUHEADER(0,0) + POPUP '맵' + item '턴 종료' (MF_END) + end of popup list
        raw = struct.pack('<HH', 0, 0) + struct.pack('<H', 0x10 | 0x80) + '맵'.encode('utf-16le') + b'\0\0' + struct.pack('<HH', 0x80, 40009) + '턴 종료(&T)\tF10'.encode('utf-16le') + b'\0\0'
        m = parse_menu(raw)
        self.assertEqual(m['items'][0]['text'], '맵')
        self.assertEqual(m['items'][0]['items'][0], dict(text='턴 종료(&T)\tF10', id=40009, flags=0x80))

if __name__ == '__main__':
    unittest.main()
```

- [x] **Step 2: 실패 확인** — Run: `python3 -I -m unittest tools.test_ft2_dialogs -v` (저장소 루트, `tools` 가 패키지가 아니면 `cd tools && python3 -I -m unittest test_ft2_dialogs -v`). Expected: `ModuleNotFoundError: ft2_dialogs`.

- [x] **Step 3: 구현** — `tools/ft2_dialogs.py`: 스크래치 `probe_dialogs.py`(2026-10-19)의 PE 섹션 → RVA 변환, 리소스 디렉터리 순회(`readdir`, `leaf`), `parse_dialog(raw: bytes) -> dict`(DLGTEMPLATE/EX, DS_SETFONT 0x40, 컨트롤 DWORD 정렬, 클래스·텍스트 `sz_or_ord`, `extra` 생성 데이터 건너뛰기), `parse_menu(raw: bytes) -> dict`(MENUITEMTEMPLATEHEADER ver 0, MF_POPUP 0x10, MF_END 0x80), `read_resources(exe: bytes) -> dict`(RT_MENU 4, RT_DIALOG 5), `dialog_json`은 id −1/0xFFFF → `None`. `main(argv)`: `ft2_dialogs.py FT2.exe out.json`.

- [x] **Step 4: 통과 확인** — Run: 위 명령. Expected: 2 tests OK. 실제 EXE 로 `python3 -I tools/ft2_dialogs.py extracted/FarlandTactics2/FT2.exe /tmp/ui.json` → `dialogs 21, menus 1`.

- [x] **Step 5: 내보내기 연결** — `ft2_export.py`에 `export_ui(game, out, report)`: `FT2.exe` 를 읽어 `out/data/dialogs.json`(키 = 문자열 id), `out/data/menu.json`(메뉴 103) 을 쓰고, `index.json` 에 `"ui": true`. `test_ft2_export.py` 에 `export_ui` 가 두 파일을 쓰는 테스트(가짜 EXE 는 Task 1의 `dlg()` 를 리소스 섹션에 넣기 어렵다 → `read_resources` 를 monkeypatch 하여 호출·파일 쓰기만 확인).

- [x] **Step 6: 커밋** — `git add tools/ft2_dialogs.py tools/test_ft2_dialogs.py tools/ft2_export.py tools/test_ft2_export.py && git commit -m "feat(tools): export the executable's dialog and menu resources (RT_DIALOG 21, RT_MENU 103) as JSON"`

### Task 2: 레이아웃 모델 — `web/src/ui/win/layout.ts`

**Files:**
- Create: `web/src/ui/win/layout.ts`, `web/test/winLayout.test.ts`
- Modify: `web/src/data/assets.ts`(또는 데이터 로더가 있는 모듈)에 `ui()` 로더: `data/dialogs.json`, `data/menu.json`

**Interfaces:**
- Produces: `interface DialogTemplate { ex: boolean; style: number; title: string; font: [number, string] | null; cx: number; cy: number; items: ControlTemplate[] }`, `interface ControlTemplate { id: number | null; cls: string; text: string | null; x: number; y: number; cx: number; cy: number; style: number }`, `interface Metrics { charW: number; charH: number }`(글꼴의 평균 문자폭·높이, px), `duToPx(m: Metrics, x, y, cx, cy) -> { left, top, width, height }`(가로 ×charW/4, 세로 ×charH/8, 반올림), `layoutDialog(t: DialogTemplate, m: Metrics) -> { width, height, controls: LaidControl[] }`, `mnemonic(text) -> { label: string; key: string | null; accel: string | null }`('유니트 일람(&L)\tF2' → label '유니트 일람(L)', key 'l', accel 'F2'; 밑줄 위치는 `label` 안의 인덱스 `ul`).
- Consumes: Task 1의 JSON 모양.

- [x] **Step 1: 실패하는 테스트**

```ts
// web/test/winLayout.test.ts
import { describe, expect, it } from 'vitest';
import { duToPx, layoutDialog, mnemonic, type DialogTemplate } from '../src/ui/win/layout';

const confirm126: DialogTemplate = { ex: false, style: 0, title: '확인', font: [9, '굴림'], cx: 151, cy: 55, items: [
  { id: 1058, cls: 'static', text: null, x: 48, y: 9, cx: 96, cy: 16, style: 0x50020001 },
  { id: 6, cls: 'button', text: '예(&Y)', x: 48, y: 32, cx: 44, cy: 16, style: 0x50030000 },
  { id: 7, cls: 'button', text: '아니오(&N)', x: 100, y: 32, cx: 44, cy: 16, style: 0x50010000 },
] };

describe('Win95 dialog layout', () => {
  it('dialog units scale by the font: 4 horizontal per average char width, 8 vertical per char height', () => {
    expect(duToPx({ charW: 6, charH: 12 }, 48, 32, 44, 16)).toEqual({ left: 72, top: 48, width: 66, height: 24 });
  });
  it('lays out every control and the dialog size', () => {
    const l = layoutDialog(confirm126, { charW: 6, charH: 12 });
    expect([l.width, l.height]).toEqual([227, 83]);                       // 151×6/4 = 226.5 → 227, 55×12/8 = 82.5 → 83
    expect(l.controls[1]).toMatchObject({ id: 6, cls: 'button', label: '예(Y)', ul: 2, left: 72, top: 48, width: 66, height: 24, default: true });   // BS_DEFPUSHBUTTON 0x1
  });
  it('mnemonic and accelerator parse out of the resource string', () => {
    expect(mnemonic('유니트 일람(&L)\tF2')).toEqual({ label: '유니트 일람(L)', ul: 7, key: 'l', accel: 'F2' });
    expect(mnemonic('산다!')).toEqual({ label: '산다!', ul: -1, key: null, accel: null });
  });
});
```

- [x] **Step 2: 실패 확인** — Run: `cd web && npx vitest run test/winLayout.test.ts`. Expected: FAIL, 모듈 없음.
- [x] **Step 3: 구현** — `layout.ts`: 위 인터페이스. `default` = `(style & 0xF) === 1`(BS_DEFPUSHBUTTON) for buttons; `radio` = 0x9, `group` = 0x7, `ownerDraw` = 0xB; static `right` = `(style & 0x3) === 2`, `center` = 1; listbox `sort/notify` 무시.
- [x] **Step 4: 통과 확인** — Run: 같은 명령. Expected: 3 passed.
- [x] **Step 5: 커밋** — `git commit -am "feat(web): Win95 dialog layout model from the original templates"`

### Task 3: 프레임·테마·메뉴 바

**Files:**
- Create: `web/src/ui/win/theme.css`, `web/src/ui/win/menubar.ts`, `web/test/winMenu.test.ts`
- Modify: `web/play.html`(프레임 구조), `web/src/game/main.ts`(`resize()` 가 프레임 배율을 건다), `web/src/viewer/scale.ts`(필요하면 `frameScale(availW, availH, menuBarH)`)

**Interfaces:**
- Produces: `menuModel(menu: Menu, enabled: Record<number, boolean>, dev: boolean) -> MenuBarModel`(바 항목 = 메뉴 103의 첫 팝업 '맵' 하위 항목들: 표시 ▸, 턴 종료, 구분선, 시스템 ▸; `dev` 가 false 면 '디버그' 팝업은 제외 — 바에는 원래 '맵' 하나만 있으므로 바 = ['맵']), `accelOf(key: string, ctrl: boolean) -> number | null`(F1→40028, F2→40010, F3→40030, F4→40003, F5→40029, F10→40009, F11→40012), `class MenuBar { constructor(root: HTMLElement, model, onCommand(id: number)) ; setEnabled(id, on) }`. 명령 id → 동작 매핑은 Task 8의 `BrowserStage`.
- Consumes: Task 2의 `mnemonic`.

- [x] **Step 1: 실패하는 테스트**

```ts
// web/test/winMenu.test.ts
import { describe, expect, it } from 'vitest';
import { accelOf, menuModel } from '../src/ui/win/menubar';
import menu from './helpers/menu103.json';   // Task 1의 내보내기에서 복사한 고정 자료(저장소에 넣어도 되는 메타데이터: 문자열과 id뿐)

describe('menu bar model', () => {
  it('the bar is the 맵 popup; 디버그 only in dev', () => {
    const m = menuModel(menu, {}, false);
    expect(m.bar.map((p) => p.label)).toEqual(['맵']);
    expect(m.bar[0]!.items.map((i) => i.label)).toEqual(['표시(D)', '턴 종료(T)', '-', '시스템(S)']);
    expect(menuModel(menu, {}, true).popups['디버그']!.items[0]!.label).toBe('무적(I)');
  });
  it('accelerators follow the resource strings', () => {
    expect(accelOf('F10', false)).toBe(40009);
    expect(accelOf('F2', false)).toBe(40010);
    expect(accelOf('z', true)).toBe(40026);
    expect(accelOf('F6', false)).toBeNull();
  });
  it('enabled flags land on the items', () => {
    const m = menuModel(menu, { 40009: false }, false);
    expect(m.bar[0]!.items[1]).toMatchObject({ id: 40009, enabled: false, accel: 'F10' });
  });
});
```

- [x] **Step 2: 실패 확인** — Run: `npx vitest run test/winMenu.test.ts`. Expected: FAIL.
- [x] **Step 3: 구현** — `menubar.ts`(모델 함수 + 얇은 DOM 클래스: `<div class="w95-menubar">` 안의 `<span class="w95-menu">`, 드롭다운 `<div class="w95-popup">`, 항목 `<div class="w95-item" data-id>`; 열림/닫힘, 니모닉 Alt+키, 바깥 클릭 닫기). `theme.css`: 토큰(`--w95-face:#c0c0c0; --w95-shadow:#808080; --w95-dark:#000; --w95-light:#fff; --w95-sel:#000080`), 베벨(`box-shadow: inset -1px -1px var(--w95-dark), inset 1px 1px var(--w95-light), inset -2px -2px var(--w95-shadow)`), 글꼴 스택 `'Gulim','굴림','Apple SD Gothic Neo','Malgun Gothic',sans-serif`, 메뉴 바 높이 19px. `play.html`: `<div id="frame"><div id="menubar"></div><div id="screen">…</div></div>`; `#panel` 는 `hidden` 기본, `?dev=1` 이면 보임. `main.ts`의 `resize()`: `k = fitScale(availW, availH - 19 * k…)` → `frameScale`: 정수 k 중 `640k ≤ W && (480 + 19)k ≤ H` 최대값; `#frame { transform: scale(k); transform-origin: top left; width: 640px; height: 499px }` 로 프레임 전체를 키운다(캔버스 CSS 크기는 640×480 고정).
- [x] **Step 4: 통과 확인** — Run: 같은 명령 + `npx tsc --noEmit`. Expected: 3 passed, tsc clean. 브라우저: 메뉴 바가 캔버스 위에 같은 배율로 보인다.
- [x] **Step 5: 커밋** — `git commit -am "feat(web): Win95 frame, theme and the original menu bar (menu 103)"`

### Task 4: 팝업 메뉴와 유닛 명령

**Files:**
- Create: `web/src/ui/win/popup.ts`, `web/test/winPopup.test.ts`
- Modify: `web/src/game/browserStage.ts`(유닛 왼쪽 클릭 → 팝업), `web/src/game/battleInput.ts`

**Interfaces:**
- Produces: `unitCommandItems(en: MenuEnabled, u: Unit, tables) -> PopupItem[]`(이동하다(M) · 공격하다(A) · 마법(G) ▸ 주문들(`${name} MP n`, MP 부족은 비활성; 없으면 '마법을 걸 상대가 없다.' 비활성) · 도구(I) ▸ 사용 가능 아이템 · 대기(W)), 각 항목에 `cmd: Command | null`; `class PopupMenu { open(x, y, items): Promise<PopupItem | null> }`(Esc/바깥/오른쪽 클릭 → null).
- Consumes: `menuEnabled`(panel.ts → `web/src/ui/menuEnabled.ts` 로 옮긴다; panel.ts 는 Task 8에서 개발 전용이 된다), `usableItems`.

- [x] **Step 1: 실패하는 테스트**

```ts
// web/test/winPopup.test.ts
import { describe, expect, it } from 'vitest';
import { unitCommandItems } from '../src/ui/win/popup';
import { unit } from './helpers/battleFixtures';
import { tables } from './helpers/tables';   // 기존 테스트가 쓰는 표 로더

describe('unit command popup', () => {
  it('lists the original five commands with mnemonics and the enabled state', () => {
    const items = unitCommandItems({ move: true, attack: false, magic: true, item: false, wait: true, endTurn: true }, unit({ slot: 0, spells: [1, 0], mp: 50 }), tables);
    expect(items.map((i) => [i.label, i.enabled])).toEqual([['이동하다(M)', true], ['공격하다(A)', false], ['마법(G)', true], ['도구(I)', false], ['대기(W)', true]]);
    expect(items[0]!.cmd).toEqual({ type: 'beginMove' });
    expect(items[2]!.items![0]).toMatchObject({ label: `${tables.magic[1]!.name}  MP ${Math.abs(tables.magic[1]!.mp_cost)}`, cmd: { type: 'beginTarget', action: 1 } });
  });
  it('a caster without the MP shows the spell disabled; one with no spells shows the original message', () => {
    expect(unitCommandItems({ move: true, attack: true, magic: true, item: true, wait: true, endTurn: true }, unit({ slot: 0, spells: [1], mp: 0 }), tables)[2]!.items![0]!.enabled).toBe(false);
    expect(unitCommandItems({ move: true, attack: true, magic: false, item: true, wait: true, endTurn: true }, unit({ slot: 0, spells: [] }), tables)[2]!.items![0]).toMatchObject({ label: '마법을 걸 상대가 없다.', enabled: false });
  });
});
```

- [x] **Step 2: 실패 확인** — Run: `npx vitest run test/winPopup.test.ts`. Expected: FAIL.
- [x] **Step 3: 구현** — `popup.ts`: 모델 함수 + DOM 클래스(프레임 좌표로 위치, 프레임 밖이면 안쪽으로 민다, 하위 메뉴는 오른쪽에). `browserStage.ts`: 전투 모드에서 아군 유닛 클릭 → `select` 명령 뒤 `popup.open(x, y, unitCommandItems(...))` → 고른 `cmd` 를 `hooks.onCommand(cmd)`(새 훅) 로; null 이면 `cancel`. 기존 `onCell` 은 범위 선택 중에만.
- [x] **Step 4: 통과 확인** — 테스트 + tsc + 브라우저(전투 테스트 `game.html` 또는 플레이에서 유닛 클릭 → 팝업 → 이동).
- [x] **Step 5: 커밋** — `git commit -am "feat(web): the original unit command popup (이동하다·공격하다·마법·도구·대기)"`

### Task 5: 대화상자 엔진 + 확인(126) · 데이터 선택(143) · 스테이지 선택(124)

**Files:**
- Create: `web/src/ui/win/dialog.ts`, `web/src/ui/win/screens/confirm.ts`, `screens/saves.ts`, `screens/title.ts`, `web/test/winDialog.test.ts`
- Modify: `web/src/ui/dialogue.ts`(`openModal('ask')`·`'save'`·`openLoad`·`openSaveSlots`·`slotPicker` 삭제 → 대화상자 호출), `web/src/game/browserStage.ts`, `web/play.html`(`#title` 블록 삭제: 타이틀은 124 가 맡는다)

**Interfaces:**
- Produces: `class DialogBox<T> { constructor(frame, template, metrics) ; bind(id, fn(el)) ; show(): Promise<T> ; close(value: T) }`; `confirm(frame, templates, text) -> Promise<boolean>`(126: 1058 에 글, 6 예 → true, 7 아니오/Esc → false); `pickSave(frame, templates, saves, mode: 'load' | 'save') -> Promise<{ slot } | { fresh: true } | null>`(143: 리스트 1060 에 32 슬롯 `NN  stage SS  턴 T  Gold G` 또는 `-- 비어 있음 --`/`손상됨`(불러오기에서 비활성), 1 결정, 2 취소, 8000 처음부터 는 load 모드에서만 보임); `titleDialog(frame, templates) -> Promise<'new' | 'load'>`(124: 리스트 1051 은 스테이지 이름 1개 "파랜드 택틱스 2"(원작의 스테이지 선택은 데모용 [추정]), 1 게임 개시, 2 불러오기).
- Consumes: Task 2 `layoutDialog`, `SaveSummary`(`src/game/save*.ts`).

- [x] **Step 1: 실패하는 테스트** — 모델 수준: `dialog.ts` 의 `resolveResult(template, controlId, state)` 와 `savesRows(saves, mode)`:

```ts
// web/test/winDialog.test.ts
import { describe, expect, it } from 'vitest';
import { savesRows } from '../src/ui/win/screens/saves';
import { titleChoice } from '../src/ui/win/screens/title';

describe('data select dialog 143', () => {
  it('rows name the slot, stage, turn and gold; empty and corrupt slots are marked and not loadable', () => {
    const rows = savesRows([{ stage: 3, turn: 2, gold: 150, corrupt: false }, null, { stage: 0, turn: 0, gold: 0, corrupt: true }], 'load');
    expect(rows[0]).toEqual({ slot: 0, text: '01  3일째  턴 2  150 Gold', enabled: true });
    expect(rows[1]).toEqual({ slot: 1, text: '02  -- 비어 있음 --', enabled: false });
    expect(rows[2]).toEqual({ slot: 2, text: '03  손상됨', enabled: false });
  });
  it('in save mode an empty slot is a target and 처음부터 is hidden', () => {
    const rows = savesRows([null], 'save');
    expect(rows[0]!.enabled).toBe(true);
  });
});
describe('title dialog 124', () => {
  it('maps the two buttons', () => { expect(titleChoice(1)).toBe('new'); expect(titleChoice(2)).toBe('load'); });
});
```

- [x] **Step 2: 실패 확인** — Run: `npx vitest run test/winDialog.test.ts`. Expected: FAIL.
- [x] **Step 3: 구현** — `dialog.ts`: 템플릿 → DOM(`<div class="w95-dialog" role="dialog">` 제목 막대(파란 그라데이션 없이 단색 `--w95-sel`), 컨트롤: button → `<button>`, static → `<span>`(정렬), edit → `<input>`, listbox → `<select size>` 또는 `<div role=listbox>`(더블클릭 지원), SysTabControl32 → 탭 헤더 + 자식 템플릿 교체), 모달 스택(`frame` 안 `#modals`), 포커스 기본 버튼, Esc = IDCANCEL(2) 또는 아니오(7), Enter = 기본 버튼. `screens/*.ts`: 위 함수. `dialogue.ts`: 'ask' 는 `confirm`, 'save' 는 `pickSave(mode 'save')`, `openLoad` 는 `pickSave('load')`, 옛 `slotPicker`/`openSaveSlots`/`openLoad` 와 관련 CSS·테스트 삭제. `browserStage`/`main`: 타이틀 → `titleDialog`.
- [x] **Step 4: 통과 확인** — 테스트 + tsc + `npx vitest run`(dialogue.test.ts 갱신 포함) + 브라우저: 새 게임 → 124 → 저장 F5 → 143.
- [x] **Step 5: 커밋** — `git commit -am "feat(web): dialog engine from the original templates; 확인 126, 데이터 선택 143, 스테이지 선택 124 replace the HTML modals"`

### Task 6: 유니트 일람 107 (탭 117 상태 · 119 장비 · 118 매각)

**Files:**
- Create: `web/src/ui/win/screens/unitList.ts`, `web/test/winUnitList.test.ts`
- Modify: `web/src/ui/dialogue.ts`(`openParty` 삭제 → `unitList`), `web/src/game/browserStage.ts`(F2·메뉴 40010·마을 오른쪽 클릭·상점 '유니트 일람' → `unitList`)

**Interfaces:**
- Produces: `statusRows(u: Unit, tables) -> { id: number; text: string }[]`(1014 체력 `hp/hpMax`, 1015 마력, 1016 공격력 `totals.atk`, 1017 방어력, 1018 지력 `wis`, 1019 마항력 `mgr`, 1020 민첩성 `agi`, 1032 경험치, 1033 레벨, 1008 이름, 1010 종족), `equipRows(u, tables) -> { 1035: 무기, 1037: 방패, 1034: 장비1, 1032: 장비2, 1036: 소지물[] }`, `sellRows(u, inv, tables) -> { 1048: [소지금], 1023: 가방 항목(이름, 반값) }`, `unitList(frame, templates, ctx, extra?) -> Promise<void>`(리스트 1002 = 파티원, 탭 전환, 1004 이동 = 원작의 "이동(&M)" 은 전투 중 선택 유닛으로 커서 이동 [추정] → 비활성으로 둔다, 1005 닫기; 매각 탭 더블클릭 → `sell()` → 문구 `SELL_TEXT[result]`).
- Consumes: `totals`, `itemsOf`, `sell`(shop.ts), `equip/unequip`(equipment.ts), Task 5 `DialogBox`.

- [x] **Step 1: 실패하는 테스트**

```ts
// web/test/winUnitList.test.ts
import { describe, expect, it } from 'vitest';
import { sellRows, statusRows } from '../src/ui/win/screens/unitList';
import { unit } from './helpers/battleFixtures';
import { emptyInventory } from '../src/battle/inventory';
import { tables } from './helpers/tables';

describe('unit list 107', () => {
  it('status tab 117 fills the original control ids', () => {
    const rows = statusRows(unit({ slot: 0, hp: 40, hpMax: 64, mp: 3, mpMax: 30, level: 15, exp: 23 }), tables);
    expect(rows).toContainEqual({ id: 1014, text: '40/64' });
    expect(rows).toContainEqual({ id: 1033, text: '15' });
    expect(rows).toContainEqual({ id: 1032, text: '23' });
  });
  it('sell tab 118 lists the bag at half price and the purse', () => {
    const inv = emptyInventory(); inv.gold = 120;
    const rows = sellRows(unit({ slot: 0, bag: [6, 0, 0, 0] }), inv, tables);
    expect(rows.gold).toBe('120');
    expect(rows.bag[0]).toEqual({ index: 0, text: `${tables.item[6]!.name.replace(/_/g, ' ')}  ${Math.floor(tables.item[6]!.price / 2)} Gold` });
  });
});
```

- [x] **Step 2: 실패 확인** — Run: `npx vitest run test/winUnitList.test.ts`. Expected: FAIL.
- [x] **Step 3: 구현** — 위 함수들 + `unitList` DOM 바인딩(탭 117/119/118 템플릿을 1022 자리에 겹침, 더블클릭 → 장비 탭은 장착/해제 메뉴(팝업 재사용: '장착한다/벗는다/그만둔다' [추정 문구]), 매각 탭은 `confirm` 없이 즉시 판매 → 원작 153 "몇개 팔았습니까?" 는 소모품 묶음 판매용이므로 가방 1개 판매에는 쓰지 않는다 [추정]). `dialogue.ts` 의 `openParty` 와 그 테스트·CSS 삭제.
- [x] **Step 4: 통과 확인** — 테스트 + tsc + 전체 Vitest + 브라우저 F2.
- [x] **Step 5: 커밋** — `git commit -am "feat(web): 유니트 일람 dialog 107 with the status, equipment and sale tabs"`

### Task 7: 상점(150·151·152) · 환경설정(156) · BGM(160) · 경험치 배분(162) · 클리어 조건

**Files:**
- Create: `web/src/ui/win/screens/shop.ts`, `screens/settings.ts`, `screens/bgm.ts`, `screens/expShare.ts`, `web/test/winShop.test.ts`, `web/test/winExpShare.test.ts`
- Modify: `web/src/ui/dialogue.ts`(`shop`, `battleResult` 삭제), `web/src/game/browserStage.ts`, `web/src/game/main.ts`(음량 → 156), `web/play.html`(`#audio` 블록 삭제)

**Interfaces:**
- Produces: `shopRows(ids, inv, tables) -> { 1081: ['이름  가격  보유'], 1082: rows }`, `buyFlow(frame, templates, ctx, id) -> Promise<void>`(151 갯수 edit 1073 기본 1, 1076 소지금, 1077 금액 = 가격×갯수; 장비면 152 누가 사나(1099 파티원, 1100 소지품) → `buy()` 결과 문구), `settingsModel(audio) -> { 1092/1093 전체화면, 1094/1095 효과음, 1096 안내문(사운드폰트 상태) }` + 음악 음량은 1090/1091 자리 대신 슬라이더 1개 추가 [추정: 원작 음원 선택은 웹에 없음], `expShareDialog(frame, templates, party, pool) -> Promise<number[]>`(162: 막대 7개 = 파티원 순서, 소유자 그리기 막대는 `<input type=range>` 로 대체 [추정], 1114~1120 `exp(+share)`, 1110 남은 풀, 1109 밸런스 = `equalizeShare`, 1108 균등 = `evenShare`, 1 결정), `objectiveMessage(entry) -> string`(메뉴 40032 → 메시지창 `MESSAGE` 와 같은 자리).
- Consumes: `buy`, `countOf`, `evenShare`, `equalizeShare`, `EXP_CAP`, `AudioGate`/음량 API(`src/audio/*`).

- [x] **Step 1: 실패하는 테스트**

```ts
// web/test/winExpShare.test.ts
import { describe, expect, it } from 'vitest';
import { expShareModel } from '../src/ui/win/screens/expShare';

describe('EXP share dialog 162', () => {
  it('opens on the equalizing split, caps each bar by the pool left and labels exp(+share)', () => {
    const m = expShareModel([{ exp: 100 }, { exp: 300 }], 400);
    expect(m.shares).toEqual([300, 100]);
    m.set(0, 1000);                                                         // more than the pool: clamped to what the others leave
    expect(m.shares).toEqual([300, 100]);
    m.set(1, 0); m.set(0, 1000);
    expect(m.shares).toEqual([400, 0]);
    expect(m.label(0)).toBe('100(+400)');
    expect(m.left()).toBe(0);
  });
  it('균등 splits evenly', () => { const m = expShareModel([{ exp: 0 }, { exp: 0 }, { exp: 0 }], 10); m.even(); expect(m.shares).toEqual([4, 3, 3]); });
});
```

```ts
// web/test/winShop.test.ts
import { describe, expect, it } from 'vitest';
import { buyTotal, shopRows } from '../src/ui/win/screens/shop';
import { emptyInventory } from '../src/battle/inventory';
import { tables } from './helpers/tables';

describe('shop dialogs 150/151', () => {
  it('rows show name, price and owned count', () => {
    const inv = emptyInventory();
    expect(shopRows([6], inv, tables)[0]).toEqual({ id: 6, text: `${tables.item[6]!.name.replace(/_/g, ' ')}  ${tables.item[6]!.price} Gold  보유 0` });
  });
  it('몇개 삽니까 totals price × count and refuses what the purse cannot pay', () => {
    expect(buyTotal(tables.item[6]!, 3, 1000)).toEqual({ total: tables.item[6]!.price * 3, ok: true });
    expect(buyTotal(tables.item[6]!, 3, 10).ok).toBe(false);
  });
});
```

- [x] **Step 2: 실패 확인** — Run: `npx vitest run test/winShop.test.ts test/winExpShare.test.ts`. Expected: FAIL.
- [x] **Step 3: 구현** — 위 모델 + DOM 바인딩. `dialogue.ts` 의 `shop`/`battleResult`/`BUY_TEXT` 사용처를 옮기고 삭제; `openModal` 은 `message` 만 남긴다(메시지창은 화면 안 — 그대로). `main.ts` 의 음량 슬라이더 → 156 바인딩(`localStorage` 유지).
- [x] **Step 4: 통과 확인** — 테스트 + tsc + 전체 Vitest(dialogue.test.ts·gameHooks.test.ts 의 상점·결과 테스트를 새 모델 테스트로 대체) + 브라우저: 마을 상점 → 150 → 151 → 152; 전투 승리 → 162; F11 → 156.
- [x] **Step 5: 커밋** — `git commit -am "feat(web): shop, settings, BGM and EXP-share dialogs from the original templates; the HTML modals are gone"`

### Task 8: 개발 패널 격리, 캠페인 워크, 문서

**Files:**
- Modify: `web/play.html`(`#panel` 은 `?dev=1` 에서만; 안내문 줄 삭제), `web/src/game/main.ts`(`new Panel` 은 dev 에서만; `panel` null 허용 — `handle()`/`dispatch()` 의 `!panel` 조건 제거), `web/src/ui/panel.ts`(개발 전용 주석; `menuEnabled` 는 Task 4 에서 옮겨짐), `web/src/game/browserStage.ts`(메뉴 명령 id → 동작: 40010 유니트 일람, 40030 전체 맵 [추정: 축소 맵 캔버스 오버레이], 40003 전체 화면, 40032 클리어 조건, 40009 턴 종료, 40028/40029 불러오기/저장, 40012 환경설정, 40004 게임종료 → `confirm` 뒤 타이틀), `docs/manual.md`(§7 플레이 조작: 메뉴·F키·팝업·대화상자, `?dev=1`), `README.md`(로드맵 행 7), `analysis/story_flow.md` §7a(내보내기와 웹 구현 표시)
- Test: `web/test/campaignWalk.test.ts` 는 변경 없이 통과해야 한다; `web/test/gameHooks.test.ts` 의 패널 가정 제거

- [x] **Step 1: 실패하는 테스트** — `web/test/winCommands.test.ts`: `menuCommand(id) -> Action` 매핑(40009 → `{ type: 'endTurn' }`, 40010 → `'unitList'`, 40003 → `'fullscreen'`, 40032 → `'objective'`, 40028 → `'load'`, 40029 → `'save'`, 40012 → `'settings'`, 40004 → `'quit'`, 40030 → `'fullMap'`, 모르는 id → null).
- [x] **Step 2: 실패 확인** — Run: `npx vitest run test/winCommands.test.ts`. Expected: FAIL.
- [x] **Step 3: 구현** — 매핑 + `browserStage` 연결 + dev 격리 + 전체 맵 오버레이(맵 전체를 1/4 로 그린 캔버스, 클릭으로 닫기, [추정]) + 문서.
- [x] **Step 4: 통과 확인** — `cd web && npm run check`(tsc + Vitest 전부, 캠페인 워크 포함) + `python3 -I -m unittest discover -s tools -p 'test_*.py'` + 브라우저 확인(§1-7 순서, 스크린샷을 `docs/img/ui-*.png` 에 저장).
- [x] **Step 5: 커밋** — `git commit -am "feat(web): the interface lives inside the game window — dev panel behind ?dev=1; manual and README"`

### Task 9: 최종 리뷰와 보고

- [x] 리뷰 패키지 → Fable 리뷰어(파일 수정 금지) → Critical/Important 수정(RED→GREEN) → 두 스위트 → 커밋.
- [x] 보고 아티팩트(완성 보고)에 §11 "원작 UI 재현" 추가: 메뉴·팝업·대화상자 화면 7장, 추정 목록(전체 맵, 소유자 그리기 그림, 탭 '이동' 버튼, 음원 선택 대체), 테스트 수.
- [x] 메모리 파일 갱신.
