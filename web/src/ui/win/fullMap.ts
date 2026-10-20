/**
 * Menu 40030 "전체 맵" (F3). The original opens a second top-level window (FUN_00436c40: class and caption "전체맵", a 640×480
 * client by default, its place kept in the INI as WinRect) whose paint (FUN_0042c290) stretches the whole map into the client
 * area and marks every unit; a click or drag in it scrolls the main view to that map point (FUN_00436900 → FUN_0042dc70), and
 * the menu item carries a check while it is open (CheckMenuItem in the WM_INITMENU handler). The web has one window, so this
 * is a child window inside the frame at half size, bottom right [추정]. A map change closes it (FUN_0042d5d0 destroys it).
 */
import { PARTY_SLOTS, type Unit } from '../../battle/unit';
import { TITLE_H } from './dialog';

export const FULL_MAP_W = 320, FULL_MAP_H = 240;
export interface Marker { x: number; y: number; party: boolean }

/** FUN_0042c290's unit loop: every unit record in play (side 7 only for chests, id 8), not hidden (status 9), at its cell anchor scaled to the window. */
export function fullMapMarkers(units: (Unit | null)[], cellOf: (c: number, r: number) => { x: number; y: number } | null, size: [number, number], w: number, h: number): Marker[] {
  const out: Marker[] = [];
  for (const u of units) {
    if (!u || (u.side === 7 && u.id !== 8) || u.status === 9) continue;
    const p = cellOf(u.c, u.r);
    if (!p) continue;
    out.push({ x: Math.trunc((p.x * w) / size[0]), y: Math.trunc((p.y * h) / size[1]), party: u.slot < PARTY_SLOTS });
  }
  return out;
}
/** FUN_00436900: a client point → the map point under it (negative coordinates clamp to 0; the camera clamp handles the far side). */
export function mapPointOf(mx: number, my: number, w: number, h: number, size: [number, number]): { x: number; y: number } {
  return { x: Math.trunc((Math.max(0, mx) * size[0]) / w), y: Math.trunc((Math.max(0, my) * size[1]) / h) };
}

export class FullMapWindow {
  readonly el: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private size: [number, number] | null = null;
  private down = false;
  constructor(layer: HTMLElement, private readonly onPick: (x: number, y: number) => void) {
    const doc = layer.ownerDocument;
    const box = doc.createElement('div'); box.className = 'w95 w95-window w95-raised'; box.hidden = true;
    box.style.width = `${FULL_MAP_W + 6}px`; box.style.height = `${FULL_MAP_H + TITLE_H + 6}px`;
    box.style.left = `${640 - FULL_MAP_W - 10}px`; box.style.top = `${480 - FULL_MAP_H - TITLE_H - 10}px`;
    const title = doc.createElement('div'); title.className = 'w95-title'; title.textContent = '전체맵';
    const canvas = doc.createElement('canvas'); canvas.width = FULL_MAP_W; canvas.height = FULL_MAP_H; canvas.className = 'w95-map';
    box.append(title, canvas); layer.appendChild(box);
    this.el = box;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx; ctx.imageSmoothingEnabled = false;
    const pick = (e: MouseEvent) => { if (this.size) { const p = mapPointOf(e.offsetX, e.offsetY, FULL_MAP_W, FULL_MAP_H, this.size); this.onPick(p.x, p.y); } };
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { this.down = true; pick(e); } });   // SetCapture: the drag keeps scrolling
    canvas.addEventListener('mousemove', (e) => { if (this.down) pick(e); });
    doc.addEventListener('mouseup', () => { this.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  get visible(): boolean { return !this.el.hidden; }
  toggle(): void { this.el.hidden = !this.el.hidden; }
  hide(): void { this.el.hidden = true; }
  /** One frame: the whole map stretched into the client area (a nearest-neighbour blit like DirectDraw's), then a small cross per unit — party white, others red [추정]. */
  paint(whole: { image: CanvasImageSource; w: number; h: number }, markers: Marker[]): void {
    this.size = [whole.w, whole.h];
    const g = this.ctx;
    g.drawImage(whole.image, 0, 0, whole.w, whole.h, 0, 0, FULL_MAP_W, FULL_MAP_H);
    for (const m of markers) { g.fillStyle = m.party ? '#fff' : '#f00'; g.fillRect(m.x - 2, m.y, 5, 1); g.fillRect(m.x, m.y - 2, 1, 5); }
  }
}
