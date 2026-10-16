import json
import struct
import tempfile
import unittest
from pathlib import Path

import ft2_export


def rec(scene, step, slot, name, pal=(0, 0, 0)):
    return struct.pack('<HHH', scene, step, slot) + name.encode('ascii').ljust(16, b'\0') + struct.pack('<HHHH', 0, *pal)


class VisualExportTest(unittest.TestCase):
    def test_records_become_json_with_lowercase_names(self):
        with tempfile.TemporaryDirectory() as d:
            src, dst = Path(d, 'game'), Path(d, 'out')
            (src / 'DATA').mkdir(parents=True)
            (src / 'DATA' / 'vsllst.dat').write_bytes(rec(0, 0, 0, 'VOP01') + rec(3, 0, 2, 'V03C00', (32, 10, 208)))
            report = ft2_export.Report()
            n = ft2_export.export_visual(src, dst, report)
            self.assertEqual(n, 2)
            self.assertEqual(report.errors, [])
            data = json.loads((dst / 'data' / 'visual.json').read_text(encoding='utf-8'))
            self.assertEqual(data[0], {'scene': 0, 'step': 0, 'slot': 0, 'name': 'vop01', 'pal': [0, 0, 0]})
            self.assertEqual(data[1]['name'], 'v03c00')
            self.assertEqual(data[1]['pal'], [32, 10, 208])

    def test_missing_list_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            report = ft2_export.Report()
            self.assertEqual(ft2_export.export_visual(Path(d, 'none'), Path(d, 'out'), report), 0)
            self.assertEqual(len(report.errors), 1)


if __name__ == '__main__':
    unittest.main()
