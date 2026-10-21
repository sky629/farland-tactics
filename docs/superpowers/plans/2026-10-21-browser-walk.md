# 브라우저 자동 플레이(렌더링 검증) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캠페인 워크의 플레이어 규칙을 실제 브라우저 페이지에 연결해, 새 게임부터 엔딩까지 매 프레임을 그리면서 자동 플레이하고, 정해진 순간의 화면과 자동 판정을 모은 보고서를 만든다.

**Architecture:** 테스트 안의 결정 논리를 `Walker` 클래스로 떼어내고, 바깥세상(헤드리스 `MapStage` / 브라우저 페이지)과는 `WalkWorld` 인터페이스로만 만나게 한다. 브라우저 쪽 `walk.ts` 는 가상 시계로 `main.ts` 의 프레임 함수를 돌리며(자산 로딩 중에는 멈춤), 포착 순간과 자동 판정을 계산해 `window.__walk` 로 내놓는다. ego 브라우저의 Node 스크립트가 그 신호를 받아 화면을 저장하고, Python 스크립트가 보고서를 만든다.

**Tech Stack:** TypeScript(Vite, vitest), ego-browser(`ego-browser nodejs`, `page.evaluate/waitForFunction/cdp`), Python 3 표준 라이브러리 + macOS `sips`.

**Spec:** `docs/superpowers/specs/2026-10-20-browser-walk-design.md`

## Global Constraints

- 결정 논리는 한 벌: `web/src/dev/walker.ts` 만. 테스트도 페이지도 그것을 쓴다.
- 게임 코드 변경은 계측뿐: 자산 층의 미결 카운터, 프레임 함수의 외부 호출, 대화상자 DOM 의 `data-id`/`data-template`. 게임의 동작은 바뀌지 않는다.
- 가상 시계 간격 `1000 / 60` ms. 자산 미결(`stage.loading > 0` 또는 `#win`/`#dialogue` 의 미완성 `<img>`)이 있으면 가상 시각을 멈춘다.
- 자동 플레이는 타이틀을 열지 않는다. 패배·되돌리기의 불러오기는 `core.loadGame`.
- 세이브는 메모리 백엔드. 결과물은 스크래치패드 `walk-browser/<YYYYMMDD-HHMM>/`. 저장소에는 코드·문서만 커밋한다.
- 개발 서버 포트 5199. 5173 은 쓰지 않는다.
- `Rng` 씨앗 기본 7, 재시도·되돌리기의 재씨앗 규칙은 헤드리스와 같다.
- 성공 기준: `error`·`stuck` 0, `warn` 0, 전투 33, `game complete`. `blank`·`overflow` 는 사람이 본다.
- 커밋 끝: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `python3 -I`. 그림 보고서는 HTML.

## Review Focus

1. 한 프레임에 포착 순간이 둘 이상(예: 맵 로드와 대화상자 열림)이면 둘 다 찍혀야 한다 — Task 4 `momentsBetween` 테스트(여러 태그 반환).
2. `&from=` 세이브로 시작한 뒤 첫 패배에서 재시도할 자동 세이브 30 이 있어야 한다 — Task 1 `Walker` 생성 옵션 `from` 이 그 바이트를 슬롯 30 으로 삼는 테스트(헤드리스 `WALK_FROM` 경로와 같음).
3. 드라이버의 `waitForFunction` 이 시간 초과로 끝나도 페이지는 멈춘 채 다음 라운드를 기다리고, 매니페스트는 페이지에 남아 있어야 한다 — Task 5 의 `__walk.manifest()` 가 `pending` 상태에서도 전체를 반환하는 테스트.
4. 페이드 중(알파 ≥ 1)이나 비주얼 씬 재생 중의 검은 프레임은 `blank` 가 아니다 — Task 4 `blankFlag` 테스트.
5. 비주얼 씬 재생 중 60초 넘게 VM pc 가 같아도 `stuck` 이 아니다(부가 바뀌면 리셋, 220초 규칙) — Task 4 `StuckWatch` 테스트.

---

### Task 1: Walker 추출 — 테스트에서 `web/src/dev/walker.ts` 로

**Files:**
- Create: `web/src/dev/walker.ts`
- Modify: `web/test/campaignWalk.test.ts` (얇은 하네스로)
- Test: `web/test/campaignWalk.test.ts`(기존 단언 유지), `web/test/walker.test.ts`(새)

**Interfaces:**
- Produces:
  ```ts
  export type WalkModalKind = 'message' | 'ask' | 'save' | 'result' | 'shop';
  export interface WalkWorld {
    click(): void;                                   // WAIT_CLICK 한 번 넘기기
    answer(kind: WalkModalKind, value: number): void; // 모달 응답 전달
    presenterBusy(): boolean;
    autosave(slot: 30 | 31): Uint8Array | null;
    reseed(seed: number): void;
    log(line: string): void;                         // Walker 의 로그 줄(`walk: …`, `warn:walk …`)
  }
  export interface WalkerOptions { maxRetries?: number; stopStage?: number; stopBattles?: number; from?: Uint8Array | null; onAutosave?: (n: number, bytes: Uint8Array) => void }
  export type StepResult = 'frame' | 'skip' | 'stop';   // frame: core.frame(now) 를 부른다, skip: 이번 프레임은 건너뛴다(방금 불러왔다), stop: 끝
  export class Walker {
    constructor(core: GameCore, tables: Tables, world: WalkWorld, opts?: WalkerOptions);
    onModal(kind: WalkModalKind, payload: unknown): void;   // 안에서 world.answer 를 부른다
    onLog(kind: 'warn' | 'info', text: string): void;      // 'save 30'·'save 31'·'TEST_IS_ACTOR…'·경고
    step(now: number): StepResult;
    get finished(): boolean;                               // ended 이고 defeat 가 아님
    summary(): { stages: number[]; battles: number[]; towns: string[]; retries: string; strikes: string; picks: string; simulatedMs: number; log: string[]; turnLog: string[]; stopped: string };
  }
  ```
  모듈 수준 상태(`REACH`, `LESSONS`, `boldness`, `rushing`)는 그대로 모듈 수준에 둔다 — 한 번에 Walker 하나만 산다(문서 주석에 적는다).
- Consumes: 테스트의 기존 헬퍼 함수 전부(`enemyField` … `shopping`)는 그대로 `walker.ts` 로 옮긴다(비공개). 테스트의 `it` 본문 중 결정 논리는 `step()` 안으로, `stage.calls` 를 읽어 반응하던 부분은 `onModal`/`onLog` 로 간다.

- [x] **Step 1: 추출 전 요약을 남긴다**

Run: `cd web && rtk proxy npx vitest run test/campaignWalk.test.ts --reporter=verbose --silent=false 2>&1 | grep -E "^(picks|strikes|stages|battles at|towns|mode) " > /private/tmp/claude-501/-Users-kang-Documents-dev-farland-tactics/c85999d5-2c72-44f9-a278-18cf9d1354e5/scratchpad/walk-summary-before.txt; wc -l $_`
Expected: 6 줄(picks, strikes, stages, battles at, towns, mode).

- [x] **Step 2: 실패하는 테스트 `web/test/walker.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { Walker, type WalkWorld } from '../src/dev/walker';
// GameCore + MapStage 는 campaignWalk.test.ts 가 쓰는 것과 같은 자산 경로로 만든다(헬퍼를 test/helpers/walkFixtures.ts 로 옮겨 둘이 공유)
describe('Walker', () => {
  it('a new game: the first steps click the opening away and answer no modal; finished is false', () => {
    const calls: string[] = [];
    const world: WalkWorld = { click: () => calls.push('click'), answer: (k, v) => calls.push(`answer ${k} ${v}`), presenterBusy: () => false, autosave: () => null, reseed: () => {}, log: () => {} };
    const { core, tables } = newGameCore();            // walkFixtures
    const w = new Walker(core, tables, world);
    let now = 0; for (let i = 0; i < 50; i++) { now += 50; if (w.step(now) === 'frame') core.frame(now); }
    expect(calls.filter((c) => c === 'click').length).toBeGreaterThan(0);
    expect(w.finished).toBe(false);
  });
  it('from: the given save is this battle\'s autosave 30 (a retry reloads it) and the battle counts as number 1', () => {
    const { core, tables, saveAt } = newGameCore();     // saveAt(n): the BATTLE_START autosave of battle n from the walk fixtures (scratchpad saves48/battle-01-stage01.bin copied into test/fixtures/walk/)
    const bytes = saveAt(1);
    const w = new Walker(core, tables, stubWorld(), { from: bytes });
    expect(w.summary().battles).toEqual([core.campaign.stage]);
  });
  it('result: the EXP pool goes to one unit of the dialog\'s row set (status 9 excluded) and the answer is 0', () => {
    const answers: [string, number][] = [];
    const { core, tables } = newGameCore(); // then put the party into a state with one hidden member
    core.campaign.units[2]!.status = 9;
    const w = new Walker(core, tables, { ...stubWorld(), answer: (k, v) => answers.push([k, v]) });
    w.onModal('result', { gold: 0, pool: 100 });
    expect(answers).toEqual([['result', 0]]);
    expect(core.campaign.units[2]!.exp).toBe(/* unchanged */ core.campaign.units[2]!.exp);
  });
});
```
(세 번째 테스트는 Task 2 의 규칙을 미리 핀다: Task 1 에서는 `it.skip`, Task 2 에서 켠다.)

- [x] **Step 3: 실패 확인**

Run: `cd web && rtk proxy npx vitest run test/walker.test.ts`
Expected: FAIL — `Cannot find module '../src/dev/walker'`.

- [x] **Step 4: `web/src/dev/walker.ts` 를 만든다** — 테스트의 헬퍼 함수와 `it` 본문을 옮기고, `stage.*` 접근을 전부 `WalkWorld` 와 `GameCore` 로 바꾼다. 매핑: `stage.clicks = 1` → `world.click()`; `stage.modal = v` → `world.answer(kind, v)`; `stage.presenter.busy` → `world.presenterBusy()`; `stage.saves.get(30|31)` → `world.autosave(30|31)`; `res.rng = Rng.fromSeed(s)` → `world.reseed(s)`; `log.push` → 내부 배열 + `world.log`. `stage.visual = null` 과 `stage.fading = false` 는 옮기지 않는다(MapStage 의 일). 파일 머리에 모듈 주석: 결정 논리의 출처(캠페인 워크), 모듈 수준 상태의 제약.

- [x] **Step 5: 테스트 하네스를 얇게 만든다** — `campaignWalk.test.ts` 는 `MapStage` + `WalkWorld` 구현(`click: () => { stage.clicks = 1 }`, `answer: (_, v) => { stage.modal = v }`, `autosave: (n) => stage.saves.get(n) ?? null`, `reseed: (s) => { res.rng = Rng.fromSeed(s) }`) + 루프:
  ```ts
  for (let frame = 0; frame < 10_000_000 && !walker.finished && …stop conditions; frame++) {
    now += 50;
    for (; seen < stage.calls.length; seen++) { const c = stage.calls[seen]!; if (c[0] === 'openModal') walker.onModal(c[1] as WalkModalKind, c[2]); if (c[0] === 'log') walker.onLog(c[1] as 'warn' | 'info', String(c[2])); }
    if (stage.visual) stage.visual = null;
    if (core.mode === 'script') stage.fading = false;
    const r = walker.step(now); if (r === 'stop') break; if (r === 'skip') continue;
    core.frame(now);
  }
  ```
  콘솔 요약과 단언은 `walker.summary()` 에서 같은 문구로 찍는다. `WALK_SAVE_DIR`/`WALK_FROM`/`WALK_STOP_*` 는 `WalkerOptions`(`onAutosave`, `from`, `stopStage`, `stopBattles`)로 전달한다.

- [x] **Step 6: 두 테스트 통과 + 요약 동일 확인**

Run: `cd web && rtk proxy npx vitest run test/walker.test.ts test/campaignWalk.test.ts --reporter=verbose --silent=false 2>&1 | tee /private/tmp/claude-501/-Users-kang-Documents-dev-farland-tactics/c85999d5-2c72-44f9-a278-18cf9d1354e5/scratchpad/walk-after.txt | grep -E "Tests |FAIL"; grep -E "^(picks|strikes|stages|battles at|towns|mode) " /private/tmp/claude-501/-Users-kang-Documents-dev-farland-tactics/c85999d5-2c72-44f9-a278-18cf9d1354e5/scratchpad/walk-after.txt | diff - /private/tmp/claude-501/-Users-kang-Documents-dev-farland-tactics/c85999d5-2c72-44f9-a278-18cf9d1354e5/scratchpad/walk-summary-before.txt && echo SAME`
Expected: 모두 통과(세 번째 walker 테스트는 skip), `SAME`.

- [x] **Step 7: 커밋** `refactor(web): the campaign walker as a module (dev/walker.ts) behind WalkWorld; the test is its headless harness`

### Task 2: 경험치 받는 이를 대화상자 행 집합에 맞춘다

**Files:** Modify `web/src/dev/walker.ts`(onModal 'result'), `web/test/walker.test.ts`(skip 해제)

- [x] **Step 1: `it.skip` → `it`; 실패 확인** — Expected: FAIL(숨은 유닛이 풀을 받을 수 있음 또는 선택 집합 차이).
- [x] **Step 2: `onModal('result')` 의 `party` 를 `core.campaign.units.filter((u): u is Unit => u !== null && u.slot < PARTY_SLOTS && u.status !== 9)` 로 바꾼다** (대화상자 `dialogue.ts` 122행과 같은 규칙). 사다리(fighter/flyer 선택)는 그대로.
- [x] **Step 3: 통과 + 캠페인 워크 초록 확인** — Run: `cd web && rtk proxy npx vitest run test/walker.test.ts test/campaignWalk.test.ts 2>&1 | grep -E "Tests |FAIL"`. Expected: 모두 통과. 요약이 달라졌으면 그 차이를 커밋 메시지에 적는다.
- [x] **Step 4: 커밋** `fix(dev): the walker gives the EXP pool only to a unit dialog 162 lists (no hidden member)`

### Task 3: 계측 — 자산 미결 카운터, 대화상자 DOM 표식

**Files:**
- Modify: `web/src/assets/loader.ts`(`inflight`), `web/src/assets/bitmaps.ts`(`inflight`), `web/src/game/spriteCache.ts`(`inflight`), `web/src/game/browserStage.ts`(`get loading(): number`), `web/src/ui/win/dialog.ts`(`ControlSet`: `el.dataset['id']`; `DialogBox`: `box.dataset['template']`; `Dialogs`: `get opened(): number` 누적 카운터, `get top(): HTMLElement | null`)
- Test: `web/test/assetInflight.test.ts`(새), `web/test/winDialog.test.ts`(기존에 `opened` 카운터 단언 추가 — DOM 없는 모델 테스트가 가능한 범위에서; DialogBox 의 `data-template` 은 Task 5 의 브라우저 확인에서 본다)

**Interfaces:**
- Produces: `AssetLoader.inflight: number`(fetch 시작 +1, 끝 −1), `BitmapCache.inflight: number`(= pending.size), `SpriteCache.inflight: number`(= pending.size), `BrowserStage.loading: number` = `assets.inflight + bitmaps.inflight + sprites.inflight + (loading map ? 1 : 0) + (sheets 중 값이 null 인 수) + (visualImages 중 값이 null 인 수)`; `Dialogs.opened: number`(상자가 열릴 때마다 +1, 줄지 않음), `Dialogs.top`.

- [x] **Step 1: 실패하는 테스트**
```ts
// web/test/assetInflight.test.ts
it('AssetLoader.inflight counts fetches from start to settle', async () => {
  let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
  vi.stubGlobal('fetch', async () => { await gate; return new Response(new Uint8Array([0]), { status: 200 }); });
  const a = new AssetLoader('x'); const p = a.image('bmp', 'a').catch(() => null);
  expect(a.inflight).toBe(1); release(); await p; expect(a.inflight).toBe(0);
});
it('BitmapCache.inflight is the number of images still loading', …);   // Image 를 스텁: onload 를 수동으로 부른다
it('SpriteCache.inflight …', …);                                        // loader.apd 를 영원히 기다리게 하는 스텁
```
- [x] **Step 2: 실패 확인** — Run: `cd web && rtk proxy npx vitest run test/assetInflight.test.ts`. Expected: FAIL(`inflight` undefined).
- [x] **Step 3: 구현** — 세 카운터와 `BrowserStage.loading`, `Dialogs.opened/top`, `ControlSet` 의 `data-id`(id 가 null 이 아닐 때), `DialogBox` 의 `data-template`.
- [x] **Step 4: 통과 + 전체 검사** — Run: `cd web && rtk proxy npx vitest run test/assetInflight.test.ts test/winDialog.test.ts && rtk proxy npx tsc --noEmit -p .`. Expected: 통과, tsc 조용.
- [x] **Step 5: 커밋** `feat(web): instrumentation — inflight asset counters, Dialogs.opened/top, data-id/data-template on dialog DOM`

### Task 4: 순수 판정 모듈 `web/src/dev/walkChecks.ts`

**Files:** Create `web/src/dev/walkChecks.ts`; Test `web/test/walkChecks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface WalkSnapshot { t: number; mode: string; mapReady: boolean; turn: number | null; phase: string | null; selMode: string | null; town: boolean; visualPart: number | null; visualPlaying: boolean; dialogsOpened: number; dialogTemplate: string | null; fadeAlpha: number; pc: number }
  export function momentsBetween(prev: WalkSnapshot | null, cur: WalkSnapshot, lastTickT: number): string[];
  //  'map'(mapReady false→true), 'battle-start'(turn 1 ∧ phase player ∧ selMode idle, 전투마다 한 번: prev.turn !== 1 or prev.phase !== 'player'), 'battle-end'(phase 'end' 첫 프레임),
  //  'town'(town false→true), `scene-${part}`(visualPart 바뀜 — 호출자가 가상 1초 뒤에 찍도록 'scene-pending' 을 다룬다: 반환은 part 가 바뀐 프레임에 `scene-${part}`), `dialog-${template}`(dialogsOpened 증가),
  //  'tick'(cur.t − lastTickT ≥ 10000). 여러 개면 모두 반환(순서 고정: 위 순서).
  export function blankRatio(rgba: Uint8ClampedArray): number;            // 표본 픽셀 중 최빈색의 비율 0..1
  export function blankFlag(ratio: number, fadeAlpha: number, visualPlaying: boolean): boolean;   // ratio ≥ 0.99 ∧ fadeAlpha < 1 ∧ !visualPlaying
  export function overflowing(rects: { left: number; top: number; right: number; bottom: number }[], screen: { left: number; top: number; right: number; bottom: number }): number;   // 밖으로 나간 사각형 수
  export class StuckWatch { constructor(limitMs = 60000, sceneLimitMs = 220000); update(s: WalkSnapshot): boolean /* true = stuck */ }
  //  서명 = mode|pc|turn|dialogsOpened|fadeAlpha(소수 둘째 자리) ; visualPlaying 이면 서명 = `scene:${visualPart}` 에 sceneLimit 적용
  ```
- [x] **Step 1: 실패하는 테스트** — 위 Review Focus 1·4·5 를 포함: `momentsBetween` 이 map+dialog 둘을 돌려주는 경우, `blankFlag(1, 1, false) === false`, `blankFlag(1, 0, true) === false`, `blankFlag(0.995, 0, false) === true`, `overflowing([{-1,0,10,10}], screen)=1`, `StuckWatch`: 60초 같은 서명 → true, 씬 중 100초 → false, 씬 중 230초 → true, 부가 바뀌면 리셋.
- [x] **Step 2: 실패 확인** — Run: `cd web && rtk proxy npx vitest run test/walkChecks.test.ts`. Expected: FAIL(모듈 없음).
- [x] **Step 3: 구현** — 서명·규칙은 위 인터페이스 주석대로.
- [x] **Step 4: 통과 확인** — Expected: PASS.
- [x] **Step 5: 커밋** `feat(dev): walk checks — capture moments, blank/overflow/stuck rules`

### Task 5: 페이지의 자동 플레이 모드 `web/src/play/walk.ts` + `main.ts` 연결

**Files:**
- Create: `web/src/play/walk.ts`
- Modify: `web/src/play/main.ts`

**Interfaces:**
- `main.ts` 가 Produces: `function tick(now: number): void`(지금의 `frame` 본문에서 `requestAnimationFrame(frame)` 만 뺀 것; `frame` 은 `tick` 뒤에 rAF 를 건다); walk 모드 분기(`new URLSearchParams(location.search).get('walk') === '1'`): rAF 를 걸지 않음, `showTitle()` 을 부르지 않음(부팅 때도 `ended` 때도), `MemoryBackend` 강제, `stage.setVolumes(0, 0)`, `Rng.fromSeed(Number(params.get('seed') ?? 7))`, 부팅 끝에 `const { startWalk } = await import('./walk'); startWalk({ tick, core, stage, dialogs: dialogHost, dialogue, res, tables, params })`; `log()` 가 `walkLog?.(kind, text)` 모듈 변수도 부른다(walk.ts 가 설정).
- `walk.ts` Produces(`window.__walk`):
  ```ts
  interface WalkWindow { pending: { id: number; file: string; tag: string } | null; done: boolean; resume(): void; manifest(): WalkManifest; frameRect(): { x: number; y: number; width: number; height: number } }
  interface WalkManifest { run: { seed: number; from: string | null; startedAt: string; frames: number; simulatedMs: number; done: boolean; stopped: string | null }; shots: { id: number; tag: string; file: string; t: number; stage: number; battle: number; turn: number | null; mode: string; flags: string[] }[]; counts: Record<string, number>; log: string[]; console: { kind: 'error' | 'warn'; text: string }[] }
  ```
- `walk.ts` 의 `BrowserWorld implements WalkWorld`: `click` → `dialogue.noteClick()`; `answer(kind, v)` → 다음 재개 뒤 적용: `ask` → `[data-id="6"|"7"]` 클릭(v ? 6 : 7), `message` → `#dialogue .modal button` 클릭, `save` → `[data-id="2"]`, `shop` → `[data-id="1078"]`, `result` → 행별 `input.w95-bar` 값(받는 이 = `walker` 가 고른 슬롯의 행 index; `party.filter(u !== null && status !== 9)` 순서)을 설정하고 `input` 이벤트 → `[data-id="1"]` 클릭; 상자는 `dialogs.top`; 못 찾으면 `warn:walk no dialog for ${kind}` 로그. `presenterBusy` → `stage.presenter.busy`; `autosave(n)` → `stage.writeSave` 를 감싸 잡아 둔 바이트; `reseed(s)` → `res.rng = Rng.fromSeed(s)`; `openModal` 은 `stage.openModal` 을 감싸 `walker.onModal` 로, `log` 는 `walkLog` 로 `walker.onLog` 와 매니페스트 콘솔 목록으로.
- 가상 루프: `now += 1000/60`; 자산 대기(`stage.loading > 0` 또는 `#win,#dialogue img:not([complete])`)면 `await new Promise(r => setTimeout(r, 20))` 뒤 다시 검사(가상 시각 유지); 아니면 `walker.step(now)` → `'frame'` 이면 `tick(now)`; 프레임 뒤 스냅샷 → `momentsBetween` → 포착 큐; 큐가 있으면 `requestAnimationFrame` 한 번 기다린 뒤 `__walk.pending` 설정, `resume()` 까지 대기(`params.get('shots') === '0'` 이면 대기 없음); 양보는 `MessageChannel`. 판정: `blankRatio` 는 `view` 캔버스를 `getImageData` 로 32×24 표본(매 프레임), `overflowing` 은 `#win .w95-dialog, .w95-popup, .w95-window` 의 `getBoundingClientRect` 대 `#screen`; 걸리면 `flag-<종류>` 포착(장당 종류별 3장). `StuckWatch` 가 true → `done = true, stopped = 'stuck'`. `window.onerror`/`unhandledrejection`/`console.error` 는 콘솔 목록 + `flag-error`.
- 장 = `walker.summary().battles.length`. `ui-*` 순간: 전투마다 `battle-start` 포착 뒤 한 번, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' }))` → 탭 4개(`.w95-tab` 순서대로 클릭, 각각 포착 `ui-unitlist-N`) → Esc; F3 → `ui-fullmap` → F3; 행동할 파티원의 셀 중심에 `contextmenu` 이벤트(`stage.cellOf` + 카메라 + 프레임 배율) → `ui-popup` → Esc. 이 동안 Walker 는 쉬게 한다(`presenterBusy` 와 별개로 `uiBusy` 플래그).
- 시작점: `params.get('from')` 이면 `fetch` → `core.loadGame(bytes)` + `WalkerOptions.from`; 아니면 `core.newGame()`. `stop` 파라미터 → `stopBattles`.

- [x] **Step 1: `main.ts` 리팩터(tick/frame 분리, walk 분기)** — Run: `cd web && rtk proxy npx tsc --noEmit -p . && rtk proxy npx vitest run 2>&1 | grep -E "Tests |FAIL"`. Expected: tsc 조용, 전체 통과(플레이 경로 불변).
- [x] **Step 2: `walk.ts` 구현** — 위 인터페이스대로. 재사용: `Walker`(Task 1), `walkChecks`(Task 4), `stage.loading`·`dialogs.opened/top`·`data-id`(Task 3).
- [x] **Step 3: 짧은 브라우저 실행(ego)** — 개발 서버 `cd web && npx vite --port 5199 --strictPort`(백그라운드), 개발용 세이브 복사 `cp <scratchpad>/saves48/battle-04-stage03.bin web/public/assets/save/zz-walk-04.bin`, ego 라운드 파일 `<scratchpad>/walk-browser/<run>/round-01.mjs`:
  ```js
  const task = await taskSpace("ft2 browser walk");
  const page = task.page("p1");
  const fs = await import("node:fs/promises"); const DIR = "<scratchpad>/walk-browser/<run>";
  await page.goto("http://localhost:5199/play.html?walk=1&seed=7&from=assets/save/zz-walk-04.bin&stop=1");
  for (let i = 0; i < 300; i++) {
    await page.waitForFunction(() => window.__walk && (window.__walk.pending || window.__walk.done), undefined, { timeout: 300000 });
    const p = await page.evaluate(() => window.__walk.pending ? { ...window.__walk.pending, rect: window.__walk.frameRect() } : null);
    if (!p) break;
    const shot = await page.cdp("Page.captureScreenshot", { format: "png", clip: { ...p.rect, scale: 1 } });
    await fs.writeFile(`${DIR}/shots/${p.file}`, Buffer.from(shot.data, "base64"));
    await page.evaluate(() => window.__walk.resume());
  }
  const m = await page.evaluate(() => window.__walk.manifest());
  await fs.writeFile(`${DIR}/manifest.json`, JSON.stringify(m, null, 1));
  console.log({ shots: m.shots.length, done: m.run.done, stopped: m.run.stopped, counts: m.counts });
  ```
  Run: `ego-browser nodejs <round-01.mjs 내용>`. Expected: 전투 1판이 끝나고 `done: true`, `shots` 가 20장 이상, `counts.error` 없음; PNG 몇 장을 눈으로 확인(대화상자·메뉴 바가 보임, 162 의 막대가 Walker 의 선택대로).
- [x] **Step 4: 전체 검사** — `cd web && npm run check`. Expected: 통과.
- [x] **Step 5: 커밋** `feat(web): play.html?walk=1 — the walker drives the real page on a virtual clock, captures moments and flags frames for an ego-browser harvester`

### Task 6: 보고서 `tools/walk_report.py`

**Files:** Create `tools/walk_report.py`, `tools/test_walk_report.py`

**Interfaces:**
- `python3 -I tools/walk_report.py <run-dir>` → `<run-dir>/thumbs/*.jpg`(`sips -Z 160`, 없으면 건너뜀), `<run-dir>/report.html`(로컬: 요약 → 걸린 프레임(원본 `<img>`) → 장별 섬네일 격자, 섬네일 `<a href="shots/…">`), `<run-dir>/summary.html`(아티팩트용: 요약 + 걸린 프레임 원본 base64 + 섬네일 base64; 16 MB 넘으면 섬네일을 장당 앞 12장으로 줄인다).
- 함수: `load_manifest(path) -> dict`, `chapters(shots) -> dict[int, list]`, `render_report(manifest, thumbs: dict[str, str] | None, inline: bool) -> str`, `main(argv) -> int`.
- [x] **Step 1: 실패하는 테스트** — `test_walk_report.py`: 작은 매니페스트(장 0·1, 걸린 프레임 1)와 zlib 로 만든 2×2 PNG 로 `render_report` 가 걸린 프레임 섹션을 먼저, 장 제목 `전투 1` 을 포함하는지; `chapters` 가 battle 로 묶는지; `main` 이 `report.html`·`summary.html` 을 쓰는지.
- [x] **Step 2: 실패 확인** — Run: `python3 -I -m unittest tools.test_walk_report`. Expected: FAIL(모듈 없음).
- [x] **Step 3: 구현** — 표준 라이브러리만; HTML 은 다크/라이트 토큰, 섬네일 격자 CSS grid.
- [x] **Step 4: 통과 확인** — Expected: OK. 그리고 Task 5 의 짧은 실행 디렉터리로 `python3 -I tools/walk_report.py <run-dir>` → `report.html` 을 브라우저로 열어 본다.
- [x] **Step 5: 커밋** `feat(tools): walk_report.py — thumbnails and the chapter report of a browser walk`

### Task 7: 전체 실행과 결함 처리

**Files:** 코드 변경은 발견한 결함에 따라(각각 TDD로 별도 커밋). 결과물은 스크래치패드.

- [x] **Step 1: 새 게임부터 실행** — `?walk=1&seed=7`, 라운드 파일 `round-01.mjs`…(라운드마다 새 파일, 같은 작업 공간 이름). 라운드 끝마다 `manifest.json` 갱신. Expected: `done: true, stopped: null`, 전투 33, `counts.error`·`stuck`·`warn` 없음.
- [x] **Step 2: 보고서 생성** — `python3 -I tools/walk_report.py <run-dir>`; `summary.html` 을 아티팩트로 발행하고 완성 보고 아티팩트에 §13 으로 연결.
- [x] **Step 3: 걸린 프레임 분류** — `blank`·`overflow` 는 보고서에서 사람이 판단할 수 있게 그대로; 진짜 결함은 systematic-debugging 으로 원인을 찾고 TDD 로 고친 뒤 그 구간만 `&from=<그 전투의 자동 세이브>&stop=1` 로 다시 돌린다. 결함과 수정은 커밋 메시지와 보고서 §13 에 적는다.
- [x] **Step 4: 문서** — `docs/manual.md` §7.10 "끝까지 가는지 확인하는 법" 에 브라우저 워크(명령, 파라미터, 보고서 읽는 법) 추가; `README.md` 검사 행; 메모리 파일. 커밋 `docs: the browser walk`.

### Task 8: 최종 리뷰

- [ ] 리뷰 패키지 → Fable 리뷰어(파일 수정 금지) → Critical/Important 수정(RED→GREEN) → `npm run check` + Python → 커밋.
