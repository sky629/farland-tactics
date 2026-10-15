import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeIndexedPng } from '../src/assets/png';
import type { ApdData, AssetIndex, MapData } from '../src/assets/types';
import { layerKey, MapModel } from '../src/map/mapModel';
import { compileAll } from '../src/sprite/animScript';
import { ApdModel } from '../src/sprite/apdModel';

const ASSETS = fileURLToPath(new URL('../public/assets/', import.meta.url));
const available = existsSync(join(ASSETS, 'index.json'));
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(ASSETS, rel), 'utf-8')) as T;
const readPng = (rel: string) => { const b = readFileSync(join(ASSETS, rel)); return decodeIndexedPng(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

describe.skipIf(!available)('exported corpus', () => {
  const index = available ? readJson<AssetIndex>('index.json') : { format: 1 as const, maps: [], sprites: [] };

  it('has 76 maps and 312 sprites', () => {
    expect(index.maps).toHaveLength(76);
    expect(index.sprites).toHaveLength(312);
  });

  it('every map builds a MapModel whose cellAt covers exactly its cells', async () => {
    for (const name of index.maps) {
      const data = readJson<MapData>(`map/${name}.json`);
      const layers = await Promise.all(data.layers.map((l) => readPng(`map/${l}.png`)));
      const model = new MapModel(data, layers, null);
      const covered = model.rows.reduce((n, r) => n + r.cells.length, 0);
      expect(covered, name).toBe(data.cells.length);
      expect(new Set(data.cellAt.filter((i) => i >= 0)).size, name).toBe(data.cells.length);
    }
  }, 60_000);

  it('layer color keys follow the top-left rule and are reserved indices', async () => {
    const seen = new Set<string>();
    const keys: Record<number, number> = {};
    for (const name of index.maps) {
      for (const l of readJson<MapData>(`map/${name}.json`).layers) {
        if (seen.has(l) || !existsSync(join(ASSETS, `map/${l}.png`))) continue;
        seen.add(l);
        const k = layerKey(await readPng(`map/${l}.png`));
        expect(k <= 9 || k >= 246, l).toBe(true);
        keys[k] = (keys[k] ?? 0) + 1;
      }
    }
    console.info('layer keys:', keys);          // expected to be dominated by 249 with 250/252/253/255
    expect(seen.size).toBeGreaterThan(90);
  }, 60_000);

  it('compiles every animation; reports @ references to earlier anims', () => {
    const bad: string[] = [];
    let earlyRefs = 0;
    for (const name of index.sprites) {
      const apd = readJson<ApdData>(`sprite/${name}.json`);
      const { errors } = compileAll(apd);
      for (const e of errors) bad.push(`${name}/${e.anim}`);
      apd.anims.forEach((a, i) => {
        for (const m of a.script.matchAll(/@([^,\s]+)/g)) {
          const target = apd.anims.findIndex((x) => x.name.toUpperCase() === m[1]!.toUpperCase());
          if (target >= 0 && target <= i) earlyRefs++;
        }
      });
    }
    console.info('@ references to earlier anims:', earlyRefs);
    expect(bad).toEqual([]);
  });

  it('every sprite with all sheets present builds an ApdModel', async () => {
    let built = 0, skipped = 0;
    for (const name of index.sprites) {
      const apd = readJson<ApdData>(`sprite/${name}.json`);
      if (!apd.sheets.every((s) => existsSync(join(ASSETS, `sprite/${s}.png`)))) { skipped++; continue; }
      const sheets = await Promise.all(apd.sheets.map((s) => readPng(`sprite/${s}.png`)));
      new ApdModel(name, apd, sheets);
      built++;
    }
    console.info(`apd models built: ${built}, skipped (missing sheet): ${skipped}`);
    expect(skipped).toBeLessThanOrEqual(5);
    expect(built + skipped).toBe(312);
  }, 120_000);
});
