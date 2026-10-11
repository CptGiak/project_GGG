/**
 * Offline DSP in plain JS: the instruments that Web Audio nodes cannot build (plucked strings need
 * a feedback loop shorter than a render quantum) and the one-shots worth computing once and
 * replaying as buffers (drums, cymbals, debris). Everything here writes Float32Arrays; the sample
 * bank turns them into AudioBuffers.
 */

/** mulberry32: deterministic so every render of a sample sounds the same */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midiHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
export const dbGain = (db: number): number => Math.pow(10, db / 20);

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf' | 'notch';

/** RBJ cookbook biquad, transposed direct form II */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;
  constructor(readonly sr: number, type?: BiquadType, f = 1000, q = 0.707, gainDb = 0) {
    if (type) this.set(type, f, q, gainDb);
  }

  set(type: BiquadType, f: number, q = 0.707, gainDb = 0): this {
    const w = (2 * Math.PI * Math.min(f, this.sr * 0.49)) / this.sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const alpha = sw / (2 * Math.max(q, 1e-4));
    const A = Math.pow(10, gainDb / 40);
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    switch (type) {
      case 'lowpass':
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'notch':
        b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'peaking':
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
        break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cw + s); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s);
        a0 = A + 1 + (A - 1) * cw + s; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s;
        break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s);
        a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s;
        break;
      }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }

  tick(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  run(buf: Float32Array): Float32Array {
    for (let i = 0; i < buf.length; i++) buf[i] = this.tick(buf[i]);
    return buf;
  }
}

/** apply a chain of filters in place */
export function filter(buf: Float32Array, sr: number, ...specs: Array<[BiquadType, number, number?, number?]>): Float32Array {
  for (const [type, f, q, g] of specs) new Biquad(sr, type, f, q ?? 0.707, g ?? 0).run(buf);
  return buf;
}

/** white, pink (Paul Kellet's economy filter) or brown noise */
export function noise(n: number, color: 'white' | 'pink' | 'brown', r: () => number): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    if (color === 'white') out[i] = w;
    else if (color === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    } else {
      last = (last + 0.02 * w) / 1.02;
      out[i] = last * 3.5;
    }
  }
  return out;
}

export function peak(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
  return p;
}

export function normalize(buf: Float32Array, to = 0.9): Float32Array {
  const p = peak(buf);
  if (p > 1e-6) {
    const k = to / p;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }
  return buf;
}

/** short linear fades so a cut buffer never clicks */
export function fadeEdges(buf: Float32Array, sr: number, inMs = 0.5, outMs = 8): Float32Array {
  const a = Math.min(buf.length, Math.floor((inMs / 1000) * sr));
  const b = Math.min(buf.length, Math.floor((outMs / 1000) * sr));
  for (let i = 0; i < a; i++) buf[i] *= i / a;
  for (let i = 0; i < b; i++) buf[buf.length - 1 - i] *= i / b;
  return buf;
}

/** soft clipper with optional bias (bias adds even harmonics, like a driven tube stage) */
export function drive(buf: Float32Array, gain: number, bias = 0, out = 1): Float32Array {
  const off = Math.tanh(gain * bias);
  const norm = 1 / Math.tanh(gain + Math.abs(gain * bias));
  for (let i = 0; i < buf.length; i++) buf[i] = (Math.tanh(gain * (buf[i] + bias)) - off) * norm * out;
  return buf;
}

/** exponential decay envelope multiplied in place: value hits -60 dB after t60 seconds */
export function decay(buf: Float32Array, sr: number, t60: number, startSample = 0): Float32Array {
  const k = Math.exp(Math.log(0.001) / (t60 * sr));
  let g = 1;
  for (let i = startSample; i < buf.length; i++) {
    buf[i] *= g;
    g *= k;
  }
  return buf;
}

export function mixInto(dst: Float32Array, src: Float32Array, gain = 1, offset = 0): Float32Array {
  const n = Math.min(src.length, dst.length - offset);
  for (let i = 0; i < n; i++) dst[i + offset] += src[i] * gain;
  return dst;
}

/** sine sweep with an exponential pitch envelope (f0 -> f1 with time constant tau), returns phase-continuous tone */
export function sweep(n: number, sr: number, f0: number, f1: number, tau: number, phase0 = 0): Float32Array {
  const out = new Float32Array(n);
  let ph = phase0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / tau);
    ph += (2 * Math.PI * f) / sr;
    out[i] = Math.sin(ph);
  }
  return out;
}

// -----------------------------------------------------------------------------------------------
// Plucked string (extended Karplus–Strong)
// -----------------------------------------------------------------------------------------------

export interface PluckOpts {
  freq: number;
  dur: number;
  /** seconds for the string to ring down by 60 dB */
  t60?: number;
  /** 0..1, loop lowpass weight (higher = darker decay) */
  damp?: number;
  /** 0..1 pluck position along the string (comb notch in the excitation) */
  pickPos?: number;
  /** excitation brightness 0..1 (pick vs finger) */
  bright?: number;
  /** seconds after which the note is muted (palm mute / release) */
  muteAt?: number;
  seed?: number;
}

/**
 * Extended Karplus–Strong: noise burst shaped by a pick lowpass and a pick-position comb, a
 * fractional delay tuned with a first-order allpass, and a two-tap loop filter. Muting raises the
 * loop damping instead of cutting the buffer, so a palm-muted chug still has its attack.
 */
export function pluck(sr: number, o: PluckOpts): Float32Array {
  const r = rng(o.seed ?? 1);
  const n = Math.floor(o.dur * sr);
  const out = new Float32Array(n);
  const period = sr / o.freq;
  const damp = o.damp ?? 0.5;
  const w0 = damp * 0.5;
  // the delay line, the loop lowpass (w samples) and a first-order allpass (the fraction) add up
  // to exactly one period
  const L = Math.max(2, Math.floor(period - w0 - 0.1));
  const frac = period - w0 - L;
  const apC = (1 - frac) / (1 + frac);
  const line = new Float32Array(L);
  // excitation: noise lowpassed by the pick, combed at the pick position
  const bright = o.bright ?? 0.7;
  const ex = new Float32Array(L);
  let lp = 0;
  const a = 0.15 + bright * 0.8;
  for (let i = 0; i < ex.length; i++) {
    lp += a * (r() * 2 - 1 - lp);
    ex[i] = lp;
  }
  const P = Math.max(1, Math.floor((o.pickPos ?? 0.18) * L));
  for (let i = ex.length - 1; i >= P; i--) ex[i] -= ex[i - P] * 0.9;
  let mean = 0;
  for (let i = 0; i < ex.length; i++) mean += ex[i];
  mean /= ex.length;
  for (let i = 0; i < ex.length; i++) line[i] = ex[i] - mean;
  // loop gain per period for the requested ring time (and for the muted string)
  const sustain = Math.pow(0.001, 1 / ((o.t60 ?? 2.5) * o.freq));
  const muted = Math.pow(0.001, 1 / (0.09 * o.freq));
  const muteAt = o.muteAt !== undefined ? Math.floor(o.muteAt * sr) : n + 1;
  let idx = 0;
  let prev = 0;
  let apX = 0;
  let apY = 0;
  let g = sustain;
  let w = w0;
  for (let i = 0; i < n; i++) {
    if (i === muteAt) {
      g = Math.min(g, muted);
      w = 0.45;
    }
    const x = line[idx];
    // loop lowpass: mix of the current and previous sample
    const y = g * ((1 - w) * x + w * prev);
    prev = x;
    // fractional delay (allpass)
    const ap = apC * y + apX - apC * apY;
    apX = y;
    apY = ap;
    line[idx] = ap;
    idx = (idx + 1) % L;
    out[i] = x;
  }
  return out;
}
