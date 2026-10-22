/**
 * Dialog 156 "파랜드 택틱스 환경설정" (F11): 전화면 표시 ON/OFF (1092/1093), 사용음원 MIDI/CD-DA (1090/1091), 효과음 ON/OFF (1094/1095),
 * a note edit (1096), DirectX 하드웨어/에물레이션 (1097/1098), 설정(1) / 취소(2). On the web the music is always the MIDI synth
 * (CD-DA and the DirectX choice are greyed) and the note tells the synth's state.
 */
import { DialogBox, type DialogHost } from '../dialog';
import { SPEEDS, type Speed } from '../speed';

export interface Settings { fullscreen: boolean; sound: boolean; speed: Speed }

/** The web-only row under the template: 배속 1배/2배/4배 (F6 cycles it in the game window). */
function speedStrip(host: DialogHost, current: Speed): { el: HTMLElement; value: () => Speed } {
  const doc = host.layer.ownerDocument, strip = doc.createElement('div'); strip.className = 'w95-strip';
  const cap = doc.createElement('span'); cap.textContent = '배속 (F6 · 6):'; strip.appendChild(cap);
  const radios = SPEEDS.map((s) => {
    const label = doc.createElement('label'), r = doc.createElement('input');
    r.type = 'radio'; r.name = 'speed'; r.value = String(s); r.checked = s === current;
    label.append(r, `${s}배`); strip.appendChild(label);
    return [s, r] as const;
  });
  return { el: strip, value: () => radios.find(([, r]) => r.checked)?.[0] ?? current };
}

export function settingsDialog(host: DialogHost, current: Settings, note: string): Promise<Settings | null> {
  const box = new DialogBox<Settings | null>(host, 156, { cancel: () => null }, 26);
  const speed = speedStrip(host, current.speed); box.extra(speed.el);
  const radio = (id: number) => box.control<HTMLLabelElement>(id).querySelector('input')!;
  const group = (a: number, b: number, name: string, on: boolean) => { radio(a).name = name; radio(b).name = name; radio(a).checked = on; radio(b).checked = !on; };
  group(1092, 1093, 'full', current.fullscreen); group(1094, 1095, 'sound', current.sound); group(1090, 1091, 'source', true); group(1097, 1098, 'dx', true);
  for (const id of [1091, 1097, 1098]) box.setEnabled(id, false);
  box.setEnabled(1090, false);
  const edit = box.control<HTMLInputElement>(1096); edit.value = note; edit.readOnly = true;
  box.onClick(1, () => box.close({ fullscreen: radio(1092).checked, sound: radio(1094).checked, speed: speed.value() }));
  box.onClick(2, () => box.close(null));
  return box.show();
}
