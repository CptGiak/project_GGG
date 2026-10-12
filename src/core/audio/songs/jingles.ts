/**
 * Short cues: the victory fanfare (the motif finally resolves upward to the octave), the defeat
 * lament, and the calm results-screen loop.
 */
import type { SongDef } from '../score';

export const JINGLES: Record<string, SongDef> = {
  victory: {
    id: 'victory',
    title: 'Victory',
    bpm: 126,
    tonic: 50,
    scale: [0, 2, 4, 5, 7, 9, 11],
    once: true,
    order: ['fanfare'],
    loopAt: 0,
    sections: {
      fanfare: {
        bars: 5,
        chords: 'A | D:8 G/D:8 | Bb:8 C:8 | Dadd9 | Dadd9',
        brass: '-:12 A4:2 C#5:2 | D5:2 A5:2 C6:3 B5:1 D6:8 | D5:4 F5:4 E5:4 G5:4 | F#5:16~ | -:16',
        brass2: '-:16 | A4:2 F#5:2 A5:3 G5:1 B5:8 | Bb4:4 D5:4 C5:4 E5:4 | D5:16 | -:16',
        oct: true,
        strings: '-:16 | -:16 | -:16 | D5:1 E5:1 F#5:1 G5:1 A5:1 B5:1 C#6:1 D6:9 | -:16',
        hit: '................|................|H...H...H...H...|H...............|................',
        pad: 'both',
        timp: 'R...............|................|R...R...R...R...|r-----------....|................',
        drums: {
          s: '....x.x.xxxxrrrr|................|x...x...x...x...|................|................',
          k: 'X...............|X.......x.......|X...X...X...X...|X...............|................',
          c: '................|C...............|c...............|C...............|................',
        },
        minifill: false,
      },
    },
  },
  defeat: {
    id: 'defeat',
    title: 'Defeat',
    bpm: 84,
    tonic: 50,
    scale: [0, 2, 3, 5, 7, 8, 10],
    once: true,
    order: ['lament'],
    loopAt: 0,
    sections: {
      lament: {
        bars: 5,
        chords: 'Dm | Bb | Gm6 | A7b9:8 Dm:8 | Dm:16',
        brass2: 'A4:8 F4:8 | F4:8 D4:8 | E4:8 Bb4:8 | C#5:8 D5:8~ | -:16',
        pad: 'strings',
        bass: 'R---------------|R---------------|R---------------|R-------R-------|R---------------',
        timp: 'R...............|................|................|R.......R.......|................',
        bells: '-:16 | -:16 | -:16 | -:8 A5:8 | D5:16',
        minifill: false,
      },
    },
  },
  results: {
    id: 'results',
    title: 'After the Hour',
    bpm: 96,
    tonic: 50,
    scale: [0, 2, 4, 5, 7, 9, 11],
    order: ['loop'],
    loopAt: 0,
    sections: {
      loop: {
        bars: 8,
        chords: 'D | G/D | Bm7 | G | Em7 | A7sus4 | D | D',
        bells: 'F#6:8 A6:8 | G6:8 B6:8 | F#6:8 D6:8 | B5:8 D6:8 | G6:8 E6:8 | E6:16 | F#6:16 | -:16',
        strings: '1.3.5.8.5.3.1.5.',
        pad: 'strings',
        bass: 'R-------5-------',
        drums: {
          h: 'r...r...r...r...',
          k: 'x.......x.......',
          s: '....c.......c...',
        },
        minifill: false,
        mix: { pad: 0.6 },
      },
    },
  },
};
