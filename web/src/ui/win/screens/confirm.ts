/** Dialog 126 "확인": the question in static 1058, 예(6) / 아니오(7); Esc answers no. The icon button 1059 is left blank (owner-drawn in the original [추정]). */
import { DialogBox, type DialogHost } from '../dialog';

export function confirm(host: DialogHost, text: string): Promise<boolean> {
  const box = new DialogBox<boolean>(host, 126, { cancel: () => false });
  box.setText(1058, text);
  box.onClick(6, () => box.close(true));
  box.onClick(7, () => box.close(false));
  return box.show();
}
