# 하위 프로젝트 5 — 세이브·소리·비주얼 씬 설계

날짜: 2026-10-16 · 상태: 계획 A(세이브) 구현 완료 — main `769b3ed`(리뷰 Critical 1·Important 5 수정) · 계획 B(소리)·C(비주얼 씬) 진행 중 · 선행: 하위 프로젝트 4 (main `0c807eb`)

## 1. 목표와 완료 기준

이야기 모드(`play.html`)에 원작의 나머지 세 축을 넣어 **처음부터 끝까지** 플레이할 수 있게 한다.

1. **세이브/불러오기**: 원작 `save%02d.dat`(6848 B) 와 양방향 호환. 2015년 실제 세이브를 불러와 `Restart` 라벨부터 이어진다. 브라우저 저장소에 32슬롯, `.dat` 내보내기/가져오기. `SAVE_GAME` 모달, 자동 저장(슬롯 30·31), 타이틀의 **불러오기**.
2. **소리**: `SOUND` 효과음(WAV, 16채널 규칙), `MUSIC`/`MUSIC_FADE`/`WAIT_MUSIC_FADE`(MIDI → 브라우저 합성), 볼륨·음소거. 브라우저 자동재생 정책을 지킨다.
3. **비주얼 씬**: `PLAY_VISUAL` 이 쓰는 장면 11개(0, 1, 3, 4, 6, 7, 9, 10, 11, 12, 13)를 원작 장면 함수에서 전사한 타임라인으로 재생한다. 오프닝 무비(장면 0, 18부)와 엔딩 포함.
4. 헤드리스 테스트: 세이브 라운드트립과 실제 세이브 디코드, 소리 채널 규칙과 페이드, 비주얼 타임라인 실행(가짜 캔버스)이 Vitest 로 재현된다.

## 2. 원작 근거

`analysis/save_sound_visual.md`(세이브 레이아웃, MUSIC/SOUND 내부, 비주얼 디스패치·레코드·상태 기계), `analysis/file_formats.md` §6·§7, `analysis/story_flow.md` §2·§4, `analysis/event_script_format.md`(MUSIC/SOUND/PLAY_VISUAL/SAVE_GAME 행).

## 3. 접근 방식

| 축 | 선택 | 대안과 기각 이유 |
|---|---|---|
| 세이브 | **원작 바이너리 레이아웃을 그대로 정식 저장 형식**으로 쓴다(`SaveFile` 6848 B). 브라우저는 IndexedDB 에 슬롯별 바이트를 둔다. | JSON 세이브: 원작 세이브를 못 읽고 형식이 둘이 된다. |
| 음악 | **spessasynth_lib**(Apache-2.0, AudioWorklet) + GM 사운드폰트 파일 1개(`assets/sf2/gm.sf3`, 저장소 밖). | 빌드 때 MIDI→OGG 렌더: fluidsynth 설치가 필요하고 페이드/반복 제어가 거칠다. Web MIDI API: 외부 신디사이저가 필요하다. |
| 효과음 | Web Audio `decodeAudioData` + 버퍼 소스 16채널. | `<audio>` 요소: 채널 규칙과 동시 재생 제어가 어렵다. |
| 비주얼 씬 | 장면 함수를 **데이터(타임라인)로 전사**하고 작은 재생기가 실행. | 슬라이드쇼 근사: 원작 연출을 잃고 나중에 다시 만든다. |

채택 결정은 §15 에 있다.

## 4. 데이터

- 세이브: `web/src/save/format.ts` 가 6848 B ↔ `Campaign` 를 변환한다. 헤더(468 B) 필드는 `file_formats.md` §6 그대로. 유닛 124 B ↔ `Unit` 은 `battle_rules.md` §7 의 워드 맵(미확인 워드 0x10·0x11 과 스프라이트 핸들 0x36..0x3d 는 0). 마을 블록 180 B 는 알려진 오프셋만 쓰고 나머지는 0.
- `Campaign` 변경: `flags` 는 **24개**(원작 `u16[24]`; 코퍼스 최대 인덱스 10). `bgm: number`(현재 곡, −1 없음) 추가. `message` 는 이미 있다(장면 설명).
- 소리 자산: 변환기가 `Wave/*.wav` → `assets/wave/<소문자>.wav`, `Midi/bgm%02d.mid` → `assets/midi/bgm%02d.mid` 로 복사하고 `index.json` 에 `wave`, `midi` 목록을 쓴다. 사운드폰트는 `tools/ft2_soundfont.py` 가 공개 GM 사운드폰트(FluidR3Mono_GM.sf3, 13.8 MB, MIT)를 내려받아 `assets/sf2/gm.sf3` 에 둔다(없으면 음악만 꺼지고 게임은 진행).
- 비주얼: 변환기가 `DATA/vsllst.dat` 를 `data/visual.json`(레코드 249개)으로 쓴다. 장면 타임라인은 코드(`web/src/visual/scenes/sceneNN.ts`)에 전사한다 — 원작도 코드였다.

## 5. 모듈

```
web/src/save/format.ts       encodeSave(campaign, now) / decodeSave(buf) → Campaign, 유닛 레코드 변환
web/src/save/store.ts        SaveStore: IndexedDB 슬롯 0..31 {bytes, title, date, gold, stage}, list/read/write/delete, export(Blob)/import(File)
web/src/audio/sound.ts       SoundPlayer: 16채널, '*' 채널 0, 빈 이름 정지, 버퍼 캐시, 볼륨
web/src/audio/music.ts       MusicPlayer: 사운드폰트 로드, play(n)/stop/fade(ms, dir)/fadeBusy, 볼륨, 반복
web/src/visual/player.ts     VisualPlayer: 타임라인 실행(그리기·대기·페이드·클릭 건너뛰기), Scene.backdrop 로 출력
web/src/visual/scenes/*.ts   장면 0..13 타임라인 (전사)
web/src/game/gameCore.ts     Host: save/loadGame/music/musicFade/musicFadeBusy/sound/playVisual 연결, 자동 저장
web/src/ui/dialogue.ts       슬롯 모달(저장/불러오기): 32슬롯 목록, 비어 있음/제목/날짜/소지금, 내보내기·가져오기
web/src/play/main.ts         타이틀: 새 게임 · 불러오기 · 전투 테스트; 오디오 컨텍스트는 첫 클릭에 만든다; 패널에 볼륨·음소거
tools/ft2_export.py          wave/midi 복사, visual.json
tools/ft2_soundfont.py       사운드폰트 내려받기(sha256 확인)
```

## 6. 세이브 의미론

- `SAVE_GAME n`: n ≥ 0 → 슬롯 n 에 즉시 기록(결과 n). n < 0 → 슬롯 모달 → 고른 슬롯에 기록(결과 슬롯) 또는 취소(−1). 원작처럼 스크립트는 결과를 `host.save(slot)` 로 받는다.
- 자동 저장: `BATTLE_START`/`BATTLE_START_HEAL` 직후 슬롯 30, 턴 종료(라운드 시작 이벤트) 뒤 슬롯 31.
- 불러오기: 바이트 → `Campaign` → `GameCore.loadGame(campaign)`: 전투·마을·대화를 모두 비우고, 턴 < 0 이면 `EVENT00 Restart`, 아니면 `stage Restart`; `bgm > 0` 이면 음악 재생. 모든 스테이지 파일에 `Restart` 가 있다(코퍼스 19개 + EVENT00).
- 내보내기는 `save%02d.dat` 이름의 다운로드, 가져오기는 파일 선택(6848 B 가 아니면 거부, 메시지).
- 모르는 필드는 0 으로 쓴다. 원작이 읽어도 깨지지 않는 값들이다(유닛 핸들은 로드 때 다시 만든다).

## 7. 소리 의미론

- `SOUND s`: `*` 접두 → 채널 0 (기존 채널 0 정지 뒤 재생), 아니면 빈 채널(없으면 0). 빈 문자열 → 채널 0 정지. 없는 파일 → 경고 1회.
- `MUSIC n`: n < 0 정지. 같은 곡이면 다시 시작하지 않는다 [추정]. 반복 재생 [추정]. 볼륨은 페이드 상태에 따른다.
- `MUSIC_FADE ms dir`: ms 동안 선형으로 0↔1. dir 0 = 끄기(끝나면 정지), 1 = 켜기. ms 0 즉시. `WAIT_MUSIC_FADE` 는 끝날 때까지 기다린다(원작 §1B).
- 오디오 컨텍스트는 사용자 첫 클릭(타이틀 버튼)에 만든다. 그 전의 `MUSIC` 은 기억했다가 컨텍스트가 생기면 시작한다.
- 사운드폰트가 없으면 음악 호출은 로그만 남기고, 패널에 안내 한 줄.

## 8. 비주얼 씬 의미론

- `PLAY_VISUAL n` → 표(§3.1 분석)로 (장면, 시작 부) 를 고르고 모드를 `visual` 로 바꾼다. 재생기가 끝나면 스크립트로 돌아온다(원작 모드 8 → 4). 클릭/Enter 로 장면을 건너뛸 수 있다 [결정: 원작의 취소 플래그 `DAT_0044a63c` 에 해당].
- 타임라인 원시: `fill(color)`, `blit(slot, sx, sy, w, h, dx, dy)`, `wait(ms)`, `fadeIn/fadeOut(ms)`, `scroll(slot, from, to, ms)`, `music(n)`, `sound(s)`. 장면마다 원작 함수에서 좌표·시간을 옮긴다. 전사 근거는 각 파일 머리말에 함수 주소로 적는다.
- 이미지는 `vsllst` 레코드의 (장면, 부, 슬롯) 으로 찾고, PNG 를 그대로 그린다(팔레트 재배치는 트루컬러에서 불필요).

## 9. 페이지와 UI

- 타이틀: `새 게임` · `불러오기`(슬롯 모달) · `전투 테스트`. 패널: 볼륨 슬라이더(음악/효과음), 음소거.
- 슬롯 모달: 32행(번호, 제목, 날짜, 소지금, 스테이지), 저장 모드는 빈 슬롯도 고를 수 있고 덮어쓰기는 확인 한 번. 아래에 **내보내기**(현재 슬롯 .dat), **가져오기**(파일 → 슬롯).

## 10. 오류 처리

- 세이브 바이트 길이 ≠ 6848 또는 헤더 u32 ≠ 468 → 거부 + 메시지. 유닛 레코드의 모르는 race/item 인덱스 → 경고 후 0 으로.
- IndexedDB 를 못 열면(사생활 모드) 메모리 저장소로 대체하고 안내.
- 사운드폰트/WAV 로드 실패 → 경고 1회, 게임 계속. 비주얼 비트맵 없음 → 그 블릿만 건너뜀.

## 11. 테스트

- `save/format.test.ts`: 새 게임 캠페인 라운드트립(캠페인 → 바이트 → 캠페인, 필드 단위 — 원본 파일의 미지 필드는 0 으로 쓰므로 바이트 동일성은 요구하지 않는다), 헤더 필드 위치(468/4/6/38/40/90/106/108/112/436), 유닛 워드 맵, 실제 세이브(`extracted/.../save/save09.dat` 가 있으면 읽어 제목 "첫업무"·소지금 200·유닛 0 레벨 2 확인, 없으면 건너뜀).
- `save/store.test.ts`: 가짜 IndexedDB(메모리) 로 list/write/read/delete, 가져오기 길이 검사.
- `audio/sound.test.ts`: 가짜 AudioContext 로 채널 선택 규칙, `*`, 빈 이름, 캐시. `audio/music.test.ts`: 가짜 신디사이저로 play/stop/fade 타이밍·`fadeBusy`.
- `gameCore` 추가: SAVE_GAME 30 → store 에 6848 B; loadGame → `Restart` 실행과 bgm; 자동 저장 슬롯 30·31.
- `visual/player.test.ts`: 타임라인 실행 순서·대기·건너뛰기; 장면 전사는 "모든 참조 슬롯이 vsllst 에 있고 비트맵이 index 에 있다" 코퍼스 테스트.

## 12. 계획 분할

- **계획 A 세이브·타이틀**: format, store, Campaign 변경, Host save/loadGame, 슬롯 모달, 자동 저장, 타이틀 불러오기, 문서.
- **계획 B 소리**: 변환기 wave/midi, SoundPlayer, MusicPlayer(spessasynth), Host 연결, 패널 볼륨, 사운드폰트 도구, 문서.
- **계획 C 비주얼 씬**: 원시 함수 분석, 재생기, 장면 0(18부)·1·3·4·6·7·9·10·11·12·13 전사, 코퍼스 테스트, 문서.

## 13. 범위 밖

원작 Win32 다이얼로그 외관 재현, 상점 판매(규칙 미분석), GS 음원(`_gs.mid`), 비주얼 장면 2·5·8(스크립트 미사용), 세이브 슬롯 다이얼로그의 원작 그림.

## 14. 결정 사항

1. 세이브 정식 형식 = 원작 바이너리(6848 B). 브라우저 저장소는 그 바이트를 담는 그릇.
2. 스크립트 플래그는 24개로 줄인다(원작 u16[24]).
3. 음악은 spessasynth_lib + 외부 GM 사운드폰트 1개, 저장소 밖(`assets/sf2/`).
4. 비주얼 씬은 코드 타임라인으로 전사하고 클릭으로 건너뛸 수 있다.
5. 자동 저장 슬롯 30(전투 시작)·31(턴 종료)은 원작과 같다.
6. 반복 재생·같은 곡 재시작 금지는 [추정]; 분석되면 바꾼다.
