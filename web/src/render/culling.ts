import { VIEW_H, VIEW_W } from '../iso/grid';

/** True when the rect (x, y, w, h) overlaps the 640×480 viewport whose top-left is (camX, camY). */
export function rectVisible(x: number, y: number, w: number, h: number, camX: number, camY: number): boolean {
  return x < camX + VIEW_W && x + w > camX && y < camY + VIEW_H && y + h > camY;
}
