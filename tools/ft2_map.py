#!/usr/bin/env python3
"""Parser for Farland Tactics 2 map files (map\\stageNN.map, SZDD-compressed 'FM2' records).

Decompressed layout (little-endian), as read by FT2.exe FUN_0042d5d0 / FUN_00431460:
  0x00 magic "FM2\\0"
  0x04 u32 w, 0x08 u32 h          : logical grid size; the map holds w*h + (w-1)*(h-1) diamond cells
  0x0C u32 n_layers               : number of object image layers
  0x10 char bg[16]                : background BMP name (map\\), may be empty
  0x20 i32 ×2 parallax divisors   : background scroll = (−320 − camera) / divisor; 0 pins it to the screen (FUN_00431900)
  0x28 i32 ×2 bg_offset           : background position in cells (×32, ×16 → map pixels) (FUN_00431460 `<< 5`, `<< 4`; FUN_00431900)
  0x30 RECT view (left, top, right, bottom) in diagonal cell units:
         origin_x = (top - left) * 32,  origin_y = -(top + left) * 16
         pixel_w  = max(640, (right - bottom - left + top) * 32)
         pixel_h  = max(480, (bottom - top - left + right) * 16)
  0x40 char layer[n_layers][16]   : object layer BMP names (map\\)
  then u32 cell_offset[count]     : absolute offsets of the cell records
  cell record : i16 height, u8 blocked, u8 flag2, u8 land, u8 n_objects,
                n_objects × 14 B { u8 layer, u8 front, i16 left, i16 top, i16 right, i16 bottom, i16 ox, i16 oy }
Cells are addressed by diagonal coordinates (c, r) with 0 <= c, r < w + h - 1 (FUN_0042d960).
Screen position of a cell: x = (c - r) * 32 + origin_x, y = (c + r) * 16 + origin_y - height * 8.
An object is drawn at (x + ox, y + oy) from RECT(left, top, right, bottom) of layer image `layer`;
front == 1 objects occlude units standing behind them (drawn in the second pass).

Usage: python3 -I ft2_map.py stage02.map [--json]     # or a directory to validate all maps
"""
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # keep working under `python3 -I`
from ft2_szdd import szdd_decompress  # noqa: E402


def cell_index(w: int, h: int, c: int, r: int) -> int:
    """Port of FUN_0042d960: diagonal (c, r) -> 1-based cell index, 0 if outside the map."""
    if c + r < w - 1 or c + r > h * 2 + w - 3 or abs(c - r) > w - 1:
        return 0
    cap = min(w, h) * 2 - 1
    index = 1
    for k in range(c):
        n = min(k, h - k + w - 2) * 2 + 1
        index += min(n, cap)
    if c >= w:
        return w - c - 1 + r + index
    return r - w + 1 + c + index


def parse(data: bytes) -> dict:
    if data[:4] == b'SZDD':
        data = szdd_decompress(data)
    if data[:4] != b'FM2\0':
        raise ValueError('not an FM2 map')
    w, h, n_layers = struct.unpack_from('<III', data, 4)
    bg = data[0x10:0x20].split(b'\0')[0].decode('ascii', 'replace')
    parallax = struct.unpack_from('<2i', data, 0x20)
    bg_offset = struct.unpack_from('<2i', data, 0x28)
    left, top, right, bottom = struct.unpack_from('<4i', data, 0x30)
    layers = [data[0x40 + 16 * i:0x50 + 16 * i].split(b'\0')[0].decode('ascii', 'replace')
              for i in range(n_layers)]
    count = w * h + (w - 1) * (h - 1)
    table = 0x40 + 16 * n_layers
    offsets = struct.unpack_from(f'<{count}I', data, table)
    cells = []
    for o in offsets:
        height, blocked, flag2, land, n_obj = struct.unpack_from('<hBBBB', data, o)
        objects = []
        for j in range(n_obj):
            layer, front, l, t, r, b, ox, oy = struct.unpack_from('<BBhhhhhh', data, o + 6 + 14 * j)
            objects.append(dict(layer=layer, front=front, left=l, top=t, right=r, bottom=b, ox=ox, oy=oy))
        cells.append(dict(height=height, blocked=blocked, flag2=flag2, land=land, objects=objects))
    size = w + h - 1
    grid = {}
    for c in range(size):
        for r in range(size):
            idx = cell_index(w, h, c, r)
            if idx:
                grid[f'{c},{r}'] = idx - 1
    return dict(
        w=w, h=h, bg=bg, layers=layers, parallax=parallax, bg_offset=bg_offset,
        view=dict(left=left, top=top, right=right, bottom=bottom),
        origin=((top - left) * 32, -(top + left) * 16),
        pixel_size=(max(640, (right - bottom - left + top) * 32), max(480, (bottom - top - left + right) * 16)),
        cells=cells, grid=grid)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        raise SystemExit(__doc__)
    target = Path(argv[1])
    if target.is_dir():
        for p in sorted(q for q in target.iterdir() if q.suffix.lower() == '.map'):
            m = parse(p.read_bytes())
            used = set(m['grid'].values())
            assert used == set(range(len(m['cells']))), p.name
            print(f"{p.name}: {m['w']}x{m['h']} cells={len(m['cells'])} layers={m['layers']} "
                  f"origin={m['origin']} px={m['pixel_size']}")
        return 0
    m = parse(target.read_bytes())
    if '--json' in argv:
        print(json.dumps(m, ensure_ascii=False))
        return 0
    objects = sum(len(c['objects']) for c in m['cells'])
    print(f"{target.name}: grid {m['w']}x{m['h']} ({len(m['cells'])} cells), bg={m['bg']!r}, layers={m['layers']}")
    print(f"  view={m['view']} origin={m['origin']} pixel_size={m['pixel_size']} start={m['start']}")
    print(f"  objects={objects}, heights {min(c['height'] for c in m['cells'])}..{max(c['height'] for c in m['cells'])}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
