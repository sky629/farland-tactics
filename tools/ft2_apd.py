#!/usr/bin/env python3
"""Parser for Farland Tactics 2 .APD sprite files (magic 'nDPA', n = version 0..3).

Layout (little-endian), as read by FT2.exe FUN_00427f60 and its helpers:
  header   16 B  : magic[4] ("3DPA"), u32 unused, u16 n_sheets, u16 n_images, u16 n_patterns, u16 n_anims
  sheets   n_sheets × 256 B (version 0: 1024 B) : BMP file name, NUL padded (looked up in sprite\\)
  images   n_images × 20 B  : u8 sheet, u8 key, u16 x, u16 y, u16 w, u16 h, i16 ox, i16 oy, 6 B pad
                              key = color-key palette index of this image (FUN_00428620 → FUN_0040e0a0
                              SetColorKey before each blit; version < 2 files use 255 regardless)
  patterns n_patterns × 520 B (version <3: 72 B) : u32 unused, i16 y_offset, u16 count, u16 image_index[count], pad
                              y_offset is subtracted from the draw y (FUN_00428780 / FUN_0042a610); the u32 is not read
  anims    n_anims × 36 B  : char name[32], u16 script_offset, u16 script_length
  scripts  (last.offset + last.length + 1) B : ASCII animation scripts referenced by the anims
Bytes after the script blob are ignored by the game (about a third of the files carry leftovers).

Animation script grammar (FT2.exe FUN_00424c80 and helpers; full rules in
docs/superpowers/specs/2026-10-14-rendering-foundation-design.md §8):
  S<ms>            frame duration for the following frames (default 200)
  N<n>             frame count of the step: cycle emitted frames to fill, or truncate
  M<dx>,<dy>       movement of the whole step in pixels; the second number ENDS the step
  P<list>          list elements: [H|V][A|B|C|D][(n)|(#n)]<pattern>[-<pattern>]; '-' is a range
                   (either direction), A..D attach a mark 1..4 and (n) a trigger to the frame of the
                   number they precede (for a range: its last frame). The trigger resets after every number.
  H / V            flip: before a number (that frame), before P or M (whole token: HM negates dx),
                   before @ (whole include). Flip bits combine with XOR.
  @<anim_name>     include the steps of another animation of this file (name ends at ',' or space)
A step with M but no P repeats the previous step's frames.

Usage: python3 -I ft2_apd.py FILE.APD [--json]      # or a directory to validate every .apd in it
"""
import json
import struct
import sys
from pathlib import Path


def parse(data: bytes) -> dict:
    magic, _unused, n_sheets, n_images, n_patterns, n_anims = struct.unpack_from('<4sIHHHH', data, 0)
    if magic[1:] != b'DPA' or not magic[:1].isdigit():
        raise ValueError(f'bad magic {magic!r}')
    version = int(magic[:1])
    pos = 16
    name_len = 0x400 if version == 0 else 0x100
    sheets = []
    for _ in range(n_sheets):
        sheets.append(data[pos:pos + name_len].split(b'\0')[0].decode('ascii', 'replace'))
        pos += name_len
    images = []
    for _ in range(n_images):
        sheet, key, x, y, w, h, ox, oy = struct.unpack_from('<BBHHHHhh', data, pos)
        images.append(dict(sheet=sheet, key=key, x=x, y=y, w=w, h=h, ox=ox, oy=oy))
        pos += 20
    pattern_len = 0x208 if version >= 3 else 0x48
    patterns = []
    for _ in range(n_patterns):
        y_offset, count = struct.unpack_from('<hH', data, pos + 4)
        indices = list(struct.unpack_from(f'<{count}H', data, pos + 8))
        patterns.append(dict(y_offset=y_offset, images=indices))
        pos += pattern_len
    anims = []
    for _ in range(n_anims):
        name = data[pos:pos + 32].split(b'\0')[0].decode('ascii', 'replace')
        offset, length = struct.unpack_from('<HH', data, pos + 32)
        anims.append(dict(name=name, offset=offset, length=length))
        pos += 36
    scripts = b''
    if anims:
        blob_len = anims[-1]['offset'] + anims[-1]['length'] + 1
        scripts = data[pos:pos + blob_len]
        pos += blob_len
    for a in anims:
        a['script'] = scripts[a['offset']:a['offset'] + a['length']].decode('ascii', 'replace')
    return dict(version=version, sheets=sheets, images=images, patterns=patterns,
                anims=anims, consumed=pos, file_size=len(data))


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        raise SystemExit(__doc__)
    target = Path(argv[1])
    if target.is_dir():
        files = sorted(p for p in target.iterdir() if p.suffix.lower() == '.apd')
        exact = trailing = 0
        for p in files:
            d = parse(p.read_bytes())
            if d['consumed'] == d['file_size']:
                exact += 1
            else:
                trailing += 1
        print(f'{len(files)} files parsed; {exact} consumed exactly, {trailing} with ignored trailing bytes')
        return 0
    d = parse(target.read_bytes())
    if '--json' in argv:
        print(json.dumps(d, ensure_ascii=False, indent=1))
        return 0
    print(f"{target.name}: APD v{d['version']}, sheets={d['sheets']}, "
          f"{len(d['images'])} images, {len(d['patterns'])} patterns, {len(d['anims'])} anims")
    for a in d['anims']:
        print(f"  {a['name']:16} {a['script']!r}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
