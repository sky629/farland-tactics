/**
 * Scene 4 (PLAY_VISUAL 24): FUN_00405c70 → FUN_00405ca0, setup FUN_00405d00.
 * Background v04a; object 3 (v04b 448×464) drifts from (416,16) to (640,−128) over 15 s; after 10 s an 8-step fade-out.
 */
import type { SceneDef } from '../timeline';

export const scene04: SceneDef = { id: 4, parts: [[
  { op: 'order', ids: [0, 3] },
  { op: 'show', obj: 0, slot: 0, sx: 0, sy: 0, w: 640, h: 480, dx: 0, dy: 0 },
  { op: 'show', obj: 3, slot: 1, sx: 0, sy: 0, w: 448, h: 464, dx: 0, dy: 0 },
  { op: 'move', obj: 3, from: [416, 16], to: [640, -128], ms: 15000 },
  { op: 'fade', dir: 'in', steps: 8 },
  { op: 'wait', ms: 10000 },
  { op: 'fade', dir: 'out', steps: 8 },
  { op: 'waitFade' },
  { op: 'end' },
]] };
