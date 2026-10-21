import type { AssetLoader } from '../assets/loader';
import type { SpriteProvider } from '../field/presenter';
import type { Renderer } from '../render/renderer';
import { ApdModel } from '../sprite/apdModel';

/** Loads APDs on demand; returns null until a sprite file is ready or when it does not exist. */
export class SpriteCache implements SpriteProvider {
  private readonly models = new Map<string, ApdModel | null>();
  private readonly pending = new Set<string>();
  constructor(private readonly loader: AssetLoader, private readonly renderer: Renderer, private readonly known: Set<string>, private readonly onError: (e: unknown) => void) {}
  /** APDs requested and not yet ready (or failed). */
  get inflight(): number { return this.pending.size; }
  apd(name: string): ApdModel | null {
    if (this.models.has(name)) return this.models.get(name)!;
    if (!this.known.has(name)) { this.models.set(name, null); return null; }
    if (!this.pending.has(name)) {
      this.pending.add(name);
      void (async () => {
        try {
          const data = await this.loader.apd(name);
          const sheets = await Promise.all(data.sheets.map((s) => this.loader.image('sprite', s)));
          const model = new ApdModel(name, data, sheets);
          await this.renderer.prepareApd(model);
          this.models.set(name, model);
        } catch (e) { this.models.set(name, null); this.onError(e); }
        finally { this.pending.delete(name); }
      })();
    }
    return null;
  }
}

