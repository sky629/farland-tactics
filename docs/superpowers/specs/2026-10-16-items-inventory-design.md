# 하위 프로젝트 3 — 아이템·소지품 설계

날짜: 2026-10-16 · 상태: 승인(목표 지시 "완전한 게임 완성까지 계획대로 쭉 진행해"에 따라 진행) · 선행: 하위 프로젝트 2 「전투 1판」(main `d476126`)

## 1. 목표와 완료 기준

전투 페이지(`web/game.html`)에서 플레이어가 다음을 할 수 있다.

1. **보물 습득**: 파티 유닛이 보물 오브젝트(진영 7) 칸으로 이동하면 골드 또는 아이템을 얻는다. 숨은 보물(상태 9)은 파티 유닛이 인접하면 드러난다.
2. **아이템 사용**: 「아이템」 명령으로 소지한 소모품을 자신 또는 인접 아군에게 쓴다. 효과는 `battle_rules.md` §4.2 그대로다. 하나가 소비된다.
3. **소지품 보기**: 패널에 파티 골드, 소모품 목록(이름 ×개수), 파티원별 장비 가방(4칸)이 보인다.

그리고 헤드리스 모델이 다음을 제공하고 테스트로 고정한다.

4. **소지품 모델**: 원작 한계(80칸, 칸당 9999, 골드 0~999999)와 `giveItem`/`takeItem`/`countOf`/`addGold` 규칙.
5. **장비 규칙**: 장착 가능 판정(슬롯·종족 비트), 장착·해제(가방 ↔ 장비 칸 교환). UI는 하위 프로젝트 4(마을·상태 화면)에서 붙인다.
6. **상점 구매 규칙**: 가격만큼 골드를 내고 `giveItem`. 판매 규칙은 원작 미확인이라 범위 밖이다.

완료 기준: `npm run check` 통과(새 테스트 포함), 전투 1판에서 보물 습득과 아이템 사용이 브라우저에서 동작, 설명서 §6 갱신.

## 2. 원작 근거

- 소지품 구조·한계·함수: `battle_rules.md` §4.3 [관찰].
- 보물 습득 절차와 메시지: §4.4 [관찰].
- 전투 메뉴의 아이템 항목 조건, 명령 → action 변환, 사용 후 소비, 사거리 0..1: §4.5 [관찰].
- 아이템 효과: §4.2 [관찰]. 사용 연출 = `use_effect` 마법의 효과 APD [추정].
- 장비 가능 종족: `item.race_mask` 의 `1 << race` 비트 [추정: 데이터]. 가방 4칸: 유닛 워드 0xe..0x11 [관찰].
- 장착·해제·판매 UI 프로시저는 Ghidra 가 함수로 잡지 못해 미분석(§4.3 끝). 그 규칙은 [추정]으로 표시하고 한 모듈에 가둔다.

## 3. 접근 방식

| 안 | 내용 | 평가 |
|---|---|---|
| **A. 전투 상태 안의 소지품 객체** (채택) | `BattleState.inventory` 에 순수 데이터 `Inventory` 를 두고 `battle/inventory.ts` 의 순수 함수로 다룬다. `Battle.start` 가 소지품을 인자로 받는다. | 기존 리듀서 구조와 같다. 캠페인(하위 프로젝트 4)이 같은 객체를 전투 사이에 들고 다니면 된다. |
| B. 파티 집합체(`Party`) + 캠페인 | 유닛·소지품·골드를 묶는 객체를 지금 만든다. | 캠페인이 아직 없어 YAGNI. A 의 `Inventory` 를 그때 감싸면 된다. |
| C. 유닛별 소모품 | 유닛마다 소모품을 들게 한다. | 원작과 다르다. |

## 4. 데이터 모델

```ts
// battle/inventory.ts
export interface Stack { id: number; count: number }
export interface Inventory { items: Stack[]; gold: number }   // items.length ≤ 80, 1 ≤ count ≤ 9999, 0 ≤ gold ≤ 999999
export const INVENTORY_SLOTS = 80, STACK_MAX = 9999, GOLD_MAX = 999999, BAG_SLOTS = 4;
export const emptyInventory = (): Inventory => ({ items: [], gold: 0 });
```

`Unit` 에 `bag: number[]`(길이 4, 0 = 빈칸)를 더한다. 원작은 파티 유닛의 드롭 필드 자리를 가방으로 쓰지만, 이 코드는 `dropItem/dropGold` 와 `bag` 을 따로 둔다 [결정: 뜻이 다른 두 용도를 한 필드에 겹치지 않는다].

`BattleState.inventory: Inventory`. `Battle.start(entry, map, roster1, roster, tables, seed, inventory = emptyInventory())`.

## 5. 규칙

### 5.1 소지품 (`battle/inventory.ts`, §4.3 그대로)

```text
countOf(inv, id) → 해당 칸의 count, 없으면 0
giveItem(inv, unit | null, id, n, items) → boolean
  items[id].slot ∈ {0,1,2}: unit 없음 → false; unit.bag 의 첫 0 칸에 id, 없으면 false
  슬롯 3: 같은 id 칸 → 없으면 빈 자리(80 미만) → 없으면 false; count + n > 9999 → false; count += n
takeItem(inv, id, n, items) → void   슬롯 3 만; count -= n, 1 미만이면 칸 제거 (count + n ≥ 10000 이면 무시)
addGold(inv, d) → gold 를 0..999999 로 자른다
usableItems(inv, items) → [{ id, count }]  슬롯 3, use_effect ≠ 0, count > 0 (전투 메뉴 조건)
```

### 5.2 보물 습득 (`Battle.move` 뒤, §4.4 그대로)

`move` 가 성공하고 이동한 유닛이 파티(진영 0)이면 `pickUp(unit)`:

```text
for each 오브젝트 o (side 7):
  dist(unit, o) == 0:
    o.dropItem == 0 → addGold(o.dropGold); 이벤트 { type:'pickup', slot, gold:o.dropGold, item:0 }; o 삭제(removed)
    else giveItem(inv, unit, o.dropItem, 1) 성공 → 이벤트 { type:'pickup', slot, item:o.dropItem, gold:0 }; o 삭제
         실패 → 이벤트 { type:'bagFull', slot, item:o.dropItem }; o 는 남는다
  dist == 1 && o.status == 9 → o.status = 0; 이벤트 { type:'revealed', slot:o.slot }
```

`get%03d` 스크립트 라벨은 하위 프로젝트 4 에서 `pickup` 이벤트에 연결한다. AI 유닛은 습득하지 않는다.

### 5.3 아이템 사용 (action = 1000 + id)

- `beginTarget(action ≥ 1000)`: `u.acted` 면 거부; `usableItems` 에 없으면 `'no such item'`; 범위 표: 거리 `item.range_min..range_max`(0..1) 안의 **파티 유닛**(사망 포함 — 소생약은 사망자가 대상)을 kind 2 로 표시. 침묵은 막지 않는다.
- `act(c, r)`: 그 칸의 유닛 하나가 대상. `perform(u, action, …)` → `resolveAction` 의 아이템 분기 → `applyOutcome` → `takeItem(inv, id, 1)`. `u.acted = true`.
- `targetsOf(action ≥ 1000)`: `unitAt(cell)` 하나(없으면 빈 배열).
- `menuEnabled.item = !u.acted && usableItems(...).length > 0`.
- AI 는 아이템을 쓰지 않는다(원작 평가 함수에 없음).

### 5.4 아이템 효과 (`resolve.ts` `resolveItem`, §4.2 그대로)

```text
t 가 사망/오브젝트이고 item.status_code != 1 → miss ('miss!')
heal = min(item.hp_heal, hpMax − hp), mp = min(item.mp_heal, mpMax − mp); 둘 다 적용. 팝업은 heal 우선(숫자), 없으면 mp 숫자
id 6 치유약: status != 0 → status 0, 'well' ; 아니면 miss
id 7 깨어나는 약: status ∈ {1,3} → 0 (사망도 소생: hp 가 0 이면 heal 적용 뒤 유지)
id 8, 9: status ∈ {1,5} → 0
id 155~160: hpMax/mpMax/str/def/wis/mgr += 5 (상한 999), 팝업 'hp_up!' 'mp_up!' 'str_up!' 'def_up!' 'wis_up!' 'mgr_up!'
id 163 에리쿠사: status = 0, hp/mp 999 회복
그 외 status_code != 0 이고 t.status == status_code → 0 ('well'), 아니면 miss
Hit.kind: 회복 수치가 있으면 'heal', 상태만 → 'cure', 능력치 → 'buff', 아무 효과 없음 → 'none'
```

경험치는 기존 `expGain`(회복·메시지 → 7,3,1 계열)을 그대로 쓴다.

### 5.5 장비 (`battle/equipment.ts`, [추정])

```text
canEquip(unit, id, items) = items[id].slot ∈ {0,1,2} && (id == 0 || (items[id].race_mask >> unit.race) & 1)
equip(unit, bagIndex, items) → boolean   가방의 아이템을 장착: 슬롯 0 → weapon, 1 → armor, 2 → acc 의 빈칸(없으면 acc[0]); 밀려난 장비는 그 가방 칸으로. canEquip 거짓이면 false
unequip(unit, slot: 'weapon'|'armor'|0|1) → boolean   빈 가방 칸으로; 없으면 false. 장비 0(없음)은 해제 대상 아님
```

### 5.6 상점 (`battle/shop.ts`, [관찰: 가격 필드] + [추정: 지불 순서])

```text
buy(inv, unit | null, id, items) → 'ok' | 'no gold' | 'full'
  gold < price → 'no gold'; giveItem 실패 → 'full'; 성공 → addGold(−price)
```

판매는 범위 밖(원작 미확인).

## 6. 표현

- `action ≥ 1000` 의 연출: 시전 애니 없이(STAND 유지) `use_effect` 마법의 `effect` APD 를 대상 칸에 1회(70 해독은 효과 없음). 대상 반응은 기존 `hits` 규칙(heal/cure → STAND + 팝업).
- 팝업: 회복 숫자, 'well', 'miss!', '*_up!'.
- 보물: `pickup` → 대상 유닛 위 텍스트 팝업 "%s 획득" / "%d Gold"; `bagFull` → "더 가질 수 없다"; `revealed` → 오브젝트 스프라이트가 STAND 로 바뀐다(상태 9 → 0 이면 `bodyAnim` 이 HIDE 대신 STAND).
- 효과 APD 미리 로드: 전투 시작 때 파티가 아는 주문과 `usableItems` 의 `use_effect` 마법의 효과 APD 를 요청한다(리뷰 M6 해소).

## 7. UI (`web/game.html`, `ui/panel.ts`)

- 명령 버튼 「아이템」: 「마법」과 같은 토글 목록 `#items`(버튼 "이름 ×개수"). 버튼은 목록 키(id·개수)가 바뀔 때만 다시 만든다(리뷰 C1 규칙).
- 소지품 절 `#inventory`: "골드 N", 소모품 줄, 파티원별 "이름: 가방 a, b, c, d".
- 로그: `pickup`("카린: 허브 획득" / "100 Gold 획득"), `bagFull`, `revealed`("보물 찾았다!"), 아이템 사용 줄은 `describeHit` 그대로.
- 시작 키트 [결정: 개발 페이지 편의]: 전투 시작 시 골드 300, 허브 ×3, 해독초 ×2, 깨어나는 약 ×1. 원작 흐름은 스크립트가 주므로, 이 키트는 `game.html` 에만 있다.

## 8. 오류 처리

- 소지품 함수는 예외를 던지지 않고 `false`/무시로 끝난다(원작과 같다).
- 잘못된 action(없는 아이템, 장비 id)은 `rejected` 이벤트.
- 가방이 가득 찬 습득은 `bagFull` 로 알리고 오브젝트를 남긴다.

## 9. 테스트

- `inventory.test.ts`: 한계(80칸, 9999, 골드 clamp), 장비는 가방으로, 가방 가득, 소모품 제거.
- `equipment.test.ts`: 종족 비트, 슬롯별 교환, 장신구 두 칸, 해제 실패.
- `shop.test.ts`: 골드 부족, 가득 참, 성공 시 골드 차감.
- `resolveItem` (`resolveMagic.test.ts` 옆 `resolveItem.test.ts`): §5.4 각 줄.
- `battle.test.ts`: 보물 습득(골드·아이템·가득·숨김 드러남), 아이템 사용 흐름(목록 → 대상 → 효과 → 소비 → acted), AI 는 습득 안 함.
- `panel.test.ts`: `menuEnabled.item`, 아이템 버튼 동일성, 소지품 절 텍스트.
- `presenter.test.ts`: 아이템 action 의 효과 APD·STAND, pickup 팝업.
- `battleCorpus.test.ts`: 기존 정책 유지(소지품 비어 있음).

## 10. 범위 밖

판매, 장비·상점 화면(하위 프로젝트 4), 세이브의 소지품 블록(하위 프로젝트 5), `get%03d` 스크립트 실행(4).

## 11. 결정 사항

1. `bag` 을 `dropItem/dropGold` 와 분리한 필드로 둔다.
2. 아이템 사용은 시전 애니 없이 효과 APD 만 쓴다 [추정 — 원작 소모품 경로 미분석].
3. 시작 키트는 개발 페이지의 편의 기능이다.
4. 장비·상점 규칙은 [추정]으로 모듈에 가두고, UI 는 하위 프로젝트 4 에서 원작 확인 후 붙인다.
