import { describe, expect, it } from 'vitest';
import { cellAnchor, gridSize, inDiamond, rowCells } from '../src/iso/grid';

const g = { w: 25, h: 25, originX: 768, originY: -256 };   // stage02-like values

describe('grid', () => {
  it('N = w + h - 1', () => { expect(gridSize(g)).toBe(49); });

  it('anchor follows (c-r)*32+ox, (c+r)*16+oy-h*8', () => {
    expect(cellAnchor(g, 0, 0, 0)).toEqual({ x: 768, y: -256 });
    expect(cellAnchor(g, 24, 0, 0)).toEqual({ x: 768 + 24 * 32, y: -256 + 24 * 16 });
    expect(cellAnchor(g, 12, 12, 3)).toEqual({ x: 768, y: -256 + 24 * 16 - 24 });
  });

  it('diamond test uses |dx|/32 + |dy|/16 <= 1 around the center', () => {
    expect(inDiamond(100, 50, 100, 50)).toBe(true);
    expect(inDiamond(131, 50, 100, 50)).toBe(true);    // right tip
    expect(inDiamond(100, 66, 100, 50)).toBe(true);    // bottom tip
    expect(inDiamond(116, 58, 100, 50)).toBe(true);    // on the edge
    expect(inDiamond(117, 58, 100, 50)).toBe(false);   // just outside
    expect(inDiamond(133, 50, 100, 50)).toBe(false);
  });

  it('rowCells lists (c, r) with c + r = s inside 0..N-1, c ascending', () => {
    expect(rowCells(3, 0)).toEqual([[0, 0]]);
    expect(rowCells(3, 2)).toEqual([[0, 2], [1, 1], [2, 0]]);
    expect(rowCells(3, 3)).toEqual([[1, 2], [2, 1]]);
    expect(rowCells(3, 4)).toEqual([[2, 2]]);
    expect(rowCells(3, 5)).toEqual([]);
  });
});
