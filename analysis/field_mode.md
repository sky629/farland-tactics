# 파랜드 택틱스 2 (FT2.exe) 필드·전투 모드 분석 — 로스터, 유닛 스프라이트, 이동 범위, 적 AI

- 대상: `FT2.exe` (sha256 979b0c7a…), Ghidra 12.1.4 디컴파일 (2026-10-15).
- 표기: **[관찰]** = 디컴파일 코드에서 직접 확인(함수 주소 병기). **[추정]** = 데이터 값·호출 문맥에서 유추.
- 이 문서는 `battle_rules.md`(판정 공식)와 `file_formats.md`(파일 포맷, §8 이동 규칙)를 보완한다. 유닛 구조체 필드 번호는 `battle_rules.md` §7의 u16 인덱스를 쓴다.

| 주소 | 역할 |
|---|---|
| `FUN_0041fcf0` | 전투 로스터 `data\stage%03d.dat` 로드 (스크립트 opcode 0x0B) |
| `FUN_0041fae0` | 레코드 → 유닛 생성 또는 파티 유닛 위치 갱신 |
| `FUN_0041e9e0`, `FUN_0041e350`, `FUN_0041f580` | 유닛 스프라이트(본체·그림자·상태 아이콘) 생성과 애니 이름 규칙 |
| `FUN_00439690`, `FUN_00438c10`, `FUN_00438c70` | 21×21 이동·사거리 표, 커서 종류 |
| `FUN_00438960` | 이동 경로 복원 |
| `FUN_004118b0`, `FUN_00411b10`, `FUN_00412a80` | 적 AI: 목적지 점수표, 행동 선택, 공격 가능 판정 |
| `FUN_0041f5f0` | 유닛 검색 반복자 (모드 2 id, 3 종족, 4 상태, 5 위치, 6 진영, 7 거리 범위) |

---

## 1. 전투 로스터 로딩 [관찰]

스크립트 명령 `0x0B n`(이전 문서의 `CLEAR_SCENE`, 지금은 `LOAD_UNITS`)은 `FUN_0041fcf0`를 호출한다(유일한 호출자, 0x409030).

```text
FUN_0041fcf0():
  슬롯 10..49 의 유닛을 모두 삭제 (FUN_0041fcd0)            # 파티 슬롯 0..9 는 그대로
  스프라이트 데이터 슬롯(0x4563a0..0x4564a0) 해제
  파일 = 포맷 13 "data\stage%03d.dat"  (0x44bf08) ; 디버그 "Load UNIT stage%03d."
  레코드마다 (28 B):
      rec[124 B] = 0 ; rec[0..27] = 파일 레코드          # 유닛 구조체 앞 14 워드
      rec[0xe..0xf] = rec[0xc..0xd] ; rec[0xc..0xd] = 0   # 워드 12,13 → 드롭 아이템, 드롭 골드
      FUN_0041fae0(rec) ; 실패(빈 슬롯 없음)면 중단
```

레코드 = `[0] id, [1] 종족, [2] 레벨, [3] 방향, [4..5] c (i32), [6..7] r (i32), [8] 상태, [9] 진영, [10] 무기, [11] 방어구, [12] 드롭 아이템, [13] 드롭 골드`. `id 8`은 이름 없는 몬스터, 진영 7은 오브젝트(보물상자 종족 8, 금 종족 9).

### 1.1 전투 카탈로그 [관찰: 스크립트 데이터]

`LOAD_MAP`과 `LOAD_UNITS` 뒤 `BATTLE_START(_HEAL)`로 들어가는 33개 전투. 로스터 번호는 보통 맵 번호와 같다(150·126·137은 같은 맵의 다른 로스터).

| 이벤트 | 라벨 | 맵 | 로스터 | 에피소드 | 목표 |
|---|---|---|---|---|---|
| 01 | outfield | 49 | 49 | 첫업무 | 슬라임을 전멸시켜라! |
| 02 | depot | 12 | 12 | 창고에서의 전투 | 도적을 전멸시켜라! |
| 03 | outfield | 51 | 51 | 진흙 투성이의 싸움 | 적을 전멸시켜라! |
| 03 | battle_start | 26 | 26 | 나 시집가요 | 사라를 쓰러뜨려라!! |
| 04 | backdoor | 50 | 50 | 사랑하는 카트린느 | 카트린느를 쓰러뜨려라! |
| 05 | macdogal | 32 | 32 | 홀에서의 싸움 | 적을 전멸시키자! |
| 05 | complete | 29 | 29 | 지붕 위에서의 싸움 | 적을 전멸시켜라! |
| 05 | outfield | 42 | 42 | 보트하우스의 사투 | 조무라기들을 전멸시켜라! |
| 06 | store_papa | 50 | 150 | 카트린느 역습! | 카트린느를 쓰러뜨려라!! |
| 07 | outfield | 53 | 53 | 광산의 마수 | 적을 전멸시켜라! |
| 07 | roar | 46 | 46 | 지하의 지배자 | 베히모스를 쓰러뜨려라! |
| 08 | begin | 54 | 54 | 광차로 GO! | 하피를 전멸시켜라! |
| 09 | outfield | 30 | 30 | 게가 왔다 | 게를 전멸시켜라! |
| 10 | outfield | 52 | 52 | 남자는 강하게 | 적 전멸(가능한 존 혼자서) |
| 11 | outfield | 56 | 56 | 너는 누구냐?」 | 적을 전멸시켜라! |
| 12 | church_night | 16 | 16 | 고스트바스터즈 출동 | 적을 전멸시켜라! |
| 12 | complete | 40 | 40 | 타락천사v.s.타락천사 | 듀마를 쓰러뜨리자! |
| 13 | lighthouse | 13 | 13 | 등대 1층의 전투 | 적을 전멸시켜라! |
| 13 | up_to_2f | 43 | 43 | 등대2층의 전투 | (없음) |
| 13 | up_to_3f | 44 | 44 | 등대 3층의 전투 | (없음) |
| 14 | begin | 57 | 57 | 해상의 결전 | 듀마를 쓰러뜨리자! |
| 15 | begin | 26 | 126 | 길드 사람 휩쓸다? | 적을 전멸시켜라! |
| 15 | rush | 58 | 58 | 아리스 위기일발! | 적을 전멸시켜라! |
| 15 | comp_1a | 62 | 62 | 지하감옥을 목표로 | 적을 전멸시키자! |
| 15 | comp_b1 | 59 | 59 | 취사장으로 바토르 | 적을 전멸시켜라! |
| 15 | comp_1b | 60 | 60 | 2층 돌입! | 적을 전멸시켜라! |
| 15 | comp_2a | 61 | 61 | 저혈압인 사람들 | 적을 전멸시켜라! |
| 15 | comp_2b | 64 | 64 | 길드 대결전! | 길드 마스터를 쓰러뜨려라! |
| 16 | begin | 37 | 37 | 재판을 내리는 자 | 앨비스를 쓰러뜨려라! |
| 17 | outfield | 35 | 35 | 하늘을 향해 달린다 | 적을 전멸시켜라! |
| 17 | complete | 36 | 36 | 오랫동안 헤멘 끝에 | 손을 쓰러뜨려라! |
| 17 | comp_sorn | 37 | 137 | 복수의 천사 | 앨비스를 쓰러뜨려랴! |
| 17 | comp_alveas | 69 | 69 | 시간과 공간의 사이에서 | 손. 바이스를 쓰러뜨려라! |

첫 전투(로스터 49): 마법사 Lv2 (36,19) 방향 2, 검사 Lv2 (35,18) 방향 2, 블루슬라임(종족 10) Lv1 × 6, 진영 4, 무기 130(적검A). 파티의 초기 장비는 로스터 1(`stage001`)에 있다: 마법사 무기 30·방어구 112, 검사 무기 10·방어구 81.

### 1.2 유닛 생성 `FUN_0041fae0(rec)` [관찰]

```text
if rec.side == 0:  슬롯 0..9 에서 같은 id 검색 → 있으면 위치·방향·상태만 갱신 (x, y, [3], [8]) 후 플래그 처리로
빈 슬롯 찾기: side 0 → 0..9, 그 외 → 10..49 ; 없으면 실패(NULL)
side 0 인 새 유닛은 FUN_0041eee0(rec) 로 이름 등록 (디버그 메시지)
구조체 124 B 복사
if 종족 < 종족 수 and side != 7:
    HPmax=HP=race.hp, MPmax=MP=race.mp, str/def/wis/mgr/agi = race 기본치
    (레벨-1) 회 FUN_0041f7c0(unit, randomize = (side != 0), announce = 0)    # 적만 ±1 난수 성장
    status 1(사망) → HP = 0 ; status ≠ 0 → 상태 카운터 [0x34] = 100
    exp = (레벨-1)*100
    id > 7 → 주문 [0x1c..0x1f] = race.spell0..3
스프라이트 핸들 [0x38..0x3d] = 0
이동 완료 [0x2e] = 1, 행동 완료 [0x30] = 1          # BATTLE_START 가 0 으로 되돌린다
FUN_0041e9e0(unit)  → 스프라이트 생성 (§2)
```

---

## 2. 유닛 스프라이트 [관찰 `FUN_0041e9e0`, `FUN_0041e350`, `FUN_0041f580`]

### 2.1 파일 선택

- `FUN_0041e9e0`: 문자 `'a'`(0x61)로 `FUN_0041e350(unit, letter)`를 부른다. 예외: 스크립트 모드(4)에서 이름 있는 파티 유닛(id ≠ 8, id < 30, 종족 ∉ {0x17, 0x48, 0x49})이면 `'v'`.
- `FUN_0041e350`: 포맷 11 `sprite\char_%02d%c.apd` = (**종족 번호**, 문자). 종족별로 한 번만 로드해 `DAT_00456378[종족]`에 캐시한다(문자가 달라도 첫 로드가 남는다). 종족 7(NPC)과 종족 수 이상은 스프라이트를 만들지 않는다.
- 따라서 전투 중 유닛 그림은 `char_<종족 2자리>a.apd`다. 블루슬라임(종족 10) → `char_10a.apd`.

### 2.2 본체 애니 이름

```text
접두 (FUN_0041f580, 방향 [3]):  0(남)·1(동) → "F."   2(서)·3(북) → "B."
반전 플래그 0x10:              방향 1·2 일 때.  종족 0x17(베히모스)·0x49(세라프)는 반전 없음
상태 선택 (uVar8):
  스크립트 모드이고 이름 있는 파티 유닛이 이동·행동을 모두 마쳤으면(bVar2) → 상태 9 면 9, 아니면 0
  그 외: status 0 이고 FUN_0041ee30(unit, 0xb) 참이면 0xb(부유 아이템), 아니면 status 그대로
이름 뒤에 붙는 상태 토큰:
  0, 6(침묵), 7(매혹):  오브젝트(진영 7)·베히모스·세라프·또는 bVar2 거짓 →
                         이동 또는 행동이 남았거나 오브젝트 → "STAND" (스크립트 모드/대기 중이면 반복 플래그 0x03)
                         둘 다 마친 파티 유닛 → "COMPLETE"
                         둘 다 마친 적 → "STAND"
                       bVar2 참(스크립트 모드의 대기 파티원) → "SET"
  1(사망):             파티(진영 0) → "DEAD" ; 그 외 → "DOWN_DAMAGE"
  2, 3, 8 (독·수면·홀드) 및 그 밖의 값: "DOWN_DAMAGE"
  4(석화): "S/DAMAGE"      5(동결): "A/DAMAGE"
  9(은신): 오브젝트면 "HIDE", 아니면 스프라이트 없음
  0xb(부유): "LEVITATE"
완성 이름 = 접두 + 토큰. 먼저 이름 + "#" 를 시도하고 없으면 "#" 없이 다시 시도 (FUN_00429a50). 둘 다 없으면 디버그 메시지.
```

본체 스프라이트는 `FUN_00429630(0, apd, 0, 0, layer)`로 만든다. **layer = 4, 오브젝트(진영 7)는 3**. 이 값이 스프라이트 레코드 +0x48(같은 행 안의 정렬 2차 키)이다. 스크립트 `SPRITE_LAYER`(1 또는 5), `LOAD_SPRITE`(3 또는 5), 마커 `LARGE.M`(2)도 같은 필드를 쓴다. `file_formats.md` §9의 "+0x48 출처" 항목은 이것으로 해결된다.

### 2.3 그림자와 상태 아이콘 (`system.apd`, 핸들 `DAT_0044b738`)

```text
그림자: 크기 k = race.size(+0x38) ; 쓰러짐(1,4,5,2,3,8)이면 k+1, 부유면 k-1
        k = 0 → 없음, 1 "SMALL", 2 "MIDDLE", 3 "LARGE", ≥4 "HUGE" ; 이름 + ".M" ; layer 2 ; 플래그 0x80
        (DAT_0044b740 == 0x45 이면 그림자 없음)
상태 아이콘: 1(파티만) "DEAD", 2 "POISON", 3 "SLEEP", 6 "MUTE", 7 "CHARM" ; layer 5 ; 플래그 3
             위치 = 유닛 화면 좌표, y − 56 (사망은 y − 16)
```

### 2.4 애니 어휘 [관찰: 코퍼스]

`char_*a` 64개 파일에 가장 흔한 이름: `STAND`(64), `RUN1/RUN2`(60), `DOWN_DAMAGE`(59), `ATTACK1`(58), `MIDDLE_DAMAGE`·`UP_DAMAGE`(58), `DEFENSE`(56), `A/DAMAGE`·`S/DAMAGE`(51), `SET`(49), `DOWN1/2`(46), `JUMP1/2`(45), `CAST1A/1B`(42), `WALK1/2`(27), `FLY1/2`(24), `TOUCH_DOWN1/2`(23). 파티 종족(0~6)에는 `COMPLETE`, `DEAD`, `FALL`, `LIFT`, `LEVITATE`가 더 있다. 슬라임(종족 10)·좀도둑(18)·그레믈린(44)에는 `RUN`·`ATTACK`이 **없다**(`STAND`, `DEFENSE`, 피격 4종만).

`system.apd`(31개): `CURSOR`, `ENEMY`, `FRIEND`(커서 3종), `MOVE`, `ATTACK`(범위 표시 타일), `WAIT`, `TURN_NORTH/EAST/SOUTH/WEST`와 `S.TURN_*`(방향 선택 화살표), `F.SWEAT`/`B.SWEAT`, 그림자 4종(`MDDLE.M` 오타 포함), 크기 이름 4종, 상태 아이콘 `DEAD SLEEP MUTE POISON CHARM SILENCE`. `number.apd`: `POP_0..9`, `B_POP_0..9`(팝업 숫자 두 색).

### 2.5 피격 애니 표 [추정]

0x44a098부터 32바이트 문자열 표 두 벌: `DEFENSE, UP_DAMAGE, MIDDLE_DAMAGE, DOWN_DAMAGE, UP_DAMAGE, -, -, -` 와 `DEFENSE, MIDDLE_DAMAGE, UP_DAMAGE, DOWN_DAMAGE, UP_DAMAGE, …`. 앞의 헤더 `0,0,2,4,6,0`. 인덱스 규칙(판정 결과 종류로 추정)은 소비 함수를 찾지 못해 미확인.

---

## 3. 이동·사거리 표 [관찰 `FUN_00439690(unit, action)`]

- 표 `DAT_0044c4b0`: 21×21 셀 × (u16 남은 이동력, u16 종류), 유닛 위치가 중심. `FUN_00438c10(dx, dy)`가 셀 포인터를 돌려준다.
- 맵 셀 레코드(`FUN_0042cd50(x, y)`): +0 i16 높이, +2 u8 blocked, +3 u8 flag2, +4 u8 land.

```text
action == 0 (이동 + 물리 공격):
  중심 셀 이동력 = 30
  if unit.side != 3 and !moved and status ∉ {1,4,5,3,8,9}: FUN_00439b40(0,0)   # 재귀 채우기 (file_formats §8)
  if !acted:
    for v in 거리 [weapon.range_min, weapon.range_max] 안의 유닛:
      무기 종류 != 3(활) 이고 |높이(unit) − 높이(v)| > 4 → **함수 전체 return** (뒤의 대상은 표시되지 않음, 원작 특이점)
      hostile(unit, v) and 셀이 창 안 and (무기 종류 != 1 or v 가 같은 x 또는 같은 y) → 종류 = 1
action ≥ 1000 (아이템 action−1000): 거리 [item.range_min, range_max] 안의 **파티 슬롯(0..9)** 유닛 → 종류 = 2
action = 마법 m:
  shape 0,1,3: 거리 [range_min, range_max] 이고 blocked == 0 인 모든 셀 → 종류 = (target == 1 ? 2 : 1)
  shape 2,5:   4방향, 1..range_max−1 칸 전진. 칸 ≥ range_min 이면 종류 표시.
               m == 60: flag2 ≠ 0 또는 높이가 앞 칸과 다르면 중단 ; m == 62: flag2 ≠ 0 또는 높이가 높아지면 중단
  shape 4: 표시 없음
```

커서 종류 `FUN_00438c70(x, y)`: 셀이 없거나 blocked ≠ 0 또는 flag2 ≠ 0 → 없음(−1). 종류 1 → `ENEMY`, 종류 2 → `FRIEND`, 남은 이동력 ≠ 0 이고 (유닛 없음 / 자기 자신 / 보물상자 오브젝트) → `FRIEND`, 그 외 없음.

---

## 4. 경로 복원 [관찰 `FUN_00438960(destX, destY)`]

```text
(dx, dy) = dest − unit ; 경로 비움
while (dx, dy) != (0, 0):
  best = 없음 ; bestMove = 현재 셀의 남은 이동력
  for d in 0..3:
    (nx, ny) = 이웃 (FUN_0041f340)
    if 이웃 셀이 창 안 and 맵 셀 존재:
      climb = (모드 1 이고 (종족 cost_land0 != 99 또는 부유)) ? 99 : race.climb_max
      drop  = 같은 조건 ? 99 : race.drop_max
      if 높이(현재) − 높이(이웃) ≤ climb and 높이(이웃) − 높이(현재) ≤ drop:
        if 이웃 이동력 > bestMove or (같고 d == 직전 방향): best = d, bestMove = 이웃 이동력
  if best 없음: return (경로 없음)
  경로 앞에 (best ^ 3) 추가 ; (dx, dy) = 이웃 ; 직전 방향 = best
최대 30 단계. 결과 DAT_004616f0 = 출발점부터의 방향 열
```

---

## 5. 적 AI [관찰 `FUN_004118b0`, `FUN_00411b10`, `FUN_00412a80`]

### 5.1 성향 모드

```text
mode = unit.side (0 → 4)
if mode != 6 and (acted or status ∈ {1,4,5,3,8,9}): mode = 5      # 행동 불능·행동 완료 → 수세
```
2 = 제자리 선호, 4 = 보통(파티 자동 전투), 5 = 수세(멀어지기), 6 = 공세(제약 무시, 공격 점수 2배). 그 밖의 진영 값(1, 3)은 기본 규칙만 쓴다.

### 5.2 셀 점수표 `FUN_00411b10(unit) → (destX, destY)`

창 21×21(`DAT_0044f228`, 셀당 10 워드: `[0] move, [1] attack, [2] magic, [3] magicId, [4..5] attackTargetIdx+1, [6..7] targetX, [8..9] targetY`), 대상 목록 `L`(최대 50: x, y, score, unit). 상수 `R = DAT_0044a058 = 4`, 지형 점수표 `DAT_0044ab00[land] = {0, 10, 15, 20, 40, 15, 20, 10}`.

```text
canMove = !moved and status ∉ {1,4,5,3,8,9}
for dy in −10..10, dx in −10..10:
  cell = (unit.x + dx, unit.y + dy)
  if FUN_00438c70(cell) < 0 or (다른 유닛이 cell 에 있음): move = −9999 ; continue
  if !canMove and !(dx == 0 and dy == 0): continue                 # move 0 으로 남음
  own = (dx == 0 and dy == 0)
  if own and mode == 2: move = 10
  if own and mode == 5: move = 10 ; 거리 1..R 안에 비행동불능 적이 있으면 move = 0
  move += landBonus[land(cell)] / (mode == 5 ? 5 : 10)
  # 인접 적 벌점
  acc = 0 ; n = 0
  for v in 거리 1..R 안의 유닛: if mode != 6 and hostile(unit, v) and v 비행동불능: move −= acc/2 ; acc += 3 ; n += 1
  if mode == 5 or n == 0:
    dmin = min 거리(cell, v) over v: v != unit, id != 0, status != 9, hostile, status != 1, side != 7  (없으면 999)
    if mode == 6: dmin *= 2
    move += (mode == 5) ? dmin : (R − dmin)
  # 물리 공격
  if !acted and 비행동불능 and 무기 사거리 [min,max] 안에 유닛이 있음:
    base = mode == 5 ? 5 : mode == 6 ? 40 : 20 ; if mode == 2 and own: base += 10 ; move = 0
    for v in 그 유닛들: if FUN_00412a80(cell, unit, v):            # §5.4
      bonus = 8 (배후) ; d = dir(cell → v) ; if d != v.dir: bonus = (d^3 == v.dir) ? 0 (정면) : 4 (측면)
      if v.status == 7: base = 5
      if mode == 5: bonus >>= 2
      if unit.side == 0 and (cell 과 unit 과 v 가 같은 x 또는 같은 y) and 거리(unit, cell) > 2: bonus += 40   # 대시
      score = base + bonus ; L[v] = max(L[v], (cell, score)) ; if attack < score: attack = score, attackTarget = v
  # 마법 (주문 슬롯 i = 0..9, 벌점 pen = i*10)
  for i, m in unit.spells: skip if m == 0, acted, 행동불능, status == 6(침묵), MP < |magic.mp|, m == 31(오더)
    shape 0: rmin,rmax = magic 사거리 ; tmin,tmax = 0,0
    shape 1: 같고 tmax = 반경(FUN_0043e350: Δ=level−learn, ≥20→2, ≥10→1, else 0)
    shape 3: rmin=rmax=0 ; tmin,tmax = magic 사거리 (시전자 중심)
    shape 4: rmin=rmax=0 ; tmin=0, tmax=9999
    shape 2 (직선, m != 62): 방향별 합 S[d]: for v in 사거리 안: v.status != 1, side != 7, v != unit,
             (target == 2 or hostile == (target == 0)), v 가 cell 과 같은 x 또는 y:
             d = dir(cell → v) ; 아군이면 S[d] −= 40 ; 적이면 (m == 77 이면 경로 높이가 올라가면 제외) S[d] += (mode==6 ? 40 : 20),
             이미 걸린 상태면 −20 (m 72↔status 5, 73↔2, 74↔8, 75↔4)
             best d 의 S > magic 이면 magic = S, magicId = m, target = 그 방향 마지막 v 위치 ; continue
    for 대상 셀 t in 사각 [cell ± rmax]: 셀 존재, blocked == 0, rmin ≤ 거리(t, cell) ≤ rmax, 거리 [tmin,tmax] 안에 유닛 존재:
      s = 0
      for v in 그 유닛들: (v.status != 1 and side != 7) or target == 2 or hostile == (target == 0):
        m ∈ {13 레스토어, 45 리커버리}: 아군이고 status ≠ 0 → s = {2,8: 60, 3: 50, 4: 80, 5: 70, 7: 80}[status] ; v 가 t 에 있으면 +1
        m ∈ {32 어스, 40 힐링}: 아군, 생존 → s += (HPmax − HP)*100/HPmax ; v 가 t 에 있으면 +1
        m == 41 리잘렉션: 아군이고 (사망 또는 side 7) → s = 100
        m ∈ {55 라이프스틸, 81 드레인}: 자기 HP < max, v 생존, 적 → s += (HPmax − HP) − v.mgr/10
        그 외: 아군 → s −= (mode==6 ? 10 : 20) ; 적 → s += 30 + (mode==6 ? 20 : 0), v 가 t 에 있으면 +1,
               이미 걸린 상태면 −20 (m 5,11,12↔status 8 ; 24↔3 ; 50↔2 ; 52↔7 ; 78↔5)
      if s > 0 and own: s += 5
      if magic < s − pen: magic = s − pen, magicId = m, target = t
끝:
  for e in L: cell(e.x, e.y).attack = max(attack, e.score)
  for cell: move += max(attack, magic)
  dest = move 최대 셀 (−9999 제외) ; 동점이면 |dx|+|dy| 작은 셀 ; 순회 순서 dy 바깥, dx 안쪽
```

### 5.3 행동 선택 `FUN_004118b0(unit)`

```text
FUN_00439690(unit, 0) ; 카메라를 유닛으로 ; dest = FUN_00411b10 ; 경로 = FUN_00438960(dest)
T = cell(dest)
if T.magicId == 0 or T.magic <= T.attack:
  if T.attackTarget 없음: unit.dir = 가장 가까운 적을 향한 방향 (dest 기준)
  else: 대상 목록 = FUN_00438d70(L[target].x, L[target].y, 0) (dest 에 선 것으로 계산) ; acted = 1 ; action = 0
else:
  대상 목록 = FUN_00438d70(T.targetX, T.targetY, T.magicId) ; acted = 1 ; MP −= |magic.mp| ; action = magicId
FUN_0043af00(action) 이 battle%02d 스크립트를 띄우지 않으면 FUN_0043afd0(action) 실행 (이동 후 행동)
```

### 5.4 공격 가능 `FUN_00412a80(cell, attacker, target)`

```text
hostile(attacker, target) and target.status != 1 and target.side != 7
무기 종류 != 3: |높이(cell) − 높이(target)| ≤ 4
무기 종류 == 1: target 이 cell 과 같은 x 또는 같은 y
```

---

## 6. 미확인

- 이동 연출: 작업 시스템 `FUN_00437bb0 → FUN_00437e50/FUN_00437c00`(GlobalAlloc 작업 테이블, 애니 이름·속도)은 분석하지 않았다. `RUN1/RUN2` 선택 규칙과 칸당 픽셀 속도 미확인. `RUN`이 없는 종족(슬라임 등)의 이동 애니도 미확인.
- 피격 애니 표(§2.5)의 인덱스 규칙과 `ATTACK%d`의 `%d`(무기별 공격 번호, `battle_rules.md` §8).
- 공격 연출 순서 `FUN_0043afd0` 내부(공격자 애니 → 효과 → 피격 → 팝업 순서와 대기).
- 진영 3 유닛이 이동하지 않는 이유(`FUN_00439690`의 `side != 3`).
- `S.TURN_*`와 `TURN_*`의 차이(선택됨/보통으로 추정), `WAIT` 애니 용도.
