import { describe, expect, it } from 'vitest';
import { HOTSPOTS, hitTest, layerFrame, townLabel, townLayers } from '../src/town/town';
import { prog, res } from './helpers/scriptFixtures';

const all = Array(15).fill(1);

describe('town screen model (story_flow.md §3)', () => {
  it('lists the 15 facilities in table order', () => {
    expect(HOTSPOTS.map((h) => h.label)).toEqual(['outfield', 'inn', 'guild', 'weapon', 'store', 'church', 'cemetery', 'harbor', 'cafe', 'macdogal', 'smith', 'depot', 'lighthouse', 'farm', 'backdoor']);
    expect(HOTSPOTS[8]!.name).toBe('카페「Love&&Peace」');
  });
  it('hitTest picks the first active facility whose click rect holds the point (PtInRect: right/bottom exclusive)', () => {
    expect(hitTest(600, 30, Array(15).fill(0))).toBeNull();
    const only0 = Array(15).fill(0); only0[0] = 1;
    expect(hitTest(600, 30, only0)).toBe(0);
    expect(hitTest(639, 30, all)).toBeNull();                                  // right edge excluded
    expect(hitTest(10, 10, all)).toBeNull();
    expect(hitTest(440, 188, all)).toBe(1);                                    // inn (1) before farm (13) where they overlap
  });
  it('townLayers names the sheet files of a set; the 128×128 extra layer exists only for the night set', () => {
    expect(townLayers(1, false)).toEqual(['town00', 'town01', 'town02', 'town03']);
    expect(townLayers(2, true)).toEqual(['town10', 'town11', 'town12', 'town13', 'town14']);
    expect(townLayers(3, true)).toEqual(['town20', 'town21', 'town22', 'town23']);
    expect(townLayers(1, true)).toEqual(['town00', 'town01', 'town02', 'town03']);
  });
  it('layers 1 and 2 share frame k = (tick % 15) / 3 over a 50 ms tick: 2 columns × 3 rows, 150 ms a frame', () => {
    expect(layerFrame(1, 0)).toEqual({ sx: 0, sy: 0, w: 112, h: 64, dx: 528, dy: 0 });
    expect(layerFrame(1, 150)).toEqual({ sx: 0, sy: 64, w: 112, h: 64, dx: 528, dy: 0 });
    expect(layerFrame(1, 450)).toEqual({ sx: 112, sy: 0, w: 112, h: 64, dx: 528, dy: 0 });
    expect(layerFrame(1, 750)).toEqual(layerFrame(1, 0));
    expect(layerFrame(2, 300)).toEqual({ sx: 0, sy: 320, w: 288, h: 160, dx: 352, dy: 320 });
  });
  it('layer 4 ping-pongs 0→5→0 over counter values 0..10 (skipping 2 and 4), rests on frame 0 until the 28-tick cycle wraps', () => {
    expect(layerFrame(4, 0)).toEqual({ sx: 0, sy: 0, w: 128, h: 128, dx: 496, dy: 160 });
    expect(layerFrame(4, 100)).toMatchObject({ sx: 0, sy: 128 });              // tick 2 → counter 3 → j 3
    expect(layerFrame(4, 150)).toMatchObject({ sx: 256, sy: 128 });            // tick 3 → counter 5 → j 5
    expect(layerFrame(4, 200)).toMatchObject({ sx: 128, sy: 128 });            // tick 4 → counter 6 → j 4
    expect(layerFrame(4, 400)).toMatchObject({ sx: 0, sy: 0 });                // tick 8 → counter 10 → j 0
    expect(layerFrame(4, 600)).toMatchObject({ sx: 0, sy: 0 });                // tick 12 → counter 14 ≥ 11 → rest
    expect(layerFrame(4, 1400)).toMatchObject({ sx: 0, sy: 0 });               // tick 28 → counter 0
    expect(layerFrame(4, 1450)).toMatchObject({ sx: 128, sy: 0 });             // tick 29 → counter 1 → j 1
  });
  it('townLabel looks in the stage file first, then EVENT00, else null', () => {
    const r = res([prog(0, ['inn', ['END'], 'guild', ['END']]), prog(3, ['inn', ['END']])]);
    expect(townLabel(r, 3, 1)).toEqual({ stage: 3, label: 'inn' });
    expect(townLabel(r, 3, 2)).toEqual({ stage: 0, label: 'guild' });
    expect(townLabel(r, 3, 4)).toBeNull();
    expect(townLabel(r, 3, 99)).toBeNull();
  });
});
