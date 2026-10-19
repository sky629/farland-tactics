import { canEquip, equip, unequip, type EquipSlot } from '../battle/equipment';
import { countOf, type Inventory } from '../battle/inventory';
import { buy, sell } from '../battle/shop';
import { equalizeShare, evenShare } from '../game/expShare';
import { EXP_CAP } from '../battle/outcome';
import type { Unit } from '../battle/unit';
import type { Tables } from '../data/types';
import type { SaveSummary } from '../save/format';
import type { ModalKind, Where } from '../script/host';
import { itemName, unitName } from './panel';
import type { DialogHost } from './win/dialog';
import { confirm } from './win/screens/confirm';
import { pickSave } from './win/screens/saves';

/** One piece of a TEXT line with the size/color the `[Snn]`/`[Cnn]` tags before it set (null = default). */
export interface TextRun { text: string; size: number | null; color: number | null }

export function parseTextTags(line: string): TextRun[] {
  const runs: TextRun[] = [];
  let size: number | null = null, color: number | null = null, last = 0;
  const re = /\[([SC])(\d+)\]/g;
  const flush = (end: number) => { if (end > last) runs.push({ text: line.slice(last, end), size, color }); };
  for (let m = re.exec(line); m; m = re.exec(line)) {
    flush(m.index);
    if (m[1] === 'S') size = Number(m[2]); else color = Number(m[2]);
    last = m.index + m[0].length;
  }
  flush(line.length);
  return runs;
}

/** What the modals need from the game: item/race names, the shared inventory, the party for equipment purchases. */
export interface ModalContext { tables: Tables; inventory: Inventory; party: (Unit | null)[]; saves?: (SaveSummary | null)[] }

interface ResultPayload { gold: number; pool: number }

const BUY_TEXT: Record<ReturnType<typeof buy>, string> = { ok: '샀다.', 'no gold': '골드가 부족하다.', full: '더 가질 수 없다.', 'unknown item': '그런 물건은 없다.' };

/**
 * HTML overlay for the story scripts (spec §10): two dialogue windows, a modal box (message / ask / shop / result / save)
 * and the episode title. Only DOM glue lives here; clicks on the overlay are counted for WAIT_CLICK.
 */
export class Dialogue {
  readonly windows: Record<Where, HTMLElement>;
  readonly modal: HTMLElement;
  readonly episode: HTMLElement;
  private readonly parts: Record<Where, { face: HTMLImageElement; name: HTMLElement; lines: HTMLElement }>;
  private clicks = 0;
  private result: number | null = null;
  private dialogs: DialogHost | null = null;   // the original's dialog boxes (ask 126, save 143) once the templates are loaded
  private episodeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly doc: Document, root: HTMLElement, private readonly faceUrl: (speaker: number, letter: string) => string | null) {
    const win = (where: Where) => {
      const box = this.el('div', `win ${where}`); box.hidden = true;
      const face = this.el('img', 'face') as HTMLImageElement; face.hidden = true;
      const body = this.el('div', 'body');
      const name = this.el('div', 'name'), lines = this.el('div', 'lines');
      body.append(name, lines); box.append(face, body); root.appendChild(box);
      return { box, face, name, lines };
    };
    const top = win('top'), bottom = win('bottom');
    this.windows = { top: top.box, bottom: bottom.box };
    this.parts = { top, bottom };
    this.modal = this.el('div', 'modal'); this.modal.hidden = true; root.appendChild(this.modal);
    this.episode = this.el('div', 'episode'); this.episode.hidden = true; root.appendChild(this.episode);
    root.addEventListener('click', () => { this.clicks++; });
  }

  private el(tag: string, className: string, text = ''): HTMLElement {
    const e = this.doc.createElement(tag);
    e.className = className;
    if (text) e.textContent = text;
    return e;
  }
  private button(label: string, onClick: () => void): HTMLElement {
    const b = this.el('button', 'btn', label);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
    return b;
  }

  /** The dialog templates and the frame layer for the Win95 boxes; ASK and SAVE_GAME wait until they are attached. */
  attach(host: DialogHost): void { this.dialogs = host; }
  face(where: Where): HTMLImageElement { return this.parts[where].face; }
  lines(where: Where): HTMLElement { return this.parts[where].lines; }

  openWindow(where: Where, speaker: number, faceLetter: string | null): void {
    const p = this.parts[where];
    const url = faceLetter && speaker < 30 ? this.faceUrl(speaker, faceLetter) : null;
    p.face.hidden = url === null;
    if (url) p.face.src = url;
    p.name.textContent = '';
    p.lines.replaceChildren();
    this.windows[where].hidden = false;
  }
  closeWindow(where: Where): void { this.windows[where].hidden = true; }

  text(where: Where, line: string, speakerName: string | null): void {
    const p = this.parts[where];
    if (speakerName) p.name.textContent = speakerName;
    const node = this.el('div', 'line');
    for (const run of parseTextTags(line)) {
      const span = this.el('span', run.color === null ? '' : `c${run.color}`, run.text);
      if (run.size !== null) span.style.fontSize = `${run.size / 16}em`;           // [Snn] is in 640×480 pixels; the overlay scales with the canvas
      node.appendChild(span);
    }
    p.lines.appendChild(node);
    this.windows[where].hidden = false;
  }

  openModal(kind: ModalKind, payload: unknown, ctx: ModalContext): void {
    this.result = null;
    const box = this.modal;
    box.replaceChildren();
    const close = (value: number) => (): void => { this.result = value; box.hidden = true; };
    switch (kind) {
      case 'message': box.append(this.el('div', 'text', String(payload)), this.button('닫기', close(0))); break;
      case 'ask': { if (!this.dialogs) throw new Error('dialogs not attached'); void confirm(this.dialogs, String(payload)).then((yes) => { this.result = yes ? 1 : 0; }); return; }   // dialog 126 확인
      case 'save': { if (!this.dialogs) throw new Error('dialogs not attached'); void pickSave(this.dialogs, ctx.saves ?? [], 'save').then((p) => { this.result = p && 'slot' in p ? p.slot : -1; }); return; }   // dialog 143 데이터 선택
      case 'result': this.battleResult(payload as ResultPayload, ctx, close(0)); break;
      case 'shop': this.shop(payload as number[], ctx, close(1)); break;
    }
    box.hidden = false;
  }

  private shop(ids: number[], ctx: ModalContext, done: () => void): void {
    const box = this.modal;
    const party = ctx.party.filter((u): u is Unit => u !== null);
    const who = this.doc.createElement('select') as HTMLSelectElement;
    who.className = 'who';
    who.replaceChildren(...party.map((u) => Object.assign(this.doc.createElement('option'), { value: String(u.slot), textContent: unitName(u, ctx.tables) })));
    const gold = this.el('div', 'gold'), note = this.el('div', 'note');
    const list = this.el('div', 'list');
    const refresh = () => {
      gold.textContent = `소지금 ${ctx.inventory.gold} Gold`;
      list.replaceChildren();
      for (const id of ids) {
        const item = ctx.tables.item[id];
        if (!item) continue;
        const row = this.el('div', 'item');
        row.append(this.el('span', 'iname', itemName(item)), this.el('span', 'price', `${item.price} Gold`), this.el('span', 'owned', `보유 ${countOf(ctx.inventory, id)}`),
          this.button(`구매 ${itemName(item)}`, () => {
            const unit = party.find((u) => u.slot === Number(who.value)) ?? party[0] ?? null;
            note.textContent = BUY_TEXT[buy(ctx.inventory, unit, id, ctx.tables.item)];
            refresh();
          }));
        list.appendChild(row);
      }
    };
    refresh();
    const party_ = this.button('유니트 일람', () => this.openParty(ctx, { onClose: () => { box.replaceChildren(); this.shop(ids, ctx, done); box.hidden = false; } }));   // dialog 150: 사기 · 유니트 일람 · 돌아오기 (the original has no selling)
    box.append(this.el('div', 'title', '상점'), gold, who, list, note, this.el('div', 'row'), party_, this.button('돌아오기', done));
  }

  /**
   * Battle result (dialog 0xA2): the gold, then the EXP pool the script grants, shared out over the party. The original opens on
   * the equalizing split and lets the player drag each unit's bar; here ± buttons move ten points within the pool, 균등 splits
   * evenly, 확인 adds the shares (FUN_0040a5c0 case 9 then levels the party up — the VM does that after this modal closes).
   */
  private battleResult(r: ResultPayload, ctx: ModalContext, done: () => void): void {
    const box = this.modal;
    const party = ctx.party.filter((u): u is Unit => u !== null);
    const alloc = equalizeShare(party.map((u) => u.exp), r.pool);
    const list = this.el('div', 'list');
    const left = () => r.pool - alloc.reduce((a, b) => a + b, 0);
    const refresh = () => {
      list.replaceChildren();
      party.forEach((u, i) => {
        const row = this.el('div', 'item');
        const move = (d: number) => () => { const v = Math.max(0, Math.min(alloc[i]! + d, alloc[i]! + left())); alloc[i] = v; refresh(); };
        row.append(this.el('span', 'iname', `${unitName(u, ctx.tables)} Lv${u.level} EXP ${u.exp}`), this.el('span', 'price', `+${alloc[i]}`), this.button('−10', move(-10)), this.button('+10', move(10)));
        list.appendChild(row);
      });
    };
    refresh();
    const even = this.button('균등', () => { evenShare(party.length, r.pool).forEach((v, i) => { alloc[i] = v; }); refresh(); });
    const ok = this.button('확인', () => { party.forEach((u, i) => { u.exp = Math.min(u.exp + alloc[i]!, EXP_CAP); }); done(); });
    box.append(this.el('div', 'title', '전투 결과'), this.el('div', 'text', `${r.gold} Gold`), this.el('div', 'gold', `경험치 ${r.pool}`), list, this.el('div', 'row'), even, ok);
  }

  /** Town right click (spec §9): every party member with level, HP/MP, equipment and bag; 장착/해제 go through equipment.ts, 팔기 through shop.ts. */
  openParty(ctx: ModalContext, extra: { onClose?: () => void } = {}): void {
    this.result = null;
    const box = this.modal, items = ctx.tables.item;
    const name = (id: number) => (id === 0 ? '—' : itemName(items[id]!));
    const render = () => {
      box.replaceChildren(this.el('div', 'title', '파티'));
      for (const u of ctx.party) {
        if (!u) continue;
        const row = this.el('div', 'member');
        row.appendChild(this.el('div', 'uname', `${unitName(u, ctx.tables)}  Lv ${u.level}  HP ${u.hp}/${u.hpMax}  MP ${u.mp}/${u.mpMax}`));
        const eq = this.el('div', 'equip');
        const slots: [string, EquipSlot, number][] = [['무기', 'weapon', u.weapon], ['방어구', 'armor', u.armor], ['장신구1', 0, u.acc[0]], ['장신구2', 1, u.acc[1]]];
        for (const [label, where, id] of slots) {
          eq.appendChild(this.el('span', 'slot', `${label}: ${name(id)}`));
          if (id !== 0) eq.appendChild(this.button(`해제 ${label}`, () => { unequip(u, where); render(); }));
        }
        const bag = this.el('div', 'bag');
        bag.appendChild(this.el('span', 'slot', '가방:'));
        u.bag.forEach((id, i) => {
          if (id === 0) return;
          bag.appendChild(this.el('span', 'slot', name(id)));
          if (canEquip(u, id, items)) bag.appendChild(this.button(`장착 ${name(id)}`, () => { equip(u, i, items); render(); }));
          bag.appendChild(this.button(`팔기 ${name(id)}`, () => { sell(ctx.inventory, u, i, items); render(); }));   // menu 103 "도구 → 팔기": half the price
        });
        row.append(eq, bag);
        box.appendChild(row);
      }
      const row = this.el('div', 'row');
      row.appendChild(this.button('닫기', () => { if (extra.onClose) extra.onClose(); else box.hidden = true; }));
      box.appendChild(row);
    };
    render();
    box.hidden = false;
  }

  takeModalResult(): number | null { const r = this.result; this.result = null; return r; }

  showEpisode(title: string): void {
    this.episode.textContent = title;
    this.episode.hidden = false;
    if (this.episodeTimer) clearTimeout(this.episodeTimer);
    this.episodeTimer = setTimeout(() => { this.episode.hidden = true; }, 2500);
  }

  closeAll(): void {
    this.windows.top.hidden = true; this.windows.bottom.hidden = true;
    this.modal.hidden = true; this.episode.hidden = true;
    this.result = null;
  }

  /** One WAIT_CLICK release per click (a double click releases two waits, not three). */
  noteClick(): void { this.clicks++; }
  takeClick(): boolean { if (this.clicks > 0) { this.clicks--; return true; } return false; }
}
