/**
 * The headless world of the campaign walk: the exported assets read from disk, a GameCore on a MapStage (a FakeStage whose
 * LOAD_MAP hands the battle the exported map), and the walk's own saves. Shared by campaignWalk.test.ts and walker.test.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../../src/battle/rng';
import type { MapData } from '../../src/assets/types';
import type { RosterUnit, Tables } from '../../src/data/types';
import { GameCore } from '../../src/game/gameCore';
import type { Resources } from '../../src/script/host';
import { loadProgram } from '../../src/script/program';
import { FakeStage } from './stageFixtures';

export const ASSETS = fileURLToPath(new URL('../../public/assets/', import.meta.url));
export const available = existsSync(join(ASSETS, 'data', 'event00.json'));
export const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(ASSETS, rel), 'utf-8')) as T;

/** A FakeStage whose LOAD_MAP hands the battle the exported map (FakeStage itself uses a flat 9×9 stub). */
export class MapStage extends FakeStage {
  override loadMap(n: number): void {
    this.calls.push(['loadMap', n]);
    const p = join(ASSETS, 'map', `stage${String(n).padStart(2, '0')}.json`);
    this.map = n >= 0 && existsSync(p) ? readJson<MapData>(`map/stage${String(n).padStart(2, '0')}.json`) : null;
    this.loaded = true;
    if (n >= 0 && !this.map) this.log('warn', `map stage${n} missing`);
  }
}

export function walkResources(seed = 7): { res: Resources; tables: Tables } {
  const index = readJson<{ events: number[] }>('index.json');
  const programs = new Map(index.events.map((n) => [n, loadProgram(n, readJson(`data/event${String(n).padStart(2, '0')}.json`))]));
  const tables: Tables = { race: readJson('data/race.json'), item: readJson('data/item.json'), magic: readJson('data/magic.json') };
  const res: Resources = {
    program: (n) => programs.get(n) ?? null,
    roster: (n) => { const p = join(ASSETS, 'data', 'roster', `stage${String(n).padStart(3, '0')}.json`); return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf-8')) as RosterUnit[]) : null; },
    tables, rng: Rng.fromSeed(seed),
  };
  return { res, tables };
}

/** A fresh game on a MapStage, plus the BATTLE_START autosave of battle n from the fixtures (the walk wrote them). */
export function newGameCore(): { core: GameCore; stage: MapStage; res: Resources; tables: Tables; saveAt: (n: number) => Uint8Array } {
  const { res, tables } = walkResources();
  const stage = new MapStage();
  const core = new GameCore(res, stage);
  core.newGame();
  const saveAt = (n: number): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/walk/battle-${String(n).padStart(2, '0')}-stage01.bin`, import.meta.url))));
  return { core, stage, res, tables, saveAt };
}
