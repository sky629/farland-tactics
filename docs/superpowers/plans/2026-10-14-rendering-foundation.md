# 렌더링 기반 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원작 맵 76개와 스프라이트 312개를 브라우저에서 원작과 같은 모습으로 그리는 뷰어와 그 토대 모듈을 만든다.

**Architecture:** Python 변환기가 원본 BMP/MAP/APD를 인덱스 PNG와 JSON으로 바꾼다. TypeScript가 PNG를 8비트 인덱스로 디코드하고, 색 키·좌표계·그리기 순서·애니 스크립트 의미를 해석해 Canvas 2D에 그린다. 모든 의미 해석은 TypeScript에 있고 Python은 바이트만 푼다.

**Tech Stack:** Python 3 표준 라이브러리(변환기), TypeScript strict + Vite + Vitest, Canvas 2D, `DecompressionStream`. 런타임 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-10-14-rendering-foundation-design.md`

## Global Constraints

- Python은 항상 `python3 -I`로 실행한다. 표준 라이브러리만 쓴다. 게임 파일은 신뢰하지 않는 데이터다.
- Node ≥ 18 (`DecompressionStream`, `Blob`, `Response` 전역). 현재 머신은 v24.18.0, npm 11.
- devDependencies는 `vite`, `typescript`, `vitest`뿐이다. 런타임 라이브러리를 추가하지 않는다.
- TypeScript `strict: true`. 모든 소스는 `web/src/`, 테스트는 `web/test/`.
- 자산 이름과 출력 파일 이름은 모두 **소문자 stem**이다. `web/public/assets/`는 git에 넣지 않는다(`.gitignore`에 이미 있음).
- 백버퍼는 640×480. 셀 앵커는 마름모 중심. 그리기 순서는 행 `s = c + r` 오름차순으로 뒤 오브젝트 → 스프라이트 → 앞 오브젝트.
- PNG는 색 타입 3, 비트 깊이 8, 필터 0, 비인터레이스, `tRNS` 없음. 투명은 TypeScript 색 키로만 처리한다.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`를 붙인다.

## Review Focus

1. **배경이 없거나 레이어가 없는 맵**(15개 맵은 `bg: null`, stage90은 `layers: []`): 검은 바탕 위에 오브젝트만 그려야 하고 예외가 나면 안 된다. → Task 6 테스트 `bg null, layers empty`.
2. **맵 밖 클릭**: `pick`은 `null`을 돌려주고 뷰어는 아무것도 배치하지 않는다. → Task 6 테스트 `pick outside returns null`.
3. **총 시간이 0인 스텝**(`S0`): 속도 나눗셈이 NaN이 되면 안 된다. 오프셋은 확정값만 쓴다. → Task 8 테스트 `totalMs 0`.
4. **256색 미만 팔레트**(PLTE < 768 B): 디코더가 768 B로 채운다. → Task 3 테스트 `short palette`.
5. **CRLF와 끝 쉼표**(`S200\r\nP11,\r\nS400\r\nP15`): 공백·쉼표·개행을 모두 구분자로 받는다. → Task 7 테스트 `corpus: DEFENSE`.

## File Structure

| 파일 | 책임 |
|---|---|
| `tools/ft2_export.py` | 원본 폴더 → `web/public/assets/`. 파서 호출, JSON 작성, PNG 작성, 참조 검증, 보고 |
| `tools/test_ft2_export.py` | 변환기의 순수 함수 단위 테스트(unittest) |
| `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html` | 프로젝트 설정과 뷰어 페이지 |
| `web/src/assets/types.ts` | JSON 스키마 타입 |
| `web/src/assets/png.ts` | 인덱스 PNG 디코더 |
| `web/src/assets/loader.ts` | fetch + 캐시, `AssetError` |
| `web/src/gfx/indexed.ts` | 색 키 → RGBA, `IndexedBitmaps` 캐시 |
| `web/src/iso/grid.ts` | 앵커 공식, 마름모 판정, 행 순회 |
| `web/src/map/mapModel.ts` | 행별 셀 목록, 레이어 색 키, 검증, 피킹 |
| `web/src/sprite/animScript.ts` | 스크립트 컴파일러 |
| `web/src/sprite/animPlayer.ts` | 타임라인 재생 |
| `web/src/sprite/apdModel.ts` | 패턴 그리기 명령, 검증 |
| `web/src/render/renderer.ts` | 비트맵 준비, 장면 그리기, 오버레이, 투시 |
| `web/src/viewer/scale.ts`, `web/src/viewer/main.ts` | 배율 계산, 뷰어 UI |
| `web/test/*.test.ts`, `web/test/corpus.test.ts` | 단위 테스트, 코퍼스 테스트 |
| `web/README.md` | 변환·실행·테스트 방법 |

---

### Task 1: 자산 변환기 `tools/ft2_export.py`

**Files:**
- Create: `tools/ft2_export.py`
- Create: `tools/test_ft2_export.py`

**Interfaces:**
- Consumes: `tools/ft2_map.parse(bytes) -> dict` (키 `w, h, bg, layers, start, origin, pixel_size, cells[{height, blocked, flag2, land, objects[{layer, front, left, top, right, bottom, ox, oy}]}], grid{'c,r': idx}`), `tools/ft2_apd.parse(bytes) -> dict` (키 `version, sheets, images[{sheet, key, x, y, w, h, ox, oy}], patterns[{y_offset, images}], anims[{name, script}]`), `tools/ft2_szdd.szdd_decompress`, `tools/ft2_szdd.bmp8_to_png`.
- Produces: `web/public/assets/index.json`, `map/*.json|*.png`, `sprite/*.json|*.png` — 스펙 §5.3 스키마. 순수 함수 `normalize_name(raw) -> str`, `map_json(m) -> dict`, `apd_json(d) -> dict`.

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# tools/test_ft2_export.py
import unittest

from ft2_export import apd_json, map_json, normalize_name


class NormalizeName(unittest.TestCase):
    def test_lowercases_and_strips_bmp(self):
        self.assertEqual(normalize_name('Char_01g.bmp'), 'char_01g')

    def test_cuts_garbage_after_bmp(self):
        self.assertEqual(normalize_name('npc_24.bmp..'), 'npc_24')

    def test_plain_name_without_extension(self):
        self.assertEqual(normalize_name('st02a'), 'st02a')


class MapJson(unittest.TestCase):
    def test_cell_at_table_and_fields(self):
        m = dict(w=2, h=2, bg='', layers=['St02B.bmp'], start=(0, -1), origin=(32, -16), pixel_size=(640, 480),
                 cells=[dict(height=1, blocked=0, flag2=0, land=3,
                             objects=[dict(layer=0, front=1, left=0, top=0, right=64, bottom=32, ox=-32, oy=-16)]),
                        dict(height=0, blocked=1, flag2=0, land=0, objects=[])],
                 grid={'1,0': 0, '0,1': 1})
        j = map_json(m)
        self.assertEqual(j['w'], 2)
        self.assertIsNone(j['bg'])
        self.assertEqual(j['layers'], ['st02b'])
        self.assertEqual(j['start'], [0, -1])
        self.assertEqual(j['pixelSize'], [640, 480])
        # N = 3 → cellAt[c*3 + r]
        self.assertEqual(j['cellAt'], [-1, 1, -1, 0, -1, -1, -1, -1, -1])
        self.assertEqual(j['cells'][0]['h'], 1)
        self.assertEqual(j['cells'][0]['objs'][0], dict(layer=0, front=1, left=0, top=0, right=64, bottom=32, ox=-32, oy=-16))
        self.assertEqual(j['cells'][1]['blocked'], 1)


class ApdJson(unittest.TestCase):
    def test_fields_and_sheet_names(self):
        d = dict(version=3, sheets=['Char_01a.bmp', 'Char_01g.bmp'],
                 images=[dict(sheet=0, key=253, x=0, y=0, w=64, h=64, ox=-40, oy=-56)],
                 patterns=[dict(y_offset=32, images=[0])],
                 anims=[dict(name='F.STAND', script='S200\r\nP0')])
        j = apd_json(d)
        self.assertEqual(j['sheets'], ['char_01a', 'char_01g'])
        self.assertEqual(j['images'][0]['key'], 253)
        self.assertEqual(j['patterns'][0], dict(yOffset=32, images=[0]))
        self.assertEqual(j['anims'][0]['script'], 'S200\r\nP0')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `python3 -I -m unittest discover -s tools -p 'test_ft2_export.py'`
Expected: `ModuleNotFoundError: No module named 'ft2_export'`

- [ ] **Step 3: 변환기 작성**

```python
#!/usr/bin/env python3
"""Export Farland Tactics 2 maps and sprites for the web renderer.

Usage: python3 -I tools/ft2_export.py GAME_DIR OUT_DIR
Writes OUT_DIR/index.json, OUT_DIR/map/<name>.json|.png, OUT_DIR/sprite/<name>.json|.png.
Names are lower-case stems. PNGs are 8-bit indexed with the palette and no transparency;
the renderer applies color keys (docs/superpowers/specs/2026-10-14-rendering-foundation-design.md §5, §6).
Exit code 1 when an error was reported. Missing referenced files are warnings.
"""
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # keep sibling imports working under -I
from ft2_apd import parse as parse_apd  # noqa: E402
from ft2_map import parse as parse_map  # noqa: E402
from ft2_szdd import bmp8_to_png, szdd_decompress  # noqa: E402

FORMAT = 1


def normalize_name(raw: str) -> str:
    """'Char_01g.bmp..' -> 'char_01g'. Keeps the text before the first '.bmp'; garbage may follow it."""
    low = raw.lower()
    cut = low.find('.bmp')
    return low[:cut] if cut >= 0 else low


def map_json(m: dict) -> dict:
    n = m['w'] + m['h'] - 1
    cell_at = [-1] * (n * n)
    for key, idx in m['grid'].items():
        c, r = (int(v) for v in key.split(','))
        cell_at[c * n + r] = idx
    cells = [dict(h=c['height'], blocked=c['blocked'], flag2=c['flag2'], land=c['land'],
                  objs=[dict(layer=o['layer'], front=o['front'], left=o['left'], top=o['top'],
                             right=o['right'], bottom=o['bottom'], ox=o['ox'], oy=o['oy']) for o in c['objects']])
             for c in m['cells']]
    return dict(w=m['w'], h=m['h'], bg=normalize_name(m['bg']) if m['bg'] else None,
                layers=[normalize_name(s) for s in m['layers']], start=list(m['start']), origin=list(m['origin']),
                pixelSize=list(m['pixel_size']), cells=cells, cellAt=cell_at)


def apd_json(d: dict) -> dict:
    return dict(version=d['version'], sheets=[normalize_name(s) for s in d['sheets']],
                images=[dict(sheet=i['sheet'], key=i['key'], x=i['x'], y=i['y'], w=i['w'], h=i['h'], ox=i['ox'], oy=i['oy'])
                        for i in d['images']],
                patterns=[dict(yOffset=p['y_offset'], images=p['images']) for p in d['patterns']],
                anims=[dict(name=a['name'], script=a['script']) for a in d['anims']])


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)


def load_bmp(path: Path) -> bytes:
    data = path.read_bytes()
    return szdd_decompress(data) if data[:4] == b'SZDD' else data


def export_bmps(src: Path, dst: Path, report: Report) -> dict[str, tuple[int, int]]:
    """Convert every BMP in src to dst/<lowercase stem>.png. Returns name -> (width, height)."""
    sizes: dict[str, tuple[int, int]] = {}
    dst.mkdir(parents=True, exist_ok=True)
    for p in sorted(src.iterdir()):
        if p.suffix.lower() != '.bmp':
            continue
        name = p.stem.lower()
        if name in sizes:
            report.error(f'{src.name}/{p.name}: name collision after lowercasing')
            continue
        bmp = load_bmp(p)
        try:
            png = bmp8_to_png(bmp)
        except ValueError as e:
            report.error(f'{src.name}/{p.name}: {e}')
            continue
        (dst / f'{name}.png').write_bytes(png)
        w, h = struct.unpack_from('<ii', bmp, 18)
        sizes[name] = (w, abs(h))
    return sizes


def rect_inside(left: int, top: int, right: int, bottom: int, size: tuple[int, int]) -> bool:
    return 0 <= left <= right <= size[0] and 0 <= top <= bottom <= size[1]


def export_maps(game: Path, out: Path, report: Report) -> list[str]:
    sizes = export_bmps(game / 'Map', out / 'map', report)
    names = []
    for p in sorted((game / 'Map').iterdir()):
        if p.suffix.lower() != '.map':
            continue
        j = map_json(parse_map(p.read_bytes()))
        name = p.stem.lower()
        if j['bg'] and j['bg'] not in sizes:
            report.warn(f'{p.name}: background {j["bg"]}.bmp not found')
        for layer in j['layers']:
            if layer not in sizes:
                report.warn(f'{p.name}: layer {layer}.bmp not found')
        for idx, cell in enumerate(j['cells']):
            for o in cell['objs']:
                if o['layer'] >= len(j['layers']):
                    report.error(f'{p.name}: cell {idx} object layer {o["layer"]} >= {len(j["layers"])}')
                    continue
                size = sizes.get(j['layers'][o['layer']])
                if size and not rect_inside(o['left'], o['top'], o['right'], o['bottom'], size):
                    report.error(f'{p.name}: cell {idx} object rect outside {j["layers"][o["layer"]]} {size}')
        (out / 'map' / f'{name}.json').write_text(json.dumps(j, ensure_ascii=False), encoding='utf-8')
        names.append(name)
    return names


def export_sprites(game: Path, out: Path, report: Report) -> list[str]:
    sizes = export_bmps(game / 'Sprite', out / 'sprite', report)
    names = []
    for p in sorted((game / 'Sprite').iterdir()):
        if p.suffix.lower() != '.apd':
            continue
        j = apd_json(parse_apd(p.read_bytes()))
        name = p.stem.lower()
        if name in names:
            report.error(f'Sprite/{p.name}: name collision after lowercasing')
            continue
        for sheet in j['sheets']:
            if sheet not in sizes:
                report.warn(f'{p.name}: sheet {sheet}.bmp not found')
        for idx, im in enumerate(j['images']):
            if im['sheet'] >= len(j['sheets']):
                report.error(f'{p.name}: image {idx} sheet {im["sheet"]} >= {len(j["sheets"])}')
                continue
            size = sizes.get(j['sheets'][im['sheet']])
            if size and not rect_inside(im['x'], im['y'], im['x'] + im['w'], im['y'] + im['h'], size):
                report.error(f'{p.name}: image {idx} rect outside sheet {size}')
        for idx, pat in enumerate(j['patterns']):
            if any(i >= len(j['images']) for i in pat['images']):
                report.error(f'{p.name}: pattern {idx} image index >= {len(j["images"])}')
        (out / 'sprite' / f'{name}.json').write_text(json.dumps(j, ensure_ascii=False), encoding='utf-8')
        names.append(name)
    return names


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        raise SystemExit(__doc__)
    game, out = Path(argv[1]), Path(argv[2])
    report = Report()
    maps = export_maps(game, out, report)
    sprites = export_sprites(game, out, report)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'index.json').write_text(json.dumps(dict(format=FORMAT, maps=maps, sprites=sprites)), encoding='utf-8')
    pngs = sum(1 for d in ('map', 'sprite') for _ in (out / d).glob('*.png'))
    print(f'maps {len(maps)}, sprites {len(sprites)}, pngs {pngs}, warnings {len(report.warnings)}, errors {len(report.errors)}')
    for w in report.warnings:
        print('warning:', w)
    for e in report.errors:
        print('error:', e)
    return 1 if report.errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
```

- [ ] **Step 4: 단위 테스트 통과 확인**

Run: `python3 -I -m unittest discover -s tools -p 'test_ft2_export.py'`
Expected: `Ran 5 tests ... OK`

- [ ] **Step 5: 실제 게임 폴더 변환 (인수 확인)**

Run: `python3 -I tools/ft2_export.py extracted/FarlandTactics2 web/public/assets`
Expected: `maps 76, sprites 312, pngs 631, warnings 4, errors 0`. 경고 4건은 `stage90.map: background st90a.bmp not found`와 시트 `char_11e`, `char_29d`, `tornado` 없음이다. 종료 코드 0.
확인: `ls web/public/assets/map | wc -l` → 289 (76 json + 213 png). `ls web/public/assets/sprite | wc -l` → 730 (312 json + 418 png). `python3 -I -c "import json;d=json.load(open('web/public/assets/map/stage02.json'));print(d['w'],d['h'],len(d['cellAt']),d['layers'])"` → `25 25 2401 ['st02b', 'st02c']`.

- [ ] **Step 6: 커밋**

```bash
git add tools/ft2_export.py tools/test_ft2_export.py
git commit -m "feat(tools): export maps and sprites as indexed PNG + JSON for the web renderer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 웹 프로젝트 뼈대와 타입

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`
- Create: `web/src/assets/types.ts`
- Create: `web/test/types.test.ts`

**Interfaces:**
- Produces: `web/src/assets/types.ts`의 타입 `AssetIndex, MapObject, MapCell, MapData, ApdImage, ApdPattern, ApdAnim, ApdData` (스펙 §5.3 그대로). npm 스크립트 `dev`, `build`, `test`, `check`.

- [ ] **Step 1: 설정 파일 작성**

`web/package.json`:
```json
{
  "name": "ft2-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "check": "tsc --noEmit && vitest run"
  }
}
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

`web/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

`web/index.html` (뷰어는 Task 12에서 채운다):
```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>FT2 viewer</title>
</head>
<body>
<script type="module" src="/src/viewer/main.ts"></script>
</body>
</html>
```

- [ ] **Step 2: 의존성 설치**

Run: `cd web && npm install -D vite typescript vitest @types/node`
Expected: `package-lock.json` 생성, `node_modules/` 생성(.gitignore에 있음). `npx tsc --version` → `Version 5.x`.

- [ ] **Step 3: 타입과 실패하는 테스트 작성**

`web/src/assets/types.ts`:
```ts
export interface AssetIndex { format: 1; maps: string[]; sprites: string[] }

export interface MapObject { layer: number; front: number; left: number; top: number; right: number; bottom: number; ox: number; oy: number }
export interface MapCell { h: number; blocked: number; flag2: number; land: number; objs: MapObject[] }
export interface MapData {
  w: number; h: number;
  bg: string | null;
  layers: string[];
  start: [number, number];
  origin: [number, number];
  pixelSize: [number, number];
  cells: MapCell[];
  cellAt: number[];
}

export interface ApdImage { sheet: number; key: number; x: number; y: number; w: number; h: number; ox: number; oy: number }
export interface ApdPattern { yOffset: number; images: number[] }
export interface ApdAnim { name: string; script: string }
export interface ApdData { version: number; sheets: string[]; images: ApdImage[]; patterns: ApdPattern[]; anims: ApdAnim[] }

/** Minimal shape check for JSON that came over the network. Throws TypeError with the failing field. */
export function assertMapData(x: unknown, name: string): asserts x is MapData {
  const o = x as Record<string, unknown>;
  for (const k of ['w', 'h', 'layers', 'start', 'origin', 'pixelSize', 'cells', 'cellAt']) {
    if (!(k in o)) throw new TypeError(`${name}: missing field "${k}"`);
  }
  if (!Array.isArray(o['cellAt'])) throw new TypeError(`${name}: cellAt is not an array`);
}

export function assertApdData(x: unknown, name: string): asserts x is ApdData {
  const o = x as Record<string, unknown>;
  for (const k of ['version', 'sheets', 'images', 'patterns', 'anims']) {
    if (!Array.isArray(o[k]) && k !== 'version') throw new TypeError(`${name}: field "${k}" is not an array`);
  }
}
```

`web/test/types.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { assertApdData, assertMapData } from '../src/assets/types';

describe('assertMapData', () => {
  it('accepts a complete map', () => {
    const m = { w: 1, h: 1, bg: null, layers: [], start: [0, 0], origin: [0, 0], pixelSize: [640, 480], cells: [], cellAt: [] };
    expect(() => assertMapData(m, 'stage00')).not.toThrow();
  });
  it('names the missing field', () => {
    expect(() => assertMapData({ w: 1 }, 'stage00')).toThrow('stage00: missing field "h"');
  });
});

describe('assertApdData', () => {
  it('rejects a non-array field', () => {
    expect(() => assertApdData({ version: 3, sheets: 'x', images: [], patterns: [], anims: [] }, 'char_01a')).toThrow('"sheets"');
  });
});
```

- [ ] **Step 4: 테스트와 타입 검사 실행**

Run: `cd web && npm run check`
Expected: `tsc` 오류 0, Vitest `3 passed`. (Step 3 전에 실행하면 `types.ts`가 없어 실패한다. 순서를 지킨다.)

- [ ] **Step 5: 커밋**

```bash
git add web/package.json web/package-lock.json web/tsconfig.json web/vite.config.ts web/index.html web/src/assets/types.ts web/test/types.test.ts
git commit -m "feat(web): scaffold Vite + TypeScript + Vitest project with asset JSON types

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 인덱스 PNG 디코더 `assets/png.ts`

**Files:**
- Create: `web/src/assets/png.ts`
- Create: `web/test/helpers/makePng.ts` (테스트용 PNG 인코더. `test/**/*.test.ts` 글롭에 걸리지 않는다)
- Create: `web/test/png.test.ts`

**Interfaces:**
- Produces: `interface IndexedImage { width: number; height: number; indices: Uint8Array; palette: Uint8Array }` (palette 768 B RGB), `class PngFormatError extends Error`, `async function decodeIndexedPng(buf: ArrayBuffer): Promise<IndexedImage>`.
- Test helper: `makePng(width, height, indices: number[], palette: number[], opts?: { colorType?: number; filter?: number; idatSplit?: number }): ArrayBuffer` — Task 10의 테스트도 쓴다.

- [ ] **Step 1: 테스트 헬퍼와 실패하는 테스트 작성**

`web/test/helpers/makePng.ts`:
```ts
import { deflateSync } from 'node:zlib';

/** Build a PNG the way tools/ft2_szdd.bmp8_to_png does (8-bit indexed, filter 0, one IDAT) with optional overrides. */
export function makePng(width: number, height: number, indices: number[], palette: number[], opts: { colorType?: number; filter?: number; idatSplit?: number } = {}): ArrayBuffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length))); return out;
  };
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = opts.colorType ?? 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) { raw[y * (width + 1)] = opts.filter ?? 0; raw.set(indices.slice(y * width, (y + 1) * width), y * (width + 1) + 1); }
  const z = new Uint8Array(deflateSync(raw));
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('PLTE', new Uint8Array(palette))];
  if (opts.idatSplit) parts.push(chunk('IDAT', z.subarray(0, opts.idatSplit)), chunk('IDAT', z.subarray(opts.idatSplit)));
  else parts.push(chunk('IDAT', z));
  parts.push(chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0); const buf = new Uint8Array(total); let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf.buffer;
}

/** 4-color palette used by several tests: black, red, green, magenta. */
export const PAL4 = [0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 0, 255];
```

`web/test/png.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { decodeIndexedPng, PngFormatError } from '../src/assets/png';
import { makePng, PAL4 } from './helpers/makePng';

describe('decodeIndexedPng', () => {
  it('returns indices and a 768-byte palette', async () => {
    const img = await decodeIndexedPng(makePng(3, 2, [0, 1, 2, 3, 2, 1], PAL4));
    expect(img.width).toBe(3); expect(img.height).toBe(2);
    expect(Array.from(img.indices)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(img.palette.length).toBe(768);                 // short palette (4 colors) padded with zeros
    expect(Array.from(img.palette.subarray(9, 12))).toEqual([255, 0, 255]);
    expect(img.palette[767]).toBe(0);
  });
  it('joins several IDAT chunks', async () => {
    const img = await decodeIndexedPng(makePng(4, 4, Array.from({ length: 16 }, (_, i) => i % 4), PAL4, { idatSplit: 5 }));
    expect(img.indices[15]).toBe(3);
  });
  it('rejects a non-indexed color type', async () => {
    await expect(decodeIndexedPng(makePng(1, 1, [0], PAL4, { colorType: 2 }))).rejects.toThrow(PngFormatError);
    await expect(decodeIndexedPng(makePng(1, 1, [0], PAL4, { colorType: 2 }))).rejects.toThrow('color type 2');
  });
  it('rejects a row filter other than 0', async () => {
    await expect(decodeIndexedPng(makePng(2, 1, [0, 1], PAL4, { filter: 1 }))).rejects.toThrow('filter 1');
  });
  it('rejects a buffer without the PNG signature', async () => {
    await expect(decodeIndexedPng(new Uint8Array([1, 2, 3]).buffer)).rejects.toThrow(PngFormatError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/png.test.ts`
Expected: FAIL — `Failed to resolve import "../src/assets/png"`.

- [ ] **Step 3: 디코더 작성**

`web/src/assets/png.ts`:
```ts
export interface IndexedImage { width: number; height: number; indices: Uint8Array; palette: Uint8Array }

export class PngFormatError extends Error {
  override name = 'PngFormatError';
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function inflate(zlibData: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([zlibData]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decode an 8-bit indexed, non-interlaced PNG whose rows all use filter 0 (what tools/ft2_export.py writes). */
export async function decodeIndexedPng(buf: ArrayBuffer): Promise<IndexedImage> {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new PngFormatError('not a PNG (bad signature)');
  const view = new DataView(buf);
  let pos = 8;
  let width = 0, height = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8); height = view.getUint32(pos + 12);
      const bitDepth = data[8], colorType = data[9], interlace = data[12];
      if (colorType !== 3) throw new PngFormatError(`unsupported color type ${colorType} (need 3 = indexed)`);
      if (bitDepth !== 8) throw new PngFormatError(`unsupported bit depth ${bitDepth} (need 8)`);
      if (interlace !== 0) throw new PngFormatError('interlaced PNG is not supported');
    } else if (type === 'PLTE') {
      palette = new Uint8Array(768); palette.set(data.subarray(0, 768));
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }
  if (!width || !height) throw new PngFormatError('missing IHDR');
  if (!palette) throw new PngFormatError('missing PLTE');
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idat) { joined.set(c, o); o += c.length; }
  const raw = await inflate(joined);
  const stride = width + 1;
  if (raw.length < stride * height) throw new PngFormatError(`image data too short (${raw.length} < ${stride * height})`);
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    if (filter !== 0) throw new PngFormatError(`row ${y} uses filter ${filter}; only filter 0 is supported`);
    indices.set(raw.subarray(y * stride + 1, y * stride + 1 + width), y * width);
  }
  return { width, height, indices, palette };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/png.test.ts`
Expected: `5 passed`.

- [ ] **Step 5: 커밋**

```bash
git add web/src/assets/png.ts web/test/helpers/makePng.ts web/test/png.test.ts
git commit -m "feat(web): decode 8-bit indexed PNG into palette + indices

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 색 키 → RGBA와 비트맵 캐시 `gfx/indexed.ts`

**Files:**
- Create: `web/src/gfx/indexed.ts`
- Create: `web/test/indexed.test.ts`

**Interfaces:**
- Consumes: `IndexedImage` (Task 3).
- Produces: `function indexedToRgba(image: IndexedImage, key: number | null): Uint8ClampedArray` (길이 w·h·4), `class IndexedBitmaps { constructor(image: IndexedImage); prepare(key: number | null): Promise<void>; get(key: number | null): ImageBitmap }`. `get`은 `prepare` 전에 부르면 `Error('bitmap for key K not prepared')`.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/indexed.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { IndexedImage } from '../src/assets/png';
import { indexedToRgba } from '../src/gfx/indexed';

function image(): IndexedImage {
  const palette = new Uint8Array(768);
  palette.set([10, 20, 30], 0);          // index 0
  palette.set([255, 0, 255], 253 * 3);   // index 253 magenta (a typical key)
  return { width: 2, height: 1, indices: new Uint8Array([0, 253]), palette };
}

describe('indexedToRgba', () => {
  it('copies palette colors with alpha 255 when there is no key', () => {
    const rgba = indexedToRgba(image(), null);
    expect(Array.from(rgba)).toEqual([10, 20, 30, 255, 255, 0, 255, 255]);
  });
  it('makes only the key index transparent', () => {
    const rgba = indexedToRgba(image(), 253);
    expect(Array.from(rgba.subarray(0, 4))).toEqual([10, 20, 30, 255]);
    expect(rgba[7]).toBe(0);
  });
  it('leaves other reserved indices opaque (key 255 must not hide index 253)', () => {
    const rgba = indexedToRgba(image(), 255);
    expect(rgba[7]).toBe(255);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/indexed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

`web/src/gfx/indexed.ts`:
```ts
import type { IndexedImage } from '../assets/png';

/** Expand palette indices to RGBA. Pixels whose index equals `key` get alpha 0; everything else is opaque. */
export function indexedToRgba(image: IndexedImage, key: number | null): Uint8ClampedArray {
  const { indices, palette } = image;
  const out = new Uint8ClampedArray(indices.length * 4);
  for (let i = 0, o = 0; i < indices.length; i++, o += 4) {
    const idx = indices[i]!;
    const p = idx * 3;
    out[o] = palette[p]!; out[o + 1] = palette[p + 1]!; out[o + 2] = palette[p + 2]!;
    out[o + 3] = idx === key ? 0 : 255;
  }
  return out;
}

const NO_KEY = -1;

/** One indexed image, converted lazily to an ImageBitmap per color key. Browser only (ImageData, createImageBitmap). */
export class IndexedBitmaps {
  private readonly cache = new Map<number, ImageBitmap>();

  constructor(readonly image: IndexedImage) {}

  async prepare(key: number | null): Promise<void> {
    const k = key ?? NO_KEY;
    if (this.cache.has(k)) return;
    const data = new ImageData(indexedToRgba(this.image, key), this.image.width, this.image.height);
    this.cache.set(k, await createImageBitmap(data));
  }

  get(key: number | null): ImageBitmap {
    const bmp = this.cache.get(key ?? NO_KEY);
    if (!bmp) throw new Error(`bitmap for key ${key} not prepared`);
    return bmp;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npm run check`
Expected: tsc 오류 0, 모든 테스트 통과(`indexed` 3개 포함).

- [ ] **Step 5: 커밋**

```bash
git add web/src/gfx/indexed.ts web/test/indexed.test.ts
git commit -m "feat(web): per-key RGBA expansion and ImageBitmap cache for indexed images

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 좌표계 `iso/grid.ts`

**Files:**
- Create: `web/src/iso/grid.ts`
- Create: `web/test/grid.test.ts`

**Interfaces:**
- Produces:
  - `interface GridGeometry { w: number; h: number; originX: number; originY: number }`
  - `function gridSize(g: GridGeometry): number` → `N = w + h - 1`
  - `function cellAnchor(g: GridGeometry, c: number, r: number, height: number): { x: number; y: number }` → 마름모 중심
  - `function inDiamond(px: number, py: number, ax: number, ay: number): boolean`
  - `function rowCells(N: number, s: number): Array<[number, number]>` → 행 s의 (c, r)들, c 오름차순
  - 상수 `TILE_W = 64`, `TILE_H = 32`, `HEIGHT_STEP = 8`, `VIEW_W = 640`, `VIEW_H = 480`

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/grid.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { cellAnchor, gridSize, inDiamond, rowCells } from '../src/iso/grid';

const g = { w: 25, h: 25, originX: 768, originY: -256 };   // stage02 values

describe('grid', () => {
  it('N = w + h - 1', () => { expect(gridSize(g)).toBe(49); });

  it('anchor follows (c-r)*32+ox, (c+r)*16+oy-h*8', () => {
    expect(cellAnchor(g, 0, 0, 0)).toEqual({ x: 768, y: -256 });
    expect(cellAnchor(g, 24, 0, 0)).toEqual({ x: 768 + 24 * 32, y: -256 + 24 * 16 });
    expect(cellAnchor(g, 12, 12, 3)).toEqual({ x: 768, y: -256 + 24 * 16 - 24 });
  });

  it('diamond test uses |dx|/32 + |dy|/16 <= 1 around the center', () => {
    expect(inDiamond(100, 50, 100, 50)).toBe(true);
    expect(inDiamond(131, 50, 100, 50)).toBe(true);    // right tip
    expect(inDiamond(100, 66, 100, 50)).toBe(true);    // bottom tip
    expect(inDiamond(116, 58, 100, 50)).toBe(true);    // on the edge
    expect(inDiamond(117, 58, 100, 50)).toBe(false);   // just outside
    expect(inDiamond(133, 50, 100, 50)).toBe(false);
  });

  it('rowCells lists (c, r) with c + r = s inside 0..N-1, c ascending', () => {
    expect(rowCells(3, 0)).toEqual([[0, 0]]);
    expect(rowCells(3, 2)).toEqual([[0, 2], [1, 1], [2, 0]]);
    expect(rowCells(3, 3)).toEqual([[1, 2], [2, 1]]);
    expect(rowCells(3, 4)).toEqual([[2, 2]]);
    expect(rowCells(3, 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/grid.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

`web/src/iso/grid.ts`:
```ts
export const TILE_W = 64;
export const TILE_H = 32;
export const HEIGHT_STEP = 8;
export const VIEW_W = 640;
export const VIEW_H = 480;

export interface GridGeometry { w: number; h: number; originX: number; originY: number }

/** Diagonal grid size: c and r both run 0..N-1 (FUN_0042d960). */
export function gridSize(g: GridGeometry): number {
  return g.w + g.h - 1;
}

/** Center of the 64×32 diamond of cell (c, r) in map pixels (FUN_0042dd00). */
export function cellAnchor(g: GridGeometry, c: number, r: number, height: number): { x: number; y: number } {
  return { x: (c - r) * (TILE_W / 2) + g.originX, y: (c + r) * (TILE_H / 2) + g.originY - height * HEIGHT_STEP };
}

export function inDiamond(px: number, py: number, ax: number, ay: number): boolean {
  return Math.abs(px - ax) / (TILE_W / 2) + Math.abs(py - ay) / (TILE_H / 2) <= 1;
}

/** Cells of diagonal row s (= c + r), c ascending. Rows run 0..2N-2 (FUN_0042cde0 loop bounds). */
export function rowCells(N: number, s: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let c = Math.max(0, s - (N - 1)); c <= Math.min(N - 1, s); c++) out.push([c, s - c]);
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/grid.test.ts`
Expected: `4 passed`.

- [ ] **Step 5: 커밋**

```bash
git add web/src/iso/grid.ts web/test/grid.test.ts
git commit -m "feat(web): diagonal grid geometry (diamond-center anchor, row iteration, hit test)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 맵 모델 `map/mapModel.ts`

**Files:**
- Create: `web/src/map/mapModel.ts`
- Create: `web/test/mapModel.test.ts`

**Interfaces:**
- Consumes: `MapData`, `MapCell` (Task 2), `IndexedImage` (Task 3), `cellAnchor`, `gridSize`, `inDiamond`, `rowCells`, `GridGeometry` (Task 5).
- Produces:
  - `class MapDataError extends Error`
  - `function layerKey(img: IndexedImage): number` — 좌상단 픽셀 규칙
  - `interface PlacedCell { c: number; r: number; index: number; cell: MapCell; x: number; y: number }` (x, y = 앵커)
  - `interface MapRow { s: number; cells: PlacedCell[] }`
  - `class MapModel { constructor(data: MapData, layers: IndexedImage[], bg: IndexedImage | null); readonly N; readonly geometry: GridGeometry; readonly rows: MapRow[]; readonly layerKeys: number[]; readonly data; readonly layers; readonly bg; cellAt(c, r): PlacedCell | null; pick(px, py): PlacedCell | null }`

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/mapModel.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { IndexedImage } from '../src/assets/png';
import type { MapData } from '../src/assets/types';
import { layerKey, MapDataError, MapModel } from '../src/map/mapModel';

function sheet(topLeft: number, width = 64, height = 32): IndexedImage {
  const indices = new Uint8Array(width * height).fill(7);
  indices[0] = topLeft;
  return { width, height, indices, palette: new Uint8Array(768) };
}

/** 2×2 logical grid → N = 3, five cells: (1,0) (0,1) (1,1) (2,1) (1,2). Index = order in `cells`. */
function map(overrides: Partial<MapData> = {}): MapData {
  const N = 3;
  const cellAt = new Array(N * N).fill(-1);
  const place = (c: number, r: number, i: number) => { cellAt[c * N + r] = i; };
  place(1, 0, 0); place(0, 1, 1); place(1, 1, 2); place(2, 1, 3); place(1, 2, 4);
  const empty = { blocked: 0, flag2: 0, land: 1, objs: [] };
  return {
    w: 2, h: 2, bg: null, layers: ['l0'], start: [0, 0], origin: [64, 0], pixelSize: [640, 480],
    cells: [
      { h: 0, ...empty, objs: [{ layer: 0, front: 0, left: 0, top: 0, right: 64, bottom: 32, ox: -32, oy: -16 }] },
      { h: 0, ...empty }, { h: 0, ...empty }, { h: 0, ...empty }, { h: 2, ...empty },
    ],
    cellAt, ...overrides,
  };
}

describe('layerKey', () => {
  it('uses the top-left index when it is reserved (<=9 or >=246)', () => {
    expect(layerKey(sheet(253))).toBe(253);
    expect(layerKey(sheet(255))).toBe(255);
    expect(layerKey(sheet(5))).toBe(5);
  });
  it('falls back to 249 for an ordinary color', () => {
    expect(layerKey(sheet(67))).toBe(249);
    expect(layerKey(sheet(121))).toBe(249);
  });
});

describe('MapModel', () => {
  it('builds rows in c-ascending order with anchors', () => {
    const m = new MapModel(map(), [sheet(249)], null);
    expect(m.N).toBe(3);
    expect(m.rows.map((r) => r.cells.map((p) => [p.c, p.r]))).toEqual([[], [[0, 1], [1, 0]], [[1, 1]], [[1, 2], [2, 1]], []]);
    expect(m.cellAt(1, 1)).toMatchObject({ x: 64, y: 32 });          // (1-1)*32+64, (1+1)*16
    expect(m.cellAt(1, 2)).toMatchObject({ x: 32, y: 48 - 16 });     // height 2 → -16
    expect(m.cellAt(0, 0)).toBeNull();
    expect(m.layerKeys).toEqual([249]);
  });
  it('picks the front-most cell under a point and null outside', () => {
    const m = new MapModel(map(), [sheet(249)], null);
    expect(m.pick(64, 30)).toMatchObject({ c: 1, r: 1 });
    expect(m.pick(40, 34)).toMatchObject({ c: 1, r: 2 });            // raised (1,2) is drawn after (1,1) and (0,1), so it wins
    expect(m.pick(400, 400)).toBeNull();
  });
  it('accepts a map without background and without layers', () => {
    const data = map({ layers: [], cells: map().cells.map((c) => ({ ...c, objs: [] })) });
    const m = new MapModel(data, [], null);
    expect(m.bg).toBeNull();
    expect(m.rows[2]!.cells).toHaveLength(1);
  });
  it('rejects a layer count mismatch', () => {
    expect(() => new MapModel(map(), [], null)).toThrow(MapDataError);
  });
  it('rejects an object whose layer index is out of range', () => {
    const data = map();
    data.cells[0]!.objs[0]!.layer = 3;
    expect(() => new MapModel(data, [sheet(249)], null)).toThrow(/layer 3 out of range/);
  });
  it('rejects an object rect outside its layer sheet', () => {
    const data = map();
    data.cells[0]!.objs[0]!.bottom = 999;
    expect(() => new MapModel(data, [sheet(249)], null)).toThrow(/outside layer/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/mapModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

`web/src/map/mapModel.ts`:
```ts
import type { IndexedImage } from '../assets/png';
import type { MapCell, MapData } from '../assets/types';
import { cellAnchor, gridSize, inDiamond, rowCells, type GridGeometry } from '../iso/grid';

export class MapDataError extends Error {
  override name = 'MapDataError';
}

export const DEFAULT_LAYER_KEY = 249;

/** Color key of a map layer sheet (FUN_00431460): the top-left pixel, unless it is an ordinary color 10..245 → 249. */
export function layerKey(img: IndexedImage): number {
  const p = img.indices[0] ?? DEFAULT_LAYER_KEY;
  return p >= 10 && p <= 245 ? DEFAULT_LAYER_KEY : p;
}

export interface PlacedCell { c: number; r: number; index: number; cell: MapCell; x: number; y: number }
export interface MapRow { s: number; cells: PlacedCell[] }

export class MapModel {
  readonly N: number;
  readonly geometry: GridGeometry;
  readonly rows: MapRow[] = [];
  readonly layerKeys: number[];
  private readonly byPos = new Map<number, PlacedCell>();

  constructor(readonly data: MapData, readonly layers: IndexedImage[], readonly bg: IndexedImage | null) {
    if (layers.length !== data.layers.length) {
      throw new MapDataError(`expected ${data.layers.length} layer images, got ${layers.length}`);
    }
    this.geometry = { w: data.w, h: data.h, originX: data.origin[0], originY: data.origin[1] };
    this.N = gridSize(this.geometry);
    if (data.cellAt.length !== this.N * this.N) {
      throw new MapDataError(`cellAt has ${data.cellAt.length} entries, expected ${this.N * this.N}`);
    }
    this.layerKeys = layers.map(layerKey);
    for (let s = 0; s <= 2 * this.N - 2; s++) {
      const cells: PlacedCell[] = [];
      for (const [c, r] of rowCells(this.N, s)) {
        const index = data.cellAt[c * this.N + r]!;
        if (index < 0) continue;
        const cell = data.cells[index];
        if (!cell) throw new MapDataError(`cellAt points to cell ${index} but there are ${data.cells.length}`);
        for (const o of cell.objs) {
          const img = layers[o.layer];
          if (!img) throw new MapDataError(`cell ${index}: object layer ${o.layer} out of range`);
          if (o.left < 0 || o.top < 0 || o.right > img.width || o.bottom > img.height) {
            throw new MapDataError(`cell ${index}: object rect outside layer ${o.layer} (${img.width}×${img.height})`);
          }
        }
        const { x, y } = cellAnchor(this.geometry, c, r, cell.h);
        const placed = { c, r, index, cell, x, y };
        cells.push(placed);
        this.byPos.set(c * this.N + r, placed);
      }
      this.rows.push({ s, cells });
    }
  }

  cellAt(c: number, r: number): PlacedCell | null {
    return this.byPos.get(c * this.N + r) ?? null;
  }

  /** Front-most cell (last in draw order) whose height-adjusted diamond contains the map-pixel point. */
  pick(px: number, py: number): PlacedCell | null {
    let hit: PlacedCell | null = null;
    for (const row of this.rows) for (const p of row.cells) if (inDiamond(px, py, p.x, p.y)) hit = p;
    return hit;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/mapModel.test.ts`
Expected: `8 passed`.

- [ ] **Step 5: 커밋**

```bash
git add web/src/map/mapModel.ts web/test/mapModel.test.ts
git commit -m "feat(web): map model with row ordering, layer color keys, validation and picking

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 애니 스크립트 컴파일러 `sprite/animScript.ts`

**Files:**
- Create: `web/src/sprite/animScript.ts`
- Create: `web/test/animScript.test.ts`

**Interfaces:**
- Consumes: `ApdData` (Task 2).
- Produces:
  - `interface Frame { pattern: number; flipH: boolean; flipV: boolean; ms: number; trigger: number | null; triggerSharp: boolean; mark: 0 | 1 | 2 | 3 | 4 }`
  - `interface Step { frames: Frame[]; dx: number; dy: number; totalMs: number }`
  - `interface Timeline { name: string; steps: Step[] }`
  - `class AnimScriptError extends Error { anim: string; offset: number }`
  - `function compileAnim(apd: ApdData, animIndex: number): Timeline`
  - `function compileAll(apd: ApdData): { timelines: Map<string, Timeline>; errors: AnimScriptError[] }` — 키는 애니 이름 대문자.

스펙 §8.1~8.3의 규칙 1~12를 구현한다. 원작 파서(`FUN_00424c80`)처럼 문자 단위로 읽는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/animScript.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { ApdData } from '../src/assets/types';
import { AnimScriptError, compileAll, compileAnim, type Frame } from '../src/sprite/animScript';

function apd(scripts: Record<string, string>, nPatterns = 50): ApdData {
  return {
    version: 3, sheets: ['s'], images: [{ sheet: 0, key: 253, x: 0, y: 0, w: 8, h: 8, ox: 0, oy: 0 }],
    patterns: Array.from({ length: nPatterns }, () => ({ yOffset: 0, images: [0] })),
    anims: Object.entries(scripts).map(([name, script]) => ({ name, script })),
  };
}
const f = (pattern: number, ms = 200, extra: Partial<Frame> = {}): Frame =>
  ({ pattern, flipH: false, flipV: false, ms, trigger: null, triggerSharp: false, mark: 0, ...extra });
const compile = (script: string, nPatterns = 50) => compileAnim(apd({ X: script }, nPatterns), 0);

describe('compileAnim – frames', () => {
  it('P range and list, default 200 ms (corpus F.STAND)', () => {
    const t = compile('S200\r\nP1-3,2');
    expect(t.steps).toHaveLength(1);
    expect(t.steps[0]!.frames).toEqual([f(1), f(2), f(3), f(2)]);
    expect(t.steps[0]).toMatchObject({ dx: 0, dy: 0, totalMs: 800 });
  });
  it('S changes the duration of following frames; trailing comma and CRLF are separators (corpus F.DEFENSE)', () => {
    const t = compile('S200\r\nP0,\r\nS400\r\nP4');
    expect(t.steps[0]!.frames).toEqual([f(0, 200), f(4, 400)]);
    expect(t.steps[0]!.totalMs).toBe(600);
  });
  it('descending range', () => {
    expect(compile('P5-3').steps[0]!.frames.map((x) => x.pattern)).toEqual([5, 4, 3]);
  });
  it('range to the same pattern adds nothing', () => {
    expect(compile('P5-5').steps[0]!.frames).toHaveLength(1);
  });
  it('marks and triggers attach to the number they precede; a range gives them to its last frame (corpus char_31B)', () => {
    const frames = compile('S150\r\nP13-A(6)16-B(6)22').steps[0]!.frames;
    expect(frames.map((x) => x.pattern)).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    expect(frames[3]).toEqual(f(16, 150, { mark: 1, trigger: 6 }));
    expect(frames[9]).toEqual(f(22, 150, { mark: 2, trigger: 6 }));
    expect(frames[4]).toEqual(f(17, 150));
  });
  it('trigger resets after every number; N truncates (corpus char_27B)', () => {
    const step = compile('S50\r\nPA(2)16,15,(2)14-12\r\nN4\r\nM16,32').steps[0]!;
    expect(step.frames).toEqual([f(16, 50, { mark: 1, trigger: 2 }), f(15, 50), f(14, 50, { trigger: 2 }), f(13, 50)]);
    expect(step).toMatchObject({ dx: 16, dy: 32, totalMs: 200 });
  });
  it('(#n) sets triggerSharp', () => {
    expect(compile('P(#3)7').steps[0]!.frames[0]).toEqual(f(7, 200, { trigger: 3, triggerSharp: true }));
  });
  it('N cycles frames to fill (corpus F.LIFT)', () => {
    const t = compile('S50 P6 N8 M0,-8\r\nS50 P6 N8 M0,-16');
    expect(t.steps).toHaveLength(2);
    expect(t.steps[0]!.frames).toHaveLength(8);
    expect(t.steps[0]!.frames.every((x) => x.pattern === 6 && x.ms === 50)).toBe(true);
    expect(t.steps[0]).toMatchObject({ dx: 0, dy: -8, totalMs: 400 });
    expect(t.steps[1]).toMatchObject({ dx: 0, dy: -16 });
  });
  it('N cycles a multi-frame list in order', () => {
    expect(compile('P1,2 N5').steps[0]!.frames.map((x) => x.pattern)).toEqual([1, 2, 1, 2, 1]);
  });
});

describe('compileAnim – steps and movement', () => {
  it('M-only steps repeat the previous frames (corpus F.S/DAMAGE)', () => {
    const t = compile('P21\r\nM4,2\r\nM-6,-3\r\nM3,2\r\nM-1,-1\r\nM0,0');
    expect(t.steps).toHaveLength(5);
    expect(t.steps.map((s) => [s.dx, s.dy])).toEqual([[4, 2], [-6, -3], [3, 2], [-1, -1], [0, 0]]);
    expect(t.steps.every((s) => s.frames.length === 1 && s.frames[0]!.pattern === 21)).toBe(true);
  });
  it('an empty trailing step is dropped', () => {
    expect(compile('P1 M0,0\r\n').steps).toHaveLength(1);
  });
  it('HP flips the whole list, H before a number flips that frame, HM negates dx, VM negates dy', () => {
    expect(compile('HP1-2').steps[0]!.frames.every((x) => x.flipH && !x.flipV)).toBe(true);
    const mixed = compile('P1,H2,V3').steps[0]!.frames;
    expect(mixed.map((x) => [x.flipH, x.flipV])).toEqual([[false, false], [true, false], [false, true]]);
    expect(compile('P1 HM4,2').steps[0]).toMatchObject({ dx: -4, dy: 2 });
    expect(compile('P1 VM4,2').steps[0]).toMatchObject({ dx: 4, dy: -2 });
    expect(compile('HP1,H2').steps[0]!.frames.map((x) => x.flipH)).toEqual([true, false]);   // XOR
  });
});

describe('compileAnim – includes', () => {
  const data = apd({
    'F.ATTACK1': 'S100 P0-1 M8,0',
    'F.ATTACK2': 'S100 P2 M0,4',
    'F.ATTACK6': '@F.ATTACK1, @F.ATTACK2,\r\n@F.ATTACK1',
    'B.MIRROR': 'H@F.ATTACK1',
    SELF: '@SELF',
  });
  it('@ appends the steps of another animation (corpus char_01b F.ATTACK6)', () => {
    const t = compileAnim(data, 2);
    expect(t.steps.map((s) => [s.frames.map((x) => x.pattern), s.dx, s.dy])).toEqual([[[0, 1], 8, 0], [[2], 0, 4], [[0, 1], 8, 0]]);
    expect(t.steps[0]!.frames[0]!.ms).toBe(100);
  });
  it('H@ flips the included frames and negates dx', () => {
    const t = compileAnim(data, 3);
    expect(t.steps[0]!.frames.every((x) => x.flipH)).toBe(true);
    expect(t.steps[0]).toMatchObject({ dx: -8, dy: 0 });
  });
  it('resolves names case-insensitively', () => {
    expect(compileAnim(apd({ A: '@b', b: 'P1' }), 0).steps).toHaveLength(1);
  });
  it('rejects self include', () => {
    expect(() => compileAnim(data, 4)).toThrow(/recursive/);
  });
});

describe('compileAnim – errors', () => {
  const err = (script: string, re: RegExp, n = 50) => expect(() => compile(script, n)).toThrow(re);
  it('unknown character', () => err('P1 Q2', /unknown character "Q"/));
  it('pattern out of range names the limit', () => err('P7', /pattern 7 out of range \(5\)/, 5));
  it('range without a start', () => err('P-3', /range without a start/));
  it('first step with only M', () => err('M1,1', /no previous step/));
  it('@ after frames in the same step', () => expect(() => compileAnim(apd({ A: 'P0 @B', B: 'P1' }), 0)).toThrow(/after frames/));
  it('unknown include target', () => expect(() => compileAnim(apd({ A: '@NOPE' }), 0)).toThrow(/no such animation/));
  it('empty script has no frames', () => err('', /no frames/));
  it('carries the anim name and offset', () => {
    try { compile('P1 Q'); } catch (e) {
      expect(e).toBeInstanceOf(AnimScriptError);
      expect((e as AnimScriptError).anim).toBe('X');
      expect((e as AnimScriptError).offset).toBe(3);
    }
  });
});

describe('compileAll', () => {
  it('keeps compiling other anims after an error and keys by upper-case name', () => {
    const { timelines, errors } = compileAll(apd({ 'f.stand': 'P1', BAD: 'P-1', 'B.STAND': 'P2' }));
    expect([...timelines.keys()]).toEqual(['F.STAND', 'B.STAND']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.anim).toBe('BAD');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/animScript.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

`web/src/sprite/animScript.ts`:
```ts
import type { ApdData } from '../assets/types';

export interface Frame { pattern: number; flipH: boolean; flipV: boolean; ms: number; trigger: number | null; triggerSharp: boolean; mark: 0 | 1 | 2 | 3 | 4 }
export interface Step { frames: Frame[]; dx: number; dy: number; totalMs: number }
export interface Timeline { name: string; steps: Step[] }

export class AnimScriptError extends Error {
  override name = 'AnimScriptError';
  constructor(readonly anim: string, readonly offset: number, message: string) {
    super(`${anim}@${offset}: ${message}`);
  }
}

const DEFAULT_MS = 200;
const MAX_INCLUDE_DEPTH = 8;
const FLIP_H = 1;
const FLIP_V = 2;

type Mode = 'none' | 'P' | 'M' | 'N' | 'S';

interface StepBuild { frames: Frame[]; n: number | null; dx: number; dy: number }

const newStep = (): StepBuild => ({ frames: [], n: null, dx: 0, dy: 0 });

/** Compile one animation script of an APD file into a timeline (FUN_00424c80 and helpers). */
export function compileAnim(apd: ApdData, animIndex: number, depth = 0): Timeline {
  const anim = apd.anims[animIndex];
  if (!anim) throw new RangeError(`anim index ${animIndex} out of range`);
  const s = anim.script;
  const steps: Step[] = [];
  let cur = newStep();
  let mode: Mode = 'none';
  let ms = DEFAULT_MS;
  let tokenFlip = 0;   // H/V right before P or M
  let elemFlip = 0;    // H/V right before a number
  let mark: Frame['mark'] = 0;
  let range = false;   // '-' seen since the last number (P context)
  let negative = false;  // '-' seen since the last number (M context)
  let trigger: number | null = null;
  let sharp = false;
  let mIndex = 0;
  let i = 0;

  const fail = (message: string) => new AnimScriptError(anim.name, i, message);

  /** Flip bits from 'H'/'V' characters immediately before position pos (FUN_00425100 looks at pos-1 and pos-2). */
  const flipsBefore = (pos: number): number => {
    let bits = 0;
    for (const back of [1, 2]) {
      const ch = s[pos - back];
      if (ch === 'H') bits |= FLIP_H;
      else if (ch === 'V') bits |= FLIP_V;
      else break;
    }
    return bits;
  };

  const frameOf = (pattern: number, flip: number, withMeta: boolean): Frame => ({
    pattern, flipH: (flip & FLIP_H) !== 0, flipV: (flip & FLIP_V) !== 0, ms,
    trigger: withMeta ? trigger : null, triggerSharp: withMeta ? sharp : false, mark: withMeta ? mark : 0,
  });

  const checkPattern = (p: number) => {
    if (p >= apd.patterns.length) throw fail(`pattern ${p} out of range (${apd.patterns.length})`);
  };

  // FUN_004253a0: one P number → one frame, or a range fill ending at this number.
  const emitPattern = (v: number) => {
    checkPattern(v);
    const flip = elemFlip ^ tokenFlip;
    if (!range) { cur.frames.push(frameOf(v, flip, true)); return; }
    const last = cur.frames[cur.frames.length - 1];
    if (!last) throw fail('range without a start pattern');
    if (last.pattern === v) return;
    const dir = v > last.pattern ? 1 : -1;
    for (let p = last.pattern + dir; p !== v; p += dir) cur.frames.push(frameOf(p, flip, false));
    cur.frames.push(frameOf(v, flip, true));
  };

  // FUN_00425190: close the step. M-only steps copy the previous step; N cycles or truncates.
  const endStep = (final: boolean) => {
    if (cur.frames.length === 0) {
      if (final) return;
      const prev = steps[steps.length - 1];
      if (!prev) throw fail('step without frames and no previous step');
      cur.frames = prev.frames.map((fr) => ({ ...fr }));
      if (cur.n === null) cur.n = prev.frames.length;
    }
    let frames = cur.frames;
    if (cur.n !== null && cur.n > 0) {
      if (cur.n < frames.length) frames = frames.slice(0, cur.n);
      else {
        const base = frames.slice();
        for (let k = 0; frames.length < cur.n; k = (k + 1) % base.length) frames.push({ ...base[k]! });
      }
    }
    const totalMs = frames.reduce((acc, fr) => acc + fr.ms, 0);
    steps.push({ frames, dx: cur.dx, dy: cur.dy, totalMs });
    cur = newStep();
  };

  // FUN_00425560: include the steps of another animation of this file.
  const include = (name: string, flip: number) => {
    if (cur.frames.length > 0) throw fail(`@${name} after frames in the same step`);
    const target = apd.anims.findIndex((a) => a.name.toUpperCase() === name.toUpperCase());
    if (target < 0) throw fail(`@${name}: no such animation`);
    if (target === animIndex || depth >= MAX_INCLUDE_DEPTH) throw fail(`@${name}: recursive include`);
    const inner = compileAnim(apd, target, depth + 1);
    const fh = (flip & FLIP_H) !== 0, fv = (flip & FLIP_V) !== 0;
    for (const st of inner.steps) {
      steps.push({
        frames: st.frames.map((fr) => ({ ...fr, flipH: fr.flipH !== fh, flipV: fr.flipV !== fv })),
        dx: fh ? -st.dx : st.dx, dy: fv ? -st.dy : st.dy, totalMs: st.totalMs,
      });
    }
  };

  const resetAfterNumber = () => { trigger = null; sharp = false; mark = 0; range = false; negative = false; };

  while (i < s.length) {
    const ch = s[i]!;
    if (ch >= '0' && ch <= '9') {
      let j = i, v = 0;
      while (j < s.length && s[j]! >= '0' && s[j]! <= '9') { v = v * 10 + (s.charCodeAt(j) - 48); j++; }
      elemFlip = flipsBefore(i);
      switch (mode) {
        case 'P': emitPattern(v); break;
        case 'M': {
          let val = negative ? -v : v;
          if (mIndex === 0) { if (tokenFlip & FLIP_H) val = -val; cur.dx = val; mIndex = 1; }
          else { if (tokenFlip & FLIP_V) val = -val; cur.dy = val; endStep(false); mode = 'none'; }
          break;
        }
        case 'N': cur.n = v; break;
        case 'S': ms = v; break;
        default: throw fail(`number ${v} without a command`);
      }
      resetAfterNumber();
      i = j;
      continue;
    }
    switch (ch) {
      case ' ': case ',': elemFlip = 0; mark = 0; range = false; negative = false; break;
      case '\r': case '\n': case 'H': case 'V': break;
      case 'A': mark = 1; break;
      case 'B': mark = 2; break;
      case 'C': mark = 3; break;
      case 'D': mark = 4; break;
      case '-': range = true; negative = true; break;
      case '(': {
        const close = s.indexOf(')', i);
        if (close < 0) throw fail('unterminated trigger');
        let body = s.slice(i + 1, close);
        sharp = body.startsWith('#');
        if (sharp) body = body.slice(1);
        if (!/^\d+$/.test(body)) throw fail(`bad trigger "(${s.slice(i + 1, close)})"`);
        trigger = Number(body);
        i = close + 1;
        continue;
      }
      case 'P': mode = 'P'; tokenFlip = flipsBefore(i); break;
      case 'M': mode = 'M'; tokenFlip = flipsBefore(i); mIndex = 0; break;
      case 'N': mode = 'N'; break;
      case 'S': mode = 'S'; break;
      case '@': {
        const flip = flipsBefore(i);
        let j = i + 1;
        while (j < s.length && !' ,\r\n'.includes(s[j]!)) j++;
        include(s.slice(i + 1, j), flip);
        i = j;
        continue;
      }
      default: throw fail(`unknown character "${ch}"`);
    }
    i++;
  }
  endStep(true);
  if (steps.every((st) => st.frames.length === 0)) throw fail('no frames');
  return { name: anim.name, steps };
}

/** Compile every animation of a file; one failing script does not stop the others. */
export function compileAll(apd: ApdData): { timelines: Map<string, Timeline>; errors: AnimScriptError[] } {
  const timelines = new Map<string, Timeline>();
  const errors: AnimScriptError[] = [];
  apd.anims.forEach((a, index) => {
    try { timelines.set(a.name.toUpperCase(), compileAnim(apd, index)); }
    catch (e) { if (e instanceof AnimScriptError) errors.push(e); else throw e; }
  });
  return { timelines, errors };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/animScript.test.ts`
Expected: 모든 테스트 통과(`compileAnim – frames` 9, `steps` 3, `includes` 4, `errors` 8, `compileAll` 1).

- [ ] **Step 5: 커밋**

```bash
git add web/src/sprite/animScript.ts web/test/animScript.test.ts
git commit -m "feat(web): compile APD animation scripts into timelines (full FT2 grammar)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 애니 플레이어 `sprite/animPlayer.ts`

**Files:**
- Create: `web/src/sprite/animPlayer.ts`
- Create: `web/test/animPlayer.test.ts`

**Interfaces:**
- Consumes: `Timeline`, `Step`, `Frame` (Task 7).
- Produces:
  - `interface PlayOptions { loop?: boolean; mirrorH?: boolean; mirrorV?: boolean; keepOffset?: boolean }`
  - `type AnimEvent = { type: 'frame'; frame: Frame } | { type: 'step'; step: number } | { type: 'end' }`
  - `class AnimPlayer { constructor(timeline: Timeline, options?: PlayOptions); update(nowMs: number): AnimEvent[]; readonly frame: Frame; readonly offset: { x: number; y: number }; readonly finished: boolean; readonly stepIndex: number }`

스펙 §8.4 규칙 1~7. 원작 `FUN_0042a210` / `FUN_0042a3d0` / `FUN_0042a450`의 순서를 그대로 따른다.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/animPlayer.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { AnimPlayer } from '../src/sprite/animPlayer';
import type { Frame, Timeline } from '../src/sprite/animScript';

const fr = (pattern: number, ms: number): Frame => ({ pattern, flipH: false, flipV: false, ms, trigger: null, triggerSharp: false, mark: 0 });
const step = (frames: Frame[], dx = 0, dy = 0) => ({ frames, dx, dy, totalMs: frames.reduce((a, f) => a + f.ms, 0) });
const tl = (...steps: ReturnType<typeof step>[]): Timeline => ({ name: 'T', steps });

describe('AnimPlayer', () => {
  it('a static anim (1 step, 1 frame, no move) never changes', () => {
    const p = new AnimPlayer(tl(step([fr(3, 200)])), { loop: true });
    expect(p.update(0)).toEqual([]);
    expect(p.update(5000)).toEqual([]);
    expect(p.frame.pattern).toBe(3);
    expect(p.offset).toEqual({ x: 0, y: 0 });
  });

  it('the first update only records the start time; frames advance one at a time', () => {
    const p = new AnimPlayer(tl(step([fr(0, 100), fr(1, 100), fr(2, 100)])));
    expect(p.update(0)).toEqual([]);
    expect(p.update(50)).toEqual([]);
    expect(p.update(100)).toEqual([{ type: 'frame', frame: fr(1, 100) }]);
    expect(p.update(1000)).toEqual([{ type: 'frame', frame: fr(2, 100) }]);   // no catch-up: only one frame
  });

  it('ends without loop, keeps showing the last frame and the last offset', () => {
    const p = new AnimPlayer(tl(step([fr(0, 100), fr(1, 100)], 20, 0)));
    p.update(0); p.update(100);
    expect(p.offset).toEqual({ x: 10, y: 0 });        // elapsed 100 of 200 → 20 * 0.5
    expect(p.update(200)).toEqual([{ type: 'end' }]);
    expect(p.finished).toBe(true);
    expect(p.frame.pattern).toBe(1);
    expect(p.offset).toEqual({ x: 10, y: 0 });
    expect(p.update(300)).toEqual([]);
  });

  it('commits the step move at step end and interpolates by elapsed frame time', () => {
    const p = new AnimPlayer(tl(step([fr(0, 100), fr(1, 100)], 20, 0), step([fr(2, 100)], 0, 8)), { loop: true });
    p.update(0);
    p.update(100); expect(p.offset).toEqual({ x: 10, y: 0 });
    expect(p.update(200)).toEqual([{ type: 'step', step: 1 }, { type: 'frame', frame: fr(2, 100) }]);
    expect(p.offset).toEqual({ x: 20, y: 0 });        // committed 20, new step elapsed 0
    p.update(300);                                     // wrap: reset committed (no keepOffset), then add the finished step (0, 8)
    expect(p.stepIndex).toBe(0);
    expect(p.offset).toEqual({ x: 0, y: 8 });
  });

  it('mirrorH negates x movement and mirrorV negates y movement', () => {
    const p = new AnimPlayer(tl(step([fr(0, 100), fr(1, 100)], 20, 10)), { loop: true, mirrorH: true, mirrorV: true });
    p.update(0); p.update(100);
    expect(p.offset).toEqual({ x: -10, y: -5 });
  });

  it('truncates toward zero like __ftol', () => {
    const p = new AnimPlayer(tl(step([fr(0, 100), fr(1, 100), fr(2, 100)], -5, 0)), { loop: true });
    p.update(0); p.update(100);
    expect(p.offset.x).toBe(-1);                       // -5 * 100/300 = -1.66 → -1
  });

  it('a step whose total time is 0 has speed 0 and a finite offset', () => {
    const p = new AnimPlayer(tl(step([fr(0, 0), fr(1, 0)], 16, 0)), { loop: true });
    p.update(0);
    expect(p.update(0)).toEqual([{ type: 'frame', frame: fr(1, 0) }]);
    expect(p.offset).toEqual({ x: 0, y: 0 });
    p.update(0);
    expect(p.offset).toEqual({ x: 16, y: 0 });         // committed after wrap
  });

  it('keepOffset keeps the committed offset when the anim ends', () => {
    const p = new AnimPlayer(tl(step([fr(0, 100)], 7, 0), step([fr(1, 100)], 3, 0)), { keepOffset: true });
    p.update(0); p.update(100);
    expect(p.offset).toEqual({ x: 7, y: 0 });
    p.update(200);
    expect(p.finished).toBe(true);
    expect(p.offset).toEqual({ x: 7, y: 0 });          // last step's move is not committed at the end (original order)
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/animPlayer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

`web/src/sprite/animPlayer.ts`:
```ts
import type { Frame, Step, Timeline } from './animScript';

export interface PlayOptions { loop?: boolean; mirrorH?: boolean; mirrorV?: boolean; keepOffset?: boolean }
export type AnimEvent = { type: 'frame'; frame: Frame } | { type: 'step'; step: number } | { type: 'end' };

/** Plays a Timeline the way FT2.exe does (FUN_0042a210 / FUN_0042a3d0 / FUN_0042a450). */
export class AnimPlayer {
  private readonly opts: Required<PlayOptions>;
  private _stepIndex = 0;
  private frameIndex = 0;
  private frameStart: number | null = null;
  private elapsed = 0;                          // ms of frames entered in the current step (+0x14)
  private committed = { x: 0, y: 0 };           // (+0x2a, +0x2c)
  private _offset = { x: 0, y: 0 };             // (+0x36, +0x38)
  private _finished = false;

  constructor(readonly timeline: Timeline, options: PlayOptions = {}) {
    this.opts = { loop: false, mirrorH: false, mirrorV: false, keepOffset: false, ...options };
  }

  get stepIndex(): number { return this._stepIndex; }
  get step(): Step { return this.timeline.steps[this._stepIndex]!; }
  get frame(): Frame { return this.step.frames[this.frameIndex]!; }
  get offset(): { x: number; y: number } { return this._offset; }
  get finished(): boolean { return this._finished; }

  /** FUN_00429950: one step, one frame, no movement → a still image. */
  private get isStatic(): boolean {
    const st = this.timeline.steps;
    return st.length === 1 && st[0]!.frames.length === 1 && st[0]!.dx === 0 && st[0]!.dy === 0;
  }

  update(now: number): AnimEvent[] {
    if (this._finished || this.isStatic) return [];
    if (this.frameStart === null) { this.frameStart = now; return []; }
    if (now < this.frameStart + this.frame.ms) return [];
    const events: AnimEvent[] = [];
    this.frameStart = now;
    this.frameIndex++;
    if (this.frameIndex < this.step.frames.length) {
      this.elapsed += this.frame.ms;              // FUN_0042a3d0 adds the duration of the frame just entered
    } else {
      const done = this.step;
      this._stepIndex++;
      if (this._stepIndex >= this.timeline.steps.length) {
        if (!this.opts.keepOffset) this.committed = { x: 0, y: 0 };
        if (!this.opts.loop) {
          this._stepIndex--;
          this.frameIndex = done.frames.length - 1;
          this._finished = true;
          events.push({ type: 'end' });
          return events;                           // offset keeps its last value (FUN_0042a210 returns before recomputing)
        }
        this._stepIndex = 0;
      }
      this.committed = {
        x: this.committed.x + (this.opts.mirrorH ? -done.dx : done.dx),
        y: this.committed.y + (this.opts.mirrorV ? -done.dy : done.dy),
      };
      this.elapsed = 0;
      this.frameIndex = 0;
      events.push({ type: 'step', step: this._stepIndex });
    }
    this.recomputeOffset();
    events.push({ type: 'frame', frame: this.frame });
    return events;
  }

  private recomputeOffset(): void {
    const st = this.step;
    const sx = st.totalMs > 0 ? st.dx / st.totalMs : 0;
    const sy = st.totalMs > 0 ? st.dy / st.totalMs : 0;
    const mx = Math.trunc(this.elapsed * sx);
    const my = Math.trunc(this.elapsed * sy);
    this._offset = {
      x: this.committed.x + (this.opts.mirrorH ? -mx : mx),
      y: this.committed.y + (this.opts.mirrorV ? -my : my),
    };
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/animPlayer.test.ts`
Expected: `8 passed`.

- [ ] **Step 5: 커밋**

```bash
git add web/src/sprite/animPlayer.ts web/test/animPlayer.test.ts
git commit -m "feat(web): timeline player with FT2 step/loop/offset semantics

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 스프라이트 모델 `sprite/apdModel.ts`

**Files:**
- Create: `web/src/sprite/apdModel.ts`
- Create: `web/test/apdModel.test.ts`

**Interfaces:**
- Consumes: `ApdData` (Task 2), `IndexedImage` (Task 3), `compileAll`, `Frame`, `Timeline`, `AnimScriptError` (Task 7).
- Produces:
  - `class ApdDataError extends Error`
  - `interface DrawCommand { sheet: number; key: number; sx: number; sy: number; w: number; h: number; dx: number; dy: number; flipH: boolean; flipV: boolean }` — (dx, dy)는 스프라이트 원점(셀 앵커 + 이동 오프셋) 기준
  - `interface Bounds { left: number; top: number; right: number; bottom: number }`
  - `class ApdModel { constructor(name: string, data: ApdData, sheets: IndexedImage[]); readonly name; readonly data; readonly sheets; readonly keys: number[]; readonly timelines: Map<string, Timeline>; readonly errors: AnimScriptError[]; anim(name: string): Timeline | undefined; animNames(): string[]; keysBySheet(): Map<number, Set<number>>; commands(frame: Frame): DrawCommand[]; bounds(frame: Frame): Bounds }`

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/apdModel.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { IndexedImage } from '../src/assets/png';
import type { ApdData } from '../src/assets/types';
import { ApdDataError, ApdModel } from '../src/sprite/apdModel';
import type { Frame } from '../src/sprite/animScript';

const sheet = (width = 128, height = 64): IndexedImage => ({ width, height, indices: new Uint8Array(width * height), palette: new Uint8Array(768) });
const frame = (pattern: number, flipH = false, flipV = false): Frame => ({ pattern, flipH, flipV, ms: 200, trigger: null, triggerSharp: false, mark: 0 });

function data(overrides: Partial<ApdData> = {}): ApdData {
  return {
    version: 3, sheets: ['a', 'g'],
    images: [
      { sheet: 0, key: 253, x: 0, y: 0, w: 64, h: 64, ox: -32, oy: -56 },
      { sheet: 1, key: 255, x: 64, y: 0, w: 16, h: 8, ox: 4, oy: -70 },
    ],
    patterns: [{ yOffset: 0, images: [0] }, { yOffset: 32, images: [0, 1] }],
    anims: [{ name: 'F.STAND', script: 'P0' }, { name: 'BROKEN', script: 'P9' }],
    ...overrides,
  };
}

describe('ApdModel', () => {
  it('compiles the anims and collects per-anim errors', () => {
    const m = new ApdModel('char_01a', data(), [sheet(), sheet()]);
    expect(m.animNames()).toEqual(['F.STAND', 'BROKEN']);
    expect(m.anim('f.stand')?.steps[0]?.frames[0]?.pattern).toBe(0);
    expect(m.errors.map((e) => e.anim)).toEqual(['BROKEN']);
  });
  it('places images at origin + (ox, oy) and subtracts the pattern yOffset', () => {
    const m = new ApdModel('x', data(), [sheet(), sheet()]);
    expect(m.commands(frame(1))).toEqual([
      { sheet: 0, key: 253, sx: 0, sy: 0, w: 64, h: 64, dx: -32, dy: -56 - 32, flipH: false, flipV: false },
      { sheet: 1, key: 255, sx: 64, sy: 0, w: 16, h: 8, dx: 4, dy: -70 - 32, flipH: false, flipV: false },
    ]);
  });
  it('mirrors offsets as -(ox + w) and -(oy + h) when flipped (FUN_00428620)', () => {
    const m = new ApdModel('x', data(), [sheet(), sheet()]);
    const [c] = m.commands(frame(0, true, true));
    expect(c).toMatchObject({ dx: -(-32 + 64), dy: -(-56 + 64), flipH: true, flipV: true });
  });
  it('bounds is the union of the image rects', () => {
    const m = new ApdModel('x', data(), [sheet(), sheet()]);
    expect(m.bounds(frame(1))).toEqual({ left: -32, top: -102, right: 32, bottom: -24 });
  });
  it('uses key 255 for every image of a version < 2 file', () => {
    const m = new ApdModel('old', data({ version: 1 }), [sheet(), sheet()]);
    expect(m.keys).toEqual([255, 255]);
    expect(m.keysBySheet()).toEqual(new Map([[0, new Set([255])], [1, new Set([255])]]));
  });
  it('groups keys by sheet', () => {
    const m = new ApdModel('x', data(), [sheet(), sheet()]);
    expect(m.keysBySheet()).toEqual(new Map([[0, new Set([253])], [1, new Set([255])]]));
  });
  it('rejects a sheet count mismatch, an image outside its sheet and a pattern with a bad image index', () => {
    expect(() => new ApdModel('x', data(), [sheet()])).toThrow(ApdDataError);
    const outside = data(); outside.images[0]!.w = 999;
    expect(() => new ApdModel('x', outside, [sheet(), sheet()])).toThrow(/image 0 .* outside sheet 0/);
    const badPattern = data(); badPattern.patterns[0]!.images = [7];
    expect(() => new ApdModel('x', badPattern, [sheet(), sheet()])).toThrow(/pattern 0: image 7 out of range/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/apdModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

`web/src/sprite/apdModel.ts`:
```ts
import type { IndexedImage } from '../assets/png';
import type { ApdData } from '../assets/types';
import { compileAll, type AnimScriptError, type Frame, type Timeline } from './animScript';

export class ApdDataError extends Error {
  override name = 'ApdDataError';
}

export interface DrawCommand { sheet: number; key: number; sx: number; sy: number; w: number; h: number; dx: number; dy: number; flipH: boolean; flipV: boolean }
export interface Bounds { left: number; top: number; right: number; bottom: number }

const LEGACY_KEY = 255;   // FUN_00428620: APD version < 2 ignores the per-image key byte

export class ApdModel {
  readonly keys: number[];
  readonly timelines: Map<string, Timeline>;
  readonly errors: AnimScriptError[];

  constructor(readonly name: string, readonly data: ApdData, readonly sheets: IndexedImage[]) {
    if (sheets.length !== data.sheets.length) {
      throw new ApdDataError(`${name}: expected ${data.sheets.length} sheet images, got ${sheets.length}`);
    }
    data.images.forEach((im, i) => {
      const sh = sheets[im.sheet];
      if (!sh) throw new ApdDataError(`${name}: image ${i} sheet ${im.sheet} out of range`);
      if (im.x < 0 || im.y < 0 || im.x + im.w > sh.width || im.y + im.h > sh.height) {
        throw new ApdDataError(`${name}: image ${i} (${im.x},${im.y} ${im.w}×${im.h}) outside sheet ${im.sheet} (${sh.width}×${sh.height})`);
      }
    });
    data.patterns.forEach((p, i) => {
      for (const idx of p.images) if (idx >= data.images.length) throw new ApdDataError(`${name}: pattern ${i}: image ${idx} out of range`);
    });
    this.keys = data.images.map((im) => (data.version < 2 ? LEGACY_KEY : im.key));
    ({ timelines: this.timelines, errors: this.errors } = compileAll(data));
  }

  anim(animName: string): Timeline | undefined {
    return this.timelines.get(animName.toUpperCase());
  }

  animNames(): string[] {
    return this.data.anims.map((a) => a.name);
  }

  /** Which color keys each sheet needs bitmaps for. */
  keysBySheet(): Map<number, Set<number>> {
    const out = new Map<number, Set<number>>();
    this.data.images.forEach((im, i) => {
      if (!out.has(im.sheet)) out.set(im.sheet, new Set());
      out.get(im.sheet)!.add(this.keys[i]!);
    });
    return out;
  }

  /** Draw commands for one frame, relative to the sprite origin (FUN_0042a610 + FUN_00428620 offsets). */
  commands(frame: Frame): DrawCommand[] {
    const pattern = this.data.patterns[frame.pattern];
    if (!pattern) throw new ApdDataError(`${this.name}: pattern ${frame.pattern} out of range`);
    return pattern.images.map((idx) => {
      const im = this.data.images[idx]!;
      return {
        sheet: im.sheet, key: this.keys[idx]!, sx: im.x, sy: im.y, w: im.w, h: im.h,
        dx: frame.flipH ? -(im.ox + im.w) : im.ox,
        dy: (frame.flipV ? -(im.oy + im.h) : im.oy) - pattern.yOffset,
        flipH: frame.flipH, flipV: frame.flipV,
      };
    });
  }

  bounds(frame: Frame): Bounds {
    const b = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const c of this.commands(frame)) {
      b.left = Math.min(b.left, c.dx); b.top = Math.min(b.top, c.dy);
      b.right = Math.max(b.right, c.dx + c.w); b.bottom = Math.max(b.bottom, c.dy + c.h);
    }
    return b;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/apdModel.test.ts`
Expected: `7 passed`.

- [ ] **Step 5: 커밋**

```bash
git add web/src/sprite/apdModel.ts web/test/apdModel.test.ts
git commit -m "feat(web): APD model with validation, per-image keys and frame draw commands

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 자산 로더 `assets/loader.ts`

**Files:**
- Create: `web/src/assets/loader.ts`
- Create: `web/test/loader.test.ts`

**Interfaces:**
- Consumes: `AssetIndex`, `MapData`, `ApdData`, `assertMapData`, `assertApdData` (Task 2), `decodeIndexedPng`, `IndexedImage` (Task 3), `makePng`, `PAL4` (Task 3 헬퍼).
- Produces:
  - `class AssetError extends Error { asset: string }`
  - `class AssetLoader { constructor(base?: string /* default 'assets' */); index(): Promise<AssetIndex>; map(name: string): Promise<MapData>; apd(name: string): Promise<ApdData>; image(kind: 'map' | 'sprite', name: string): Promise<IndexedImage> }` — `image`는 같은 (kind, name)을 한 번만 받아 캐시한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/loader.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetError, AssetLoader } from '../src/assets/loader';
import { makePng, PAL4 } from './helpers/makePng';

function stubFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const make = routes[url];
    return make ? make() : new Response('not found', { status: 404 });
  }));
  return calls;
}
const json = (x: unknown) => () => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('AssetLoader', () => {
  it('loads and validates map JSON', async () => {
    stubFetch({ 'assets/map/stage02.json': json({ w: 1, h: 1, bg: null, layers: [], start: [0, 0], origin: [0, 0], pixelSize: [640, 480], cells: [], cellAt: [] }) });
    const m = await new AssetLoader().map('stage02');
    expect(m.pixelSize).toEqual([640, 480]);
  });
  it('turns HTTP errors into AssetError naming the asset path', async () => {
    stubFetch({});
    await expect(new AssetLoader().map('stage99')).rejects.toThrow(AssetError);
    await expect(new AssetLoader().map('stage99')).rejects.toThrow('assets/map/stage99.json: HTTP 404');
  });
  it('turns a bad JSON shape into AssetError', async () => {
    stubFetch({ 'assets/sprite/x.json': json({ version: 3, sheets: 'oops' }) });
    await expect(new AssetLoader().apd('x')).rejects.toThrow(/sheets/);
  });
  it('decodes PNG images and caches them per (kind, name)', async () => {
    const png = makePng(2, 1, [0, 3], PAL4);
    const calls = stubFetch({ 'assets/sprite/char_01a.png': () => new Response(png, { status: 200 }) });
    const loader = new AssetLoader();
    const [a, b] = await Promise.all([loader.image('sprite', 'char_01a'), loader.image('sprite', 'char_01a')]);
    expect(a).toBe(b);
    expect(Array.from(a.indices)).toEqual([0, 3]);
    expect(calls).toEqual(['assets/sprite/char_01a.png']);
  });
  it('reads the index', async () => {
    stubFetch({ 'assets/index.json': json({ format: 1, maps: ['stage02'], sprites: [] }) });
    expect((await new AssetLoader().index()).maps).toEqual(['stage02']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/loader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

`web/src/assets/loader.ts`:
```ts
import { decodeIndexedPng, type IndexedImage } from './png';
import { assertApdData, assertMapData, type ApdData, type AssetIndex, type MapData } from './types';

export class AssetError extends Error {
  override name = 'AssetError';
  constructor(readonly asset: string, message: string) {
    super(`${asset}: ${message}`);
  }
}

/** Fetches exported assets (tools/ft2_export.py output) relative to `base`. Images are decoded once and cached. */
export class AssetLoader {
  private readonly images = new Map<string, Promise<IndexedImage>>();

  constructor(private readonly base = 'assets') {}

  async index(): Promise<AssetIndex> {
    const path = `${this.base}/index.json`;
    const data = (await this.fetchJson(path)) as Partial<AssetIndex>;
    if (data.format !== 1 || !Array.isArray(data.maps) || !Array.isArray(data.sprites)) throw new AssetError(path, 'not an asset index (format 1)');
    return data as AssetIndex;
  }

  async map(name: string): Promise<MapData> {
    const path = `${this.base}/map/${name}.json`;
    const data = await this.fetchJson(path);
    try { assertMapData(data, name); } catch (e) { throw new AssetError(path, (e as Error).message); }
    return data;
  }

  async apd(name: string): Promise<ApdData> {
    const path = `${this.base}/sprite/${name}.json`;
    const data = await this.fetchJson(path);
    try { assertApdData(data, name); } catch (e) { throw new AssetError(path, (e as Error).message); }
    return data;
  }

  image(kind: 'map' | 'sprite', name: string): Promise<IndexedImage> {
    const path = `${this.base}/${kind}/${name}.png`;
    let p = this.images.get(path);
    if (!p) {
      p = this.fetchBytes(path).then((buf) => decodeIndexedPng(buf)).catch((e: unknown) => {
        this.images.delete(path);
        throw e instanceof AssetError ? e : new AssetError(path, (e as Error).message);
      });
      this.images.set(path, p);
    }
    return p;
  }

  private async fetchBytes(path: string): Promise<ArrayBuffer> {
    const res = await fetch(path);
    if (!res.ok) throw new AssetError(path, `HTTP ${res.status}`);
    return res.arrayBuffer();
  }

  private async fetchJson(path: string): Promise<unknown> {
    const res = await fetch(path);
    if (!res.ok) throw new AssetError(path, `HTTP ${res.status}`);
    try { return await res.json(); } catch { throw new AssetError(path, 'invalid JSON'); }
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npm run check`
Expected: tsc 오류 0, 모든 테스트 통과(`loader` 5개 포함).

- [ ] **Step 5: 커밋**

```bash
git add web/src/assets/loader.ts web/test/loader.test.ts
git commit -m "feat(web): asset loader with validation, AssetError and image cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 렌더러 `render/renderer.ts`

**Files:**
- Create: `web/src/render/culling.ts`
- Create: `web/test/culling.test.ts`
- Create: `web/src/render/renderer.ts`

**Interfaces:**
- Consumes: `MapModel`, `PlacedCell` (Task 6), `ApdModel`, `DrawCommand` (Task 9), `AnimPlayer` (Task 8), `IndexedBitmaps` (Task 4), `VIEW_W`, `VIEW_H`, `TILE_W`, `TILE_H` (Task 5).
- Produces:
  - `render/culling.ts`: `function rectVisible(x: number, y: number, w: number, h: number, camX: number, camY: number): boolean` — 사각형이 카메라 위치의 640×480 뷰포트와 겹치면 true.
  - `interface PlacedSprite { model: ApdModel; player: AnimPlayer; c: number; r: number }`
  - `interface Overlay { grid: boolean; height: boolean; land: boolean; blocked: boolean }`
  - `interface Scene { map: MapModel | null; sprites: PlacedSprite[]; camera: { x: number; y: number }; overlay: Overlay; seeThrough: boolean }`
  - `class Renderer { constructor(canvas: HTMLCanvasElement); prepareMap(model: MapModel): Promise<void>; prepareApd(model: ApdModel): Promise<void>; draw(scene: Scene): void }`

캔버스 API를 쓰는 `Renderer`는 단위 테스트가 없다. 순수 함수 `rectVisible`만 테스트하고, 그림은 Task 12의 수동 확인으로 검증한다.

- [ ] **Step 1: 컬링 테스트 작성**

`web/test/culling.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { rectVisible } from '../src/render/culling';

describe('rectVisible', () => {
  it('is true when the rect overlaps the 640×480 viewport at the camera', () => {
    expect(rectVisible(0, 0, 64, 32, 0, 0)).toBe(true);
    expect(rectVisible(630, 470, 64, 32, 0, 0)).toBe(true);    // partially inside
    expect(rectVisible(1000, 1000, 64, 32, 400, 600)).toBe(true);
  });
  it('is false when the rect is fully outside', () => {
    expect(rectVisible(640, 0, 64, 32, 0, 0)).toBe(false);     // touching the right edge is outside
    expect(rectVisible(-64, 0, 64, 32, 0, 0)).toBe(false);
    expect(rectVisible(0, 0, 64, 32, 700, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/culling.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 컬링 구현**

`web/src/render/culling.ts`:
```ts
import { VIEW_H, VIEW_W } from '../iso/grid';

/** True when the rect (x, y, w, h) overlaps the 640×480 viewport whose top-left is (camX, camY). */
export function rectVisible(x: number, y: number, w: number, h: number, camX: number, camY: number): boolean {
  return x < camX + VIEW_W && x + w > camX && y < camY + VIEW_H && y + h > camY;
}
```

Run: `cd web && npx vitest run test/culling.test.ts` → `2 passed`.

- [ ] **Step 4: 렌더러 구현**

`web/src/render/renderer.ts`:
```ts
import { IndexedBitmaps } from '../gfx/indexed';
import { TILE_H, TILE_W, VIEW_H, VIEW_W } from '../iso/grid';
import type { MapModel, PlacedCell } from '../map/mapModel';
import type { AnimPlayer } from '../sprite/animPlayer';
import type { ApdModel, DrawCommand } from '../sprite/apdModel';
import { rectVisible } from './culling';

export interface PlacedSprite { model: ApdModel; player: AnimPlayer; c: number; r: number }
export interface Overlay { grid: boolean; height: boolean; land: boolean; blocked: boolean }
export interface Scene { map: MapModel | null; sprites: PlacedSprite[]; camera: { x: number; y: number }; overlay: Overlay; seeThrough: boolean }

type Camera = { x: number; y: number };
interface MapGfx { layers: IndexedBitmaps[]; keys: number[]; bg: IndexedBitmaps | null }

const LAND_COLORS = ['rgba(0,0,0,0)', 'rgba(80,200,80,.35)', 'rgba(60,120,220,.35)', 'rgba(200,170,60,.35)',
  'rgba(160,100,60,.35)', 'rgba(120,120,120,.35)', 'rgba(200,80,200,.35)', 'rgba(80,200,200,.35)'];

/** Draws a Scene into a 640×480 canvas in the original's order (FUN_0042a990): per row s = c + r, back objects → sprites → front objects. */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scratch = document.createElement('canvas');
  private readonly mapBitmaps = new WeakMap<MapModel, MapGfx>();
  private readonly apdBitmaps = new WeakMap<ApdModel, IndexedBitmaps[]>();
  private checker: CanvasPattern | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
  }

  /** Build the (layer, key) bitmaps of a map once. */
  async prepareMap(model: MapModel): Promise<void> {
    if (this.mapBitmaps.has(model)) return;
    const layers = model.layers.map((img) => new IndexedBitmaps(img));
    await Promise.all(layers.map((b, i) => b.prepare(model.layerKeys[i]!)));
    const bg = model.bg ? new IndexedBitmaps(model.bg) : null;
    if (bg) await bg.prepare(null);
    this.mapBitmaps.set(model, { layers, keys: model.layerKeys, bg });
  }

  /** Build the (sheet, key) bitmaps a sprite file needs. */
  async prepareApd(model: ApdModel): Promise<void> {
    if (this.apdBitmaps.has(model)) return;
    const sheets = model.sheets.map((img) => new IndexedBitmaps(img));
    const jobs: Promise<void>[] = [];
    for (const [sheet, keys] of model.keysBySheet()) for (const key of keys) jobs.push(sheets[sheet]!.prepare(key));
    await Promise.all(jobs);
    this.apdBitmaps.set(model, sheets);
  }

  draw(scene: Scene): void {
    const { ctx } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const map = scene.map;
    if (!map) return;
    const gfx = this.mapBitmaps.get(map);
    if (!gfx) throw new Error('map bitmaps not prepared; call prepareMap first');
    const cam = scene.camera;
    if (gfx.bg) ctx.drawImage(gfx.bg.get(null), -cam.x, -cam.y);

    const spritesByRow = new Map<number, PlacedSprite[]>();
    for (const sp of scene.sprites) {
      const s = sp.c + sp.r;
      if (!spritesByRow.has(s)) spritesByRow.set(s, []);
      spritesByRow.get(s)!.push(sp);
    }
    for (const row of map.rows) {
      for (const p of row.cells) this.drawObjects(gfx, p, cam, false, false);
      for (const sp of spritesByRow.get(row.s) ?? []) this.drawSprite(map, sp, cam);
      for (const p of row.cells) this.drawObjects(gfx, p, cam, true, scene.seeThrough);
    }
    this.drawOverlay(map, scene.overlay, cam);
  }

  /** FUN_0042d1e0: the objects of one cell, back (front == 0) or front (front != 0). Mode 4 = checkerboard see-through. */
  private drawObjects(gfx: MapGfx, p: PlacedCell, cam: Camera, front: boolean, seeThrough: boolean): void {
    for (const o of p.cell.objs) {
      if ((o.front !== 0) !== front) continue;
      const w = o.right - o.left, h = o.bottom - o.top;
      const x = p.x + o.ox - cam.x, y = p.y + o.oy - cam.y;
      if (!rectVisible(x, y, w, h, 0, 0)) continue;
      const bmp = gfx.layers[o.layer]!.get(gfx.keys[o.layer]!);
      if (seeThrough) this.drawCheckered(bmp, o.left, o.top, w, h, x, y);
      else this.ctx.drawImage(bmp, o.left, o.top, w, h, x, y, w, h);
    }
  }

  /** FUN_0042a560 / FUN_0042a610: sprite origin = cell anchor + animation offset; each image at origin + (dx, dy). */
  private drawSprite(map: MapModel, sp: PlacedSprite, cam: Camera): void {
    const cell = map.cellAt(sp.c, sp.r);
    const sheets = this.apdBitmaps.get(sp.model);
    if (!cell || !sheets) return;
    const frame = sp.player.frame;
    const ox = cell.x + sp.player.offset.x - cam.x, oy = cell.y + sp.player.offset.y - cam.y;
    const b = sp.model.bounds(frame);
    if (!rectVisible(ox + b.left, oy + b.top, b.right - b.left, b.bottom - b.top, 0, 0)) return;
    for (const c of sp.model.commands(frame)) this.drawCommand(sheets[c.sheet]!.get(c.key), c, ox + c.dx, oy + c.dy);
  }

  private drawCommand(bmp: ImageBitmap, c: DrawCommand, x: number, y: number): void {
    const { ctx } = this;
    if (!c.flipH && !c.flipV) {
      ctx.drawImage(bmp, c.sx, c.sy, c.w, c.h, x, y, c.w, c.h);
      return;
    }
    ctx.save();
    ctx.translate(c.flipH ? x + c.w : x, c.flipV ? y + c.h : y);
    ctx.scale(c.flipH ? -1 : 1, c.flipV ? -1 : 1);
    ctx.drawImage(bmp, c.sx, c.sy, c.w, c.h, 0, 0, c.w, c.h);
    ctx.restore();
  }

  /** Mode 4 of FUN_0042d1e0: pixels whose (screenX + screenY) is odd are dropped. */
  private drawCheckered(bmp: ImageBitmap, sx: number, sy: number, w: number, h: number, x: number, y: number): void {
    const sc = this.scratch;
    if (sc.width < w || sc.height < h) {
      sc.width = Math.max(sc.width, w);
      sc.height = Math.max(sc.height, h);
    }
    const g = sc.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    g.drawImage(bmp, sx, sy, w, h, 0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const pattern = this.checkerPattern(g);
    pattern.setTransform(new DOMMatrix().translate(((x + y) & 1) === 0 ? 0 : 1, 0));
    g.fillStyle = pattern;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(sc, 0, 0, w, h, x, y, w, h);
  }

  private checkerPattern(g: CanvasRenderingContext2D): CanvasPattern {
    if (this.checker) return this.checker;
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    const cg = c.getContext('2d')!;
    cg.fillStyle = '#fff';
    cg.fillRect(0, 0, 1, 1);
    cg.fillRect(1, 1, 1, 1);          // keep pixels where (u + v) is even
    this.checker = g.createPattern(c, 'repeat')!;
    return this.checker;
  }

  private drawOverlay(map: MapModel, ov: Overlay, cam: Camera): void {
    if (!ov.grid && !ov.height && !ov.land && !ov.blocked) return;
    const { ctx } = this;
    ctx.save();
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    for (const row of map.rows) {
      for (const p of row.cells) {
        const x = p.x - cam.x, y = p.y - cam.y;
        if (!rectVisible(x - TILE_W / 2, y - TILE_H / 2, TILE_W, TILE_H, 0, 0)) continue;
        ctx.beginPath();
        ctx.moveTo(x - TILE_W / 2, y);
        ctx.lineTo(x, y - TILE_H / 2);
        ctx.lineTo(x + TILE_W / 2, y);
        ctx.lineTo(x, y + TILE_H / 2);
        ctx.closePath();
        if (ov.land) { ctx.fillStyle = LAND_COLORS[p.cell.land] ?? 'rgba(255,255,255,.3)'; ctx.fill(); }
        if (ov.blocked && p.cell.blocked) { ctx.fillStyle = 'rgba(255,40,40,.45)'; ctx.fill(); }
        if (ov.grid) { ctx.strokeStyle = 'rgba(80,255,80,.8)'; ctx.stroke(); }
        if (ov.height && p.cell.h) { ctx.fillStyle = '#fff'; ctx.fillText(String(p.cell.h), x, y + 4); }
      }
    }
    ctx.restore();
  }
}
```

- [ ] **Step 5: 타입 검사와 테스트**

Run: `cd web && npm run check`
Expected: tsc 오류 0, `culling` 2개 포함 모든 테스트 통과.

- [ ] **Step 6: 커밋**

```bash
git add web/src/render/renderer.ts web/src/render/culling.ts web/test/culling.test.ts
git commit -m "feat(web): Canvas 2D renderer with row-ordered objects/sprites, see-through and debug overlays

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: 뷰어 `viewer/main.ts`, `viewer/scale.ts`, `index.html`, README

**Files:**
- Create: `web/src/viewer/scale.ts`
- Create: `web/test/scale.test.ts`
- Create: `web/src/viewer/main.ts`
- Modify: `web/index.html`
- Create: `web/README.md`

**Interfaces:**
- Consumes: `AssetLoader`, `AssetError` (Task 10), `MapModel` (Task 6), `ApdModel` (Task 9), `AnimPlayer` (Task 8), `Renderer`, `Scene`, `PlacedSprite` (Task 11), `VIEW_W`, `VIEW_H` (Task 5).
- Produces: `function fitScale(availW: number, availH: number): number` — 640×480이 들어가는 가장 큰 정수 배율, 최소 1. `function clampCamera(x: number, y: number, pixelW: number, pixelH: number): { x: number; y: number }`.

- [ ] **Step 1: 배율·카메라 테스트 작성**

`web/test/scale.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { clampCamera, fitScale } from '../src/viewer/scale';

describe('fitScale', () => {
  it('picks the largest integer scale that fits', () => {
    expect(fitScale(1920, 1080)).toBe(2);
    expect(fitScale(2000, 1500)).toBe(3);
    expect(fitScale(1279, 960)).toBe(1);
  });
  it('never goes below 1', () => {
    expect(fitScale(320, 200)).toBe(1);
  });
});

describe('clampCamera', () => {
  it('keeps the viewport inside the map pixel area', () => {
    expect(clampCamera(-10, -11, 1344, 896)).toEqual({ x: 0, y: 0 });
    expect(clampCamera(5000, 5000, 1344, 896)).toEqual({ x: 1344 - 640, y: 896 - 480 });
    expect(clampCamera(100, 50, 1344, 896)).toEqual({ x: 100, y: 50 });
  });
  it('is always (0, 0) for a 640×480 map', () => {
    expect(clampCamera(64, 48, 640, 480)).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/scale.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: `scale.ts` 구현**

`web/src/viewer/scale.ts`:
```ts
import { VIEW_H, VIEW_W } from '../iso/grid';

/** Largest integer CSS scale at which 640×480 fits the available area; never below 1 (the page scrolls instead). */
export function fitScale(availW: number, availH: number): number {
  return Math.max(1, Math.floor(Math.min(availW / VIEW_W, availH / VIEW_H)));
}

/** Camera top-left clamped so the 640×480 viewport stays inside the map (FUN_00431460 scroll limits). */
export function clampCamera(x: number, y: number, pixelW: number, pixelH: number): { x: number; y: number } {
  return { x: Math.min(Math.max(0, x), Math.max(0, pixelW - VIEW_W)), y: Math.min(Math.max(0, y), Math.max(0, pixelH - VIEW_H)) };
}
```

Run: `cd web && npx vitest run test/scale.test.ts` → `4 passed`.

- [ ] **Step 4: 페이지와 뷰어 작성**

`web/index.html`:
```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FT2 viewer</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #14120e; color: #eae4d6; font: 13px/1.4 system-ui, sans-serif; display: flex; min-height: 100vh; }
  #panel { width: 260px; padding: 12px; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; background: #1e1a14; }
  #panel label { display: flex; flex-direction: column; gap: 2px; }
  #panel select, #panel button { font: inherit; }
  #stage { flex: 1; display: grid; place-items: center; overflow: auto; }
  canvas { image-rendering: pixelated; image-rendering: crisp-edges; background: #000; }
  #status { font-family: ui-monospace, monospace; white-space: pre-wrap; }
  #error { color: #ff6b6b; font-family: ui-monospace, monospace; white-space: pre-wrap; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
</head>
<body>
<aside id="panel">
  <label>맵 <select id="map"></select></label>
  <label>스프라이트 <select id="sprite"></select></label>
  <label>애니 <select id="anim"></select></label>
  <div class="row">
    <button id="clear">배치 전부 지우기</button>
  </div>
  <div class="row">
    <label><input type="checkbox" id="grid" checked> 격자</label>
    <label><input type="checkbox" id="height"> 높이</label>
    <label><input type="checkbox" id="land"> land</label>
    <label><input type="checkbox" id="blocked"> blocked</label>
    <label><input type="checkbox" id="loop" checked> 반복</label>
  </div>
  <div>셀 클릭: 선택한 애니를 배치 · 방향키/드래그: 스크롤 · Shift: 투시</div>
  <div id="status"></div>
  <div id="error"></div>
</aside>
<main id="stage"><canvas id="view"></canvas></main>
<script type="module" src="/src/viewer/main.ts"></script>
</body>
</html>
```

`web/src/viewer/main.ts`:
```ts
import { AssetError, AssetLoader } from '../assets/loader';
import { VIEW_H, VIEW_W } from '../iso/grid';
import { MapModel } from '../map/mapModel';
import { AnimPlayer } from '../sprite/animPlayer';
import { ApdModel } from '../sprite/apdModel';
import { Renderer, type PlacedSprite, type Scene } from '../render/renderer';
import { clampCamera, fitScale } from './scale';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>('view');
const renderer = new Renderer(canvas);
const loader = new AssetLoader();
const scene: Scene = { map: null, sprites: [], camera: { x: 0, y: 0 }, overlay: { grid: true, height: false, land: false, blocked: false }, seeThrough: false };
let apd: ApdModel | null = null;
let hover: { c: number; r: number } | null = null;

function showError(e: unknown): void {
  const msg = e instanceof AssetError ? e.message : e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  $('error').textContent = msg;
  console.error(e);
}

function resize(): void {
  const stage = $('stage');
  const k = fitScale(stage.clientWidth - 16, stage.clientHeight - 16);
  canvas.style.width = `${VIEW_W * k}px`;
  canvas.style.height = `${VIEW_H * k}px`;
}

async function loadMap(name: string): Promise<void> {
  $('error').textContent = '';
  const data = await loader.map(name);
  const layers = await Promise.all(data.layers.map((n) => loader.image('map', n)));
  const bg = data.bg ? await loader.image('map', data.bg).catch((e: unknown) => { showError(e); return null; }) : null;
  const model = new MapModel(data, layers, bg);
  await renderer.prepareMap(model);
  scene.map = model;
  scene.sprites = [];
  scene.camera = clampCamera(data.start[0] * 32, data.start[1] * 16, data.pixelSize[0], data.pixelSize[1]);
}

async function loadApd(name: string): Promise<void> {
  const data = await loader.apd(name);
  const sheets = await Promise.all(data.sheets.map((n) => loader.image('sprite', n)));
  const model = new ApdModel(name, data, sheets);
  await renderer.prepareApd(model);
  apd = model;
  const animSel = $<HTMLSelectElement>('anim');
  animSel.replaceChildren(...model.animNames().map((n) => Object.assign(document.createElement('option'), { value: n, textContent: n })));
  if (model.errors.length) showError(model.errors.map((e) => e.message).join('\n'));
}

function placeSprite(c: number, r: number): void {
  if (!apd) return;
  const tl = apd.anim($<HTMLSelectElement>('anim').value);
  if (!tl) return;
  const player = new AnimPlayer(tl, { loop: $<HTMLInputElement>('loop').checked });
  scene.sprites.push({ model: apd, player, c, r } satisfies PlacedSprite);
}

function canvasPoint(ev: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: ((ev.clientX - rect.left) / rect.width) * VIEW_W + scene.camera.x, y: ((ev.clientY - rect.top) / rect.height) * VIEW_H + scene.camera.y };
}

function updateStatus(): void {
  const map = scene.map;
  const cell = map && hover ? map.cellAt(hover.c, hover.r) : null;
  const frames = scene.sprites.map((s) => `${s.player.timeline.name}#${s.player.stepIndex}/${s.player.frame.pattern}`).join(' ');
  $('status').textContent = cell
    ? `cell (${cell.c}, ${cell.r}) h=${cell.cell.h} land=${cell.cell.land} blocked=${cell.cell.blocked} flag2=${cell.cell.flag2} objs=${cell.cell.objs.length}\ncam (${scene.camera.x}, ${scene.camera.y})\n${frames}`
    : `cam (${scene.camera.x}, ${scene.camera.y})\n${frames}`;
}

function frame(now: number): void {
  for (const sp of scene.sprites) sp.player.update(now);
  renderer.draw(scene);
  updateStatus();
  requestAnimationFrame(frame);
}

function bind(): void {
  const mapSel = $<HTMLSelectElement>('map'), spriteSel = $<HTMLSelectElement>('sprite');
  mapSel.addEventListener('change', () => loadMap(mapSel.value).catch(showError));
  spriteSel.addEventListener('change', () => loadApd(spriteSel.value).catch(showError));
  $('clear').addEventListener('click', () => { scene.sprites = []; });
  for (const key of ['grid', 'height', 'land', 'blocked'] as const) {
    $<HTMLInputElement>(key).addEventListener('change', (e) => { scene.overlay[key] = (e.target as HTMLInputElement).checked; });
  }
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  canvas.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: scene.camera.x, cy: scene.camera.y }; });
  window.addEventListener('mouseup', (e) => {
    if (!drag) return;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3;
    drag = null;
    if (moved || !scene.map) return;
    const pt = canvasPoint(e);
    const cell = scene.map.pick(pt.x, pt.y);
    if (cell) placeSprite(cell.c, cell.r);
  });
  canvas.addEventListener('mousemove', (e) => {
    const map = scene.map;
    if (!map) return;
    if (drag) {
      const k = canvas.getBoundingClientRect().width / VIEW_W;
      scene.camera = clampCamera(drag.cx - (e.clientX - drag.x) / k, drag.cy - (e.clientY - drag.y) / k, map.data.pixelSize[0], map.data.pixelSize[1]);
      return;
    }
    const pt = canvasPoint(e);
    const cell = map.pick(pt.x, pt.y);
    hover = cell ? { c: cell.c, r: cell.r } : null;
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') scene.seeThrough = true;
    const map = scene.map;
    if (!map) return;
    const step = e.shiftKey ? 64 : 16;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = d[e.key];
    if (m) { scene.camera = clampCamera(scene.camera.x + m[0], scene.camera.y + m[1], map.data.pixelSize[0], map.data.pixelSize[1]); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') scene.seeThrough = false; });
  window.addEventListener('resize', resize);
}

async function main(): Promise<void> {
  bind();
  resize();
  const index = await loader.index();
  const option = (v: string) => Object.assign(document.createElement('option'), { value: v, textContent: v });
  $<HTMLSelectElement>('map').replaceChildren(...index.maps.map(option));
  $<HTMLSelectElement>('sprite').replaceChildren(...index.sprites.map(option));
  const firstMap = index.maps.includes('stage02') ? 'stage02' : index.maps[0];
  const firstSprite = index.sprites.includes('char_01a') ? 'char_01a' : index.sprites[0];
  if (firstMap) { $<HTMLSelectElement>('map').value = firstMap; await loadMap(firstMap); }
  if (firstSprite) { $<HTMLSelectElement>('sprite').value = firstSprite; await loadApd(firstSprite); }
  requestAnimationFrame(frame);
}

main().catch(showError);
```

`web/README.md`:
```markdown
# FT2 web viewer (sub-project 1: rendering foundation)

Spec: `../docs/superpowers/specs/2026-10-14-rendering-foundation-design.md`

## 1. Export the assets (once, and after changing the exporter)

    python3 -I ../tools/ft2_export.py ../extracted/FarlandTactics2 public/assets

Expected: `maps 76, sprites 312, pngs 631, warnings 4, errors 0`. `public/assets/` is git-ignored.

## 2. Run

    npm install
    npm run dev        # http://localhost:5173

Controls: map / sprite / anim selectors, click a cell to place the selected anim, arrow keys or drag to scroll, hold Shift for see-through, checkboxes for overlays.

## 3. Check

    npm run check      # tsc --noEmit && vitest run

Corpus tests (`test/corpus.test.ts`) run only when `public/assets/index.json` exists.
```

- [ ] **Step 5: 타입 검사 후 수동 확인**

Run: `cd web && npm run check` → tsc 오류 0, 모든 테스트 통과.
Run: `cd web && npm run dev` 후 브라우저에서 `http://localhost:5173` 열기. 다음을 확인하고 결과를 커밋 메시지에 적는다.

1. stage02가 뜬다. 격자 마름모가 바닥 타일과 맞는다. 콘솔 오류 0.
2. stage51(오브젝트 최다)과 stage57(최대 픽셀)로 바꿔 스크롤한다. 끊김이 없다.
3. stage06(레이어 키 253)과 stage32로 바꾼다. 배경 가장자리와 레이어 투명이 올바른지 본다. 이상하면 스펙 §13의 배경 배치 항목에 관찰 결과를 적는다.
4. char_01a F.STAND를 빈 바닥 셀에 놓는다. 캐릭터가 마름모 중앙에 서 있고 발이 중심 조금 아래에 있다.
5. 같은 캐릭터를 나무·기둥 앞 오브젝트(front=1) 뒤 셀에 놓는다. 가려진다. Shift를 누르면 체커보드로 비친다.
6. B.STAND(뒷모습)와 H 반전이 들어간 애니(예: char_01b F.ATTACK6)를 재생한다. 반복 체크를 끄고 다시 놓으면 한 번만 재생되고 마지막 프레임에 멈춘다.
7. 창 크기를 바꾼다. 캔버스가 정수 배율로만 커지고 작아진다.

- [ ] **Step 6: 커밋**

```bash
git add web/index.html web/src/viewer/main.ts web/src/viewer/scale.ts web/test/scale.test.ts web/README.md
git commit -m "feat(web): development viewer (map/sprite selection, placement, scroll, overlays)

Manual check: stage02/51/57/06/32 render; sprites occlude behind front objects; Shift see-through works.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: 코퍼스 테스트 `test/corpus.test.ts`

**Files:**
- Create: `web/test/corpus.test.ts`

**Interfaces:**
- Consumes: 변환된 자산 `web/public/assets/` (Task 1), `decodeIndexedPng` (Task 3), `MapModel`, `layerKey` (Task 6), `compileAll` (Task 7), `ApdModel` (Task 9), 타입(Task 2).

자산이 없으면 전체를 건너뛴다. 있으면 스펙 §11의 코퍼스 기준을 검사한다.

- [ ] **Step 1: 테스트 작성**

`web/test/corpus.test.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeIndexedPng } from '../src/assets/png';
import type { ApdData, AssetIndex, MapData } from '../src/assets/types';
import { layerKey, MapModel } from '../src/map/mapModel';
import { compileAll } from '../src/sprite/animScript';
import { ApdModel } from '../src/sprite/apdModel';

const ASSETS = fileURLToPath(new URL('../public/assets/', import.meta.url));
const available = existsSync(join(ASSETS, 'index.json'));
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(ASSETS, rel), 'utf-8')) as T;
const readPng = (rel: string) => { const b = readFileSync(join(ASSETS, rel)); return decodeIndexedPng(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

/** Anims whose script indexes a pattern past the end of the file (spec §13); the original reads garbage there. */
const KNOWN_BAD_ANIMS = new Set(['char_28b/B.ATTACK1', 'char_68v/F.FLOAT']);

describe.skipIf(!available)('exported corpus', () => {
  const index = available ? readJson<AssetIndex>('index.json') : { format: 1 as const, maps: [], sprites: [] };

  it('has 76 maps and 312 sprites', () => {
    expect(index.maps).toHaveLength(76);
    expect(index.sprites).toHaveLength(312);
  });

  it('every map builds a MapModel whose cellAt covers exactly its cells', async () => {
    for (const name of index.maps) {
      const data = readJson<MapData>(`map/${name}.json`);
      const layers = await Promise.all(data.layers.map((l) => readPng(`map/${l}.png`)));
      const model = new MapModel(data, layers, null);
      const covered = model.rows.reduce((n, r) => n + r.cells.length, 0);
      expect(covered, name).toBe(data.cells.length);
      expect(new Set(data.cellAt.filter((i) => i >= 0)).size, name).toBe(data.cells.length);
    }
  }, 60_000);

  it('layer color keys follow the top-left rule and are reserved indices', async () => {
    const seen = new Set<string>();
    const keys: Record<number, number> = {};
    for (const name of index.maps) {
      for (const l of readJson<MapData>(`map/${name}.json`).layers) {
        if (seen.has(l) || !existsSync(join(ASSETS, `map/${l}.png`))) continue;
        seen.add(l);
        const k = layerKey(await readPng(`map/${l}.png`));
        expect(k <= 9 || k >= 246, l).toBe(true);
        keys[k] = (keys[k] ?? 0) + 1;
      }
    }
    console.info('layer keys:', keys);          // expected to be dominated by 249 with 250/252/253/255
    expect(seen.size).toBeGreaterThan(90);
  }, 60_000);

  it('compiles every animation except the two known bad ones; reports @ references to earlier anims', () => {
    const bad: string[] = [];
    let earlyRefs = 0;
    for (const name of index.sprites) {
      const apd = readJson<ApdData>(`sprite/${name}.json`);
      const { errors } = compileAll(apd);
      for (const e of errors) bad.push(`${name}/${e.anim}`);
      apd.anims.forEach((a, i) => {
        for (const m of a.script.matchAll(/@([^,\s]+)/g)) {
          const target = apd.anims.findIndex((x) => x.name.toUpperCase() === m[1]!.toUpperCase());
          if (target >= 0 && target <= i) earlyRefs++;
        }
      });
    }
    console.info('@ references to earlier anims:', earlyRefs);
    expect(new Set(bad)).toEqual(KNOWN_BAD_ANIMS);
  });

  it('every sprite with all sheets present builds an ApdModel', async () => {
    let built = 0, skipped = 0;
    for (const name of index.sprites) {
      const apd = readJson<ApdData>(`sprite/${name}.json`);
      if (!apd.sheets.every((s) => existsSync(join(ASSETS, `sprite/${s}.png`)))) { skipped++; continue; }
      const sheets = await Promise.all(apd.sheets.map((s) => readPng(`sprite/${s}.png`)));
      new ApdModel(name, apd, sheets);
      built++;
    }
    console.info(`apd models built: ${built}, skipped (missing sheet): ${skipped}`);
    expect(skipped).toBeLessThanOrEqual(5);
    expect(built + skipped).toBe(312);
  }, 120_000);
});
```

- [ ] **Step 2: 자산 없이 실행해 건너뛰는지 확인**

Run: `cd web && mv public/assets public/assets.off && npx vitest run test/corpus.test.ts; mv public/assets.off public/assets`
Expected: `skipped` 5개, 실패 0.

- [ ] **Step 3: 자산과 함께 실행**

Run: `cd web && npx vitest run test/corpus.test.ts`
Expected: 5개 통과. 콘솔에 `layer keys: {249: …, 250: …, 252: …, 253: …, 255: …}`, `@ references to earlier anims: 0`, `apd models built: N, skipped: ≤5`. 다른 값이 나오면 스펙 §13에 관찰 결과를 적고, 테스트가 아니라 스펙의 기대치를 확인한다.

- [ ] **Step 4: 전체 검사**

Run: `cd web && npm run check`
Expected: tsc 오류 0, 모든 테스트 통과.

- [ ] **Step 5: 커밋**

```bash
git add web/test/corpus.test.ts
git commit -m "test(web): corpus checks over every exported map and sprite

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 완료 기준

- `python3 -I tools/ft2_export.py extracted/FarlandTactics2 web/public/assets` → 오류 0.
- `cd web && npm run check` → tsc 오류 0, 단위 테스트와 코퍼스 테스트 전부 통과.
- Task 12 Step 5의 수동 확인 7개 항목이 모두 정상이다.
- 스펙 §13의 미확인 항목 중 뷰어로 확인하기로 한 것(배경 배치, `start` 필드)에 관찰 결과가 적혀 있다.
