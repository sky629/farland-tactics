/**
 * Dialog 162 "경험치 배분" (EXT BATTLE_RESULT): seven rows — portrait button 1121.., name static 1122.., owner-drawn bar 1104.. and
 * label 1114.. "exp(+share)" — the pool left in 1110 "경험치  n", 밸런스 배분(1109) = the equalizing split the dialog opens on,
 * 균등배분(1108) = the even split, 결정(1) adds the shares. The bars are ranges here (the original draws them itself [추정]).
 */
import { equalizeShare, evenShare } from '../../../game/expShare';
import { DialogBox, type DialogHost } from '../dialog';

const ROW_IDS = [[1121, 1122, 1104, 1114], [1129, 1123, 1105, 1115], [1130, 1124, 1106, 1116], [1131, 1125, 1107, 1117], [1132, 1126, 1111, 1118], [1133, 1127, 1112, 1119], [1134, 1128, 1113, 1120]] as const;

export interface ExpShareModel { shares: number[]; set(i: number, v: number): void; even(): void; balance(): void; left(): number; label(i: number): string; text(): string }

export function expShareModel(party: { exp: number }[], pool: number): ExpShareModel {
  const exps = party.map((u) => u.exp);
  const m: ExpShareModel = {
    shares: equalizeShare(exps, pool),
    left: () => pool - m.shares.reduce((a, b) => a + b, 0),
    set(i, v) { const others = m.shares.reduce((a, b, k) => a + (k === i ? 0 : b), 0); m.shares[i] = Math.max(0, Math.min(Math.trunc(v), pool - others)); },
    even() { m.shares = evenShare(exps.length, pool); },
    balance() { m.shares = equalizeShare(exps, pool); },
    label: (i) => `${exps[i]}(+${m.shares[i]})`,
    text: () => `경험치  ${m.left()}`,
  };
  return m;
}

/** The dialog; resolves with the shares in party order (the caller adds them to the units). */
export function expShareDialog(host: DialogHost, party: { exp: number; name: string }[], pool: number): Promise<number[]> {
  const box = new DialogBox<number[]>(host, 162);
  const m = expShareModel(party, pool);
  const doc = host.layer.ownerDocument;
  const bars: HTMLInputElement[] = [];
  ROW_IDS.forEach(([portrait, name, bar, label], i) => {
    const u = party[i];
    if (!u) { for (const id of [portrait, name, bar, label]) box.hide(id); return; }
    box.setText(name, u.name);
    const range = doc.createElement('input'); range.type = 'range'; range.min = '0'; range.max = String(pool); range.className = 'w95-bar';
    box.control(bar).replaceChildren(range); bars.push(range);
    range.addEventListener('input', () => { m.set(i, Number(range.value)); refresh(); });
  });
  const refresh = () => { party.forEach((_, i) => { bars[i]!.value = String(m.shares[i]); box.setText(ROW_IDS[i]![3], m.label(i)); }); box.setText(1110, m.text()); };
  box.onClick(1109, () => { m.balance(); refresh(); });
  box.onClick(1108, () => { m.even(); refresh(); });
  box.onClick(1, () => box.close(m.shares));
  refresh();
  return box.show();
}
