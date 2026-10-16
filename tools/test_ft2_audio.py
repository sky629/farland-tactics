import contextlib
import hashlib
import io
import tempfile
import unittest
from pathlib import Path

import ft2_soundfont
from ft2_export import Report, export_audio
from ft2_soundfont import SoundfontError, fetch_soundfont


class ExportAudio(unittest.TestCase):
    def test_copies_wave_and_gm_midi_with_lower_case_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / 'game', Path(tmp) / 'out'
            (src / 'Wave').mkdir(parents=True); (src / 'Midi').mkdir()
            (src / 'Wave' / 'A.wav').write_bytes(b'RIFFa'); (src / 'Wave' / 'hit.WAV').write_bytes(b'RIFFb')
            (src / 'Midi' / 'bgm00.mid').write_bytes(b'MThd0'); (src / 'Midi' / 'bgm07_gs.mid').write_bytes(b'MThdg')
            (src / 'Midi' / 'bgm07.mid').write_bytes(b'MThd7'); (src / 'Midi' / 'back.lzh').write_bytes(b'lzh')
            report = Report()
            got = export_audio(src, dst, report)
            self.assertEqual(got, {'wave': ['a', 'hit'], 'midi': [0, 7]})
            self.assertEqual((dst / 'wave' / 'a.wav').read_bytes(), b'RIFFa')
            self.assertEqual((dst / 'wave' / 'hit.wav').read_bytes(), b'RIFFb')
            self.assertEqual(sorted(p.name for p in (dst / 'midi').iterdir()), ['bgm00.mid', 'bgm07.mid'])
            self.assertEqual(report.errors, [])

    def test_missing_directories_are_errors_not_crashes(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = Report()
            got = export_audio(Path(tmp) / 'nogame', Path(tmp) / 'out', report)
            self.assertEqual(got, {'wave': [], 'midi': []})
            self.assertEqual(len(report.errors), 2)


class Soundfont(unittest.TestCase):
    def test_downloads_checks_the_hash_and_keeps_a_verified_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            blob = b'RIFF fake soundfont'
            src = Path(tmp) / 'gm.sf3'; src.write_bytes(blob)
            dest = Path(tmp) / 'assets'
            out = fetch_soundfont(src.as_uri(), dest, hashlib.sha256(blob).hexdigest())
            self.assertEqual(out, dest / 'sf2' / 'gm.sf3')
            self.assertEqual(out.read_bytes(), blob)
            src.write_bytes(b'changed')
            self.assertEqual(fetch_soundfont(src.as_uri(), dest, hashlib.sha256(blob).hexdigest()).read_bytes(), blob)   # verified copy: untouched

    def test_an_existing_copy_with_the_wrong_hash_is_fetched_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            blob = b'RIFF the real one'
            src = Path(tmp) / 'gm.sf3'; src.write_bytes(blob)
            dest = Path(tmp) / 'assets'; (dest / 'sf2').mkdir(parents=True); (dest / 'sf2' / 'gm.sf3').write_bytes(b'RIFF truncated')
            self.assertEqual(fetch_soundfont(src.as_uri(), dest, hashlib.sha256(blob).hexdigest()).read_bytes(), blob)

    def test_the_default_hash_is_pinned(self):
        self.assertRegex(ft2_soundfont.DEFAULT_SHA256, r'^[0-9a-f]{64}$')

    def test_a_failed_download_is_an_error_line_not_a_traceback(self):
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stderr(io.StringIO()) as err:
            rc = ft2_soundfont.main(['ft2_soundfont.py', str(Path(tmp) / 'assets'), '--url', (Path(tmp) / 'nowhere.sf3').as_uri()])
        self.assertEqual(rc, 1)
        self.assertTrue(err.getvalue().startswith('error:'), err.getvalue())

    def test_hash_mismatch_removes_the_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / 'gm.sf3'; src.write_bytes(b'not the font')
            dest = Path(tmp) / 'assets'
            with self.assertRaises(SoundfontError):
                fetch_soundfont(src.as_uri(), dest, '00' * 32)
            self.assertFalse((dest / 'sf2' / 'gm.sf3').exists())


if __name__ == '__main__':
    unittest.main()
