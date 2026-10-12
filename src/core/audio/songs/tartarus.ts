/**
 * MIDNIGHT TARTARUS battle theme: "The Hidden Hour". C minor (harmonic), 144 BPM. The villain
 * side of the score: gong and taiko open the dark hour, a drop-tuned gallop riff with a
 * leading-tone bite, a Showa-style brass melody over a Neapolitan D-flat, a chorus the choir sings,
 * a half-time breakdown where a lead guitar wails in Phrygian dominant over a G pedal, and a riser
 * through minor thirds into the last chorus in D minor.
 */
import type { SongDef } from '../score';
import { up } from './util';

const RIFF_A = 'C2:2m C2:1m C2:1m Eb2:2 C2:1m C2:1m D2:2 C2:1m C2:1m B1:2 C2:2';
const RIFF_B = 'C2:2m C2:1m C2:1m G2:3 F#2:3 F2:3 Eb2:3';
const RIFF_AB = 'Ab1:2 Ab1:1m Ab1:1m Ab1:2m Ab1:2 Eb2:2 Ab1:2m G1:4';
const RIFF_FAB = 'F1:2 F1:1m F1:1m F1:2m F1:2 Ab1:2 Ab1:1m Ab1:1m Ab1:2m Ab1:2';
// the guitar plays the low bars an octave above the bass (drop-C range)
const GTR_AB = up(RIFF_AB, 12);
const GTR_G = 'G2:2 G2:1m G2:1m G2:2m B2:2s D3:2s F3:2s Ab3:4s';
const GTR_FAB = up(RIFF_FAB, 12);

const CHORUS_MEL =
  'C5:2 G5:2 Bb5:3 Ab5:1 G5:8 | -:2 Eb5:2 F5:2 G5:2 Ab5:4 G5:2 F5:2 | G5:6 Bb5:2 Eb5:8 | -:2 D5:2 F5:2 Bb5:2 D6:4 C6:2 Bb5:2 | ' +
  'C6:6 Ab5:2 F5:4 G5:2 Ab5:2 | C6:6 Bb5:2 Ab5:4 Eb5:4 | D6:4 B5:4 C6:4 Eb6:4 | D6:8 B5:4 G5:4';

export const TARTARUS: SongDef = {
  id: 'tartarus',
  title: 'The Hidden Hour',
  bpm: 144,
  tonic: 48,
  scale: [0, 2, 3, 5, 7, 8, 11],
  order: ['intro', 'A', 'B', 'chorus', 'A', 'breakdown', 'riser', 'chorus+2', 'tag'],
  loopAt: 1,
  climax: ['riser', 'chorus+2', 'breakdown+2', 'chorus+3'],
  sections: {
    intro: {
      bars: 8,
      chords: 'Cm | Ab/C | Fm/C | G/C | Cm | Ab/C | Fm/C | G7b9',
      brass2: 'C4:4 G4:4 Bb4:6 Ab4:2 | G4:16 | F4:4 C5:4 Eb5:6 Db5:2 | B4:16 | -:16 | -:16 | -:16 | -:16',
      brass: '-:16 | -:16 | -:16 | -:16 | C5:4 G5:4 Bb5:6 Ab5:2 | G5:16 | F5:4 C6:4 Eb6:6 Db6:2 | B5:8 D6:8',
      pad: 'choir',
      bass: 'R---------------',
      timp: '................|................|................|................|R...............|R...............|R...............|r---------------',
      drums: {
        c: 'g...............|................|................|................|g...............|................|................|................',
        t: 'K.....k.k...K...|K.....k.k...K...|K.....k.k...K...|K.....k.kkk.K.k.',
      },
      fill: 'toms',
      minifill: false,
    },
    A: {
      bars: 8,
      chords: 'Cm | Cm | Ab | G | Cm | Cm | Fm:8 Ab:8 | G',
      gtr: `${RIFF_A} | ${RIFF_B} | ${GTR_AB} | ${GTR_G} | ${RIFF_A} | ${RIFF_B} | ${GTR_FAB} | G2:16`,
      bass: `${RIFF_A} | ${RIFF_B} | ${RIFF_AB} | G1:16 | ${RIFF_A} | ${RIFF_B} | ${RIFF_FAB} | G1:16`,
      strings: '1585158515851585',
      stabs: 'X...............|................|X...............|X.....X.....X...',
      drums: {
        h: 'x.x.x.x.x.x.x.x.',
        k: 'X...x.x.X...x...',
        s: '....X.......X...',
        c: 'C...............|................|................|................|c...............|................|................|................',
      },
      gate: { strings: 0.4 },
    },
    B: {
      bars: 8,
      chords: 'Ab | Bb | Gm | Cm | Fm | Db | G | G7b9',
      brass: 'C5:6 Eb5:2 Ab5:8 | D5:6 F5:2 Bb5:8 | Bb5:4 A5:2 G5:2 D5:8 | Eb5:4 D5:2 C5:2 G4:8 | Ab5:6 G5:2 F5:4 C5:4 | F5:6 Ab5:2 Db6:8 | D6:4 B5:4 G5:4 F5:4 | Ab5:4 G5:4 F5:4 D5:4',
      brass2: 'Eb4:16 | F4:16 | D4:16 | Eb4:16 | C4:16 | F4:16 | D4:16 | B3:16',
      pad: 'choir',
      gtr: 'X-x-x-x-X-x-x-x-',
      bass: 'R-r-r-r-R-r-r-r-',
      drums: {
        h: 'r.r.r.r.r.r.r.r.',
        k: 'X.....x.X.x.....',
        s: '....x.......x...',
        t: 'k...............',
      },
      fill: 'breath',
    },
    chorus: {
      bars: 8,
      chords: 'Cm | Ab | Eb | Bb | Fm | Ab | G:8 Ab:8 | G',
      brass: CHORUS_MEL,
      oct: true,
      choir: up(CHORUS_MEL, -12),
      strings: '1585158515851585',
      gtr: 'X-x-x-x-X-x-x-x-',
      bass: 'R-r-R-r-R-r-5-8-',
      timp: 'R.......R.......',
      drums: {
        h: 'r.r.r.r.r.r.r.r.',
        k: 'X.....x.X.x.....',
        s: '....X.......X...',
        t: 'K.......K.......',
        c: 'C...............|................',
      },
      fill: 'big|toms',
      gate: { strings: 0.4 },
    },
    breakdown: {
      bars: 8,
      chords: 'Cm/G | Ab/G | Fm/G | G | Cm/G | Ab/G | Fm/G | G7b9',
      lead:
        'G4:4 Ab4:4 B4:6 C5:2 | D5:4 C5:2 B4:2 Ab4:8~ | C5:4 Ab4:4 F4:6 G4:2 | Ab4:4 G4:4 F4:2 Eb4:2 D4:4 | ' +
        'G5:4^ Ab5:4 B5:6 C6:2 | D6:4 C6:2 B5:2 Ab5:8~ | C6:4 Ab5:4 F5:6 G5:2 | Ab5:4 G5:4 F5:4 B4:4/',
      pad: 'choir',
      bass: 'R-------R-------',
      timp: 'R.......5.......',
      drums: {
        k: 'X.........x.....',
        s: '........X.......',
        t: 'K...............',
        c: 'g...............|................|................|................|C...............|................|................|................',
      },
      fill: 'half',
      minifill: false,
    },
    riser: {
      bars: 4,
      chords: 'Cm | Ebm | F#m | A7',
      brass: 'C5:2 G5:2 Bb5:3 Ab5:1 G5:8 | Eb5:2 Bb5:2 Db6:3 B5:1 Bb5:8 | F#5:2 C#6:2 E6:3 D6:1 C#6:8 | A4:2 E5:2 G5:3 F5:1 E5:8',
      oct: true,
      strings: '1111111111111111',
      gtr: 'X---------------',
      bass: 'R-------R-------',
      timp: 'r---------------',
      drums: {
        k: 'X...X...X...X...|X...X...X...X...|X...X...X...X...|X...X...X.......',
        s: 'x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx|rrrrrrrrrrrrrrrr|rrrrrrrrrrrr....',
        c: 'C...............|c...............|c...............|................',
        t: 'K...............',
      },
      minifill: false,
    },
    tag: {
      bars: 2,
      chords: 'Eb | G7',
      hit: 'H.......H.......|H..H..H.........',
      brass: 'G5:8 Bb5:8 | B5:4 D6:4 F6:8',
      oct: true,
      gtr: 'X-------X-------|X..X..X.........',
      bass: 'R-------R-------|R..R..R.........',
      drums: {
        k: 'X.......X.......|X..X..X.........',
        s: '....x.......x...|X..X..X...xxrrrr',
        c: 'C...............|C..c..n.........',
      },
      minifill: false,
    },
  },
};
