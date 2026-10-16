import { describe, expect, it } from 'vitest';
import { sortRow, type PlacedSprite } from '../src/render/renderer';

const sp = (layer: number, tag: string) => ({ layer, tag } as unknown as PlacedSprite & { tag: string });

describe('sortRow', () => {
  it('orders by layer and keeps placement order within a layer', () => {
    const out = sortRow([sp(4, 'unit-a'), sp(2, 'shadow'), sp(5, 'icon'), sp(4, 'unit-b'), sp(1, 'tile')]) as (PlacedSprite & { tag: string })[];
    expect(out.map((s) => s.tag)).toEqual(['tile', 'shadow', 'unit-a', 'unit-b', 'icon']);
  });
});
