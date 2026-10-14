export interface IndexedImage { width: number; height: number; indices: Uint8Array; palette: Uint8Array }

export class PngFormatError extends Error {
  override name = 'PngFormatError';
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function inflate(zlibData: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([zlibData]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decode an 8-bit indexed, non-interlaced PNG whose rows all use filter 0 (what tools/ft2_export.py writes). */
export async function decodeIndexedPng(buf: ArrayBuffer): Promise<IndexedImage> {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new PngFormatError('not a PNG (bad signature)');
  const view = new DataView(buf);
  let pos = 8;
  let width = 0, height = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8); height = view.getUint32(pos + 12);
      const bitDepth = data[8], colorType = data[9], interlace = data[12];
      if (colorType !== 3) throw new PngFormatError(`unsupported color type ${colorType} (need 3 = indexed)`);
      if (bitDepth !== 8) throw new PngFormatError(`unsupported bit depth ${bitDepth} (need 8)`);
      if (interlace !== 0) throw new PngFormatError('interlaced PNG is not supported');
    } else if (type === 'PLTE') {
      palette = new Uint8Array(768); palette.set(data.subarray(0, 768));
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }
  if (!width || !height) throw new PngFormatError('missing IHDR');
  if (!palette) throw new PngFormatError('missing PLTE');
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idat) { joined.set(c, o); o += c.length; }
  const raw = await inflate(joined);
  const stride = width + 1;
  if (raw.length < stride * height) throw new PngFormatError(`image data too short (${raw.length} < ${stride * height})`);
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    if (filter !== 0) throw new PngFormatError(`row ${y} uses filter ${filter}; only filter 0 is supported`);
    indices.set(raw.subarray(y * stride + 1, y * stride + 1 + width), y * width);
  }
  return { width, height, indices, palette };
}
