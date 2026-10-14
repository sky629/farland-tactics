import type { IndexedImage } from '../assets/png';

/** Expand palette indices to RGBA. Pixels whose index equals `key` get alpha 0; everything else is opaque. */
export function indexedToRgba(image: IndexedImage, key: number | null): Uint8ClampedArray<ArrayBuffer> {
  const { indices, palette } = image;
  const out = new Uint8ClampedArray(indices.length * 4);
  for (let i = 0, o = 0; i < indices.length; i++, o += 4) {
    const idx = indices[i]!;
    const p = idx * 3;
    out[o] = palette[p]!; out[o + 1] = palette[p + 1]!; out[o + 2] = palette[p + 2]!;
    out[o + 3] = idx === key ? 0 : 255;
  }
  return out;
}

const NO_KEY = -1;

/** One indexed image, converted lazily to an ImageBitmap per color key. Browser only (ImageData, createImageBitmap). */
export class IndexedBitmaps {
  private readonly cache = new Map<number, ImageBitmap>();

  constructor(readonly image: IndexedImage) {}

  async prepare(key: number | null): Promise<void> {
    const k = key ?? NO_KEY;
    if (this.cache.has(k)) return;
    const data = new ImageData(indexedToRgba(this.image, key), this.image.width, this.image.height);
    this.cache.set(k, await createImageBitmap(data));
  }

  get(key: number | null): ImageBitmap {
    const bmp = this.cache.get(key ?? NO_KEY);
    if (!bmp) throw new Error(`bitmap for key ${key} not prepared`);
    return bmp;
  }
}
