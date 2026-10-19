import { describe, expect, it } from 'vitest';
import { duToPx, layoutDialog, metricsFor, mnemonic, type DialogTemplate } from '../src/ui/win/layout';

// dialog 126 "확인" as the exporter writes it (tools/ft2_dialogs.py): a static for the question, 예/아니오, an owner-drawn icon button
const confirm126: DialogTemplate = { ex: false, style: 0x80c800c0, title: '확인', font: [9, '굴림'], cx: 151, cy: 55, items: [
  { id: 1058, cls: 'static', text: null, x: 48, y: 9, cx: 96, cy: 16, style: 0x50020001 },
  { id: 6, cls: 'button', text: '예(&Y)', x: 48, y: 32, cx: 44, cy: 16, style: 0x50030000 },
  { id: 7, cls: 'button', text: '아니오(&N)', x: 100, y: 32, cx: 44, cy: 16, style: 0x50010000 },
  { id: 1059, cls: 'button', text: null, x: 6, y: 4, cx: 32, cy: 48, style: 0x5002000b },
] };

describe('Win95 dialog layout from the original templates', () => {
  it('dialog units scale by the font: 4 per average character width across, 8 per character height down', () => {
    expect(duToPx({ charW: 6, charH: 12 }, 48, 32, 44, 16)).toEqual({ left: 72, top: 48, width: 66, height: 24 });
    expect(duToPx({ charW: 7, charH: 13 }, 1, 1, 1, 1)).toEqual({ left: 2, top: 2, width: 2, height: 2 });   // rounded, never 0 for a 1-du control
  });
  it('lays out the dialog size and every control with its kind flags', () => {
    const l = layoutDialog(confirm126, { charW: 6, charH: 12 });
    expect([l.width, l.height]).toEqual([227, 83]);                       // 151 × 6/4 = 226.5 → 227; 55 × 12/8 = 82.5 → 83
    expect(l.controls[0]).toMatchObject({ id: 1058, cls: 'static', label: '', align: 'center', left: 72, top: 14, width: 144, height: 24 });
    expect(l.controls[1]).toMatchObject({ id: 6, cls: 'button', label: '예(Y)', ul: 2, key: 'y', kind: 'push' });   // 0x50030000: WS_GROUP|WS_TABSTOP, no BS_DEFPUSHBUTTON — the original's 확인 has no default button
    expect(l.controls[2]).toMatchObject({ id: 7, kind: 'push' });
    expect(l.controls[3]).toMatchObject({ id: 1059, kind: 'ownerdraw' });   // BS_OWNERDRAW 0xb
  });
  it('mnemonics and accelerators come out of the resource strings', () => {
    expect(mnemonic('유니트 일람(&L)\tF2')).toEqual({ label: '유니트 일람(L)', ul: 7, key: 'l', accel: 'F2' });
    expect(mnemonic('산다!')).toEqual({ label: '산다!', ul: -1, key: null, accel: null });
    expect(mnemonic('게임종료(&Q)\tALT+F4')).toEqual({ label: '게임종료(Q)', ul: 5, key: 'q', accel: 'ALT+F4' });
  });
  it('static alignment and button kinds follow the style bits', () => {
    const l = layoutDialog({ ...confirm126, items: [
      { id: 1085, cls: 'static', text: '999999', x: 0, y: 0, cx: 10, cy: 8, style: 0x50020002 },     // SS_RIGHT
      { id: 1092, cls: 'button', text: 'ON', x: 0, y: 0, cx: 10, cy: 8, style: 0x50030009 },        // BS_AUTORADIOBUTTON
      { id: null, cls: 'button', text: '현재 소지품', x: 0, y: 0, cx: 10, cy: 8, style: 0x50000007 },  // BS_GROUPBOX
      { id: 1022, cls: 'SysTabControl32', text: 'Tab1', x: 0, y: 0, cx: 10, cy: 8, style: 0x50010100 },
      { id: 1, cls: 'button', text: '게임 개시(&S)', x: 0, y: 0, cx: 10, cy: 8, style: 0x50010001 },   // BS_DEFPUSHBUTTON (dialog 124)
    ] }, { charW: 6, charH: 12 });
    expect(l.controls.map((c) => c.kind)).toEqual(['text', 'radio', 'group', 'tab', 'default']);
    expect(l.controls[0]!.align).toBe('right');
  });
  it('the dialog base unit follows 굴림, a half-width font: average character width = half the pixel size, height = the pixel size', () => {
    expect(metricsFor([9, '굴림'])).toEqual({ charW: 6, charH: 12 });          // 9 pt = 12 px
    expect(metricsFor([12, '굴림'])).toEqual({ charW: 8, charH: 16 });
    expect(metricsFor(null)).toEqual({ charW: 6, charH: 12 });                 // no DS_SETFONT: the system font, 9 pt
  });
});
