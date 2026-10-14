# FT2 이벤트 스크립트 (DATA/EVENT*.dat) 포맷 명세

대상: `FT2.exe` (Farland Tactics 2, 1997, x86 PE). 인터프리터 `FUN_004085f0` (0x4085f0–0x40a442), 확장 명령 `FUN_0040a5c0`, 피연산자 판독기 `FUN_0040a570`/`FUN_0040a590`, 로더 `FUN_004083b0`.
검증: `tools/ft2_event_disasm.py` 로 20개 파일 전부 처음부터 끝까지 디코딩 (미지 opcode 0, 재동기 오류 0).

표기: **[관찰]** = 코드에서 직접 확인. **[추정]** = 호출 함수/데이터 사용 패턴으로 추정.

## 1. 파일 구조

| 구간 | 내용 |
|---|---|
| 심볼 테이블 | `name\0` + u32 LE 오프셋(파일 시작 기준) 의 반복. 엔트리 시작 바이트가 `0xFF` 이면 테이블 끝 (게임은 개수를 저장하지 않고 이 규칙만 사용: `FUN_004083b0`, 0x40841d) |
| 본문 | `FF op operand…` 명령열. 라벨 블록은 보통 `FF FF`(END)로 끝남 |

- 로더 `FUN_004083b0(stage, label)`: `data\event%02d.dat` 를 통째로 읽어(`DAT_004498b8`) 라벨을 대소문자 무시(`lstrcmpiA`)로 찾고 `pc = base + offset`. 라벨이 없으면 파일을 해제하고 0 반환.
- 실행 모드: 스크립트 실행 중 `DAT_00449d4c = 4`. 시작 시 이전 모드를 `DAT_0044f118`에 저장하고 END 에서 복원.
- 인터프리터는 매 프레임 호출된다(`FUN_00410780` 메인 루프 case 4). 대기형 명령은 `return 1`로 프레임을 넘기고, 다음 프레임에 같은 명령(또는 다음 명령)부터 재개한다.

## 2. 명령 인출과 피연산자 인코딩 [관찰]

```
instr  := 0xFF opcode operand*        ; opcode 1 byte, 0x4087c0
number := i8                          ; 0x80 이 아니면 부호 있는 1바이트 (-127..127)
        | 0x80 i32le                  ; 5바이트 (FUN_0040a570)
unit   := number                      ; 유닛 id. 24 = 현재 전투 대상(DAT_0046cb1c). 그 외 FUN_0041f5f0(2,id)로 검색 (FUN_0040a590)
string := bytes* 0x00                 ; CP949. '_' 는 공백 표시용(FUN_004343b0에서 '_'→' ' 확인)
label  := string                      ; 심볼 테이블에서 대소문자 무시 검색
list   := number* 0                   ; SHOP 전용, 0 으로 종료
```

- 명령 경계에서 `0xFF`가 아닌 바이트를 만나면 `return 0` → 스크립트 종료(모드 복원). 데이터에서 라벨 블록 끝은 `FF FF` (opcode 0xFF → switch default → END 처리).
- 유닛 피연산자 뒤의 피연산자는 모두 `if (unit != NULL)` 블록 안에서 읽는다. 유닛 id 0 은 절대 매치되지 않으므로(빈 슬롯 검사) 뒤 피연산자는 소비되지 않는다. (EVENT15 0x170a `FF 1F 00` 가 실제 사례. 디스어셈블러도 동일하게 처리)
- 점프 계열은 라벨 문자열을 읽은 뒤 `pc`를 심볼 테이블 선두(`DAT_004498b8`)로 되돌려 선형 검색한다. 없으면 `return 0`(스크립트 종료).
- CALL 은 되돌아갈 주소를 전역 `DAT_0044ed0c` 하나에만 저장한다(스택 깊이 1). RETURN 은 그 주소로 복귀하고 0 으로 지운다.

## 3. 주 opcode 표 (0x00–0x3F, 디스패치 0x4087f1)

약어: n=number, u=unit, s=string, L=label. "대기"=`return 1`로 프레임을 넘김.

| op | 이름 | 피연산자 | 의미 | 근거 |
|---|---|---|---|---|
| 00 | EXT | n(sub) + 확장 피연산자 | 확장 명령 (4절) | [관찰] 0x4087f8 |
| 01 | WAIT | n ms | `DAT_0044eca8 = now+n` 후 대기. Ctrl 키로 스킵 | [관찰] 0x40a1fc |
| 02 | FADE_IN | n(step) | 논리 팔레트(`DAT_00451f08`)로 10..0xF6 범위 페이드, 대기. n=0 즉시 | [관찰] 0x40a21d, FUN_00418660 |
| 03 | FADE_OUT | n | 팔레트 `0x46c4c0`(검정, `FUN_00419240`이 0 으로 채움)으로 페이드. 대기 없음 | [관찰] 0x408817 |
| 04 | MSG_TOP | n(spk) [+2B] | 상단 대화창. spk=0 닫기. spk≠0 이면 2바이트 추가(표정 문자, 0): 초상 `bmp\face%02d%c.bmp`(FUN_004202f0, 포맷 idx5). 다른 화자 창이 열려 있으면 닫고 재시도 | [관찰] 0x408845 |
| 05 | MSG_BOTTOM | n(spk) [+2B] | 하단 대화창. 동일. 초상은 spk<30 일 때만 | [관찰] 0x4089cb |
| 06 | TEXT | s | 현재 창에 한 줄 출력. `[Snn]` 글자 크기(기본 16), `[Cnn]` 색(기본 30). 첫 줄이면 화자 이름 출력: spk 14 → `SET_SPEAKER_NAME` 값, spk<30 → 이름표(6절), spk≥30 → 유닛 이름 | [관찰] 0x408b46 |
| 07 | RESPRITE_UNIT | u, 문자, 0 | 유닛 클래스(u[1])의 스프라이트를 `sprite\char_%02d%c.apd`(클래스, 문자)로 다시 로드하고 "마지막 스프라이트"(`DAT_00449950`)로 설정. 이어서 0x21 과 같은 스프라이트 재생성 | [관찰] 0x408e1b asm: `mov al,[pc]; push eax; push unit; call FUN_0041ea40` |
| 08 | ANIM | u, s(anim), n | 스프라이트 애니메이션 지정 `FUN_00429a50`. n=0 → 플래그 0x11(반복), n≠0 → 0x01(1회). 이름 앞 `*` → 플래그 \|2 (강제/우선) | [관찰] 0x408f13 |
| 09 | WAIT_FADE | – | 팔레트 페이드가 끝날 때까지 재시도 | [관찰] 0x408fd7 |
| 0A | LOAD_MAP | n | `map\stage%02d.map` 로드 `FUN_0042d5d0(n)`, 위성뷰 갱신 | [관찰] 0x408ff0 |
| 0B | CLEAR_SCENE | n(무시) | 모든 유닛 스프라이트/로드된 스프라이트 데이터 20슬롯 해제 | [관찰] 0x40901d |
| 0C | CAMERA_TILE | n x, n y | 타일 좌표로 카메라 이동 | [관찰] 0x409079 |
| 0D | CAMERA_UNIT | u | 유닛 위치로 카메라 | [관찰] 0x4090d8 |
| 0E | MUSIC | n | `midi\bgm%02d.mid`(또는 `_gs`) 재생 후 볼륨 최대. n<0 정지 | [관찰] 0x40912a, FUN_0042e8c0 |
| 0F | MUSIC_FADE | n ms, n dir | 음악 볼륨 페이드 `FUN_00436500(ms, dir)`. dir 0=끄기, 1=켜기. ms=0 즉시 | [관찰] 0x409150 |
| 10 | SOUND | s | `wave\%s.wav` 재생. 앞 `*` → 채널 0 고정(플래그 1). 빈 문자열 → 채널 0 정지 | [관찰] 0x409180, FUN_0040d950 |
| 11 | WAIT_UNIT | u | 애니/이동/효과(0x3c) 완료까지 재시도 | [관찰] 0x4091d8 |
| 12 | CAMERA_SCROLL | n dx, n dy, n tx, n ty, n ms | 자동 스크롤: 매 ms 마다 (dx,dy)px 이동, 타일(tx,ty) 도달/통과 시 정지. (0,0) 타겟 없음 | [관찰] 0x409274 + 0x408660 |
| 13 | LOAD_SPRITE | s, n id, n x, n y | `sprite\%s.apd` 를 빈 슬롯(20개)에 로드, id 로 오브젝트 유닛(side 7 템플릿) 생성, 좌표 설정. id<4000 → 레이어 3, 아니면 5 | [관찰] 0x40931a |
| 14 | SPRITE_REUSE | n id, n x, n y | 마지막 로드 스프라이트로 오브젝트 유닛 생성 | [관찰] 0x40934c |
| 15 | REMOVE_UNIT | u | 유닛 슬롯 삭제 | [관찰] 0x4093b8 |
| 16 | GIVE_ITEM | n item, n cnt | 파티 소지품 추가(장비는 1번 유닛 슬롯) `FUN_0041ecc0` | [관찰] 0x4093dd |
| 17 | TAKE_ITEM | n item, n cnt | 소지품 감소 `FUN_0041eda0` | [관찰] 0x409417 |
| 18 | WAIT_CLICK | n ms | 클릭 대기(커서 변경, 타이머). n>0 이면 시간 초과도 해제 | [관찰] 0x40a278 |
| 19 | MOVE_PATH | u, s anim, s path | path 문자 `e n s w`(소문자화) 순서로 이동 작업 등록 `FUN_00437bb0`, 이동 시작. 마지막 방향으로 유닛 방향 설정 | [관찰] 0x40944c, 0x4094e1 |
| 1A | NOP_UNIT | u | 유닛만 읽고 아무 동작 없음 | [관찰] 0x409586 |
| 1B | WAIT_MUSIC_FADE | – | 볼륨 페이드 종료까지 재시도. 종료 시 dir=0 이었으면 음악 정지 | [관찰] 0x40959a |
| 1C | SET_POS | u, n x, n y | 유닛 타일 좌표 설정 | [관찰] 0x4095cd |
| 1D | BATTLE_START_HEAL | – | 전 유닛 HP=max, MP=max/2 후 0x35 와 동일 | [관찰] 0x40960e |
| 1E | NEXT_STAGE | – | 플래그 100개 초기화, 비파티 유닛 삭제, END 시 `stage+1`의 `begin` 로드(`ForcedStage` INI 키가 있으면 현재 stage 재시작). 데이터에서 미사용 | [관찰] 0x40971d, 0x40a0bf |
| 1F | SET_DIR | u, n | 방향 0=S 1=E 2=W 3=N, 4=유지 | [관찰] 0x40975f, FUN_0041f4d0 |
| 20 | JUMP | L | 라벨로 점프 (`Jump:'%s'` 디버그) | [관찰] 0x40a001 |
| 21 | ATTACH_SPRITE | n id | id 유닛이 없으면 템플릿(class 7, side 1)으로 생성하고 마지막 스프라이트 부착; 있으면 그 유닛의 스프라이트 재생성 | [관찰] 0x408e58 |
| 22 | WAIT_SCROLL | – | CAMERA_SCROLL 종료까지 재시도 | [관찰] 0x40a2e7 |
| 23 | RESET_SPRITES | – | 전 유닛 스프라이트 삭제, 20슬롯 해제, 행동 플래그(0x5c/0x60)=1 | [관찰] 0x4097a2 |
| 24 | END_RESUME | – | END 처리 후 `FUN_0043afd0(-1)`: 보류 중인 전투 행동 재개. `battle%02d` 라벨용 | [관찰] 0x40a0bf default + `'$'` 검사 |
| 25 | FACE_UNIT | u a, u b | b 가 a 를 바라보도록 방향 설정 | [관찰] 0x40980b |
| 26 | SPRITE_OFFSET | u, n dx, n dy | 스프라이트 픽셀 오프셋 | [관찰] 0x409873 |
| 27 | JUMP_IF_RESULT | n, L | `(result != 0) == (n != 0)` 이면 점프. result = `DAT_0044f16c` | [관찰] 0x4098c3 |
| 28 | JUMP_IF_LESS | n, L | `(less != 0) == (n != 0)` 이면 점프. less = `DAT_0044ec00` (FLAG_CMP 가 설정) | [관찰] 0x4098c3 |
| 29 | FLAG_SET | n i, n v | `Flag[i] = v` | [관찰] 0x40990b |
| 2A | FLAG_ADD | n i, n v | `Flag[i] += v` | [관찰] |
| 2B | FLAG_SUB | n i, n v | `Flag[i] -= v` | [관찰] |
| 2C | FLAG_CMP | n i, n v | `result = (Flag[i] == v)`, `less = (Flag[i] < v)` | [관찰] 0x4099dc |
| 2D | FLAGS_CLEAR | – | 플래그 100개 0 | [관찰] |
| 2E | CALL | L | 복귀 주소 저장 후 점프 (깊이 1) | [관찰] 0x409fdf |
| 2F | RETURN | – | 복귀 | [관찰] 0x409a5c |
| 30 | FIELD_MODE | – | END 시 복원 모드를 1(필드/전투)로 강제, 스프라이트 재생성, 유닛 다이얼로그/위성뷰 표시 | [관찰] 0x409a71 |
| 31 | SHOP | list | 다이얼로그 150 (`LAB_0040c4e0`). 다이얼로그 프로시저가 `FUN_0040a570`으로 번호를 0 까지 읽어 리스트박스에 추가(0x40c84f). 아이템 id 목록 → 상점 | [관찰] 0x40a300, 0x40c838 바이트 |
| 32 | SHOW_IMAGE | s, n step | `bmp\%s.bmp` 전체화면 표시 후 팔레트 페이드 인. `DAT_0044f158=1` | [관찰] 0x409ab9 |
| 33 | HIDE_IMAGE | – | 팔레트 복원, 화면 지움, `DAT_0044f158=0` | [관찰] 0x409bd5 |
| 34 | PLAY_VISUAL | n | 모드 8 비주얼 씬 n (0..47, 테이블 0x449598, `VSLLST.DAT`). 종료 후 모드 4 복귀 | [관찰] 0x40a324, FUN_004082d0, FUN_00401f70 |
| 35 | BATTLE_START | – | 상태 초기화, 첫 생존 유닛으로 카메라, `FUN_00423820(30)` 자동 저장(슬롯 30), 전투 플래그 | [관찰] 0x409639 |
| 36 | TOWN | – | 스크립트 해제, 모드 9(마을), 맵 해제, 마을 배경 `Town%02d.bmp` 로드, 턴=-1 | [관찰] 0x40a37d, FUN_0042ad00 |
| 37 | FLAG_BIT_SET | n i, n bit | `Flag[i] |= 1<<bit` | [관찰] 0x409c1a |
| 38 | FLAG_BIT_CLR | n i, n bit | `&= ~` | [관찰] |
| 39 | FLAG_BIT_TOGGLE | n i, n bit | `^=` | [관찰] |
| 3A | FLAG_BIT_TEST | n i, n bit | `result = (Flag[i] & 1<<bit) != 0` | [관찰] 0x409d10 |
| 3B | EPISODE | s, n | 에피소드 제목(`DAT_0046cb50`, 세이브 헤더에 저장) 설정. n≠0 이면 즉시 중앙 표시 `FUN_0040d4c0` | [관찰] 0x409d77 |
| 3C | LOAD_SCRIPT | n stage, L | 현재 스크립트 해제, `event%02d.dat` 로드 후 라벨 실행 | [관찰] 0x409de6 |
| 3D | SET_SPEAKER_NAME | s | 화자 id 14 의 이름(`DAT_0044ecb0`) | [관찰] 0x409e32 |
| 3E | MESSAGE | s | 중앙 메시지 박스(클릭 대기, 모드 7). 문자열은 `DAT_0046cb20`에 남아 세이브 헤더(장면 설명)에 기록됨 | [관찰] 0x409e5b, FUN_00423820 |
| 3F | WAIT_UNIT2 | u | 0x11 과 같으나 효과 스프라이트(0x3c)는 검사 안 함 | [관찰] 0x409e92 |
| FF | END | – | switch default: 스크립트 해제, 모드 복원, NEXT_STAGE 처리 | [관찰] 0x40a0bf |

0x40 이상 다른 값도 default(END)로 가지만 데이터에는 `FF FF`만 존재한다.

## 4. 확장 opcode (op 00, sub = number, `FUN_0040a5c0` 점프 테이블 1..57)

| sub | 이름 | 피연산자 | 의미 | 근거 |
|---|---|---|---|---|
| 01 | REMOVE_SCRIPT_UNITS | – | 슬롯 10.. 중 side(u[9])==1 (스크립트 생성 유닛) 삭제 | [관찰] |
| 02 | MARKER | u, n | n≠0: `LARGE.M` 애니 스프라이트(마커)를 유닛 위치에 생성(레이어 2); 0: 삭제 | [관찰] |
| 03 | SET_ACT_FLAGS | u, n | 유닛 +0x5c/+0x60 (이동/행동 가능 플래그) = n | [관찰] 필드 의미 [추정] |
| 04 | TOWN_FLAG_SET | n i, n v | `DAT_0044b210[i] = v`. 마을 화면(FUN_0042b080)에서 참조 → 시설 활성 플래그 | [관찰]/[추정] |
| 05 | SHOW_ONLY | u | 다른 모든 유닛 스프라이트 숨김 | [관찰] |
| 06 | STAGE_FROM_FLAG | n i | `stage(DAT_0044b73c) = Flag[i]` | [관찰] |
| 07 | DIM_SCENE | n step | 팔레트 0x20..0xD0 을 60% 밝기로 | [관찰] FUN_00434330 |
| 08 | ASK | s | 예/아니오 다이얼로그(`+` 접두 → 리소스 0xA3, 아니면 0x7E). `result = (답 != IDNO)` | [관찰] FUN_004343b0 |
| 09 | BATTLE_RESULT | n gold, n p | gold>0 이면 골드 추가+효과음+메시지, 결과 다이얼로그 0xA2(파라미터 p), 전 유닛 레벨업 처리 | [관찰] |
| 0A | TOWN_SET | n | 마을 배경 세트 1/2/3 (`Town00/10/20+`) | [관찰] FUN_0042ac90/FUN_0042ad70 |
| 0B | SWEAT | u | `sweat` 효과 스프라이트(레이어 5) | [관찰] |
| 0C | REMOVE_DEAD | – | 슬롯 10.. 의 id 8/24/>30 이고 HP 0 또는 status≠1 인 유닛 삭제 | [관찰] |
| 0D | SPRITE_APPEAR | u, n | 스프라이트 표시 후 타이밍 효과 모드 8, 길이 n `FUN_00429ee0` | [관찰] 효과 종류 [추정] |
| 0E | SPRITE_VANISH | u, n | 효과 모드 0, 길이 n | 동상 |
| 0F | SET_VISIBLE | u, n | 3개 스프라이트 표시/숨김. status 9(숨김) 유닛은 n≠0 이면 0 으로 | [관찰] |
| 10 | ALL_FACE | u | 모든 유닛이 u 를 바라봄 | [관찰] |
| 11 | UNIT_TO_ID8 | u | id=8, HP=0, status=1. id 8 은 이벤트 라벨이 발생하지 않는 익명 유닛 | [관찰] |
| 12 | ALL_VISIBLE | n | 전 유닛 표시/숨김 | [관찰] |
| 13 | GAME_COMPLETE_QUIT | – | 종료 메시지, INI `CompleteFlag` 기록, `WM_DESTROY` | [관찰] |
| 14 | RESET_PAL_STAGE0 | – | 팔레트 0x10..0x20, 0x90..0xD0 즉시 복원, stage=0 | [관찰] |
| 15 | CLEAR_SCREEN | – | 백버퍼 지움 + flip | [관찰] |
| 16 | FLASH_WHITE | n | 팔레트 `0x46c0c0`(흰색, `FUN_00419240`이 0xFF 로 채움)으로 페이드. 마법 효과음과 함께 n=0 로 사용 | [관찰] |
| 17 | SHAKE | n | `DAT_0044b764 = n`. 화면 합성 `FUN_00432d40`이 참조. `*rumbling` 효과음과 함께 6, 종료 시 0 | [추정] |
| 18 | CLEAR_TEXTPAL | n | 화면 지움 후 팔레트 0x10..0x20(문자색) 페이드 | [관찰] |
| 19 | TINT_SUNSET | n | R×1.2, G/B×0.8 틴트 팔레트로 페이드 | [관찰] |
| 1A | MOVE_TO | u, s | 이동 작업 `FUN_004383d0(u, s)` (경로 문자열 해석 `FUN_00438580`) | [관찰] 문자열 의미 [미확인] |
| 1B | TIMER_START | – | `timeGetTime()` 저장 | [관찰] |
| 1C | WAIT_TIMER | n sec | 경과 < n초 이면 재시도 | [관찰] |
| 1D | DIM_UI | n step, n pct | 팔레트 0xD0..0xF0 를 pct% 로 | [관찰] |
| 1E | CLEAR_FACEPAL | n | 화면 지움 후 팔레트 0x90..0xD0 페이드 | [관찰] |
| 1F | SPRITE_RAISE | u | 스프라이트 y 오프셋 −32 | [관찰] |
| 20 | TEST_ENEMY_PHASE | – | `result = (DAT_0044b7a0 == 7)` (적 AI 페이즈) | [관찰] FUN_004332f0 |
| 21 | SPRITE_LAYER | u, n | 레이어(+0x48) = n?5:1 | [관찰] |
| 22 | TOWN_EXTRA | n | `DAT_0044b264 = n` (마을 배경 5번째 레이어 사용) | [관찰] |
| 23 | TEST_UNITS_1_2 | – | result = 유닛1 또는 2 가 행동 가능 상태 | [관찰] |
| 24 | SET_STATUS8 | u | status=8 | [관찰] 8의 의미 [미확인] |
| 25 | GIVE_ITEM_TO | u, n | 유닛에 아이템 1개, 성공/실패 메시지, result | [관찰] |
| 26 | BLACK_SPRITES | n | 팔레트 0x20..0x90 을 0% | [관찰] |
| 27 | HIDE_MARKERS | – | 전 유닛 마커 숨김 | [관찰] |
| 28 | HEAL_ALL | – | HP=max, MP=max/2, status 9 제외 0 | [관찰] |
| 29 | DOPPEL_COPY | – | 행동 유닛(`DAT_0046cc48`)이 파티원이면 대상 유닛(24)에 클래스/능력치 복사 (도플갱어) | [관찰] |
| 2A | TARGET_CLASS40 | – | 대상 유닛 클래스=0x40 | [관찰] |
| 2B | KILL | u | HP=MP=0, status 1, 스프라이트 삭제 | [관찰] |
| 2C | ADD_GOLD | n | 골드 += n (0..999999), 메시지 | [관찰] |
| 2D | TINT_NIGHT | n | R×0.6, G×0.8, B+R/2 | [관찰] |
| 2E | TEST_IS_ACTOR | u | result = (행동 유닛 == u). 아니면 대상 HP=1 | [관찰] |
| 2F | TEST_ACTIVE | u | result = !(status 1 \|\| side 7) | [관찰] |
| 30 | REVIVE | u | HP=max, status 0 | [관찰] |
| 31 | TINT_DUSK | n | R×0.9, G/B×0.6 | [관찰] |
| 32 | TINT_UI_DARK | – | 0xD0..0xF0 어둡게 즉시 | [관찰] |
| 33 | SAVE_GAME | n slot | `save\save%02d.dat` 기록. n<0 이면 슬롯 선택 다이얼로그 0x8F | [관찰] |
| 34 | FLAG_FROM_TOWN | n i | `Flag[i] = 마을 세트(1/2/3)` | [관찰] |
| 35 | UI_HALF_A | – | 0x20..0x90 반투명(흰색과 평균) + 3개 범위 복원 | [관찰] |
| 36 | UI_HALF_B | – | 위와 같고 0xD0 범위 제외 | [관찰] |
| 37 | WRITE_COMPLETE_FLAG | – | INI `CompleteFlag` 기록 | [관찰] |
| 38 | UNLOCK_ANIMS | – | 활성 유닛 스프라이트 잠금 해제(`FUN_00429bf0(s,0x80)`) | [관찰] |
| 39 | LOCK_ANIMS | – | 애니 잠금 비트 설정 | [관찰] |
| 99 | (미구현) | sub2 + ... | EVENT98 전용. 점프 테이블 범위 밖 → 아무 동작 없이 return 0, 다음 바이트가 0xFF 가 아니므로 스크립트 종료. 데이터 상 레이아웃: 0:–, 1:n, 2:–, 3:–, 4:n,s(자막), 5:– | [관찰]/[추정] |

## 5. 상태 변수

| 변수 | 주소 | 의미 |
|---|---|---|
| pc | `DAT_0044f170` | 현재 명령 포인터 |
| 스크립트 베이스 | `DAT_004498b8` | 파일 버퍼 |
| Flag[0..99] | `DAT_0046cb80` (short×100) | 세이브에 저장. `FLAGS_CLEAR`/`NEXT_STAGE`로 초기화 |
| result | `DAT_0044f16c` | 비교/테스트 결과 |
| less | `DAT_0044ec00` | FLAG_CMP 의 `<` |
| 복귀 주소 | `DAT_0044ed0c` | CALL 1단 |
| 마지막 스프라이트 | `DAT_00449950` | LOAD_SPRITE/RESPRITE 가 설정, SPRITE_REUSE/ATTACH 가 사용 |
| stage | `DAT_0044b73c` | 현재 스테이지(=EVENT 번호) |
| 턴 | `DAT_0044b744` | 전투 턴 수, 마을 -1 |
| 모드 | `DAT_00449d4c` | 1 필드/전투, 2·3 전투 연출, 4 스크립트, 7 메시지 대기, 8 비주얼, 9 마을 |

유닛 구조체(ushort 인덱스, 0x7C바이트, 50슬롯 `DAT_0046a880`, 0..9 파티): [0] id, [1] class, [2] level, [3] dir, [4..5] x, [6..7] y, [8] status(0 정상, 1 전투불능, 9 숨김, 3/4/5/8 상태이상), [9] side(0 파티, 1 스크립트 오브젝트, 7 지형 오브젝트), [0x12] maxHP, [0x13] HP, [0x14] maxMP, [0x15] MP, [0x16] exp, [0x36..] 스프라이트 데이터, [0x38] 본체 스프라이트, [0x3a] 마커, [0x3c] 효과.

## 6. 화자 id 이름표 (`DAT_0044be30`, TEXT 첫 줄)

| id | 이름 | id | 이름 | id | 이름 |
|---|---|---|---|---|---|
| 1 | 카린 | 11 | 손 | 21 | 베히모스 |
| 2 | 알 | 12 | 마크도갈 | 22 | 듀마 |
| 3 | 아리스 | 13 | 가스톤 | 23 | 존 |
| 4 | 사라 | 14 | (SET_SPEAKER_NAME) | 24 | 돗펠원화 |
| 5 | 라딧슈 | 15 | 마스터 | 25 | 앨비스 |
| 6 | 소피아 | 16 | 근육 아저씨 | 26 | 손.바이스 |
| 7 | 루루 | 17 | 숍언니 | 27 | 히드라 |
| 8 | (없음) | 18 | 화난 카린 | 28 | 코카트리스 |
| 9 | ??? | 19 | 곤란한 아리스 | 29 | 길드 마스터 |
| 10 | T.T. | 20 | 카트린느 | ≥30 | 유닛 이름 |

## 7. 런타임이 호출하는 라벨

| 라벨 | 파일 | 시점 | 근거 |
|---|---|---|---|
| `begin` | stage 또는 EVENT00 | 새 게임(`FUN_004239b0`), NEXT_STAGE 후 | 0x449954 |
| `Restart` | 저장된 stage (마을이면 EVENT00) | 게임 로드 | 0x44af0c |
| `fraud` | stage | 기동 시 stage>0 (ForcedStage 디버그) | FUN_00410780 |
| `battle%02d` | stage | 공격 대상/주체 id 로 전투 연출 직전 (`FUN_0043af00`). END_RESUME 로 복귀 | 0x44a408 |
| `BEAT%02d` / `AFTER%02d` | stage | 행동 결과: 대상(id) 전투불능/생존 | FUN_0043a2e0 case 4 |
| `ASSIST%02d` | stage | 파티원이 파티원에게 행동(주체 id) | 동상 |
| `WIN%02d` | stage | 파티원(주체 id)이 대상을 쓰러뜨림 | 동상 |
| `levelup%02d` | EVENT00 | 레벨업(주체 id) | case 9 |
| `GAMEOVER` | EVENT00 | 파티 전멸 | case 10 |
| `COMPLETE` | stage | 적 전멸 | case 10 |
| `get%03d` | stage | 지형 오브젝트에서 아이템 획득 | FUN_00431170 |
| 마을 메뉴 | stage, 없으면 EVENT00 | 메뉴 0..14: outfield, inn, guild, weapon, store, church, cemetery, harbor, cafe, macdogal, smith, depot, lighthouse, farm, backdoor | FUN_0042b080, 테이블 0x44b290 |

`Town%02d`(bmp), `%sPOP_%d`(대미지 숫자 애니), `magic%02d`(wave) 는 라벨이 아니라 리소스 이름이다. `battle%02d`는 wave 이름으로도 쓰인다.

## 8. 리소스 경로 포맷 (`FUN_004340c0`, 테이블 0x44c130)

| idx | 포맷 | 사용 명령 |
|---|---|---|
| 5 | `bmp\face%02d%c.bmp` | MSG_TOP/BOTTOM 초상 |
| 7 | `bmp\%s.bmp` | SHOW_IMAGE, 마을 배경 |
| 8 | `map\stage%02d.map` | LOAD_MAP |
| 9 | `sprite\%s.apd` | LOAD_SPRITE |
| 11 | `sprite\char_%02d%c.apd` | RESPRITE_UNIT, 유닛 기본 스프라이트 |
| 15 | `wave\%s.wav` | SOUND |
| 16/17 | `midi\bgm%02d.mid` / `_gs.mid` | MUSIC |
| 18 | `data\event%02d.dat` | LOAD_SCRIPT/로더 |
| 19 | `save\save%02d.dat` | SAVE_GAME |

팔레트 영역: 0x10–0x20 문자, 0x20–0x90 맵/스프라이트, 0x90–0xD0 초상, 0xD0–0xF0 시스템 UI. 페이드는 0x0A–0xF6.

## 9. 검증 결과 (`python3 -I tools/ft2_event_disasm.py -q DATA/EVENT*.dat`)

20개 파일 모두 OK. 전 바이트 소비, 미지 opcode 0, 심볼 오프셋 전부 명령 경계와 일치.

| 파일 | 크기 | 심볼 | 명령 | 비고 |
|---|---|---|---|---|
| EVENT00 | 4039 | 32 | 504 | |
| EVENT01 | 12722 | 17 | 1248 | |
| EVENT02 | 20325 | 41 | 1983 | |
| EVENT03 | 12015 | 34 | 1330 | END_RESUME 2회 |
| EVENT04 | 11345 | 25 | 1214 | |
| EVENT05 | 14309 | 15 | 1470 | |
| EVENT06 | 9758 | 17 | 1047 | |
| EVENT07 | 8147 | 14 | 983 | 0x0CFF 에 사(死)바이트 2개(`3A 00`, 무조건 JUMP 뒤) |
| EVENT08 | 9505 | 5 | 1031 | |
| EVENT09 | 10104 | 12 | 1009 | |
| EVENT10 | 8416 | 21 | 812 | |
| EVENT11 | 10391 | 20 | 1074 | |
| EVENT12 | 9641 | 20 | 1086 | |
| EVENT13 | 7593 | 19 | 836 | |
| EVENT14 | 2180 | 6 | 293 | |
| EVENT15 | 18690 | 30 | 2068 | 0x170A `SET_DIR u0` 피연산자 누락(게임도 건너뜀) |
| EVENT16 | 6311 | 6 | 673 | |
| EVENT17 | 19798 | 24 | 2045 | |
| EVENT98 | 1805 | 1 | 278 | EXT 99 22회 (바이너리 미구현) |
| EVENT99 | 8350 | 27 | 734 | |

## 10. 남은 미확인 사항

| 항목 | 상태 | 증거 |
|---|---|---|
| TEXT 안의 `*` (3708줄 중 1170줄) | 렌더러 `FUN_00433bc0` 내부 처리 추정(짧은 멈춤 또는 줄 구분). 코드 미확인 | 0x408b46 루프는 `[`와 NUL 만 특수 처리 |
| EXT 1A MOVE_TO 의 문자열 형식 | `FUN_00438580(job, str)` 미분석. 데이터 1회(`"f.event04"`) | 0x40aeba |
| EXT 0D/0E 의 효과 모드 8/0 | `FUN_00429ee0` 타이밍 필드만 확인, 시각 효과 종류 미확인 | 0x40aa72 |
| EXT 17 SHAKE | `DAT_0044b764` 를 `FUN_00432d40`이 사용하는 것만 확인 | 0x432d92 |
| EXT 24 status 8, 상태이상 코드 3/4/5 | 의미 미확인 | FUN_0043a2e0 |
| 다이얼로그 0xA2(BATTLE_RESULT), 0x7E/0xA3(ASK) 내용 | 리소스 미분석 | 0x40a81b |
| EVENT98/99 진입 경로 | LOAD_SCRIPT 대상은 0..17 뿐. 코드에서 98/99 상수 미발견 | — |
| 유닛 id 가 0 이외인데 존재하지 않을 때 | 게임은 뒤 피연산자를 읽지 않아 다음 바이트부터 명령 해석 → 보통 스크립트 종료. 디스어셈블러는 정적 레이아웃으로 디코딩 | 0x4091d8 등 |
