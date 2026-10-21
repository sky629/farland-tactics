import json
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from walk_report import chapters, load_manifest, main, render_report


def tiny_png(path: Path, rgb=(10, 20, 30)):
    """A 2×2 PNG with the standard library only."""
    raw = b''.join(b'\0' + bytes(rgb) * 2 for _ in range(2))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 2, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


MANIFEST = {
    'run': {'seed': 7, 'from': None, 'startedAt': '2026-10-21T04:00:00Z', 'frames': 100, 'simulatedMs': 20000, 'done': True, 'stopped': None},
    'shots': [
        {'id': 1, 'tag': 'map', 'file': '0001-map.png', 't': 0, 'stage': 1, 'battle': 0, 'turn': None, 'mode': 'script', 'flags': []},
        {'id': 2, 'tag': 'battle-start', 'file': '0002-battle-start.png', 't': 5000, 'stage': 1, 'battle': 1, 'turn': 1, 'mode': 'battle', 'flags': []},
        {'id': 3, 'tag': 'flag-blank', 'file': '0003-flag-blank.png', 't': 9000, 'stage': 1, 'battle': 1, 'turn': 2, 'mode': 'battle', 'flags': ['flag-blank'],
         'note': 'event01@7426 LOAD_MAP[51] fade=none map=none town=false camera=0,0'},
    ],
    'counts': {'map': 1, 'battle-start': 1, 'flag-blank': 1},
    'log': ['walk: stage 1 town → facility 2'],
    'console': [],
}


class WalkReport(unittest.TestCase):
    def test_chapters_group_by_battle(self):
        ch = chapters(MANIFEST['shots'])
        self.assertEqual(sorted(ch), [0, 1])
        self.assertEqual([s['id'] for s in ch[1]], [2, 3])

    def test_report_puts_flagged_frames_first_and_names_chapters(self):
        html = render_report(MANIFEST, None, inline=False)
        self.assertLess(html.index('0003-flag-blank.png'), html.index('전투 1'))
        self.assertIn('전투 1', html)
        self.assertIn('shots/0002-battle-start.png', html)
        self.assertIn('3장', html)

    def test_flagged_frame_shows_its_note(self):
        html = render_report(MANIFEST, None, inline=False)
        self.assertIn('LOAD_MAP[51] fade=none', html)
        self.assertLess(html.index('LOAD_MAP[51]'), html.index('전투 1'))

    def test_a_shot_without_its_png_is_skipped_not_fatal(self):
        with tempfile.TemporaryDirectory() as d:
            run = Path(d); (run / 'shots').mkdir()
            for s in MANIFEST['shots'][:2]:
                tiny_png(run / 'shots' / s['file'])                      # the flagged shot's PNG is missing (the harvester skipped it)
            (run / 'manifest.json').write_text(json.dumps(MANIFEST), encoding='utf-8')
            self.assertEqual(main([str(run)]), 0)
            summary = (run / 'summary.html').read_text(encoding='utf-8')
            report = (run / 'report.html').read_text(encoding='utf-8')
            self.assertNotIn('src="None"', report)
            self.assertIn('0003-flag-blank.png', summary)                   # the caption still names the lost picture
            self.assertNotIn('src="None"', summary)
            self.assertIn('사진 없음', summary)

    def test_main_writes_report_and_summary(self):
        with tempfile.TemporaryDirectory() as d:
            run = Path(d); (run / 'shots').mkdir()
            for s in MANIFEST['shots']:
                tiny_png(run / 'shots' / s['file'])
            (run / 'manifest.json').write_text(json.dumps(MANIFEST), encoding='utf-8')
            self.assertEqual(main([str(run)]), 0)
            self.assertTrue((run / 'report.html').is_file())
            self.assertTrue((run / 'summary.html').is_file())
            self.assertEqual(load_manifest(run / 'manifest.json')['run']['seed'], 7)
            self.assertIn('data:image/png;base64,', (run / 'summary.html').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
