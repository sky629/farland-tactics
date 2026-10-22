# 스토리 진행 구현 계획 A — 데이터 내보내기 · 스크립트 VM · 캠페인 상태

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원작 이벤트 스크립트 20개를 JSON 으로 내보내고, 가짜 호스트 위에서 모든 명령을 실행하는 헤드리스 VM 과 캠페인 상태를 만든다. 화면·마을·전투 연결은 계획 B.

**Architecture:** Python 디스어셈블러를 구조화 디코더로 바꾸고 exporter 가 그 결과를 JSON 으로 쓴다. TypeScript 는 `script/program.ts`(프로그램·라벨), `game/campaign.ts`(공유 상태), `script/host.ts`(부작용 인터페이스 + FakeHost), `script/vm.ts`(한 프레임씩 실행) 로 나뉜다. VM 은 `Resources`(프로그램·로스터·테이블의 동기 접근자)와 `Host` 만 알고 DOM 을 모른다.

**Tech Stack:** Python 3 (stdlib), TypeScript 7, Vitest 5, Vite 8.

**Spec:** `docs/superpowers/specs/2026-10-16-story-flow-design.md` (§4 데이터, §5 모듈, §6 VM 의미론, §7 Host, §13 테스트). 원작 근거 `analysis/event_script_format.md`, `analysis/story_flow.md`.

## Global Constraints

- 디코드 규칙은 `event_script_format.md` §2 그대로: 유닛 id 0 뒤 피연산자 생략, `0x80 i32`, CP949 문자열, 라벨 대소문자 무시, `FF FF` = END.
- 명령은 한 프레임에 1,000개까지 실행한다. 대기 명령은 같은 명령을 다음 프레임에 다시 실행한다.
- 없는 라벨·프로그램·로스터는 예외가 아니라 `host.log('warn', …)` 과 'ended'.
- 테스트 명령 `cd web && npm run check`; Python `python3 -I -m unittest discover -s tools -p 'test_*.py'`.

## Review Focus

1. **유닛 id 0 으로 잘린 명령**(`SET_DIR 0`): 인자가 모자라도 예외 없이 건너뛴다. → Task 5 테스트 `an instruction whose unit is 0 is skipped without reading the rest`.
2. **없는 라벨로 JUMP**: 스크립트가 끝나고 경고가 남는다(원작과 같음). → Task 4 테스트 `a jump to a missing label ends the script with a warning`.
3. **CALL 중첩**: 두 번째 CALL 은 첫 복귀 주소를 덮어쓴다(깊이 1). → Task 4 테스트 `CALL keeps one return address`.
4. **WAIT_CLICK 시간 초과**: n > 0 이면 클릭 없이도 해제된다. → Task 4 테스트 `WAIT_CLICK with a timeout releases on time`.
5. **LOAD_SCRIPT 로 다른 파일의 라벨**: 프로그램이 바뀌고 Flag 는 유지된다. → Task 4 테스트 `LOAD_SCRIPT switches programs and keeps the flags`.

## File Structure

```
tools/ft2_event_disasm.py        수정: decode_program() 구조화 디코더; disassemble() 은 그 결과를 텍스트로
tools/ft2_export.py              수정: export_events(), bmp 폴더 export, index.json events/bmp
tools/test_ft2_export.py         수정: 디코드·JSON 테스트
web/src/assets/types.ts          수정: AssetIndex.events, bmp
web/src/data/loader.ts           수정: DataLoader.event(n)
web/src/script/program.ts        신규: Program/Instr/Arg, loadProgram, findLabel, argument helpers
web/src/script/host.ts           신규: Host, Resources, FakeHost
web/src/script/vm.ts             신규: ScriptVm
web/src/game/campaign.ts         신규: Campaign, newCampaign, findUnit, createScriptUnit
web/src/battle/unit.ts           수정: Unit.sprite (스크립트 표현 필드)
web/test/{program,campaign,vm,vmUnits,eventCorpus}.test.ts  신규
```

---

### Task 1: 구조화 디코더와 이벤트·비트맵 내보내기

**Files:**
- Modify: `tools/ft2_event_disasm.py`
- Modify: `tools/ft2_export.py`
- Test: `tools/test_ft2_export.py`

**Interfaces:**
- Produces (Python): `decode_program(data: bytes) -> dict` = `{'symbols': [[name, offset], …], 'code': [{'at': int, 'op': str, 'args': list}, …], 'stats': {...}}`; 인자 표현: n → int, u → int, s/L → str, F → `[speaker, letter|None]`, V → letter str, Z → `[int, …]`; EXT 는 `op` 가 하위 이름(`"TOWN_FLAG_SET"`)이고 인자는 그 하위 명령의 것. END/UNKNOWN 은 `op: "END"` / `"UNKNOWN_0x..."` 에 `args: []`.
- Produces (JSON): `web/public/assets/data/event%02d.json` = `{symbols: {name: offset}, code: [...]}`; `web/public/assets/bmp/<name>.png`; `index.json` 에 `events: number[]`, `bmp: string[]`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tools/test_ft2_export.py` 끝에 추가:
```python
from ft2_event_disasm import decode_program, disassemble
from ft2_export import event_json


def script(*parts: bytes) -> bytes:
    return b"".join(parts)


def num(v: int) -> bytes:
    return bytes([v & 0xFF]) if -127 <= v <= 127 and v != -128 else b"\x80" + v.to_bytes(4, "little", signed=True)


class DecodeProgram(unittest.TestCase):
    def sample(self) -> bytes:
        body = script(
            b"\xff\x29", num(2), num(0),                  # FLAG_SET 2, 0
            b"\xff\x00", num(4), num(1), num(1),          # EXT TOWN_FLAG_SET 1, 1
            b"\xff\x04", num(15), b"a\x00",               # MSG_TOP spk15 face 'a'
            b"\xff\x06", "안녕_세계\x00".encode("cp949"), # TEXT
            b"\xff\x1f", num(0),                          # SET_DIR u0 → rest skipped
            b"\xff\x31", num(1), num(5), num(0),          # SHOP [1, 5]
            b"\xff\x20", b"Next\x00",                     # JUMP @Next
            b"\xff\xff",                                  # END
        )
        table = b"begin\x00" + (0).to_bytes(4, "little") + b"next\x00" + (0).to_bytes(4, "little")
        base = len(table)
        table = b"begin\x00" + base.to_bytes(4, "little") + b"next\x00" + (base + len(body) - 2).to_bytes(4, "little")
        return table + body

    def test_decodes_typed_arguments_and_truncates_after_unit_zero(self):
        p = decode_program(self.sample())
        self.assertEqual(p["symbols"], [["begin", 26], ["next", 26 + 40 - 2 + 0]])
        ops = [(i["op"], i["args"]) for i in p["code"]]
        self.assertEqual(ops[0], ("FLAG_SET", [2, 0]))
        self.assertEqual(ops[1], ("TOWN_FLAG_SET", [1, 1]))
        self.assertEqual(ops[2], ("MSG_TOP", [[15, "a"]]))
        self.assertEqual(ops[3], ("TEXT", ["안녕_세계"]))
        self.assertEqual(ops[4], ("SET_DIR", [0]))
        self.assertEqual(ops[5], ("SHOP", [[1, 5]]))
        self.assertEqual(ops[6], ("JUMP", ["Next"]))
        self.assertEqual(ops[7], ("END", []))
        self.assertEqual(p["stats"]["instr"], 8)

    def test_disassembly_text_comes_from_the_same_decode(self):
        syms, body, lines, stats, bad = disassemble(self.sample())
        self.assertIn("  0x001e: TOWN_FLAG_SET", "\n".join(lines).replace("EXT TOWN_FLAG_SET", "TOWN_FLAG_SET"))
        self.assertEqual(stats["instr"], 8)
        self.assertEqual(bad, [])

    def test_event_json_shape(self):
        j = event_json(decode_program(self.sample()))
        self.assertEqual(j["symbols"]["begin"], 26)
        self.assertEqual(j["code"][2], {"at": 0x1e + 5, "op": "MSG_TOP", "args": [[15, "a"]]})
```
(두 번째 심볼 오프셋과 `at` 값은 Step 3 뒤 실제 값으로 맞춘다: 심볼 테이블 길이 = `len("begin\0")+4 + len("next\0")+4 = 10+9 = 19`... 테스트에서는 계산식 대신 디코드 결과를 서로 비교하는 편이 안전하다 → `self.assertEqual(p["symbols"][0][1], p["code"][0]["at"])`, `self.assertEqual(p["symbols"][1][1], p["code"][7]["at"])` 로 바꾼다.)

- [ ] **Step 2: 실패 확인**

Run: `python3 -I -m unittest tools.test_ft2_export -k DecodeProgram 2>&1 | tail -3`
Expected: `ImportError: cannot import name 'decode_program'`.

- [ ] **Step 3: 디코더 구현**

`tools/ft2_event_disasm.py`:
- `decode_operands(data, pc, spec, labels_lower, out)` 를 **값을 돌려주는** 함수로 바꾼다:
```python
def decode_operands(data, pc, spec, labels_lower):
    """Decode operands per spec. Returns (args, pc, ext_name, missing_labels)."""
    args, ext_name, missing = [], None, []
    for code in spec:
        if code == "n":
            v, pc = read_number(data, pc); args.append(v)
        elif code == "u":
            v, pc = read_number(data, pc); args.append(v)
            if v == 0:
                break            # unit id 0 never resolves; the game reads no further operands
        elif code == "s":
            raw, pc = read_cstr(data, pc); args.append(decode_text(raw))
        elif code == "L":
            raw, pc = read_cstr(data, pc); name = raw.decode("ascii", "backslashreplace")
            if name.lower() not in labels_lower: missing.append(name)
            args.append(name)
        elif code == "F":
            v, pc = read_number(data, pc)
            if v == 0: args.append([0, None])
            else:
                if pc + 2 > len(data): raise DecodeError("face bytes past EOF at 0x%x" % pc)
                letter = data[pc]; pc += 2
                args.append([v, chr(letter) if 0x20 <= letter < 0x7F else "0x%02x" % letter])
        elif code == "V":
            if pc + 2 > len(data): raise DecodeError("variant bytes past EOF at 0x%x" % pc)
            letter = data[pc]; pc += 2
            args.append(chr(letter) if 0x20 <= letter < 0x7F else "0x%02x" % letter)
        elif code == "X":
            sub, pc = read_number(data, pc)
            ent = EXT_OPS.get(sub)
            if ent is None and sub == 99:
                sub2, pc = read_number(data, pc)
                ent = EXT99_OPS.get(sub2)
                if ent is None: raise DecodeError("unknown ext99 sub-opcode %d" % sub2)
                stats_unsupported.append(pc)
            elif ent is None:
                raise DecodeError("unknown ext opcode %d" % sub)
            ext_name = ent[0]
            sub_args, pc, _, sub_missing = decode_operands(data, pc, ent[1], labels_lower)
            args.extend(sub_args); missing.extend(sub_missing)
        elif code == "Z":
            items = []
            while True:
                v, pc = read_number(data, pc)
                if v == 0: break
                items.append(v)
            args.append(items)
        else:
            raise AssertionError(code)
    return args, pc, ext_name, missing
```
- 새 함수:
```python
def decode_program(data):
    """Structured decode of one event file: symbols, instructions with typed arguments, stats."""
    syms, body = parse_symbols(data)
    labels_lower = {name.lower() for name, _ in syms}
    code, stats = [], {"instr": 0, "unknown": 0, "db": 0, "errors": [], "unsupported": 0, "missing_labels": []}
    del stats_unsupported[:]
    pc = body
    while pc < len(data):
        start = pc
        b = data[pc]
        if b != 0xFF or pc + 1 >= len(data):
            code.append({"at": start, "op": "DB", "args": [b]}); stats["db"] += 1; pc += 1; continue
        op = data[pc + 1]; pc += 2
        args, ext_name = [], None
        try:
            if op in MAIN_OPS:
                name, spec = MAIN_OPS[op]
                args, pc, ext_name, missing = decode_operands(data, pc, spec, labels_lower)
                stats["missing_labels"].extend("0x%04x: %s" % (start, m) for m in missing)
                if ext_name: name = ext_name
            elif op == 0xFF:
                name = "END"
            elif op == 0x24 or op >= 0x40:
                name = "END(default op 0x%02x)" % op; stats["unknown"] += 1
            else:
                name = "UNKNOWN_0x%02x" % op; stats["unknown"] += 1
        except DecodeError as e:
            stats["errors"].append("0x%04x: %s" % (start, e)); name = "UNKNOWN_0x%02x" % op; stats["unknown"] += 1; pc = len(data)
        stats["instr"] += 1
        code.append({"at": start, "op": name, "args": args})
    stats["unsupported"] = len(stats_unsupported)
    return {"symbols": [[n, o] for n, o in syms], "code": code, "stats": stats, "body": body}
```
- `disassemble(data, show_raw=False)` 를 `decode_program` 위에 다시 쓴다(출력 형식 유지):
```python
def format_arg(op, spec_code, v):
    if spec_code == "u": return "u%d" % v if v != 24 else "u24(target)"
    if spec_code == "s": return quote_text(v)
    if spec_code == "L": return "@" + v
    if spec_code == "F": return "close" if v[0] == 0 else "spk%d, face'%s'" % (v[0], v[1])
    if spec_code == "V": return "var'%s'" % v
    if spec_code == "Z": return "[" + ", ".join(str(x) for x in v) + "]"
    return str(v)
```
  라벨이 없을 때의 `(?)` 표시는 `stats["missing_labels"]` 로 복원하고, 유닛 0 뒤에는 `; u0: rest skipped` 를 붙인다. `quote_text(s)` 는 기존 `quote` 와 같은 결과를 str 에 대해 낸다. 각 명령의 spec 은 이름으로 역조회(`SPEC_BY_NAME = {name: spec for _, (name, spec) in MAIN_OPS.items()}` + EXT/EXT99). EXT 명령의 텍스트는 `EXT <subname>, args…` 로 기존과 같게 한다.
- `main()`의 `-q`/`-r` 동작은 그대로.

- [ ] **Step 4: 디스어셈블리 회귀 확인**

Run: `python3 -I tools/ft2_event_disasm.py extracted/FarlandTactics2/DATA/EVENT*.dat > /tmp/ft2-scratch/events/after.txt && diff /tmp/ft2-scratch/events/all.txt /tmp/ft2-scratch/events/after.txt | head`
Expected: 차이 없음(또는 `(?)`·`pad` 표시만 다른 줄 — 있으면 형식을 맞춘다).

- [ ] **Step 5: exporter**

`tools/ft2_export.py`:
```python
from ft2_event_disasm import decode_program


def event_json(program: dict) -> dict:
    return {"symbols": {name: off for name, off in program["symbols"]}, "code": program["code"]}


def export_events(game: Path, out: Path, report: Report) -> list[int]:
    """DATA/EVENTnn.dat → data/eventnn.json (structured decode). Returns the stage numbers."""
    data_dir = next((p for p in game.iterdir() if p.is_dir() and p.name.lower() == "data"), None)
    if data_dir is None:
        report.error("no DATA directory"); return []
    (out / "data").mkdir(parents=True, exist_ok=True)
    stages: list[int] = []
    for p in sorted(data_dir.iterdir()):
        m = re.fullmatch(r"event(\d\d)\.dat", p.name.lower())
        if not m:
            continue
        program = decode_program(p.read_bytes())
        for e in program["stats"]["errors"]:
            report.error(f"{p.name}: {e}")
        for w in program["stats"]["missing_labels"]:
            report.warn(f"{p.name}: missing label {w}")
        (out / "data" / f"event{m.group(1)}.json").write_text(json.dumps(event_json(program), ensure_ascii=False), encoding="utf-8")
        stages.append(int(m.group(1)))
    return stages
```
`main()`: `events = export_events(game, out, report)`; `bmps = export_bmps(next(p for p in game.iterdir() if p.name.lower() == 'bmp'), out / 'bmp', report)`; index 에 `events=events, bmp=sorted(bmps)`; 요약 출력에 `events {len(events)}, bmp {len(bmps)}`. (`Report.warn` 이 없으면 `warnings.append` 를 쓰는 기존 메서드 이름에 맞춘다.)

- [ ] **Step 6: 테스트 통과 + 내보내기 실행**

Run: `python3 -I -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -2 && python3 -I tools/ft2_export.py extracted/FarlandTactics2 web/public/assets | tail -4 && ls web/public/assets/data/event*.json | wc -l && ls web/public/assets/bmp | wc -l`
Expected: `OK`; `events 20, bmp 397`(또는 Thumbs 제외 수); 20개 JSON; 397개 PNG; errors 0.

- [ ] **Step 7: 커밋**

```bash
git add tools/ft2_event_disasm.py tools/ft2_export.py tools/test_ft2_export.py
git commit -m "feat(tools): structured event-script decoder; export event JSON and bmp PNGs"
```

---

### Task 2: 프로그램 모델과 로더

**Files:**
- Create: `web/src/script/program.ts`
- Modify: `web/src/assets/types.ts` (AssetIndex), `web/src/data/loader.ts` (event)
- Test: `web/test/program.test.ts`

**Interfaces:**
- Produces: `type Arg = number | string | null | Arg[]`, `interface Instr { at: number; op: string; args: Arg[] }`, `interface Program { stage: number; symbols: Record<string, number>; code: Instr[]; byOffset: Map<number, number> }`, `loadProgram(stage: number, raw: unknown): Program` (ScriptError 던짐), `findLabel(p: Program, name: string): number | null` (code index), `num(a: Arg | undefined): number | null`, `str(a): string | null`, `list(a): number[]`, `face(a): [number, string | null] | null`; `DataLoader.event(n): Promise<Program>`; `AssetIndex { …; events?: number[]; bmp?: string[] }`.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/program.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { face, findLabel, list, loadProgram, num, ScriptError, str } from '../src/script/program';

const raw = {
  symbols: { begin: 10, Next: 20 },
  code: [
    { at: 10, op: 'FLAG_SET', args: [2, 0] },
    { at: 14, op: 'MSG_TOP', args: [[15, 'a']] },
    { at: 18, op: 'SHOP', args: [[1, 5]] },
    { at: 20, op: 'END', args: [] },
  ],
};

describe('program', () => {
  it('loads a decoded event file, indexes offsets and finds labels case-insensitively', () => {
    const p = loadProgram(3, raw);
    expect(p.stage).toBe(3);
    expect(findLabel(p, 'BEGIN')).toBe(0);
    expect(findLabel(p, 'next')).toBe(3);
    expect(findLabel(p, 'nowhere')).toBeNull();
    expect(p.byOffset.get(18)).toBe(2);
  });
  it('rejects a malformed file with a ScriptError naming the problem', () => {
    expect(() => loadProgram(3, { symbols: {}, code: [{ at: 1, op: 5, args: [] }] })).toThrow(ScriptError);
    expect(() => loadProgram(3, null)).toThrow(/event03/);
    expect(() => loadProgram(3, { symbols: { x: 99 }, code: [] })).toThrow(/label x/);
  });
  it('argument helpers return null for a missing argument instead of throwing', () => {
    const p = loadProgram(0, raw);
    expect(num(p.code[0]!.args[0])).toBe(2);
    expect(num(p.code[0]!.args[5])).toBeNull();
    expect(face(p.code[1]!.args[0])).toEqual([15, 'a']);
    expect(list(p.code[2]!.args[0])).toEqual([1, 5]);
    expect(str('abc')).toBe('abc');
    expect(str(3)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/program.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/script/program.ts`:
```ts
export type Arg = number | string | null | Arg[];
export interface Instr { at: number; op: string; args: Arg[] }
/** One decoded event file (tools/ft2_export.py → data/eventNN.json). */
export interface Program { stage: number; symbols: Record<string, number>; code: Instr[]; byOffset: Map<number, number> }

export class ScriptError extends Error {
  override name = 'ScriptError';
  constructor(stage: number, message: string) { super(`event${String(stage).padStart(2, '0')}: ${message}`); }
}

const isArg = (a: unknown): a is Arg => a === null || typeof a === 'number' || typeof a === 'string' || (Array.isArray(a) && a.every(isArg));

export function loadProgram(stage: number, raw: unknown): Program {
  if (!raw || typeof raw !== 'object') throw new ScriptError(stage, 'not an object');
  const { symbols, code } = raw as { symbols?: unknown; code?: unknown };
  if (!symbols || typeof symbols !== 'object' || !Array.isArray(code)) throw new ScriptError(stage, 'needs symbols and code');
  const byOffset = new Map<number, number>();
  code.forEach((c, i) => {
    const ins = c as Partial<Instr>;
    if (typeof ins.at !== 'number' || typeof ins.op !== 'string' || !Array.isArray(ins.args) || !ins.args.every(isArg)) throw new ScriptError(stage, `instruction ${i} malformed`);
    byOffset.set(ins.at, i);
  });
  for (const [name, off] of Object.entries(symbols as Record<string, unknown>)) {
    if (typeof off !== 'number' || !byOffset.has(off)) throw new ScriptError(stage, `label ${name} points outside the code`);
  }
  return { stage, symbols: symbols as Record<string, number>, code: code as Instr[], byOffset };
}

/** FUN_004083b0: labels are matched without case; returns the code index. */
export function findLabel(p: Program, name: string): number | null {
  const want = name.toLowerCase();
  for (const [label, off] of Object.entries(p.symbols)) if (label.toLowerCase() === want) return p.byOffset.get(off) ?? null;
  return null;
}

export const num = (a: Arg | undefined): number | null => (typeof a === 'number' ? a : null);
export const str = (a: Arg | undefined): string | null => (typeof a === 'string' ? a : null);
export const list = (a: Arg | undefined): number[] => (Array.isArray(a) ? a.filter((x): x is number => typeof x === 'number') : []);
export const face = (a: Arg | undefined): [number, string | null] | null =>
  Array.isArray(a) && typeof a[0] === 'number' && (a[1] === null || typeof a[1] === 'string') ? [a[0], a[1]] : null;
```

`web/src/assets/types.ts`: `export interface AssetIndex { format: 1; maps: string[]; sprites: string[]; events?: number[]; bmp?: string[] }`.

`web/src/data/loader.ts`: import `loadProgram, type Program` from `'../script/program'`; 메서드 추가:
```ts
  async event(n: number): Promise<Program> {
    return loadProgram(n, await this.json(`event${String(n).padStart(2, '0')}.json`));
  }
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/program.test.ts && npx tsc --noEmit -p .`
Expected: PASS 3/3, tsc 0.

- [ ] **Step 5: 커밋**

```bash
git add web/src/script/program.ts web/src/assets/types.ts web/src/data/loader.ts web/test/program.test.ts
git commit -m "feat(web): event program model (labels, typed arguments) and loader"
```

---

### Task 3: 캠페인 상태

**Files:**
- Create: `web/src/game/campaign.ts`
- Modify: `web/src/battle/unit.ts` (Unit.sprite), `web/test/helpers/battleFixtures.ts` (unit() 기본값)
- Test: `web/test/campaign.test.ts`

**Interfaces:**
- Produces: `Unit.sprite?: SpriteOverride` with `interface SpriteOverride { apd?: string; layer?: number; anim?: { name: string; loop: boolean; force: boolean }; hidden?: boolean; offset?: { x: number; y: number }; marker?: boolean }`;
  `interface Campaign { units: (Unit | null)[]; inventory: Inventory; flags: number[]; townFlags: number[]; stage: number; turn: number; episode: string; message: string; speakerName: string; townSet: 1 | 2 | 3; townExtra: boolean; lastSprite: string | null; battleTarget: number | null; actor: number | null }`;
  `newCampaign(): Campaign` (골드 200, 턴 −1, stage 0, flags 100개 0, townFlags 16개 0, townSet 1);
  `findUnit(c, id): Unit | null` (24 → battleTarget 슬롯; 0 → null; 그 외 id 일치 첫 유닛);
  `createScriptUnit(c, id, race, c0, r0, apd, layer): Unit | null` (빈 슬롯 10..49, side 1, status 0, sprite.apd/layer; 없으면 null);
  `removeScriptUnits(c)`, `removeDead(c)`, `loadRoster(c, recs, tables, rng)` (슬롯 10..49 비우고 `createUnit`; `(0,0)` 자리표시자는 그대로 둔다 — 배치는 BATTLE_START 때 계획 B).

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/campaign.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createScriptUnit, findUnit, loadRoster, newCampaign, removeDead, removeScriptUnits } from '../src/game/campaign';
import type { RosterUnit } from '../src/data/types';
import { fixedRng, tables, unit } from './helpers/battleFixtures';

const rec = (over: Partial<RosterUnit>): RosterUnit => ({ unit_id: 8, race: 1, level: 1, dir: 0, c: 3, r: 3, status: 0, side: 4, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0, ...over });

describe('campaign', () => {
  it('a new game has 200 gold, turn −1, stage 0, cleared flags and no units', () => {
    const c = newCampaign();
    expect(c.inventory).toEqual({ items: [], gold: 200 });
    expect(c).toMatchObject({ turn: -1, stage: 0, townSet: 1, townExtra: false, battleTarget: null });
    expect(c.flags).toHaveLength(100);
    expect(c.flags.every((f) => f === 0)).toBe(true);
    expect(c.townFlags).toHaveLength(16);
    expect(c.units.filter(Boolean)).toHaveLength(0);
  });
  it('findUnit resolves id 24 to the battle target, 0 to nothing and others by id', () => {
    const c = newCampaign();
    c.units[0] = unit({ slot: 0, id: 1 }); c.units[1] = unit({ slot: 1, id: 2 }); c.units[10] = unit({ slot: 10, id: 8, side: 4 });
    expect(findUnit(c, 2)).toBe(c.units[1]);
    expect(findUnit(c, 0)).toBeNull();
    expect(findUnit(c, 24)).toBeNull();
    c.battleTarget = 10;
    expect(findUnit(c, 24)).toBe(c.units[10]);
    expect(findUnit(c, 99)).toBeNull();
  });
  it('script units take free slots from 10, carry their APD and layer, and REMOVE_SCRIPT_UNITS clears exactly them', () => {
    const c = newCampaign();
    c.units[10] = unit({ slot: 10, id: 8, side: 4 });
    const u = createScriptUnit(c, 101, 7, 13, 22, 'char_01d', 3)!;
    expect(u).toMatchObject({ slot: 11, id: 101, side: 1, c: 13, r: 22, sprite: { apd: 'char_01d', layer: 3 } });
    createScriptUnit(c, 4000, 7, 1, 1, 'npc_02', 5);
    removeScriptUnits(c);
    expect(c.units[10]).not.toBeNull();
    expect(c.units[11]).toBeNull();
    expect(c.units[12]).toBeNull();
  });
  it('removeDead drops fallen generic enemies (id 8, 24, > 30) with 0 HP or a non-dead status', () => {
    const c = newCampaign();
    c.units[10] = unit({ slot: 10, id: 8, side: 4, hp: 0, status: 1 });
    c.units[11] = unit({ slot: 11, id: 31, side: 4, hp: 5, status: 3 });
    c.units[12] = unit({ slot: 12, id: 12, side: 4, hp: 0, status: 1 });   // named: kept
    c.units[13] = unit({ slot: 13, id: 8, side: 4, hp: 5, status: 1 });    // dead status but HP left: status != 1 is false, hp 0 is false → kept
    removeDead(c);
    expect([10, 11, 12, 13].map((s) => c.units[s] === null)).toEqual([true, true, false, false]);
  });
  it('loadRoster replaces slots 10..49 with the roster records and leaves the party alone', () => {
    const c = newCampaign();
    c.units[0] = unit({ slot: 0, id: 1 });
    c.units[10] = unit({ slot: 10, id: 8, side: 4 });
    loadRoster(c, [rec({}), rec({ c: 4 }), rec({ unit_id: 1, side: 0, c: 5 })], tables(), fixedRng([0]));
    expect(c.units[0]).toMatchObject({ id: 1, c: 0 });
    expect(c.units[10]).toMatchObject({ id: 8, c: 3, side: 4 });
    expect(c.units[11]).toMatchObject({ c: 4 });
    expect(c.units[12]).toBeNull();                                        // party records do not create new units here
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/campaign.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/battle/unit.ts` 에 추가(`Unit` 위):
```ts
/** Presentation state the story scripts set on a unit (sprite handles live in the original unit record too). */
export interface SpriteOverride { apd?: string; layer?: number; anim?: { name: string; loop: boolean; force: boolean }; hidden?: boolean; offset?: { x: number; y: number }; marker?: boolean }
```
`Unit` 에 `sprite?: SpriteOverride;` 추가(`bag` 다음). `createUnit` 은 그대로(선택 필드). 픽스처 `unit()` 도 그대로(선택 필드).

`web/src/game/campaign.ts`:
```ts
import type { RandomSource } from '../battle/rng';
import { emptyInventory, type Inventory } from '../battle/inventory';
import { createUnit, MAX_SLOTS, PARTY_SLOTS, type Unit } from '../battle/unit';
import type { RosterUnit, Tables } from '../data/types';

export const FLAG_COUNT = 100;
export const TOWN_FLAG_COUNT = 16;
export const BATTLE_TARGET_ID = 24;

/** Everything the story carries between scripts, battles and towns (story_flow.md §2, event_script_format.md §5). */
export interface Campaign {
  units: (Unit | null)[];
  inventory: Inventory;
  flags: number[];
  townFlags: number[];
  stage: number;
  turn: number;
  episode: string;
  message: string;
  speakerName: string;
  townSet: 1 | 2 | 3;
  townExtra: boolean;
  lastSprite: string | null;
  battleTarget: number | null;   // slot of the unit scripts address as id 24
  actor: number | null;          // slot of the acting unit during battle hooks
}

/** FUN_004239b0 new game: empty units, 200 gold, town turn. */
export function newCampaign(): Campaign {
  const inventory = emptyInventory();
  inventory.gold = 200;
  return { units: new Array<Unit | null>(MAX_SLOTS).fill(null), inventory, flags: new Array<number>(FLAG_COUNT).fill(0), townFlags: new Array<number>(TOWN_FLAG_COUNT).fill(0),
    stage: 0, turn: -1, episode: '', message: '', speakerName: '', townSet: 1, townExtra: false, lastSprite: null, battleTarget: null, actor: null };
}

/** FUN_0040a590 / FUN_0041f5f0(2, id): id 24 is the battle target; id 0 never matches. */
export function findUnit(c: Campaign, id: number): Unit | null {
  if (id === 0) return null;
  if (id === BATTLE_TARGET_ID) return c.battleTarget === null ? null : c.units[c.battleTarget] ?? null;
  return c.units.find((u) => u !== null && u.id === id) ?? null;
}

const freeSlot = (c: Campaign): number => { for (let s = PARTY_SLOTS; s < MAX_SLOTS; s++) if (!c.units[s]) return s; return -1; };

/** LOAD_SPRITE / SPRITE_REUSE / ATTACH_SPRITE: an object unit (side 1) whose body is a named APD. */
export function createScriptUnit(c: Campaign, id: number, race: number, col: number, row: number, apd: string, layer: number): Unit | null {
  const slot = freeSlot(c);
  if (slot < 0) return null;
  const u: Unit = {
    slot, id, race, level: 1, dir: 0, c: col, r: row, status: 0, side: 1, weapon: 0, armor: 0, acc: [0, 0], dropItem: 0, dropGold: 0, bag: [0, 0, 0, 0],
    hpMax: 0, hp: 0, mpMax: 0, mp: 0, exp: 0, str: 0, def: 0, wis: 0, mgr: 0, agi: 0, spells: [], buff: { str: 0, def: 0, wis: 0, mgr: 0, agi: 0 }, elem: [0, 0, 0],
    moved: true, acted: true, special: false, statusCounter: 0, sprite: { apd, layer },
  };
  c.units[slot] = u;
  return u;
}

/** EXT REMOVE_SCRIPT_UNITS: slots 10.. whose side is 1. */
export function removeScriptUnits(c: Campaign): void {
  for (let s = PARTY_SLOTS; s < MAX_SLOTS; s++) if (c.units[s]?.side === 1) c.units[s] = null;
}

/** EXT REMOVE_DEAD: generic units (id 8, 24, > 30) in slots 10.. with 0 HP or a status other than dead. */
export function removeDead(c: Campaign): void {
  for (let s = PARTY_SLOTS; s < MAX_SLOTS; s++) {
    const u = c.units[s];
    if (u && (u.id === 8 || u.id === 24 || u.id > 30) && (u.hp === 0 || u.status !== 1)) c.units[s] = null;
  }
}

/** LOAD_UNITS: clear slots 10..49 and create the roster's non-party records there (party records are positions for the battle start). */
export function loadRoster(c: Campaign, recs: RosterUnit[], tables: Tables, rng: RandomSource): void {
  for (let s = PARTY_SLOTS; s < MAX_SLOTS; s++) c.units[s] = null;
  for (const rec of recs) {
    if (rec.side === 0) continue;
    const slot = freeSlot(c);
    if (slot < 0) break;
    c.units[slot] = createUnit(rec, slot, tables, rng);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run test/campaign.test.ts && npx tsc --noEmit -p .`
Expected: PASS 5/5, tsc 0.

- [ ] **Step 5: 커밋**

```bash
git add web/src/game/campaign.ts web/src/battle/unit.ts web/test/campaign.test.ts
git commit -m "feat(web): campaign state (new game, flags, script units, roster loading)"
```

---

### Task 4: Host 인터페이스와 VM — 흐름·플래그·대화·대기

**Files:**
- Create: `web/src/script/host.ts`, `web/src/script/vm.ts`
- Test: `web/test/vm.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Resources { program(stage: number): Program | null; roster(n: number): RosterUnit[] | null; tables: Tables; rng: RandomSource }
export interface Host {
  fade(dir: 'in' | 'out', step: number): void; fadeBusy(): boolean;
  showImage(name: string, step: number): void; hideImage(): void; clearScreen(): void;
  tint(kind: 'dim' | 'sunset' | 'night' | 'dusk' | 'white' | 'uiDark' | 'uiHalfA' | 'uiHalfB' | 'textpal' | 'facepal' | 'black' | 'dimUi' | 'reset', n: number, pct?: number): void;
  shake(n: number): void;
  cameraTile(x: number, y: number): void; cameraUnit(u: Unit): void; cameraScroll(dx: number, dy: number, tx: number, ty: number, ms: number): void; scrollBusy(): boolean;
  openWindow(where: 'top' | 'bottom', speaker: number, faceLetter: string | null): void; closeWindow(where: 'top' | 'bottom'): void;
  text(where: 'top' | 'bottom', line: string, speakerName: string | null): void;
  takeClick(): boolean;                                   // true once per click
  openModal(kind: 'message' | 'ask' | 'shop' | 'result' | 'episode' | 'save', payload: unknown): void; modalResult(): number | null;   // null while open
  anim(u: Unit, name: string, loop: boolean, force: boolean): void; unitBusy(u: Unit, withEffects: boolean): boolean;
  moveUnit(u: Unit, dirs: Dir[], animBase: string): void;
  marker(u: Unit, on: boolean): void; sweat(u: Unit): void; appear(u: Unit, ms: number): void; vanish(u: Unit, ms: number): void;
  showOnly(u: Unit): void; setVisible(u: Unit, on: boolean): void; allVisible(on: boolean): void;
  resetSprites(): void; loadMap(n: number): void; mapBusy(): boolean; unitsChanged(): void;
  music(n: number): void; musicFade(ms: number, on: boolean): void; musicFadeBusy(): boolean; sound(name: string): void;
  playVisual(n: number): void; save(slot: number): void; quitComplete(): void; writeCompleteFlag(): void;
  enterBattle(): void; resumeBattle(): void; enterTown(): void; fieldMode(): void; enemyPhase(): boolean;
  scriptEnded(restore: 'battle' | 'town' | 'previous'): void;
  log(kind: 'warn' | 'info', text: string): void;
}
export class FakeHost implements Host { calls: [string, ...unknown[]][]; clicks = 0; fading = false; busyUnits = new Set<number>(); modal: number | null = 0; … }
export type StepResult = 'running' | 'waiting' | 'ended';
export class ScriptVm {
  readonly state: { pc: number; program: Program | null; result: number; less: number; callReturn: { program: Program; pc: number } | null; restore: 'battle' | 'town' | 'previous'; pendingStage: number | null };
  constructor(res: Resources, campaign: Campaign, host: Host);
  run(stage: number, label: string): boolean;
  step(now: number): StepResult;
}
```

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/vm.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { newCampaign } from '../src/game/campaign';
import { FakeHost, type Resources } from '../src/script/host';
import { loadProgram, type Program } from '../src/script/program';
import { ScriptVm } from '../src/script/vm';
import { fixedRng, tables } from './helpers/battleFixtures';

/** Build a program from [label?, op, ...args] rows; offsets are synthetic. */
function prog(stage: number, rows: (string | [string, ...unknown[]])[]): Program {
  const symbols: Record<string, number> = {}; const code: unknown[] = [];
  rows.forEach((row, i) => {
    if (typeof row === 'string') { symbols[row] = i * 4; return; }
    const [op, ...args] = row; code.push({ at: i * 4, op, args });
  });
  // labels point at the next instruction's offset
  const fixed: Record<string, number> = {};
  for (const [name, off] of Object.entries(symbols)) { const next = (code as { at: number }[]).find((c) => c.at >= off); fixed[name] = next ? next.at : (code as { at: number }[]).at(-1)!.at; }
  return loadProgram(stage, { symbols: fixed, code });
}
const res = (...programs: Program[]): Resources => ({ program: (n) => programs.find((p) => p.stage === n) ?? null, roster: () => null, tables: tables(), rng: fixedRng([0]) });
const setup = (programs: Program[]) => { const host = new FakeHost(); const c = newCampaign(); const vm = new ScriptVm(res(...programs), c, host); return { host, c, vm }; };

describe('ScriptVm: flow and flags', () => {
  it('runs a label to END, ends with the restore mode, and sets flags with FLAG_* ops', () => {
    const { host, c, vm } = setup([prog(0, ['begin', ['FLAG_SET', 2, 5], ['FLAG_ADD', 2, 1], ['FLAG_SUB', 2, 2], ['FLAG_BIT_SET', 3, 4], ['FLAG_BIT_TOGGLE', 3, 4], ['FLAG_BIT_SET', 3, 1], ['FLAG_BIT_TEST', 3, 1], ['END']])]);
    expect(vm.run(0, 'BEGIN')).toBe(true);
    expect(vm.step(0)).toBe('ended');
    expect(c.flags[2]).toBe(4);
    expect(c.flags[3]).toBe(2);
    expect(vm.state.result).toBe(1);
    expect(host.calls.at(-1)).toEqual(['scriptEnded', 'previous']);
  });
  it('FLAG_CMP sets result and less; JUMP_IF_RESULT/LESS branch on them', () => {
    const { c, vm } = setup([prog(0, ['begin', ['FLAG_SET', 1, 3], ['FLAG_CMP', 1, 5], ['JUMP_IF_LESS', 1, 'small'], ['FLAG_SET', 9, 1], ['END'], 'small', ['FLAG_CMP', 1, 3], ['JUMP_IF_RESULT', 0, 'never'], ['FLAG_SET', 9, 2], ['END'], 'never', ['FLAG_SET', 9, 3], ['END']])]);
    vm.run(0, 'begin'); vm.step(0);
    expect(c.flags[9]).toBe(2);
  });
  it('a jump to a missing label ends the script with a warning', () => {
    const { host, vm } = setup([prog(0, ['begin', ['JUMP', 'ghost'], ['FLAG_SET', 0, 1], ['END']])]);
    vm.run(0, 'begin');
    expect(vm.step(0)).toBe('ended');
    expect(host.calls.some((c) => c[0] === 'log' && c[1] === 'warn' && String(c[2]).includes('ghost'))).toBe(true);
  });
  it('CALL keeps one return address', () => {
    const { c, vm } = setup([prog(0, ['begin', ['CALL', 'a'], ['FLAG_SET', 5, 1], ['END'], 'a', ['CALL', 'b'], ['FLAG_SET', 6, 1], ['RETURN'], 'b', ['FLAG_SET', 7, 1], ['RETURN']])]);
    vm.run(0, 'begin'); vm.step(0);
    expect(c.flags[7]).toBe(1);
    expect(c.flags[6]).toBe(1);   // RETURN from b goes back into a (the only saved address)
    expect(c.flags[5]).toBe(0);   // a's RETURN has no address left → script ends
  });
  it('LOAD_SCRIPT switches programs and keeps the flags; a missing target label ends the script', () => {
    const { c, vm, host } = setup([prog(0, ['begin', ['FLAG_SET', 1, 7], ['LOAD_SCRIPT', 2, 'begin'], ['END']]), prog(2, ['begin', ['FLAG_ADD', 1, 1], ['LOAD_SCRIPT', 5, 'nowhere'], ['END']])]);
    vm.run(0, 'begin'); expect(vm.step(0)).toBe('ended');
    expect(c.flags[1]).toBe(8);
    expect(vm.state.program?.stage).toBe(2);
    expect(host.calls.filter((x) => x[0] === 'log' && x[1] === 'warn')).toHaveLength(1);
  });
  it('run() returns false for an unknown stage or label', () => {
    const { vm } = setup([prog(0, ['begin', ['END']])]);
    expect(vm.run(7, 'begin')).toBe(false);
    expect(vm.run(0, 'nope')).toBe(false);
  });
});

describe('ScriptVm: waits, windows and modals', () => {
  it('WAIT holds the same instruction until the time passes; WAIT_FADE until the host finishes fading', () => {
    const { host, vm, c } = setup([prog(0, ['begin', ['WAIT', 1000], ['FADE_OUT', 8], ['WAIT_FADE'], ['FLAG_SET', 0, 1], ['END']])]);
    vm.run(0, 'begin');
    expect(vm.step(100)).toBe('waiting');
    expect(vm.step(900)).toBe('waiting');
    host.fading = true;
    expect(vm.step(1100)).toBe('waiting');
    expect(host.calls).toContainEqual(['fade', 'out', 8]);
    host.fading = false;
    expect(vm.step(1200)).toBe('ended');
    expect(c.flags[0]).toBe(1);
  });
  it('MSG_TOP/TEXT open a window, print the speaker name on the first line only, and close on speaker 0', () => {
    const { host, vm } = setup([prog(0, ['begin', ['MSG_BOTTOM', [1, 'b']], ['TEXT', '아프다...」'], ['TEXT', '두_번째'], ['MSG_BOTTOM', [0, null]], ['SET_SPEAKER_NAME', '수상한_남자'], ['MSG_TOP', [14, 'a']], ['TEXT', '...'], ['MSG_TOP', [31, null]], ['TEXT', 'x'], ['END']])]);
    vm.run(0, 'begin'); vm.step(0);
    const texts = host.calls.filter((x) => x[0] === 'text');
    expect(host.calls[0]).toEqual(['openWindow', 'bottom', 1, 'b']);
    expect(texts[0]).toEqual(['text', 'bottom', '아프다...」', '카린']);
    expect(texts[1]).toEqual(['text', 'bottom', '두 번째', null]);
    expect(host.calls).toContainEqual(['closeWindow', 'bottom']);
    expect(texts[2]).toEqual(['text', 'top', '...', '수상한 남자']);
    expect(texts[3]).toEqual(['text', 'top', 'x', null]);                 // speaker ≥ 30 and no unit → no name
  });
  it('WAIT_CLICK waits for a click; with a timeout it releases on time', () => {
    const { host, vm } = setup([prog(0, ['begin', ['WAIT_CLICK', 0], ['WAIT_CLICK', 500], ['END']])]);
    vm.run(0, 'begin');
    expect(vm.step(0)).toBe('waiting');
    host.clicks = 1;
    expect(vm.step(10)).toBe('waiting');      // second WAIT_CLICK, no click left
    expect(vm.step(400)).toBe('waiting');
    expect(vm.step(520)).toBe('ended');
  });
  it('MESSAGE and ASK open a modal and wait for its result; ASK stores the answer in result', () => {
    const { host, vm, c } = setup([prog(0, ['begin', ['MESSAGE', '안녕'], ['ASK', '+계속?'], ['JUMP_IF_RESULT', 1, 'yes'], ['FLAG_SET', 0, 2], ['END'], 'yes', ['FLAG_SET', 0, 1], ['END']])]);
    vm.run(0, 'begin');
    host.modal = null;
    expect(vm.step(0)).toBe('waiting');
    expect(host.calls[0]).toEqual(['openModal', 'message', '안녕']);
    host.modal = 1;
    expect(vm.step(1)).toBe('waiting');                                     // ASK opened
    expect(host.calls.at(-1)).toEqual(['openModal', 'ask', '+계속?']);
    host.modal = 1;
    expect(vm.step(2)).toBe('ended');
    expect(c.flags[0]).toBe(1);
  });
  it('EPISODE stores the title and shows it when asked; SHOP waits on the modal', () => {
    const { host, vm, c } = setup([prog(0, ['begin', ['EPISODE', '첫_업무', 1], ['SHOP', [1, 5]], ['END']])]);
    vm.run(0, 'begin'); host.modal = null;
    expect(vm.step(0)).toBe('waiting');
    expect(c.episode).toBe('첫 업무');
    expect(host.calls).toContainEqual(['openModal', 'episode', '첫 업무']);
    host.modal = 1;
    expect(vm.step(1)).toBe('waiting');
    expect(host.calls.at(-1)).toEqual(['openModal', 'shop', [1, 5]]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/vm.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: host.ts**

```ts
import type { Dir } from '../battle/grid';
import type { RandomSource } from '../battle/rng';
import type { Unit } from '../battle/unit';
import type { RosterUnit, Tables } from '../data/types';
import type { Program } from './program';

/** Synchronous access to preloaded programs and rosters (the page loads them before a script runs). */
export interface Resources { program(stage: number): Program | null; roster(n: number): RosterUnit[] | null; tables: Tables; rng: RandomSource }

export type Where = 'top' | 'bottom';
export type Tint = 'dim' | 'sunset' | 'night' | 'dusk' | 'white' | 'uiDark' | 'uiHalfA' | 'uiHalfB' | 'textpal' | 'facepal' | 'black' | 'dimUi' | 'reset';
export type ModalKind = 'message' | 'ask' | 'shop' | 'result' | 'episode' | 'save';
export type Restore = 'battle' | 'town' | 'previous';

/** Every side effect a script can have (spec §7). The VM never touches the DOM or the canvas itself. */
export interface Host {
  fade(dir: 'in' | 'out', step: number): void; fadeBusy(): boolean;
  showImage(name: string, step: number): void; hideImage(): void; clearScreen(): void;
  tint(kind: Tint, n: number, pct?: number): void; shake(n: number): void;
  cameraTile(x: number, y: number): void; cameraUnit(u: Unit): void; cameraScroll(dx: number, dy: number, tx: number, ty: number, ms: number): void; scrollBusy(): boolean;
  openWindow(where: Where, speaker: number, faceLetter: string | null): void; closeWindow(where: Where): void;
  text(where: Where, line: string, speakerName: string | null): void;
  takeClick(): boolean;
  openModal(kind: ModalKind, payload: unknown): void; modalResult(): number | null;
  anim(u: Unit, name: string, loop: boolean, force: boolean): void; unitBusy(u: Unit, withEffects: boolean): boolean;
  moveUnit(u: Unit, dirs: Dir[], animBase: string): void;
  marker(u: Unit, on: boolean): void; sweat(u: Unit): void; appear(u: Unit, ms: number): void; vanish(u: Unit, ms: number): void;
  showOnly(u: Unit): void; setVisible(u: Unit, on: boolean): void; allVisible(on: boolean): void;
  resetSprites(): void; loadMap(n: number): void; mapBusy(): boolean; unitsChanged(): void;
  music(n: number): void; musicFade(ms: number, on: boolean): void; musicFadeBusy(): boolean; sound(name: string): void;
  playVisual(n: number): void; save(slot: number): void; quitComplete(): void; writeCompleteFlag(): void;
  enterBattle(): void; resumeBattle(): void; enterTown(): void; fieldMode(): void; enemyPhase(): boolean;
  scriptEnded(restore: Restore): void;
  log(kind: 'warn' | 'info', text: string): void;
}

/** Records every call; waits are driven by its public fields. */
export class FakeHost implements Host {
  calls: [string, ...unknown[]][] = [];
  clicks = 0;
  fading = false;
  scrolling = false;
  loading = false;
  musicFading = false;
  busyUnits = new Set<number>();
  modal: number | null = 0;          // what modalResult() returns; set null to keep a modal open
  enemy = false;
  private rec(name: string, ...args: unknown[]): void { this.calls.push([name, ...args]); }
  fade(dir: 'in' | 'out', step: number): void { this.rec('fade', dir, step); }
  fadeBusy(): boolean { return this.fading; }
  showImage(name: string, step: number): void { this.rec('showImage', name, step); }
  hideImage(): void { this.rec('hideImage'); }
  clearScreen(): void { this.rec('clearScreen'); }
  tint(kind: Tint, n: number, pct?: number): void { this.rec('tint', kind, n, pct); }
  shake(n: number): void { this.rec('shake', n); }
  cameraTile(x: number, y: number): void { this.rec('cameraTile', x, y); }
  cameraUnit(u: Unit): void { this.rec('cameraUnit', u.slot); }
  cameraScroll(dx: number, dy: number, tx: number, ty: number, ms: number): void { this.rec('cameraScroll', dx, dy, tx, ty, ms); }
  scrollBusy(): boolean { return this.scrolling; }
  openWindow(where: Where, speaker: number, faceLetter: string | null): void { this.rec('openWindow', where, speaker, faceLetter); }
  closeWindow(where: Where): void { this.rec('closeWindow', where); }
  text(where: Where, line: string, speakerName: string | null): void { this.rec('text', where, line, speakerName); }
  takeClick(): boolean { if (this.clicks > 0) { this.clicks--; return true; } return false; }
  openModal(kind: ModalKind, payload: unknown): void { this.rec('openModal', kind, payload); }
  modalResult(): number | null { return this.modal; }
  anim(u: Unit, name: string, loop: boolean, force: boolean): void { this.rec('anim', u.slot, name, loop, force); }
  unitBusy(u: Unit, withEffects: boolean): boolean { void withEffects; return this.busyUnits.has(u.slot); }
  moveUnit(u: Unit, dirs: Dir[], animBase: string): void { this.rec('moveUnit', u.slot, dirs, animBase); }
  marker(u: Unit, on: boolean): void { this.rec('marker', u.slot, on); }
  sweat(u: Unit): void { this.rec('sweat', u.slot); }
  appear(u: Unit, ms: number): void { this.rec('appear', u.slot, ms); }
  vanish(u: Unit, ms: number): void { this.rec('vanish', u.slot, ms); }
  showOnly(u: Unit): void { this.rec('showOnly', u.slot); }
  setVisible(u: Unit, on: boolean): void { this.rec('setVisible', u.slot, on); }
  allVisible(on: boolean): void { this.rec('allVisible', on); }
  resetSprites(): void { this.rec('resetSprites'); }
  loadMap(n: number): void { this.rec('loadMap', n); }
  mapBusy(): boolean { return this.loading; }
  unitsChanged(): void { this.rec('unitsChanged'); }
  music(n: number): void { this.rec('music', n); }
  musicFade(ms: number, on: boolean): void { this.rec('musicFade', ms, on); }
  musicFadeBusy(): boolean { return this.musicFading; }
  sound(name: string): void { this.rec('sound', name); }
  playVisual(n: number): void { this.rec('playVisual', n); }
  save(slot: number): void { this.rec('save', slot); }
  quitComplete(): void { this.rec('quitComplete'); }
  writeCompleteFlag(): void { this.rec('writeCompleteFlag'); }
  enterBattle(): void { this.rec('enterBattle'); }
  resumeBattle(): void { this.rec('resumeBattle'); }
  enterTown(): void { this.rec('enterTown'); }
  fieldMode(): void { this.rec('fieldMode'); }
  enemyPhase(): boolean { return this.enemy; }
  scriptEnded(restore: Restore): void { this.rec('scriptEnded', restore); }
  log(kind: 'warn' | 'info', text: string): void { this.rec('log', kind, text); }
}
```

- [ ] **Step 4: vm.ts (이 작업의 범위: 흐름·플래그·대화·대기·모달; 유닛 계열은 Task 5 에서 `exec` 에 추가)**

```ts
import { SPEAKER_NAMES } from '../ui/panel';
import type { Campaign } from '../game/campaign';
import { findUnit } from '../game/campaign';
import { face, findLabel, list, num, str, type Instr, type Program } from './program';
import type { Host, Resources, Restore, Where } from './host';

export type StepResult = 'running' | 'waiting' | 'ended';
const MAX_PER_FRAME = 1000;

/** TEXT markup: '_' is a space; '*' is stripped [추정]; [Snn]/[Cnn] tags stay for the dialogue renderer. */
export const scriptText = (s: string): string => s.replace(/_/g, ' ').replace(/\*/g, '');

/** Interprets one event program a frame at a time (event_script_format.md §2–§5). */
export class ScriptVm {
  readonly state: { pc: number; program: Program | null; result: number; less: number; callReturn: { program: Program; pc: number } | null; restore: Restore; pendingStage: number | null } =
    { pc: 0, program: null, result: 0, less: 0, callReturn: null, restore: 'previous', pendingStage: null };
  private wait: { pc: number; until: number } | null = null;
  private modalOpen = false;
  private timer = 0;
  private window: { where: Where; speaker: number; firstLine: boolean } | null = null;

  constructor(private readonly res: Resources, protected readonly c: Campaign, protected readonly host: Host) {}

  /** FUN_004083b0: load the stage file and jump to the label; false when either is missing. */
  run(stage: number, label: string): boolean {
    const program = this.res.program(stage);
    if (!program) { this.host.log('warn', `event${String(stage).padStart(2, '0')}: no such program`); return false; }
    const pc = findLabel(program, label);
    if (pc === null) { this.host.log('warn', `event${String(stage).padStart(2, '0')}: no label ${label}`); return false; }
    this.state.program = program; this.state.pc = pc; this.wait = null; this.modalOpen = false; this.window = null;
    return true;
  }

  get running(): boolean { return this.state.program !== null; }

  step(now: number): StepResult {
    for (let n = 0; n < MAX_PER_FRAME; n++) {
      const p = this.state.program;
      if (!p) return 'ended';
      const ins = p.code[this.state.pc];
      if (!ins) return this.end();
      const r = this.exec(ins, now);
      if (r === 'wait') return 'waiting';
      if (r === 'end') return this.end();
      if (r === 'next') this.state.pc++;
      // 'jumped': pc already set
    }
    return 'running';
  }

  private end(): StepResult {
    if (this.state.pendingStage !== null) {
      const stage = this.state.pendingStage; this.state.pendingStage = null;
      this.c.stage = stage;
      if (this.run(stage, 'begin')) return 'running';
    }
    this.state.program = null;
    this.host.scriptEnded(this.state.restore);
    this.state.restore = 'previous';
    return 'ended';
  }

  private jump(label: string): 'jumped' | 'end' {
    const p = this.state.program!;
    const pc = findLabel(p, label);
    if (pc === null) { this.host.log('warn', `event${String(p.stage).padStart(2, '0')}: no label ${label}`); return 'end'; }
    this.state.pc = pc;
    return 'jumped';
  }

  /** Hold this instruction until `until`; the first call arms the timer. */
  private waitUntil(now: number, until: () => number): 'wait' | 'next' {
    if (!this.wait || this.wait.pc !== this.state.pc) this.wait = { pc: this.state.pc, until: until() };
    if (now < this.wait.until) return 'wait';
    this.wait = null;
    return 'next';
  }

  private modal(kind: Parameters<Host['openModal']>[0], payload: unknown): { done: boolean; result: number } {
    if (!this.modalOpen) { this.host.openModal(kind, payload); this.modalOpen = true; }
    const r = this.host.modalResult();
    if (r === null) return { done: false, result: 0 };
    this.modalOpen = false;
    return { done: true, result: r };
  }

  private speakerName(spk: number): string | null {
    if (spk === 14) return scriptText(this.c.speakerName);
    if (spk < 30) return SPEAKER_NAMES[spk] ?? null;
    const u = findUnit(this.c, spk);
    return u ? this.res.tables.race[u.race]?.name.replace(/_/g, ' ') ?? null : null;
  }

  protected exec(ins: Instr, now: number): 'next' | 'wait' | 'jumped' | 'end' {
    const a = ins.args;
    const f = this.c.flags;
    const i = (k: number) => num(a[k]);
    switch (ins.op) {
      case 'END': case 'DB': return 'end';
      case 'END_RESUME': this.host.resumeBattle(); return 'end';
      case 'JUMP': return this.jump(str(a[0]) ?? '');
      case 'JUMP_IF_RESULT': return ((this.state.result !== 0) === ((i(0) ?? 0) !== 0)) ? this.jump(str(a[1]) ?? '') : 'next';
      case 'JUMP_IF_LESS': return ((this.state.less !== 0) === ((i(0) ?? 0) !== 0)) ? this.jump(str(a[1]) ?? '') : 'next';
      case 'CALL': this.state.callReturn = { program: this.state.program!, pc: this.state.pc + 1 }; return this.jump(str(a[0]) ?? '');
      case 'RETURN': { const r = this.state.callReturn; if (!r) return 'end'; this.state.callReturn = null; this.state.program = r.program; this.state.pc = r.pc; return 'jumped'; }
      case 'LOAD_SCRIPT': { const stage = i(0) ?? 0; this.c.stage = stage; return this.run(stage, str(a[1]) ?? '') ? 'jumped' : 'end'; }
      case 'NEXT_STAGE': f.fill(0); for (let s = 10; s < this.c.units.length; s++) this.c.units[s] = null; this.state.pendingStage = this.c.stage + 1; return 'next';
      case 'FIELD_MODE': this.state.restore = 'battle'; this.host.fieldMode(); return 'next';
      case 'FLAG_SET': f[i(0) ?? 0] = i(1) ?? 0; return 'next';
      case 'FLAG_ADD': f[i(0) ?? 0] = (f[i(0) ?? 0] ?? 0) + (i(1) ?? 0); return 'next';
      case 'FLAG_SUB': f[i(0) ?? 0] = (f[i(0) ?? 0] ?? 0) - (i(1) ?? 0); return 'next';
      case 'FLAG_CMP': { const v = f[i(0) ?? 0] ?? 0, w = i(1) ?? 0; this.state.result = v === w ? 1 : 0; this.state.less = v < w ? 1 : 0; return 'next'; }
      case 'FLAGS_CLEAR': f.fill(0); return 'next';
      case 'FLAG_BIT_SET': f[i(0) ?? 0] = (f[i(0) ?? 0] ?? 0) | (1 << (i(1) ?? 0)); return 'next';
      case 'FLAG_BIT_CLR': f[i(0) ?? 0] = (f[i(0) ?? 0] ?? 0) & ~(1 << (i(1) ?? 0)); return 'next';
      case 'FLAG_BIT_TOGGLE': f[i(0) ?? 0] = (f[i(0) ?? 0] ?? 0) ^ (1 << (i(1) ?? 0)); return 'next';
      case 'FLAG_BIT_TEST': this.state.result = ((f[i(0) ?? 0] ?? 0) & (1 << (i(1) ?? 0))) !== 0 ? 1 : 0; return 'next';
      case 'STAGE_FROM_FLAG': this.c.stage = f[i(0) ?? 0] ?? 0; return 'next';
      case 'FLAG_FROM_TOWN': f[i(0) ?? 0] = this.c.townSet; return 'next';
      case 'TOWN_FLAG_SET': this.c.townFlags[i(0) ?? 0] = i(1) ?? 0; return 'next';
      case 'TOWN_SET': { const s = i(0) ?? 0; if (s === 1 || s === 2 || s === 3) this.c.townSet = s; return 'next'; }
      case 'TOWN_EXTRA': this.c.townExtra = (i(0) ?? 0) !== 0; return 'next';
      case 'RESET_PAL_STAGE0': this.host.tint('reset', 0); this.c.stage = 0; return 'next';
      // waits
      case 'WAIT': return this.waitUntil(now, () => now + (i(0) ?? 0));
      case 'WAIT_FADE': return this.host.fadeBusy() ? 'wait' : 'next';
      case 'WAIT_SCROLL': return this.host.scrollBusy() ? 'wait' : 'next';
      case 'WAIT_MUSIC_FADE': return this.host.musicFadeBusy() ? 'wait' : 'next';
      case 'WAIT_CLICK': { const ms = i(0) ?? 0; if (this.host.takeClick()) { this.wait = null; return 'next'; } if (ms <= 0) return 'wait'; return this.waitUntil(now, () => now + ms); }
      case 'TIMER_START': this.timer = now; return 'next';
      case 'WAIT_TIMER': return now - this.timer < (i(0) ?? 0) * 1000 ? 'wait' : 'next';
      // screen
      case 'FADE_IN': this.host.fade('in', i(0) ?? 0); return 'next';
      case 'FADE_OUT': this.host.fade('out', i(0) ?? 0); return 'next';
      case 'SHOW_IMAGE': this.host.showImage(str(a[0]) ?? '', i(1) ?? 0); return 'next';
      case 'HIDE_IMAGE': this.host.hideImage(); return 'next';
      case 'CLEAR_SCREEN': this.host.clearScreen(); return 'next';
      case 'DIM_SCENE': this.host.tint('dim', i(0) ?? 0); return 'next';
      case 'DIM_UI': this.host.tint('dimUi', i(0) ?? 0, i(1) ?? 100); return 'next';
      case 'FLASH_WHITE': this.host.tint('white', i(0) ?? 0); return 'next';
      case 'CLEAR_TEXTPAL': this.host.tint('textpal', i(0) ?? 0); return 'next';
      case 'CLEAR_FACEPAL': this.host.tint('facepal', i(0) ?? 0); return 'next';
      case 'TINT_SUNSET': this.host.tint('sunset', i(0) ?? 0); return 'next';
      case 'TINT_NIGHT': this.host.tint('night', i(0) ?? 0); return 'next';
      case 'TINT_DUSK': this.host.tint('dusk', i(0) ?? 0); return 'next';
      case 'TINT_UI_DARK': this.host.tint('uiDark', 0); return 'next';
      case 'BLACK_SPRITES': this.host.tint('black', i(0) ?? 0); return 'next';
      case 'UI_HALF_A': this.host.tint('uiHalfA', 0); return 'next';
      case 'UI_HALF_B': this.host.tint('uiHalfB', 0); return 'next';
      case 'SHAKE': this.host.shake(i(0) ?? 0); return 'next';
      case 'CAMERA_TILE': this.host.cameraTile(i(0) ?? 0, i(1) ?? 0); return 'next';
      case 'CAMERA_SCROLL': this.host.cameraScroll(i(0) ?? 0, i(1) ?? 0, i(2) ?? 0, i(3) ?? 0, i(4) ?? 0); return 'next';
      // sound (stubs in the page until sub-project 5)
      case 'MUSIC': this.host.music(i(0) ?? -1); return 'next';
      case 'MUSIC_FADE': this.host.musicFade(i(0) ?? 0, (i(1) ?? 0) !== 0); return 'next';
      case 'SOUND': this.host.sound(str(a[0]) ?? ''); return 'next';
      case 'PLAY_VISUAL': this.host.playVisual(i(0) ?? 0); return 'next';
      // dialogue
      case 'MSG_TOP': case 'MSG_BOTTOM': {
        const where: Where = ins.op === 'MSG_TOP' ? 'top' : 'bottom';
        const fc = face(a[0]);
        if (!fc || fc[0] === 0) { this.host.closeWindow(where); if (this.window?.where === where) this.window = null; return 'next'; }
        this.host.openWindow(where, fc[0], fc[1]);
        this.window = { where, speaker: fc[0], firstLine: true };
        return 'next';
      }
      case 'TEXT': {
        const w = this.window ?? { where: 'bottom' as Where, speaker: 0, firstLine: false };
        this.host.text(w.where, scriptText(str(a[0]) ?? ''), w.firstLine ? this.speakerName(w.speaker) : null);
        w.firstLine = false;
        return 'next';
      }
      case 'SET_SPEAKER_NAME': this.c.speakerName = str(a[0]) ?? ''; return 'next';
      case 'EPISODE': { this.c.episode = scriptText(str(a[0]) ?? ''); if ((i(1) ?? 0) === 0) return 'next'; const m = this.modal('episode', this.c.episode); return m.done ? 'next' : 'wait'; }
      case 'MESSAGE': { this.c.message = scriptText(str(a[0]) ?? ''); const m = this.modal('message', this.c.message); return m.done ? 'next' : 'wait'; }
      case 'ASK': { const m = this.modal('ask', str(a[0]) ?? ''); if (!m.done) return 'wait'; this.state.result = m.result !== 0 ? 1 : 0; return 'next'; }
      case 'SHOP': { const m = this.modal('shop', list(a[0])); return m.done ? 'next' : 'wait'; }
      case 'SAVE_GAME': { const m = this.modal('save', i(0) ?? -1); if (!m.done) return 'wait'; this.host.save(m.result); return 'next'; }
      case 'GAME_COMPLETE_QUIT': this.host.quitComplete(); return 'end';
      case 'WRITE_COMPLETE_FLAG': this.host.writeCompleteFlag(); return 'next';
      case 'TOWN': this.c.turn = -1; this.state.restore = 'town'; this.host.enterTown(); return 'end';
      case 'TEST_ENEMY_PHASE': this.state.result = this.host.enemyPhase() ? 1 : 0; return 'next';
      default: return this.execUnits(ins, now);
    }
  }

  /** Unit, sprite, map, item and battle instructions (Task 5). */
  protected execUnits(ins: Instr, now: number): 'next' | 'wait' | 'jumped' | 'end' {
    void now;
    this.host.log('warn', `unimplemented op ${ins.op}`);
    return 'next';
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd web && npx vitest run test/vm.test.ts && npx tsc --noEmit -p .`
Expected: PASS 11/11, tsc 0.

- [ ] **Step 6: 커밋**

```bash
git add web/src/script/host.ts web/src/script/vm.ts web/test/vm.test.ts
git commit -m "feat(web): script VM — flow, flags, waits, dialogue windows and modals over a Host interface"
```

---

### Task 5: VM — 유닛·스프라이트·맵·아이템·전투 명령

**Files:**
- Modify: `web/src/script/vm.ts` (`execUnits`)
- Test: `web/test/vmUnits.test.ts`

**Interfaces:**
- Consumes: Task 3 `findUnit/createScriptUnit/removeScriptUnits/removeDead/loadRoster`, `giveItem/takeItem/addGold`, `growUnit`, `dirTo`.
- Produces: 나머지 모든 명령의 의미(§6). `Unit.sprite` 갱신(apd/layer/anim/hidden/offset/marker). `BATTLE_START(_HEAL)` 은 `c.turn = 0`, 전 유닛 moved/acted 초기화(+HEAL 이면 HP=max, MP=max/2, status 9 외 0), `restore = 'battle'`, `host.enterBattle()`.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/test/vmUnits.test.ts` (Task 4 의 `prog`/`setup` 헬퍼를 `web/test/helpers/scriptFixtures.ts` 로 옮겨 두 테스트가 공유한다 — Task 4 의 테스트 파일에서도 import 로 바꾼다):
```ts
import { describe, expect, it } from 'vitest';
import { ScriptVm } from '../src/script/vm';
import { newCampaign } from '../src/game/campaign';
import { FakeHost } from '../src/script/host';
import { prog, res } from './helpers/scriptFixtures';
import { fixedRng, tables, unit } from './helpers/battleFixtures';

const start = (rows: Parameters<typeof prog>[1], rosters: Record<number, Parameters<typeof res>[1]> = {}) => {
  const host = new FakeHost(); const c = newCampaign();
  c.units[0] = unit({ slot: 0, id: 1, c: 2, r: 2 }); c.units[1] = unit({ slot: 1, id: 2, c: 3, r: 2 });
  const vm = new ScriptVm(res([prog(0, rows)], rosters), c, host);
  vm.run(0, 'begin');
  return { host, c, vm };
};

describe('ScriptVm: units and sprites', () => {
  it('SET_POS/SET_DIR/FACE_UNIT move and turn units; SET_DIR 4 keeps the facing', () => {
    const { c, vm } = start(['begin', ['SET_POS', 1, 5, 6], ['SET_DIR', 1, 3], ['SET_DIR', 2, 4], ['FACE_UNIT', 1, 2], ['END']]);
    vm.step(0);
    expect(c.units[0]).toMatchObject({ c: 5, r: 6, dir: 3 });
    expect(c.units[1]!.dir).toBe(1);                                      // unit 2 at (3,2) faces unit 1 at (5,6): more columns than rows → east
  });
  it('an instruction whose unit is 0 is skipped without reading the rest', () => {
    const { c, vm, host } = start(['begin', ['SET_DIR', 0], ['SET_POS', 0], ['FLAG_SET', 0, 1], ['END']]);
    expect(vm.step(0)).toBe('ended');
    expect(c.flags[0]).toBe(1);
    expect(host.calls.filter((x) => x[0] === 'log')).toHaveLength(0);
  });
  it('LOAD_SPRITE/SPRITE_REUSE/ATTACH_SPRITE create object units with the named APD; RESPRITE_UNIT swaps a letter file', () => {
    const { c, vm } = start(['begin', ['LOAD_SPRITE', 'npc_02', 15, 20, 30], ['SPRITE_REUSE', 16, 1, 1], ['ATTACH_SPRITE', 100], ['ATTACH_SPRITE', 1], ['RESPRITE_UNIT', 2, 'c'], ['END']]);
    vm.step(0);
    const u15 = c.units.find((u) => u?.id === 15)!, u16 = c.units.find((u) => u?.id === 16)!, u100 = c.units.find((u) => u?.id === 100)!;
    expect(u15).toMatchObject({ side: 1, c: 20, r: 30, sprite: { apd: 'npc_02', layer: 3 } });
    expect(u16.sprite?.apd).toBe('npc_02');
    expect(u100).toMatchObject({ race: 7, side: 1, sprite: { apd: 'npc_02' } });
    expect(c.units[0]!.sprite?.apd).toBe('npc_02');
    expect(c.units[1]!.sprite?.apd).toBe('char_00c');
    expect(c.lastSprite).toBe('char_00c');
  });
  it('ANIM, MOVE_PATH and WAIT_UNIT go through the host; MOVE_PATH updates the position and the last direction', () => {
    const { c, vm, host } = start(['begin', ['ANIM', 1, '*f.event01', 1], ['MOVE_PATH', 1, 'run', 'sseN'], ['WAIT_UNIT', 1], ['END']]);
    host.busyUnits.add(0);
    expect(vm.step(0)).toBe('waiting');
    expect(host.calls).toContainEqual(['anim', 0, 'f.event01', false, true]);
    expect(host.calls).toContainEqual(['moveUnit', 0, [0, 0, 1, 3], 'run']);
    expect(c.units[0]).toMatchObject({ c: 3, r: 3, dir: 3 });
    host.busyUnits.clear();
    expect(vm.step(1)).toBe('ended');
  });
  it('REMOVE_UNIT, SET_VISIBLE and KILL/REVIVE change the unit; SET_VISIBLE on a hidden unit clears status 9', () => {
    const { c, vm, host } = start(['begin', ['SET_STATUS8', 2], ['KILL', 1], ['REVIVE', 1], ['SET_VISIBLE', 2, 1], ['REMOVE_UNIT', 2], ['END']]);
    c.units[1]!.status = 9;
    vm.step(0);
    expect(c.units[0]).toMatchObject({ status: 0, hp: 30 });
    expect(host.calls).toContainEqual(['setVisible', 1, true]);
    expect(c.units[1]).toBeNull();
  });
  it('REMOVE_SCRIPT_UNITS and REMOVE_DEAD delegate to the campaign; HEAL_ALL heals everyone but the hidden', () => {
    const { c, vm } = start(['begin', ['LOAD_SPRITE', 'x', 15, 1, 1], ['REMOVE_SCRIPT_UNITS'], ['HEAL_ALL'], ['END']]);
    c.units[0]!.hp = 1; c.units[0]!.mp = 0; c.units[1]!.status = 9;
    vm.step(0);
    expect(c.units.find((u) => u?.id === 15)).toBeUndefined();
    expect(c.units[0]).toMatchObject({ hp: 30, mp: 10, status: 0 });
    expect(c.units[1]!.status).toBe(9);
  });
});

describe('ScriptVm: map, items and battle', () => {
  it('LOAD_MAP waits for the host; LOAD_UNITS fills slots 10.. from the roster; BATTLE_START_HEAL resets the party and enters battle', () => {
    const roster = [{ unit_id: 8, race: 1, level: 1, dir: 0, c: 6, r: 4, status: 0, side: 4, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0 }];
    const { c, vm, host } = start(['begin', ['LOAD_MAP', 49], ['LOAD_UNITS', 49], ['BATTLE_START_HEAL'], ['END']], { 49: roster });
    host.loading = true;
    expect(vm.step(0)).toBe('waiting');
    host.loading = false;
    c.units[0]!.hp = 3; c.units[0]!.moved = true;
    expect(vm.step(1)).toBe('ended');
    expect(c.units[10]).toMatchObject({ id: 8, side: 4, c: 6, r: 4 });
    expect(c.units[0]).toMatchObject({ hp: 30, mp: 10, moved: false, acted: false });
    expect(c.turn).toBe(0);
    expect(host.calls).toContainEqual(['enterBattle']);
    expect(host.calls.at(-1)).toEqual(['scriptEnded', 'battle']);
  });
  it('GIVE_ITEM/TAKE_ITEM/ADD_GOLD/GIVE_ITEM_TO touch the inventory and report through result', () => {
    const { c, vm } = start(['begin', ['GIVE_ITEM', 7, 3], ['TAKE_ITEM', 7, 1], ['ADD_GOLD', 150], ['GIVE_ITEM_TO', 2, 1], ['JUMP_IF_RESULT', 1, 'ok'], ['END'], 'ok', ['FLAG_SET', 0, 1], ['END']]);
    vm.step(0);
    expect(c.inventory).toMatchObject({ gold: 350, items: [{ id: 7, count: 2 }] });
    expect(c.units[1]!.bag[0]).toBe(1);
    expect(c.flags[0]).toBe(1);
  });
  it('TEST_ACTIVE, TEST_UNITS_1_2 and TEST_IS_ACTOR set result from the units', () => {
    const { c, vm } = start(['begin', ['TEST_ACTIVE', 2], ['JUMP_IF_RESULT', 0, 'dead'], ['TEST_IS_ACTOR', 1], ['JUMP_IF_RESULT', 1, 'actor'], ['END'], 'dead', ['FLAG_SET', 0, 1], ['END'], 'actor', ['FLAG_SET', 0, 2], ['END']]);
    c.units[1]!.status = 1; c.actor = 0;
    vm.step(0);
    expect(c.flags[0]).toBe(1);
  });
  it('BATTLE_RESULT adds gold, opens the result modal and levels up party members with enough EXP', () => {
    const { c, vm, host } = start(['begin', ['BATTLE_RESULT', 100, 1], ['END']]);
    c.units[0]!.exp = 250; c.units[0]!.level = 1;
    host.modal = null;
    expect(vm.step(0)).toBe('waiting');
    expect(c.inventory.gold).toBe(300);
    expect(host.calls).toContainEqual(['openModal', 'result', { gold: 100, param: 1, levelUps: [{ slot: 0, from: 1, to: 3 }] }]);
    expect(c.units[0]!.level).toBe(3);
    host.modal = 1;
    expect(vm.step(1)).toBe('ended');
  });
  it('MOVE_TO and EXT99 are logged and skipped', () => {
    const { vm, host } = start(['begin', ['MOVE_TO', 1, 'f.event04'], ['EXT99_4', 1, 'x'], ['END']]);
    expect(vm.step(0)).toBe('ended');
    expect(host.calls.filter((x) => x[0] === 'log' && x[1] === 'warn')).toHaveLength(2);
  });
});
```
`web/test/helpers/scriptFixtures.ts`: Task 4 의 `prog` 와, 로스터 맵을 받는 `res(programs: Program[], rosters: Record<number, RosterUnit[]> = {})`.

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run test/vmUnits.test.ts test/vm.test.ts`
Expected: vmUnits FAIL(미구현 경고·상태 불변), vm PASS.

- [ ] **Step 3: 구현 — `execUnits`**

`vm.ts` 상단 import 에 `dirTo, type Dir` (`../battle/grid`), `addGold, giveItem, takeItem` (`../battle/inventory`), `growUnit` (`../battle/unit`), `createScriptUnit, loadRoster, removeDead, removeScriptUnits` (`../game/campaign`) 추가. `execUnits` 를 다음으로 바꾼다:
```ts
  protected execUnits(ins: Instr, now: number): 'next' | 'wait' | 'jumped' | 'end' {
    void now;
    const a = ins.args;
    const i = (k: number) => num(a[k]);
    const unitArg = (k: number): Unit | null | 'skip' => { const id = i(k); if (id === null || id === 0) return 'skip'; return findUnit(this.c, id); };
    const u = unitArg(0);
    if (u === 'skip' && UNIT_FIRST.has(ins.op)) return 'next';           // unit id 0: the game reads no further operands
    const un = u === 'skip' ? null : u;
    switch (ins.op) {
      case 'NOP_UNIT': return 'next';
      case 'SET_POS': if (un) { un.c = i(1) ?? un.c; un.r = i(2) ?? un.r; this.host.unitsChanged(); } return 'next';
      case 'SET_DIR': { const d = i(1) ?? 4; if (un && d >= 0 && d <= 3) un.dir = d as Dir; return 'next'; }
      case 'FACE_UNIT': { const b = unitArg(1); if (un && b && b !== 'skip' && (un.c !== b.c || un.r !== b.r)) b.dir = dirTo(b.c, b.r, un.c, un.r); return 'next'; }
      case 'ALL_FACE': if (un) for (const v of this.c.units) if (v && v !== un && (v.c !== un.c || v.r !== un.r)) v.dir = dirTo(v.c, v.r, un.c, un.r); return 'next';
      case 'REMOVE_UNIT': if (un) { this.c.units[un.slot] = null; this.host.unitsChanged(); } return 'next';
      case 'REMOVE_SCRIPT_UNITS': removeScriptUnits(this.c); this.host.unitsChanged(); return 'next';
      case 'REMOVE_DEAD': removeDead(this.c); this.host.unitsChanged(); return 'next';
      case 'LOAD_SPRITE': { const apd = str(a[0]) ?? ''; const id = i(1) ?? 0; this.c.lastSprite = apd; if (!createScriptUnit(this.c, id, 7, i(2) ?? 0, i(3) ?? 0, apd, id < 4000 ? 3 : 5)) this.host.log('warn', 'no free unit slot'); this.host.unitsChanged(); return 'next'; }
      case 'SPRITE_REUSE': { const id = i(0) ?? 0; if (this.c.lastSprite) createScriptUnit(this.c, id, 7, i(1) ?? 0, i(2) ?? 0, this.c.lastSprite, id < 4000 ? 3 : 5); this.host.unitsChanged(); return 'next'; }
      case 'ATTACH_SPRITE': { const id = i(0) ?? 0; const apd = this.c.lastSprite; if (!apd) return 'next'; const target = findUnit(this.c, id) ?? createScriptUnit(this.c, id, 7, 0, 0, apd, 3); if (target) target.sprite = { ...target.sprite, apd }; this.host.unitsChanged(); return 'next'; }
      case 'RESPRITE_UNIT': if (un) { const apd = `char_${String(un.race).padStart(2, '0')}${str(a[1]) ?? 'a'}`; un.sprite = { ...un.sprite, apd }; this.c.lastSprite = apd; this.host.unitsChanged(); } return 'next';
      case 'ANIM': if (un) { const raw = str(a[1]) ?? ''; const force = raw.startsWith('*'); const name = force ? raw.slice(1) : raw; const loop = (i(2) ?? 0) === 0; un.sprite = { ...un.sprite, anim: { name, loop, force } }; this.host.anim(un, name, loop, force); } return 'next';
      case 'MOVE_PATH': if (un) { const base = str(a[1]) ?? 'run'; const dirs = [...(str(a[2]) ?? '').toLowerCase()].map((ch) => PATH_DIR[ch]).filter((d): d is Dir => d !== undefined); for (const d of dirs) { [un.c, un.r] = stepCell(un.c, un.r, d); } if (dirs.length) un.dir = dirs[dirs.length - 1]!; this.host.moveUnit(un, dirs, base); } return 'next';
      case 'MOVE_TO': this.host.log('warn', `MOVE_TO ${str(a[1]) ?? ''} is not understood; skipped`); return 'next';
      case 'WAIT_UNIT': return un && this.host.unitBusy(un, true) ? 'wait' : 'next';
      case 'WAIT_UNIT2': return un && this.host.unitBusy(un, false) ? 'wait' : 'next';
      case 'CAMERA_UNIT': if (un) this.host.cameraUnit(un); return 'next';
      case 'SPRITE_OFFSET': if (un) un.sprite = { ...un.sprite, offset: { x: i(1) ?? 0, y: i(2) ?? 0 } }; return 'next';
      case 'SPRITE_RAISE': if (un) un.sprite = { ...un.sprite, offset: { x: un.sprite?.offset?.x ?? 0, y: (un.sprite?.offset?.y ?? 0) - 32 } }; return 'next';
      case 'SPRITE_LAYER': if (un) un.sprite = { ...un.sprite, layer: (i(1) ?? 0) !== 0 ? 5 : 1 }; return 'next';
      case 'MARKER': if (un) { const on = (i(1) ?? 0) !== 0; un.sprite = { ...un.sprite, marker: on }; this.host.marker(un, on); } return 'next';
      case 'HIDE_MARKERS': for (const v of this.c.units) if (v?.sprite?.marker) { v.sprite.marker = false; this.host.marker(v, false); } return 'next';
      case 'SWEAT': if (un) this.host.sweat(un); return 'next';
      case 'SPRITE_APPEAR': if (un) { un.sprite = { ...un.sprite, hidden: false }; this.host.appear(un, i(1) ?? 0); } return 'next';
      case 'SPRITE_VANISH': if (un) { un.sprite = { ...un.sprite, hidden: true }; this.host.vanish(un, i(1) ?? 0); } return 'next';
      case 'SET_VISIBLE': if (un) { const on = (i(1) ?? 0) !== 0; if (on && un.status === 9) un.status = 0; un.sprite = { ...un.sprite, hidden: !on }; this.host.setVisible(un, on); } return 'next';
      case 'ALL_VISIBLE': { const on = (i(0) ?? 0) !== 0; for (const v of this.c.units) if (v) { if (on && v.status === 9) v.status = 0; v.sprite = { ...v.sprite, hidden: !on }; } this.host.allVisible(on); return 'next'; }
      case 'SHOW_ONLY': if (un) { for (const v of this.c.units) if (v) v.sprite = { ...v.sprite, hidden: v !== un }; this.host.showOnly(un); } return 'next';
      case 'RESET_SPRITES': for (const v of this.c.units) if (v) { v.sprite = undefined; v.moved = true; v.acted = true; } this.host.resetSprites(); return 'next';
      case 'UNLOCK_ANIMS': case 'LOCK_ANIMS': return 'next';
      case 'SET_ACT_FLAGS': if (un) { const on = (i(1) ?? 0) !== 0; un.moved = on; un.acted = on; } return 'next';
      case 'SET_STATUS8': if (un) un.status = 8; return 'next';
      case 'UNIT_TO_ID8': if (un) { un.id = 8; un.hp = 0; un.status = 1; } return 'next';
      case 'KILL': if (un) { un.hp = 0; un.mp = 0; un.status = 1; un.sprite = { ...un.sprite, hidden: true }; this.host.unitsChanged(); } return 'next';
      case 'REVIVE': if (un) { un.hp = un.hpMax; un.status = 0; } return 'next';
      case 'HEAL_ALL': for (const v of this.c.units) if (v) { v.hp = v.hpMax; v.mp = Math.trunc(v.mpMax / 2); if (v.status !== 9) v.status = 0; v.special = false; } return 'next';
      case 'DOPPEL_COPY': { const actor = this.c.actor === null ? null : this.c.units[this.c.actor]; const t = findUnit(this.c, 24); if (actor && actor.side === 0 && t) { t.race = actor.race; t.status = actor.status; t.dir = dirTo(t.c, t.r, actor.c, actor.r); t.hpMax = actor.hpMax; t.hp = Math.min(t.hp, actor.hpMax); t.mpMax = actor.mpMax; t.mp = Math.trunc(t.mpMax / 2); t.exp = actor.exp; t.str = actor.str; t.def = actor.def; t.wis = actor.wis; t.mgr = actor.mgr; t.agi = actor.agi; t.spells = [...actor.spells]; } return 'next'; }
      case 'TARGET_CLASS40': { const t = findUnit(this.c, 24); if (t) t.race = 0x40; return 'next'; }
      case 'TEST_ACTIVE': this.state.result = un && un.status !== 1 && un.side !== 7 ? 1 : 0; return 'next';
      case 'TEST_IS_ACTOR': { const actor = this.c.actor === null ? null : this.c.units[this.c.actor]; this.state.result = un && actor === un ? 1 : 0; if (!this.state.result) { const t = findUnit(this.c, 24); if (t) t.hp = 1; } return 'next'; }
      case 'TEST_UNITS_1_2': { const ok = (id: number) => { const v = findUnit(this.c, id); return v !== null && ![1, 3, 4, 5, 8, 9].includes(v.status) ? 1 : 0; }; this.state.result = ok(1) | ok(2); return 'next'; }
      // items and gold
      case 'GIVE_ITEM': giveItem(this.c.inventory, findUnit(this.c, 1), i(0) ?? 0, i(1) ?? 1, this.res.tables.item); return 'next';
      case 'TAKE_ITEM': takeItem(this.c.inventory, i(0) ?? 0, i(1) ?? 1, this.res.tables.item); return 'next';
      case 'GIVE_ITEM_TO': if (un) this.state.result = giveItem(this.c.inventory, un, i(1) ?? 0, 1, this.res.tables.item) ? 1 : 0; return 'next';
      case 'ADD_GOLD': addGold(this.c.inventory, i(0) ?? 0); return 'next';
      // map and battle
      case 'LOAD_MAP': { if (!this.wait || this.wait.pc !== this.state.pc) { this.host.loadMap(i(0) ?? 0); this.wait = { pc: this.state.pc, until: 0 }; } if (this.host.mapBusy()) return 'wait'; this.wait = null; return 'next'; }
      case 'LOAD_UNITS': { const n = i(0) ?? 0; const recs = this.res.roster(n); if (!recs) { this.host.log('warn', `roster ${n} missing`); return 'next'; } loadRoster(this.c, recs, this.res.tables, this.res.rng); this.host.unitsChanged(); return 'next'; }
      case 'BATTLE_START': case 'BATTLE_START_HEAL': {
        for (const v of this.c.units) if (v) { v.moved = false; v.acted = false; v.special = false; if (ins.op === 'BATTLE_START_HEAL') { v.hp = v.hpMax; v.mp = Math.trunc(v.mpMax / 2); if (v.status !== 9) v.status = 0; } }
        this.c.turn = 0; this.state.restore = 'battle'; this.host.enterBattle(); return 'next';
      }
      case 'BATTLE_RESULT': {
        if (!this.modalOpen) {
          const gold = i(0) ?? 0;
          if (gold > 0) addGold(this.c.inventory, gold);
          const levelUps: { slot: number; from: number; to: number }[] = [];
          for (const v of this.c.units.slice(0, 10)) if (v) { const from = v.level; while (v.level * 100 <= v.exp && v.level < 99) { v.level++; growUnit(v, this.res.tables.race[v.race]!, true, this.res.rng, this.res.tables.magic); } if (v.level !== from) levelUps.push({ slot: v.slot, from, to: v.level }); }
          this.resultPayload = { gold, param: i(1) ?? 0, levelUps };
        }
        return this.modal('result', this.resultPayload).done ? 'next' : 'wait';
      }
      default:
        this.host.log('warn', `${ins.op} is not implemented; skipped`);
        return 'next';
    }
  }
```
파일 상단에 추가:
```ts
import { dirTo, stepCell, type Dir } from '../battle/grid';
const PATH_DIR: Record<string, Dir> = { s: 0, e: 1, w: 2, n: 3 };
/** Instructions whose first operand is a unit; with id 0 the original reads nothing more and does nothing. */
const UNIT_FIRST = new Set(['NOP_UNIT', 'SET_POS', 'SET_DIR', 'FACE_UNIT', 'ALL_FACE', 'REMOVE_UNIT', 'RESPRITE_UNIT', 'ANIM', 'MOVE_PATH', 'MOVE_TO', 'WAIT_UNIT', 'WAIT_UNIT2', 'CAMERA_UNIT', 'SPRITE_OFFSET', 'SPRITE_RAISE', 'SPRITE_LAYER', 'MARKER', 'SWEAT', 'SPRITE_APPEAR', 'SPRITE_VANISH', 'SET_VISIBLE', 'SHOW_ONLY', 'SET_ACT_FLAGS', 'SET_STATUS8', 'UNIT_TO_ID8', 'KILL', 'REVIVE', 'TEST_ACTIVE', 'TEST_IS_ACTOR', 'GIVE_ITEM_TO', 'ATTACH_SPRITE']);
```
클래스 필드 `private resultPayload: unknown = null;` 추가. `EXT99_*` 는 default 경고 경로를 탄다. `ATTACH_SPRITE` 는 유닛이 없으면 새로 만들므로 `UNIT_FIRST` 의 skip 규칙(id 0 만)과 충돌하지 않는다.

- [ ] **Step 4: 통과 확인**

Run: `cd web && npm run check`
Expected: 전부 PASS, tsc 0.

- [ ] **Step 5: 커밋**

```bash
git add web/src/script/vm.ts web/test/vmUnits.test.ts web/test/vm.test.ts web/test/helpers/scriptFixtures.ts
git commit -m "feat(web): script VM — unit, sprite, map, item and battle instructions"
```

---

### Task 6: 이벤트 코퍼스 테스트와 문서

**Files:**
- Create: `web/test/eventCorpus.test.ts`
- Modify: `docs/manual.md`(상태 표 4행 "진행 중(A 완료)"), `docs/superpowers/specs/2026-10-16-story-flow-design.md`(§4 데이터에 실제 JSON 크기·개수 기록)

**Interfaces:**
- Consumes: 내보낸 `web/public/assets/data/event*.json`, `roster/*.json`, 테이블. 자산이 없으면 `describe.skipIf`.

- [ ] **Step 1: 테스트 작성**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/battle/rng';
import type { RosterUnit, Tables } from '../src/data/types';
import { newCampaign } from '../src/game/campaign';
import { FakeHost, type Resources } from '../src/script/host';
import { findLabel, loadProgram, str, type Program } from '../src/script/program';
import { ScriptVm } from '../src/script/vm';

const ASSETS = fileURLToPath(new URL('../public/assets/', import.meta.url));
const available = existsSync(join(ASSETS, 'data', 'event00.json'));
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(ASSETS, rel), 'utf-8')) as T;

describe.skipIf(!available)('event corpus', () => {
  const index = readJson<{ events: number[] }>('index.json');
  const programs = new Map(index.events.map((n) => [n, loadProgram(n, readJson(`data/event${String(n).padStart(2, '0')}.json`))]));
  const tables: Tables = { race: readJson('data/race.json'), item: readJson('data/item.json'), magic: readJson('data/magic.json') };
  const res: Resources = {
    program: (n) => programs.get(n) ?? null,
    roster: (n) => { const p = join(ASSETS, 'data', 'roster', `stage${String(n).padStart(3, '0')}.json`); return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf-8')) as RosterUnit[]) : null; },
    tables, rng: Rng.fromSeed(1),
  };
  it('loads all 20 files and every jump target exists in its file (LOAD_SCRIPT targets in theirs)', () => {
    expect(programs.size).toBe(20);
    const missing: string[] = [];
    for (const p of programs.values()) for (const ins of p.code) {
      if (ins.op === 'JUMP' || ins.op === 'CALL' || ins.op === 'JUMP_IF_RESULT' || ins.op === 'JUMP_IF_LESS') { const l = str(ins.args[ins.op === 'JUMP' || ins.op === 'CALL' ? 0 : 1]); if (l && findLabel(p, l) === null) missing.push(`${p.stage}:${ins.at}:${l}`); }
      if (ins.op === 'LOAD_SCRIPT') { const t = programs.get(Number(ins.args[0])); const l = str(ins.args[1]); if (!t || (l && findLabel(t, l) === null)) missing.push(`${p.stage}:${ins.at}:LOAD_SCRIPT ${String(ins.args[0])} ${l}`); }
    }
    expect(missing).toEqual([]);
  });
  it('every runtime label the game asks for exists somewhere sensible', () => {
    expect(findLabel(programs.get(0)!, 'begin')).not.toBeNull();
    expect(findLabel(programs.get(0)!, 'GAMEOVER')).not.toBeNull();
    expect(findLabel(programs.get(0)!, 'town')).not.toBeNull();
    for (const n of [1, 2, 3]) expect(findLabel(programs.get(n)!, 'begin')).not.toBeNull();
  });
  it('EVENT00 begin runs through the opening to TOWN with a fake host that clicks everything away', () => {
    const host = new FakeHost(); host.modal = 1;
    const c = newCampaign();
    const vm = new ScriptVm(res, c, host);
    expect(vm.run(0, 'begin')).toBe(true);
    let now = 0, steps = 0;
    while (vm.running && steps < 200_000) { host.clicks = 1; const r = vm.step(now); now += 50; steps++; if (r === 'ended') break; }
    expect(vm.running).toBe(false);
    expect(host.calls).toContainEqual(['enterTown']);
    expect(host.calls.filter((x) => x[0] === 'log' && x[1] === 'warn')).toEqual([]);
    expect(c.stage).toBe(1);
    expect(c.townSet).toBe(1);
  });
});
```
(`EVENT00 begin` 끝은 `LOAD_SCRIPT 1 @begin` → EVENT01 `begin` → `LOAD_SCRIPT 0 @town` → `TOWN`. 경고가 나오면 그 명령의 의미를 고친다. `PLAY_VISUAL 0` 은 스텁.)

- [ ] **Step 2: 실행**

Run: `cd web && npx vitest run test/eventCorpus.test.ts`
Expected: PASS 3/3. 실패하면 원인은 VM 의미 결함이다: 고치고(테스트는 그대로) 다시 돈다.

- [ ] **Step 3: 전체 확인, 문서, 커밋**

Run: `cd web && npm run check`
`docs/manual.md` 상태 표의 "4 스크립트 VM" 행 → "진행 중 — VM·데이터(A) 완료, 화면·마을(B) 예정". 스펙 §4 끝에 "내보낸 결과: event 20개, bmp N개(실측)" 한 줄.

```bash
git add web/test/eventCorpus.test.ts docs/manual.md docs/superpowers/specs/2026-10-16-story-flow-design.md
git commit -m "test(web): event corpus — all scripts decode, labels resolve, the opening runs to TOWN headlessly"
```
