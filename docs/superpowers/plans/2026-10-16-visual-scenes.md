# 비주얼 씬 (하위 프로젝트 5 계획 C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `PLAY_VISUAL` 이 부르는 원작 비주얼 씬 11개(오프닝 무비 18부, 엔딩 2종 포함)를 원작 장면 함수에서 전사한 타임라인으로 재생한다. 재생 중 클릭 또는 Enter 로 건너뛸 수 있다.

**Architecture:** 원작 모드 8 은 "오브젝트 ≤ 10개(이미지 슬롯·소스 rect·위치·색 키·클립), 팔레트 페이드, 오브젝트 이동, 타일 효과, 타이머" 위에 장면마다 손으로 짠 상태 기계다. 웹판은 같은 원시 집합을 **타임라인 명령**(`visual/timeline.ts`)으로 두고, 순수 재생기(`visual/player.ts`)가 명령열을 실행해 `Scene.backdrop` 조각과 페이드를 낸다. 장면은 코드 파일로 전사한다(`visual/scenes/sceneNN.ts`, 머리말에 원작 함수 주소). `GameCore` 는 `visual` 모드를 얻고, 장면이 끝나면 `script` 로 돌아온다.

**Tech Stack:** TypeScript, Vitest(가짜 이미지·가짜 시계), 기존 Renderer `Scene.backdrop`/`FxSnapshot`, `AssetLoader.image('bmp')` + `IndexedBitmaps`(색 키 249), Python 변환기(stdlib).

**Spec:** `docs/superpowers/specs/2026-10-16-save-sound-visual-design.md` §3, §4, §5, §8, §11, §12(계획 C), §13, §14. 근거: `analysis/save_sound_visual.md` §3 와 Task 1 이 쓰는 `analysis/visual_scenes.md`.

## Global Constraints

- `PLAY_VISUAL n` 해석은 표 0x449598: n 0..17 → 장면 0 의 n부부터 끝까지, n 21..33 → 장면 1..13 처음부터, 그 밖은 경고 1줄 뒤 무시 (`analysis/save_sound_visual.md` §3.1). 스크립트가 쓰는 n: 0, 21, 23, 24, 26, 27, 29, 30, 31, 32, 33.
- 이미지는 `vsllst` 레코드 (scene, step, slot) → `bmp/<name>.png` (이름 소문자). 오브젝트 0 은 불투명, 오브젝트 1..9 는 색 키 249 (`FUN_00401880`); 장면이 `FUN_00419da0` 로 바꾸면 그 값.
- 팔레트 페이드 1 스텝 = `FADE_STEP_MS` 30 ms (`field/effects.ts` 와 같은 상수). "저장된 팔레트로 페이드"(mode 2/4) 는 검정으로의 페이드아웃으로 둔다 [추정]. 팔레트 리맵(vsllst pal 파라미터, FUN_00434250) 은 하지 않는다 [추정: PNG 가 이미 각 비트맵의 팔레트를 가진다].
- 타일 효과(kind 0/3/4) 는 **근사**다 [추정]: kind 3 = 셀이 격자 순서로 나타남, kind 4 = 셀이 격자 순서로 사라짐, kind 0 = 여러 이미지를 순서대로 바꿔 보임. 파일 머리말에 [추정] 표시.
- 재생 중 클릭/Enter → 장면 즉시 종료(원작 `DAT_0044a63c` 취소에 해당, 스펙 §8). 종료 뒤 스크립트는 다음 명령부터 이어진다.
- 코드 식별자·주석은 영어, 사용자 문서·로그는 한국어. 원작 함수 주소를 장면 파일 머리말에 적는다.
- 매 작업 끝에 `cd web && npm run check` 와 `python3 -I -m unittest discover -s tools -p 'test_*.py'` 가 녹색.

## Review Focus

1. **비트맵이 없는 슬롯**을 그리는 명령은 그 조각만 건너뛰고 장면은 계속된다(검은 화면이 아니라 다른 조각은 보인다). → Task 2 테스트 `a missing image skips only its piece`.
2. **건너뛰기**는 재생 중 어느 순간이든 장면을 끝내고, 두 번 눌러도 두 번 끝나지 않는다; 스크립트는 바로 이어진다. → Task 2 `skip ends the scene once`, Task 4 `a click during a scene returns to the script`.
3. **오프닝 표 시각**은 장면 시작 기준이다(부 시작 기준이 아님): 부 k 는 장면 시계가 `table[k]` 를 지나야 끝난다. → Task 2 테스트 `waitUntil uses the scene clock`.
4. **장면 중 VM 정지**: `visual` 모드에서는 VM 이 다음 명령을 실행하지 않는다; 장면이 끝난 프레임에 `script` 로 돌아온다. → Task 4 테스트 `the VM waits while a scene plays`.
5. **알 수 없는 n**(표 밖 18..20, 34 이상; 또는 전사하지 않은 장면 2/5/8): 경고 1줄 뒤 즉시 다음 명령. → Task 4 테스트 `an unknown scene number logs and continues`.

## File Structure

```
tools/ft2_export.py                 export_visual(): DATA/vsllst.dat → data/visual.json (249 레코드); index.json visual: true
tools/test_ft2_visual.py            변환기 테스트
analysis/visual_scenes.md           장면 함수 디컴파일 정리(원시 표, 장면별 상태 기계, 오프닝 표 시각, 미확인)
web/src/visual/timeline.ts          Cmd 타입과 SceneDef, VisualImages 인터페이스, PART_END_MS(오프닝 표), dispatch(n)
web/src/visual/player.ts            VisualPlayer: 명령열 실행 → { backdrop, fade, done }; skip()
web/src/visual/scenes/index.ts      scenes: Record<number, SceneDef>
web/src/visual/scenes/scene00.ts … scene13.ts  전사(머리말: 원작 함수, [추정] 항목)
web/src/game/gameCore.ts            Mode 'visual'; playVisual(n); frame: visual → stage.visualDone() → script
web/src/game/browserStage.ts        VisualPlayer 보유, 슬롯 이미지 로딩(IndexedBitmaps 키), draw, 클릭/Enter → skip
web/test/helpers/stageFixtures.ts   FakeStage.startVisual/visualDone/skipVisual
web/test/visualPlayer.test.ts, visualScenes.test.ts, gameCore.test.ts(추가)
docs/manual.md §7, README.md, 스펙 상태 줄
```

---

### Task 1: 장면 목록 변환과 분석 문서

**Files:**
- Modify: `tools/ft2_export.py` (`export_audio` 뒤에 `export_visual`, `main` 에 호출과 `visual=True`)
- Create: `analysis/visual_scenes.md`
- Test: `tools/test_ft2_visual.py`

**Interfaces:**
- Produces: `web/public/assets/data/visual.json` = `[{ "scene": int, "step": int, "slot": int, "name": str(lower), "pal": [int,int,int] }, …]` (vsllst 순서 그대로, 249 개). `index.json` 에 `"visual": true`.

- [ ] **Step 1: 실패하는 테스트**

```python
# tools/test_ft2_visual.py
import json, struct, tempfile, unittest
from pathlib import Path
import ft2_export

def rec(scene, step, slot, name, pal=(0, 0, 0)):
    return struct.pack('<HHH', scene, step, slot) + name.encode('ascii').ljust(16, b'\0') + struct.pack('<HHHH', 0, *pal)

class VisualExportTest(unittest.TestCase):
    def test_records_become_json_with_lowercase_names(self):
        with tempfile.TemporaryDirectory() as d:
            src, dst = Path(d, 'game'), Path(d, 'out')
            (src / 'DATA').mkdir(parents=True)
            (src / 'DATA' / 'vsllst.dat').write_bytes(rec(0, 0, 0, 'VOP01') + rec(3, 0, 2, 'V03C00', (32, 10, 208)))
            report = ft2_export.Report()
            n = ft2_export.export_visual(src, dst, report)
            self.assertEqual(n, 2)
            self.assertEqual(report.errors, [])
            data = json.loads((dst / 'data' / 'visual.json').read_text(encoding='utf-8'))
            self.assertEqual(data[0], {'scene': 0, 'step': 0, 'slot': 0, 'name': 'vop01', 'pal': [0, 0, 0]})
            self.assertEqual(data[1]['name'], 'v03c00')
            self.assertEqual(data[1]['pal'], [32, 10, 208])

    def test_missing_list_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            report = ft2_export.Report()
            self.assertEqual(ft2_export.export_visual(Path(d, 'none'), Path(d, 'out'), report), 0)
            self.assertEqual(len(report.errors), 1)
```

- [ ] **Step 2: RED** — `python3 -I -m unittest tools.test_ft2_visual -v` → FAIL `AttributeError: module 'ft2_export' has no attribute 'export_visual'`.
- [ ] **Step 3: 구현**

```python
def export_visual(src: Path, dst: Path, report: Report) -> int:
    """DATA/vsllst.dat (30-B records: u16 scene, u16 step, u16 slot, char[16] name, u16 loaded, u16[3] palette params)
    → data/visual.json. Returns the record count."""
    lst = next((p for p in (src / 'DATA').glob('*') if p.name.lower() == 'vsllst.dat'), None) if (src / 'DATA').is_dir() else None
    if lst is None:
        report.error('no DATA/vsllst.dat')
        return 0
    raw = lst.read_bytes()
    records = []
    for i in range(len(raw) // 30):
        r = raw[i * 30:(i + 1) * 30]
        scene, step, slot = struct.unpack_from('<HHH', r, 0)
        name = r[6:22].split(b'\0')[0].decode('ascii', 'replace').lower()
        pal = list(struct.unpack_from('<HHH', r, 24))
        records.append(dict(scene=scene, step=step, slot=slot, name=name, pal=pal))
    (dst / 'data').mkdir(parents=True, exist_ok=True)
    (dst / 'data' / 'visual.json').write_text(json.dumps(records), encoding='utf-8')
    return len(records)
```
`main`: `visual = export_visual(game, out, report)` 와 index.json `visual=visual > 0`; 출력 줄에 `visual {visual}`.

- [ ] **Step 4: GREEN + 실제 변환** — 테스트 PASS; `python3 -I tools/ft2_export.py extracted/FarlandTactics2 web/public/assets` → `visual 249`, errors 0; `python3 -I -m unittest discover -s tools -p 'test_*.py'` OK.
- [ ] **Step 5: 분석 문서** — `analysis/visual_scenes.md`: §1 원시 함수 표(오브젝트·이미지 슬롯·FUN_00419c70 show·FUN_00419e40 order·FUN_00419da0 key·FUN_00419f10 clip·팔레트 FUN_00419920/970/a20/99b0/aa0·이동 FUN_0041a2b0/a380/a270·타일 효과 FUN_0041aac0/aa20/a890/a910·소리 FUN_0041dc50/dca0/dc30·타이머 FUN_004024f0/0041dbc0/00402050·FUN_00401880 reset·FUN_00402070 part end), §2 장면별 상태 기계(0~13, 세션 노트의 내용), §3 오프닝 표 0x449058, §4 미확인(타일 효과 kind 의 실제 모양, FUN_0041a0b0/a1a0/a200 dissolve, FUN_00407280 크레딧 루프, pal 파라미터 의미). `analysis/save_sound_visual.md` §3 끝에 링크 1줄.
- [ ] **Step 6: 커밋** — `git add tools/ft2_export.py tools/test_ft2_visual.py analysis/visual_scenes.md analysis/save_sound_visual.md && git commit -m "feat(tools): export the visual scene list; analysis of the scene functions"`

### Task 2: 타임라인과 재생기

**Files:**
- Create: `web/src/visual/timeline.ts`, `web/src/visual/player.ts`
- Test: `web/test/visualPlayer.test.ts`

**Interfaces (Produces):**

```ts
// timeline.ts
export type Cmd =
  | { op: 'order'; ids: number[] }                                                                 // FUN_00419e40 draw order (front to back = last drawn last)
  | { op: 'show'; obj: number; slot: number; sx: number; sy: number; w: number; h: number; dx: number; dy: number }   // FUN_00419c70
  | { op: 'hide'; obj: number }                                                                    // FUN_00419fe0
  | { op: 'key'; obj: number; key: number | null }                                                 // FUN_00419da0
  | { op: 'clip'; obj: number; x: number; y: number; w: number; h: number }                        // FUN_00419f10
  | { op: 'move'; obj: number; from: [number, number]; to: [number, number]; ms: number }         // FUN_0041a2b0 / a380
  | { op: 'waitMove'; obj: number }                                                                // FUN_0041a270
  | { op: 'fade'; dir: 'in' | 'out'; steps: number }                                               // FUN_00419a20(steps, 1) in / (steps, 2|4) out
  | { op: 'waitFade' }                                                                             // FUN_00419aa0 / thunk_FUN_004184d0
  | { op: 'wait'; ms: number }                                                                     // FUN_004024f0: ms since the last wait ended
  | { op: 'waitUntil'; ms: number }                                                                // FUN_00402050 / FUN_0041dbc0: ms since the scene clock reset
  | { op: 'resetClock' }                                                                           // DAT_00449674 = now
  | { op: 'pos'; obj: number; x: number; y: number }                                               // FUN_00419ec0 base position
  | { op: 'anim'; fx: number; obj: number; x: number; y: number; frames: Frame[]; loop: boolean }  // FUN_0041aac0 (sheet(...)) / FUN_0041aa20 (slides(...))
  | { op: 'effect'; fx: number; on: boolean }                                                      // FUN_0041a890
  | { op: 'waitEffect'; fx: number }                                                               // FUN_0041a910
  | { op: 'sound'; name: string }                                                                  // FUN_0041dc50 + FUN_0041dca0(ch, 1)
  | { op: 'end' };                                                                                 // FUN_00402070
export interface SceneDef { id: number; parts: Cmd[][] }
export interface VisualImage { image: CanvasImageSource; w: number; h: number }
export interface VisualImages { get(slot: number): VisualImage | null }   // null = missing or not yet loaded
export const OPENING_PART_END_MS: number[] = [9000, 24000, 32000, 45000, 53000, 57000, 62000, 66000, 71000, 76000, 85000, 93000, 97000, 103000, 108000, 128000, 139000];   // 0x449058
export function dispatch(n: number): { scene: number; part: number } | null;   // 0..17 → {0, n}; 21..33 → {n-20, 0}; else null
// player.ts
export interface VisualFrame { backdrop: Backdrop[]; fade: { color: 'black'; alpha: number } | null; done: boolean }
export class VisualPlayer {
  onSound?: (name: string) => void;
  get playing(): boolean;
  start(def: SceneDef, part: number, images: VisualImages, now: number): void;
  update(now: number): VisualFrame;
  skip(): void;
}
```

재생 규칙: 명령은 순서대로 즉시 실행하고, `wait*` 명령은 조건이 참이 될 때까지 그 명령에 머문다(한 `update` 에서 여러 명령 소비 가능). 부가 끝나면 다음 부로; `end` 또는 마지막 명령 뒤 → `done`. 시계는 둘: **부 시계**(부 시작과 `resetClock` 에서 0; `wait ms` = 부 시계 ≥ ms — 원작 `DAT_00449688`/`DAT_00449674`, 하위 단계 사이에 리셋되지 않는다 [관찰 FUN_004052a0, FUN_00406a60]) 와 **장면 시계**(`waitUntil ms` — `FUN_0041dbc0`). 이동은 선형 보간, 끝나면 `to` 에 고정. 페이드: in = alpha 1→0, out = 0→1, `steps×30 ms`, steps 0 = 즉시; 페이드아웃 뒤 alpha 1 유지. 애니메이션: `anim` 은 정의만 하고 `effect on` 이 시작; 매 프레임 경과 시간으로 프레임을 골라 오브젝트에 보인다(1회면 끝난 뒤 마지막 프레임 유지, 반복이면 `effect off` 까지). `waitEffect` 는 1회 효과가 끝날 때까지(정의만 된 효과는 바로 통과). `show` 의 조각은 이미지 크기로 클립(원작과 같음). `skip()` → `done`, 이후 `update` 는 빈 backdrop + 같은 done.

- [ ] **Step 1: 실패하는 테스트**

```ts
// web/test/visualPlayer.test.ts
import { describe, expect, it } from 'vitest';
import { VisualPlayer } from '../src/visual/player';
import { dispatch, type Cmd, type SceneDef, type VisualImages } from '../src/visual/timeline';

const img = (w: number, h: number) => ({ image: { w, h } as unknown as CanvasImageSource, w, h });
const images = (sizes: Record<number, [number, number]>): VisualImages => ({ get: (slot) => (sizes[slot] ? img(...sizes[slot]) : null) });
const scene = (...parts: Cmd[][]): SceneDef => ({ id: 1, parts });

describe('VisualPlayer', () => {
  it('show draws one piece at its position, clipped to the image', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 }, { op: 'wait', ms: 100 }]), 0, images({ 0: [288, 96] }), 0);
    const f = p.update(0);
    expect(f.backdrop).toEqual([{ image: expect.anything(), sx: 0, sy: 0, w: 288, h: 96, dx: 0, dy: 0 }]);
    expect(f.done).toBe(false);
  });
  it('a missing image skips only its piece', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 }, { op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 10, h: 10, dx: 5, dy: 6 }, { op: 'wait', ms: 100 }]), 0, images({ 1: [10, 10] }), 0);
    expect(p.update(0).backdrop.map((b) => b.dx)).toEqual([5]);
  });
  it('order decides the drawing order', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'order', ids: [3, 0] }, { op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 10, h: 10, dx: 0, dy: 0 }, { op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 10, h: 10, dx: 1, dy: 0 }, { op: 'wait', ms: 1 }]), 0, images({ 0: [10, 10], 1: [10, 10] }), 0);
    expect(p.update(0).backdrop.map((b) => b.dx)).toEqual([1, 0]);
  });
  it('move interpolates and waitMove holds until the end', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 10, h: 10, dx: 0, dy: 0 }, { op: 'move', obj: 3, from: [0, 0], to: [100, 50], ms: 1000 }, { op: 'waitMove', obj: 3 }, { op: 'end' }]), 0, images({ 1: [10, 10] }), 0);
    expect(p.update(500).backdrop[0]).toMatchObject({ dx: 50, dy: 25 });
    expect(p.update(500).done).toBe(false);
    const f = p.update(1000);
    expect(f.backdrop[0]).toMatchObject({ dx: 100, dy: 50 });
    expect(f.done).toBe(true);
  });
  it('fade in goes from black to clear in steps × 30 ms', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'fade', dir: 'in', steps: 8 }, { op: 'waitFade' }, { op: 'end' }]), 0, images({}), 0);
    expect(p.update(0).fade).toEqual({ color: 'black', alpha: 1 });
    expect(p.update(120).fade).toEqual({ color: 'black', alpha: 0.5 });
    const f = p.update(240);
    expect(f.fade).toBeNull();
    expect(f.done).toBe(true);
  });
  it('wait reads the part clock, which resetClock restarts', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'wait', ms: 100 }, { op: 'wait', ms: 150 }, { op: 'resetClock' }, { op: 'wait', ms: 100 }, { op: 'end' }]), 0, images({}), 0);
    expect(p.update(149).done).toBe(false);
    expect(p.update(150).done).toBe(false);
    expect(p.update(250).done).toBe(true);
  });
  it('waitUntil uses the scene clock', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'wait', ms: 100 }, { op: 'waitUntil', ms: 150 }], [{ op: 'waitUntil', ms: 300 }, { op: 'end' }]), 0, images({}), 1000);
    expect(p.update(1149).done).toBe(false);
    expect(p.update(1150).done).toBe(false);   // part 1 waits for 300 since the scene start
    expect(p.update(1300).done).toBe(true);
  });
  // 애니메이션 테스트: 시트 프레임 진행·마지막 프레임 유지, 반복 효과 정지, 슬라이드 교체, 시작 안 한 효과의 waitEffect — 구현 파일 test/visualPlayer.test.ts 참조
  it('sound reports its name once', () => {
    const p = new VisualPlayer(); const heard: string[] = [];
    p.onSound = (n) => heard.push(n);
    p.start(scene([{ op: 'sound', name: 'v01' }, { op: 'wait', ms: 10 }]), 0, images({}), 0);
    p.update(0); p.update(5);
    expect(heard).toEqual(['v01']);
  });
  it('skip ends the scene once', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 10, h: 10, dx: 0, dy: 0 }, { op: 'wait', ms: 5000 }]), 0, images({ 0: [10, 10] }), 0);
    p.update(0);
    p.skip(); p.skip();
    const f = p.update(1);
    expect(f.done).toBe(true);
    expect(f.backdrop).toEqual([]);
    expect(p.playing).toBe(false);
  });
  it('start at a later part skips the earlier ones', () => {
    const p = new VisualPlayer();
    p.start(scene([{ op: 'wait', ms: 5000 }], [{ op: 'end' }]), 1, images({}), 0);
    expect(p.update(0).done).toBe(true);
  });
});

describe('dispatch', () => {
  it('maps the PLAY_VISUAL table 0x449598', () => {
    expect(dispatch(0)).toEqual({ scene: 0, part: 0 });
    expect(dispatch(17)).toEqual({ scene: 0, part: 17 });
    expect(dispatch(21)).toEqual({ scene: 1, part: 0 });
    expect(dispatch(33)).toEqual({ scene: 13, part: 0 });
    expect(dispatch(18)).toBeNull();
    expect(dispatch(34)).toBeNull();
  });
});
```

- [ ] **Step 2: RED** — `cd web && npx vitest run test/visualPlayer.test.ts` → FAIL (module not found).
- [ ] **Step 3: 구현** — `timeline.ts` 위 인터페이스 그대로; `player.ts`: 상태 `objs: Map<number, { slot, sx, sy, w, h, dx, dy, clip?, key, visible }>`, `order: number[]`(기본 0..9), `moves: Map<obj, { from, to, start, ms }>`, `fadeState`, `effects: Map<obj, { def: TilesCmd; start: number | null }>`, `waitBase`(직전 wait 종료 시각), `clock0`(start now / resetClock), 커서 `{ part, i }`. `update(now)`: 커서 명령을 `done` 또는 wait 조건이 거짓일 때까지 실행; 그 뒤 프레임 조립: order 의 각 obj 에 대해 (1) 효과가 있고 켜져 있으면 셀 조각들, (2) 아니면 show 조각(이동 중이면 보간 위치; clip 적용). fade alpha 는 Effects 와 같은 계산.
- [ ] **Step 4: GREEN** — 위 테스트 PASS; `npm run check` 녹색.
- [ ] **Step 5: 커밋** — `git add web/src/visual web/test/visualPlayer.test.ts && git commit -m "feat(web): visual scene timeline and player"`

### Task 3: 장면 전사 1차 — 1, 3, 4, 6, 7, 9, 10, 11

**Files:**
- Create: `web/src/visual/scenes/index.ts`, `scene01.ts`, `scene03.ts`, `scene04.ts`, `scene06.ts`, `scene07.ts`, `scene09.ts`, `scene10.ts`, `scene11.ts`
- Test: `web/test/visualScenes.test.ts`

**Interfaces:**
- Consumes: Task 2 `Cmd`, `SceneDef`, `dispatch`.
- Produces: `scenes: Record<number, SceneDef>` (`index.ts`).

전사 규칙: 각 파일 머리말 주석에 원작 래퍼·본체·설정 함수 주소와 [추정] 항목. 설정 함수의 `FUN_00419c70` 호출은 `show`, `FUN_00419e40` 는 `order`, `FUN_00419ec0` 는 `pos`, `FUN_0041aac0(fx, obj, x, y, cw, ch, ms, repeat, slot)` 는 `anim{frames: sheet(slot, W, H, cw, ch, ms), loop: repeat === 0}`(W×H 는 PNG 크기), `FUN_0041aa20(fx, obj, x, y, sx, sy, w, h, ms, repeat, list)` 는 `anim{frames: slides(list, w, h, ms)}`, `FUN_0041dc50(ch, name)` + `FUN_0041dca0(ch,1)` 는 `sound`(채널 정지는 생략 [추정: 짧은 소리]), 본체의 sub-step 들은 `wait*`/`effect`/`fade`. 설정 함수는 REA `batch_decompile` 로 읽는다.

- [ ] **Step 1: 실패하는 테스트**

```ts
// web/test/visualScenes.test.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scenes } from '../src/visual/scenes';
import { dispatch, type Cmd } from '../src/visual/timeline';

const ASSETS = join(__dirname, '../public/assets');
const list = JSON.parse(readFileSync(join(ASSETS, 'data/visual.json'), 'utf-8')) as { scene: number; step: number; slot: number; name: string }[];
const index = JSON.parse(readFileSync(join(ASSETS, 'index.json'), 'utf-8')) as { bmp: string[] };
const SCRIPT_USES = [0, 21, 23, 24, 26, 27, 29, 30, 31, 32, 33];
const FIRST_PASS = [1, 3, 4, 6, 7, 9, 10, 11];

describe('visual scenes (corpus)', () => {
  it.each(FIRST_PASS)('scene %i is transcribed and ends with end', (id) => {
    const def = scenes[id];
    expect(def, `scene ${id}`).toBeDefined();
    const last = def!.parts.at(-1)!.at(-1)!;
    expect(last.op).toBe('end');
  });
  it('every slot a scene shows exists in the list and its bitmap is exported', () => {
    for (const def of Object.values(scenes)) {
      def.parts.forEach((cmds, part) => {
        const slots = cmds.flatMap((c: Cmd) => c.op === 'show' ? [c.slot] : c.op === 'anim' ? c.frames.map((f) => f.slot) : []);
        for (const slot of slots) {
          const rec = list.find((r) => r.scene === def.id && r.slot === slot && r.step <= part);
          expect(rec, `scene ${def.id} part ${part} slot ${slot}`).toBeDefined();
          expect(index.bmp.includes(rec!.name), rec!.name).toBe(true);
          expect(existsSync(join(ASSETS, `bmp/${rec!.name}.png`))).toBe(true);
        }
      });
    }
  });
  it('every PLAY_VISUAL number the scripts use resolves to a transcribed scene', () => {
    for (const n of SCRIPT_USES) {
      const d = dispatch(n)!;
      expect(d, `n ${n}`).not.toBeNull();
      if (d.scene === 0 || d.scene === 12 || d.scene === 13) continue;   // Task 5
      expect(scenes[d.scene], `scene ${d.scene}`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: RED** — FAIL (no `scenes` module).
- [ ] **Step 3: 전사** — 세션 노트/`analysis/visual_scenes.md` §2 대로. 예 `scene01.ts`:

```ts
/** Scene 1 (PLAY_VISUAL 21): FUN_004052a0 → setup FUN_00405340. [추정] tile kind 3 look, p7 = ms per cell. */
import type { SceneDef } from '../timeline';
export const scene01: SceneDef = { id: 1, parts: [[
  { op: 'order', ids: [0, 3] },
  { op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 },
  { op: 'anim', fx: 0, obj: 3, x: 336, y: 48, frames: sheet(1, 1008, 352, 144, 176, 100), loop: false },
  { op: 'fade', dir: 'in', steps: 8 }, { op: 'waitFade' }, { op: 'wait', ms: 3000 },
  { op: 'effect', fx: 0, on: true }, { op: 'waitEffect', fx: 0 }, { op: 'waitUntil', ms: 6000 },
  { op: 'end' },
]] };
```
(`FUN_00402070(0)` 뒤의 화면 전환은 스크립트의 FADE 가 맡는다.) 나머지 장면도 같은 식.

- [ ] **Step 4: GREEN** — 코퍼스 테스트 PASS; `npm run check`.
- [ ] **Step 5: 커밋** — `git add web/src/visual/scenes web/test/visualScenes.test.ts && git commit -m "feat(web): visual scenes 1, 3, 4, 6, 7, 9, 10, 11 transcribed"`

### Task 4: GameCore `visual` 모드와 BrowserStage 재생·건너뛰기

**Files:**
- Modify: `web/src/game/gameCore.ts` (Stage 인터페이스 3 메서드, `Mode` 에 `'visual'`, `playVisual`, `frame`), `web/src/game/browserStage.ts`, `web/test/helpers/stageFixtures.ts`
- Test: `web/test/gameCore.test.ts` (추가 describe)

**Interfaces:**
- Consumes: Task 2 `VisualPlayer`, `dispatch`; Task 3 `scenes`.
- Produces: `Stage.startVisual(def: SceneDef, part: number): void; Stage.visualDone(): boolean; Stage.skipVisual(): void`. FakeStage: `visual: { id: number; part: number } | null`, `startVisual` 기록 `['startVisual', id, part]` 후 `visual` 설정, `visualDone()` = `visual === null`, `skipVisual()` = `visual = null`.

GameCore: `playVisual(n)`: `const d = dispatch(n); const def = d && scenes[d.scene]; if (!def) { log warn 'PLAY_VISUAL n: 장면 없음'; return; } this.stage.startVisual(def, d.part); this.mode = 'visual';`. `frame`: `else if (this.mode === 'visual') { if (this.stage.visualDone()) this.mode = 'script'; }` (visual 모드에서는 VM 을 밟지 않는다; 다음 프레임에 script 가 이어진다). BrowserStage: `player = new VisualPlayer()`, `visualImages: Map<slot, VisualImage|null>` 를 `startVisual` 때 `visual.json` 의 (scene, slot) 레코드로 채운다(`assets.image('bmp', name)` → `IndexedBitmaps.prepare(key)`; key = obj 0 → null, else 249 — 레코드의 슬롯이 어느 obj 에 그려지는지는 명령에서 알 수 없으므로 두 키 모두 준비하고 `VisualImages.get(slot, opaque?)`… ⇒ 단순화: 슬롯 0 은 불투명, 그 밖은 키 249 [추정: 전사한 모든 장면에서 obj 0 ↔ slot 0]), `draw`: `player.playing` 이면 `renderer.draw({ map: null, sprites: [], camera: {0,0}, overlay OFF, seeThrough false, fx: { ...fx, fade: frame.fade ?? fx.fade }, backdrop: frame.backdrop })`; 클릭(mouseup, cellMode 아님)과 Enter: `if (this.player.playing) { this.player.skip(); return; }`; `player.onSound = (n) => this.playSound(n)`. `visual.json` 은 page boot 에서 fetch 해 BrowserStage 생성자에 넘긴다(`visualList: VisualRecord[]`).

- [ ] **Step 1: 실패하는 테스트** (gameCore.test.ts 에 추가)

```ts
describe('visual scenes', () => {
  const program = (body: string) => /* 기존 helper 로 'begin' 라벨에 body 를 둔 EVENT01 프로그램 생성 */;
  it('PLAY_VISUAL 21 starts scene 1 and the VM waits while a scene plays', () => {
    const { core, stage } = boot(program('PLAY_VISUAL 21\nSOUND tumble\nTOWN'));
    core.frame(0);
    expect(stage.calls).toContainEqual(['startVisual', 1, 0]);
    expect(core.mode).toBe('visual');
    core.frame(16);
    expect(stage.calls.some((c) => c[0] === 'playSound')).toBe(false);
    stage.skipVisual();                      // a click during a scene returns to the script
    core.frame(32); core.frame(48);
    expect(stage.calls).toContainEqual(['playSound', 'tumble']);
  });
  it('an unknown scene number logs and continues', () => {
    const { core, stage } = boot(program('PLAY_VISUAL 40\nSOUND tumble\nTOWN'));
    core.frame(0);
    expect(stage.calls.filter((c) => c[0] === 'startVisual')).toEqual([]);
    expect(stage.calls.some((c) => c[0] === 'log' && String(c[2]).includes('PLAY_VISUAL 40'))).toBe(true);
    expect(stage.calls).toContainEqual(['playSound', 'tumble']);
  });
  it('PLAY_VISUAL 0 starts the opening at part 0', () => {
    const { core, stage } = boot(program('PLAY_VISUAL 0\nTOWN'));
    core.frame(0);
    expect(stage.calls).toContainEqual(['startVisual', 0, 0]);
  });
});
```
(세 번째 테스트는 Task 5 전까지 `scenes[0]` 가 없어 경고로 끝난다 → Task 5 에서 녹색이 되도록 `it.todo` 가 아니라 Task 5 Step 1 로 옮긴다.)

- [ ] **Step 2: RED** — `startVisual` 없음 / mode 가 `script`.
- [ ] **Step 3: 구현** (위 설계) → **Step 4: GREEN**, `npm run check`.
- [ ] **Step 5: 커밋** — `git commit -am "feat(web): visual mode in GameCore; BrowserStage plays and skips scenes"`

### Task 5: 장면 전사 2차 — 오프닝(0, 18부)과 엔딩(12, 13)

**Files:**
- Create: `web/src/visual/scenes/scene00.ts`, `scene12.ts`, `scene13.ts`; `index.ts` 등록
- Test: `web/test/visualScenes.test.ts` 에 `FIRST_PASS` → 모든 전사 장면 `[0,1,3,4,6,7,9,10,11,12,13]`, 오프닝 부 수 18, 부 k(0..16) 의 마지막 `waitUntil` 이 `OPENING_PART_END_MS[k]`; `gameCore.test.ts` 에 `PLAY_VISUAL 0 starts the opening at part 0`.

디컴파일 대상(REA `batch_decompile`): 오프닝 설정 FUN_00402210, 402510, 402800, 402ae0, 402e70, 403100, 403280, 4034b0, 403630, 403830, 403c00, 403d80, 404020, 4041b0, 4045e0, 404850, 404e50; 엔딩 FUN_00407340(12 설정), FUN_00407280(크레딧), FUN_00407510/407680/4078f0/407a50/407ed0/408140(13 부). 전사하지 못한 세부(디졸브 FUN_0041a0b0/a1a0/a200, 크레딧 루프)는 `show`+`fade` 로 근사하고 머리말에 [추정] 로 적는다.

- [ ] **Step 1: RED** (테스트 확장 → 0/12/13 없음) → **Step 2: 전사** → **Step 3: GREEN**, `npm run check` → **Step 4: 커밋** `"feat(web): opening movie (18 parts) and ending scenes transcribed"`

### Task 6: 브라우저 확인과 문서

- [ ] **Step 1: 브라우저**(내 탭) — `/play.html` 새 게임: 로고(SHOW_IMAGE) 뒤 `PLAY_VISUAL 0` 오프닝 재생 확인(스크린샷 `.playwright-mcp/visual-opening.png`), 클릭으로 건너뛰기 → 마을 스크립트 이어짐; `__ft2().core.vm.run(1, …)` 대신 `__ft2().core.playVisual(21)` 로 장면 1 재생 확인; 콘솔 오류 0.
- [ ] **Step 2: 문서** — `docs/manual.md` §7 "비주얼 씬"(재생·건너뛰기·근사 효과·없는 것: 장면 2/5/8, 팔레트 리맵), README 진행 상태(하위 프로젝트 5 완료), 스펙 상태 줄(계획 C 구현 완료).
- [ ] **Step 3: 커밋** — `git add docs README.md && git commit -m "docs: visual scenes; sub-project 5 complete"`
