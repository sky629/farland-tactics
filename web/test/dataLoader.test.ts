import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError, DataLoader, validateRoster } from '../src/data/loader';
import type { Tables } from '../src/data/types';

const race = (name: string) => ({ name, exp_value: 10, hp: 24, hp_up: 3, mp: 24, mp_up: 3, str: 18, str_up: 5, def: 14, def_up: 4, wis: 22, wis_up: 5, mgr: 12, mgr_up: 5, agi: 18, agi_up: 4, elem0: 0, elem1: 0, elem2: 0, size: 3, climb_max: 4, drop_max: 4, cost_land0: 99, cost_land1: 5, cost_land2: 5, cost_land3: 6, cost_land4: 7, cost_land5: 7, cost_land6: 8, cost_land7: 5, spell0: 0, spell1: 0, spell2: 0, spell3: 0 });
const item = (name: string) => ({ name, price: 0, hp_heal: 0, mp_heal: 0, atk: 0, def: 0, wis: 0, mgr: 0, agi: 0, elem0: 0, elem1: 0, elem2: 0, range_min: 1, range_max: 1, slot: 0, use_effect: 0, weapon_type: 0, status_code: 0, race_mask: 0 });
const magic = (name: string) => ({ name, learn_level: 1, mp_cost: 6, elem0: 5, elem1: 0, elem2: 0, range_min: 2, range_max: 6, effect: 'BURST', effect_no: 1, target: 0, shape: 1, learn_mask: 1, short: '' });
const tables: Tables = { race: [race('a'), race('b')], item: [item('none'), item('sword')], magic: [magic('x')] };
const rec = { unit_id: 1, race: 0, level: 2, dir: 2, c: 3, r: 4, status: 0, side: 0, weapon: 1, armor: 0, drop_item: 0, drop_gold: 0 };

function mockFetch(files: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = files[url];
    return body === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('validateRoster', () => {
  it('accepts a record inside every range', () => {
    expect(() => validateRoster([rec], tables, 'r')).not.toThrow();
  });
  it('rejects race, item, level and side out of range with the field name', () => {
    expect(() => validateRoster([{ ...rec, race: 2 }], tables, 'r')).toThrow(/unit 0 race 2/);
    expect(() => validateRoster([{ ...rec, weapon: 9 }], tables, 'r')).toThrow(/weapon 9/);
    expect(() => validateRoster([{ ...rec, level: 0 }], tables, 'r')).toThrow(/level 0/);
    expect(() => validateRoster([{ ...rec, side: 8 }], tables, 'r')).toThrow(DataError);
  });
});

describe('DataLoader', () => {
  it('loads and caches the three tables', async () => {
    mockFetch({ 'assets/data/race.json': tables.race, 'assets/data/item.json': tables.item, 'assets/data/magic.json': tables.magic });
    const loader = new DataLoader();
    const t = await loader.tables();
    expect(t.race[1]!.name).toBe('b');
    await loader.tables();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('reports a missing roster file as DataError with the path', async () => {
    mockFetch({ 'assets/data/race.json': tables.race, 'assets/data/item.json': tables.item, 'assets/data/magic.json': tables.magic });
    await expect(new DataLoader().roster(49)).rejects.toMatchObject({ name: 'DataError', file: 'assets/data/roster/stage049.json' });
  });
  it('rejects a table with the wrong record shape', async () => {
    mockFetch({ 'assets/data/race.json': [{ name: 'x' }], 'assets/data/item.json': tables.item, 'assets/data/magic.json': tables.magic });
    await expect(new DataLoader().tables()).rejects.toThrow(/race.json: record 0 missing "hp"/);
  });
  it('loads the battle catalog and checks its fields', async () => {
    mockFetch({ 'assets/data/battles.json': [{ event: 1, label: 'outfield', map: 'stage49', roster: 49, episode: '첫업무', objective: '!', heal: true }] });
    expect((await new DataLoader().battles())[0]!.roster).toBe(49);
    mockFetch({ 'assets/data/battles.json': [{ event: 1 }] });
    await expect(new DataLoader().battles()).rejects.toThrow(/battles.json: entry 0 missing "map"/);
  });
});
