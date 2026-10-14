import unittest

from ft2_export import apd_json, map_json, normalize_name


class NormalizeName(unittest.TestCase):
    def test_lowercases_and_strips_bmp(self):
        self.assertEqual(normalize_name('Char_01g.bmp'), 'char_01g')

    def test_cuts_garbage_after_bmp(self):
        self.assertEqual(normalize_name('npc_24.bmp..'), 'npc_24')

    def test_plain_name_without_extension(self):
        self.assertEqual(normalize_name('st02a'), 'st02a')


class MapJson(unittest.TestCase):
    def test_cell_at_table_and_fields(self):
        m = dict(w=2, h=2, bg='', layers=['St02B.bmp'], start=(0, -1), origin=(32, -16), pixel_size=(640, 480),
                 cells=[dict(height=1, blocked=0, flag2=0, land=3,
                             objects=[dict(layer=0, front=1, left=0, top=0, right=64, bottom=32, ox=-32, oy=-16)]),
                        dict(height=0, blocked=1, flag2=0, land=0, objects=[])],
                 grid={'1,0': 0, '0,1': 1})
        j = map_json(m)
        self.assertEqual(j['w'], 2)
        self.assertIsNone(j['bg'])
        self.assertEqual(j['layers'], ['st02b'])
        self.assertEqual(j['start'], [0, -1])
        self.assertEqual(j['pixelSize'], [640, 480])
        # N = 3 → cellAt[c*3 + r]
        self.assertEqual(j['cellAt'], [-1, 1, -1, 0, -1, -1, -1, -1, -1])
        self.assertEqual(j['cells'][0]['h'], 1)
        self.assertEqual(j['cells'][0]['objs'][0], dict(layer=0, front=1, left=0, top=0, right=64, bottom=32, ox=-32, oy=-16))
        self.assertEqual(j['cells'][1]['blocked'], 1)


class ApdJson(unittest.TestCase):
    def test_fields_and_sheet_names(self):
        d = dict(version=3, sheets=['Char_01a.bmp', 'Char_01g.bmp'],
                 images=[dict(sheet=0, key=253, x=0, y=0, w=64, h=64, ox=-40, oy=-56)],
                 patterns=[dict(y_offset=32, images=[0])],
                 anims=[dict(name='F.STAND', script='S200\r\nP0')])
        j = apd_json(d)
        self.assertEqual(j['sheets'], ['char_01a', 'char_01g'])
        self.assertEqual(j['images'][0]['key'], 253)
        self.assertEqual(j['patterns'][0], dict(yOffset=32, images=[0]))
        self.assertEqual(j['anims'][0]['script'], 'S200\r\nP0')


if __name__ == '__main__':
    unittest.main()
