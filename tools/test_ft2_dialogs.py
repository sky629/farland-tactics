import struct
import unittest

from ft2_dialogs import parse_dialog, parse_menu


def dlg(items, title='확인', font=(9, '굴림')):
    """A DLGTEMPLATE (16-bit style, DS_SETFONT) with `items` = (id, class atom, text, x, y, cx, cy)."""
    head = struct.pack('<IIHhhhh', 0x80000000 | 0x40, 0, len(items), 0, 0, 100, 50) + b'\0\0' + b'\0\0' \
        + title.encode('utf-16le') + b'\0\0' + struct.pack('<H', font[0]) + font[1].encode('utf-16le') + b'\0\0'
    body = b''
    for cid, cls, text, x, y, cx, cy in items:
        while (len(head) + len(body)) % 4:
            body += b'\0'
        body += struct.pack('<IIhhhhH', 0x50010000, 0, x, y, cx, cy, cid) + struct.pack('<HH', 0xFFFF, cls) \
            + text.encode('utf-16le') + b'\0\0' + b'\0\0'
    return head + body


class ParseDialog(unittest.TestCase):
    def test_controls_positions_and_classes(self):
        d = parse_dialog(dlg([(6, 0x80, '예(&Y)', 48, 32, 44, 16), (1058, 0x82, '', 48, 9, 96, 16)]))
        self.assertEqual((d['cx'], d['cy'], d['title'], d['font']), (100, 50, '확인', [9, '굴림']))
        self.assertEqual(d['items'][0], dict(id=6, cls='button', text='예(&Y)', x=48, y=32, cx=44, cy=16, style=0x50010000))
        self.assertEqual(d['items'][1]['cls'], 'static')
        self.assertFalse(d['ex'])

    def test_static_id_minus_one_is_null(self):
        d = parse_dialog(dlg([(0xFFFF, 0x82, '체력(HP)', 4, 112, 32, 8)]))
        self.assertIsNone(d['items'][0]['id'])


class ParseMenu(unittest.TestCase):
    def test_popup_and_items_with_end_flags(self):
        raw = struct.pack('<HH', 0, 0) + struct.pack('<H', 0x10 | 0x80) + '맵'.encode('utf-16le') + b'\0\0' \
            + struct.pack('<HH', 0x80, 40009) + '턴 종료(&T)\tF10'.encode('utf-16le') + b'\0\0'
        m = parse_menu(raw)
        self.assertEqual(m['items'][0]['text'], '맵')
        self.assertEqual(m['items'][0]['items'][0], dict(text='턴 종료(&T)\tF10', id=40009, flags=0x80))


if __name__ == '__main__':
    unittest.main()
