# 세이브·불러오기·타이틀 (하위 프로젝트 5 계획 A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원작 `save%02d.dat`(6848 B)와 양방향 호환되는 세이브/불러오기를 `play.html` 에 넣는다 — 브라우저 32슬롯, `.dat` 내보내기/가져오기, `SAVE_GAME` 슬롯 모달, 자동 저장 30·31, 타이틀의 불러오기.

**Architecture:** `save/format.ts` 가 바이트 ↔ `Campaign` 변환(순수), `save/store.ts` 가 슬롯 저장소(백엔드 교체 가능: IndexedDB / 메모리), `GameCore` 가 `saveBytes()`/`loadGame(bytes)` 와 자동 저장을 맡고 `Stage.writeSave` 로 바이트를 내보낸다. 슬롯 모달은 `Dialogue` 에, 저장소·파일 입출력은 `play/main.ts` 에 둔다.

**Tech Stack:** TypeScript, Vitest(가짜 백엔드), IndexedDB, `TextDecoder('euc-kr')` 로 CP949 디코드 + 역매핑으로 인코드.

**Spec:** `docs/superpowers/specs/2026-10-16-save-sound-visual-design.md` §4, §6, §9, §10, §11, §12(계획 A), §14.

## Global Constraints

- 세이브 정식 형식 = 원작 바이너리 6848 B(헤더 468 + 유닛 50×124 + 마을 블록 180) — `analysis/file_formats.md` §6·§7 의 오프셋 그대로.
- 스크립트 플래그는 24개(`FLAG_COUNT = 24`); 인덱스 ≥ 24 는 경고 후 무시.
- 모르는 필드는 0 으로 쓴다. 문자열은 CP949, 32 B, NUL 종료, 넘치면 자른다.
- 자동 저장: `BATTLE_START(_HEAL)` 직후 슬롯 30, `roundStart` 이벤트 뒤 슬롯 31.
- `npm run check` 가 매 작업 끝에 녹색이어야 한다.

## Review Focus

1. **`Restart` 라벨이 없는 스테이지의 세이브를 불러오면** 경고 로그 뒤 타이틀로 돌아간다(멈추지 않는다). → Task 3 테스트 `loading a save whose stage has no Restart label warns and returns to the title`.
2. **전투 중 저장(슬롯 30)을 불러오면** 스테이지 `Restart` 가 전투를 다시 세운다 — 코퍼스 20개 파일 모두 `Restart` 를 가진다. → Task 3 코퍼스 테스트 `every event file has a Restart label`.
3. **길이가 6848 이 아니거나 헤더가 468 이 아닌 파일 가져오기**는 거부되고 메시지가 남는다. → Task 1 테스트 `decodeSave rejects a wrong size or header`, Task 2 `importBytes rejects a bad file`.
4. **IndexedDB 를 열 수 없으면** 메모리 백엔드로 대체하고 안내 한 줄. → Task 4 (브라우저 확인; 코드는 try/catch 폴백).
5. **주문 11개 이상·가방 외 필드 넘침**: 인코드가 10개로 자르고 경고. → Task 1 테스트 `encodeUnit keeps at most 10 spells`.

## File Structure

```
web/src/save/cp949.ts        decodeCp949(bytes), encodeCp949(str) (TextDecoder 역매핑, 지연 생성)
web/src/save/format.ts       SAVE_SIZE/HEADER_SIZE/UNIT_SIZE/TOWN_BLOCK, SaveError, encodeSave/decodeSave, encodeUnit/decodeUnit, saveSummary
web/src/save/store.ts        SlotBackend, MemoryBackend, IdbBackend, SaveStore(summaries/read/write/remove/importBytes), SLOT_COUNT 32
web/src/game/campaign.ts     FLAG_COUNT 24, bgm
web/src/script/vm.ts         MUSIC → c.bgm; SAVE_GAME n≥0 즉시, n<0 모달
web/src/game/gameCore.ts     saveBytes(), loadGame(bytes), save(slot) → stage.writeSave, 자동 저장 30/31, Stage.writeSave
web/src/ui/dialogue.ts       openModal('save') 슬롯 선택 모달(결과 슬롯/−1), openLoad(summaries, onPick, onImport)
web/src/play/main.ts, web/play.html   타이틀 불러오기, 저장소 조립, 내보내기/가져오기
web/test/{cp949,saveFormat,saveStore}.test.ts, gameCore.test.ts 추가, vm.test.ts 추가, dialogue.test.ts 추가
docs/manual.md §7, README.md
```

---

### Task 1: 세이브 형식 (format)

**Files:** Create `web/src/save/cp949.ts`, `web/src/save/format.ts`; Modify `web/src/game/campaign.ts` (FLAG_COUNT 24, `bgm`); Test `web/test/cp949.test.ts`, `web/test/saveFormat.test.ts`.

**Interfaces:**
```ts
export function decodeCp949(bytes: Uint8Array): string;           // NUL 에서 끝
export function encodeCp949(s: string, size: number): Uint8Array; // size 바이트, NUL 채움, 넘치면 자름(2 B 문자 경계 보존)
export const SAVE_SIZE = 6848, HEADER_SIZE = 468, UNIT_SIZE = 124, TOWN_BLOCK = 180;
export class SaveError extends Error {}
export interface SaveSummary { stage: number; title: string; turn: number; date: Date | null; bgm: number; gold: number; message: string }
export function saveSummary(bytes: Uint8Array): SaveSummary;     // 헤더만 읽는다; 길이/헤더 검사
export function encodeUnit(u: Unit | null, view: DataView, off: number, warn: (s: string) => void): void;
export function decodeUnit(view: DataView, off: number, slot: number): Unit | null;   // id 0 → null
export function encodeSave(c: Campaign, date: Date, warn?: (s: string) => void): Uint8Array;
export function decodeSave(bytes: Uint8Array): Campaign;         // SaveError on size/header
```
- 유닛 워드 맵: `battle_rules.md` §7. 슬롯 < 10 이면 0xe..0x11 = bag, 아니면 0xe dropItem, 0xf dropGold. 주문 0x1c..0x25 (10개, 0 = 없음), 버프 0x26..0x2a (i16), elem 0x2b..0x2d, moved 0x2e (i32), acted 0x30, special 0x32, statusCounter 0x34, 핸들 0x36..0x3d = 0. `sprite` 는 저장하지 않는다.
- 마을 블록: +0 180, +88 townFlags[15], +168 night(townSet ≥ 2), +172 extra, +176 dark(townSet 3). 디코드: townSet = dark ? 3 : night ? 2 : 1.
- 헤더: +0 468, +4 stage, +6 episode, +38 turn(i16), +40 flags[24], +90 SYSTEMTIME(연, 월, 요일, 일, 시, 분, 초, 밀리초), +106 bgm, +108 gold, +112 (id, count)×80, +436 message.

- [ ] **Step 1: 실패하는 테스트** — cp949: `encodeCp949('첫업무', 32)` 는 32 B 이고 되돌리면 같다; ASCII 와 `_` 보존; 넘침은 문자 경계에서 자름. format: 새 게임 캠페인 + 로스터 적용(fixtures) → `encodeSave` → 길이 6848, `view.getUint32(0, true) === 468`, +4 stage, +38 turn −1 (0xffff), +108 gold 200; `decodeSave(encodeSave(c))` 가 units(id/race/level/c/r/hp/exp/bag/spells)·flags·inventory·townFlags·turn·episode·message·bgm 을 되돌린다; 잘못된 길이/헤더 → `SaveError`; 주문 11개 → 10개 + 경고; 실제 세이브(`../extracted/FarlandTactics2/save/save09.dat` 가 있으면): `saveSummary` 제목 '첫업무', 소지금 200, stage 1, turn ≥ 0, 유닛 0 레벨 2 (없으면 `it.skip`).
- [ ] **Step 2–4: RED → 구현 → `npm run check`.** **Step 5: 커밋** — `"feat(web): original save file format (encode/decode 6848 B) and CP949 strings"`

---

### Task 2: 슬롯 저장소 (store)

**Files:** Create `web/src/save/store.ts`; Test `web/test/saveStore.test.ts`.

**Interfaces:**
```ts
export const SLOT_COUNT = 32;
export interface SlotBackend { get(slot: number): Promise<Uint8Array | null>; put(slot: number, bytes: Uint8Array): Promise<void>; remove(slot: number): Promise<void>; keys(): Promise<number[]> }
export class MemoryBackend implements SlotBackend {}
export class IdbBackend implements SlotBackend { static open(dbName = 'ft2'): Promise<IdbBackend> }   // 실패 시 reject
export class SaveStore {
  constructor(backend: SlotBackend);
  summaries(): Promise<(SaveSummary | null)[]>;   // 길이 32
  read(slot: number): Promise<Uint8Array | null>;
  write(slot: number, bytes: Uint8Array): Promise<void>;   // 길이/헤더 검사(SaveError)
  remove(slot: number): Promise<void>;
  importBytes(slot: number, bytes: Uint8Array): Promise<SaveSummary>;   // 검사 후 write
  static fileName(slot: number): string;   // save%02d.dat
}
```
- [ ] **Step 1: 실패하는 테스트** — 메모리 백엔드로 write/read/summaries(빈 슬롯 null)/remove; 잘못된 바이트 write → `SaveError`; `fileName(30)` = `save30.dat`; 슬롯 범위 밖 → RangeError.
- [ ] **Step 2–4: RED → 구현 → check.** **Step 5: 커밋** — `"feat(web): save slot store with IndexedDB and memory backends"`

---

### Task 3: GameCore 저장·불러오기와 VM

**Files:** Modify `web/src/game/gameCore.ts`, `web/src/script/vm.ts`, `web/src/script/host.ts`(FakeHost 변경 없음), `web/test/helpers/stageFixtures.ts`; Test `web/test/gameCore.test.ts`, `web/test/vm.test.ts`, `web/test/eventCorpus.test.ts`.

**Interfaces:**
- `Stage.writeSave(slot: number, bytes: Uint8Array): void` (FakeStage: `saves: Map<number, Uint8Array>`).
- `GameCore.saveBytes(): Uint8Array` (`encodeSave(campaign, new Date())`); `GameCore.save(slot)`: slot ≥ 0 → `stage.writeSave(slot, saveBytes())` + info 로그; slot < 0 → 아무것도 안 함.
- `GameCore.loadGame(bytes: Uint8Array): boolean`: `decodeSave` → 캠페인 교체, VM 재생성, 전투/훅/마을/대화 비움, presenter.sync, `startScript(turn < 0 ? 0 : stage, 'Restart')`; 실패(SaveError 또는 라벨 없음) → 경고 로그, 모드 `title`, false. `bgm > 0` 이면 `music(bgm)`.
- 자동 저장: `startBattle()` 끝에 `save(30)`; `handle(events)` 가 `roundStart` 를 보면 `save(31)`.
- VM: `MUSIC n` → `c.bgm = n`; `SAVE_GAME n`: n ≥ 0 → `host.save(n)` 바로; n < 0 → 모달 'save' → 결과 ≥ 0 이면 `host.save(결과)`.
- [ ] **Step 1: 실패하는 테스트** — gameCore: BATTLE_START 뒤 `stage.saves.get(30)` 길이 6848 이고 `saveSummary` 의 stage/gold 가 맞다; 적 턴이 끝나 `roundStart` 가 나오면 슬롯 31; `loadGame(bytes)` 가 flags/gold/units 를 되살리고 `Restart` 를 실행(stage 프로그램에 `Restart` → FLAG_SET 9 1 → END → town); 턴 −1 세이브는 EVENT00 `Restart`; `Restart` 가 없는 stage → false + 경고 + 모드 title; vm: `MUSIC 6` → `c.bgm === 6`; `SAVE_GAME 30` → `host.calls` 에 `['save', 30]` 이고 모달 없음; `SAVE_GAME -1` + `host.modal = 5` → `['save', 5]`; corpus: 20개 파일 모두 `findLabel(p, 'Restart') !== null`.
- [ ] **Step 2–4: RED → 구현 → check.** **Step 5: 커밋** — `"feat(web): save/load through GameCore (autosave 30/31, Restart), SAVE_GAME slots in the VM"`

---

### Task 4: 슬롯 모달·타이틀·페이지

**Files:** Modify `web/src/ui/dialogue.ts`, `web/src/play/main.ts`, `web/play.html`, `web/src/game/browserStage.ts`; Test `web/test/dialogue.test.ts`.

**Interfaces:**
- `ModalContext.saves?: (SaveSummary | null)[]` (페이지가 최신 요약을 넘긴다).
- `openModal('save', payload, ctx)`: 32행(번호 · 제목 또는 "비어 있음" · 날짜 · 소지금) 버튼; 찬 슬롯은 "덮어쓰기" 확인 버튼이 한 번 더 뜬다; 취소 → −1.
- `Dialogue.openLoad(saves, onPick: (slot) => void, onImport: (file: File) => void)`: 찬 슬롯만 선택 가능, 파일 입력 1개(가져오기), 닫기.
- `BrowserStage.writeSave(slot, bytes)` → `hooks.writeSave(slot, bytes)`; 페이지: `SaveStore` 조립(`IdbBackend.open()` 실패 → `MemoryBackend` + 안내), 쓰기 뒤 요약 갱신, 내보내기 버튼(각 행, Blob 다운로드), 타이틀 **불러오기**, `loadGame` 성공 시 타이틀 숨김.
- [ ] **Step 1: 실패하는 테스트**(dialogue) — save 모달: 빈 슬롯 클릭 → 결과 슬롯; 찬 슬롯 클릭 → "덮어쓰기" 확인 뒤 결과; 취소 → −1. openLoad: 빈 슬롯 버튼은 `disabled`; 찬 슬롯 클릭 → onPick(slot).
- [ ] **Step 2: 구현, `npm run check`.** **Step 3: 브라우저 점검**(새 탭): 새 게임 → 첫 전투 진입 → 슬롯 30 생성 확인(`__ft2`) → 페이지 새로고침 → 불러오기 → 슬롯 30 → `Restart` 로 전투 재개; 2015 세이브 `save/save01.dat` 가져오기 → 스테이지 12 `Restart`; 콘솔 오류 0.
- [ ] **Step 4: 문서** — manual §7.7 "저장과 불러오기"(슬롯·자동 저장·내보내기/가져오기·원작 세이브 호환), README 진행 상태, 스펙 상태. **Step 5: 커밋** — `"feat(web): save slot modals, title load, export/import (.dat)"`
