/**
 * What a hit sounds like, decided by the ability that landed it.
 *
 * One hit plays at most one world impact (3D, at the victim, in the attacker's material) and, for
 * the attacker, one 2D confirm. Nothing else stacks on top: crits, counters and momentum change
 * the impact and the confirm instead of adding sounds. Rapid fire, beams, swarms and damage over
 * time are rate-limited per source (`gap`) so a channelled beam is a texture, not a machine gun.
 *
 * Impacts are designed to be heard hundreds of times a match: short (60-250 ms), their weight
 * in a clean 150-500 Hz body and a band-passed 0.6-1.8 kHz smack, little energy in 2-5 kHz where
 * the ear is most sensitive, no hiss, and sub only on the heaviest hits.
 */
import { CHAMPIONS } from '../../../shared/champions';
import { bell, blip, blop, chordHz, click, crunch, flutter, hiss, lerp, mallet, ring, rr, smack, sparkle, stab, sub, thump, whoosh, type SfxCtx, type SfxDef } from './layers';

export type Mat =
  | 'blade'
  | 'greatsword'
  | 'ringblade'
  | 'claw'
  | 'stake'
  | 'nail'
  | 'blunt'
  | 'bullet'
  | 'slug'
  | 'beam'
  | 'sonic'
  | 'shock'
  | 'aoe'
  | 'bite'
  | 'bat'
  | 'honey'
  | 'sting'
  | 'rock'
  | 'water'
  | 'grass'
  | 'holy';

export interface ImpactSpec {
  mat: Mat;
  /** weight 0..1 (body size, tail, sub) */
  w: number;
  /** min seconds between two impacts of this ability from one attacker (rapid fire / ticks) */
  gap?: number;
}

const I = (mat: Mat, w: number, gap?: number): ImpactSpec => ({ mat, w, gap });

/** champion -> "slot.part" -> impact */
export const IMPACTS: Record<string, Record<string, ImpactSpec>> = {
  kaiser: {
    'sig.wave': I('shock', 0.6),
    'sig.tip': I('shock', 0.85),
    'atk.c1': I('greatsword', 0.45),
    'atk.c2': I('greatsword', 0.45),
    'atk.c3': I('greatsword', 0.7),
    'atk.air': I('greatsword', 0.55),
    'atk.shock': I('shock', 0.4),
    'sec.riposte': I('greatsword', 0.8),
    'abi.dive': I('greatsword', 0.8),
    'ult.slam': I('aoe', 1),
  },
  nova: {
    'sig.cross': I('blade', 0.5),
    'atk.c1': I('blade', 0.28),
    'atk.c2': I('blade', 0.28),
    'atk.c3': I('blade', 0.35),
    'atk.c4': I('blade', 0.55),
    'atk.air': I('blade', 0.45),
    'sec.pass': I('blade', 0.45),
    'abi.cut': I('blade', 0.85),
    'ult.hit': I('blade', 0.45, 0.1),
  },
  rex: {
    'sig.slug': I('slug', 0.8),
    'atk.shot': I('bullet', 0.3, 0.1),
    'sec.charge': I('beam', 0.85),
    'sec.perfect': I('beam', 1),
    'abi.blast': I('aoe', 0.7),
    'ult.note': I('sonic', 0.4, 0.08),
  },
  sera: {
    'sig.note': I('sonic', 0.55),
    'sig.core': I('sonic', 0.8),
    'atk.orb': I('sonic', 0.35),
    'sec.tick': I('beam', 0.2, 0.22),
    'abi.wave': I('shock', 0.6),
    'ult.pillar': I('aoe', 1),
  },
  akali: {
    'sig.q': I('blade', 0.4),
    'atk.c1': I('blade', 0.3),
    'atk.c2': I('blade', 0.3),
    'atk.c3': I('blade', 0.42),
    'atk.air': I('blade', 0.45),
    'atk.mark': I('blade', 0.65),
    'abi.flip1': I('blade', 0.4),
    'abi.flip2': I('blade', 0.6),
    'ult.ex1': I('blade', 0.7),
    'ult.ex2': I('blade', 0.95),
  },
  qiyana: {
    'sig.q': I('ringblade', 0.5),
    'sig.qRock': I('rock', 0.75),
    'sig.qWater': I('water', 0.55),
    'sig.qGrass': I('grass', 0.5),
    'atk.c1': I('ringblade', 0.35),
    'atk.c2': I('ringblade', 0.35),
    'atk.air': I('ringblade', 0.45),
    'atk.royal': I('holy', 0.35),
    'abi.e': I('ringblade', 0.6),
    'ult.wave': I('shock', 0.7),
    'ult.burst': I('rock', 0.95),
  },
  locke: {
    'sig.q': I('nail', 0.35),
    'atk.c1': I('stake', 0.35),
    'atk.c2': I('stake', 0.35),
    'atk.c3': I('stake', 0.42),
    'atk.c4': I('stake', 0.65),
    'atk.air': I('stake', 0.45),
    'atk.stake': I('stake', 0.4),
    'atk.nails': I('nail', 0.75),
    'atk.dash': I('stake', 0.5),
    'abi.e': I('blade', 0.55),
    'ult.purg': I('aoe', 0.7),
    'ult.seal': I('holy', 1),
  },
  pooh: {
    'sig.bump': I('blunt', 0.75),
    'atk.pot': I('honey', 0.4),
    'atk.big': I('honey', 0.65),
    'atk.goo': I('honey', 0.08, 0.5),
    'ult.hive': I('honey', 0.7),
    'ult.sting': I('sting', 0.1, 0.25),
    'ult.sting2': I('sting', 0.18, 0.25),
  },
  elisabbat: {
    'sig.bite': I('bite', 0.7),
    'sig.feast': I('bite', 0.85),
    'atk.c1': I('claw', 0.3),
    'atk.c2': I('claw', 0.3),
    'atk.c3': I('claw', 0.55),
    'atk.air': I('claw', 0.45),
    'abi.bat': I('bat', 0.2, 0.07),
    'ult.storm': I('bat', 0.15, 0.25),
    'ult.finale': I('claw', 0.9),
  },
};

/** the impact of an ability (falls back on the champion's role and the damage) */
export function impactFor(champ: string | null, slot?: string, part?: string, amount = 60): ImpactSpec {
  const spec = champ && slot ? IMPACTS[champ]?.[`${slot}.${part}`] : undefined;
  if (spec) return spec;
  const melee = champ ? CHAMPIONS[champ as keyof typeof CHAMPIONS]?.role !== 'ranged' : true;
  return I(melee ? 'blade' : 'bullet', Math.min(1, Math.max(0.2, (amount - 20) / 200)));
}

// -----------------------------------------------------------------------------------------------
// the shared physical core of a hit
// -----------------------------------------------------------------------------------------------

/** pitched body + band-passed smack + a quiet click; crumble and sub only when heavy */
function core(c: SfxCtx, w: number, o: { body?: number; bodyVol?: number; smackF?: number; smackVol?: number; clickVol?: number } = {}): void {
  const bf = o.body ?? lerp(300, 165, w);
  thump(c, { f0: bf, f1: bf * 0.42, dur: 0.07 + 0.13 * w, vol: o.bodyVol ?? 0.8 });
  smack(c, { f: o.smackF ?? lerp(1500, 950, w), q: 1.1, dur: 0.03 + 0.05 * w, vol: o.smackVol ?? 0.42, drop: 0.55 });
  click(c, { f: 2800, dur: 0.005, vol: o.clickVol ?? 0.1 });
  if (w > 0.35) crunch(c, { f: 900, f1: 160, dur: 0.07 + 0.16 * w, vol: 0.12 + 0.22 * w });
  if (w > 0.8) sub(c, 62 * c.p, 36, 0.14 + 0.1 * w, 0.35 * (w - 0.6));
}

/** crits: a metallic accent and more body (the attacker's confirm carries the "ding") */
function critAccent(c: SfxCtx, w: number): void {
  ring(c, { f: rr(c, 1100, 1300), decay: 0.12, vol: 0.05, bright: 0.4 });
  thump(c, { f0: 140, f1: 60, dur: 0.12 + 0.08 * w, vol: 0.35 });
}

const W = (c: SfxCtx) => Math.max(0, Math.min(1, Number(c.arg?.w ?? 0.5)));
const isCrit = (c: SfxCtx) => !!c.arg?.crit;

function hitDef(fn: (c: SfxCtx, w: number) => void, o: Partial<SfxDef> = {}): SfxDef {
  return {
    cat: 'impact',
    dur: 0.35,
    max: 4,
    vary: 0.05,
    ...o,
    fn: (c) => {
      const w = W(c);
      fn(c, w);
      if (isCrit(c)) critAccent(c, w);
    },
  };
}

/** world impacts, one per material ("hit.blade"...) */
export const IMPACT_SFX: Record<string, SfxDef> = {
  'hit.blade': hitDef((c, w) => {
    core(c, w, { body: lerp(330, 200, w), bodyVol: 0.6, smackF: lerp(1700, 1150, w), smackVol: 0.38 });
    // the edge: a thin slice and a faint ring of steel
    smack(c, { f: 2300, q: 2.2, dur: 0.025, vol: 0.12, drop: 0.85 });
    ring(c, { f: rr(c, 1700, 2100), decay: 0.05 + 0.04 * w, vol: 0.022, bright: 0.3 });
  }),
  'hit.greatsword': hitDef((c, w) => {
    core(c, w, { body: lerp(240, 150, w), bodyVol: 0.85, smackF: lerp(1200, 850, w), smackVol: 0.45 });
    ring(c, { f: rr(c, 640, 760), decay: 0.12 + 0.08 * w, vol: 0.05, bright: 0.35 });
    // Bassline's string: a short bass note on the chord root
    blip(c, { type: 'triangle', f: chordHz(c.h, 0, 2), dur: 0.16 + 0.1 * w, vol: 0.22, out: c.g.filter('lowpass', 700, 0.8, c.out) });
  }),
  'hit.ringblade': hitDef((c, w) => {
    core(c, w, { body: lerp(320, 190, w), bodyVol: 0.6, smackF: lerp(1600, 1100, w), smackVol: 0.36 });
    // the golden ring answers
    ring(c, { f: rr(c, 1350, 1550), decay: 0.14 + 0.08 * w, vol: 0.035, bright: 0.4 });
  }),
  'hit.claw': hitDef((c, w) => {
    core(c, w, { body: lerp(300, 190, w), bodyVol: 0.55, smackVol: 0.25 });
    // three nails raking across
    for (let i = 0; i < 3; i++) smack(c, { f: rr(c, 1400, 2000), q: 2.6, dur: 0.016, vol: 0.18, at: 0.004 + i * rr(c, 0.011, 0.016), drop: 0.7 });
  }),
  'hit.stake': hitDef((c, w) => {
    core(c, w, { body: lerp(260, 170, w), bodyVol: 0.8, smackF: lerp(1300, 900, w), smackVol: 0.42 });
    // silver tip: a short bright tink
    ring(c, { f: rr(c, 1450, 1650), decay: 0.06, vol: 0.03, bright: 0.3 });
  }),
  'hit.nail': hitDef((c, w) => {
    core(c, w, { body: lerp(280, 200, w), bodyVol: 0.5, smackF: 1500, smackVol: 0.3 });
    // nails punching in: two quick pierces and a ring
    click(c, { f: 2400, dur: 0.007, vol: 0.12, at: 0.012 });
    ring(c, { f: rr(c, 1500, 1750), decay: 0.09, vol: 0.035, bright: 0.35 });
  }),
  'hit.blunt': hitDef((c, w) => {
    core(c, w, { body: lerp(220, 140, w), bodyVol: 0.9, smackF: lerp(900, 650, w), smackVol: 0.5, clickVol: 0.05 });
    // rubbery give
    blip(c, { type: 'triangle', f: 260 * c.p, f1: 150, dur: 0.09, vol: 0.18, at: 0.01 });
  }),
  'hit.bullet': hitDef(
    (c, w) => {
      // a tight "puk": short, mid-focused, no tail
      thump(c, { f0: lerp(300, 220, w), f1: 120, dur: 0.05 + 0.03 * w, vol: 0.65 });
      smack(c, { f: rr(c, 1500, 1800), q: 1.5, dur: 0.02, vol: 0.3, drop: 0.6 });
      click(c, { f: 2600, dur: 0.004, vol: 0.08 });
    },
    { dur: 0.15, max: 4 },
  ),
  'hit.slug': hitDef((c, w) => {
    core(c, w, { body: 200, bodyVol: 0.9, smackF: 1000, smackVol: 0.5 });
    blip(c, { type: 'sawtooth', f: chordHz(c.h, 0, 2), f1: chordHz(c.h, 0, 1), dur: 0.2, vol: 0.12, out: c.g.filter('lowpass', 500, 1, c.out) });
  }),
  'hit.beam': hitDef(
    (c, w) => {
      // a sizzle that locks onto the chord
      hiss(c, { f: 1600, f1: 1200, q: 1.4, dur: 0.06 + 0.12 * w, vol: 0.25, a: 0.004 });
      blip(c, { f: chordHz(c.h, 2, 4), dur: 0.08 + 0.1 * w, vol: 0.2 });
      if (w > 0.6) core(c, w, { body: 180, bodyVol: 0.6, smackVol: 0.3 });
    },
    { dur: 0.3, max: 3 },
  ),
  'hit.sonic': hitDef((c, w) => {
    // a soft pop and a chime on the chord
    thump(c, { f0: lerp(280, 180, w), f1: 110, dur: 0.07 + 0.08 * w, vol: 0.45 });
    smack(c, { f: 1200, q: 1, dur: 0.03, vol: 0.2, drop: 0.6 });
    mallet(c, chordHz(c.h, Math.floor(c.r() * 3), 5), 0.18 + 0.12 * w, 0.2);
    if (w > 0.5) sparkle(c, 0.2, 3, 0.03, 6, 0.02);
  }),
  'hit.shock': hitDef((c, w) => {
    // a wall of air: low thump, dull crumble, no metal
    thump(c, { f0: lerp(190, 130, w), f1: 60, dur: 0.12 + 0.12 * w, vol: 0.8 });
    smack(c, { f: lerp(900, 650, w), q: 0.8, dur: 0.06 + 0.06 * w, vol: 0.4, drop: 0.45 });
    crunch(c, { f: 1100, f1: 150, dur: 0.12 + 0.2 * w, vol: 0.25 + 0.2 * w });
    if (w > 0.75) sub(c, 58 * c.p, 34, 0.2, 0.3);
  }),
  'hit.aoe': hitDef(
    (c, w) => {
      // the blast already plays: each body caught in it only thuds
      thump(c, { f0: lerp(220, 150, w), f1: 80, dur: 0.1 + 0.08 * w, vol: 0.6 });
      smack(c, { f: 900, q: 1, dur: 0.04, vol: 0.25, drop: 0.5 });
    },
    { dur: 0.25 },
  ),
  'hit.bite': hitDef((c, w) => {
    core(c, w, { body: lerp(240, 170, w), bodyVol: 0.7, smackF: 800, smackVol: 0.3 });
    // fangs: a sharp double puncture and a wet crunch
    click(c, { f: 2100, dur: 0.006, vol: 0.12 });
    click(c, { f: 1900, dur: 0.006, vol: 0.1, at: 0.018 });
    smack(c, { f: rr(c, 650, 800), q: 1.6, dur: 0.09, vol: 0.28, at: 0.02, drop: 0.5 });
  }),
  'hit.bat': hitDef(
    (c, w) => {
      thump(c, { f0: 320, f1: 180, dur: 0.05, vol: 0.4 });
      smack(c, { f: rr(c, 1300, 1600), q: 2, dur: 0.018, vol: 0.2, drop: 0.7 });
      flutter(c, 2, 0.08 + 0.1 * w, 0.01, 700, 0.03);
    },
    { dur: 0.15, max: 3 },
  ),
  'hit.honey': hitDef(
    (c, w) => {
      // a sticky splat: a wet slap that falls and a bubble
      smack(c, { f: lerp(900, 700, w), q: 0.9, dur: 0.06 + 0.06 * w, vol: 0.45, drop: 0.35 });
      blop(c, lerp(320, 240, w), 0.25 + 0.15 * w, 0.015);
      thump(c, { f0: 200, f1: 110, dur: 0.06 + 0.06 * w, vol: 0.3 + 0.3 * w });
    },
    { dur: 0.25, max: 3 },
  ),
  // a bee sting: a tiny "tsk", heard many times, so barely there
  'hit.sting': {
    cat: 'impact',
    dur: 0.1,
    max: 2,
    lvl: -6,
    fn: (c) => {
      smack(c, { f: rr(c, 1700, 2100), q: 3, dur: 0.012, vol: 0.25, drop: 0.85 });
      thump(c, { f0: 420, f1: 260, dur: 0.035, vol: 0.2 });
    },
  },
  'hit.rock': hitDef((c, w) => {
    core(c, w, { body: lerp(200, 130, w), bodyVol: 0.8, smackF: 850, smackVol: 0.45 });
    // stone cracks and crumbles
    click(c, { f: 2000, dur: 0.008, vol: 0.15 });
    crunch(c, { f: 1500, f1: 300, dur: 0.15 + 0.15 * w, vol: 0.3 });
    for (let i = 0; i < 4; i++) smack(c, { f: rr(c, 1200, 2400), q: 4, dur: 0.012, vol: 0.06, at: 0.04 + i * rr(c, 0.02, 0.05), drop: 0.9 });
  }),
  'hit.water': hitDef((c, w) => {
    thump(c, { f0: 230, f1: 110, dur: 0.1, vol: 0.5 });
    // a splash: a falling wet band and droplets
    smack(c, { f: 1300, q: 0.7, dur: 0.12 + 0.08 * w, vol: 0.38, drop: 0.3 });
    blop(c, 420, 0.2, 0.03);
    blop(c, 560, 0.12, 0.07);
  }),
  'hit.grass': hitDef((c, w) => {
    core(c, w, { body: lerp(300, 200, w), bodyVol: 0.55, smackVol: 0.25 });
    // leaves: a soft rustle and a green chime
    hiss(c, { f: 2200, q: 0.9, dur: 0.12, vol: 0.1, a: 0.01 });
    mallet(c, chordHz(c.h, 2, 5), 0.18, 0.12, 0.01);
  }),
  'hit.holy': hitDef((c, w) => {
    thump(c, { f0: lerp(240, 160, w), f1: 90, dur: 0.1 + 0.12 * w, vol: 0.6 });
    // a bell on the chord, bigger when it seals
    bell(c, chordHz(c.h, 0, 4), 0.5 + 0.8 * w, 0.18 + 0.12 * w, 0, 0.9);
    bell(c, chordHz(c.h, 2, 5), 0.3 + 0.5 * w, 0.08, 0.01, 0.8);
    if (w > 0.8) sub(c, 55, 35, 0.3, 0.3);
  }),
  // a hit on a raised guard: dull shield, scrape, no body
  'hit.block': {
    cat: 'impact',
    dur: 0.35,
    max: 3,
    fn: (c) => {
      thump(c, { f0: 230, f1: 160, dur: 0.06, vol: 0.55 });
      ring(c, { f: rr(c, 480, 560), decay: 0.18, vol: 0.06, bright: 0.25, ratios: [1, 2.4, 4.1] });
      smack(c, { f: 1300, q: 2.2, dur: 0.05, vol: 0.18, at: 0.01, drop: 0.7 });
    },
  },
};

// -----------------------------------------------------------------------------------------------
// the local player's side: confirms (2D, in key, quiet) and getting hurt
// -----------------------------------------------------------------------------------------------

export const CONFIRM_SFX: Record<string, SfxDef> = {
  // a soft mallet tock that climbs the chord with the combo
  'confirm.hit': {
    cat: 'confirm',
    dur: 0.15,
    max: 3,
    combo: 0.7,
    vary: 0.004,
    fn: (c) => {
      const f = chordHz(c.h, Math.min(c.step, 5), 5);
      mallet(c, f, 0.1, 0.55);
      thump(c, { f0: 420, f1: 260, dur: 0.035, vol: 0.18 });
      click(c, { f: 3200, dur: 0.004, vol: 0.04 });
    },
  },
  // crit: two quick tones, the second a bell (the "ding")
  'confirm.crit': {
    cat: 'confirm',
    dur: 0.3,
    max: 2,
    lvl: 2,
    vary: 0.004,
    fn: (c) => {
      mallet(c, chordHz(c.h, 0, 5), 0.08, 0.45);
      bell(c, chordHz(c.h, 2, 6), 0.26, 0.26, 0.045, 1.3);
      thump(c, { f0: 380, f1: 220, dur: 0.04, vol: 0.2 });
    },
  },
  // counter / riposte: a rising arpeggio that resolves on a bell
  'confirm.counter': {
    cat: 'confirm',
    dur: 0.45,
    max: 2,
    lvl: 3,
    vary: 0.003,
    fn: (c) => {
      [0, 1, 2].forEach((d, i) => mallet(c, chordHz(c.h, d, 5), 0.09, 0.4, i * 0.035));
      bell(c, chordHz(c.h, 0, 6), 0.35, 0.28, 0.105, 1.2);
      thump(c, { f0: 160, f1: 70, dur: 0.12, vol: 0.4 });
    },
  },
  // the hit was blocked: a dull muted tuk
  'confirm.block': {
    cat: 'confirm',
    dur: 0.12,
    max: 2,
    lvl: -3,
    fn: (c) => {
      thump(c, { f0: 300, f1: 210, dur: 0.05, vol: 0.5 });
      smack(c, { f: 900, q: 2, dur: 0.02, vol: 0.2, drop: 0.8 });
    },
  },
  // arriving at speed: a punchy swish under the confirm, scaled by the momentum
  'confirm.momentum': {
    cat: 'confirm',
    dur: 0.3,
    max: 2,
    lvl: 1,
    fn: (c) => {
      const k = Math.max(0.3, Math.min(1, c.v));
      whoosh(c, { f0: 1600, f1: 900, f2: 400, dur: 0.14 + 0.08 * k, q: 1.1, vol: 0.3, peak: 0.15, edge: 0.2 });
      thump(c, { f0: 150, f1: 60, dur: 0.12 + 0.1 * k, vol: 0.5 });
    },
  },
  // the takedown: a short stab on the chord, a bell on top, a thump under it
  'confirm.kill': {
    cat: 'confirm',
    dur: 0.8,
    max: 2,
    lvl: 5,
    duck: 2.5,
    vary: 0.002,
    combo: 8,
    fn: (c) => {
      const up = Math.pow(2, Math.min(c.step, 4) / 12);
      stab(c, { notes: [chordHz(c.h, 0, 4) * up, chordHz(c.h, 1, 4) * up, chordHz(c.h, 2, 4) * up], dur: 0.32, vol: 0.32, cutoff: 1500, open: 3600, a: 0.003 });
      bell(c, chordHz(c.h, 0, 6) * up, 0.5, 0.18, 0.06, 1.2);
      thump(c, { f0: 110, f1: 48, dur: 0.24, vol: 0.6 });
      sparkle(c, 0.35, 4, 0.025, 6, 0.08);
    },
  },
  // the local player takes a hit: a body blow felt more than heard, scaled by damage
  hurt: {
    cat: 'hurt',
    dur: 0.25,
    max: 2,
    gap: 0.12,
    fn: (c) => {
      const k = Math.max(0.3, Math.min(1, c.v));
      thump(c, { f0: 150, f1: 62, dur: 0.1 + 0.08 * k, vol: 0.8 });
      crunch(c, { f: 700, f1: 160, dur: 0.08 + 0.06 * k, vol: 0.25 });
    },
  },
};
