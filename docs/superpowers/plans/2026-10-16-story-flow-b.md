# 스토리 진행 구현 계획 B — 화면 효과 · 표현층 · 게임 컨트롤러 · 마을 · 대화 UI · 플레이 페이지

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계획 A 의 VM 을 화면에 붙인다. `web/play.html` 에서 새 게임을 누르면 오프닝 → 마을 → 시설 → 전투 → 훅 → 다음 스테이지가 브라우저에서 돌아간다.

**Architecture:** DOM 을 모르는 `GameCore`(모드 기계 + VM/전투 연결 + 훅)가 `Stage` 인터페이스(표현층·효과·대화·마을 그리기)를 통해 화면을 움직인다. `BrowserStage` 가 캔버스·패널·오버레이 DOM 으로 `Stage` 를 구현한다. 효과 상태(`Effects`)와 마을 핫스팟/프레임 계산(`town.ts`)은 순수 모듈로 두고 테스트한다. 전투 입력 매핑은 `battleInput.ts` 로 뽑아 전투 테스트 페이지와 공유한다.

**Tech Stack:** TypeScript 7, Vite 8, Vitest 5(node), Canvas 2D, HTML 오버레이.

**Spec:** `docs/superpowers/specs/2026-10-16-story-flow-design.md` §5, §8–§12. 원작 근거 `analysis/story_flow.md` §3–§5.

## Global Constraints

- 페이드 1 스텝 = 30 ms, 마을 애니 프레임 200 ms [추정, 스펙 §15].
- 비주얼 씬·세이브·음악·효과음은 스텁(로그/메시지).
- 유닛 배열·소지품은 `Campaign` 의 것을 `Battle` 이 그대로 쓴다(복사 금지).
- 테스트 명령 `cd web && npm run check`.

## Review Focus

1. **스크립트가 전투 중 `END`(FIELD_MODE 없이)로 끝나면** 전투로 돌아오고 선택 상태는 비어 있다. → Task 4 테스트 `a hook script returns to the battle with an idle selection`.
2. **`COMPLETE` 라벨이 없는 승리**: 결과 패널만 뜨고 예외 없이 멈춘다. → Task 4 테스트 `victory without a COMPLETE label shows the result and stays`.
3. **마을에서 비활성 시설 클릭**: 아무 일도 없다. 활성 시설인데 라벨이 stage 파일에도 EVENT00 에도 없으면 경고 로그. → Task 5 테스트 `inactive hotspots ignore clicks; a missing label logs a warning`.
4. **대화 중 클릭**: `WAIT_CLICK` 하나당 클릭 하나만 소비한다(연타해도 대사가 두 줄 건너뛰지 않는다). → Task 6 테스트 `one click releases one wait`.
5. **없는 비트맵(SHOW_IMAGE)**: 검정 화면으로 대체하고 페이드는 끝난다. → Task 1 테스트 `a missing image still completes its fade`.

## File Structure

```
web/src/field/effects.ts        신규: Effects (페이드·틴트·이미지·흔들림·스크롤 상태; 순수)
web/src/field/presenter.ts      수정: Unit.sprite(apd/anim/hidden/offset/layer/marker), moveUnit(base), unitBusy, sweat; sync/scene 의 상태 타입 축소
web/src/render/renderer.ts      수정: Scene.fx (이미지·틴트·페이드·흔들림), 맵 없이도 그리기
web/src/assets/bitmaps.ts       신규: BitmapCache (bmp PNG → ImageBitmap/HTMLImageElement, 비동기, 없으면 null)
web/src/game/battleInput.ts     신규: cellCommand(state, cell) (game/main.ts 의 onClick 분기 이동)
web/src/game/gameCore.ts        신규: GameCore (모드 기계, Host 구현, 전투 훅) + Stage 인터페이스 + FakeStage
web/src/game/browserStage.ts    신규: BrowserStage (캔버스·패널·대화 오버레이·마을 그리기)
web/src/town/town.ts            신규: HOTSPOTS, hitTest, layerFrames, townLabel
web/src/ui/dialogue.ts          신규: parseTextTags, Dialogue (DOM 오버레이: 창 2개, 모달 6종)
web/src/game/main.ts            수정: battleInput 사용
web/src/play/main.ts, web/play.html   신규
web/test/{effects,presenterScript,battleInput,gameCore,gameHooks,town,dialogue}.test.ts  신규
docs/manual.md, README.md       수정
```

---

### Task 1: 화면 효과 상태와 렌더러 합성

**Files:**
- Create: `web/src/field/effects.ts`, `web/src/assets/bitmaps.ts`
- Modify: `web/src/render/renderer.ts` (Scene.fx, 맵 없이 그리기)
- Test: `web/test/effects.test.ts`

**Interfaces:**
- Produces:
```ts
export const FADE_STEP_MS = 30;
export interface FxSnapshot { fade: { color: 'black' | 'white'; alpha: number } | null; tint: { color: string; alpha: number } | null; image: CanvasImageSource | null; shake: { x: number; y: number } }
export class Effects {
  fade(dir: 'in' | 'out', step: number, now: number, color?: 'black' | 'white'): void;   // step 0 = 즉시
  fadeBusy(): boolean;
  showImage(img: CanvasImageSource | null, step: number, now: number): void;  // null = 검정 화면; step 0 즉시, 아니면 검정에서 페이드 인
  hideImage(): void;
  tint(kind: Tint, n: number, pct?: number): void;                            // 'reset' 으로 지움
  shake(n: number): void; clearScreen(): void;
  startScroll(dx, dy, tx, ty, ms, cellOf: (c, r) => { x; y } | null): void; scrollBusy(): boolean;
  update(now: number, camera: { x; y }, clamp: (x, y) => { x; y }): { x; y }   // 스크롤·흔들림 적용한 카메라
  snapshot(now: number): FxSnapshot;
}
```
  `BitmapCache { constructor(base: string, known: Set<string>); get(name): CanvasImageSource | null (요청 시 로드 시작); load(name): Promise<CanvasImageSource | null> }`.
  `Scene.fx?: FxSnapshot`; `Renderer.draw` 는 `map` 이 없어도 `fx.image`·틴트·페이드를 그린다. 그리기 순서: 맵+스프라이트+텍스트 → (image 가 있으면 전체를 덮음) → tint → fade.

- [ ] **Step 1: 실패하는 테스트**

`web/test/effects.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Effects, FADE_STEP_MS } from '../src/field/effects';

describe('Effects', () => {
  it('fades out to black over step × 30 ms and reports busy until done; step 0 is instant', () => {
    const fx = new Effects();
    fx.fade('out', 8, 1000);
    expect(fx.fadeBusy()).toBe(true);
    expect(fx.snapshot(1000).fade).toEqual({ color: 'black', alpha: 0 });
    expect(fx.snapshot(1000 + 4 * FADE_STEP_MS).fade?.alpha).toBeCloseTo(0.5);
    expect(fx.snapshot(1000 + 8 * FADE_STEP_MS).fade).toEqual({ color: 'black', alpha: 1 });
    fx.snapshot(1000 + 8 * FADE_STEP_MS);
    expect(fx.fadeBusy()).toBe(false);
    fx.fade('in', 0, 2000);
    expect(fx.snapshot(2000).fade).toBeNull();
    expect(fx.fadeBusy()).toBe(false);
  });
  it('showImage with a step fades the image in from black; a missing image still completes its fade', () => {
    const fx = new Effects();
    fx.showImage(null, 4, 0);
    expect(fx.snapshot(0)).toMatchObject({ image: null, fade: { color: 'black', alpha: 1 } });
    expect(fx.snapshot(4 * FADE_STEP_MS).fade).toBeNull();
    expect(fx.fadeBusy()).toBe(false);
    const img = {} as CanvasImageSource;
    fx.showImage(img, 0, 500);
    expect(fx.snapshot(500)).toMatchObject({ image: img, fade: null });
    fx.hideImage();
    expect(fx.snapshot(501).image).toBeNull();
  });
  it('tints map to overlay colours and reset clears them; FLASH_WHITE fades to white', () => {
    const fx = new Effects();
    fx.tint('dim', 1);
    expect(fx.snapshot(0).tint).toEqual({ color: '#000', alpha: 0.4 });
    fx.tint('sunset', 1);
    expect(fx.snapshot(0).tint?.color).toBe('#f80');
    fx.tint('reset', 0);
    expect(fx.snapshot(0).tint).toBeNull();
    fx.tint('white', 4);
    expect(fx.snapshot(0).fade).toEqual({ color: 'white', alpha: 0 });
  });
  it('shake offsets the camera while active; scroll moves the camera toward the target cell and stops there', () => {
    const fx = new Effects();
    const clamp = (x: number, y: number) => ({ x, y });
    fx.shake(6);
    const shaken = fx.update(100, { x: 100, y: 100 }, clamp);
    expect(Math.abs(shaken.x - 100) + Math.abs(shaken.y - 100)).toBeGreaterThan(0);
    fx.shake(0);
    expect(fx.update(200, { x: 100, y: 100 }, clamp)).toEqual({ x: 100, y: 100 });
    fx.startScroll(16, 0, 5, 5, 100, () => ({ x: 480, y: 340 }));    // target cell centre → camera (160, 100) at 640×480
    expect(fx.scrollBusy()).toBe(true);
    let cam = { x: 100, y: 100 };
    for (let t = 300; t <= 1000; t += 100) cam = fx.update(t, cam, clamp);
    expect(cam.x).toBe(160);
    expect(fx.scrollBusy()).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd web && npx vitest run test/effects.test.ts` → 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/field/effects.ts`:
```ts
import { VIEW_H, VIEW_W } from '../iso/grid';
import type { Tint } from '../script/host';

export const FADE_STEP_MS = 30;
export interface FxSnapshot { fade: { color: 'black' | 'white'; alpha: number } | null; tint: { color: string; alpha: number } | null; image: CanvasImageSource | null; shake: { x: number; y: number } }
type Fade = { color: 'black' | 'white'; from: number; to: number; start: number; ms: number };
const TINTS: Partial<Record<Tint, { color: string; alpha: number }>> = {
  dim: { color: '#000', alpha: 0.4 }, sunset: { color: '#f80', alpha: 0.25 }, night: { color: '#024', alpha: 0.45 }, dusk: { color: '#630', alpha: 0.35 },
  black: { color: '#000', alpha: 0.9 }, uiDark: { color: '#000', alpha: 0.3 }, textpal: { color: '#000', alpha: 0.2 }, facepal: { color: '#000', alpha: 0.2 }, uiHalfA: { color: '#fff', alpha: 0.3 }, uiHalfB: { color: '#fff', alpha: 0.3 },
};

/** Palette effects of the original approximated as full-screen overlays, plus camera shake and scripted scrolling. */
export class Effects {
  private fadeState: Fade | null = null;
  private tintState: { color: string; alpha: number } | null = null;
  private image: CanvasImageSource | null = null;
  private shakeAmp = 0;
  private scroll: { dx: number; dy: number; target: { x: number; y: number } | null; ms: number; last: number } | null = null;

  fade(dir: 'in' | 'out', step: number, now: number, color: 'black' | 'white' = 'black'): void {
    const to = dir === 'out' ? 1 : 0, from = this.fadeState ? this.alphaAt(now) : dir === 'out' ? 0 : 1;
    this.fadeState = { color, from, to, start: now, ms: Math.max(step, 0) * FADE_STEP_MS };
  }
  private alphaAt(now: number): number {
    const f = this.fadeState!;
    if (f.ms <= 0) return f.to;
    const t = Math.min(Math.max((now - f.start) / f.ms, 0), 1);
    return f.from + (f.to - f.from) * t;
  }
  fadeBusy(): boolean { return this.fadeState !== null && this.fadeState.ms > 0 && this.lastNow < this.fadeState.start + this.fadeState.ms; }
  private lastNow = 0;

  showImage(img: CanvasImageSource | null, step: number, now: number): void {
    this.image = img;
    if (step > 0) { this.fadeState = { color: 'black', from: 1, to: 0, start: now, ms: step * FADE_STEP_MS }; }
  }
  hideImage(): void { this.image = null; }
  clearScreen(): void { this.image = null; }
  tint(kind: Tint, n: number, pct?: number): void {
    void n;
    if (kind === 'reset') { this.tintState = null; return; }
    if (kind === 'white') { this.fadeState = { color: 'white', from: 0, to: 1, start: this.lastNow, ms: Math.max(n, 0) * FADE_STEP_MS }; return; }
    if (kind === 'dimUi') { this.tintState = { color: '#000', alpha: 1 - Math.min(Math.max(pct ?? 100, 0), 100) / 100 }; return; }
    this.tintState = TINTS[kind] ?? null;
  }
  shake(n: number): void { this.shakeAmp = Math.max(n, 0); }
  startScroll(dx: number, dy: number, tx: number, ty: number, ms: number, cellOf: (c: number, r: number) => { x: number; y: number } | null): void {
    const cell = tx === 0 && ty === 0 ? null : cellOf(tx, ty);
    this.scroll = { dx, dy, target: cell ? { x: cell.x - VIEW_W / 2, y: cell.y - VIEW_H / 2 } : null, ms: Math.max(ms, 1), last: -1 };
  }
  scrollBusy(): boolean { return this.scroll !== null; }

  /** Advance scripted scrolling and apply shake; returns the camera to draw with. */
  update(now: number, camera: { x: number; y: number }, clamp: (x: number, y: number) => { x: number; y: number }): { x: number; y: number } {
    this.lastNow = now;
    let cam = camera;
    const s = this.scroll;
    if (s) {
      if (s.last < 0) s.last = now;
      const ticks = Math.floor((now - s.last) / s.ms);
      if (ticks > 0) {
        s.last += ticks * s.ms;
        let { x, y } = cam;
        for (let k = 0; k < ticks && this.scroll; k++) {
          const nx = x + s.dx, ny = y + s.dy;
          const passedX = s.target ? (s.dx > 0 ? nx >= s.target.x : s.dx < 0 ? nx <= s.target.x : true) : false;
          const passedY = s.target ? (s.dy > 0 ? ny >= s.target.y : s.dy < 0 ? ny <= s.target.y : true) : false;
          if (s.target && passedX && passedY) { x = s.target.x; y = s.target.y; this.scroll = null; }
          else { x = nx; y = ny; }
        }
        cam = clamp(x, y);
        if (this.scroll && !s.target && (cam.x !== x || cam.y !== y)) this.scroll = null;      // hit the map edge
      }
    }
    if (this.shakeAmp > 0) {
      const phase = Math.floor(now / 50);
      cam = { x: cam.x + ((phase & 1) ? this.shakeAmp : -this.shakeAmp), y: cam.y + ((phase & 2) ? this.shakeAmp : -this.shakeAmp) };
    }
    return cam;
  }

  snapshot(now: number): FxSnapshot {
    this.lastNow = now;
    let fade: FxSnapshot['fade'] = null;
    if (this.fadeState) {
      const alpha = this.alphaAt(now);
      if (alpha > 0) fade = { color: this.fadeState.color, alpha: Math.round(alpha * 1000) / 1000 };
      if (!this.fadeBusy() && alpha <= 0) this.fadeState = null;
    }
    return { fade, tint: this.tintState, image: this.image, shake: { x: 0, y: 0 } };
  }
}
```
(테스트의 `shake` 결과 필드는 `update` 가 카메라에 반영하므로 `snapshot.shake` 는 0 으로 둔다 — 테스트는 `update` 만 본다.)

`web/src/assets/bitmaps.ts`:
```ts
/** bmp/*.png as drawable images, loaded on demand; unknown or failed names resolve to null (black screen). */
export class BitmapCache {
  private readonly cache = new Map<string, CanvasImageSource | null>();
  private readonly pending = new Map<string, Promise<CanvasImageSource | null>>();
  constructor(private readonly base: string, private readonly known: Set<string>, private readonly onError: (name: string) => void = () => {}) {}
  get(name: string): CanvasImageSource | null { const key = name.toLowerCase(); if (!this.cache.has(key)) void this.load(key); return this.cache.get(key) ?? null; }
  load(name: string): Promise<CanvasImageSource | null> {
    const key = name.toLowerCase();
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key) ?? null);
    let p = this.pending.get(key);
    if (!p) {
      p = (this.known.has(key) ? new Promise<CanvasImageSource | null>((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => { this.onError(key); resolve(null); }; img.src = `${this.base}/bmp/${key}.png`; }) : Promise.resolve(null))
        .then((img) => { this.cache.set(key, img); this.pending.delete(key); return img; });
      this.pending.set(key, p);
    }
    return p;
  }
}
```

`web/src/render/renderer.ts`: `Scene` 에 `fx?: FxSnapshot` 추가(import type). `draw()`:
```ts
  draw(scene: Scene): void {
    const { ctx } = this;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const map = scene.map;
    if (map) { …기존 맵·스프라이트·텍스트·오버레이 그리기… }
    const fx = scene.fx;
    if (fx?.image) ctx.drawImage(fx.image, 0, 0, VIEW_W, VIEW_H);
    if (fx?.tint) { ctx.globalAlpha = fx.tint.alpha; ctx.fillStyle = fx.tint.color; ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.globalAlpha = 1; }
    if (fx?.fade) { ctx.globalAlpha = fx.fade.alpha; ctx.fillStyle = fx.fade.color === 'white' ? '#fff' : '#000'; ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.globalAlpha = 1; }
  }
```

- [ ] **Step 4: 통과 확인** — `cd web && npx vitest run test/effects.test.ts && npx tsc --noEmit -p .` → PASS 4/4.
- [ ] **Step 5: 커밋** — `git add web/src/field/effects.ts web/src/assets/bitmaps.ts web/src/render/renderer.ts web/test/effects.test.ts && git commit -m "feat(web): screen effects (fade, tint, image, shake, scroll) and bitmap cache"`

---

### Task 2: 표현층 — 스크립트 스프라이트

**Files:**
- Modify: `web/src/field/presenter.ts`
- Test: `web/test/presenterScript.test.ts`

**Interfaces:**
- Produces: `Presenter.sync(state: Pick<BattleState, 'units'>)`, `scene(map, state: Pick<BattleState, 'units' | 'phase'>)`; `Presenter.moveUnit(slot, dirs, base)`(이동 큐에 넣음; `base` 'run'/'walk'/'fly' → `RUN`/`WALK`/`FLY` 우선, 폴백 순서 유지); `Presenter.unitBusy(slot)`; `Presenter.sweat(slot)`(system `F.SWEAT` 1초); 본체 선택 규칙: `u.sprite?.hidden` → 스프라이트 없음; `u.sprite?.apd` → 그 APD 에서 `u.sprite.anim?.name`(있으면) 또는 `F./B.STAND` → 없으면 APD 의 첫 애니; `u.sprite?.layer` 가 레이어; `u.sprite?.offset` 이 더해짐; `u.sprite?.marker` → system `LARGE.M` 레이어 2.
- `anim` 1회(loop false) 재생이 끝나면 마지막 프레임을 유지한다.

- [ ] **Step 1: 실패하는 테스트** (`web/test/presenterScript.test.ts`, 기존 presenter.test 의 `apd/provider/state` 헬퍼를 `web/test/helpers/presenterFixtures.ts` 로 옮겨 공유):
```ts
import { describe, expect, it } from 'vitest';
import { Presenter, STEP_MS } from '../src/field/presenter';
import { apd, mapModel, provider, state, files } from './helpers/presenterFixtures';
import { tables, unit } from './helpers/battleFixtures';

const npc = apd({ 'F.EVENT01': 'S100 P0 P0 P0', 'F.STAND': 'P0', 'F.SET': 'P0' });
files.npc_02 = npc;

describe('Presenter: script sprites', () => {
  it('a unit with sprite.apd draws from that APD and plays sprite.anim; hidden units draw nothing', () => {
    const s = state();
    s.units[20] = unit({ slot: 20, id: 15, side: 1, c: 4, r: 4, race: 7, sprite: { apd: 'npc_02', layer: 3, anim: { name: 'f.event01', loop: false, force: true } } });
    const p = new Presenter(provider, tables());
    p.sync(s);
    const body = () => p.scene(mapModel(s), s).sprites.find((sp) => sp.c === 4 && sp.r === 4);
    expect(body()).toMatchObject({ model: npc, layer: 3 });
    expect(body()!.player.timeline.name).toBe('F.EVENT01');
    s.units[20]!.sprite!.hidden = true; p.sync(s);
    expect(body()).toBeUndefined();
  });
  it('moveUnit walks the unit with the scripted base anim and unitBusy is true until it arrives', () => {
    const s = state();
    const p = new Presenter(provider, tables());
    p.sync(s);
    s.units[0]!.c = 4; s.units[0]!.moved = true;
    p.moveUnit(0, [1, 1], 'walk');
    expect(p.unitBusy(0)).toBe(true);
    p.update(0); p.update(STEP_MS / 2);
    expect(p.scene(mapModel(s), s).sprites.find((sp) => sp.layer === 4 && sp.model !== undefined && sp.c === 2)!.player.timeline.name).toBe('F.WALK1');
    p.update(STEP_MS * 2 + 1); p.update(STEP_MS * 2 + 2);
    expect(p.unitBusy(0)).toBe(false);
  });
  it('a marker draws LARGE.M under the unit and sweat shows F.SWEAT above it for a moment', () => {
    const s = state();
    s.units[0]!.sprite = { marker: true };
    const p = new Presenter(provider, tables());
    p.sync(s);
    expect(p.scene(mapModel(s), s).sprites.filter((sp) => sp.c === 2 && sp.r === 4 && sp.layer === 2)).toHaveLength(2);   // shadow + marker
    p.sweat(0);
    p.update(0); p.update(10);
    expect(p.scene(mapModel(s), s).sprites.some((sp) => sp.player.timeline.name === 'F.SWEAT')).toBe(true);
  });
});
```
(`system` 픽스처에 `'F.SWEAT': 'S100 P0 P0'` 추가; `hero`(a-file) 는 그대로, `heroB` 에 `F.WALK1` 이미 있음.)

- [ ] **Step 2: 실패 확인** → `npx vitest run test/presenterScript.test.ts`.

- [ ] **Step 3: 구현** (`presenter.ts`)
- `sync(state: { units: (Unit | null)[] })`, `scene(map, state: { units; phase })` 로 시그니처 축소(`BattleState` import 는 타입만).
- `Item` 의 `move` 에 `base: string` 추가; `moveUnit(slot, dirs, base)`: `this.queue.push(step({ kind: 'move', slot, path: dirs, from: null, step: 0, base }))`; `stepsFor('moved')` 는 `base: 'RUN'`. `runSprite(u, prefix, flipH, step, base)`: 후보 순서 `[base, 'RUN', 'WALK', 'FLY']` 중복 제거.
- `unitBusy(slot)`: `this.queue.some((s) => s.items.some((it) => ('slot' in it) && it.slot === slot))`.
- `sweat(slot)`: `this.queue.push(step({ kind: 'anim', slot: -1, name: `system:F.SWEAT:${v.c},${v.r}`, ms: 0, model: null, player: null }))` — 유닛 좌표는 enqueue 시점의 visual 로.
- `scene()` 본체 선택: 
```ts
      if (u.sprite?.hidden) continue;
      const override = u.sprite?.apd ? this.provider.apd(u.sprite.apd) : null;
      const model = override ?? this.provider.apd(bodyApd(u.race));
      …
      if (override) {
        const name = u.sprite?.anim?.name;
        const tl = (name ? pickTimeline(override, name.toUpperCase()) : undefined) ?? pickTimeline(override, `${prefix}STAND`) ?? (override.animNames()[0] ? override.anim(override.animNames()[0]!) : undefined);
        if (tl) playing = { model: override, player: this.player(`${u.slot}:${tl.name}:${flipH}:${u.sprite?.anim?.loop ?? true}`, tl, u.sprite?.anim?.loop ?? true, flipH) };
      } else if (u.sprite?.anim) { const tl = pickTimeline(model, u.sprite.anim.name.toUpperCase()); if (tl) playing = { model, player: this.player(`${u.slot}:${tl.name}:${flipH}:${u.sprite.anim.loop}`, tl, u.sprite.anim.loop, flipH) }; }
```
  (기존 override/move/idle 순서는 그대로; 위 블록은 `playing` 이 아직 없을 때 idle 보다 먼저.) 레이어 `u.sprite?.layer ?? (u.side === 7 ? LAYER.object : LAYER.unit)`, 오프셋 `{ x: v.offset.x + (u.sprite?.offset?.x ?? 0), y: v.offset.y + (u.sprite?.offset?.y ?? 0) }`. 마커: `if (u.sprite?.marker && system) { const tl = pickTimeline(system, 'LARGE.M'); if (tl) sprites.push({ model: system, player: this.player('marker', tl, true), c: v.c, r: v.r, layer: LAYER.shadow }); }`.
- 애니 이름은 APD 가 대문자로 저장하므로 `toUpperCase()`; `anim()` 은 이미 대소문자 무시.

- [ ] **Step 4: 통과 확인** — `cd web && npm run check`.
- [ ] **Step 5: 커밋** — `git commit -m "feat(web): presenter plays script sprites (APD override, anim, hidden, offset, layer, marker, sweat) and scripted walks"`

---

### Task 3: 전투 입력 분리와 GameCore

**Files:**
- Create: `web/src/game/battleInput.ts`, `web/src/game/gameCore.ts`
- Modify: `web/src/game/main.ts` (battleInput 사용)
- Test: `web/test/battleInput.test.ts`, `web/test/gameCore.test.ts`

**Interfaces:**
- `cellCommand(state: BattleState, cell: [number, number]): Command | null` — `game/main.ts` 의 `onClick` 분기 그대로.
- `Stage` (DOM 없는 표현 계약):
```ts
export interface Stage {
  presenter: Presenter; effects: Effects;
  loadMap(n: number): Promise<void>; mapReady(): boolean; cellOf(c: number, r: number): { x: number; y: number } | null;
  camera: { x: number; y: number }; clampCamera(x: number, y: number): { x: number; y: number };
  dialogue: { openWindow(where, speaker, face): void; closeWindow(where): void; text(where, line, name): void; openModal(kind, payload): void; takeModalResult(): number | null; closeAll(): void };
  bitmap(name: string): CanvasImageSource | null;
  town: { show(set: 1 | 2 | 3, extra: boolean, flags: number[]): void; hide(): void };
  takeClick(): boolean;
  log(kind: 'warn' | 'info', text: string): void;
}
```
- `GameCore`:
```ts
export type Mode = 'title' | 'script' | 'town' | 'battle' | 'ended';
export class GameCore implements Host {
  readonly campaign: Campaign; readonly vm: ScriptVm; battle: Battle | null; mode: Mode; result: 'victory' | 'defeat' | null;
  constructor(res: Resources, stage: Stage, tables: Tables, rng: RandomSource);
  newGame(): void;                      // campaign = newCampaign(); vm.run(0, 'begin'); mode 'script'
  frame(now: number): void;             // 모드별 한 프레임
  dispatch(cmd: Command): void;         // 전투 입력(패널·셀) → Battle.reduce + 훅
  townSelect(i: number): void;          // 핫스팟 i 클릭
  events: BattleEvent[]                 // 마지막 전투 이벤트(패널 로그용)
}
export class FakeStage implements Stage { … 호출 기록, mapReady true, dialogue 기록 + modal 결과 큐 … }
```
- Host 구현 규칙: `fade/showImage/tint/shake/cameraScroll` → `stage.effects`; `camera*` → `stage.camera`; `openWindow/text/openModal/modalResult` → `stage.dialogue`; `anim/moveUnit/marker/sweat/unitBusy/appear/vanish/setVisible/showOnly/allVisible/resetSprites/unitsChanged` → `presenter`(sync 로 반영); `loadMap(n)` → `stage.loadMap(n)` 비동기, `mapBusy` → `!stage.mapReady()`; `enterBattle` → `pendingBattle = true`; `enterTown` → `mode = 'town'` + `stage.town.show`; `fieldMode` → restore 'battle'; `scriptEnded(restore)` → 'battle' 이면 전투 생성/복귀, 'town' 이면 마을, 'previous' 이면 이전 모드(전투 중이었으면 전투); `music/sound/playVisual/save/writeCompleteFlag` → `stage.log('info', …)`; `quitComplete` → mode 'ended'.
- 전투 생성(`startBattle()`): `placeUnplacedParty(units, grid)`; `new Battle({ entry, map, grid, units: campaign.units, turn: 1, phase idle, rng, lastPath: [], inventory: campaign.inventory }, tables)`; entry = `{ event: campaign.stage, label: 'script', map: `stage${mapNo}`, roster: rosterNo, episode: campaign.episode, objective: '', heal: false }`(mapNo·rosterNo 는 마지막 LOAD_MAP/LOAD_UNITS 값을 GameCore 가 기억).

- [ ] **Step 1: 실패하는 테스트**

`web/test/battleInput.test.ts`: 기존 `onClick` 의 다섯 분기를 각각 한 번씩(idle → select, menu 다른 유닛 → select, move → move, target → act, face → face dir 계산; 적 유닛 클릭은 null).

`web/test/gameCore.test.ts`:
```ts
describe('GameCore', () => {
  it('newGame runs EVENT00 begin in script mode and SHOW_IMAGE/fade/text reach the stage', () => { … prog(0, ['begin', ['SHOW_IMAGE', 'vop99', 0], ['MSG_BOTTOM', [1, 'b']], ['TEXT', '아프다'], ['WAIT_CLICK', 0], ['END']]) … frame(0) → stage.calls contains ['showImage','vop99'], dialogue text; frame(1) still script (waiting); stage.clicks = 1; frame(2) → mode 'title'? → END with restore 'previous' and no battle/town → mode 'ended'?? });
```
  규칙: `scriptEnded('previous')` 이고 이전 모드가 없으면(새 게임 직후) 모드는 `'title'` 이 아니라 `'ended'`(스크립트가 끝났는데 갈 곳이 없음 → 로그 경고). 테스트는 이 경고를 확인한다.
```ts
  it('TOWN switches to town mode and a hotspot click runs the label from the stage file, else EVENT00', () => { … stage 1 program has 'inn'; stage 0 has 'guild' … townSelect(1) → mode script, vm program stage 1; after END (restore previous = town) → mode town; townSelect(2) → EVENT00 guild; inactive flag → nothing });
  it('LOAD_MAP waits for the stage; BATTLE_START after END creates a Battle over the campaign units and inventory', () => { … stage.ready = false → frame waiting; ready → … END → core.battle!.state.units === core.campaign.units; inventory same object; mode 'battle' });
});
```

- [ ] **Step 2: 실패 확인**, **Step 3: 구현** (gameCore.ts ~250줄: Host 메서드들은 한 줄씩 위임; `frame(now)`: `script` → `vm.step(now)`; `battle` → 기존 main.ts `frame` 의 전투 부분(presenter.update/sync, enemyStep, end → result, 포커스 카메라) + 훅 큐(Task 4); `town` → 없음(Stage 가 그림); 매 프레임 `stage.presenter.update(now)`), `main.ts` 는 `cellCommand` 를 import 해 `onClick` 을 대체.

- [ ] **Step 4: 통과 확인** — `npm run check`. **Step 5: 커밋** — `"feat(web): GameCore mode machine implementing the script Host over a Stage; shared battle input mapping"`

---

### Task 4: 전투 훅

**Files:**
- Modify: `web/src/game/gameCore.ts`
- Test: `web/test/gameHooks.test.ts`

**Interfaces:**
- `GameCore.dispatch(cmd)`: `act` 명령 전에 `battle%02d`(대상 id, 대상이 적이 아니면 행동 유닛 id) 라벨이 stage 파일에 있으면 `pendingAct = cmd` 로 보류하고 스크립트 실행; `END_RESUME` → `resumeBattle()` 이 보류 명령을 수행. 그 외 명령은 바로 `battle.reduce`.
- 이벤트 처리(`afterEvents(events)`): `action` → 훅 큐에 대상마다 `{ kind: 'target', slot, actor }`; `levelUp` → `{ kind: 'levelup', actor }`; `end` → `{ kind: 'end', result }`. 표현 큐가 비면(`!presenter.busy`) 훅 큐를 하나씩 처리: `target` → `campaign.battleTarget = slot`, `campaign.actor = actor`; 라벨 선택 story_flow §5(BEAT/AFTER/ASSIST, 그 다음 WIN) — 라벨이 있으면 `vm.run(stage, label)`, 모드 `script`, 끝나면(`scriptEnded('previous')`) 전투로 복귀하고 다음 훅. `levelup` → `levelup%02d` in EVENT00. `end` → `GAMEOVER`(EVENT00) / `COMPLETE`(stage); 없으면 `result` 를 두고 전투 모드 유지(결과 패널).
- 스크립트에서 돌아올 때 `battle.state.phase` 가 player 면 선택을 idle 로.

- [ ] **Step 1: 실패하는 테스트** (`gameHooks.test.ts`, FakeStage + 합성 프로그램 + 9×9 flatMap 로스터):
```ts
  it('BEAT and WIN labels run after a killing blow, in that order, with id 24 bound to the target', …)   // stage program: 'BEAT08' sets FLAG 1=1 and TEST_ACTIVE 24; 'WIN01' FLAG 2=1
  it('a hook script returns to the battle with an idle selection', …)
  it('levelup%02d runs from EVENT00 after a level up', …)
  it('victory runs COMPLETE from the stage file; defeat runs GAMEOVER from EVENT00', …)
  it('victory without a COMPLETE label shows the result and stays', …)
  it('battle%02d runs before the action and END_RESUME performs it', …)
```

- [ ] **Step 2–4: RED → 구현 → `npm run check`.** **Step 5: 커밋** — `"feat(web): battle script hooks (battle/BEAT/AFTER/ASSIST/WIN/levelup/COMPLETE/GAMEOVER)"`

---

### Task 5: 마을 화면

**Files:**
- Create: `web/src/town/town.ts`
- Modify: `web/src/game/gameCore.ts` (townSelect 가 `townLabel` 사용), `web/src/game/browserStage.ts`(Task 6 에서 그리기)
- Test: `web/test/town.test.ts`

**Interfaces:**
```ts
export interface Hotspot { label: string; name: string; click: [number, number, number, number]; highlight: [number, number, number, number] }
export const HOTSPOTS: Hotspot[]  // story_flow.md §3.2 의 15개
export function hitTest(x: number, y: number, flags: number[]): number | null   // 활성(flags[i] != 0) 핫스팟 중 첫 적중
export function townLayers(set: 1 | 2 | 3, extra: boolean): string[]           // ['town00','town01','town02','town03'(,'town04')]
export function layerFrame(layer: 1 | 2 | 4, now: number): { sx: number; sy: number; w: number; h: number; dx: number; dy: number }   // §3.1 프레임 규칙, 200 ms
export function townLabel(res: Resources, stage: number, i: number): { stage: number; label: string } | null   // stage 파일 → EVENT00
```

- [ ] **Step 1: 실패하는 테스트** — 핫스팟 15개, `hitTest(600, 30, flags)` → 0(outfield) 활성일 때만; `townLayers(2, true)` → `['town10','town11','town12','town13','town14']`; `layerFrame(1, 0)` → (0,0,112,64 → 528,0), `layerFrame(1, 600)` → k=1: (0, 64…)… `(k/3)*112, (k%3)*64`; `layerFrame(4, 2200)` 핑퐁 j = 5−|11−5| = 1…; `townLabel` 이 stage 파일에 없으면 EVENT00, 둘 다 없으면 null.
- [ ] **Step 2–4: RED → 구현 → check.** **Step 5: 커밋** — `"feat(web): town screen model (hotspots, layer frames, label lookup)"`

---

### Task 6: 대화 UI 와 BrowserStage

**Files:**
- Create: `web/src/ui/dialogue.ts`, `web/src/game/browserStage.ts`
- Test: `web/test/dialogue.test.ts`

**Interfaces:**
- `parseTextTags(line: string): { text: string; size: number | null; color: number | null }[]` (`[Snn]`, `[Cnn]` 분리).
- `Dialogue(doc, root)`: `openWindow(where, speaker, face, faceSrc: string | null)`, `closeWindow`, `text(where, line, name)`, `openModal(kind, payload, ctx: { tables, inventory, party, buy })`, `takeModalResult()`, `closeAll()`, `takeClick()`(오버레이 클릭 1회 소비). 모달: message(닫기), ask(예/아니오 → 1/0), shop(목록·구매·닫기 → 1), result(골드·레벨업·닫기), episode(제목 표시, 클릭으로 닫기), save("세이브는 다음 단계" 닫기 → −1).
- `BrowserStage(canvas, renderer, assets, bitmaps, dialogue, tables)` implements `Stage`: 캔버스 클릭 → `takeClick`; 마을 모드에서는 `town.show` 가 레이어를 그리고 마우스 이동으로 하이라이트, 클릭 → `onTownClick(i)` 콜백; `loadMap(n)` 은 `assets.map(`stage${nn}`)` + 레이어 PNG → `MapModel` + `renderer.prepareMap`.

- [ ] **Step 1: 실패하는 테스트**(`dialogue.test.ts`, fakeDom 확장: `className`, `style`, `appendChild`, `remove()`): 태그 파싱; 창 열고 두 줄 쓰면 두 줄 노드; `takeClick` 은 클릭당 1(연타 2 → 두 번째 호출까지 true, 세 번째 false — Review Focus 4); ask 모달 예 → 1.
- [ ] **Step 2–4: RED → 구현 → check.** **Step 5: 커밋** — `"feat(web): dialogue overlay (windows, modals, shop) and BrowserStage"`

---

### Task 7: 플레이 페이지와 문서

**Files:**
- Create: `web/play.html`, `web/src/play/main.ts`
- Modify: `docs/manual.md`(§7 "이야기 모드" 신설: 새 게임, 대화 조작, 마을, 상점, 스텁 안내), `README.md`(빠른 시작에 play.html), 스펙 상태.

- [ ] **Step 1: 페이지** — `play.html`: 타이틀 레이어(`<div id="title">` 배경 `bmp/title.png`, 버튼 "새 게임", 링크 "전투 테스트"), 캔버스, 전투 패널(game.html 과 같은 id 들), 대화 오버레이 `<div id="dialogue">`, 로그. `src/play/main.ts`: boot — index → tables → `index.events` 전부 `data.event(n)` → 로스터는 프로그램의 `LOAD_UNITS` 인자를 모아 미리 로드 → `Resources` → `BrowserStage` → `GameCore`; 새 게임 버튼 → `core.newGame()`; `requestAnimationFrame` 루프 → `core.frame(now)` → 패널 `update`/`logEvents`; 디버그 훅 `window.__ft2 = () => ({ core, campaign, vm, battle, stage })`.
- [ ] **Step 2: 브라우저 점검** — `http://localhost:5173/play.html`: 새 게임 → 로고 3장(각 4초) → 오프닝 대사(클릭 진행) → 마을 배경(Town00) → 길드 클릭 → 대사 → … 첫 전투 시작(맵 49, 슬라임) → 승리 → COMPLETE 스크립트 → 마을. 콘솔 오류 0. 사용자의 Chrome 탭을 직접 조작하지 말고 새 탭에서 확인하거나 `__ft2()` 로 읽는다.
- [ ] **Step 3: 문서, `npm run check`, 커밋** — `"feat(web): play page — new game runs the story (opening, town, battles) through the script VM"`
