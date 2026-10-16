# 전투 기반(하위 프로젝트 2 "전투 1판") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브라우저에서 33개 전투 중 하나를 골라 원작 규칙(이동·공격·마법·적 AI·승패)으로 한 판을 끝까지 플레이한다. 같은 시드와 명령열이면 결과가 재현된다.

**Architecture:** Python 변환기가 `race/item/magic` 테이블, 로스터 59개, 전투 카탈로그를 JSON으로 쓴다. `web/src/battle/`은 DOM 없는 순수 규칙 코어(`(state, command) → events`)이고, `web/src/field/`가 이벤트를 하위 프로젝트 1 렌더러의 `Scene`으로 바꾸며, `web/src/ui/`가 HTML 패널로 명령을 만든다. 적 AI는 원작 `FUN_00411b10` 점수표를 그대로 옮긴다.

**Tech Stack:** Python 3 (stdlib), TypeScript 7 (strict, `noUncheckedIndexedAccess`), Vite 8, Vitest 5, Canvas 2D. 프레임워크·린터 없음.

**Spec:** `docs/superpowers/specs/2026-10-15-battle-foundation-design.md`. 규칙 근거: `analysis/battle_rules.md`, `analysis/field_mode.md`, `analysis/file_formats.md` §8.

## Global Constraints

- 원작 특이점 보존(스펙 D2): 회피 roll 인수 역전, 홀드(51)의 속성 축 0 사용, 무기 상태이상의 카운터 미갱신, 적 회복 시 EXP `max(…,1)`, 사거리 표의 높이 검사 조기 return.
- 난수는 원작 Wichmann–Hill 3-LCG(`FUN_004337a0`) 재현. 상수 177/171/2/30269, 176/172/35/30307, 178/170/63/30323. `rand(n)`은 `n > 0`이면 `% n`.
- JSON 필드 이름 = `tools/ft2_tables.py`의 snake_case 이름. TS 타입도 같은 이름(스펙 D9).
- `battle/` 모듈은 `document`, `window`, `fetch`, `HTMLCanvasElement`를 import 하거나 참조하지 않는다.
- 명령 거부는 `{ type: 'rejected', reason }` 이벤트 하나. 예외를 던지지 않는다.
- 자산 이름은 소문자 stem. 유닛 본체 APD는 `char_<종족 2자리>a`, 그림자·아이콘·하이라이트·커서는 `system`, 팝업 숫자는 `number`.
- 모든 Python 실행은 `python3 -I`. 테스트 명령은 `cd web && npm run check`(tsc + vitest), Python은 `python3 -I -m unittest discover -s tools -p 'test_*.py'`. 셸은 `set -o pipefail` 뒤 명시적 종료 코드 확인.
- 커밋은 작업마다. 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **로스터 좌표가 맵에 없는 셀**(`cellAt == −1`)인 전투를 고르면: 그 유닛을 `DataError`로 보고하고 전투 시작을 막아야 한다. 다른 전투는 그대로 열려야 한다. → Task 12 테스트 `rejects a roster unit placed on a missing cell`.
2. **이동 범위가 없는 유닛**(전 방향 blocked, 또는 수면 상태)을 선택하면: 메뉴는 열리되 이동 버튼이 비활성이고, `move` 명령은 `rejected`여야 한다. → Task 12 테스트 `move is rejected when the range has no reachable cell`.
3. **마지막 적이 드롭 아이템을 가진 채 죽을 때**: side 7 오브젝트로 바뀌어도 승리 판정은 그 턴에 나와야 한다(오브젝트는 적 집계에서 빠진다). → Task 10 테스트 `victory counts a converted treasure object as no enemy`.
4. **AI 유닛이 갈 곳도 때릴 대상도 없을 때**(멀리 떨어진 적, 모든 셀 −9999 제외): 제자리에 머물고 가장 가까운 적을 바라봐야 하며 예외가 없어야 한다. → Task 11 테스트 `stays and turns toward the nearest enemy when nothing is reachable`.
5. **RUN·ATTACK 애니가 없는 종족**(블루슬라임 등)이 이동·공격할 때: `STAND`로 대체하고 연출 큐가 멈추지 않아야 한다. → Task 14 테스트 `falls back to STAND when the body APD lacks RUN and ATTACK`.

## File Structure

```
tools/ft2_export.py             수정: export_data() — data/race.json, item.json, magic.json, roster/stageNNN.json, battles.json ; index.json 에 data:true
tools/test_ft2_export.py        수정: 카탈로그 추출·로스터 JSON 테스트
web/game.html                   신규: 전투 페이지
web/src/data/types.ts           신규: RaceData, ItemData, MagicData, RosterUnit, BattleEntry, Tables + assert 함수
web/src/data/loader.ts          신규: DataLoader, DataError
web/src/battle/rng.ts           신규: RandomSource, Rng
web/src/battle/unit.ts          신규: Unit, createUnit, growUnit, rebuildSpells, 장비 합산
web/src/battle/grid.ts          신규: Dir, DIR_DELTA, dist, dirTo, stepCell, incap, hostile, BattleGrid, unitAt, unitsWithin
web/src/battle/moveRange.ts     신규: RangeTable, computeMoveRange, markTargets, pathTo, canStop
web/src/battle/targets.ts       신규: targetsOf, canAttack, magicRadius
web/src/battle/resolve.ts       신규: Hit, resolveAction (물리·마법)
web/src/battle/outcome.ts       신규: applyOutcome, statusTick, roundStart, checkEnd
web/src/battle/ai.ts            신규: chooseAction
web/src/battle/types.ts          신규: BattleState, Phase, Selection, Command, BattleEvent
web/src/battle/battle.ts        신규: BattleState, Command, BattleEvent, Battle, createParty, applyRoster
web/src/field/unitSprites.ts    신규: bodyApd, bodyAnim, shadowAnim, iconAnim, LAYER
web/src/field/overlay.ts        신규: overlaySprites
web/src/field/presenter.ts      신규: Presenter (연출 큐 → Scene)
web/src/ui/panel.ts             신규: Panel, menuEnabled
web/src/game/main.ts            신규: 조립
web/src/render/renderer.ts      수정: PlacedSprite.layer, 행 안 정렬 (sortRow)
web/src/viewer/main.ts          수정: layer: 4
web/test/helpers/battleFixtures.ts  신규: flatMap(), unit(), tables() 합성 데이터
web/test/*.test.ts              신규 테스트 파일 (작업마다)
docs/manual.md, README.md, web/README.md   수정: 게임 페이지 사용법·상태
```

---
### Task 1: Python 데이터 변환 (테이블·로스터·전투 카탈로그)

**Files:**
- Modify: `tools/ft2_export.py`
- Test: `tools/test_ft2_export.py`

**Interfaces:**
- Consumes: `ft2_tables.race/item/magic/stage(data: bytes) -> Iterator[dict]`, `ft2_event_disasm.disassemble(data) -> (syms, body, lines, stats, bad_syms)` (lines: `"label:"` 또는 `"  0x%04x: NAME operands"`).
- Produces: `OUT/data/race.json`, `item.json`, `magic.json` (레코드 리스트), `OUT/data/roster/stageNNN.json` (`RosterUnit[]`, 필드 `unit_id race level dir c r status side weapon armor drop_item drop_gold`), `OUT/data/battles.json` (`BattleEntry[]`: `event label map roster episode objective heal`), `index.json`에 `"data": true`. 함수 `battles_from_listing(lines, event) -> list[dict]`, `roster_json(records) -> list[dict]`, `export_data(game, out, report) -> dict`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tools/test_ft2_export.py` 끝(`if __name__` 앞)에 추가:

```python
from ft2_export import battles_from_listing, roster_json


class BattlesFromListing(unittest.TestCase):
    LISTING = [
        'outfield:',
        '  0x26d1: MUSIC 6',
        '  0x26d6: LOAD_MAP 49',
        '  0x26d9: LOAD_UNITS 49',
        '  0x2755: MESSAGE "슬라임을_전멸시켜라!?"',
        '  0x276d: BATTLE_START_HEAL',
        '  0x276f: END',
        'restart:',
        '  0x2774: LOAD_MAP 49',
        '  0x277a: FIELD_MODE',
        '  0x2781: END',
        'roof:',
        '  0x1d9b: LOAD_MAP 29',
        '  0x1d9c: LOAD_UNITS 29',
        '  0x1daa: EPISODE "지붕_위에서의_싸움", 0',
        '  0x1dc0: MESSAGE "적을_전멸시켜라!"',
        '  0x1dd3: BATTLE_START',
        'broken:',
        '  0x3000: MESSAGE "x"',
        '  0x3001: BATTLE_START',
    ]

    def test_extracts_one_entry_per_battle_start(self):
        entries, warnings = battles_from_listing(self.LISTING, 5)
        self.assertEqual(entries, [
            dict(event=5, label='outfield', map='stage49', roster=49, episode='', objective='슬라임을 전멸시켜라!?', heal=True),
            dict(event=5, label='roof', map='stage29', roster=29, episode='지붕 위에서의 싸움', objective='적을 전멸시켜라!', heal=False),
        ])
        self.assertEqual(warnings, ['EVENT05 broken: BATTLE_START without LOAD_MAP/LOAD_UNITS'])


class RosterJson(unittest.TestCase):
    def test_drops_hi_words_and_keeps_named_fields(self):
        recs = [dict(unit_id=8, race=10, level=1, dir=1, c=14, c_hi=0, r=17, r_hi=0, status=0, side=4,
                     weapon=130, armor=0, drop_item=0, drop_gold=0)]
        self.assertEqual(roster_json(recs), [dict(unit_id=8, race=10, level=1, dir=1, c=14, r=17, status=0, side=4,
                                                  weapon=130, armor=0, drop_item=0, drop_gold=0)])
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/kang/Documents/dev/farland_tactics && python3 -I -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -3`
Expected: `ImportError: cannot import name 'battles_from_listing'`

- [ ] **Step 3: 구현**

`tools/ft2_export.py`에서 import 아래에 추가:

```python
import re

from ft2_event_disasm import disassemble  # noqa: E402
from ft2_tables import item as parse_item, magic as parse_magic, race as parse_race, stage as parse_stage  # noqa: E402

INSTR = re.compile(r'^\s+0x[0-9a-f]+: (\w+)(?: (.*))?$')
STRING = re.compile(r'"([^"]*)"')
ROSTER_FIELDS = ('unit_id', 'race', 'level', 'dir', 'c', 'r', 'status', 'side', 'weapon', 'armor', 'drop_item', 'drop_gold')


def battles_from_listing(lines: list[str], event: int) -> tuple[list[dict], list[str]]:
    """One BattleEntry per BATTLE_START(_HEAL): the last LOAD_MAP/LOAD_UNITS/EPISODE/MESSAGE seen in the same label."""
    entries, warnings = [], []
    label, ctx = '', {}
    for line in lines:
        if line.endswith(':') and not line.startswith(' '):
            label, ctx = line[:-1], {}
            continue
        m = INSTR.match(line)
        if not m:
            continue
        name, args = m.group(1), m.group(2) or ''
        if name in ('LOAD_MAP', 'LOAD_UNITS'):
            ctx[name] = int(args)
        elif name in ('EPISODE', 'MESSAGE'):
            s = STRING.search(args)
            ctx[name] = s.group(1).replace('_', ' ') if s else ''
        elif name in ('BATTLE_START', 'BATTLE_START_HEAL'):
            if 'LOAD_MAP' not in ctx or 'LOAD_UNITS' not in ctx:
                warnings.append(f'EVENT{event:02d} {label}: BATTLE_START without LOAD_MAP/LOAD_UNITS')
                continue
            entries.append(dict(event=event, label=label, map=f'stage{ctx["LOAD_MAP"]:02d}', roster=ctx['LOAD_UNITS'],
                                episode=ctx.get('EPISODE', ''), objective=ctx.get('MESSAGE', ''),
                                heal=name == 'BATTLE_START_HEAL'))
    return entries, warnings


def roster_json(records) -> list[dict]:
    return [{k: r[k] for k in ROSTER_FIELDS} for r in records]


def export_data(game: Path, out: Path, report: Report) -> dict:
    """Tables, rosters and the battle catalog → OUT/data. Returns counts."""
    data_dir, roster_dir = out / 'data', out / 'data' / 'roster'
    roster_dir.mkdir(parents=True, exist_ok=True)
    tables = {}
    for name, parser in (('race', parse_race), ('item', parse_item), ('magic', parse_magic)):
        tables[name] = list(parser((game / 'DATA' / f'{name}.dat').read_bytes()))
        (data_dir / f'{name}.json').write_text(json.dumps(tables[name], ensure_ascii=False), encoding='utf-8')
    rosters = {}
    for p in sorted(game.joinpath('DATA').iterdir()):
        mm = re.fullmatch(r'stage(\d{3})\.dat', p.name.lower())
        if not mm:
            continue
        recs = roster_json(parse_stage(p.read_bytes()))
        for i, r in enumerate(recs):
            if not (0 <= r['race'] < len(tables['race'])):
                report.error(f'{p.name}: unit {i} race {r["race"]} out of range')
            for k in ('weapon', 'armor', 'drop_item'):
                if not (0 <= r[k] < len(tables['item'])):
                    report.error(f'{p.name}: unit {i} {k} {r[k]} out of range')
            if not (1 <= r['level'] <= 99) or not (0 <= r['side'] <= 7):
                report.error(f'{p.name}: unit {i} level {r["level"]} or side {r["side"]} out of range')
        n = int(mm.group(1))
        rosters[n] = recs
        (roster_dir / f'stage{n:03d}.json').write_text(json.dumps(recs), encoding='utf-8')
    battles = []
    for ev in range(0, 18):
        p = game / 'DATA' / f'EVENT{ev:02d}.dat'
        if not p.exists():
            continue
        _, _, lines, _, _ = disassemble(p.read_bytes())
        entries, warnings = battles_from_listing(lines, ev)
        for w in warnings:
            report.warn(w)
        for e in entries:
            if e['roster'] not in rosters:
                report.error(f'EVENT{ev:02d} {e["label"]}: roster {e["roster"]} missing')
            if not (game / 'Map' / f'{e["map"]}.map').exists() and not (game / 'Map' / f'{e["map"].upper()}.MAP').exists():
                report.error(f'EVENT{ev:02d} {e["label"]}: map {e["map"]} missing')
        battles.extend(entries)
    (data_dir / 'battles.json').write_text(json.dumps(battles, ensure_ascii=False), encoding='utf-8')
    return dict(race=len(tables['race']), item=len(tables['item']), magic=len(tables['magic']), rosters=len(rosters), battles=len(battles))
```

`main()`을 다음으로 바꾼다:

```python
def main(argv: list[str]) -> int:
    if len(argv) != 3:
        raise SystemExit(__doc__)
    game, out = Path(argv[1]), Path(argv[2])
    report = Report()
    maps = export_maps(game, out, report)
    sprites = export_sprites(game, out, report)
    counts = export_data(game, out, report)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'index.json').write_text(json.dumps(dict(format=FORMAT, maps=maps, sprites=sprites, data=True)), encoding='utf-8')
    pngs = sum(1 for d in ('map', 'sprite') for _ in (out / d).glob('*.png'))
    print(f'maps {len(maps)}, sprites {len(sprites)}, pngs {pngs}, warnings {len(report.warnings)}, errors {len(report.errors)}')
    print(f'tables race {counts["race"]}, item {counts["item"]}, magic {counts["magic"]}, rosters {counts["rosters"]}, battles {counts["battles"]}')
    for w in report.warnings:
        print('warning:', w)
    for e in report.errors:
        print('error:', e)
    return 1 if report.errors else 0
```

맵 파일 존재 검사: `Map/` 폴더의 파일 이름은 소문자(`stage49.map`)다. 위 코드의 두 번째 `exists()`는 대문자 변형 대비다.

docstring의 둘째 줄에 `OUT_DIR/data/{race,item,magic}.json, data/roster/stageNNN.json, data/battles.json`를 추가한다.

- [ ] **Step 4: 통과 확인과 실제 변환**

Run: `python3 -I -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -3`
Expected: `Ran 10 tests` … `OK`

Run: `set -o pipefail; python3 -I tools/ft2_export.py extracted/FarlandTactics2 web/public/assets > /tmp/export.log 2>&1; echo rc=$?; head -3 /tmp/export.log`
Expected: `rc=0`, 둘째 줄 `tables race 74, item 180, magic 84, rosters 59, battles 33`, 경고는 기존 4개뿐.

Run: `python3 -I -c "import json; b=json.load(open('web/public/assets/data/battles.json')); print(b[0])"`
Expected: `{'event': 1, 'label': 'outfield', 'map': 'stage49', 'roster': 49, 'episode': '첫업무', 'objective': '슬라임을 전멸시켜라!?', 'heal': True}`

- [ ] **Step 5: 커밋**

```bash
git add tools/ft2_export.py tools/test_ft2_export.py
git commit -m "feat(tools): export race/item/magic tables, rosters and the battle catalog as JSON"
```

---

### Task 2: 데이터 타입과 로더 (TypeScript)

**Files:**
- Create: `web/src/data/types.ts`, `web/src/data/loader.ts`
- Test: `web/test/dataLoader.test.ts`

**Interfaces:**
- Consumes: Task 1의 JSON 파일.
- Produces: `interface RaceData/ItemData/MagicData/RosterUnit/BattleEntry/Tables`, `class DataError extends Error { file: string }`, `class DataLoader { constructor(base = 'assets/data'); tables(): Promise<Tables>; roster(n: number): Promise<RosterUnit[]>; battles(): Promise<BattleEntry[]> }`, `validateRoster(recs, tables, file): void` (throws DataError).

- [ ] **Step 1: 실패하는 테스트**

`web/test/dataLoader.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError, DataLoader, validateRoster } from '../src/data/loader';
import type { Tables } from '../src/data/types';

const race = (name: string) => ({ name, exp_value: 10, hp: 24, hp_up: 3, mp: 24, mp_up: 3, str: 18, str_up: 5, def: 14, def_up: 4, wis: 22, wis_up: 5, mgr: 12, mgr_up: 5, agi: 18, agi_up: 4, elem0: 0, elem1: 0, elem2: 0, size: 3, climb_max: 4, drop_max: 4, cost_land0: 99, cost_land1: 5, cost_land2: 5, cost_land3: 6, cost_land4: 7, cost_land5: 7, cost_land6: 8, cost_land7: 5, spell0: 0, spell1: 0, spell2: 0, spell3: 0 });
const item = (name: string) => ({ name, price: 0, hp_heal: 0, mp_heal: 0, atk: 0, def: 0, wis: 0, mgr: 0, agi: 0, elem0: 0, elem1: 0, elem2: 0, range_min: 1, range_max: 1, slot: 0, use_effect: 0, weapon_type: 0, status_code: 0, race_mask: 0 });
const magic = (name: string) => ({ name, learn_level: 1, mp_cost: 6, elem0: 5, elem1: 0, elem2: 0, range_min: 2, range_max: 6, effect: 'BURST', effect_no: 1, target: 0, shape: 1, learn_mask: 1, short: '' });
const tables: Tables = { race: [race('a'), race('b')], item: [item('none'), item('sword')], magic: [magic('x')] };
const rec = { unit_id: 1, race: 0, level: 2, dir: 2, c: 3, r: 4, status: 0, side: 0, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0 };

function mockFetch(files: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = files[url];
    return body === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('validateRoster', () => {
  it('accepts a record inside every range', () => {
    expect(() => validateRoster([rec], tables, 'r')).not.toThrow();
  });
  it('rejects race, item, level and side out of range with the field name', () => {
    expect(() => validateRoster([{ ...rec, race: 2 }], tables, 'r')).toThrow(/unit 0 race 2/);
    expect(() => validateRoster([{ ...rec, weapon: 9 }], tables, 'r')).toThrow(/weapon 9/);
    expect(() => validateRoster([{ ...rec, level: 0 }], tables, 'r')).toThrow(/level 0/);
    expect(() => validateRoster([{ ...rec, side: 8 }], tables, 'r')).toThrow(DataError);
  });
});

describe('DataLoader', () => {
  it('loads and caches the three tables', async () => {
    mockFetch({ 'assets/data/race.json': tables.race, 'assets/data/item.json': tables.item, 'assets/data/magic.json': tables.magic });
    const loader = new DataLoader();
    const t = await loader.tables();
    expect(t.race[1]!.name).toBe('b');
    await loader.tables();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('reports a missing roster file as DataError with the path', async () => {
    mockFetch({ 'assets/data/race.json': tables.race, 'assets/data/item.json': tables.item, 'assets/data/magic.json': tables.magic });
    await expect(new DataLoader().roster(49)).rejects.toMatchObject({ name: 'DataError', file: 'assets/data/roster/stage049.json' });
  });
  it('rejects a table with the wrong record shape', async () => {
    mockFetch({ 'assets/data/race.json': [{ name: 'x' }], 'assets/data/item.json': tables.item, 'assets/data/magic.json': tables.magic });
    await expect(new DataLoader().tables()).rejects.toThrow(/race.json: record 0 missing "hp"/);
  });
  it('loads the battle catalog and checks its fields', async () => {
    mockFetch({ 'assets/data/battles.json': [{ event: 1, label: 'outfield', map: 'stage49', roster: 49, episode: '첫업무', objective: '!', heal: true }] });
    expect((await new DataLoader().battles())[0]!.roster).toBe(49);
    mockFetch({ 'assets/data/battles.json': [{ event: 1 }] });
    await expect(new DataLoader().battles()).rejects.toThrow(/battles.json: entry 0 missing "map"/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/dataLoader.test.ts 2>&1 | tail -5`
Expected: FAIL — `Failed to resolve import "../src/data/loader"`

- [ ] **Step 3: 구현**

`web/src/data/types.ts`:

```ts
// Field names follow tools/ft2_tables.py (spec D9).
export interface RaceData {
  name: string; exp_value: number;
  hp: number; hp_up: number; mp: number; mp_up: number; str: number; str_up: number; def: number; def_up: number;
  wis: number; wis_up: number; mgr: number; mgr_up: number; agi: number; agi_up: number;
  elem0: number; elem1: number; elem2: number; size: number; climb_max: number; drop_max: number;
  cost_land0: number; cost_land1: number; cost_land2: number; cost_land3: number;
  cost_land4: number; cost_land5: number; cost_land6: number; cost_land7: number;
  spell0: number; spell1: number; spell2: number; spell3: number;
}
export interface ItemData {
  name: string; price: number; hp_heal: number; mp_heal: number; atk: number; def: number; wis: number; mgr: number; agi: number;
  elem0: number; elem1: number; elem2: number; range_min: number; range_max: number; slot: number; use_effect: number;
  weapon_type: number; status_code: number; race_mask: number;
}
export interface MagicData {
  name: string; learn_level: number; mp_cost: number; elem0: number; elem1: number; elem2: number;
  range_min: number; range_max: number; effect: string; effect_no: number; target: number; shape: number; learn_mask: number; short: string;
}
export interface RosterUnit {
  unit_id: number; race: number; level: number; dir: number; c: number; r: number; status: number; side: number;
  weapon: number; armor: number; drop_item: number; drop_gold: number;
}
export interface BattleEntry { event: number; label: string; map: string; roster: number; episode: string; objective: string; heal: boolean }
export interface Tables { race: RaceData[]; item: ItemData[]; magic: MagicData[] }

export const RACE_FIELDS = ['name', 'exp_value', 'hp', 'hp_up', 'mp', 'mp_up', 'str', 'str_up', 'def', 'def_up', 'wis', 'wis_up', 'mgr', 'mgr_up', 'agi', 'agi_up', 'elem0', 'elem1', 'elem2', 'size', 'climb_max', 'drop_max', 'cost_land0', 'cost_land1', 'cost_land2', 'cost_land3', 'cost_land4', 'cost_land5', 'cost_land6', 'cost_land7', 'spell0', 'spell1', 'spell2', 'spell3'] as const;
export const ITEM_FIELDS = ['name', 'price', 'hp_heal', 'mp_heal', 'atk', 'def', 'wis', 'mgr', 'agi', 'elem0', 'elem1', 'elem2', 'range_min', 'range_max', 'slot', 'use_effect', 'weapon_type', 'status_code', 'race_mask'] as const;
export const MAGIC_FIELDS = ['name', 'learn_level', 'mp_cost', 'elem0', 'elem1', 'elem2', 'range_min', 'range_max', 'effect', 'effect_no', 'target', 'shape', 'learn_mask', 'short'] as const;
export const ROSTER_FIELDS = ['unit_id', 'race', 'level', 'dir', 'c', 'r', 'status', 'side', 'weapon', 'armor', 'drop_item', 'drop_gold'] as const;
export const BATTLE_FIELDS = ['event', 'label', 'map', 'roster', 'episode', 'objective', 'heal'] as const;

/** Throws TypeError naming the first missing field of the first bad record. */
export function assertRecords(x: unknown, fields: readonly string[], what: string): void {
  if (!Array.isArray(x)) throw new TypeError(`${what} is not an array`);
  x.forEach((rec, i) => {
    const o = rec as Record<string, unknown>;
    for (const f of fields) if (!(f in o)) throw new TypeError(`${what} ${i} missing "${f}"`);
  });
}

/** Elemental vector of a race, item or magic record. */
export const elems = (r: { elem0: number; elem1: number; elem2: number }): [number, number, number] => [r.elem0, r.elem1, r.elem2];
export const costLand = (r: RaceData): number[] => [r.cost_land0, r.cost_land1, r.cost_land2, r.cost_land3, r.cost_land4, r.cost_land5, r.cost_land6, r.cost_land7];
export const raceSpells = (r: RaceData): number[] => [r.spell0, r.spell1, r.spell2, r.spell3];
```

`web/src/data/loader.ts`:

```ts
import { assertRecords, BATTLE_FIELDS, ITEM_FIELDS, MAGIC_FIELDS, RACE_FIELDS, ROSTER_FIELDS, type BattleEntry, type RosterUnit, type Tables } from './types';

export class DataError extends Error {
  override name = 'DataError';
  constructor(readonly file: string, message: string) {
    super(`${file}: ${message}`);
  }
}

/** Roster records must index existing table rows (spec §5.4, §12). */
export function validateRoster(recs: RosterUnit[], tables: Tables, file: string): void {
  recs.forEach((r, i) => {
    if (r.race < 0 || r.race >= tables.race.length) throw new DataError(file, `unit ${i} race ${r.race} out of range`);
    for (const k of ['weapon', 'armor', 'drop_item'] as const) {
      if (r[k] < 0 || r[k] >= tables.item.length) throw new DataError(file, `unit ${i} ${k} ${r[k]} out of range`);
    }
    if (r.level < 1 || r.level > 99) throw new DataError(file, `unit ${i} level ${r.level} out of range`);
    if (r.side < 0 || r.side > 7) throw new DataError(file, `unit ${i} side ${r.side} out of range`);
  });
}

/** Fetches tools/ft2_export.py --data output (assets/data/*.json). Tables and the catalog are fetched once. */
export class DataLoader {
  private tablesP: Promise<Tables> | null = null;
  private battlesP: Promise<BattleEntry[]> | null = null;

  constructor(private readonly base = 'assets/data') {}

  tables(): Promise<Tables> {
    this.tablesP ??= (async () => {
      const [race, item, magic] = await Promise.all([this.json('race.json'), this.json('item.json'), this.json('magic.json')]);
      assertRecords(race, RACE_FIELDS, `${this.base}/race.json: record`);
      assertRecords(item, ITEM_FIELDS, `${this.base}/item.json: record`);
      assertRecords(magic, MAGIC_FIELDS, `${this.base}/magic.json: record`);
      return { race, item, magic } as Tables;
    })().catch((e: unknown) => { this.tablesP = null; throw e; });
    return this.tablesP;
  }

  async roster(n: number): Promise<RosterUnit[]> {
    const file = `${this.base}/roster/stage${String(n).padStart(3, '0')}.json`;
    const recs = await this.json(file, true);
    assertRecords(recs, ROSTER_FIELDS, `${file}: record`);
    validateRoster(recs as RosterUnit[], await this.tables(), file);
    return recs as RosterUnit[];
  }

  battles(): Promise<BattleEntry[]> {
    this.battlesP ??= (async () => {
      const list = await this.json('battles.json');
      assertRecords(list, BATTLE_FIELDS, `${this.base}/battles.json: entry`);
      return list as BattleEntry[];
    })().catch((e: unknown) => { this.battlesP = null; throw e; });
    return this.battlesP;
  }

  private async json(rel: string, absolute = false): Promise<unknown> {
    const path = absolute ? rel : `${this.base}/${rel}`;
    const res = await fetch(path);
    if (!res.ok) throw new DataError(path, `HTTP ${res.status}`);
    try { return await res.json(); } catch { throw new DataError(path, 'invalid JSON'); }
  }
}
```

`assertRecords`가 던지는 `TypeError` 메시지는 `assets/data/race.json: record 0 missing "hp"` 형태다(테스트의 정규식과 일치).

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/dataLoader.test.ts 2>&1 | tail -5`
Expected: `Tests  6 passed`

- [ ] **Step 5: 커밋**

```bash
git add web/src/data web/test/dataLoader.test.ts
git commit -m "feat(web): data types and DataLoader for tables, rosters and the battle catalog"
```

---

### Task 3: 원작 난수 생성기

**Files:**
- Create: `web/src/battle/rng.ts`
- Test: `web/test/rng.test.ts`

**Interfaces:**
- Produces: `interface RandomSource { rand(n: number): number }`, `class Rng implements RandomSource { constructor(s1, s2, s3); static fromSeed(seed: number): Rng; rand(n): number; clone(): Rng; readonly state: [number, number, number] }`.

- [ ] **Step 1: 실패하는 테스트**

`web/test/rng.test.ts` (기대값은 Python 교차 구현으로 계산한 값):

```ts
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/battle/rng';

describe('Rng (FUN_004337a0 Wichmann–Hill 3-LCG)', () => {
  it('seed 12345 → state (12346, 1, 1) and the first ten rand(100) values', () => {
    const r = Rng.fromSeed(12345);
    expect(r.state).toEqual([12346, 1, 1]);
    expect(Array.from({ length: 10 }, () => r.rand(100))).toEqual([47, 76, 5, 1, 90, 51, 59, 48, 48, 20]);
  });
  it('rand(0) returns the raw sum of the three states', () => {
    const r = Rng.fromSeed(12345);
    expect(Array.from({ length: 5 }, () => r.rand(0))).toEqual([22947, 79776, 36505, 57701, 34890]);
  });
  it('seed 1: rand(3) × 8 and the end state', () => {
    const r = Rng.fromSeed(1);
    expect(Array.from({ length: 8 }, () => r.rand(3))).toEqual([0, 0, 1, 1, 0, 1, 2, 0]);
    expect(r.state).toEqual([11389, 29080, 21289]);
  });
  it('clone continues independently', () => {
    const a = Rng.fromSeed(7); a.rand(10);
    const b = a.clone();
    expect(b.rand(1000)).toBe(a.rand(1000));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/rng.test.ts 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/battle/rng`

- [ ] **Step 3: 구현**

`web/src/battle/rng.ts`:

```ts
export interface RandomSource { rand(n: number): number }

/** FT2.exe FUN_004337a0: three multiplicative congruential generators (Wichmann–Hill), summed. rand(n) is 0..n-1 for n > 0. */
export class Rng implements RandomSource {
  constructor(private s1: number, private s2: number, private s3: number) {}

  /** Remake seeding (the original seeds from the clock): spread one integer over the three states, each ≥ 1. */
  static fromSeed(seed: number): Rng {
    const s = Math.abs(Math.trunc(seed));
    return new Rng(1 + (s % 30268), 1 + (Math.trunc(s / 30268) % 30306), 1 + (Math.trunc(s / (30268 * 30306)) % 30322));
  }

  get state(): [number, number, number] { return [this.s1, this.s2, this.s3]; }

  clone(): Rng { return new Rng(this.s1, this.s2, this.s3); }

  rand(n: number): number {
    this.s1 = (this.s1 % 177) * 171 - Math.trunc(this.s1 / 177) * 2;
    this.s2 = (this.s2 % 176) * 172 - Math.trunc(this.s2 / 176) * 35;
    this.s3 = (this.s3 % 178) * 170 - Math.trunc(this.s3 / 178) * 63;
    if (this.s1 < 0) this.s1 += 30269;
    if (this.s2 < 0) this.s2 += 30307;
    if (this.s3 < 0) this.s3 += 30323;
    const v = this.s1 + this.s2 + this.s3;
    return n > 0 ? v % n : v;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/rng.test.ts 2>&1 | tail -3`
Expected: `Tests  4 passed`

- [ ] **Step 5: 커밋**

```bash
git add web/src/battle/rng.ts web/test/rng.test.ts
git commit -m "feat(web): reproduce the original Wichmann-Hill random generator"
```

---
### Task 4: 유닛 생성과 성장

**Files:**
- Create: `web/src/battle/unit.ts`, `web/test/helpers/battleFixtures.ts`
- Test: `web/test/unit.test.ts`

**Interfaces:**
- Consumes: `RandomSource` (Task 3), `RaceData/ItemData/MagicData/Tables/RosterUnit`, `raceSpells`, `elems` (Task 2).
- Produces: `interface Unit`, `PARTY_SLOTS = 10`, `MAX_SLOTS = 50`, `createUnit(rec: RosterUnit, slot: number, tables: Tables, rng: RandomSource): Unit`, `growUnit(u: Unit, race: RaceData, randomize: boolean, rng: RandomSource, magic: MagicData[]): number[]` (새로 배운 주문 번호), `rebuildSpells(u: Unit, magic: MagicData[]): number[]`, `itemsOf(u: Unit, items: ItemData[]): [ItemData, ItemData, ItemData, ItemData]`. 픽스처: `RACE(over)`, `ITEM(over)`, `MAGIC(over)`, `tables(over)`, `unit(over & { slot })`, `fixedRng(values)`.

- [ ] **Step 1: 픽스처 작성**

`web/test/helpers/battleFixtures.ts`:

```ts
import type { MapCell, MapData } from '../../src/assets/types';
import type { RandomSource } from '../../src/battle/rng';
import type { Unit } from '../../src/battle/unit';
import type { ItemData, MagicData, RaceData, Tables } from '../../src/data/types';

export const RACE = (over: Partial<RaceData> = {}): RaceData => ({
  name: 'test', exp_value: 10, hp: 24, hp_up: 3, mp: 24, mp_up: 3, str: 18, str_up: 5, def: 14, def_up: 4, wis: 22, wis_up: 5,
  mgr: 12, mgr_up: 5, agi: 18, agi_up: 4, elem0: 0, elem1: 0, elem2: 0, size: 3, climb_max: 4, drop_max: 4,
  cost_land0: 99, cost_land1: 5, cost_land2: 5, cost_land3: 6, cost_land4: 7, cost_land5: 7, cost_land6: 8, cost_land7: 5,
  spell0: 0, spell1: 0, spell2: 0, spell3: 0, ...over,
});
export const ITEM = (over: Partial<ItemData> = {}): ItemData => ({
  name: 'item', price: 0, hp_heal: 0, mp_heal: 0, atk: 0, def: 0, wis: 0, mgr: 0, agi: 0, elem0: 0, elem1: 0, elem2: 0,
  range_min: 1, range_max: 1, slot: 0, use_effect: 0, weapon_type: 0, status_code: 0, race_mask: 0, ...over,
});
export const MAGIC = (over: Partial<MagicData> = {}): MagicData => ({
  name: 'magic', learn_level: 1, mp_cost: 6, elem0: 5, elem1: 0, elem2: 0, range_min: 1, range_max: 3, effect: 'BURST',
  effect_no: 1, target: 0, shape: 0, learn_mask: 1, short: '', ...over,
});

/** race 0 mage-like, 1 slime-like (strong def, low hp), 2 flying. item 0 none, 1 sword, 2 bow, 3 pike (line), 4 halberd (T), 5 armor, 6 poison dagger. magic 0 none, 1 burst (shape 1), 2 heal (shape 1, allies), 3 line (shape 2), 4 self-area (shape 3), 5 sleep (status). */
export function tables(over: Partial<Tables> = {}): Tables {
  return {
    race: [RACE(), RACE({ name: 'slime', hp: 12, hp_up: 4, str: 20, def: 22, agi: 12, size: 3 }), RACE({ name: 'bird', cost_land0: 4 })],
    item: [ITEM({ name: 'none', range_min: 0, range_max: 0 }), ITEM({ name: 'sword', atk: 10 }), ITEM({ name: 'bow', atk: 6, weapon_type: 3, range_min: 1, range_max: 7 }),
      ITEM({ name: 'pike', atk: 8, weapon_type: 1, range_min: 1, range_max: 2 }), ITEM({ name: 'halberd', atk: 9, weapon_type: 2 }),
      ITEM({ name: 'armor', slot: 1, def: 5 }), ITEM({ name: 'poison dagger', atk: 5, status_code: 2 })],
    magic: [MAGIC({ name: 'none', mp_cost: 0 }), MAGIC({ name: 'burst', shape: 1, range_min: 2, range_max: 6 }),
      MAGIC({ name: 'heal', shape: 1, target: 1, elem0: 0, elem2: 1, range_min: 0, range_max: 6, learn_mask: 2 }),
      MAGIC({ name: 'line', shape: 2, range_min: 1, range_max: 4 }), MAGIC({ name: 'area', shape: 3, range_min: 1, range_max: 2 }),
      MAGIC({ name: 'sleep', shape: 0, elem0: 0, elem1: 3, learn_level: 2 })],
    ...over,
  };
}

export function unit(over: Partial<Unit> & { slot: number }): Unit {
  return {
    id: 1, race: 0, level: 1, dir: 0, c: 0, r: 0, status: 0, side: 0, weapon: 1, armor: 0, acc: [0, 0], dropItem: 0, dropGold: 0,
    hpMax: 30, hp: 30, mpMax: 20, mp: 20, exp: 0, str: 20, def: 10, wis: 10, mgr: 10, agi: 10, spells: [],
    buff: { str: 0, def: 0, wis: 0, mgr: 0, agi: 0 }, elem: [0, 0, 0], moved: false, acted: false, special: false, statusCounter: 0,
    ...over,
  };
}

/** 50-slot unit array with each unit in its slot. */
export function units(...us: Unit[]): (Unit | null)[] {
  const out = new Array<Unit | null>(50).fill(null);
  for (const u of us) out[u.slot] = u;
  return out;
}

/** Deterministic RandomSource cycling through `values` (each already reduced: callers use them as 0..n-1). */
export function fixedRng(values: number[]): RandomSource & { calls: number } {
  let i = 0;
  return { calls: 0, rand(n: number) { this.calls++; const v = values[i++ % values.length]!; return n > 0 ? v % n : v; } };
}

/** N×N diagonal grid with every (c, r) present (w = N, h = 1 → gridSize N). `edit` overrides cell fields per position. */
export function flatMap(N: number, edit: (c: number, r: number) => Partial<MapCell> = () => ({})): MapData {
  const cells: MapCell[] = [];
  const cellAt = new Array<number>(N * N).fill(-1);
  for (let c = 0; c < N; c++) {
    for (let r = 0; r < N; r++) {
      cellAt[c * N + r] = cells.length;
      cells.push({ h: 0, blocked: 0, flag2: 0, land: 1, objs: [], ...edit(c, r) });
    }
  }
  return { w: N, h: 1, bg: null, layers: [], start: [0, 0], origin: [N * 32, 0], pixelSize: [Math.max(640, N * 64), Math.max(480, N * 32)], cells, cellAt };
}
```

- [ ] **Step 2: 실패하는 테스트**

`web/test/unit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createUnit, growUnit, itemsOf, rebuildSpells } from '../src/battle/unit';
import { fixedRng, MAGIC, RACE, tables, unit } from './helpers/battleFixtures';

const rec = { unit_id: 1, race: 0, level: 2, dir: 2, c: 36, r: 19, status: 0, side: 0, weapon: 1, armor: 5, drop_item: 0, drop_gold: 0 };

describe('createUnit (FUN_0041fae0)', () => {
  it('copies the record, applies race base stats and one deterministic growth for level 2', () => {
    const u = createUnit(rec, 0, tables(), fixedRng([0]));
    expect(u).toMatchObject({ slot: 0, id: 1, race: 0, level: 2, dir: 2, c: 36, r: 19, side: 0, weapon: 1, armor: 5, acc: [0, 0] });
    expect([u.hpMax, u.hp, u.mpMax, u.mp]).toEqual([27, 27, 27, 27]);
    expect([u.str, u.def, u.wis, u.mgr, u.agi]).toEqual([23, 18, 27, 17, 22]);
    expect(u.exp).toBe(100);
    expect(u.spells).toEqual([1]);                      // learn_mask 1, learn_level 1 ≤ 2
    expect([u.moved, u.acted]).toEqual([true, true]);   // BATTLE_START clears them
  });
  it('randomizes growth for non-party units with two draws per stat (bound check, then value)', () => {
    const rng = fixedRng([2]);                          // rand(3) = 2 → +1 every draw
    const u = createUnit({ ...rec, unit_id: 8, race: 1, level: 3, side: 4, weapon: 1, armor: 0 }, 10, tables(), rng);
    expect(u.hpMax).toBe(12 + (4 + 1) * 2);
    expect(u.str).toBe(20 + (5 + 1) * 2);
    expect(rng.calls).toBe(7 * 2 * 2);                  // 7 stats × 2 draws × 2 levels
    expect(u.spells).toEqual([]);                       // race spells all 0
  });
  it('status 1 → hp 0; other status → counter 100; monsters take race spells', () => {
    const t = tables({ race: [RACE(), RACE({ spell0: 1, spell1: 5 }), RACE()] });
    expect(createUnit({ ...rec, status: 1 }, 0, t, fixedRng([0])).hp).toBe(0);
    const m = createUnit({ ...rec, unit_id: 8, race: 1, side: 4, status: 3, level: 1 }, 10, t, fixedRng([0]));
    expect(m.statusCounter).toBe(100);
    expect(m.spells).toEqual([1, 5]);
  });
  it('side 7 objects keep zero stats', () => {
    const o = createUnit({ ...rec, unit_id: 8, race: 1, side: 7, level: 1, drop_item: 118 }, 11, tables(), fixedRng([0]));
    expect([o.hpMax, o.str, o.dropItem]).toEqual([0, 0, 118]);
  });
});

describe('growUnit / rebuildSpells (FUN_0041f7c0)', () => {
  it('caps stats at 999 and refills HP/MP unless dead', () => {
    const u = unit({ slot: 0, hpMax: 998, hp: 5, str: 999 });
    growUnit(u, RACE({ hp_up: 5, str_up: 5 }), false, fixedRng([0]), tables().magic);
    expect([u.hpMax, u.hp, u.str]).toEqual([999, 999, 999]);
    const dead = unit({ slot: 0, status: 1, hp: 0 });
    growUnit(dead, RACE(), false, fixedRng([0]), tables().magic);
    expect(dead.hp).toBe(0);
  });
  it('rebuilds party spells from learn_mask and learn_level and reports the ones learned at this level', () => {
    const magic = [MAGIC({ name: 'none', mp_cost: 0 }), MAGIC({ learn_level: 1, learn_mask: 1 }), MAGIC({ learn_level: 3, learn_mask: 1 }), MAGIC({ learn_level: 2, learn_mask: 2 })];
    const u = unit({ slot: 0, id: 1, level: 3 });
    expect(growUnit(u, RACE(), false, fixedRng([0]), magic)).toEqual([2]);
    expect(u.spells).toEqual([1, 2]);
    expect(rebuildSpells(unit({ slot: 1, id: 2, level: 2 }), magic)).toEqual([3]);
  });
  it('itemsOf returns weapon, armor and both accessories', () => {
    const t = tables();
    expect(itemsOf(unit({ slot: 0, weapon: 1, armor: 5 }), t.item).map((i) => i.name)).toEqual(['sword', 'armor', 'none', 'none']);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd web && npx vitest run test/unit.test.ts 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/battle/unit`

- [ ] **Step 4: 구현**

`web/src/battle/unit.ts`:

```ts
import { raceSpells, type ItemData, type MagicData, type RaceData, type RosterUnit, type Tables } from '../data/types';
import type { RandomSource } from './rng';

export const PARTY_SLOTS = 10;
export const MAX_SLOTS = 50;

/** The battle-relevant fields of the original 124-byte unit record (battle_rules.md §7). */
export interface Unit {
  slot: number;
  id: number; race: number; level: number; dir: 0 | 1 | 2 | 3; c: number; r: number;
  status: number; side: number;
  weapon: number; armor: number; acc: [number, number];
  dropItem: number; dropGold: number;
  hpMax: number; hp: number; mpMax: number; mp: number; exp: number;
  str: number; def: number; wis: number; mgr: number; agi: number;
  spells: number[];
  buff: { str: number; def: number; wis: number; mgr: number; agi: number };
  elem: [number, number, number];
  moved: boolean; acted: boolean; special: boolean;
  statusCounter: number;
}

export function itemsOf(u: Unit, items: ItemData[]): [ItemData, ItemData, ItemData, ItemData] {
  const at = (i: number) => items[i] ?? items[0]!;
  return [at(u.weapon), at(u.armor), at(u.acc[0]), at(u.acc[1])];
}

const STAT_PAIRS = [['hpMax', 'hp', 'hp_up'], ['mpMax', 'mp', 'mp_up'], ['str', 'str', 'str_up'], ['def', 'def', 'def_up'],
  ['wis', 'wis', 'wis_up'], ['mgr', 'mgr', 'mgr_up'], ['agi', 'agi', 'agi_up']] as const;

/** Party spell list: every magic whose learn_mask has bit (id-1) and 0 < learn_level ≤ level. Returns the ones learned exactly at this level. */
export function rebuildSpells(u: Unit, magic: MagicData[]): number[] {
  const bit = 1 << (u.id - 1);
  const learned: number[] = [];
  u.spells = [];
  magic.forEach((m, i) => {
    if (i === 0 || !(m.learn_mask & bit) || m.learn_level <= 0 || m.learn_level > u.level) return;
    u.spells.push(i);
    if (m.learn_level === u.level) learned.push(i);
  });
  return learned;
}

/** FUN_0041f7c0: one level of growth. With randomize, each stat draws rand(3)-1 twice (bound check, then value). */
export function growUnit(u: Unit, race: RaceData, randomize: boolean, rng: RandomSource, magic: MagicData[]): number[] {
  for (const [maxKey, , upKey] of STAT_PAIRS) {
    const up = race[upKey];
    const probe = u[maxKey] + up + (randomize ? rng.rand(3) - 1 : 0);
    u[maxKey] = probe < 1000 ? u[maxKey] + up + (randomize ? rng.rand(3) - 1 : 0) : 999;
  }
  if (u.status !== 1) { u.hp = u.hpMax; u.mp = u.mpMax; }
  return u.side === 0 ? rebuildSpells(u, magic) : [];
}

/** FUN_0041fae0 for a fresh slot: base stats, (level-1) growths (random only for non-party), status, exp, monster spells. */
export function createUnit(rec: RosterUnit, slot: number, tables: Tables, rng: RandomSource): Unit {
  const u: Unit = {
    slot, id: rec.unit_id, race: rec.race, level: rec.level, dir: (rec.dir & 3) as 0 | 1 | 2 | 3, c: rec.c, r: rec.r,
    status: rec.status, side: rec.side, weapon: rec.weapon, armor: rec.armor, acc: [0, 0], dropItem: rec.drop_item, dropGold: rec.drop_gold,
    hpMax: 0, hp: 0, mpMax: 0, mp: 0, exp: 0, str: 0, def: 0, wis: 0, mgr: 0, agi: 0, spells: [],
    buff: { str: 0, def: 0, wis: 0, mgr: 0, agi: 0 }, elem: [0, 0, 0], moved: true, acted: true, special: false, statusCounter: 0,
  };
  const race = tables.race[rec.race];
  if (race && rec.side !== 7) {
    u.hpMax = u.hp = race.hp; u.mpMax = u.mp = race.mp;
    u.str = race.str; u.def = race.def; u.wis = race.wis; u.mgr = race.mgr; u.agi = race.agi;
    for (let lv = 2; lv <= rec.level; lv++) growUnit(u, race, rec.side !== 0, rng, tables.magic);
    if (u.status === 1) u.hp = 0;
    else if (u.status !== 0) u.statusCounter = 100;
    u.exp = (u.level - 1) * 100;
    if (u.id > 7) u.spells = raceSpells(race).filter((m) => m !== 0);
  }
  return u;
}
```

`growUnit`의 `u[maxKey]` 대입은 `STAT_PAIRS`의 키가 `keyof Unit` 중 숫자 필드이므로 TypeScript가 허용한다. `as const` 튜플에서 두 번째 요소(현재값 키)는 쓰지 않는다(HP/MP 전회복은 뒤의 한 줄이 처리).

- [ ] **Step 5: 통과 확인**

Run: `cd web && npx vitest run test/unit.test.ts 2>&1 | tail -3`
Expected: `Tests  7 passed`

- [ ] **Step 6: 커밋**

```bash
git add web/src/battle/unit.ts web/test/unit.test.ts web/test/helpers/battleFixtures.ts
git commit -m "feat(web): unit creation and growth from roster records (FUN_0041fae0 / FUN_0041f7c0)"
```

---

### Task 5: 격자 조회

**Files:**
- Create: `web/src/battle/grid.ts`
- Test: `web/test/grid.test.ts`

**Interfaces:**
- Consumes: `MapData`, `MapCell` (하위 프로젝트 1), `Unit` (Task 4).
- Produces: `type Dir = 0 | 1 | 2 | 3`, `DIR_DELTA: readonly [number, number][]` (index = Dir, [dc, dr]), `dist(ac, ar, bc, br)`, `dirTo(ac, ar, bc, br): Dir`, `opposite(d): Dir`, `stepCell(c, r, d): [number, number]`, `incap(status): boolean`, `hostile(a: Unit, b: Unit): boolean`, `class BattleGrid { constructor(map: MapData); N; cell(c, r): MapCell | null; height(c, r): number }`, `unitAt(units, c, r): Unit | null`, `unitsWithin(units, c, r, min, max): Unit[]`, `liveUnits(units): Unit[]`.

- [ ] **Step 1: 실패하는 테스트**

`web/test/grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BattleGrid, dirTo, dist, hostile, incap, opposite, stepCell, unitAt, unitsWithin } from '../src/battle/grid';
import { flatMap, unit, units } from './helpers/battleFixtures';

describe('geometry (FUN_0041f2e0 / FUN_0041f4d0 / FUN_0041f340)', () => {
  it('Manhattan distance and direction with the |dx|>|dy| rule', () => {
    expect(dist(0, 0, 3, -2)).toBe(5);
    expect(dirTo(0, 0, 3, 1)).toBe(1);   // +x wins
    expect(dirTo(0, 0, -3, 1)).toBe(2);
    expect(dirTo(0, 0, 1, 1)).toBe(0);   // tie → y axis, dy >= 0 → 0
    expect(dirTo(0, 0, 1, -1)).toBe(3);
    expect(dirTo(0, 0, 0, 0)).toBe(0);
  });
  it('opposite is d ^ 3 and stepCell follows DIR_DELTA', () => {
    expect([0, 1, 2, 3].map((d) => opposite(d as 0 | 1 | 2 | 3))).toEqual([3, 2, 1, 0]);
    expect(stepCell(5, 5, 0)).toEqual([5, 6]);
    expect(stepCell(5, 5, 1)).toEqual([6, 5]);
    expect(stepCell(5, 5, 2)).toEqual([4, 5]);
    expect(stepCell(5, 5, 3)).toEqual([5, 4]);
  });
});

describe('hostile (FUN_0041f520) and incap', () => {
  const ally = unit({ slot: 0, side: 0 }), ally2 = unit({ slot: 1, side: 0 }), enemy = unit({ slot: 10, side: 4 });
  it('party vs non-party are hostile; same camp, side 1 and side 7 are not', () => {
    expect(hostile(ally, enemy)).toBe(true);
    expect(hostile(enemy, ally)).toBe(true);
    expect(hostile(ally, ally2)).toBe(false);
    expect(hostile(unit({ slot: 11, side: 4 }), unit({ slot: 12, side: 6 }))).toBe(false);   // both non-party
    expect(hostile(ally, unit({ slot: 13, side: 1 }))).toBe(false);
    expect(hostile(ally, unit({ slot: 14, side: 7 }))).toBe(false);
    expect(hostile(ally, ally)).toBe(false);
  });
  it('a charmed actor inverts the test', () => {
    expect(hostile(unit({ slot: 0, side: 0, status: 7 }), enemy)).toBe(false);
    expect(hostile(unit({ slot: 0, side: 0, status: 7 }), ally2)).toBe(true);
  });
  it('incapacitating statuses are 1, 3, 4, 5, 8, 9', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11].filter(incap)).toEqual([1, 3, 4, 5, 8, 9]);
  });
});

describe('BattleGrid and unit lookup', () => {
  const grid = new BattleGrid(flatMap(5, (c, r) => (c === 2 && r === 2 ? { h: 3 } : {})));
  it('returns cells inside the grid and null outside', () => {
    expect(grid.N).toBe(5);
    expect(grid.cell(2, 2)?.h).toBe(3);
    expect(grid.height(2, 2)).toBe(3);
    expect(grid.cell(5, 0)).toBeNull();
    expect(grid.cell(-1, 0)).toBeNull();
    expect(grid.height(-1, 0)).toBe(0);
  });
  it('finds units by position and by distance range in slot order, skipping hidden units', () => {
    const a = unit({ slot: 0, c: 1, r: 1 }), b = unit({ slot: 10, c: 3, r: 1, side: 4 }), hidden = unit({ slot: 11, c: 1, r: 3, status: 9, side: 4 });
    const all = units(a, b, hidden);
    expect(unitAt(all, 3, 1)).toBe(b);
    expect(unitAt(all, 1, 3)).toBeNull();
    expect(unitsWithin(all, 1, 1, 1, 2)).toEqual([b]);
    expect(unitsWithin(all, 1, 1, 0, 0)).toEqual([a]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/grid.test.ts 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/battle/grid`

- [ ] **Step 3: 구현**

`web/src/battle/grid.ts`:

```ts
import type { MapCell, MapData } from '../assets/types';
import type { Unit } from './unit';

export type Dir = 0 | 1 | 2 | 3;
/** [dc, dr] per direction: 0 = +y (south), 1 = +x (east), 2 = −x (west), 3 = −y (north). x = c, y = r (unit words 4..7). */
export const DIR_DELTA: readonly [number, number][] = [[0, 1], [1, 0], [-1, 0], [0, -1]];

export const dist = (ac: number, ar: number, bc: number, br: number): number => Math.abs(ac - bc) + Math.abs(ar - br);

/** FUN_0041f4d0: |dx| > |dy| ? (dx > 0 ? 1 : 2) : (dy >= 0 ? 0 : 3). */
export function dirTo(ac: number, ar: number, bc: number, br: number): Dir {
  const dx = bc - ac, dy = br - ar;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 2) : (dy >= 0 ? 0 : 3);
}

export const opposite = (d: Dir): Dir => (d ^ 3) as Dir;
export const stepCell = (c: number, r: number, d: Dir): [number, number] => [c + DIR_DELTA[d]![0], r + DIR_DELTA[d]![1]];

const INCAP = new Set([1, 3, 4, 5, 8, 9]);
export const incap = (status: number): boolean => INCAP.has(status);

/** FUN_0041f520: different camps (party vs non-party), never with side 1 or 7, inverted while the actor is charmed (7). */
export function hostile(a: Unit, b: Unit): boolean {
  if (a === b || a.side === 7 || b.side === 7 || a.side === 1 || b.side === 1) return false;
  const h = (a.side === 0) !== (b.side === 0);
  return a.status === 7 ? !h : h;
}

export class BattleGrid {
  readonly N: number;
  constructor(readonly map: MapData) {
    this.N = map.w + map.h - 1;
  }
  cell(c: number, r: number): MapCell | null {
    if (c < 0 || r < 0 || c >= this.N || r >= this.N) return null;
    const i = this.map.cellAt[c * this.N + r]!;
    return i < 0 ? null : this.map.cells[i]!;
  }
  height(c: number, r: number): number {
    return this.cell(c, r)?.h ?? 0;
  }
}

const visible = (u: Unit | null): u is Unit => u !== null && u.id !== 0 && (u.status !== 9 || u.id === 8);

export const liveUnits = (units: (Unit | null)[]): Unit[] => units.filter((u): u is Unit => u !== null);

/** FUN_0041f5f0 mode 5: the unit standing on (c, r); hidden units (status 9) are skipped unless id 8. */
export function unitAt(units: (Unit | null)[], c: number, r: number): Unit | null {
  return units.find((u) => visible(u) && u.c === c && u.r === r) ?? null;
}

/** FUN_0041f5f0 mode 7: units with min ≤ dist ≤ max from (c, r), slot order. */
export function unitsWithin(units: (Unit | null)[], c: number, r: number, min: number, max: number): Unit[] {
  return units.filter((u): u is Unit => visible(u) && dist(u.c, u.r, c, r) >= min && dist(u.c, u.r, c, r) <= max);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/grid.test.ts 2>&1 | tail -3`
Expected: `Tests  6 passed`

- [ ] **Step 5: 커밋**

```bash
git add web/src/battle/grid.ts web/test/grid.test.ts
git commit -m "feat(web): battle grid queries, direction and hostility rules"
```

---

### Task 6: 이동 범위, 대상 표시, 경로

**Files:**
- Create: `web/src/battle/moveRange.ts`
- Test: `web/test/moveRange.test.ts`

**Interfaces:**
- Consumes: Task 4 `Unit`, Task 5 grid 함수, Task 2 `costLand`, `Tables`.
- Produces: `RANGE_SIZE = 21`, `MOVE_BUDGET = 30`, `type TargetKind = 0 | 1 | 2`, `class RangeTable { constructor(cx, cy); index(c, r): number; moveAt(c, r): number; kindAt(c, r): TargetKind; setMove; setKind; cells(): Iterable<{ c; r; move; kind }> }`, `computeMoveRange(grid, units, unit, race): RangeTable`, `markTargets(table, grid, units, unit, action, tables): number`, `pathTo(table, grid, unit, race, dest: [c, r]): Dir[]`, `canStop(table, units, unit, c, r): boolean`.

- [ ] **Step 1: 실패하는 테스트**

`web/test/moveRange.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { canStop, computeMoveRange, markTargets, pathTo, RangeTable } from '../src/battle/moveRange';
import { flatMap, RACE, tables, unit, units } from './helpers/battleFixtures';

const race = RACE();   // cost_land1 = 5, climb 4, drop 4

describe('RangeTable', () => {
  it('maps a 21×21 window around the center and reports outside as -1 / 0', () => {
    const t = new RangeTable(10, 10);
    expect(t.index(10, 10)).toBe(10 * 21 + 10);
    expect(t.index(0, 20)).toBe(0);
    expect(t.index(21, 10)).toBe(-1);
    t.setMove(12, 9, 7);
    expect(t.moveAt(12, 9)).toBe(7);
    expect(t.moveAt(99, 99)).toBe(0);
  });
});

describe('computeMoveRange (FUN_00439690 / FUN_00439b40)', () => {
  it('spends land cost per step from a budget of 30', () => {
    const grid = new BattleGrid(flatMap(7));
    const u = unit({ slot: 0, c: 3, r: 3 });
    const t = computeMoveRange(grid, units(u), u, race);
    expect(t.moveAt(3, 3)).toBe(30);
    expect(t.moveAt(4, 3)).toBe(25);
    expect(t.moveAt(6, 3)).toBe(15);
    expect(t.moveAt(6, 5)).toBe(5);     // distance 5
    expect(t.moveAt(6, 6)).toBe(0);     // distance 6 → 30 − 30 = 0 → not reachable
  });
  it('detours around blocked cells and ignores height within climb/drop limits', () => {
    const grid = new BattleGrid(flatMap(7, (c, r) => (c === 4 && r === 3 ? { blocked: 1 } : c === 2 && r === 3 ? { h: 5 } : c === 3 && r === 2 ? { h: 4 } : {})));
    const u = unit({ slot: 0, c: 3, r: 3 });
    const t = computeMoveRange(grid, units(u), u, race);
    expect(t.moveAt(4, 3)).toBe(0);
    expect(t.moveAt(5, 3)).toBe(10);    // four steps around the block
    expect(t.moveAt(2, 3)).toBe(0);     // climb 5 > 4
    expect(t.moveAt(3, 2)).toBe(25);    // climb 4 allowed
  });
  it('a cell next to a hostile unit keeps only 1 move point (ZOC) and flag2 cells cost nothing', () => {
    const grid = new BattleGrid(flatMap(7, (c, r) => (c === 3 && r === 4 ? { flag2: 1 } : {})));
    const u = unit({ slot: 0, c: 3, r: 3 });
    const e = unit({ slot: 10, c: 5, r: 3, side: 4 });
    const t = computeMoveRange(grid, units(u, e), u, race);
    expect(t.moveAt(4, 3)).toBe(1);
    expect(t.moveAt(3, 4)).toBe(30);
    expect(t.moveAt(5, 3)).toBe(0);     // occupied cells cost 0 but ZOC stops at (4,3); reached via (4,4)/(5,4)? (5,4) is adjacent to e → 1, so (5,3) stays 0
  });
  it('a unit that already moved, is incapacitated, or has side 3 only owns its cell', () => {
    const grid = new BattleGrid(flatMap(5));
    for (const u of [unit({ slot: 0, c: 2, r: 2, moved: true }), unit({ slot: 0, c: 2, r: 2, status: 3 }), unit({ slot: 10, c: 2, r: 2, side: 3 })]) {
      const t = computeMoveRange(grid, units(u), u, race);
      expect(t.moveAt(2, 2)).toBe(30);
      expect(t.moveAt(3, 2)).toBe(0);
    }
  });
  it('flying races ignore height limits and enter land 0', () => {
    const grid = new BattleGrid(flatMap(5, (c, r) => (c === 3 && r === 2 ? { h: 20, land: 0 } : {})));
    const u = unit({ slot: 0, c: 2, r: 2, race: 2 });
    const t = computeMoveRange(grid, units(u), u, RACE({ cost_land0: 4 }));
    expect(t.moveAt(3, 2)).toBe(26);
  });
});

describe('markTargets', () => {
  it('marks hostile units in weapon range as kind 1 and skips allies', () => {
    const grid = new BattleGrid(flatMap(7));
    const u = unit({ slot: 0, c: 3, r: 3, weapon: 1 });
    const e = unit({ slot: 10, c: 4, r: 3, side: 4 }), far = unit({ slot: 11, c: 5, r: 3, side: 4 }), a = unit({ slot: 1, c: 3, r: 4 });
    const t = computeMoveRange(grid, units(u, e, far, a), u, race);
    expect(markTargets(t, grid, units(u, e, far, a), u, 0, tables())).toBe(1);
    expect(t.kindAt(4, 3)).toBe(1);
    expect(t.kindAt(5, 3)).toBe(0);
    expect(t.kindAt(3, 4)).toBe(0);
  });
  it('keeps the original quirk: a melee target more than 4 high ends the scan before later targets', () => {
    const grid = new BattleGrid(flatMap(7, (c, r) => (c === 4 && r === 3 ? { h: 6 } : {})));
    const u = unit({ slot: 0, c: 3, r: 3, weapon: 1 });
    const high = unit({ slot: 10, c: 4, r: 3, side: 4 }), low = unit({ slot: 11, c: 2, r: 3, side: 4 });
    const t = computeMoveRange(grid, units(u, high, low), u, race);
    expect(markTargets(t, grid, units(u, high, low), u, 0, tables())).toBe(0);
    expect(t.kindAt(2, 3)).toBe(0);
    const bowman = unit({ slot: 0, c: 3, r: 3, weapon: 2 });
    const t2 = computeMoveRange(grid, units(bowman, high, low), bowman, race);
    expect(markTargets(t2, grid, units(bowman, high, low), bowman, 0, tables())).toBe(2);
  });
  it('line weapons need a shared row or column; nothing is marked after acting', () => {
    const grid = new BattleGrid(flatMap(7));
    const u = unit({ slot: 0, c: 3, r: 3, weapon: 3 });
    const diag = unit({ slot: 10, c: 4, r: 4, side: 4 }), inline = unit({ slot: 11, c: 3, r: 5, side: 4 });
    const t = computeMoveRange(grid, units(u, diag, inline), u, race);
    expect(markTargets(t, grid, units(u, diag, inline), u, 0, tables())).toBe(1);
    expect(t.kindAt(3, 5)).toBe(1);
    expect(markTargets(new RangeTable(3, 3), grid, units(u, inline), { ...u, acted: true }, 0, tables())).toBe(0);
  });
  it('magic shape 1 marks every floor cell in range as kind 1 (enemies) or 2 (allies); shape 2 walks four lines', () => {
    const grid = new BattleGrid(flatMap(13, (c, r) => (c === 6 && r === 9 ? { blocked: 1 } : {})));
    const u = unit({ slot: 0, c: 6, r: 6 });
    const t = new RangeTable(6, 6);
    markTargets(t, grid, units(u), u, 1, tables());          // burst: range 2..6
    expect(t.kindAt(6, 6)).toBe(0);
    expect(t.kindAt(7, 6)).toBe(0);
    expect(t.kindAt(8, 6)).toBe(1);
    expect(t.kindAt(6, 9)).toBe(0);                            // blocked
    expect(t.kindAt(6, 12)).toBe(1);
    const heal = new RangeTable(6, 6);
    markTargets(heal, grid, units(u), u, 2, tables());
    expect(heal.kindAt(6, 6)).toBe(2);
    const line = new RangeTable(6, 6);
    expect(markTargets(line, grid, units(u), u, 3, tables())).toBe(12);   // range 1..4 → steps 1..3 in 4 directions
    expect(line.kindAt(6, 9)).toBe(1);                         // shape 2 does not check blocked
    expect(line.kindAt(7, 7)).toBe(0);
  });
});

describe('pathTo (FUN_00438960) and canStop', () => {
  it('walks back along increasing move points and prefers the previous direction on ties', () => {
    const grid = new BattleGrid(flatMap(7));
    const u = unit({ slot: 0, c: 3, r: 3 });
    const t = computeMoveRange(grid, units(u), u, race);
    expect(pathTo(t, grid, u, race, [5, 3])).toEqual([1, 1]);
    expect(pathTo(t, grid, u, race, [3, 3])).toEqual([]);
    const p = pathTo(t, grid, u, race, [5, 5]);
    expect(p).toHaveLength(4);
    expect(p.filter((d) => d === 1)).toHaveLength(2);
  });
  it('routes around a blocked cell; the blocked cell itself is not a stop', () => {
    const grid = new BattleGrid(flatMap(7, (c, r) => (c === 4 && r === 3 ? { blocked: 1 } : {})));
    const u = unit({ slot: 0, c: 3, r: 3 });
    const t = computeMoveRange(grid, units(u), u, race);
    const p = pathTo(t, grid, u, race, [5, 3]);
    expect(p).toHaveLength(4);
    expect(p.includes(0) || p.includes(3)).toBe(true);
    expect(canStop(t, units(u), u, 4, 3)).toBe(false);        // pathTo is only called for cells canStop accepts
  });
  it('canStop needs move points and an empty cell, own cell or a treasure object', () => {
    const grid = new BattleGrid(flatMap(7));
    const u = unit({ slot: 0, c: 3, r: 3 });
    const ally = unit({ slot: 1, c: 4, r: 3 }), chest = unit({ slot: 20, c: 3, r: 4, id: 8, side: 7, race: 8 });
    const all = units(u, ally, chest);
    const t = computeMoveRange(grid, all, u, race);
    expect(canStop(t, all, u, 3, 3)).toBe(true);
    expect(canStop(t, all, u, 4, 3)).toBe(false);
    expect(canStop(t, all, u, 3, 4)).toBe(true);
    expect(canStop(t, all, u, 0, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/moveRange.test.ts 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/battle/moveRange`

- [ ] **Step 3: 구현**

`web/src/battle/moveRange.ts`:

```ts
import { costLand, type RaceData, type Tables } from '../data/types';
import { dist, hostile, incap, opposite, stepCell, unitAt, unitsWithin, type BattleGrid, type Dir } from './grid';
import type { Unit } from './unit';

export const RANGE_SIZE = 21;
const HALF = 10;
export const MOVE_BUDGET = 30;
export type TargetKind = 0 | 1 | 2;   // 1 = attack/enemy cell, 2 = friend cell (FUN_00439690)

/** 21×21 window of (remaining move, target kind) around the acting unit (DAT_0044c4b0). */
export class RangeTable {
  readonly move = new Int16Array(RANGE_SIZE * RANGE_SIZE);
  readonly kind = new Uint8Array(RANGE_SIZE * RANGE_SIZE);
  constructor(readonly cx: number, readonly cy: number) {}

  index(c: number, r: number): number {
    const dx = c - this.cx + HALF, dy = r - this.cy + HALF;
    return dx < 0 || dy < 0 || dx >= RANGE_SIZE || dy >= RANGE_SIZE ? -1 : dx * RANGE_SIZE + dy;
  }
  moveAt(c: number, r: number): number { const i = this.index(c, r); return i < 0 ? 0 : this.move[i]!; }
  kindAt(c: number, r: number): TargetKind { const i = this.index(c, r); return i < 0 ? 0 : (this.kind[i] as TargetKind); }
  setMove(c: number, r: number, v: number): void { const i = this.index(c, r); if (i >= 0) this.move[i] = v; }
  setKind(c: number, r: number, k: TargetKind): void { const i = this.index(c, r); if (i >= 0) this.kind[i] = k; }

  *cells(): Iterable<{ c: number; r: number; move: number; kind: TargetKind }> {
    for (let dx = 0; dx < RANGE_SIZE; dx++) {
      for (let dy = 0; dy < RANGE_SIZE; dy++) {
        const i = dx * RANGE_SIZE + dy;
        if (this.move[i] !== 0 || this.kind[i] !== 0) yield { c: this.cx + dx - HALF, r: this.cy + dy - HALF, move: this.move[i]!, kind: this.kind[i] as TargetKind };
      }
    }
  }
}

const flies = (race: RaceData, u: Unit) => race.cost_land0 !== 99 || u.status === 11;

/** FUN_00439690(unit, 0) + FUN_00439b40: budget 30, land cost per cell, climb/drop limits, ZOC (file_formats.md §8). */
export function computeMoveRange(grid: BattleGrid, units: (Unit | null)[], unit: Unit, race: RaceData): RangeTable {
  const t = new RangeTable(unit.c, unit.r);
  t.setMove(unit.c, unit.r, MOVE_BUDGET);
  if (unit.side === 3 || unit.moved || incap(unit.status)) return t;
  const cost = costLand(race);
  const fly = flies(race, unit);
  const inZoc = (c: number, r: number, h: number) => units.some((v) => v && v !== unit && hostile(unit, v) && !incap(v.status)
    && dist(v.c, v.r, c, r) === 1 && Math.abs(grid.height(v.c, v.r) - h) < 8);
  const visit = (c: number, r: number, remaining: number): void => {
    if (remaining < 2) return;
    const hc = grid.height(c, r);
    for (let d = 0; d < 4; d++) {
      const [nc, nr] = stepCell(c, r, d as Dir);
      const cell = grid.cell(nc, nr);
      if (!cell || t.index(nc, nr) < 0) continue;
      let k = cell.blocked ? 99 : cell.flag2 !== 0 || unitAt(units, nc, nr) ? 0 : cost[cell.land] ?? 99;
      if (unit.status === 11 && cell.land === 0 && !cell.blocked) k = race.cost_land1;
      if (unit.status === 10) k -= 1;
      if (k >= 99) continue;
      if (!fly) {
        const dh = cell.h - hc;
        if (dh > race.climb_max || -dh > race.drop_max) continue;
      }
      let left = remaining - k;
      if (left < 1 || left <= t.moveAt(nc, nr)) continue;
      if (inZoc(nc, nr, cell.h)) left = 1;
      t.setMove(nc, nr, left);
      visit(nc, nr, left);
    }
  };
  visit(unit.c, unit.r, MOVE_BUDGET);
  return t;
}

/** FUN_00439690: action 0 marks physical targets (with the original early-return height quirk); a magic index marks its range. Returns the count. */
export function markTargets(t: RangeTable, grid: BattleGrid, units: (Unit | null)[], unit: Unit, action: number, tables: Tables): number {
  let n = 0;
  if (action === 0) {
    if (unit.acted) return 0;
    const w = tables.item[unit.weapon]!;
    for (const v of unitsWithin(units, unit.c, unit.r, w.range_min, w.range_max)) {
      if (w.weapon_type !== 3 && Math.abs(grid.height(unit.c, unit.r) - grid.height(v.c, v.r)) > 4) return n;   // original: whole function returns
      if (hostile(unit, v) && t.index(v.c, v.r) >= 0 && (w.weapon_type !== 1 || v.c === unit.c || v.r === unit.r)) {
        t.setKind(v.c, v.r, 1);
        n++;
      }
    }
    return n;
  }
  const m = tables.magic[action]!;
  const kind: TargetKind = m.target === 1 ? 2 : 1;
  if (m.shape === 0 || m.shape === 1 || m.shape === 3) {
    for (let dx = -HALF; dx <= HALF; dx++) {
      for (let dy = -HALF; dy <= HALF; dy++) {
        const c = unit.c + dx, r = unit.r + dy, d = Math.abs(dx) + Math.abs(dy);
        const cell = grid.cell(c, r);
        if (cell && cell.blocked === 0 && d >= m.range_min && d <= m.range_max) { t.setKind(c, r, kind); n++; }
      }
    }
  } else if (m.shape === 2 || m.shape === 5) {
    for (let d = 0; d < 4; d++) {
      let c = unit.c, r = unit.r, prev = grid.cell(c, r);
      for (let step = 1; step < m.range_max; step++) {
        [c, r] = stepCell(c, r, d as Dir);
        const cell = grid.cell(c, r);
        if (!cell) break;
        if (step >= m.range_min) {
          if (action === 60 && (cell.flag2 !== 0 || cell.h !== (prev?.h ?? 0))) break;
          if (action === 62 && (cell.flag2 !== 0 || cell.h > (prev?.h ?? 0))) break;
          if (t.index(c, r) >= 0) { t.setKind(c, r, kind); n++; }
        }
        prev = cell;
      }
    }
  }
  return n;
}

/** Movable destination: has move points and holds nobody, the unit itself, or a treasure object (FUN_00438c70). */
export function canStop(t: RangeTable, units: (Unit | null)[], unit: Unit, c: number, r: number): boolean {
  if (t.moveAt(c, r) === 0) return false;
  const v = unitAt(units, c, r);
  return !v || v === unit || (v.side === 7 && v.id === 8);
}

/** FUN_00438960: from dest back to the unit, always stepping to a neighbour with more move points (ties keep the previous direction). */
export function pathTo(t: RangeTable, grid: BattleGrid, unit: Unit, race: RaceData, dest: [number, number]): Dir[] {
  let [c, r] = dest;
  const back: Dir[] = [];
  let prevDir = -1;
  const limit = flies(race, unit) ? 99 : null;
  while (c !== unit.c || r !== unit.r) {
    if (back.length >= 30) return [];
    let best = -1, bestMove = t.moveAt(c, r);
    const hc = grid.height(c, r);
    for (let d = 0; d < 4; d++) {
      const [nc, nr] = stepCell(c, r, d as Dir);
      if (t.index(nc, nr) < 0 || !grid.cell(nc, nr)) continue;
      const hn = grid.height(nc, nr);
      if (hc - hn > (limit ?? race.climb_max) || hn - hc > (limit ?? race.drop_max)) continue;
      const mv = t.moveAt(nc, nr);
      if (mv > bestMove || (mv === bestMove && d === prevDir)) { best = d; bestMove = mv; }
    }
    if (best < 0) return [];
    back.push(opposite(best as Dir));
    [c, r] = stepCell(c, r, best as Dir);
    prevDir = best;
  }
  return back.reverse();
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/moveRange.test.ts 2>&1 | tail -3`
Expected: `Tests  12 passed`. 기대값이 어긋나면 셀 수 세기(`dist`)부터 다시 확인한다. 특히 ZOC 테스트의 `(5,3)`은 (4,3)·(5,4)·(5,2)·(6,3)가 모두 적에 인접(이동력 1)이라 0이다.

- [ ] **Step 5: 커밋**

```bash
git add web/src/battle/moveRange.ts web/test/moveRange.test.ts
git commit -m "feat(web): 21x21 move/target range table, path reconstruction and stop rule"
```

---
### Task 7: 행동 대상 목록

**Files:**
- Create: `web/src/battle/targets.ts`
- Test: `web/test/targets.test.ts`

**Interfaces:**
- Consumes: Task 5 grid 함수, Task 4 `Unit`, Task 2 `Tables`.
- Produces: `magicRadius(unit: Unit, magic: MagicData): number` (FUN_0043e350), `canAttack(grid, fromC, fromR, actor, target, weapon): boolean` (FUN_00412a80), `targetsOf(grid, units, actor, action, cell: [number, number], tables): Unit[]` (FUN_00438d70; 행동자는 이미 `cell`을 바라본다).

- [ ] **Step 1: 실패하는 테스트**

`web/test/targets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { canAttack, magicRadius, targetsOf } from '../src/battle/targets';
import { flatMap, MAGIC, tables, unit, units } from './helpers/battleFixtures';

const t = tables();
const grid = new BattleGrid(flatMap(9, (c, r) => (c === 6 && r === 4 ? { h: 6 } : {})));

describe('magicRadius (FUN_0043e350)', () => {
  it('grows with level − learn_level: ≥20 → 2, ≥10 → 1, else 0', () => {
    expect(magicRadius(unit({ slot: 0, level: 2 }), MAGIC({ learn_level: 1 }))).toBe(0);
    expect(magicRadius(unit({ slot: 0, level: 11 }), MAGIC({ learn_level: 1 }))).toBe(1);
    expect(magicRadius(unit({ slot: 0, level: 25 }), MAGIC({ learn_level: 5 }))).toBe(2);
  });
});

describe('canAttack (FUN_00412a80)', () => {
  const a = unit({ slot: 0, c: 4, r: 4, dir: 1 });
  it('needs a hostile living non-object target; melee refuses |Δh| > 4; line weapons need alignment', () => {
    const e = unit({ slot: 10, c: 5, r: 4, side: 4 });
    expect(canAttack(grid, 4, 4, a, e, t.item[1]!)).toBe(true);
    expect(canAttack(grid, 4, 4, a, unit({ slot: 1, c: 5, r: 4 }), t.item[1]!)).toBe(false);
    expect(canAttack(grid, 4, 4, a, { ...e, status: 1 }, t.item[1]!)).toBe(false);
    expect(canAttack(grid, 5, 4, a, { ...e, c: 6 }, t.item[1]!)).toBe(false);     // target on h 6
    expect(canAttack(grid, 5, 4, a, { ...e, c: 6 }, t.item[2]!)).toBe(true);      // bow ignores height
    expect(canAttack(grid, 4, 4, a, { ...e, c: 5, r: 5 }, t.item[3]!)).toBe(false); // pike needs same row/col
    expect(canAttack(grid, 4, 4, a, { ...e, c: 5, r: 4 }, t.item[3]!)).toBe(true);
  });
});

describe('targetsOf (FUN_00438d70)', () => {
  it('single weapons hit the unit on the clicked cell; bows too', () => {
    const a = unit({ slot: 0, c: 4, r: 4, dir: 1, weapon: 1 });
    const e = unit({ slot: 10, c: 5, r: 4, side: 4 });
    expect(targetsOf(grid, units(a, e), a, 0, [5, 4], t)).toEqual([e]);
    expect(targetsOf(grid, units(a, e), a, 0, [6, 6], t)).toEqual([]);
  });
  it('line weapons hit everything in the facing line within range, dropping dead, objects and |Δh| > 4', () => {
    const a = unit({ slot: 0, c: 4, r: 4, dir: 1, weapon: 3 });                   // pike 1..2
    const e1 = unit({ slot: 10, c: 5, r: 4, side: 4 }), e2 = unit({ slot: 11, c: 6, r: 4, side: 4 });   // e2 stands on h 6
    const ally = unit({ slot: 1, c: 5, r: 4 });
    expect(targetsOf(grid, units(a, e1, e2), a, 0, [5, 4], t)).toEqual([e1]);
    expect(targetsOf(grid, units(a, ally), a, 0, [5, 4], t)).toEqual([ally]);     // friendly fire is possible
    expect(targetsOf(grid, units(a, { ...e1, status: 1 }), a, 0, [5, 4], t)).toEqual([]);
  });
  it('T-shaped weapons hit front, left and right of the actor', () => {
    const a = unit({ slot: 0, c: 4, r: 4, dir: 0, weapon: 4 });                   // facing +r
    const front = unit({ slot: 10, c: 4, r: 5, side: 4 }), left = unit({ slot: 11, c: 3, r: 4, side: 4 }), right = unit({ slot: 12, c: 5, r: 4, side: 4 }), behind = unit({ slot: 13, c: 4, r: 3, side: 4 });
    expect(targetsOf(grid, units(a, front, left, right, behind), a, 0, [4, 5], t).map((u) => u.slot).sort()).toEqual([10, 11, 12]);
  });
  it('magic shape 0/1 takes units around the clicked cell within the radius, filtered by target camp', () => {
    const a = unit({ slot: 0, c: 4, r: 4, level: 11 });
    const e1 = unit({ slot: 10, c: 7, r: 4, side: 4 }), e2 = unit({ slot: 11, c: 7, r: 5, side: 4 }), ally = unit({ slot: 1, c: 7, r: 3 });
    const magic = t.magic.slice(); magic[1] = MAGIC({ shape: 1, range_min: 2, range_max: 6 }); magic[2] = MAGIC({ shape: 1, target: 1, range_min: 0, range_max: 6 });
    const tt = { ...t, magic };
    expect(targetsOf(grid, units(a, e1, e2, ally), a, 1, [7, 4], tt).map((u) => u.slot).sort()).toEqual([10, 11]);   // radius 1 at level 11
    expect(targetsOf(grid, units(a, e1, e2, ally), { ...a, level: 2 }, 1, [7, 4], tt)).toEqual([e1]);
    expect(targetsOf(grid, units(a, e1, e2, ally), a, 2, [7, 3], tt)).toEqual([ally]);
  });
  it('shape 3 centers on the caster, shape 4 takes the whole map, resurrection takes only the dead', () => {
    const a = unit({ slot: 0, c: 4, r: 4 });
    const near = unit({ slot: 10, c: 5, r: 4, side: 4 }), far = unit({ slot: 11, c: 8, r: 8, side: 4 }), dead = unit({ slot: 1, c: 2, r: 2, status: 1, hp: 0 });
    const magic = t.magic.slice(); magic[4] = MAGIC({ shape: 3, range_min: 1, range_max: 2 }); magic[28] = MAGIC({ shape: 4 }); magic[41] = MAGIC({ shape: 1, target: 1, range_min: 0, range_max: 6 });
    const tt = { ...t, magic };
    expect(targetsOf(grid, units(a, near, far, dead), a, 4, [4, 4], tt)).toEqual([near]);
    expect(targetsOf(grid, units(a, near, far, dead), a, 28, [4, 4], tt).map((u) => u.slot)).toEqual([10, 11]);
    expect(targetsOf(grid, units(a, near, far, dead), a, 41, [2, 2], tt)).toEqual([dead]);
  });
  it('shape 2 walks the facing line and stops at the first unit for magic 62; drain adds the caster last', () => {
    const a = unit({ slot: 0, c: 4, r: 4, dir: 1 });
    const e1 = unit({ slot: 10, c: 6, r: 4, side: 4 }), e2 = unit({ slot: 11, c: 7, r: 4, side: 4 });
    const magic = t.magic.slice(); magic[3] = MAGIC({ shape: 2, range_min: 1, range_max: 4 }); magic[62] = MAGIC({ shape: 2, range_min: 1, range_max: 4 }); magic[55] = MAGIC({ shape: 0, range_min: 1, range_max: 3 });
    const tt = { ...t, magic };
    expect(targetsOf(grid, units(a, e1, e2), a, 3, [5, 4], tt).map((u) => u.slot)).toEqual([10, 11]);
    expect(targetsOf(grid, units(a, e1, e2), a, 62, [5, 4], tt).map((u) => u.slot)).toEqual([10]);
    expect(targetsOf(grid, units(a, e1), a, 55, [6, 4], tt).map((u) => u.slot)).toEqual([10, 0]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/targets.test.ts 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/battle/targets`

- [ ] **Step 3: 구현**

`web/src/battle/targets.ts`:

```ts
import type { ItemData, MagicData, Tables } from '../data/types';
import { dirTo, dist, hostile, stepCell, unitAt, type BattleGrid, type Dir } from './grid';
import type { Unit } from './unit';

/** FUN_0043e350: shape-1 radius from level − learn_level. */
export function magicRadius(unit: Unit, magic: MagicData): number {
  const d = unit.level - magic.learn_level;
  return d >= 20 ? 2 : d >= 10 ? 1 : 0;
}

/** FUN_00412a80: hostile, alive, not an object; melee needs |Δh| ≤ 4 (bows ignore height); line weapons need a shared row or column. */
export function canAttack(grid: BattleGrid, fromC: number, fromR: number, actor: Unit, target: Unit, weapon: ItemData): boolean {
  if (!hostile(actor, target) || target.status === 1 || target.side === 7) return false;
  if (weapon.weapon_type !== 3 && Math.abs(grid.height(fromC, fromR) - grid.height(target.c, target.r)) > 4) return false;
  if (weapon.weapon_type === 1 && target.c !== fromC && target.r !== fromR) return false;
  return true;
}

const perpendicular = (d: Dir): [Dir, Dir] => (d === 0 || d === 3 ? [1, 2] : [0, 3]);
const alive = (u: Unit) => u.status !== 1 && u.side !== 7;
const campOk = (actor: Unit, u: Unit, magic: MagicData) => magic.target === 2 || hostile(actor, u) === (magic.target === 0);

/** FUN_00438d70: the units an action at `cell` affects. The actor already faces `cell`. */
export function targetsOf(grid: BattleGrid, units: (Unit | null)[], actor: Unit, action: number, cell: [number, number], tables: Tables): Unit[] {
  const out: Unit[] = [];
  const hA = grid.height(actor.c, actor.r);
  if (action === 0) {
    const w = tables.item[actor.weapon]!;
    if (w.weapon_type === 1) {
      let c = actor.c, r = actor.r;
      for (let step = 1; step <= w.range_max; step++) {
        [c, r] = stepCell(c, r, actor.dir);
        if (step < w.range_min) continue;
        const u = unitAt(units, c, r);
        if (u && alive(u) && Math.abs(grid.height(c, r) - hA) <= 4) out.push(u);
      }
    } else if (w.weapon_type === 2) {
      for (const d of [actor.dir, ...perpendicular(actor.dir)]) {
        const [c, r] = stepCell(actor.c, actor.r, d);
        const u = unitAt(units, c, r);
        if (u && alive(u) && Math.abs(grid.height(c, r) - hA) <= 4) out.push(u);
      }
    } else {
      const u = unitAt(units, cell[0], cell[1]);
      if (u) out.push(u);
    }
    return out;
  }
  const m = tables.magic[action]!;
  if (m.shape === 2) {
    let c = actor.c, r = actor.r, prevH = hA;
    for (let step = 1; step <= m.range_max; step++) {
      [c, r] = stepCell(c, r, actor.dir);
      const cellData = grid.cell(c, r);
      if (!cellData) break;
      const dh = cellData.h - prevH;
      if (action === 60 && (cellData.flag2 !== 0 || dh !== 0)) break;
      if (action === 62 && cellData.h - hA > 0) break;
      if (action === 77 && (cellData.flag2 !== 0 || dh > 0)) break;
      if (step >= m.range_min) {
        const u = unitAt(units, c, r);
        if (u && alive(u) && campOk(actor, u, m)) {
          out.push(u);
          if (action === 62) break;      // the original stops after a hit unless the line dropped 5 or more
        }
      }
      prevH = cellData.h;
    }
  } else {
    let center = cell, min = 0, max = 0;
    if (m.shape === 1) max = magicRadius(actor, m);
    else if (m.shape === 3 || m.shape === 5) { center = [actor.c, actor.r]; min = m.range_min; max = m.range_max; }
    else if (m.shape === 4) max = 9999;
    for (const u of units) {
      if (!u || u.id === 0 || (u.status === 9 && u.id !== 8) || u.side === 7 && action !== 41 && action !== 64) continue;
      if (!campOk(actor, u, m)) continue;
      const d = dist(u.c, u.r, center[0], center[1]);
      if (d < min || d > max) continue;
      if (m.shape === 5) {
        if (u.c !== center[0] && u.r !== center[1]) continue;
        const dd = dirTo(center[0], center[1], u.c, u.r);
        if (dd !== actor.dir && dd !== (actor.dir ^ 3)) continue;
      }
      if (action === 41) { if (u.status === 1 || u.side === 7) out.push(u); }
      else if (action === 64 || alive(u)) out.push(u);
    }
  }
  if (action === 55 || action === 81) out.push(actor);
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/targets.test.ts 2>&1 | tail -3`
Expected: `Tests  8 passed`

- [ ] **Step 5: 커밋**

```bash
git add web/src/battle/targets.ts web/test/targets.test.ts
git commit -m "feat(web): action target selection for weapons and magic shapes (FUN_00438d70)"
```

---

### Task 8: 물리 공격 판정

**Files:**
- Create: `web/src/battle/resolve.ts`
- Test: `web/test/resolvePhysical.test.ts`

**Interfaces:**
- Consumes: Task 4 `Unit`, `itemsOf`; Task 5 `dirTo`, `incap`, `BattleGrid`; Task 3 `RandomSource`; Task 2 `elems`.
- Produces: `interface Hit { target: number; kind: 'damage' | 'heal' | 'miss' | 'status' | 'cure' | 'buff' | 'none'; value: number; crit: boolean; popup: string; statusAfter: number }`, `interface ResolveContext { tables: Tables; grid: BattleGrid; units: (Unit | null)[]; rng: RandomSource; dash: boolean }`, `totals(u, items): { atk; def; wis; mgr; agi }`, `elemTotal(u, race, items, axis): number`, `roll(a, b, base, rng): boolean`, `statusOk(t): boolean`, `resolvePhysical(actor, target, ctx): Hit`, `resolveAction(actor, action, targets, ctx): Hit[]` (Task 9가 마법 분기를 채운다; 이 작업에서는 action 0만).

- [ ] **Step 1: 실패하는 테스트**

`web/test/resolvePhysical.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { resolveAction, resolvePhysical, roll, totals, type ResolveContext } from '../src/battle/resolve';
import { fixedRng, flatMap, ITEM, RACE, tables, unit, units } from './helpers/battleFixtures';

const grid = new BattleGrid(flatMap(9, (c, r) => (c === 2 && r === 4 ? { h: 2 } : {})));
const ctx = (rng: number[], over: Partial<ResolveContext> = {}): ResolveContext => ({ tables: tables(), grid, units: units(), rng: fixedRng(rng), dash: false, ...over });
/** attacker at (4,4) facing east, target at (5,4). */
const attacker = (over = {}) => unit({ slot: 0, c: 4, r: 4, dir: 1, str: 20, weapon: 1, ...over });
const target = (over = {}) => unit({ slot: 10, c: 5, r: 4, dir: 0, def: 10, hp: 30, side: 4, id: 8, ...over });

describe('totals and roll (FUN_0043dd90)', () => {
  it('sums weapon/accessory attack, armor/accessory defense and all four items for agi/wis/mgr', () => {
    const t = tables();
    const u = unit({ slot: 0, str: 20, def: 10, agi: 10, weapon: 1, armor: 5, buff: { str: 2, def: 0, wis: 0, mgr: 0, agi: 1 } });
    const items = [t.item[1]!, t.item[5]!, t.item[0]!, t.item[0]!] as const;
    expect(totals(u, items)).toEqual({ atk: 32, def: 15, wis: 10, mgr: 10, agi: 11 });
  });
  it('chance = agi(a) * m / agi(b): ×3 vs incapacitated, ×2 from behind, +50% from the side', () => {
    const a = unit({ slot: 0, agi: 10, dir: 1 });
    const front = unit({ slot: 10, agi: 10, dir: 2 }), side = unit({ slot: 11, agi: 10, dir: 0 }), back = unit({ slot: 12, agi: 10, dir: 1 }), asleep = unit({ slot: 13, agi: 10, dir: 2, status: 3 });
    const t = tables();
    expect(roll(a, front, 3, fixedRng([2]), t.item)).toBe(true);     // chance 3
    expect(roll(a, front, 3, fixedRng([3]), t.item)).toBe(false);
    expect(roll(a, side, 3, fixedRng([3]), t.item)).toBe(true);      // m = 3 + 1 = 4 → chance 4
    expect(roll(a, side, 3, fixedRng([4]), t.item)).toBe(false);
    expect(roll(a, back, 3, fixedRng([5]), t.item)).toBe(true);      // m = 6
    expect(roll(a, asleep, 3, fixedRng([8]), t.item)).toBe(true);    // m = 9
    expect(roll(a, asleep, 3, fixedRng([9]), t.item)).toBe(false);
    expect(roll(unit({ slot: 0, agi: 1 }), unit({ slot: 1, agi: 999 }), 3, fixedRng([0]), t.item)).toBe(true);   // chance floors at 1
  });
});

describe('resolvePhysical (FUN_0043b4a0 action 0)', () => {
  it('side hit: base = atk − def, ×1.15, no rolls succeed', () => {
    const t = target();
    const hit = resolvePhysical(attacker(), t, ctx([99, 99]));
    expect(hit).toMatchObject({ target: 10, kind: 'damage', value: 23, crit: false, popup: '23', statusAfter: 0 });
    expect(t.hp).toBe(7);
  });
  it('back (+25%) and front (+0%) multipliers depend on the target facing', () => {
    const back = target({ dir: 1 });
    resolvePhysical(attacker(), back, ctx([99, 99]));
    expect(back.hp).toBe(30 - 25);
    const front = target({ dir: 2 });
    resolvePhysical(attacker(), front, ctx([99, 99]));
    expect(front.hp).toBe(30 - 20);
  });
  it('height difference adds 2% per step and damage is at least 1 and at most the remaining HP', () => {
    const high = attacker({ c: 2, r: 4, dir: 1 });                   // h 2
    const t = target({ c: 3, r: 4 });
    resolvePhysical(high, t, ctx([99, 99]));
    expect(t.hp).toBe(30 - 23);                                       // (100+15+4)% of 20 = 23.8 → 23
    const tank = target({ def: 999, hp: 5 });
    resolvePhysical(attacker(), tank, ctx([99, 99]));
    expect(tank.hp).toBe(4);
  });
  it('critical (+80%) kills: HP 0 → status 1 (dead)', () => {
    const t = target();
    const hit = resolvePhysical(attacker(), t, ctx([0, 99]));        // crit roll 0 < 3, evade roll 99
    expect(hit).toMatchObject({ kind: 'damage', value: 30, crit: true, statusAfter: 1 });
    expect(t.status).toBe(1);
  });
  it('evade (roll with swapped arguments) → miss, the target turns toward the attacker', () => {
    const t = target({ dir: 0 });
    const hit = resolvePhysical(attacker(), t, ctx([99, 0]));
    expect(hit).toMatchObject({ kind: 'miss', value: 0, popup: 'miss!' });
    expect(t.hp).toBe(30);
    expect(t.dir).toBe(2);
  });
  it('a sleeping target wakes before the rolls and is therefore allowed to evade', () => {
    const t = target({ status: 3, statusCounter: 85 });
    resolvePhysical(attacker(), t, ctx([99, 0]));
    expect(t.status).toBe(0);
    expect(t.hp).toBe(30);
  });
  it('the special flag triples damage and skips both rolls', () => {
    const t = target();
    const rng = fixedRng([0]);
    resolvePhysical(attacker({ special: true }), t, ctx([], { rng }));
    expect(t.hp).toBe(0);
    expect(rng.calls).toBe(0);
  });
  it('dash grants the critical without a roll result but still rolls', () => {
    const t = target();
    const rng = fixedRng([99, 99]);
    const hit = resolvePhysical(attacker(), t, ctx([], { rng, dash: true }));
    expect(hit.crit).toBe(true);
    expect(rng.calls).toBe(2);
  });
  it('elements: the axis with the largest |A−D| is used; same sign lowers, opposite sign raises', () => {
    const tt = tables({ race: [RACE({ elem0: 10 }), RACE({ elem0: 10 }), RACE({ elem0: -5 })] });
    const same = target({ race: 1 });
    resolvePhysical(attacker(), same, ctx([99, 99], { tables: tt }));
    expect(same.hp).toBe(30 - 17);                                    // base 20 × 75% = 15 → ×1.15 = 17.25 → 17
    const opposite = target({ race: 2 });
    resolvePhysical(attacker(), opposite, ctx([99, 99], { tables: tt }));
    expect(opposite.hp).toBe(30 - 24);                                // |−5−10|/2 = 7% → 21 → ×1.15 = 24.15 → 24
  });
  it('weapon status effects roll at 20% and leave the counter untouched', () => {
    const t = target({ id: 8 });
    const hit = resolvePhysical(attacker({ weapon: 6 }), t, ctx([99, 99, 19]));
    expect(hit.statusAfter).toBe(2);
    expect(t.statusCounter).toBe(0);
    const named = target({ id: 20, side: 4 });                        // named enemy: immune
    resolvePhysical(attacker({ weapon: 6 }), named, ctx([99, 99, 0]));
    expect(named.status).toBe(0);
  });
  it('resolveAction(0) resolves every target in order', () => {
    const a = attacker(), t1 = target(), t2 = target({ slot: 11, c: 5, r: 5 });
    const hits = resolveAction(a, 0, [t1, t2], ctx([99, 99, 99, 99]));
    expect(hits.map((h) => h.target)).toEqual([10, 11]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/resolvePhysical.test.ts 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/battle/resolve`

- [ ] **Step 3: 구현**

`web/src/battle/resolve.ts`:

```ts
import { elems, type ItemData, type RaceData, type Tables } from '../data/types';
import { dirTo, incap, type BattleGrid } from './grid';
import type { RandomSource } from './rng';
import { itemsOf, type Unit } from './unit';

export interface Hit { target: number; kind: 'damage' | 'heal' | 'miss' | 'status' | 'cure' | 'buff' | 'none'; value: number; crit: boolean; popup: string; statusAfter: number }
export interface ResolveContext { tables: Tables; grid: BattleGrid; units: (Unit | null)[]; rng: RandomSource; dash: boolean }

type Items = readonly [ItemData, ItemData, ItemData, ItemData];
const trunc = Math.trunc;
const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** battle_rules.md §2.2: armor contributes no attack, weapons no defense; agi/wis/mgr sum all four items. */
export function totals(u: Unit, items: Items): { atk: number; def: number; wis: number; mgr: number; agi: number } {
  const [w, a, x, y] = items;
  return {
    atk: u.str + w.atk + x.atk + y.atk + u.buff.str,
    def: u.def + a.def + x.def + y.def + u.buff.def,
    wis: u.wis + w.wis + a.wis + x.wis + y.wis + u.buff.wis,
    mgr: u.mgr + w.mgr + a.mgr + x.mgr + y.mgr + u.buff.mgr,
    agi: u.agi + w.agi + a.agi + x.agi + y.agi + u.buff.agi,
  };
}

/** A_i(u) = race.e_i + Σ items.e_i + unit.e_i. */
export function elemTotal(u: Unit, race: RaceData, items: Items, axis: 0 | 1 | 2): number {
  return elems(race)[axis] + items.reduce((s, it) => s + elems(it)[axis], 0) + u.elem[axis];
}

/** FUN_0043dd90(a, b, base): facing multiplier then chance = agi(a)·m / agi(b), floor 1 %. */
export function roll(a: Unit, b: Unit, base: number, rng: RandomSource, items: ItemData[]): boolean {
  let m = Math.max(base, 1);
  if (incap(b.status)) m *= 3;
  else if (a.dir === b.dir) m *= 2;
  else if (b.dir !== (a.dir ^ 3)) m += trunc(m / 2);
  const agiA = totals(a, itemsOf(a, items)).agi, agiB = totals(b, itemsOf(b, items)).agi;
  const chance = Math.max(trunc((agiA * m) / Math.max(agiB, 1)), 1);
  return rng.rand(100) < chance;
}

/** Named enemies (id ≠ 8, non-party) are immune to status effects. */
export const statusOk = (t: Unit): boolean => t.side === 0 || t.id === 8;

/** Elemental percentage on `base` for the attacker's strongest axis (battle_rules.md §2.2). `ownElem` = race or weapon/magic vector that must share the attacker's sign. */
export function elementAdjust(base: number, attacker: Unit, target: Unit, ctx: ResolveContext, ownElem: [number, number, number]): number {
  const t = ctx.tables;
  const ia = itemsOf(attacker, t.item), it = itemsOf(target, t.item);
  const ra = t.race[attacker.race]!, rt = t.race[target.race]!;
  let best: 0 | 1 | 2 | null = null, bestDiff = -1;
  for (const axis of [0, 1, 2] as const) {
    const A = elemTotal(attacker, ra, ia, axis), D = elemTotal(target, rt, it, axis);
    if (A === 0 || D === 0) continue;
    if (sign(A) !== sign(elems(ra)[axis]) && sign(A) !== sign(ownElem[axis])) continue;
    if (Math.abs(A - D) > bestDiff) { bestDiff = Math.abs(A - D); best = axis; }
  }
  if (best === null) return base;
  const A = elemTotal(attacker, ra, ia, best), D = elemTotal(target, rt, it, best);
  const pct = sign(A) === sign(D) ? -trunc((Math.abs(D) - Math.abs(A) + 100) / 4) : trunc(Math.abs(D - A) / 2);
  return Math.max(trunc(((100 + pct) * base) / 100), 1);
}

const hit = (target: Unit, kind: Hit['kind'], value: number, popup: string, crit = false): Hit => ({ target: target.slot, kind, value, crit, popup, statusAfter: target.status });

function applyWeaponStatus(a: Unit, t: Unit, ctx: ResolveContext): void {
  const st = ctx.tables.item[a.weapon]!.status_code;
  if (st === 0 || t.status === 1 || !statusOk(t) || !roll(a, t, 20, ctx.rng, ctx.tables.item)) return;
  const s = t.status;
  const ok = (st === 2 || st === 3 || st === 6 || st === 7) ? !incap(s)
    : (st === 4 || st === 5) ? ![1, 4, 5, 9].includes(s)
      : st === 8 ? ![1, 4, 5, 8, 9].includes(s) : false;
  if (ok) t.status = st;                       // the duration counter is NOT set (original quirk)
}

/** FUN_0043b4a0 action 0 + FUN_0043afd0 dash: wake → crit roll → evade roll (arguments swapped) → damage → weapon status. */
export function resolvePhysical(a: Unit, t: Unit, ctx: ResolveContext): Hit {
  const tbl = ctx.tables;
  if (t.status === 3) t.status = 0;
  let crit = ctx.dash;
  if (!a.special && roll(a, t, 3, ctx.rng, tbl.item)) crit = true;
  if (!a.special && !incap(t.status) && roll(t, a, 3, ctx.rng, tbl.item)) {
    t.dir = dirTo(t.c, t.r, a.c, a.r);
    return hit(t, 'miss', 0, 'miss!');
  }
  const ia = itemsOf(a, tbl.item), it = itemsOf(t, tbl.item);
  let base = Math.max(totals(a, ia).atk - totals(t, it).def, 1);
  base = elementAdjust(base, a, t, ctx, elems(ia[0]));
  let mult = a.special ? 300 : 100;
  if (crit) mult += 80;
  const d = dirTo(a.c, a.r, t.c, t.r);
  if (t.dir === d) mult += 25;
  else if (t.dir !== (d ^ 3)) mult += 15;
  mult += (ctx.grid.height(a.c, a.r) - ctx.grid.height(t.c, t.r)) * 2;
  const dmg = Math.min(Math.max(trunc((mult * base) / 100), 1), t.hp);
  t.hp -= dmg;
  if (t.hp === 0) t.status = 1;
  else applyWeaponStatus(a, t, ctx);
  return hit(t, 'damage', dmg, String(dmg), crit);
}

/** One FUN_0043b4a0 call per target. Task 9 adds the magic branch. */
export function resolveAction(actor: Unit, action: number, targets: Unit[], ctx: ResolveContext): Hit[] {
  if (action === 0) return targets.map((t) => resolvePhysical(actor, t, ctx));
  throw new Error(`action ${action} not supported yet`);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/resolvePhysical.test.ts 2>&1 | tail -3`
Expected: `Tests  12 passed`

- [ ] **Step 5: 커밋**

```bash
git add web/src/battle/resolve.ts web/test/resolvePhysical.test.ts
git commit -m "feat(web): physical attack resolution with the original hit, evade, element and status rules"
```

---

### Task 9: 마법 판정

**Files:**
- Modify: `web/src/battle/resolve.ts`
- Test: `web/test/resolveMagic.test.ts`

**Interfaces:**
- Produces: `resolveMagic(actor, target, magicIndex, ctx): Hit`, `resolveAction` 완성(마법 분기, 55/81 흡수), `STATUS_MAGIC: Record<number, { status: number; axis: 0|1|2; k: number; allow: (s: number) => boolean }>`, `STATUS_ONLY: Set<number>`, 팝업 문자열 `well`, `str_up!` 등.

- [ ] **Step 1: 실패하는 테스트**

`web/test/resolveMagic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { resolveAction, resolveMagic, type ResolveContext } from '../src/battle/resolve';
import type { MagicData } from '../src/data/types';
import { fixedRng, flatMap, MAGIC, tables, unit, units } from './helpers/battleFixtures';

/** Real magic indices matter: 1 burst (fire), 3 heat blade, 5 flash (dmg+hold), 9 ifrit (fire), 13 restore, 24 lullaby, 25 cheering, 31 order, 35 levitate, 40 healing, 41 resurrection, 55 lifesteal, 64 sacrifice, 14 macabre dance. */
function magicTable(): MagicData[] {
  const m = Array.from({ length: 84 }, (_, i) => MAGIC({ name: `m${i}`, mp_cost: 6 }));
  m[1] = MAGIC({ name: 'burst', elem0: 5 });
  m[3] = MAGIC({ name: 'heat blade', elem0: 1, target: 1 });
  m[5] = MAGIC({ name: 'flash', elem0: 8 });
  m[9] = MAGIC({ name: 'ifrit', elem0: 20 });
  m[13] = MAGIC({ name: 'restore', elem2: 1, target: 1 });
  m[14] = MAGIC({ name: 'macabre', mp_cost: 0, elem0: 0, target: 1 });
  m[24] = MAGIC({ name: 'lullaby', elem0: 0, elem1: 3 });
  m[25] = MAGIC({ name: 'cheering', elem2: 1, target: 1 });
  m[31] = MAGIC({ name: 'order', elem1: 2 });
  m[35] = MAGIC({ name: 'levitate', elem1: 1, target: 1 });
  m[40] = MAGIC({ name: 'healing', elem0: 0, elem2: 1, target: 1 });
  m[41] = MAGIC({ name: 'resurrection', elem2: 10, target: 1 });
  m[55] = MAGIC({ name: 'lifesteal', elem2: -5 });
  m[64] = MAGIC({ name: 'sacrifice', elem2: 10, target: 1 });
  return m;
}
const grid = new BattleGrid(flatMap(9));
const ctx = (rng: number[]): ResolveContext => ({ tables: tables({ magic: magicTable() }), grid, units: units(), rng: fixedRng(rng), dash: false });
const caster = (over = {}) => unit({ slot: 0, c: 4, r: 4, dir: 1, wis: 10, agi: 10, mp: 20, ...over });
const foe = (over = {}) => unit({ slot: 10, c: 6, r: 4, dir: 2, mgr: 10, agi: 10, hp: 30, side: 4, id: 8, ...over });

describe('resolveMagic (FUN_0043b4a0 magic cases)', () => {
  it('damage = power + wis − mgr, no rolls, no facing or height bonus', () => {
    const t = foe({ dir: 1 });
    const rng = fixedRng([0]);
    const hit = resolveMagic(caster(), t, 1, { ...ctx([]), rng });
    expect(hit).toMatchObject({ kind: 'damage', value: 5, popup: '5', crit: false });
    expect(t.hp).toBe(25);
    expect(rng.calls).toBe(0);
  });
  it('fire magic thaws a frozen target before damaging it', () => {
    const t = foe({ status: 5 });
    resolveMagic(caster(), t, 9, ctx([]));
    expect(t.status).toBe(0);
    expect(t.hp).toBe(30 - 20);
  });
  it('healing restores min(wisTot, missing HP); resurrection needs a dead target and gives half', () => {
    const ally = unit({ slot: 1, c: 5, r: 4, hp: 10, hpMax: 30 });
    expect(resolveMagic(caster(), ally, 40, ctx([]))).toMatchObject({ kind: 'heal', value: 10, popup: '10' });
    expect(ally.hp).toBe(20);
    const dead = unit({ slot: 2, c: 5, r: 5, hp: 0, hpMax: 30, status: 1 });
    expect(resolveMagic(caster({ wis: 50 }), dead, 41, ctx([])).kind).toBe('cure');
    expect([dead.hp, dead.status]).toEqual([25, 0]);
    expect(resolveMagic(caster(), unit({ slot: 3, c: 5, r: 3, hp: 5 }), 41, ctx([])).kind).toBe('miss');
  });
  it('status magic: chance = pow·bonus·m / res; success sets the status and counter 100', () => {
    const t = foe();                                   // pow 20, res 20, bonus 30, m 1 (front) → 30 %
    expect(resolveMagic(caster(), t, 24, ctx([29])).kind).toBe('status');
    expect([t.status, t.statusCounter]).toEqual([3, 100]);
    const t2 = foe();
    expect(resolveMagic(caster(), t2, 24, ctx([30])).kind).toBe('none');
    expect(t2.status).toBe(0);
    const named = foe({ id: 20 });
    expect(resolveMagic(caster(), named, 24, ctx([0])).kind).toBe('none');   // immune
  });
  it('damage-plus-status magic applies the status roll and then the damage', () => {
    const t = foe();
    const hit = resolveMagic(caster(), t, 5, ctx([0]));                // flash: hold, then 8 damage
    expect(hit).toMatchObject({ kind: 'damage', value: 8, statusAfter: 8 });
    expect(t.hp).toBe(22);
  });
  it('order turns the target, levitate needs a ground race and sets the counter from the caster level', () => {
    const t = foe({ dir: 2 });
    resolveMagic(caster({ dir: 3 }), t, 31, ctx([0]));
    expect(t.dir).toBe(3);
    const ally = unit({ slot: 1, c: 5, r: 4 });
    resolveMagic(caster({ level: 4 }), ally, 35, ctx([]));
    expect([ally.status, ally.statusCounter]).toEqual([11, 40]);
    const bird = unit({ slot: 2, c: 5, r: 5, race: 2 });
    expect(resolveMagic(caster(), bird, 35, ctx([])).kind).toBe('none');
  });
  it('buffs are capped; cheering restores move and act; macabre dance sets the caster flag', () => {
    const a = caster({ str: 40 });
    expect(resolveMagic(a, a, 3, ctx([]))).toMatchObject({ kind: 'buff', popup: 'str_up!' });
    expect(a.buff.str).toBe(5);                        // min(0 + 4 + 1, 10)
    for (let i = 0; i < 5; i++) resolveMagic(a, a, 3, ctx([]));
    expect(a.buff.str).toBe(10);
    const tired = unit({ slot: 1, c: 5, r: 4, moved: true, acted: true });
    resolveMagic(a, tired, 25, ctx([]));
    expect([tired.moved, tired.acted]).toEqual([false, false]);
    resolveMagic(a, a, 14, ctx([]));
    expect(a.special).toBe(true);
  });
  it('restore cures any status except death ("well"); sacrifice kills the caster and revives the target', () => {
    const poisoned = unit({ slot: 1, c: 5, r: 4, status: 2 });
    expect(resolveMagic(caster(), poisoned, 13, ctx([]))).toMatchObject({ kind: 'cure', popup: 'well' });
    expect(poisoned.status).toBe(0);
    const a = caster({ wis: 20 }), dead = unit({ slot: 1, c: 5, r: 4, hp: 0, status: 1, hpMax: 30 });
    resolveMagic(a, dead, 64, ctx([]));
    expect([a.hp, a.status, dead.hp, dead.status]).toEqual([0, 1, 10, 0]);
  });
  it('resolveAction: lifesteal damages the targets and heals the caster by the first damage', () => {
    const a = caster({ hp: 10, hpMax: 30, wis: 20 });
    const t = foe();                                   // power 5 + 20 − 10 = 15
    const hits = resolveAction(a, 55, [t, a], ctx([]));
    expect(hits.map((h) => [h.target, h.kind, h.value])).toEqual([[10, 'damage', 15], [0, 'heal', 15]]);
    expect(a.hp).toBe(25);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/resolveMagic.test.ts 2>&1 | tail -3`
Expected: FAIL — `resolveMagic` is not exported

- [ ] **Step 3: 구현**

`web/src/battle/resolve.ts`에 추가하고 `resolveAction`을 바꾼다:

```ts
/** battle_rules.md §3.5: status magic parameters. allow(s) = statuses the effect may be applied on. */
export const STATUS_MAGIC: Record<number, { status: number; axis: 0 | 1 | 2; k: number; allow: (s: number) => boolean }> = {};
const notIn = (...xs: number[]) => (s: number) => !xs.includes(s);
for (const m of [5, 51]) STATUS_MAGIC[m] = { status: 8, axis: 0, k: 30, allow: notIn(1, 4, 5, 8, 9) };
for (const m of [11, 12, 19, 72]) STATUS_MAGIC[m] = { status: 5, axis: 0, k: 30, allow: notIn(1, 4, 5, 9) };
STATUS_MAGIC[23] = { status: 6, axis: 1, k: 40, allow: (s) => !incap(s) };
STATUS_MAGIC[24] = { status: 3, axis: 1, k: 30, allow: (s) => !incap(s) };
for (const m of [26, 74, 79]) STATUS_MAGIC[m] = { status: 8, axis: 1, k: 30, allow: notIn(1, 4, 5, 8, 9) };
for (const m of [34, 73]) STATUS_MAGIC[m] = { status: 2, axis: 1, k: 40, allow: (s) => !incap(s) };
for (const m of [50, 75]) STATUS_MAGIC[m] = { status: 4, axis: 2, k: 20, allow: notIn(1, 4, 5, 9) };
STATUS_MAGIC[52] = { status: 7, axis: 2, k: 50, allow: (s) => !incap(s) };
STATUS_MAGIC[53] = { status: -1, axis: 2, k: 30, allow: (s) => !incap(s) };   // dark force: random status

/** Magic whose only effect is the status/turn change (no damage). */
export const STATUS_ONLY = new Set([23, 24, 28, 31, 35, 51, 52]);
const FIRE = new Set([1, 9, 71]);
const HEAL = new Set([22, 32, 40]);
const BUFF: Record<number, { key: keyof Unit['buff']; stat: 'str' | 'agi' | 'def' | 'mgr'; cap: number; popup: string }> = {
  3: { key: 'str', stat: 'str', cap: 4, popup: 'str_up!' }, 21: { key: 'agi', stat: 'agi', cap: 2, popup: 'agi_up!' },
  33: { key: 'def', stat: 'def', cap: 2, popup: 'def_up!' }, 44: { key: 'mgr', stat: 'mgr', cap: 2, popup: 'mgr_up!' },
};
const SPECIAL = new Set([14, 54, 63]);

function statusRoll(a: Unit, t: Unit, m: MagicData, axis: 0 | 1 | 2, k: number, ctx: ResolveContext): boolean {
  const tbl = ctx.tables;
  const ia = itemsOf(a, tbl.item), it = itemsOf(t, tbl.item);
  const ta = totals(a, ia), tt = totals(t, it);
  const res = Math.max(tt.mgr + tt.agi, 1);
  const pow = ta.wis + ta.agi;
  const s = sign(elems(m)[axis]) || 1;
  const bonus = Math.max(k + s * (elemTotal(a, tbl.race[a.race]!, ia, axis) - elemTotal(t, tbl.race[t.race]!, it, axis)), 1);
  const mul = incap(t.status) ? 3 : a.dir === t.dir ? 2 : t.dir !== (a.dir ^ 3) ? 1.5 : 1;
  const chance = Math.max(trunc((pow * bonus * mul) / res), 1);
  return ctx.rng.rand(100) < chance;
}

function darkForce(ctx: ResolveContext): number {
  const r = ctx.rng.rand(100);
  return r < 1 ? 4 : r < 5 ? 5 : r < 10 ? 7 : r < 20 ? 8 : r < 30 ? 2 : r < 40 ? 6 : r < 50 ? 3 : 0;
}

function magicDamage(a: Unit, t: Unit, m: MagicData, ctx: ResolveContext): number {
  const tbl = ctx.tables;
  const power = Math.abs(elems(m).find((v) => v !== 0) ?? 0);
  const atk = totals(a, itemsOf(a, tbl.item)).wis, def = totals(t, itemsOf(t, tbl.item)).mgr;
  let base = Math.max(power + atk - def, 1);
  base = elementAdjust(base, a, t, ctx, elems(m));
  const dmg = Math.min(base, t.hp);
  t.hp -= dmg;
  if (t.hp === 0) t.status = 1;
  return dmg;
}

/** FUN_0043b4a0 for action = magic index. Returns the Hit for `t`; mutates units. */
export function resolveMagic(a: Unit, t: Unit, index: number, ctx: ResolveContext): Hit {
  const tbl = ctx.tables;
  const m = tbl.magic[index]!;
  const wisTot = totals(a, itemsOf(a, tbl.item)).wis;
  if (FIRE.has(index) && t.status === 5) t.status = 0;
  if (HEAL.has(index)) {
    if (t.status === 1 || t.side === 7) return hit(t, 'miss', 0, 'miss!');
    const v = Math.min(wisTot, t.hpMax - t.hp); t.hp += v;
    return hit(t, 'heal', v, String(v));
  }
  if (index === 41) {
    if (t.status !== 1 && t.side !== 7) return hit(t, 'miss', 0, 'miss!');
    t.hp = Math.min(trunc(wisTot / 2), t.hpMax); t.status = 0;
    return hit(t, 'cure', t.hp, String(t.hp));
  }
  if (index === 64) {
    a.hp = 0; a.status = 1;
    t.hp = Math.min(trunc(wisTot / 2), t.hpMax); t.status = 0;
    return hit(t, 'cure', t.hp, String(t.hp));
  }
  if (index === 2 || index === 10 || index === 13 || index === 45 || index === 47) {
    const cures = index === 2 ? t.status === 5 : index === 10 ? t.status === 2 : t.status !== 1 && (t.status !== 0 || index === 47);
    if (!cures) return hit(t, 'none', 0, '');
    t.status = 0;
    if (index === 47) t.hp = t.hpMax;
    return hit(t, 'cure', 0, 'well');
  }
  if (index === 25) { t.moved = false; t.acted = false; return hit(t, 'buff', 0, ''); }
  if (SPECIAL.has(index)) { a.special = true; return hit(t, 'buff', 0, ''); }
  const buff = BUFF[index];
  if (buff) {
    const base = t[buff.stat];
    t.buff[buff.key] = Math.min(t.buff[buff.key] + trunc(base / 10) + 1, trunc(base / buff.cap));
    return hit(t, 'buff', t.buff[buff.key], buff.popup);
  }
  if (index === 28) { if (!incap(t.status)) { t.status = 6; t.statusCounter = 100; } return hit(t, 'status', 6, ''); }
  if (index === 31) {
    if (!incap(t.status) && statusRoll(a, t, m, 1, 60, ctx)) { t.dir = a.dir; return hit(t, 'status', 0, ''); }
    return hit(t, 'none', 0, '');
  }
  if (index === 35) {
    const race = tbl.race[t.race]!;
    const ok = t.status === 0 && race.cost_land0 === 99 && itemsOf(t, tbl.item).every((it) => it.status_code !== 11);
    if (!ok) return hit(t, 'none', 0, '');
    t.status = 11; t.statusCounter = a.level * 5 + 20;
    return hit(t, 'status', 11, 'fly_high!');
  }
  const sm = STATUS_MAGIC[index];
  let statusApplied = false;
  if (sm && statusOk(t) && sm.allow(t.status) && !(index === 50 && t.race === 50)) {
    if (statusRoll(a, t, m, sm.axis, sm.k, ctx)) {
      const s = sm.status === -1 ? darkForce(ctx) : sm.status;
      if (s !== 0) { t.status = s; t.statusCounter = 100; statusApplied = true; }
    }
  }
  if (STATUS_ONLY.has(index)) return hit(t, statusApplied ? 'status' : 'none', statusApplied ? t.status : 0, '');
  const dmg = magicDamage(a, t, m, ctx);
  return hit(t, 'damage', dmg, String(dmg));
}

/** One FUN_0043b4a0 call per target; lifesteal/drain heal the caster (last target) by the first damage dealt. */
export function resolveAction(actor: Unit, action: number, targets: Unit[], ctx: ResolveContext): Hit[] {
  if (action === 0) return targets.map((t) => resolvePhysical(actor, t, ctx));
  const hits: Hit[] = [];
  for (const t of targets) {
    if ((action === 55 || action === 81) && t === actor) {
      const first = hits.find((h) => h.kind === 'damage');
      const v = first ? Math.min(first.value, actor.hpMax - actor.hp) : 0;
      actor.hp += v;
      hits.push(hit(actor, 'heal', v, String(v)));
      continue;
    }
    hits.push(resolveMagic(actor, t, action, ctx));
  }
  return hits;
}
```

기존의 `resolveAction` 정의(Task 8의 `throw`)는 지운다.

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/resolveMagic.test.ts test/resolvePhysical.test.ts 2>&1 | tail -3`
Expected: `Tests  21 passed`

- [ ] **Step 5: 커밋**

```bash
git add web/src/battle/resolve.ts web/test/resolveMagic.test.ts
git commit -m "feat(web): magic resolution — damage, heals, revives, status rolls, buffs and drains"
```

---
### Task 10: 결과 처리 — 사망·드롭·EXP·레벨업·상태 틱·라운드·승패

**Files:**
- Create: `web/src/battle/types.ts`, `web/src/battle/outcome.ts`
- Test: `web/test/outcome.test.ts`

**Interfaces:**
- Consumes: Task 4 `Unit`, `growUnit`, `PARTY_SLOTS`; Task 5 `BattleGrid`, `incap`; Task 8 `Hit`; Task 3 `Rng`, `RandomSource`; Task 2 `BattleEntry`, `Tables`.
- Produces (`types.ts`): `type Dir`(re-export), `interface BattleState { entry: BattleEntry; map: MapData; grid: BattleGrid; units: (Unit | null)[]; turn: number; phase: Phase; rng: Rng; lastPath: Dir[] }`, `type Phase = { kind: 'player'; sel: Selection } | { kind: 'enemy'; queue: number[] } | { kind: 'end'; result: 'victory' | 'defeat' }`, `type Selection`, `type Command`, `type BattleEvent` (스펙 §6.2–§6.3 그대로).
- Produces (`outcome.ts`): `expGain(actor, target, hit, tables, k: { v: number }): number`, `applyOutcome(state, actor, hits, tables): BattleEvent[]`, `statusTick(state, pick: (u: Unit) => boolean): BattleEvent[]`, `roundStart(state): BattleEvent[]`, `checkEnd(state): 'victory' | 'defeat' | null`.

- [ ] **Step 1: 실패하는 테스트**

`web/test/outcome.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { applyOutcome, checkEnd, expGain, roundStart, statusTick } from '../src/battle/outcome';
import type { Hit } from '../src/battle/resolve';
import { Rng, type RandomSource } from '../src/battle/rng';
import type { BattleState } from '../src/battle/types';
import { fixedRng, flatMap, RACE, tables, unit, units } from './helpers/battleFixtures';

const entry = { event: 1, label: 'outfield', map: 'stage49', roster: 49, episode: '', objective: '', heal: true };
function state(us: ReturnType<typeof units>, rng: RandomSource = Rng.fromSeed(1)): BattleState {
  const map = flatMap(9);
  return { entry, map, grid: new BattleGrid(map), units: us, turn: 1, phase: { kind: 'player', sel: { mode: 'idle' } }, rng, lastPath: [] };
}
const dmg = (target: number, value: number, dead = false): Hit => ({ target, kind: 'damage', value, crit: false, popup: String(value), statusAfter: dead ? 1 : 0 });
const t = tables({ race: [RACE(), RACE({ name: 'slime', exp_value: 10, hp: 12 })] });

describe('expGain (FUN_0043a2e0 case 7)', () => {
  const actor = unit({ slot: 0, level: 2 });
  const slime = unit({ slot: 10, id: 8, race: 1, level: 1, side: 4, hpMax: 12, hp: 7 });
  it('damage share × race exp, level difference scaling, kill bonus, named enemy ×2', () => {
    expect(expGain(actor, slime, dmg(10, 5), t, { v: 7 })).toBe(3);              // 10×5/12 = 4 → 80 % → 3
    expect(expGain(actor, { ...slime, hp: 0 }, dmg(10, 7, true), t, { v: 7 })).toBe(12);   // 5 + 10 = 15 → 80 % → 12
    expect(expGain(actor, { ...slime, id: 20 }, dmg(10, 5), t, { v: 7 })).toBe(6);         // 4 × 2 = 8 → 80 % → 6
    expect(expGain(actor, { ...slime, level: 10 }, dmg(10, 5), t, { v: 7 })).toBe(10);     // 100 + 20·8 = 260 %
  });
  it('allies and message results take the halving series 7, 3, 1, 1; party targets give 0', () => {
    const k = { v: 7 };
    const ally = unit({ slot: 1 });
    expect(expGain(actor, ally, { ...dmg(1, 5), kind: 'heal' }, t, k)).toBe(7);
    expect(expGain(actor, slime, { ...dmg(10, 0), kind: 'miss' }, t, k)).toBe(3);
    expect(expGain(actor, slime, { ...dmg(10, 0), kind: 'miss' }, t, k)).toBe(1);
    expect(expGain(actor, slime, { ...dmg(10, 0), kind: 'miss' }, t, k)).toBe(1);
    expect(expGain(actor, unit({ slot: 2, side: 4 }), dmg(2, 5), t, { v: 7 })).toBe(0);   // a party slot that is hostile (charmed)
  });
});

describe('applyOutcome', () => {
  it('kills convert enemies with drops into treasure objects and remove the others; EXP and level-ups follow', () => {
    const actor = unit({ slot: 0, level: 1, exp: 95, hpMax: 30 });
    const chest = unit({ slot: 10, id: 8, race: 1, side: 4, hp: 0, status: 1, dropGold: 50, hpMax: 12 });
    const plain = unit({ slot: 11, id: 8, race: 1, side: 4, hp: 0, status: 1, hpMax: 12 });
    const s = state(units(actor, chest, plain));
    const events = applyOutcome(s, actor, [dmg(10, 12, true), dmg(11, 12, true)], t);
    expect(s.units[10]).toMatchObject({ side: 7, race: 9, status: 0 });
    expect(s.units[11]).toBeNull();
    expect(events.map((e) => e.type)).toEqual(['died', 'died', 'removed', 'exp', 'levelUp', 'end']);
    expect(events.find((e) => e.type === 'exp')).toMatchObject({ slot: 0, gain: 40 });   // per kill: 10×12/12 + 10 = 20, same level → 100 %
  });
  it('a drop item makes a chest (race 8) and the battle is not over while a live enemy remains', () => {
    const actor = unit({ slot: 0, level: 5 });
    const dead = unit({ slot: 10, id: 8, race: 1, side: 4, hp: 0, status: 1, dropItem: 118, hpMax: 12 });
    const alive = unit({ slot: 11, id: 8, race: 1, side: 4, hp: 3, hpMax: 12 });
    const s = state(units(actor, dead, alive));
    const events = applyOutcome(s, actor, [dmg(10, 12, true)], t);
    expect(s.units[10]).toMatchObject({ side: 7, race: 8 });
    expect(events.some((e) => e.type === 'end')).toBe(false);
  });
  it('party deaths stay as corpses and enemy actors earn nothing', () => {
    const enemy = unit({ slot: 10, id: 8, race: 1, side: 4 });
    const hero = unit({ slot: 0, hp: 0, status: 1 }), hero2 = unit({ slot: 1 });
    const s = state(units(hero, hero2, enemy));
    const events = applyOutcome(s, enemy, [dmg(0, 30, true)], t);
    expect(s.units[0]).toMatchObject({ status: 1 });
    expect(events.map((e) => e.type)).toEqual(['died']);
  });
});

describe('checkEnd, statusTick, roundStart', () => {
  it('victory when only objects remain; defeat when no party unit can act', () => {
    expect(checkEnd(state(units(unit({ slot: 0 }), unit({ slot: 10, side: 7, id: 8, race: 8 }))))).toBe('victory');
    expect(checkEnd(state(units(unit({ slot: 0 }), unit({ slot: 10, side: 1, id: 8 }))))).toBe('victory');
    expect(checkEnd(state(units(unit({ slot: 0, status: 3 }), unit({ slot: 10, side: 4, id: 8 }))))).toBe('defeat');
    expect(checkEnd(state(units(unit({ slot: 0 }), unit({ slot: 10, side: 4, id: 8 }))))).toBeNull();
  });
  it('poison bites HPmax/10+1; counters shrink and cure when below the roll; levitate lands', () => {
    const poisoned = unit({ slot: 10, side: 4, id: 8, status: 2, hp: 3, hpMax: 30 });
    const asleep = unit({ slot: 11, side: 4, id: 8, status: 3, statusCounter: 100 });
    const flying = unit({ slot: 12, side: 4, id: 8, status: 11, statusCounter: 10 });
    const s = state(units(poisoned, asleep, flying), fixedRng([90]));
    const events = statusTick(s, (u) => u.side !== 0);
    expect(poisoned).toMatchObject({ hp: 0, status: 1 });
    expect(asleep).toMatchObject({ status: 0, statusCounter: 85 });          // 85 < 90 → cured
    expect(flying).toMatchObject({ status: 0, statusCounter: 0 });
    expect(events).toEqual([
      { type: 'statusTick', slot: 10, status: 2, value: 3, cured: false },
      { type: 'died', slot: 10 },
      { type: 'statusTick', slot: 11, status: 3, value: 85, cured: true },
      { type: 'statusTick', slot: 12, status: 11, value: 0, cured: true },
    ]);
  });
  it('roundStart clears flags, regenerates MP by ceil(max/10) and decays buffs toward zero', () => {
    const u = unit({ slot: 0, moved: true, acted: true, mp: 5, mpMax: 24, buff: { str: 3, def: 0, wis: -2, mgr: 0, agi: 1 } });
    const s = state(units(u));
    expect(roundStart(s)).toEqual([{ type: 'roundStart', turn: 2 }]);
    expect(u).toMatchObject({ moved: false, acted: false, mp: 8, buff: { str: 2, def: 0, wis: -1, mgr: 0, agi: 0 } });
    expect(s.turn).toBe(2);
  });
});
```

첫 `applyOutcome` 테스트: exp 95 + 40 = 135 → 레벨 2 → `levelUp` 1회. 제거된 유닛(슬롯 11)의 EXP도 들어가야 하므로 구현은 EXP를 제거 **전에** 계산한다.

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/outcome.test.ts 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/battle/outcome`

- [ ] **Step 3: 구현**

`web/src/battle/types.ts`:

```ts
import type { MapData } from '../assets/types';
import type { BattleEntry } from '../data/types';
import type { BattleGrid, Dir } from './grid';
import type { RangeTable } from './moveRange';
import type { Hit } from './resolve';
import type { RandomSource } from './rng';
import type { Unit } from './unit';

export type { Dir };

export type Selection =
  | { mode: 'idle' }
  | { mode: 'menu'; slot: number; range: RangeTable }
  | { mode: 'move'; slot: number; range: RangeTable }
  | { mode: 'target'; slot: number; action: number; range: RangeTable }
  | { mode: 'face'; slot: number };

export type Phase =
  | { kind: 'player'; sel: Selection }
  | { kind: 'enemy'; queue: number[] }
  | { kind: 'end'; result: 'victory' | 'defeat' };

export interface BattleState {
  entry: BattleEntry;
  map: MapData;
  grid: BattleGrid;
  units: (Unit | null)[];
  turn: number;
  phase: Phase;
  rng: RandomSource;        // an Rng in the game; tests inject fixed sources
  lastPath: Dir[];          // path of the selected unit's last move (dash detection)
}

export type Command =
  | { type: 'select'; slot: number } | { type: 'cancel' }
  | { type: 'beginMove' } | { type: 'move'; c: number; r: number }
  | { type: 'beginTarget'; action: number } | { type: 'act'; c: number; r: number }
  | { type: 'wait' } | { type: 'face'; dir: Dir }
  | { type: 'endTurn' } | { type: 'enemyStep' };

export type BattleEvent =
  | { type: 'selected'; slot: number } | { type: 'deselected' }
  | { type: 'moved'; slot: number; path: Dir[]; to: [number, number] }
  | { type: 'faced'; slot: number; dir: Dir }
  | { type: 'action'; slot: number; action: number; cell: [number, number]; hits: Hit[] }
  | { type: 'died'; slot: number } | { type: 'removed'; slot: number }
  | { type: 'exp'; slot: number; gain: number } | { type: 'levelUp'; slot: number; level: number; learned: number[] }
  | { type: 'statusTick'; slot: number; status: number; value: number; cured: boolean }
  | { type: 'roundStart'; turn: number } | { type: 'phase'; kind: 'player' | 'enemy' }
  | { type: 'end'; result: 'victory' | 'defeat' }
  | { type: 'rejected'; reason: string };
```

`web/src/battle/outcome.ts`:

```ts
import type { Tables } from '../data/types';
import { incap } from './grid';
import type { Hit } from './resolve';
import { growUnit, PARTY_SLOTS, type Unit } from './unit';
import type { BattleEvent, BattleState } from './types';

const trunc = Math.trunc;
const EXP_CAP = 9899;

/** FUN_0043a2e0 case 7: experience for one hit. `k` carries the halving series across the hits of one action. */
export function expGain(actor: Unit, target: Unit, hit: Hit, tables: Tables, k: { v: number }): number {
  const message = hit.kind !== 'damage' && hit.kind !== 'heal';
  if (target.side === 0 || message) {
    const gain = Math.max(k.v, 1);
    k.v = Math.max(trunc(k.v / 2), 1);
    return gain;
  }
  const v = hit.kind === 'heal' ? -hit.value : hit.value;
  const base = tables.race[target.race]!.exp_value;
  let gain = trunc((base * v) / Math.max(target.hpMax, 1));
  if (target.hp === 0) gain += base;
  if (target.id !== 8) gain *= 2;
  const pct = Math.max(100 + 20 * (target.level - actor.level), 10);
  gain = Math.max(trunc((pct * gain) / 100), 1);
  return target.slot < PARTY_SLOTS ? 0 : gain;
}

/** Party wiped (no unit able to act) → defeat; no live enemy (HP > 0, side ∉ {1, 7}, not hidden) → victory. */
export function checkEnd(state: BattleState): 'victory' | 'defeat' | null {
  const party = state.units.slice(0, PARTY_SLOTS).filter((u): u is Unit => u !== null);
  if (!party.some((u) => !incap(u.status))) return 'defeat';
  const enemies = state.units.slice(PARTY_SLOTS).filter((u): u is Unit => u !== null && u.hp > 0 && u.side !== 1 && u.side !== 7 && u.status !== 9);
  return enemies.length === 0 ? 'victory' : null;
}

/** FUN_0043a2e0 cases 4, 7, 8, 9, 10 after one action: deaths → EXP (before removal) → drops/removal → level-ups → end check. */
export function applyOutcome(state: BattleState, actor: Unit, hits: Hit[], tables: Tables): BattleEvent[] {
  const events: BattleEvent[] = [];
  const dead: Unit[] = [];
  for (const h of hits) {
    const t = state.units[h.target];
    if (t && t.status === 1 && t.hp === 0 && t.side !== 7 && !dead.includes(t)) { dead.push(t); events.push({ type: 'died', slot: t.slot }); }
  }
  let total = 0;
  if (actor.side === 0) {
    const k = { v: 7 };
    for (const h of hits) {
      const t = state.units[h.target];
      if (t) total += expGain(actor, t, h, tables, k);
    }
  }
  for (const t of dead) {
    if (t.slot < PARTY_SLOTS) continue;
    if (t.dropItem !== 0 || t.dropGold !== 0) {
      t.side = 7; t.race = t.dropItem !== 0 ? 8 : 9; t.status = 0; t.id = 8;
    } else {
      state.units[t.slot] = null;
      events.push({ type: 'removed', slot: t.slot });
    }
  }
  if (actor.side === 0) {
    actor.exp = Math.min(actor.exp + total, EXP_CAP);
    events.push({ type: 'exp', slot: actor.slot, gain: total });
    const newLevel = Math.min(trunc(actor.exp / 100) + 1, 99);
    while (actor.level < newLevel) {
      actor.level++;
      const learned = growUnit(actor, tables.race[actor.race]!, true, state.rng, tables.magic);
      events.push({ type: 'levelUp', slot: actor.slot, level: actor.level, learned });
    }
  }
  const end = checkEnd(state);
  if (end) { state.phase = { kind: 'end', result: end }; events.push({ type: 'end', result: end }); }
  return events;
}

const DECAY: Record<number, number> = { 3: 15, 5: 10, 6: 15, 7: 10, 8: 10, 11: 20 };

/** FUN_0043e1e0 for the units `pick` selects: poison damage; timed statuses decay and cure when counter < rand(100). */
export function statusTick(state: BattleState, pick: (u: Unit) => boolean): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (const u of state.units) {
    if (!u || !pick(u)) continue;
    if (u.status === 2) {
      const dmg = Math.min(trunc(u.hpMax / 10) + 1, u.hp);
      u.hp -= dmg;
      events.push({ type: 'statusTick', slot: u.slot, status: 2, value: dmg, cured: false });
      if (u.hp === 0) { u.status = 1; events.push({ type: 'died', slot: u.slot }); }
      continue;
    }
    const dec = DECAY[u.status];
    if (dec === undefined) continue;
    const c = Math.max(u.statusCounter - dec, 0);
    u.statusCounter = c;
    const cured = c < state.rng.rand(100);
    const status = u.status;
    if (cured) u.status = 0;
    events.push({ type: 'statusTick', slot: u.slot, status, value: c, cured });
  }
  return events;
}

/** FUN_00420230: new round — flags reset, MP += ceil(max/10), buffs decay toward zero, turn + 1. */
export function roundStart(state: BattleState): BattleEvent[] {
  for (const u of state.units) {
    if (!u) continue;
    u.moved = false; u.acted = false;
    u.mp = Math.min(u.mp + Math.ceil(u.mpMax / 10), u.mpMax);
    for (const k of ['str', 'def', 'wis', 'mgr', 'agi'] as const) {
      const v = u.buff[k];
      u.buff[k] = v > 0 ? v - 1 : v < 0 ? v + 1 : 0;
    }
  }
  state.turn += 1;
  return [{ type: 'roundStart', turn: state.turn }];
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/outcome.test.ts 2>&1 | tail -3`
Expected: `Tests  8 passed`

- [ ] **Step 5: 커밋**

```bash
git add web/src/battle/types.ts web/src/battle/outcome.ts web/test/outcome.test.ts
git commit -m "feat(web): battle outcome — deaths, drops, experience, level-ups, status ticks, rounds, victory"
```

---

### Task 11: 적 AI

**Files:**
- Create: `web/src/battle/ai.ts`
- Test: `web/test/ai.test.ts`

**Interfaces:**
- Consumes: Task 6 `computeMoveRange`, `pathTo`; Task 7 `canAttack`, `magicRadius`; Task 5 grid 함수; Task 10 `BattleState`.
- Produces: `interface AiDecision { dest: [number, number]; path: Dir[]; action: number | null; cell: [number, number] | null; faceDir: Dir | null }`, `chooseAction(state: BattleState, unit: Unit, tables: Tables): AiDecision`, `AI_R = 4`, `LAND_BONUS`.

- [ ] **Step 1: 실패하는 테스트**

`web/test/ai.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../src/battle/ai';
import { BattleGrid, dist } from '../src/battle/grid';
import { Rng } from '../src/battle/rng';
import type { BattleState } from '../src/battle/types';
import { flatMap, MAGIC, tables, unit, units } from './helpers/battleFixtures';

const entry = { event: 1, label: 'x', map: 'stage49', roster: 49, episode: '', objective: '', heal: true };
function state(map = flatMap(11), us = units()): BattleState {
  return { entry, map, grid: new BattleGrid(map), units: us, turn: 1, phase: { kind: 'enemy', queue: [] }, rng: Rng.fromSeed(1), lastPath: [] };
}
const t = tables();

describe('chooseAction (FUN_004118b0 / FUN_00411b10)', () => {
  it('walks next to the nearest hero and attacks it', () => {
    const slime = unit({ slot: 10, id: 8, race: 1, side: 4, c: 5, r: 2, weapon: 1, moved: false, acted: false });
    const hero = unit({ slot: 0, c: 5, r: 6 });
    const d = chooseAction(state(flatMap(11), units(hero, slime)), slime, t);
    expect(dist(d.dest[0], d.dest[1], 5, 6)).toBe(1);
    expect(d.action).toBe(0);
    expect(d.cell).toEqual([5, 6]);
    expect(d.path.length).toBeGreaterThan(0);
  });
  it('prefers the hero\'s back when both adjacent cells are reachable', () => {
    const slime = unit({ slot: 10, id: 8, race: 1, side: 4, c: 5, r: 3, weapon: 1, moved: false, acted: false });
    const hero = unit({ slot: 0, c: 5, r: 5, dir: 0 });                 // faces +r: its back is (5,4)
    const d = chooseAction(state(flatMap(11), units(hero, slime)), slime, t);
    expect(d.dest).toEqual([5, 4]);
  });
  it('a unit that already acted (passive mode) moves away from enemies and does nothing', () => {
    const slime = unit({ slot: 10, id: 8, race: 1, side: 4, c: 5, r: 4, weapon: 1, moved: false, acted: true });
    const hero = unit({ slot: 0, c: 5, r: 6 });
    const d = chooseAction(state(flatMap(11), units(hero, slime)), slime, t);
    expect(dist(d.dest[0], d.dest[1], 5, 6)).toBeGreaterThan(2);
    expect(d.action).toBeNull();
  });
  it('stays and turns toward the nearest enemy when nothing is reachable', () => {
    const map = flatMap(11, (c, r) => (dist(c, r, 2, 2) === 1 ? { blocked: 1 } : {}));
    const slime = unit({ slot: 10, id: 8, race: 1, side: 4, c: 2, r: 2, weapon: 1, moved: false, acted: false });
    const hero = unit({ slot: 0, c: 9, r: 2 });
    const d = chooseAction(state(map, units(hero, slime)), slime, t);
    expect(d).toEqual({ dest: [2, 2], path: [], action: null, cell: null, faceDir: 1 });
  });
  it('a healer casts healing on a wounded ally instead of attacking', () => {
    const magic = t.magic.slice(); magic[40] = MAGIC({ name: 'healing', shape: 1, target: 1, elem0: 0, elem2: 1, range_min: 0, range_max: 6 });
    const tt = { ...t, magic };
    const healer = unit({ slot: 10, id: 8, race: 0, side: 4, c: 5, r: 5, weapon: 1, spells: [40], mp: 20, moved: false, acted: false });
    const wounded = unit({ slot: 11, id: 8, race: 1, side: 4, c: 7, r: 5, hp: 3, hpMax: 30 });
    const hero = unit({ slot: 0, c: 5, r: 9 });
    const d = chooseAction(state(flatMap(11), units(hero, healer, wounded)), healer, tt);
    expect(d.action).toBe(40);
    expect(d.cell).toEqual([7, 5]);
  });
  it('is deterministic', () => {
    const mk = () => { const slime = unit({ slot: 10, id: 8, race: 1, side: 4, c: 3, r: 3, weapon: 1, moved: false, acted: false }); return chooseAction(state(flatMap(11), units(unit({ slot: 0, c: 8, r: 8 }), slime)), slime, t); };
    expect(mk()).toEqual(mk());
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/ai.test.ts 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/battle/ai`

- [ ] **Step 3: 구현**

`web/src/battle/ai.ts`:

```ts
import { elems, type MagicData, type Tables } from '../data/types';
import { dirTo, dist, hostile, incap, liveUnits, stepCell, unitAt, unitsWithin, type Dir } from './grid';
import { computeMoveRange, pathTo } from './moveRange';
import { canAttack, magicRadius } from './targets';
import type { BattleState } from './types';
import type { Unit } from './unit';

export interface AiDecision { dest: [number, number]; path: Dir[]; action: number | null; cell: [number, number] | null; faceDir: Dir | null }

export const AI_R = 4;                                       // DAT_0044a058
export const LAND_BONUS = [0, 10, 15, 20, 40, 15, 20, 10];   // DAT_0044ab00
const HALF = 10;
const trunc = Math.trunc;

interface CellScore { c: number; r: number; move: number; attack: number; attackTarget: Unit | null; magic: number; magicId: number; target: [number, number] | null }

const CURE_SCORE: Record<number, number> = { 2: 60, 8: 60, 3: 50, 4: 80, 5: 70, 7: 80 };
const REDUNDANT: Record<number, number> = { 5: 8, 11: 8, 12: 8, 24: 3, 50: 2, 52: 7, 78: 5 };
const LINE_REDUNDANT: Record<number, number> = { 72: 5, 73: 2, 74: 8, 75: 4 };

/** FUN_00411b10 + FUN_004118b0: score every reachable cell, pick the best, then decide attack / magic / facing. */
export function chooseAction(state: BattleState, u: Unit, tables: Tables): AiDecision {
  const { grid, units } = state;
  const race = tables.race[u.race]!;
  const weapon = tables.item[u.weapon]!;
  let mode = u.side === 0 ? 4 : u.side;
  if (mode !== 6 && (u.acted || incap(u.status))) mode = 5;
  const table = computeMoveRange(grid, units, u, race);
  const canMove = !u.moved && !incap(u.status);
  const canAct = !u.acted && !incap(u.status);
  const enemies = liveUnits(units).filter((v) => v !== u && v.status !== 9 && hostile(u, v) && v.status !== 1 && v.side !== 7);
  const nearestEnemyDist = (c: number, r: number) => enemies.reduce((m, v) => Math.min(m, dist(v.c, v.r, c, r)), 999);

  const scores: CellScore[] = [];
  for (let dy = -HALF; dy <= HALF; dy++) {
    for (let dx = -HALF; dx <= HALF; dx++) {
      const c = u.c + dx, r = u.r + dy, own = dx === 0 && dy === 0;
      const s: CellScore = { c, r, move: 0, attack: 0, attackTarget: null, magic: 0, magicId: 0, target: null };
      scores.push(s);
      const cell = grid.cell(c, r);
      const occupant = unitAt(units, c, r);
      if (!cell || table.moveAt(c, r) === 0 || (occupant && occupant !== u)) { s.move = -9999; continue; }
      if (!canMove && !own) continue;
      if (own && mode === 2) s.move = 10;
      if (own && mode === 5) {
        s.move = 10;
        if (unitsWithin(units, c, r, 1, AI_R).some((v) => hostile(v, u) && !incap(v.status))) s.move = 0;
      }
      s.move += trunc((LAND_BONUS[cell.land] ?? 0) / (mode === 5 ? 5 : 10));
      let acc = 0, adjacent = 0;
      for (const v of unitsWithin(units, c, r, 1, AI_R)) {
        if (mode !== 6 && hostile(u, v) && !incap(v.status)) { s.move -= trunc(acc / 2); acc += 3; adjacent++; }
      }
      if (mode === 5 || adjacent === 0) {
        let dmin = nearestEnemyDist(c, r);
        if (mode === 6) dmin *= 2;
        s.move += mode === 5 ? dmin : AI_R - dmin;
      }
      if (canAct) {
        const cands = unitsWithin(units, c, r, weapon.range_min, weapon.range_max);
        if (cands.length > 0) {
          let base = mode === 5 ? 5 : mode === 6 ? 40 : 20;
          if (mode === 2 && own) { base += 10; s.move = 0; }
          for (const v of cands) {
            if (!canAttack(grid, c, r, u, v, weapon)) continue;
            let bonus = 8;
            const d = dirTo(c, r, v.c, v.r);
            if (d !== v.dir) bonus = (d ^ 3) === v.dir ? 0 : 4;
            if (v.status === 7) base = 5;
            if (mode === 5) bonus >>= 2;
            if (u.side === 0 && ((v.c === c && u.c === c) || (v.r === r && u.r === r)) && dist(u.c, u.r, c, r) > 2) bonus += 40;
            const score = base + bonus;
            if (score > s.attack) { s.attack = score; s.attackTarget = v; }
          }
        }
        u.spells.forEach((m, i) => scoreMagic(s, u, m, i * 10, mode, own, state, tables));
      }
    }
  }
  let best: CellScore | null = null, bestDist = 999;
  for (const s of scores) {
    if (s.move === -9999) continue;
    const total = s.move + Math.max(s.attack, s.magic);
    const d = Math.abs(s.c - u.c) + Math.abs(s.r - u.r);
    if (!best || total > best.move + Math.max(best.attack, best.magic) || (total === best.move + Math.max(best.attack, best.magic) && d < bestDist)) { best = s; bestDist = d; }
  }
  const dest: [number, number] = best ? [best.c, best.r] : [u.c, u.r];
  const path = dest[0] === u.c && dest[1] === u.r ? [] : pathTo(table, grid, u, race, dest);
  if (!best || best.magicId === 0 || best.magic <= best.attack) {
    if (best?.attackTarget) return { dest, path, action: 0, cell: [best.attackTarget.c, best.attackTarget.r], faceDir: null };
    let near: Unit | null = null;
    for (const v of enemies) if (!near || dist(v.c, v.r, dest[0], dest[1]) < dist(near.c, near.r, dest[0], dest[1])) near = v;
    return { dest, path, action: null, cell: null, faceDir: near ? dirTo(dest[0], dest[1], near.c, near.r) : null };
  }
  return { dest, path, action: best.magicId, cell: best.target, faceDir: null };
}

/** Magic scoring for one spell slot from cell (s.c, s.r). `pen` = slot index × 10. */
function scoreMagic(s: CellScore, u: Unit, m: number, pen: number, mode: number, own: boolean, state: BattleState, tables: Tables): void {
  const { grid, units } = state;
  if (m === 0 || u.status === 6 || m === 31) return;
  const M = tables.magic[m]!;
  if (u.mp < Math.abs(M.mp_cost)) return;
  const campOk = (v: Unit) => (v.status !== 1 && v.side !== 7) || M.target === 2 || hostile(u, v) === (M.target === 0);
  let rmin = 0, rmax = 0, tmin = 0, tmax = 0;
  switch (M.shape) {
    case 0: rmin = M.range_min; rmax = M.range_max; break;
    case 1: rmin = M.range_min; rmax = M.range_max; tmax = magicRadius(u, M); break;
    case 3: tmin = M.range_min; tmax = M.range_max; break;
    case 4: tmax = 9999; break;
    case 2: scoreLine(s, u, m, M, mode, state, tables); return;
    default: return;
  }
  for (let ty = s.r - rmax; ty <= s.r + rmax; ty++) {
    for (let tx = s.c - rmax; tx <= s.c + rmax; tx++) {
      const cell = grid.cell(tx, ty);
      const d = dist(tx, ty, s.c, s.r);
      if (!cell || cell.blocked !== 0 || d < rmin || d > rmax) continue;
      const victims = unitsWithin(units, tx, ty, tmin, tmax);
      if (victims.length === 0) continue;
      let sc = 0;
      for (const v of victims) {
        if (!campOk(v)) continue;
        const onCell = v.c === tx && v.r === ty;
        if (m === 13 || m === 45) {
          if (!hostile(u, v) && v.status !== 0) sc = CURE_SCORE[v.status] ?? 0;
          if (sc > 0 && onCell) sc += 1;
        } else if (m === 32 || m === 40) {
          if (!hostile(u, v) && v.status !== 1 && v.side !== 7 && v.hp < v.hpMax) sc += trunc(((v.hpMax - v.hp) * 100) / v.hpMax);
          if (sc > 0 && onCell) sc += 1;
        } else if (m === 41) {
          if (!hostile(u, v) && (v.status === 1 || v.side === 7)) sc = 100;
        } else if (m === 55 || m === 81) {
          if (u.hp < u.hpMax && v.status !== 1 && v.side !== 7 && hostile(u, v)) sc = sc - u.hp + (u.hpMax - trunc(v.mgr / 10));
        } else if (!hostile(u, v)) {
          sc -= mode === 6 ? 10 : 20;
        } else {
          sc += 30 + (mode === 6 ? 20 : 0);
          if (onCell) sc += 1;
          if (REDUNDANT[m] === v.status) sc -= 20;
        }
      }
      if (sc > 0 && own) sc += 5;
      if (sc - pen > s.magic) { s.magic = sc - pen; s.magicId = m; s.target = [tx, ty]; }
    }
  }
}

/** Shape 2 (line) scoring: per direction sum over aligned units; the best direction's last unit is the target. */
function scoreLine(s: CellScore, u: Unit, m: number, M: MagicData, mode: number, state: BattleState, tables: Tables): void {
  if (m === 62) return;
  const { grid, units } = state;
  const sums = [0, 0, 0, 0], last: (Unit | null)[] = [null, null, null, null];
  for (const v of unitsWithin(units, s.c, s.r, M.range_min, M.range_max)) {
    if (v.status === 1 || v.side === 7 || v === u) continue;
    if (!(M.target === 2 || hostile(u, v) === (M.target === 0))) continue;
    if (v.c !== s.c && v.r !== s.r) continue;
    const d = dirTo(s.c, s.r, v.c, v.r);
    if (!hostile(u, v)) { sums[d] -= 40; last[d] = v; continue; }
    if (m === 77) {
      let [c, r] = [s.c, s.r], blocked = false, steps = dist(s.c, s.r, v.c, v.r);
      while (steps-- > 0) { const [nc, nr] = stepCell(c, r, d); if (grid.height(nc, nr) > grid.height(c, r)) { blocked = true; break; } [c, r] = [nc, nr]; }
      if (blocked) continue;
    }
    sums[d] += mode === 6 ? 40 : 20;
    if (LINE_REDUNDANT[m] === v.status) sums[d] -= 20;
    last[d] = v;
  }
  let bestDir = -1;
  for (let d = 0; d < 4; d++) if (sums[d]! > 0 && (bestDir < 0 || sums[d]! > sums[bestDir]!)) bestDir = d;
  if (bestDir >= 0 && sums[bestDir]! > s.magic) {
    s.magic = sums[bestDir]!; s.magicId = m;
    const v = last[bestDir]!; s.target = [v.c, v.r];
  }
  void elems;
}
```

`void elems;`는 import 정리 전 임시다: `elems`를 쓰지 않으면 import 줄에서 지운다(미사용 import는 `tsc`가 허용하지만 깔끔히 한다).

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/ai.test.ts 2>&1 | tail -3`
Expected: `Tests  6 passed`. 두 번째 테스트(등 뒤 선호)는 (5,4)와 (5,6)이 아니라 (5,4)·(4,5)·(6,5)가 후보다: 배후 (5,4) 보너스 8 > 측면 4 → (5,4). 세 번째 테스트에서 수세 모드는 `+dmin`이므로 가장 먼 도달 셀을 고른다.

- [ ] **Step 5: 커밋**

```bash
git add web/src/battle/ai.ts web/test/ai.test.ts
git commit -m "feat(web): enemy AI scoring table ported from FUN_00411b10"
```

---
### Task 12: 전투 상태 기계와 파티 규칙

**Files:**
- Create: `web/src/battle/battle.ts`
- Test: `web/test/battle.test.ts`

**Interfaces:**
- Consumes: Tasks 3–11 전부, Task 2 `DataError`, `RosterUnit`, `BattleEntry`.
- Produces: `createParty(roster1, tables, rng): (Unit | null)[]`, `applyRoster(units, roster, tables, rng): void`, `syncPartyLevels(units, roster, tables, rng): void`, `startBattle(units, heal): void`, `isDash(grid, unit, path, target: [c, r], weapon): boolean`, `class Battle { readonly state: BattleState; static start(entry, map, roster1, roster, tables, seed): Battle; reduce(cmd: Command): BattleEvent[]; partyFinished(): boolean }`.

- [ ] **Step 1: 실패하는 테스트**

`web/test/battle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyRoster, Battle, createParty, isDash } from '../src/battle/battle';
import { BattleGrid } from '../src/battle/grid';
import type { BattleEvent, Command } from '../src/battle/types';
import { DataError } from '../src/data/loader';
import type { RosterUnit } from '../src/data/types';
import { fixedRng, flatMap, tables, unit } from './helpers/battleFixtures';

const entry = { event: 1, label: 'outfield', map: 'stage49', roster: 49, episode: '첫업무', objective: '!', heal: true };
const t = tables();
const rec = (over: Partial<RosterUnit>): RosterUnit => ({ unit_id: 1, race: 0, level: 2, dir: 2, c: 1, r: 1, status: 0, side: 0, weapon: 1, armor: 5, drop_item: 0, drop_gold: 0, ...over });
const roster1 = [rec({ unit_id: 1 }), rec({ unit_id: 2, race: 0, c: 1, r: 2, weapon: 1, armor: 0 })];
/** two heroes at the left, two slimes at the right of a 9×9 map. */
const roster = [rec({ unit_id: 1, level: 3, c: 2, r: 4, weapon: 0, armor: 0 }), rec({ unit_id: 2, c: 2, r: 5, weapon: 0, armor: 0 }),
  rec({ unit_id: 8, race: 1, level: 1, side: 4, c: 6, r: 4, weapon: 1 }), rec({ unit_id: 8, race: 1, level: 1, side: 4, c: 7, r: 6, weapon: 1 })];
const start = (seed = 1, map = flatMap(9), ros = roster) => Battle.start(entry, map, roster1, ros, t, seed);
const types = (events: BattleEvent[]) => events.map((e) => e.type);

describe('party rules (spec §11)', () => {
  it('createParty builds slots 0.. from roster 1 with equipment; applyRoster keeps stats and moves the party', () => {
    const units = createParty(roster1, t, fixedRng([0]));
    expect(units[0]).toMatchObject({ id: 1, weapon: 1, armor: 5, level: 2 });
    expect(units[1]).toMatchObject({ id: 2, slot: 1 });
    applyRoster(units, roster, t, fixedRng([0]));
    expect(units[0]).toMatchObject({ c: 2, r: 4, weapon: 1, armor: 5, level: 2 });     // position only
    expect(units[10]).toMatchObject({ id: 8, race: 1, side: 4, c: 6, r: 4 });
    expect(units[11]).toMatchObject({ slot: 11, c: 7, r: 6 });
  });
  it('Battle.start syncs party levels up to the roster level, drops party members missing from the roster, heals and clears flags', () => {
    const b = start();
    expect(b.state.units[0]).toMatchObject({ level: 3, moved: false, acted: false });
    expect(b.state.units[0]!.hp).toBe(b.state.units[0]!.hpMax);
    expect(b.state.units[0]!.mp).toBe(Math.trunc(b.state.units[0]!.mpMax / 2));
    const solo = Battle.start(entry, flatMap(9), roster1, roster.filter((r) => r.unit_id !== 2), t, 1);
    expect(solo.state.units[1]).toBeNull();
    expect(solo.state.phase).toEqual({ kind: 'player', sel: { mode: 'idle' } });
  });
  it('rejects a roster unit placed on a missing cell', () => {
    const map = flatMap(9);
    map.cellAt[6 * 9 + 4] = -1;
    expect(() => start(1, map)).toThrow(DataError);
    expect(() => start(1, map)).toThrow(/\(6, 4\)/);
  });
});

describe('isDash (FUN_0043afd0)', () => {
  const grid = new BattleGrid(flatMap(9, (c, r) => (c === 4 && r === 4 ? { h: 3 } : {})));
  const hero = unit({ slot: 0, c: 5, r: 4, side: 0 });
  it('needs a party unit, three straight steps in the attack direction, flat ground and no special flag', () => {
    expect(isDash(grid, hero, [1, 1, 1], [6, 4], t.item[1]!)).toBe(false);    // passes over h 3 at (4,4)
    expect(isDash(grid, { ...hero, r: 2 }, [1, 1, 1], [6, 2], t.item[1]!)).toBe(true);
    expect(isDash(grid, { ...hero, r: 2 }, [1, 1], [6, 2], t.item[1]!)).toBe(false);
    expect(isDash(grid, { ...hero, r: 2 }, [1, 1, 1], [5, 3], t.item[1]!)).toBe(false);   // attack not in the run direction
    expect(isDash(grid, { ...hero, r: 2, special: true }, [1, 1, 1], [6, 2], t.item[1]!)).toBe(false);
    expect(isDash(grid, { ...hero, r: 2, side: 4 }, [1, 1, 1], [6, 2], t.item[1]!)).toBe(false);
    expect(isDash(grid, { ...hero, r: 2 }, [1, 1, 1], [7, 2], t.item[2]!)).toBe(false);   // bow needs an adjacent target
  });
});

describe('Battle.reduce — player phase', () => {
  it('select → beginMove → move → beginTarget → act → face runs one unit through its turn', () => {
    const b = start(1);
    expect(types(b.reduce({ type: 'select', slot: 0 }))).toEqual(['selected']);
    expect(b.state.phase).toMatchObject({ kind: 'player', sel: { mode: 'menu', slot: 0 } });
    expect(types(b.reduce({ type: 'beginMove' }))).toEqual([]);
    const moved = b.reduce({ type: 'move', c: 5, r: 4 });
    expect(moved).toEqual([{ type: 'moved', slot: 0, path: [1, 1, 1], to: [5, 4] }]);
    expect(b.state.units[0]).toMatchObject({ c: 5, r: 4, dir: 1, moved: true });
    expect(types(b.reduce({ type: 'beginTarget', action: 0 }))).toEqual([]);
    expect(b.state.phase).toMatchObject({ sel: { mode: 'target', action: 0 } });
    const acted = b.reduce({ type: 'act', c: 6, r: 4 });
    expect(acted[0]).toMatchObject({ type: 'action', slot: 0, action: 0, cell: [6, 4] });
    expect(b.state.units[0]!.acted).toBe(true);
    expect(b.state.phase).toMatchObject({ sel: { mode: 'face', slot: 0 } });
    expect(b.reduce({ type: 'face', dir: 3 })).toEqual([{ type: 'faced', slot: 0, dir: 3 }]);
    expect(b.state.units[0]!.dir).toBe(3);
    expect(b.state.phase).toMatchObject({ sel: { mode: 'idle' } });
  });
  it('rejects commands the rules forbid without changing state', () => {
    const b = start(1);
    expect(b.reduce({ type: 'select', slot: 10 })).toEqual([{ type: 'rejected', reason: 'not a party unit' }]);
    expect(b.reduce({ type: 'move', c: 3, r: 4 })).toEqual([{ type: 'rejected', reason: 'no unit selected' }]);
    b.reduce({ type: 'select', slot: 0 });
    expect(b.reduce({ type: 'move', c: 3, r: 4 })).toEqual([{ type: 'rejected', reason: 'not moving' }]);
    b.reduce({ type: 'beginMove' });
    expect(b.reduce({ type: 'move', c: 2, r: 5 })).toEqual([{ type: 'rejected', reason: 'cannot stop there' }]);   // ally stands there
    b.reduce({ type: 'move', c: 3, r: 4 });
    expect(b.reduce({ type: 'beginMove' })).toEqual([{ type: 'rejected', reason: 'already moved' }]);
    expect(b.reduce({ type: 'beginTarget', action: 0 })).toEqual([{ type: 'rejected', reason: 'no target in range' }]);
    expect(b.reduce({ type: 'beginTarget', action: 2 })).toEqual([{ type: 'rejected', reason: 'unknown spell' }]);   // heal (learn_mask 2) belongs to id 2
    b.reduce({ type: 'wait' });
    expect(b.state.phase).toMatchObject({ sel: { mode: 'face' } });
    expect(b.reduce({ type: 'cancel' })).toEqual([{ type: 'rejected', reason: 'choose a direction' }]);
    b.reduce({ type: 'face', dir: 0 });
    expect(b.reduce({ type: 'select', slot: 0 })).toEqual([{ type: 'rejected', reason: 'unit finished' }]);
  });
  it('move is rejected when the range has no reachable cell', () => {
    const map = flatMap(9, (c, r) => ((Math.abs(c - 2) + Math.abs(r - 4) === 1) ? { blocked: 1 } : {}));
    const b = start(1, map, roster.map((r) => (r.unit_id === 2 ? { ...r, c: 0, r: 0 } : r)));
    b.reduce({ type: 'select', slot: 0 });
    expect(b.reduce({ type: 'beginMove' })).toEqual([{ type: 'rejected', reason: 'nowhere to move' }]);
  });
  it('cancel steps back: target → menu → idle; the enemy phase refuses player commands', () => {
    const b = start(1);
    b.reduce({ type: 'select', slot: 0 });
    b.reduce({ type: 'beginMove' });
    expect(b.reduce({ type: 'cancel' })).toEqual([]);
    expect(b.state.phase).toMatchObject({ sel: { mode: 'menu' } });
    expect(b.reduce({ type: 'cancel' })).toEqual([{ type: 'deselected' }]);
    b.reduce({ type: 'endTurn' });
    expect(b.state.phase.kind).toBe('enemy');
    expect(b.reduce({ type: 'select', slot: 0 })).toEqual([{ type: 'rejected', reason: 'enemy phase' }]);
  });
});

describe('Battle.reduce — enemy phase and rounds', () => {
  it('endTurn queues every hostile enemy; enemySteps run them and a new round starts', () => {
    const b = start(1);
    const ev = b.reduce({ type: 'endTurn' });
    expect(ev[0]).toEqual({ type: 'phase', kind: 'enemy' });
    expect(b.state.phase).toEqual({ kind: 'enemy', queue: [10, 11] });
    const step1 = b.reduce({ type: 'enemyStep' });
    expect(step1.some((e) => e.type === 'moved')).toBe(true);
    expect(b.state.units[10]!.moved).toBe(true);
    expect(b.state.phase).toEqual({ kind: 'enemy', queue: [11] });
    const step2 = b.reduce({ type: 'enemyStep' });                  // last queued unit → the round ends in the same batch
    expect(types(step2).slice(-2)).toEqual(['roundStart', 'phase']);
    expect(b.state.turn).toBe(2);
    expect(b.state.units[0]!.moved).toBe(false);
    expect(b.reduce({ type: 'enemyStep' })).toEqual([{ type: 'rejected', reason: 'player phase' }]);
  });
  it('all party units finished → the enemy phase begins by itself', () => {
    const b = start(1);
    for (const slot of [0, 1]) { b.reduce({ type: 'select', slot }); b.reduce({ type: 'wait' }); b.reduce({ type: 'face', dir: 1 }); }
    expect(b.state.phase.kind).toBe('enemy');
  });
  it('killing the last enemy ends the battle with victory and later commands are rejected', () => {
    const b = Battle.start(entry, flatMap(9), roster1, [roster[0]!, roster[1]!, { ...roster[2]!, c: 3, r: 4 }], t, 1);
    const slime = b.state.units[10]!;
    slime.hp = 1;
    b.state.rng = fixedRng([99]);                                   // no critical, no evade
    b.reduce({ type: 'select', slot: 0 });
    b.reduce({ type: 'beginTarget', action: 0 });
    const ev = b.reduce({ type: 'act', c: 3, r: 4 });
    expect(ev.some((e) => e.type === 'end' && e.result === 'victory')).toBe(true);
    expect(b.state.phase).toEqual({ kind: 'end', result: 'victory' });
    expect(b.reduce({ type: 'select', slot: 1 })).toEqual([{ type: 'rejected', reason: 'battle over' }]);
  });
  it('the same seed and commands produce the same events', () => {
    const script: Command[] = [{ type: 'select', slot: 0 }, { type: 'beginMove' }, { type: 'move', c: 5, r: 4 }, { type: 'beginTarget', action: 0 },
      { type: 'act', c: 6, r: 4 }, { type: 'face', dir: 1 }, { type: 'endTurn' }, { type: 'enemyStep' }, { type: 'enemyStep' }, { type: 'enemyStep' }];
    const run = () => { const b = start(42); return JSON.stringify(script.flatMap((c) => b.reduce(c))); };
    expect(run()).toBe(run());
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/battle.test.ts 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/battle/battle`

- [ ] **Step 3: 구현**

`web/src/battle/battle.ts`:

```ts
import type { MapData } from '../assets/types';
import { DataError } from '../data/loader';
import type { BattleEntry, ItemData, RosterUnit, Tables } from '../data/types';
import { chooseAction } from './ai';
import { BattleGrid, dirTo, dist, hostile, incap, liveUnits, stepCell, unitAt, type Dir } from './grid';
import { canStop, computeMoveRange, markTargets, pathTo, RangeTable } from './moveRange';
import { applyOutcome, roundStart, statusTick } from './outcome';
import { resolveAction } from './resolve';
import { Rng, type RandomSource } from './rng';
import { targetsOf } from './targets';
import type { BattleEvent, BattleState, Command, Selection } from './types';
import { createUnit, growUnit, MAX_SLOTS, PARTY_SLOTS, type Unit } from './unit';

const freeSlot = (units: (Unit | null)[], from: number, to: number): number => { for (let s = from; s < to; s++) if (!units[s]) return s; return -1; };

/** New-game party: the side-0 records of roster 1 go into slots 0..9 (equipment included). */
export function createParty(roster1: RosterUnit[], tables: Tables, rng: RandomSource): (Unit | null)[] {
  const units = new Array<Unit | null>(MAX_SLOTS).fill(null);
  for (const rec of roster1) {
    if (rec.side !== 0) continue;
    const slot = freeSlot(units, 0, PARTY_SLOTS);
    if (slot >= 0) units[slot] = createUnit(rec, slot, tables, rng);
  }
  return units;
}

/** LOAD_UNITS (FUN_0041fcf0 + FUN_0041fae0): clear slots 10..49, place every record; existing party units only move. */
export function applyRoster(units: (Unit | null)[], roster: RosterUnit[], tables: Tables, rng: RandomSource): void {
  for (let s = PARTY_SLOTS; s < MAX_SLOTS; s++) units[s] = null;
  for (const rec of roster) {
    if (rec.side === 0) {
      const existing = units.slice(0, PARTY_SLOTS).find((u) => u && u.id === rec.unit_id);
      if (existing) { existing.c = rec.c; existing.r = rec.r; existing.dir = (rec.dir & 3) as Dir; existing.status = rec.status; continue; }
    }
    const slot = rec.side === 0 ? freeSlot(units, 0, PARTY_SLOTS) : freeSlot(units, PARTY_SLOTS, MAX_SLOTS);
    if (slot >= 0) units[slot] = createUnit(rec, slot, tables, rng);
  }
}

/** Remake rule (spec §11.3): a party unit below the roster's level grows deterministically up to it. */
export function syncPartyLevels(units: (Unit | null)[], roster: RosterUnit[], tables: Tables, rng: RandomSource): void {
  for (const rec of roster) {
    if (rec.side !== 0) continue;
    const u = units.slice(0, PARTY_SLOTS).find((x) => x && x.id === rec.unit_id);
    if (!u) continue;
    while (u.level < rec.level) { u.level++; growUnit(u, tables.race[u.race]!, false, rng, tables.magic); }
  }
}

/** BATTLE_START(_HEAL): flags cleared, buffs and the special flag reset; with heal HP = max and MP = max/2. */
export function startBattle(units: (Unit | null)[], heal: boolean): void {
  for (const u of units) {
    if (!u) continue;
    u.moved = false; u.acted = false; u.special = false;
    u.buff = { str: 0, def: 0, wis: 0, mgr: 0, agi: 0 };
    if (heal && u.status !== 1) { u.hp = u.hpMax; u.mp = Math.trunc(u.mpMax / 2); }
  }
}

/** FUN_0043afd0 dash: party unit, no special flag, last three steps straight toward the target, each step |Δh| ≤ 2, not levitating; bows need an adjacent target. */
export function isDash(grid: BattleGrid, unit: Unit, path: Dir[], target: [number, number], weapon: ItemData): boolean {
  if (unit.side !== 0 || unit.special || unit.status === 11 || path.length < 3) return false;
  const d = path[path.length - 1]!;
  if (path[path.length - 2] !== d || path[path.length - 3] !== d) return false;
  if (dirTo(unit.c, unit.r, target[0], target[1]) !== d) return false;
  if (weapon.weapon_type === 3 && dist(unit.c, unit.r, target[0], target[1]) !== 1) return false;
  let c = unit.c, r = unit.r;
  for (let i = 0; i < 3; i++) {
    const [pc, pr] = stepCell(c, r, (d ^ 3) as Dir);
    if (Math.abs(grid.height(pc, pr) - grid.height(c, r)) > 2) return false;
    c = pc; r = pr;
  }
  return true;
}

const reject = (reason: string): BattleEvent[] => [{ type: 'rejected', reason }];

export class Battle {
  constructor(readonly state: BattleState, private readonly tables: Tables) {}

  static start(entry: BattleEntry, map: MapData, roster1: RosterUnit[], roster: RosterUnit[], tables: Tables, seed: number): Battle {
    const rng = Rng.fromSeed(seed);
    const units = createParty(roster1, tables, rng);
    applyRoster(units, roster, tables, rng);
    const inRoster = new Set(roster.filter((r) => r.side === 0).map((r) => r.unit_id));
    for (let s = 0; s < PARTY_SLOTS; s++) if (units[s] && !inRoster.has(units[s]!.id)) units[s] = null;
    syncPartyLevels(units, roster, tables, rng);
    const grid = new BattleGrid(map);
    for (const u of liveUnits(units)) {
      if (!grid.cell(u.c, u.r)) throw new DataError(`roster/stage${String(entry.roster).padStart(3, '0')}.json`, `unit ${u.slot} (id ${u.id}) stands on a missing cell (${u.c}, ${u.r})`);
    }
    startBattle(units, entry.heal);
    return new Battle({ entry, map, grid, units, turn: 1, phase: { kind: 'player', sel: { mode: 'idle' } }, rng, lastPath: [] }, tables);
  }

  partyFinished(): boolean {
    return this.state.units.slice(0, PARTY_SLOTS).every((u) => !u || incap(u.status) || (u.moved && u.acted));
  }

  reduce(cmd: Command): BattleEvent[] {
    const s = this.state;
    if (s.phase.kind === 'end') return reject('battle over');
    if (s.phase.kind === 'enemy') return cmd.type === 'enemyStep' ? this.enemyStep() : reject('enemy phase');
    if (cmd.type === 'enemyStep') return reject('player phase');
    if (cmd.type === 'endTurn') return this.beginEnemyPhase();
    const sel = s.phase.sel;
    switch (cmd.type) {
      case 'select': return this.select(cmd.slot);
      case 'cancel': return this.cancel(sel);
      case 'beginMove': return this.beginMove(sel);
      case 'move': return this.move(sel, cmd.c, cmd.r);
      case 'beginTarget': return this.beginTarget(sel, cmd.action);
      case 'act': return this.act(sel, cmd.c, cmd.r);
      case 'wait': return this.wait(sel);
      case 'face': return this.face(sel, cmd.dir);
    }
  }

  private setSel(sel: Selection): void { this.state.phase = { kind: 'player', sel }; }

  private unitOf(sel: Selection): Unit | null {
    return sel.mode === 'idle' ? null : this.state.units[sel.slot] ?? null;
  }

  private rangeFor(u: Unit): RangeTable {
    const t = computeMoveRange(this.state.grid, this.state.units, u, this.tables.race[u.race]!);
    markTargets(t, this.state.grid, this.state.units, u, 0, this.tables);
    return t;
  }

  private select(slot: number): BattleEvent[] {
    const u = this.state.units[slot];
    if (!u || slot >= PARTY_SLOTS || u.side !== 0) return reject('not a party unit');
    if (incap(u.status) || (u.moved && u.acted)) return reject('unit finished');
    this.state.lastPath = [];
    this.setSel({ mode: 'menu', slot, range: this.rangeFor(u) });
    return [{ type: 'selected', slot }];
  }

  private cancel(sel: Selection): BattleEvent[] {
    if (sel.mode === 'idle') return reject('nothing to cancel');
    if (sel.mode === 'face') return reject('choose a direction');
    if (sel.mode === 'menu') { this.setSel({ mode: 'idle' }); return [{ type: 'deselected' }]; }
    this.setSel({ mode: 'menu', slot: sel.slot, range: sel.range });
    return [];
  }

  private beginMove(sel: Selection): BattleEvent[] {
    const u = this.unitOf(sel);
    if (!u || sel.mode !== 'menu') return reject(u ? 'not in menu' : 'no unit selected');
    if (u.moved) return reject('already moved');
    const range = this.rangeFor(u);
    let any = false;
    for (const cell of range.cells()) if ((cell.c !== u.c || cell.r !== u.r) && canStop(range, this.state.units, u, cell.c, cell.r)) { any = true; break; }
    if (!any) return reject('nowhere to move');
    this.setSel({ mode: 'move', slot: u.slot, range });
    return [];
  }

  private move(sel: Selection, c: number, r: number): BattleEvent[] {
    const u = this.unitOf(sel);
    if (!u) return reject('no unit selected');
    if (sel.mode !== 'move') return reject('not moving');
    if ((c === u.c && r === u.r) || !canStop(sel.range, this.state.units, u, c, r)) return reject('cannot stop there');
    const path = pathTo(sel.range, this.state.grid, u, this.tables.race[u.race]!, [c, r]);
    if (path.length === 0) return reject('no path');
    u.c = c; u.r = r; u.dir = path[path.length - 1]!; u.moved = true;
    this.state.lastPath = path;
    this.setSel({ mode: 'menu', slot: u.slot, range: this.rangeFor(u) });
    return [{ type: 'moved', slot: u.slot, path, to: [c, r] }];
  }

  private beginTarget(sel: Selection, action: number): BattleEvent[] {
    const u = this.unitOf(sel);
    if (!u || sel.mode !== 'menu') return reject(u ? 'not in menu' : 'no unit selected');
    if (u.acted) return reject('already acted');
    if (action !== 0) {
      if (!u.spells.includes(action) || !this.tables.magic[action]) return reject('unknown spell');
      if (u.mp < Math.abs(this.tables.magic[action]!.mp_cost)) return reject('not enough MP');
      if (u.status === 6) return reject('silenced');
    }
    const range = new RangeTable(u.c, u.r);
    if (markTargets(range, this.state.grid, this.state.units, u, action, this.tables) === 0) return reject('no target in range');
    this.setSel({ mode: 'target', slot: u.slot, action, range });
    return [];
  }

  private act(sel: Selection, c: number, r: number): BattleEvent[] {
    const u = this.unitOf(sel);
    if (!u) return reject('no unit selected');
    if (sel.mode !== 'target') return reject('not targeting');
    if (sel.range.kindAt(c, r) === 0) return reject('not a target cell');
    const dir = c !== u.c || r !== u.r ? dirTo(u.c, u.r, c, r) : u.dir;
    const probe = { ...u, dir };                                                   // facing is applied only when the action goes ahead
    const targets = targetsOf(this.state.grid, this.state.units, probe, sel.action, [c, r], this.tables).map((t) => (t === probe ? u : t));
    if (targets.length === 0) return reject('no target there');
    u.dir = dir;
    const events = this.perform(u, sel.action, [c, r], targets, this.state.lastPath);
    if (this.state.phase.kind === 'player') this.setSel(u.status === 1 ? { mode: 'idle' } : { mode: 'face', slot: u.slot });
    return events;
  }

  /** Shared by player and AI: MP, dash, resolution, flags, outcome. */
  private perform(u: Unit, action: number, cell: [number, number], targets: Unit[], path: Dir[]): BattleEvent[] {
    const weapon = this.tables.item[u.weapon]!;
    if (action !== 0) u.mp -= Math.abs(this.tables.magic[action]!.mp_cost);
    const dash = action === 0 && isDash(this.state.grid, u, path, cell, weapon);
    const hits = resolveAction(u, action, targets, { tables: this.tables, grid: this.state.grid, units: this.state.units, rng: this.state.rng, dash });
    u.acted = true;
    const events: BattleEvent[] = [{ type: 'action', slot: u.slot, action, cell, hits }];
    events.push(...applyOutcome(this.state, u, hits, this.tables));
    return events;
  }

  private wait(sel: Selection): BattleEvent[] {
    const u = this.unitOf(sel);
    if (!u || sel.mode !== 'menu') return reject(u ? 'not in menu' : 'no unit selected');
    u.moved = true; u.acted = true;
    this.setSel({ mode: 'face', slot: u.slot });
    return [];
  }

  private face(sel: Selection, dir: Dir): BattleEvent[] {
    const u = this.unitOf(sel);
    if (!u || sel.mode !== 'face') return reject(u ? 'not choosing a direction' : 'no unit selected');
    u.dir = dir; u.moved = true; u.acted = true;
    this.setSel({ mode: 'idle' });
    const events: BattleEvent[] = [{ type: 'faced', slot: u.slot, dir }];
    if (this.partyFinished()) events.push(...this.beginEnemyPhase());
    return events;
  }

  private beginEnemyPhase(): BattleEvent[] {
    const s = this.state;
    const party = liveUnits(s.units).filter((u) => u.slot < PARTY_SLOTS);
    const queue = liveUnits(s.units).filter((u) => u.slot >= PARTY_SLOTS && u.side !== 1 && u.side !== 7 && u.hp > 0 && !incap(u.status) && party.some((p) => hostile(u, p))).map((u) => u.slot);
    s.phase = { kind: 'enemy', queue };
    const events: BattleEvent[] = [{ type: 'phase', kind: 'enemy' }, ...statusTick(s, (u) => u.slot >= PARTY_SLOTS)];
    return queue.length === 0 ? [...events, ...this.endEnemyPhase()] : events;
  }

  private endEnemyPhase(): BattleEvent[] {
    const s = this.state;
    const events = statusTick(s, (u) => u.slot < PARTY_SLOTS);
    events.push(...roundStart(s));
    s.phase = { kind: 'player', sel: { mode: 'idle' } };
    events.push({ type: 'phase', kind: 'player' });
    return events;
  }

  private enemyStep(): BattleEvent[] {
    const s = this.state;
    if (s.phase.kind !== 'enemy') return reject('player phase');
    let u: Unit | null = null;
    while (s.phase.queue.length > 0 && !u) {
      const cand = s.units[s.phase.queue.shift()!];
      if (cand && cand.hp > 0 && !incap(cand.status) && cand.side !== 7) u = cand;
    }
    if (!u) return this.endEnemyPhase();
    const events: BattleEvent[] = [];
    const d = chooseAction(s, u, this.tables);
    if (d.path.length > 0) {
      u.c = d.dest[0]; u.r = d.dest[1]; u.dir = d.path[d.path.length - 1]!;
      events.push({ type: 'moved', slot: u.slot, path: d.path, to: d.dest });
    }
    u.moved = true;
    if (d.action !== null && d.cell) {
      if (d.cell[0] !== u.c || d.cell[1] !== u.r) u.dir = dirTo(u.c, u.r, d.cell[0], d.cell[1]);
      const targets = targetsOf(s.grid, s.units, u, d.action, d.cell, this.tables);
      if (targets.length > 0) events.push(...this.perform(u, d.action, d.cell, targets, d.path));
      else u.acted = true;
    } else if (d.faceDir !== null) {
      u.dir = d.faceDir;
      events.push({ type: 'faced', slot: u.slot, dir: d.faceDir });
    }
    if (s.phase.kind === 'enemy' && s.phase.queue.length === 0) events.push(...this.endEnemyPhase());
    return events;
  }
}
```

import 줄에서 쓰지 않는 이름(`unitAt`, `stepCell` 등)은 지운다.

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/battle.test.ts 2>&1 | tail -3`
Expected: `Tests  11 passed`. 첫 조작 테스트의 `move (5,4)`는 영웅(2,4)에서 동쪽 3칸이다(슬라임 (6,4)에 인접, 비용 5×3 = 15 ≤ 30, 적 인접 셀이라 ZOC로 이동력 1이 남지만 멈출 수 있다).

- [ ] **Step 5: 커밋**

```bash
git add web/src/battle/battle.ts web/test/battle.test.ts
git commit -m "feat(web): battle state machine — selection, move, act, face, enemy phase, rounds, party rules"
```

---

### Task 13: 렌더러 레이어 키·픽셀 오프셋·텍스트, 유닛 스프라이트 이름 규칙

**Files:**
- Modify: `web/src/render/renderer.ts`, `web/src/viewer/main.ts`
- Create: `web/src/field/unitSprites.ts`
- Test: `web/test/sortRow.test.ts`, `web/test/unitSprites.test.ts`

**Interfaces:**
- Consumes: 하위 프로젝트 1 `Renderer`, `PlacedSprite`, `Scene`; Task 4 `Unit`; Task 2 `RaceData`, `ItemData`.
- Produces: `PlacedSprite { model; player; c; r; layer: number; offset?: { x: number; y: number } }`, `Scene.texts?: { x: number; y: number; text: string }[]` (맵 픽셀 좌표), `sortRow(sprites: PlacedSprite[]): PlacedSprite[]` (layer 오름차순, 안정), `LAYER = { ground: 1, shadow: 2, object: 3, unit: 4, icon: 5 }`, `bodyApd(race): string`, `bodyAnim(u, items): { name: string; flipH: boolean } | null`, `shadowAnim(u, race): string | null`, `iconAnim(u): { name: string; dy: number } | null`, `pickTimeline(model: ApdModel, name: string): Timeline | undefined` (`name#` 우선).

- [ ] **Step 1: 실패하는 테스트**

`web/test/sortRow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sortRow, type PlacedSprite } from '../src/render/renderer';

const sp = (layer: number, tag: string) => ({ layer, tag } as unknown as PlacedSprite & { tag: string });

describe('sortRow', () => {
  it('orders by layer and keeps placement order within a layer', () => {
    const out = sortRow([sp(4, 'unit-a'), sp(2, 'shadow'), sp(5, 'icon'), sp(4, 'unit-b'), sp(1, 'tile')]) as (PlacedSprite & { tag: string })[];
    expect(out.map((s) => s.tag)).toEqual(['tile', 'shadow', 'unit-a', 'unit-b', 'icon']);
  });
});
```

`web/test/unitSprites.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bodyAnim, bodyApd, iconAnim, LAYER, pickTimeline, shadowAnim } from '../src/field/unitSprites';
import { ApdModel } from '../src/sprite/apdModel';
import type { ApdData } from '../src/assets/types';
import { ITEM, RACE, unit } from './helpers/battleFixtures';

const items = [ITEM({ name: 'none' }), ITEM({ name: 'sword' }), ITEM({ name: 'wings', slot: 2, status_code: 11 })];

describe('bodyApd / bodyAnim (FUN_0041e350)', () => {
  it('names the APD by race and the anim by facing prefix, state token and flip', () => {
    expect(bodyApd(10)).toBe('char_10a');
    expect(bodyAnim(unit({ slot: 0, dir: 0 }), items)).toEqual({ name: 'F.STAND', flipH: false });
    expect(bodyAnim(unit({ slot: 0, dir: 1 }), items)).toEqual({ name: 'F.STAND', flipH: true });
    expect(bodyAnim(unit({ slot: 0, dir: 2 }), items)).toEqual({ name: 'B.STAND', flipH: true });
    expect(bodyAnim(unit({ slot: 0, dir: 3 }), items)).toEqual({ name: 'B.STAND', flipH: false });
    expect(bodyAnim(unit({ slot: 0, dir: 1, race: 0x17 }), items)!.flipH).toBe(false);
  });
  it('finished party units stand COMPLETE; finished enemies STAND; dead party DEAD, dead enemies DOWN_DAMAGE', () => {
    expect(bodyAnim(unit({ slot: 0, moved: true, acted: true }), items)!.name).toBe('F.COMPLETE');
    expect(bodyAnim(unit({ slot: 10, side: 4, moved: true, acted: true }), items)!.name).toBe('F.STAND');
    expect(bodyAnim(unit({ slot: 0, status: 1 }), items)!.name).toBe('F.DEAD');
    expect(bodyAnim(unit({ slot: 10, side: 4, status: 1 }), items)!.name).toBe('F.DOWN_DAMAGE');
  });
  it('status tokens: petrified S/DAMAGE, frozen A/DAMAGE, levitating LEVITATE (also via a status-11 item), hidden → none, others DOWN_DAMAGE', () => {
    expect(bodyAnim(unit({ slot: 0, status: 4 }), items)!.name).toBe('F.S/DAMAGE');
    expect(bodyAnim(unit({ slot: 0, status: 5 }), items)!.name).toBe('F.A/DAMAGE');
    expect(bodyAnim(unit({ slot: 0, status: 11 }), items)!.name).toBe('F.LEVITATE');
    expect(bodyAnim(unit({ slot: 0, acc: [2, 0] }), items)!.name).toBe('F.LEVITATE');
    expect(bodyAnim(unit({ slot: 10, side: 4, status: 9 }), items)).toBeNull();
    expect(bodyAnim(unit({ slot: 10, side: 7, status: 9 }), items)!.name).toBe('F.HIDE');
    expect(bodyAnim(unit({ slot: 0, status: 2 }), items)!.name).toBe('F.DOWN_DAMAGE');
    expect(bodyAnim(unit({ slot: 0, status: 6 }), items)!.name).toBe('F.STAND');
  });
});

describe('shadowAnim / iconAnim (system.apd)', () => {
  it('shadow size follows race.size, +1 when down, −1 when levitating, none for hidden or size 0', () => {
    expect(shadowAnim(unit({ slot: 0 }), RACE({ size: 3 }))).toBe('LARGE.M');
    expect(shadowAnim(unit({ slot: 0, status: 1 }), RACE({ size: 3 }))).toBe('HUGE.M');
    expect(shadowAnim(unit({ slot: 0, status: 11 }), RACE({ size: 3 }))).toBe('MIDDLE.M');
    expect(shadowAnim(unit({ slot: 0, status: 11 }), RACE({ size: 1 }))).toBeNull();
    expect(shadowAnim(unit({ slot: 0, status: 9 }), RACE({ size: 3 }))).toBeNull();
    expect(shadowAnim(unit({ slot: 0 }), RACE({ size: 0 }))).toBeNull();
    expect(shadowAnim(unit({ slot: 0 }), RACE({ size: 1 }))).toBe('SMALL.M');
  });
  it('status icons sit 56 px above the unit, 16 px for the dead; only party units show DEAD', () => {
    expect(iconAnim(unit({ slot: 0, status: 2 }))).toEqual({ name: 'POISON', dy: -56 });
    expect(iconAnim(unit({ slot: 0, status: 3 }))).toEqual({ name: 'SLEEP', dy: -56 });
    expect(iconAnim(unit({ slot: 0, status: 6 }))).toEqual({ name: 'MUTE', dy: -56 });
    expect(iconAnim(unit({ slot: 0, status: 7 }))).toEqual({ name: 'CHARM', dy: -56 });
    expect(iconAnim(unit({ slot: 0, status: 1 }))).toEqual({ name: 'DEAD', dy: -16 });
    expect(iconAnim(unit({ slot: 10, side: 4, status: 1 }))).toBeNull();
    expect(iconAnim(unit({ slot: 0 }))).toBeNull();
    expect(LAYER).toEqual({ ground: 1, shadow: 2, object: 3, unit: 4, icon: 5 });
  });
});

describe('pickTimeline', () => {
  it('prefers the "#" variant and falls back to the plain name', () => {
    const data: ApdData = { version: 3, sheets: ['s'], images: [{ sheet: 0, key: 255, x: 0, y: 0, w: 8, h: 8, ox: 0, oy: 0 }], patterns: [{ yOffset: 0, images: [0] }],
      anims: [{ name: 'F.STAND', script: 'P0' }, { name: 'F.STAND#', script: 'P0 P0' }, { name: 'B.STAND', script: 'P0' }] };
    const model = new ApdModel('x', data, [{ width: 8, height: 8, indices: new Uint8Array(64), palette: new Uint8Array(768) }]);
    expect(pickTimeline(model, 'F.STAND')!.name).toBe('F.STAND#');
    expect(pickTimeline(model, 'B.STAND')!.name).toBe('B.STAND');
    expect(pickTimeline(model, 'F.RUN1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/sortRow.test.ts test/unitSprites.test.ts 2>&1 | tail -3`
Expected: FAIL — `sortRow` is not exported; cannot resolve `../src/field/unitSprites`

- [ ] **Step 3: 렌더러 수정**

`web/src/render/renderer.ts`:

1. 타입을 바꾼다:
```ts
export interface PlacedSprite { model: ApdModel; player: AnimPlayer; c: number; r: number; layer: number; offset?: { x: number; y: number } }
export interface SceneText { x: number; y: number; text: string }   // map pixels, centered
export interface Scene { map: MapModel | null; sprites: PlacedSprite[]; camera: { x: number; y: number }; overlay: Overlay; seeThrough: boolean; texts?: SceneText[] }

/** Within one diagonal row the original sorts by the sprite's layer field (+0x48); equal layers keep placement order. */
export function sortRow(sprites: PlacedSprite[]): PlacedSprite[] {
  return sprites.map((s, i) => [s, i] as const).sort((a, b) => a[0].layer - b[0].layer || a[1] - b[1]).map(([s]) => s);
}
```
2. `draw()`의 행 루프에서 `for (const sp of spritesByRow.get(row.s) ?? [])`를 `for (const sp of sortRow(spritesByRow.get(row.s) ?? []))`로 바꾸고, 루프가 끝난 뒤 `this.drawOverlay(...)` 앞에 `this.drawTexts(scene.texts ?? [], cam);`를 넣는다.
3. `drawSprite`에서 원점 계산에 오프셋을 더한다:
```ts
    const ox = cell.x + sp.player.offset.x + (sp.offset?.x ?? 0) - cam.x, oy = cell.y + sp.player.offset.y + (sp.offset?.y ?? 0) - cam.y;
```
4. 메서드를 추가한다:
```ts
  private drawTexts(texts: SceneText[], cam: Camera): void {
    if (texts.length === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    for (const t of texts) { ctx.strokeText(t.text, t.x - cam.x, t.y - cam.y); ctx.fillText(t.text, t.x - cam.x, t.y - cam.y); }
    ctx.restore();
  }
```

`web/src/viewer/main.ts`의 `placeSprite`에서 `scene.sprites.push({ model: apd, player, c, r } satisfies PlacedSprite)`를 `scene.sprites.push({ model: apd, player, c, r, layer: 4 } satisfies PlacedSprite)`로 바꾼다.

- [ ] **Step 4: 유닛 스프라이트 규칙**

`web/src/field/unitSprites.ts`:

```ts
import type { ItemData, RaceData } from '../data/types';
import type { Timeline } from '../sprite/animScript';
import type { ApdModel } from '../sprite/apdModel';
import type { Unit } from '../battle/unit';

/** Sprite layer = the original's +0x48 sort key within a diagonal row. */
export const LAYER = { ground: 1, shadow: 2, object: 3, unit: 4, icon: 5 } as const;

const NO_FLIP_RACES = new Set([0x17, 0x49]);

export const bodyApd = (race: number): string => `char_${String(race).padStart(2, '0')}a`;

/** FUN_0041e350 in battle mode: "F."/"B." by facing, flip for east/west, state token. null = no body sprite. */
export function bodyAnim(u: Unit, items: ItemData[]): { name: string; flipH: boolean } | null {
  const prefix = u.dir === 0 || u.dir === 1 ? 'F.' : 'B.';
  const flipH = (u.dir === 1 || u.dir === 2) && !NO_FLIP_RACES.has(u.race);
  const levitateItem = [u.weapon, u.armor, u.acc[0], u.acc[1]].some((i) => items[i]?.status_code === 11);
  const status = u.status === 0 && levitateItem ? 11 : u.status;
  let token: string | null;
  switch (status) {
    case 0: case 6: case 7:
      token = u.moved && u.acted && u.side === 0 ? 'COMPLETE' : 'STAND';
      break;
    case 1: token = u.side === 0 ? 'DEAD' : 'DOWN_DAMAGE'; break;
    case 4: token = 'S/DAMAGE'; break;
    case 5: token = 'A/DAMAGE'; break;
    case 9: token = u.side === 7 ? 'HIDE' : null; break;
    case 11: token = 'LEVITATE'; break;
    default: token = 'DOWN_DAMAGE';
  }
  return token === null ? null : { name: prefix + token, flipH };
}

const SHADOW = ['', 'SMALL', 'MIDDLE', 'LARGE'];

/** system.apd "<size>.M": race.size, +1 while down, −1 while levitating; none when hidden or size ≤ 0. */
export function shadowAnim(u: Unit, race: RaceData): string | null {
  if (u.status === 9) return null;
  let k = race.size;
  if (k === 0) return null;
  if (u.status === 11) k -= 1;
  else if (u.status !== 0 && u.status !== 6 && u.status !== 7) k += 1;
  if (k <= 0) return null;
  return `${SHADOW[k] ?? 'HUGE'}.M`;
}

/** system.apd status icon above the unit (y − 56; the dead marker at y − 16, party only). */
export function iconAnim(u: Unit): { name: string; dy: number } | null {
  switch (u.status) {
    case 1: return u.side === 0 ? { name: 'DEAD', dy: -16 } : null;
    case 2: return { name: 'POISON', dy: -56 };
    case 3: return { name: 'SLEEP', dy: -56 };
    case 6: return { name: 'MUTE', dy: -56 };
    case 7: return { name: 'CHARM', dy: -56 };
    default: return null;
  }
}

/** The original tries "<name>#" first, then "<name>" (FUN_0041e350). */
export function pickTimeline(model: ApdModel, name: string): Timeline | undefined {
  return model.anim(`${name}#`) ?? model.anim(name);
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd web && npm run check 2>&1 | tail -4`
Expected: tsc 0 errors (뷰어 `layer: 4` 포함), 모든 테스트 통과(새 테스트 10개 포함).

- [ ] **Step 6: 커밋**

```bash
git add web/src/render/renderer.ts web/src/viewer/main.ts web/src/field/unitSprites.ts web/test/sortRow.test.ts web/test/unitSprites.test.ts
git commit -m "feat(web): sprite layer sort key, pixel offsets and text overlays; unit sprite naming rules"
```

---
### Task 14: 하이라이트·커서·방향 화살표와 연출 큐

**Files:**
- Create: `web/src/field/overlay.ts`, `web/src/field/presenter.ts`
- Test: `web/test/overlay.test.ts`, `web/test/presenter.test.ts`

**Interfaces:**
- Consumes: Task 10 `Selection`, `BattleEvent`, `BattleState`; Task 6 `canStop`; Task 13 `LAYER`, `bodyApd`, `bodyAnim`, `shadowAnim`, `iconAnim`, `pickTimeline`, `PlacedSprite`, `SceneText`; 하위 프로젝트 1 `ApdModel`, `AnimPlayer`, `MapModel`.
- Produces (`overlay.ts`): `interface OverlaySprite { c: number; r: number; anim: string; layer: number }`, `overlaySprites(sel: Selection, units, hover: [number, number] | null): OverlaySprite[]`, `TURN_ANIM: Record<Dir, string>`.
- Produces (`presenter.ts`): `interface SpriteProvider { apd(name: string): ApdModel | null }`, `class Presenter { constructor(provider, tables); sync(state): void; enqueue(events): void; update(now): void; readonly busy: boolean; hover: [number, number] | null; focus: [number, number] | null; scene(map: MapModel, state: BattleState): { sprites: PlacedSprite[]; texts: SceneText[] } }`, 상수 `STEP_MS = 160`, `POPUP_MS = 400`, `FALLBACK_MS = 400`.

- [ ] **Step 1: 실패하는 테스트 (overlay)**

`web/test/overlay.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { computeMoveRange, markTargets, RangeTable } from '../src/battle/moveRange';
import { overlaySprites } from '../src/field/overlay';
import { flatMap, RACE, tables, unit, units } from './helpers/battleFixtures';

const grid = new BattleGrid(flatMap(7));
const hero = unit({ slot: 0, c: 3, r: 3 }), ally = unit({ slot: 1, c: 4, r: 3 }), foe = unit({ slot: 10, c: 3, r: 5, side: 4 });
const all = units(hero, ally, foe);

describe('overlaySprites', () => {
  it('menu/move: MOVE tiles on stoppable cells, cursor FRIEND over them and CURSOR elsewhere', () => {
    const range = computeMoveRange(grid, all, hero, RACE());
    const out = overlaySprites({ mode: 'move', slot: 0, range }, all, [3, 2]);
    const tiles = out.filter((o) => o.anim === 'MOVE');
    expect(tiles.some((o) => o.c === 4 && o.r === 3)).toBe(false);          // ally stands there
    expect(tiles.some((o) => o.c === 3 && o.r === 2)).toBe(true);
    expect(tiles.every((o) => o.layer === 1)).toBe(true);
    expect(out.find((o) => o.c === 3 && o.r === 2 && o.anim !== 'MOVE')!.anim).toBe('FRIEND');
    expect(overlaySprites({ mode: 'move', slot: 0, range }, all, [0, 6]).find((o) => o.c === 0 && o.r === 6)!.anim).toBe('CURSOR');
  });
  it('target: ATTACK tiles on marked cells, ENEMY cursor over an enemy cell', () => {
    const range = new RangeTable(3, 3);
    markTargets(range, grid, all, hero, 1, tables());                         // burst 2..6
    const out = overlaySprites({ mode: 'target', slot: 0, action: 1, range }, all, [3, 5]);
    expect(out.filter((o) => o.anim === 'ATTACK').length).toBeGreaterThan(10);
    expect(out.find((o) => o.c === 3 && o.r === 5 && o.anim !== 'ATTACK')!.anim).toBe('ENEMY');
  });
  it('face: four TURN arrows around the unit, the hovered one selected; idle shows only the cursor', () => {
    const out = overlaySprites({ mode: 'face', slot: 0 }, all, [3, 4]);
    expect(out.map((o) => o.anim).sort()).toEqual(['S.TURN_SOUTH', 'TURN_EAST', 'TURN_NORTH', 'TURN_WEST']);
    expect(out.find((o) => o.anim === 'TURN_NORTH')).toMatchObject({ c: 3, r: 2, layer: 5 });
    expect(overlaySprites({ mode: 'idle' }, all, [1, 1])).toEqual([{ c: 1, r: 1, anim: 'CURSOR', layer: 1 }]);
    expect(overlaySprites({ mode: 'idle' }, all, null)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패하는 테스트 (presenter)**

`web/test/presenter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ApdData } from '../src/assets/types';
import { BattleGrid } from '../src/battle/grid';
import type { BattleState } from '../src/battle/types';
import { Presenter, POPUP_MS, STEP_MS } from '../src/field/presenter';
import { MapModel } from '../src/map/mapModel';
import { ApdModel } from '../src/sprite/apdModel';
import { fixedRng, flatMap, tables, unit, units } from './helpers/battleFixtures';

/** One 8×8 image; every anim is 2 frames × 100 ms unless named otherwise. */
function apd(anims: Record<string, string>): ApdModel {
  const data: ApdData = { version: 3, sheets: ['s'], images: [{ sheet: 0, key: 255, x: 0, y: 0, w: 8, h: 8, ox: -4, oy: -8 }],
    patterns: [{ yOffset: 0, images: [0] }], anims: Object.entries(anims).map(([name, script]) => ({ name, script })) };
  return new ApdModel('x', data, [{ width: 8, height: 8, indices: new Uint8Array(64), palette: new Uint8Array(768) }]);
}
const hero = apd({ 'F.STAND': 'P0', 'B.STAND': 'P0', 'F.COMPLETE': 'P0', 'F.RUN1': 'S100 P0 P0', 'F.RUN2': 'S100 P0 P0', 'F.ATTACK1': 'S150 P0 P0', 'F.MIDDLE_DAMAGE': 'S100 P0 P0', 'F.DEAD': 'P0', 'F.DOWN_DAMAGE': 'P0', 'F.DEFENSE': 'S100 P0 P0' });
const slime = apd({ 'F.STAND': 'P0', 'B.STAND': 'P0', 'F.DOWN_DAMAGE': 'P0', 'F.MIDDLE_DAMAGE': 'S100 P0 P0', 'F.DEFENSE': 'S100 P0 P0' });
const system = apd({ 'LARGE.M': 'P0', 'HUGE.M': 'P0', 'MOVE': 'P0', 'ATTACK': 'P0', 'CURSOR': 'P0', 'ENEMY': 'P0', 'FRIEND': 'P0', 'POISON': 'P0', 'TURN_NORTH': 'P0', 'TURN_SOUTH': 'P0', 'TURN_EAST': 'P0', 'TURN_WEST': 'P0', 'S.TURN_NORTH': 'P0' });
const number = apd(Object.fromEntries([...Array(10).keys()].flatMap((d) => [[`POP_${d}`, 'P0'], [`B_POP_${d}`, 'P0']])));
const provider = { apd: (name: string) => (name === 'char_00a' ? hero : name === 'char_01a' ? slime : name === 'system' ? system : name === 'number' ? number : null) };

const entry = { event: 1, label: 'x', map: 'stage49', roster: 49, episode: '', objective: '', heal: true };
function state(): BattleState {
  const map = flatMap(9);
  const h = unit({ slot: 0, c: 2, r: 4, race: 0 }), s = unit({ slot: 10, c: 6, r: 4, race: 1, side: 4, id: 8, hp: 12, hpMax: 12 });
  return { entry, map, grid: new BattleGrid(map), units: units(h, s), turn: 1, phase: { kind: 'player', sel: { mode: 'idle' } }, rng: fixedRng([0]), lastPath: [] };
}
const mapModel = (s: BattleState) => new MapModel(s.map, [], null);

describe('Presenter', () => {
  it('draws body, shadow and no icon for a healthy unit; nothing for an unknown APD', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    p.sync(s);
    const { sprites } = p.scene(mapModel(s), s);
    const hero0 = sprites.filter((sp) => sp.c === 2 && sp.r === 4);
    expect(hero0.map((sp) => sp.layer).sort()).toEqual([2, 4]);
    s.units[0]!.race = 2;                                      // char_02a is not provided
    p.sync(s);
    expect(p.scene(mapModel(s), s).sprites.filter((sp) => sp.c === 2 && sp.r === 4)).toHaveLength(0);
  });
  it('a moved event walks the snapshot one cell per STEP_MS with a pixel offset in between', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    p.sync(s);
    s.units[0]!.c = 5; s.units[0]!.moved = true;               // the rules already moved the unit
    p.enqueue([{ type: 'moved', slot: 0, path: [1, 1, 1], to: [5, 4] }]);
    expect(p.busy).toBe(true);
    p.update(0);
    p.update(STEP_MS / 2);
    const mid = p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.model === hero)!;
    expect(mid.c).toBe(2);
    expect(mid.offset!.x).toBe(16);                            // half a cell east = 32 px / 2
    p.update(STEP_MS * 3 + 1);
    p.update(STEP_MS * 3 + 2);
    expect(p.busy).toBe(false);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.model === hero)).toMatchObject({ c: 5, r: 4 });
    expect(p.focus).toEqual([5, 4]);
  });
  it('an action plays the attack anim, then the reaction anim with a number popup, then settles', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    s.units[0]!.c = 5; s.units[0]!.dir = 1;
    p.sync(s);
    s.units[10]!.hp = 4;
    p.enqueue([{ type: 'action', slot: 0, action: 0, cell: [6, 4], hits: [{ target: 10, kind: 'damage', value: 8, crit: false, popup: '8', statusAfter: 0 }] }]);
    p.update(0);
    expect(p.busy).toBe(true);
    p.update(100);
    expect(p.scene(mapModel(s), s).sprites.some((sp) => sp.model === number)).toBe(false);   // still attacking (300 ms)
    p.update(350);
    const popups = p.scene(mapModel(s), s).sprites.filter((sp) => sp.model === number);
    expect(popups).toHaveLength(1);                            // one digit "8"
    expect(popups[0]).toMatchObject({ c: 6, r: 4, layer: 5 });
    p.update(300 + POPUP_MS + 1);
    p.update(300 + POPUP_MS + 2);
    expect(p.busy).toBe(false);
  });
  it('falls back to STAND when the body APD lacks RUN and ATTACK and still finishes the queue', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    p.sync(s);
    s.units[10]!.c = 3;
    p.enqueue([
      { type: 'moved', slot: 10, path: [2, 2, 2], to: [3, 4] },
      { type: 'action', slot: 10, action: 0, cell: [2, 4], hits: [{ target: 0, kind: 'miss', value: 0, crit: false, popup: 'miss!', statusAfter: 0 }] },
    ]);
    let now = 0;
    while (p.busy && now < 10_000) { p.update(now); now += 50; }
    expect(p.busy).toBe(false);
    expect(now).toBeLessThan(10_000);
    p.update(now);
    expect(p.scene(mapModel(s), s).texts).toEqual([]);          // the "miss!" text has expired
  });
  it('a dead unit shows its death pose only after the hit step and removal hides it', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    s.units[0]!.c = 5; s.units[0]!.dir = 1;
    p.sync(s);
    s.units[10] = null;
    p.enqueue([
      { type: 'action', slot: 0, action: 0, cell: [6, 4], hits: [{ target: 10, kind: 'damage', value: 12, crit: true, popup: '12', statusAfter: 1 }] },
      { type: 'died', slot: 10 }, { type: 'removed', slot: 10 },
    ]);
    p.update(0); p.update(100);
    expect(p.scene(mapModel(s), s).sprites.some((sp) => sp.model === slime)).toBe(true);
    let now = 100;
    while (p.busy && now < 10_000) { p.update(now); now += 50; }
    expect(p.scene(mapModel(s), s).sprites.some((sp) => sp.model === slime)).toBe(false);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd web && npx vitest run test/overlay.test.ts test/presenter.test.ts 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/field/overlay`, `../src/field/presenter`

- [ ] **Step 4: 구현 (overlay)**

`web/src/field/overlay.ts`:

```ts
import { stepCell, unitAt, type Dir } from '../battle/grid';
import { canStop } from '../battle/moveRange';
import type { Selection } from '../battle/types';
import type { Unit } from '../battle/unit';
import { LAYER } from './unitSprites';

export interface OverlaySprite { c: number; r: number; anim: string; layer: number }

export const TURN_ANIM: Record<Dir, string> = { 0: 'TURN_SOUTH', 1: 'TURN_EAST', 2: 'TURN_WEST', 3: 'TURN_NORTH' };

/** system.apd tiles: MOVE on stoppable cells (menu/move), ATTACK on target cells, TURN_* arrows while facing, one cursor under the mouse (FUN_00438c70 kinds). */
export function overlaySprites(sel: Selection, units: (Unit | null)[], hover: [number, number] | null): OverlaySprite[] {
  const out: OverlaySprite[] = [];
  let cursor = 'CURSOR';
  if (sel.mode === 'menu' || sel.mode === 'move') {
    const u = units[sel.slot];
    if (u) {
      for (const cell of sel.range.cells()) {
        if ((cell.c !== u.c || cell.r !== u.r) && canStop(sel.range, units, u, cell.c, cell.r)) out.push({ c: cell.c, r: cell.r, anim: 'MOVE', layer: LAYER.ground });
      }
      if (hover && canStop(sel.range, units, u, hover[0], hover[1])) cursor = 'FRIEND';
    }
  } else if (sel.mode === 'target') {
    for (const cell of sel.range.cells()) if (cell.kind !== 0) out.push({ c: cell.c, r: cell.r, anim: 'ATTACK', layer: LAYER.ground });
    if (hover) {
      const k = sel.range.kindAt(hover[0], hover[1]);
      if (k === 1) cursor = 'ENEMY';
      else if (k === 2) cursor = 'FRIEND';
    }
  } else if (sel.mode === 'face') {
    const u = units[sel.slot];
    if (u) {
      for (const d of [0, 1, 2, 3] as Dir[]) {
        const [c, r] = stepCell(u.c, u.r, d);
        const hovered = hover !== null && hover[0] === c && hover[1] === r;
        out.push({ c, r, anim: (hovered ? 'S.' : '') + TURN_ANIM[d], layer: LAYER.icon });
      }
    }
    return out;
  }
  if (hover) out.push({ c: hover[0], r: hover[1], anim: cursor, layer: LAYER.ground });
  void unitAt;
  return out;
}
```

`void unitAt;`와 그 import는 쓰지 않으므로 지운다.

- [ ] **Step 5: 구현 (presenter)**

`web/src/field/presenter.ts`:

```ts
import { dirTo, stepCell, type Dir } from '../battle/grid';
import type { BattleEvent, BattleState } from '../battle/types';
import type { Unit } from '../battle/unit';
import type { Tables } from '../data/types';
import { TILE_H, TILE_W } from '../iso/grid';
import type { MapModel } from '../map/mapModel';
import type { PlacedSprite, SceneText } from '../render/renderer';
import { AnimPlayer } from '../sprite/animPlayer';
import type { Timeline } from '../sprite/animScript';
import type { ApdModel } from '../sprite/apdModel';
import { overlaySprites } from './overlay';
import { bodyAnim, bodyApd, iconAnim, LAYER, pickTimeline, shadowAnim } from './unitSprites';

export interface SpriteProvider { apd(name: string): ApdModel | null }

export const STEP_MS = 160;
export const POPUP_MS = 400;
export const FALLBACK_MS = 400;
const WAIT_MS = 300;

type Item =
  | { kind: 'move'; slot: number; path: Dir[]; step: number; start: number | null }
  | { kind: 'anim'; slot: number; name: string; start: number | null; ms: number; player: AnimPlayer | null }
  | { kind: 'popup'; slot: number; text: string; digits: boolean; start: number | null }
  | { kind: 'wait'; ms: number; start: number | null }
  | { kind: 'apply'; fn: () => void; done: boolean };
type Step = Item[];

interface Visual { c: number; r: number; dir: Dir; offset: { x: number; y: number } }

const clone = (u: Unit): Unit => ({ ...u, acc: [...u.acc], buff: { ...u.buff }, elem: [...u.elem], spells: [...u.spells] });
const timelineMs = (t: Timeline) => t.steps.reduce((n, s) => n + s.totalMs, 0);

/** Turns BattleEvents into a sequential queue of visual steps over a snapshot of the units; builds the renderer Scene. */
export class Presenter {
  hover: [number, number] | null = null;
  focus: [number, number] | null = null;
  private snapshot: (Unit | null)[] = [];
  private visuals = new Map<number, Visual>();
  private queue: Step[] = [];
  private players = new Map<string, AnimPlayer>();
  private now = 0;

  constructor(private readonly provider: SpriteProvider, private readonly tables: Tables) {}

  get busy(): boolean { return this.queue.length > 0; }

  /** Replace the snapshot with the rules' units (call when a battle starts and whenever the queue drains). */
  sync(state: BattleState): void {
    this.snapshot = state.units.map((u) => (u ? clone(u) : null));
    this.visuals.clear();
    for (const u of this.snapshot) if (u) this.visuals.set(u.slot, { c: u.c, r: u.r, dir: u.dir, offset: { x: 0, y: 0 } });
  }

  enqueue(events: BattleEvent[]): void {
    for (const e of events) this.queue.push(...this.stepsFor(e));
  }

  private stepsFor(e: BattleEvent): Step[] {
    switch (e.type) {
      case 'moved': return [[{ kind: 'move', slot: e.slot, path: e.path, step: 0, start: null }]];
      case 'faced': return [[{ kind: 'apply', fn: () => this.setDir(e.slot, e.dir), done: false }]];
      case 'action': {
        const steps: Step[] = [[{ kind: 'apply', fn: () => { const v = this.visuals.get(e.slot); if (v && (v.c !== e.cell[0] || v.r !== e.cell[1])) this.setDir(e.slot, dirTo(v.c, v.r, e.cell[0], e.cell[1])); }, done: false }]];
        if (e.action === 0) steps.push([this.anim(e.slot, 'ATTACK1')]);
        else {
          steps.push([this.anim(e.slot, 'CAST1A')], [this.anim(e.slot, 'CAST1B')]);
          const effect = this.tables.magic[e.action]?.effect.toLowerCase();
          const fx = effect ? this.provider.apd(effect) : null;
          if (fx && fx.animNames().length > 0) steps.push([{ kind: 'anim', slot: -1, name: `${effect}:${fx.animNames()[0]!}:${e.cell[0]},${e.cell[1]}`, start: null, ms: 0, player: null }]);
        }
        for (const h of e.hits) {
          const reaction = h.kind === 'miss' ? 'DEFENSE' : h.kind === 'damage' ? (h.statusAfter === 1 ? 'DOWN_DAMAGE' : h.crit ? 'UP_DAMAGE' : 'MIDDLE_DAMAGE') : null;
          const step: Step = [{ kind: 'apply', fn: () => this.applyHit(h.target, h.kind, h.value, h.statusAfter), done: false }];
          if (reaction) step.push(this.anim(h.target, reaction));
          if (h.popup) step.push({ kind: 'popup', slot: h.target, text: h.popup, digits: /^\d+$/.test(h.popup), start: null });
          if (h.crit) step.push({ kind: 'popup', slot: h.target, text: '크리티컬!', digits: false, start: null });
          steps.push(step);
        }
        return steps;
      }
      case 'removed': return [[{ kind: 'apply', fn: () => { this.snapshot[e.slot] = null; this.visuals.delete(e.slot); }, done: false }]];
      case 'exp': return e.gain > 0 ? [[{ kind: 'popup', slot: e.slot, text: `EXP +${e.gain}`, digits: false, start: null }]] : [];
      case 'levelUp': return [[{ kind: 'popup', slot: e.slot, text: 'LEVEL UP!', digits: false, start: null }]];
      case 'statusTick': {
        const text = e.status === 2 && !e.cured ? String(e.value) : e.cured ? (e.status === 11 ? 'landing!' : 'well') : '';
        const step: Step = [{ kind: 'apply', fn: () => this.applyTick(e.slot, e.status, e.value, e.cured), done: false }];
        if (text) step.push({ kind: 'popup', slot: e.slot, text, digits: /^\d+$/.test(text), start: null });
        return [step];
      }
      case 'phase': return e.kind === 'enemy' ? [[{ kind: 'wait', ms: WAIT_MS, start: null }]] : [];
      default: return [];
    }
  }

  private anim(slot: number, token: string): Item { return { kind: 'anim', slot, name: token, start: null, ms: 0, player: null }; }

  private setDir(slot: number, dir: Dir): void {
    const v = this.visuals.get(slot), u = this.snapshot[slot];
    if (v) v.dir = dir;
    if (u) u.dir = dir;
  }

  private applyHit(slot: number, kind: string, value: number, statusAfter: number): void {
    const u = this.snapshot[slot];
    if (!u) return;
    if (kind === 'damage') u.hp = Math.max(u.hp - value, 0);
    else if (kind === 'heal') u.hp = Math.min(u.hp + value, u.hpMax);
    u.status = statusAfter;
  }

  private applyTick(slot: number, status: number, value: number, cured: boolean): void {
    const u = this.snapshot[slot];
    if (!u) return;
    if (status === 2) { u.hp = Math.max(u.hp - value, 0); if (u.hp === 0) u.status = 1; }
    else if (cured) u.status = 0;
  }

  /** Advance the head step; a step ends when every item in it has ended. */
  update(now: number): void {
    this.now = now;
    for (const p of this.players.values()) p.update(now);
    const step = this.queue[0];
    if (!step) return;
    let done = true;
    for (const item of step) if (!this.advance(item, now)) done = false;
    if (done) this.queue.shift();
  }

  private advance(item: Item, now: number): boolean {
    switch (item.kind) {
      case 'apply': if (!item.done) { item.fn(); item.done = true; } return true;
      case 'wait': item.start ??= now; return now - item.start >= item.ms;
      case 'popup': item.start ??= now; return now - item.start >= POPUP_MS;
      case 'move': {
        const v = this.visuals.get(item.slot);
        if (!v || item.step >= item.path.length) return true;
        item.start ??= now;
        const t = Math.min((now - item.start) / STEP_MS, 1);
        const d = item.path[item.step]!;
        const [nc, nr] = stepCell(v.c, v.r, d);
        v.dir = d;
        v.offset = { x: Math.round((nc - v.c - (nr - v.r)) * (TILE_W / 2) * t), y: Math.round((nc - v.c + (nr - v.r)) * (TILE_H / 2) * t) };
        this.focus = [nc, nr];
        if (t >= 1) {
          v.c = nc; v.r = nr; v.offset = { x: 0, y: 0 }; item.step++; item.start = now;
          const u = this.snapshot[item.slot];
          if (u) { u.c = nc; u.r = nr; u.dir = d; }
          if (item.step >= item.path.length) return true;
        }
        return false;
      }
      case 'anim': {
        if (item.start === null) {
          item.start = now;
          const tl = this.resolveAnim(item);
          item.ms = tl ? Math.max(timelineMs(tl), 1) : FALLBACK_MS;
          item.player = tl ? new AnimPlayer(tl, { loop: false }) : null;
          if (item.slot >= 0) { const v = this.visuals.get(item.slot); if (v) this.focus = [v.c, v.r]; }
        }
        item.player?.update(now);
        return now - item.start >= item.ms;
      }
    }
  }

  /** "ATTACK1" → "<F.|B.>ATTACK1" of the unit's body APD (with "#" preference); effects are "<apd>:<anim>:<c>,<r>". */
  private resolveAnim(item: Extract<Item, { kind: 'anim' }>): Timeline | null {
    if (item.slot < 0) {
      const [apdName, anim] = item.name.split(':');
      const model = this.provider.apd(apdName!);
      return model ? pickTimeline(model, anim!) ?? null : null;
    }
    const u = this.snapshot[item.slot], v = this.visuals.get(item.slot);
    if (!u || !v) return null;
    const model = this.provider.apd(bodyApd(u.race));
    if (!model) return null;
    const prefix = v.dir === 0 || v.dir === 1 ? 'F.' : 'B.';
    return pickTimeline(model, prefix + item.name) ?? pickTimeline(model, `${prefix}STAND`) ?? null;
  }

  private player(key: string, tl: Timeline, loop: boolean): AnimPlayer {
    let p = this.players.get(key);
    if (!p) { p = new AnimPlayer(tl, { loop }); p.update(this.now); this.players.set(key, p); }
    return p;
  }

  /** Units (snapshot), overlays (rules' selection), active one-shot anims, effects and popups. */
  scene(map: MapModel, state: BattleState): { sprites: PlacedSprite[]; texts: SceneText[] } {
    const sprites: PlacedSprite[] = [];
    const texts: SceneText[] = [];
    const head = this.queue[0] ?? [];
    const overrides = new Map<number, AnimPlayer>();
    for (const item of head) if (item.kind === 'anim' && item.slot >= 0 && item.player) overrides.set(item.slot, item.player);
    const system = this.provider.apd('system');
    for (const u of this.snapshot) {
      if (!u) continue;
      const v = this.visuals.get(u.slot)!;
      const shown = { ...u, dir: v.dir };
      const body = bodyAnim(shown, this.tables.item);
      const model = this.provider.apd(bodyApd(u.race));
      if (body && model) {
        const tl = pickTimeline(model, body.name);
        const player = overrides.get(u.slot) ?? (tl ? this.player(`${u.slot}:${body.name}`, tl, true) : null);
        if (player) sprites.push({ model, player, c: v.c, r: v.r, layer: u.side === 7 ? LAYER.object : LAYER.unit, offset: v.offset });
        if (system) {
          const race = this.tables.race[u.race];
          const shadow = race ? shadowAnim(shown, race) : null;
          const stl = shadow ? pickTimeline(system, shadow) : undefined;
          if (stl) sprites.push({ model: system, player: this.player(`shadow:${shadow}`, stl, true), c: v.c, r: v.r, layer: LAYER.shadow, offset: v.offset });
          const icon = iconAnim(shown);
          const itl = icon ? pickTimeline(system, icon.name) : undefined;
          if (icon && itl) sprites.push({ model: system, player: this.player(`icon:${icon.name}`, itl, true), c: v.c, r: v.r, layer: LAYER.icon, offset: { x: v.offset.x, y: v.offset.y + icon.dy } });
        }
      }
    }
    if (system && state.phase.kind === 'player') {
      for (const o of overlaySprites(state.phase.sel, state.units, this.hover)) {
        const tl = pickTimeline(system, o.anim);
        if (tl) sprites.push({ model: system, player: this.player(`ov:${o.anim}`, tl, true), c: o.c, r: o.r, layer: o.layer });
      }
    }
    for (const item of head) {
      if (item.kind === 'anim' && item.slot < 0 && item.player) {
        const [apdName, , cell] = item.name.split(':');
        const model = this.provider.apd(apdName!);
        const [c, r] = cell!.split(',').map(Number) as [number, number];
        if (model) sprites.push({ model, player: item.player, c, r, layer: LAYER.icon });
      }
      if (item.kind === 'popup' && item.start !== null) this.popup(item, map, sprites, texts);
    }
    return { sprites, texts };
  }

  private popup(item: Extract<Item, { kind: 'popup' }>, map: MapModel, sprites: PlacedSprite[], texts: SceneText[]): void {
    const v = this.visuals.get(item.slot);
    if (!v) return;
    const rise = Math.round(16 * Math.min((this.now - (item.start ?? this.now)) / POPUP_MS, 1));
    const number = this.provider.apd('number');
    if (item.digits && number) {
      const digits = item.text.split('');
      const widths = digits.map((d) => { const tl = pickTimeline(number, `POP_${d}`); if (!tl) return 0; const b = number.bounds(tl.steps[0]!.frames[0]!); return b.right - b.left; });
      const total = widths.reduce((a, b) => a + b, 0);
      let x = -Math.trunc(total / 2);
      digits.forEach((d, i) => {
        const tl = pickTimeline(number, `POP_${d}`);
        if (tl) sprites.push({ model: number, player: this.player(`pop:${d}`, tl, true), c: v.c, r: v.r, layer: LAYER.icon, offset: { x: v.offset.x + x, y: v.offset.y - 40 - rise } });
        x += widths[i]!;
      });
      return;
    }
    const cell = map.cellAt(v.c, v.r);
    if (cell) texts.push({ x: cell.x + v.offset.x, y: cell.y + v.offset.y - 40 - rise, text: item.text });
  }
}
```

- [ ] **Step 6: 통과 확인**

Run: `cd web && npx vitest run test/overlay.test.ts test/presenter.test.ts 2>&1 | tail -3`
Expected: `Tests  8 passed`. 이동 테스트의 오프셋: 동쪽 한 칸은 화면에서 (+32, +16)px 이므로 절반 시점에 x = 16.

- [ ] **Step 7: 커밋**

```bash
git add web/src/field/overlay.ts web/src/field/presenter.ts web/test/overlay.test.ts web/test/presenter.test.ts
git commit -m "feat(web): range/cursor/turn overlays and the presentation queue that animates battle events"
```

---

### Task 15: 전투 페이지 — HTML 패널, 입력, 조립

**Files:**
- Create: `web/game.html`, `web/src/ui/panel.ts`, `web/src/game/main.ts`
- Test: `web/test/panel.test.ts`

**Interfaces:**
- Consumes: Task 12 `Battle`, Task 14 `Presenter`, `SpriteProvider`, Task 2 `DataLoader`, 하위 프로젝트 1 `AssetLoader`, `Renderer`, `MapModel`, `fitScale`, `clampCamera`.
- Produces: `interface MenuEnabled { move: boolean; attack: boolean; magic: boolean; wait: boolean; endTurn: boolean }`, `menuEnabled(state: BattleState): MenuEnabled`, `describeHit(actor: Unit, hit: Hit, units, tables): string`, `unitName(u: Unit, tables): string` (이름표 §6 또는 종족 이름), `class Panel`.

- [ ] **Step 1: 실패하는 테스트**

`web/test/panel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BattleGrid } from '../src/battle/grid';
import { RangeTable } from '../src/battle/moveRange';
import type { BattleState } from '../src/battle/types';
import { describeHit, menuEnabled, unitName } from '../src/ui/panel';
import { fixedRng, flatMap, tables, unit, units } from './helpers/battleFixtures';

const entry = { event: 1, label: 'x', map: 'stage49', roster: 49, episode: '', objective: '', heal: true };
const base = (phase: BattleState['phase'], us = units(unit({ slot: 0, spells: [1] }), unit({ slot: 10, side: 4, id: 8, race: 1 }))): BattleState => {
  const map = flatMap(5);
  return { entry, map, grid: new BattleGrid(map), units: us, turn: 1, phase, rng: fixedRng([0]), lastPath: [] };
};

describe('menuEnabled', () => {
  it('idle: only end turn; menu: move/attack/magic/wait by flags; enemy phase: nothing', () => {
    expect(menuEnabled(base({ kind: 'player', sel: { mode: 'idle' } }))).toEqual({ move: false, attack: false, magic: false, wait: false, endTurn: true });
    const range = new RangeTable(0, 0);
    expect(menuEnabled(base({ kind: 'player', sel: { mode: 'menu', slot: 0, range } }))).toEqual({ move: true, attack: true, magic: true, wait: true, endTurn: true });
    const moved = units(unit({ slot: 0, moved: true, acted: true, spells: [] }));
    expect(menuEnabled(base({ kind: 'player', sel: { mode: 'menu', slot: 0, range } }, moved))).toEqual({ move: false, attack: false, magic: false, wait: true, endTurn: true });
    expect(menuEnabled(base({ kind: 'enemy', queue: [] }))).toEqual({ move: false, attack: false, magic: false, wait: false, endTurn: false });
  });
});

describe('unitName / describeHit', () => {
  const t = tables();
  it('names party characters from the speaker table and others by race', () => {
    expect(unitName(unit({ slot: 0, id: 1 }), t)).toBe('카린');
    expect(unitName(unit({ slot: 0, id: 2 }), t)).toBe('알');
    expect(unitName(unit({ slot: 10, id: 8, race: 1 }), t)).toBe('slime');
  });
  it('writes one log line per hit', () => {
    const a = unit({ slot: 0, id: 1 }), e = unit({ slot: 10, id: 8, race: 1 });
    const us = units(a, e);
    expect(describeHit(a, { target: 10, kind: 'damage', value: 12, crit: true, popup: '12', statusAfter: 1 }, us, t)).toBe('카린 → slime: 12 (크리티컬) 쓰러짐');
    expect(describeHit(a, { target: 10, kind: 'miss', value: 0, crit: false, popup: 'miss!', statusAfter: 0 }, us, t)).toBe('카린 → slime: 빗나감');
    expect(describeHit(a, { target: 0, kind: 'heal', value: 7, crit: false, popup: '7', statusAfter: 0 }, us, t)).toBe('카린 → 카린: 회복 7');
    expect(describeHit(a, { target: 10, kind: 'status', value: 3, crit: false, popup: '', statusAfter: 3 }, us, t)).toBe('카린 → slime: 수면');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/panel.test.ts 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/ui/panel`

- [ ] **Step 3: 구현 (panel)**

`web/src/ui/panel.ts`:

```ts
import type { Hit } from '../battle/resolve';
import type { BattleEvent, BattleState, Command } from '../battle/types';
import type { Unit } from '../battle/unit';
import type { BattleEntry, Tables } from '../data/types';

export interface MenuEnabled { move: boolean; attack: boolean; magic: boolean; wait: boolean; endTurn: boolean }

/** Which buttons the rules would accept right now (spec §10.2). */
export function menuEnabled(state: BattleState): MenuEnabled {
  const none = { move: false, attack: false, magic: false, wait: false, endTurn: false };
  if (state.phase.kind !== 'player') return none;
  const sel = state.phase.sel;
  if (sel.mode !== 'menu') return { ...none, endTurn: true };
  const u = state.units[sel.slot];
  if (!u) return { ...none, endTurn: true };
  return { move: !u.moved, attack: !u.acted, magic: !u.acted && u.spells.length > 0 && u.status !== 6, wait: true, endTurn: true };
}

/** event_script_format.md §6 speaker names for the named characters (id 1..29). */
export const SPEAKER_NAMES: Record<number, string> = {
  1: '카린', 2: '알', 3: '아리스', 4: '사라', 5: '라딧슈', 6: '소피아', 7: '루루', 9: '???', 10: 'T.T.', 11: '손', 12: '마크도갈', 13: '가스톤',
  15: '마스터', 16: '근육 아저씨', 17: '숍언니', 18: '화난 카린', 19: '곤란한 아리스', 20: '카트린느', 21: '베히모스', 22: '듀마', 23: '존', 24: '돗펠원화',
  25: '앨비스', 26: '손.바이스', 27: '히드라', 28: '코카트리스', 29: '길드 마스터',
};
export const STATUS_NAMES: Record<number, string> = { 0: '정상', 1: '사망', 2: '독', 3: '수면', 4: '석화', 5: '동결', 6: '침묵', 7: '매혹', 8: '홀드', 9: '은신', 11: '부유' };

export function unitName(u: Unit, tables: Tables): string {
  return (u.id !== 8 && u.id < 30 && SPEAKER_NAMES[u.id]) || tables.race[u.race]?.name.replace(/_/g, ' ') || `종족 ${u.race}`;
}

export function describeHit(actor: Unit, hit: Hit, units: (Unit | null)[], tables: Tables): string {
  const target = units[hit.target];
  const head = `${unitName(actor, tables)} → ${target ? unitName(target, tables) : `슬롯 ${hit.target}`}: `;
  switch (hit.kind) {
    case 'damage': return `${head}${hit.value}${hit.crit ? ' (크리티컬)' : ''}${hit.statusAfter === 1 ? ' 쓰러짐' : ''}`;
    case 'miss': return `${head}빗나감`;
    case 'heal': return `${head}회복 ${hit.value}`;
    case 'cure': return `${head}${hit.popup === 'well' ? '상태 회복' : `소생 ${hit.value}`}`;
    case 'status': return `${head}${STATUS_NAMES[hit.statusAfter] ?? `상태 ${hit.statusAfter}`}`;
    case 'buff': return `${head}${hit.popup || '효과'}`;
    default: return `${head}효과 없음`;
  }
}

export interface PanelHandlers { onStart(entry: BattleEntry, seed: number): void; onCommand(cmd: Command): void }

const $ = <T extends HTMLElement>(doc: Document, id: string): T => {
  const el = doc.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

/** DOM panel of game.html. Only DOM glue lives here; decisions are in menuEnabled/describeHit. */
export class Panel {
  private readonly el: Record<'battle' | 'seed' | 'start' | 'turn' | 'unit' | 'move' | 'attack' | 'magic' | 'wait' | 'endTurn' | 'spells' | 'log' | 'result' | 'error' | 'objective', HTMLElement>;
  private entries: BattleEntry[] = [];
  private lines: string[] = [];

  constructor(private readonly doc: Document, private readonly handlers: PanelHandlers, private readonly tables: Tables) {
    const ids = ['battle', 'seed', 'start', 'turn', 'unit', 'move', 'attack', 'magic', 'wait', 'endTurn', 'spells', 'log', 'result', 'error', 'objective'] as const;
    this.el = Object.fromEntries(ids.map((id) => [id, $(doc, id)])) as Panel['el'];
    this.el.start.addEventListener('click', () => {
      const entry = this.entries[Number((this.el.battle as HTMLSelectElement).value)];
      if (entry) this.handlers.onStart(entry, Number((this.el.seed as HTMLInputElement).value) || Date.now());
    });
    this.el.move.addEventListener('click', () => handlers.onCommand({ type: 'beginMove' }));
    this.el.attack.addEventListener('click', () => handlers.onCommand({ type: 'beginTarget', action: 0 }));
    this.el.wait.addEventListener('click', () => handlers.onCommand({ type: 'wait' }));
    this.el.endTurn.addEventListener('click', () => handlers.onCommand({ type: 'endTurn' }));
    this.el.magic.addEventListener('click', () => { this.el.spells.hidden = !this.el.spells.hidden; });
  }

  setBattles(entries: BattleEntry[]): void {
    this.entries = entries;
    const sel = this.el.battle as HTMLSelectElement;
    sel.replaceChildren(...entries.map((e, i) => Object.assign(this.doc.createElement('option'), { value: String(i), textContent: `${String(i + 1).padStart(2, '0')} ${e.episode || e.label} — ${e.objective || '(목표 없음)'}` })));
  }

  /** Refresh turn, menu, spell list and the selected unit's card. */
  update(state: BattleState, hoverUnit: Unit | null): void {
    this.el.objective.textContent = `${state.entry.episode} — ${state.entry.objective}`;
    this.el.turn.textContent = state.phase.kind === 'end' ? `턴 ${state.turn} · ${state.phase.result === 'victory' ? '승리' : '패배'}` : `턴 ${state.turn} · ${state.phase.kind === 'player' ? '아군 페이즈' : '적 페이즈'}`;
    const en = menuEnabled(state);
    (this.el.move as HTMLButtonElement).disabled = !en.move;
    (this.el.attack as HTMLButtonElement).disabled = !en.attack;
    (this.el.magic as HTMLButtonElement).disabled = !en.magic;
    (this.el.wait as HTMLButtonElement).disabled = !en.wait;
    (this.el.endTurn as HTMLButtonElement).disabled = !en.endTurn;
    const sel = state.phase.kind === 'player' ? state.phase.sel : null;
    const selected = sel && sel.mode !== 'idle' ? state.units[sel.slot] ?? null : null;
    if (!en.magic) this.el.spells.hidden = true;
    this.renderSpells(selected);
    this.renderUnit(hoverUnit ?? selected);
  }

  private renderSpells(u: Unit | null): void {
    if (!u) { this.el.spells.replaceChildren(); return; }
    this.el.spells.replaceChildren(...u.spells.map((m) => {
      const magic = this.tables.magic[m]!;
      const b = this.doc.createElement('button');
      b.textContent = `${magic.name} (MP ${Math.abs(magic.mp_cost)}, 사거리 ${magic.range_min}-${magic.range_max})`;
      b.disabled = u.mp < Math.abs(magic.mp_cost);
      b.addEventListener('click', () => { this.el.spells.hidden = true; this.handlers.onCommand({ type: 'beginTarget', action: m }); });
      return b;
    }));
  }

  private renderUnit(u: Unit | null): void {
    if (!u) { this.el.unit.textContent = ''; return; }
    const w = this.tables.item[u.weapon]?.name ?? '-', a = this.tables.item[u.armor]?.name ?? '-';
    this.el.unit.textContent = `${unitName(u, this.tables)} (${this.tables.race[u.race]?.name ?? u.race}) Lv${u.level}\nHP ${u.hp}/${u.hpMax}  MP ${u.mp}/${u.mpMax}\n상태 ${STATUS_NAMES[u.status] ?? u.status}  ${u.moved ? '이동완료' : ''} ${u.acted ? '행동완료' : ''}\n무기 ${w}  방어구 ${a}\n공 ${u.str} 방 ${u.def} 지 ${u.wis} 마항 ${u.mgr} 민 ${u.agi}`;
  }

  logEvents(state: BattleState, events: BattleEvent[]): void {
    for (const e of events) {
      if (e.type === 'action') { const actor = state.units[e.slot]; for (const h of e.hits) if (actor) this.log(describeHit(actor, h, state.units, this.tables)); }
      else if (e.type === 'levelUp') this.log(`레벨 업! Lv${e.level}`);
      else if (e.type === 'statusTick' && e.cured) this.log(`상태 회복 (슬롯 ${e.slot})`);
      else if (e.type === 'rejected') this.log(`불가: ${e.reason}`);
      else if (e.type === 'roundStart') this.log(`— 턴 ${e.turn} —`);
    }
  }

  log(line: string): void {
    this.lines.push(line);
    if (this.lines.length > 10) this.lines.shift();
    this.el.log.textContent = this.lines.join('\n');
  }

  showResult(result: 'victory' | 'defeat' | null): void {
    this.el.result.textContent = result === 'victory' ? '승리! 적을 전멸시켰다.' : result === 'defeat' ? '게임 오버… 파티가 전멸했다.' : '';
  }

  showError(message: string): void { this.el.error.textContent = message; }
}
```

- [ ] **Step 4: 페이지와 조립**

`web/game.html`:

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FT2 전투</title>
<link rel="icon" href="data:,">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #14120e; color: #eae4d6; font: 13px/1.4 system-ui, sans-serif; display: flex; min-height: 100vh; }
  #panel { width: 300px; padding: 12px; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; background: #1e1a14; overflow-y: auto; }
  #panel select, #panel button, #panel input { font: inherit; }
  #stage { flex: 1; display: grid; place-items: center; overflow: auto; }
  canvas { image-rendering: pixelated; image-rendering: crisp-edges; background: #000; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  .mono { font-family: ui-monospace, monospace; white-space: pre-wrap; }
  #spells { display: flex; flex-direction: column; gap: 4px; }
  #spells[hidden] { display: none; }
  #error { color: #ff6b6b; }
  #result { font-size: 16px; font-weight: 600; }
</style>
</head>
<body>
<aside id="panel">
  <label>전투 <select id="battle"></select></label>
  <div class="row"><label>시드 <input id="seed" type="number" style="width:9em"></label><button id="start">시작</button></div>
  <div id="objective"></div>
  <div id="turn" class="mono"></div>
  <div class="row">
    <button id="move">이동</button><button id="attack">공격</button><button id="magic">마법</button><button id="wait">대기</button><button id="endTurn">턴 종료</button>
  </div>
  <div id="spells" hidden></div>
  <div id="unit" class="mono"></div>
  <div>셀 클릭: 선택/이동/대상 · 오른쪽 클릭·Esc: 취소 · 방향키/드래그: 스크롤 · Shift: 투시</div>
  <div id="result"></div>
  <div id="log" class="mono"></div>
  <div id="error" class="mono"></div>
</aside>
<main id="stage"><canvas id="view"></canvas></main>
<script type="module" src="/src/game/main.ts"></script>
</body>
</html>
```

`web/src/game/main.ts`:

```ts
import { AssetError, AssetLoader } from '../assets/loader';
import { Battle } from '../battle/battle';
import type { BattleEvent, Command } from '../battle/types';
import type { Unit } from '../battle/unit';
import { DataError, DataLoader } from '../data/loader';
import type { BattleEntry, Tables } from '../data/types';
import { Presenter, type SpriteProvider } from '../field/presenter';
import { VIEW_H, VIEW_W } from '../iso/grid';
import { MapModel } from '../map/mapModel';
import { Renderer, type Scene } from '../render/renderer';
import { ApdModel } from '../sprite/apdModel';
import { Panel } from '../ui/panel';
import { clampCamera, fitScale } from '../viewer/scale';

const $ = <T extends HTMLElement>(id: string): T => { const el = document.getElementById(id); if (!el) throw new Error(`missing element #${id}`); return el as T; };

/** Loads APDs on demand; returns null until a sprite file is ready or when it does not exist. */
class SpriteCache implements SpriteProvider {
  private readonly models = new Map<string, ApdModel | null>();
  private readonly pending = new Set<string>();
  constructor(private readonly loader: AssetLoader, private readonly renderer: Renderer, private readonly known: Set<string>, private readonly onError: (e: unknown) => void) {}
  apd(name: string): ApdModel | null {
    if (this.models.has(name)) return this.models.get(name)!;
    if (!this.known.has(name)) { this.models.set(name, null); return null; }
    if (!this.pending.has(name)) {
      this.pending.add(name);
      void (async () => {
        try {
          const data = await this.loader.apd(name);
          const sheets = await Promise.all(data.sheets.map((s) => this.loader.image('sprite', s)));
          const model = new ApdModel(name, data, sheets);
          await this.renderer.prepareApd(model);
          this.models.set(name, model);
        } catch (e) { this.models.set(name, null); this.onError(e); }
      })();
    }
    return null;
  }
}

const canvas = $<HTMLCanvasElement>('view');
const renderer = new Renderer(canvas);
const assets = new AssetLoader();
const data = new DataLoader();
let tables: Tables | null = null;
let battle: Battle | null = null;
let presenter: Presenter | null = null;
let mapModel: MapModel | null = null;
let sprites: SpriteCache | null = null;
let panel: Panel | null = null;
let camera = { x: 0, y: 0 };
let seeThrough = false;
let hoverUnit: Unit | null = null;

const showError = (e: unknown) => { const msg = e instanceof AssetError || e instanceof DataError ? e.message : e instanceof Error ? `${e.name}: ${e.message}` : String(e); $('error').textContent = msg; console.error(e); };

function resize(): void {
  const stage = $('stage');
  const k = fitScale(stage.clientWidth - 16, stage.clientHeight - 16);
  canvas.style.width = `${VIEW_W * k}px`; canvas.style.height = `${VIEW_H * k}px`;
}

function dispatch(cmd: Command): void {
  if (!battle || !presenter || !panel) return;
  if (presenter.busy) return;
  const events = battle.reduce(cmd);
  handle(events);
}

function handle(events: BattleEvent[]): void {
  if (!battle || !presenter || !panel) return;
  presenter.enqueue(events);
  panel.logEvents(battle.state, events);
  $('error').textContent = '';
}

async function startBattle(entry: BattleEntry, seed: number): Promise<void> {
  if (!tables || !panel) return;
  try {
    const [roster1, roster, map] = await Promise.all([data.roster(1), data.roster(entry.roster), assets.map(entry.map)]);
    const layers = await Promise.all(map.layers.map((n) => assets.image('map', n)));
    const bg = map.bg ? await assets.image('map', map.bg).catch((e: unknown) => { showError(e); return null; }) : null;
    mapModel = new MapModel(map, layers, bg);
    await renderer.prepareMap(mapModel);
    battle = Battle.start(entry, map, roster1, roster, tables, seed);
    presenter = new Presenter(sprites!, tables);
    presenter.sync(battle.state);
    const first = battle.state.units.find((u) => u && u.side === 0);
    const cell = first ? mapModel.cellAt(first.c, first.r) : null;
    camera = clampCamera((cell?.x ?? 0) - VIEW_W / 2, (cell?.y ?? 0) - VIEW_H / 2, map.pixelSize[0], map.pixelSize[1]);
    panel.showResult(null);
    panel.log(`전투 시작: ${entry.episode} (시드 ${seed})`);
    $('error').textContent = '';
  } catch (e) { showError(e); }
}

function canvasCell(ev: MouseEvent): [number, number] | null {
  if (!mapModel) return null;
  const rect = canvas.getBoundingClientRect();
  const px = ((ev.clientX - rect.left) / rect.width) * VIEW_W + camera.x, py = ((ev.clientY - rect.top) / rect.height) * VIEW_H + camera.y;
  const cell = mapModel.pick(px, py);
  return cell ? [cell.c, cell.r] : null;
}

function onClick(cell: [number, number]): void {
  if (!battle) return;
  const s = battle.state;
  if (s.phase.kind !== 'player') return;
  const sel = s.phase.sel;
  const u = s.units.find((x) => x && x.c === cell[0] && x.r === cell[1]) ?? null;
  switch (sel.mode) {
    case 'idle': if (u && u.side === 0) dispatch({ type: 'select', slot: u.slot }); break;
    case 'menu': if (u && u.side === 0 && u.slot !== sel.slot) dispatch({ type: 'select', slot: u.slot }); break;
    case 'move': dispatch({ type: 'move', c: cell[0], r: cell[1] }); break;
    case 'target': dispatch({ type: 'act', c: cell[0], r: cell[1] }); break;
    case 'face': {
      const me = s.units[sel.slot]!;
      const d = Math.abs(cell[0] - me.c) + Math.abs(cell[1] - me.r);
      if (d === 0) dispatch({ type: 'face', dir: me.dir });
      else if (d === 1) dispatch({ type: 'face', dir: cell[0] > me.c ? 1 : cell[0] < me.c ? 2 : cell[1] > me.r ? 0 : 3 });
      break;
    }
  }
}

function frame(now: number): void {
  if (battle && presenter && mapModel && panel) {
    presenter.update(now);
    const s = battle.state;
    if (!presenter.busy) {
      presenter.sync(s);
      if (s.phase.kind === 'enemy') handle(battle.reduce({ type: 'enemyStep' }));
      else if (s.phase.kind === 'end') panel.showResult(s.phase.result);
    }
    if (presenter.focus) {
      const cell = mapModel.cellAt(presenter.focus[0], presenter.focus[1]);
      if (cell && (cell.x < camera.x + 64 || cell.x > camera.x + VIEW_W - 64 || cell.y < camera.y + 64 || cell.y > camera.y + VIEW_H - 64)) {
        camera = clampCamera(cell.x - VIEW_W / 2, cell.y - VIEW_H / 2, s.map.pixelSize[0], s.map.pixelSize[1]);
      }
    }
    const { sprites: placed, texts } = presenter.scene(mapModel, s);
    const scene: Scene = { map: mapModel, sprites: placed, camera, overlay: { grid: false, height: false, land: false, blocked: false }, seeThrough, texts };
    renderer.draw(scene);
    panel.update(s, hoverUnit);
  } else {
    renderer.draw({ map: null, sprites: [], camera, overlay: { grid: false, height: false, land: false, blocked: false }, seeThrough: false });
  }
  requestAnimationFrame(frame);
}

function bind(): void {
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); dispatch({ type: 'cancel' }); });
  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) drag = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y }; });
  window.addEventListener('mouseup', (e) => {
    if (!drag || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3;
    drag = null;
    if (moved) return;
    const cell = canvasCell(e);
    if (cell) onClick(cell);
  });
  canvas.addEventListener('mousemove', (e) => {
    if (drag && battle) {
      const k = canvas.getBoundingClientRect().width / VIEW_W;
      camera = clampCamera(drag.cx - (e.clientX - drag.x) / k, drag.cy - (e.clientY - drag.y) / k, battle.state.map.pixelSize[0], battle.state.map.pixelSize[1]);
      return;
    }
    const cell = canvasCell(e);
    if (presenter) presenter.hover = cell;
    hoverUnit = cell && battle ? battle.state.units.find((u) => u && u.c === cell[0] && u.r === cell[1]) ?? null : null;
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') seeThrough = true;
    if (e.key === 'Escape') dispatch({ type: 'cancel' });
    if (e.key === 'Enter' && battle?.state.phase.kind === 'player' && battle.state.phase.sel.mode === 'face') dispatch({ type: 'face', dir: battle.state.units[battle.state.phase.sel.slot]!.dir });
    if (!battle || (e.target as HTMLElement).tagName === 'INPUT') return;
    const step = e.shiftKey ? 64 : 16;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = d[e.key];
    if (m) { camera = clampCamera(camera.x + m[0], camera.y + m[1], battle.state.map.pixelSize[0], battle.state.map.pixelSize[1]); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') seeThrough = false; });
  window.addEventListener('blur', () => { seeThrough = false; });
  window.addEventListener('resize', resize);
}

async function boot(): Promise<void> {
  bind();
  resize();
  requestAnimationFrame(frame);
  try {
    const index = await assets.index();
    if (!(index as { data?: boolean }).data) throw new AssetError('assets/index.json', 'no data tables: run tools/ft2_export.py again');
    tables = await data.tables();
    sprites = new SpriteCache(assets, renderer, new Set(index.sprites), showError);
    panel = new Panel(document, { onStart: (entry, seed) => void startBattle(entry, seed), onCommand: dispatch }, tables);
    panel.setBattles(await data.battles());
    ($('seed') as HTMLInputElement).value = String(Date.now() % 100000);
  } catch (e) { showError(e); }
}

void boot();
```

- [ ] **Step 5: 통과 확인과 수동 확인**

Run: `cd web && npm run check 2>&1 | tail -4`
Expected: tsc 0 errors, 모든 테스트 통과(panel 3개 포함).

Run: `cd web && npm run dev` 후 브라우저(Playwright MCP)로 `http://localhost:5173/game.html`을 연다. 확인 항목:
1. 전투 목록 33개, 첫 항목 `01 첫업무 — 슬라임을 전멸시켜라!?`. 시작 → 맵 49, 카린·알·슬라임 6마리가 보인다. 콘솔 오류 0.
2. 카린 클릭 → 파란(MOVE) 타일, 메뉴 활성. 이동 → 셀 클릭 → 달려간다. 공격 → 빨간(ATTACK) 타일 → 슬라임 클릭 → 공격 애니, 숫자 팝업, 로그 한 줄. 방향 화살표 4개 → 클릭.
3. 마법 → 프레임버스트 → 사거리 표시 → 셀 클릭 → 시전·효과·팝업.
4. 턴 종료 → 슬라임들이 다가와 공격, 팝업. 턴 2 표시.
5. 스크린샷 `.playwright-mcp/game_01_start.png`, `game_02_attack.png`, `game_03_enemy.png`.

- [ ] **Step 6: 커밋**

```bash
git add web/game.html web/src/ui/panel.ts web/src/game/main.ts web/test/panel.test.ts
git commit -m "feat(web): battle page — HTML panel, mouse/keyboard input, sprite cache and game loop"
```

---

### Task 16: 코퍼스·시나리오 테스트와 문서

**Files:**
- Create: `web/test/battleCorpus.test.ts`
- Modify: `docs/manual.md`, `README.md`, `web/README.md`

**Interfaces:**
- Consumes: Task 1 JSON, Task 12 `Battle`, Task 11 AI.

- [ ] **Step 1: 코퍼스·시나리오 테스트 작성**

`web/test/battleCorpus.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MapData } from '../src/assets/types';
import { Battle } from '../src/battle/battle';
import { dist, hostile, liveUnits } from '../src/battle/grid';
import { canStop } from '../src/battle/moveRange';
import type { BattleEvent, Command } from '../src/battle/types';
import type { Unit } from '../src/battle/unit';
import { validateRoster } from '../src/data/loader';
import type { BattleEntry, RosterUnit, Tables } from '../src/data/types';

const ASSETS = fileURLToPath(new URL('../public/assets/', import.meta.url));
const available = existsSync(join(ASSETS, 'data', 'battles.json'));
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(ASSETS, rel), 'utf-8')) as T;
const roster = (n: number) => readJson<RosterUnit[]>(`data/roster/stage${String(n).padStart(3, '0')}.json`);

describe.skipIf(!available)('battle corpus', () => {
  const tables: Tables = available ? { race: readJson('data/race.json'), item: readJson('data/item.json'), magic: readJson('data/magic.json') } : { race: [], item: [], magic: [] };
  const battles = available ? readJson<BattleEntry[]>('data/battles.json') : [];

  it('has 33 battles, 74 races, 180 items and 84 magics', () => {
    expect(battles).toHaveLength(33);
    expect([tables.race.length, tables.item.length, tables.magic.length]).toEqual([74, 180, 84]);
  });

  it('every battle starts, every roster validates, and one full enemy phase runs without throwing', () => {
    const roster1 = roster(1);
    for (const entry of battles) {
      const ros = roster(entry.roster);
      validateRoster(ros, tables, `roster ${entry.roster}`);
      const map = readJson<MapData>(`map/${entry.map}.json`);
      const b = Battle.start(entry, map, roster1, ros, tables, 7);
      expect(b.state.units.filter((u) => u && u.side === 0).length, entry.label).toBeGreaterThan(0);
      b.reduce({ type: 'endTurn' });
      let guard = 0;
      while (b.state.phase.kind === 'enemy' && guard++ < 60) b.reduce({ type: 'enemyStep' });
      expect(b.state.phase.kind, `${entry.event} ${entry.label}`).not.toBe('enemy');
    }
  });

  /** Simple policy: each hero attacks a reachable enemy if it can, else walks toward the nearest enemy, then faces east. */
  function play(seed: number): { events: BattleEvent[]; turns: number; result: string } {
    const entry = battles[0]!;
    const b = Battle.start(entry, readJson<MapData>(`map/${entry.map}.json`), roster(1), roster(entry.roster), tables, seed);
    const log: BattleEvent[] = [];
    const run = (c: Command) => { const ev = b.reduce(c); log.push(...ev); return ev; };
    while (b.state.phase.kind === 'player' && b.state.turn <= 40) {
      const s = b.state;
      const hero = liveUnits(s.units).find((u) => u.side === 0 && !(u.moved && u.acted) && u.status === 0);
      if (!hero) { run({ type: 'endTurn' }); }
      else {
        run({ type: 'select', slot: hero.slot });
        const tryAttack = (): boolean => {
          if (run({ type: 'beginTarget', action: 0 }).some((e) => e.type === 'rejected')) return false;
          const sel = b.state.phase.kind === 'player' ? b.state.phase.sel : null;
          if (!sel || sel.mode !== 'target') return false;
          const target = liveUnits(b.state.units).find((u) => hostile(hero, u) && sel.range.kindAt(u.c, u.r) === 1);
          if (!target) { run({ type: 'cancel' }); return false; }
          run({ type: 'act', c: target.c, r: target.r });
          return true;
        };
        if (!tryAttack() && !hero.moved) {
          run({ type: 'beginMove' });
          const sel = b.state.phase.kind === 'player' ? b.state.phase.sel : null;
          if (sel && sel.mode === 'move') {
            const enemies = liveUnits(b.state.units).filter((u) => hostile(hero, u));
            let best: [number, number] | null = null, bestD = 999;
            for (const cell of sel.range.cells()) {
              if (!canStop(sel.range, b.state.units, hero, cell.c, cell.r) || (cell.c === hero.c && cell.r === hero.r)) continue;
              const d = Math.min(...enemies.map((e) => dist(e.c, e.r, cell.c, cell.r)));
              if (d < bestD) { bestD = d; best = [cell.c, cell.r]; }
            }
            if (best) run({ type: 'move', c: best[0], r: best[1] }); else run({ type: 'cancel' });
            tryAttack();
          }
        }
        if (b.state.phase.kind === 'player' && b.state.phase.sel.mode === 'menu') run({ type: 'wait' });
        if (b.state.phase.kind === 'player' && b.state.phase.sel.mode === 'face') run({ type: 'face', dir: 1 });
      }
      let guard = 0;
      while (b.state.phase.kind === 'enemy' && guard++ < 60) run({ type: 'enemyStep' });
    }
    return { events: log, turns: b.state.turn, result: b.state.phase.kind === 'end' ? b.state.phase.result : 'open' };
  }

  it('the first battle is played to an end by a simple policy, deterministically', () => {
    const a = play(7), b = play(7);
    expect(a.result).not.toBe('open');
    expect(a.turns).toBeLessThanOrEqual(40);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    const units: Unit[] = [];
    void units;
    console.info(`first battle: ${a.result} in ${a.turns} turns, ${a.events.length} events`);
  });
});
```

`void units` 줄과 `Unit` import는 쓰지 않으므로 지운다.

- [ ] **Step 2: 실행**

Run: `cd web && npx vitest run test/battleCorpus.test.ts 2>&1 | tail -6`
Expected: `Tests  3 passed`, 콘솔에 `first battle: victory in N turns`(패배여도 통과한다. 40턴 안에 끝나지 않으면 정책의 `wait` 처리와 `cancel` 분기를 확인한다).

- [ ] **Step 3: 문서**

`docs/manual.md`:
- §1.2 표의 "2 필드 모드 … 예정"을 "2 전투 1판 (필드 + 전투 규칙 + 적 AI) … 완료"로, "3 전투 규칙"을 "3 아이템·소지품 … 예정"으로 바꾼다.
- §6 앞에 새 절 **"6. 전투 페이지"**를 넣고 기존 §6 뷰어를 §7로, 이후 절 번호를 하나씩 민다(§13 문서 지도까지). 새 절 내용:

```markdown
## 6. 전투 페이지

```bash
cd web && npm run dev
```

브라우저에서 http://localhost:5173/game.html 을 연다.

### 6.1 시작

1. **전투** 목록에서 하나를 고른다(33개, `번호 에피소드 — 목표`). 첫 항목이 원작의 첫 전투 "첫업무"다.
2. **시드**는 비워 두면 시각으로 정한다. 같은 시드와 같은 조작은 같은 결과를 낸다.
3. **시작**을 누른다. 파티는 새 게임 파티(카린·알, 로스터 1의 장비)에 고른 전투의 로스터를 적용한 것이다. 파티 레벨이 로스터보다 낮으면 로스터 레벨까지 올린다(리메이크 편의 규칙).

### 6.2 조작

| 조작 | 동작 |
|---|---|
| 아군 유닛 클릭 | 선택. 이동 가능 셀(MOVE 타일)과 메뉴가 나온다 |
| 이동 → 셀 클릭 | 경로를 따라 달린다. 이동은 되돌릴 수 없다 |
| 공격 → 빨간 셀의 적 클릭 | 공격. 숫자 팝업과 로그 |
| 마법 → 주문 → 셀 클릭 | 시전. MP가 부족한 주문은 비활성 |
| 대기 | 유닛 종료 |
| 방향 화살표 클릭 / 유닛 클릭 / Enter | 행동 뒤 바라볼 방향. 배후·측면 판정에 쓰인다 |
| 오른쪽 클릭 / Esc | 한 단계 취소 |
| 턴 종료 | 적 페이즈. 모든 아군이 끝나도 자동으로 넘어간다 |
| 방향키·드래그·Shift | 뷰어와 같다 |

### 6.3 규칙 요약

- 유닛마다 턴에 이동 1회, 행동 1회. 이동력 30, 지형 비용은 종족표. 적 옆 칸에 들어가면 멈춘다(ZOC).
- 명중·크리티컬·회피는 민첩 비율, 방향(배후 ×2, 측면 +50 %), 상태로 정한다. 대미지 = 공격 − 방어, 속성·배율·높이 보정. 자세한 공식은 `analysis/battle_rules.md`.
- 적은 원작 AI 점수표로 움직인다(`analysis/field_mode.md` §5).
- 적 전멸 → 승리, 아군 전멸 → 게임 오버. 결과는 패널에 뜬다.

### 6.4 없는 것

아이템 사용, 이야기·대사, 마을, 세이브, 소리. 다음 하위 프로젝트에서 만든다.
```

- §7(뷰어)의 첫 줄 명령은 그대로 두고, 문서 지도(§14가 됨)에 `docs/superpowers/specs/2026-10-15-battle-foundation-design.md`, `analysis/field_mode.md` 행을 더한다.
- `README.md`: 상태표의 2행을 "2 전투 1판 | 유닛·이동·공격·마법·적 AI·승패 (33개 전투 선택) | 완료", 3행을 "3 아이템·소지품 | 전투 중 아이템 사용, 상점 소지품 | 예정"으로 바꾸고, 빠른 시작 3단계 아래에 `# 전투: http://localhost:5173/game.html` 줄을 더한다.
- `web/README.md`: 명령표 아래에 "전투 페이지 `game.html`, 뷰어 `index.html`" 한 줄을 더한다.

- [ ] **Step 4: 전체 검사와 커밋**

Run: `cd web && npm run check 2>&1 | tail -4` 와 `python3 -I -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -2`
Expected: 모두 통과.

```bash
git add web/test/battleCorpus.test.ts docs/manual.md README.md web/README.md
git commit -m "test(web): battle corpus and first-battle scenario; docs for the battle page"
```
