/**
 * Sample bank: instruments rendered once in JS (see dsp.ts) and replayed as AudioBuffers.
 *
 * Drums come in round-robin takes (no two snare hits are bit-identical, the "machine gun" tell of
 * cheap sequenced drums). Guitars are double-tracked: two separately plucked takes, hard left and
 * hard right, the way rock rhythm guitars are recorded, which is most of what makes them sound wide
 * and real instead of like one buzzing oscillator.
 */
import { Biquad, decay, drive, fadeEdges, filter, midiHz, mixInto, noise, normalize, pluck, rng, sweep } from './dsp';

export type DrumId =
  | 'kick' | 'snare' | 'snareRim' | 'ghost' | 'hat' | 'hatOpen' | 'hatPedal'
  | 'crash' | 'crash2' | 'china' | 'ride' | 'rideBell' | 'splash'
  | 'tom1' | 'tom2' | 'tom3' | 'tom4' | 'clap' | 'taiko' | 'gong';

const ROUND_ROBIN: Partial<Record<DrumId, number>> = { kick: 3, snare: 4, snareRim: 2, ghost: 3, hat: 4, hatOpen: 2, ride: 3, tom1: 2, tom2: 2, tom3: 2, tom4: 2, clap: 2 };

type Stereo = [Float32Array, Float32Array];

/** metallic partial set (inharmonic square bank, the 808/909 cymbal approach) */
const METAL = [1, 1.4836, 1.8011, 2.5466, 2.6324, 3.8977];

function metallic(sr: number, n: number, base: number, r: () => number): Float32Array {
  const out = new Float32Array(n);
  const ph = METAL.map(() => r());
  const inc = METAL.map((m) => (base * m * (1 + (r() - 0.5) * 0.01)) / sr);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < METAL.length; k++) {
      ph[k] = (ph[k] + inc[k]) % 1;
      s += ph[k] < 0.5 ? 1 : -1;
    }
    out[i] = s / METAL.length;
  }
  return out;
}

function stereoFrom(mono: Float32Array, spread: number, sr: number): Stereo {
  // Haas-free widening: a slightly different filter on each side keeps mono compatibility
  const l = Float32Array.from(mono);
  const r = Float32Array.from(mono);
  if (spread > 0) {
    new Biquad(sr, 'peaking', 3200, 1.2, spread * 3).run(l);
    new Biquad(sr, 'peaking', 3200, 1.2, -spread * 3).run(r);
    new Biquad(sr, 'peaking', 700, 1, -spread * 2).run(l);
    new Biquad(sr, 'peaking', 700, 1, spread * 2).run(r);
  }
  return [l, r];
}

function renderDrum(id: DrumId, sr: number, take: number): Stereo {
  const r = rng(1000 + take * 31 + id.length * 7 + id.charCodeAt(0));
  const vary = (amt: number) => 1 + (r() - 0.5) * 2 * amt;
  const len = (s: number) => Math.floor(s * sr);
  switch (id) {
    case 'kick': {
      // rock kick: pitched membrane thump + beater click + a little shell resonance
      const n = len(0.55);
      const body = sweep(n, sr, 145 * vary(0.03), 52, 0.035);
      decay(body, sr, 0.45);
      const sub = sweep(n, sr, 60, 47, 0.08);
      decay(sub, sr, 0.5);
      const click = noise(len(0.012), 'white', r);
      filter(click, sr, ['highpass', 1800, 0.7], ['peaking', 4200, 1.5, 6]);
      decay(click, sr, 0.012);
      const out = new Float32Array(n);
      mixInto(out, body, 0.9);
      mixInto(out, sub, 0.45);
      mixInto(out, click, 0.5);
      drive(out, 1.8, 0, 0.9);
      filter(out, sr, ['peaking', 380, 1.4, -5], ['highshelf', 6000, 0.7, 2]);
      return stereoFrom(normalize(fadeEdges(out, sr), 0.95), 0, sr);
    }
    case 'snare':
    case 'snareRim':
    case 'ghost': {
      const rim = id === 'snareRim';
      const ghost = id === 'ghost';
      const n = len(ghost ? 0.18 : 0.42);
      const out = new Float32Array(n);
      // two drumhead modes
      const h1 = sweep(n, sr, 240 * vary(0.02), 185, 0.02);
      decay(h1, sr, ghost ? 0.07 : 0.16);
      const h2 = sweep(n, sr, 345 * vary(0.02), 330, 0.02);
      decay(h2, sr, ghost ? 0.05 : 0.1);
      // snare wires: bright noise, longer than the head
      const wires = noise(n, 'white', r);
      filter(wires, sr, ['highpass', 1400, 0.7], ['peaking', 5200, 0.9, 4], ['lowpass', 11000, 0.7]);
      decay(wires, sr, ghost ? 0.12 : 0.32 * vary(0.08));
      mixInto(out, h1, rim ? 0.75 : 0.6);
      mixInto(out, h2, 0.35);
      mixInto(out, wires, ghost ? 0.35 : 0.55);
      if (rim) {
        // rimshot crack: a short metallic ring of the hoop
        const crack = noise(len(0.03), 'white', r);
        filter(crack, sr, ['bandpass', 2600, 2.5]);
        decay(crack, sr, 0.03);
        mixInto(out, crack, 0.9);
      }
      drive(out, rim ? 2.4 : 1.6, 0.05, 0.9);
      return stereoFrom(normalize(fadeEdges(out, sr), ghost ? 0.4 : 0.92), 0.2, sr);
    }
    case 'clap': {
      const n = len(0.35);
      const out = new Float32Array(n);
      const src = noise(n, 'white', r);
      filter(src, sr, ['bandpass', 1300, 1.1], ['highpass', 600, 0.7]);
      // three quick reflections then a tail: the classic clap envelope
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let e = Math.exp(-t / 0.09) * 0.6;
        for (const at of [0, 0.011, 0.022]) if (t >= at) e = Math.max(e, Math.exp(-(t - at) / 0.006));
        out[i] = src[i] * e;
      }
      return stereoFrom(normalize(fadeEdges(out, sr), 0.8), 0.5, sr);
    }
    case 'hat':
    case 'hatOpen':
    case 'hatPedal': {
      const open = id === 'hatOpen';
      const n = len(open ? 0.6 : id === 'hatPedal' ? 0.09 : 0.11);
      const out = metallic(sr, n, 410 * vary(0.01), r);
      const air = noise(n, 'white', r);
      mixInto(out, air, 0.35);
      filter(out, sr, ['bandpass', 10000, 0.9], ['highpass', 7000, 0.7]);
      decay(out, sr, open ? 0.55 : id === 'hatPedal' ? 0.05 : 0.07 * vary(0.15));
      return stereoFrom(normalize(fadeEdges(out, sr), open ? 0.55 : 0.5), 0.6, sr);
    }
    case 'crash':
    case 'crash2':
    case 'china':
    case 'splash': {
      const long = id === 'splash' ? 0.9 : id === 'china' ? 1.9 : 2.6;
      const n = len(long);
      const base = id === 'crash2' ? 330 : id === 'china' ? 260 : id === 'splash' ? 520 : 370;
      const l = metallic(sr, n, base, r);
      const rr = metallic(sr, n, base * 1.013, r);
      for (const ch of [l, rr]) {
        mixInto(ch, noise(n, 'white', r), 0.8);
        filter(ch, sr, ['highpass', id === 'china' ? 1500 : 2400, 0.7], ['peaking', id === 'china' ? 3200 : 6500, 0.8, 4]);
        // soft bloom: the crash swells for a few ms, then washes out
        for (let i = 0; i < n; i++) ch[i] *= Math.min(1, i / (0.004 * sr));
        decay(ch, sr, long);
        if (id === 'china') drive(ch, 2.5);
        normalize(ch, 0.6);
      }
      return [fadeEdges(l, sr, 0.5, 40), fadeEdges(rr, sr, 0.5, 40)];
    }
    case 'ride':
    case 'rideBell': {
      const bell = id === 'rideBell';
      const n = len(bell ? 1.4 : 1.1);
      const out = metallic(sr, n, bell ? 620 : 520, r);
      // the stick "ping": a pitched partial
      const ping = sweep(n, sr, bell ? 2900 : 3600, bell ? 2900 : 3600, 1);
      decay(ping, sr, bell ? 1.2 : 0.35);
      mixInto(out, ping, bell ? 0.5 : 0.25);
      mixInto(out, noise(n, 'white', r), 0.25);
      filter(out, sr, ['highpass', 1800, 0.7], ['peaking', 4500, 1, 3]);
      decay(out, sr, bell ? 1.3 : 1.0);
      return stereoFrom(normalize(fadeEdges(out, sr), bell ? 0.5 : 0.42), 0.5, sr);
    }
    case 'tom1':
    case 'tom2':
    case 'tom3':
    case 'tom4': {
      const f = { tom1: 196, tom2: 147, tom3: 110, tom4: 82 }[id] * vary(0.015);
      const n = len(0.7);
      const out = sweep(n, sr, f * 1.45, f, 0.06);
      decay(out, sr, 0.55);
      const ov = sweep(n, sr, f * 2.3, f * 1.58, 0.05);
      decay(ov, sr, 0.18);
      mixInto(out, ov, 0.3);
      const stick = noise(len(0.02), 'white', r);
      filter(stick, sr, ['bandpass', 3000, 1]);
      decay(stick, sr, 0.02);
      mixInto(out, stick, 0.35);
      drive(out, 1.5);
      return stereoFrom(normalize(fadeEdges(out, sr), 0.85), 0.1, sr);
    }
    case 'taiko': {
      const n = len(1.4);
      const out = sweep(n, sr, 120, 62, 0.05);
      decay(out, sr, 1.1);
      const skin = noise(n, 'brown', r);
      filter(skin, sr, ['lowpass', 900, 0.7]);
      decay(skin, sr, 0.25);
      mixInto(out, skin, 0.6);
      const slap = noise(len(0.02), 'white', r);
      filter(slap, sr, ['bandpass', 1800, 1.2]);
      decay(slap, sr, 0.02);
      mixInto(out, slap, 0.4);
      drive(out, 1.6);
      return stereoFrom(normalize(fadeEdges(out, sr), 0.9), 0.15, sr);
    }
    case 'gong': {
      // tam-tam: inharmonic partials that bloom after the strike
      const n = len(4.5);
      const l = new Float32Array(n);
      const rr = new Float32Array(n);
      const parts = [1, 1.52, 2.03, 2.74, 3.1, 3.93, 4.6, 5.3, 6.81, 8.2];
      parts.forEach((p, k) => {
        const f = 72 * p * (1 + (r() - 0.5) * 0.01);
        const tone = sweep(n, sr, f * 0.995, f, 0.6, r() * 6);
        const bloom = 0.05 + k * 0.08;
        for (let i = 0; i < n; i++) tone[i] *= 1 - Math.exp(-i / (bloom * sr));
        decay(tone, sr, 4.2 - k * 0.25);
        mixInto(k % 2 ? l : rr, tone, 0.5 / (1 + k * 0.3));
        mixInto(k % 2 ? rr : l, tone, 0.3 / (1 + k * 0.3));
      });
      const hit = noise(len(0.08), 'pink', r);
      filter(hit, sr, ['lowpass', 1200, 0.7]);
      decay(hit, sr, 0.08);
      mixInto(l, hit, 0.5);
      mixInto(rr, hit, 0.5);
      return [normalize(fadeEdges(l, sr, 0.5, 60), 0.7), normalize(fadeEdges(rr, sr, 0.5, 60), 0.7)];
    }
  }
}

// -----------------------------------------------------------------------------------------------
// Guitars & bass
// -----------------------------------------------------------------------------------------------

export type GuitarArt = 'open' | 'mute' | 'single' | 'lead';

/** one distorted take of a power chord (root, fifth, octave) through an amp and a 4x12 cabinet */
function guitarTake(sr: number, root: number, art: GuitarArt, seed: number, dur: number): Float32Array {
  const n = Math.floor(dur * sr);
  const di = new Float32Array(n);
  const mute = art === 'mute';
  const strings = art === 'single' || art === 'lead' ? [0] : [0, 7, 12];
  const r = rng(seed);
  strings.forEach((iv, k) => {
    // a downstroke reaches the higher strings a few ms later
    const strum = Math.floor((k * (mute ? 0.004 : 0.007) + r() * 0.002) * sr);
    const s = pluck(sr, {
      freq: midiHz(root + iv) * (1 + (r() - 0.5) * 0.0016),
      dur,
      t60: art === 'lead' ? 5 : 3.2,
      damp: mute ? 0.55 : 0.32,
      pickPos: 0.12 + r() * 0.05,
      bright: mute ? 0.55 : 0.9,
      muteAt: mute ? 0.085 + r() * 0.02 : undefined,
      seed: seed * 7 + k,
    });
    mixInto(di, s, k === 0 ? 0.55 : 0.45, strum);
  });
  // amp: tighten the lows before the gain stage so the chord stays defined, then clip
  filter(di, sr, ['highpass', mute ? 140 : 110, 0.7], ['peaking', 900, 0.8, 3]);
  drive(di, mute ? 14 : art === 'lead' ? 32 : 20, 0.1);
  // cabinet: steep low cut, mid scoop, presence bump, the 5 kHz speaker roll-off
  filter(di, sr, ['highpass', 82, 0.7], ['highpass', 82, 0.7], ['peaking', 520, 1.1, -5], ['peaking', 2300, 1.1, 4], ['lowpass', 5200, 0.9], ['lowpass', 6800, 0.6]);
  if (mute) filter(di, sr, ['lowshelf', 160, 0.7, 4]);
  // pick noise on the attack
  return fadeEdges(di, sr, 0.3, 30);
}

function bassNote(sr: number, midi: number, seed: number): Float32Array {
  const dur = 1.6;
  const s = pluck(sr, { freq: midiHz(midi), dur, t60: 2.4, damp: 0.6, pickPos: 0.2, bright: 0.75, seed });
  // round-wound pick bass: growl from light overdrive, mids for presence on small speakers
  const sub = sweep(Math.floor(dur * sr), sr, midiHz(midi), midiHz(midi), 1);
  decay(sub, sr, 1.6);
  mixInto(s, sub, 0.35);
  filter(s, sr, ['highpass', 35, 0.7]);
  drive(s, 2.4, 0.05);
  filter(s, sr, ['peaking', 800, 1, 4], ['lowpass', 3200, 0.7]);
  return normalize(fadeEdges(s, sr, 0.3, 20), 0.8);
}

// -----------------------------------------------------------------------------------------------

export class SampleBank {
  private drums = new Map<string, AudioBuffer>();
  private guitars = new Map<string, AudioBuffer>();
  private basses = new Map<number, AudioBuffer>();
  private rr = new Map<string, number>();
  private queue: Array<() => void> = [];
  private pumping = false;

  constructor(readonly ctx: BaseAudioContext) {}

  private toBuffer(ch: Float32Array[]): AudioBuffer {
    const b = this.ctx.createBuffer(ch.length, ch[0].length, this.ctx.sampleRate);
    ch.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    return b;
  }

  /** next round-robin take of a drum */
  drum(id: DrumId): AudioBuffer {
    const takes = ROUND_ROBIN[id] ?? 1;
    let k = ((this.rr.get(id) ?? Math.floor(Math.random() * takes)) + 1 + Math.floor(Math.random() * (takes - 1))) % takes;
    if (takes === 1) k = 0;
    this.rr.set(id, k);
    const key = `${id}:${k}`;
    let b = this.drums.get(key);
    if (!b) {
      b = this.toBuffer(renderDrum(id, this.ctx.sampleRate, k));
      this.drums.set(key, b);
    }
    return b;
  }

  /** stereo double-tracked guitar: take A left, take B right */
  guitar(root: number, art: GuitarArt): AudioBuffer {
    const key = `${root}:${art}`;
    let b = this.guitars.get(key);
    if (!b) {
      const sr = this.ctx.sampleRate;
      const dur = art === 'mute' ? 0.35 : art === 'lead' ? 3 : 2.4;
      const a = guitarTake(sr, root, art, root * 13 + 1, dur);
      const bb = guitarTake(sr, root, art, root * 17 + 5, dur);
      // the second take is played a hair late, like a real overdub
      const late = new Float32Array(bb.length);
      late.set(bb.subarray(0, bb.length - 180), 180);
      b = this.toBuffer([normalize(a, 0.7), normalize(late, 0.7)]);
      this.guitars.set(key, b);
    }
    return b;
  }

  bass(midi: number): AudioBuffer {
    let b = this.basses.get(midi);
    if (!b) {
      const m = bassNote(this.ctx.sampleRate, midi, midi * 3 + 1);
      b = this.toBuffer([m]);
      this.basses.set(midi, b);
    }
    return b;
  }

  /** render in the background, a few buffers per tick, so a song never stalls a frame */
  prewarm(jobs: Array<() => void>): void {
    this.queue.push(...jobs);
    if (this.pumping) return;
    this.pumping = true;
    const pump = () => {
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < 6) this.queue.shift()!();
      if (this.queue.length) setTimeout(pump, 16);
      else this.pumping = false;
    };
    setTimeout(pump, 0);
  }

  prewarmDrums(): void {
    const jobs: Array<() => void> = [];
    for (const id of Object.keys(ROUND_ROBIN) as DrumId[]) for (let k = 0; k < (ROUND_ROBIN[id] ?? 1); k++) jobs.push(() => this.drum(id));
    for (const id of ['crash', 'crash2', 'china', 'rideBell', 'splash', 'hatPedal', 'taiko', 'gong'] as DrumId[]) jobs.push(() => this.drum(id));
    this.prewarm(jobs);
  }
}
