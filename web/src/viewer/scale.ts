import { VIEW_H, VIEW_W } from '../iso/grid';

/** Largest integer CSS scale at which 640×480 fits the available area; never below 1 (the page scrolls instead). */
export function fitScale(availW: number, availH: number): number {
  return Math.max(1, Math.floor(Math.min(availW / VIEW_W, availH / VIEW_H)));
}

/** The Win95 menu bar above the surface (play.html #menubar): 19 CSS px at scale 1, like the original window's menu bar. */
export const MENU_BAR_H = 19;

/** Largest integer scale at which the 640×480 surface plus the menu bar fits the available area; never below 1 (the page scrolls instead). */
export function frameScale(availW: number, availH: number): number {
  return Math.max(1, Math.floor(Math.min(availW / VIEW_W, availH / (VIEW_H + MENU_BAR_H))));
}

/** Camera top-left in whole map pixels, clamped so the 640×480 viewport stays inside the map (FUN_00431460 scroll limits). */
export function clampCamera(x: number, y: number, pixelW: number, pixelH: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(0, Math.round(x)), Math.max(0, pixelW - VIEW_W)),
    y: Math.min(Math.max(0, Math.round(y)), Math.max(0, pixelH - VIEW_H)),
  };
}
