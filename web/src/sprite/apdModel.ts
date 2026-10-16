import type { IndexedImage } from '../assets/png';
import type { ApdData } from '../assets/types';
import { compileAll, type AnimScriptError, type Frame, type Timeline } from './animScript';

export class ApdDataError extends Error {
  override name = 'ApdDataError';
}

export interface DrawCommand { sheet: number; key: number; sx: number; sy: number; w: number; h: number; dx: number; dy: number; flipH: boolean; flipV: boolean }
export interface Bounds { left: number; top: number; right: number; bottom: number }

const LEGACY_KEY = 255;   // FUN_00428620: APD version < 2 ignores the per-image key byte

export class ApdModel {
  readonly keys: number[];
  readonly timelines: Map<string, Timeline>;
  readonly errors: AnimScriptError[];

  constructor(readonly name: string, readonly data: ApdData, readonly sheets: IndexedImage[]) {
    if (sheets.length !== data.sheets.length) {
      throw new ApdDataError(`${name}: expected ${data.sheets.length} sheet images, got ${sheets.length}`);
    }
    data.images.forEach((im, i) => {
      const sh = sheets[im.sheet];
      if (!sh) throw new ApdDataError(`${name}: image ${i} sheet ${im.sheet} out of range`);
      if (im.x < 0 || im.y < 0 || im.x + im.w > sh.width || im.y + im.h > sh.height) {
        throw new ApdDataError(`${name}: image ${i} (${im.x},${im.y} ${im.w}×${im.h}) outside sheet ${im.sheet} (${sh.width}×${sh.height})`);
      }
    });
    data.patterns.forEach((p, i) => {
      for (const idx of p.images) if (idx >= data.images.length) throw new ApdDataError(`${name}: pattern ${i}: image ${idx} out of range`);
    });
    this.keys = data.images.map((im) => (data.version < 2 ? LEGACY_KEY : im.key));
    ({ timelines: this.timelines, errors: this.errors } = compileAll(data));
  }

  anim(animName: string): Timeline | undefined {
    return this.timelines.get(animName.toUpperCase());
  }

  animNames(): string[] {
    return this.data.anims.map((a) => a.name);
  }

  /** Which color keys each sheet needs bitmaps for. */
  keysBySheet(): Map<number, Set<number>> {
    const out = new Map<number, Set<number>>();
    this.data.images.forEach((im, i) => {
      if (!out.has(im.sheet)) out.set(im.sheet, new Set());
      out.get(im.sheet)!.add(this.keys[i]!);
    });
    return out;
  }

  /** Draw commands for one frame, relative to the sprite origin (FUN_0042a610 + FUN_00428620 offsets).
   *  `mirrorH` is the sprite's own flip flag (FUN_00429a50 flag 0x10, e.g. a unit facing east/west); it XORs with the frame's "H". */
  commands(frame: Frame, mirrorH = false): DrawCommand[] {
    const pattern = this.data.patterns[frame.pattern];
    if (!pattern) throw new ApdDataError(`${this.name}: pattern ${frame.pattern} out of range`);
    const flipH = frame.flipH !== mirrorH;
    return pattern.images.map((idx) => {
      const im = this.data.images[idx]!;
      return {
        sheet: im.sheet, key: this.keys[idx]!, sx: im.x, sy: im.y, w: im.w, h: im.h,
        dx: flipH ? -(im.ox + im.w) : im.ox,
        dy: (frame.flipV ? -(im.oy + im.h) : im.oy) - pattern.yOffset,
        flipH, flipV: frame.flipV,
      };
    });
  }

  bounds(frame: Frame, mirrorH = false): Bounds {
    const b = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const c of this.commands(frame, mirrorH)) {
      b.left = Math.min(b.left, c.dx); b.top = Math.min(b.top, c.dy);
      b.right = Math.max(b.right, c.dx + c.w); b.bottom = Math.max(b.bottom, c.dy + c.h);
    }
    return b;
  }
}
