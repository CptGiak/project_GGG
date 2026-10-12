/**
 * POOH, "Orso di Poco Cervello": a cuddly bear with honey pots, a blue balloon and a beehive.
 *
 * Timbre family: soft woodblocks and marimba on the score's chord, rubbery boings (sine/triangle
 * bends whose wobble settles), wet sticky honey (low band-passed glops that fall, bubbles), a toy
 * balloon squeak, a warm lightbulb ding, and the bees: a chorus of band-passed saws around
 * 180-260 Hz, each on its own slow random detune. Everything is round and cartoon: almost nothing
 * above ~3 kHz, noise only as pink or brown bands under ~1.5 kHz.
 */
import { blip, chordHz, click, crunch, mallet, rr, signature, smack, sparkle, swell, thump, whoosh, type SfxCtx, type SfxDef } from '../layers';

/**
 * Wraps a recipe: every play moves its level a little (+/- db) so repeats never measure the same,
 * and the whole voice sits under a gentle low-pass (Pooh is round: noise skirts and partials stop
 * around 3-4 kHz instead of turning into hiss).
 */
const V =
  (fn: (c: SfxCtx) => void, db = 1.2, top = 4200) =>
  (c: SfxCtx): void =>
    fn({ ...c, out: c.g.gain(Math.pow(10, rr(c, -db, db) / 20), c.g.filter('lowpass', top, 0.6, c.out)) });

/** a soft woodblock knock: a sine body settling from a hair sharp, a short woody partial, a pink tick */
function wood(c: SfxCtx, f: number, vol: number, at = 0, dur = 0.08, partial = 0.2): void {
  const t = c.t + at;
  c.g.tone({ f: f * 1.03, f1: f, glide: 0.01, t, dur, vol, a: 0.0025, out: c.out });
  if (partial > 0) c.g.tone({ f: f * 2.71, t, dur: dur * 0.3, vol: vol * partial, a: 0.0008, out: c.out });
  click(c, { f: Math.min(2200, f * 1.9), q: 2, dur: 0.01, vol: vol * 0.22, at });
}

/** a bubble: a sine that pitches up as the cavity closes (honey, droplets, a gulp) */
function bubble(c: SfxCtx, f: number, vol: number, at = 0, dur = 0.06): void {
  c.g.tone({ f: f * 0.75, f1: f * 1.5, glide: dur * 0.6, t: c.t + at, dur, vol, a: 0.004, out: c.out });
}

/** a rubbery spring ("boyoyoing"): bends from f0 to f1 while a wobble on its pitch settles */
function spring(c: SfxCtx, o: { f0: number; f1: number; dur: number; vol: number; at?: number; rate?: number; depth?: number; type?: OscillatorType; top?: number }): void {
  const ctx = c.g.ctx;
  const t = c.t + (o.at ?? 0);
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'triangle';
  osc.frequency.setValueAtTime(o.f0, t);
  osc.frequency.exponentialRampToValueAtTime(o.f1, t + Math.min(0.07, o.dur * 0.25));
  const lfo = ctx.createOscillator();
  const rate = o.rate ?? 13;
  lfo.frequency.setValueAtTime(rate, t);
  lfo.frequency.linearRampToValueAtTime(rate * 0.7, t + o.dur);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(o.depth ?? 260, t);
  depth.gain.exponentialRampToValueAtTime(6, t + o.dur);
  lfo.connect(depth).connect(osc.detune);
  const env = ctx.createGain();
  c.g.envelope(env.gain, t, o.vol, 0.004, o.dur, o.dur * 0.2);
  osc.connect(env).connect(o.top ? c.g.filter('lowpass', o.top, 0.7, c.out) : c.out);
  osc.start(t);
  lfo.start(t);
  osc.stop(t + o.dur + 0.05);
  lfo.stop(t + o.dur + 0.05);
}

/** a warm "ding": harmonic partials only (no FM brightness) and a slow vibraphone shimmer */
function ding(c: SfxCtx, f: number, dur: number, vol: number, at = 0): void {
  const t = c.t + at;
  c.g.tone({ f, t, dur, vol, a: 0.002, vib: [7, 5.5], out: c.out });
  c.g.tone({ f: f * 2, t, dur: dur * 0.4, vol: vol * 0.28, a: 0.0015, out: c.out });
  c.g.tone({ f: f * 3, t, dur: dur * 0.15, vol: vol * 0.1, a: 0.001, out: c.out });
}

/**
 * The bees: `n` saws around `f`, each on its own slow random detune (a new target every 50-110 ms),
 * through a band-pass that moves from band[0] to band[1] (brighter = nearer) and a low-pass that
 * keeps them round. The grain fades in and out linearly, so grains played every ~0.3 s overlap
 * into one continuous swarm.
 */
function bees(c: SfxCtx, o: { n: number; f: number; dur: number; vol: number; band: [number, number]; fadeIn: number; fadeOut: number; at?: number; q?: number; spread?: number; top?: number; bend?: number; level?: [number, number] }): void {
  const g = c.g;
  const t = c.t + (o.at ?? 0);
  const end = t + o.dur;
  const [l0, l1] = o.level ?? [1, 1];
  const lp = g.filter('lowpass', o.top ?? 1800, 0.7, c.out);
  const env = g.gain(0, lp);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(o.vol * l0, t + o.fadeIn);
  env.gain.linearRampToValueAtTime(o.vol * l1, Math.max(t + o.fadeIn, end - o.fadeOut));
  env.gain.linearRampToValueAtTime(0, end);
  const bp = g.filter('bandpass', o.band[0], o.q ?? 0.9, env);
  bp.frequency.setValueAtTime(o.band[0], t);
  bp.frequency.exponentialRampToValueAtTime(o.band[1], end);
  const bend = o.bend ?? 0;
  for (let i = 0; i < o.n; i++) {
    const osc = g.ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = o.f * (1 + (c.r() - 0.5) * (o.spread ?? 0.24));
    osc.frequency.setValueAtTime(base, t);
    for (let tt = t + rr(c, 0.02, 0.06); tt < end; tt += rr(c, 0.05, 0.11)) {
      const k = 1 + bend * ((tt - t) / o.dur);
      osc.frequency.setTargetAtTime(base * k * (1 + (c.r() - 0.5) * 0.05), tt, 0.035);
    }
    osc.connect(g.gain(rr(c, 0.6, 1) / Math.sqrt(o.n), bp));
    osc.start(t);
    osc.stop(end + 0.05);
  }
}

export const POOH: Record<string, SfxDef> = {
  // Barattolo di Miele, the throw (twice a second while held): a soft round lob, the honey sloshing
  // in the pot and a quiet marimba plink that walks the chord up and down from throw to throw.
  // Super Pots (arg.big) swing lower and leave a golden twinkle.
  'pooh.throw': {
    cat: 'basic',
    dur: 0.3,
    max: 3,
    combo: 1.2,
    fn: V((c) => {
      const big = !!c.arg?.big;
      whoosh(c, { f0: big ? 230 : 290, f1: big ? 760 : 920, f2: big ? 300 : 380, dur: big ? 0.24 : rr(c, 0.16, 0.19), q: 1, vol: 0.42, peak: 0.42, edge: 0.12 });
      bubble(c, rr(c, 300, 380), 0.1, 0.012, 0.05);
      mallet(c, chordHz(c.h, [0, 1, 2, 1][c.step % 4], 4), 0.1, 0.1, 0.02);
      if (big) sparkle(c, 0.16, 3, 0.02, 5, 0.04);
    }),
  },
  // the pot lands: the clay goes "tok", the honey splotches down and bubbles, droplets patter
  // (Super Pots, arg.big: a deeper splotch, more droplets and a slow glorp)
  'pooh.splat': {
    cat: 'basic',
    lvl: 2,
    dur: 0.45,
    max: 4,
    fn: V((c) => {
      const big = !!c.arg?.big;
      wood(c, rr(c, 820, 980) * (big ? 0.85 : 1), 0.15, 0, 0.045, 0);
      smack(c, { f: big ? 560 : 680, q: 1.4, dur: big ? 0.2 : 0.14, vol: 0.5, drop: 0.32, at: 0.004, a: 0.005 });
      thump(c, { f0: big ? 175 : 205, f1: big ? 90 : 115, dur: big ? 0.13 : 0.08, vol: big ? 0.42 : 0.32 });
      bubble(c, rr(c, 240, 300), 0.22, 0.025, 0.07);
      bubble(c, rr(c, 340, 420), 0.14, rr(c, 0.06, 0.09), 0.06);
      const drops = big ? 4 : 2;
      for (let i = 0; i < drops; i++) bubble(c, rr(c, 480, 760), rr(c, 0.035, 0.07), 0.12 + i * rr(c, 0.04, 0.07), 0.035);
      if (big) bubble(c, rr(c, 165, 195), 0.2, 0.05, 0.13);
    }),
  },
  // Panzata: the tummy puffs up ("bwoomp") and he charges, a fluffy low rush
  'pooh.bump': {
    cat: 'skill',
    dur: 0.48,
    max: 2,
    fn: V((c) => {
      c.g.tone({ f: 150 * c.p, f1: 310 * c.p, glide: 0.075, t: c.t, dur: 0.12, vol: 0.4, a: 0.006, out: c.out });
      crunch(c, { f: 700, f1: 350, dur: 0.09, vol: 0.1, a: 0.01 });
      whoosh(c, { f0: 260, f1: 850, f2: 320, dur: 0.32, q: 0.9, vol: 0.45, peak: 0.3, at: 0.07, edge: 0.15 });
      thump(c, { f0: 200, f1: 125, dur: 0.09, vol: 0.28, at: 0.08 });
      signature(c, 'dash', 'pooh');
    }),
  },
  // he bounces off his own tummy (into an enemy, whose hit plays the body, or a wall): a rubbery
  // spring from the chord root up an octave, settling, and a fluffy belly "pff"
  'pooh.boing': {
    cat: 'skill',
    lvl: 1,
    dur: 0.55,
    max: 2,
    vary: 0.02,
    fn: V((c) => {
      const r = chordHz(c.h, 0, 3);
      spring(c, { f0: r, f1: r * 2, dur: 0.46, vol: 0.34, rate: rr(c, 12, 15), depth: 280, top: 1500 });
      spring(c, { f0: r * 2, f1: r * 4, dur: 0.22, vol: 0.06, rate: rr(c, 12, 15), depth: 200, type: 'sine' });
      thump(c, { f0: 185, f1: 115, dur: 0.07, vol: 0.16 });
      smack(c, { f: 520, q: 1, dur: 0.035, vol: 0.1, drop: 0.6 });
    }),
  },
  // Nuvoletta Nera: he grabs the blue balloon (a rubber squeak) and floats up on a rising roll
  'pooh.balloon': {
    cat: 'skill',
    dur: 0.75,
    max: 2,
    fn: V((c) => {
      const bp = c.g.filter('bandpass', 950, 2, c.out);
      c.g.tone({ type: 'triangle', f: 640 * c.p, f1: 980 * c.p, glide: 0.09, t: c.t, dur: 0.13, vol: 0.32, a: 0.004, vib: [90, 26], out: bp });
      swell(c, 0.45, 300, 1300, 0.08, 'pink', 0.05);
      [0, 1, 2, 3].forEach((d, i) => mallet(c, chordHz(c.h, d, 4), 0.22, 0.14 - i * 0.015, 0.1 + i * 0.07));
    }),
  },
  // he lets go: the string slips off his paw ("plip") and a little slide whistle falls with him
  'pooh.pop': {
    cat: 'skill',
    lvl: -1,
    dur: 0.55,
    max: 2,
    vary: 0.02,
    fn: V((c) => {
      c.g.tone({ f: 820 * c.p, f1: 260 * c.p, glide: 0.03, t: c.t, dur: 0.05, vol: 0.3, a: 0.001, out: c.out });
      click(c, { f: 1600, dur: 0.006, vol: 0.06 });
      c.g.tone({ f: chordHz(c.h, 2, 5), f1: chordHz(c.h, 0, 4), glide: 0.36, t: c.t + 0.04, dur: 0.42, vol: 0.12, a: 0.03, vib: [25, 6], out: c.out });
      whoosh(c, { f0: 700, f1: 500, f2: 260, dur: 0.3, q: 0.9, vol: 0.18, peak: 0.25, at: 0.05, edge: 0 });
    }),
  },
  // Pensa, Pensa, Pensa: the paw taps his (hollow) head, a soft low woodblock that climbs the chord
  // tap by tap; the Idea's roll picks the climb up from there
  'pooh.tap': {
    cat: 'skill',
    lvl: -5,
    dur: 0.15,
    max: 3,
    combo: 0.5,
    vary: 0.01,
    fn: V((c) => {
      wood(c, chordHz(c.h, Math.min(c.step, 2), 4), 0.4, 0, 0.08, 0.25);
    }),
  },
  // the Idea! the bulb lights up: a quick roll up the chord into a warm, round ding over a soft
  // glow (a world sound: enemies learn he just healed and loaded the Panzata and the Super Pots)
  'pooh.idea': {
    cat: 'skill',
    dur: 1.1,
    max: 1,
    vary: 0.004,
    rev: 1.2,
    fn: V((c) => {
      click(c, { f: 1800, q: 2, dur: 0.006, vol: 0.05 });
      mallet(c, chordHz(c.h, 1, 4), 0.12, 0.22);
      mallet(c, chordHz(c.h, 2, 4), 0.12, 0.22, 0.045);
      ding(c, chordHz(c.h, 0, 5), 0.9, 0.35, 0.09);
      for (const i of [0, 2]) c.g.tone({ f: chordHz(c.h, i, 4), t: c.t + 0.09, dur: 0.7, vol: 0.06, a: 0.04, out: c.out });
    }),
  },
  // Ghiotto di Miele: he licks up a puddle (+health): a wet slurp dragged upward, trembling with
  // the tongue, a gulp, a happy "mm-mm"
  'pooh.slurp': {
    cat: 'skill',
    lvl: -3,
    dur: 0.65,
    max: 2,
    fn: V((c) => {
      const trem = c.g.gain(0.6, c.out);
      const lfo = c.g.ctx.createOscillator();
      lfo.frequency.value = rr(c, 22, 28);
      const depth = c.g.gain(0.4);
      lfo.connect(depth).connect(trem.gain);
      lfo.start(c.t);
      lfo.stop(c.t + 0.3);
      c.g.noiseBurst({ color: 'pink', type: 'bandpass', f: 380 * c.p, f1: 1250 * c.p, glide: 0.22, q: 4, t: c.t, dur: 0.24, vol: 0.5, a: 0.03, out: trem });
      c.g.tone({ f: 210 * c.p, f1: 520 * c.p, glide: 0.2, t: c.t + 0.02, dur: 0.22, vol: 0.08, a: 0.03, out: c.out });
      bubble(c, rr(c, 170, 210), 0.25, 0.27, 0.08);
      mallet(c, chordHz(c.h, 0, 4), 0.14, 0.14, 0.34);
      mallet(c, chordHz(c.h, 1, 4), 0.2, 0.14, 0.44);
    }),
  },
  // Sciame d'Api, the cast: the hive in his paw and the bees inside getting angry under a marimba
  // wind-up; enemies also hear the warning, an angry low buzz a semitone apart
  'pooh.ult': {
    cat: 'ult',
    dur: 1,
    max: 2,
    duck: 3,
    fn: V((c) => {
      bees(c, { n: 3, f: 205, dur: 0.75, vol: 0.5, band: [350, 900], q: 1, fadeIn: 0.42, fadeOut: 0.25, top: 1400, bend: 0.06 });
      [0, 1, 2].forEach((d, i) => blip(c, { type: 'triangle', f: chordHz(c.h, d, 4), dur: 0.14, vol: 0.12, at: 0.05 + i * 0.11 }));
      if (!c.self) {
        const lp = c.g.filter('lowpass', 900, 0.8, c.out);
        const r = chordHz(c.h, 0, 3);
        for (const f of [r, r * 1.0595]) c.g.tone({ type: 'sawtooth', f, t: c.t + 0.1, dur: 0.85, vol: 0.11, a: 0.35, vib: [22, 19], out: lp });
      }
    }),
  },
  // the beehive goes flying: a heavy round lob and the buzz inside flying away (a touch of Doppler)
  'pooh.hive': {
    cat: 'skill',
    lvl: 2,
    dur: 0.75,
    max: 2,
    fn: V((c) => {
      whoosh(c, { f0: 220, f1: 720, f2: 280, dur: 0.36, q: 0.9, vol: 0.5, peak: 0.35, edge: 0.15 });
      wood(c, rr(c, 260, 300), 0.3, 0, 0.09, 0.25);
      bees(c, { n: 3, f: 215, dur: 0.7, vol: 0.4, band: [900, 450], q: 1, fadeIn: 0.05, fadeOut: 0.4, top: 1600, bend: -0.05 });
    }),
  },
  // the hive cracks open where it lands and the swarm pours out (the honey splat plays with it)
  'pooh.hiveBurst': {
    cat: 'ult',
    dur: 1.4,
    max: 2,
    duck: 3,
    rev: 1.2,
    fn: V((c) => {
      c.g.tone({ f: rr(c, 205, 235), f1: 190, glide: 0.02, t: c.t, dur: 0.14, vol: 0.5, a: 0.0012, out: c.out });
      click(c, { f: 900, q: 1.5, dur: 0.012, vol: 0.12 });
      crunch(c, { f: 1300, f1: 200, dur: 0.28, vol: 0.4 });
      thump(c, { f0: 140, f1: 60, dur: 0.26, vol: 0.6 });
      for (let i = 0; i < 2; i++) c.g.tone({ f: rr(c, 480, 820), t: c.t + 0.05 + i * rr(c, 0.03, 0.06), dur: 0.035, vol: 0.1, a: 0.001, out: c.out });
      bees(c, { n: 4, f: 225, dur: 1.25, vol: 0.6, band: [1300, 600], q: 0.9, fadeIn: 0.05, fadeOut: 0.55, top: 2000, bend: -0.04, at: 0.03 });
    }),
  },
  // the swarm chasing its prey (a grain every ~0.3 s from the kit): overlapping soft-edged grains of
  // the bee chorus, each flying a little nearer or farther, so it reads as one continuous swarm
  'pooh.buzz': {
    cat: 'skill',
    lvl: -3,
    dur: 0.65,
    max: 3,
    gap: 0.22,
    fn: V((c) => {
      const near = c.r() < 0.5;
      const b0 = rr(c, 520, 700);
      const b1 = near ? b0 * rr(c, 1.25, 1.5) : b0 / rr(c, 1.25, 1.5);
      bees(c, { n: 3, f: rr(c, 195, 240), dur: 0.62, vol: 0.5, band: [b0, b1], q: 0.9, fadeIn: 0.2, fadeOut: 0.3, top: 1800, bend: near ? 0.025 : -0.025, level: near ? [0.75, 1] : [1, 0.75] });
    }),
  },
};
