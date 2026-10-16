# 전투 기반 설계 — 파랜드 택틱스 2 웹 리메이크, 하위 프로젝트 2 "전투 1판"

작성일 2026-10-15. 하위 프로젝트 1(렌더링 기반, `2026-10-14-rendering-foundation-design.md`) 위에 유닛·턴·이동·공격·마법·적 AI·승패를 올린다. 근거 문서: `analysis/battle_rules.md`(판정 공식), `analysis/field_mode.md`(로스터·스프라이트·이동 범위·AI), `analysis/file_formats.md` §8(이동 비용). 이 문서는 **[관찰]** 사실만 규칙으로 쓰고, 추정과 리메이크 편의 규칙은 그렇게 표시한다.

설계 대화(2026-10-15) 이후 추가한 것: §10.3 **방향 선택 단계**. 원작 `system.apd`에 `TURN_*` 화살표가 있고 방향이 배후·측면 판정에 쓰이므로 유닛 종료 시 방향을 고르게 한다.

## 1. 목표

브라우저에서 전투를 고르고, 원작 규칙 그대로 한 판을 끝까지 플레이할 수 있다. 첫 전투 "첫업무"(맵 49, 로스터 49: 마법사 Lv2 + 검사 Lv2 대 블루슬라임 6)는 원작과 같은 파티·장비·적으로 시작한다. 33개 전투 전부를 고를 수 있다.

성공 기준:

1. 전투 선택 → 아군 유닛 클릭 → 이동 범위 표시 → 이동 → 공격·마법 → 판정 팝업 → 방향 선택 → 턴 종료 → 적이 원작 AI로 움직이고 공격 → 적 전멸이면 승리, 아군 전멸이면 게임오버.
2. 같은 시드와 같은 명령열이면 전투 전체가 똑같이 재현된다(헤드리스 테스트로 증명).
3. 33개 로스터가 모두 로드·검증을 통과한다.

## 2. 범위

포함:

- Python 변환기 확장: `race/item/magic` 테이블, 로스터 59개, 전투 카탈로그 → JSON.
- `web/src/battle/`: 난수, 유닛, 격자 조회, 이동 범위·경로, 대상, 판정, 결과, AI, 상태 기계.
- `web/src/field/`: 유닛 스프라이트 묶음, 연출 큐, 하이라이트·커서, 카메라.
- `web/src/ui/`: HTML 패널(전투 선택, 메뉴, 상태창, 로그, 결과창).
- 렌더러 변경: 스프라이트 레이어 키(§9.4).
- 페이지 `web/game.html` + `web/src/game/main.ts`.

제외(후속):

- 이야기·대사·마을·상점(하위 프로젝트 4), 아이템 사용·소지품, 세이브, 소리, 원작 UI 비트맵, 레벨업 연출(레벨업 자체는 규칙대로 적용하고 로그에 적는다), 보물 상자 획득(표시만), 팔레트 효과, `battle%02d` 등 스크립트 라벨 호출.

## 3. 확정된 결정

| # | 결정 | 이유 |
|---|---|---|
| D1 | 규칙 코어는 순수 TypeScript. DOM·캔버스 의존 없음. 입력 `(state, command)` → `{state, events}` | 헤드리스 테스트, 스크립트 VM 재사용 |
| D2 | 원작 특이점 보존(회피 roll 인수 역전, 홀드 축 불일치, 무기 상태이상 카운터 미갱신, 적 회복 EXP 1, 사거리 표의 높이 검사 조기 return) | 하위 프로젝트 1의 "원작 충실" 결정 |
| D3 | 난수 = 원작 Wichmann–Hill 3-LCG 재현, 시드 지정 가능 | 재현성 |
| D4 | 적 AI = `FUN_00411b10` 점수표 그대로 | 충실도. 대체 AI 없음 |
| D5 | 아이템 사용 제외 | 소지품 데이터가 스크립트에서만 온다 |
| D6 | 메뉴·상태창은 HTML. 하이라이트·커서·팝업 숫자는 원작 `system.apd`/`number.apd` 스프라이트 | 게임 화면은 원작 자산, UI 비트맵은 하위 프로젝트 5 |
| D7 | 연출 타이밍은 규칙 문서에 없으므로 "비슷하게"(§9.6의 고정값). 애니는 원작 APD | 원작 작업 시스템 미분석 |
| D8 | 파티는 "새 게임 파티(로스터 1) + 고른 로스터 적용 + 로스터 레벨까지 결정적 성장" (리메이크 편의, §11) | 이야기 진행 상태가 없다 |
| D9 | 데이터 JSON 필드 이름 = `tools/ft2_tables.py`의 이름(snake_case). TS 타입도 같은 이름 | 이름 하나로 통일 |

## 4. 전체 구조

### 4.1 디렉터리

```
tools/ft2_export.py             확장: --data 로 테이블·로스터·전투 카탈로그도 쓴다 (§5)
web/
  game.html                      전투 페이지 (index.html = 뷰어 그대로)
  public/assets/data/            생성물. git 제외
    race.json item.json magic.json battles.json roster/stage049.json ...
  src/
    data/types.ts                §5.3 의 TS 타입과 검증
    data/loader.ts               data/*.json fetch (AssetLoader 확장 아님: 별도 클래스 DataLoader)
    battle/rng.ts                Rng (§7.1)
    battle/unit.ts               Unit, createUnit, growUnit (§6.1, §7.2)
    battle/grid.ts               BattleGrid: 셀 조회, 점유, 거리, 방향, hostile (§7.3)
    battle/moveRange.ts          RangeTable (21×21), computeMoveRange, markTargets, pathTo (§7.4)
    battle/targets.ts            targetsOf(action) (§7.5)
    battle/resolve.ts            resolveAction → Hit[] (§7.6)
    battle/outcome.ts            applyOutcome, statusTick, roundStart, checkEnd (§7.7)
    battle/ai.ts                 scoreCells, chooseAction (§8)
    battle/battle.ts             Battle: 상태 기계와 reduce(command) (§6.2, §6.3)
    field/unitSprites.ts         UnitSprites: 본체·그림자·아이콘 이름 규칙 (§9.2, §9.3)
    field/presenter.ts           Presenter: 이벤트 → 연출 큐 → Scene (§9.5, §9.6)
    field/overlay.ts             하이라이트·커서 스프라이트 (§9.1)
    ui/panel.ts                  HTML 패널 (§10)
    game/main.ts                 조립: 로더 → Battle → Presenter → 렌더 루프
  test/                          Vitest (§13)
```

### 4.2 모듈 책임

| 모듈 | 하는 일 | 입력 | 출력 | 의존 |
|---|---|---|---|---|
| `data/loader.ts` | 테이블·로스터·카탈로그를 받아 검증 | 이름 | `Tables`, `Roster`, `BattleEntry[]` | `types.ts` |
| `battle/rng.ts` | 원작 난수열 | 시드 | `rand(n)` | 없음 |
| `battle/unit.ts` | 유닛 생성·성장 | 로스터 레코드, 테이블, Rng | `Unit` | `rng.ts` |
| `battle/grid.ts` | 맵과 유닛 배치 조회 | `MapData`, `Unit[]` | 셀·점유·거리·방향 | 없음 |
| `battle/moveRange.ts` | 이동 범위·대상 표시·경로 | `BattleGrid`, `Unit`, action | `RangeTable`, `Dir[]` | `grid.ts` |
| `battle/targets.ts` | 행동의 대상 목록 | `BattleGrid`, 행동자, action, 셀 | `Unit[]` | `grid.ts` |
| `battle/resolve.ts` | 판정 | 행동자, 대상, action, Rng | `Hit[]` | `rng.ts`, 테이블 |
| `battle/outcome.ts` | 결과 적용·턴 처리·승패 | `BattleState`, `Hit[]` | 상태 변경 + 이벤트 | `rng.ts` |
| `battle/ai.ts` | 적 행동 결정 | `BattleState`, `Unit` | `{dest, path, action, cell}` | 위 전부 |
| `battle/battle.ts` | 명령 처리 | `Command` | `BattleEvent[]` | 위 전부 |
| `field/*` | 상태·이벤트를 장면으로 | `BattleState`, `BattleEvent[]` | `Scene`(렌더러 입력) | 하위 프로젝트 1 |
| `ui/panel.ts` | DOM ↔ 명령 | DOM 이벤트, 상태 | `Command` | 없음 |

### 4.3 데이터 흐름

```
원본 폴더 ──(ft2_export.py)──▶ assets/map, assets/sprite (기존) + assets/data/*.json (신규)
                                        │
 DataLoader ──▶ Tables, Roster(n), battles.json ──▶ createParty + applyRoster ──▶ BattleState
                                        │
 ui/panel ──Command──▶ Battle.reduce ──▶ {state, events} ──▶ Presenter(큐) ──▶ Scene ──▶ Renderer.draw
                                        ▲                                      │
                                        └──── 연출 끝 → 다음 Command 허용 ◀─────┘
 적 페이즈: Battle 이 ai.chooseAction 으로 Command 를 스스로 만든다
```

## 5. 데이터 변환 (`tools/ft2_export.py` 확장)

### 5.1 입력과 출력

```
python3 -I tools/ft2_export.py GAME_DIR OUT_DIR
```

기존 맵·스프라이트 출력에 더해 `OUT_DIR/data/`를 쓴다. 입력 폴더 `DATA/`를 읽는다. `ft2_tables.py`의 `race/item/magic/stage` 파서와 `ft2_event_disasm.py`의 디코더를 import 한다.

### 5.2 전투 카탈로그 추출 규칙

이벤트 파일 `EVENT00..17`을 디스어셈블한 명령열을 파일 순서대로 훑는다. `BATTLE_START` 또는 `BATTLE_START_HEAL`을 만나면 **직전 전투 이후 마지막으로 본** `LOAD_MAP n`, `LOAD_UNITS m`, `EPISODE s`, `MESSAGE s`로 항목을 만들고 문맥을 비운다. 문맥은 라벨 경계를 넘어 유지한다(EVENT01은 에피소드를, EVENT03은 맵·로스터를 `battle_start`로 점프하는 앞 라벨에서 설정한다). `LOAD_MAP`이나 `LOAD_UNITS`가 없으면 경고로 보고하고 항목을 쓰지 않는다. 기대 결과 33개(`analysis/field_mode.md` §1.1). `_`는 공백으로 바꾼다. 로스터 파일이 없으면 오류.

### 5.3 JSON 스키마

```ts
// assets/data/race.json : RaceData[]  (74개)   — 필드 이름은 ft2_tables.RACE_FIELDS 그대로
interface RaceData { name: string; exp_value: number; hp: number; hp_up: number; mp: number; mp_up: number;
  str: number; str_up: number; def: number; def_up: number; wis: number; wis_up: number; mgr: number; mgr_up: number;
  agi: number; agi_up: number; elem0: number; elem1: number; elem2: number; size: number; climb_max: number; drop_max: number;
  cost_land0: number; cost_land1: number; cost_land2: number; cost_land3: number; cost_land4: number; cost_land5: number;
  cost_land6: number; cost_land7: number; spell0: number; spell1: number; spell2: number; spell3: number }
// assets/data/item.json : ItemData[] (180개)
interface ItemData { name: string; price: number; hp_heal: number; mp_heal: number; atk: number; def: number; wis: number;
  mgr: number; agi: number; elem0: number; elem1: number; elem2: number; range_min: number; range_max: number; slot: number;
  use_effect: number; weapon_type: number; status_code: number; race_mask: number }
// assets/data/magic.json : MagicData[] (84개)
interface MagicData { name: string; learn_level: number; mp_cost: number; elem0: number; elem1: number; elem2: number;
  range_min: number; range_max: number; effect: string; effect_no: number; target: number; shape: number; learn_mask: number; short: string }
// assets/data/roster/stage049.json : RosterUnit[]
interface RosterUnit { unit_id: number; race: number; level: number; dir: number; c: number; r: number; status: number;
  side: number; weapon: number; armor: number; drop_item: number; drop_gold: number }   // c_hi, r_hi 는 쓰지 않는다
// assets/data/battles.json : BattleEntry[]  (33개, 이벤트·라벨 순)
interface BattleEntry { event: number; label: string; map: string; roster: number; episode: string; objective: string; heal: boolean }
// map: "stage49" (소문자 stem). roster: 49. heal: BATTLE_START_HEAL 이면 true
```

`index.json`에 `data: true`를 더한다(format은 1 그대로. 로더는 `data`가 없으면 "자산을 다시 변환하라"는 `AssetError`).

### 5.4 검증과 보고

- 테이블 레코드 수 74/180/84, 로스터 59개, 전투 33개를 출력한다.
- 로스터 검증: 종족 < 74, 무기·방어구·드롭 아이템 < 180, 레벨 1..99, 진영 0..7. 위반은 오류.
- 전투 검증: 맵 `stageNN.map`과 로스터 파일 존재. 없으면 오류.

## 6. 전투 코어 모델

### 6.1 유닛

원작 124 B 구조체(`battle_rules.md` §7) 중 전투에 쓰는 필드만 둔다. 스프라이트 핸들은 `field/`가 따로 가진다.

```ts
type Dir = 0 | 1 | 2 | 3;                      // 0 남(+y) 1 동(+x) 2 서(−x) 3 북(−y)  (file_formats §8)
interface Unit {
  slot: number;                                 // 0..49. 0..9 파티
  id: number; race: number; level: number; dir: Dir; c: number; r: number;
  status: number;                               // battle_rules §6.1
  side: number;                                 // 0 아군, 1 중립, 7 오브젝트, 그 외 적
  weapon: number; armor: number; acc: [number, number];
  dropItem: number; dropGold: number;
  hpMax: number; hp: number; mpMax: number; mp: number; exp: number;
  str: number; def: number; wis: number; mgr: number; agi: number;
  spells: number[];                             // 최대 10
  buff: { str: number; def: number; wis: number; mgr: number; agi: number };   // [0x26..0x2a]
  elem: [number, number, number];               // [0x2b..0x2d], 보통 0
  moved: boolean; acted: boolean;               // [0x2e], [0x30]
  special: boolean;                             // [0x32] 특수기 ×3
  statusCounter: number;                        // [0x34]
}
```

### 6.2 상태와 명령

```ts
interface BattleState {
  battle: BattleEntry; map: MapData; units: (Unit | null)[];   // 길이 50
  turn: number;                                                // 1부터
  phase: { kind: 'player'; sel: Selection } | { kind: 'enemy'; queue: number[] } | { kind: 'end'; result: 'victory' | 'defeat' };
  rng: RngState;
}
type Selection =
  | { mode: 'idle' }
  | { mode: 'menu'; slot: number; range: RangeTable }          // 유닛 선택됨, 이동 가능 셀 표시
  | { mode: 'move'; slot: number; range: RangeTable }
  | { mode: 'target'; slot: number; action: number; range: RangeTable }   // action 0 공격, m 마법
  | { mode: 'face'; slot: number };                           // 방향 선택
type Command =
  | { type: 'select'; slot: number } | { type: 'cancel' }
  | { type: 'beginMove' } | { type: 'move'; c: number; r: number }
  | { type: 'beginTarget'; action: number } | { type: 'act'; c: number; r: number }
  | { type: 'wait' } | { type: 'face'; dir: Dir }
  | { type: 'endTurn' } | { type: 'enemyStep' };             // enemyStep: 적 유닛 하나 처리 (Presenter 가 연출 뒤 호출)
```

`Battle.reduce(command): BattleEvent[]`는 상태를 바꾸고 이벤트를 돌려준다. 허용되지 않는 명령(예: 이미 이동한 유닛의 `beginMove`)은 `{ type: 'rejected', reason }` 하나만 돌려주고 상태를 바꾸지 않는다.

### 6.3 이벤트

```ts
type BattleEvent =
  | { type: 'selected'; slot: number } | { type: 'deselected' }
  | { type: 'moved'; slot: number; path: Dir[]; to: [number, number] }
  | { type: 'faced'; slot: number; dir: Dir }
  | { type: 'action'; slot: number; action: number; cell: [number, number]; hits: Hit[] }   // action 0 물리, m 마법
  | { type: 'died'; slot: number } | { type: 'removed'; slot: number }                     // removed: 적 사망 처리로 슬롯 비움
  | { type: 'exp'; slot: number; gain: number } | { type: 'levelUp'; slot: number; level: number; learned: number[] }
  | { type: 'statusTick'; slot: number; status: number; value: number; cured: boolean }
  | { type: 'roundStart'; turn: number } | { type: 'phase'; kind: 'player' | 'enemy' }
  | { type: 'end'; result: 'victory' | 'defeat' }
  | { type: 'rejected'; reason: string };
interface Hit { target: number; kind: 'damage' | 'heal' | 'miss' | 'status' | 'cure' | 'buff' | 'none';
  value: number; crit: boolean; popup: string; statusAfter: number }   // popup: "miss!", "크리티컬!", "well", "str_up!", 숫자
```

### 6.4 턴 구조 [관찰 `battle_rules.md` §6.3]

```
아군 페이즈: 아군 유닛을 임의 순서로. 유닛마다 이동 1회(moved) + 행동 1회(acted). endTurn 또는 전원 종료 →
  적 유닛 상태 틱(FUN_0043e1a0(0)) [추정] →
  적 페이즈: 슬롯 10..49 오름차순, side ∉ {1, 7}, 아군과 hostile, status ∉ 행동불능 인 유닛마다 AI 1회 →
  아군 상태 틱 → 라운드 시작(전 유닛 moved=acted=false, MP += ceil(MPmax/10) 상한 MPmax, 버프 |값|−1) → turn += 1
승패 검사는 행동 결과를 적용할 때마다: 파티 10슬롯 중 행동 가능 유닛 0 → defeat ;
  슬롯 10..49 중 HP>0, side ∉ {1, 7}, status ≠ 9 인 유닛 0 → victory
```

## 7. 규칙 코어

### 7.1 난수 [관찰 `FUN_004337a0`]

Wichmann–Hill 3-LCG: 상태 (s1, s2, s3). `rand(n)`은 0..n−1. 상수와 초기 시드는 구현 시 `FUN_004337a0`과 시드 설정 함수에서 옮겨 적고, Python으로 같은 알고리즘을 짜서 첫 100개 값을 교차 확인한다(`test/rng.test.ts`에 고정값 저장). 상태는 `BattleState.rng`에 들어 있어 전투가 값 타입처럼 재현된다.

### 7.2 유닛 생성·성장 [관찰 `field_mode.md` §1.2, `battle_rules.md` §5.3]

`createUnit(rec, tables, rng)`: 종족 기본치 → `(level−1)`회 `grow(unit, randomize = side !== 0, rng)` → 상태·EXP·주문. `grow`는 `FUN_0041f7c0`: 스탯마다 `g = 성장치 (+ rand(3)−1 if randomize)`, 상한 999, 사망이 아니면 HP/MP 전회복, 파티면 습득 주문 재구성(`magic.learn_mask & 1<<(id−1)`, `0 < learn_level ≤ level`).

### 7.3 격자 [관찰 `file_formats.md` §8, `battle_rules.md` §1]

- 셀: 높이 `h`, `blocked`, `flag2`, `land` (하위 프로젝트 1의 `MapData.cells`).
- `dist = |Δc| + |Δr|`, `dir(a→b) = |dx|>|dy| ? (dx>0 ? 1 : 2) : (dy>=0 ? 0 : 3)`, 반대 = `dir ^ 3`.
- `hostile(a, b)`: a≠b, 양쪽 side≠7, 양쪽 side≠1, (a.side==0) ≠ (b.side==0), a가 CHARM(7)이면 반전.
- 행동불능 = status ∈ {1, 3, 4, 5, 8, 9}.

### 7.4 이동 범위와 경로 [관찰 `field_mode.md` §3, §4; `file_formats.md` §8]

`RangeTable`: 21×21, 셀마다 `{ move: number; kind: 0 | 1 | 2 }`, 유닛 위치가 중심. `computeMoveRange(grid, unit)`:

```
중심 move = 30
unit.side !== 3 && !moved && !행동불능 이면 4방향 재귀:
  land = (cell.flag2 ≠ 0 || 오브젝트가 아닌 유닛이 서 있음) ? 0 : cell.land        (FUN_0041f410)
  비용 = race.cost_land[land] ; land 0 이고 부유(상태 11 또는 부유 장비)면 cost_land1 ; 상태 10 이면 −1 ; cell.blocked 면 99
         → 지상 종족은 다른 유닛이 선 칸과 flag2 칸을 지나가지 못한다(cost_land0 = 99)
  높이: 오를 때 new−cur ≤ climb_max, 내려갈 때 cur−new ≤ drop_max ; 비행 종족(cost_land0 ≠ 99) 또는 부유면 제한 없음
  남은 = 현재 − 비용 ; ≥1 이면 진입, ≥2 이면 계속 ; 더 큰 값으로만 갱신
  ZOC: 적(행동불능 제외, 높이차 < 8)에 인접한 셀은 남은 = 1
```

`markTargets(table, grid, unit, action)`: §3의 action 0 / 마법 규칙 그대로(아이템 action은 이번 범위 밖). **높이 검사 조기 return 특이점 유지(D2)**. `pathTo(table, grid, unit, dest): Dir[]`는 §4 그대로(최대 30단계, 없으면 빈 배열 → 이동 거부).

이동 가능 셀 = `move ≠ 0` 이고 (유닛 없음 또는 자기 자신). 보물 오브젝트 위로는 이동 가능하나 이번 범위에서는 획득 처리를 하지 않는다.

### 7.5 대상 선정 [관찰 `battle_rules.md` §2.4, §3.2; `FUN_00438d70`]

`targetsOf(grid, actor, action, cell)`:

- action 0: 무기 종류 0 → cell의 유닛 1명(거리 `[min,max]`); 1 → 바라보는 방향 1..max 칸 중 ≥min 인 모든 유닛(관통); 2 → 정면·좌·우 인접 3칸; 3(활) → cell의 유닛 1명, 높이 무시. 근접은 |Δh| > 4 제외. hostile만.
- 마법 m: shape 0 → cell 1칸; 1 → cell 중심 반경 r(Δ=level−learn: ≥20→2, ≥10→1, 0); 2 → 정면 직선 1..max(장애물에서 중단) ≥min; 3 → 시전자 중심 거리 `[min,max]` 모든 유닛; 4 → 맵 전체. 생존 필터: 리잘렉션(41)은 사망/side 7만, 그 외는 비사망·비side 7. 라이프스틸(55)/드레인(81)은 끝에 시전자 추가. 대상 진영 `magic.target` 0 적 / 1 아군 / 2 모두.

### 7.6 판정 [관찰 `battle_rules.md` §2, §3]

`resolveAction(state, actor, action, targets, rng): Hit[]` — 대상마다 `FUN_0043b4a0` 1회에 해당. 구현은 문서의 수식을 그대로 옮긴다. 핵심만 적는다(세부는 문서가 권위다):

- 물리: 수면 깨움 → 크리티컬 `roll(att, tgt, 3)`(대시면 확정) → 회피 `roll(tgt, att, 3)`(**인수 역전 유지**) → 대미지 `max(atk−def,1)` → 속성 보정(최대 |차이| 축 하나) → 배율 100(+200 특수기, +80 크리, +25 배후, +15 측면, 높이차×2) → `min(dmg, HP)`. 무기 상태이상 `roll(att, tgt, 20)`.
- 마법: `power + wisTot − mgrTot` 또는 회복·소생·흡수·상태이상(§3.4, §3.5 표). 방향·높이·크리·회피 없음. MP 차감은 행동 시작 때.
- 대시: 아군이 `special` 아님, 같은 방향 3칸 이상 직진(경로 각 칸 높이차 ≤2, 비행 아님) 후 그 방향으로 공격 → 크리 확정. 활은 대상 인접 필요. `moved` 경로를 `Battle`이 기억해 판정에 넘긴다.

### 7.7 결과·턴 처리 [관찰 `battle_rules.md` §5, §6]

`applyOutcome`: HP 반영, 사망(status 1), 아군 행동이면 EXP(§5.1 공식: 대미지 비율×종족 exp_value, 처치 보너스, 이름 있는 적 ×2, 레벨차 보정, 아군 대상·메시지 결과는 7, 3, 1…), 레벨업(`exp/100+1`, `grow(randomize=true, announce)`), 적 사망 → 드롭이 있으면 side 7 오브젝트(종족 8/9)로 전환, 없으면 슬롯 비움(`removed`). `statusTick(side)`: 독 `HPmax/10+1`, 카운터 감소(수면·침묵 −15, 동결·매혹·홀드 −10, 부유 −20) 후 `c < rand(100)`이면 해제. `roundStart`: 플래그·MP·버프. `checkEnd`.

## 8. 적 AI [관찰 `field_mode.md` §5]

`chooseAction(state, unit): { dest: [c, r]; path: Dir[]; action: number | null; cell: [c, r] | null; faceDir: Dir | null }`

§5.2의 점수표를 그대로 구현한다. 상수는 표로 고정한다.

| 상수 | 값 | 출처 |
|---|---|---|
| R (인접 반경·거리 기준) | 4 | `DAT_0044a058` |
| 지형 점수 `landBonus[land]` | 0, 10, 15, 20, 40, 15, 20, 10 | `DAT_0044ab00` |
| 지형 나누기 | 10 (수세 5) | |
| 공격 기본 점수 | 보통 20, 공세 40, 수세 5, 매혹 대상 5, 제자리 모드 자기 셀 +10 | |
| 방향 보너스 | 배후 8, 측면 4, 정면 0 (수세는 >>2), 대시 +40 | |
| 마법 기본 | 적 +30(공세 +50), 아군 −20(공세 −10), 중복 상태 −20, 자기 셀 +5, 슬롯 벌점 i×10 | |
| 치료 점수 | 레스토어/리커버리: 독·홀드 60, 수면 50, 석화 80, 동결 70, 매혹 80 ; 힐링·어스: 결손 % ; 리잘렉션 100 | |

행동: `T = cell(dest)`; `magicId == 0 || magic <= attack` 이면 물리(대상 없으면 가장 가까운 적을 향해 방향만) 아니면 마법. 적 페이즈에서 `Battle`은 유닛마다 `moved → action → face` 순서로 이벤트를 낸다.

## 9. 표현 (`field/`)

### 9.1 하이라이트와 커서 (`system.apd`)

- 이동 가능 셀: `MOVE`, 사거리·대상 후보 셀: `ATTACK`, 레이어 1(그림자 아래), 셀 기준점에 둔다.
- 커서: 마우스 아래 셀에 `FUN_00438c70` 규칙으로 `ENEMY` / `FRIEND` / `CURSOR`(기본). 레이어 1.
- 방향 선택: 유닛 주위 4칸에 `TURN_NORTH/EAST/SOUTH/WEST`, 마우스가 가리키는 것은 `S.TURN_*`. 레이어 5.

### 9.2 유닛 스프라이트 [관찰 `field_mode.md` §2]

`UnitSprites.for(unit)` → `{ body: {apd: 'char_%02da', anim, flipH}, shadow: {apd: 'system', anim: 'SMALL.M'…} | null, icon: {apd: 'system', anim} | null }`. 애니 이름 규칙은 §2.2 표 그대로. `#` 변형 우선. 본체 레이어 4(오브젝트 3), 그림자 2, 아이콘 5(유닛 위 56px, 사망 16px). 종족 7과 존재하지 않는 APD는 스프라이트 없음 + 로그.

### 9.3 행동 애니

| 순간 | 본체 애니 | 비고 |
|---|---|---|
| 이동 한 칸 | `RUN1`, `RUN2` 번갈아 (없으면 `WALK1/2`, 없으면 `STAND`) | 칸마다 방향 갱신 [추정: 원작 작업 시스템 미분석] |
| 물리 공격 | `ATTACK1` (없으면 `STAND` 1회 길이 400 ms) | 대상 쪽으로 방향 전환 먼저 |
| 마법 시전 | `CAST1A` → `CAST1B` (없으면 `STAND`) + 효과 APD `magic.effect` 소문자 (`burst` 등)를 대상 셀에 1회 | 효과 APD 없으면 생략 |
| 빗나감 | 대상 `DEFENSE` | |
| 피격 | 대상 `MIDDLE_DAMAGE`; 크리티컬 `UP_DAMAGE`; 사망 `DOWN_DAMAGE` 후 `DEAD`(아군)/`DOWN_DAMAGE` 유지(적) | [추정: 0x44a098 표 인덱스 미확인] |
| 회복·버프·상태 | 대상 `STAND` 유지 + 팝업 | |

### 9.4 렌더러 변경

`PlacedSprite`에 `layer: number`를 추가한다. 같은 행(c+r) 안에서 `layer` 오름차순, 같으면 배치 순서. 하위 프로젝트 1 스펙 §7.4의 "배치 순서" 결정은 이 규칙으로 바뀐다(그 문서 §12 "원작과 다르게 하는 점" 표가 예고한 대로). 뷰어는 `layer: 4`를 쓴다.

### 9.5 팝업과 로그

- 숫자: `number.apd`의 `POP_<자릿수>`(대미지)와 `B_POP_<자릿수>`(회복) [추정: 색 역할]. 유닛 위에서 400 ms 동안 위로 16px 떠오르며 사라진다.
- 문자(`miss!`, `크리티컬!`, `well`, `str_up!`, `hp_up!`…): 캔버스 텍스트(10px monospace, 흰색, 검은 테두리) 같은 위치. 원작의 `FUN_00439f40` 글꼴은 하위 프로젝트 5.
- HTML 로그에 모든 Hit를 한 줄씩 적는다: `카린 → 블루슬라임: 12 (크리티컬)`.

### 9.6 연출 큐와 타이밍

`Presenter.enqueue(events)` → 큐가 빌 때까지 입력 잠금. 고정값: 이동 한 칸 160 ms(직선 보간), 공격 애니는 APD 길이(`Timeline.totalMs`), 팝업 400 ms, 적 유닛 사이 300 ms. 카메라는 행동 유닛이 화면 밖이면 그 유닛을 중앙으로 즉시 이동(스크롤 애니 없음).

## 10. UI (`ui/panel.ts`, `game.html`)

### 10.1 패널

전투 선택(33개, `에피소드 — 목표`), 시작 버튼, 시드 입력(기본: 현재 시각), 턴·페이즈, 유닛 상태창(마우스 아래 또는 선택 유닛: 이름(이름표 §6 또는 종족 이름), 종족, Lv, HP/MP, 상태, 무기·방어구 이름), 유닛 메뉴(이동/공격/마법/대기), 주문 목록(이름, MP, 사거리; 부족하면 비활성), 턴 종료, 로그 10줄, 결과창(승리/패배, 획득 EXP, 레벨업).

### 10.2 조작 흐름 (아군 페이즈)

| 상태 | 입력 | 결과 |
|---|---|---|
| idle | 아군 유닛 클릭 | `select` → menu. 이동 가능 셀 표시 |
| idle | 다른 유닛 클릭 | 상태창만 갱신 |
| menu | 이동 | `beginMove` → move. (이미 이동했으면 비활성) |
| move | 파란 셀 클릭 | `move` → 이동 연출 → menu |
| menu | 공격 / 마법(주문 선택) | `beginTarget` → target. 사거리 표시 |
| target | 대상 셀 클릭 | `act` → 연출 → face |
| menu | 대기 | `wait` → face |
| face | 화살표 클릭 / 유닛 클릭(유지) | `face` → idle. 유닛 종료(`COMPLETE`) |
| menu, move, target | 오른쪽 클릭 / Esc | `cancel` → 한 단계 뒤로 (이동은 되돌리지 않음) |
| 아무 때나 | 턴 종료 버튼 | `endTurn` → 적 페이즈 |

### 10.3 방향 선택

행동이나 대기 뒤 `face` 상태. 원작 `TURN_*` 화살표 4개를 유닛 주위에 표시한다. 화살표 클릭 → 그 방향, 유닛 클릭 또는 Enter → 현재 방향 유지. 방향은 다음 적 페이즈의 배후·측면 판정에 쓰인다.

### 10.4 적 페이즈

패널 입력 잠금. `Battle`이 큐의 적 유닛 하나를 `enemyStep`으로 처리 → Presenter 연출 → 다음 `enemyStep`. 끝나면 `roundStart` → 아군 페이즈.

## 11. 파티 규칙 (전투 선택)

1. 새 게임 파티 = 로스터 1(`stage001`)로 `createUnit` (장비 포함).
2. 고른 로스터를 원작 `LOAD_UNITS`처럼 적용: 슬롯 10..49 비움 → 레코드마다 `applyRosterUnit`: 파티 id가 이미 있으면 위치·방향·상태만 갱신, 없으면 생성.
3. **리메이크 편의 규칙**: 파티 유닛의 레벨이 로스터 레코드의 레벨보다 낮으면 `grow(randomize=false)`를 반복해 맞춘다. 첫 전투는 둘 다 Lv2라 영향이 없다. 로스터에 없는 파티 유닛(이야기상 아직 합류 전/이탈)은 그 전투에 두지 않는다 → 로스터의 파티 레코드만 쓴다.
4. 전투 시작 = `BATTLE_START_HEAL`이면 전 유닛 HP=max, MP=max/2; `BATTLE_START`면 그대로(새 유닛은 생성 시 전회복). 모두 `moved=acted=false`, turn=1.
5. **리메이크 편의 규칙**: 로스터의 (0, 0)은 "아직 배치하지 않음"이다(17개 전투: 이야기 스크립트가 `SET_POS`로 자리를 정하거나 나중에 증원한다). 파티 유닛이면 배치된 파티 유닛들의 중심에서 가장 가까운 빈 바닥 셀(blocked 아님, land ≠ 0, 비어 있음)에 둔다(배치된 파티가 없으면 맵 중앙 기준). 파티가 아닌 유닛이면 그 전투에서 뺀다. (0, 0)이 아닌 없는 셀에 선 유닛은 `DataError`다.

## 12. 오류 처리

- `DataLoader`는 로드 시 §5.4의 범위를 다시 검사한다. 위반은 `DataError(file, message)` → 전투 선택 화면에 표시, 그 전투만 비활성.
- `MapData`에 로스터 좌표가 없으면(`cellAt == −1`) 그 유닛을 `DataError`로 보고하고 전투를 막는다. 예외는 §11.5의 (0, 0) 자리표시다.
- 애니·APD 없음은 §9.3의 대체 + 로그(오류 아님).
- 코어 불변 조건(HP 0..max, 셀당 유닛 1, 슬롯 0..9만 side 0)은 테스트의 `assertInvariants`에서만 검사한다.
- 명령 거부는 `rejected` 이벤트로만 알린다. 예외를 던지지 않는다.

## 13. 테스트

| 영역 | 테스트 | 근거 |
|---|---|---|
| 난수 | 시드 S의 첫 100개 값 = Python 교차 구현 결과 | §7.1 |
| 유닛 | 로스터 1 생성: 마법사 Lv2 스탯 = 기본치 + 성장 1회; 적 성장 난수 소비 수 | §7.2 |
| 격자 | dir·dist·hostile 사례표(CHARM 반전 포함) | §7.3 |
| 이동 범위 | 합성 5×5 맵: 비용·높이 제한·ZOC·flag2·부유; 경로 복원 동점 규칙 | §7.4 |
| 대상 | 무기 4종·마법 shape 5종 사례; 높이 4 초과 제외; 조기 return 특이점 | §7.5, D2 |
| 판정 | `battle_rules.md`의 수식마다 사례 1개 이상(물리 배율 조합, 속성 동/반, 회피 인수 역전, 마법 회복 상한, 상태이상 확률 경계) | §7.6 |
| 결과 | EXP 공식·레벨업·드롭 전환·상태 틱·라운드 시작 | §7.7 |
| AI | 합성 맵 사례: 인접 적 1명 → 그 옆 셀 공격; 수세 모드는 멀어짐; 힐러는 결손 아군에게 힐링 | §8 |
| 상태 기계 | 명령 거부 사례(이동 2회, 행동 뒤 공격), 페이즈 전환, 승패 | §6 |
| 시나리오 | 첫 전투: 시드 고정 + 명령열로 승리까지. 이벤트 열 스냅샷 | §1 |
| 코퍼스 | 33개 전투 로드·검증·AI 1턴 실행(예외 없음) | §5 |
| 변환기 | Python unittest: 카탈로그 33개, 로스터 필드, JSON 스키마 | §5 |
| 수동 | Playwright: 첫 전투 이동·공격·마법·방향·적 턴·승리 1회, 콘솔 오류 0 | §10 |

원작 실행 환경이 없으므로 수치 검증은 **문서 수식 대비**다. 원작 캡처와의 비교는 하지 않는다.

## 14. 미확인·후속

| 항목 | 이번 처리 | 후속 |
|---|---|---|
| 이동 애니 선택·속도 (원작 작업 시스템) | §9.3 추정값 | 하위 프로젝트 5에서 `FUN_00437e50` 분석 |
| 피격 애니 표 인덱스 | §9.3 추정 | 소비 함수 탐색 |
| `ATTACK%d`의 번호 | 항상 `ATTACK1` | `battle_rules.md` §8 |
| `land` 이름·회피 보정 | 비용표만 사용 | |
| 진영 3 유닛 이동 불가 | 규칙대로(이동 안 함) | 이유 미확인 |
| 아이템 사용 | 제외 | 하위 프로젝트 4(소지품은 스크립트가 준다) |
| 보물 상자 획득 `get%03d` | 표시만 | 하위 프로젝트 4 |
| `POP_`/`B_POP_` 색 역할 | 피해/회복으로 추정 | |

## 15. 원작 함수 참조

| 함수 | 역할 | 이 문서 |
|---|---|---|
| `FUN_0041fcf0`, `FUN_0041fae0`, `FUN_0041f7c0` | 로스터 로드, 유닛 생성, 성장 | §7.2, §11 |
| `FUN_0041e9e0`, `FUN_0041e350`, `FUN_0041f580`, `FUN_00429630` | 스프라이트·애니 이름·레이어 | §9.2, §9.4 |
| `FUN_00439690`, `FUN_00439b40`, `FUN_00438c10`, `FUN_00438c70`, `FUN_00438960` | 이동 범위, 대상 표시, 커서, 경로 | §7.4, §9.1 |
| `FUN_00438d70` | 대상 목록 | §7.5 |
| `FUN_0043b4a0`, `FUN_0043dd90`, `FUN_0043df50`, `FUN_0043afd0` | 판정·실행 | §7.6 |
| `FUN_0043a2e0`, `FUN_0043e1e0`, `FUN_00420230`, `FUN_004332f0` | 결과, 상태 틱, 라운드, 페이즈 | §7.7, §6.4 |
| `FUN_004118b0`, `FUN_00411b10`, `FUN_00412a80` | 적 AI | §8 |
| `FUN_004337a0` | 난수 | §7.1 |
| `FUN_0041f2e0`, `FUN_0041f4d0`, `FUN_0041f520`, `FUN_0041f5f0` | 거리, 방향, 적대, 유닛 검색 | §7.3 |
