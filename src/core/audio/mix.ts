/**
 * The SFX mix as data.
 *
 * Every sound is loudness-normalised to REF_LUFS (momentary, at the listener, before any of the
 * numbers below): `trims.ts` holds the measured corrections and `tools/audio/mix_trims.mjs`
 * rebuilds it after a sound changes. With that in place the mix is this table: a category level
 * moves every sound in it together, a sound's own `lvl` only expresses its rank inside the
 * category.
 *
 * Categories follow a competitive game's priorities: what the player must react to (ultimates,
 * big impacts, ability casts aimed at them) sits on top, their own confirms are quiet but always
 * audible (2D, never attenuated), traversal and foley sit underneath so ten fighters grappling
 * around never turn into a wall of noise.
 */

export type Cat = 'ult' | 'big' | 'skill' | 'impact' | 'basic' | 'move' | 'foley' | 'confirm' | 'hurt' | 'ui';

export interface CatSpec {
  /** level, dB relative to the normalised reference */
  db: number;
  /** full level up to `near` metres, inverse-distance roll-off after it, silent at `far` */
  near: number;
  far: number;
  /** simultaneous voices in the category before the quietest one is dropped */
  voices: number;
  /** category bus EQ: high-pass (keeps sub energy for the few events that earn it) and low-pass */
  hp: number;
  lp: number;
  /** presence: a gentle peak at 3 kHz on the bus, dB (definition without per-sound hiss) */
  presence?: number;
  /** 2D: no distance, pan or room (own confirms, UI) */
  ui?: boolean;
  /** room send multiplier */
  rev: number;
}

/** momentary loudness (LUFS-M, BS.1770) every sound is normalised to at 0 m */
export const REF_LUFS = -19;

export const CATS: Record<Cat, CatSpec> = {
  // ultimates and their threat cues: heard across the arena
  ult: { db: 0, near: 10, far: 110, voices: 4, hp: 35, lp: 16000, rev: 1.1 },
  // explosions, slams, finishers
  big: { db: -2, near: 8, far: 85, voices: 5, hp: 40, lp: 15000, rev: 1 },
  // ability casts (signature, secondary, special)
  skill: { db: -5, near: 6, far: 60, voices: 8, hp: 70, lp: 14000, rev: 0.9 },
  // a hit landing on a body
  impact: { db: -8, near: 5, far: 50, voices: 6, hp: 70, lp: 12000, rev: 0.6 },
  // basic attacks: swings, shots, orbs (the most frequent combat sounds)
  basic: { db: -11, near: 5, far: 45, voices: 8, hp: 90, lp: 12000, rev: 0.7 },
  // traversal: hooks, gas, dashes, jumps, landings
  move: { db: -14, near: 4, far: 35, voices: 8, hp: 90, lp: 11000, rev: 0.6 },
  // footsteps and small body foley
  foley: { db: -21, near: 3, far: 22, voices: 6, hp: 120, lp: 10000, rev: 0.35 },
  // own hit confirms, kill confirms, medals (2D, dry)
  confirm: { db: -12, near: 0, far: 0, voices: 4, hp: 200, lp: 9000, ui: true, rev: 0 },
  // the local player getting hit (2D)
  hurt: { db: -12, near: 0, far: 0, voices: 2, hp: 50, lp: 6000, ui: true, rev: 0 },
  // menus
  ui: { db: -15, near: 0, far: 0, voices: 3, hp: 200, lp: 10000, ui: true, rev: 0 },
};

/** full level up to `near`, then -6 dB per doubling of distance, faded out over the last 30 % */
export function distanceGain(d: number, near: number, far: number): number {
  if (d <= near) return 1;
  if (d >= far) return 0;
  const inv = near / d;
  const x = (far - d) / (far * 0.3);
  const fade = x >= 1 ? 1 : x * x * (3 - 2 * x);
  return inv * fade;
}

/**
 * Volume slider (0..1) to gain. Ears hear level in dB, so the slider walks a dB scale: its top
 * half covers the useful -12..0 dB, the bottom half fades out, and 0 is silence.
 */
export const SLIDER_RANGE_DB = 40;
export function sliderGain(s: number): number {
  if (s <= 0.001) return 0;
  const db = (Math.min(1, s) - 1) * SLIDER_RANGE_DB;
  // a short linear tail below 5 % so the last steps reach true silence smoothly
  const tail = Math.min(1, s / 0.05);
  return Math.pow(10, db / 20) * tail;
}

/** shipped defaults (the mix above is balanced for these) */
export const DEFAULT_VOLUMES = { master: 1, music: 0.85, sfx: 1 };

export const dbToGain = (db: number) => Math.pow(10, db / 20);
