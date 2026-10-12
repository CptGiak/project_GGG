/**
 * Validates the soundtrack score: every bar of every part adds up, every chord parses, and the
 * melodies stay in their instrument's range. Also lists held notes on beats 1 and 3 that rub a
 * minor second against the chord, so wrong notes are caught before anyone listens.
 *
 *   npx tsx tools/audio/check_songs.ts
 */
import { SONGS } from '../../src/core/audio/songs';
import { chordAt, compileSong } from '../../src/core/audio/score';

const RANGES: Record<string, [number, number]> = {
  brass: [52, 91], brass2: [43, 79], synth: [57, 93], lead: [52, 91], choir: [48, 79], strings: [55, 93], bells: [72, 103],
};
const name = (m: number) => ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
let problems = 0;
let warnings = 0;
for (const song of Object.values(SONGS)) {
  let secs;
  try {
    secs = compileSong(song);
  } catch (e) {
    console.log(`ERROR ${(e as Error).message}`);
    problems++;
    continue;
  }
  let bars = 0;
  for (const entry of song.order) bars += secs.get(entry)!.bars;
  const seconds = (bars * 4 * 60) / song.bpm;
  console.log(`${song.id.padEnd(9)} ${song.title.padEnd(18)} ${song.bpm} BPM  ${bars} bars  ${seconds.toFixed(0)} s`);
  for (const [entry, sec] of secs) {
    for (const [track, evs] of Object.entries(sec.tracks)) {
      const range = RANGES[track];
      for (const ev of evs ?? []) {
        if (range && sec.def[track as 'brass'] && /[A-G]/.test(sec.def[track as 'brass'] as string))
          for (const n of ev.notes)
            if (n < range[0] || n > range[1]) {
              console.log(`  range  ${song.id}.${entry}.${track} bar ${Math.floor(ev.step / 16) + 1}: ${name(n)}`);
              warnings++;
            }
        // clash check on strong beats for melodic lines
        // only notes held on the strong beats (1 and 3); passing tones are the composer's business
        if (!range || ev.step % 8 !== 0 || ev.len < 3) continue;
        if (!(sec.def[track as 'brass'] && /[A-G]/.test(sec.def[track as 'brass'] as string))) continue;
        const c = chordAt(sec.chords, ev.step);
        const pcs = c.tones.map((t) => (c.root + t) % 12);
        for (const n of ev.notes) {
          const pc = ((n % 12) + 12) % 12;
          if (pcs.includes(pc)) continue;
          const clash = pcs.some((t) => Math.abs(((pc - t + 12) % 12)) === 1 || Math.abs(((t - pc + 12) % 12)) === 1);
          if (clash) {
            console.log(`  clash  ${song.id}.${entry}.${track} bar ${Math.floor(ev.step / 16) + 1} beat ${((ev.step % 16) / 4) + 1}: ${name(n)} over ${c.name}`);
            warnings++;
          }
        }
      }
    }
  }
}
console.log(problems ? `${problems} errors` : 'score OK', warnings ? `(${warnings} warnings)` : '');
process.exit(problems ? 1 : 0);
