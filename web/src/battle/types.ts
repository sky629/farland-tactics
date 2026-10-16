import type { MapData } from '../assets/types';
import type { BattleEntry } from '../data/types';
import type { BattleGrid, Dir } from './grid';
import type { Inventory } from './inventory';
import type { RangeTable } from './moveRange';
import type { Hit } from './resolve';
import type { RandomSource } from './rng';
import type { Unit } from './unit';

export type { Dir };

export type Selection =
  | { mode: 'idle' }
  | { mode: 'menu'; slot: number; range: RangeTable }
  | { mode: 'move'; slot: number; range: RangeTable }
  | { mode: 'target'; slot: number; action: number; range: RangeTable }
  | { mode: 'face'; slot: number };

export type Phase =
  | { kind: 'player'; sel: Selection }
  | { kind: 'enemy'; queue: number[] }
  | { kind: 'end'; result: 'victory' | 'defeat' };

export interface BattleState {
  entry: BattleEntry;
  map: MapData;
  grid: BattleGrid;
  units: (Unit | null)[];
  turn: number;
  phase: Phase;
  rng: RandomSource;        // an Rng in the game; tests inject fixed sources
  lastPath: Dir[];          // path of the selected unit's last move (dash detection)
  inventory: Inventory;     // party consumables and gold (battle_rules.md §4.3)
}

export type Command =
  | { type: 'select'; slot: number } | { type: 'cancel' }
  | { type: 'beginMove' } | { type: 'move'; c: number; r: number }
  | { type: 'beginTarget'; action: number } | { type: 'act'; c: number; r: number }
  | { type: 'wait' } | { type: 'face'; dir: Dir }
  | { type: 'endTurn' } | { type: 'enemyStep' };

export type BattleEvent =
  | { type: 'selected'; slot: number } | { type: 'deselected' }
  | { type: 'moved'; slot: number; path: Dir[]; to: [number, number] }
  | { type: 'faced'; slot: number; dir: Dir }
  | { type: 'action'; slot: number; action: number; cell: [number, number]; hits: Hit[] }
  | { type: 'died'; slot: number } | { type: 'removed'; slot: number }
  | { type: 'exp'; slot: number; gain: number } | { type: 'levelUp'; slot: number; level: number; learned: number[] }
  | { type: 'statusTick'; slot: number; status: number; value: number; cured: boolean }
  | { type: 'roundStart'; turn: number } | { type: 'phase'; kind: 'player' | 'enemy' }
  | { type: 'end'; result: 'victory' | 'defeat' }
  | { type: 'pickup'; slot: number; item: number; gold: number } | { type: 'bagFull'; slot: number; item: number } | { type: 'revealed'; slot: number }
  | { type: 'rejected'; reason: string };
