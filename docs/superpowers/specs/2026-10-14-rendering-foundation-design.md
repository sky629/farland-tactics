# 렌더링 기반 설계 — 파랜드 택틱스 2 웹 리메이크, 하위 프로젝트 1

작성일 2026-10-14. 상태: 초안, 사용자 검토 대기.
근거 문서: `analysis/file_formats.md`, `analysis/report.html`. 함수 주소는 `FT2.exe` 기준이다.
표기: **관찰** = 디컴파일 코드로 확인함. **추정** = 데이터 패턴으로 추론함. **결정** = 이 설계에서 정한 것.

## 1. 목표

브라우저에서 원작의 맵과 스프라이트를 원작과 같은 모습으로 그린다. 이 하위 프로젝트가 끝나면 다음 두 가지가 가능하다.

1. 맵 76개 중 하나를 골라 화면에 띄우고, 스크롤하고, 셀 정보를 본다.
2. 스프라이트 312개 중 하나를 골라 애니메이션을 재생하고, 맵의 셀 위에 올려 깊이 순서를 확인한다.

이후 하위 프로젝트(필드 모드, 전투, 스크립트 VM, 세이브·사운드·UI)는 이 렌더러 위에서 만든다.

## 2. 범위

포함:

- 자산 변환기 `tools/ft2_export.py`: 원본 폴더 → `web/public/assets/`.
- 웹 프로젝트 `web/`: TypeScript + Vite + Canvas 2D + Vitest.
- 인덱스 PNG 디코더, 색 키 처리, 맵 모델, 좌표계, 장면 렌더러, 애니 스크립트 컴파일러, 애니 플레이어, 개발용 뷰어.

제외(후속 하위 프로젝트):

- 유닛·스테이지 배치(`STAGE%03d.dat`), 이동 범위, 커서 이동 규칙, 메뉴.
- 이벤트 스크립트, 대사 창, `bmp/` UI 이미지, 한글 폰트.
- 사운드(WAV, MIDI), 팔레트 애니메이션, 팔레트 페이드.
- 세이브.
- `char_%02d%c.apd`의 문자(`a`, `b`, `e`, `k`, `v`, `z`) 선택 규칙.

## 3. 확정된 결정

| 번호 | 결정 | 이유 |
|---|---|---|
| D1 | 자산은 빌드 시 Python으로 변환하고 로컬에만 둔다. git에 넣지 않는다. | 개인 플레이 용도. 저작권 자산을 배포하지 않는다. |
| D2 | 원작 그대로 재현한다. 640×480 정수 배율, 원작 규칙과 특이점 유지. | 원본과 직접 대조해 검증할 수 있다. |
| D3 | TypeScript(strict) + Vite + Canvas 2D. 게임 프레임워크 없음. | 8비트 팔레트와 색 키를 직접 제어한다. 의존성 최소. |
| D4 | 매 프레임 전체를 다시 그린다. 더티 사각형 없음. | 맵당 오브젝트 최대 1,647개(stage51). Canvas 2D로 충분하다. |
| D5 | 애니 스크립트는 TypeScript가 로드 시 컴파일한다. | 의미 해석을 한 언어에 모은다. 312개 전수 테스트가 쉽다. |
| D6 | 이미지는 브라우저에서도 8비트 인덱스로 유지한다. 팔레트 → RGBA 변환은 렌더러가 (시트, 색 키)마다 한 번 하고 캐시한다. | 색 키가 이미지마다 다르다(§6). 팔레트를 보존해야 이후 페이드·물 애니를 재현할 수 있다. |

원칙: **Python은 바이트를 풀고, TypeScript는 의미를 해석한다.** 색 키 규칙, 그리기 순서, 스크립트 문법은 모두 TypeScript에 있다.

## 4. 전체 구조

### 4.1 디렉터리

```
farland_tactics/
  tools/ft2_export.py            신규. ft2_szdd/ft2_map/ft2_apd를 호출해 자산을 쓴다
  web/
    package.json  vite.config.ts  tsconfig.json  index.html
    public/assets/               생성물. git 제외
      index.json
      map/<name>.json  map/<sheet>.png
      sprite/<name>.json  sprite/<sheet>.png
    src/
      assets/types.ts            JSON 스키마의 TS 타입 (§5.3)
      assets/png.ts              인덱스 PNG 디코더 → IndexedImage (§6.1)
      assets/loader.ts           fetch + 캐시. 이름은 소문자
      gfx/indexed.ts             IndexedImage, (이미지, 키) → ImageBitmap 캐시 (§6.3)
      iso/grid.ts                셀 좌표 ↔ 화면 좌표, 행 순회, 피킹 (§7)
      map/mapModel.ts            MapData → 행별 셀 목록, 레이어 색 키 (§6.2)
      sprite/animScript.ts       스크립트 → Timeline 컴파일러 (§8)
      sprite/animPlayer.ts       Timeline 재생 (§8.4)
      sprite/apdModel.ts         ApdData + 시트 → 패턴 그리기 정보
      render/renderer.ts         640×480 백버퍼, 카메라, 장면 그리기, 오버레이 (§7)
      viewer/main.ts             개발용 뷰어 (§9)
    test/                        Vitest
```

### 4.2 모듈 책임

| 모듈 | 하는 일 | 입력 | 출력 | 의존 |
|---|---|---|---|---|
| `assets/png.ts` | PNG 바이트를 디코드한다 | ArrayBuffer | `IndexedImage` | 없음 (DecompressionStream) |
| `assets/loader.ts` | 자산을 받아 캐시한다 | 자산 이름 | `MapData`, `ApdData`, `IndexedImage` | `png.ts`, `types.ts` |
| `gfx/indexed.ts` | 인덱스 이미지를 색 키 적용 RGBA 비트맵으로 바꾼다 | `IndexedImage`, 키 | `ImageBitmap` | 없음 |
| `iso/grid.ts` | 셀과 화면 좌표를 바꾼다 | w, h, origin, 셀 높이 | 좌표, 행 목록 | 없음 |
| `map/mapModel.ts` | 맵 JSON을 그리기용 구조로 바꾼다 | `MapData`, 레이어 이미지 | `MapModel` | `grid.ts`, `indexed.ts` |
| `sprite/animScript.ts` | 스크립트를 타임라인으로 컴파일한다 | `ApdData` | `Timeline[]` | 없음 |
| `sprite/animPlayer.ts` | 시간에 따라 프레임과 이동량을 계산한다 | `Timeline`, 시각 | 현재 프레임, 오프셋, 이벤트 | 없음 |
| `sprite/apdModel.ts` | 패턴의 이미지 목록과 반전 배치를 계산한다 | `ApdData`, 시트 이미지 | 그리기 명령 | `indexed.ts` |
| `render/renderer.ts` | 장면을 그린다 | `MapModel`, 배치 스프라이트, 카메라, 옵션 | 캔버스 픽셀 | 위 전부 |
| `viewer/main.ts` | 사용자 입력을 상태로 바꾼다 | DOM 이벤트 | 렌더러 호출 | 위 전부 |

각 모듈은 내부를 몰라도 쓸 수 있어야 한다. 모듈 간 통신은 §5.3의 타입과 이 문서의 함수 시그니처로만 한다.

### 4.3 데이터 흐름

```
원본 폴더 ──(ft2_export.py)──▶ assets/*.json, *.png (인덱스 PNG, 팔레트 보존, 투명 없음)
                                        │
   loader.fetchMap(name) ───────────────┤──▶ MapData + 레이어 IndexedImage ──▶ MapModel
   loader.fetchApd(name) ───────────────┘──▶ ApdData + 시트 IndexedImage ──▶ Timeline[] + ApdModel
                                                                            │
   AnimPlayer.update(now) ──▶ {frame, offset}                               │
                                   │                                        │
   Renderer.draw(scene) ◀──────────┴────────────────────────────────────────┘
       행 s = c+r 오름차순: 뒤 오브젝트 → 스프라이트 → 앞 오브젝트
```

## 5. 자산 변환 (`tools/ft2_export.py`)

### 5.1 입력과 출력

```
python3 -I tools/ft2_export.py GAME_DIR OUT_DIR
```

- 입력: 추출한 게임 폴더(`Map/`, `Sprite/`). 다른 폴더는 이 하위 프로젝트에서 읽지 않는다.
- 출력: `OUT_DIR/index.json`, `OUT_DIR/map/*.json|*.png`, `OUT_DIR/sprite/*.json|*.png`.
- 기존 파서를 import해서 쓴다. 변환기는 파서 결과를 JSON으로 적고 PNG를 쓰는 접착 코드다.
- 종료 코드: 오류가 하나라도 있으면 1. 경고만 있으면 0.

### 5.2 PNG 규칙

- 모든 BMP(맵 배경, 맵 레이어, 스프라이트 시트)를 **8비트 인덱스 PNG**로 쓴다. 팔레트 256색을 그대로 보존한다.
- `tRNS` 청크를 쓰지 않는다. 투명은 TypeScript가 색 키로 처리한다(§6.2).
- 필터 0, 비인터레이스, IDAT 하나. 디코더(§6.1)는 이 형식만 받는다.
- 기존 `ft2_szdd.bmp8_to_png`를 쓴다. `--key` 옵션은 제거한다(이 설계에서 쓰지 않는다).
- 맵 팔레트 재배치(10..121 → 32..143, `FUN_00434250`)는 하지 않는다. 색은 같고 인덱스만 다르다. 색 키 규칙(§6.2)은 원본 인덱스 기준으로 쓴다.

### 5.3 JSON 스키마

TypeScript 타입으로 적는다. 변환기와 `assets/types.ts`는 이 타입을 똑같이 따른다.

```ts
// assets/index.json
interface AssetIndex {
  format: 1;
  maps: string[];      // 예: "stage02". 소문자 stem
  sprites: string[];   // 예: "char_01a"
}

// assets/map/<name>.json  (원본 FM2, analysis/file_formats.md §2)
interface MapObject { layer: number; front: number; left: number; top: number; right: number; bottom: number; ox: number; oy: number }
interface MapCell { h: number; blocked: number; flag2: number; land: number; objs: MapObject[] }
interface MapData {
  w: number; h: number;
  bg: string | null;        // 배경 PNG 이름. 예: "st02a" → assets/map/st02a.png
  layers: string[];         // 레이어 PNG 이름
  start: [number, number];  // 원본 0x28, 0x2C
  origin: [number, number]; // ((top-left)*32, -(top+left)*16)
  pixelSize: [number, number];
  cells: MapCell[];         // 원본 셀 레코드 순서
  cellAt: number[];         // 길이 N*N, N = w+h-1. cellAt[c*N + r] = cells 인덱스 또는 -1
}

// assets/sprite/<name>.json  (원본 APD, analysis/file_formats.md §3)
interface ApdImage { sheet: number; key: number; x: number; y: number; w: number; h: number; ox: number; oy: number }
interface ApdPattern { yOffset: number; images: number[] }
interface ApdAnim { name: string; script: string }   // script는 원문 그대로
interface ApdData { version: number; sheets: string[]; images: ApdImage[]; patterns: ApdPattern[]; anims: ApdAnim[] }
```

- `cellAt`는 Python의 `cell_index`(`FUN_0042d960` 이식)로 만든다. TypeScript는 이 표만 쓴다.
- `ApdImage.key`는 원본 이미지 레코드의 `flag` 바이트다. 의미는 §6.2에 있다.
- `ApdPattern.yOffset`은 원본 패턴 레코드 +4의 u16이다(i16로 해석). 원본 +0의 u32는 게임이 읽지 않으므로 내보내지 않는다.

### 5.4 이름 정규화

- 출력 파일 이름과 JSON 안의 모든 참조 이름은 **소문자 stem**이다. 원본은 `CHAR_05a.APD`, `Char_01g.bmp`, `st02a.bmp`처럼 대소문자가 섞여 있다.
- APD 시트 이름 → `.bmp` 확장자를 떼고 소문자로 바꾼 뒤 `Sprite/` 폴더에서 대소문자 무시로 찾는다.
- 소문자로 바꾼 뒤 이름이 겹치면 오류다.
- 시트 이름 뒤에 쓰레기 바이트가 붙은 경우(`npc_24.bmp..`)는 첫 `.bmp`까지만 쓴다. 그래도 파일이 없으면 경고로 보고하고 JSON은 그대로 쓴다.

### 5.5 검증과 보고

변환기는 끝에 다음을 출력한다.

- 맵 수(76), 스프라이트 수(312), PNG 수.
- 참조 무결성: 맵 레이어·배경 파일 존재, APD 시트 파일 존재, 이미지 RECT가 시트 안에 있는지, 패턴의 이미지 번호가 범위 안인지, 오브젝트의 레이어 번호가 범위 안인지.
- 존재하지 않는 시트 참조는 경고. 그 밖의 위반은 오류.

## 6. 인덱스 이미지와 색 키

### 6.1 PNG 디코더 (`assets/png.ts`)

```ts
interface IndexedImage { width: number; height: number; indices: Uint8Array; palette: Uint8Array /* 768 B, RGB */ }
function decodeIndexedPng(buf: ArrayBuffer): Promise<IndexedImage>
```

- 받는 형식: 색 타입 3, 비트 깊이 8, 비인터레이스, 필터 0. 그 밖은 형식 이름을 포함한 오류를 던진다.
- 압축 해제는 `DecompressionStream("deflate")`를 쓴다(zlib 스트림). 브라우저와 Node 18+에서 모두 쓸 수 있다.
- 여러 IDAT는 이어 붙여 처리한다.

### 6.2 색 키 규칙 — 관찰

| 대상 | 키 | 근거 |
|---|---|---|
| 스프라이트 이미지 | 이미지 레코드의 `key`(flag) 바이트. APD 버전 < 2이면 항상 255 | `FUN_00428620`이 +0x1c에 저장, `FUN_0042a610` → `FUN_0040e0a0`이 블릿 직전에 SetColorKey |
| 맵 레이어 시트 | 시트의 **좌상단 픽셀** 인덱스 `p`. `10 ≤ p ≤ 245`이면 249로 대체 | `FUN_00431460`: 마지막 저장 행(= 윗줄) 첫 바이트를 읽고 `9 < p < 0xF6`이면 `0xF9` |
| 맵 배경 | 없음(불투명) | 배경은 색 키 없이 전체 블릿 |

데이터로 확인한 사실:

- 스프라이트 이미지 9,673개의 키 분포: 253(5,741), 255(2,186), 250(784), 249(592), 254(338), 252(117), 251(40).
- 키가 255인 이미지 500개의 사각형 안에 인덱스 246이 실제 색으로 들어 있다. 키 253인 이미지 101개 안에 255가 들어 있다. 그래서 "246 이상 투명" 규칙은 틀렸다. 투명은 반드시 이미지의 키 하나로만 판정한다.
- 맵 레이어 시트 102개 중 97개는 좌상단 픽셀이 시트의 지배적 예약 인덱스와 같다. 나머지 5개는 좌상단이 일반 색(67, 70, 121)이고 규칙에 따라 249가 된다.

### 6.3 비트맵 캐시 (`gfx/indexed.ts`)

```ts
class IndexedBitmaps {
  constructor(image: IndexedImage)
  prepare(key: number | null): Promise<void>   // (이미지, 키) 비트맵을 만들어 캐시한다. key === null → 불투명
  get(key: number | null): ImageBitmap         // prepare 전에 부르면 오류
}
```

- (이미지, 키) 조합마다 RGBA `ImageData`를 만들고 `createImageBitmap`으로 바꾼다. 결과를 Map에 캐시한다.
- 필요한 (시트, 키) 조합은 모델을 만들 때 모두 알 수 있다(레이어 키, 이미지 키). `MapModel`과 `ApdModel` 생성이 `prepare`를 끝낸 뒤 완료되므로, 그리기 경로는 동기다.
- 스프라이트 시트 하나에 키가 2개 이상 쓰이는 경우가 있다(`char_00m.bmp`: 253, 255. `st41c.bmp`: 254, 255). 그래서 캐시 키는 (시트, 색 키)다.
- 팔레트는 `IndexedImage`에 남아 있다. 후속 하위 프로젝트의 팔레트 페이드는 같은 클래스에 변환 함수를 추가해서 만든다.

## 7. 좌표계와 장면 그리기

### 7.1 셀 앵커 — 관찰

셀 (c, r)의 앵커는 **마름모(64×32)의 중심**이다.

```
N        = w + h - 1                       // c, r의 범위 0..N-1
anchor_x = (c - r) * 32 + origin_x
anchor_y = (c + r) * 16 + origin_y - h_cell * 8
마름모 꼭짓점: (anchor_x - 32, anchor_y), (anchor_x, anchor_y - 16), (anchor_x + 32, anchor_y), (anchor_x, anchor_y + 16)
```

근거: 64×32 바닥 타일 오브젝트 14,133개 중 13,857개가 (ox, oy) = (−32, −16)에 놓인다. 캐릭터 이미지의 ox는 폭의 절반의 음수(−32)다. 유닛 위치는 `FUN_00429c40` → `FUN_0042dd50`로 셀 앵커를 그대로 쓴다.

### 7.2 오브젝트 배치 — 관찰 (`FUN_0042d1e0`)

오브젝트 `o`는 레이어 `o.layer` 시트의 RECT(left, top, right, bottom)를 `(anchor_x + o.ox, anchor_y + o.oy)`에 그린다. 레이어 시트의 색 키는 §6.2 규칙으로 정한다.

### 7.3 스프라이트 배치 — 관찰 (`FUN_0042a560`, `FUN_0042a610`, `FUN_00428620`)

프레임 F(패턴 p, flipH, flipV)를 셀 (c, r)에 놓인 스프라이트에 그리는 규칙:

```
base = (anchor_x + move_x, anchor_y + move_y - pattern.yOffset)   // move = 플레이어의 현재 이동 오프셋(§8.4)
패턴의 이미지 i를 순서대로:
  dx = flipH ? -(i.ox + i.w) : i.ox
  dy = flipV ? -(i.oy + i.h) : i.oy
  시트 i.sheet의 (i.x, i.y, i.w, i.h)를 (base_x + dx, base_y + dy)에 그린다. flipH/flipV면 거울상.
```

### 7.4 그리기 순서 — 관찰 (`FUN_0042a990`, `FUN_0042df70`, `FUN_0042d1e0`)

```
for s in 0 .. 2N-2:                       // 행 = c + r 오름차순
  for 각 셀 (c, r) with c+r == s, c 오름차순:  front == 0 인 오브젝트를 레코드 순서로 그린다
  for 각 스프라이트 with c+r == s:            프레임을 그린다 (§7.3)
  for 각 셀 (c, r) with c+r == s, c 오름차순:  front != 0 인 오브젝트를 레코드 순서로 그린다
```

- 배경 이미지는 맵 픽셀 좌표 (0, 0)에 먼저 그린다. **추정**: 배경 크기가 `pixelSize`와 다른 맵이 있다(`st32a` 1760×1120 vs stage32 1728×1120, `st06a` 1504×992 vs stage06 1536×1024). 배치 기준은 뷰어에서 이 두 맵으로 확인한다(§13).
- 같은 행 안의 스프라이트 순서: 원작은 행 키(+0x46) 다음에 +0x48 값으로 정렬한다(`FUN_00429cb0`). +0x48의 의미는 미확인이다. **결정**: 이 하위 프로젝트에서는 배치 순서를 쓴다. 하위 프로젝트 2에서 확인한다.
- 뷰포트와 겹치지 않는 셀과 스프라이트는 건너뛴다. 오브젝트 RECT와 스프라이트 패턴 경계로 판정한다.

### 7.5 투시 모드 — 관찰 (`FUN_0042df70`, `FUN_0042d1e0` mode 4)

Shift 키를 누르는 동안 `front != 0` 오브젝트를 체커보드로 그린다. 화면 좌표 (x + y)가 홀수인 픽셀을 투명하게 한다. 구현: 오브젝트를 작은 오프스크린 캔버스에 그리고 2×2 체커보드 패턴으로 `destination-in` 합성한 뒤 복사한다. 디버그 기능이므로 속도는 신경 쓰지 않는다.

### 7.6 카메라와 배율

- 백버퍼는 640×480. 카메라 `(camX, camY)`는 맵 픽셀 좌표의 왼쪽 위. 범위는 `[0, pixelSize - (640, 480)]`로 클램프.
- 초기 카메라: `(start[0] * 32, start[1] * 16)`을 클램프한 값. 원작 `FUN_00431460`이 0x28, 0x2C 필드를 각각 `<< 5`, `<< 4`해서 스크롤 변수에 넣는다(의미는 추정).
- 화면 표시: 캔버스를 창에 맞는 가장 큰 정수 배율로 CSS 확대. 최소 1배. 창이 640×480보다 작으면 페이지가 스크롤된다. `image-rendering: pixelated`.

### 7.7 커서 피킹

화면 점 → 셀: 그리기 순서(§7.4)대로 모든 셀을 돌며, 점이 셀 마름모(높이 반영) 안에 있으면 후보로 기록한다. 마지막 후보(가장 앞)가 결과다. 마름모 판정은 `|px - anchor_x| / 32 + |py - anchor_y| / 16 <= 1`. 셀 수는 최대 1,800개 안팎이므로 선형 탐색으로 충분하다. 원작은 `flag2 != 0`인 셀을 선택에서 제외하지만(`FUN_0042dda0`), 뷰어는 디버그 목적이라 모두 선택할 수 있게 한다.

## 8. 애니메이션 스크립트

### 8.1 문법 — 관찰 (`FUN_00424c80`과 보조 함수)

원작 파서는 문자 단위로 읽는다. 아래 표가 전체 문법이다.

| 문자 | 의미 |
|---|---|
| `S<n>` | 이후 프레임의 표시 시간 n ms. 초기값 200 |
| `N<n>` | 현재 스텝의 프레임 수를 n으로 맞춘다 (§8.2 규칙 5) |
| `M<dx>,<dy>` | 스텝의 이동량(px). 두 번째 숫자 뒤에 스텝이 끝난다 |
| `P` | 패턴 목록 시작. 뒤의 숫자들이 프레임이 된다 |
| 숫자 | 직전 명령(`P`, `M`, `N`, `S`)의 인수. 숫자 하나를 읽을 때마다 트리거가 초기화된다 |
| `,` 공백 | 구분자. 요소 단위 플래그(숫자 앞 `H`/`V`, `A`~`D`, 범위)를 지운다 |
| `\r` `\n` | 무시 |
| `-` | `P` 목록에서는 범위(직전 패턴 → 다음 패턴). `M`에서는 다음 숫자의 음수 부호 |
| `H`, `V` | 좌우/상하 반전. 바로 뒤 토큰에 붙는다: `HP`(목록 전체), `HM`(dx 부호 반전), `H@`(포함 전체), 숫자 바로 앞(그 요소만). 반전 비트는 XOR로 합친다 |
| `A`, `B`, `C`, `D` | 다음 숫자가 만드는 프레임에 표식(mark) 1~4를 붙인다. 하나만 유효 |
| `(<n>)`, `(#<n>)` | 다음 숫자가 만드는 프레임에 트리거 값 n을 붙인다. `#`는 플래그 |
| `@<name>` | 같은 파일의 다른 애니를 스텝 단위로 포함한다. 이름은 `,`나 공백까지(최대 31자) |

코퍼스 통계(애니 3,065개): `P` 3,678, `S` 2,432, `M` 1,835, `N` 280, `A(` 171, `P(` 249, `B(` 101, `HP` 10, `HM` 2, `@` 36. `C`, `D`, `V`, `(#`는 쓰이지 않는다. 그래도 파서는 모두 받는다.

### 8.2 컴파일 규칙 — 관찰

1. 스텝은 프레임 목록과 이동량(dx, dy)으로 이루어진다. `M`의 두 번째 숫자 뒤에서 스텝이 끝난다. 스크립트 끝에서 마지막 스텝이 끝난다.
2. `P` 목록의 숫자 n은 프레임 {패턴 n, 반전, 표시 시간 = 현재 S, 트리거, 표식}을 추가한다.
3. 범위 `a-b`: a는 규칙 2로 추가된다. b는 a+1..b(또는 a−1..b) 프레임을 추가한다. 중간 프레임은 트리거 없음, 표식 0이다. 마지막 프레임 b만 b 앞에 적힌 트리거와 표식을 받는다. a == b이면 아무것도 추가하지 않는다. 스텝에 프레임이 없는데 범위가 오면 오류다(원작은 무시한다).
4. 숫자 하나를 처리할 때마다 트리거는 없음으로, 표식과 범위 플래그는 0으로 돌아간다. 숫자 바로 앞의 `H`/`V`는 다음 구분자에서 지워진다.
5. `N<n>`: 스텝이 끝날 때 프레임 수를 n으로 맞춘다. 프레임이 n보다 적으면 앞에서부터 순환해 채운다(패턴, 반전, 시간, 트리거, 표식 모두 복사). 많으면 n개로 자른다.
6. 프레임이 없는 스텝이 `M`으로 끝나면 직전 스텝의 프레임 전부(와 N 값)를 복사한다. 첫 스텝이면 오류다.
7. 프레임이 없는 스텝이 스크립트 끝에서 끝나면 그 스텝은 버린다.
8. `M<dx>,<dy>`: `-`는 음수. `HM`은 dx 부호를, `VM`은 dy 부호를 뒤집는다.
9. 스텝의 총 시간 T = 프레임 시간의 합. 속도 = (dx / T, dy / T) px/ms. T == 0이면 속도 0.
10. `@name`: 대상 애니의 스텝들을 현재 위치에 새 스텝으로 추가한다. 프레임 반전은 포함 반전과 XOR. `H@`면 dx와 x 속도 부호를, `V@`면 dy와 y 속도 부호를 뒤집는다. 현재 스텝에 이미 프레임이 있으면 오류다(원작은 덮어쓴다). 자기 자신이나 순환 포함은 오류다.
11. 원작은 `@`의 대상을 파일에서 현재 애니 **뒤**에 있는 것만 찾는다. TypeScript는 파일 안 어디든 찾는다. 코퍼스 테스트가 앞쪽 참조가 있는지 보고한다.
12. 전체 프레임이 0개면 오류다.

반전 비트: H = 1, V = 2. 프레임의 최종 반전 = 숫자 앞 반전 ⊕ 토큰 반전(`HP`) ⊕ 포함 반전.

### 8.3 Timeline 타입

```ts
interface Frame { pattern: number; flipH: boolean; flipV: boolean; ms: number; trigger: number | null; triggerSharp: boolean; mark: 0 | 1 | 2 | 3 | 4 }
interface Step { frames: Frame[]; dx: number; dy: number; totalMs: number }
interface Timeline { name: string; steps: Step[] }
function compileAnim(apd: ApdData, animIndex: number): Timeline   // 오류는 AnimScriptError(name, offset, message)
function compileAll(apd: ApdData): Timeline[]
```

트리거와 표식의 **소비** 의미(효과음, 타격 시점)는 이 하위 프로젝트 범위 밖이다. 원작은 `FUN_004294b0`(트리거 목록)과 `FUN_00429380`(표식 목록)으로 전투 코드에 넘긴다. 컴파일러는 값을 보존만 한다.

### 8.4 플레이어 — 관찰 (`FUN_0042a210`, `FUN_0042a3d0`, `FUN_0042a450`)

```ts
interface PlayOptions { loop: boolean; mirrorH: boolean; mirrorV: boolean; keepOffset: boolean }
class AnimPlayer {
  constructor(timeline: Timeline, options: PlayOptions)
  update(nowMs: number): AnimEvent[]       // 'frame' | 'step' | 'end'
  readonly frame: Frame
  readonly offset: { x: number; y: number }
  readonly finished: boolean
}
```

재생 규칙:

1. 상태: 스텝 i, 프레임 j, 프레임 시작 시각, 스텝 안 경과 시간 e, 확정 오프셋 C, 표시 오프셋 O.
2. 첫 `update`는 프레임 시작 시각만 기록한다.
3. `now < 시작 + frame.ms`이면 변화 없음. 아니면 프레임을 **하나만** 넘긴다(밀린 시간을 따라잡지 않는다). `e += frame.ms`, 시작 시각 = now.
4. 스텝의 마지막 프레임을 넘기면: 끝난 스텝의 (dx, dy)를 C에 더한다(mirrorH면 −dx, mirrorV면 −dy). `e = 0`. 다음 스텝으로 간다.
5. 마지막 스텝을 넘기면: `keepOffset`이 아니면 C = 0. `loop`가 아니면 종료(`finished = true`, 'end' 이벤트). `loop`면 첫 스텝으로 돌아간 뒤 규칙 4의 덧셈을 적용한다(원작 순서 그대로).
6. 표시 오프셋 `O = C + trunc(e × 속도)`. 부호는 mirror 플래그로 뒤집는다. `trunc`는 0 방향 내림이다(`__ftol`). O는 프레임이 넘어갈 때만 바뀐다. 틱마다 보간하지 않는다(원작 `FUN_0042a210`도 프레임 전환 시에만 계산한다).
7. 스텝 1개, 프레임 1개, 이동 없음인 애니는 정지 화상이다. 이벤트를 내지 않는다.

뷰어는 `loop: true`를 기본으로 쓴다.

## 9. 뷰어 UI (`viewer/main.ts`)

- 왼쪽 패널: 맵 선택(`index.json`), 스프라이트 선택, 애니 선택, 배치 버튼, 전부 지우기.
- 캔버스: 방향키와 마우스 드래그로 스크롤. 클릭한 셀에 선택한 스프라이트를 배치한다(여러 개 가능). Shift로 투시.
- 토글: 격자, 높이 숫자, land 색, blocked 색, 애니 반복.
- 상태줄: 커서 셀 (c, r), 높이, land, blocked, flag2, 오브젝트 수, 프레임 번호.
- 오류는 상태줄 아래 빨간 글씨로 보인다. 콘솔에도 남긴다.

## 10. 오류 처리

| 위치 | 상황 | 처리 |
|---|---|---|
| 변환기 | BMP가 8비트 무압축이 아님, 소문자 이름 충돌, 범위 밖 참조 | 오류 메시지 + 종료 코드 1 |
| 변환기 | 시트 파일 없음 | 경고. JSON은 쓴다 |
| 로더 | 404, JSON 형식 불일치 | 자산 이름을 포함한 `AssetError` |
| PNG 디코더 | 지원하지 않는 형식 | 형식 이름을 포함한 오류 |
| 컴파일러 | 알 수 없는 문자, 범위 밖 패턴 번호, 규칙 3·6·10·12 위반 | `AnimScriptError(anim, offset, message)`. 파일의 다른 애니는 계속 컴파일한다 |
| 렌더러 | 레이어·이미지 번호 범위 밖 | 모델 생성 시 검증해서 미리 막는다. 그리기 중에는 검사하지 않는다 |

## 11. 테스트와 성공 기준

| 종류 | 내용 | 통과 기준 |
|---|---|---|
| 변환기 실행 | 전체 게임 폴더 변환 | 오류 0. 맵 76, 스프라이트 312. 경고는 알려진 5개 시트만 |
| Vitest 단위 `png` | 테스트 안에서 작은 인덱스 PNG를 만들어 디코드 | 인덱스·팔레트 왕복 일치. 필터 0 외 → 오류 |
| Vitest 단위 `indexed` | 색 키 적용 | 키 픽셀만 alpha 0 |
| Vitest 단위 `grid` | 앵커 공식, 마름모 판정, 피킹 왕복 | 수치 일치 |
| Vitest 단위 `animScript` | 규칙 1~12 각각의 인라인 예제. 코퍼스에서 뽑은 실제 스크립트 6개 포함 (`S200\r\nP1-3,2`, `P21\r\nM4,2\r\nM-6,-3`, `P13-A(6)16-B(6)22`, `PA(2)16,15,(2)14-12\r\nN4\r\nM16,32`, `S50 P6 N8 M0,-8`, `@F.ATTACK1, @F.ATTACK2`) | 기대 타임라인과 일치 |
| Vitest 단위 `animPlayer` | 규칙 1~7. 반복/비반복, mirror, 이동 보간 | 프레임·오프셋 수치 일치 |
| Vitest 코퍼스 | `web/public/assets`가 있을 때만 실행. APD 312개 전부 컴파일. 맵 76개 `cellAt` 유효 수 == `cells.length`. 레이어 색 키 계산 | 컴파일 오류 0. `@` 앞쪽 참조 수 보고 |
| 수동 | 뷰어에서 stage02, stage51(오브젝트 최다), stage57(최대 픽셀), stage06(레이어 키 253) 확인. 캐릭터를 나무 뒤 셀에 놓아 가려짐 확인. F./B. 애니와 H 반전 확인 | 눈으로 이상 없음 |

자동 화면 비교는 원본 캡처가 없어 범위 밖이다.

## 12. 원작과 다르게 하는 점

| 항목 | 원작 | 이 설계 | 이유 |
|---|---|---|---|
| 정적 맵 합성 | 한 번 합성 + 더티 영역 갱신 | 매 프레임 전체 | 단순함. 결과 화면은 같다 |
| 같은 행 스프라이트 순서 | +0x48 값으로 정렬 | 배치 순서 | +0x48 의미 미확인. 하위 프로젝트 2에서 해결 |
| `@` 대상 검색 | 현재 애니 뒤쪽만 | 파일 전체 | 더 관대함. 코퍼스 테스트로 차이 보고 |
| 범위 시작 없음, `@` 앞 프레임 있음 | 무시 / 덮어씀 | 오류 | 데이터 문제를 숨기지 않는다 |
| 투시 모드 패리티 | 스크롤 값 포함 | 화면 좌표 (x+y) | 디버그 기능 |

## 13. 미확인 사항

- 스프라이트 레코드 +0x48(행 안 정렬 2차 키)의 출처.
- 트리거 `(n)`, `(#n)`, 표식 `A`~`D`의 소비 의미. 전투 코드(`FUN_0043b4a0`) 분석에서 확인한다.
- `start`(0x28, 0x2C) 필드의 의미. 데이터 검사: 76개 맵 중 유효한 셀 좌표인 경우는 0개다. `(start[0]*32, start[1]*16)`을 스크롤로 보면 59개가 범위 안이고, 나머지 17개는 음수이거나 범위를 넘는다(예: stage26 (−10, 4), stage57 (0, −11)). 클램프하면 모두 유효하다. **결정**: 클램프한 스크롤로 쓴다. 뷰어에서 어색하면 맵 중앙으로 바꾼다.
- 배경 이미지 배치 기준. 배경 크기가 `pixelSize`와 다른 맵(stage06, stage32)이 있다. **뷰어 확인(2026-10-15)**: (0, 0) 배치로 두 맵 모두 배경 가장자리가 마름모 경계와 일치하고 오브젝트가 격자에 맞는다. 차이 나는 32px는 셀이 없는 검은 영역이다. 결정 유지.
- **뷰어 확인(2026-10-15)**: `start`를 클램프한 스크롤로 쓰면 stage02가 (0, 0)에서 시작해 빈 구석이 보인다. 결정대로 뷰어는 맵 중앙에서 시작한다. `start`의 의미는 여전히 미확인이다.
- ~~패턴 번호가 범위를 벗어나는 애니 2개~~ **정정(2026-10-15)**: `char_28b` B.ATTACK1과 `char_68v` F.FLOAT는 범위 밖이 아니다. 스크립트에 `M32-16`, `M0-40`처럼 쉼표 대신 `-`가 있고, 원작 파서(`-`는 다음 숫자의 부호)와 컴파일러 모두 `M32,-16`, `M0,-40`으로 읽는다. 이전 추정은 Python 검사 스크립트의 오탐이었다. 코퍼스 312개 파일, 3,065개 애니 전부 컴파일 오류 0.
- 코퍼스 검사 결과, 규칙 3·6·7·10·11·12의 오류 조건(시작 없는 범위, 프레임 뒤 `@`, 앞쪽 `@` 참조, 첫 스텝 M만, 빈 스크립트, 중복 애니 이름)은 실제 파일에 한 건도 없다. 오류 처리가 실제 데이터를 거부하지 않는다.
- `land` 1~7의 이름, 팔레트 애니메이션 범위(옵션 `DisablePaletteAnime` 존재 확인).
- 스프라이트 시트 5개(`char_11e`, `char_29d`, `npc_24`, `npc_25d`, `tornado`)가 폴더에 없다. 해당 APD가 실제로 쓰이는지 확인한다.

## 14. 근거 (FT2.exe 함수)

| 함수 | 내용 |
|---|---|
| `FUN_00431460` | 맵 로드, 레이어 색 키 규칙, origin·pixelSize·초기 스크롤 |
| `FUN_0042cde0`, `FUN_0042a990`, `FUN_0042df70`, `FUN_0042d1e0` | 맵 합성, 장면 그리기, 행 단위 뒤·스프라이트·앞 순서, 투시 모드 |
| `FUN_0042dd00`, `FUN_0042dd50`, `FUN_00429c40` | 셀 → 화면 좌표, 스프라이트 위치 = 셀 앵커 |
| `FUN_00429cb0` | 스프라이트 정렬 키 (+0x46 = c+r, +0x48) |
| `FUN_00428620`, `FUN_00428780` | 이미지 레코드(키, 반전 오프셋 −(ox+w), −(oy+h)), 패턴 레코드(yOffset) |
| `FUN_0042a560`, `FUN_0042a610`, `FUN_0040e0a0` | 스프라이트 그리기, 이미지별 SetColorKey |
| `FUN_00424c80`, `FUN_00425100`, `FUN_004250a0`, `FUN_00425b00`, `FUN_004253a0`, `FUN_00425520`, `FUN_00425190`, `FUN_00425560`, `FUN_00425900` | 스크립트 파서 전체 |
| `FUN_0042a210`, `FUN_0042a3d0`, `FUN_0042a450`, `FUN_00429950` | 애니 재생, 스텝 전환, 반복, 이동 오프셋 |
| `FUN_004294b0`, `FUN_00429380` | 트리거·표식 목록 추출 (소비는 범위 밖) |
