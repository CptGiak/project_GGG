/**
 * SHIBUYA VELVET battle theme: "Crimson Scramble". D minor, 172 BPM, riff-driven rock with a
 * brass section on top. Galloping guitar riff with a flat-five, a two-beat verse (snare on every
 * off-beat, the anisong sense of speed), a chromatic diminished climb, a chorus with a Neapolitan
 * E-flat surprise, a kime break, a half-time Phrygian-dominant breakdown over an A pedal, a riser
 * through minor thirds and the final chorus a whole step up.
 * Final minute: double-kick, choir and the motif upside down in the horns, answered by trumpets.
 */
import type { SongDef } from '../score';

const RIFF_A = 'D2:2m D2:1m D2:1m F2:2 D2:1m D2:1m G2:2 D2:1m D2:1m Ab2:2 G2:2';
const RIFF_B = 'D2:2m D2:1m D2:1m F2:2 D2:1m D2:1m C3:3 Bb2:3 A2:2';
const KIME = (n: string) => `${n}:1 -:2 ${n}:1 -:2 ${n}:1 -:3 ${n}:1 -:1 ${n}:1 -:3`;

const SABI_CHORDS = 'Dm | Bb | F | C | Gm | Bb | A7 | A7 | Dm | Bb | F | C/E | Gm | Eb | Bb | C';
const SABI_MEL =
  'D5:2 A5:2 C6:3 B5:1 A5:8 | -:2 F5:2 G5:2 A5:2 Bb5:4 A5:2 G5:2 | A5:6 C6:2 F5:8 | -:2 E5:2 G5:2 C6:2 E6:4 D6:2 C6:2 | ' +
  'D6:6 Bb5:2 G5:4 A5:2 Bb5:2 | D6:6 C6:2 Bb5:4 F5:4 | E5:2 A5:2 C#6:3 B5:1 A5:8 | G5:4 F5:2 E5:2 C#5:4 E5:4 | ' +
  'D5:2 A5:2 C6:3 B5:1 A5:8 | -:2 F5:2 G5:2 A5:2 Bb5:4 D6:4 | C6:6 A5:2 F5:4 A5:4 | G5:6 E5:2 C5:4 E5:4 | ' +
  'Bb5:4 D6:4 F6:8 | Eb6:6 D6:2 Bb5:4 G5:4 | F5:4 Bb5:4 D6:8 | E6:8 C6:4 D6:4';
const SABI_STR =
  'F5:8 A5:8 | D5:8 F5:8 | C5:8 F5:8 | E5:8 G5:8 | D5:8 Bb4:8 | F5:8 D5:8 | C#5:8 E5:8 | G5:8 E5:8 | ' +
  'F5:8 A5:8 | D5:8 F5:8 | A5:8 F5:8 | E5:8 C5:8 | D5:8 G5:8 | Bb5:8 G5:8 | D5:8 F5:8 | G5:8 E5:8';

export const CITY: SongDef = {
  id: 'city',
  title: 'Crimson Scramble',
  bpm: 172,
  tonic: 50,
  scale: [0, 2, 3, 5, 7, 9, 10],
  order: ['intro', 'A', 'B', 'sabi', 'inter', 'breakdown', 'riser', 'sabi+2', 'tag'],
  loopAt: 0,
  climax: ['final', 'sabi+1', 'final+1', 'sabi+2'],
  sections: {
    intro: {
      bars: 8,
      chords: 'Dm | Dm | Dm | Dm | Bb | C | A7 | A7',
      gtr: `${RIFF_A} | ${RIFF_B} | ${RIFF_A} | ${RIFF_B} | ${KIME('Bb2')} | ${KIME('C3')} | A2:16 | A2:2m A2:2m A2:2m A2:2m A2:1m A2:1m A2:1m A2:1m A2:1m A2:1m A2:1m A2:1m`,
      bass: `-:16 | -:16 | ${RIFF_A} | ${RIFF_B} | ${KIME('Bb1')} | ${KIME('C2')} | A1:16 | A1:16`,
      brass: '-:16 | -:16 | -:16 | -:16 | -:16 | -:16 | A4:2 E5:2 G5:3 F5:1 E5:8 | -:12 A4:1 C#5:1 E5:1 G5:1',
      oct: true,
      hit: '................|................|................|................|H..H..H...H.H...|H..H..H...H.H...|H...............|................',
      timp: '................|................|................|................|................|................|r---------------|r-----------R...',
      drums: {
        h: 'x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.|................|................|................|................',
        k: 'X...............|X...............|X.....x.X.......|X.....x.X...x...|X..X..X...X.X...|X..X..X...X.X...|X...............|x...x...x.x.x.x.',
        s: '................|................|....x.......x...|....x.......x...|X..X..X...X.X...|X..X..X...X.X...|................|x.x.x.x.xxxxrrrr',
        c: '................|................|c...............|................|C..c..c...c.C...|C..c..c...c.C...|C...............|................',
      },
      minifill: false,
    },
    A: {
      bars: 16,
      chords: 'Dm | Dm | F | G | Dm | Dm | Bb | A | Dm | Dm | F | G | Dm | Dm | Bb | A7b9',
      brass:
        '-:4 D5:2 A5:2 C6:3 B5:1 A5:4 | _:4 G5:2 F5:2 E5:2 D5:6 | C5:6 F5:2 _:4 A5:4 | B5:6 A5:2 G5:4 D5:4 | ' +
        '-:4 D5:2 A5:2 C6:3 B5:1 A5:4 | _:4 C6:2 D6:2 E6:2 F6:6 | D6:6 C6:2 Bb5:4 F5:4 | E5:8 C#5:4 E5:4',
      lead: '-:16 | -:16 | -:16 | -:16 | -:16 | -:16 | -:16 | -:16 | -:16 | -:16 | -:16 | -:16 | -:16 | -:16 | -:16 | A4:1 Bb4:1 C#5:1 D5:1 E5:1 F5:1 G5:1 A5:1 Bb5:2^ A5:2 G5:2 F5:1 E5:1',
      stabs: '...X.......X....',
      strings: '1586515865158651',
      gtr: 'X-mmX-mmX-mmX-mm',
      bass: 'R-r-R-r-R-r-5-8-',
      drums: {
        h: 'X.x.X.x.X.x.X.x.',
        k: 'X...x...X...x...',
        s: '..x...x...x...x.',
        c: 'C...............|................|................|................|c...............|................|................|................',
      },
      gate: { strings: 0.45, stabs: 0.3 },
    },
    B: {
      bars: 8,
      chords: 'Bb | Bdim7 | C | C#dim7 | Dm | Dm/C | Bb | A7sus4:8 A7:8',
      brass: 'D5:6 F5:2 Bb5:8 | D5:6 F5:2 Ab5:8 | E5:6 G5:2 C6:8 | E5:6 G5:2 Bb5:8 | F5:4 A5:4 D6:8 | C6:4 A5:4 F5:8 | D6:4 C6:2 Bb5:2 F5:8 | D6:8 C#6:4 E6:2 -:2',
      brass2: 'F4:16 | F4:16 | G4:16 | G4:16 | A4:16 | A4:16 | F4:16 | E4:16',
      strings: '1313131313131313',
      pad: 'strings',
      gtr: 'X-x-x-x-X-x-x-x-',
      bass: 'R-r-r-r-R-r-r-r-',
      drums: {
        h: 'x.x.x.x.x.x.x.x.',
        k: 'X.....x.X.......',
        s: '....x.......x...',
        t: '................|................|................|................|................|................|....1.1.2.2.3.3.|................',
        c: 'c...............|................|................|................|c...............|................|................|................',
      },
      fill: 'breath',
      gate: { strings: 0.5 },
    },
    sabi: {
      bars: 16,
      chords: SABI_CHORDS,
      brass: SABI_MEL,
      oct: true,
      strings: SABI_STR,
      pad: 'choir',
      gtr: 'X-x-x-x-X-x-x-x-',
      bass: 'R-r-R-r-R-r-5-8-',
      drums: {
        h: 'XxxxXxxxXxxxXxxx',
        k: 'X.....X.X.....X.',
        s: '....x.......x...',
        c: 'C...............|................|................|................',
      },
      fill: 'big|toms',
      gate: { strings: 0.4 },
    },
    inter: {
      bars: 4,
      chords: 'D | D | Bb | A7',
      hit: 'H..H..H...H.H...|H..H..H...H.H...|H.......H.......|H...............',
      gtr: `${KIME('D2')} | ${KIME('D2')} | Bb2:8 Bb2:8 | A2:16`,
      bass: `${KIME('D2')} | ${KIME('D2')} | Bb1:8 Bb1:8 | A1:16`,
      brass: '-:16 | -:16 | Bb4:2 F5:2 Ab5:3 G5:1 F5:8 | G5:4 E5:4 C#5:4 A4:4',
      oct: true,
      drums: {
        k: 'X..X..X...X.X...|X..X..X...X.X...|X.......X.......|X...x...x.x.xxxx',
        s: 'X..X..X...X.X...|X..X..X...X.X...|X.......X.......|....x...x.x.xxxx',
        c: 'C..c..c...c.C...|C..c..c...c.C...|C.......c.......|C...............',
      },
      minifill: false,
    },
    breakdown: {
      bars: 8,
      chords: 'Dm/A | Bb/A | Gm/A | A | Dm/A | Bb/A | Gm/A | A7b9',
      brass2: 'A4:4 Bb4:4 C#5:6 D5:2 | E5:4 D5:2 C#5:2 Bb4:8 | D5:4 Bb4:4 G4:6 A4:2 | Bb4:4 A4:4 G4:2 F4:2 E4:4 | -:16 | -:16 | -:16 | -:16',
      brass: '-:16 | -:16 | -:16 | -:16 | A5:4 Bb5:4 C#6:6 D6:2 | E6:4 D6:2 C#6:2 Bb5:8 | D6:4 Bb5:4 G5:6 A5:2 | Bb5:4 A5:4 G5:4 C#5:4',
      pad: 'choir',
      gtr: 'X---------------',
      bass: 'R-------R-------',
      timp: 'R.......5.......',
      drums: {
        k: 'X.........x.....',
        s: '........x.......',
        t: 'k...............',
        c: 'C...............|................|................|................|c...............|................|................|................',
      },
      fill: 'half',
      minifill: false,
      mix: { gtr: 0.7 },
    },
    riser: {
      bars: 4,
      chords: 'Dm | Fm | Abm | B7',
      brass: 'D4:2 A4:2 C5:3 B4:1 A4:8 | F4:2 C5:2 Eb5:3 D5:1 C5:8 | Ab4:2 Eb5:2 Gb5:3 F5:1 Eb5:8 | B4:2 F#5:2 A5:3 G#5:1 F#5:8',
      oct: true,
      strings: '1111111111111111',
      gtr: 'X---------------',
      bass: 'R-------R-------',
      timp: 'r---------------',
      drums: {
        k: 'X...X...X...X...|X...X...X...X...|X...X...X...X...|X...X...X.......',
        s: 'x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx|rrrrrrrrrrrrrrrr|rrrrrrrrrrrr....',
        c: 'C...............|c...............|c...............|................',
      },
      minifill: false,
    },
    tag: {
      bars: 2,
      chords: 'E | A7',
      hit: 'H...............|H.....H.....H...',
      brass: 'E5:16 | E5:4 C#5:4 A4:4 G4:4',
      oct: true,
      gtr: 'X---------------|X.....X.....X...',
      bass: 'R---------------|R.....R.....R...',
      drums: {
        k: 'X...............|X.....X.....X...',
        s: '................|X.....X.....X.rr',
        c: 'C...............|C.....c.....c...',
      },
      minifill: false,
    },
    // final minute: double kick, china, the motif upside down in the horns answered by trumpets
    final: {
      bars: 8,
      chords: 'Dm | Eb/D | Dm | Eb/D | Bb | C | A7 | A7',
      brass2: 'D4:2 G3:2 E3:3 F3:1 G3:8 | -:16 | D4:2 G3:2 E3:3 F3:1 G3:8 | -:16 | Bb3:16 | C4:16 | C#4:16 | E4:16',
      brass: '-:16 | Eb5:2 Bb5:2 Db6:3 C6:1 Bb5:8 | -:16 | Eb5:2 Bb5:2 Db6:3 C6:1 Bb5:8 | D6:4 C6:4 Bb5:4 F5:4 | E6:4 D6:4 C6:4 G5:4 | C#6:8 E6:8 | E6:4 C#6:4 A5:4 G5:4',
      strings: '1586515865158651',
      pad: 'choir',
      gtr: 'MmmmMmmmMmmmMmmm|MmmmMmmmMmmmMmmm|MmmmMmmmMmmmMmmm|MmmmMmmmMmmmMmmm|X-x-x-x-X-x-x-x-|X-x-x-x-X-x-x-x-|X-x-x-x-X-x-x-x-|X-x-x-x-X-x-x-x-',
      bass: 'R-r-r-r-R-r-r-r-',
      timp: 'R.5.R.5.R.5.R.5.',
      drums: {
        k: 'xxxxxxxxxxxxxxxx',
        s: '....X.......X...',
        c: 'C...n...n...n...|n...n...n...n...',
      },
      minifill: false,
      mix: { gtr: 0.85 },
    },
  },
};
