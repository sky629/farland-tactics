"""FT2.exe UI resources → JSON: the 21 dialog templates (RT_DIALOG) and menu 103 (RT_MENU).

The original draws cursors, range tiles and text windows on its 640×480 surface, but every other piece of interface is
Win32 chrome: a menu bar and dialog boxes whose layout lives in the executable's resource section. This reads them with
the standard library only (PE section table → resource directory → DLGTEMPLATE/DLGTEMPLATEEX and MENUITEMTEMPLATE), so the
web remake can rebuild the same dialogs from data instead of hand-written coordinates.

Usage: python3 -I tools/ft2_dialogs.py FT2.exe out.json
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

RT_MENU, RT_DIALOG = 4, 5
CLASS_ATOMS = {0x80: 'button', 0x81: 'edit', 0x82: 'static', 0x83: 'listbox', 0x84: 'scrollbar', 0x85: 'combobox'}
DS_SETFONT = 0x40
MF_POPUP, MF_END = 0x10, 0x80


def _wstr(data: bytes, off: int) -> tuple[str, int]:
    out = []
    while True:
        (c,) = struct.unpack_from('<H', data, off)
        off += 2
        if c == 0:
            return ''.join(out), off
        out.append(chr(c))


def _sz_or_ord(data: bytes, off: int):
    """A resource "sz_Or_Ord": 0 = none, 0xFFFF + WORD = ordinal, else a NUL-terminated UTF-16 string."""
    (w,) = struct.unpack_from('<H', data, off)
    if w == 0xFFFF:
        return ('ord', struct.unpack_from('<H', data, off + 2)[0]), off + 4
    if w == 0:
        return None, off + 2
    return _wstr(data, off)


def _ident(v) -> int | None:
    return None if v in (0xFFFF, 0xFFFFFFFF) else v


def parse_dialog(raw: bytes) -> dict:
    """DLGTEMPLATE or DLGTEMPLATEEX → {ex, style, title, font, cx, cy, items:[{id, cls, text, x, y, cx, cy, style}]}."""
    ex = struct.unpack_from('<HH', raw, 0) == (1, 0xFFFF)
    if ex:
        _, _, _helpid, _exstyle, style, cdit, _x, _y, cx, cy = struct.unpack_from('<HHIIIHhhhh', raw, 0)
        p = 26
    else:
        style, _exstyle, cdit, _x, _y, cx, cy = struct.unpack_from('<IIHhhhh', raw, 0)
        p = 18
    _menu, p = _sz_or_ord(raw, p)
    _cls, p = _sz_or_ord(raw, p)
    title, p = _wstr(raw, p)
    font = None
    if style & DS_SETFONT:
        (pt,) = struct.unpack_from('<H', raw, p)
        p += 2
        if ex:
            p += 4                                                           # weight, italic, charset
        name, p = _wstr(raw, p)
        font = [pt, name]
    items = []
    for _ in range(cdit):
        p = (p + 3) & ~3                                                     # every control starts DWORD-aligned
        if ex:
            _helpid, _exst, st, x, y, w, h, cid = struct.unpack_from('<IIIhhhhI', raw, p)
            p += 24
        else:
            st, _exst, x, y, w, h, cid = struct.unpack_from('<IIhhhhH', raw, p)
            p += 18
        cls, p = _sz_or_ord(raw, p)
        text, p = _sz_or_ord(raw, p)
        (extra,) = struct.unpack_from('<H', raw, p)
        p += 2 + extra                                                       # creation data
        cls_name = CLASS_ATOMS.get(cls[1], f'atom{cls[1]:#x}') if isinstance(cls, tuple) else cls
        text_s = text if isinstance(text, str) else (f'#{text[1]}' if isinstance(text, tuple) else None)
        items.append(dict(id=_ident(cid), cls=cls_name, text=text_s, x=x, y=y, cx=w, cy=h, style=st))
    return dict(ex=ex, style=style, title=title, font=font, cx=cx, cy=cy, items=items)


def parse_menu(raw: bytes) -> dict:
    """MENUITEMTEMPLATEHEADER (version 0) → {items:[{text, id, flags, items?}]}; MF_POPUP opens a sub-list, MF_END closes one."""
    ver, hdr = struct.unpack_from('<HH', raw, 0)
    if ver != 0:
        raise ValueError(f'unsupported menu template version {ver}')

    def items(p: int) -> tuple[list, int]:
        out = []
        while True:
            (flags,) = struct.unpack_from('<H', raw, p)
            p += 2
            if flags & MF_POPUP:
                text, p = _wstr(raw, p)
                sub, p = items(p)
                out.append(dict(text=text, id=None, flags=flags, items=sub))
            else:
                (mid,) = struct.unpack_from('<H', raw, p)
                p += 2
                text, p = _wstr(raw, p)
                out.append(dict(text=text, id=mid, flags=flags))
            if flags & MF_END:
                return out, p

    out, _ = items(4 + hdr)
    return dict(items=out)


def read_resources(exe: bytes) -> dict:
    """{'dialogs': {id: dialog}, 'menus': {id: menu}} from a PE32 image's .rsrc section."""
    (pe,) = struct.unpack_from('<I', exe, 0x3C)
    (nsec,) = struct.unpack_from('<H', exe, pe + 6)
    (optsize,) = struct.unpack_from('<H', exe, pe + 20)
    opt = pe + 24
    rsrc_rva, _rsrc_size = struct.unpack_from('<II', exe, opt + 96 + 2 * 8)   # data directory 2 = resources (PE32)
    sections = []
    for i in range(nsec):
        o = opt + optsize + i * 40
        vsz, va, rsz, ro = struct.unpack_from('<IIII', exe, o + 8)
        sections.append((va, max(vsz, rsz), ro))

    def rva2off(rva: int) -> int:
        for va, size, ro in sections:
            if va <= rva < va + size:
                return ro + rva - va
        raise ValueError(f'rva {rva:#x} outside every section')

    base = rva2off(rsrc_rva)

    def readdir(off: int) -> list[tuple[int | str, int]]:
        nn, ni = struct.unpack_from('<HH', exe, off + 12)
        out = []
        for k in range(nn + ni):
            name, child = struct.unpack_from('<II', exe, off + 16 + k * 8)
            if name & 0x80000000:
                so = base + (name & 0x7FFFFFFF)
                (ln,) = struct.unpack_from('<H', exe, so)
                ident: int | str = exe[so + 2:so + 2 + ln * 2].decode('utf-16le')
            else:
                ident = name
            out.append((ident, child))
        return out

    def leaf(child: int) -> bytes:
        rva, size, _cp = struct.unpack_from('<III', exe, base + child)
        off = rva2off(rva)
        return exe[off:off + size]

    out: dict = {'dialogs': {}, 'menus': {}}
    for rtype, child in readdir(base):
        if rtype not in (RT_MENU, RT_DIALOG):
            continue
        for ident, c2 in readdir(base + (child & 0x7FFFFFFF)):
            for _lang, c3 in readdir(base + (c2 & 0x7FFFFFFF)):
                raw = leaf(c3)
                if rtype == RT_DIALOG:
                    out['dialogs'][str(ident)] = parse_dialog(raw)
                else:
                    out['menus'][str(ident)] = parse_menu(raw)
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    res = read_resources(Path(argv[1]).read_bytes())
    Path(argv[2]).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f"dialogs {len(res['dialogs'])}, menus {len(res['menus'])}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
