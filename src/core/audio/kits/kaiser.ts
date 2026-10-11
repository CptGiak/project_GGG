/**
 * KAISER, "Bassline": a holographic greatsword played like a bass guitar.
 *
 * Timbre family: low saw/triangle bass notes on the score's chord root (octaves 2-3, octave 1 and
 * real sub only in the ultimate), a filter wobble on the heavy moves, power chords through gentle
 * drive. The blade itself is a low-mid air sweep with a faint holo hum; nothing of his lives above
 * ~4 kHz.
 */
import { boom, chordHz, click, crunch, hiss, ring, signature, smack, stab, surface, swell, thump, whoosh, type SfxCtx, type SfxDef } from '../layers';

/** a bass note on the chord root: saw through a low-pass that closes, optional pitch glide */
function bass(c: SfxCtx, o: { oct: number; dur: number; vol: number; at?: number; to?: number; cutoff?: number; deg?: number }): void {
  const f = chordHz(c.h, o.deg ?? 0, o.oct);
  const lp = c.g.filter('lowpass', o.cutoff ?? 900, 1.4, c.g.filter('highpass', 45, 0.7, c.out));
  const t = c.t + (o.at ?? 0);
  lp.frequency.setValueAtTime(o.cutoff ?? 900, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(120, (o.cutoff ?? 900) * 0.25), t + o.dur);
  for (const d of [-5, 5]) c.g.tone({ type: 'sawtooth', f, f1: o.to ? f * o.to : undefined, glide: o.dur * 0.7, t, dur: o.dur, vol: o.vol * 0.5, a: 0.004, detune: d, out: lp });
}

/** the holo blade's hum riding the swing: a band-passed saw that sweeps with the arc */
function holo(c: SfxCtx, dur: number, vol: number, step = 0): void {
  const f = chordHz(c.h, step % 3, 3);
  const bp = c.g.filter('bandpass', 500, 2.5, c.out);
  bp.frequency.setValueAtTime(400, c.t);
  bp.frequency.exponentialRampToValueAtTime(1400, c.t + dur * 0.45);
  bp.frequency.exponentialRampToValueAtTime(450, c.t + dur);
  c.g.tone({ type: 'sawtooth', f, t: c.t, dur, vol, a: dur * 0.3, out: bp });
}

export const KAISER: Record<string, SfxDef> = {
  // Verse Combo, swings 1-2: a broad blade sweep with the holo hum (steps up on the second)
  'kaiser.swing': {
    cat: 'basic',
    dur: 0.32,
    max: 3,
    combo: 0.9,
    fn: (c) => {
      whoosh(c, { f0: 320, f1: 1300, f2: 420, dur: 0.26, q: 1.3, vol: 0.5, peak: 0.42 });
      holo(c, 0.24, 0.07, c.step);
    },
  },
  // the third swing, the air cleave and the chord's wind-up: bigger, with the bass wobble
  'kaiser.swingHeavy': {
    cat: 'basic',
    lvl: 3,
    dur: 0.5,
    max: 3,
    fn: (c) => {
      whoosh(c, { f0: 240, f1: 1000, f2: 300, dur: 0.38, q: 1.2, vol: 0.55, peak: 0.45 });
      holo(c, 0.36, 0.08, 2);
      signature(c, 'heavy', 'kaiser');
    },
  },
  // the third swing's ground pound: a bass "dun" under a thump
  'kaiser.shock': {
    cat: 'skill',
    lvl: -2,
    dur: 0.6,
    max: 2,
    fn: (c) => {
      thump(c, { f0: 150, f1: 80, dur: 0.22, vol: 0.75 });
      crunch(c, { f: 1000, f1: 180, dur: 0.22, vol: 0.3 });
      bass(c, { oct: 2, dur: 0.35, vol: 0.3, cutoff: 700 });
      surface(c, 0.6);
    },
  },
  // Power Chord: the slam lands a distorted power chord on the score's root
  'kaiser.chord': {
    cat: 'skill',
    lvl: 2,
    dur: 1,
    max: 2,
    duck: 2,
    rev: 1.2,
    fn: (c) => {
      const r = chordHz(c.h, 0, 2);
      stab(c, { notes: [r, r * 1.4983, r * 2], dur: 0.75, vol: 0.4, cutoff: 900, open: 2600, drive: 2.2, a: 0.003 });
      bass(c, { oct: 2, dur: 0.6, vol: 0.4, cutoff: 600 });
      thump(c, { f0: 130, f1: 75, dur: 0.3, vol: 0.7 });
      smack(c, { f: 900, q: 0.9, dur: 0.06, vol: 0.4, drop: 0.5 });
      crunch(c, { f: 1300, f1: 200, dur: 0.35, vol: 0.3 });
      click(c, { f: 2400, dur: 0.006, vol: 0.12 });
    },
  },
  // the wave's sweet spot lights up: a higher fifth answers, with a punch
  'kaiser.chordTip': {
    cat: 'skill',
    lvl: -1,
    dur: 0.6,
    max: 2,
    fn: (c) => {
      const r = chordHz(c.h, 0, 3);
      stab(c, { notes: [r, r * 1.4983], dur: 0.35, vol: 0.3, cutoff: 1400, open: 3200, drive: 1.6 });
      thump(c, { f0: 170, f1: 85, dur: 0.16, vol: 0.6 });
      smack(c, { f: 1200, q: 1, dur: 0.04, vol: 0.3, drop: 0.5 });
    },
  },
  // Mute Guard raised: a palm-muted bass "chk" and the shield humming on
  'kaiser.guard': {
    cat: 'skill',
    lvl: -8,
    dur: 0.3,
    max: 2,
    fn: (c) => {
      bass(c, { oct: 3, dur: 0.07, vol: 0.4, cutoff: 900 });
      smack(c, { f: 700, q: 2, dur: 0.02, vol: 0.25, drop: 0.8 });
      ring(c, { f: 420, decay: 0.25, vol: 0.05, bright: 0.2, ratios: [1, 2.4] });
      hiss(c, { f: 900, f1: 1400, q: 2, dur: 0.2, vol: 0.05, a: 0.06 });
    },
  },
  // Riposte: out of the parry, a lunge and a bass slide up into the hit
  'kaiser.riposte': {
    cat: 'skill',
    lvl: 1,
    dur: 0.5,
    max: 2,
    fn: (c) => {
      swell(c, 0.04, 600, 2000, 0.15);
      whoosh(c, { f0: 500, f1: 2000, f2: 600, dur: 0.22, q: 1.5, vol: 0.45, peak: 0.25, at: 0.03 });
      bass(c, { oct: 2, dur: 0.3, vol: 0.4, to: 2, cutoff: 1200, at: 0.02 });
      thump(c, { f0: 160, f1: 70, dur: 0.1, vol: 0.35, at: 0.03 });
    },
  },
  // Drop Dive: gas fires, the body becomes a missile, the bass drops an octave under it
  'kaiser.dive': {
    cat: 'skill',
    dur: 0.7,
    max: 2,
    fn: (c) => {
      hiss(c, { f: 1100, f1: 700, q: 0.8, dur: 0.18, vol: 0.3, a: 0.004 });
      thump(c, { f0: 170, f1: 70, dur: 0.1, vol: 0.45 });
      whoosh(c, { f0: 300, f1: 1500, f2: 400, dur: 0.45, q: 1.2, vol: 0.5, peak: 0.3, at: 0.04 });
      bass(c, { oct: 3, dur: 0.5, vol: 0.35, to: 0.5, cutoff: 1000, at: 0.04 });
      signature(c, 'heavy', 'kaiser');
    },
  },
  // Encore Break, the rise: a wobble riser that speeds up as he climbs
  'kaiser.ultRise': {
    cat: 'ult',
    dur: 1.2,
    max: 2,
    duck: 4,
    rev: 1.2,
    fn: (c) => {
      const dur = 0.7;
      const r = chordHz(c.h, 0, 2);
      const lp = c.g.filter('lowpass', 200, 6, c.g.filter('highpass', 45, 0.7, c.out));
      let at = 0;
      for (let i = 0; at < dur; i++) {
        const rate = 4 + (at / dur) * 10;
        lp.frequency.setTargetAtTime(1800 + at * 1500, c.t + at, 0.01);
        lp.frequency.setTargetAtTime(220, c.t + at + 0.5 / rate, 0.02);
        at += 1 / rate;
      }
      for (const d of [-6, 6]) c.g.tone({ type: 'sawtooth', f: r, f1: r * 2.5, glide: dur, t: c.t, dur: dur + 0.1, vol: 0.3, a: 0.02, detune: d, out: lp });
      swell(c, dur, 300, 3000, 0.25);
      hiss(c, { f: 1000, f1: 600, q: 0.8, dur: 0.2, vol: 0.25, a: 0.004 });
      thump(c, { f0: 140, f1: 60, dur: 0.15, vol: 0.45 });
      if (!c.self) stab(c, { notes: [chordHz(c.h, 0, 2), chordHz(c.h, 0, 2) * 1.06], dur: 0.9, vol: 0.18, at: 0.3, cutoff: 600, open: 900 });
    },
  },
  // Encore Break, the drop: the crater, the power chord and the sub all at once
  'kaiser.ultSlam': {
    cat: 'ult',
    lvl: 1,
    dur: 2,
    max: 2,
    duck: 5,
    rev: 1.3,
    fn: (c) => {
      boom(c, 1.1, 0.9);
      const r = chordHz(c.h, 0, 2);
      stab(c, { notes: [r, r * 1.4983, r * 2, r * 3], dur: 1.1, vol: 0.4, cutoff: 800, open: 3000, drive: 2.4 });
      bass(c, { oct: 1, dur: 1, vol: 0.45, cutoff: 400, to: 0.5 });
      signature(c, 'ult', 'kaiser');
    },
  },
};
