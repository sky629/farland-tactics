# 파랜드 택틱스 2 웹 리메이크

1998년 PC 게임 **파랜드 택틱스 2**(FT2.exe, TGL의 Farland Saga 時の道標 한국어판, 640×480 256색)를 브라우저에서 원작 그대로 재현하는 프로젝트다. 원본 데이터 파일(맵, 스프라이트, 테이블, 이벤트 스크립트)을 그대로 읽는다. Python이 원본 바이트를 풀어 PNG와 JSON으로 쓰고, TypeScript가 그 의미를 해석해 Canvas 2D로 그린다.

## 진행 상태

| 하위 프로젝트 | 내용 | 상태 |
|---|---|---|
| 1 렌더링 기반 | 자산 변환, 맵·스프라이트 그리기, 애니메이션 재생, 개발용 뷰어 | 완료 |
| 2 전투 1판 | 유닛·이동·공격·마법·적 AI·승패 (33개 전투 선택) | 완료 |
| 3 아이템·소지품 | 전투 중 아이템 사용, 보물 습득, 파티 소지품·장비 가방 | 완료 (상점·장비 화면은 4에서) |
| 4 스크립트 VM | 이벤트 스크립트 실행 | 예정 |
| 5 세이브·사운드·UI | 세이브 호환, MIDI/WAV, 메뉴 | 예정 |

## 빠른 시작

원본 게임 파일이 필요하다. 저장소에는 코드와 문서만 있다.

```bash
# 1. 원본 아카이브 풀기 (18개 .egg 파일을 저장소 루트에 둔 뒤)
python3 -I tools/ft2_unegg.py 파랜드택틱스2.vol1.egg extracted
mv extracted/FarlandTactics2_Package.vol1 extracted/FarlandTactics2

# 2. 웹 자산 변환 (약 20초)
python3 -I tools/ft2_export.py extracted/FarlandTactics2 web/public/assets

# 3. 뷰어 실행
cd web && npm install && npm run dev      # 뷰어 http://localhost:5173 · 전투 http://localhost:5173/game.html
```

자세한 절차, 뷰어 조작, 검사, 분석 도구, 문제 해결은 **[사용 설명서 `docs/manual.md`](docs/manual.md)** 에 있다.

## 저장소 구조

```
tools/          Python 도구: EGG 풀기, SZDD 풀기, 맵·APD·테이블·이벤트 파서, 웹 자산 변환기
web/            TypeScript 렌더러와 개발용 뷰어 (Vite, Vitest)
analysis/       FT2.exe 역공학 결과: 보고서, 파일 포맷, 이벤트 스크립트, 전투 규칙
docs/           사용 설명서, 설계 문서(specs), 구현 계획(plans)
extracted/      원본 게임 폴더 (git 제외)
web/public/assets/   변환 자산 (git 제외)
```

## 데이터 정책

원본 게임 파일(`*.egg`, `extracted/`)과 변환 결과(`web/public/assets/`)는 저작권이 있는 자료다. `.gitignore`가 이 경로를 막는다. 사용자가 가진 원본으로 자기 컴퓨터에서 변환한다.
