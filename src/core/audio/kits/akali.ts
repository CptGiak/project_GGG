/**
 * AKALI, "True Damage": kama and kunai, a rapper's smoke bomb.
 *
 * Timbre family: vinyl scratches (a saw "sample" and pink record grain through a band that
 * follows the hand, the fader cutting between strokes), short 808s on the chord root (98-196 Hz
 * for her moves, an octave lower with a real sub only for Perfect Execution), crisp steel for the
 * kunai and the shuriken kept under ~3.5 kHz, and smoke as a soft pink "poof" over a low whoomp,
 * never a hiss.
 */
import { chordHz, mallet, ring, rr, sparkle, sub, swell, thump, whoosh, type SfxCtx, type SfxDef } from '../layers';

/** the chord root between 98 and 196 Hz: where her 808s sit (laptops still hear it) */
function low(c: SfxCtx): number {
  const f = chordHz(c.h, 0, 3);
  return f > 196 ? f / 2 : f;
}

/**
 * a vinyl scratch: a saw "sample" and pink record grain through a band that follows the hand.
 * Each stroke speeds up and slows down (pitch up then down); pulling back sits a little lower.
 * `cut` closes the fader early in each stroke (a chirp, or a transformer when strokes are short).
 */
function scratch(c: SfxCtx, o: { dur: number; n: number; vol: number; at?: number; f?: number; up?: number; rest?: number; cut?: number; back?: boolean }): void {
  const g = c.g;
  const t = c.t + (o.at ?? 0);
  const f = (o.f ?? 150) * rr(c, 0.94, 1.06);
  const up = o.up ?? 2.6;
  const rest = o.rest ?? 0.7;
  const env = g.gain(0, c.out);
  const bp = g.filter('bandpass', f * 3, 2.2, env);
  const saw = g.ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.connect(g.gain(0.55, bp));
  g.noiseSrc('pink', t, o.dur).connect(g.gain(0.7, bp));
  const st = o.dur / o.n;
  env.gain.setValueAtTime(0, t);
  for (let i = 0; i < o.n; i++) {
    const a = t + i * st;
    const back = (i + (o.back ? 1 : 0)) % 2 === 1;
    const k = up * (back ? 0.78 : 1) * rr(c, 0.9, 1.1);
    saw.frequency.setValueAtTime(f * rest, a);
    saw.frequency.linearRampToValueAtTime(f * k, a + st * 0.45);
    saw.frequency.linearRampToValueAtTime(f * rest, a + st);
    bp.frequency.setValueAtTime(f * rest * 3, a);
    bp.frequency.linearRampToValueAtTime(Math.min(2600, f * k * 4), a + st * 0.45);
    bp.frequency.linearRampToValueAtTime(f * rest * 3, a + st);
    const v = o.vol * rr(c, 0.85, 1);
    env.gain.setValueAtTime(0.0001, a);
    env.gain.linearRampToValueAtTime(v, a + st * 0.3);
    env.gain.linearRampToValueAtTime(0, a + st * (o.cut ?? 0.95));
  }
  saw.start(t);
  saw.stop(t + o.dur + 0.02);
}

/** an 808: a sine that drops onto the note, a touch of drive so small speakers hear the knock */
function kick(c: SfxCtx, f: number, dur: number, vol: number, at = 0): void {
  const d = c.g.drive(1.8, c.g.gain(0.7, c.out));
  c.g.tone({ f: f * 2.4, f1: f, tau: 0.016, t: c.t + at, dur, vol, a: 0.002, out: d });
}

/** thrown steel leaving in a fan: one band of pink air restruck per blade, swept left to right */
function volley(c: SfxCtx, o: { n: number; gap: number; f: number; vol: number; at?: number; spread?: number }): void {
  const g = c.g;
  const t = c.t + (o.at ?? 0);
  const pan = g.ctx.createStereoPanner();
  pan.connect(c.out);
  const env = g.gain(0, pan);
  const bp = g.filter('bandpass', o.f, 3, env);
  g.noiseSrc('pink', t, o.n * o.gap + 0.08).connect(bp);
  env.gain.setValueAtTime(0, t);
  const sp = o.spread ?? 0.6;
  for (let i = 0; i < o.n; i++) {
    const a = t + (i + rr(c, -0.15, 0.15)) * o.gap;
    const f = Math.min(2000, o.f * rr(c, 0.9, 1.12) * c.p);
    bp.frequency.setValueAtTime(f * 1.25, a);
    bp.frequency.exponentialRampToValueAtTime(f * 0.7, a + 0.05);
    pan.pan.setValueAtTime(-sp + (2 * sp * i) / Math.max(1, o.n - 1), a);
    env.gain.setValueAtTime(0, a);
    env.gain.linearRampToValueAtTime(o.vol * rr(c, 0.8, 1), a + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, a + 0.055);
  }
}

/** steel ticks on the chord: one oscillator stepping through `notes`, each a struck, fast-dying ping */
function pings(c: SfxCtx, notes: number[], gap: number, vol: number, at = 0): void {
  const t = c.t + at;
  const env = c.g.gain(0, c.out);
  const o = c.g.ctx.createOscillator();
  o.connect(env);
  env.gain.setValueAtTime(0, t);
  notes.forEach((f, i) => {
    const a = t + i * gap;
    o.frequency.setValueAtTime(f, a);
    env.gain.setValueAtTime(0.0001, a);
    env.gain.exponentialRampToValueAtTime(vol * rr(c, 0.75, 1), a + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, a + gap * 0.95);
  });
  o.start(t);
  o.stop(t + notes.length * gap + 0.02);
}

/** a spinning blade flying off: a narrow band of pink grain chopped by its rotation, falling away */
function whir(c: SfxCtx, o: { f: number; f1: number; rate: number; rate1?: number; dur: number; vol: number; at?: number }): void {
  const g = c.g;
  const t = c.t + (o.at ?? 0);
  const env = g.gain(0, c.out);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(o.vol, t + 0.015);
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  const am = g.gain(0.5, env);
  const lfo = g.ctx.createOscillator();
  lfo.type = 'triangle';
  lfo.frequency.setValueAtTime(o.rate, t);
  lfo.frequency.linearRampToValueAtTime(o.rate1 ?? o.rate, t + o.dur);
  const depth = g.gain(0.5);
  depth.connect(am.gain);
  lfo.connect(depth);
  const bp = g.filter('bandpass', o.f * c.p, 4, am);
  bp.frequency.setValueAtTime(o.f * c.p, t);
  bp.frequency.exponentialRampToValueAtTime(o.f1 * c.p, t + o.dur);
  g.noiseSrc('pink', t, o.dur).connect(bp);
  lfo.start(t);
  lfo.stop(t + o.dur + 0.05);
}

/** a low minor-second drone: what enemies hear when her execution is coming */
function threat(c: SfxCtx, dur: number, vol: number, at = 0): void {
  const r = chordHz(c.h, 0, 2);
  const lp = c.g.filter('lowpass', 480, 1, c.out);
  for (const f of [r, r * Math.pow(2, 1 / 12)]) c.g.tone({ type: 'sawtooth', f, t: c.t + at, dur, vol, a: 0.1, hold: dur * 0.4, out: lp });
}

export const AKALI: Record<string, SfxDef> = {
  // Kama Strikes, cuts 1-2: the kama's air (a slightly whistling curve), a baby scratch under it
  // (forward on the first cut, pulled back on the second) and a faint glint of the blade
  'akali.swing': {
    cat: 'basic',
    dur: 0.26,
    max: 3,
    combo: 0.7,
    fn: (c) => {
      const v = rr(c, 0.85, 1.1);
      whoosh(c, { f0: 440, f1: rr(c, 1250, 1450), f2: 560, dur: rr(c, 0.14, 0.18), q: 2.1, vol: 0.5 * v, peak: 0.26, edge: 0.18 });
      scratch(c, { dur: 0.085, n: 1, vol: 0.28 * v, at: 0.015, f: 170, up: 2.3, rest: 0.8, back: c.step % 2 === 1 });
      const f = rr(c, 1300, 1550);
      c.g.tone({ f, t: c.t + 0.05, dur: 0.07, vol: 0.012, a: 0.001, out: c.out });
      c.g.tone({ f: f + 6, t: c.t + 0.05, dur: 0.06, vol: 0.01, a: 0.001, out: c.out });
    },
  },
  // c3, the spin: kama and kunai go round (two passes), a "wikka-wikka" scratch, an 808 as she plants
  'akali.spin': {
    cat: 'basic',
    lvl: 3,
    dur: 0.45,
    max: 2,
    fn: (c) => {
      const v = rr(c, 0.88, 1.1);
      kick(c, low(c), 0.13, 0.06 * v, 0.01);
      whoosh(c, { f0: 340, f1: 1350, f2: 420, dur: 0.2, q: 1.6, vol: 0.5 * v, peak: 0.45, edge: 0, at: 0.02 });
      whoosh(c, { f0: 400, f1: 1600, f2: 480, dur: 0.18, q: 1.8, vol: 0.42 * v, peak: 0.4, edge: 0, at: rr(c, 0.15, 0.17) });
      scratch(c, { dur: 0.26, n: 4, vol: 0.3, at: 0.03, f: 170, up: 2.5, rest: 0.8 });
    },
  },
  // the air cut, rising: the air climbs and stays up, one long forward scratch rides it
  'akali.rise': {
    cat: 'basic',
    lvl: 1,
    dur: 0.36,
    max: 2,
    fn: (c) => {
      const v = rr(c, 0.88, 1.1);
      whoosh(c, { f0: 340, f1: 1450, f2: 1000, dur: 0.24, q: 1.7, vol: 0.5 * v, peak: 0.55, edge: 0.15 });
      scratch(c, { dur: 0.16, n: 1, vol: 0.3 * v, at: 0.02, f: 160, up: 2.4, rest: 0.8 });
      thump(c, { f0: 240, f1: 160, dur: 0.045, vol: 0.03 });
    },
  },
  // Five Point Strike: the arms flick open and five kunai leave in a fan (each a zip and a tick of
  // steel on the chord, left to right); a scratch cuts in on the throw, a small 808 under it
  'akali.kunai': {
    cat: 'skill',
    dur: 0.45,
    max: 2,
    fn: (c) => {
      const v = rr(c, 0.88, 1.1);
      whoosh(c, { f0: 500, f1: 1500, f2: 650, dur: 0.14, q: 1.6, vol: 0.3, peak: 0.3, edge: 0 });
      volley(c, { n: 5, gap: 0.018, f: 1150, vol: 0.8 * v, at: 0.01 });
      pings(c, [0, 1, 2, 3, 4].map((i) => chordHz(c.h, i, 5)), 0.018, 0.035, 0.012);
      scratch(c, { dur: 0.08, n: 1, vol: 0.2, f: 170, up: 2.1, rest: 0.8 });
      kick(c, low(c), 0.1, 0.03 * v);
    },
  },
  // Twilight Shroud: the bomb hits the floor (a low whoomp and a soft pink poof), the record brakes
  // to a stop as she fades, the smoke blooms, a few glints in it
  'akali.shroud': {
    cat: 'skill',
    lvl: 1,
    dur: 1,
    max: 2,
    rev: 1.2,
    fn: (c) => {
      const g = c.g;
      const v = rr(c, 0.88, 1.1);
      thump(c, { f0: 160 * rr(c, 0.92, 1.08), f1: 90, dur: rr(c, 0.22, 0.28), vol: 0.12 * v });
      g.noiseBurst({ color: 'pink', type: 'bandpass', f: 520 * c.p, f1: 300, q: 0.8, t: c.t, dur: 0.4, vol: 1.0 * v, a: 0.012, out: c.out });
      g.noiseBurst({ color: 'pink', type: 'bandpass', f: 380 * c.p, f1: 240, q: 0.6, t: c.t + 0.05, dur: rr(c, 0.7, 0.9), vol: 0.6 * v, a: 0.15, out: c.out });
      const lp = g.filter('lowpass', 1600, 1, c.out);
      lp.frequency.setValueAtTime(1600, c.t + 0.04);
      lp.frequency.exponentialRampToValueAtTime(250, c.t + 0.5);
      for (const f of [chordHz(c.h, 0, 4), chordHz(c.h, 2, 4)]) {
        const o = g.tone({ type: 'sawtooth', f, t: c.t + 0.04, dur: 0.5, vol: 0.08 * v, a: 0.004, hold: 0.25, out: lp });
        o.frequency.linearRampToValueAtTime(f * rr(c, 0.25, 0.35), c.t + 0.5);
      }
      sparkle(c, 0.4, 3, 0.02, 6, 0.3);
    },
  },
  // Shuriken Flip: she flips back (a low body sweep) and the star leaves with a "shing", whirring
  // away; a scratch on the throw
  'akali.shuriken': {
    cat: 'skill',
    dur: 0.6,
    max: 2,
    fn: (c) => {
      const v = rr(c, 0.88, 1.1);
      whoosh(c, { f0: 260, f1: 900, f2: 320, dur: 0.32, q: 1.2, vol: 0.35 * v, peak: 0.45, edge: 0 });
      ring(c, { f: rr(c, 1150, 1300), decay: 0.22, vol: 0.05, bright: 0.5, ratios: [1, 2.32] });
      whir(c, { f: 2000, f1: 1100, rate: rr(c, 32, 36), rate1: 26, dur: 0.45, vol: 0.6 * v, at: 0.01 });
      scratch(c, { dur: 0.1, n: 1, vol: 0.25, f: 170, up: 2.6, rest: 0.8 });
    },
  },
  // Shuriken Flip, the recast: she drops onto the marked target: a breath, a forward scratch, the
  // zip, an 808 on the launch
  'akali.flipDash': {
    cat: 'skill',
    lvl: 1,
    dur: 0.5,
    max: 2,
    fn: (c) => {
      const v = rr(c, 0.88, 1.1);
      swell(c, 0.05, 500, 1800, 0.25);
      scratch(c, { dur: 0.12, n: 1, vol: 0.35 * v, f: 160, up: 2.5, rest: 0.8, at: 0.02 });
      whoosh(c, { f0: 400, f1: 1600, f2: 560, dur: 0.28, q: 1.4, vol: 0.55 * v, peak: 0.25, at: 0.04, edge: 0.2 });
      kick(c, low(c), 0.13, 0.05 * v, 0.04);
    },
  },
  // Perfect Execution, the first dash: a scratch winds up, she cuts through (a long zip, the kama's
  // ring), an 808 with a real sub on the root; enemies hear the execution coming (a low
  // minor-second drone)
  'akali.exec1': {
    cat: 'ult',
    dur: 1.1,
    max: 2,
    duck: 3,
    rev: 1.1,
    fn: (c) => {
      const f = low(c);
      const v = rr(c, 0.88, 1.1);
      scratch(c, { dur: 0.1, n: 2, vol: 0.5 * v, f: 160, up: 2.8, rest: 0.8 });
      whoosh(c, { f0: 380, f1: 1900, f2: 520, dur: 0.32, q: 1.3, vol: 0.9 * v, peak: 0.3, at: 0.06, edge: 0 });
      ring(c, { f: rr(c, 1000, 1100), decay: 0.3, vol: 0.06, ratios: [1], at: 0.1 });
      sub(c, f * 1.2, f * 0.45, 0.4, 0.2 * v, 0.06);
      if (!c.self) threat(c, 0.9, 0.08, 0.15);
    },
  },
  // Perfect Execution, the execute: a transformer scratch (the fader chopping the record), the cut
  // through (zip and kama ring) and the drop: an 808 sliding down onto the root's sub
  'akali.exec2': {
    cat: 'ult',
    lvl: 2,
    dur: 1.4,
    max: 2,
    duck: 4,
    rev: 1.3,
    fn: (c) => {
      const f = low(c);
      const v = rr(c, 0.88, 1.1);
      scratch(c, { dur: 0.16, n: 4, vol: 0.6 * v, f: 170, up: 2.6, rest: 0.8, cut: 0.55 });
      whoosh(c, { f0: 340, f1: 1800, f2: 460, dur: 0.36, q: 1.3, vol: 0.9 * v, peak: 0.35, at: 0.08, edge: 0 });
      ring(c, { f: rr(c, 900, 1000), decay: 0.4, vol: 0.08, ratios: [1], at: 0.12 });
      kick(c, f, 0.5, 0.18 * v, 0.1);
      sub(c, f * 0.75, f / 2, 0.7, 0.2 * v, 0.1);
    },
  },
  // the Assassin's Mark cashed in (her own 2D cue): a quick scratch cut and a two-note rise
  'akali.markPop': {
    cat: 'confirm',
    lvl: -2,
    dur: 0.3,
    max: 2,
    fn: (c) => {
      const v = rr(c, 0.85, 1.1);
      scratch(c, { dur: 0.07, n: 1, vol: 0.5 * v, f: 220, up: 2.4, rest: 0.8 });
      mallet(c, chordHz(c.h, 0, 5), 0.12, 0.12 * v, 0.03);
      mallet(c, chordHz(c.h, 2, 5), 0.18, 0.12, 0.08);
    },
  },
};
