/**
 * ELISABBAT, "La Principessa Vampira": velvet claws, bats and blood.
 *
 * Timbre family: leathery wing beats (band-passed pink pulses on one voice), velvet whooshes (low
 * Q, dark), claw rakes (three quick band-passed scratches), breath through vowel formants instead
 * of raw hiss, gulps through a throat formant, and dark harmony: open fifths and the chord's own
 * tones low in the register, a pipe-organ chord for the ultimate. Bats squeak under ~3.5 kHz,
 * quietly. Her basic attacks live in 300 Hz-2 kHz.
 */
import { bell, blip, chordHz, crunch, mallet, rr, semi, smack, swell, thump, whoosh, type SfxCtx, type SfxDef } from '../layers';

/**
 * Wraps a recipe: every play moves its level a little (+/- db) so repeats never measure the same,
 * and the whole voice sits under a gentle low-pass (nothing of hers lives above ~5 kHz: noise
 * skirts and partials stop there instead of turning into hiss).
 */
const V =
  (fn: (c: SfxCtx) => void, db = 1.2, top = 5000) =>
  (c: SfxCtx): void =>
    fn({ ...c, out: c.g.gain(Math.pow(10, rr(c, -db, db) / 20), c.g.filter('lowpass', top, 0.6, c.out)) });

interface Pulse {
  t: number;
  f: number;
  f1?: number;
  v: number;
}

/**
 * Short band-passed noise pulses on ONE voice (3 nodes however many): each pulse retunes the band,
 * rises in `atk` and decays; the gain carries on from what the last pulse left (no clicks).
 */
function pulses(c: SfxCtx, ps: Pulse[], o: { q: number; len: number; atk: number }): void {
  const g = c.g;
  const t0 = ps[0].t;
  const end = ps[ps.length - 1].t + o.len * 4;
  const src = g.noiseSrc('pink', t0, end - t0);
  const bp = g.filter('bandpass', ps[0].f, o.q);
  const env = g.gain(0);
  src.connect(bp).connect(env).connect(c.out);
  const tau = Math.max(0.002, (o.len - o.atk) * 0.4);
  env.gain.setValueAtTime(0, t0);
  let peak = 0;
  let peakT = t0;
  ps.forEach((p, i) => {
    const next = ps[i + 1]?.t ?? Infinity;
    bp.frequency.setValueAtTime(p.f, p.t);
    if (p.f1 !== undefined) bp.frequency.exponentialRampToValueAtTime(p.f1, Math.min(p.t + o.len, next - 0.0005));
    env.gain.setValueAtTime(peak * Math.exp(-(p.t - peakT) / tau), p.t);
    env.gain.linearRampToValueAtTime(p.v, p.t + o.atk);
    env.gain.setTargetAtTime(0, p.t + o.atk, tau);
    peak = p.v;
    peakT = p.t + o.atk;
  });
}

/** leathery wing beats: `n` pushes of air every ~`rate` s (`accel` < 1 speeds them up), the band
 *  moving from f to f1 and the level fading by `fade` over the run */
function wings(c: SfxCtx, o: { n: number; rate: number; f: number; f1?: number; q?: number; vol: number; at?: number; accel?: number; fade?: number; len?: number }): void {
  const ps: Pulse[] = [];
  let t = c.t + (o.at ?? 0);
  let per = o.rate;
  for (let i = 0; i < o.n; i++) {
    const k = o.n > 1 ? i / (o.n - 1) : 0;
    const f = (o.f + ((o.f1 ?? o.f) - o.f) * k) * c.p * rr(c, 0.88, 1.12);
    ps.push({ t, f, f1: f * 0.8, v: o.vol * rr(c, 0.65, 1) * (1 - (o.fade ?? 0) * k) });
    t += per * rr(c, 0.86, 1.14);
    per *= o.accel ?? 1;
  }
  const len = o.len ?? 0.032;
  pulses(c, ps, { q: o.q ?? 1.7, len, atk: len * 0.28 });
}

/** claws raking: `n` quick scratches, each nail a little higher, dragging down as it goes */
function rake(c: SfxCtx, o: { f: number; vol: number; at?: number; n?: number; gap?: number; q?: number }): void {
  const ps: Pulse[] = [];
  let t = c.t + (o.at ?? 0);
  for (let i = 0; i < (o.n ?? 3); i++) {
    const f = o.f * c.p * rr(c, 0.95, 1.05) * (1 + i * 0.07);
    ps.push({ t, f, f1: f * 0.72, v: o.vol * rr(c, 0.75, 1) });
    t += (o.gap ?? 0.013) * rr(c, 0.85, 1.15);
  }
  pulses(c, ps, { q: o.q ?? 3, len: 0.017, atk: 0.0025 });
}

/** a bat squeak: a quick sine chirp, kept under ~3.4 kHz */
function squeak(c: SfxCtx, f: number, vol: number, at = 0): void {
  const d = rr(c, 0.035, 0.055);
  c.g.tone({ f: Math.min(3400, f * 1.08), f1: f * 0.8, glide: d, t: c.t + at, dur: d, vol, a: 0.004, out: c.out });
}

/** breath through vowel formants: a whispered "haah" (her hiss), soft pink noise only */
function breath(c: SfxCtx, o: { dur: number; vol: number; at?: number; vowel?: 'a' | 'e' | 'o'; shift?: number; a?: number }): void {
  const g = c.g;
  const t = c.t + (o.at ?? 0);
  const F: Record<string, [number, number, number][]> = {
    a: [[760, 6, 1], [1180, 7, 0.6], [2450, 9, 0.16]],
    e: [[460, 6, 1], [1850, 8, 0.45], [2500, 9, 0.18]],
    o: [[480, 6, 1], [840, 7, 0.5], [2450, 9, 0.08]],
  };
  const src = g.noiseSrc('pink', t, o.dur);
  const env = g.gain(0, c.out);
  g.envelope(env.gain, t, o.vol, o.a ?? o.dur * 0.3, o.dur);
  for (const [f0, q, k] of F[o.vowel ?? 'a']) {
    const f = f0 * c.p;
    const bp = g.filter('bandpass', f, q);
    bp.frequency.setValueAtTime(f, t);
    if (o.shift) bp.frequency.exponentialRampToValueAtTime(f * o.shift, t + o.dur);
    src.connect(bp).connect(g.gain(k * 2.2, env));
  }
}

/** gulps: a throat formant on pink noise (one voice) with a bubble rising under each */
function gulps(c: SfxCtx, at: number[], vol: number): void {
  pulses(
    c,
    at.map((a, i) => {
      const f = rr(c, 430, 520) * (1 + i * 0.04);
      return { t: c.t + a, f, f1: f * 0.8, v: vol };
    }),
    { q: 3.2, len: 0.06, atk: 0.007 },
  );
  at.forEach((a, i) => c.g.tone({ f: rr(c, 150, 175) * (1 + i * 0.05), f1: rr(c, 250, 300), glide: 0.035, t: c.t + a + 0.004, dur: 0.07, vol: vol * 0.7, a: 0.004, out: c.out }));
}

/** a pipe-organ chord: drawbar harmonics, a breath of attack, a hold and a slow release */
function organ(c: SfxCtx, o: { notes: number[]; dur: number; vol: number; at?: number; cutoff?: number; a?: number; hold?: number }): void {
  const g = c.g;
  const wave = g.periodic('elisabbat.organ', [1, 0.75, 0.5, 0.55, 0.15, 0.3, 0.05, 0.22]);
  const lp = g.filter('lowpass', o.cutoff ?? 1500, 0.6, c.out);
  const each = o.vol / Math.sqrt(o.notes.length);
  o.notes.forEach((f, i) => g.tone({ wave, f, t: c.t + (o.at ?? 0), dur: o.dur, vol: each, a: o.a ?? 0.025, hold: o.hold ?? o.dur * 0.3, detune: i % 2 ? 3 : -3, out: lp }));
}

/** a sustained low pedal (root and fifth of the chord) faded in and out linearly, so grains played
 *  back to back join into one drone */
function pedal(c: SfxCtx, o: { dur: number; vol: number; fadeIn: number; fadeOut: number; cutoff?: number }): void {
  const g = c.g;
  const t = c.t;
  const env = g.gain(0, g.filter('lowpass', o.cutoff ?? 500, 0.7, c.out));
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(o.vol, t + o.fadeIn);
  env.gain.setValueAtTime(o.vol, t + o.dur - o.fadeOut);
  env.gain.linearRampToValueAtTime(0, t + o.dur);
  for (const i of [0, 2]) g.tone({ type: 'sawtooth', f: chordHz(c.h, i, 3), t, dur: o.dur + 0.02, vol: 0.5, a: 0.01, hold: o.dur, detune: rr(c, -6, 6), out: env });
}

export const ELISABBAT: Record<string, SfxDef> = {
  // Artigli di Velluto, swipes 1-2 and the air dive: a soft, dark velvet sweep, three nails raking
  // the air and the flick of a sleeve; each swipe of a string rakes a little higher
  'elisabbat.claw': {
    cat: 'basic',
    dur: 0.24,
    max: 3,
    combo: 0.8,
    fn: V((c) => {
      whoosh(c, { f0: 360, f1: 1050, f2: 480, dur: rr(c, 0.15, 0.18), q: 1.3, vol: 0.42, peak: 0.3, edge: 0.18 });
      rake(c, { f: 1250 * semi(Math.min(c.step, 2) * 1.5), vol: 0.22, at: 0.018 });
      wings(c, { n: 1, rate: 0.04, f: 650, vol: 0.12 });
    }),
  },
  // the third swipe, the X: the arms cross high (the cape swirls) and slash down and out, two rakes
  // crossing in a fuller sweep, a dark fall from the chord's fifth to its root under it
  'elisabbat.clawX': {
    cat: 'basic',
    lvl: 3,
    dur: 0.42,
    max: 2,
    fn: V((c) => {
      wings(c, { n: 2, rate: 0.05, f: 620, vol: 0.14 });
      whoosh(c, { f0: 300, f1: 1100, f2: 380, dur: 0.3, q: 1.1, vol: 0.5, peak: 0.3, at: 0.03, edge: 0.3 });
      rake(c, { f: 1150, vol: 0.22, at: 0.07 });
      rake(c, { f: 1500, vol: 0.18, at: 0.086 });
      blip(c, { type: 'triangle', f: chordHz(c.h, 2, 3), f1: chordHz(c.h, 0, 3), glide: 0.16, dur: 0.24, vol: 0.14, at: 0.07, a: 0.006, out: c.g.filter('lowpass', 700, 0.8, c.out) });
    }),
  },
  // Spellvamp, the pounce: a whispered hiss through a vowel, the cape kicking off, a velvet rush
  // rising toward the prey over a dark root-to-fifth glide
  'elisabbat.lunge': {
    cat: 'skill',
    dur: 0.5,
    max: 2,
    fn: V((c) => {
      breath(c, { dur: 0.3, vol: 0.32, vowel: 'a', shift: 1.15, a: 0.04 });
      wings(c, { n: 2, rate: 0.06, f: 600, vol: 0.2, at: 0.01 });
      whoosh(c, { f0: 300, f1: 1400, f2: 500, dur: 0.36, q: 1.3, vol: 0.45, peak: 0.55, at: 0.04, edge: 0.25 });
      thump(c, { f0: 210, f1: 135, dur: 0.07, vol: 0.22, at: 0.02, a: 0.004 });
      blip(c, { f: chordHz(c.h, 0, 3), f1: chordHz(c.h, 2, 3), glide: 0.3, dur: 0.34, vol: 0.08, a: 0.06, at: 0.03 });
    }),
  },
  // the fangs are in (the bite's own hit plays first): three gulps through the throat while a low,
  // dark tone swells with the life she takes
  'elisabbat.drink': {
    cat: 'skill',
    lvl: -2,
    dur: 0.55,
    max: 2,
    fn: V((c) => {
      gulps(c, [0.11 + rr(c, 0, 0.015), 0.22 + rr(c, -0.01, 0.015), 0.33 + rr(c, -0.01, 0.012)], 0.4);
      c.g.tone({ f: chordHz(c.h, 0, 3), f1: chordHz(c.h, 1, 3), glide: 0.35, t: c.t + 0.08, dur: 0.4, vol: 0.07, a: 0.12, vib: [12, 5], out: c.g.filter('lowpass', 600, 0.7, c.out) });
      swell(c, 0.3, 300, 800, 0.05, 'pink', 0.08);
    }),
  },
  // the drink heals her (her own 2D confirm): a sated breath out and a dark chime up the chord
  'elisabbat.heal': {
    cat: 'confirm',
    lvl: -2,
    dur: 0.6,
    max: 1,
    vary: 0.01,
    fn: V((c) => {
      breath(c, { dur: 0.28, vol: 0.2, vowel: 'o', shift: 0.85, a: 0.02 });
      [0, 1, 2].forEach((d, i) => mallet(c, chordHz(c.h, d, 4), 0.25, 0.16, 0.03 + i * 0.06));
      bell(c, chordHz(c.h, 0, 5), 0.4, 0.08, 0.2, 0.4);
    }),
  },
  // Spellvamp caught on a guard or dodged: the jaws snap shut on nothing
  'elisabbat.snap': {
    cat: 'skill',
    lvl: -4,
    dur: 0.2,
    max: 2,
    fn: V((c) => {
      smack(c, { f: 1700, q: 4, dur: 0.012, vol: 0.4, drop: 0.85 });
      smack(c, { f: 1400, q: 4, dur: 0.014, vol: 0.35, at: 0.028, drop: 0.85 });
      thump(c, { f0: 260, f1: 180, dur: 0.03, vol: 0.2, at: 0.028 });
      breath(c, { dur: 0.12, vol: 0.1, vowel: 'e', at: 0.04, a: 0.01 });
    }),
  },
  // Forma di Pipistrello: she bursts into a bat, a velvet puff, wing beats speeding up as she
  // shrinks, two squeaks and a quick roll up the chord
  'elisabbat.batIn': {
    cat: 'skill',
    dur: 0.7,
    max: 2,
    fn: V((c) => {
      swell(c, 0.07, 400, 1400, 0.12);
      whoosh(c, { f0: 260, f1: 900, f2: 340, dur: 0.3, q: 0.9, vol: 0.42, peak: 0.25, at: 0.05, edge: 0.15 });
      wings(c, { n: 8, rate: 0.055, accel: 0.9, f: 700, f1: 1050, vol: 0.28, at: 0.08 });
      squeak(c, rr(c, 2500, 3000), 0.018, 0.24);
      squeak(c, rr(c, 2200, 2600), 0.013, 0.36);
      [0, 1, 2].forEach((d, i) => blip(c, { type: 'triangle', f: chordHz(c.h, d, 4), dur: 0.14, vol: 0.06, at: 0.06 + i * 0.035, a: 0.005 }));
    }),
  },
  // and back: the beats slow down and widen, the cloak settles, the roll falls
  'elisabbat.batOut': {
    cat: 'skill',
    lvl: -1,
    dur: 0.6,
    max: 2,
    fn: V((c) => {
      wings(c, { n: 5, rate: 0.035, accel: 1.25, f: 1200, f1: 650, vol: 0.26 });
      whoosh(c, { f0: 700, f1: 600, f2: 220, dur: 0.32, q: 0.9, vol: 0.4, peak: 0.2, at: 0.06, edge: 0.15 });
      thump(c, { f0: 180, f1: 110, dur: 0.1, vol: 0.28, at: 0.12, a: 0.004 });
      [2, 1, 0].forEach((d, i) => blip(c, { type: 'triangle', f: chordHz(c.h, d, 4), dur: 0.14, vol: 0.06, at: 0.05 + i * 0.04, a: 0.005 }));
    }),
  },
  // flying as a bat (a grain every ~0.2 s while the form lasts): small leathery beats and, now and
  // then, a squeak
  // bat form's flapping: a traversal texture (move: its range, its voices, ducked by big events)
  'elisabbat.wings': {
    cat: 'move',
    lvl: 1,
    dur: 0.26,
    max: 3,
    gap: 0.2,
    fn: V((c) => {
      wings(c, { n: 3, rate: 0.068, f: rr(c, 800, 950), vol: 0.35, len: 0.028 });
      if (c.r() < 0.18) squeak(c, rr(c, 2500, 3200), 0.03, rr(c, 0.02, 0.15));
    }),
  },
  // Sciame di Pipistrelli, the release: a flick of the cloak and six bats bursting from her hands,
  // their beats overlapping as they fly off, three squeaks
  'elisabbat.swarm': {
    cat: 'skill',
    dur: 0.75,
    max: 2,
    fn: V((c) => {
      whoosh(c, { f0: 400, f1: 1150, f2: 560, dur: 0.2, q: 1.3, vol: 0.35, peak: 0.3, edge: 0.15 });
      wings(c, { n: 9, rate: 0.034, f: 720, f1: 600, vol: 0.3, fade: 0.6, at: 0.02 });
      wings(c, { n: 8, rate: 0.041, f: 950, f1: 760, vol: 0.22, fade: 0.6, at: 0.035 });
      for (let i = 0; i < 3; i++) squeak(c, rr(c, 2200, 3000), 0.012, 0.06 + i * rr(c, 0.07, 0.12));
    }),
  },
  // Notte Eterna: a breath in, then the spectral wings open on a low pipe-organ chord with a sub
  // under it; enemies also hear a dissonant pedal a semitone up and the bats screeching (the threat)
  'elisabbat.ult': {
    cat: 'ult',
    dur: 1.9,
    max: 2,
    duck: 4,
    rev: 1.3,
    fn: V((c) => {
      swell(c, 0.28, 300, 1800, 0.22);
      const r = chordHz(c.h, 0, 2);
      organ(c, { notes: [r, r * 2, chordHz(c.h, 2, 3), chordHz(c.h, 1, 4)], dur: 1.5, vol: 0.45, at: 0.26, cutoff: 1500, a: 0.02, hold: 0.35 });
      c.g.tone({ f: r, f1: r / 2, tau: 0.12, t: c.t + 0.26, dur: 0.5, vol: 0.5, a: 0.004, out: c.out });
      wings(c, { n: 2, rate: 0.22, f: 380, q: 1, vol: 0.5, at: 0.26, len: 0.12 });
      if (!c.self) {
        organ(c, { notes: [r * semi(1)], dur: 1.2, vol: 0.2, at: 0.4, cutoff: 900, a: 0.15 });
        squeak(c, 3100, 0.03, 0.55);
        squeak(c, 2700, 0.03, 0.68);
      }
    }),
  },
  // the vortex (a grain every 0.3 s while it turns): bats whirling round her, the band swinging
  // past like a flock circling, over a low pedal of the chord; now and then one squeaks
  'elisabbat.storm': {
    cat: 'skill',
    lvl: -2,
    dur: 0.62,
    max: 3,
    gap: 0.25,
    rev: 1.2,
    fn: V((c) => {
      const up = c.r() < 0.5;
      wings(c, { n: 7, rate: 0.046, f: up ? 600 : 1100, f1: up ? 1100 : 600, q: 1.4, vol: 0.32, len: 0.035 });
      pedal(c, { dur: 0.62, vol: 0.07, fadeIn: 0.2, fadeOut: 0.3, cutoff: 650 });
      if (c.r() < 0.35) squeak(c, rr(c, 2300, 3200), 0.025, rr(c, 0.05, 0.4));
    }),
  },
  // Notte Eterna, the finale: the bats dive from every side (a rush closing in), then the hit: a
  // short organ chord, a body and a sub, the flock bursting apart
  'elisabbat.finale': {
    cat: 'ult',
    lvl: 1,
    dur: 2,
    max: 2,
    duck: 5,
    rev: 1.3,
    fn: V((c) => {
      swell(c, 0.12, 500, 2400, 0.25);
      const r = chordHz(c.h, 0, 2);
      organ(c, { notes: [r, chordHz(c.h, 2, 2), chordHz(c.h, 1, 3)], dur: 0.9, vol: 0.4, at: 0.1, cutoff: 1300, a: 0.006, hold: 0.08 });
      thump(c, { f0: 150, f1: 70, dur: 0.3, vol: 0.65, at: 0.1 });
      c.g.tone({ f: r, f1: r / 2, tau: 0.1, t: c.t + 0.1, dur: 0.45, vol: 0.28, a: 0.004, out: c.out });
      crunch(c, { f: 1500, f1: 160, dur: 0.6, vol: 0.45, at: 0.1, a: 0.004 });
      smack(c, { f: 1000, q: 0.9, dur: 0.05, vol: 0.35, at: 0.1, drop: 0.5 });
      wings(c, { n: 12, rate: 0.03, accel: 1.08, f: 900, f1: 600, vol: 0.35, fade: 0.7, at: 0.11 });
      squeak(c, rr(c, 2600, 3200), 0.03, 0.2);
      squeak(c, rr(c, 2200, 2700), 0.025, 0.31);
    }),
  },
};
