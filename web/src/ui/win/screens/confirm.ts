/**
 * The 확인 boxes of ASK (FUN_004343b0): the question in static 1058, 예(6) / 아니오(7); Esc answers no. A "+" prefix on the
 * script's text picks resource 0xA3 — dialog 163, the small box — else 0x7E, dialog 126 (whose icon button 1059 is left blank:
 * owner-drawn in the original [추정]). The text is shown as the script shows it (underscores as spaces, stars dropped).
 */
import { scriptText } from '../../../script/vm';
import { DialogBox, type DialogHost } from '../dialog';

export type ConfirmTemplate = 126 | 163;

/** The script's ASK argument → the box to use and the text to show. */
export function askPrompt(raw: string): { text: string; template: ConfirmTemplate } {
  const small = raw.startsWith('+');
  return { text: scriptText(small ? raw.slice(1) : raw), template: small ? 163 : 126 };
}

export function confirm(host: DialogHost, text: string, template: ConfirmTemplate = 126): Promise<boolean> {
  const box = new DialogBox<boolean>(host, template, { cancel: () => false });
  box.setText(1058, text);
  box.onClick(6, () => box.close(true));
  box.onClick(7, () => box.close(false));
  return box.show();
}
