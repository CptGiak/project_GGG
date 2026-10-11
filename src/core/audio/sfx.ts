/**
 * Sound effect recipes.
 *
 * Every effect is built from layers with one job each (transient, body, tail, sub), each from a
 * different generator, and every play is a fresh variation (pitch, filter, envelope, noise grain).
 * Layers that carry pitch take it from the score's current chord, so a kill confirm or a medal
 * always sits in key with the music. Champions add a small signature layer to their own swings,
 * dashes and ultimates (Kaiser's bass wobble, Nova's bit-crushed stutter, Akali's scratch...).
 */
import type { Graph, NoiseColor } from './graph';
import type { Harmony } from './music';

export interface SfxCtx {
  g: Graph;
  /** start time */
  t: number;
  /** voice input (already panned, distance-filtered and sent to the room) */
  out: AudioNode;
  /** random pitch multiplier for this play */
  p: number;
  /** requested volume (0..~1.2): heavier calls get heavier layers */
  v: number;
  r: () => number;
  /** consecutive repeats from the same source (combo escalation) */
  step: number;
  /** champion making the sound, when known */
  champ: string | null;
  /** the local player's own sound */
  self: boolean;
  h: Harmony;
  /** arena id (surfaces) */
  arena: string;
}

export interface SfxDef {
  fn: (c: SfxCtx) => void;
  /** approximate length (voice accounting) */
  dur: number;
  /** concurrent instances before the oldest is stolen */
  max?: number;
  /** reverb send multiplier */
  rev?: number;
  /** 2D: no distance, pan or room (UI and the player's own confirms) */
  ui?: boolean;
  /** random pitch range (+/- fraction) */
  vary?: number;
  /** repeats within this window (s) escalate `step` */
  combo?: number;
  /** music duck in dB when the sound is near the listener */
  duck?: number;
}

// -----------------------------------------------------------------------------------------------
// pitch helpers (follow the score)
// -----------------------------------------------------------------------------------------------

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
/** chord tone i (0 = root, wraps up the octave) in octave `oct` */
export function chordHz(h: Harmony, i: number, oct: number): number {
  const n = h.tones.length;
  const k = ((i % n) + n) % n;
  return hz(12 * (oct + 1) + h.root + h.tones[k] + 12 * Math.floor(i / n));
}
/** scale degree d (0-based, wraps up the octave) above the key's tonic */
export function degHz(h: Harmony, d: number, oct: number): number {
  const n = h.scale.length;
  const k = ((d % n) + n) % n;
  return hz(12 * (oct + 1) + h.tonic + h.scale[k] + 12 * Math.floor(d / n));
}
const semi = (s: number) => Math.pow(2, s / 12);
const rr = (c: SfxCtx, a: number, b: number) => a + (b - a) * c.r();

// -----------------------------------------------------------------------------------------------
// layer recipes
// -----------------------------------------------------------------------------------------------

/** resonant noise sweep that rises to the blade's fastest point and falls away */
function whoosh(c: SfxCtx, o: { f0: number; f1: number; f2: number; dur: number; q?: number; vol: number; color?: NoiseColor; peak?: number; at?: number }): void {
  const t = c.t + (o.at ?? 0);
  const peak = o.dur * (o.peak ?? 0.4);
  const k = c.p * rr(c, 0.9, 1.1);
  // two edges: the blade and its higher, quieter partner a beat later
  for (const [mul, delay, vol] of [[1, 0, 1], [1.6, 0.014, 0.55]] as const) {
    const f = c.g.noiseBurst({ color: o.color ?? 'pink', type: 'bandpass', f: o.f0 * mul * k, f1: o.f1 * mul * k, glide: peak, q: o.q ?? 3, t: t + delay, dur: o.dur, vol: o.vol * vol, a: peak * 0.85, out: c.out });
    f.frequency.exponentialRampToValueAtTime(o.f2 * mul * k, t + delay + o.dur);
  }
}

/** sub thump plus a saturated copy so laptop speakers still "hear" the low end */
function sub(c: SfxCtx, f0: number, f1: number, dur: number, vol: number, at = 0): void {
  const t = c.t + at;
  c.g.tone({ f: f0, f1, tau: dur * 0.3, t, dur, vol, a: 0.003, out: c.out });
  const d = c.g.drive(3, c.g.gain(0.22, c.g.filter('lowpass', 900, 0.7, c.out)));
  c.g.tone({ type: 'triangle', f: f0, f1, tau: dur * 0.3, t, dur: dur * 0.6, vol: vol * 0.9, a: 0.003, out: d });
}

/** a body hit: click, pitched punch, crunch and tail; weight 0..1 */
function impact(c: SfxCtx, w: number, vol = 1): void {
  const g = c.g;
  const t = c.t;
  g.noiseBurst({ type: 'highpass', f: 2600 * c.p, t, dur: 0.008 + 0.004 * w, vol: 0.55 * vol, out: c.out });
  const f0 = (190 - 70 * w) * c.p * rr(c, 0.94, 1.06);
  const pd = g.drive(2.5 + w * 2, g.gain(0.7 * vol, c.out));
  g.tone({ f: f0, f1: (62 - 24 * w) * c.p, tau: 0.025 + 0.03 * w, t, dur: 0.12 + 0.28 * w, vol: 0.8, a: 0.002, out: pd });
  g.noiseBurst({ type: 'bandpass', f: rr(c, 1800, 2700) * c.p, f1: 800, q: 1.3, t, dur: 0.05 + 0.06 * w, vol: 0.45 * vol, out: c.out });
  g.noiseBurst({ color: 'brown', type: 'lowpass', f: 1400, f1: 180, t: t + 0.004, dur: 0.18 + 0.35 * w, vol: (0.22 + 0.25 * w) * vol, a: 0.004, out: c.out });
  if (w > 0.6) sub(c, 72 * c.p, 32, 0.45 + 0.3 * w, 0.75 * vol * w);
}

/** struck metal: free-bar partials, each split into a slow-beating pair, plus click and scrape */
function metal(c: SfxCtx, f: number, ring: number, vol: number, bright = 1): void {
  const g = c.g;
  const t = c.t;
  const ratios = [1, 2.756, 5.404, 8.933, 13.3];
  ratios.forEach((rt, i) => {
    const pf = f * rt * c.p * (1 + (c.r() - 0.5) * 0.02);
    if (pf > 16000) return;
    const d = ring / (1 + i * 0.9);
    const a = (vol / (1 + i)) * (i > 1 ? bright : 1);
    g.tone({ f: pf, t, dur: d, vol: a * 0.6, a: 0.0006, out: c.out });
    g.tone({ f: pf + rr(c, 0.6, 3), t, dur: d * 0.9, vol: a * 0.4, a: 0.0006, out: c.out });
  });
  g.noiseBurst({ type: 'highpass', f: 4000, t, dur: 0.004, vol: vol * 0.9, out: c.out });
  g.noiseBurst({ type: 'bandpass', f: rr(c, 3500, 6000), f1: 2500, q: 2, t, dur: 0.08, vol: vol * 0.25, out: c.out });
}

/** energy discharge: a falling saw through a tracking lowpass */
function zap(c: SfxCtx, f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sawtooth'): void {
  const g = c.g;
  const lp = g.filter('lowpass', f0 * 3 * c.p, 1.5, c.out);
  lp.frequency.setValueAtTime(f0 * 3 * c.p, c.t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, f1 * 2), c.t + dur);
  g.tone({ type, f: f0 * c.p, f1: f1 * c.p, glide: dur, t: c.t, dur, vol, a: 0.001, out: lp });
}

/** explosion: crack, thump, bloom, rumble, then debris raining down */
function boom(c: SfxCtx, size: number): void {
  const g = c.g;
  const t = c.t;
  const crack = g.drive(4, g.gain(0.5, c.out));
  g.noiseBurst({ type: 'highpass', f: 700, t, dur: 0.018, vol: 1, out: crack });
  sub(c, 64 * c.p, 28, 0.5 + 0.35 * size, 1.0);
  const bloom = g.drive(1.8, g.gain(0.9, c.out));
  g.noiseBurst({ color: 'brown', type: 'lowpass', f: 2200 * c.p, f1: 140, t, dur: 0.9 + 0.8 * size, vol: 0.95, a: 0.006, out: bloom });
  g.noiseBurst({ color: 'brown', type: 'lowpass', f: 110, t: t + 0.05, dur: 1.6 + 1.4 * size, vol: 0.5, a: 0.08, out: c.out, rate: 0.5 });
  // debris: grains whose rate falls off
  let at = 0.06;
  const n = Math.round(8 + 10 * size);
  for (let i = 0; i < n; i++) {
    at += 0.012 + Math.pow(c.r(), 2) * 0.06 * (1 + i * 0.25);
    g.noiseBurst({ type: 'bandpass', f: rr(c, 1200, 6000), q: rr(c, 3, 8), t: t + at, dur: rr(c, 0.006, 0.02), vol: rr(c, 0.05, 0.16) / (1 + i * 0.08), out: c.out });
  }
}

/** reverse swell: the breath in before a big moment */
function swell(c: SfxCtx, dur: number, f0: number, f1: number, vol: number, color: NoiseColor = 'pink'): void {
  const g = c.g;
  const s = g.noiseSrc(color, c.t, dur);
  const f = g.filter('bandpass', f0, 1.2);
  f.frequency.setValueAtTime(f0, c.t);
  f.frequency.exponentialRampToValueAtTime(f1, c.t + dur);
  const gn = g.gain(0);
  gn.gain.setValueAtTime(0.0001, c.t);
  gn.gain.exponentialRampToValueAtTime(vol, c.t + dur);
  gn.gain.linearRampToValueAtTime(0, c.t + dur + 0.012);
  s.connect(f).connect(gn).connect(c.out);
}

/** sparkle: high sine grains on the chord tones */
function shimmer(c: SfxCtx, dur: number, count: number, vol: number, oct = 6): void {
  for (let i = 0; i < count; i++) {
    const f = chordHz(c.h, Math.floor(c.r() * 6), oct);
    const at = (i / count) * dur * 0.8 + c.r() * 0.02;
    c.g.tone({ f, f1: f * 1.015, t: c.t + at, dur: rr(c, 0.05, 0.16), vol: vol * rr(c, 0.5, 1), a: 0.004, out: c.out });
  }
}

/** a short sung "ah" blip through vowel formants */
function vox(c: SfxCtx, f: number, dur: number, vol: number, f1 = f, at = 0): void {
  const g = c.g;
  const t = c.t + at;
  const sum = g.gain(1);
  for (const [ff, q, gg] of [[800, 8, 1], [1150, 9, 0.6], [2900, 12, 0.25]] as const) sum.connect(g.filter('bandpass', ff, q, g.gain(gg * 2.5, c.out)));
  g.tone({ type: 'sawtooth', f, f1, glide: dur * 0.6, t, dur, vol, a: 0.02, out: sum, vib: [18, 5.5, 0.08] });
}

/** tonal "ding" on a chord tone: glassy FM bell */
function bell(c: SfxCtx, f: number, dur: number, vol: number, at = 0): void {
  c.g.fm({ f, ratio: 3.5, index: 1.6, index1: 0.1, t: c.t + at, dur, vol, out: c.out });
  c.g.tone({ f: f * 2, t: c.t + at, dur: dur * 0.4, vol: vol * 0.25, out: c.out });
}

/** the grapple cable: a metallic zip that climbs as the line pays out */
function cable(c: SfxCtx, dur: number, vol: number): void {
  c.g.noiseBurst({ type: 'bandpass', f: 1400 * c.p, f1: 5200 * c.p, q: 7, q1: 3, t: c.t + 0.01, dur, vol, a: 0.01, out: c.out });
  for (let i = 0; i < 4; i++) c.g.tone({ type: 'square', f: rr(c, 2500, 3400) * (1 - i * 0.06), t: c.t + 0.02 + i * 0.026, dur: 0.008, vol: vol * 0.25, out: c.out });
}

// -----------------------------------------------------------------------------------------------
// champion signatures (layered onto their own swings / dashes / ultimates)
// -----------------------------------------------------------------------------------------------

type SigKind = 'swing' | 'heavy' | 'dash' | 'ult';

function signature(c: SfxCtx, kind: SigKind): void {
  const g = c.g;
  const t = c.t;
  const heavy = kind === 'heavy' || kind === 'ult';
  switch (c.champ) {
    case 'kaiser': {
      // the bass drop: a sub saw wobbling through a lowpass
      const dur = kind === 'ult' ? 1.3 : heavy ? 0.42 : 0.24;
      const lp = g.filter('lowpass', 200, 6, g.gain(kind === 'ult' ? 0.5 : 0.32, c.out));
      const rate = kind === 'ult' ? 6 : 9;
      for (let i = 0; i * (1 / rate) < dur; i++) {
        const at = t + i / rate;
        lp.frequency.setTargetAtTime(1600, at, 0.012);
        lp.frequency.setTargetAtTime(160, at + 0.5 / rate, 0.02);
      }
      const root = chordHz(c.h, 0, 1);
      g.tone({ type: 'sawtooth', f: root, t, dur, vol: 0.7, a: 0.01, out: lp });
      g.tone({ type: 'sawtooth', f: root * 1.008, t, dur, vol: 0.5, a: 0.01, out: lp });
      break;
    }
    case 'nova': {
      // glitch stutter: the same chirp repeated through a 4-bit crusher
      const crush = g.crush(4, g.gain(0.18, c.out));
      const n = kind === 'ult' ? 8 : 3;
      const f = chordHz(c.h, 2, 6);
      for (let i = 0; i < n; i++) g.tone({ type: 'square', f: f * (i % 2 ? 1.5 : 1), f1: f * 0.5, t: t + i * 0.035, dur: 0.028, vol: 0.5, out: crush });
      break;
    }
    case 'akali': {
      // a vinyl scratch ("wikka"): band of noise and a tone dragged back and forth
      const bp = g.filter('bandpass', 1200, 3, g.gain(0.4, c.out));
      const dur = heavy ? 0.32 : 0.18;
      const s = g.noiseSrc('white', t, dur);
      const gn = g.gain(0);
      s.connect(bp);
      const o = g.ctx.createOscillator();
      o.type = 'sawtooth';
      o.connect(gn).connect(bp);
      gn.gain.setValueAtTime(0.25, t);
      bp.frequency.setValueAtTime(700, t);
      o.frequency.setValueAtTime(120, t);
      const pts = heavy ? 4 : 2;
      for (let i = 0; i <= pts; i++) {
        const at = t + (i / pts) * dur;
        const up = i % 2 === 0;
        bp.frequency.linearRampToValueAtTime(up ? 2600 : 700, at);
        o.frequency.linearRampToValueAtTime(up ? 380 : 120, at);
      }
      gn.gain.linearRampToValueAtTime(0, t + dur);
      o.start(t);
      o.stop(t + dur + 0.02);
      break;
    }
    case 'qiyana': {
      // the golden ring: a short high modal shimmer
      metal(c, rr(c, 2100, 2500), heavy ? 0.5 : 0.25, 0.05, 0.6);
      if (heavy) g.noiseBurst({ color: 'brown', type: 'lowpass', f: 300, t, dur: 0.4, vol: 0.25, a: 0.02, out: c.out });
      break;
    }
    case 'locke': {
      // chains: a handful of small clinks
      const n = heavy ? 6 : 3;
      for (let i = 0; i < n; i++) g.fm({ f: rr(c, 1800, 3200), ratio: 2.41, index: 3, t: t + 0.03 + i * rr(c, 0.02, 0.045), dur: 0.09, vol: 0.05, out: c.out });
      if (kind === 'ult') bell(c, chordHz(c.h, 0, 3), 2.5, 0.25);
      break;
    }
    case 'sera':
      vox(c, chordHz(c.h, kind === 'ult' ? 2 : 1, 5), heavy ? 0.35 : 0.16, 0.08, chordHz(c.h, kind === 'ult' ? 4 : 2, 5));
      break;
    case 'rex':
      // the gun's action: a two-stage mechanical clack
      g.noiseBurst({ type: 'bandpass', f: 3200, q: 4, t: t + 0.05, dur: 0.012, vol: 0.18, out: c.out });
      g.noiseBurst({ type: 'bandpass', f: 2100, q: 4, t: t + 0.09, dur: 0.016, vol: 0.2, out: c.out });
      if (kind === 'ult') sub(c, 55, 30, 1.2, 0.8, 0.05);
      break;
    case 'pooh':
      g.tone({ type: 'triangle', f: rr(c, 380, 460), f1: 220, t: t + 0.02, dur: 0.07, vol: 0.12, out: c.out });
      break;
    case 'elisabbat':
      for (let i = 0; i < (heavy ? 4 : 2); i++) g.noiseBurst({ type: 'bandpass', f: 1100 + i * 140, q: 2.4, t: t + 0.02 + i * 0.045, dur: 0.03, vol: 0.12, out: c.out });
      break;
  }
}

// -----------------------------------------------------------------------------------------------
// footsteps & landings per surface
// -----------------------------------------------------------------------------------------------

function surface(c: SfxCtx, vol: number): void {
  const g = c.g;
  const t = c.t;
  switch (c.arena) {
    case 'stage':
      // hollow stage deck: a woody knock with a resonant cavity
      g.tone({ f: rr(c, 150, 190), f1: 120, t, dur: 0.07, vol: vol * 0.5, out: c.out });
      g.noiseBurst({ type: 'bandpass', f: rr(c, 700, 950), q: 4, t, dur: 0.04, vol: vol * 0.35, out: c.out });
      break;
    case 'tartarus':
      // stone: a hard click and a short gritty tail
      g.noiseBurst({ type: 'highpass', f: 3000, t, dur: 0.006, vol: vol * 0.5, out: c.out });
      g.noiseBurst({ type: 'bandpass', f: rr(c, 1800, 2600), q: 1.5, t: t + 0.004, dur: 0.05, vol: vol * 0.25, out: c.out });
      break;
    default:
      // asphalt and grit
      g.noiseBurst({ type: 'bandpass', f: rr(c, 1100, 1700), q: 1.2, t, dur: 0.035, vol: vol * 0.35, out: c.out });
      g.noiseBurst({ type: 'highpass', f: 5000, t: t + 0.01, dur: 0.03, vol: vol * 0.15, out: c.out });
  }
}

// -----------------------------------------------------------------------------------------------
// the catalogue
// -----------------------------------------------------------------------------------------------

export const SFX: Record<string, SfxDef> = {
  // ---- movement ------------------------------------------------------------------------------
  hookFire: {
    dur: 0.3,
    max: 4,
    fn: (c) => {
      c.g.noiseBurst({ type: 'highpass', f: 1600 * c.p, f1: 3200, t: c.t, dur: 0.11, vol: 0.4, a: 0.002, out: c.out });
      c.g.tone({ type: 'square', f: 1900 * c.p, f1: 800, t: c.t, dur: 0.018, vol: 0.12, out: c.out });
      c.g.noiseBurst({ type: 'bandpass', f: 4200, q: 3, t: c.t, dur: 0.005, vol: 0.5, out: c.out });
      cable(c, 0.22, 0.22);
    },
  },
  hookHit: {
    dur: 0.35,
    max: 4,
    fn: (c) => {
      c.g.tone({ f: 170 * c.p, f1: 82, tau: 0.02, t: c.t, dur: 0.09, vol: 0.55, out: c.out });
      metal(c, 1700 * c.p, 0.14, 0.12, 0.5);
      // the line snaps taut: a short twang
      c.g.tone({ type: 'triangle', f: 330 * c.p, f1: 300, t: c.t + 0.015, dur: 0.16, vol: 0.12, out: c.g.filter('bandpass', 700, 2, c.out) });
    },
  },
  hookDry: {
    dur: 0.25,
    max: 2,
    fn: (c) => {
      c.g.noiseBurst({ type: 'bandpass', f: 2600, q: 5, t: c.t, dur: 0.01, vol: 0.4, out: c.out });
      c.g.noiseBurst({ type: 'bandpass', f: 1800, q: 5, t: c.t + 0.07, dur: 0.012, vol: 0.32, out: c.out });
      c.g.noiseBurst({ type: 'highpass', f: 3500, t: c.t + 0.02, dur: 0.14, vol: 0.08, a: 0.02, out: c.out });
    },
  },
  jump: {
    dur: 0.25,
    max: 3,
    fn: (c) => {
      c.g.noiseBurst({ type: 'lowpass', f: 1100 * c.p, f1: 300, t: c.t, dur: 0.17, vol: 0.25, a: 0.01, out: c.out });
      c.g.tone({ f: 130 * c.p, f1: 70, t: c.t, dur: 0.08, vol: 0.2, out: c.out });
      surface(c, 0.5);
    },
  },
  gasBurst: {
    dur: 0.4,
    max: 3,
    fn: (c) => {
      c.g.noiseBurst({ type: 'highpass', f: 1300 * c.p, f1: 2600, t: c.t, dur: 0.3, vol: 0.42, a: 0.004, out: c.out });
      c.g.noiseBurst({ type: 'bandpass', f: 900, q: 1.4, t: c.t, dur: 0.18, vol: 0.2, a: 0.004, out: c.out });
      sub(c, 110 * c.p, 52, 0.16, 0.35);
      c.g.noiseBurst({ type: 'bandpass', f: 3000, q: 6, t: c.t, dur: 0.008, vol: 0.3, out: c.out });
    },
  },
  boostStart: {
    dur: 0.3,
    max: 2,
    fn: (c) => {
      c.g.noiseBurst({ type: 'highpass', f: 800 * c.p, f1: 2800, t: c.t, dur: 0.26, vol: 0.32, a: 0.012, out: c.out });
      c.g.noiseBurst({ type: 'bandpass', f: 2800, q: 6, t: c.t, dur: 0.008, vol: 0.25, out: c.out });
    },
  },
  // the anime "shun": a breath in, a zip, a sub kick
  dash: {
    dur: 0.35,
    max: 3,
    fn: (c) => {
      swell(c, 0.05, 600, 2400, 0.18);
      whoosh(c, { f0: 420, f1: 2900, f2: 700, dur: 0.24, q: 1.6, vol: 0.5, peak: 0.25, at: 0.04 });
      c.g.tone({ f: 1500 * c.p, f1: 320, t: c.t + 0.04, dur: 0.09, vol: 0.07, out: c.out });
      sub(c, 150 * c.p, 60, 0.12, 0.3, 0.04);
      signature(c, 'dash');
    },
  },
  wallkick: {
    dur: 0.3,
    max: 2,
    fn: (c) => {
      c.g.tone({ f: 150 * c.p, f1: 62, tau: 0.02, t: c.t, dur: 0.12, vol: 0.45, out: c.out });
      c.g.noiseBurst({ type: 'bandpass', f: 1600, f1: 900, q: 1.2, t: c.t, dur: 0.1, vol: 0.28, out: c.out });
      surface(c, 0.7);
    },
  },
  land: {
    dur: 0.5,
    max: 3,
    fn: (c) => {
      const w = Math.min(1, c.v);
      c.g.tone({ f: 105 * c.p, f1: 44, tau: 0.03, t: c.t, dur: 0.14 + 0.15 * w, vol: 0.55, out: c.out });
      c.g.noiseBurst({ color: 'brown', type: 'lowpass', f: 1300, f1: 200, t: c.t, dur: 0.15 + 0.15 * w, vol: 0.3, out: c.out });
      surface(c, 0.6 + 0.5 * w);
      if (w > 0.7)
        for (let i = 0; i < 5; i++) c.g.noiseBurst({ type: 'bandpass', f: rr(c, 1500, 4500), q: 5, t: c.t + 0.04 + c.r() * 0.2, dur: 0.01, vol: 0.06, out: c.out });
    },
  },
  footstep: {
    dur: 0.12,
    max: 2,
    vary: 0.08,
    rev: 0.4,
    fn: (c) => {
      c.g.tone({ f: 85 * c.p, f1: 55, t: c.t, dur: 0.05, vol: 0.18, out: c.out });
      surface(c, 0.35);
      c.g.noiseBurst({ type: 'bandpass', f: 2400, q: 1, t: c.t + 0.025, dur: 0.025, vol: 0.05, out: c.out });
    },
  },

  // ---- melee -----------------------------------------------------------------------------------
  swing: {
    dur: 0.3,
    max: 4,
    combo: 0.7,
    fn: (c) => {
      const k = semi(Math.min(c.step, 4) * 0.7);
      whoosh(c, { f0: 480 * k, f1: 2500 * k, f2: 800, dur: rr(c, 0.17, 0.23), q: 2.8, vol: 0.42 });
      signature(c, 'swing');
    },
  },
  swingHeavy: {
    dur: 0.5,
    max: 3,
    combo: 0.9,
    fn: (c) => {
      whoosh(c, { f0: 240, f1: 1500, f2: 380, dur: rr(c, 0.34, 0.42), q: 2.2, vol: 0.5, color: 'pink' });
      c.g.noiseBurst({ color: 'brown', type: 'lowpass', f: 380, t: c.t, dur: 0.38, vol: 0.32, a: 0.12, out: c.out });
      sub(c, 70, 48, 0.3, 0.2, 0.05);
      signature(c, 'heavy');
    },
  },
  whoosh: {
    dur: 0.5,
    max: 3,
    fn: (c) => whoosh(c, { f0: 380, f1: 2400, f2: 600, dur: 0.45, q: 1.4, vol: 0.4 }),
  },
  hit: {
    dur: 0.35,
    max: 6,
    combo: 0.6,
    fn: (c) => impact(c, 0.35 + Math.min(c.step, 3) * 0.06),
  },
  hitHeavy: {
    dur: 0.7,
    max: 4,
    duck: 2,
    fn: (c) => impact(c, 0.95),
  },
  crit: {
    dur: 0.5,
    max: 3,
    fn: (c) => {
      bell(c, chordHz(c.h, 2, 6), 0.4, 0.14);
      bell(c, chordHz(c.h, 4, 6), 0.35, 0.1, 0.035);
      for (let i = 0; i < 6; i++) c.g.tone({ f: rr(c, 5000, 9000), t: c.t + i * 0.012, dur: 0.05, vol: 0.03, out: c.out });
    },
  },
  block: {
    dur: 0.5,
    max: 3,
    fn: (c) => {
      metal(c, rr(c, 620, 760), 0.22, 0.22, 0.6);
      c.g.tone({ f: 140, f1: 70, t: c.t, dur: 0.1, vol: 0.35, out: c.out });
    },
  },
  // perfect parry: brighter, longer ring, a breath in and a sparkle in key
  parry: {
    dur: 1.2,
    max: 2,
    duck: 4,
    rev: 1.4,
    fn: (c) => {
      metal(c, chordHz(c.h, 0, 5) * 2, 0.9, 0.32, 1.2);
      sub(c, 120, 45, 0.3, 0.5);
      shimmer(c, 0.5, 8, 0.05, 7);
    },
  },
  slice: {
    dur: 0.5,
    max: 2,
    fn: (c) => {
      c.g.noiseBurst({ type: 'bandpass', f: 7500 * c.p, f1: 1300, q: 2.2, t: c.t, dur: 0.2, vol: 0.5, out: c.out });
      sub(c, 110, 38, 0.32, 0.6);
      c.g.tone({ type: 'triangle', f: chordHz(c.h, 2, 6), f1: chordHz(c.h, 1, 6), t: c.t, dur: 0.14, vol: 0.07, out: c.out });
    },
  },
  counter: {
    dur: 0.6,
    max: 2,
    ui: true,
    fn: (c) => {
      // glassy shatter over a reversed breath
      for (let i = 0; i < 9; i++) c.g.fm({ f: rr(c, 2000, 6000), ratio: 1.41, index: 2, t: c.t + i * 0.011, dur: rr(c, 0.08, 0.25), vol: 0.035, out: c.out });
      bell(c, chordHz(c.h, 0, 5), 0.3, 0.1);
      bell(c, chordHz(c.h, 2, 5), 0.3, 0.08, 0.05);
      zap(c, 600, 90, 0.25, 0.15);
    },
  },
  dodge: {
    dur: 0.6,
    max: 2,
    fn: (c) => {
      whoosh(c, { f0: 500, f1: 3600, f2: 1200, dur: 0.32, q: 1.6, vol: 0.4 });
      bell(c, chordHz(c.h, 1, 6), 0.4, 0.07);
      bell(c, chordHz(c.h, 2, 6), 0.4, 0.06, 0.05);
    },
  },

  // ---- ranged & abilities -----------------------------------------------------------------------
  shot: {
    dur: 0.4,
    max: 5,
    fn: (c) => {
      zap(c, 2400, 150, 0.09, 0.2);
      c.g.noiseBurst({ type: 'highpass', f: 2200, t: c.t, dur: 0.012, vol: 0.4, out: c.out });
      sub(c, 92 * c.p, 46, 0.09, 0.45);
      c.g.noiseBurst({ type: 'bandpass', f: 3400, q: 5, t: c.t + 0.045, dur: 0.01, vol: 0.12, out: c.out });
    },
  },
  slug: {
    dur: 0.9,
    max: 2,
    duck: 2,
    fn: (c) => {
      zap(c, 1500, 110, 0.18, 0.28);
      c.g.noiseBurst({ type: 'highpass', f: 1800, t: c.t, dur: 0.02, vol: 0.55, out: c.g.drive(3, c.g.gain(0.7, c.out)) });
      sub(c, 150 * c.p, 36, 0.35, 0.8);
      c.g.noiseBurst({ color: 'brown', type: 'lowpass', f: 2400, f1: 220, t: c.t + 0.02, dur: 0.45, vol: 0.25, out: c.out });
      signature(c, 'heavy');
    },
  },
  chargeShot: {
    dur: 1,
    max: 2,
    duck: 3,
    fn: (c) => {
      zap(c, 900, 45, 0.5, 0.32);
      sub(c, 82, 28, 0.6, 0.9);
      c.g.noiseBurst({ color: 'pink', type: 'lowpass', f: 4200, f1: 300, q: 0.8, t: c.t, dur: 0.35, vol: 0.45, out: c.out });
      c.g.tone({ f: chordHz(c.h, 0, 4), f1: chordHz(c.h, 0, 3), t: c.t, dur: 0.6, vol: 0.12, out: c.out });
    },
  },
  charge: {
    dur: 1,
    max: 2,
    fn: (c) => {
      const f = chordHz(c.h, 0, 3);
      c.g.tone({ type: 'sawtooth', f, f1: f * 4, glide: 0.9, t: c.t, dur: 0.9, vol: 0.06, a: 0.25, out: c.g.filter('lowpass', 2500, 2, c.out), vib: [30, 9, 0.2] });
      swell(c, 0.85, 300, 5000, 0.12);
    },
  },
  orb: {
    dur: 0.4,
    max: 4,
    fn: (c) => {
      vox(c, chordHz(c.h, Math.floor(c.r() * 3), 5), 0.16, 0.07);
      bell(c, chordHz(c.h, 2, 6), 0.25, 0.06);
    },
  },
  note: {
    dur: 0.4,
    max: 4,
    combo: 0.8,
    fn: (c) => {
      const f = chordHz(c.h, Math.min(c.step, 5), 5);
      bell(c, f, 0.35, 0.1);
      c.g.tone({ type: 'triangle', f, t: c.t, dur: 0.25, vol: 0.06, out: c.out });
    },
  },
  lob: {
    dur: 0.5,
    max: 3,
    fn: (c) => {
      const f = chordHz(c.h, 0, 5);
      vox(c, f, 0.32, 0.08, f * 2);
      c.g.noiseBurst({ type: 'bandpass', f: 800, f1: 2400, q: 1.4, t: c.t, dur: 0.25, vol: 0.12, a: 0.06, out: c.out });
    },
  },
  beam: {
    dur: 0.55,
    max: 2,
    fn: (c) => {
      const f = chordHz(c.h, 0, 3);
      c.g.tone({ type: 'sawtooth', f, t: c.t, dur: 0.5, vol: 0.06, a: 0.05, out: c.g.filter('lowpass', 1800, 4, c.out), vib: [25, 11] });
      c.g.tone({ f: f * 2.005, t: c.t, dur: 0.5, vol: 0.08, a: 0.05, out: c.out });
      c.g.noiseBurst({ type: 'bandpass', f: 3000, q: 2, t: c.t, dur: 0.5, vol: 0.06, a: 0.05, out: c.out });
    },
  },
  explosion: {
    dur: 2.4,
    max: 3,
    duck: 4,
    rev: 1.3,
    fn: (c) => boom(c, Math.min(1.2, c.v)),
  },
  wave: {
    dur: 0.8,
    max: 3,
    fn: (c) => {
      c.g.tone({ f: 200 * c.p, f1: 900, t: c.t, dur: 0.4, vol: 0.25, a: 0.02, out: c.g.drive(1.5, c.g.gain(0.8, c.out)) });
      c.g.noiseBurst({ type: 'bandpass', f: 500, f1: 3200, q: 1.2, t: c.t, dur: 0.5, vol: 0.38, a: 0.03, out: c.out });
      sub(c, 90, 40, 0.35, 0.5);
    },
  },
  teleport: {
    dur: 0.5,
    max: 3,
    fn: (c) => {
      swell(c, 0.09, 1500, 7000, 0.2, 'white');
      c.g.tone({ type: 'square', f: 300 * c.p, f1: 2600, glide: 0.08, t: c.t, dur: 0.1, vol: 0.06, out: c.g.filter('lowpass', 5000, 1, c.out) });
      c.g.noiseBurst({ type: 'bandpass', f: 5200, f1: 900, q: 3, t: c.t + 0.09, dur: 0.12, vol: 0.32, out: c.out });
      sub(c, 180, 70, 0.08, 0.35, 0.09);
      shimmer(c, 0.2, 4, 0.04, 6);
      signature(c, 'dash');
    },
  },
  kunai: {
    dur: 0.4,
    max: 3,
    fn: (c) => {
      for (let i = 0; i < 5; i++) {
        const t = i * 0.018;
        c.g.noiseBurst({ type: 'bandpass', f: (2600 + i * 450) * c.p, f1: 7000, q: 5, t: c.t + t, dur: 0.08, vol: 0.2, a: 0.004, out: c.out });
        c.g.fm({ f: rr(c, 3200, 4200), ratio: 2.76, index: 1.2, t: c.t + t + 0.01, dur: 0.06, vol: 0.03, out: c.out });
      }
    },
  },
  slam: {
    dur: 2.4,
    max: 2,
    duck: 5,
    rev: 1.3,
    fn: (c) => {
      boom(c, 1.1 * Math.min(1.2, c.v));
      metal(c, 140, 0.5, 0.15, 0.4);
      sub(c, chordHz(c.h, 0, 1) * 2, chordHz(c.h, 0, 1), 0.9, 0.8);
    },
  },
  glitch: {
    dur: 0.25,
    max: 2,
    fn: (c) => {
      const crush = c.g.crush(3, c.g.gain(0.25, c.out));
      for (let i = 0; i < 4; i++) c.g.tone({ type: 'square', f: rr(c, 600, 1600), f1: 200, t: c.t + i * 0.03, dur: 0.025, vol: 0.4, out: crush });
    },
  },
  chord: {
    dur: 1,
    max: 2,
    fn: (c) => {
      for (let i = 0; i < 3; i++) {
        bell(c, chordHz(c.h, i, 5), 0.8, 0.07, i * 0.025);
        vox(c, chordHz(c.h, i, 4), 0.6, 0.035, chordHz(c.h, i, 4), i * 0.025);
      }
    },
  },

  // ---- ultimates & match flow ------------------------------------------------------------------
  // Persona-style cut-in: breath in, a brass-like chord stab in key, the sub drops away
  cutin: {
    dur: 1.2,
    max: 2,
    ui: true,
    duck: 5,
    fn: (c) => {
      swell(c, 0.18, 400, 6000, 0.35);
      const t = 0.18;
      const lp = c.g.filter('lowpass', 2400, 1, c.out);
      for (let i = 0; i < 4; i++) {
        const f = chordHz(c.h, i, 4);
        c.g.tone({ type: 'sawtooth', f, t: c.t + t, dur: 0.5, vol: 0.06, a: 0.008, out: lp, detune: -6 });
        c.g.tone({ type: 'sawtooth', f, t: c.t + t, dur: 0.5, vol: 0.05, a: 0.008, out: lp, detune: 7 });
      }
      sub(c, chordHz(c.h, 0, 2), chordHz(c.h, 0, 1), 0.6, 0.6, t);
      c.g.noiseBurst({ type: 'highpass', f: 5000, t: c.t + t, dur: 0.4, vol: 0.12, out: c.out });
    },
  },
  ult: {
    dur: 1.6,
    max: 3,
    duck: 4,
    rev: 1.2,
    fn: (c) => {
      // riser into the activation
      c.g.tone({ type: 'sawtooth', f: chordHz(c.h, 0, 2), f1: chordHz(c.h, 0, 5), glide: 0.55, t: c.t, dur: 0.6, vol: 0.12, a: 0.1, out: c.g.filter('lowpass', 3000, 2, c.out) });
      swell(c, 0.55, 300, 6000, 0.3);
      sub(c, chordHz(c.h, 0, 2), chordHz(c.h, 0, 1) * 0.5, 0.9, 0.7, 0.5);
      if (!c.self) {
        // threat cue: enemies' ultimates are announced by a low brass "braam"
        for (const dt of [-8, 0, 9]) c.g.tone({ type: 'sawtooth', f: chordHz(c.h, 0, 2), t: c.t + 0.45, dur: 0.8, vol: 0.06, a: 0.06, detune: dt, out: c.g.filter('lowpass', 700, 1.5, c.out) });
      }
      signature(c, 'ult');
    },
  },
  ultReady: {
    dur: 0.8,
    max: 1,
    ui: true,
    fn: (c) => {
      [0, 1, 2, 3].forEach((i) => bell(c, chordHz(c.h, i, 5), 0.5, 0.09, i * 0.07));
      shimmer(c, 0.4, 6, 0.03, 7);
    },
  },
  ultTick: { dur: 0.1, max: 2, ui: true, fn: (c) => c.g.tone({ f: chordHz(c.h, 2, 6), t: c.t, dur: 0.06, vol: 0.08, out: c.out }) },
  death: {
    dur: 1.2,
    max: 3,
    rev: 1.2,
    fn: (c) => {
      // the hologram shatters
      for (let i = 0; i < 12; i++) c.g.fm({ f: rr(c, 1800, 7000), ratio: 1.41, index: 2.5, t: c.t + i * 0.018 + c.r() * 0.01, dur: rr(c, 0.1, 0.35), vol: 0.04, out: c.out });
      c.g.tone({ type: 'triangle', f: chordHz(c.h, 0, 5), f1: chordHz(c.h, 0, 2), glide: 0.7, t: c.t, dur: 0.75, vol: 0.12, out: c.out });
      sub(c, 110, 35, 0.5, 0.5);
    },
  },
  respawn: {
    dur: 1,
    max: 2,
    ui: true,
    fn: (c) => {
      swell(c, 0.35, 600, 5000, 0.15);
      c.g.tone({ f: chordHz(c.h, 0, 4), f1: chordHz(c.h, 0, 5), glide: 0.35, t: c.t, dur: 0.45, vol: 0.12, a: 0.05, out: c.out });
      shimmer(c, 0.5, 8, 0.04, 6);
    },
  },
  kill: {
    dur: 0.8,
    max: 2,
    ui: true,
    fn: (c) => {
      [0, 1, 2].forEach((i) => c.g.tone({ type: 'square', f: chordHz(c.h, i, 5), t: c.t + i * 0.08, dur: 0.16 + i * 0.1, vol: 0.05, out: c.g.filter('lowpass', 4000, 1, c.out) }));
      bell(c, chordHz(c.h, 3, 6), 0.5, 0.08, 0.16);
    },
  },
  killConfirm: {
    dur: 0.8,
    max: 2,
    ui: true,
    combo: 8,
    duck: 3,
    fn: (c) => {
      // rising fifth, a semitone higher for every kill in the streak
      const k = semi(Math.min(c.step, 6));
      const f = chordHz(c.h, 0, 5) * k;
      c.g.tone({ type: 'square', f, t: c.t, dur: 0.08, vol: 0.05, out: c.out });
      c.g.tone({ type: 'square', f: f * 1.5, t: c.t + 0.06, dur: 0.1, vol: 0.05, out: c.out });
      bell(c, f * 2, 0.4, 0.1, 0.12);
      sub(c, 92, 34, 0.36, 0.7);
      c.g.noiseBurst({ type: 'highpass', f: 6000, t: c.t, dur: 0.006, vol: 0.3, out: c.out });
    },
  },

  // ---- 2D combat confirms ------------------------------------------------------------------------
  tick: {
    dur: 0.08,
    max: 3,
    ui: true,
    combo: 0.8,
    vary: 0.01,
    fn: (c) => {
      // each consecutive hit in a combo ticks a semitone higher
      const k = semi(Math.min(c.step, 7));
      c.g.tone({ type: 'square', f: 2600 * k, f1: 1900 * k, t: c.t, dur: 0.03, vol: 0.06, out: c.out });
      c.g.tone({ f: 1300 * k, t: c.t, dur: 0.05, vol: 0.09, out: c.out });
      c.g.noiseBurst({ type: 'highpass', f: 7000, t: c.t, dur: 0.004, vol: 0.12, out: c.out });
    },
  },
  dink: {
    dur: 0.25,
    max: 2,
    ui: true,
    fn: (c) => {
      metal(c, 2090, 0.18, 0.12, 0.8);
      c.g.tone({ type: 'triangle', f: 3136, t: c.t, dur: 0.14, vol: 0.12, out: c.out });
    },
  },
  perfectTick: {
    dur: 0.2,
    max: 2,
    ui: true,
    fn: (c) => {
      bell(c, chordHz(c.h, 2, 6), 0.15, 0.1);
      bell(c, chordHz(c.h, 0, 7), 0.12, 0.05, 0.04);
    },
  },
  alarm: {
    dur: 0.3,
    max: 1,
    ui: true,
    fn: (c) => {
      // a tritone, twice: unmistakably "danger"
      for (const at of [0, 0.12]) {
        c.g.tone({ type: 'square', f: 880, t: c.t + at, dur: 0.08, vol: 0.05, out: c.out });
        c.g.tone({ type: 'square', f: 622, t: c.t + at, dur: 0.08, vol: 0.04, out: c.out });
      }
    },
  },
  medal1: {
    dur: 0.5,
    max: 1,
    ui: true,
    fn: (c) => [0, 2].forEach((i, k) => bell(c, chordHz(c.h, i, 5), 0.3, 0.08, k * 0.07)),
  },
  medal2: {
    dur: 0.6,
    max: 1,
    ui: true,
    fn: (c) => [0, 1, 2].forEach((i, k) => bell(c, chordHz(c.h, i, 5), 0.35, 0.08, k * 0.06)),
  },
  medal3: {
    dur: 0.9,
    max: 1,
    ui: true,
    fn: (c) => {
      [0, 1, 2, 3].forEach((i, k) => {
        bell(c, chordHz(c.h, i, 5), 0.45, 0.08, k * 0.06);
        c.g.tone({ type: 'sawtooth', f: chordHz(c.h, i, 4), t: c.t + k * 0.06, dur: 0.25, vol: 0.025, out: c.g.filter('lowpass', 3000, 1, c.out) });
      });
      sub(c, 65, 38, 0.5, 0.5);
      shimmer(c, 0.5, 8, 0.03, 7);
    },
  },

  // ---- UI --------------------------------------------------------------------------------------
  uiMove: {
    dur: 0.05,
    max: 2,
    ui: true,
    vary: 0.02,
    fn: (c) => {
      c.g.tone({ f: degHz(c.h, 4, 6), t: c.t, dur: 0.025, vol: 0.05, out: c.out });
      c.g.noiseBurst({ type: 'highpass', f: 6000, t: c.t, dur: 0.004, vol: 0.06, out: c.out });
    },
  },
  uiSelect: {
    dur: 0.25,
    max: 2,
    ui: true,
    fn: (c) => {
      c.g.tone({ type: 'triangle', f: degHz(c.h, 0, 5), t: c.t, dur: 0.07, vol: 0.12, out: c.out });
      c.g.tone({ type: 'triangle', f: degHz(c.h, 2, 5), t: c.t + 0.05, dur: 0.12, vol: 0.12, out: c.out });
      c.g.noiseBurst({ type: 'highpass', f: 5000, t: c.t, dur: 0.006, vol: 0.08, out: c.out });
    },
  },
  uiBack: {
    dur: 0.15,
    max: 2,
    ui: true,
    fn: (c) => {
      c.g.tone({ type: 'triangle', f: degHz(c.h, 4, 5), t: c.t, dur: 0.06, vol: 0.1, out: c.out });
      c.g.tone({ type: 'triangle', f: degHz(c.h, 0, 5), t: c.t + 0.05, dur: 0.08, vol: 0.1, out: c.out });
    },
  },
  countdown: {
    dur: 0.3,
    max: 1,
    ui: true,
    fn: (c) => {
      c.g.tone({ type: 'square', f: degHz(c.h, 4, 5), t: c.t, dur: 0.14, vol: 0.06, out: c.g.filter('lowpass', 3000, 1, c.out) });
      c.g.noiseBurst({ type: 'bandpass', f: 1200, q: 2, t: c.t, dur: 0.05, vol: 0.12, out: c.out });
    },
  },
  go: {
    dur: 1,
    max: 1,
    ui: true,
    duck: 2,
    fn: (c) => {
      [0, 2, 4, 7].forEach((d) => c.g.tone({ type: 'sawtooth', f: degHz(c.h, d, 4), t: c.t, dur: 0.45, vol: 0.04, out: c.g.filter('lowpass', 3500, 1, c.out) }));
      whoosh(c, { f0: 300, f1: 4000, f2: 1500, dur: 0.4, q: 1.2, vol: 0.3, peak: 0.3 });
      sub(c, 90, 40, 0.4, 0.5);
    },
  },

  // ---- Pooh -----------------------------------------------------------------------------------
  boing: {
    dur: 0.5,
    max: 2,
    fn: (c) => {
      c.g.tone({ f: 150 * c.p, f1: 430, glide: 0.08, t: c.t, dur: 0.09, vol: 0.5, out: c.out });
      c.g.tone({ f: 430 * c.p, f1: 170, t: c.t + 0.08, dur: 0.3, vol: 0.38, out: c.out, vib: [60, 14] });
      impact(c, 0.3, 0.6);
    },
  },
  splat: {
    dur: 0.5,
    max: 3,
    fn: (c) => {
      // clay crack, then wet honey
      c.g.noiseBurst({ type: 'highpass', f: 2600, f1: 1800, t: c.t, dur: 0.05, vol: 0.45, out: c.out });
      for (let i = 0; i < 4; i++) c.g.noiseBurst({ type: 'bandpass', f: rr(c, 400, 1100), q: 6, t: c.t + 0.02 + i * 0.03, dur: 0.06, vol: 0.25, out: c.out });
      c.g.noiseBurst({ type: 'lowpass', f: 1400, f1: 220, q: 1.2, t: c.t + 0.02, dur: 0.3, vol: 0.45, a: 0.01, out: c.out });
      c.g.tone({ f: 260 * c.p, f1: 90, t: c.t + 0.02, dur: 0.14, vol: 0.35, out: c.out });
    },
  },
  buzz: {
    dur: 0.4,
    max: 3,
    fn: (c) => {
      const lp = c.g.filter('bandpass', 1000, 1.5, c.out);
      c.g.tone({ type: 'sawtooth', f: rr(c, 200, 215), f1: 225, t: c.t, dur: 0.32, vol: 0.09, a: 0.04, out: lp, vib: [40, 23] });
      c.g.tone({ type: 'sawtooth', f: rr(c, 228, 240), f1: 214, t: c.t + 0.03, dur: 0.3, vol: 0.07, a: 0.04, out: lp, vib: [35, 27] });
    },
  },
  idea: {
    dur: 1,
    max: 1,
    fn: (c) => {
      [0, 1, 2].forEach((i) => bell(c, chordHz(c.h, i, 5), 0.3, 0.09, i * 0.08));
      bell(c, chordHz(c.h, 0, 6), 0.8, 0.12, 0.24);
      shimmer(c, 0.5, 6, 0.03, 7);
    },
  },
  tap: {
    dur: 0.15,
    max: 2,
    fn: (c) => {
      c.g.tone({ f: 300 * c.p, f1: 170, t: c.t, dur: 0.07, vol: 0.3, out: c.out });
      c.g.noiseBurst({ type: 'bandpass', f: 1200, q: 3, t: c.t, dur: 0.02, vol: 0.12, out: c.out });
    },
  },
  slurp: {
    dur: 0.5,
    max: 2,
    fn: (c) => {
      c.g.noiseBurst({ type: 'bandpass', f: 500, f1: 1900, q: 4, t: c.t, dur: 0.3, vol: 0.22, a: 0.04, out: c.out });
      vox(c, 220 * c.p, 0.25, 0.04, 520);
    },
  },
  pop: {
    dur: 0.15,
    max: 3,
    fn: (c) => {
      c.g.noiseBurst({ type: 'highpass', f: 3000, t: c.t, dur: 0.02, vol: 0.4, out: c.out });
      c.g.tone({ f: 900 * c.p, f1: 220, t: c.t, dur: 0.06, vol: 0.2, out: c.out });
    },
  },

  // ---- Elisabbat -------------------------------------------------------------------------------
  hiss: {
    dur: 0.4,
    max: 2,
    fn: (c) => {
      c.g.noiseBurst({ type: 'highpass', f: 3200, f1: 5200, q: 0.9, t: c.t, dur: 0.32, vol: 0.3, a: 0.03, out: c.out });
      c.g.noiseBurst({ type: 'bandpass', f: 2600, q: 6, t: c.t, dur: 0.3, vol: 0.12, a: 0.05, out: c.out });
    },
  },
  bite: {
    dur: 0.4,
    max: 2,
    fn: (c) => {
      c.g.noiseBurst({ type: 'bandpass', f: 1900, f1: 700, q: 2, t: c.t, dur: 0.08, vol: 0.6, out: c.out });
      impact(c, 0.4, 0.7);
      c.g.noiseBurst({ type: 'bandpass', f: 2700, f1: 1300, q: 3, t: c.t + 0.05, dur: 0.06, vol: 0.4, out: c.out });
    },
  },
  drink: {
    dur: 0.5,
    max: 2,
    fn: (c) => {
      c.g.tone({ f: chordHz(c.h, 2, 4), f1: chordHz(c.h, 0, 3), t: c.t, dur: 0.3, vol: 0.2, a: 0.02, out: c.out, vib: [40, 7] });
      c.g.noiseBurst({ type: 'lowpass', f: 900, f1: 300, t: c.t, dur: 0.3, vol: 0.18, a: 0.03, out: c.out });
    },
  },
  batPoof: {
    dur: 0.6,
    max: 2,
    fn: (c) => {
      whoosh(c, { f0: 600, f1: 2400, f2: 900, dur: 0.4, q: 1.2, vol: 0.4 });
      for (let i = 0; i < 6; i++) c.g.noiseBurst({ type: 'bandpass', f: 1300 + i * 80, q: 2.2, t: c.t + 0.04 + i * 0.035, dur: 0.03, vol: 0.25, out: c.out });
      c.g.tone({ f: rr(c, 4400, 5000), f1: 5600, t: c.t + 0.12, dur: 0.05, vol: 0.04, out: c.out });
    },
  },
  bats: {
    dur: 0.7,
    max: 2,
    fn: (c) => {
      for (let i = 0; i < 10; i++) c.g.noiseBurst({ type: 'bandpass', f: rr(c, 1000, 1700), q: 2.4, t: c.t + i * rr(c, 0.035, 0.055), dur: 0.03, vol: 0.2, out: c.out });
      for (let i = 0; i < 3; i++) c.g.tone({ f: rr(c, 4000, 5200), f1: rr(c, 5000, 6000), t: c.t + 0.05 + i * 0.12, dur: 0.05, vol: 0.04, out: c.out });
    },
  },
  storm: {
    dur: 1.6,
    max: 1,
    duck: 3,
    rev: 1.3,
    fn: (c) => {
      c.g.noiseBurst({ type: 'bandpass', f: 260, f1: 900, q: 0.8, t: c.t, dur: 1.3, vol: 0.45, a: 0.25, out: c.out });
      c.g.tone({ type: 'sawtooth', f: chordHz(c.h, 0, 1), t: c.t, dur: 1.1, vol: 0.12, a: 0.2, out: c.g.filter('lowpass', 500, 2, c.out) });
      for (let i = 0; i < 16; i++) c.g.noiseBurst({ type: 'bandpass', f: 1000 + (i % 4) * 250, q: 2.4, t: c.t + 0.1 + i * 0.06, dur: 0.03, vol: 0.16, out: c.out });
      for (let i = 0; i < 4; i++) c.g.tone({ f: rr(c, 4000, 5400), f1: rr(c, 5000, 6200), t: c.t + 0.2 + i * 0.2, dur: 0.05, vol: 0.04, out: c.out });
    },
  },
  claw: {
    dur: 0.2,
    max: 3,
    fn: (c) => {
      c.g.noiseBurst({ type: 'highpass', f: 2600, f1: 6200, q: 1.2, t: c.t, dur: 0.12, vol: 0.28, a: 0.01, out: c.out });
      c.g.noiseBurst({ type: 'bandpass', f: 4200, f1: 3000, q: 6, t: c.t + 0.02, dur: 0.06, vol: 0.12, out: c.out });
    },
  },
};
