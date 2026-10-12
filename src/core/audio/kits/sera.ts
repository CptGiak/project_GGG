/**
 * SERA, "ENCORE": a pop idol whose mic-scepter turns her voice into the weapon.
 *
 * Timbre family: sung vowels ("ah", "oh", "oo") on the score's chord, harmonies that stack into
 * the chord as her moves grow, soft sine chimes and sparkles no higher than octave 6, and a light
 * reverb feel (generous room sends). Her voice is a saw ensemble through a low-pass and series
 * formant peaks, so it keeps its pitch, stays under ~3 kHz and costs a handful of nodes; no
 * noise anywhere except a breath and the air of her blasts.
 */
import { chordHz, clamp01, lerp, rr, semi, smack, sparkle, sub, swell, thump, whoosh, type SfxCtx, type SfxDef } from '../layers';

// -----------------------------------------------------------------------------------------------
// her voice
// -----------------------------------------------------------------------------------------------

type Formants = Array<[hz: number, q: number, db: number]>;
type Vowel = 'a' | 'o' | 'u';

/** soprano formant peaks: 'a' open, 'o' round, 'u' dark (the third formant kept low) */
const VOWELS: Record<Vowel, Formants> = {
  a: [[800, 2.5, 12], [1150, 3.5, 9], [2900, 5, 2]],
  o: [[450, 2.5, 12], [800, 3.5, 9], [2830, 5, 0]],
  u: [[325, 2.5, 11], [700, 3.5, 6], [2530, 5, -2]],
};

/** a vowel between two others (k = 0..1): her voice opening as a move grows */
function blend(a: Vowel, b: Vowel, k: number): Formants {
  return VOWELS[a].map(([f, q, db], i) => [f * Math.pow(VOWELS[b][i][0] / f, k), lerp(q, VOWELS[b][i][1], k), lerp(db, VOWELS[b][i][2], k)]);
}

interface Sing {
  /** one voice per note (Hz) */
  notes: number[];
  dur: number;
  vol: number;
  at?: number;
  /** attack (s) */
  a?: number;
  /** release (s): hold, then a linear fade (grains, swells); without it the note decays away */
  rel?: number;
  /** exponential (in dB) attack: a crescendo rather than a fade-in */
  swell?: boolean;
  vowel?: Vowel | Formants;
  /** vowel at the end of the note */
  to?: Vowel;
  /** pitch ratio reached at the end */
  bend?: number;
  /** start this ratio off the note and slide onto it (a sung scoop) */
  scoop?: number;
  vib?: [cents: number, hz: number];
  /** brightness cap */
  lp?: number;
  /** per-voice levels (adds a gain per voice) */
  levels?: number[];
  out?: AudioNode;
}

/** Sera sings: saws (a few cents apart) -> envelope -> low-pass -> three formant peaks */
function sing(c: SfxCtx, o: Sing): void {
  const g = c.g;
  const t = c.t + (o.at ?? 0);
  const end = t + o.dur;
  const fm: Formants = typeof o.vowel === 'object' ? o.vowel : VOWELS[o.vowel ?? 'a'];
  let dst: AudioNode = o.out ?? c.out;
  // series peaks, last to first
  const peaks: BiquadFilterNode[] = [];
  for (let i = fm.length - 1; i >= 0; i--) {
    const [f, q, db] = fm[i];
    const pk = g.filter('peaking', f, q, dst, db);
    peaks.unshift(pk);
    dst = pk;
  }
  if (o.to) {
    VOWELS[o.to].forEach(([f, , db], i) => {
      peaks[i].frequency.setValueAtTime(fm[i][0], t);
      peaks[i].frequency.exponentialRampToValueAtTime(f, t + o.dur * 0.8);
      peaks[i].gain.setValueAtTime(fm[i][2], t);
      peaks[i].gain.linearRampToValueAtTime(db, t + o.dur * 0.8);
    });
  }
  const env = g.gain(0, g.filter('lowpass', o.lp ?? 2600, 0.7, dst));
  // the formant peaks add up to +12 dB: the voice keeps its own headroom
  const vol = o.vol * 0.3;
  const a = o.a ?? 0.02;
  const p = env.gain;
  if (o.rel !== undefined) {
    p.setValueAtTime(o.swell ? 0.0005 : 0, t);
    if (o.swell) p.exponentialRampToValueAtTime(vol, t + a);
    else p.linearRampToValueAtTime(vol, t + a);
    p.setValueAtTime(vol, Math.max(t + a, end - o.rel));
    p.linearRampToValueAtTime(0, end);
  } else {
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(vol, t + a);
    p.exponentialRampToValueAtTime(0.0001, end);
  }
  let depth: GainNode | null = null;
  if (o.vib) {
    const lfo = g.ctx.createOscillator();
    lfo.frequency.value = o.vib[1] * rr(c, 0.94, 1.06);
    depth = g.gain(0);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(o.vib[0], t + Math.min(0.25, o.dur * 0.5));
    lfo.connect(depth);
    lfo.start(t);
    lfo.stop(end + 0.05);
  }
  o.notes.forEach((f0, i) => {
    const s = g.ctx.createOscillator();
    s.type = 'sawtooth';
    const f = f0 * c.p;
    s.frequency.setValueAtTime(f * (o.scoop ?? 1), t);
    if (o.scoop) s.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.06, o.dur * 0.4));
    if (o.bend) s.frequency.exponentialRampToValueAtTime(f * o.bend, end);
    s.detune.value = rr(c, -6, 6);
    if (depth) depth.connect(s.detune);
    if (o.levels) s.connect(g.gain(o.levels[i] ?? 1, env));
    else s.connect(env);
    s.start(t);
    s.stop(end + 0.05);
  });
}

/** the same play through a gain: headroom for the dense recipes (trims.ts sets the real level) */
const quieter = (c: SfxCtx, k: number): SfxCtx => ({ ...c, out: c.g.gain(k, c.out) });

/** a soft chime: a sine and a faint octave, struck */
function chime(c: SfxCtx, f: number, dur: number, vol: number, at = 0): void {
  c.g.tone({ f, t: c.t + at, dur, vol, a: 0.003, out: c.out });
  c.g.tone({ f: f * 2.002, t: c.t + at, dur: dur * 0.5, vol: vol * 0.2, a: 0.002, out: c.out });
}

/** a node feeding both the voice bus and a short slap echo (broken after `until`) */
function withEcho(c: SfxCtx, time: number, fb: number, wet: number, until: number): AudioNode {
  const both = c.g.gain(1, c.out);
  both.connect(c.g.echo(time, fb, wet, c.out, 2400, c.t + until));
  return both;
}

// -----------------------------------------------------------------------------------------------
// the kit
// -----------------------------------------------------------------------------------------------

export const SERA: Record<string, SfxDef> = {
  // Note Orb (her basic attack, ~2.6 per second): a short sung "ah"/"oo" that walks the chord
  // (fifth, root, third, root) while she keeps firing, a chime an octave above, a soft "p" of air
  'sera.orb': {
    cat: 'basic',
    lvl: -1,
    dur: 0.25,
    max: 4,
    vary: 0.006,
    combo: 0.8,
    rev: 1.3,
    fn: (c) => {
      const deg = [2, 3, 4, 3][c.step % 4];
      const f = chordHz(c.h, deg, 4);
      const lv = rr(c, 0.85, 1.05);
      sing(c, { notes: [f], dur: 0.16, vol: 0.5 * lv, a: 0.012, vowel: c.step % 2 ? 'u' : 'a', scoop: semi(-1), lp: 1900 });
      chime(c, f * 2, 0.22, 0.07 * lv, 0.008);
      smack(c, { f: 1000, q: 1.2, dur: 0.02, vol: 0.5, drop: 0.7 });
    },
  },
  // High Note, the lob: "oooh" sung up an octave as the note leaves the scepter, the air it rides
  'sera.lob': {
    cat: 'skill',
    lvl: -2,
    dur: 0.55,
    max: 2,
    rev: 1.4,
    fn: (c) => {
      sing(c, { notes: [chordHz(c.h, 0, 4), chordHz(c.h, 2, 4)], dur: 0.45, vol: 0.45 * rr(c, 0.88, 1.05), a: 0.04, vowel: 'u', to: 'o', bend: 2, vib: [18, 6] });
      whoosh(c, { f0: 400, f1: 1400, f2: 900, dur: 0.35, q: 1.2, vol: 0.5, peak: 0.6, at: 0.05, edge: 0.2 });
      sparkle(c, 0.3, 3, 0.03, 5, 0.15);
    },
  },
  // High Note, the burst (the projectile's boom): the note blooms into a sung chord, "oh" opening
  // to "ah" on root, third and fifth, over a soft round pop
  'sera.noteBurst': {
    cat: 'skill',
    lvl: 1,
    dur: 0.9,
    max: 2,
    rev: 1.5,
    fn: (c) => {
      const lv = rr(c, 0.88, 1.05);
      sing(c, { notes: [chordHz(c.h, 0, 4), chordHz(c.h, 1, 4), chordHz(c.h, 2, 4)], dur: 0.75, vol: 0.5 * lv, a: 0.03, vowel: 'o', to: 'a', vib: [14, 5.5] });
      thump(c, { f0: 300, f1: 150, dur: 0.12, vol: 0.55 * lv });
      smack(c, { f: 900, q: 0.9, dur: 0.06, vol: 0.8, drop: 0.5 });
      chime(c, chordHz(c.h, 2, 5), 0.5, 0.06, 0.01);
      sparkle(c, 0.35, 3, 0.025, 5, 0.04);
    },
  },
  // Resonance, the cast: a breath in and the first touch of the note
  'sera.beamStart': {
    cat: 'skill',
    lvl: -3,
    dur: 0.3,
    max: 2,
    rev: 1.3,
    fn: (c) => {
      swell(c, 0.08, 600, 2200, 0.25);
      sing(c, { notes: [chordHz(c.h, 2, 4)], dur: 0.22, vol: 0.4, a: 0.04, at: 0.06, vowel: 'u', scoop: semi(-2) });
      chime(c, chordHz(c.h, 2, 5), 0.25, 0.05, 0.06);
    },
  },
  // Resonance, the beam: a sustained sung note built from overlapping grains (one per ~0.1 s;
  // the kit's volume 0.35..0.65 is the CRESCENDO). As it builds the vowel opens from "oo" to
  // "ah" and the chord's third fades in above the note; 3-4 grains always overlap and crossfade,
  // so it reads as one voice (no level dip at the grain rate)
  'sera.beam': {
    cat: 'skill',
    dur: 0.1,
    max: 6,
    gap: 0.085,
    vary: 0.003,
    rev: 1.3,
    fn: (c) => {
      const k = clamp01(c.arg?.k !== undefined ? Number(c.arg.k) : (c.v - 0.35) / 0.3);
      const f = chordHz(c.h, 2, 4);
      sing(c, { notes: [f, chordHz(c.h, 4, 4)], levels: [1, 0.15 + 0.6 * k], dur: 0.34, vol: lerp(0.6, 0.45, k), a: 0.14, rel: 0.16, vowel: blend('u', 'a', k), vib: [12, 5.2], lp: lerp(1400, 1900, k) });
    },
  },
  // Resonance at full crescendo: the harmony locks into the whole chord, a chime on top
  'sera.beamMax': {
    cat: 'skill',
    lvl: -1,
    dur: 0.6,
    max: 2,
    rev: 1.4,
    fn: (c) => {
      sing(c, { notes: [chordHz(c.h, 0, 5), chordHz(c.h, 1, 5), chordHz(c.h, 2, 5)], dur: 0.45, vol: 0.4, a: 0.02, vowel: 'a' });
      chime(c, chordHz(c.h, 0, 6), 0.4, 0.05, 0.01);
      sparkle(c, 0.3, 4, 0.03, 5, 0.03);
    },
  },
  // Echo Wave: a shouted "HA!" chord with a slap echo, and the blast of air that rolls out
  'sera.wave': {
    cat: 'skill',
    lvl: 2,
    dur: 0.8,
    max: 2,
    rev: 1.2,
    fn: (c0) => {
      const c = quieter(c0, 0.6);
      const lv = rr(c, 0.88, 1.05);
      const out = withEcho(c, 0.13, 0.28, 0.45, 0.6);
      sing(c, { notes: [chordHz(c.h, 0, 4), chordHz(c.h, 2, 4), chordHz(c.h, 0, 5)], dur: 0.24, vol: 0.6 * lv, a: 0.008, vowel: 'a', bend: semi(-2), out });
      whoosh(c, { f0: 300, f1: 1100, f2: 350, dur: 0.45, q: 1, vol: 1, peak: 0.18, edge: 0.25 });
      thump(c, { f0: 190, f1: 80, dur: 0.2, vol: 0.6 * lv });
    },
  },
  // Grand Finale, the cast: the choir breathes in and swells toward the spotlight (it lands with
  // the pillar ~1.05 s later); enemies also hear a dark low cluster under it
  'sera.ult': {
    cat: 'ult',
    dur: 1.2,
    max: 2,
    duck: 3,
    rev: 1.4,
    fn: (c) => {
      const notes = [chordHz(c.h, 0, 4), chordHz(c.h, 2, 4), chordHz(c.h, 1, 5)];
      const levels = [1, 1, 0.8];
      if (!c.self) {
        // the threat: a low minor-second cluster the choir swells over
        const r = chordHz(c.h, 0, 3);
        notes.push(r, r * semi(1));
        levels.push(0.4, 0.32);
      }
      // ends ~70 ms before the pillar: a breath of near silence before the hit
      sing(c, { notes, levels, dur: 0.98, vol: 0.45, a: 0.9, rel: 0.08, swell: true, vowel: 'u', to: 'a', vib: [20, 5] });
      swell(c, 0.94, 300, 2200, 0.45);
      sparkle(c, 0.9, 3, 0.025, 5, 0.12);
    },
  },
  // Grand Finale, the pillar: the full choir on the chord, a light-column shimmer, a sub under it
  'sera.pillar': {
    cat: 'ult',
    lvl: 1,
    dur: 1.8,
    max: 2,
    duck: 5,
    rev: 1.5,
    fn: (c0) => {
      const c = quieter(c0, 0.45);
      const lv = rr(c, 0.9, 1.05);
      sing(c, { notes: [chordHz(c.h, 0, 3), chordHz(c.h, 1, 4), chordHz(c.h, 2, 4), chordHz(c.h, 0, 5)], dur: 1.4, vol: 0.55 * lv, a: 0.015, vowel: 'a', vib: [16, 5.5] });
      sub(c, chordHz(c.h, 0, 2), chordHz(c.h, 0, 1), 0.6, 0.55 * lv);
      thump(c, { f0: 170, f1: 70, dur: 0.3, vol: 0.6 });
      smack(c, { f: 800, q: 0.8, dur: 0.08, vol: 1, drop: 0.5 });
      chime(c, chordHz(c.h, 0, 5), 1.1, 0.07, 0.01);
      sparkle(c, 0.6, 3, 0.025, 5, 0.05);
    },
  },
};
