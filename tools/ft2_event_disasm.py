#!/usr/bin/env python3
"""Disassembler for Farland Tactics 2 (FT2.exe) event scripts: DATA/EVENT*.dat.

Format (recovered from FUN_004085f0 / FUN_0040a570 / FUN_0040a590 / FUN_0040a5c0
in FT2.exe):

  file      = symbol-table body
  symbol    = name '\\0' u32le-offset         (offset is relative to file start)
  table end = first byte 0xFF at an entry start (the game stops the label
              search when *pc == 0xFF; it never checks a count)
  instr     = 0xFF opcode operand*
  number    = i8, or 0x80 followed by i32le (5 bytes total)
  unit      = number (unit id; 24 = current battle target unit)
  string    = NUL-terminated CP949 bytes
  label     = string, looked up case-insensitively in the symbol table

Any byte other than 0xFF at an instruction boundary stops the interpreter
(script ends).  The disassembler prints such bytes as `DB`.

Usage:  python3 -I ft2_event_disasm.py [-q] [-r] FILE...
          -q  summary only (one line per file)
          -r  show raw instruction bytes
Stdlib only.
"""
import argparse
import struct
import sys

# operand codes:
#   n  number            u  unit ref (number)      s  string
#   L  label string      F  face (number speaker; +2 bytes if speaker != 0)
#   V  sprite variant (2 raw bytes: letter, pad)    X  extended opcode (number + ext operands)
MAIN_OPS = {
    0x00: ("EXT", "X"),
    0x01: ("WAIT", "n"),                 # ms, Ctrl skips
    0x02: ("FADE_IN", "n"),              # steps (0 = instant); yields
    0x03: ("FADE_OUT", "n"),             # steps to black (palette 0x46c4c0)
    0x04: ("MSG_TOP", "F"),              # speaker, face letter -> bmp\face%02d%c.bmp ; 0 = close
    0x05: ("MSG_BOTTOM", "F"),
    0x06: ("TEXT", "s"),                 # [Cnn] colour, [Snn] size markup
    0x07: ("RESPRITE_UNIT", "uV"),       # reload unit sprite: sprite\char_%02d%c.apd (class, letter); sets "last sprite"
    0x08: ("ANIM", "usn"),               # unit, anim name ('*' prefix = flag 2), loop(0)/once
    0x09: ("WAIT_FADE", ""),
    0x0a: ("LOAD_MAP", "n"),             # map\stage%02d.map
    0x0b: ("LOAD_UNITS", "n"),           # clears unit slots 10..49, loads roster data\stage%03d.dat (FUN_0041fcf0)
    0x0c: ("CAMERA_TILE", "nn"),
    0x0d: ("CAMERA_UNIT", "u"),
    0x0e: ("MUSIC", "n"),                # midi\bgm%02d.mid ; -1 = stop
    0x0f: ("MUSIC_FADE", "nn"),          # duration ms, 0=out/1=in
    0x10: ("SOUND", "s"),                # wave\%s.wav ; '*' prefix = channel 0 exclusive ; "" = stop
    0x11: ("WAIT_UNIT", "u"),            # wait anim+move+effect
    0x12: ("CAMERA_SCROLL", "nnnnn"),    # dx, dy, target tx, ty, interval ms
    0x13: ("LOAD_SPRITE", "snnn"),       # sprite\%s.apd, id, x, y
    0x14: ("SPRITE_REUSE", "nnn"),       # id, x, y (last loaded sprite data)
    0x15: ("REMOVE_UNIT", "u"),
    0x16: ("GIVE_ITEM", "nn"),           # item, count (to party)
    0x17: ("TAKE_ITEM", "nn"),           # item, count
    0x18: ("WAIT_CLICK", "n"),           # timeout ms (0 = none)
    0x19: ("MOVE_PATH", "uss"),          # unit, anim, path letters e/n/s/w
    0x1a: ("NOP_UNIT", "u"),
    0x1b: ("WAIT_MUSIC_FADE", ""),
    0x1c: ("SET_POS", "unn"),
    0x1d: ("BATTLE_START_HEAL", ""),
    0x1e: ("NEXT_STAGE", ""),            # clear flags, drop non-party units, stage++ at END
    0x1f: ("SET_DIR", "un"),             # 0=S 1=E 2=W 3=N 4=keep
    0x20: ("JUMP", "L"),
    0x21: ("ATTACH_SPRITE", "u"),        # create unit id if missing, attach last sprite
    0x22: ("WAIT_SCROLL", ""),
    0x23: ("RESET_SPRITES", ""),
    0x24: ("END_RESUME", ""),            # '$' : end script, then resume pending battle action
    0x25: ("FACE_UNIT", "uu"),           # target, unit (unit faces target)
    0x26: ("SPRITE_OFFSET", "unn"),
    0x27: ("JUMP_IF_RESULT", "nL"),      # if (result != 0) == (n != 0)
    0x28: ("JUMP_IF_LESS", "nL"),        # if (flag < value from FLAG_CMP) == (n != 0)
    0x29: ("FLAG_SET", "nn"),
    0x2a: ("FLAG_ADD", "nn"),
    0x2b: ("FLAG_SUB", "nn"),
    0x2c: ("FLAG_CMP", "nn"),            # result = (Flag[i] == v); less = (Flag[i] < v)
    0x2d: ("FLAGS_CLEAR", ""),
    0x2e: ("CALL", "L"),
    0x2f: ("RETURN", ""),
    0x30: ("FIELD_MODE", ""),            # restore mode 1 (field/battle) at END
    0x31: ("SHOP", "Z"),                 # DialogBox resource 150; item id list, 0-terminated (dialog proc reads it with FUN_0040a570)
    0x32: ("SHOW_IMAGE", "sn"),          # bmp\%s.bmp full screen, fade steps
    0x33: ("HIDE_IMAGE", ""),
    0x34: ("PLAY_VISUAL", "n"),          # visual scene n (VSLLST.DAT), mode 8
    0x35: ("BATTLE_START", ""),
    0x36: ("TOWN", ""),                  # end script, enter town mode 9
    0x37: ("FLAG_BIT_SET", "nn"),
    0x38: ("FLAG_BIT_CLR", "nn"),
    0x39: ("FLAG_BIT_TOGGLE", "nn"),
    0x3a: ("FLAG_BIT_TEST", "nn"),       # result = bit set
    0x3b: ("EPISODE", "sn"),             # title text, show flag
    0x3c: ("LOAD_SCRIPT", "nL"),         # data\event%02d.dat, label
    0x3d: ("SET_SPEAKER_NAME", "s"),     # name for speaker id 14
    0x3e: ("MESSAGE", "s"),              # centered message, wait click; stored in save header
    0x3f: ("WAIT_UNIT2", "u"),
}

EXT_OPS = {
    0x01: ("REMOVE_SCRIPT_UNITS", ""),
    0x02: ("MARKER", "un"),              # LARGE.M sprite on/off
    0x03: ("SET_ACT_FLAGS", "un"),
    0x04: ("TOWN_FLAG_SET", "nn"),
    0x05: ("SHOW_ONLY", "u"),
    0x06: ("STAGE_FROM_FLAG", "n"),
    0x07: ("DIM_SCENE", "n"),            # palette 0x20..0xd0 to 60%
    0x08: ("ASK", "s"),                  # yes/no dialog; result = (answer != IDNO)
    0x09: ("BATTLE_RESULT", "nn"),       # gold reward, dialog param; then level-ups
    0x0a: ("TOWN_SET", "n"),
    0x0b: ("SWEAT", "u"),
    0x0c: ("REMOVE_DEAD", ""),
    0x0d: ("SPRITE_APPEAR", "un"),
    0x0e: ("SPRITE_VANISH", "un"),
    0x0f: ("SET_VISIBLE", "un"),
    0x10: ("ALL_FACE", "u"),
    0x11: ("UNIT_TO_ID8", "u"),
    0x12: ("ALL_VISIBLE", "n"),
    0x13: ("GAME_COMPLETE_QUIT", ""),
    0x14: ("RESET_PAL_STAGE0", ""),
    0x15: ("CLEAR_SCREEN", ""),
    0x16: ("FLASH_WHITE", "n"),          # fade to white palette 0x46c0c0
    0x17: ("SHAKE", "n"),                # DAT_0044b764, read by the frame compositor (inferred)
    0x18: ("CLEAR_TEXTPAL", "n"),        # clear screen, fade palette 0x10..0x20
    0x19: ("TINT_SUNSET", "n"),
    0x1a: ("MOVE_TO", "us"),
    0x1b: ("TIMER_START", ""),
    0x1c: ("WAIT_TIMER", "n"),           # seconds
    0x1d: ("DIM_UI", "nn"),
    0x1e: ("CLEAR_FACEPAL", "n"),        # clear screen, fade palette 0x90..0xd0
    0x1f: ("SPRITE_RAISE", "u"),
    0x20: ("TEST_ENEMY_PHASE", ""),      # result = (field state DAT_0044b7a0 == 7)
    0x21: ("SPRITE_LAYER", "un"),
    0x22: ("TOWN_EXTRA", "n"),
    0x23: ("TEST_UNITS_1_2", ""),
    0x24: ("SET_STATUS8", "u"),
    0x25: ("GIVE_ITEM_TO", "un"),
    0x26: ("BLACK_SPRITES", "n"),
    0x27: ("HIDE_MARKERS", ""),
    0x28: ("HEAL_ALL", ""),
    0x29: ("DOPPEL_COPY", ""),
    0x2a: ("TARGET_CLASS40", ""),
    0x2b: ("KILL", "u"),
    0x2c: ("ADD_GOLD", "n"),
    0x2d: ("TINT_NIGHT", "n"),
    0x2e: ("TEST_IS_ACTOR", "u"),
    0x2f: ("TEST_ACTIVE", "u"),
    0x30: ("REVIVE", "u"),
    0x31: ("TINT_DUSK", "n"),
    0x32: ("TINT_UI_DARK", ""),
    0x33: ("SAVE_GAME", "n"),            # slot; -1 = ask
    0x34: ("FLAG_FROM_TOWN", "n"),
    0x35: ("UI_HALF_A", ""),
    0x36: ("UI_HALF_B", ""),
    0x37: ("WRITE_COMPLETE_FLAG", ""),
    0x38: ("UNLOCK_ANIMS", ""),
    0x39: ("LOCK_ANIMS", ""),
}

# EXT sub-opcode 99 appears only in EVENT98.dat.  The shipped FUN_0040a5c0 jump
# table covers 1..57 only, so the game ignores it and then stops at the next
# non-0xFF byte.  Operand layouts below are inferred from the data, not code.
EXT99_OPS = {
    0: ("EXT99_0", ""),
    1: ("EXT99_1", "n"),
    2: ("EXT99_2", ""),
    3: ("EXT99_3", ""),
    4: ("EXT99_4", "ns"),
    5: ("EXT99_5", ""),
}


class DecodeError(Exception):
    pass


stats_unsupported = []  # positions of EXT99 uses (reset per file)


def read_cstr(data, pc):
    end = data.find(b"\0", pc)
    if end < 0:
        raise DecodeError("unterminated string at 0x%x" % pc)
    return data[pc:end], end + 1


def decode_text(raw):
    try:
        return raw.decode("cp949")
    except UnicodeDecodeError:
        return raw.decode("cp949", "backslashreplace")


def quote(raw):
    return '"' + decode_text(raw).replace("\\", "\\\\").replace('"', '\\"') + '"'


def read_number(data, pc):
    if pc >= len(data):
        raise DecodeError("number past EOF at 0x%x" % pc)
    b = data[pc]
    if b == 0x80:
        if pc + 5 > len(data):
            raise DecodeError("i32 past EOF at 0x%x" % pc)
        return struct.unpack_from("<i", data, pc + 1)[0], pc + 5
    return (b - 256 if b >= 0x80 else b), pc + 1


def parse_symbols(data):
    """Return (list of (name, offset), table_end)."""
    syms = []
    pc = 0
    while pc < len(data) and data[pc] != 0xFF:
        raw, pc = read_cstr(data, pc)
        if pc + 4 > len(data):
            raise DecodeError("symbol table truncated")
        off = struct.unpack_from("<I", data, pc)[0]
        pc += 4
        syms.append((raw.decode("ascii", "backslashreplace"), off))
    return syms, pc


def decode_operands(data, pc, spec, labels_lower):
    """Decode operands per spec. Returns (args, pc, info).

    args: n/u -> int, s/L -> str, F -> [speaker, letter|None], V -> letter str, Z -> [int...];
    an X (extended) operand sets info['sub'] and appends the sub-opcode's operands.
    info: {'sub', 'unsupported', 'missing' (labels not in the table), 'skipped' (unit id 0 cut the rest)}.
    """
    args = []
    info = {"sub": None, "unsupported": False, "missing": [], "skipped": False}
    for code in spec:
        if code == "n":
            v, pc = read_number(data, pc)
            args.append(v)
        elif code == "u":
            v, pc = read_number(data, pc)
            args.append(v)
            if v == 0:
                # Unit id 0 never resolves (FUN_0041f5f0 skips empty slots), and
                # every handler reads its remaining operands inside the
                # `if (unit != NULL)` block, so the game skips them too.
                info["skipped"] = True
                break
        elif code == "s":
            raw, pc = read_cstr(data, pc)
            args.append(decode_text(raw))
        elif code == "L":
            raw, pc = read_cstr(data, pc)
            name = raw.decode("ascii", "backslashreplace")
            if name.lower() not in labels_lower:
                info["missing"].append(name)
            args.append(name)
        elif code == "F":
            v, pc = read_number(data, pc)
            if v == 0:
                args.append([0, None])
            else:
                if pc + 2 > len(data):
                    raise DecodeError("face bytes past EOF at 0x%x" % pc)
                letter, pad = data[pc], data[pc + 1]
                pc += 2
                if pad != 0:
                    raise DecodeError("face pad byte 0x%02x at 0x%x" % (pad, pc - 1))
                args.append([v, chr(letter) if 0x20 <= letter < 0x7F else "0x%02x" % letter])
        elif code == "V":
            if pc + 2 > len(data):
                raise DecodeError("variant bytes past EOF at 0x%x" % pc)
            letter, pad = data[pc], data[pc + 1]
            pc += 2
            if pad != 0:
                raise DecodeError("variant pad byte 0x%02x at 0x%x" % (pad, pc - 1))
            args.append(chr(letter) if 0x20 <= letter < 0x7F else "0x%02x" % letter)
        elif code == "X":
            sub, pc = read_number(data, pc)
            ent = EXT_OPS.get(sub)
            if ent is None and sub == 99:
                sub2, pc = read_number(data, pc)
                ent = EXT99_OPS.get(sub2)
                if ent is None:
                    raise DecodeError("unknown ext99 sub-opcode %d" % sub2)
                info["unsupported"] = True
                stats_unsupported.append(pc)
            elif ent is None:
                raise DecodeError("unknown ext opcode %d" % sub)
            info["sub"] = ent[0]
            sub_args, pc, sub_info = decode_operands(data, pc, ent[1], labels_lower)
            args.extend(sub_args)
            info["missing"].extend(sub_info["missing"])
            info["skipped"] = sub_info["skipped"]
        elif code == "Z":
            items = []
            while True:
                v, pc = read_number(data, pc)
                if v == 0:
                    break
                items.append(v)
            args.append(items)
        else:
            raise AssertionError(code)
    return args, pc, info


SPEC_BY_NAME = {name: spec for name, spec in MAIN_OPS.values()}
SPEC_BY_NAME.update({name: spec for name, spec in EXT_OPS.values()})
SPEC_BY_NAME.update({name: spec for name, spec in EXT99_OPS.values()})


def decode_program(data):
    """Structured decode of one event file.

    Returns {'symbols': [[name, offset], ...], 'body': table_end,
             'code': [{'at', 'end', 'op', 'sub'?, 'args', 'missing'?, 'skipped'?, 'unsupported'?}, ...],
             'stats': {'instr', 'unknown', 'db', 'errors', 'unsupported', 'missing_labels'}}.
    'op' is the main mnemonic; an EXT instruction carries the sub-opcode name in 'sub'.
    """
    syms, body = parse_symbols(data)
    labels_lower = {name.lower() for name, _ in syms}
    code = []
    stats = {"instr": 0, "unknown": 0, "db": 0, "errors": [], "unsupported": 0, "missing_labels": []}
    del stats_unsupported[:]
    pc = body
    while pc < len(data):
        start = pc
        b = data[pc]
        if b != 0xFF:
            code.append({"at": start, "end": pc + 1, "op": "DB", "args": [b]})
            stats["db"] += 1
            pc += 1
            continue
        if pc + 1 >= len(data):
            code.append({"at": start, "end": pc + 1, "op": "DB", "args": [0xFF], "truncated": True})
            stats["db"] += 1
            pc += 1
            continue
        op = data[pc + 1]
        pc += 2
        ins = {"at": start, "op": None, "args": []}
        try:
            if op in MAIN_OPS:
                name, spec = MAIN_OPS[op]
                args, pc, info = decode_operands(data, pc, spec, labels_lower)
                ins["args"] = args
                if info["sub"]:
                    ins["sub"] = info["sub"]
                if info["missing"]:
                    ins["missing"] = info["missing"]
                    stats["missing_labels"].extend("0x%04x: %s" % (start, m) for m in info["missing"])
                if info["skipped"]:
                    ins["skipped"] = True
                if info["unsupported"]:
                    ins["unsupported"] = True
            elif op == 0xFF:
                name = "END"                      # ff ff: switch default -> script end
            elif op >= 0x40:
                # any value >= 0x40 hits the switch default (script end) but is not used by the data files.
                name = "END(default op 0x%02x)" % op
                stats["unknown"] += 1
            else:
                name = "UNKNOWN_0x%02x" % op
                stats["unknown"] += 1
        except DecodeError as e:
            stats["errors"].append("0x%04x: %s" % (start, e))
            name = "UNKNOWN_0x%02x" % op
            stats["unknown"] += 1
            pc = len(data)  # cannot resync safely
        ins["op"] = name
        ins["end"] = pc
        stats["instr"] += 1
        code.append(ins)
    stats["unsupported"] = len(stats_unsupported)
    return {"symbols": [[n, o] for n, o in syms], "body": body, "code": code, "stats": stats}


def _format_args(ins):
    """Text operands of one decoded instruction, in the disassembler's listing format."""
    spec = SPEC_BY_NAME.get(ins.get("sub") or ins["op"], "")
    out = []
    if ins.get("sub"):
        out.append(ins["sub"] + ("(unsupported)" if ins.get("unsupported") else ""))
    missing = set(ins.get("missing", ()))
    args = ins["args"]
    for code, v in zip(spec, args):
        if code == "n":
            out.append(str(v))
        elif code == "u":
            out.append("u%d" % v if v != 24 else "u24(target)")
            if v == 0:
                out.append("; u0: rest skipped")
        elif code == "s":
            out.append('"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"')
        elif code == "L":
            out.append("@" + v + ("(?)" if v in missing else ""))
        elif code == "F":
            if v[0] == 0:
                out.append("close")
            else:
                out.append("spk%d" % v[0])
                out.append("face%s" % v[1] if v[1].startswith("0x") else "face'%s'" % v[1])
        elif code == "V":
            out.append("var%s" % v if v.startswith("0x") else "var'%s'" % v)
        elif code == "Z":
            out.append("[" + ", ".join(str(x) for x in v) + "]")
    return out


def disassemble(data, show_raw=False):
    prog = decode_program(data)
    syms, body = prog["symbols"], prog["body"]
    by_off = {}
    for name, off in syms:
        by_off.setdefault(off, []).append(name)
    lines = []
    starts = set()
    for ins in prog["code"]:
        for name in by_off.get(ins["at"], ()):
            lines.append("%s:" % name)
        starts.add(ins["at"])
        if ins["op"] == "DB":
            lines.append("  0x%04x: DB 0x%02x%s" % (ins["at"], ins["args"][0], "  ; truncated" if ins.get("truncated") else ""))
            continue
        text = "  0x%04x: %s" % (ins["at"], ins["op"])
        out = _format_args(ins)
        if out:
            text += " " + ", ".join(out)
        if show_raw:
            text += "   ; " + data[ins["at"]:ins["end"]].hex(" ")
        lines.append(text)
    bad_syms = [(n, o) for n, o in syms if o not in starts]
    return syms, body, lines, prog["stats"], bad_syms


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("-q", "--quiet", action="store_true", help="summary only")
    ap.add_argument("-r", "--raw", action="store_true", help="show raw bytes")
    args = ap.parse_args(argv)
    rc = 0
    for path in args.files:
        with open(path, "rb") as f:
            data = f.read()
        try:
            syms, body, lines, stats, bad_syms = disassemble(data, args.raw)
        except DecodeError as e:
            print("%s: FATAL %s" % (path, e))
            rc = 1
            continue
        ok = not stats["errors"] and not bad_syms and stats["unknown"] == 0
        summary = "%s: size=%d table_end=0x%x symbols=%d instr=%d db=%d unknown=%d unsupported_ext99=%d bad_sym=%d errors=%d %s" % (
            path, len(data), body, len(syms), stats["instr"], stats["db"], stats["unknown"],
            stats["unsupported"], len(bad_syms), len(stats["errors"]), "OK" if ok else "FAIL")
        if not ok:
            rc = 1
        if args.quiet:
            print(summary)
            for e in stats["errors"]:
                print("   error", e)
            for n, o in bad_syms:
                print("   symbol %s -> 0x%x is not an instruction start" % (n, o))
            continue
        print("; " + summary)
        print("; symbols:")
        for name, off in syms:
            print(";   %-24s 0x%04x" % (name, off))
        for ln in lines:
            print(ln)
        for e in stats["errors"]:
            print("; ERROR", e)
        for n, o in bad_syms:
            print("; BAD SYMBOL %s -> 0x%x" % (n, o))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
