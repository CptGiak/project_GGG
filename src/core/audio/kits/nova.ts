/**
 * NOVA, "Synth & Sample": twin holo-katanas played like a sampler.
 *
 * Timbre family: detuned-saw plucks on the score's chord (her combo and her ultimate are
 * arpeggios), sample chops (band-passed air gated into slices: the stutter edit), a held sample
 * stepping down (the glitch), and low-bit crushed chirps (her signature, re-voiced on triangles
 * so the grit stays under ~3 kHz). The blades are light: their air sits at 400-1600 Hz, the plucks
 * under ~2 kHz, and there is no sub outside the ultimate.
 */
import { chordHz, click, rr, smack, sub, swell, thump, whoosh, type SfxCtx, type SfxDef } from '../layers';

/** a synth pluck: saws through a resonant low-pass that snaps shut (one note = a detuned pair) */
function pluck(c: SfxCtx, o: { notes: number[]; dur: number; vol: number; at?: number; cut?: number; q?: number; det?: number; out?: AudioNode }): void {
  const t = c.t + (o.at ?? 0);
  const cut = (o.cut ?? 1600) * rr(c, 0.92, 1.08);
  const lp = c.g.filter('lowpass', cut, o.q ?? 2, o.out ?? c.out);
  lp.frequency.setValueAtTime(cut, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(160, Math.min(...o.notes) * 1.2), t + o.dur * 0.6);
  const det = o.det ?? 8;
  const each = o.vol / Math.sqrt(o.notes.length);
  o.notes.forEach((f, i) => {
    if (o.notes.length === 1) for (const d of [-det, det]) c.g.tone({ type: 'sawtooth', f, t, dur: o.dur, vol: each * 0.6, a: 0.002, detune: d, out: lp });
    else c.g.tone({ type: 'sawtooth', f, t, dur: o.dur, vol: each, a: 0.002, detune: i % 2 ? det : -det, out: lp });
  });
}

/** sample chop: band-passed pink air gated into `n` slices that fade (a sampler's stutter edit) */
function chop(c: SfxCtx, o: { f: number; f1?: number; q?: number; dur: number; n: number; vol: number; at?: number; duty?: number; fade?: number }): void {
  const g = c.g;
  const t = c.t + (o.at ?? 0);
  const f0 = Math.min(4500, o.f * c.p);
  const bp = g.filter('bandpass', f0, o.q ?? 2);
  bp.frequency.setValueAtTime(f0, t);
  if (o.f1) bp.frequency.exponentialRampToValueAtTime(Math.min(4500, o.f1 * c.p), t + o.dur);
  const gate = g.gain(0, c.out);
  const slice = o.dur / o.n;
  const on = Math.max(0.007, slice * (o.duty ?? 0.55));
  gate.gain.setValueAtTime(0, t);
  for (let i = 0; i < o.n; i++) {
    const a = t + i * slice;
    const v = o.vol * Math.pow(o.fade ?? 0.7, i) * rr(c, 0.8, 1);
    gate.gain.setValueAtTime(0, a);
    gate.gain.linearRampToValueAtTime(v, a + 0.002);
    gate.gain.setValueAtTime(v, a + on - 0.003);
    gate.gain.linearRampToValueAtTime(0, a + on);
  }
  g.noiseSrc('pink', t, o.dur).connect(bp).connect(gate);
}

/**
 * crushed chirps: short triangle notes through a low-bit quantiser and a low-pass, one every
 * `rate` s (the 8-bit grit of her signature); `glide` bends each note, `fade` shrinks the next
 */
function bits(c: SfxCtx, o: { notes: number[]; rate: number; len?: number; vol: number; at?: number; bits?: number; glide?: number; fade?: number; lp?: number; type?: OscillatorType }): void {
  const lp = c.g.filter('lowpass', (o.lp ?? 2800) * rr(c, 0.9, 1.1), 0.8, c.out);
  const crush = c.g.crush(o.bits ?? 4, c.g.gain(o.vol, lp));
  o.notes.forEach((f, i) => c.g.tone({ type: o.type ?? 'triangle', f, f1: f * (o.glide ?? 1), t: c.t + (o.at ?? 0) + i * o.rate, dur: o.len ?? o.rate * 0.8, vol: 0.85 * Math.pow(o.fade ?? 1, i), a: 0.001, out: crush }));
}

/** a held sample stuttering: one oscillator jumping through `freqs`, one gated slice each */
function stepper(c: SfxCtx, o: { freqs: number[]; slice: number; duty?: number; vol: number; at?: number; type?: OscillatorType; cut?: number; bits?: number }): void {
  const g = c.g;
  const t = c.t + (o.at ?? 0);
  const lp = g.filter('lowpass', o.cut ?? 2000, 0.9, c.out);
  // the level is set after the quantiser: before it, the crusher would round it away
  const post = g.gain(o.bits ? o.vol / 0.7 : 1, lp);
  const gate = g.gain(0, o.bits ? g.crush(o.bits, post) : post);
  const peak = o.bits ? 0.7 : o.vol;
  const osc = g.ctx.createOscillator();
  osc.type = o.type ?? 'sawtooth';
  osc.connect(gate);
  const on = o.slice * (o.duty ?? 0.7);
  gate.gain.setValueAtTime(0, t);
  o.freqs.forEach((f, i) => {
    const a = t + i * o.slice;
    const v = peak * (1 - i / (o.freqs.length + 1));
    osc.frequency.setValueAtTime(f, a);
    gate.gain.setValueAtTime(0, a);
    gate.gain.linearRampToValueAtTime(v, a + 0.002);
    gate.gain.setValueAtTime(v, a + on - 0.003);
    gate.gain.linearRampToValueAtTime(0, a + on);
  });
  osc.start(t);
  osc.stop(t + o.freqs.length * o.slice + 0.03);
}

/** the X of Cross Fade: two saws gliding across each other (one falls, one climbs) and swapping sides */
function xglide(c: SfxCtx, lo: number, hi: number, dur: number, vol: number, at = 0): void {
  const g = c.g;
  const t = c.t + at;
  const lp = g.filter('lowpass', 2000, 1.2, c.out);
  for (const [f0, f1, p0] of [[hi, lo, -0.7], [lo, hi, 0.7]] as const) {
    const pan = g.ctx.createStereoPanner();
    pan.pan.setValueAtTime(p0, t);
    pan.pan.linearRampToValueAtTime(-p0, t + dur);
    pan.connect(lp);
    g.tone({ type: 'sawtooth', f: f0, f1, glide: dur, t, dur, vol, a: 0.006, hold: dur * 0.5, out: pan });
  }
}

/** the barrage's melody, chord tone and octave per strike: D4 A4 D5 A4 | F5 D5 A5 D5 on D minor */
const RIFF: Array<[number, number]> = [[0, 4], [2, 4], [0, 5], [2, 4], [1, 5], [0, 5], [2, 5], [0, 5]];

export const NOVA: Record<string, SfxDef> = {
  // Sample Flurry, cuts 1-3: a light twin-edge sweep, a dark pluck under it that climbs the chord
  // with the combo, and the sampler's ghost of the cut (three shrinking slices)
  'nova.swing': {
    cat: 'basic',
    dur: 0.26,
    max: 3,
    combo: 0.8,
    fn: (c) => {
      const v = rr(c, 0.85, 1.1);
      whoosh(c, { f0: 420, f1: rr(c, 1300, 1500), f2: 560, dur: rr(c, 0.14, 0.18), q: 1.7, vol: 0.5 * v, peak: 0.25, edge: 0.22 });
      pluck(c, { notes: [chordHz(c.h, Math.min(c.step, 2), 4)], dur: 0.1, vol: 0.05 * v, at: 0.035, cut: 1300 });
      chop(c, { f: 1250, f1: 850, q: 2.4, dur: 0.1, n: 3, vol: 0.3, at: 0.085, fade: 0.65 });
    },
  },
  // the finisher's spin (c4): both blades pass, the arpeggio resolves on the chord, the stutter
  'nova.swingBig': {
    cat: 'basic',
    lvl: 2,
    dur: 0.5,
    max: 2,
    fn: (c) => {
      const v = rr(c, 0.88, 1.1);
      whoosh(c, { f0: 320, f1: 1250, f2: 420, dur: 0.22, q: 1.5, vol: 0.5 * v, peak: 0.45, edge: 0 });
      whoosh(c, { f0: 380, f1: 1550, f2: 480, dur: 0.2, q: 1.6, vol: 0.45 * v, peak: 0.4, at: rr(c, 0.14, 0.16), edge: 0 });
      pluck(c, { notes: [chordHz(c.h, 0, 4), chordHz(c.h, 2, 4), chordHz(c.h, 0, 5)], dur: 0.26, vol: 0.075, at: 0.04, cut: 1500 });
      bits(c, { notes: [chordHz(c.h, 2, 5), chordHz(c.h, 0, 5), chordHz(c.h, 2, 5)], rate: 0.034, vol: 0.05, at: 0.02, glide: 0.7 });
      thump(c, { f0: 220, f1: 140, dur: 0.06, vol: 0.04 });
    },
  },
  // Rising Remix (the air cut): the air climbs and stays up, a crushed arpeggio runs up the chord
  'nova.rise': {
    cat: 'basic',
    lvl: 1,
    dur: 0.4,
    max: 2,
    fn: (c) => {
      const v = rr(c, 0.88, 1.1);
      whoosh(c, { f0: 340, f1: 1600, f2: 1150, dur: 0.26, q: 1.5, vol: 0.5 * v, peak: 0.4, edge: 0.22 });
      bits(c, { notes: [0, 1, 2, 3].map((i) => chordHz(c.h, i, 4)), rate: 0.04, vol: 0.09 * v, at: 0.02, lp: 2600 });
      thump(c, { f0: 240, f1: 160, dur: 0.045, vol: 0.03 });
    },
  },
  // Cross Fade: the crossed blades fling apart and the X flies. Two synth voices glide across each
  // other (one falls while the other climbs, and they swap sides); the X's air recedes in slices
  'nova.cross': {
    cat: 'skill',
    dur: 0.6,
    max: 2,
    fn: (c) => {
      const v = rr(c, 0.88, 1.1);
      swell(c, 0.04, 800, 2400, 0.2);
      whoosh(c, { f0: 450, f1: 1800, f2: 600, dur: 0.2, q: 1.5, vol: 0.45 * v, peak: 0.3, at: 0.03, edge: 0 });
      xglide(c, chordHz(c.h, 0, 4), chordHz(c.h, 2, 5), rr(c, 0.24, 0.28), 0.09 * v, 0.03);
      chop(c, { f: 1400, f1: 650, q: 1.8, dur: 0.3, n: 7, vol: 0.3, at: 0.1, fade: 0.78 });
      bits(c, { notes: [chordHz(c.h, 2, 5), chordHz(c.h, 0, 5)], rate: 0.034, vol: 0.06, at: 0.03, glide: 0.6 });
      thump(c, { f0: 200, f1: 120, dur: 0.08, vol: 0.05, at: 0.03 });
    },
  },
  // Glitch Step: the buffer stutters out (the chord stepping down in slices), a dropout, the
  // crushed pop where she lands and its echo (the afterimage that cuts)
  'nova.glitch': {
    cat: 'skill',
    lvl: -1,
    dur: 0.45,
    max: 2,
    fn: (c) => {
      const r = chordHz(c.h, 0, 4);
      const v = rr(c, 0.88, 1.1);
      stepper(c, { freqs: [chordHz(c.h, 2, 4), chordHz(c.h, 1, 4), r, r * 0.5], slice: rr(c, 0.02, 0.024), vol: 0.3 * v, cut: 2400, bits: 5 });
      bits(c, { notes: [r * 2, r * 2, r * 2], rate: 0.09, len: 0.05, vol: 0.12, at: 0.12, glide: 1.5, fade: 0.45 });
      thump(c, { f0: 220, f1: 130, dur: 0.06, vol: 0.25 * v, at: 0.12 });
      smack(c, { f: 1200, q: 1.2, dur: 0.04, vol: 0.3 * v, at: 0.12, drop: 0.6 });
    },
  },
  // Phantom Cut: the sample is yanked out (a crushed stutter collapsing), a breath of reversed air,
  // then the cut behind the target: a sharp double sweep, a steel glint, a dark stab
  'nova.phantom': {
    cat: 'skill',
    lvl: 2,
    dur: 0.6,
    max: 2,
    rev: 1.1,
    fn: (c) => {
      const r = chordHz(c.h, 0, 4);
      const v = rr(c, 0.88, 1.1);
      stepper(c, { freqs: [r * 2, r * 1.5, r], slice: 0.018, vol: 0.15, cut: 1800, bits: 4 });
      swell(c, 0.05, 500, 2600, 0.25);
      whoosh(c, { f0: 600, f1: 2100, f2: 700, dur: 0.15, q: 1.8, vol: 0.5 * v, peak: 0.25, at: 0.03, edge: 0 });
      c.g.tone({ f: 1320 * c.p, t: c.t + 0.05, dur: 0.16, vol: 0.035, a: 0.001, out: c.out });
      pluck(c, { notes: [chordHz(c.h, 0, 3), chordHz(c.h, 2, 3)], dur: 0.3, vol: 0.13 * v, at: 0.05, cut: 800, q: 1.4 });
      bits(c, { notes: [chordHz(c.h, 2, 5), chordHz(c.h, 0, 5)], rate: 0.034, vol: 0.05, at: 0.06, glide: 0.6 });
    },
  },
  // Remix Barrage, the cast: the track is grabbed (her stutter at full length) over a chopped riser,
  // a sub drop on the root under it; enemies also hear a low minor-second warning
  'nova.ult': {
    cat: 'ult',
    dur: 1.2,
    max: 2,
    duck: 4,
    rev: 1.2,
    fn: (c) => {
      const r2 = chordHz(c.h, 0, 2);
      bits(c, { notes: [chordHz(c.h, 2, 5), chordHz(c.h, 0, 5), chordHz(c.h, 0, 6)], rate: 0.045, vol: 0.07, glide: 0.6, lp: 3000 });
      chop(c, { f: 600, f1: 2600, q: 1.6, dur: 0.4, n: 10, vol: 0.6, fade: 1.08, duty: 0.5 });
      sub(c, r2 * 2, r2 * 0.5, 0.6, 0.28 * rr(c, 0.9, 1.1), 0.02);
      if (!c.self) {
        // the warning pulses at the strikes' rate (5 a second)
        const lp = c.g.filter('lowpass', 520, 1, c.out);
        const am = c.g.gain(0.6, lp);
        const lfo = c.g.ctx.createOscillator();
        lfo.frequency.value = 5;
        lfo.connect(c.g.gain(0.4)).connect(am.gain);
        lfo.start(c.t + 0.08);
        lfo.stop(c.t + 1.1);
        for (const f of [r2, r2 * Math.pow(2, 1 / 12)]) c.g.tone({ type: 'sawtooth', f, t: c.t + 0.08, dur: 0.95, vol: 0.1, a: 0.12, hold: 0.4, out: am });
      }
    },
  },
  // Remix Barrage, each of the 8 strikes: a pluck walking the chord (RIFF), a quick blade, a crushed
  // tick; the eighth lands on the root with a bass note, a sub and the stutter
  'nova.barrage': {
    cat: 'skill',
    lvl: 1,
    dur: 0.3,
    max: 3,
    combo: 0.4,
    gap: 0.1,
    fn: (c) => {
      const k = Math.min(c.step, RIFF.length - 1);
      const [i, oct] = RIFF[k];
      const f = chordHz(c.h, i, oct);
      const v = rr(c, 0.88, 1.1);
      pluck(c, { notes: [f], dur: 0.2 + 0.015 * k, vol: 0.15 * v, cut: 1600 + 100 * k });
      whoosh(c, { f0: 500, f1: rr(c, 1600, 1850), f2: 600, dur: 0.12, q: 1.6, vol: 0.4 * v, peak: 0.3, edge: 0 });
      bits(c, { notes: [f * 2], rate: 0.03, vol: 0.035, glide: 0.7, bits: 5, lp: 2400 });
      if (k === RIFF.length - 1) {
        pluck(c, { notes: [chordHz(c.h, 0, 3), chordHz(c.h, 0, 4)], dur: 0.5, vol: 0.16, cut: 1000, q: 1.2 });
        sub(c, chordHz(c.h, 0, 2), chordHz(c.h, 0, 1), 0.35, 0.22);
      }
    },
  },
  // a takedown reloads her (Glitch Step back, Phantom Cut halved): her own 2D cue, after the kill
  // confirm has spoken: three crushed blips up the chord, a bright pluck
  'nova.reset': {
    cat: 'confirm',
    lvl: -2,
    dur: 0.6,
    max: 1,
    fn: (c) => {
      const v = rr(c, 0.85, 1.1);
      bits(c, { notes: [0, 1, 2].map((i) => chordHz(c.h, i, 5)), rate: 0.05, vol: 0.2 * v, at: 0.2, lp: 3500 });
      pluck(c, { notes: [chordHz(c.h, 0, 5)], dur: 0.22, vol: 0.12, at: 0.35, cut: 3000 });
    },
  },
  // Phantom Cut spends a glitch mark (half cooldown): her own 2D cue, a crushed "lock"
  'nova.mark': {
    cat: 'confirm',
    lvl: -3,
    dur: 0.2,
    max: 1,
    fn: (c) => {
      bits(c, { notes: [chordHz(c.h, 2, 5), chordHz(c.h, 0, 6)], rate: 0.045, vol: 0.2 * rr(c, 0.85, 1.1), lp: 3500 });
      click(c, { f: 1800, dur: 0.004, vol: 0.05 });
    },
  },
  // Phantom Cut finds nobody: her own 2D cue, a dry crushed "nope" (a minor second down)
  'nova.fizzle': {
    cat: 'confirm',
    lvl: -8,
    dur: 0.15,
    max: 1,
    fn: (c) => {
      stepper(c, { freqs: [chordHz(c.h, 1, 4), chordHz(c.h, 1, 4) * Math.pow(2, -1 / 12)], slice: 0.045, vol: 0.25 * rr(c, 0.85, 1.1), cut: 1400, bits: 4, type: 'square' });
    },
  },
};
