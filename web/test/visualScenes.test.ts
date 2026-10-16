import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scenes } from '../src/visual/scenes';
import { OPENING_PART_END_MS, dispatch, type Cmd } from '../src/visual/timeline';

const ASSETS = join(__dirname, '../public/assets');
const list = JSON.parse(readFileSync(join(ASSETS, 'data/visual.json'), 'utf-8')) as { scene: number; step: number; slot: number; name: string }[];
const index = JSON.parse(readFileSync(join(ASSETS, 'index.json'), 'utf-8')) as { bmp: string[] };
const SCRIPT_USES = [0, 21, 23, 24, 26, 27, 29, 30, 31, 32, 33];
const TRANSCRIBED = [0, 1, 3, 4, 6, 7, 9, 10, 11, 12, 13];

const slotsOf = (c: Cmd): number[] => (c.op === 'show' ? [c.slot] : c.op === 'anim' ? c.frames.map((f) => f.slot) : c.op === 'deadline' ? c.outro.flatMap(slotsOf) : []);
const pngSize = (name: string): [number, number] => { const b = readFileSync(join(ASSETS, `bmp/${name}.png`)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

describe('visual scenes (corpus)', () => {
  it.each(TRANSCRIBED)('scene %i is transcribed and ends with end', (id) => {
    const def = scenes[id];
    expect(def, `scene ${id}`).toBeDefined();
    expect(def!.id).toBe(id);
    const last = def!.parts.at(-1)!;
    const tail = last.at(-1)!;
    expect(tail.op === 'end' || (last[0]!.op === 'deadline' && last[0]!.outro.at(-1)!.op === 'end')).toBe(true);
  });
  it('the opening has 18 parts; parts 0..16 end on table 0x449058, part 17 by itself', () => {
    const parts = scenes[0]!.parts;
    expect(parts).toHaveLength(18);
    parts.slice(0, 17).forEach((cmds, k) => { expect(cmds[0]).toMatchObject({ op: 'deadline', ms: OPENING_PART_END_MS[k] }); });
    expect(parts[17]!.some((c) => c.op === 'deadline')).toBe(false);
  });
  it('every slot a scene shows exists in the list for that scene and its bitmap is exported', () => {
    for (const def of Object.values(scenes)) {
      def.parts.forEach((cmds, part) => {
        for (const slot of new Set(cmds.flatMap(slotsOf))) {
          const rec = list.find((r) => r.scene === def.id && r.slot === slot);   // steps group preloads, not parts (scene 13 preloads step 3 in part 0)
          expect(rec, `scene ${def.id} part ${part} slot ${slot}`).toBeDefined();
          expect(index.bmp.includes(rec!.name), rec!.name).toBe(true);
          expect(existsSync(join(ASSETS, `bmp/${rec!.name}.png`))).toBe(true);
        }
      });
    }
  });
  it('animation frames lie inside their sheets', () => {
    for (const def of Object.values(scenes)) {
      for (const c of def.parts.flat()) {
        if (c.op !== 'anim') continue;
        for (const f of c.frames) {
          const rec = list.find((r) => r.scene === def.id && r.slot === f.slot)!;
          const [w, h] = pngSize(rec.name);
          expect(f.sx + f.w <= w && f.sy + f.h <= h, `scene ${def.id} fx ${c.fx} ${rec.name} frame (${f.sx},${f.sy},${f.w},${f.h}) in ${w}x${h}`).toBe(true);
        }
      }
    }
  });
  it('every PLAY_VISUAL number the scripts use resolves to a transcribed scene', () => {
    for (const n of SCRIPT_USES) {
      const d = dispatch(n);
      expect(d, `n ${n}`).not.toBeNull();
      expect(scenes[d!.scene], `scene ${d!.scene}`).toBeDefined();
    }
  });
});
