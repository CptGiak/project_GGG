/**
 * The soundtrack. Every cue develops one original five-note idea, the "Ki motif":
 * scale degrees 1 - 5 - b7 - 6 - 5 in the rhythm 8th, 8th, dotted 8th, 16th, half note
 * (D A C B A in D minor). It opens the menu fanfare, drives the battle choruses, turns upside
 * down for the final minute and finally resolves up to the octave in the victory jingle.
 */
import type { DrumLane, SongDef } from '../score';
import { CITY } from './city';
import { JINGLES } from './jingles';
import { MENU } from './menu';
import { STAGE } from './stage';
import { TARTARUS } from './tartarus';

export const SONGS: Record<string, SongDef> = {
  menu: MENU,
  city: CITY,
  stage: STAGE,
  tartarus: TARTARUS,
  ...JINGLES,
};

/** which battle theme plays in which arena */
export const ARENA_SONG: Record<string, string> = {
  neon_city: 'city',
  stage: 'stage',
  tartarus: 'tartarus',
};

/** whole-bar fills (replace the drums of a section's last bar) */
export const FILLS: Record<string, Partial<Record<DrumLane, string>>> = {
  snareRoll: { k: 'x.......x.......', s: '....x.x.xxxxrrrr' },
  toms: { k: 'x...x...x...x...', s: 'x.g.x...........', t: '........11223344' },
  // ends on an 8th of silence: the band "breathes in" before the chorus downbeat
  breath: { k: 'x.....x.........', s: '....x...xxxxrr..' },
  big: { k: 'x...x...x.x.x.xx', s: 'x.x.x.x.........', t: '........1.2.3.44' },
  kime: { k: 'X..X..X.........', s: 'X..X..X.........', c: 'C..C..C.........' },
  half: { k: 'x.......x.......', s: '........x.x.rrrr' },
};

/** one-beat fills closing every 4th bar (steps 13-16); a random one each time */
export const MINI_FILLS: Array<Partial<Record<DrumLane, string>>> = [
  { s: 'xxxx' },
  { t: '1133' },
  { s: 'x.', t: '..33' },
  { s: '.gxx' },
  { s: 'x', t: '.234' },
  { s: 'rr..' },
];
