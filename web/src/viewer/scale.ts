import { VIEW_H, VIEW_W } from '../iso/grid';

/** Largest integer CSS scale at which 640×480 fits the available area; never below 1 (the page scrolls instead). */
export function fitScale(availW: number, availH: number): number {
  return Math.max(1, Math.floor(Math.min(availW / VIEW_W, availH / VIEW_H)));
}

/** Camera top-left in whole map pixels, clamped so the 640×480 viewport stays inside the map (FUN_00431460 scroll limits). */
export function clampCamera(x: number, y: number, pixelW: number, pixelH: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(0, Math.round(x)), Math.max(0, pixelW - VIEW_W)),
    y: Math.min(Math.max(0, Math.round(y)), Math.max(0, pixelH - VIEW_H)),
  };
}
