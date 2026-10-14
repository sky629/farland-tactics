export interface AssetIndex { format: 1; maps: string[]; sprites: string[] }

export interface MapObject { layer: number; front: number; left: number; top: number; right: number; bottom: number; ox: number; oy: number }
export interface MapCell { h: number; blocked: number; flag2: number; land: number; objs: MapObject[] }
export interface MapData {
  w: number; h: number;
  bg: string | null;
  layers: string[];
  start: [number, number];
  origin: [number, number];
  pixelSize: [number, number];
  cells: MapCell[];
  cellAt: number[];
}

export interface ApdImage { sheet: number; key: number; x: number; y: number; w: number; h: number; ox: number; oy: number }
export interface ApdPattern { yOffset: number; images: number[] }
export interface ApdAnim { name: string; script: string }
export interface ApdData { version: number; sheets: string[]; images: ApdImage[]; patterns: ApdPattern[]; anims: ApdAnim[] }

/** Minimal shape check for JSON that came over the network. Throws TypeError with the failing field. */
export function assertMapData(x: unknown, name: string): asserts x is MapData {
  const o = x as Record<string, unknown>;
  for (const k of ['w', 'h', 'layers', 'start', 'origin', 'pixelSize', 'cells', 'cellAt']) {
    if (!(k in o)) throw new TypeError(`${name}: missing field "${k}"`);
  }
  if (!Array.isArray(o['cellAt'])) throw new TypeError(`${name}: cellAt is not an array`);
}

export function assertApdData(x: unknown, name: string): asserts x is ApdData {
  const o = x as Record<string, unknown>;
  for (const k of ['version', 'sheets', 'images', 'patterns', 'anims']) {
    if (!Array.isArray(o[k]) && k !== 'version') throw new TypeError(`${name}: field "${k}" is not an array`);
  }
}
