/**
 * LOCKE, the Ashen Exorcist (Demacia): a silver stake, ritual nails, a soul flame, a reliquary.
 *
 * Timbre family: iron chain links (small FM clinks kept under ~4 kHz) and small silver bells on the
 * chord for the everyday moves; a deep church bell (FM 1:1.4 strike, a hum an octave below, the
 * tierce on the chord's third) for the big ones; fire as soft low "whoomphs" of brown noise with a
 * crackle of band-passed pink grains, never hiss; a choir on the chord when a soul is sealed.
 * The swings stay in 300 Hz-2 kHz; sub only when the reliquary lands.
 */
import type { NoiseColor } from '../graph';
import { bell, blip, chordHz, rr, semi, smack, sub, swell, thump, whoosh, type SfxCtx, type SfxDef } from '../layers';

/** chain links: small FM clinks (ratio 2.41) through a low-pass that keeps them under ~4 kHz */
function links(c: SfxCtx, n: number, o: { at?: number; spread?: [number, number]; vol: number; f?: [number, number] }): void {
  const lp = c.g.filter('lowpass', 3800, 0.7, c.out);
  let at = o.at ?? 0;
  for (let i = 0; i < n; i++) {
    c.g.fm({ f: rr(c, o.f?.[0] ?? 1100, o.f?.[1] ?? 1650), ratio: 2.41, index: rr(c, 1.1, 1.6), t: c.t + at, dur: rr(c, 0.05, 0.09), vol: o.vol * rr(c, 0.6, 1), out: lp });
    at += rr(c, o.spread?.[0] ?? 0.02, o.spread?.[1] ?? 0.045);
  }
}

/**
 * a church bell on a chord tone: an FM strike (carrier:modulator 1:1.4, its brightness dying
 * first), the hum an octave below that outlasts it, and the tierce tuned to the chord's third
 */
function toll(c: SfxCtx, o: { f: number; dur: number; vol: number; at?: number; index?: number; hum?: boolean; tierce?: boolean }): void {
  const t = c.t + (o.at ?? 0);
  const v = o.vol * rr(c, 0.84, 1.16);
  c.g.fm({ f: o.f, ratio: 1.4, index: o.index ?? 4, index1: 0.3, t, dur: o.dur * 0.7, vol: v, a: 0.002, out: c.g.filter('highpass', o.f * 0.7, 0.8, c.out) });
  if (o.hum !== false) c.g.tone({ f: o.f * 0.5, f1: o.f * 0.5 * 0.997, t, dur: o.dur, vol: v * 0.32, a: 0.012, out: c.out });
  if (o.tierce !== false) c.g.tone({ f: o.f * (chordHz(c.h, 1, 4) / chordHz(c.h, 0, 4)), t, dur: o.dur * 0.55, vol: v * 0.2, a: 0.004, out: c.out });
}

/** the soul flame catching: a soft low whoomph of brown noise opening upward, a breath of pressure */
function whoomph(c: SfxCtx, o: { dur: number; vol: number; at?: number; f0?: number; f1?: number }): void {
  const t = c.t + (o.at ?? 0);
  c.g.noiseBurst({ color: 'pink', type: 'bandpass', f: (o.f0 ?? 230) * c.p, f1: (o.f1 ?? 750) * c.p, glide: o.dur * 0.35, q: 1.1, t, dur: o.dur, vol: o.vol * rr(c, 0.84, 1.16), a: 0.03, out: c.g.filter('highpass', 150, 0.7, c.out) });
  c.g.tone({ f: 190 * c.p, f1: 140, t, dur: o.dur * 0.5, vol: o.vol * 0.22, a: 0.02, out: c.out });
}

/** ash or smoke blown out: brown noise through a falling band, high-passed so it carries no sub */
function puff(c: SfxCtx, o: { f: number; f1: number; dur: number; vol: number; at?: number }): void {
  c.g.noiseBurst({ color: 'brown', type: 'bandpass', f: o.f * c.p, f1: o.f1 * c.p, q: 0.8, t: c.t + (o.at ?? 0), dur: o.dur, vol: o.vol * rr(c, 0.84, 1.16), a: 0.006, out: c.g.filter('highpass', 150, 0.7, c.out) });
}

/** about +/-1.5 dB of level variation on a layer */
const vv = (c: SfxCtx, v: number) => v * rr(c, 0.84, 1.16);

/**
 * Many short grains from ONE noise source (one band-pass, one automated gain): ember crackle, a
 * rain of nails. Each grain takes its own centre around a sweep f -> f1. Three nodes whatever the
 * count.
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

/** a spinning cut: one noise band whose centre and level rise and fall once per pass of a blade */
function spin(c: SfxCtx, o: { passes: number; dur: number; vol: number; lo?: number; hi?: number; q?: number; at?: number }): void {
  const g = c.g;
  const t = c.t + (o.at ?? 0);
  const k = c.p * rr(c, 0.92, 1.08);
  const lo = (o.lo ?? 380) * k;
  const hi = Math.min(4500, (o.hi ?? 1400) * k);
  const src = g.noiseSrc('pink', t, o.dur);
  const bp = g.filter('bandpass', lo, o.q ?? 1.5);
  const amp = g.gain(0);
  src.connect(bp).connect(amp).connect(c.out);
  const per = o.dur / o.passes;
  bp.frequency.setValueAtTime(lo, t);
  amp.gain.setValueAtTime(0.0001, t);
  for (let i = 0; i < o.passes; i++) {
    const s = t + i * per;
    const v = o.vol * (i === 0 ? 1 : rr(c, 0.65, 0.85));
    bp.frequency.exponentialRampToValueAtTime(hi, s + per * 0.45);
    bp.frequency.exponentialRampToValueAtTime(lo, s + per);
    amp.gain.exponentialRampToValueAtTime(v, s + per * 0.45);
    amp.gain.exponentialRampToValueAtTime(v * 0.06, s + per);
  }
  amp.gain.exponentialRampToValueAtTime(0.0001, t + o.dur + 0.02);
}

/** the reliquary tumbling through the air: a band of noise beating with each turn */
function tumble(c: SfxCtx, o: { dur: number; vol: number; at?: number; rate: number; f?: number }): void {
  const g = c.g;
  const t = c.t + (o.at ?? 0);
  const src = g.noiseSrc('pink', t, o.dur);
  const bp = g.filter('bandpass', (o.f ?? 650) * c.p, 1.4);
  const am = g.gain(0.5);
  const env = g.gain(0);
  src.connect(bp).connect(am).connect(env).connect(c.out);
  const lfo = g.ctx.createOscillator();
  lfo.frequency.setValueAtTime(o.rate * rr(c, 0.9, 1.1), t);
  const depth = g.gain(0.5);
  depth.connect(am.gain);
  lfo.connect(depth);
  lfo.start(t);
  lfo.stop(t + o.dur + 0.05);
  g.envelope(env.gain, t, o.vol, o.dur * 0.3, o.dur);
}

/** a choir on chord tones: saws through one shared vowel ("ah") filter bank, one shared vibrato */
function choir(c: SfxCtx, notes: number[], o: { dur: number; vol: number; at?: number; a?: number }): void {
  const g = c.g;
  const t = c.t + (o.at ?? 0);
  const env = g.gain(0);
  const lp = g.filter('lowpass', 4000, 0.7, c.out);
  for (const [ff, q, gg] of [[800, 8, 1], [1150, 9, 0.6], [2900, 12, 0.15]] as const) env.connect(g.filter('bandpass', ff, q, g.gain(gg * 2.5, lp)));
  const a = o.a ?? 0.12;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(o.vol, t + a);
  env.gain.setValueAtTime(o.vol, t + o.dur * 0.45);
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  const lfo = g.ctx.createOscillator();
  lfo.frequency.value = rr(c, 4.8, 5.6);
  const depth = g.gain(14);
  lfo.connect(depth);
  lfo.start(t);
  lfo.stop(t + o.dur + 0.05);
  for (const f of notes) {
    const osc = g.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    osc.detune.value = rr(c, -9, 9);
    depth.connect(osc.detune);
    osc.connect(env);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }
}

export const LOCKE: Record<string, SfxDef> = {
  // Exorcism, hits 1-3 and the air thrust: the stake's quick arc and a silver bell tick that climbs
  // the chord with the combo
  'locke.swing': {
    cat: 'basic',
    dur: 0.25,
    max: 3,
    combo: 0.85,
    fn: (c) => {
      whoosh(c, { f0: 360, f1: 1350, f2: 470, dur: rr(c, 0.14, 0.18), q: 1.6, vol: vv(c, 0.5), peak: 0.33, edge: 0.22 });
      bell(c, chordHz(c.h, Math.min(c.step, 3), 5), 0.14, 0.03 * rr(c, 0.85, 1.1), 0.035, 0.6);
    },
  },
  // Exorcism's fourth hit: a full turn with both weapons (two passes), the chains swinging out and
  // the bell resolving on the root
  'locke.swingHeavy': {
    cat: 'basic',
    lvl: 3,
    dur: 0.5,
    max: 2,
    fn: (c) => {
      spin(c, { passes: 2, dur: 0.42, vol: vv(c, 0.5), lo: 340, hi: 1300, q: 1.5 });
      thump(c, { f0: 190, f1: 95, dur: 0.1, vol: vv(c, 0.15), at: 0.02 });
      links(c, 3, { at: 0.08, spread: [0.05, 0.09], vol: 0.05 });
      bell(c, chordHz(c.h, 0, 5), 0.35, 0.07, 0.3, 0.8);
    },
  },
  // Ritual Nails: a flick of the wrist, three nails singing out, and a ritual bell that climbs the
  // chord on each of the three casts
  'locke.nails': {
    cat: 'skill',
    lvl: -1,
    dur: 0.45,
    max: 3,
    combo: 2,
    fn: (c) => {
      const k = Math.min(c.step, 2);
      whoosh(c, { f0: 700, f1: 2000, f2: 850, dur: 0.12, q: 2.2, vol: vv(c, 0.32), peak: 0.3, edge: 0.15 });
      grains(c, { f: 1900, q: 7, n: 3, span: 0.035, at: 0.008, vol: 0.7, len: [0.006, 0.012], jit: 0.12, atk: 0.0008 });
      // the nails flying off: a thin whistle that drops as they leave
      c.g.noiseBurst({ color: 'pink', type: 'bandpass', f: 2100 * c.p, f1: 1400 * c.p, q: 6, t: c.t + 0.01, dur: 0.22, vol: 0.09, a: 0.01, out: c.out });
      bell(c, chordHz(c.h, k, 5), 0.32 + 0.08 * k, vv(c, 0.065), 0.01, 0.7);
      if (k === 2) bell(c, chordHz(c.h, 0, 6), 0.4, 0.035, 0.03, 0.6);
      thump(c, { f0: 300, f1: 180, dur: 0.04, vol: 0.1 });
    },
  },
  // Soul Ignition: the soul flame catches (a soft low whoomph), a low bell, a short crackle of embers
  // and the soul rising a fifth
  'locke.ignite': {
    cat: 'skill',
    dur: 1.3,
    max: 2,
    fn: (c) => {
      whoomph(c, { dur: 0.5, vol: 0.55 });
      toll(c, { f: chordHz(c.h, 0, 4), dur: 1.3, vol: 0.16, at: 0.02, index: 2.5, tierce: false });
      grains(c, { f: 1500, q: 2.5, n: 14, span: 0.55, at: 0.06, vol: 0.22, len: [0.002, 0.006], jit: 0.5, early: 1.4, fade: 0.8 });
      blip(c, { f: chordHz(c.h, 0, 4), f1: chordHz(c.h, 2, 4), glide: 0.3, dur: 0.45, vol: 0.05, a: 0.08, at: 0.04 });
    },
  },
  // Ashen Pursuit: he blinks out in a puff of ash and lands in a circular cut, a bell tolling once
  'locke.pursuit': {
    cat: 'skill',
    dur: 1,
    max: 2,
    fn: (c) => {
      swell(c, 0.06, 700, 2200, 0.12, 'pink', 0, 1);
      puff(c, { f: 1100, f1: 380, dur: 0.32, vol: 0.3, at: 0.05 });
      spin(c, { passes: 1, dur: 0.3, vol: vv(c, 0.42), lo: 360, hi: 1400, at: 0.06 });
      toll(c, { f: chordHz(c.h, 0, 4), dur: 0.9, vol: 0.16, at: 0.07, index: 3, tierce: false });
      links(c, 2, { at: 0.1, vol: 0.04 });
    },
  },
  // the empowered lunge after Ashen Pursuit: a breath in, the soul flame flaring, a chain lash
  'locke.lunge': {
    cat: 'skill',
    dur: 0.45,
    max: 2,
    fn: (c) => {
      swell(c, 0.045, 600, 2000, vv(c, 0.14));
      whoosh(c, { f0: 420, f1: 1800, f2: 520, dur: 0.24, q: 1.4, vol: vv(c, 0.48), peak: 0.25, at: 0.035, edge: 0.25 });
      whoomph(c, { dur: 0.3, vol: 0.3, at: 0.03, f0: 220, f1: 800 });
      thump(c, { f0: 185, f1: 100, dur: 0.08, vol: vv(c, 0.12), at: 0.035 });
      links(c, 2, { at: 0.06, spread: [0.025, 0.04], vol: 0.045 });
    },
  },
  // Ritual Nails cashed in by a melee hit (arg.n = stacks): the nails burst out of the body with a
  // ghostly breath, more of them and a higher bell per stack (the hit itself is the central impact)
  'locke.nailBurst': {
    cat: 'skill',
    lvl: -2,
    dur: 0.4,
    max: 3,
    fn: (c) => {
      const n = Math.max(1, Math.min(3, Number(c.arg?.n ?? 2)));
      grains(c, { f: 2000, q: 5, n: 2 + 3 * n, span: 0.05 + 0.025 * n, vol: 0.4, len: [0.004, 0.01], jit: 0.2 });
      c.g.noiseBurst({ color: 'pink', type: 'bandpass', f: 500 * c.p, f1: 1400 * c.p, q: 1.2, t: c.t, dur: 0.18, vol: 0.15, a: 0.01, out: c.out });
      bell(c, chordHz(c.h, n - 1, 5), 0.28, vv(c, 0.09), 0.01, 0.8);
      thump(c, { f0: 320, f1: 170, dur: 0.05, vol: 0.2 });
    },
  },
  // Purgatory, the cast: the reliquary raised, the church bell tolls on the fifth and the chains
  // wake; enemies hear a low warning under it
  'locke.ult': {
    cat: 'ult',
    lvl: -2,
    dur: 1.6,
    max: 2,
    duck: 2,
    rev: 1.3,
    fn: (c) => {
      toll(c, { f: chordHz(c.h, 2, 3), dur: 2, vol: 0.3, index: 4.5 });
      swell(c, 0.28, 300, 1600, vv(c, 0.12));
      links(c, 2, { at: 0.05, spread: [0.06, 0.1], vol: 0.045 });
      if (!c.self) {
        const lp = c.g.filter('lowpass', 800, 0.8, c.out);
        const r = chordHz(c.h, 0, 2);
        for (const f of [r, r * semi(1)]) c.g.tone({ type: 'sawtooth', f, t: c.t + 0.08, dur: 0.8, vol: vv(c, 0.09), a: 0.06, out: lp });
      }
    },
  },
  // Purgatory, the throw: an overhand heave and the reliquary tumbling through the air (0.5 s)
  'locke.relicThrow': {
    cat: 'ult',
    lvl: -4,
    dur: 0.65,
    max: 2,
    fn: (c) => {
      whoosh(c, { f0: 260, f1: 1150, f2: 380, dur: 0.32, q: 1.3, vol: vv(c, 0.45), peak: 0.3, edge: 0.2 });
      tumble(c, { dur: 0.5, vol: 0.2, at: 0.05, rate: 9 });
      links(c, 2, { at: 0.12, spread: [0.12, 0.2], vol: 0.04 });
      blip(c, { f: chordHz(c.h, 2, 4), f1: chordHz(c.h, 2, 4) * semi(-1), dur: 0.5, vol: 0.022, a: 0.05, at: 0.05, vib: [20, 9] });
    },
  },
  // Purgatory lands: the reliquary hits the floor, the church bell strikes the root, chains crash
  // and the nails rain into the circle
  'locke.relicLand': {
    cat: 'ult',
    dur: 2.4,
    max: 2,
    duck: 4,
    rev: 1.3,
    fn: (c) => {
      thump(c, { f0: 135, f1: 45, dur: 0.35, vol: vv(c, 0.8) });
      sub(c, chordHz(c.h, 0, 2), chordHz(c.h, 0, 1), 0.4, 0.35);
      toll(c, { f: chordHz(c.h, 0, 3), dur: 2.6, vol: 0.34, at: 0.005, index: 5 });
      // chains crashing: iron links ringing at two pitches
      grains(c, { f: 1300, q: 14, n: 9, span: 0.3, at: 0.01, vol: 0.5, len: [0.015, 0.035], jit: 0.25, early: 1.5 });
      // the nails raining into the circle
      grains(c, { f: 2100, f1: 1500, q: 4, n: 34, span: 0.5, at: 0.05, vol: 0.22, len: [0.003, 0.007], jit: 0.3, early: 1.3 });
    },
  },
  // Purgatory seals a soul: a shaft of light falls on it, the choir sings the chord, the bell locks it
  'locke.seal': {
    cat: 'ult',
    lvl: 1,
    dur: 2.4,
    max: 3,
    duck: 3,
    rev: 1.3,
    fn: (c) => {
      c.g.noiseBurst({ color: 'pink', type: 'bandpass', f: 3200, f1: 650, glide: 0.24, q: 3, t: c.t, dur: 0.3, vol: 0.14, a: 0.02, out: c.out });
      blip(c, { f: chordHz(c.h, 0, 6), f1: chordHz(c.h, 0, 5), glide: 0.22, dur: 0.3, vol: 0.05, a: 0.01 });
      choir(c, [chordHz(c.h, 0, 4), chordHz(c.h, 1, 4), chordHz(c.h, 2, 4)], { dur: 1.6, vol: vv(c, 0.22), at: 0.12, a: 0.14 });
      toll(c, { f: chordHz(c.h, 0, 4), dur: 2.4, vol: 0.3, at: 0.2, index: 4, tierce: false });
      thump(c, { f0: 150, f1: 55, dur: 0.25, vol: vv(c, 0.55), at: 0.2 });
    },
  },
  // the reliquary picked back up (Locke's own 2D confirm): the latch closes and three small bells
  // climb the chord
  'locke.relicPick': {
    cat: 'confirm',
    lvl: 2,
    dur: 0.55,
    max: 1,
    vary: 0.004,
    fn: (c) => {
      smack(c, { f: 1300, q: 3, dur: 0.014, vol: 0.25, drop: 0.9 });
      smack(c, { f: 900, q: 3, dur: 0.018, vol: 0.28, at: 0.035, drop: 0.9 });
      [0, 1, 2].forEach((i) => bell(c, chordHz(c.h, i, 5), 0.3 + i * 0.08, vv(c, 0.16), 0.06 + i * 0.06, 0.3));
    },
  },
};
