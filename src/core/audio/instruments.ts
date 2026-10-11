/**
 * The band: the instruments the sequencer plays.
 *
 * Drums, guitars and bass replay the JS-rendered sample bank. Brass, strings, choir and timpani are
 * synthesized voices (below) that are rendered once per note in a background OfflineAudioContext
 * and then replayed as buffers: the same sound for two audio nodes per note instead of a dozen.
 * Until a note's render is ready the live voice plays it, so nothing ever waits.
 *
 * Realism comes from the small things players hear subconsciously: brass that scoops into the
 * note and blooms through its filter, vibrato that arrives a moment after the attack, octave
 * doublings with their own timing and tuning, strums that reach the high string a few ms late,
 * snares that are never the same take twice.
 */
import { Graph } from './graph';
import { midiHz } from './dsp';
import type { DrumId, GuitarArt, SampleBank } from './samples';

export interface Bus {
  /** dry input of the instrument channel */
  in: GainNode;
  /** reverb send */
  send: GainNode;
}

export type BrassKind = 'trumpet' | 'horn' | 'stab' | 'swell';

const jitter = (ms: number) => ((Math.random() * 2 - 1) * ms) / 1000;

// =============================================================================================
// Voices (pure: they draw into any context, live or offline)
// =============================================================================================

/**
 * One brass player: three detuned saws through a lowpass whose envelope does the "blat" (bright
 * attack, settle), a scoop up into the note, delayed vibrato and breath noise. 'trumpet' bright
 * and edgy, 'horn' round and dark, 'stab' short and percussive (with a fall when `fall`), 'swell'
 * a slow crescendo.
 */
export function brassVoice(g: Graph, out: AudioNode, midi: number, t: number, dur: number, vel: number, kind: BrassKind, scoopCents = 18, fall = false, vibCents = 11): void {
  const c = g.ctx;
  const f = midiHz(midi);
  const stab = kind === 'stab';
  const swell = kind === 'swell';
  const horn = kind === 'horn';
  const atk = stab ? 0.012 : swell ? Math.min(0.5, dur * 0.6) : horn ? 0.05 : 0.03;
  const rel = stab ? 0.07 : 0.12;
  const len = stab ? Math.min(dur, 0.16) : dur;
  const end = t + len;
  const amp = c.createGain();
  const peak = 0.11 * vel;
  const settle = peak * (stab ? 0.5 : 0.78);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(peak, t + atk);
  if (!swell) amp.gain.exponentialRampToValueAtTime(settle, t + atk + 0.12);
  amp.gain.setValueAtTime(swell ? peak : settle, end);
  amp.gain.exponentialRampToValueAtTime(0.0001, end + rel);
  // the filter envelope does the work: bright attack (velocity and key follow), then settle
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = horn ? 0.5 : 1.2;
  const bright = (horn ? 2.2 : 4.5) + vel * (horn ? 1.5 : 3.5);
  const rest = horn ? 1.8 : 3;
  const fc = (k: number) => Math.min(16000, f * k + 300);
  lp.frequency.setValueAtTime(fc(swell ? rest * 0.6 : 1.2), t);
  lp.frequency.exponentialRampToValueAtTime(fc(bright), t + atk + (swell ? 0.2 : 0.015));
  if (!swell) lp.frequency.exponentialRampToValueAtTime(fc(rest), t + atk + 0.2);
  lp.frequency.setValueAtTime(fc(swell ? bright : rest), end);
  lp.frequency.exponentialRampToValueAtTime(fc(1), end + rel);
  lp.connect(amp).connect(out);
  const detunes = horn ? [-5, 4] : [-7, 0, 6];
  for (const dt of detunes) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.setValueAtTime(dt - scoopCents, t);
    o.detune.linearRampToValueAtTime(dt, t + 0.045);
    if (fall) {
      o.detune.setValueAtTime(dt, end - 0.02);
      o.detune.linearRampToValueAtTime(dt - 200, end + rel);
    }
    o.connect(lp);
    o.start(t);
    o.stop(end + rel + 0.05);
    if (len > 0.35 && !stab) {
      // vibrato arrives after the attack, at a slightly human rate
      const lfo = c.createOscillator();
      lfo.frequency.value = 5.2 + Math.random() * 0.6;
      const depth = c.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.setValueAtTime(0, t + 0.25);
      depth.gain.linearRampToValueAtTime(vibCents, t + 0.55);
      lfo.connect(depth).connect(o.detune);
      lfo.start(t);
      lfo.stop(end + rel);
    }
  }
  // breath at the attack
  g.noiseBurst({ color: 'pink', type: 'bandpass', f: Math.min(6000, f * 3), q: 1.5, t, dur: atk + 0.05, vol: 0.05 * vel, a: 0.005, out: lp });
}

/** string section note: legato (long) or spiccato (short ostinato) */
export function stringsVoice(g: Graph, out: AudioNode, midi: number, t: number, dur: number, vel: number, short: boolean): void {
  const c = g.ctx;
  const f = midiHz(midi);
  const atk = short ? 0.006 : Math.min(0.22, 0.06 + dur * 0.15);
  const len = short ? Math.min(dur, 0.13) : dur;
  const end = t + len;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(Math.min(12000, f * (short ? 9 : 5) + 600), t);
  if (short) lp.frequency.exponentialRampToValueAtTime(Math.min(9000, f * 3 + 500), t + 0.1);
  const amp = c.createGain();
  const peak = (short ? 0.07 : 0.05) * vel;
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(peak, t + atk);
  amp.gain.setValueAtTime(peak, end);
  amp.gain.exponentialRampToValueAtTime(0.0001, end + (short ? 0.09 : 0.25));
  lp.connect(amp).connect(out);
  // body resonances of the instrument (300 / 700 / 3000 Hz) give the saws a wooden voice
  const body = g.gain(0.35, amp);
  lp.connect(g.filter('bandpass', 300, 2.5, body));
  lp.connect(g.filter('bandpass', 700, 2.5, body));
  lp.connect(g.filter('bandpass', 3000, 1.5, body));
  const voices = short ? [-6, 7] : [-11, -3, 4, 12];
  for (const dt of voices) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = dt;
    if (!short && len > 0.4) {
      const lfo = c.createOscillator();
      lfo.frequency.value = 5 + Math.random() * 0.8;
      const depth = c.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(9, t + 0.45);
      lfo.connect(depth).connect(o.detune);
      lfo.start(t);
      lfo.stop(end + 0.3);
    }
    o.connect(lp);
    o.start(t);
    o.stop(end + 0.3);
  }
}

/** choir "aah": saws through three vowel formants, slow bloom, wide vibrato */
export function choirVoice(g: Graph, out: AudioNode, midi: number, t: number, dur: number, vel: number): void {
  const c = g.ctx;
  const f = midiHz(midi);
  const end = t + dur;
  const amp = c.createGain();
  const peak = 0.16 * vel;
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.35, dur * 0.4));
  amp.gain.setValueAtTime(peak, end);
  amp.gain.exponentialRampToValueAtTime(0.0001, end + 0.4);
  amp.connect(out);
  // "ah" formants (F1 ~ 800, F2 ~ 1150, F3 ~ 2900 Hz); the vowel opens from "oh" as it swells
  const formants: Array<[number, number, number, number]> = [[500, 800, 7, 1], [850, 1150, 9, 0.6], [2600, 2900, 12, 0.25]];
  const sum = c.createGain();
  for (const [f0, f1, q, gg] of formants) {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.linearRampToValueAtTime(f1, t + Math.min(0.4, dur * 0.5));
    sum.connect(bp).connect(g.gain(gg * 3, amp));
  }
  for (const dt of [-9, 0, 8]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = dt;
    const lfo = c.createOscillator();
    lfo.frequency.value = 4.6 + Math.random() * 0.9;
    const depth = c.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(16, t + 0.5);
    lfo.connect(depth).connect(o.detune);
    o.connect(sum);
    o.start(t);
    lfo.start(t);
    o.stop(end + 0.45);
    lfo.stop(end + 0.45);
  }
}

/** timpani: tuned membrane modes (1 : 1.5 : 1.98 : 2.44), sharp at the strike, with a mallet thud */
export function timpaniVoice(g: Graph, out: AudioNode, midi: number, t: number, vel: number): void {
  const f = midiHz(midi);
  [1, 1.5, 1.98, 2.44].forEach((r, i) => {
    g.tone({ f: f * r * 1.02, f1: f * r, glide: 0.12, t, dur: 1.6 - i * 0.3, vol: (0.32 * vel) / (1 + i * 0.9), a: 0.002, out });
  });
  g.noiseBurst({ color: 'brown', type: 'lowpass', f: 900, t, dur: 0.09, vol: 0.4 * vel, out });
}

// =============================================================================================
// Note cache: each voice rendered once, offline, in the background
// =============================================================================================

interface Job {
  key: string;
  len: number;
  build: (g: Graph, out: AudioNode) => void;
}

export class NoteCache {
  private bufs = new Map<string, AudioBuffer>();
  private pending = new Set<string>();
  private queue: Job[] = [];
  private busy = false;
  private waiters: Array<() => void> = [];

  constructor(private main: Graph) {}

  get(key: string): AudioBuffer | null {
    return this.bufs.get(key) ?? null;
  }

  want(key: string, len: number, build: Job['build']): void {
    if (this.bufs.has(key) || this.pending.has(key) || typeof OfflineAudioContext === 'undefined') return;
    this.pending.add(key);
    this.queue.push({ key, len, build });
    this.pump();
  }

  /** resolves once everything requested so far is rendered */
  idle(): Promise<void> {
    if (!this.busy && !this.queue.length) return Promise.resolve();
    return new Promise((res) => this.waiters.push(res));
  }

  private pump(): void {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) {
      this.waiters.splice(0).forEach((w) => w());
      return;
    }
    this.busy = true;
    const sr = this.main.ctx.sampleRate;
    const oc = new OfflineAudioContext(1, Math.ceil(job.len * sr), sr);
    job.build(new Graph(oc, this.main.noise), oc.destination);
    oc.startRendering()
      .then((b) => {
        this.bufs.set(job.key, b);
      })
      .catch(() => undefined)
      .finally(() => {
        this.pending.delete(job.key);
        this.busy = false;
        this.pump();
      });
  }
}

/** rendered lengths: long enough for the longest held notes in the score */
const SUS = { brass: 2.8, horn: 2.8, strings: 3.6, choir: 3.6 };
const REF_VEL = 0.9;

// =============================================================================================
// The band
// =============================================================================================

export class Band {
  readonly ch: Record<string, Bus> = {};
  readonly cache: NoteCache;
  /** notes played live because their render was not ready (profiling) */
  misses = new Map<string, number>();

  constructor(
    readonly g: Graph,
    readonly bank: SampleBank,
    readonly mix: AudioNode,
    readonly reverb: AudioNode,
  ) {
    this.cache = new NoteCache(g);
    // channel strip: level, pan, reverb send, and the EQ slot each part lives in
    const strip = (name: string, vol: number, pan: number, rev: number, hp = 0, lp = 0) => {
      const input = g.gain(vol);
      let node: AudioNode = input;
      if (hp) node = node.connect(g.filter('highpass', hp, 0.7));
      if (lp) node = node.connect(g.filter('lowpass', lp, 0.7));
      const out = g.pan(pan, mix);
      node.connect(out);
      const send = g.gain(rev, reverb);
      node.connect(send);
      this.ch[name] = { in: input, send };
    };
    strip('kick', 0.85, 0, 0.04, 35);
    strip('snare', 0.62, 0, 0.18);
    strip('hats', 0.3, 0.25, 0.05, 300);
    strip('cym', 0.34, -0.15, 0.12, 300);
    strip('toms', 0.55, 0, 0.14, 50);
    strip('perc', 0.5, -0.1, 0.25, 40);
    strip('gtr', 0.56, 0, 0.06, 95, 9000);
    strip('bass', 0.42, 0, 0.0, 40, 4500);
    strip('brass', 0.32, 0.15, 0.28, 140);
    strip('horns', 0.26, -0.25, 0.32, 120);
    strip('strings', 0.22, -0.3, 0.34, 160);
    strip('pad', 0.16, 0, 0.45, 200);
    strip('choir', 0.2, 0, 0.5, 200);
    strip('lead', 0.3, 0.1, 0.22, 180, 9000);
    strip('synth', 0.16, 0.2, 0.2, 200);
    strip('bells', 0.12, 0.35, 0.35, 600);
  }

  get ctx(): BaseAudioContext {
    return this.g.ctx;
  }

  /** a voice output feeding a channel's dry input and its reverb send */
  private voiceOut(bus: Bus, vol = 1): GainNode {
    const v = this.g.gain(vol);
    v.connect(bus.in);
    v.connect(bus.send);
    return v;
  }

  /**
   * Replay a cached note: gain envelope cut to the note length, pitch moves (scoop, fall, extra
   * vibrato) on the source's detune. Returns false when the note is not rendered yet.
   */
  private cached(key: string, bus: Bus, t: number, dur: number, vel: number, rel: number, o: { attack?: number; scoop?: number; fall?: boolean; vib?: number } = {}): boolean {
    const buf = this.cache.get(key);
    if (!buf) {
      this.misses.set(key, (this.misses.get(key) ?? 0) + 1);
      return false;
    }
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = buf;
    const d = s.detune;
    // every player drifts a little from the others
    const drift = (Math.random() - 0.5) * 8;
    d.setValueAtTime(drift - (o.scoop ?? 0), t);
    if (o.scoop) d.linearRampToValueAtTime(drift, t + 0.05);
    const end = t + Math.max(0.02, Math.min(dur, buf.duration - rel - 0.03));
    if (o.fall) {
      d.setValueAtTime(drift, end - 0.02);
      d.linearRampToValueAtTime(drift - 200, end + rel);
    }
    if (o.vib) {
      const lfo = c.createOscillator();
      lfo.frequency.value = 5.4;
      const depth = this.g.gain(0);
      depth.gain.setValueAtTime(0, t + 0.2);
      depth.gain.linearRampToValueAtTime(o.vib, t + 0.5);
      lfo.connect(depth).connect(d);
      lfo.start(t);
      lfo.stop(end + rel);
    }
    const k = vel / REF_VEL;
    const gn = c.createGain();
    if (o.attack) {
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(k, t + o.attack);
    } else gn.gain.setValueAtTime(k, t);
    gn.gain.setValueAtTime(k, end);
    gn.gain.exponentialRampToValueAtTime(0.0001, end + rel);
    s.connect(gn);
    gn.connect(bus.in);
    gn.connect(bus.send);
    s.start(Math.max(0, t));
    s.stop(end + rel + 0.03);
    return true;
  }

  /** queue the background renders of a part's notes (prewarm) */
  want(part: 'trumpet' | 'horn' | 'stab' | 'stabFall' | 'strings' | 'spiccato' | 'choir' | 'timp', midi: number): void {
    const c = this.cache;
    switch (part) {
      case 'trumpet':
        c.want(`bt${midi}`, SUS.brass + 0.2, (g, o) => brassVoice(g, o, midi, 0, SUS.brass, REF_VEL, 'trumpet'));
        break;
      case 'horn':
        c.want(`bh${midi}`, SUS.horn + 0.2, (g, o) => brassVoice(g, o, midi, 0, SUS.horn, REF_VEL, 'horn'));
        break;
      case 'stab':
        c.want(`bs${midi}`, 0.4, (g, o) => brassVoice(g, o, midi, 0, 0.16, REF_VEL, 'stab'));
        break;
      case 'stabFall':
        c.want(`bf${midi}`, 0.4, (g, o) => brassVoice(g, o, midi, 0, 0.16, REF_VEL, 'stab', 18, true));
        break;
      case 'strings':
        c.want(`sl${midi}`, SUS.strings + 0.35, (g, o) => stringsVoice(g, o, midi, 0, SUS.strings, REF_VEL, false));
        break;
      case 'spiccato':
        c.want(`ss${midi}`, 0.3, (g, o) => stringsVoice(g, o, midi, 0, 0.13, REF_VEL, true));
        break;
      case 'choir':
        c.want(`ch${midi}`, SUS.choir + 0.5, (g, o) => choirVoice(g, o, midi, 0, SUS.choir, REF_VEL));
        break;
      case 'timp':
        c.want(`tp${midi}`, 1.8, (g, o) => timpaniVoice(g, o, midi, 0, REF_VEL));
        break;
    }
  }

  // -------------------------------------------------------------------------------------------
  // drums
  // -------------------------------------------------------------------------------------------

  drum(id: DrumId, t: number, vel: number, pan = 0): void {
    const lane = id === 'kick' ? 'kick' : id.startsWith('snare') || id === 'ghost' || id === 'clap' ? 'snare' : id.startsWith('hat') ? 'hats' : id.startsWith('tom') ? 'toms' : id === 'taiko' || id === 'gong' ? 'perc' : 'cym';
    const bus = this.ch[lane];
    const s = this.ctx.createBufferSource();
    s.buffer = this.bank.drum(id);
    // softer hits are also a touch lower, like a real drum
    s.playbackRate.value = 1 + (vel - 0.8) * 0.03 + (Math.random() - 0.5) * 0.012;
    const gn = this.g.gain(vel * vel, pan ? this.g.pan(pan, bus.in) : bus.in);
    s.connect(gn);
    s.start(Math.max(0, t));
  }

  // -------------------------------------------------------------------------------------------
  // guitars & bass (sampled)
  // -------------------------------------------------------------------------------------------

  /** power chord on `root` (midi); length in seconds; slide: semitones to slide up from */
  guitar(root: number, art: GuitarArt, t: number, dur: number, vel: number, slide = 0): void {
    const bus = this.ch.gtr;
    const s = this.ctx.createBufferSource();
    s.buffer = this.bank.guitar(root, art);
    if (slide) {
      s.detune.setValueAtTime(-slide * 100, t);
      s.detune.linearRampToValueAtTime(0, t + 0.09);
    }
    const g = this.ctx.createGain();
    const v = vel * (art === 'mute' ? 0.85 : 1);
    g.gain.setValueAtTime(v, t);
    const end = t + Math.min(dur, s.buffer.duration - 0.05);
    g.gain.setValueAtTime(v, Math.max(t, end - 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.06);
    s.connect(g).connect(bus.in);
    s.start(Math.max(0, t));
    s.stop(end + 0.08);
  }

  /** a lead guitar note: sustained distorted single string, bent and shaken through detune */
  leadGuitar(midi: number, t: number, dur: number, vel: number, flags: string): void {
    const bus = this.ch.lead;
    const s = this.ctx.createBufferSource();
    s.buffer = this.bank.guitar(midi, 'lead');
    const d = s.detune;
    if (flags.includes('^')) {
      d.setValueAtTime(-200, t);
      d.linearRampToValueAtTime(0, t + 0.07);
    } else d.setValueAtTime(0, t);
    if (dur > 0.3 || flags.includes('~')) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 5.6 + Math.random() * 0.5;
      const depth = this.ctx.createGain();
      const cents = flags.includes('~') ? 38 : 22;
      depth.gain.setValueAtTime(0, t);
      depth.gain.setValueAtTime(0, t + 0.22);
      depth.gain.linearRampToValueAtTime(cents, t + 0.5);
      lfo.connect(depth).connect(d);
      lfo.start(t);
      lfo.stop(t + dur + 0.2);
    }
    if (flags.includes('/')) {
      d.setValueAtTime(0, t + dur * 0.7);
      d.linearRampToValueAtTime(-300, t + dur + 0.05);
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.setValueAtTime(vel, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    s.connect(g).connect(bus.in);
    s.start(t);
    s.stop(t + dur + 0.15);
  }

  bass(midi: number, t: number, dur: number, vel: number): void {
    const bus = this.ch.bass;
    const s = this.ctx.createBufferSource();
    s.buffer = this.bank.bass(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    const end = t + Math.min(dur * 0.95, 1.5);
    g.gain.setValueAtTime(vel, end);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.05);
    s.connect(g).connect(bus.in);
    s.start(t);
    s.stop(end + 0.07);
  }

  // -------------------------------------------------------------------------------------------
  // orchestra (cached voices with live fallback)
  // -------------------------------------------------------------------------------------------

  brass(midi: number, t: number, dur: number, vel: number, flags = '', kind: BrassKind = 'trumpet', bus = this.ch.brass): void {
    // brass sits a few ms behind the drums
    t += 0.006 + jitter(4);
    const stab = kind === 'stab';
    const scoop = flags.includes('^') || (flags.includes('!') && !stab) ? 80 : 0;
    const fall = flags.includes('/') || (stab && flags.includes('X'));
    const vib = flags.includes('~') ? 14 : 0;
    if (stab) {
      const part = fall ? 'stabFall' : 'stab';
      this.want(part, midi);
      if (this.cached(`${fall ? 'bf' : 'bs'}${midi}`, bus, t, 0.16, vel, 0.12)) return;
    } else {
      const horn = kind === 'horn';
      this.want(horn ? 'horn' : 'trumpet', midi);
      const attack = kind === 'swell' ? Math.min(0.5, dur * 0.6) : undefined;
      if (this.cached(`${horn ? 'bh' : 'bt'}${midi}`, bus, t, dur, vel, 0.12, { scoop, fall, vib, attack })) return;
    }
    brassVoice(this.g, this.voiceOut(bus), midi, t, dur, vel, kind, scoop || 18, fall, 11 + vib);
  }

  /** brass chord stab or swell, horns an octave below on the outer voices */
  brassChord(notes: number[], t: number, dur: number, vel: number, flags: string): void {
    const swell = flags === '<';
    notes.forEach((n, i) => {
      this.brass(n, t + jitter(3), dur, vel * (i === notes.length - 1 ? 1 : 0.8), flags, swell ? 'swell' : 'stab');
      if (i === 0 || i === notes.length - 1) this.brass(n - 12, t + jitter(3), dur, vel * 0.7, flags, swell ? 'swell' : 'stab', this.ch.horns);
    });
  }

  strings(midi: number, t: number, dur: number, vel: number, short: boolean, bus = this.ch.strings): void {
    t += 0.004 + jitter(5);
    this.want(short ? 'spiccato' : 'strings', midi);
    if (this.cached(`${short ? 'ss' : 'sl'}${midi}`, bus, t, short ? 0.13 : dur, vel, short ? 0.09 : 0.25)) return;
    stringsVoice(this.g, this.voiceOut(bus), midi, t, dur, vel, short);
  }

  choir(midi: number, t: number, dur: number, vel: number, bus = this.ch.choir): void {
    t += jitter(8);
    this.want('choir', midi);
    if (this.cached(`ch${midi}`, bus, t, dur, vel, 0.4)) return;
    choirVoice(this.g, this.voiceOut(bus), midi, t, dur, vel);
  }

  /** timpani: single strokes, or a roll with a crescendo */
  timpani(midi: number, t: number, dur: number, vel: number, roll: boolean): void {
    const bus = this.ch.perc;
    this.want('timp', midi);
    const strike = (at: number, v: number) => {
      if (!this.cached(`tp${midi}`, bus, at, 1.6, v, 0.15)) timpaniVoice(this.g, this.voiceOut(bus), midi, at, v);
    };
    if (!roll) strike(t, vel);
    else {
      const n = Math.max(3, Math.floor(dur / 0.055));
      for (let i = 0; i < n; i++) strike(t + i * 0.055 + jitter(3), vel * (0.35 + 0.65 * (i / n)));
    }
  }

  /** anisong "singer" stand-in: a bright saw/square lead with scoops (live: few notes) */
  synthLead(midi: number, t: number, dur: number, vel: number, flags: string): void {
    const c = this.ctx;
    const f = midiHz(midi);
    const bus = this.ch.synth;
    const end = t + dur * (flags.includes("'") ? 0.5 : 0.95);
    const lp = this.g.filter('lowpass', Math.min(12000, f * 6), 1.5);
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.09 * vel, t + 0.01);
    out.gain.setValueAtTime(0.08 * vel, end);
    out.gain.exponentialRampToValueAtTime(0.0001, end + 0.08);
    lp.connect(out).connect(bus.in);
    out.connect(bus.send);
    for (const [type, dt] of [['sawtooth', -5], ['square', 6]] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const scoop = flags.includes('^') ? 150 : flags.includes('!') ? 60 : 0;
      o.detune.setValueAtTime(dt - scoop, t);
      o.detune.linearRampToValueAtTime(dt, t + 0.06);
      if (dur > 0.3) {
        const lfo = c.createOscillator();
        lfo.frequency.value = 5.8;
        const depth = c.createGain();
        depth.gain.setValueAtTime(0, t);
        depth.gain.setValueAtTime(0, t + 0.2);
        depth.gain.linearRampToValueAtTime(18, t + 0.45);
        lfo.connect(depth).connect(o.detune);
        lfo.start(t);
        lfo.stop(end + 0.1);
      }
      o.connect(lp);
      o.start(t);
      o.stop(end + 0.1);
    }
  }

  /** glockenspiel / celesta sparkle: inharmonic struck bar */
  bell(midi: number, t: number, vel: number): void {
    const f = midiHz(midi);
    const bus = this.ch.bells;
    this.g.tone({ f, t, dur: 1.4, vol: 0.18 * vel, a: 0.001, out: bus.in });
    this.g.tone({ f: f * 2.76, t, dur: 0.5, vol: 0.06 * vel, a: 0.001, out: bus.in });
    this.g.tone({ f: f * 5.4, t, dur: 0.18, vol: 0.03 * vel, a: 0.001, out: bus.in });
    this.g.tone({ f, t, dur: 1.4, vol: 0.06 * vel, a: 0.001, out: bus.send });
  }
}
