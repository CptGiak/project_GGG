/**
 * TRUE NOTE ARENA battle theme: "Encore Overdrive". A major, 160 BPM, a bright anisong opening
 * in the "Cha-La" tradition: a synth lead sings the tune, brass punches the kime, the bVI-bVII-I
 * power-up cadence opens every round, the verse walks its bass down the scale, the pre-chorus
 * rides the royal-road progression, and after a lead-guitar solo the last choruses lift a semitone.
 */
import type { SongDef } from '../score';

const A_MEL =
  '-:2 E5:2 A5:2 B5:2 C#6:4 B5:2 A5:2 | G#5:6 E5:6 -:4 | -:2 F#5:2 A5:2 C#6:2 E6:4 C#6:2 A5:2 | B5:4 G#5:4 E5:8 | ' +
  '-:2 D5:2 F#5:2 A5:2 D6:4 C#6:2 A5:2 | C#6:6 B5:2 A5:4 E5:4 | D6:4 C#6:2 B5:2 A5:4 F#5:4 | B5:6 A5:2 G#5:4 E5:4';

const B_MEL =
  'F#5:4 A5:4 C#6:6 B5:2 | B5:8 G#5:4 E5:4 | E5:4 G#5:4 B5:6 C#6:2 | C#6:8 A5:4 F#5:4 | ' +
  'D6:4 C#6:2 D6:2 F#6:6 E6:2 | F6:8 C#6:4 G#5:4 | F#6:6 E6:2 D6:4 E6:4 | F6:4 C6:4 D6:2 G6:2 -:4';

const SABI_MEL =
  'A4:2 E5:2 G5:3 F#5:1 E5:8 | -:2 B4:2 E5:2 G#5:2 B5:4 A5:2 G#5:2 | A5:6 C#6:2 _:4 B5:2 A5:2 | F#5:4 A5:4 G#5:4 B5:4 | ' +
  'C#6:6 B5:2 A5:4 E5:4 | F#5:2 A5:2 D6:3 E6:1 F#6:8 | E6:4 D6:2 C#6:2 B5:4 G#5:4 | A5:8 G5:4 E5:4';

const SABI_CHORDS = 'A | E/G# | F#m | D:8 E:8 | A/C#:16 | D | Bm7:8 E7:8 | A:8 A7:8';

export const STAGE: SongDef = {
  id: 'stage',
  title: 'Encore Overdrive',
  bpm: 160,
  tonic: 45,
  scale: [0, 2, 4, 5, 7, 9, 11],
  order: ['intro', 'A', 'B', 'sabi', 'inter', 'A', 'B', 'sabi', 'solo', 'sabi+1', 'sabi+1'],
  loopAt: 0,
  climax: ['inter', 'sabi+1', 'solo+1', 'sabi+2'],
  sections: {
    intro: {
      bars: 4,
      chords: 'F:8 G:8 | A | F:8 G:8 | A',
      brass: 'C5:4 F5:4 D5:4 G5:4 | A5:2 E5:2 G5:3 F#5:1 E5:8 | C6:4 A5:4 B5:4 D6:4 | C#6:4 B5:2 C#6:2 E6:8',
      oct: true,
      hit: 'H.....H.........|H...............|H.....H.........|H..H..H...H.H...',
      gtr: 'X-----X-X-------|X---------------|X-----X-X-------|X..X..X...X.X...',
      bass: 'R-----R-R-------|R---------------|R-----R-R-------|R..R..R...R.R...',
      drums: {
        k: 'X.....X.X.......|X...x...x...x...|X.....X.X.......|X..X..X...X.X...',
        s: '................|....x.......x...|................|X..X..X...X.Xrrr',
        h: '................|x.x.x.x.x.x.x.x.|................|................',
        c: 'C.....c.c.......|................|C.....c.c.......|C..c..c...c.C...',
      },
      minifill: false,
    },
    A: {
      bars: 8,
      chords: 'A | E/G# | F#m | C#m/E | D | A/C# | Bm7 | E7sus4:8 E7:8',
      synth: A_MEL,
      bells: '-:16 | -:8 B6:2 G#6:2 E6:4 | -:16 | -:8 G#6:2 E6:2 C#6:4 | -:16 | -:8 E6:2 C#6:2 A5:4 | -:16 | -:8 B6:2 G#6:2 E6:4',
      stabs: '..x...x...x...x.',
      pad: 'strings',
      gtr: 'm-m-m-m-m-m-m-m-',
      bass: 'R-r-r-r-R-r-5-r-',
      drums: {
        h: 'x.x.x.x.x.x.x.x.',
        k: 'X.....x.X.......',
        s: '....x.......x...',
        c: 'c...............|................|................|................|s...............|................|................|................',
      },
      gate: { stabs: 0.5, gtr: 0.25 },
      mix: { gtr: 0.6, pad: 0.7, stabs: 0.6 },
    },
    B: {
      bars: 8,
      chords: 'Dmaj7 | E7 | C#m7 | F#m7 | Bm7 | C#7 | Dmaj7:8 E/D:8 | F:8 G:8',
      synth: B_MEL,
      brass2: 'A4:16 | G#4:16 | G#4:16 | A4:16 | A4:16 | G#4:16 | A4:8 G#4:8 | A4:8 B4:8',
      strings: '1585358515853585',
      gtr: 'X-------x-x-x-x-',
      bass: 'R-r-r-r-R-r-r-r-',
      drums: {
        h: 'r.r.r.r.r.r.r.r.',
        k: 'x.....x.x.......',
        s: '....x.......x...',
      },
      fill: 'breath',
      gate: { strings: 0.4 },
    },
    sabi: {
      bars: 8,
      chords: SABI_CHORDS,
      synth: SABI_MEL,
      brass: SABI_MEL,
      strings: 'C#6:8 E6:8 | B5:8 G#5:8 | A5:8 F#5:8 | A5:8 B5:8 | E5:8 C#5:8 | D5:8 F#5:8 | D5:8 D5:8 | C#5:8 G5:8',
      pad: 'both',
      gtr: 'X-x-x-x-X-x-x-x-',
      bass: 'R-r-R-r-R-r-5-8-',
      drums: {
        h: 'XxxxXxxxXxxxXxxx',
        k: 'X.....X.X.....X.',
        s: '....x.......x...',
        c: 'C...............|................',
      },
      fill: 'toms|big',
      mix: { synth: 0.8 },
    },
    inter: {
      bars: 4,
      chords: 'A | A | F:8 G:8 | A',
      hit: 'H..H..H...H.H...|H..H..H...H.H...|H.......H.......|H...............',
      brass: '-:16 | A5:2 E6:2 G6:3 F#6:1 E6:8 | C6:8 D6:8 | C#6:16',
      oct: true,
      gtr: 'X..X..X...X.X...|X..X..X...X.X...|X-------X-------|X---------------',
      bass: 'R..R..R...R.R...|R..R..R...R.R...|R-------R-------|R---------------',
      drums: {
        k: 'X..X..X...X.X...|X..X..X...X.X...|X.......X.......|X...x...x.x.xxxx',
        s: 'X..X..X...X.X...|X..X..X...X.X...|X.......X.......|....x...xxxxrrrr',
        c: 'C..c..c...c.C...|C..c..c...c.C...|C.......C.......|C...............',
      },
      minifill: false,
    },
    solo: {
      bars: 8,
      chords: 'F#m | D | A | E | F#m | D | Bm7 | E7',
      lead:
        'C#5:4^ E5:2 F#5:2 A5:6~ F#5:2 | F#5:2 E5:2 D5:4 A4:8~ | E5:2 A5:2 C#6:4^ B5:2 A5:2 E5:4 | G#5:6~ B5:2 E6:8~ | ' +
        'F#5:1 G#5:1 A5:1 B5:1 C#6:4 B5:1 A5:1 G#5:1 F#5:1 E5:4 | D6:4^ C#6:2 A5:2 F#5:8~ | B5:2 D6:2 F#6:4^ E6:2 D6:2 B5:4 | G#5:4 B5:4 D6:4 E6:4/',
      stabs: 'X.......X.......|x.......x.......',
      pad: 'strings',
      gtr: 'X-mmX-mmX-mmX-mm',
      bass: 'R-r-R-r-R-r-5-8-',
      drums: {
        h: 'R.r.R.r.R.r.R.r.',
        k: 'X.....x.X.x.....',
        s: '....x.......x...',
        c: 'C...............|................|................|................',
      },
      fill: 'big',
      mix: { gtr: 0.8, stabs: 0.7, pad: 0.6 },
    },
  },
};
