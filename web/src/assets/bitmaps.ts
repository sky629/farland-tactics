/** bmp/*.png as drawable images, loaded on demand; unknown or failed names resolve to null (black screen). */
export class BitmapCache {
  private readonly cache = new Map<string, CanvasImageSource | null>();
  private readonly pending = new Map<string, Promise<CanvasImageSource | null>>();

  constructor(private readonly base: string, private readonly known: Set<string>, private readonly onError: (name: string) => void = () => {}) {}
  /** Images requested and not yet loaded (or failed). */
  get inflight(): number { return this.pending.size; }

  /** Starts loading on first use; null until the image is ready or when it does not exist. */
  get(name: string): CanvasImageSource | null {
    const key = name.toLowerCase();
    if (!this.cache.has(key) && !this.pending.has(key)) void this.load(key);
    return this.cache.get(key) ?? null;
  }

  load(name: string): Promise<CanvasImageSource | null> {
    const key = name.toLowerCase();
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key) ?? null);
    let p = this.pending.get(key);
    if (!p) {
      p = (this.known.has(key)
        ? new Promise<CanvasImageSource | null>((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => { this.onError(key); resolve(null); }; img.src = `${this.base}/bmp/${key}.png`; })
        : Promise.resolve<CanvasImageSource | null>(null)
      ).then((img) => { this.cache.set(key, img); this.pending.delete(key); return img; });
      this.pending.set(key, p);
    }
    return p;
  }
}
