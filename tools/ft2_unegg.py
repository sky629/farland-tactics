#!/usr/bin/env python3
"""Extract the Farland Tactics 2 EGG archive (ALZip EGG format, unencrypted, non-solid, split volumes).

Usage: python3 -I tools/ft2_unegg.py FIRST.vol1.egg [OUT_DIR]     (no OUT_DIR = list only)
The other volumes (.vol2.egg ...) are found next to the first one by name. Supported compression:
store, deflate, bzip2. Every block is CRC-checked. Stdlib only.
"""
import bz2
import os
import re
import struct
import sys
import zlib
from pathlib import Path, PurePosixPath

SIG_EGG = 0x41474745
SIG_SPLIT = 0x24F5A262
SIG_SOLID = 0x24E5A060
SIG_FILE = 0x0A8590E3
SIG_FILENAME = 0x0A8591AC
SIG_WININFO = 0x2C86950B
SIG_ENCRYPT = 0x08D1470F
SIG_BLOCK = 0x02B50C13
SIG_END = 0x08E28222

FILETIME_EPOCH_DIFF = 116444736000000000  # 1601-01-01 -> 1970-01-01, in 100 ns


def read_extra_fields(buf, pos):
    """Read extra fields up to SIG_END. Return ({sig: (flag, data)}, pos after SIG_END)."""
    fields = {}
    while True:
        (sig,) = struct.unpack_from('<I', buf, pos)
        pos += 4
        if sig == SIG_END:
            return fields, pos
        flag = buf[pos]
        if flag & 0x01:
            (size,) = struct.unpack_from('<I', buf, pos + 1)
            pos += 5
        else:
            (size,) = struct.unpack_from('<H', buf, pos + 1)
            pos += 3
        fields[sig] = (flag, bytes(buf[pos:pos + size]))
        pos += size


def read_volume(path):
    """Return (header_id, next_id, payload) of one volume."""
    data = path.read_bytes()
    sig, _version, header_id, _reserved = struct.unpack_from('<IHII', data, 0)
    if sig != SIG_EGG:
        raise ValueError(f'{path.name}: not an EGG file')
    fields, pos = read_extra_fields(data, 14)
    if SIG_SOLID in fields:
        raise ValueError('solid EGG archives are not supported')
    if SIG_ENCRYPT in fields:
        raise ValueError('encrypted EGG archives are not supported')
    next_id = 0
    if SIG_SPLIT in fields:
        _prev_id, next_id = struct.unpack_from('<II', fields[SIG_SPLIT][1])
    return header_id, next_id, data[pos:]


def join_volumes(first):
    """Concatenate the payloads of all volumes, following the split ID chain."""
    m = re.fullmatch(r'(.*)\.vol(\d+)\.egg', first.name)
    if not m:
        header_id, next_id, payload = read_volume(first)
        return bytearray(payload), 1
    volumes = sorted(first.parent.glob(f'{m.group(1)}.vol*.egg'),
                     key=lambda p: int(re.search(r'\.vol(\d+)\.egg$', p.name).group(1)))
    joined = bytearray()
    expected_id = None
    for vol in volumes:
        header_id, next_id, payload = read_volume(vol)
        if expected_id is not None and header_id != expected_id:
            raise ValueError(f'{vol.name}: split chain broken (expected id {expected_id:#x})')
        joined += payload
        expected_id = next_id
    if expected_id != 0:
        raise ValueError('last volume points to a missing next volume')
    return joined, len(volumes)


def decode_name(flag, data):
    pos = 0
    encoding = 'utf-8'
    if flag & 0x08:
        (codepage,) = struct.unpack_from('<H', data, 0)
        encoding = f'cp{codepage}'
        pos += 2
    if flag & 0x10:
        raise ValueError('relative-path filename headers are not supported')
    return data[pos:].decode(encoding).replace('\\', '/')


def safe_target(out_dir, name):
    rel = PurePosixPath(name)
    if rel.is_absolute() or '..' in rel.parts:
        raise ValueError(f'unsafe path in archive: {name}')
    return out_dir.joinpath(*rel.parts)


def decompress(method, data, usize):
    if method == 0:
        return bytes(data)
    if method == 1:
        return zlib.decompress(data, -15, usize)
    if method == 2:
        return bz2.decompress(data)
    raise ValueError(f'unsupported compression method {method}')


def main():
    first = Path(sys.argv[1])
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    buf, n_volumes = join_volumes(first)
    print(f'volumes: {n_volumes}, payload: {len(buf):,} bytes')

    pos = 0
    n_files = n_dirs = total = 0
    while pos < len(buf):
        (sig,) = struct.unpack_from('<I', buf, pos)
        if sig == SIG_END:
            pos += 4
            break
        if sig != SIG_FILE:
            # Archive-level extra field (e.g. a comment): skip it.
            _, pos = read_extra_fields(buf, pos)
            pos -= 4  # read_extra_fields consumed a SIG_END that is not ours
            continue
        _file_id, file_length = struct.unpack_from('<IQ', buf, pos + 4)
        fields, pos = read_extra_fields(buf, pos + 16)
        if SIG_ENCRYPT in fields:
            raise ValueError('encrypted entries are not supported')
        name = decode_name(*fields[SIG_FILENAME])
        mtime = attr = None
        if SIG_WININFO in fields:
            filetime, attr = struct.unpack_from('<QB', fields[SIG_WININFO][1])
            mtime = (filetime - FILETIME_EPOCH_DIFF) / 1e7

        chunks = []
        while pos < len(buf) and struct.unpack_from('<I', buf, pos)[0] == SIG_BLOCK:
            method, _hint, usize, csize, crc, end = struct.unpack_from('<BBIIII', buf, pos + 4)
            if end != SIG_END:
                raise ValueError(f'{name}: bad block header')
            pos += 22
            if out_dir is not None:
                chunk = decompress(method, buf[pos:pos + csize], usize)
                if len(chunk) != usize or zlib.crc32(chunk) != crc:
                    raise ValueError(f'{name}: CRC/size mismatch')
                chunks.append(chunk)
            pos += csize

        is_dir = file_length == 0 and attr is not None and attr & 0x80
        if is_dir:
            n_dirs += 1
        else:
            n_files += 1
            total += file_length
        if out_dir is None:
            attr_text = '-' if attr is None else f'{attr:#04x}'
            print(f'{"D" if is_dir else "F"} {file_length:>12,}  attr={attr_text}  {name}')
            continue
        target = safe_target(out_dir, name)
        if is_dir:
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            data = b''.join(chunks)
            if len(data) != file_length:
                raise ValueError(f'{name}: size mismatch')
            target.write_bytes(data)
        if mtime is not None:
            os.utime(target, (mtime, mtime))

    print(f'files: {n_files}, dirs: {n_dirs}, total: {total:,} bytes, '
          f'unparsed tail: {len(buf) - pos} bytes')


if __name__ == '__main__':
    main()
