import { canEquip, equip, unequip, type EquipSlot } from '../battle/equipment';
import { countOf, type Inventory } from '../battle/inventory';
import { buy } from '../battle/shop';
import type { Unit } from '../battle/unit';
import type { Tables } from '../data/types';
import type { SaveSummary } from '../save/format';
import type { ModalKind, Where } from '../script/host';
import { itemName, unitName } from './panel';

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
export interface LoadHandlers { onPick(slot: number): void; onExport(slot: number): void; onImport(file: File): void }

const two = (n: number) => String(n).padStart(2, '0');
const slotLabel = (i: number, s: SaveSummary | null): string => `${two(i)} ${s ? s.title || '(제목 없음)' : '비어 있음'}`;
const dateText = (d: Date | null): string => (d ? `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}` : '');
interface ResultPayload { gold: number; param: number; levelUps: { slot: number; from: number; to: number }[] }

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
      case 'ask': { const row = this.el('div', 'row'); row.append(this.button('예', close(1)), this.button('아니오', close(0))); box.append(this.el('div', 'text', String(payload)), row); break; }
      case 'save': this.slotPicker(ctx.saves ?? [], (slot) => { this.result = slot; box.hidden = true; }, close(-1)); break;
      case 'result': {
        const r = payload as ResultPayload;
        box.append(this.el('div', 'title', '전투 결과'), this.el('div', 'text', `${r.gold} Gold`));
        for (const l of r.levelUps) { const u = ctx.party[l.slot]; box.append(this.el('div', 'text', `${u ? unitName(u, ctx.tables) : `유닛 ${l.slot}`}: 레벨 ${l.from} → ${l.to}`)); }
        box.append(this.button('닫기', close(0)));
        break;
      }
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
    box.append(this.el('div', 'title', '상점'), gold, who, list, note, this.button('닫기', done));
  }

  /** Town right click (spec §9): every party member with level, HP/MP, equipment and bag; 장착/해제 go through equipment.ts. */
  openParty(ctx: ModalContext): void {
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
        });
        row.append(eq, bag);
        box.appendChild(row);
      }
      box.appendChild(this.button('닫기', () => { box.hidden = true; }));
    };
    render();
    box.hidden = false;
  }

  /** SAVE_GAME with no slot (dialog 0x8F): 32 rows; a used slot asks before it is overwritten. */
  private slotPicker(saves: (SaveSummary | null)[], pick: (slot: number) => void, cancel: () => void): void {
    const box = this.modal;
    const confirm = this.el('div', 'row');
    const list = this.el('div', 'slots');
    for (let i = 0; i < 32; i++) {
      const s = saves[i] ?? null;
      list.append(this.button(slotLabel(i, s), () => {
        if (!s) { pick(i); return; }
        confirm.replaceChildren(this.el('span', 'text', `${two(i)} 슬롯을 덮어쓸까?`), this.button('덮어쓰기', () => pick(i)), this.button('아니오', () => confirm.replaceChildren()));
      }), this.slotInfo(s));
    }
    box.append(this.el('div', 'title', '저장할 슬롯'), list, confirm, this.button('취소', cancel));
  }
  private slotInfo(s: SaveSummary | null): HTMLElement {
    const info = this.el('div', 'info');
    if (s) info.append(this.el('span', 'date', dateText(s.date)), this.el('span', 'gold', `${s.gold} Gold`), this.el('span', 'stage', `스테이지 ${s.stage}`));
    return info;
  }

  /** Title screen: pick a used slot to load, export any used slot as save%02d.dat, import a .dat into the first free slot. */
  openLoad(saves: (SaveSummary | null)[], h: LoadHandlers): void {
    this.result = null;
    const box = this.modal;
    box.replaceChildren(this.el('div', 'title', '불러오기'));
    const list = this.el('div', 'slots');
    for (let i = 0; i < 32; i++) {
      const s = saves[i] ?? null;
      const b = this.button(slotLabel(i, s), () => { box.hidden = true; h.onPick(i); });
      if (!s) (b as HTMLButtonElement).disabled = true;
      const info = this.slotInfo(s);
      if (s) info.appendChild(this.button('내보내기', () => h.onExport(i)));
      list.append(b, info);
    }
    const file = this.doc.createElement('input') as HTMLInputElement;
    file.type = 'file'; file.accept = '.dat'; file.className = 'file';
    const row = this.el('div', 'row');
    row.append(file, this.button('가져오기', () => { const f = file.files?.[0]; if (f) h.onImport(f); }));
    box.append(list, row, this.button('닫기', () => { box.hidden = true; }));
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
