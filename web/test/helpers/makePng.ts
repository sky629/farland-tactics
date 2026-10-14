import { deflateSync } from 'node:zlib';

/** Build a PNG the way tools/ft2_szdd.bmp8_to_png does (8-bit indexed, filter 0, one IDAT) with optional overrides. */
export function makePng(width: number, height: number, indices: number[], palette: number[], opts: { colorType?: number; filter?: number; idatSplit?: number } = {}): ArrayBuffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length))); return out;
  };
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = opts.colorType ?? 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) { raw[y * (width + 1)] = opts.filter ?? 0; raw.set(indices.slice(y * width, (y + 1) * width), y * (width + 1) + 1); }
  const z = new Uint8Array(deflateSync(raw));
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('PLTE', new Uint8Array(palette))];
  if (opts.idatSplit) parts.push(chunk('IDAT', z.subarray(0, opts.idatSplit)), chunk('IDAT', z.subarray(opts.idatSplit)));
  else parts.push(chunk('IDAT', z));
  parts.push(chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0); const buf = new Uint8Array(total); let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf.buffer;
}

/** 4-color palette used by several tests: black, red, green, magenta. */
export const PAL4 = [0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 0, 255];
