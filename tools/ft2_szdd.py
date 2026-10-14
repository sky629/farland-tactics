#!/usr/bin/env python3
"""SZDD (MS-DOS COMPRESS.EXE / LZ32) decompressor for Farland Tactics 2 assets.

Every .bmp and .map in the game folder is SZDD-compressed; FT2.exe reads them
through LZ32.DLL (LZOpenFile/LZRead), which decompresses transparently.

Usage:
  python3 -I ft2_szdd.py OUT_DIR FILE...          # decompress (non-SZDD files are copied)
  python3 -I ft2_szdd.py --png OUT_DIR FILE...    # additionally convert 8-bpp BMPs to indexed PNG

The PNG keeps the palette and has no transparency: the game applies a color key per image at
draw time (see analysis/file_formats.md §1), so transparency belongs to the renderer.
"""
import struct
import sys
import zlib
from pathlib import Path

MAGIC = b'SZDD\x88\xF0\x27\x33'


def szdd_decompress(data: bytes) -> bytes:
    if data[:8] != MAGIC:
        raise ValueError('not an SZDD stream')
    expected = struct.unpack_from('<I', data, 10)[0]
    window = bytearray(b' ' * 4096)
    pos = 4096 - 16
    out = bytearray()
    i = 14
    while i < len(data) and len(out) < expected:
        control = data[i]
        i += 1
        for bit in range(8):
            if i >= len(data) or len(out) >= expected:
                break
            if control & (1 << bit):
                b = data[i]
                i += 1
                out.append(b)
                window[pos] = b
                pos = (pos + 1) & 0xFFF
            else:
                b1, b2 = data[i], data[i + 1]
                i += 2
                src = b1 | ((b2 & 0xF0) << 4)
                length = (b2 & 0x0F) + 3
                for _ in range(length):
                    b = window[src]
                    src = (src + 1) & 0xFFF
                    out.append(b)
                    window[pos] = b
                    pos = (pos + 1) & 0xFFF
    return bytes(out)


def bmp8_to_png(bmp: bytes) -> bytes:
    """Convert an uncompressed 8-bpp BMP to an indexed PNG (keeps the palette, filter 0, no tRNS)."""
    if bmp[:2] != b'BM':
        raise ValueError('not a BMP')
    pixel_offset = struct.unpack_from('<I', bmp, 10)[0]
    header_size = struct.unpack_from('<I', bmp, 14)[0]
    width, height = struct.unpack_from('<ii', bmp, 18)
    bpp, compression = struct.unpack_from('<HI', bmp, 28)
    colors_used = struct.unpack_from('<I', bmp, 46)[0] or 256
    if bpp != 8 or compression != 0:
        raise ValueError(f'unsupported BMP: {bpp} bpp, compression {compression}')
    palette = bmp[14 + header_size:14 + header_size + 4 * colors_used]
    plte = b''.join(palette[i + 2:i + 3] + palette[i + 1:i + 2] + palette[i:i + 1]
                    for i in range(0, len(palette), 4))
    stride = (width + 3) & ~3
    bottom_up = height > 0
    height = abs(height)
    rows = []
    for y in range(height):
        src_y = height - 1 - y if bottom_up else y
        start = pixel_offset + src_y * stride
        rows.append(b'\0' + bmp[start:start + width])

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (struct.pack('>I', len(payload)) + tag + payload
                + struct.pack('>I', zlib.crc32(tag + payload) & 0xFFFFFFFF))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 3, 0, 0, 0))
    png += chunk(b'PLTE', plte)
    png += chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
    png += chunk(b'IEND', b'')
    return png


def main(argv: list[str]) -> int:
    args = argv[1:]
    to_png = False
    while args and args[0].startswith('--'):
        flag = args.pop(0)
        if flag == '--png':
            to_png = True
        else:
            raise SystemExit(f'unknown option {flag}')
    if len(args) < 2:
        raise SystemExit(__doc__)
    out_dir = Path(args[0])
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in args[1:]:
        src = Path(name)
        data = src.read_bytes()
        if data[:4] == b'SZDD':
            data = szdd_decompress(data)
        if to_png and data[:2] == b'BM':
            (out_dir / (src.stem + '.png')).write_bytes(bmp8_to_png(data))
        else:
            (out_dir / src.name).write_bytes(data)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
