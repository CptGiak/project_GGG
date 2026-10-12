/**
 * QIYANA, Empress of the Elements (True Damage): a golden ring blade and elemental magic.
 *
 * Timbre family: the golden ring (a slowly beating sine pair on a chord tone around 1.2-1.8 kHz
 * with one quiet inharmonic partial: a hoop of gold, softer than steel), regal brass on the chord
 * for the big moments, and three element palettes that never borrow from each other:
 *   ROCK  stone cracks (high-Q pink ticks), rolling gravel (band-passed grains), a low thud;
 *   WATER a falling wet splash, bubbles that pitch up as they close, a surging band of pink noise;
 *   GRASS a soft leafy rustle (band-limited pink grains) and a green marimba on the chord.
 * The slashes keep their energy in 300 Hz-2 kHz; sub only under the ultimate.
 */
import type { NoiseColor } from '../graph';
import { bell, blip, chordHz, crunch, hiss, mallet, rr, semi, smack, sparkle, sub, swell, thump, whoosh, type SfxCtx, type SfxDef } from '../layers';

/** the golden ring: a slowly beating sine pair on a chord tone, plus a quiet inharmonic partial */
function gold(c: SfxCtx, o: { i?: number; oct?: number; decay: number; vol: number; at?: number; rich?: boolean }): void {
  const f = chordHz(c.h, o.i ?? 0, o.oct ?? 6) * rr(c, 0.998, 1.002);
  const t = c.t + (o.at ?? 0);
  const v = o.vol * rr(c, 0.85, 1.1);
  c.g.tone({ f, t, dur: o.decay, vol: v * 0.6, a: 0.0015, out: c.out });
  c.g.tone({ f: f + rr(c, 3, 7), t, dur: o.decay * 0.85, vol: v * 0.4, a: 0.0015, out: c.out });
  if (o.rich !== false) c.g.tone({ f: f * 2.76 * rr(c, 0.996, 1.004), t, dur: o.decay * 0.35, vol: v * 0.12, a: 0.001, out: c.out });
}

/**
 * Many short grains from ONE noise source (one band-pass, one automated gain): crackle, gravel,
 * rustle. Each grain takes its own centre around a sweep f -> f1, so the texture moves and no two
 * grains match. Three nodes whatever the count.
 */
function grains(c: SfxCtx, o: { f: number; f1?: number; q?: number; n: number; span: number; at?: number; vol: number; len?: [number, number]; fade?: number; early?: number; jit?: number; atk?: number; color?: NoiseColor }): void {
  const g = c.g;
  const t0 = c.t + (o.at ?? 0);
  const src = g.noiseSrc(o.color ?? 'pink', t0, o.span + 0.03);
  const bp = g.filter('bandpass', o.f, o.q ?? 2);
  const amp = g.gain(0);
  src.connect(bp).connect(amp).connect(c.out);
  const times: number[] = [];
  for (let i = 0; i < o.n; i++) times.push(Math.pow(c.r(), o.early ?? 1) * o.span);
  times.sort((a, b) => a - b);
  const [l0, l1] = o.len ?? [0.003, 0.01];
  const f1 = o.f1 ?? o.f;
  amp.gain.setValueAtTime(0, t0);
  let free = 0;
  for (const s0 of times) {
    const s = Math.max(s0, free);
    const d = rr(c, l0, l1);
    if (s + d > o.span) break;
    const k = s / o.span;
    const v = o.vol * rr(c, 0.35, 1) * Math.pow(1 - k, o.fade ?? 1);
    if (v < 0.002) continue;
    bp.frequency.setValueAtTime(Math.min(6000, o.f * Math.pow(f1 / o.f, k) * c.p * (1 + (c.r() - 0.5) * 2 * (o.jit ?? 0.2))), t0 + s);
    amp.gain.setValueAtTime(0, t0 + s);
    amp.gain.linearRampToValueAtTime(v, t0 + s + (o.atk ?? 0.0015));
    amp.gain.exponentialRampToValueAtTime(0.0005, t0 + s + Math.max(d, (o.atk ?? 0.0015) + 0.002));
    amp.gain.setValueAtTime(0, t0 + s + d + 0.0003);
    free = s + d + 0.0012;
  }
}

/** running water: pink noise through a resonant band that surges up and settles back */
function flow(c: SfxCtx, o: { f0: number; f1: number; f2: number; dur: number; vol: number; at?: number; q?: number }): void {
  const t = c.t + (o.at ?? 0);
  const k = c.p * rr(c, 0.9, 1.1);
  const bp = c.g.noiseBurst({ color: 'pink', type: 'bandpass', f: o.f0 * k, f1: o.f1 * k, glide: o.dur * 0.35, q: o.q ?? 2.2, t, dur: o.dur, vol: o.vol, a: o.dur * 0.25, out: c.out });
  bp.frequency.exponentialRampToValueAtTime(o.f2 * k, t + o.dur);
}

/** stone crumbling: brown noise through a falling band, high-passed so it carries no sub */
function crumble(c: SfxCtx, o: { f: number; f1: number; dur: number; vol: number; at?: number }): void {
  c.g.noiseBurst({ color: 'brown', type: 'bandpass', f: o.f * c.p, f1: o.f1 * c.p, q: 0.8, t: c.t + (o.at ?? 0), dur: o.dur, vol: o.vol, a: 0.004, out: c.g.filter('highpass', 140, 0.7, c.out) });
}

/** about +/-1.5 dB of level variation on a layer */
const vv = (c: SfxCtx, v: number) => v * rr(c, 0.84, 1.16);

/** a bubble: a sine that pitches up as it closes, no noise */
function bubble(c: SfxCtx, f: number, vol: number, at: number): void {
  c.g.tone({ f: f * 0.75, f1: f * 1.5, glide: 0.035, t: c.t + at, dur: rr(c, 0.05, 0.08), vol: vol * rr(c, 0.7, 1), a: 0.002, out: c.out });
}

/** regal brass: saws on chord tones that scoop into the note; the low-pass opens with the attack */
function brass(c: SfxCtx, o: { notes: number[]; dur: number; vol: number; at?: number; a?: number; lo?: number; hi?: number }): void {
  const g = c.g;
  const t = c.t + (o.at ?? 0);
  const a = o.a ?? 0.02;
  const lo = o.lo ?? 500;
  const lp = g.filter('lowpass', lo, 0.9, c.out);
  lp.frequency.setValueAtTime(lo, t);
  lp.frequency.exponentialRampToValueAtTime(o.hi ?? 2400, t + a + 0.03);
  lp.frequency.exponentialRampToValueAtTime(lo, t + o.dur);
  const each = o.vol / Math.sqrt(o.notes.length);
  o.notes.forEach((f, i) => g.tone({ type: 'sawtooth', f: f * 0.985, f1: f, glide: 0.04, t: t + i * 0.006, dur: o.dur, vol: each, a, detune: i % 2 ? 6 : -6, out: lp }));
}

/** a soft marimba note: the mallet's two partials with a slower onset (no click under a quiet sound) */
function marimba(c: SfxCtx, f: number, dur: number, vol: number, at = 0): void {
  c.g.tone({ f, t: c.t + at, dur, vol, a: 0.007, out: c.out });
  c.g.tone({ f: f * 3.98, t: c.t + at, dur: dur * 0.25, vol: vol * 0.12, a: 0.004, out: c.out });
}

/** the ring takes an element at the end of Terrashape: two golden glints up the chord */
function enchant(c: SfxCtx, vol: number): void {
  gold(c, { i: 0, decay: 0.22, vol, rich: false });
  gold(c, { i: 2, decay: 0.34, vol: vol * 0.9, at: 0.055, rich: false });
}

export const QIYANA: Record<string, SfxDef> = {
  // Royal Slashes (c1, c2 and the rising air slash): the ring blade's quick arc and a golden glint
  // that climbs the chord with the combo
  'qiyana.swing': {
    cat: 'basic',
    dur: 0.26,
    max: 3,
    combo: 0.9,
    fn: (c) => {
      whoosh(c, { f0: 380, f1: 1500, f2: 520, dur: rr(c, 0.15, 0.19), q: 1.7, vol: vv(c, 0.5), peak: 0.36, edge: 0.25 });
      gold(c, { i: c.step % 3, decay: rr(c, 0.11, 0.15), vol: 0.05, at: 0.05, rich: false });
    },
  },
  // Audacity's strike as she comes down on the target: a falling cut, a short thud, the glint
  'qiyana.audacitySlash': {
    cat: 'skill',
    lvl: -2,
    dur: 0.3,
    max: 2,
    fn: (c) => {
      whoosh(c, { f0: 650, f1: 1700, f2: 380, dur: 0.2, q: 1.6, vol: vv(c, 0.45), peak: 0.25, edge: 0.25 });
      thump(c, { f0: 220, f1: 115, dur: 0.07, vol: vv(c, 0.1), at: 0.03 });
      gold(c, { i: 0, decay: 0.2, vol: 0.045, at: 0.04, rich: false });
    },
  },
  // Edge of Ixtal, no element: a long clean cut and the ring's "shing" running down the line
  'qiyana.edge': {
    cat: 'skill',
    dur: 0.55,
    max: 2,
    fn: (c) => {
      whoosh(c, { f0: 460, f1: 1800, f2: 420, dur: 0.32, q: 1.6, vol: vv(c, 0.5), peak: 0.18, edge: 0.3 });
      // the wave travelling away down the line: a band that falls
      hiss(c, { f: 1500, f1: 520, q: 2.2, dur: 0.38, vol: 0.14, a: 0.03, at: 0.05 });
      thump(c, { f0: 280, f1: 140, dur: 0.07, vol: vv(c, 0.16) });
      gold(c, { i: 0, decay: 0.32, vol: 0.06, at: 0.02 });
      gold(c, { i: 2, decay: 0.42, vol: 0.05, at: 0.055 });
    },
  },
  // Elemental Wrath, ROCK: the cut splits the ground (a stone crack, a low thud) and gravel rolls
  // away down the line
  'qiyana.edgeRock': {
    cat: 'skill',
    lvl: 1,
    dur: 0.7,
    max: 2,
    fn: (c) => {
      whoosh(c, { f0: 360, f1: 1400, f2: 380, dur: 0.28, q: 1.4, vol: vv(c, 0.4), peak: 0.2, edge: 0.25 });
      thump(c, { f0: 190, f1: 90, dur: 0.2, vol: vv(c, 0.26), at: 0.015 });
      grains(c, { f: 1700, q: 3.5, n: 6, span: 0.045, at: 0.012, vol: 1.2, len: [0.003, 0.008], jit: 0.3, atk: 0.0008 });
      grains(c, { f: 1150, f1: 650, q: 1.6, n: 26, span: 0.5, at: 0.05, vol: 1, len: [0.005, 0.014], fade: 1.4, early: 1.5, jit: 0.3 });
      crumble(c, { f: 750, f1: 320, dur: 0.35, vol: 0.45, at: 0.02 });
      gold(c, { i: 0, decay: 0.2, vol: 0.035, at: 0.01, rich: false });
    },
  },
  // Elemental Wrath, WATER: a wet splash thrown down the line, the water surging and bubbling
  'qiyana.edgeWater': {
    cat: 'skill',
    dur: 0.7,
    max: 2,
    fn: (c) => {
      whoosh(c, { f0: 420, f1: 1600, f2: 450, dur: 0.3, q: 1.5, vol: vv(c, 0.38), peak: 0.2, edge: 0.25 });
      smack(c, { f: 1250, q: 0.7, dur: 0.24, vol: vv(c, 0.4), at: 0.03, drop: 0.3, a: 0.004 });
      flow(c, { f0: 600, f1: 1300, f2: 750, dur: 0.5, vol: vv(c, 0.16), at: 0.04 });
      thump(c, { f0: 230, f1: 120, dur: 0.09, vol: vv(c, 0.2), at: 0.02 });
      [0.09, 0.14, 0.2].forEach((at, k) => bubble(c, chordHz(c.h, k, 5), 0.14, at + rr(c, -0.01, 0.01)));
      gold(c, { i: 1, decay: 0.22, vol: 0.035, at: 0.01, rich: false });
    },
  },
  // Elemental Wrath, GRASS: leaves torn up along the line (a soft dry rustle) and a green chime
  'qiyana.edgeGrass': {
    cat: 'skill',
    dur: 0.6,
    max: 2,
    fn: (c) => {
      whoosh(c, { f0: 450, f1: 1700, f2: 500, dur: 0.3, q: 1.6, vol: vv(c, 0.4), peak: 0.2, edge: 0.25 });
      grains(c, { f: 1900, f1: 1500, q: 0.9, n: 30, span: 0.4, at: 0.03, vol: vv(c, 0.28), len: [0.004, 0.012], fade: 1.2, jit: 0.35 });
      hiss(c, { f: 1300, f1: 2100, q: 1, dur: 0.3, vol: 0.06, a: 0.06, at: 0.02 });
      mallet(c, chordHz(c.h, 0, 5), 0.22, vv(c, 0.14), 0.04);
      mallet(c, chordHz(c.h, 2, 5), 0.3, vv(c, 0.12), 0.09);
      gold(c, { i: 2, decay: 0.2, vol: 0.03, at: 0.01, rich: false });
    },
  },
  // Terrashape: the dash, and the ring's charge gliding up a fifth to meet the element it claims
  'qiyana.terra': {
    cat: 'skill',
    lvl: -2,
    dur: 0.4,
    max: 2,
    fn: (c) => {
      swell(c, 0.05, 500, 1800, 0.14);
      whoosh(c, { f0: 420, f1: 2000, f2: 600, dur: 0.24, q: 1.4, vol: vv(c, 0.45), peak: 0.25, at: 0.04, edge: 0.3 });
      thump(c, { f0: 180, f1: 90, dur: 0.09, vol: vv(c, 0.15), at: 0.04 });
      blip(c, { f: chordHz(c.h, 0, 5), f1: chordHz(c.h, 2, 5), glide: 0.22, dur: 0.3, vol: vv(c, 0.05), a: 0.04, at: 0.03 });
    },
  },
  // Terrashape claims ROCK (a wall close by): stones knock, a low thud, a trickle of gravel
  'qiyana.claimRock': {
    cat: 'skill',
    lvl: -3,
    dur: 0.5,
    max: 2,
    fn: (c) => {
      enchant(c, 0.05);
      thump(c, { f0: 175, f1: 90, dur: 0.15, vol: vv(c, 0.16) });
      grains(c, { f: 1500, q: 4, n: 3, span: 0.06, vol: vv(c, 1), len: [0.004, 0.009], jit: 0.25, atk: 0.0008 });
      grains(c, { f: 1100, f1: 800, q: 1.8, n: 14, span: 0.3, at: 0.04, vol: 0.7, len: [0.005, 0.012], fade: 1.5 });
      crumble(c, { f: 650, f1: 300, dur: 0.2, vol: 0.22 });
    },
  },
  // Terrashape claims WATER (the ground): a small splash and bubbles rising up the chord
  'qiyana.claimWater': {
    cat: 'skill',
    lvl: -3,
    dur: 0.5,
    max: 2,
    fn: (c) => {
      enchant(c, 0.05);
      smack(c, { f: 1100, q: 0.7, dur: 0.16, vol: vv(c, 0.32), drop: 0.35, a: 0.003 });
      flow(c, { f0: 650, f1: 1150, f2: 800, dur: 0.32, vol: vv(c, 0.12), at: 0.03 });
      [0, 1, 2].forEach((k) => bubble(c, chordHz(c.h, k, 5) * rr(c, 0.97, 1.03), 0.13, 0.05 + k * rr(c, 0.04, 0.06)));
      thump(c, { f0: 210, f1: 110, dur: 0.08, vol: 0.2 });
    },
  },
  // Terrashape claims GRASS (in the air): a rustle of leaves and a marimba note
  'qiyana.claimGrass': {
    cat: 'skill',
    lvl: -3,
    dur: 0.5,
    max: 2,
    fn: (c) => {
      enchant(c, 0.05);
      grains(c, { f: 1800, f1: 1400, q: 0.9, n: 16, span: 0.28, vol: vv(c, 0.16), len: [0.004, 0.011], fade: 1.2, jit: 0.35 });
      hiss(c, { f: 1200, f1: 1900, q: 1, dur: 0.25, vol: 0.05, a: 0.05 });
      mallet(c, chordHz(c.h, 1, 5), 0.25, vv(c, 0.13), 0.03);
      thump(c, { f0: 260, f1: 150, dur: 0.06, vol: 0.16 });
    },
  },
  // the grass veil: she breathes in with the leaves and is gone (a rustle swelling into nothing,
  // a tone falling away, two soft marimba notes going down)
  'qiyana.veil': {
    cat: 'skill',
    lvl: -4,
    dur: 0.6,
    max: 2,
    fn: (c) => {
      c.g.noiseBurst({ color: 'pink', type: 'bandpass', f: 900 * c.p, f1: 2400 * c.p, glide: 0.2, q: 1, t: c.t, dur: 0.42, vol: vv(c, 0.1), a: 0.18, out: c.out });
      grains(c, { f: 2000, f1: 1300, q: 1, n: 14, span: 0.35, at: 0.06, vol: 0.12, len: [0.004, 0.01], fade: 2 });
      blip(c, { f: chordHz(c.h, 2, 6), f1: chordHz(c.h, 0, 5), glide: 0.38, dur: 0.45, vol: vv(c, 0.045), a: 0.05, at: 0.12, vib: [12, 7] });
      marimba(c, chordHz(c.h, 2, 5), 0.3, vv(c, 0.08), 0.2);
      marimba(c, chordHz(c.h, 0, 5), 0.35, vv(c, 0.06), 0.29);
    },
  },
  // Audacity: she springs at the target with the ring raised (push-off, rising air, a held glint)
  'qiyana.audacity': {
    cat: 'skill',
    dur: 0.45,
    max: 2,
    fn: (c) => {
      thump(c, { f0: 190, f1: 95, dur: 0.1, vol: vv(c, 0.18) });
      smack(c, { f: 800, q: 1.2, dur: 0.04, vol: 0.22, drop: 0.6 });
      whoosh(c, { f0: 300, f1: 1500, f2: 800, dur: 0.32, q: 1.3, vol: vv(c, 0.42), peak: 0.6, at: 0.02, edge: 0.25 });
      swell(c, 0.2, 400, 1800, 0.08, 'pink', 0.04);
      gold(c, { i: 2, decay: 0.32, vol: 0.05, at: 0.03 });
    },
  },
  // Supreme Display of Talent, the wind-up (the wave leaves 0.4 s later): a regal brass crescendo
  // and the breath in; enemies also hear a low warning under it
  'qiyana.ult': {
    cat: 'ult',
    lvl: -2,
    dur: 0.7,
    max: 2,
    duck: 2,
    rev: 1.2,
    fn: (c) => {
      brass(c, { notes: [chordHz(c.h, 0, 3), chordHz(c.h, 2, 3), chordHz(c.h, 1, 4)], dur: 0.48, vol: vv(c, 0.32), a: 0.3, lo: 450, hi: 2200 });
      swell(c, 0.38, 300, 2600, vv(c, 0.2));
      sparkle(c, 0.32, 3, 0.022, 6, 0.04);
      gold(c, { i: 0, decay: 0.25, vol: 0.04, rich: false });
      if (!c.self) brass(c, { notes: [chordHz(c.h, 0, 2), chordHz(c.h, 0, 2) * semi(1)], dur: 0.6, vol: 0.11, a: 0.08, lo: 350, hi: 900, at: 0.05 });
    },
  },
  // the wave released: a wall of air rolling away, the brass answering on the chord, a sub drop in
  // the key and the ground rumbling under it
  'qiyana.wave': {
    cat: 'ult',
    dur: 1.3,
    max: 2,
    duck: 4,
    rev: 1.2,
    fn: (c) => {
      c.g.noiseBurst({ color: 'pink', type: 'bandpass', f: 1300 * c.p, f1: 260, glide: 0.7, q: 0.9, t: c.t, dur: 0.75, vol: vv(c, 0.6), a: 0.02, out: c.out });
      thump(c, { f0: 140, f1: 48, dur: 0.38, vol: vv(c, 0.5) });
      sub(c, chordHz(c.h, 0, 2), chordHz(c.h, 0, 1), 0.5, 0.3);
      brass(c, { notes: [chordHz(c.h, 0, 3), chordHz(c.h, 1, 3), chordHz(c.h, 2, 3)], dur: 0.65, vol: 0.6, a: 0.012, lo: 800, hi: 3000 });
      crunch(c, { f: 500, f1: 120, dur: 0.9, vol: 0.25, a: 0.03, rate: 0.6 });
      gold(c, { i: 0, decay: 0.7, vol: 0.1, rich: false });
    },
  },
  // a wall bursts under the wave (one per wave, arg.n = walls hit): stone cracks open, a heavy
  // thud with sub, a crumbling bloom and rocks raining back down
  'qiyana.burst': {
    cat: 'big',
    dur: 1.6,
    max: 2,
    duck: 3,
    rev: 1.2,
    fn: (c) => {
      const n = Math.max(1, Math.min(3, Number(c.arg?.n ?? 1)));
      grains(c, { f: 1600, q: 3, n: 4 + 4 * n, span: 0.04 + 0.07 * (n - 1), vol: 1.2, len: [0.003, 0.009], jit: 0.35, atk: 0.0008 });
      thump(c, { f0: 140, f1: 52, dur: 0.4, vol: vv(c, 0.6) });
      for (let i = 1; i < n; i++) thump(c, { f0: 140, f1: 50, dur: 0.25, vol: 0.5, at: i * rr(c, 0.05, 0.08) });
      sub(c, 62 * c.p, 32, 0.42, 0.3);
      crunch(c, { f: 1800, f1: 170, dur: 0.9, vol: vv(c, 0.55), a: 0.004, out: c.g.drive(1.4, c.g.gain(0.9, c.out)) });
      grains(c, { f: 1300, f1: 700, q: 2.2, n: 30, span: 1.1, at: 0.08, vol: 0.7, len: [0.005, 0.016], fade: 1.3, early: 1.8, jit: 0.4 });
      bell(c, chordHz(c.h, 0, 5), 0.6, 0.05, 0.02, 0.8);
    },
  },
  // Royal Privilege procs (the attacker's own 2D chime): two golden notes up the chord
  'qiyana.royal': {
    cat: 'confirm',
    lvl: 1,
    dur: 0.45,
    max: 2,
    gap: 0.15,
    vary: 0.004,
    fn: (c) => {
      gold(c, { i: 0, decay: 0.2, vol: 0.12, rich: false });
      gold(c, { i: 2, decay: 0.38, vol: 0.12, at: 0.06, rich: false });
      sparkle(c, 0.2, 2, 0.02, 6, 0.08);
    },
  },
};
