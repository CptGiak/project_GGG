/**
 * Main menu: "Grapple the Sky". F major, 152 BPM, a heroic anisong-style anthem.
 * Intro fanfare on the motif, A-melo with a descending bass, a royal-road pre-chorus that climbs
 * through the bVI-bVII "power-up" cadence, the chorus, a kime break, the verse again with the tune
 * handed to the strings, a half-time bridge and the last chorus lifted a minor third into A-flat.
 */
import type { SongDef } from '../score';

const A_MEL =
  '-:2 C5:2 F5:2 G5:2 A5:4 G5:2 F5:2 | E5:6 C5:6 -:4 | -:2 D5:2 F5:2 A5:2 C6:4 Bb5:2 A5:2 | G5:6 F5:2 E5:4 -:4 | ' +
  '-:2 A4:2 D5:2 E5:2 F5:4 E5:2 D5:2 | Bb5:6 A5:2 G5:4 E5:4 | F5:2 C5:2 Eb5:3 D5:1 C5:8 | -:4 A4:2 C5:2 Eb5:4 D5:2 C5:2';

const SABI_MEL =
  'F4:2 C5:2 Eb5:3 D5:1 C5:8 | -:2 C5:2 D5:2 E5:2 G5:4 E5:2 C5:2 | D5:2 A5:2 C6:3 Bb5:1 A5:8 | -:2 A5:2 G5:2 E5:2 F5:4 Eb5:4 | ' +
  'D5:6 F5:2 Bb5:4 A5:4 | G5:6 E5:2 C6:8 | C6:4 B5:2 A5:2 F#5:4 A5:4 | Bb5:4 A5:2 G5:2 E5:4 G5:2 E5:2';

const SABI_CHORDS = 'F | C/E | Dm7 | Am7:8 F7:8 | Bbmaj7:16 | C | Am7:8 D7:8 | Gm7:8 C7:8';

export const MENU: SongDef = {
  id: 'menu',
  title: 'Grapple the Sky',
  bpm: 152,
  tonic: 53,
  scale: [0, 2, 4, 5, 7, 9, 10],
  order: ['intro', 'A', 'B', 'sabi', 'inter', 'A2', 'B', 'sabi', 'bridge', 'sabi+3', 'turn'],
  loopAt: 1,
  sections: {
    intro: {
      bars: 4,
      chords: 'F | Eb/F | Db | Eb',
      brass: 'F4:4 C5:4 Eb5:6 D5:2 | C5:16 | Db5:4 Eb5:4 F5:6 Eb5:2 | G5:12 -:4',
      oct: true,
      pad: 'both',
      bells: '-:16 | Bb5:2 Eb6:2 G6:2 Bb6:10 | -:16 | -:16',
      timp: 'r---------------|................|R.......R.......|r-----------....',
      drums: {
        c: 'C...............|................|c...............|c...............',
        k: 'X...............|................|x.......x.......|x.......x.x.x.x.',
        s: '................|................|................|....x...xxxxrrrr',
      },
      minifill: false,
    },
    A: {
      bars: 8,
      chords: 'F | Am7 | Bbmaj7 | C7sus4:8 C7:8 | Dm7:16 | Gm7:8 C7:8 | Eb/F:16 | F7',
      brass: A_MEL,
      pad: 'strings',
      gtr: 'm-m-m-m-m-m-m-m-',
      bass: 'R-r-r-5-R-r-8-5-',
      drums: {
        h: 'x.x.x.x.x.x.x.x.',
        s: '....x.......x...',
        k: 'X.....x.X.......',
        c: 'c...............|................|................|................|s...............|................|................|................',
      },
      gate: { gtr: 0.3 },
      mix: { gtr: 0.55, pad: 0.8 },
    },
    B: {
      bars: 8,
      chords: 'Bbmaj7 | C7 | Am7 | Dm7:16 | Gm7 | A7 | Bbmaj7:8 C/Bb:8 | Db:8 Eb:8',
      brass:
        'D5:4 F5:4 A5:6 G5:2 | G5:8 E5:4 C5:4 | C5:4 E5:4 G5:6 A5:2 | A5:8 F5:4 D5:4 | ' +
        'Bb5:4 A5:2 Bb5:2 D6:6 C6:2 | C#6:8 A5:4 E5:4 | D6:6 C6:2 Bb5:4 C6:4 | Db6:4 C6:2 Db6:2 Eb6:4 -:4',
      strings: '1585358515853585',
      stabs: '................|................|................|................|................|................|<-------<-------|X.......X.......',
      gtr: 'X-------x-x-x-x-',
      bass: 'R-r-r-r-R-r-r-r-',
      drums: {
        h: 'r.r.r.r.r.r.r.r.',
        s: '....x.......x...',
        k: 'x.....x.x.......',
      },
      fill: 'breath',
      gate: { strings: 0.35, stabs: 0.4 },
      mix: { gtr: 0.8 },
    },
    sabi: {
      bars: 8,
      chords: SABI_CHORDS,
      brass: SABI_MEL,
      oct: true,
      strings: 'A5:8 C6:8 | G5:8 E5:8 | F5:8 A5:8 | E5:8 Eb5:8 | F5:8 D5:8 | E5:8 G5:8 | E5:8 F#5:8 | D5:8 E5:8',
      pad: 'choir',
      gtr: 'X-x-x-x-X-x-x-x-',
      bass: 'R-r-r-r-R-r-5-8-',
      drums: {
        h: 'R.r.R.r.R.r.R.r.',
        s: '....x..g....x.g.',
        k: 'X.....x.X.x...x.',
        c: 'C...............|................',
      },
      fill: 'toms|big',
    },
    inter: {
      bars: 4,
      chords: 'F | F | Eb/F | Eb/F',
      hit: 'H..H..H.........|................|H..H..H.........|................',
      brass: '-:16 | F5:2 C6:2 Eb6:3 D6:1 C6:4 -:4 | -:16 | Eb5:2 Bb5:2 Db6:3 C6:1 Bb5:4 -:4',
      gtr: 'X..X..X.........|..........x.x.x.|X..X..X.........|..........m.mmmm',
      bass: 'R..R..R.........|..........r.r.r.|R..R..R.........|..........r.rrrr',
      drums: {
        k: 'X..X..X.........|..........x.x.x.|X..X..X.........|..........x.xxxx',
        s: 'X..X..X.........|..........x.x.x.|X..X..X.........|............xxxx',
        c: 'C..c..c.........|................|C..c..c.........|................',
      },
      minifill: false,
    },
    // the verse again: the tune moves to the strings, horns answer with a counter-line
    A2: {
      bars: 8,
      chords: 'F | Am7 | Bbmaj7 | C7sus4:8 C7:8 | Dm7:16 | Gm7:8 C7:8 | Eb/F:16 | F7',
      strings: A_MEL,
      brass2: 'C5:8 A4:8 | G4:16 | F4:8 A4:8 | Bb4:8 G4:8 | A4:8 F4:8 | D5:8 C5:8 | Bb4:16 | A4:8 C5:8',
      bells: '-:16 | -:8 E6:2 C6:2 A5:4 | -:16 | -:8 G6:2 E6:2 C6:4 | -:16 | -:8 E6:2 C6:2 G5:4 | -:16 | -:8 Eb6:2 C6:2 A5:4',
      gtr: 'm-m-m-m-m-m-m-m-',
      bass: 'R-r-r-5-R-r-8-5-',
      drums: {
        t: '1.....2...1...3.',
        s: '....x.......x...',
        k: 'X.....x.X.......',
        c: 'c...............|................|................|................',
      },
      gate: { gtr: 0.3 },
      mix: { gtr: 0.55 },
    },
    // half-time bridge: strings sing, a celesta sparkles, the choir hums
    bridge: {
      bars: 8,
      chords: 'Dm | Bb | Gm7 | A7 | Dm | Bbmaj7 | Gm7 | Eb7',
      strings: 'A5:12 G5:2 F5:2 | F5:8 D5:8 | Bb5:12 A5:2 G5:2 | C#5:8 E5:8 | F5:12 E5:2 D5:2 | D5:8 F5:8 | G5:8 Bb5:4 A5:4 | G5:8 Bb5:8',
      bells:
        '-:8 A6:2 F6:2 D6:4 | -:8 F6:2 D6:2 Bb5:4 | -:8 D6:2 Bb5:2 G5:4 | -:8 E6:2 C#6:2 A5:4 | ' +
        '-:8 A6:2 F6:2 D6:4 | -:8 F6:2 D6:2 Bb5:4 | -:8 Bb6:2 G6:2 D6:4 | -:8 G6:2 Eb6:2 Bb5:4',
      pad: 'choir',
      bass: 'R-------R-------',
      timp: '................|................|................|R...............|................|................|................|r---------------',
      drums: {
        k: 'X.........x.....',
        s: '........x.......',
        h: 'x...x...x...x...',
      },
      fill: 'snareRoll',
      minifill: false,
    },
    turn: {
      bars: 2,
      chords: 'Db | Eb',
      brass: 'Db5:4 F5:4 Ab5:8 | Bb5:4 G5:4 Eb5:2 F5:2 G5:4',
      oct: true,
      stabs: 'X.......X.......|X..X..X.........',
      gtr: 'X-------X-------|X..X..X.........',
      bass: 'R-r-r-r-R-r-r-r-|R..R..R.........',
      drums: {
        k: 'X.....x.X.......|X..X..X.........',
        s: '....x.......x...|X..X..X...xxrrrr',
        c: 'C...............|C..c..c.........',
      },
      minifill: false,
    },
  },
};
