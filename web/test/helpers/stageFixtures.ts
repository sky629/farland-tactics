import type { MapData } from '../../src/assets/types';
import { Effects } from '../../src/field/effects';
import { Presenter } from '../../src/field/presenter';
import type { Stage } from '../../src/game/gameCore';
import type { ModalKind, Where } from '../../src/script/host';
import { flatMap, tables } from './battleFixtures';
import { provider } from './presenterFixtures';

/** A Stage that records calls; `ready` gates loadMap, `clicks` feeds takeClick, `modal` is the next modal result. */
export class FakeStage implements Stage {
  readonly presenter = new Presenter(provider, tables());
  readonly effects = new Effects();
  camera = { x: 0, y: 0 };
  calls: [string, ...unknown[]][] = [];
  ready = true;
  clicks = 0;
  modal: number | null = null;
  map: MapData | null = null;
  private rec(name: string, ...args: unknown[]): void { this.calls.push([name, ...args]); }
  loadMap(n: number): void { this.rec('loadMap', n); this.map = flatMap(9); }
  mapReady(): boolean { return this.ready && this.map !== null; }
  mapData(): MapData | null { return this.map; }
  cellOf(c: number, r: number): { x: number; y: number } | null { return { x: (c - r) * 32 + 320, y: (c + r) * 16 }; }
  pixelSize(): [number, number] { return [1280, 960]; }
  openWindow(where: Where, speaker: number, face: string | null): void { this.rec('openWindow', where, speaker, face); }
  closeWindow(where: Where): void { this.rec('closeWindow', where); }
  text(where: Where, line: string, name: string | null): void { this.rec('text', where, line, name); }
  openModal(kind: ModalKind, payload: unknown): void { this.rec('openModal', kind, payload); }
  takeModalResult(): number | null { const r = this.modal; this.modal = null; return r; }
  closeAll(): void { this.rec('closeAll'); }
  showEpisode(title: string): void { this.rec('showEpisode', title); }
  bitmap(name: string): CanvasImageSource | null { this.rec('bitmap', name); return null; }
  showTown(set: 1 | 2 | 3, extra: boolean, flags: number[]): void { this.rec('showTown', set, extra, [...flags]); }
  hideTown(): void { this.rec('hideTown'); }
  takeClick(): boolean { if (this.clicks > 0) { this.clicks--; return true; } return false; }
  log(kind: 'warn' | 'info', text: string): void { this.rec('log', kind, text); }
}
