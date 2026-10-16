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


from ft2_export import battles_from_listing, roster_json


class BattlesFromListing(unittest.TestCase):
    LISTING = [
        'outfield:',
        '  0x26d1: MUSIC 6',
        '  0x26d6: LOAD_MAP 49',
        '  0x26d9: LOAD_UNITS 49',
        '  0x2755: MESSAGE "슬라임을_전멸시켜라!?"',
        '  0x276d: BATTLE_START_HEAL',
        '  0x276f: END',
        'restart:',
        '  0x2774: LOAD_MAP 49',
        '  0x277a: FIELD_MODE',
        '  0x2781: END',
        'roof:',
        '  0x1d9b: LOAD_MAP 29',
        '  0x1d9c: LOAD_UNITS 29',
        '  0x1daa: EPISODE "지붕_위에서의_싸움", 0',
        '  0x1dc0: MESSAGE "적을_전멸시켜라!"',
        '  0x1dd3: BATTLE_START',
        'setup:',
        '  0x2600: LOAD_MAP 26',
        '  0x2603: LOAD_UNITS 26',
        '  0x2606: EPISODE "나_시집가요", 1',
        '  0x2620: JUMP @battle_start',
        '  0x2629: END',
        'battle_start:',
        '  0x2686: FLAG_ADD 2, 1',
        '  0x268a: FIELD_MODE',
        '  0x268f: BATTLE_START_HEAL',
        'broken:',
        '  0x3000: MESSAGE "x"',
        '  0x3001: BATTLE_START',
    ]

    def test_extracts_one_entry_per_battle_start(self):
        entries, warnings = battles_from_listing(self.LISTING, 5)
        self.assertEqual(entries, [
            dict(event=5, label='outfield', map='stage49', roster=49, episode='', objective='슬라임을 전멸시켜라!?', heal=True),
            dict(event=5, label='roof', map='stage29', roster=29, episode='지붕 위에서의 싸움', objective='적을 전멸시켜라!', heal=False),
            dict(event=5, label='battle_start', map='stage26', roster=26, episode='나 시집가요', objective='', heal=True),   # set up in the label that jumps here
        ])
        self.assertEqual(warnings, ['EVENT05 broken: BATTLE_START without LOAD_MAP/LOAD_UNITS'])


class RosterJson(unittest.TestCase):
    def test_drops_hi_words_and_keeps_named_fields(self):
        recs = [dict(unit_id=8, race=10, level=1, dir=1, c=14, c_hi=0, r=17, r_hi=0, status=0, side=4,
                     weapon=130, armor=0, drop_item=0, drop_gold=0)]
        self.assertEqual(roster_json(recs), [dict(unit_id=8, race=10, level=1, dir=1, c=14, r=17, status=0, side=4,
                                                  weapon=130, armor=0, drop_item=0, drop_gold=0)])


if __name__ == '__main__':
    unittest.main()
