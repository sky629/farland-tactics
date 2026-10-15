"""Tests for ft2_unegg.py with a synthetic single-volume EGG archive (store + deflate blocks)."""
import contextlib
import io
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ft2_unegg as unegg  # noqa: E402


def field(sig: int, data: bytes) -> bytes:
    return struct.pack('<IBH', sig, 0, len(data)) + data


def raw_deflate(data: bytes) -> bytes:
    c = zlib.compressobj(wbits=-15)
    return c.compress(data) + c.flush()


def build_egg(entries: list[tuple[str, bytes, int]]) -> bytes:
    """entries: (name, content, method) with method 0 = store, 1 = deflate."""
    out = struct.pack('<IHII', unegg.SIG_EGG, 0x100, 1, 0) + struct.pack('<I', unegg.SIG_END)
    for file_id, (name, data, method) in enumerate(entries):
        out += struct.pack('<IIQ', unegg.SIG_FILE, file_id, len(data))
        out += field(unegg.SIG_FILENAME, name.encode('utf-8')) + struct.pack('<I', unegg.SIG_END)
        comp = data if method == 0 else raw_deflate(data)
        out += struct.pack('<IBBIIII', unegg.SIG_BLOCK, method, 0, len(data), len(comp), zlib.crc32(data), unegg.SIG_END)
        out += comp
    return out + struct.pack('<I', unegg.SIG_END)


def run(argv: list[str]) -> str:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        sys.argv = ['ft2_unegg.py', *argv]
        unegg.main()
    return buf.getvalue()


class UneggTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.archive = self.tmp / 'game.egg'
        self.archive.write_bytes(build_egg([
            ('Pkg/DATA/a.dat', b'stored bytes', 0),
            ('Pkg/Map/b.map', b'FM2\0' * 500, 1),
        ]))

    def test_list_only_prints_entries_and_writes_nothing(self) -> None:
        out = run([str(self.archive)])
        self.assertIn('F           12  attr=-  Pkg/DATA/a.dat', out)
        self.assertIn('files: 2, dirs: 0, total: 2,012 bytes, unparsed tail: 0 bytes', out)
        self.assertEqual(sorted(p.name for p in self.tmp.iterdir()), ['game.egg'])

    def test_extracts_store_and_deflate_blocks(self) -> None:
        out_dir = self.tmp / 'out'
        run([str(self.archive), str(out_dir)])
        self.assertEqual((out_dir / 'Pkg/DATA/a.dat').read_bytes(), b'stored bytes')
        self.assertEqual((out_dir / 'Pkg/Map/b.map').read_bytes(), b'FM2\0' * 500)

    def test_rejects_path_traversal(self) -> None:
        evil = self.tmp / 'evil.egg'
        evil.write_bytes(build_egg([('../escape.txt', b'x', 0)]))
        with self.assertRaises(ValueError):
            run([str(evil), str(self.tmp / 'out2')])
        self.assertFalse((self.tmp / 'escape.txt').exists())


if __name__ == '__main__':
    unittest.main()
