/**
 * The sound-design vocabulary every SFX is built from.
 *
 * Rules these helpers bake in (see .claude/skills/game-sfx/references/mixing.md):
 *  - noise is pink or brown and always band-limited: white noise only exists as the 1-2 ms edge
 *    of a click, never as a body or a tail (full-band hiss is what reads as "noisy");
 *  - transients are short (2-15 ms) and quiet next to the body that carries the loudness;
 *  - the weight of a hit lives in a clean pitched body (120-500 Hz) and a band-passed "smack"
 *    (600-1800 Hz), not in distorted sub: real sub is reserved for the few big events;
 *  - anything pitched follows the score's harmony (chordHz / degHz).
 */
import type { Graph, NoiseColor } from './graph';
import type { Cat } from './mix';
import type { Harmony } from './music';

export interface SfxCtx {
  g: Graph;
  /** start time */
  t: number;
  /** voice input (gain-trimmed, distance-filtered, panned, sent to the room) */
  out: AudioNode;
  /** random pitch multiplier for this play */
  p: number;
  /** requested volume (0..~1.2): heavier calls may choose heavier layers */
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
  /** per-play data from the caller (impact weight, charge level, element...) */
  arg?: Record<string, unknown>;
}

export interface SfxDef {
  fn: (c: SfxCtx) => void;
  /** mix category (level, range, voice budget, bus EQ): see mix.ts */
  cat: Cat;
  /** approximate length (voice accounting) */
  dur: number;
  /** rank inside the category, dB */
  lvl?: number;
  /** concurrent instances of this sound before the oldest is stolen */
  max?: number;
  /** reverb send multiplier (on top of the category's) */
  rev?: number;
  /** random pitch range (+/- fraction) */
  vary?: number;
  /** repeats within this window (s) escalate `step` */
  combo?: number;
  /** music duck in dB when the sound is near the listener */
  duck?: number;
  /** minimum seconds between two plays from the same source (rapid fire, ticks, channels) */
  gap?: number;
  /** distance override [near, far] in metres */
  range?: [number, number];
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
export const semi = (s: number) => Math.pow(2, s / 12);
export const rr = (c: SfxCtx, a: number, b: number) => a + (b - a) * c.r();
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// -----------------------------------------------------------------------------------------------
// atoms
// -----------------------------------------------------------------------------------------------

/** a tiny band-passed click: definition for the attack, never loud */
export function click(c: SfxCtx, o: { f?: number; q?: number; dur?: number; vol: number; at?: number; out?: AudioNode }): void {
  c.g.noiseBurst({ color: 'pink', type: 'bandpass', f: (o.f ?? 3000) * c.p, q: o.q ?? 0.9, t: c.t + (o.at ?? 0), dur: o.dur ?? 0.008, vol: o.vol, a: 0.0005, out: o.out ?? c.out });
}

/** pitched body with a fast pitch fall: the weight of a hit or a step */
export function thump(c: SfxCtx, o: { f0: number; f1?: number; dur: number; vol: number; at?: number; type?: OscillatorType; a?: number; out?: AudioNode }): void {
  c.g.tone({ type: o.type ?? 'sine', f: o.f0 * c.p, f1: (o.f1 ?? o.f0 * 0.5) * c.p, tau: o.dur * 0.22, t: c.t + (o.at ?? 0), dur: o.dur, vol: o.vol, a: o.a ?? 0.0015, out: o.out ?? c.out });
}

/** band-passed noise slap (the "smack" of a hit): f 500-2000 Hz, falling */
export function smack(c: SfxCtx, o: { f: number; q?: number; dur: number; vol: number; at?: number; drop?: number; color?: NoiseColor; a?: number; out?: AudioNode }): BiquadFilterNode {
  const f = o.f * c.p * rr(c, 0.92, 1.08);
  return c.g.noiseBurst({ color: o.color ?? 'pink', type: 'bandpass', f, f1: f * (o.drop ?? 0.6), q: o.q ?? 1.2, t: c.t + (o.at ?? 0), dur: o.dur, vol: o.vol, a: o.a ?? 0.0008, out: o.out ?? c.out });
}

/** low-passed brown noise: dull weight, dust, crumble */
export function crunch(c: SfxCtx, o: { f?: number; f1?: number; dur: number; vol: number; at?: number; a?: number; rate?: number; out?: AudioNode }): void {
  c.g.noiseBurst({ color: 'brown', type: 'lowpass', f: (o.f ?? 1000) * c.p, f1: o.f1 ?? 180, q: 0.6, t: c.t + (o.at ?? 0), dur: o.dur, vol: o.vol, a: o.a ?? 0.003, rate: o.rate, out: o.out ?? c.out });
}

/** band-limited noise texture (hiss of gas, rustle, smoke), kept under ~6 kHz */
export function hiss(c: SfxCtx, o: { f: number; f1?: number; q?: number; dur: number; vol: number; at?: number; a?: number; hold?: number; color?: NoiseColor; out?: AudioNode }): BiquadFilterNode {
  return c.g.noiseBurst({ color: o.color ?? 'pink', type: 'bandpass', f: Math.min(6000, o.f * c.p), f1: o.f1 !== undefined ? Math.min(6000, o.f1 * c.p) : undefined, q: o.q ?? 0.8, t: c.t + (o.at ?? 0), dur: o.dur, vol: o.vol, a: o.a ?? 0.01, hold: o.hold, out: o.out ?? c.out });
}

/** short pitched tone (sine or triangle): confirms, chimes, magic */
export function blip(c: SfxCtx, o: { f: number; f1?: number; dur: number; vol: number; at?: number; type?: OscillatorType; a?: number; out?: AudioNode; glide?: number; vib?: [number, number, number?] }): void {
  c.g.tone({ type: o.type ?? 'sine', f: o.f, f1: o.f1, glide: o.glide, t: c.t + (o.at ?? 0), dur: o.dur, vol: o.vol, a: o.a ?? 0.003, out: o.out ?? c.out, vib: o.vib });
}

/** the moving air of a blade or a body: resonant pink sweep up to its fastest point and away */
export function whoosh(c: SfxCtx, o: { f0: number; f1: number; f2: number; dur: number; q?: number; vol: number; color?: NoiseColor; peak?: number; at?: number; out?: AudioNode; edge?: number }): void {
  const t = c.t + (o.at ?? 0);
  const peak = o.dur * (o.peak ?? 0.4);
  const k = c.p * rr(c, 0.92, 1.08);
  const cap = (f: number) => Math.min(5000, f);
  // the blade, and a higher, quieter partner edge a beat later
  for (const [mul, delay, vol] of [[1, 0, 1], [1.5, 0.012, o.edge ?? 0.35]] as const) {
    if (vol <= 0) continue;
    const f = c.g.noiseBurst({ color: o.color ?? 'pink', type: 'bandpass', f: cap(o.f0 * mul * k), f1: cap(o.f1 * mul * k), glide: peak, q: o.q ?? 1.4, t: t + delay, dur: o.dur, vol: o.vol * vol, a: peak * 0.85, out: o.out ?? c.out });
    f.frequency.exponentialRampToValueAtTime(cap(o.f2 * mul * k), t + delay + o.dur);
  }
}

/** struck metal: a few free-bar partials, each a slowly beating pair */
export function ring(c: SfxCtx, o: { f: number; decay: number; vol: number; at?: number; bright?: number; ratios?: number[]; out?: AudioNode }): void {
  const t = c.t + (o.at ?? 0);
  const ratios = o.ratios ?? [1, 2.756, 5.404];
  ratios.forEach((rt, i) => {
    const pf = o.f * rt * c.p * (1 + (c.r() - 0.5) * 0.015);
    if (pf > 9000) return;
    const d = o.decay / (1 + i * 0.8);
    const a = (o.vol / (1 + i * 1.2)) * (i > 0 ? o.bright ?? 0.6 : 1);
    c.g.tone({ f: pf, t, dur: d, vol: a * 0.6, a: 0.001, out: o.out ?? c.out });
    c.g.tone({ f: pf + rr(c, 0.8, 2.5), t, dur: d * 0.85, vol: a * 0.4, a: 0.001, out: o.out ?? c.out });
  });
}

/** glassy FM bell on a chord tone */
export function bell(c: SfxCtx, f: number, dur: number, vol: number, at = 0, index = 1.1, out?: AudioNode): void {
  c.g.fm({ f, ratio: 3.5, index, index1: 0.05, t: c.t + at, dur, vol, out: out ?? c.out });
}

/** soft mallet: a warm two-partial tone (marimba-ish), good for friendly confirms */
export function mallet(c: SfxCtx, f: number, dur: number, vol: number, at = 0, out?: AudioNode): void {
  c.g.tone({ f, t: c.t + at, dur, vol, a: 0.002, out: out ?? c.out });
  c.g.tone({ f: f * 3.98, t: c.t + at, dur: dur * 0.25, vol: vol * 0.18, a: 0.001, out: out ?? c.out });
}

/** sub thump plus a band-passed harmonic copy so small speakers still imply it (big events only) */
export function sub(c: SfxCtx, f0: number, f1: number, dur: number, vol: number, at = 0): void {
  const t = c.t + at;
  c.g.tone({ f: f0, f1, tau: dur * 0.3, t, dur, vol, a: 0.003, out: c.out });
  const d = c.g.drive(2, c.g.gain(0.2, c.g.filter('bandpass', 180, 0.8, c.out)));
  c.g.tone({ type: 'triangle', f: f0, f1, tau: dur * 0.3, t, dur: dur * 0.6, vol: vol * 0.8, a: 0.003, out: d });
}

/** reverse swell: the breath in before a big moment */
export function swell(c: SfxCtx, dur: number, f0: number, f1: number, vol: number, color: NoiseColor = 'pink', at = 0, q = 1.2): void {
  const g = c.g;
  const t = c.t + at;
  const s = g.noiseSrc(color, t, dur);
  const f = g.filter('bandpass', f0, q);
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.min(6000, f1), t + dur);
  const gn = g.gain(0);
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(vol, t + dur);
  gn.gain.linearRampToValueAtTime(0, t + dur + 0.015);
  s.connect(f).connect(gn).connect(c.out);
}

/** sparkle: sine grains on chord tones */
export function sparkle(c: SfxCtx, dur: number, count: number, vol: number, oct = 6, at = 0): void {
  for (let i = 0; i < count; i++) {
    const f = chordHz(c.h, Math.floor(c.r() * 5), oct);
    const t = at + (i / count) * dur * 0.8 + c.r() * 0.02;
    c.g.tone({ f, f1: f * 1.01, t: c.t + t, dur: rr(c, 0.06, 0.16), vol: vol * rr(c, 0.5, 1), a: 0.005, out: c.out });
  }
}

/** a short sung vowel through formants (Sera's voice) */
export function vox(c: SfxCtx, f: number, dur: number, vol: number, f1 = f, at = 0, vowel: 'a' | 'o' | 'u' | 'e' = 'a'): void {
  const g = c.g;
  const t = c.t + at;
  const F: Record<string, [number, number, number][]> = {
    a: [[800, 8, 1], [1150, 9, 0.6], [2900, 12, 0.2]],
    o: [[450, 8, 1], [800, 9, 0.5], [2830, 12, 0.12]],
    u: [[325, 8, 1], [700, 9, 0.3], [2530, 12, 0.08]],
    e: [[400, 8, 1], [2000, 10, 0.5], [2600, 12, 0.25]],
  };
  const sum = g.gain(1);
  for (const [ff, q, gg] of F[vowel]) sum.connect(g.filter('bandpass', ff, q, g.gain(gg * 2.5, c.out)));
  g.tone({ type: 'sawtooth', f, f1, glide: dur * 0.6, t, dur, vol, a: 0.025, out: sum, vib: [16, 5.5, 0.1] });
}

/** energy discharge: a falling saw through a tracking low-pass */
export function zap(c: SfxCtx, f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sawtooth', at = 0, out?: AudioNode): void {
  const t = c.t + at;
  const lp = c.g.filter('lowpass', Math.min(9000, f0 * 3 * c.p), 1.2, out ?? c.out);
  lp.frequency.setValueAtTime(Math.min(9000, f0 * 3 * c.p), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, f1 * 2), t + dur);
  c.g.tone({ type, f: f0 * c.p, f1: f1 * c.p, glide: dur, t, dur, vol, a: 0.002, out: lp });
}

/** a synth or brass chord stab: detuned saws through an opening and closing low-pass */
export function stab(c: SfxCtx, o: { notes: number[]; dur: number; vol: number; at?: number; cutoff?: number; open?: number; drive?: number; type?: OscillatorType; a?: number; out?: AudioNode }): void {
  const g = c.g;
  const t = c.t + (o.at ?? 0);
  let dst: AudioNode = o.out ?? c.out;
  if (o.drive) dst = g.drive(o.drive, g.gain(0.6, dst));
  const lp = g.filter('lowpass', o.cutoff ?? 1800, 1.1, dst);
  const top = o.open ?? (o.cutoff ?? 1800) * 2.2;
  lp.frequency.setValueAtTime(o.cutoff ?? 1800, t);
  lp.frequency.exponentialRampToValueAtTime(top, t + 0.02);
  lp.frequency.exponentialRampToValueAtTime(o.cutoff ?? 1800, t + o.dur * 0.6);
  const each = o.vol / Math.sqrt(o.notes.length);
  for (const f of o.notes)
    for (const d of [-7, 6]) g.tone({ type: o.type ?? 'sawtooth', f, t, dur: o.dur, vol: each * 0.5, a: o.a ?? 0.004, detune: d, out: lp });
}

/** explosion: a mid crack, a bloom of low-passed noise, a short sub, a rumble and debris */
export function boom(c: SfxCtx, size: number, vol = 1): void {
  const g = c.g;
  smack(c, { f: 1100, q: 0.8, dur: 0.035, vol: 0.6 * vol, drop: 0.5 });
  click(c, { f: 2600, dur: 0.006, vol: 0.18 * vol });
  thump(c, { f0: 140, f1: 55, dur: 0.22 + 0.1 * size, vol: 0.55 * vol });
  const bloom = g.drive(1.4, g.gain(0.9, c.out));
  crunch(c, { f: 1700, f1: 140, dur: 0.5 + 0.6 * size, vol: 0.7 * vol, a: 0.004, out: bloom });
  sub(c, 58 * c.p, 32, 0.28 + 0.2 * size, 0.45 * vol);
  crunch(c, { f: 160, f1: 90, dur: 1.1 + 1.0 * size, vol: 0.28 * vol, a: 0.07, rate: 0.5, at: 0.04 });
  // debris: grains whose rate falls off
  let at = 0.07;
  const n = Math.round(6 + 8 * size);
  for (let i = 0; i < n; i++) {
    at += 0.014 + Math.pow(c.r(), 2) * 0.06 * (1 + i * 0.25);
    g.noiseBurst({ color: 'pink', type: 'bandpass', f: rr(c, 1200, 3500), q: rr(c, 3, 6), t: c.t + at, dur: rr(c, 0.008, 0.02), vol: (rr(c, 0.03, 0.08) * vol) / (1 + i * 0.1), a: 0.0008, out: c.out });
  }
}

/** a two-stage mechanical clack (bolts, latches, gun actions) */
export function clack(c: SfxCtx, vol: number, at = 0, f = 2000): void {
  smack(c, { f, q: 3, dur: 0.012, vol, at, drop: 0.9 });
  smack(c, { f: f * 0.66, q: 3, dur: 0.016, vol: vol * 1.1, at: at + 0.04, drop: 0.9 });
}

/** wing beats / cloth flaps: band-passed pink pulses */
export function flutter(c: SfxCtx, n: number, vol: number, at = 0, f = 800, rate = 0.045): void {
  for (let i = 0; i < n; i++) smack(c, { f: f * rr(c, 0.85, 1.15), q: 2, dur: 0.028, vol: vol * rr(c, 0.7, 1), at: at + i * rate * rr(c, 0.85, 1.15), drop: 0.8 });
}

/** a liquid blop: a sine bubble that pitches up then down, with a wet smack */
export function blop(c: SfxCtx, f: number, vol: number, at = 0): void {
  c.g.tone({ f: f * 0.7 * c.p, f1: f * 1.6 * c.p, glide: 0.03, t: c.t + at, dur: 0.07, vol, a: 0.002, out: c.out });
  smack(c, { f: 900, q: 1.5, dur: 0.05, vol: vol * 0.5, at, drop: 0.5 });
}

// -----------------------------------------------------------------------------------------------
// champion signatures: one short characterful layer for their generic dashes and movement
// -----------------------------------------------------------------------------------------------

export type SigKind = 'swing' | 'heavy' | 'dash' | 'ult';

export function signature(c: SfxCtx, kind: SigKind, champ = c.champ): void {
  const g = c.g;
  const t = c.t;
  const heavy = kind === 'heavy' || kind === 'ult';
  switch (champ) {
    case 'kaiser': {
      // the bass drop: a saw on the chord root wobbling through a low-pass
      const dur = kind === 'ult' ? 1.2 : heavy ? 0.4 : 0.22;
      const lp = g.filter('lowpass', 200, 5, g.filter('highpass', 55, 0.7, g.gain(kind === 'ult' ? 0.4 : 0.26, c.out)));
      const rate = kind === 'ult' ? 6 : 9;
      for (let i = 0; i * (1 / rate) < dur; i++) {
        const a = t + i / rate;
        lp.frequency.setTargetAtTime(1300, a, 0.012);
        lp.frequency.setTargetAtTime(170, a + 0.5 / rate, 0.02);
      }
      // heavy moves an octave up so laptops hear it and it stays clear of the score's bass
      const root = chordHz(c.h, 0, kind === 'ult' ? 2 : 3);
      g.tone({ type: 'sawtooth', f: root, t, dur, vol: 0.6, a: 0.01, out: lp });
      g.tone({ type: 'sawtooth', f: root * 1.008, t, dur, vol: 0.45, a: 0.01, out: lp });
      break;
    }
    case 'nova': {
      // glitch stutter: the same chirp repeated through a 6-bit crusher
      const crush = g.crush(6, g.gain(0.14, g.filter('lowpass', 5000, 0.7, c.out)));
      const n = kind === 'ult' ? 6 : 3;
      const f = chordHz(c.h, 2, 5);
      for (let i = 0; i < n; i++) g.tone({ type: 'square', f: f * (i % 2 ? 1.5 : 1), f1: f * 0.6, t: t + i * 0.034, dur: 0.026, vol: 0.45, out: crush });
      break;
    }
    case 'akali': {
      // a vinyl scratch ("wikka"): band of pink noise and a tone dragged back and forth
      const bp = g.filter('bandpass', 900, 2.5, g.gain(0.32, c.out));
      const dur = heavy ? 0.3 : 0.17;
      const s = g.noiseSrc('pink', t, dur);
      const gn = g.gain(0);
      s.connect(bp);
      const o = g.ctx.createOscillator();
      o.type = 'sawtooth';
      o.connect(gn).connect(bp);
      gn.gain.setValueAtTime(0.22, t);
      bp.frequency.setValueAtTime(600, t);
      o.frequency.setValueAtTime(110, t);
      const pts = heavy ? 4 : 2;
      for (let i = 0; i <= pts; i++) {
        const a = t + (i / pts) * dur;
        const up = i % 2 === 0;
        bp.frequency.linearRampToValueAtTime(up ? 1900 : 600, a);
        o.frequency.linearRampToValueAtTime(up ? 330 : 110, a);
      }
      gn.gain.linearRampToValueAtTime(0, t + dur);
      o.start(t);
      o.stop(t + dur + 0.02);
      break;
    }
    case 'qiyana':
      // the golden ring: a short modal shimmer
      ring(c, { f: rr(c, 1500, 1800), decay: heavy ? 0.45 : 0.22, vol: 0.05, bright: 0.45 });
      break;
    case 'locke':
      // chains: a handful of small clinks
      for (let i = 0; i < (heavy ? 5 : 3); i++) g.fm({ f: rr(c, 1500, 2400), ratio: 2.41, index: 2, t: t + 0.03 + i * rr(c, 0.02, 0.045), dur: 0.08, vol: 0.04, out: c.out });
      break;
    case 'sera':
      vox(c, chordHz(c.h, kind === 'ult' ? 2 : 1, 5), heavy ? 0.32 : 0.15, 0.07, chordHz(c.h, kind === 'ult' ? 4 : 2, 5));
      break;
    case 'rex':
      clack(c, 0.14, 0.05, 1800);
      break;
    case 'pooh':
      g.tone({ type: 'triangle', f: rr(c, 380, 440), f1: 230, t: t + 0.02, dur: 0.07, vol: 0.11, out: c.out });
      break;
    case 'elisabbat':
      flutter(c, heavy ? 4 : 2, 0.1, 0.02, 750);
      break;
  }
}

// -----------------------------------------------------------------------------------------------
// footsteps & landings per surface
// -----------------------------------------------------------------------------------------------

export function surface(c: SfxCtx, vol: number): void {
  switch (c.arena) {
    case 'stage':
      // hollow stage deck: a woody knock with a resonant cavity
      thump(c, { f0: rr(c, 170, 210), f1: 120, dur: 0.07, vol: vol * 0.5 });
      smack(c, { f: rr(c, 650, 850), q: 3, dur: 0.035, vol: vol * 0.3, drop: 0.9 });
      break;
    case 'tartarus':
      // stone: a hard tap and a short gritty tail
      click(c, { f: 2200, dur: 0.006, vol: vol * 0.3 });
      smack(c, { f: rr(c, 1300, 1700), q: 1.6, dur: 0.03, vol: vol * 0.2, at: 0.003, drop: 0.7 });
      break;
    default:
      // asphalt and grit
      smack(c, { f: rr(c, 900, 1300), q: 1.2, dur: 0.03, vol: vol * 0.3, drop: 0.7 });
      click(c, { f: 2600, dur: 0.01, vol: vol * 0.08, at: 0.008 });
  }
}
