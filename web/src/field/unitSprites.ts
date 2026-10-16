import type { Dir } from '../battle/grid';
import type { Unit } from '../battle/unit';
import type { ItemData, RaceData } from '../data/types';
import type { Timeline } from '../sprite/animScript';
import type { ApdModel } from '../sprite/apdModel';

/** Sprite layer = the original's +0x48 sort key within a diagonal row. */
export const LAYER = { ground: 1, shadow: 2, object: 3, unit: 4, icon: 5 } as const;

const NO_FLIP_RACES = new Set([0x17, 0x49]);

/** Tokens of the action scene (string pool 0x44a3e0: RUN/JUMP/DOWN/FLY/TAKE_OFF/TOUCH_DOWN/ATTACK%d/DASH_ATTACK*) and WALK live in the "b" file. */
const ACTION_TOKEN = /^(RUN|WALK|ATTACK|DASH_ATTACK|JUMP|DOWN[12]|FLY|TAKE_OFF|TOUCH_DOWN)/;

/** `sprite\char_%02d%c.apd` (format 0x44bf24): the letter is chosen per animation group —
 *  "a" idle and reactions (FUN_0041e350), "b" moves and attacks (action scene, FUN_004155f0), "e" spell casting. */
export function animApd(race: number, token: string): string {
  const letter = token.startsWith('CAST') ? 'e' : ACTION_TOKEN.test(token) ? 'b' : 'a';
  return `char_${String(race).padStart(2, '0')}${letter}`;
}

/** The idle body file. */
export const bodyApd = (race: number): string => animApd(race, 'STAND');

/** FUN_00438330 / FUN_0041e350: "F." for south/east, "B." for west/north; east and west are drawn mirrored (flag 0x10) except races 0x17 and 0x49. */
export function facing(dir: Dir, race: number): { prefix: string; flipH: boolean } {
  return { prefix: dir === 0 || dir === 1 ? 'F.' : 'B.', flipH: (dir === 1 || dir === 2) && !NO_FLIP_RACES.has(race) };
}

/** FUN_0041e350 in battle mode: facing prefix + state token, with the facing's flip. null = no body sprite. */
export function bodyAnim(u: Unit, items: ItemData[]): { name: string; flipH: boolean } | null {
  const { prefix, flipH } = facing(u.dir, u.race);
  const levitateItem = [u.weapon, u.armor, u.acc[0], u.acc[1]].some((i) => items[i]?.status_code === 11);
  const status = u.status === 0 && levitateItem ? 11 : u.status;
  let token: string | null;
  switch (status) {
    case 0: case 6: case 7:
      token = u.moved && u.acted && u.side === 0 ? 'COMPLETE' : 'STAND';
      break;
    case 1: token = u.side === 0 ? 'DEAD' : 'DOWN_DAMAGE'; break;
    case 4: token = 'S/DAMAGE'; break;
    case 5: token = 'A/DAMAGE'; break;
    case 9: token = u.side === 7 ? 'HIDE' : null; break;
    case 11: token = 'LEVITATE'; break;
    default: token = 'DOWN_DAMAGE';
  }
  return token === null ? null : { name: prefix + token, flipH };
}

const SHADOW = ['', 'SMALL', 'MIDDLE', 'LARGE'];

/** system.apd "<size>.M": race.size, +1 while down, −1 while levitating; none when hidden or size ≤ 0. */
export function shadowAnim(u: Unit, race: RaceData): string | null {
  if (u.status === 9) return null;
  let k = race.size;
  if (k === 0) return null;
  if (u.status === 11) k -= 1;
  else if (u.status !== 0 && u.status !== 6 && u.status !== 7) k += 1;
  if (k <= 0) return null;
  return `${SHADOW[k] ?? 'HUGE'}.M`;
}

/** system.apd status icon above the unit (y − 56; the dead marker at y − 16, party only). */
export function iconAnim(u: Unit): { name: string; dy: number } | null {
  switch (u.status) {
    case 1: return u.side === 0 ? { name: 'DEAD', dy: -16 } : null;
    case 2: return { name: 'POISON', dy: -56 };
    case 3: return { name: 'SLEEP', dy: -56 };
    case 6: return { name: 'MUTE', dy: -56 };
    case 7: return { name: 'CHARM', dy: -56 };
    default: return null;
  }
}

/** The original tries "<name>#" first, then "<name>" (FUN_0041e350). */
export function pickTimeline(model: ApdModel, name: string): Timeline | undefined {
  return model.anim(`${name}#`) ?? model.anim(name);
}
