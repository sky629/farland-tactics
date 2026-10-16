import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scenes } from '../src/visual/scenes';
import { VisualPlayer } from '../src/visual/player';
import type { TextLine, VisualImages } from '../src/visual/timeline';
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
  /** Fake images with the real PNG sizes of the scene's slots: the player's size-based decisions (source pans) stay real. */
  function sceneImages(sceneId: number): VisualImages {
    const sizes = new Map<number, [number, number]>();
    for (const r of list) if (r.scene === sceneId) sizes.set(r.slot, pngSize(r.name));
    return { get: (slot) => { const s = sizes.get(slot); return s ? { image: {} as CanvasImageSource, w: s[0], h: s[1] } : null; } };
  }
  function trace(sceneId: number, untilMs: number, stepMs = 100): { starts: number[]; frames: { t: number; pieces: number; visible: number; texts: number; fade: number | null }[]; doneAt: number | null } {
    const staff: TextLine[] = Array.from({ length: 60 }, (_, i) => (i % 4 === 3 ? { space: 12 } : { text: `line ${i}`, size: 24, font: 'mincho' as const, bold: true, gap: 6 }));
    const p = new VisualPlayer(); p.start(scenes[sceneId]!, 0, sceneImages(sceneId), 0, staff);
    const starts = [0]; const frames: { t: number; pieces: number; visible: number; texts: number; fade: number | null }[] = []; let doneAt: number | null = null;
    for (let t = 0; t <= untilMs; t += stepMs) {
      const f = p.update(t);
      if (p.part >= starts.length) starts.push(t);
      frames.push({ t, pieces: f.backdrop.length, visible: f.backdrop.filter((b) => (b.alpha ?? 1) >= 0.5).length, texts: f.texts.length, fade: f.fade?.alpha ?? null });
      if (f.done) { doneAt = t; break; }
    }
    return { starts, frames, doneAt };
  }
  it('the opening parts start when the table says, within the fade of the part before, and the whole movie ends after the last entry', () => {
    const { starts, doneAt } = trace(0, 200000);
    expect(starts).toHaveLength(18);
    for (let k = 1; k < 18; k++) {
      expect(starts[k]!, `part ${k} start`).toBeGreaterThanOrEqual(OPENING_PART_END_MS[k - 1]!);
      expect(starts[k]!, `part ${k} start`).toBeLessThanOrEqual(OPENING_PART_END_MS[k - 1]! + 16 * 30 + 200);
    }
    expect(doneAt).not.toBeNull();
    expect(doneAt!).toBeGreaterThan(OPENING_PART_END_MS[16]!);
  });
  it('the opening shows a picture in every part (the logo first)', () => {
    const { frames } = trace(0, 140000, 500);
    const at = (t: number) => frames.find((f) => f.t >= t)!;
    expect(at(3000).pieces).toBeGreaterThan(0);                                 // part 0: VOP01
    expect(at(15000).pieces).toBeGreaterThanOrEqual(4);                         // part 1: four layers
    expect(at(60000).pieces).toBeGreaterThan(0);                                // part 5
    expect(at(130000).pieces).toBeGreaterThan(0);                               // part 16 panorama
  });
  it('ending 1 shows the seven credit pictures on the table (33 s + 5, 25, …, 125 s; 17 s each) and ends on the closing pictures', () => {
    const { frames, doneAt } = trace(12, 210000, 500);
    const at = (t: number) => frames.find((f) => f.t >= t)!;
    for (const k of [0, 1, 2, 3, 4, 5, 6]) {
      const start = 33000 + (5 + 20 * k) * 1000;
      expect(at(start + 2000).visible, `picture ${k} shown`).toBe(1);
      expect(at(start + 18500).visible, `picture ${k} gone`).toBe(0);
    }
    expect(at(185000).visible).toBe(2);
    for (const t of [60000, 100000, 150000]) expect(at(t).texts, `staff roll at ${t}`).toBeGreaterThan(0);
    expect(at(30000).texts).toBe(0);
    expect(doneAt).toBe(200000);
  });
  it('ending 2 plays its six parts on the scene clock', () => {
    const { starts, doneAt } = trace(13, 70000);
    expect(starts.map((s) => Math.round(s / 1000))).toEqual([0, 10, 23, 29, 45, 53]);
    expect(doneAt).toBeGreaterThanOrEqual(60000);
  });
  it('every sprite a scene plays has its APD and anim exported', () => {
    for (const def of Object.values(scenes)) for (const c of def.parts.flat()) {
      if (c.op !== 'sprite') continue;
      const path = join(ASSETS, `sprite/${c.apd}.json`);
      expect(existsSync(path), `${c.apd}.json`).toBe(true);
      const anims = (JSON.parse(readFileSync(path, 'utf-8')) as { anims: { name: string }[] }).anims.map((a) => a.name.toUpperCase());
      expect(anims, `${c.apd} ${c.anim}`).toContain(c.anim.toUpperCase());
    }
    expect(scenes[0]!.parts.flat().filter((c) => c.op === 'sprite')).toHaveLength(11);   // parts 5 (2), 7 (1), 9 (2), 12 (4), 14 (2)
  });
  it('every PLAY_VISUAL number the scripts use resolves to a transcribed scene', () => {
    for (const n of SCRIPT_USES) {
      const d = dispatch(n);
      expect(d, `n ${n}`).not.toBeNull();
      expect(scenes[d!.scene], `scene ${d!.scene}`).toBeDefined();
    }
  });
});
