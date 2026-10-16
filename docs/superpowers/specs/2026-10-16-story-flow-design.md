# 하위 프로젝트 4 — 스토리 진행 설계 (스크립트 VM · 대화 · 마을 · 전투 연결)

날짜: 2026-10-16 · 상태: 승인(목표 지시 "완전한 게임 완성까지 계획대로 쭉 진행해") · 선행: 하위 프로젝트 2·3 (main `1bc14c0`)

## 1. 목표와 완료 기준

새 페이지 `web/play.html` 에서 **새 게임**을 누르면 원작 이벤트 스크립트가 게임을 처음부터 끝까지 이끈다.

1. 오프닝(로고 이미지, 대사, 캐릭터 연출) → 마을 → 시설(길드·여관·상점…) → 의뢰 → 전투(하위 프로젝트 2·3의 전투) → 전투 중·후 스크립트 훅(`battle/BEAT/AFTER/ASSIST/WIN/levelup/COMPLETE/GAMEOVER`) → 다음 스테이지 → … → `GAME_COMPLETE_QUIT`.
2. 스크립트 명령 0x00~0x3F 와 확장 1~57 이 모두 실행된다. 비주얼 씬(`PLAY_VISUAL`), 세이브(`SAVE_GAME`), 음악·효과음은 **스텁**이다: 로그를 남기고 즉시 끝난다(하위 프로젝트 5).
3. 헤드리스 테스트: 20개 이벤트 파일이 모두 디코드되고, 참조 라벨이 모두 존재하며, 가짜 호스트로 `EVENT00 begin` 부터 첫 `TOWN` 까지, 그리고 전투 1판의 훅 흐름이 재현된다.

완료 기준: `npm run check` 통과, 브라우저에서 새 게임 → 첫 마을 → 길드 → 첫 전투 시작 → 승리 → 결과 → 마을 복귀가 동작, 설명서 갱신.

## 2. 원작 근거

`analysis/event_script_format.md`(명령·확장·라벨·상태 변수), `analysis/story_flow.md`(모드, 새 게임, 마을 화면, 필드 컨트롤러, 행동 결과 훅, 리소스), `analysis/battle_rules.md`, `analysis/field_mode.md`.

## 3. 접근 방식

| 안 | 내용 | 평가 |
|---|---|---|
| **A. 호스트 인터페이스를 둔 순수 VM + 게임 컨트롤러** (채택) | VM 은 디코드된 명령열을 한 프레임씩 실행하고, 화면·소리·전투 같은 부작용은 `Host` 인터페이스로 넘긴다. `Game` 이 모드(스크립트/전투/마을/모달)를 전환한다. | 헤드리스 테스트가 쉽다. 원작의 "매 프레임 재시도" 의미를 그대로 둘 수 있다. |
| B. 스크립트를 TypeScript 코드로 변환 | 빌드 때 라벨을 함수로 컴파일 | 대기·재진입 의미를 다시 발명해야 한다. 데이터 교체가 어렵다. |
| C. 원작처럼 전역 상태 | 전역 변수와 모드 플래그 | 테스트 불가. |

## 4. 데이터

- 내보내기(`tools/ft2_export.py`): `data/event%02d.json` = `{ symbols: {name: offset}, code: [{ at, op, args }] }` (확장 명령은 `op` 가 하위 이름) (`ft2_event_disasm.py` 의 디코더를 재사용; 문자열은 UTF-8 로 변환, `_` 는 그대로 둔다); `bmp/<name>.png` 전부 + `index.json` 에 `bmp: string[]`, `events: number[]`.
- 디코드 규칙은 `event_script_format.md` §2 그대로(유닛 id 0 뒤 피연산자 생략 포함). 디코드 결과가 디스어셈블러와 같은지 Python 테스트로 고정한다.
- 내보낸 결과(2026-10-16 실측): event 20개(JSON), bmp 397개(PNG). 코퍼스 테스트가 모든 점프·CALL·LOAD_SCRIPT 라벨의 존재를 확인했고, `EVENT00 begin` 은 가짜 호스트로 `TOWN` 까지 경고 없이(MOVE_TO 1회 제외) 실행된다.

## 5. 모듈

```
web/src/script/program.ts   Program(JSON) 타입, 라벨 검색(대소문자 무시), 명령 열거
web/src/script/vm.ts        ScriptVm: run(stage, label) · step(now): 'running' | 'waiting' | 'ended' · 상태(Flag[100], result, less, callReturn, pc, lastSprite, speakerName)
web/src/script/host.ts      Host 인터페이스(아래 §7) + 테스트용 FakeHost
web/src/game/campaign.ts    Campaign: units(50), inventory, flags, townFlags, stage, turn, episode, message, townSet, townExtra, battleTarget(유닛 24)
web/src/game/game.ts        Game: 모드 기계, Host 구현(캔버스/패널에 연결), 전투 훅
web/src/town/town.ts        핫스팟 표(story_flow.md §3.2), 레이어 그리기, 마우스 처리
web/src/ui/dialogue.ts      대화창(상단/하단), 중앙 메시지, 예/아니오, 전투 결과, 상점 목록
web/play.html, web/src/play/main.ts   타이틀(새 게임 · 전투 테스트 링크) 와 조립
```

`Battle` 은 공유 `Campaign.units`·`inventory` 위에서 동작한다(`new Battle(state)`; `Battle.start` 는 전투 테스트 페이지용으로 남는다). 스크립트가 만든 오브젝트 유닛(`LOAD_SPRITE`, side 1)은 `Unit.spriteApd`(선택) 로 본체 APD 를 바꾼다. `ANIM` 은 유닛에 `scriptAnim { name, loop }` 을 둔다 — 표현층은 이것이 있으면 상태 토큰 대신 그 애니를 재생한다.

## 6. VM 의미론

- 프레임 함수가 `step(now)` 를 부른다. 명령은 'done'(다음 명령) 또는 'wait'(다음 프레임에 **같은 명령**을 다시 실행) 를 돌려준다. 대기 명령: `WAIT`(절대 시각), `FADE_IN`(원작이 페이드 끝까지 양보), `WAIT_FADE`, `WAIT_UNIT`/`WAIT_UNIT2`, `WAIT_CLICK`, `WAIT_SCROLL`, `WAIT_MUSIC_FADE`, `EXT WAIT_TIMER`, `MESSAGE`, `EXT ASK`, `SHOP`, `EXT BATTLE_RESULT`(호스트의 모달이 닫힐 때까지). `EPISODE n≠0` 은 제목을 표시만 하고 기다리지 않는다.
- `END`: 이전 모드 복원(스크립트 시작 때 저장). `END_RESUME`: 보류한 전투 행동 재개. `FIELD_MODE`: 복원 모드를 전투로 강제. `LOAD_SCRIPT n L`: 프로그램 교체 후 라벨 실행. `JUMP`/`CALL`(깊이 1)/`RETURN`. 라벨 없음 → 스크립트 종료(원작과 같음) + 경고 로그.
- 유닛 피연산자: id 24 = `campaign.battleTarget`; 그 외 `units.find(id)`; 없으면 뒤 피연산자를 읽지 않는다(디코더가 이미 그렇게 자른다).
- `TEXT`: `_` → 공백, `[Snn]` 크기, `[Cnn]` 색, `*` 는 제거(의미 미확인 [추정]). 첫 줄이면 화자 이름(spk 14 → `SET_SPEAKER_NAME`, spk < 30 → 이름표, 그 외 유닛 종족명).
- `LOAD_UNITS n`: 슬롯 10~49 비우고 로스터 n 생성(`createUnit`), `(0,0)` 은 자리표시자(하위 프로젝트 2 규칙 유지). `BATTLE_START(_HEAL)`: 상태 초기화(+회복), 턴 0, 전투 모드 진입. `NEXT_STAGE`: Flag 100개 0, 비파티 삭제, stage+1 의 `begin`.
- `FLAG_*`, `JUMP_IF_RESULT/LESS`, `FLAG_BIT_*`, `STAGE_FROM_FLAG`, `FLAG_FROM_TOWN`, `TOWN_FLAG_SET`, `TOWN_SET`, `TOWN_EXTRA`: 순수 상태 조작.
- 유닛 조작(`SET_POS/SET_DIR/FACE_UNIT/REMOVE_UNIT/RESPRITE_UNIT/LOAD_SPRITE/SPRITE_REUSE/ATTACH_SPRITE/REMOVE_SCRIPT_UNITS/REMOVE_DEAD/SET_VISIBLE/ALL_VISIBLE/SHOW_ONLY/ALL_FACE/KILL/REVIVE/HEAL_ALL/SET_STATUS8/UNIT_TO_ID8/DOPPEL_COPY/TARGET_CLASS40/SET_ACT_FLAGS/GIVE_ITEM_TO/ADD_GOLD/GIVE_ITEM/TAKE_ITEM`): `Campaign` 직접 조작 — `event_script_format.md` 의 표 그대로.
- `MOVE_PATH u anim path`: 경로 문자 `e n s w` → 방향 1 3 0 2; 호스트에 `moveUnit(u, dirs, animBase)` — 표현층의 이동 큐(RUN1/RUN2 교대 규칙과 같음, 기본 이름은 스크립트 값); 유닛 좌표는 즉시 갱신하고 마지막 방향으로 바라본다. `WAIT_UNIT` 은 큐가 빌 때까지 대기.
- `EXT MOVE_TO`(1회, 문자열 의미 미확인) 와 `EXT 99`: 경고 로그 후 무시 [결정].

## 7. Host 인터페이스

```ts
interface Host {
  // 화면
  fadeOut(step: number): void; fadeIn(step: number): void; fadeBusy(): boolean;
  showImage(name: string, step: number): void; hideImage(): void;
  tint(kind: 'dim' | 'sunset' | 'night' | 'dusk' | 'white' | 'uiDark' | 'uiHalf' | 'textpal' | 'facepal' | 'black' | 'reset', n: number): void;
  shake(n: number): void;
  camera(kind: 'tile' | 'unit' | 'scroll', ...): void; scrollBusy(): boolean;
  // 대화·모달
  openWindow(where: 'top' | 'bottom', speaker: number, face: string | null): void; closeWindow(where): void;
  text(line: string, speakerName: string | null): void;
  waitClick(ms: number): boolean;               // true = 해제됨
  message(text: string): boolean; ask(text: string): boolean | null; shop(ids: number[]): boolean; battleResult(gold: number, p: number): boolean;
  // 유닛·스프라이트
  anim(u: Unit, name: string, once: boolean): void; unitBusy(u: Unit, withEffects: boolean): boolean;
  moveUnit(u: Unit, dirs: Dir[], animBase: string): void; marker(u, on): void; sweat(u): void; appear(u, ms): void; vanish(u, ms): void; offset(u, dx, dy): void; raise(u): void; layer(u, n): void;
  resetSprites(): void; loadMap(n: number): Promise<void> | void; mapBusy(): boolean;
  // 소리·기타 (스텁 허용)
  music(n: number): void; musicFade(ms: number, on: boolean): void; musicFadeBusy(): boolean; sound(name: string): void;
  playVisual(n: number): boolean; save(slot: number): void; quitComplete(): void;
  // 전투·마을
  enterBattle(heal: boolean): void; resumeBattle(): void; enterTown(): void; fieldMode(): void;
  log(kind: 'warn' | 'info', text: string): void;
}
```

`FakeHost` 는 호출을 기록하고 대기 함수는 설정값을 돌려준다(테스트용).

## 8. 게임 컨트롤러와 전투 연결

- 모드: `title | script | town | battle | modal`. 매 프레임: `script` 면 `vm.step`; `battle` 면 기존 `game/main.ts` 의 루프(선택·적 페이즈·표현 큐)를 `Game` 안으로 옮긴다; `town` 은 마우스 처리와 레이어 애니.
- 전투 훅(`story_flow.md` §5): `Battle.reduce` 결과 이벤트를 `Game` 이 받아
  1. `action` 전(플레이어 `act`/AI 행동 직전): 라벨 `battle%02d` 가 stage 파일에 있으면 스크립트를 먼저 돌리고 `END_RESUME` 에서 행동을 수행한다 [결정: 연출 대체가 아니라 "스크립트 뒤 즉시 수행"으로 단순화].
  2. `action` 후 대상마다 `BEAT/AFTER/ASSIST` → `WIN`, 표현 큐가 빈 뒤 순서대로 실행(각 라벨은 `battleTarget` 을 그 대상으로).
  3. `levelUp` → `levelup%02d`(행동 유닛 id, EVENT00).
  4. `end: defeat` → `GAMEOVER`(EVENT00); `end: victory` → `COMPLETE`(stage). 라벨이 없으면 결과 패널을 띄우고 마을로 돌아가지 않는다(원작도 멈춘다).
  5. 스크립트가 `FIELD_MODE` 없이 `END` 하면 전투로 복귀, `TOWN` 이면 마을로.
- `BATTLE_START` 는 `Battle` 을 공유 유닛 위에 만든다. 플레이어 턴 입력은 하위 프로젝트 2 의 패널을 그대로 쓴다(`game.html` 과 `play.html` 이 같은 `Panel`).

## 9. 마을 화면

- `TOWN` 명령 → `town` 모드. 배경 레이어는 `story_flow.md` §3.1 그대로(프레임 카운터는 200 ms 마다 +1 [추정]). 하이라이트는 레이어 3 비트맵에서 핫스팟의 하이라이트 rect 를 복사한다.
- 핫스팟 15개(§3.2), `townFlags[i]` 가 0 이면 비활성. 클릭 → stage 파일의 라벨, 없으면 EVENT00. 오른쪽 클릭 → 파티원 목록 모달(이름·레벨·HP·장비·가방; 장비 교체는 `equipment.ts` 로 이 모달에서 수행 [결정: 원작 파티 메뉴 미분석이므로 최소 UI]).
- 마을 모드의 표시는 640×480 캔버스에 그린다(전투와 같은 캔버스).

## 10. 대화·모달 UI (HTML 오버레이)

- 대화창: 상단/하단 두 개, 화자 이름, 초상(`bmp/face%02d%c.png`, spk < 30), 본문 줄들(크기·색 태그 반영). `WAIT_CLICK` 은 캔버스/오버레이 클릭 또는 Enter 로 해제, n > 0 이면 시간 초과도 해제.
- `MESSAGE`: 중앙 박스, 클릭으로 닫힘. `ASK`: 예/아니오 버튼. `BATTLE_RESULT`: 획득 골드·레벨업 목록 표시 후 닫기. `SHOP`: 아이템 목록(이름·가격·보유 수) + 구매 버튼(`shop.buy`, 장비는 선택한 파티원의 가방으로) + 닫기. `SAVE_GAME`: "세이브는 다음 단계" 메시지.
- 페이드: 검정 오버레이 알파 0→1, 1 스텝 = 30 ms [추정]; `FLASH_WHITE` 는 흰색. 틴트: 반투명 색 오버레이. `SHOW_IMAGE`: 캔버스 위에 PNG 를 그린다(페이드 인 step).

## 11. 페이지

`web/play.html`: 캔버스 + 패널(전투 패널 재사용) + 대화 오버레이 + 타이틀 레이어(`bmp/title.png` 위에 "새 게임", "전투 테스트(game.html)"). 새 게임 → `Campaign.newGame()`(골드 200) → `EVENT00 begin`. 디버그 훅 `window.__ft2` 에 `vm`, `campaign`, `game` 추가.

## 12. 오류 처리

- 디코드 오류·없는 라벨·없는 리소스는 예외 대신 경고 로그와 "스크립트 종료"(원작과 같음). 없는 비트맵은 검정 화면, 없는 APD 는 스프라이트 없음.
- VM 의 무한 루프 방지: 한 프레임에 1,000 명령을 넘기면 다음 프레임으로 넘긴다.

## 13. 테스트

- Python: `test_ft2_export.py` 에 이벤트 JSON 디코드가 디스어셈블러 명령 수와 같음.
- `program.test.ts`: 라벨 검색(대소문자), 명령 열거.
- `vm.test.ts`: 명령 그룹별(흐름·플래그·대기·유닛·소지품·호스트 호출) 가짜 호스트 테스트; 라벨 없음 → ended; CALL 깊이 1.
- `eventCorpus.test.ts`: 20개 파일 전부 로드, `JUMP/CALL/JUMP_IF_*/LOAD_SCRIPT` 의 라벨 존재(대상 파일 포함), `EVENT00 begin` 을 가짜 호스트로 `TOWN` 까지 실행.
- `campaign.test.ts`: 새 게임 초기값(골드 200, 턴 −1), `LOAD_UNITS`/`BATTLE_START` 후 `Battle` 이 같은 유닛 배열을 쓴다.
- `game.test.ts`(헤드리스): 전투 훅 순서(`BEAT` → `WIN` → `levelup` → `COMPLETE`), `END` 후 모드 복원, `TOWN` 전환.
- `town.test.ts`: 핫스팟 적중·비활성·라벨 선택(stage 파일 없으면 EVENT00).
- `dialogue.test.ts`: 텍스트 태그 파싱, 화자 이름 규칙(가짜 DOM).

## 14. 범위 밖 (하위 프로젝트 5)

비주얼 씬 재생, 세이브/불러오기, MIDI/WAV, 원작 비트맵 UI 프레임·글꼴, 타이틀 다이얼로그 복원, 파티 메뉴 원작 재현, 상점 판매.

## 15. 결정 사항

1. 이벤트 스크립트는 빌드 때 JSON 으로 디코드한다(브라우저에서 CP949 를 다루지 않는다).
2. `battle%02d` 는 "스크립트 뒤 즉시 수행" 으로 단순화한다.
3. `*` 텍스트 표식은 제거한다 [추정].
4. 페이드 1 스텝 = 30 ms, 마을 애니 200 ms [추정].
5. 비주얼 씬·세이브·소리는 스텁(로그) — 5 에서 구현.
6. 파티 메뉴는 최소 모달(장비 교체 포함) — 원작 미분석.
