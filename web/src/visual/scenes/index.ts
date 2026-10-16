import type { SceneDef } from '../timeline';
import { scene00 } from './scene00';
import { scene01 } from './scene01';
import { scene03 } from './scene03';
import { scene04 } from './scene04';
import { scene06 } from './scene06';
import { scene07 } from './scene07';
import { scene09 } from './scene09';
import { scene10 } from './scene10';
import { scene11 } from './scene11';
import { scene12 } from './scene12';
import { scene13 } from './scene13';

/** Transcribed scenes by number (FUN_00401b40 dispatch). Scenes 2, 5, 8 are not used by any script and are not transcribed. */
export const scenes: Record<number, SceneDef> = Object.fromEntries([scene00, scene01, scene03, scene04, scene06, scene07, scene09, scene10, scene11, scene12, scene13].map((s) => [s.id, s]));
