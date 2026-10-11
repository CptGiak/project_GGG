/**
 * The band: synthesized instruments the sequencer plays. Brass, strings and choir are live voices
 * (their articulation changes per note); drums, guitars and bass replay the sample bank.
 *
 * Realism comes from the small things players hear subconsciously: brass that scoops into the
 * note and blooms through its filter, vibrato that arrives a moment after the attack, octave
 * doublings with their own timing and tuning, strums that reach the high string a few ms late,
 * snares that are never the same take twice.
 */
import type { Graph } from './graph';
import { midiHz } from './dsp';
import type { DrumId, GuitarArt, SampleBank } from './samples';

export interface Bus {
  /** dry input of the instrument channel */
  in: GainNode;
  /** reverb send */
  send: GainNode;
}

const jitter = (ms: number) => ((Math.random() * 2 - 1) * ms) / 1000;

export class Band {
  readonly ch: Record<string, Bus> = {};

  constructor(
    readonly g: Graph,
    readonly bank: SampleBank,
    readonly mix: AudioNode,
    readonly reverb: AudioNode,
  ) {
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
    strip('gtr', 0.36, 0, 0.06, 95, 9000);
    strip('bass', 0.5, 0, 0.0, 38, 4500);
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

  // -------------------------------------------------------------------------------------------
  // drums
  // -------------------------------------------------------------------------------------------

  drum(id: DrumId, t: number, vel: number, pan = 0): void {
    const lane = id === 'kick' ? 'kick' : id.startsWith('snare') || id === 'ghost' || id === 'clap' ? 'snare' : id.startsWith('hat') ? 'hats' : id.startsWith('tom') ? 'toms' : id === 'taiko' || id === 'gong' ? 'perc' : 'cym';
    const bus = this.ch[lane];
    const s = this.ctx.createBufferSource();
    s.buffer = this.bank.drum(id);
    // softer hits are also darker, like a real drum
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
  // brass section
  // -------------------------------------------------------------------------------------------

  /**
   * One brass player: three detuned saws through a lowpass whose envelope does the "blat" (bright
   * attack, settle), a scoop up into accented notes, delayed vibrato and breath noise.
   * `kind`: 'trumpet' bright and edgy, 'horn' round and dark, 'stab' short and percussive,
   * 'swell' slow crescendo.
   */
  brass(midi: number, t: number, dur: number, vel: number, flags = '', kind: 'trumpet' | 'horn' | 'stab' | 'swell' = 'trumpet', bus = this.ch.brass): void {
    const c = this.ctx;
    const f = midiHz(midi);
    t += 0.006 + jitter(4);
    const stab = kind === 'stab';
    const swell = kind === 'swell';
    const horn = kind === 'horn';
    const atk = stab ? 0.012 : swell ? Math.min(0.5, dur * 0.6) : horn ? 0.05 : 0.03;
    const rel = stab ? 0.07 : 0.12;
    const len = stab ? Math.min(dur, 0.16) : dur;
    const end = t + len;
    const out = c.createGain();
    // amplitude
    const peak = 0.11 * vel;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(peak, t + atk);
    if (!swell) out.gain.exponentialRampToValueAtTime(peak * (stab ? 0.5 : 0.78), t + atk + 0.12);
    out.gain.setValueAtTime(swell ? peak : peak * (stab ? 0.5 : 0.78), end);
    out.gain.exponentialRampToValueAtTime(0.0001, end + rel);
    // filter: bright attack (velocity and key follow), then settle
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = horn ? 0.5 : 1.2;
    const bright = (horn ? 2.2 : 4.5) + vel * (horn ? 1.5 : 3.5);
    const rest = horn ? 1.8 : 3;
    const fc = (k: number) => Math.min(16000, f * k + 300);
    lp.frequency.setValueAtTime(fc(swell ? rest * 0.6 : 1.2), t);
    lp.frequency.exponentialRampToValueAtTime(fc(swell ? bright : bright), t + atk + (swell ? 0.2 : 0.015));
    if (!swell) lp.frequency.exponentialRampToValueAtTime(fc(rest), t + atk + 0.2);
    lp.frequency.setValueAtTime(fc(swell ? bright : rest), end);
    lp.frequency.exponentialRampToValueAtTime(fc(1), end + rel);
    lp.connect(out).connect(bus.in);
    out.connect(bus.send);
    // pitch: scoop into accents, fall off stabs and '/' notes
    const scoop = flags.includes('^') || (flags.includes('!') && !stab) ? 80 : 18;
    const fall = flags.includes('/') || (stab && flags.includes('X'));
    const detunes = horn ? [-5, 4] : [-7, 0, 6];
    for (const dt of detunes) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.setValueAtTime(dt - scoop, t);
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
        depth.gain.linearRampToValueAtTime(flags.includes('~') ? 22 : 11, t + 0.55);
        lfo.connect(depth).connect(o.detune);
        lfo.start(t);
        lfo.stop(end + rel);
      }
    }
    // breath at the attack
    this.g.noiseBurst({ color: 'pink', type: 'bandpass', f: Math.min(6000, f * 3), q: 1.5, t, dur: atk + 0.05, vol: 0.05 * vel, a: 0.005, out: lp });
  }

  /** brass chord stab or swell, horns an octave below */
  brassChord(notes: number[], t: number, dur: number, vel: number, flags: string): void {
    const swell = flags === '<';
    notes.forEach((n, i) => {
      this.brass(n, t + jitter(3), dur, vel * (i === notes.length - 1 ? 1 : 0.8), flags, swell ? 'swell' : 'stab');
      if (i === 0 || i === notes.length - 1) this.brass(n - 12, t + jitter(3), dur, vel * 0.7, flags, swell ? 'swell' : 'stab', this.ch.horns);
    });
  }

  // -------------------------------------------------------------------------------------------
  // strings, choir, lead synth, bells, timpani
  // -------------------------------------------------------------------------------------------

  /** string section note: legato (long) or spiccato (short ostinato) */
  strings(midi: number, t: number, dur: number, vel: number, short: boolean, bus = this.ch.strings): void {
    const c = this.ctx;
    const f = midiHz(midi);
    t += 0.004 + jitter(5);
    const atk = short ? 0.006 : Math.min(0.22, 0.06 + dur * 0.15);
    const len = short ? Math.min(dur, 0.13) : dur;
    const end = t + len;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(Math.min(12000, f * (short ? 9 : 5) + 600), t);
    if (short) lp.frequency.exponentialRampToValueAtTime(Math.min(9000, f * 3 + 500), t + 0.1);
    const out = c.createGain();
    const peak = (short ? 0.07 : 0.05) * vel;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(peak, t + atk);
    out.gain.setValueAtTime(peak, end);
    out.gain.exponentialRampToValueAtTime(0.0001, end + (short ? 0.09 : 0.25));
    lp.connect(out).connect(bus.in);
    out.connect(bus.send);
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
  choir(midi: number, t: number, dur: number, vel: number, bus = this.ch.choir): void {
    const c = this.ctx;
    const f = midiHz(midi);
    t += jitter(8);
    const end = t + dur;
    const out = c.createGain();
    const peak = 0.16 * vel;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.35, dur * 0.4));
    out.gain.setValueAtTime(peak, end);
    out.gain.exponentialRampToValueAtTime(0.0001, end + 0.4);
    out.connect(bus.in);
    out.connect(bus.send);
    // "ah" formants (F1 ~ 800, F2 ~ 1150, F3 ~ 2900 Hz); the vowel opens from "oh" as it swells
    const formants: Array<[number, number, number, number]> = [[500, 800, 7, 1], [850, 1150, 9, 0.6], [2600, 2900, 12, 0.25]];
    const sum = c.createGain();
    for (const [f0, f1, q, g] of formants) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = q;
      bp.frequency.setValueAtTime(f0, t);
      bp.frequency.linearRampToValueAtTime(f1, t + Math.min(0.4, dur * 0.5));
      const gg = this.g.gain(g * 3, out);
      sum.connect(bp).connect(gg);
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

  /** anisong "singer" stand-in: a bright saw/square lead with glide and scoops */
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

  /** timpani: tuned membrane modes with a soft mallet; `roll` repeats strokes with a crescendo */
  timpani(midi: number, t: number, dur: number, vel: number, roll: boolean): void {
    const bus = this.ch.perc;
    const strike = (at: number, v: number) => {
      const f = midiHz(midi);
      // timpani partial ratios (approx. 1 : 1.5 : 1.98 : 2.44)
      [1, 1.5, 1.98, 2.44].forEach((r, i) => {
        this.g.tone({ f: f * r * 1.01, f1: f * r, glide: 0.15, t: at, dur: 1.6 - i * 0.3, vol: (0.32 * v) / (1 + i * 0.9), a: 0.002, out: bus.in });
      });
      this.g.noiseBurst({ color: 'brown', type: 'lowpass', f: 900, t: at, dur: 0.09, vol: 0.4 * v, out: bus.in });
    };
    if (!roll) strike(t, vel);
    else {
      const n = Math.max(3, Math.floor(dur / 0.055));
      for (let i = 0; i < n; i++) strike(t + i * 0.055 + jitter(3), vel * (0.35 + 0.65 * (i / n)));
    }
  }
}
