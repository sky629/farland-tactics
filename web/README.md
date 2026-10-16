# ft2-web

파랜드 택틱스 2 웹 리메이크의 브라우저 쪽 패키지(TypeScript + Vite + Canvas 2D).
전체 사용 방법은 [`../docs/manual.md`](../docs/manual.md)에 있다. 설계는 [`../docs/superpowers/specs/2026-10-14-rendering-foundation-design.md`](../docs/superpowers/specs/2026-10-14-rendering-foundation-design.md)에 있다.

| 명령 | 하는 일 |
|---|---|
| `npm install` | 개발 의존성 설치 (typescript, vite, vitest) |
| `npm run dev` | 개발 서버. 뷰어 http://localhost:5173 · 전투 페이지 http://localhost:5173/game.html |
| `npm run check` | `tsc --noEmit && vitest run` |
| `npm test` | Vitest만 실행 |
| `npm run build` | 타입 검사 후 `dist/`에 정적 빌드 |

뷰어는 `public/assets/`의 변환 자산을 읽는다. 자산은 저장소 루트에서 `python3 -I tools/ft2_export.py extracted/FarlandTactics2 web/public/assets`로 만든다(설명서 §5). `public/assets/`는 git에 넣지 않는다.
