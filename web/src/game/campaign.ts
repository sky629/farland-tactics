import { emptyInventory, type Inventory } from '../battle/inventory';
import { MAX_SLOTS, PARTY_SLOTS, type Unit } from '../battle/unit';

export const FLAG_COUNT = 24;          // u16[24] in the save header (file_formats.md §6); the scripts use 0..4 and 10
export const TOWN_FLAG_COUNT = 16;
export const BATTLE_TARGET_ID = 24;

/** Everything the story carries between scripts, battles and towns (story_flow.md §2, event_script_format.md §5). */
export interface Campaign {
  units: (Unit | null)[];
  inventory: Inventory;
  flags: number[];
  townFlags: number[];
  stage: number;
  turn: number;
  episode: string;
  message: string;
  speakerName: string;
  townSet: 1 | 2 | 3;
  townExtra: boolean;
  lastSprite: string | null;
  battleTarget: number | null;   // slot of the unit scripts address as id 24
  actor: number | null;          // slot of the acting unit during battle hooks
  bgm: number;                   // current MUSIC number, −1 none (saved in the header)
}

/** FUN_004239b0 new game: empty units, 200 gold, town turn. */
export function newCampaign(): Campaign {
  const inventory = emptyInventory();
  inventory.gold = 200;
  return {
    units: new Array<Unit | null>(MAX_SLOTS).fill(null), inventory, flags: new Array<number>(FLAG_COUNT).fill(0), townFlags: new Array<number>(TOWN_FLAG_COUNT).fill(0),
    stage: 0, turn: -1, episode: '', message: '', speakerName: '', townSet: 1, townExtra: false, lastSprite: null, battleTarget: null, actor: null, bgm: -1,
  };
}

/** FUN_0040a590 / FUN_0041f5f0(2, id): id 24 is the battle target; id 0 never matches. */
export function findUnit(c: Campaign, id: number): Unit | null {
  if (id === 0) return null;
  if (id === BATTLE_TARGET_ID) return c.battleTarget === null ? null : c.units[c.battleTarget] ?? null;
  return c.units.find((u) => u !== null && u.id === id) ?? null;
}

const freeSlot = (c: Campaign): number => { for (let s = PARTY_SLOTS; s < MAX_SLOTS; s++) if (!c.units[s]) return s; return -1; };

/** LOAD_SPRITE / SPRITE_REUSE / ATTACH_SPRITE: an object unit (side 1) whose body is a named APD. */
export function createScriptUnit(c: Campaign, id: number, race: number, col: number, row: number, apd: string, layer: number): Unit | null {
  const slot = freeSlot(c);
  if (slot < 0) return null;
  const u: Unit = {
    slot, id, race, level: 1, dir: 0, c: col, r: row, status: 0, side: 1, weapon: 0, armor: 0, acc: [0, 0], dropItem: 0, dropGold: 0, bag: [0, 0, 0, 0],
    hpMax: 0, hp: 0, mpMax: 0, mp: 0, exp: 0, str: 0, def: 0, wis: 0, mgr: 0, agi: 0, spells: [], buff: { str: 0, def: 0, wis: 0, mgr: 0, agi: 0 }, elem: [0, 0, 0],
    moved: true, acted: true, special: false, statusCounter: 0, sprite: { apd, layer, bare: true },
  };
  c.units[slot] = u;
  return u;
}

/** EXT REMOVE_SCRIPT_UNITS: slots 10.. whose side is 1. */
export function removeScriptUnits(c: Campaign): void {
  for (let s = PARTY_SLOTS; s < MAX_SLOTS; s++) if (c.units[s]?.side === 1) c.units[s] = null;
}

/** EXT REMOVE_DEAD: generic units (id 8, 24, > 30) in slots 10.. with 0 HP or a status other than dead. */
export function removeDead(c: Campaign): void {
  for (let s = PARTY_SLOTS; s < MAX_SLOTS; s++) {
    const u = c.units[s];
    if (u && (u.id === 8 || u.id === 24 || u.id > 30) && (u.hp === 0 || u.status !== 1)) c.units[s] = null;
  }
}
