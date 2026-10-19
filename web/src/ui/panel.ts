import { isTreasure } from '../battle/unit';
import { usableItems } from '../battle/inventory';
import { hasMoveTarget } from '../battle/moveRange';
import type { Hit } from '../battle/resolve';
import type { BattleEvent, BattleState, Command } from '../battle/types';
import type { Unit } from '../battle/unit';
import type { BattleEntry, ItemData, Tables } from '../data/types';

export interface MenuEnabled { move: boolean; attack: boolean; magic: boolean; item: boolean; wait: boolean; endTurn: boolean }

/** Which buttons the rules would accept right now (spec §10.2). */
export function menuEnabled(state: BattleState, items: ItemData[] = []): MenuEnabled {
  const none = { move: false, attack: false, magic: false, item: false, wait: false, endTurn: false };
  if (state.phase.kind !== 'player') return none;
  const sel = state.phase.sel;
  if (sel.mode !== 'menu') return { ...none, endTurn: true };
  const u = state.units[sel.slot];
  if (!u) return { ...none, endTurn: true };
  return { move: !u.moved && hasMoveTarget(sel.range, state.units, u), attack: !u.acted, magic: !u.acted && u.spells.length > 0 && u.status !== 6, item: !u.acted && usableItems(state.inventory, items).length > 0, wait: true, endTurn: true };
}

/** event_script_format.md §6 speaker names for the named characters (id 1..29). */
export const SPEAKER_NAMES: Record<number, string> = {
  1: '카린', 2: '알', 3: '아리스', 4: '사라', 5: '라딧슈', 6: '소피아', 7: '루루', 9: '???', 10: 'T.T.', 11: '손', 12: '마크도갈', 13: '가스톤',
  15: '마스터', 16: '근육 아저씨', 17: '숍언니', 18: '화난 카린', 19: '곤란한 아리스', 20: '카트린느', 21: '베히모스', 22: '듀마', 23: '존', 24: '돗펠원화',
  25: '앨비스', 26: '손.바이스', 27: '히드라', 28: '코카트리스', 29: '길드 마스터',
};
export const STATUS_NAMES: Record<number, string> = { 0: '정상', 1: '사망', 2: '독', 3: '수면', 4: '석화', 5: '동결', 6: '침묵', 7: '매혹', 8: '홀드', 9: '은신', 11: '부유' };

export const itemName = (item: ItemData): string => item.name.replace(/_/g, ' ');

export function unitName(u: Unit, tables: Tables): string {
  return (!isTreasure(u) && u.id !== 8 && u.id < 30 && SPEAKER_NAMES[u.id]) || tables.race[u.race]?.name.replace(/_/g, ' ') || `종족 ${u.race}`;
}

export function describeHit(actor: Unit, hit: Hit, units: (Unit | null)[], tables: Tables): string {
  const target = units[hit.target];
  const head = `${unitName(actor, tables)} → ${target ? unitName(target, tables) : `슬롯 ${hit.target}`}: `;
  switch (hit.kind) {
    case 'damage': return `${head}${hit.value}${hit.crit ? ' (크리티컬)' : ''}${hit.statusAfter === 1 ? ' 쓰러짐' : ''}`;
    case 'miss': return `${head}빗나감`;
    case 'heal': return `${head}회복 ${hit.value}`;
    case 'cure': return `${head}${hit.popup === 'well' ? '상태 회복' : `소생 ${hit.value}`}`;
    case 'status': return `${head}${STATUS_NAMES[hit.statusAfter] ?? `상태 ${hit.statusAfter}`}`;
    case 'buff': return `${head}${hit.popup || '효과'}`;
    default: return `${head}효과 없음`;
  }
}

export interface PanelHandlers { onStart(entry: BattleEntry, seed: number): void; onCommand(cmd: Command): void }

const $ = <T extends HTMLElement>(doc: Document, id: string): T => {
  const el = doc.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

type PanelId = 'battle' | 'seed' | 'start' | 'turn' | 'unit' | 'move' | 'attack' | 'magic' | 'wait' | 'endTurn' | 'spells' | 'log' | 'result' | 'error' | 'objective' | 'item' | 'items' | 'inventory';

/** DOM panel of game.html. Only DOM glue lives here; decisions are in menuEnabled/describeHit. */
export class Panel {
  private readonly el: Record<PanelId, HTMLElement>;
  private entries: BattleEntry[] = [];
  private lines: string[] = [];
  private spellsKey = '';
  private spellButtons: { magic: number; button: HTMLButtonElement }[] = [];
  private itemsKey = '';
  private itemButtons: { id: number; button: HTMLButtonElement }[] = [];

  constructor(private readonly doc: Document, private readonly handlers: PanelHandlers, private readonly tables: Tables) {
    const ids: PanelId[] = ['battle', 'seed', 'start', 'turn', 'unit', 'move', 'attack', 'magic', 'wait', 'endTurn', 'spells', 'log', 'result', 'error', 'objective', 'item', 'items', 'inventory'];
    this.el = Object.fromEntries(ids.map((id) => [id, $(doc, id)])) as Record<PanelId, HTMLElement>;
    this.el.start.addEventListener('click', () => {
      const entry = this.entries[Number((this.el.battle as HTMLSelectElement).value)];
      if (entry) this.handlers.onStart(entry, Number((this.el.seed as HTMLInputElement).value) || Date.now());
    });
    this.el.move.addEventListener('click', () => handlers.onCommand({ type: 'beginMove' }));
    this.el.attack.addEventListener('click', () => handlers.onCommand({ type: 'beginTarget', action: 0 }));
    this.el.wait.addEventListener('click', () => handlers.onCommand({ type: 'wait' }));
    this.el.endTurn.addEventListener('click', () => handlers.onCommand({ type: 'endTurn' }));
    this.el.magic.addEventListener('click', () => { this.el.spells.hidden = !this.el.spells.hidden; });
    this.el.item.addEventListener('click', () => { this.el.items.hidden = !this.el.items.hidden; });
  }

  setBattles(entries: BattleEntry[]): void {
    this.entries = entries;
    const sel = this.el.battle as HTMLSelectElement;
    sel.replaceChildren(...entries.map((e, i) => Object.assign(this.doc.createElement('option'), { value: String(i), textContent: `${String(i + 1).padStart(2, '0')} ${e.episode || e.label} — ${e.objective || '(목표 없음)'}` })));
  }

  /** Refresh turn, menu, spell list and the selected unit's card. */
  update(state: BattleState, hoverUnit: Unit | null): void {
    this.el.objective.textContent = `${state.entry.episode} — ${state.entry.objective}`;
    this.el.turn.textContent = state.phase.kind === 'end' ? `턴 ${state.turn} · ${state.phase.result === 'victory' ? '승리' : '패배'}` : `턴 ${state.turn} · ${state.phase.kind === 'player' ? '아군 페이즈' : '적 페이즈'}`;
    const en = menuEnabled(state, this.tables.item);
    (this.el.move as HTMLButtonElement).disabled = !en.move;
    (this.el.item as HTMLButtonElement).disabled = !en.item;
    (this.el.attack as HTMLButtonElement).disabled = !en.attack;
    (this.el.magic as HTMLButtonElement).disabled = !en.magic;
    (this.el.wait as HTMLButtonElement).disabled = !en.wait;
    (this.el.endTurn as HTMLButtonElement).disabled = !en.endTurn;
    const sel = state.phase.kind === 'player' ? state.phase.sel : null;
    const selected = sel && sel.mode !== 'idle' ? state.units[sel.slot] ?? null : null;
    if (!en.magic) this.el.spells.hidden = true;
    if (!en.item) this.el.items.hidden = true;
    this.renderSpells(selected);
    this.renderItems(state);
    this.renderInventory(state);
    this.renderUnit(hoverUnit ?? selected);
  }

  /** Rebuilt only when the usable list (ids and counts) changes, like the spell buttons. */
  private renderItems(state: BattleState): void {
    const list = usableItems(state.inventory, this.tables.item);
    const key = list.map((s) => `${s.id}:${s.count}`).join(',');
    if (key === this.itemsKey) return;
    this.itemsKey = key;
    this.itemButtons = list.map((s) => {
      const button = this.doc.createElement('button');
      button.textContent = `${itemName(this.tables.item[s.id]!)} ×${s.count}`;
      button.addEventListener('click', () => { this.el.items.hidden = true; this.handlers.onCommand({ type: 'beginTarget', action: 1000 + s.id }); });
      return { id: s.id, button };
    });
    this.el.items.replaceChildren(...this.itemButtons.map((x) => x.button));
  }

  private renderInventory(state: BattleState): void {
    const inv = state.inventory;
    const stacks = inv.items.map((s) => `${itemName(this.tables.item[s.id]!)} ×${s.count}`).join(', ') || '없음';
    const bags = state.units.filter((u): u is Unit => u !== null && u.side === 0).map((u) => `${unitName(u, this.tables)}: ${u.bag.map((id) => (id ? itemName(this.tables.item[id]!) : '-')).join(', ')}`);
    this.el.inventory.textContent = [`골드 ${inv.gold}`, `소모품: ${stacks}`, ...bags].join('\n');
  }

  private who(state: BattleState, slot: number): string { const u = state.units[slot]; return u ? unitName(u, this.tables) : `슬롯 ${slot}`; }

  /** Buttons are rebuilt only when the selected unit's spell list changes: update() runs every frame, and a click needs the same node under the mouse. */
  private renderSpells(u: Unit | null): void {
    const key = u ? `${u.slot}:${u.spells.join(',')}` : '';
    if (key !== this.spellsKey) {
      this.spellsKey = key;
      this.spellButtons = (u?.spells ?? []).map((m) => {
        const magic = this.tables.magic[m]!;
        const button = this.doc.createElement('button');
        button.textContent = `${magic.name} (MP ${Math.abs(magic.mp_cost)}, 사거리 ${magic.range_min}-${magic.range_max})`;
        button.addEventListener('click', () => { this.el.spells.hidden = true; this.handlers.onCommand({ type: 'beginTarget', action: m }); });
        return { magic: m, button };
      });
      this.el.spells.replaceChildren(...this.spellButtons.map((x) => x.button));
    }
    if (u) for (const { magic, button } of this.spellButtons) button.disabled = u.mp < Math.abs(this.tables.magic[magic]!.mp_cost);
  }

  private renderUnit(u: Unit | null): void {
    if (!u) { this.el.unit.textContent = ''; return; }
    const w = this.tables.item[u.weapon]?.name ?? '-', a = this.tables.item[u.armor]?.name ?? '-';
    this.el.unit.textContent = `${unitName(u, this.tables)} (${this.tables.race[u.race]?.name ?? u.race}) Lv${u.level}\nHP ${u.hp}/${u.hpMax}  MP ${u.mp}/${u.mpMax}\n상태 ${STATUS_NAMES[u.status] ?? u.status}  ${u.moved ? '이동완료' : ''} ${u.acted ? '행동완료' : ''}\n무기 ${w}  방어구 ${a}\n공 ${u.str} 방 ${u.def} 지 ${u.wis} 마항 ${u.mgr} 민 ${u.agi}`;
  }

  logEvents(state: BattleState, events: BattleEvent[]): void {
    for (const e of events) {
      if (e.type === 'action') { const actor = state.units[e.slot]; for (const h of e.hits) if (actor) this.log(describeHit(actor, h, state.units, this.tables)); }
      else if (e.type === 'levelUp') this.log(`레벨 업! Lv${e.level}`);
      else if (e.type === 'statusTick' && e.cured) this.log(`상태 회복 (슬롯 ${e.slot})`);
      else if (e.type === 'rejected') this.log(`불가: ${e.reason}`);
      else if (e.type === 'pickup') this.log(e.item !== 0 ? `${this.who(state, e.slot)}: ${itemName(this.tables.item[e.item]!)} 획득` : `${e.gold} Gold 획득`);
      else if (e.type === 'bagFull') this.log(`${this.who(state, e.slot)}: ${itemName(this.tables.item[e.item]!)}을(를) 더 가질 수 없다`);
      else if (e.type === 'revealed') this.log('보물 찾았다!');
      else if (e.type === 'roundStart') this.log(`— 턴 ${e.turn} —`);
    }
  }

  log(line: string): void {
    this.lines.push(line);
    if (this.lines.length > 10) this.lines.shift();
    this.el.log.textContent = this.lines.join('\n');
  }

  showResult(result: 'victory' | 'defeat' | null): void {
    this.el.result.textContent = result === 'victory' ? '승리! 적을 전멸시켰다.' : result === 'defeat' ? '게임 오버… 파티가 전멸했다.' : '';
  }

  showError(message: string): void { this.el.error.textContent = message; }
}
