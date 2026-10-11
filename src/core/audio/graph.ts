/**
 * Live Web Audio building blocks shared by the SFX recipes and the music instruments. Every helper
 * schedules a short-lived node graph at an absolute AudioContext time and cleans itself up when its
 * sources stop.
 */
import { noise as renderNoise, rng } from './dsp';

export type NoiseColor = 'white' | 'pink' | 'brown';
export type Curve = 'exp' | 'lin';

export interface ToneOpts {
  type?: OscillatorType;
  /** start frequency (Hz) */
  f: number;
  /** end frequency (default: f) */
  f1?: number;
  /** time for the pitch move (default: dur) */
  glide?: number;
  /** pitch moves exponentially (default) or with a setTarget curve (`tau`) */
  tau?: number;
  t: number;
  dur: number;
  vol: number;
  /** attack seconds */
  a?: number;
  /** hold at full level before the decay */
  hold?: number;
  out: AudioNode;
  detune?: number;
  /** vibrato depth in cents and rate */
  vib?: [cents: number, hz: number, delay?: number];
  /** custom PeriodicWave instead of `type` */
  wave?: PeriodicWave;
}

export interface NoiseOpts {
  color?: NoiseColor;
  type: BiquadFilterType;
  f: number;
  f1?: number;
  glide?: number;
  q?: number;
  q1?: number;
  t: number;
  dur: number;
  vol: number;
  a?: number;
  hold?: number;
  out: AudioNode;
  /** playback rate of the noise buffer (lower = grainier rumble) */
  rate?: number;
}

/** WaveShaper curves, built once */
const curves = new Map<string, Float32Array>();
function curve(name: string, make: () => Float32Array): Float32Array {
  let c = curves.get(name);
  if (!c) {
    c = make();
    curves.set(name, c);
  }
  return c;
}

export class Graph {
  readonly noise: Record<NoiseColor, AudioBuffer>;
  private waves = new Map<string, PeriodicWave>();

  constructor(readonly ctx: BaseAudioContext) {
    const sr = ctx.sampleRate;
    const make = (color: NoiseColor, seed: number) => {
      const len = sr * 2;
      const b = ctx.createBuffer(2, len, sr);
      b.copyToChannel(renderNoise(len, color, rng(seed)) as Float32Array<ArrayBuffer>, 0);
      b.copyToChannel(renderNoise(len, color, rng(seed + 99)) as Float32Array<ArrayBuffer>, 1);
      return b;
    };
    this.noise = { white: make('white', 11), pink: make('pink', 23), brown: make('brown', 37) };
  }

  gain(v = 1, out?: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (out) g.connect(out);
    return g;
  }

  pan(p: number, out: AudioNode): AudioNode {
    if (Math.abs(p) < 0.01 || !this.ctx.createStereoPanner) return out;
    const n = this.ctx.createStereoPanner();
    n.pan.value = Math.max(-1, Math.min(1, p));
    n.connect(out);
    return n;
  }

  filter(type: BiquadFilterType, f: number, q = 0.707, out?: AudioNode, gainDb = 0): BiquadFilterNode {
    const n = this.ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    n.gain.value = gainDb;
    if (out) n.connect(out);
    return n;
  }

  /** attack / hold / exponential decay on a gain param, ending silent at t + dur */
  envelope(p: AudioParam, t: number, vol: number, a: number, dur: number, hold = 0): void {
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + Math.max(a, 0.001));
    if (hold > 0) p.setValueAtTime(Math.max(vol, 0.0002), t + a + hold);
    p.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, a + hold + 0.01));
  }

  tone(o: ToneOpts): OscillatorNode {
    const c = this.ctx;
    const osc = c.createOscillator();
    if (o.wave) osc.setPeriodicWave(o.wave);
    else osc.type = o.type ?? 'sine';
    const f1 = o.f1 ?? o.f;
    osc.frequency.setValueAtTime(o.f, o.t);
    if (f1 !== o.f) {
      if (o.tau) osc.frequency.setTargetAtTime(f1, o.t, o.tau);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), o.t + (o.glide ?? o.dur));
    }
    if (o.detune) osc.detune.value = o.detune;
    if (o.vib) {
      const [cents, hz, delay = 0] = o.vib;
      const lfo = c.createOscillator();
      lfo.frequency.value = hz;
      const depth = c.createGain();
      depth.gain.setValueAtTime(0, o.t);
      depth.gain.linearRampToValueAtTime(0, o.t + delay);
      depth.gain.linearRampToValueAtTime(cents, o.t + delay + 0.25);
      lfo.connect(depth).connect(osc.detune);
      lfo.start(o.t);
      lfo.stop(o.t + o.dur + 0.1);
    }
    const g = c.createGain();
    this.envelope(g.gain, o.t, o.vol, o.a ?? 0.002, o.dur, o.hold);
    osc.connect(g).connect(o.out);
    osc.start(o.t);
    osc.stop(o.t + o.dur + 0.05);
    return osc;
  }

  noiseSrc(color: NoiseColor, t: number, dur: number, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise[color];
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(t, Math.random() * 1.8);
    s.stop(t + dur + 0.05);
    return s;
  }

  /** filtered noise burst with an optional filter sweep */
  noiseBurst(o: NoiseOpts): BiquadFilterNode {
    const c = this.ctx;
    const s = this.noiseSrc(o.color ?? 'white', o.t, o.dur, o.rate);
    const f = c.createBiquadFilter();
    f.type = o.type;
    f.Q.setValueAtTime(o.q ?? 1, o.t);
    if (o.q1 !== undefined) f.Q.linearRampToValueAtTime(o.q1, o.t + (o.glide ?? o.dur));
    f.frequency.setValueAtTime(o.f, o.t);
    const f1 = o.f1 ?? o.f;
    if (f1 !== o.f) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), o.t + (o.glide ?? o.dur));
    const g = c.createGain();
    this.envelope(g.gain, o.t, o.vol, o.a ?? 0.002, o.dur, o.hold);
    s.connect(f).connect(g).connect(o.out);
    return f;
  }

  /**
   * Two-operator FM: metallic / bell / glassy tones. `ratio` sets the modulator frequency relative
   * to the carrier, `index` the modulation depth in multiples of the modulator frequency, decaying
   * to `index1` (brightness falls as the note dies, like a struck object).
   */
  fm(o: { f: number; ratio: number; index: number; index1?: number; t: number; dur: number; vol: number; a?: number; out: AudioNode; f1?: number; type?: OscillatorType }): void {
    const c = this.ctx;
    const car = c.createOscillator();
    car.type = o.type ?? 'sine';
    const mod = c.createOscillator();
    const fm = o.f * o.ratio;
    car.frequency.setValueAtTime(o.f, o.t);
    mod.frequency.setValueAtTime(fm, o.t);
    if (o.f1 && o.f1 !== o.f) {
      car.frequency.exponentialRampToValueAtTime(o.f1, o.t + o.dur);
      mod.frequency.exponentialRampToValueAtTime(o.f1 * o.ratio, o.t + o.dur);
    }
    const depth = c.createGain();
    depth.gain.setValueAtTime(o.index * fm, o.t);
    depth.gain.exponentialRampToValueAtTime(Math.max(0.01, (o.index1 ?? o.index * 0.1) * fm), o.t + o.dur);
    mod.connect(depth).connect(car.frequency);
    const g = c.createGain();
    this.envelope(g.gain, o.t, o.vol, o.a ?? 0.001, o.dur);
    car.connect(g).connect(o.out);
    car.start(o.t);
    mod.start(o.t);
    car.stop(o.t + o.dur + 0.05);
    mod.stop(o.t + o.dur + 0.05);
  }

  /**
   * Modal resonator: a struck object as a sum of decaying partials. `ratios` are the partial
   * frequencies relative to `f`, `decays` their ring times (seconds), `gains` their levels.
   */
  modal(o: { f: number; ratios: number[]; decays: number[]; gains?: number[]; t: number; vol: number; out: AudioNode; detune?: number }): void {
    o.ratios.forEach((r, i) => {
      const d = o.decays[i % o.decays.length];
      this.tone({ f: o.f * r * (1 + (Math.random() - 0.5) * (o.detune ?? 0.004)), t: o.t, dur: d, vol: o.vol * (o.gains?.[i] ?? 1 / (1 + i * 0.6)), a: 0.0008, out: o.out });
    });
  }

  /** play a rendered buffer */
  buffer(buf: AudioBuffer, t: number, out: AudioNode, vol = 1, rate = 1, offset = 0, dur?: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const g = this.gain(vol, out);
    s.connect(g);
    s.start(t, offset);
    if (dur !== undefined) {
      g.gain.setValueAtTime(vol, t + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
      s.stop(t + dur + 0.08);
    }
    return s;
  }

  /** soft saturation (tanh) */
  drive(amount: number, out: AudioNode): WaveShaperNode {
    const key = `drive${amount.toFixed(1)}`;
    const ws = this.ctx.createWaveShaper();
    ws.curve = curve(key, () => {
      const n = 2048;
      const a = new Float32Array(n);
      const k = Math.tanh(amount);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        a[i] = Math.tanh(x * amount) / k;
      }
      return a;
    }) as Float32Array<ArrayBuffer>;
    ws.oversample = '2x';
    ws.connect(out);
    return ws;
  }

  /** amplitude quantiser: the gritty staircase of a low-bit sampler */
  crush(bits: number, out: AudioNode): WaveShaperNode {
    const ws = this.ctx.createWaveShaper();
    ws.curve = curve(`crush${bits}`, () => {
      const n = 4096;
      const a = new Float32Array(n);
      const steps = Math.pow(2, bits) / 2;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        a[i] = Math.round(x * steps) / steps;
      }
      return a;
    }) as Float32Array<ArrayBuffer>;
    ws.connect(out);
    return ws;
  }

  /** feedback delay (echo / comb); returns the input node */
  echo(time: number, feedback: number, wet: number, out: AudioNode, lp = 3500, until?: number): AudioNode {
    const c = this.ctx;
    const input = c.createGain();
    const d = c.createDelay(2);
    d.delayTime.value = time;
    const fb = c.createGain();
    fb.gain.value = feedback;
    const f = this.filter('lowpass', lp, 0.5);
    const w = this.gain(wet, out);
    input.connect(d);
    d.connect(f).connect(fb).connect(d);
    f.connect(w);
    if (until !== undefined) {
      // break the loop afterwards so the graph can be collected
      fb.gain.setValueAtTime(feedback, until);
      fb.gain.linearRampToValueAtTime(0, until + 0.05);
    }
    return input;
  }

  /** an additive wave from harmonic amplitudes, cached by name */
  periodic(name: string, harmonics: number[]): PeriodicWave {
    let w = this.waves.get(name);
    if (!w) {
      const real = new Float32Array(harmonics.length + 1);
      const imag = new Float32Array(harmonics.length + 1);
      harmonics.forEach((h, i) => (imag[i + 1] = h));
      w = this.ctx.createPeriodicWave(real, imag);
      this.waves.set(name, w);
    }
    return w;
  }
}
