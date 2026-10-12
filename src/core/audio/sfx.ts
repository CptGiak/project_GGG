/**
 * The SFX catalogue: shared sounds (movement, generic combat, confirms, UI) plus every champion's
 * ability sounds (kits/*.ts) and the per-material hit impacts (impacts.ts).
 *
 * Each entry names its mix category (mix.ts); its loudness is normalised by trims.ts, so a recipe
 * only has to sound right, not to be at the right level. Recipes are built from layers.ts.
 */
import { CONFIRM_SFX, IMPACT_SFX } from './impacts';
import { KIT_SFX } from './kits';
import {
  bell,
  blip,
  boom,
  chordHz,
  click,
  crunch,
  degHz,
  hiss,
  mallet,
  ring,
  rr,
  signature,
  smack,
  sparkle,
  stab,
  sub,
  surface,
  swell,
  thump,
  whoosh,
  zap,
  type SfxDef,
} from './layers';

export type { SfxCtx, SfxDef } from './layers';
export { chordHz, degHz } from './layers';

const SHARED: Record<string, SfxDef> = {
  // ---- movement ------------------------------------------------------------------------------
  // the grapple launcher: a pneumatic thunk, a gas spit and the cable paying out
  hookFire: {
    cat: 'move',
    dur: 0.3,
    max: 4,
    fn: (c) => {
      thump(c, { f0: 260, f1: 130, dur: 0.05, vol: 0.6 });
      smack(c, { f: 1100, q: 1.2, dur: 0.03, vol: 0.3, drop: 0.7 });
      hiss(c, { f: 1700, f1: 900, q: 0.9, dur: 0.07, vol: 0.12, a: 0.002 });
      hiss(c, { f: 900, f1: 2400, q: 4, dur: 0.2, vol: 0.13, a: 0.01, at: 0.02 });
    },
  },
  // the anchor bites: a clank, a short ring and the line snapping taut
  hookHit: {
    cat: 'move',
    dur: 0.3,
    max: 4,
    fn: (c) => {
      thump(c, { f0: 210, f1: 110, dur: 0.06, vol: 0.6 });
      ring(c, { f: rr(c, 850, 1000), decay: 0.1, vol: 0.045, bright: 0.3 });
      smack(c, { f: 1500, q: 1.6, dur: 0.02, vol: 0.2, drop: 0.8 });
      blip(c, { type: 'triangle', f: 220 * c.p, f1: 200, dur: 0.12, vol: 0.08, at: 0.015, out: c.g.filter('bandpass', 500, 2, c.out) });
    },
  },
  // out of gas: the trigger clicks dry
  hookDry: {
    cat: 'move',
    lvl: -4,
    dur: 0.2,
    max: 2,
    fn: (c) => {
      smack(c, { f: 1600, q: 4, dur: 0.01, vol: 0.4, drop: 0.9 });
      smack(c, { f: 1200, q: 4, dur: 0.012, vol: 0.32, at: 0.07, drop: 0.9 });
      hiss(c, { f: 1500, q: 1, dur: 0.1, vol: 0.06, a: 0.02, at: 0.02 });
    },
  },
  jump: {
    cat: 'foley',
    lvl: 4,
    dur: 0.2,
    max: 3,
    fn: (c) => {
      thump(c, { f0: 150, f1: 80, dur: 0.06, vol: 0.5 });
      hiss(c, { f: 700, f1: 400, q: 0.8, dur: 0.12, vol: 0.12, a: 0.01 });
      surface(c, 0.5);
    },
  },
  // gas air-jump: a round puff, not a hiss
  gasBurst: {
    cat: 'move',
    dur: 0.3,
    max: 3,
    fn: (c) => {
      thump(c, { f0: 170, f1: 70, dur: 0.1, vol: 0.55 });
      hiss(c, { f: 1300, f1: 800, q: 0.7, dur: 0.18, vol: 0.32, a: 0.004 });
      click(c, { f: 2200, dur: 0.006, vol: 0.08 });
    },
  },
  // the gas boost catches: a short ignition swell (the jet loop carries the rest)
  boostStart: {
    cat: 'move',
    lvl: -3,
    dur: 0.25,
    max: 2,
    fn: (c) => {
      hiss(c, { f: 800, f1: 1600, q: 0.8, dur: 0.2, vol: 0.3, a: 0.03 });
      thump(c, { f0: 120, f1: 70, dur: 0.12, vol: 0.3, a: 0.01 });
    },
  },
  // the anime "shun": a breath in, a zip, a soft kick, the champion's colour
  dash: {
    cat: 'move',
    lvl: 2,
    dur: 0.35,
    max: 3,
    fn: (c) => {
      swell(c, 0.05, 500, 1800, 0.15);
      whoosh(c, { f0: 400, f1: 2200, f2: 600, dur: 0.22, q: 1.4, vol: 0.45, peak: 0.25, at: 0.04 });
      thump(c, { f0: 150, f1: 60, dur: 0.1, vol: 0.35, at: 0.04 });
      signature(c, 'dash');
    },
  },
  wallkick: {
    cat: 'move',
    dur: 0.25,
    max: 2,
    fn: (c) => {
      thump(c, { f0: 160, f1: 70, dur: 0.1, vol: 0.55 });
      smack(c, { f: 1000, q: 1, dur: 0.05, vol: 0.25, drop: 0.6 });
      surface(c, 0.6);
    },
  },
  land: {
    cat: 'move',
    dur: 0.4,
    max: 3,
    fn: (c) => {
      const w = Math.min(1, c.v);
      thump(c, { f0: 120, f1: 50, dur: 0.12 + 0.12 * w, vol: 0.6 });
      crunch(c, { f: 1100, f1: 200, dur: 0.12 + 0.12 * w, vol: 0.25 });
      surface(c, 0.6 + 0.4 * w);
      if (w > 0.75) for (let i = 0; i < 4; i++) smack(c, { f: rr(c, 1200, 2600), q: 4, dur: 0.012, vol: 0.05, at: 0.04 + c.r() * 0.18, drop: 0.9 });
    },
  },
  footstep: {
    cat: 'foley',
    dur: 0.1,
    max: 2,
    vary: 0.08,
    fn: (c) => {
      thump(c, { f0: 95, f1: 60, dur: 0.05, vol: 0.3 });
      surface(c, 0.4);
    },
  },
  // a projectile bouncing off the world
  bounce: {
    cat: 'move',
    dur: 0.2,
    max: 3,
    fn: (c) => {
      thump(c, { f0: 300, f1: 180, dur: 0.04, vol: 0.4 });
      ring(c, { f: rr(c, 1000, 1200), decay: 0.07, vol: 0.04, bright: 0.3 });
    },
  },

  // ---- shared combat (every champion's casts and swings live in kits/) --------------------------
  explosion: {
    cat: 'big',
    dur: 2,
    max: 3,
    duck: 3,
    rev: 1.2,
    fn: (c) => boom(c, Math.min(1.2, c.v)),
  },
  teleport: {
    cat: 'skill',
    dur: 0.45,
    max: 3,
    fn: (c) => {
      swell(c, 0.08, 900, 4000, 0.18);
      zap(c, 300, 1800, 0.08, 0.06, 'triangle');
      smack(c, { f: 2600, q: 2.5, dur: 0.1, vol: 0.18, at: 0.09, drop: 0.35 });
      thump(c, { f0: 180, f1: 70, dur: 0.08, vol: 0.35, at: 0.09 });
      sparkle(c, 0.2, 3, 0.03, 6, 0.08);
      signature(c, 'dash');
    },
  },
  glitch: {
    cat: 'skill',
    lvl: -2,
    dur: 0.25,
    max: 2,
    fn: (c) => {
      const crush = c.g.crush(4, c.g.gain(0.22, c.g.filter('lowpass', 4000, 0.7, c.out)));
      for (let i = 0; i < 4; i++) c.g.tone({ type: 'square', f: rr(c, 500, 1200), f1: 220, t: c.t + i * 0.03, dur: 0.025, vol: 0.4, out: crush });
    },
  },
  // perfect guard: a bright clash on the chord (a highlight, allowed to ring)
  parry: {
    cat: 'big',
    lvl: -1,
    dur: 1,
    max: 2,
    duck: 3,
    rev: 1.3,
    fn: (c) => {
      ring(c, { f: chordHz(c.h, 0, 4), decay: 0.7, vol: 0.18, bright: 0.45 });
      bell(c, chordHz(c.h, 2, 5), 0.6, 0.12, 0.005, 1.2);
      thump(c, { f0: 140, f1: 55, dur: 0.25, vol: 0.6 });
      smack(c, { f: 1300, q: 1.4, dur: 0.05, vol: 0.3, drop: 0.6 });
      sparkle(c, 0.4, 5, 0.03, 6, 0.04);
    },
  },
  // perfect dodge: time catches its breath (reverse air, then a chord)
  dodge: {
    cat: 'skill',
    lvl: 2,
    dur: 0.6,
    max: 2,
    fn: (c) => {
      swell(c, 0.12, 600, 2400, 0.22);
      whoosh(c, { f0: 500, f1: 2400, f2: 900, dur: 0.3, q: 1.4, vol: 0.32, at: 0.08 });
      mallet(c, chordHz(c.h, 1, 5), 0.3, 0.2, 0.12);
      mallet(c, chordHz(c.h, 2, 5), 0.35, 0.16, 0.17);
    },
  },
  death: {
    cat: 'big',
    lvl: -3,
    dur: 1.2,
    max: 3,
    rev: 1.2,
    fn: (c) => {
      // the fighter breaks apart: a falling tone, crumble, a few dying chimes
      blip(c, { type: 'triangle', f: chordHz(c.h, 0, 5), f1: chordHz(c.h, 0, 3), glide: 0.7, dur: 0.75, vol: 0.18 });
      thump(c, { f0: 130, f1: 45, dur: 0.4, vol: 0.55 });
      crunch(c, { f: 1300, f1: 200, dur: 0.45, vol: 0.3 });
      for (let i = 0; i < 5; i++) mallet(c, chordHz(c.h, Math.floor(c.r() * 4), 5), 0.15, 0.05, 0.05 + i * rr(c, 0.05, 0.09));
    },
  },
  respawn: {
    cat: 'confirm',
    dur: 0.9,
    max: 2,
    fn: (c) => {
      swell(c, 0.3, 500, 2600, 0.12);
      blip(c, { f: chordHz(c.h, 0, 4), f1: chordHz(c.h, 0, 5), glide: 0.3, dur: 0.45, vol: 0.14, a: 0.05 });
      sparkle(c, 0.5, 6, 0.03, 6, 0.25);
    },
  },
  // the player's own ultimate card (2D)
  cutin: {
    cat: 'ult',
    lvl: -3,
    dur: 1.2,
    max: 2,
    duck: 4,
    fn: (c) => {
      swell(c, 0.18, 400, 3000, 0.28);
      stab(c, { notes: [chordHz(c.h, 0, 3), chordHz(c.h, 1, 3), chordHz(c.h, 2, 3), chordHz(c.h, 0, 4)], dur: 0.55, vol: 0.32, at: 0.18, cutoff: 1400, open: 3200 });
      thump(c, { f0: 110, f1: 45, dur: 0.35, vol: 0.6, at: 0.18 });
      sub(c, chordHz(c.h, 0, 1), chordHz(c.h, 0, 1) * 0.5, 0.5, 0.35, 0.18);
    },
  },
  // ---- player feedback (2D) ---------------------------------------------------------------------
  ultReady: {
    cat: 'confirm',
    lvl: 3,
    dur: 0.8,
    max: 1,
    fn: (c) => {
      [0, 1, 2, 3].forEach((i) => mallet(c, chordHz(c.h, i, 5), 0.4, 0.3, i * 0.07));
      bell(c, chordHz(c.h, 0, 6), 0.5, 0.12, 0.28, 1);
    },
  },
  ultTick: { cat: 'confirm', lvl: -8, dur: 0.1, max: 2, fn: (c) => mallet(c, chordHz(c.h, 2, 5), 0.06, 0.3) },
  // a timing window nailed (Rex's perfect release, Kaiser's riposte window, the spotlight beat)
  perfectTick: {
    cat: 'confirm',
    dur: 0.25,
    max: 2,
    fn: (c) => {
      bell(c, chordHz(c.h, 2, 5), 0.18, 0.35, 0, 1.2);
      mallet(c, chordHz(c.h, 0, 6), 0.1, 0.18, 0.03);
    },
  },
  // someone has a hook in you: urgent by rhythm, not by harshness
  alarm: {
    cat: 'confirm',
    lvl: 2,
    dur: 0.3,
    max: 1,
    fn: (c) => {
      for (const at of [0, 0.11]) {
        blip(c, { type: 'triangle', f: 988, dur: 0.07, vol: 0.4, at, out: c.g.filter('lowpass', 2500, 0.7, c.out) });
        blip(c, { type: 'triangle', f: 740, dur: 0.07, vol: 0.3, at: at + 0.005, out: c.g.filter('lowpass', 2500, 0.7, c.out) });
      }
    },
  },
  medal1: { cat: 'confirm', dur: 0.5, max: 1, fn: (c) => [0, 2].forEach((d, i) => mallet(c, chordHz(c.h, d, 5), 0.3, 0.35, i * 0.07)) },
  medal2: { cat: 'confirm', lvl: 1, dur: 0.6, max: 1, fn: (c) => [0, 1, 2].forEach((d, i) => mallet(c, chordHz(c.h, d, 5), 0.32, 0.33, i * 0.06)) },
  medal3: {
    cat: 'confirm',
    lvl: 3,
    dur: 0.9,
    max: 1,
    fn: (c) => {
      [0, 1, 2, 3].forEach((d, i) => mallet(c, chordHz(c.h, d, 5), 0.4, 0.3, i * 0.06));
      bell(c, chordHz(c.h, 0, 6), 0.6, 0.14, 0.24, 1.1);
      thump(c, { f0: 100, f1: 50, dur: 0.3, vol: 0.4 });
    },
  },
  // the champion's own taunt beats
  'taunt.plant': {
    cat: 'skill',
    lvl: -4,
    dur: 0.35,
    max: 2,
    fn: (c) => {
      thump(c, { f0: 150, f1: 60, dur: 0.18, vol: 0.6 });
      crunch(c, { f: 900, f1: 200, dur: 0.15, vol: 0.2 });
      surface(c, 0.6);
    },
  },
  'taunt.sparkle': {
    cat: 'skill',
    lvl: -4,
    dur: 0.6,
    max: 2,
    fn: (c) => {
      sparkle(c, 0.45, 7, 0.06, 6);
      mallet(c, chordHz(c.h, 0, 5), 0.4, 0.15);
    },
  },
  // spotlight mode: the light moves / the grand finale
  'spot.move': {
    cat: 'confirm',
    dur: 0.6,
    max: 1,
    fn: (c) => {
      for (const [i, at] of [[0, 0], [2, 0.12]] as const) mallet(c, chordHz(c.h, i, 5), 0.25, 0.32, at);
      swell(c, 0.2, 600, 2000, 0.08);
    },
  },
  'spot.finale': {
    cat: 'confirm',
    lvl: 3,
    dur: 1,
    max: 1,
    fn: (c) => {
      stab(c, { notes: [chordHz(c.h, 0, 3), chordHz(c.h, 1, 3), chordHz(c.h, 2, 3)], dur: 0.6, vol: 0.3, cutoff: 1600, open: 3400 });
      bell(c, chordHz(c.h, 0, 6), 0.7, 0.12, 0.05, 1);
      thump(c, { f0: 100, f1: 45, dur: 0.35, vol: 0.5 });
    },
  },

  // ---- menus (2D) -----------------------------------------------------------------------------
  uiMove: {
    cat: 'ui',
    lvl: -4,
    dur: 0.05,
    max: 2,
    vary: 0.01,
    fn: (c) => mallet(c, degHz(c.h, 4, 5), 0.035, 0.4),
  },
  uiSelect: {
    cat: 'ui',
    dur: 0.25,
    max: 2,
    fn: (c) => {
      mallet(c, degHz(c.h, 0, 5), 0.08, 0.4);
      mallet(c, degHz(c.h, 2, 5), 0.14, 0.4, 0.05);
    },
  },
  uiBack: {
    cat: 'ui',
    lvl: -1,
    dur: 0.18,
    max: 2,
    fn: (c) => {
      mallet(c, degHz(c.h, 4, 4), 0.07, 0.4);
      mallet(c, degHz(c.h, 0, 4), 0.1, 0.4, 0.05);
    },
  },
  countdown: {
    cat: 'confirm',
    lvl: -2,
    dur: 0.3,
    max: 1,
    fn: (c) => {
      mallet(c, degHz(c.h, 4, 5), 0.14, 0.45);
      thump(c, { f0: 200, f1: 120, dur: 0.05, vol: 0.25 });
    },
  },
  go: {
    cat: 'confirm',
    lvl: 4,
    dur: 1,
    max: 1,
    duck: 2,
    fn: (c) => {
      stab(c, { notes: [degHz(c.h, 0, 4), degHz(c.h, 2, 4), degHz(c.h, 4, 4), degHz(c.h, 7, 4)], dur: 0.45, vol: 0.3, cutoff: 1800, open: 3600 });
      whoosh(c, { f0: 300, f1: 2400, f2: 900, dur: 0.38, q: 1.2, vol: 0.25, peak: 0.3 });
      thump(c, { f0: 100, f1: 45, dur: 0.35, vol: 0.5 });
    },
  },
};

/** every sound the game can play */
export const SFX: Record<string, SfxDef> = { ...SHARED, ...IMPACT_SFX, ...CONFIRM_SFX, ...KIT_SFX };
