# 아이템·소지품 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전투 1판 안에서 보물 습득과 소모품 사용이 동작하고, 파티 소지품·장비·상점 규칙이 헤드리스 모델과 테스트로 고정된다.

**Architecture:** 소지품은 `BattleState.inventory`(순수 데이터)로 두고 `battle/inventory.ts` 의 순수 함수로 다룬다. 아이템 사용은 `action = 1000 + id` 로 기존 `beginTarget → act → perform → applyOutcome` 경로를 타고, 보물 습득은 플레이어 `move` 뒤에 붙는다. 표현층은 `pickup/bagFull/revealed` 이벤트와 아이템 action 의 효과 APD 를 더한다. 장비·상점 규칙은 UI 없이 모듈로만 둔다.

**Tech Stack:** TypeScript 7, Vite 8, Vitest 5 (node 환경), Canvas 2D. 테스트는 `web/test/**/*.test.ts`.

**Spec:** `docs/superpowers/specs/2026-10-16-items-inventory-design.md` (원작 근거: `analysis/battle_rules.md` §4.2–4.5)

## Global Constraints

- 소지품 한계: 80칸, 칸당 9999, 골드 0..999999, 장비 가방 4칸 (spec §4, §5.1).
- 아이템 사거리는 `item.range_min..range_max`, 대상은 **파티 유닛**(사망 포함) (spec §5.3).
- 효과 규칙은 `battle_rules.md` §4.2 를 글자 그대로 (spec §5.4). 팝업은 HP 숫자 우선.
- 주문·아이템 버튼은 목록 키가 바뀔 때만 다시 만든다 (리뷰 C1 규칙).
- 소모품 소비는 행동이 끝난 뒤 하나 (spec §5.3).
- 테스트 명령: `cd web && npm run check` (vitest + tsc). 출력은 파일로 받아 꼬리만 읽는다.

## Review Focus

1. **보물 칸에 섰는데 가방이 가득 찬 경우**: `bagFull` 이벤트, 오브젝트 유지, 유닛은 그 칸에 선다. → Task 3 테스트 `a full bag leaves the treasure where it is`.
2. **사망한 아군에게 소생약**: 대상 표시에 사망자가 포함되고 소생 후 HP > 0. → Task 3 테스트 `a revive item targets a fallen ally and brings it back`.
3. **마지막 소모품을 쓴 뒤**: 소지품에서 사라지고 `menuEnabled.item` 이 false. → Task 3 테스트 `the last of an item disappears after use`, Task 6 테스트 `item is enabled only while a usable consumable is held`.
4. **효과 APD 가 없는 아이템(use_effect 70 해독 등)**: 연출 큐가 멈추지 않는다. → Task 5 테스트 `an item without an effect APD still settles`.
5. **아이템 대상 선택 중 취소**: 메뉴로 돌아오고 소비가 없다. → Task 3 테스트 `cancelling item targeting consumes nothing`.

## File Structure

```
web/src/battle/inventory.ts     신규: Inventory, giveItem/takeItem/countOf/addGold/usableItems
web/src/battle/equipment.ts     신규: canEquip/equip/unequip [추정]
web/src/battle/shop.ts          신규: buy
web/src/battle/unit.ts          수정: Unit.bag
web/src/battle/resolve.ts       수정: resolveItem, resolveAction 아이템 분기
web/src/battle/targets.ts       수정: targetsOf 아이템 분기
web/src/battle/moveRange.ts     수정: markTargets 아이템 분기
web/src/battle/types.ts         수정: BattleState.inventory, 이벤트 pickup/bagFull/revealed
web/src/battle/battle.ts        수정: start(inventory), beginTarget/perform 아이템, pickUp
web/src/field/presenter.ts      수정: 아이템 연출, 새 이벤트, bag 복사
web/src/ui/panel.ts             수정: item 버튼·목록, 소지품 절, 로그
web/src/game/main.ts            수정: 시작 키트, 효과 APD 미리 로드
web/game.html                   수정: #item, #items, #inventory
web/test/helpers/battleFixtures.ts  수정: unit.bag, 소모품 픽스처, race_mask 기본값
web/test/{inventory,equipment,shop,resolveItem}.test.ts  신규
web/test/{battle,presenter,panel,unitSprites}.test.ts    수정
docs/manual.md, README.md       수정
```

---

### Task 1: 소지품 모델과 유닛 가방

**Files:**
- Create: `web/src/battle/inventory.ts`
- Modify: `web/src/battle/unit.ts` (Unit.bag, createUnit)
- Modify: `web/test/helpers/battleFixtures.ts` (unit() 기본 bag, 소모품 7·8·9, ITEM race_mask 기본값)
- Test: `web/test/inventory.test.ts`

**Interfaces:**
- Produces: `Inventory { items: Stack[]; gold: number }`, `Stack { id; count }`, `emptyInventory()`, `isEquipment(item)`, `countOf(inv, id)`, `giveItem(inv, unit|null, id, n, items): boolean`, `takeItem(inv, id, n, items): void`, `addGold(inv, delta)`, `usableItems(inv, items): Stack[]`, 상수 `INVENTORY_SLOTS=80 STACK_MAX=9999 GOLD_MAX=999999 BAG_SLOTS=4`; `Unit.bag: number[]`(길이 4).

- [ ] **Step 1: 픽스처 갱신**

`web/test/helpers/battleFixtures.ts`:
- `ITEM` 기본값의 `race_mask: 0` → `race_mask: 0xffff`.
- `tables().item` 배열 끝(`poison dagger` 뒤)에 추가:
```ts
      ITEM({ name: 'herb', slot: 3, hp_heal: 20, use_effect: 1, range_min: 0, range_max: 1 }),
      ITEM({ name: 'antidote', slot: 3, status_code: 2, use_effect: 1, range_min: 0, range_max: 1 }),
      ITEM({ name: 'dud', slot: 3, range_min: 0, range_max: 1 }),
```
- 주석 "item 0 none, 1 sword, …" 에 `7 herb (slot 3, heals 20), 8 antidote (cures poison), 9 dud (no use effect)` 추가.
- `unit()` 기본값에 `bag: [0, 0, 0, 0],` 추가(`dropGold: 0,` 뒤).

- [ ] **Step 2: 실패하는 테스트 작성**

`web/test/inventory.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { addGold, countOf, emptyInventory, giveItem, GOLD_MAX, INVENTORY_SLOTS, STACK_MAX, takeItem, usableItems } from '../src/battle/inventory';
import { ITEM, tables, unit } from './helpers/battleFixtures';

const items = tables().item;   // 1 sword, 5 armor (equipment); 7 herb, 8 antidote (usable); 9 dud (no use effect)

describe('inventory (FUN_0041ecc0 / FUN_0041eda0 / FUN_0041f310 / FUN_0041ec90)', () => {
  it('stacks consumables, caps a stack at 9999 and the table at 80 kinds', () => {
    const inv = emptyInventory();
    expect(giveItem(inv, null, 7, 3, items)).toBe(true);
    expect(giveItem(inv, null, 7, 2, items)).toBe(true);
    expect(countOf(inv, 7)).toBe(5);
    expect(giveItem(inv, null, 7, STACK_MAX, items)).toBe(false);
    expect(countOf(inv, 7)).toBe(5);
    const many = Array.from({ length: INVENTORY_SLOTS + 2 }, (_, i) => ITEM({ name: `c${i}`, slot: 3 }));
    const big = emptyInventory();
    for (let id = 1; id <= INVENTORY_SLOTS; id++) expect(giveItem(big, null, id, 1, many)).toBe(true);
    expect(giveItem(big, null, INVENTORY_SLOTS + 1, 1, many)).toBe(false);
    expect(giveItem(big, null, 0, 1, many)).toBe(false);          // id 0 is "none"
    expect(big.items).toHaveLength(INVENTORY_SLOTS);
  });
  it("equipment goes into the unit's 4-slot bag and needs a unit", () => {
    const inv = emptyInventory();
    const u = unit({ slot: 0 });
    expect(giveItem(inv, null, 1, 1, items)).toBe(false);
    for (let i = 0; i < 4; i++) expect(giveItem(inv, u, 1, 1, items)).toBe(true);
    expect(u.bag).toEqual([1, 1, 1, 1]);
    expect(giveItem(inv, u, 5, 1, items)).toBe(false);
    expect(inv.items).toEqual([]);
  });
  it('takeItem removes consumables only and drops an empty stack; gold is clamped to 0..999999', () => {
    const inv = emptyInventory();
    giveItem(inv, null, 7, 2, items); giveItem(inv, null, 8, 1, items);
    takeItem(inv, 7, 1, items); takeItem(inv, 8, 5, items); takeItem(inv, 1, 1, items);
    expect(inv.items).toEqual([{ id: 7, count: 1 }]);
    addGold(inv, 500); addGold(inv, -900);
    expect(inv.gold).toBe(0);
    addGold(inv, GOLD_MAX + 5);
    expect(inv.gold).toBe(GOLD_MAX);
  });
  it('usableItems lists held consumables that have a use effect', () => {
    const inv = emptyInventory();
    giveItem(inv, null, 7, 1, items); giveItem(inv, null, 9, 1, items);
    expect(usableItems(inv, items)).toEqual([{ id: 7, count: 1 }]);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd web && npx vitest run test/inventory.test.ts`
Expected: FAIL — `Failed to resolve import "../src/battle/inventory"`.

- [ ] **Step 4: 구현**

`web/src/battle/inventory.ts`:
```ts
import type { ItemData } from '../data/types';
import type { Unit } from './unit';

export interface Stack { id: number; count: number }
/** The party's shared consumables and gold (battle_rules.md §4.3). */
export interface Inventory { items: Stack[]; gold: number }

export const INVENTORY_SLOTS = 80;
export const STACK_MAX = 9999;
export const GOLD_MAX = 999999;
export const BAG_SLOTS = 4;

export const emptyInventory = (): Inventory => ({ items: [], gold: 0 });
export const isEquipment = (item: ItemData): boolean => item.slot === 0 || item.slot === 1 || item.slot === 2;

/** FUN_0041f310 */
export function countOf(inv: Inventory, id: number): number {
  return inv.items.find((s) => s.id === id)?.count ?? 0;
}

/** FUN_0041ecc0: equipment goes into the unit's 4-slot bag; consumables stack in the shared table. */
export function giveItem(inv: Inventory, unit: Unit | null, id: number, n: number, items: ItemData[]): boolean {
  const item = items[id];
  if (!item || id === 0) return false;
  if (isEquipment(item)) {
    if (!unit) return false;
    const free = unit.bag.indexOf(0);
    if (free < 0) return false;
    unit.bag[free] = id;
    return true;
  }
  const stack = inv.items.find((s) => s.id === id);
  if (!stack && inv.items.length >= INVENTORY_SLOTS) return false;
  if ((stack?.count ?? 0) + n > STACK_MAX) return false;
  if (stack) stack.count += n;
  else inv.items.push({ id, count: n });
  return true;
}

/** FUN_0041eda0: consumables only; a stack at zero disappears. */
export function takeItem(inv: Inventory, id: number, n: number, items: ItemData[]): void {
  const item = items[id];
  if (!item || isEquipment(item)) return;
  const i = inv.items.findIndex((s) => s.id === id);
  if (i < 0) return;
  const stack = inv.items[i]!;
  if (stack.count + n >= 10000) return;
  stack.count -= n;
  if (stack.count < 1) inv.items.splice(i, 1);
}

/** FUN_0041ec90 */
export function addGold(inv: Inventory, delta: number): void {
  inv.gold = Math.min(Math.max(inv.gold + delta, 0), GOLD_MAX);
}

/** Battle-menu rule (FUN_00430c80): held consumables that have a use effect. */
export function usableItems(inv: Inventory, items: ItemData[]): Stack[] {
  return inv.items.filter((s) => { const it = items[s.id]; return s.count > 0 && it !== undefined && it.slot === 3 && it.use_effect !== 0; });
}
```

`web/src/battle/unit.ts`:
- `Unit` 에 `dropItem: number; dropGold: number;` 다음 줄로 `bag: number[];                       // 4 equipment slots of a party unit (words 0xe..0x11; battle_rules.md §4.3)` 추가.
- `createUnit` 의 객체 리터럴에서 `dropItem: rec.drop_item, dropGold: rec.drop_gold,` 뒤에 `bag: [0, 0, 0, 0],` 추가.

- [ ] **Step 5: 통과 확인**

Run: `cd web && npx vitest run test/inventory.test.ts && npx tsc --noEmit -p .`
Expected: PASS 4/4, tsc 오류 0. (`presenter.ts` 의 `clone` 은 `...u` 로 `bag` 참조를 공유하므로 컴파일은 되지만 Task 5 에서 복사로 바꾼다.)

- [ ] **Step 6: 커밋**

```bash
git add web/src/battle/inventory.ts web/src/battle/unit.ts web/test/helpers/battleFixtures.ts web/test/inventory.test.ts
git commit -m "feat(web): party inventory model (80 stacks, bag of 4, gold clamp) per battle_rules §4.3"
```

---

### Task 2: 아이템 효과와 대상

**Files:**
- Modify: `web/src/battle/resolve.ts` (resolveItem, resolveAction 분기)
- Modify: `web/src/battle/targets.ts` (targetsOf 분기)
- Test: `web/test/resolveItem.test.ts`

**Interfaces:**
- Consumes: `hit()` 헬퍼, `ResolveContext`, `ITEM` 픽스처.
- Produces: `resolveItem(t: Unit, id: number, ctx: ResolveContext): Hit`; `resolveAction(actor, action ≥ 1000, …)` → 대상마다 `resolveItem(t, action − 1000)`; `targetsOf(…, action ≥ 1000, cell)` → 그 칸의 유닛 하나.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/resolveItem.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { resolveAction, resolveItem, type ResolveContext } from '../src/battle/resolve';
import { targetsOf } from '../src/battle/targets';
import type { ItemData } from '../src/data/types';
import { fixedRng, flatMap, ITEM, tables, unit, units } from './helpers/battleFixtures';

/** Real item ids the rules key on (battle_rules.md §4.2), in an otherwise empty table. */
function realItems(): ItemData[] {
  const arr = Array.from({ length: 170 }, () => ITEM({ name: 'none', range_min: 0, range_max: 0 }));
  const set = (i: number, o: Partial<ItemData>) => { arr[i] = ITEM({ slot: 3, range_min: 0, range_max: 1, ...o }); };
  set(1, { name: '허브', hp_heal: 20, use_effect: 67 });
  set(2, { name: '해독초', status_code: 2, use_effect: 70 });
  set(6, { name: '치유약', hp_heal: 10, use_effect: 68 });
  set(7, { name: '깨어나는_약', hp_heal: 20, status_code: 1, use_effect: 69 });
  set(9, { name: '브랜디', hp_heal: 999, mp_heal: 80, status_code: 1, use_effect: 69 });
  set(155, { name: '머시룸', hp_heal: 999, use_effect: 67 });
  set(163, { name: '에리쿠사', hp_heal: 999, mp_heal: 999, status_code: 1, use_effect: 67 });
  return arr;
}
const t = tables({ item: realItems() });
const ctx = (...us: ReturnType<typeof unit>[]): ResolveContext => ({ tables: t, grid: new BattleGrid(flatMap(5)), units: units(...us), rng: fixedRng([0]), dash: false });

describe('resolveItem (battle_rules.md §4.2)', () => {
  it('heals HP up to the maximum and reports the healed amount; a dead target is a miss unless the item revives', () => {
    const a = unit({ slot: 0, hp: 20, hpMax: 30 });
    expect(resolveItem(a, 1, ctx(a))).toMatchObject({ kind: 'heal', value: 10, popup: '10' });
    expect(a.hp).toBe(30);
    const dead = unit({ slot: 1, hp: 0, status: 1 });
    expect(resolveItem(dead, 1, ctx(dead))).toMatchObject({ kind: 'miss', popup: 'miss!' });
    expect(dead.hp).toBe(0);
  });
  it('a cure item removes exactly its status ("well"); otherwise it misses', () => {
    const poisoned = unit({ slot: 0, status: 2 });
    expect(resolveItem(poisoned, 2, ctx(poisoned))).toMatchObject({ kind: 'cure', popup: 'well', statusAfter: 0 });
    const fine = unit({ slot: 0 });
    expect(resolveItem(fine, 2, ctx(fine))).toMatchObject({ kind: 'miss' });
  });
  it('치유약 heals a wounded unit and cures any status of a healthy one', () => {
    const wounded = unit({ slot: 0, hp: 5 });
    expect(resolveItem(wounded, 6, ctx(wounded))).toMatchObject({ kind: 'heal', value: 10, popup: '10' });
    const asleep = unit({ slot: 0, status: 3 });
    expect(resolveItem(asleep, 6, ctx(asleep))).toMatchObject({ kind: 'cure', popup: 'well' });
    expect(asleep.status).toBe(0);
    const fine = unit({ slot: 0 });
    expect(resolveItem(fine, 6, ctx(fine))).toMatchObject({ kind: 'miss' });
  });
  it('깨어나는 약 revives the dead with its HP heal; 브랜디 also thaws', () => {
    const dead = unit({ slot: 0, hp: 0, status: 1 });
    expect(resolveItem(dead, 7, ctx(dead))).toMatchObject({ kind: 'heal', value: 20, statusAfter: 0 });
    expect(dead).toMatchObject({ hp: 20, status: 0 });
    const frozen = unit({ slot: 0, status: 5, mp: 0, hp: 30 });
    expect(resolveItem(frozen, 9, ctx(frozen))).toMatchObject({ kind: 'heal', value: 20, popup: '20' });   // MP 20 healed (hp full)
    expect(frozen).toMatchObject({ status: 0, mp: 20 });
  });
  it('머시룸 raises HP max by 5 (cap 999); 에리쿠사 revives and fills HP/MP', () => {
    const u = unit({ slot: 0, hpMax: 996, hp: 996 });
    expect(resolveItem(u, 155, ctx(u))).toMatchObject({ kind: 'buff', value: 5, popup: 'hp_up!' });
    expect(u.hpMax).toBe(999);
    const dead = unit({ slot: 0, hp: 0, mp: 0, status: 1 });
    expect(resolveItem(dead, 163, ctx(dead))).toMatchObject({ kind: 'heal', value: 30, statusAfter: 0 });
    expect(dead).toMatchObject({ hp: 30, mp: 20, status: 0 });
  });
  it('resolveAction routes actions ≥ 1000 to the item rules and targetsOf picks the unit on the cell', () => {
    const a = unit({ slot: 0, c: 2, r: 2, hp: 1 }), b = unit({ slot: 1, c: 3, r: 2, hp: 1 });
    const c = ctx(a, b);
    expect(targetsOf(c.grid, c.units, a, 1001, [3, 2], t)).toEqual([b]);
    expect(targetsOf(c.grid, c.units, a, 1001, [4, 4], t)).toEqual([]);
    expect(resolveAction(a, 1001, [b], c)).toEqual([expect.objectContaining({ target: 1, kind: 'heal', value: 20 })]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/resolveItem.test.ts`
Expected: FAIL — `resolveItem` is not exported / `targetsOf` throws reading `tables.magic[1001]`.

- [ ] **Step 3: 구현**

`web/src/battle/resolve.ts` — `resolveAction` 바로 위에 추가:
```ts
const STAT_UP: Record<number, ['hpMax' | 'mpMax' | 'str' | 'def' | 'wis' | 'mgr', string]> = {
  155: ['hpMax', 'hp_up!'], 156: ['mpMax', 'mp_up!'], 157: ['str', 'str_up!'], 158: ['def', 'def_up!'], 159: ['wis', 'wis_up!'], 160: ['mgr', 'mgr_up!'],
};

/** battle_rules.md §4.2: one consumable (`id` = action − 1000) on one unit. HP/MP first, then the status rule; the popup prefers the HP number. */
export function resolveItem(t: Unit, id: number, ctx: ResolveContext): Hit {
  const item = ctx.tables.item[id]!;
  if ((t.status === 1 || t.side === 7) && item.status_code !== 1) return hit(t, 'miss', 0, 'miss!');
  const heal = Math.max(Math.min(item.hp_heal, t.hpMax - t.hp), 0), mp = Math.max(Math.min(item.mp_heal, t.mpMax - t.mp), 0);
  t.hp += heal; t.mp += mp;
  const value = heal > 0 ? heal : mp;
  const popup = value > 0 ? String(value) : '';
  const miss = () => (value > 0 ? hit(t, 'heal', value, popup) : hit(t, 'miss', 0, 'miss!'));
  const up = STAT_UP[id];
  if (up) { t[up[0]] = Math.min(t[up[0]] + 5, 999); return hit(t, 'buff', 5, up[1]); }
  const before = t.status;
  if (id === 6) { if (t.status === 0) return miss(); t.status = 0; }
  else if (id === 7) { if (t.status === 1 || t.status === 3) t.status = 0; }
  else if (id === 8 || id === 9) { if (t.status === 1 || t.status === 5) t.status = 0; }
  else if (id === 163) t.status = 0;
  else if (item.status_code !== 0) { if (t.status !== item.status_code) return miss(); t.status = 0; }
  if (t.status === before) return value > 0 ? hit(t, 'heal', value, popup) : hit(t, 'none', 0, '');
  return value > 0 ? hit(t, 'heal', value, popup) : hit(t, 'cure', 0, 'well');
}
```
`resolveAction` 첫 줄 뒤에 추가:
```ts
  if (action >= 1000) return targets.map((t) => resolveItem(t, action - 1000, ctx));
```

`web/src/battle/targets.ts` — `targetsOf` 의 `const hA = …` 다음 줄에 추가:
```ts
  if (action >= 1000) { const u = unitAt(units, cell[0], cell[1]); return u ? [u] : []; }
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/resolveItem.test.ts test/resolveMagic.test.ts test/targets.test.ts`
Expected: PASS (새 6개 + 기존 전부).

- [ ] **Step 5: 커밋**

```bash
git add web/src/battle/resolve.ts web/src/battle/targets.ts web/test/resolveItem.test.ts
git commit -m "feat(web): consumable effects (battle_rules §4.2) and item targets"
```

---

### Task 3: 전투 규칙 — 소지품 상태, 아이템 사용, 보물 습득

**Files:**
- Modify: `web/src/battle/types.ts`, `web/src/battle/moveRange.ts`, `web/src/battle/battle.ts`
- Test: `web/test/battle.test.ts` (추가), `web/test/moveRange.test.ts` (추가)

**Interfaces:**
- Consumes: Task 1 `Inventory`/함수, Task 2 `targetsOf`/`resolveAction`.
- Produces: `BattleState.inventory: Inventory`; `Battle.start(entry, map, roster1, roster, tables, seed, inventory = emptyInventory())`; 이벤트 `{ type: 'pickup'; slot; item; gold }`, `{ type: 'bagFull'; slot; item }`, `{ type: 'revealed'; slot }`; `markTargets(…, action ≥ 1000)` 가 파티 유닛을 kind 2 로 표시; `beginTarget({ action: 1000 + id })`.

- [ ] **Step 1: 실패하는 테스트 작성 — markTargets**

`web/test/moveRange.test.ts` 의 `describe('markTargets: map-wide spells', …)` 뒤에 추가:
```ts
describe('markTargets: items', () => {
  it('an item marks party units within its range (self included, the fallen too) as kind 2', () => {
    const grid = new BattleGrid(flatMap(7));
    const u = unit({ slot: 0, c: 3, r: 3 });
    const ally = unit({ slot: 1, c: 4, r: 3, status: 1, hp: 0 }), far = unit({ slot: 2, c: 5, r: 3 }), foe = unit({ slot: 10, c: 3, r: 4, side: 4 });
    const t = new RangeTable(3, 3);
    expect(markTargets(t, grid, units(u, ally, far, foe), u, 1007, tables())).toBe(2);
    expect(t.kindAt(3, 3)).toBe(2);
    expect(t.kindAt(4, 3)).toBe(2);
    expect(t.kindAt(5, 3)).toBe(0);
    expect(t.kindAt(3, 4)).toBe(0);
  });
});
```

- [ ] **Step 2: 실패하는 테스트 작성 — battle**

`web/test/battle.test.ts` 의 `describe('party rules (spec §11)', …)` 앞에 추가 (파일 상단 import 에 `import { countOf, emptyInventory, giveItem } from '../src/battle/inventory';` 추가):
```ts
describe('treasure pickup (battle_rules §4.4)', () => {
  const chest = (over: Partial<RosterUnit>) => rec({ unit_id: 8, race: 9, side: 7, level: 1, c: 3, r: 4, ...over });
  const moveHero = (b: Battle, c: number, r: number) => { b.reduce({ type: 'select', slot: 0 }); b.reduce({ type: 'beginMove' }); return b.reduce({ type: 'move', c, r }); };
  it('standing on a gold chest adds the gold and removes the chest', () => {
    const b = start(1, flatMap(9), [...roster, chest({ drop_gold: 50 })]);
    const ev = moveHero(b, 3, 4);
    expect(types(ev)).toEqual(['moved', 'pickup', 'removed']);
    expect(ev[1]).toEqual({ type: 'pickup', slot: 0, item: 0, gold: 50 });
    expect(b.state.inventory.gold).toBe(50);
    expect(b.state.units[12]).toBeNull();
  });
  it('an item chest goes to the party inventory, equipment into the bag of the unit that stepped on it', () => {
    const b = start(1, flatMap(9), [...roster, chest({ drop_item: 7 }), chest({ drop_item: 1, c: 2, r: 3 })]);
    moveHero(b, 3, 4);
    expect(countOf(b.state.inventory, 7)).toBe(1);
    const b2 = start(1, flatMap(9), [...roster, chest({ drop_item: 1 })]);
    moveHero(b2, 3, 4);
    expect(b2.state.units[0]!.bag).toEqual([1, 0, 0, 0]);
  });
  it('a full bag leaves the treasure where it is', () => {
    const b = start(1, flatMap(9), [...roster, chest({ drop_item: 1 })]);
    b.state.units[0]!.bag = [1, 1, 1, 1];
    const ev = moveHero(b, 3, 4);
    expect(types(ev)).toEqual(['moved', 'bagFull']);
    expect(b.state.units[12]).toMatchObject({ side: 7, c: 3, r: 4 });
    expect(b.state.units[0]).toMatchObject({ c: 3, r: 4 });
  });
  it('a hidden chest next to the destination is revealed', () => {
    const b = start(1, flatMap(9), [...roster, chest({ drop_gold: 5, c: 4, r: 4, status: 9 })]);
    const ev = moveHero(b, 3, 4);
    expect(types(ev)).toEqual(['moved', 'revealed']);
    expect(b.state.units[12]!.status).toBe(0);
  });
});

describe('items in battle (spec §5.3)', () => {
  const withHerbs = (n = 2) => { const inv = emptyInventory(); giveItem(inv, null, 7, n, t.item); giveItem(inv, null, 9, 1, t.item); return Battle.start(entry, flatMap(9), roster1, roster, t, 1, inv); };
  it('uses a held consumable on itself: target cell, effect, one consumed, acted', () => {
    const b = withHerbs();
    const hero = b.state.units[0]!; hero.hp = 1;
    b.reduce({ type: 'select', slot: 0 });
    expect(b.reduce({ type: 'beginTarget', action: 1007 })).toEqual([]);
    const sel = b.state.phase.kind === 'player' ? b.state.phase.sel : null;
    expect(sel && sel.mode === 'target' ? sel.range.kindAt(hero.c, hero.r) : 0).toBe(2);
    const ev = b.reduce({ type: 'act', c: hero.c, r: hero.r });
    expect(ev[0]).toMatchObject({ type: 'action', action: 1007, hits: [expect.objectContaining({ target: 0, kind: 'heal', value: 20 })] });
    expect(hero).toMatchObject({ hp: 21, acted: true, moved: false });
    expect(countOf(b.state.inventory, 7)).toBe(1);
  });
  it('rejects items the party does not hold or cannot use', () => {
    const b = withHerbs();
    b.reduce({ type: 'select', slot: 0 });
    expect(b.reduce({ type: 'beginTarget', action: 1008 })).toEqual([{ type: 'rejected', reason: 'no such item' }]);
    expect(b.reduce({ type: 'beginTarget', action: 1009 })).toEqual([{ type: 'rejected', reason: 'no such item' }]);
  });
  it('a revive item targets a fallen ally and brings it back', () => {
    const inv = emptyInventory(); giveItem(inv, null, 7, 1, t.item);
    const items = t.item.map((it, i) => (i === 7 ? { ...it, status_code: 1 } : it));             // make the herb a revive item for this test
    const b = Battle.start(entry, flatMap(9), roster1, roster, { ...t, item: items }, 1, inv);
    const ally = b.state.units[1]!; ally.hp = 0; ally.status = 1;
    b.reduce({ type: 'select', slot: 0 });
    b.reduce({ type: 'beginTarget', action: 1007 });
    const sel = b.state.phase.kind === 'player' ? b.state.phase.sel : null;
    expect(sel && sel.mode === 'target' ? sel.range.kindAt(ally.c, ally.r) : 0).toBe(2);
    b.reduce({ type: 'act', c: ally.c, r: ally.r });
    expect(ally).toMatchObject({ status: 0, hp: 20 });
  });
  it('the last of an item disappears after use', () => {
    const b = withHerbs(1);
    const hero = b.state.units[0]!; hero.hp = 1;
    b.reduce({ type: 'select', slot: 0 }); b.reduce({ type: 'beginTarget', action: 1007 }); b.reduce({ type: 'act', c: hero.c, r: hero.r });
    expect(b.state.inventory.items.find((s) => s.id === 7)).toBeUndefined();
  });
  it('cancelling item targeting consumes nothing', () => {
    const b = withHerbs();
    b.reduce({ type: 'select', slot: 0 }); b.reduce({ type: 'beginTarget', action: 1007 }); b.reduce({ type: 'cancel' });
    expect(b.state.phase.kind === 'player' && b.state.phase.sel.mode).toBe('menu');
    expect(countOf(b.state.inventory, 7)).toBe(2);
  });
  it('a battle started without an inventory has an empty one', () => {
    expect(start().state.inventory).toEqual({ items: [], gold: 0 });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd web && npx vitest run test/moveRange.test.ts test/battle.test.ts`
Expected: FAIL — markTargets 가 `tables.magic[1007]` 에서 던지거나 0 반환; battle 테스트는 `inventory` undefined / `Battle.start` 가 7번째 인자를 무시.

- [ ] **Step 4: 구현 — types, moveRange**

`web/src/battle/types.ts`:
- import 추가: `import type { Inventory } from './inventory';`
- `BattleState` 에 `inventory: Inventory;      // party consumables and gold (battle_rules.md §4.3)` 추가(`lastPath` 다음).
- `BattleEvent` 에 추가:
```ts
  | { type: 'pickup'; slot: number; item: number; gold: number } | { type: 'bagFull'; slot: number; item: number } | { type: 'revealed'; slot: number }
```

`web/src/battle/moveRange.ts` — `markTargets` 의 `let n = 0;` 다음에 추가:
```ts
  if (action >= 1000) {                                   // consumable: party units within item range (the fallen too; revive items need them)
    const item = tables.item[action - 1000]!;
    for (const v of units) {
      if (!v || v.side !== 0 || v.status === 9) continue;
      const d = dist(unit.c, unit.r, v.c, v.r);
      if (d >= item.range_min && d <= item.range_max && t.index(v.c, v.r) >= 0) { t.setKind(v.c, v.r, 2); n++; }
    }
    return n;
  }
```

- [ ] **Step 5: 구현 — battle.ts**

- import 추가: `import { addGold, emptyInventory, giveItem, takeItem, usableItems, type Inventory } from './inventory';`
- `static start(entry, map, roster1, roster, tables, seed)` → `static start(entry: BattleEntry, map: MapData, roster1: RosterUnit[], roster: RosterUnit[], tables: Tables, seed: number, inventory: Inventory = emptyInventory()): Battle`, 마지막 `new Battle({ …, lastPath: [] }, tables)` → `new Battle({ …, lastPath: [], inventory }, tables)`.
- `move()`: `this.state.lastPath = path;` 다음 줄에 `const events: BattleEvent[] = [{ type: 'moved', slot: u.slot, path, to: [c, r] }];` 와 `if (u.side === 0) events.push(...this.pickUp(u));` 를 두고, `return [{ type: 'moved', … }]` 를 `return events;` 로 바꾼다 (`setSel` 호출은 pickUp 뒤에 둔다 — 범위 표가 사라진 오브젝트를 반영하도록).
- `beginTarget()`: `if (action !== 0) { … }` 블록을 다음으로 바꾼다:
```ts
    if (action >= 1000) {
      if (!usableItems(this.state.inventory, this.tables.item).some((s) => s.id === action - 1000)) return reject('no such item');
    } else if (action !== 0) {
      if (!u.spells.includes(action) || !this.tables.magic[action]) return reject('unknown spell');
      if (u.mp < Math.abs(this.tables.magic[action]!.mp_cost)) return reject('not enough MP');
      if (u.status === 6) return reject('silenced');
    }
```
- `perform()`: `if (action !== 0) u.mp -= …` → `if (action !== 0 && action < 1000) u.mp -= …`; `events.push(...applyOutcome(…));` 다음에 `if (action >= 1000) takeItem(this.state.inventory, action - 1000, 1, this.tables.item);` 추가.
- `pickUp` 메서드 추가(`move` 다음):
```ts
  /** FUN_00431170 after a party move: stand on a treasure to take it; stand next to a hidden one to reveal it. */
  private pickUp(u: Unit): BattleEvent[] {
    const events: BattleEvent[] = [];
    for (const o of liveUnits(this.state.units)) {
      if (o.side !== 7) continue;
      const d = dist(u.c, u.r, o.c, o.r);
      if (d === 0) {
        if (o.dropItem === 0) { addGold(this.state.inventory, o.dropGold); events.push({ type: 'pickup', slot: u.slot, item: 0, gold: o.dropGold }); }
        else if (giveItem(this.state.inventory, u, o.dropItem, 1, this.tables.item)) events.push({ type: 'pickup', slot: u.slot, item: o.dropItem, gold: 0 });
        else { events.push({ type: 'bagFull', slot: u.slot, item: o.dropItem }); continue; }
        this.state.units[o.slot] = null;
        events.push({ type: 'removed', slot: o.slot });
      } else if (d === 1 && o.status === 9) {
        o.status = 0;
        events.push({ type: 'revealed', slot: o.slot });
      }
    }
    return events;
  }
```

- [ ] **Step 6: 통과 확인**

Run: `cd web && npm run check`
Expected: 전부 PASS, tsc 0. (`battleCorpus.test.ts` 는 소지품 없이 시작하므로 그대로 통과한다.)

- [ ] **Step 7: 커밋**

```bash
git add web/src/battle/types.ts web/src/battle/moveRange.ts web/src/battle/battle.ts web/test/battle.test.ts web/test/moveRange.test.ts
git commit -m "feat(web): inventory in battle state, consumable use (action ≥ 1000), treasure pickup and reveal"
```

---

### Task 4: 장비·상점 규칙 [추정]

**Files:**
- Create: `web/src/battle/equipment.ts`, `web/src/battle/shop.ts`
- Test: `web/test/equipment.test.ts`, `web/test/shop.test.ts`

**Interfaces:**
- Produces: `canEquip(unit, id, items): boolean`, `equip(unit, bagIndex, items): boolean`, `unequip(unit, where: 'weapon' | 'armor' | 0 | 1): boolean`; `buy(inv, unit | null, id, items): 'ok' | 'no gold' | 'full' | 'unknown item'`.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/equipment.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { canEquip, equip, unequip } from '../src/battle/equipment';
import { ITEM, tables, unit } from './helpers/battleFixtures';

const items = [...tables().item, ITEM({ name: 'elf bow', weapon_type: 3, race_mask: 1 << 2 }), ITEM({ name: 'ring', slot: 2 })];   // 10 elf bow (race 2 only), 11 ring

describe('equipment [assumed from item.dat fields]', () => {
  it('canEquip needs an equipment slot and the race bit; item 0 always fits; consumables never do', () => {
    expect(canEquip(unit({ slot: 0, race: 0 }), 1, items)).toBe(true);
    expect(canEquip(unit({ slot: 0, race: 0 }), 10, items)).toBe(false);
    expect(canEquip(unit({ slot: 0, race: 2 }), 10, items)).toBe(true);
    expect(canEquip(unit({ slot: 0 }), 0, items)).toBe(true);
    expect(canEquip(unit({ slot: 0 }), 7, items)).toBe(false);
  });
  it('equip swaps the bag item with the equipped one; accessories fill the first empty of two slots', () => {
    const u = unit({ slot: 0, weapon: 1, bag: [3, 11, 11, 0] });
    expect(equip(u, 0, items)).toBe(true);
    expect(u).toMatchObject({ weapon: 3, bag: [1, 11, 11, 0] });
    expect(equip(u, 1, items)).toBe(true);
    expect(equip(u, 2, items)).toBe(true);
    expect(u.acc).toEqual([11, 11]);
    expect(u.bag).toEqual([1, 0, 0, 0]);
    expect(equip(u, 3, items)).toBe(false);                                         // empty bag slot
    expect(equip(unit({ slot: 0, race: 0, bag: [10, 0, 0, 0] }), 0, items)).toBe(false);   // wrong race
  });
  it('unequip moves equipment into an empty bag slot and fails when the bag is full or the slot is empty', () => {
    const u = unit({ slot: 0, weapon: 1, armor: 5, acc: [11, 0], bag: [0, 0, 0, 0] });
    expect(unequip(u, 'weapon')).toBe(true);
    expect(unequip(u, 0)).toBe(true);
    expect(u).toMatchObject({ weapon: 0, acc: [0, 0], bag: [1, 11, 0, 0] });
    expect(unequip(u, 1)).toBe(false);
    u.bag = [1, 1, 1, 1];
    expect(unequip(u, 'armor')).toBe(false);
    expect(u.armor).toBe(5);
  });
});
```

`web/test/shop.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { emptyInventory, giveItem } from '../src/battle/inventory';
import { buy } from '../src/battle/shop';
import { ITEM, tables, unit } from './helpers/battleFixtures';

const items = tables().item.map((it, i) => (i === 7 ? { ...it, price: 30 } : i === 1 ? { ...it, price: 100 } : it));

describe('shop purchase (price from item.dat; payment order assumed)', () => {
  it('charges the price and hands the item over; refuses without gold or room', () => {
    const inv = emptyInventory(); inv.gold = 120;
    const u = unit({ slot: 0 });
    expect(buy(inv, u, 7, items)).toBe('ok');
    expect(buy(inv, u, 1, items)).toBe('no gold');
    inv.gold = 100; u.bag = [1, 1, 1, 1];
    expect(buy(inv, u, 1, items)).toBe('full');
    expect(inv.gold).toBe(100);
    u.bag = [0, 0, 0, 0];
    expect(buy(inv, u, 1, items)).toBe('ok');
    expect(inv).toMatchObject({ gold: 0, items: [{ id: 7, count: 1 }] });
    expect(u.bag[0]).toBe(1);
    expect(buy(inv, u, 999, items)).toBe('unknown item');
    giveItem(inv, null, 7, 1, items);
    expect(buy(inv, null, 7, items)).toBe('no gold');
  });
  it('an unused export of ITEM keeps the fixture import honest', () => { expect(ITEM().slot).toBe(0); });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/equipment.test.ts test/shop.test.ts`
Expected: FAIL — 두 모듈을 찾지 못한다.

- [ ] **Step 3: 구현**

`web/src/battle/equipment.ts`:
```ts
import type { ItemData } from '../data/types';
import { isEquipment } from './inventory';
import type { Unit } from './unit';

export type EquipSlot = 'weapon' | 'armor' | 0 | 1;   // 0/1 = accessory index

/** [assumed from data] slot 0/1/2 items whose race_mask carries the unit's race bit; item 0 (none) always fits. */
export function canEquip(unit: Unit, id: number, items: ItemData[]): boolean {
  const item = items[id];
  if (!item || !isEquipment(item)) return false;
  return id === 0 || ((item.race_mask >> unit.race) & 1) === 1;
}

/** Equip the bag item at `bagIndex`; the displaced equipment takes its bag slot. */
export function equip(unit: Unit, bagIndex: number, items: ItemData[]): boolean {
  const id = unit.bag[bagIndex];
  if (id === undefined || id === 0 || !canEquip(unit, id, items)) return false;
  const slot = items[id]!.slot;
  let displaced: number;
  if (slot === 0) { displaced = unit.weapon; unit.weapon = id; }
  else if (slot === 1) { displaced = unit.armor; unit.armor = id; }
  else { const i = unit.acc[0] === 0 ? 0 : unit.acc[1] === 0 ? 1 : 0; displaced = unit.acc[i]; unit.acc[i] = id; }
  unit.bag[bagIndex] = displaced;
  return true;
}

/** Move a piece of equipment back into an empty bag slot. */
export function unequip(unit: Unit, where: EquipSlot): boolean {
  const current = where === 'weapon' ? unit.weapon : where === 'armor' ? unit.armor : unit.acc[where];
  if (current === 0) return false;
  const free = unit.bag.indexOf(0);
  if (free < 0) return false;
  unit.bag[free] = current;
  if (where === 'weapon') unit.weapon = 0;
  else if (where === 'armor') unit.armor = 0;
  else unit.acc[where] = 0;
  return true;
}
```

`web/src/battle/shop.ts`:
```ts
import type { ItemData } from '../data/types';
import { addGold, giveItem, type Inventory } from './inventory';
import type { Unit } from './unit';

export type BuyResult = 'ok' | 'no gold' | 'full' | 'unknown item';

/** Shop purchase: the price field of item.dat (+0x14); the item is handed over like GIVE_ITEM. Payment after the hand-over is assumed. */
export function buy(inv: Inventory, unit: Unit | null, id: number, items: ItemData[]): BuyResult {
  const item = items[id];
  if (!item || id === 0) return 'unknown item';
  if (inv.gold < item.price) return 'no gold';
  if (!giveItem(inv, unit, id, 1, items)) return 'full';
  addGold(inv, -item.price);
  return 'ok';
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/equipment.test.ts test/shop.test.ts`
Expected: PASS 5/5.

- [ ] **Step 5: 커밋**

```bash
git add web/src/battle/equipment.ts web/src/battle/shop.ts web/test/equipment.test.ts web/test/shop.test.ts
git commit -m "feat(web): equipment and shop purchase rules (assumed from item.dat fields)"
```

---

### Task 5: 표현 — 아이템 연출, 보물 이벤트, 효과 APD 미리 로드

**Files:**
- Modify: `web/src/field/presenter.ts`, `web/src/game/main.ts`
- Test: `web/test/presenter.test.ts` (추가)

**Interfaces:**
- Consumes: Task 3 이벤트, `usableItems`.
- Produces: 아이템 action 은 시전 애니 없이 `use_effect` 마법의 효과 APD 를 대상 칸에 1회; `pickup`/`bagFull` 텍스트 팝업; `revealed` 는 스냅샷 status 0; `clone` 이 `bag` 을 복사; `main.ts` 가 파티 주문·사용 가능 아이템의 효과 APD 를 전투 시작 때 요청.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/presenter.test.ts`:
- `files` 맵에 `char_09a: chest` 를 추가하고 그 위에 `const chest = apd({ 'F.STAND': 'P0', 'F.HIDE': 'P0', 'B.STAND': 'P0', 'B.HIDE': 'P0' });`, 효과 `const healing = apd({ 'HEAL': 'S100 P0 P0' });` 를 추가해 `files.healing = healing` 으로 등록한다 (`provider` 는 그대로).
- `tables()` 대신 아이템 연출용 테이블: `const itemTables = tables(); itemTables.item[7] = { ...itemTables.item[7]!, use_effect: 1 }; itemTables.item[8] = { ...itemTables.item[8]!, use_effect: 2 }; itemTables.magic[1] = { ...itemTables.magic[1]!, effect: 'HEALING' }; itemTables.magic[2] = { ...itemTables.magic[2]!, effect: '0' };` 를 `state()` 아래에 둔다.
- `describe('Presenter', …)` 안에 추가:
```ts
  it('an item action plays no cast anim: the effect APD of its use_effect magic appears on the target and the body keeps standing', () => {
    const s = state();
    const p = new Presenter(provider, itemTables);
    p.sync(s);
    p.enqueue([{ type: 'action', slot: 0, action: 1007, cell: [2, 4], hits: [{ target: 0, kind: 'heal', value: 20, crit: false, popup: '20', statusAfter: 0 }] }]);
    p.update(0); p.update(50);
    const sprites = p.scene(mapModel(s), s).sprites;
    expect(sprites.find((sp) => sp.model === healing)).toMatchObject({ c: 2, r: 4, layer: 5 });
    expect(sprites.find((sp) => sp.layer === 4 && sp.c === 2)!.player.timeline.name).toBe('F.STAND');
    let now = 50;
    while (p.busy && now < 10_000) { p.update(now); now += 50; }
    expect(p.busy).toBe(false);
  });
  it('an item without an effect APD still settles', () => {
    const s = state();
    const p = new Presenter(provider, itemTables);
    p.sync(s);
    p.enqueue([{ type: 'action', slot: 0, action: 1008, cell: [2, 4], hits: [{ target: 0, kind: 'miss', value: 0, crit: false, popup: 'miss!', statusAfter: 0 }] }]);
    let now = 0;
    while (p.busy && now < 10_000) { p.update(now); now += 50; }
    expect(now).toBeLessThan(10_000);
  });
  it('pickup and bagFull show a text popup over the unit; revealed turns a hidden chest into a standing one', () => {
    const s = state();
    s.units[20] = unit({ slot: 20, c: 3, r: 4, race: 9, side: 7, id: 8, status: 9 });
    const p = new Presenter(provider, tables());
    p.sync(s);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.model === chest)!.player.timeline.name).toBe('F.HIDE');
    p.enqueue([{ type: 'revealed', slot: 20 }, { type: 'pickup', slot: 0, item: 7, gold: 0 }, { type: 'bagFull', slot: 0, item: 1 }, { type: 'pickup', slot: 0, item: 0, gold: 50 }]);
    p.update(0); p.update(1);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.model === chest)!.player.timeline.name).toBe('F.STAND');
    const texts = (): string[] => p.scene(mapModel(s), s).texts.map((x) => x.text);
    p.update(100);
    expect(texts()).toEqual(['herb 획득']);
    p.update(POPUP_MS + 60);
    expect(texts()).toEqual(['더 가질 수 없다']);
    p.update(POPUP_MS * 2 + 70);
    expect(texts()).toEqual(['50 Gold']);
  });
```
(`unit` 은 이미 import 되어 있다. `POPUP_MS` 도 import 되어 있다.)

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/presenter.test.ts`
Expected: FAIL — 아이템 action 이 `tables.magic[1007]` 로 효과를 찾지 못하고 CAST 를 시도하거나, `pickup`/`revealed` 이벤트가 `default: return []` 로 무시된다.

- [ ] **Step 3: 구현 — presenter.ts**

- `clone`: `spells: [...u.spells]` 뒤에 `, bag: [...u.bag]` 추가.
- `stepsFor` 의 `case 'action'` 블록을 다음으로 바꾼다:
```ts
      case 'action': {
        const steps: Step[] = [step({ kind: 'apply', fn: () => { const v = this.visuals.get(e.slot); if (v && (v.c !== e.cell[0] || v.r !== e.cell[1])) this.setDir(e.slot, dirTo(v.c, v.r, e.cell[0], e.cell[1])); } })];
        if (e.action === 0) steps.push(step(this.anim(e.slot, 'ATTACK1')));
        else if (e.action < 1000) steps.push(step(this.anim(e.slot, 'CAST1A')), step(this.anim(e.slot, 'CAST1B')));
        const effect = this.effectOf(e.action);
        const fx = effect ? this.provider.apd(effect) : null;
        if (fx && fx.animNames().length > 0) steps.push(step({ kind: 'anim', slot: -1, name: `${effect}:${fx.animNames()[0]!}:${e.cell[0]},${e.cell[1]}`, ms: 0, model: null, player: null }));
```
  (이하 `for (const h of e.hits)` 부분은 그대로.)
- `case 'removed'` 앞에 추가:
```ts
      case 'revealed': return [step({ kind: 'apply', fn: () => { const u = this.snapshot[e.slot]; if (u) u.status = 0; } })];
      case 'pickup': return [step({ kind: 'popup', slot: e.slot, text: e.item !== 0 ? `${this.tables.item[e.item]?.name.replace(/_/g, ' ') ?? `아이템 ${e.item}`} 획득` : `${e.gold} Gold`, digits: false })];
      case 'bagFull': return [step({ kind: 'popup', slot: e.slot, text: '더 가질 수 없다', digits: false })];
```
- `anim()` 메서드 옆에 추가:
```ts
  /** Effect APD name (lower-case `magic.effect`) of a spell, or of a consumable's use_effect magic; null when there is none ("0"). */
  private effectOf(action: number): string | null {
    const m = action >= 1000 ? this.tables.magic[this.tables.item[action - 1000]?.use_effect ?? 0] : this.tables.magic[action];
    const name = m?.effect.toLowerCase();
    return name && name !== '0' ? name : null;
  }
```

- [ ] **Step 4: 구현 — main.ts 미리 로드**

`startBattle` 의 `for (const u of battle.state.units) if (u) for (const token of …) sprites!.apd(animApd(u.race, token));` 다음 줄에 추가:
```ts
    const effects = new Set<string>();
    for (const u of battle.state.units) if (u && u.side === 0) for (const m of u.spells) effects.add(tables.magic[m]?.effect.toLowerCase() ?? '0');
    for (const s of usableItems(battle.state.inventory, tables.item)) effects.add(tables.magic[tables.item[s.id]!.use_effect]?.effect.toLowerCase() ?? '0');
    for (const name of effects) if (name !== '0') sprites!.apd(name);          // effect APDs load before the first cast (review M6)
```
import 추가: `import { usableItems } from '../battle/inventory';`

- [ ] **Step 5: 통과 확인**

Run: `cd web && npx vitest run test/presenter.test.ts && npx tsc --noEmit -p .`
Expected: PASS (기존 + 3), tsc 0.

- [ ] **Step 6: 커밋**

```bash
git add web/src/field/presenter.ts web/src/game/main.ts web/test/presenter.test.ts
git commit -m "feat(web): item use effects, treasure popups and hidden-chest reveal in the presenter; preload effect APDs"
```

---

### Task 6: 패널·페이지·문서

**Files:**
- Modify: `web/src/ui/panel.ts`, `web/game.html`, `web/src/game/main.ts`
- Modify: `docs/manual.md`, `README.md`, `docs/superpowers/specs/2026-10-16-items-inventory-design.md` (상태)
- Test: `web/test/panel.test.ts` (추가)

**Interfaces:**
- Consumes: Task 1·3 (`usableItems`, `BattleState.inventory`, 이벤트).
- Produces: `MenuEnabled.item`; `Panel` 이 `#item` 토글, `#items` 목록(버튼 "이름 ×개수", 클릭 → `beginTarget 1000+id`), `#inventory` 텍스트를 다룬다; 로그에 pickup/bagFull/revealed.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/panel.test.ts`:
- import 에 `emptyInventory, giveItem` (from `../src/battle/inventory`) 추가. `base()` 의 상태 리터럴에 `inventory: emptyInventory(),` 추가(`lastPath: []` 뒤).
- `menuEnabled` 첫 테스트의 두 `toEqual({ move…, endTurn: true })` 기대값에 `item: false` 를 추가하고, `none` 기대값들(idle/enemy)에도 `item: false` 를 추가한다.
- `ids` 배열에 `'item', 'items', 'inventory'` 추가.
- 추가:
```ts
describe('menuEnabled.item and the item list', () => {
  it('item is enabled only while a usable consumable is held and the unit has not acted', () => {
    const range = new RangeTable(0, 0); range.setMove(0, 0, 30);
    const s = base({ kind: 'player', sel: { mode: 'menu', slot: 0, range } });
    expect(menuEnabled(s).item).toBe(false);
    giveItem(s.inventory, null, 9, 1, tables().item);                            // no use effect
    expect(menuEnabled(s).item).toBe(false);
    giveItem(s.inventory, null, 7, 1, tables().item);
    expect(menuEnabled(s).item).toBe(true);
    s.units[0]!.acted = true;
    expect(menuEnabled(s).item).toBe(false);
  });
  it('item buttons keep their identity across frames, send beginTarget 1000+id, and the inventory text lists gold, stacks and bags', () => {
    const doc = fakeDocument(ids);
    const sent: unknown[] = [];
    const panel = new Panel(doc, { onStart: () => {}, onCommand: (c) => sent.push(c) }, tables());
    const range = new RangeTable(0, 0); range.setMove(0, 0, 30);
    const s = base({ kind: 'player', sel: { mode: 'menu', slot: 0, range } });
    s.inventory.gold = 300; giveItem(s.inventory, null, 7, 3, tables().item); giveItem(s.inventory, s.units[0]!, 1, 1, tables().item);
    panel.update(s, null);
    const list = doc.getElementById('items') as unknown as FakeElement;
    expect(list.children.map((b) => b.textContent)).toEqual(['herb ×3']);
    const first = list.children[0]!;
    panel.update(s, null);
    expect(list.children[0]).toBe(first);
    first.click();
    expect(sent).toEqual([{ type: 'beginTarget', action: 1007 }]);
    const inv = doc.getElementById('inventory') as unknown as FakeElement;
    expect(inv.textContent).toBe('골드 300\n소모품: herb ×3\n카린: sword, -, -, -');
    s.inventory.items[0]!.count = 2;
    panel.update(s, null);
    expect(list.children[0]).not.toBe(first);
    expect(list.children[0]!.textContent).toBe('herb ×2');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/panel.test.ts`
Expected: FAIL — `menuEnabled` 결과에 `item` 이 없고, `#items`/`#inventory` 가 비어 있다.

- [ ] **Step 3: 구현 — panel.ts**

- import: `import { hasMoveTarget } from '../battle/moveRange';` 뒤에 `import { usableItems } from '../battle/inventory';`
- `MenuEnabled` 에 `item: boolean;` 추가; `menuEnabled` 의 `none` 에 `item: false`, 반환 객체에 `item: !u.acted && usableItems(state.inventory, state.units.length ? tablesOf(state) : []).length > 0` — 단, `menuEnabled` 는 테이블을 받지 않으므로 시그니처를 `menuEnabled(state: BattleState, items: ItemData[] = [])` 로 바꾸고 `item: !u.acted && usableItems(state.inventory, items).length > 0` 로 쓴다. 기존 테스트는 두 번째 인자 없이 호출하므로 `item: false` 가 나온다 → 위 테스트에서는 `menuEnabled(s, tables().item)` 로 호출하도록 테스트를 맞춘다(Step 1 의 첫 테스트 네 호출 모두 `tables().item` 전달).
- `PanelId` 에 `'item' | 'items' | 'inventory'` 추가, 생성자의 `ids` 배열에도 추가. 생성자에 `this.el.item.addEventListener('click', () => { this.el.items.hidden = !this.el.items.hidden; });` 추가.
- 필드 추가: `private itemsKey = ''; private itemButtons: { id: number; button: HTMLButtonElement }[] = [];`
- `update()`:
  - `const en = menuEnabled(state, this.tables.item);`
  - `(this.el.item as HTMLButtonElement).disabled = !en.item;` 추가, `if (!en.item) this.el.items.hidden = true;` 추가.
  - `this.renderSpells(selected);` 뒤에 `this.renderItems(state); this.renderInventory(state);` 추가.
- 메서드 추가:
```ts
  /** Rebuilt only when the usable list (ids and counts) changes, like the spell buttons. */
  private renderItems(state: BattleState): void {
    const list = usableItems(state.inventory, this.tables.item);
    const key = list.map((s) => `${s.id}:${s.count}`).join(',');
    if (key === this.itemsKey) return;
    this.itemsKey = key;
    this.itemButtons = list.map((s) => {
      const button = this.doc.createElement('button');
      button.textContent = `${itemName(this.tables.item[s.id]!)} ×${s.count}`;
      button.addEventListener('click', () => { this.el.items.hidden = true; this.handlers.onCommand({ type: 'beginTarget', action: 1000 + s.id }); });
      return { id: s.id, button };
    });
    this.el.items.replaceChildren(...this.itemButtons.map((x) => x.button));
  }

  private renderInventory(state: BattleState): void {
    const inv = state.inventory;
    const stacks = inv.items.map((s) => `${itemName(this.tables.item[s.id]!)} ×${s.count}`).join(', ') || '없음';
    const bags = state.units.filter((u): u is Unit => u !== null && u.side === 0).map((u) => `${unitName(u, this.tables)}: ${u.bag.map((id) => (id ? itemName(this.tables.item[id]!) : '-')).join(', ')}`);
    this.el.inventory.textContent = [`골드 ${inv.gold}`, `소모품: ${stacks}`, ...bags].join('\n');
  }
```
  파일 상단(`unitName` 옆)에 `export const itemName = (item: ItemData): string => item.name.replace(/_/g, ' ');` 추가하고 `import type { BattleEntry, ItemData, Tables } from '../data/types';` 로 import 를 넓힌다.
- `logEvents` 에 추가:
```ts
      else if (e.type === 'pickup') this.log(e.item !== 0 ? `${this.who(state, e.slot)}: ${itemName(this.tables.item[e.item]!)} 획득` : `${e.gold} Gold 획득`);
      else if (e.type === 'bagFull') this.log(`${this.who(state, e.slot)}: ${itemName(this.tables.item[e.item]!)}을(를) 더 가질 수 없다`);
      else if (e.type === 'revealed') this.log('보물 찾았다!');
```
  와 헬퍼 `private who(state: BattleState, slot: number): string { const u = state.units[slot]; return u ? unitName(u, this.tables) : `슬롯 ${slot}`; }`.

- [ ] **Step 4: 구현 — game.html, main.ts**

`web/game.html`:
- 명령 줄: `<button id="magic">마법</button>` 뒤에 `<button id="item">아이템</button>` 추가.
- `<div id="spells" hidden></div>` 뒤에 `<div id="items" hidden></div>` 추가; `<div id="unit" class="mono"></div>` 뒤에 `<div id="inventory" class="mono"></div>` 추가.
- 스타일 `#spells { … }` 두 규칙을 `#spells, #items { … }` / `#spells[hidden], #items[hidden] { display: none; }` 로.

`web/src/game/main.ts`:
- import: `import { addGold, emptyInventory, giveItem, usableItems } from '../battle/inventory';` (Task 5 의 import 를 넓힌다.)
- 상수(파일 상단, `$` 아래): `/** Dev-page convenience: the story scripts give items in the real game. */ const STARTER_KIT: { gold: number; items: [number, number][] } = { gold: 300, items: [[1, 3], [2, 2], [7, 1]] };   // 허브×3, 해독초×2, 깨어나는 약×1`
- `startBattle`: `battle = Battle.start(entry, map, roster1, roster, tables, seed);` → 
```ts
    const inventory = emptyInventory();
    addGold(inventory, STARTER_KIT.gold);
    for (const [id, n] of STARTER_KIT.items) giveItem(inventory, null, id, n, tables.item);
    battle = Battle.start(entry, map, roster1, roster, tables, seed, inventory);
```

- [ ] **Step 5: 통과 확인 + 브라우저 점검**

Run: `cd web && npm run check`
Expected: 전부 PASS, tsc 0.

브라우저(`http://localhost:5173/game.html`, 전투 01 시드 7): 패널에 「아이템」 버튼과 "골드 300 / 소모품: 허브 ×3, …" 가 보인다. 카린을 선택하고 「아이템」 → 「허브 ×3」 → 카린 칸의 ATTACK 타일 클릭 → 숫자 팝업과 로그 "카린 → 카린: 회복 N", 소모품이 ×2 로 준다. 보물이 있는 전투(예: 로스터에 드롭 골드가 있는 전투)에서 보물 칸으로 이동하면 "N Gold 획득" 로그. 콘솔 오류 0. 사용자의 Chrome 탭에는 클릭을 넣지 않는다 — 테스트와 `window.__ft2()` 읽기로 확인하거나 사용자 보고를 받는다.

- [ ] **Step 6: 문서**

- `docs/manual.md` §6 전투 페이지: 명령 표에 `| 아이템 → 항목 → 셀 클릭 | 소지한 소모품을 자신 또는 인접 아군에게 쓴다. 하나가 소비된다 |` 추가; 새 소절 "6.5 보물과 소지품": 보물 칸으로 이동하면 습득(골드/아이템/장비는 가방), 가득 차면 남는다, 인접하면 숨은 보물이 드러난다; 패널 소지품 절 설명; 시작 키트(골드 300, 허브 3, 해독초 2, 깨어나는 약 1)는 개발 페이지 편의. 상태 표의 "3 아이템·소지품" 행을 "완료(상점·장비 화면은 4에서)" 로.
- `README.md` 상태 표 같은 행 갱신.
- 스펙 상단 "상태: 승인" → "상태: 구현 완료 (main 병합 커밋 해시)" 는 병합 후 갱신.

- [ ] **Step 7: 커밋**

```bash
git add web/src/ui/panel.ts web/game.html web/src/game/main.ts web/test/panel.test.ts docs/manual.md README.md
git commit -m "feat(web): item command, inventory panel and starter kit on the battle page; manual §6 items"
```
