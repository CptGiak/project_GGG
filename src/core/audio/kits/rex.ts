/**
 * REX, "HEADLINER": a bass-cannon rifle played like a drum machine (hip-hop).
 *
 * Timbre family: every shot is a muted drum-machine hit on the score's chord (a tight 808/tom
 * body and a short pink snap, no sub, almost nothing above 2 kHz); the heavy shot is a kick +
 * clap "boom-clap" with an 808 bass tail; the Bass Charge is a filter wobble that climbs out of
 * the low end and resolves on the chord; the gun action (a two-stage clack) is his signature;
 * the ultimate is an air-horn brass stab, a rising synth-pluck arpeggio and the drop.
 */
import { chordHz, clack, clamp01, click, crunch, lerp, mallet, ring, rr, semi, smack, sub, swell, thump, whoosh, type SfxCtx, type SfxDef } from '../layers';

// -----------------------------------------------------------------------------------------------
// local instruments
// -----------------------------------------------------------------------------------------------

/** an oscillator that starts at `t` and stops itself after `end` */
function osc(c: SfxCtx, type: OscillatorType, f: number, t: number, end: number, out: AudioNode, detune = 0): OscillatorNode {
  const o = c.g.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.detune.value = detune;
  o.connect(out);
  o.start(t);
  o.stop(end + 0.05);
  return o;
}

/** the drum machine's tone: a muted saw through a low-pass that snaps shut */
function tok(c: SfxCtx, f: number, o: { dur: number; vol: number; at?: number; open: number; shut: number; q?: number; type?: OscillatorType; out?: AudioNode }): void {
  const t = c.t + (o.at ?? 0);
  const lp = c.g.filter('lowpass', o.open, o.q ?? 1.1, o.out ?? c.out);
  lp.frequency.setValueAtTime(o.open, t);
  lp.frequency.exponentialRampToValueAtTime(o.shut, t + o.dur * 0.7);
  c.g.tone({ type: o.type ?? 'sawtooth', f: f * c.p, t, dur: o.dur, vol: o.vol, a: 0.002, out: lp });
}

/** a clap: three band-passed pink slaps a hair apart and a short tail, from one noise source */
function clap(c: SfxCtx, vol: number, at = 0, f = 1150, tail = 0.14): void {
  const t = c.t + at;
  const s = c.g.noiseSrc('pink', t, 0.04 + tail);
  const bp = c.g.filter('bandpass', f * c.p * rr(c, 0.95, 1.05), 1.6);
  const gn = c.g.gain(0);
  const p = gn.gain;
  let x = t;
  for (let i = 0; i < 3; i++) {
    p.setValueAtTime(0.0001, x);
    p.linearRampToValueAtTime(vol * (i === 2 ? 1 : 0.7), x + 0.0012);
    p.exponentialRampToValueAtTime(vol * 0.12, x + 0.009);
    x += rr(c, 0.009, 0.012);
  }
  p.setValueAtTime(vol * 0.55, x);
  p.exponentialRampToValueAtTime(0.0001, x + tail);
  s.connect(bp).connect(gn).connect(c.out);
}

/** an 808-style bass note: detuned saws through a low-pass that closes, an optional fall; `extra`
 * adds single saws (other chord tones, Hz) through the same filter */
function bass(c: SfxCtx, o: { f: number; dur: number; vol: number; at?: number; to?: number; cutoff: number; hp?: number; extra?: number[] }): void {
  const t = c.t + (o.at ?? 0);
  const lp = c.g.filter('lowpass', o.cutoff, 1.3, c.g.filter('highpass', o.hp ?? 90, 0.7, c.out));
  lp.frequency.setValueAtTime(o.cutoff, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(110, o.cutoff * 0.2), t + o.dur);
  for (const d of [-6, 6]) c.g.tone({ type: 'sawtooth', f: o.f * c.p, f1: o.to ? o.f * c.p * o.to : undefined, glide: o.dur * 0.8, t, dur: o.dur, vol: o.vol * 0.5, a: 0.004, detune: d, out: lp });
  for (const f of o.extra ?? []) c.g.tone({ type: 'sawtooth', f: f * c.p, t, dur: o.dur, vol: o.vol * 0.3, a: 0.004, out: lp });
}

/** a synth pluck: saw through a low-pass that tracks the pitch and closes fast, a sine under it */
function pluck(c: SfxCtx, f: number, dur: number, vol: number, at = 0, bright = 4): void {
  const t = c.t + at;
  const open = Math.min(3200, f * bright);
  const lp = c.g.filter('lowpass', open, 2, c.out);
  lp.frequency.setValueAtTime(open, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.2), t + dur * 0.6);
  c.g.tone({ type: 'sawtooth', f, t, dur, vol: vol * 0.6, a: 0.002, out: lp });
  c.g.tone({ f, t, dur: dur * 0.8, vol: vol * 0.5, a: 0.002, out: c.out });
}

/**
 * The air horn played on the chord: brass saws with a pitch scoop into each blast and a fall at
 * the end, low-passed so it reads as a horn section and never blares.
 */
function horn(c: SfxCtx, hits: Array<[at: number, len: number]>, vol: number): void {
  const g = c.g;
  const t = c.t;
  const [la, ll] = hits[hits.length - 1];
  const end = t + la + ll;
  const lp = g.filter('lowpass', 900, 1.3, c.out);
  const amp = g.gain(0, lp);
  const r = chordHz(c.h, 0, 4);
  const notes = [r, r, chordHz(c.h, 2, 3)];
  const oscs = notes.map((f, i) => osc(c, 'sawtooth', f * c.p, t, end, amp, [-9, 8, 3][i]));
  for (const [at, len] of hits) {
    const a = t + at;
    amp.gain.setValueAtTime(0.0001, a);
    amp.gain.exponentialRampToValueAtTime(vol, a + 0.014);
    amp.gain.setValueAtTime(vol, a + len - 0.035);
    amp.gain.linearRampToValueAtTime(0, a + len);
    lp.frequency.setValueAtTime(800, a);
    lp.frequency.exponentialRampToValueAtTime(2300, a + 0.03);
    lp.frequency.exponentialRampToValueAtTime(1300, a + len);
    oscs.forEach((o, i) => {
      const f = notes[i] * c.p;
      o.frequency.setValueAtTime(f * semi(-0.8), a);
      o.frequency.exponentialRampToValueAtTime(f, a + 0.04);
    });
  }
  // the last blast falls off like a brass stab
  oscs.forEach((o, i) => {
    const f = notes[i] * c.p;
    o.frequency.setValueAtTime(f, end - 0.14);
    o.frequency.exponentialRampToValueAtTime(f * semi(-2), end);
  });
}

const num = (c: SfxCtx, key: string, def: number) => {
  const v = Number(c.arg?.[key]);
  return Number.isFinite(v) ? v : def;
};

/** the same play through a gain: headroom for the dense recipes (trims.ts sets the real level) */
const quieter = (c: SfxCtx, k: number): SfxCtx => ({ ...c, out: c.g.gain(k, c.out) });

// -----------------------------------------------------------------------------------------------
// the kit
// -----------------------------------------------------------------------------------------------

export const REX: Record<string, SfxDef> = {
  // Beat Shot (7 per second): one muted drum-machine hit per bullet. The body walks a bassline
  // on the chord (root, fifth, third, fifth) while the trigger is held, so a burst is a groove,
  // not a machine gun; a shot that lands on the score's kick (arg on) is a fuller kick on the
  // root. Energy sits at 150 Hz-1.5 kHz; no sub, no hiss.
  'rex.shot': {
    cat: 'basic',
    lvl: -4,
    dur: 0.12,
    max: 4,
    vary: 0.03,
    combo: 0.3,
    fn: (c) => {
      const on = !!c.arg?.on;
      const deg = on ? 0 : [0, 2, 1, 2][c.step % 4];
      const f = chordHz(c.h, deg, 3);
      const lv = rr(c, 0.84, 1.08) * (on ? 1.2 : 1);
      // the drum: a tight 808 tom on the chord tone, falling an octave in ~20 ms
      thump(c, { f0: f * 2, f1: f, dur: on ? 0.12 : 0.085, vol: 0.5 * lv });
      // the machine's tone: a muted saw an octave up, filter snapping shut
      tok(c, f * 2, { dur: 0.05, vol: 0.32 * lv, open: 2000, shut: 400 });
      // the snap: a short muted rim, band-passed pink (narrow, so it stays under 2 kHz)
      smack(c, { f: 1100, q: 2.2, dur: 0.028, vol: (deg === 1 ? 3.4 : 2.8) * rr(c, 0.85, 1.1), drop: 0.7 });
    },
  },
  // Lead Single, the trigger (local player only, 0.1 s before the slug): the stock settles
  'rex.load': {
    cat: 'confirm',
    lvl: -6,
    dur: 0.12,
    max: 1,
    fn: (c) => {
      smack(c, { f: 1500, q: 3, dur: 0.01, vol: rr(c, 0.8, 1.1), drop: 0.9 });
      thump(c, { f0: 260, f1: 170, dur: 0.05, vol: 0.4 * rr(c, 0.8, 1.05), at: 0.004 });
      swell(c, 0.09, 500, 1600, 0.3, 'pink', 0.004);
    },
  },
  // Lead Single: the boom-clap. A long 808 kick, a clap a flam behind it, an 808 bass tail that
  // drops a tone, and the bolt cycling after the shot
  'rex.slug': {
    cat: 'skill',
    lvl: 1,
    dur: 0.7,
    max: 2,
    duck: 2,
    fn: (c0) => {
      const c = quieter(c0, 0.6);
      const r = chordHz(c.h, 0, 3);
      thump(c, { f0: r * 2.6, f1: r * 0.85, dur: 0.24, vol: rr(c, 0.88, 1.05) });
      click(c, { f: 1800, dur: 0.004, vol: 0.1 });
      clap(c, 4 * rr(c, 0.85, 1.1), 0.012, 1150, 0.16);
      thump(c, { f0: chordHz(c.h, 2, 3) * 1.15, f1: chordHz(c.h, 2, 3), dur: 0.1, vol: 0.3, at: 0.012, type: 'triangle' });
      bass(c, { f: r, dur: 0.5, vol: 0.4, at: 0.02, to: semi(-2), cutoff: 900 });
      clack(c, 0.45, 0.17, 1700);
    },
  },
  // Bass Charge, the brace: feet planted, the rifle locks into the shoulder, the cannon spins up
  'rex.charge': {
    cat: 'skill',
    lvl: -3,
    dur: 0.3,
    max: 2,
    fn: (c) => {
      clack(c, 0.8, 0, 1500);
      thump(c, { f0: chordHz(c.h, 0, 3) * 1.4, f1: chordHz(c.h, 0, 3) * 0.9, dur: 0.16, vol: 0.5 * rr(c, 0.85, 1.05) });
    },
  },
  // Bass Charge, held: one grain per ~0.1 s while the trigger is down (arg k = charge 0..1,
  // s = state: 0 building / held, 1 perfect window, 2 overcharged). Each grain is one "wub" of
  // the wobble: the pitch climbs from the low root to the fifth and the filter opens wider; in
  // the perfect window the wobble stops dead on the chord; overcharged it detunes, droops and
  // distorts.
  'rex.chargeHold': {
    cat: 'skill',
    lvl: -4,
    dur: 0.1,
    max: 6,
    gap: 0.1,
    vary: 0.004,
    fn: (c0) => {
      const c = quieter(c0, 0.45);
      const k = clamp01(num(c, 'k', 1));
      const s = num(c, 's', 0);
      const t = c.t;
      const len = 0.24;
      const r2 = chordHz(c.h, 0, 2);
      if (s === 1) {
        // the perfect window: dead still, the chord (root, fifth, octave) with the filter open
        const lp = c.g.filter('lowpass', 2200, 0.9, c.out);
        const amp = c.g.gain(0, lp);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(0.32, t + 0.06);
        amp.gain.setValueAtTime(0.32, t + len - 0.08);
        amp.gain.linearRampToValueAtTime(0, t + len);
        const r3 = r2 * 2;
        [r3, chordHz(c.h, 2, 3), r3 * 2].forEach((f, i) => osc(c, 'sawtooth', f, t, t + len, amp, [-5, 4, 6][i]));
        return;
      }
      const over = s === 2;
      // the climb: root (octave 2) up to the fifth an octave above, the tension the perfect
      // release resolves
      const span = Math.log2(3);
      const f0 = r2 * Math.pow(2, span * k);
      const f1 = over ? f0 * 0.93 : r2 * Math.pow(2, span * Math.min(1, k + len / 0.95));
      // the wub: the low-pass opens and shuts once per grain, wider as the charge builds
      const peak = lerp(480, 1900, k) * (over ? 0.5 : 1);
      const dst = over ? c.g.drive(4, c.g.gain(0.45, c.out)) : c.out;
      // the high-pass thins the fundamental (the ear still hears the pitch from its harmonics)
      const lp = c.g.filter('lowpass', 260, lerp(4, 7, k), c.g.filter('highpass', 150, 0.7, dst));
      lp.frequency.setValueAtTime(260, t);
      lp.frequency.exponentialRampToValueAtTime(peak, t + len * 0.42);
      lp.frequency.exponentialRampToValueAtTime(260, t + len);
      const amp = c.g.gain(0, lp);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime((0.22 + 0.28 * k) * rr(c, 0.9, 1.05), t + len * 0.35);
      amp.gain.linearRampToValueAtTime(0, t + len);
      const det = over ? 45 : 7;
      for (const d of [-det, det]) {
        const o = osc(c, 'sawtooth', f0, t, t + len, amp, d);
        o.frequency.exponentialRampToValueAtTime(f1, t + len);
      }
    },
  },
  // Bass Charge, the perfect window opens (the local player's timing cue, 2D): a rim click and
  // the chord plucked once
  'rex.chargeFull': {
    cat: 'confirm',
    lvl: 2,
    dur: 0.3,
    max: 1,
    fn: (c) => {
      mallet(c, chordHz(c.h, 0, 5), 0.18, 0.4 * rr(c, 0.9, 1.05));
      mallet(c, chordHz(c.h, 2, 5), 0.2, 0.3, 0.004);
      tok(c, chordHz(c.h, 0, 4), { dur: 0.12, vol: 0.2, open: 2800, shut: 600 });
      smack(c, { f: 1700, q: 3, dur: 0.012, vol: 0.7, drop: 0.9 });
    },
  },
  // Bass Charge, the release: a bass laser "WUB" (arg k = charge, 1.4 = perfect; over =
  // overcharge 0..1). The note falls from two octaves up onto the root and the filter shuts
  // slowly; a perfect release resolves on the chord, an overcharged one comes out detuned and dirty
  'rex.release': {
    cat: 'skill',
    lvl: 3,
    dur: 0.8,
    max: 2,
    duck: 2,
    fn: (c0) => {
      const c = quieter(c0, 0.5);
      const k = Math.max(0.15, num(c, 'k', 1));
      const over = clamp01(num(c, 'over', 0));
      const perfect = k > 1.2;
      const kk = Math.min(1, k);
      const r = chordHz(c.h, 0, 2);
      const len = (0.28 + 0.3 * kk) * (perfect ? 1.25 : 1);
      const t = c.t;
      const dst = over > 0 ? c.g.drive(1.5 + 2 * over, c.g.gain(0.6, c.out)) : c.out;
      const lp = c.g.filter('lowpass', 1000, 4.5, c.g.filter('highpass', 130, 0.7, dst));
      lp.frequency.setValueAtTime(lerp(900, 2000, kk), t);
      lp.frequency.exponentialRampToValueAtTime(lerp(1400, 3000, kk) * (1 - 0.45 * over), t + 0.03);
      lp.frequency.exponentialRampToValueAtTime(lerp(500, 700, kk), t + len * 0.45);
      lp.frequency.exponentialRampToValueAtTime(130, t + len);
      const det = 6 + 42 * over;
      const fall = 1 - 0.06 * over;
      const lv = rr(c, 0.88, 1.05);
      for (const d of [-det, det]) c.g.tone({ type: 'sawtooth', f: r * 4 * c.p, f1: r * fall * c.p, tau: 0.018, t, dur: len, vol: 0.42 * lv, a: 0.003, detune: d, out: lp });
      // the punch
      thump(c, { f0: 230, f1: 110, dur: 0.14 + 0.06 * kk, vol: 0.55 + 0.25 * kk });
      smack(c, { f: 900, q: 1, dur: 0.035, vol: 0.9, drop: 0.5 });
      if (perfect) {
        // the chord: fifth and octave join the bass, a mallet on top
        for (const f of [chordHz(c.h, 2, 2), chordHz(c.h, 0, 3)]) c.g.tone({ type: 'sawtooth', f: f * 2 * c.p, f1: f * c.p, tau: 0.018, t, dur: len, vol: 0.22, a: 0.003, out: lp });
        mallet(c, chordHz(c.h, 1, 5), 0.5, 0.18, 0.02);
        mallet(c, chordHz(c.h, 0, 5), 0.6, 0.14, 0.05);
      }
    },
  },
  // Sub Bomb, the throw: the pin, the lever's clack, an underarm lob, the bomb arming
  'rex.throw': {
    cat: 'skill',
    lvl: -4,
    dur: 0.4,
    max: 2,
    fn: (c) => {
      ring(c, { f: rr(c, 1800, 2000), decay: 0.06, vol: 0.06, bright: 0.2, ratios: [1, 1.5] });
      clack(c, 0.9, 0, 1600);
      whoosh(c, { f0: 350, f1: 1300, f2: 450, dur: 0.28, q: 1.3, vol: 0.8, peak: 0.35, at: 0.03, edge: 0.2 });
      c.g.tone({ type: 'triangle', f: chordHz(c.h, 0, 3), f1: chordHz(c.h, 0, 4), glide: 0.16, t: c.t + 0.05, dur: 0.2, vol: 0.12, a: 0.01, out: c.out, vib: [40, 18] });
    },
  },
  // Sub Bomb, the detonation: a bass drop. A short sub on the root, a mid body, the bass falling
  // an octave through a closing filter, a little dust
  'rex.bomb': {
    cat: 'big',
    lvl: -2,
    dur: 1.1,
    max: 2,
    duck: 2.5,
    rev: 1.1,
    fn: (c0) => {
      const c = quieter(c0, 0.5);
      const r2 = chordHz(c.h, 0, 2);
      sub(c, r2 * c.p, r2 * 0.6, 0.32, 0.45);
      thump(c, { f0: 250, f1: 105, dur: 0.22, vol: 0.75 * rr(c, 0.85, 1.05) });
      smack(c, { f: 1000, q: 0.9, dur: 0.05, vol: 2.6, drop: 0.5 });
      click(c, { f: 2200, dur: 0.005, vol: 0.25 });
      bass(c, { f: chordHz(c.h, 0, 3), to: 0.5, dur: 0.6, vol: 0.4, cutoff: 1400, at: 0.01 });
      crunch(c, { f: 1000, f1: 150, dur: 0.35, vol: 0.8 });
    },
  },
  // Drop The Beat, the cast: the air horn on the chord (bwap-bwap-bwaaap) over a kick; enemies
  // also get a low detuned brass "braam" under it
  'rex.ult': {
    cat: 'ult',
    dur: 1.2,
    max: 2,
    duck: 4,
    rev: 1.2,
    fn: (c0) => {
      const c = quieter(c0, 0.35);
      horn(c, [[0, 0.09], [0.12, 0.09], [0.24, 0.32]], 0.32 * rr(c, 0.9, 1.05));
      thump(c, { f0: 170, f1: 70, dur: 0.25, vol: 0.6 * rr(c, 0.8, 1.05) });
      click(c, { f: 2000, dur: 0.004, vol: 0.08 });
      if (!c.self) {
        const r = chordHz(c.h, 0, 2);
        const lp = c.g.filter('lowpass', 600, 1, c.out);
        for (const f of [r, r * semi(1)]) c.g.tone({ type: 'sawtooth', f, t: c.t + 0.2, dur: 0.9, vol: 0.12, a: 0.08, out: lp });
      }
    },
  },
  // Drop The Beat, notes 1-11 (arg i = 0..10): a bright synth pluck stepping up the chord from
  // the low end, one every 90 ms: the build before the drop
  'rex.note': {
    cat: 'skill',
    lvl: -4,
    dur: 0.18,
    max: 4,
    vary: 0.003,
    fn: (c) => {
      const i = Math.max(0, Math.min(10, Math.round(num(c, 'i', 4))));
      const f = chordHz(c.h, i, 3);
      pluck(c, f, 0.18, 0.5 * rr(c, 0.85, 1.05), 0, lerp(5, 3, i / 10));
      click(c, { f: 1600, dur: 0.003, vol: 0.05 });
    },
  },
  // Drop The Beat, the 12th note: the drop. The arpeggio lands on the root over a kick with
  // sub, a clap and a bass stab on the chord
  'rex.drop': {
    cat: 'ult',
    lvl: -1,
    dur: 1.1,
    max: 2,
    duck: 4,
    rev: 1.1,
    fn: (c0) => {
      const c = quieter(c0, 0.5);
      const r2 = chordHz(c.h, 0, 2);
      sub(c, r2 * 1.5, r2 * 0.7, 0.4, 0.5);
      thump(c, { f0: 260, f1: 95, dur: 0.26, vol: 0.85 * rr(c, 0.88, 1.05) });
      clap(c, 3.5 * rr(c, 0.88, 1.05), 0.01, 1100, 0.18);
      bass(c, { f: r2 * 2, dur: 0.6, vol: 0.45, cutoff: 1700, at: 0.005, extra: [chordHz(c.h, 2, 3)] });
      pluck(c, chordHz(c.h, 0, 5), 0.35, 0.35, 0, 3);
    },
  },
};
