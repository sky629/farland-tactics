import { decodeIndexedPng, type IndexedImage } from './png';
import { assertApdData, assertMapData, type ApdData, type AssetIndex, type MapData } from './types';

export class AssetError extends Error {
  override name = 'AssetError';
  constructor(readonly asset: string, message: string) {
    super(`${asset}: ${message}`);
  }
}

/** Fetches exported assets (tools/ft2_export.py output) relative to `base`. Images are decoded once and cached. */
export class AssetLoader {
  private readonly images = new Map<string, Promise<IndexedImage>>();

  constructor(private readonly base = 'assets') {}

  async index(): Promise<AssetIndex> {
    const path = `${this.base}/index.json`;
    const data = (await this.fetchJson(path)) as Partial<AssetIndex>;
    if (data.format !== 1 || !Array.isArray(data.maps) || !Array.isArray(data.sprites)) throw new AssetError(path, 'not an asset index (format 1)');
    return data as AssetIndex;
  }

  async map(name: string): Promise<MapData> {
    const path = `${this.base}/map/${name}.json`;
    const data = await this.fetchJson(path);
    try { assertMapData(data, name); } catch (e) { throw new AssetError(path, (e as Error).message); }
    return data;
  }

  async apd(name: string): Promise<ApdData> {
    const path = `${this.base}/sprite/${name}.json`;
    const data = await this.fetchJson(path);
    try { assertApdData(data, name); } catch (e) { throw new AssetError(path, (e as Error).message); }
    return data;
  }

  image(kind: 'map' | 'sprite' | 'bmp', name: string): Promise<IndexedImage> {
    const path = `${this.base}/${kind}/${name}.png`;
    let p = this.images.get(path);
    if (!p) {
      p = this.fetchBytes(path).then((buf) => decodeIndexedPng(buf)).catch((e: unknown) => {
        this.images.delete(path);
        throw e instanceof AssetError ? e : new AssetError(path, (e as Error).message);
      });
      this.images.set(path, p);
    }
    return p;
  }

  private async fetchBytes(path: string): Promise<ArrayBuffer> {
    const res = await fetch(path);
    if (!res.ok) throw new AssetError(path, `HTTP ${res.status}`);
    return res.arrayBuffer();
  }

  private async fetchJson(path: string): Promise<unknown> {
    const res = await fetch(path);
    if (!res.ok) throw new AssetError(path, `HTTP ${res.status}`);
    try { return await res.json(); } catch { throw new AssetError(path, 'invalid JSON'); }
  }
}
