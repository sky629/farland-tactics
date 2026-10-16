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

    def test_staff_list_parses_markup_into_lines_and_spaces(self):
        text = '//\r\n// comment\r\n/MINCHO//BOLD//LINESPACE:6//FONTCOL:243//DECOCOL:244/\r\n/SPACESIZE:12/\r\n\r\n/SPACE/\r\n/SIZE:24//MINCHO/\r\n파랜드 택틱스\r\n/SIZE:16//GOTIC/\r\n프로그램\r\n/SPACE/\r\nKoji Yamamoto\r\n/SIZE:28/한글화 제작팀\r\n/SIZE:23/서판규\r\n'
        with tempfile.TemporaryDirectory() as d:
            src, dst = Path(d, 'game'), Path(d, 'out')
            (src / 'DATA').mkdir(parents=True)
            (src / 'DATA' / 'staff.lst').write_bytes(text.encode('cp949'))
            report = ft2_export.Report()
            n = ft2_export.export_staff(src, dst, report)
            self.assertEqual(report.errors, [])
            lines = json.loads((dst / 'data' / 'staff.json').read_text(encoding='utf-8'))
            self.assertEqual(n, len(lines))
            self.assertEqual(lines, [
                {'space': 12},
                {'text': '파랜드 택틱스', 'size': 24, 'font': 'mincho', 'bold': True, 'gap': 6},
                {'text': '프로그램', 'size': 16, 'font': 'gotic', 'bold': True, 'gap': 6},
                {'space': 12},
                {'text': 'Koji Yamamoto', 'size': 16, 'font': 'gotic', 'bold': True, 'gap': 6},
                {'text': '한글화 제작팀', 'size': 28, 'font': 'gotic', 'bold': True, 'gap': 6},   # tokens and text on one line (the Korean team block)
                {'text': '서판규', 'size': 23, 'font': 'gotic', 'bold': True, 'gap': 6},
            ])

    def test_missing_list_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            report = ft2_export.Report()
            self.assertEqual(ft2_export.export_visual(Path(d, 'none'), Path(d, 'out'), report), 0)
            self.assertEqual(len(report.errors), 1)


if __name__ == '__main__':
    unittest.main()
