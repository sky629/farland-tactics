# FT2 web viewer (sub-project 1: rendering foundation)

Spec: `../docs/superpowers/specs/2026-10-14-rendering-foundation-design.md`

## 1. Export the assets (once, and after changing the exporter)

    python3 -I ../tools/ft2_export.py ../extracted/FarlandTactics2 public/assets

Expected: `maps 76, sprites 312, pngs 631, warnings 4, errors 0`. `public/assets/` is git-ignored.

## 2. Run

    npm install
    npm run dev        # http://localhost:5173

Controls: map / sprite / anim selectors, click a cell to place the selected anim, arrow keys or drag to scroll, hold Shift for see-through, checkboxes for overlays.

## 3. Check

    npm run check      # tsc --noEmit && vitest run

Corpus tests (`test/corpus.test.ts`) run only when `public/assets/index.json` exists.
