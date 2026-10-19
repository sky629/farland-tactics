/** Dialog 160 "BGM 선택" (menu item 0x6b, offered once the game has been completed): the tracks in list 1101, 확인(1) plays, 취소(2). */
import { DialogBox, type DialogHost } from '../dialog';

export function bgmDialog(host: DialogHost, tracks: string[]): Promise<string | null> {
  const box = new DialogBox<string | null>(host, 160, { cancel: () => null });
  let pick: string | null = tracks[0] ?? null;
  box.setList(1101, tracks.map((text) => ({ text })), (i) => { pick = tracks[i] ?? null; }, (i) => box.close(tracks[i] ?? null));
  box.control(1101).firstElementChild?.classList.add('selected');
  box.onClick(1, () => box.close(pick));
  box.onClick(2, () => box.close(null));
  return box.show();
}
