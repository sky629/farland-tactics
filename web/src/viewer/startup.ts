import type { AssetIndex } from '../assets/types';

export const DEFAULT_MAP = 'stage02';
export const DEFAULT_SPRITE = 'char_01a';

export interface StartupDeps {
  index: () => Promise<AssetIndex>;
  populate: (index: AssetIndex, defaults: { map?: string; sprite?: string }) => void;
  loadMap: (name: string) => Promise<void>;
  loadApd: (name: string) => Promise<void>;
  startLoop: () => void;
  onError: (e: unknown) => void;
}

/** The preferred asset when the index has it, else the first one, else nothing. */
export function pickDefault(list: string[], preferred: string): string | undefined {
  return list.includes(preferred) ? preferred : list[0];
}

/** Start the render loop first so the viewer keeps working when an asset fails to load; load map and sprite independently. */
export async function startViewer(d: StartupDeps): Promise<void> {
  d.startLoop();
  let index: AssetIndex;
  try { index = await d.index(); } catch (e) { d.onError(e); return; }
  const map = pickDefault(index.maps, DEFAULT_MAP);
  const sprite = pickDefault(index.sprites, DEFAULT_SPRITE);
  d.populate(index, { map, sprite });
  const results = await Promise.allSettled([
    map ? d.loadMap(map) : Promise.resolve(),
    sprite ? d.loadApd(sprite) : Promise.resolve(),
  ]);
  for (const r of results) if (r.status === 'rejected') d.onError(r.reason);
}
