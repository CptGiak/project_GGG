/**
 * Procedural impulse responses: each arena gets a room that matches what you see, so the same
 * explosion slaps off shop fronts in Shibuya, booms around the stadium bowl and hangs in the void
 * over Tartarus. Built from discrete early reflections plus a decorrelated stereo tail whose highs
 * die faster than its lows (air and soft surfaces absorb treble first).
 */
import { Biquad, rng } from './dsp';

export interface RoomSpec {
  /** seconds to -60 dB for the low band */
  t60: number;
  /** high band dies this much faster (0..1 of t60) */
  hfRatio: number;
  /** pre-delay before the tail (s) */
  pre: number;
  /** early reflections: [delay s, gain, pan -1..1] */
  early: Array<[number, number, number]>;
  /** crossover between the low and high bands (Hz) */
  split: number;
  /** tail lowpass (Hz): darkness */
  tone: number;
  /** slow swell of the tail (0 = none): eerie rooms bloom instead of decaying at once */
  bloom?: number;
  /** discrete slap-back echoes on top of the tail: [delay s, gain] */
  slap?: Array<[number, number]>;
  tailGain?: number;
}

export const ROOMS: Record<string, RoomSpec> = {
  // narrow street canyon: tight early reflections from the shop fronts, a clear slap from the
  // building across the scramble, short bright tail
  neon_city: {
    t60: 1.5,
    hfRatio: 0.55,
    pre: 0.012,
    early: [[0.009, 0.5, -0.6], [0.017, 0.42, 0.7], [0.026, 0.3, -0.3], [0.041, 0.26, 0.5], [0.058, 0.2, -0.8]],
    split: 2500,
    tone: 9000,
    slap: [[0.105, 0.22], [0.21, 0.08]],
    tailGain: 0.55,
  },
  // concert bowl: late first reflection off the stands, dense long tail
  stage: {
    t60: 2.9,
    hfRatio: 0.5,
    pre: 0.038,
    early: [[0.031, 0.32, -0.5], [0.047, 0.3, 0.6], [0.069, 0.26, 0.1], [0.088, 0.22, -0.7], [0.121, 0.18, 0.8]],
    split: 2000,
    tone: 7000,
    tailGain: 0.75,
  },
  // the dark hour: almost no early reflections (nothing near you), a dark tail that blooms
  tartarus: {
    t60: 4.2,
    hfRatio: 0.35,
    pre: 0.06,
    early: [[0.07, 0.12, -0.4], [0.13, 0.1, 0.5]],
    split: 1400,
    tone: 4200,
    bloom: 0.35,
    tailGain: 0.8,
  },
  // music hall for the score
  hall: {
    t60: 2.3,
    hfRatio: 0.55,
    pre: 0.022,
    early: [[0.013, 0.3, -0.6], [0.021, 0.28, 0.6], [0.034, 0.22, -0.2], [0.05, 0.18, 0.4]],
    split: 2200,
    tone: 8000,
    tailGain: 0.7,
  },
};

export function renderRoom(ctx: BaseAudioContext, spec: RoomSpec, seed = 5): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * (spec.pre + spec.t60 * 1.05));
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(seed + ch * 101);
    const data = new Float32Array(len);
    const pre = Math.floor(spec.pre * sr);
    // two-band decaying noise tail
    const lowK = Math.log(0.001) / (spec.t60 * sr);
    const highK = Math.log(0.001) / (spec.t60 * spec.hfRatio * sr);
    const lo = new Biquad(sr, 'lowpass', spec.split, 0.6);
    const hi = new Biquad(sr, 'highpass', spec.split, 0.6);
    const tone = new Biquad(sr, 'lowpass', spec.tone, 0.5);
    const g = spec.tailGain ?? 0.7;
    for (let i = pre; i < len; i++) {
      const n = i - pre;
      const w = r() * 2 - 1;
      let env = 1;
      if (spec.bloom) env = 1 - Math.exp(-n / (spec.bloom * sr));
      // fade the onset in over 6 ms so the tail does not click on top of the early reflections
      env *= Math.min(1, n / (0.006 * sr));
      const s = lo.tick(w) * Math.exp(lowK * n) + hi.tick(w) * Math.exp(highK * n);
      data[i] = tone.tick(s) * env * g;
    }
    // early reflections: short filtered clicks, panned per channel
    for (const [d, gain, pan] of spec.early) {
      const at = Math.floor(d * sr);
      const side = ch === 0 ? 1 - Math.max(0, pan) : 1 + Math.min(0, pan);
      const amp = gain * side;
      const f = new Biquad(sr, 'lowpass', 6000 - d * 30000, 0.7);
      for (let k = 0; k < 48 && at + k < len; k++) data[at + k] += f.tick(k < 3 ? (r() * 2 - 1) * amp * 2 : 0);
    }
    // slap-back echoes: a darker copy of an impulse, one per discrete delay
    for (const [d, gain] of spec.slap ?? []) {
      const at = Math.floor((d + (ch ? 0.007 : 0)) * sr);
      const f = new Biquad(sr, 'bandpass', 1800, 0.8);
      for (let k = 0; k < 400 && at + k < len; k++) data[at + k] += f.tick(k < 4 ? (r() * 2 - 1) * gain * 3 : 0);
    }
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, ch);
  }
  return buf;
}
