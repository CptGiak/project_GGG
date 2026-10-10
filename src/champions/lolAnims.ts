import { clip, Ease, pose, type PoseSpec, type WeaponSpec } from '../fighter/Animator';
import type { ChampionAnimSet } from '../fighter/locomotion';
import { bodySpec, type BodySpec } from '../fighter/Rig';
import { sharedClips } from './common';
import { novaAnims } from './nova';

/**
 * Animation sets of the League of Legends ports. Authored, like Nova's, for the
 * bodySpec('female') proportions (the imported bodies scale them with animScale).
 * Clip events: 'swing' (trail + whoosh), 'hitOn' / 'hitOff' (melee window), 'throw' (projectile
 * release), 'smoke', 'wave', 'slam'.
 */

/** height of the shoulder joints in the T-pose (Rig.ts layout) */
function shoulderY(s: BodySpec): number {
  return 0.045 + s.thigh + s.shin + s.footHeight + s.spineLen + s.chestLen + s.shoulderDrop - 0.01;
}

/** animScale of these clips on another body: shoulder height over the authoring body's */
export function lolAnimScale(spec: BodySpec): number {
  return shoulderY(spec) / shoulderY(bodySpec('female'));
}

const W = (p: [number, number, number], d: [number, number, number], u: [number, number, number] = [0, 1, 0]): WeaponSpec => ({ p, d, u });

const LEGS: PoseSpec = {
  hips: [0, -0.1, 0],
  thighL: [-32, -16, 15], shinL: [48, 0, 0], footL: [-14, 16, -10],
  thighR: [14, 22, -18], shinR: [38, 0, 0], footR: [-22, -20, 14],
  spine: [12, 26, 0], chest: [2, 12, 0], neck: [0, -16, 0], head: [-4, -18, 0],
};
const LUNGE: PoseSpec = { hips: [0, -0.16, 0.12], thighL: [-46, -10, 12], shinL: [56, 0, 0], thighR: [24, 18, -14], shinR: [34, 0, 0] };

// ---------------------------------------------------------------------------------------------
// AKALI: kama (right) + kunai (left), Nova's dual-blade stance
// ---------------------------------------------------------------------------------------------

export function akaliAnims(): ChampionAnimSet {
  const nova = novaAnims();
  const base = pose(LEGS);
  const c = nova.clips;
  return {
    ...nova,
    clips: {
      ...c,
      // c4 of the combo = Five Point Strike: arms cross, then flick the kunai fan outward
      fan: clip('fan', base, [
        [0, { ...LEGS, wR: W([0.12, 1.22, 0.22], [0.55, 0.15, 0.82]), wL: W([-0.12, 1.18, 0.24], [-0.55, 0.1, 0.83]), spine: [6, 0, 0], chest: [4, 0, 0] }],
        [0.09, { ...LUNGE, wR: W([-0.5, 1.2, 0.42], [-0.6, 0.05, 0.8]), wL: W([0.5, 1.18, 0.42], [0.6, 0.0, 0.8]), spine: [16, 0, 0], chest: [8, 0, 0] }, Ease.outExpo],
        [0.2, { ...LUNGE, wR: W([-0.55, 1.15, 0.36], [-0.7, -0.05, 0.7]), wL: W([0.55, 1.12, 0.36], [0.7, -0.05, 0.7]), spine: [14, 0, 0], chest: [6, 0, 0] }],
        [0.46, { ...LEGS }, Ease.inOut],
      ], { events: [{ t: 0.04, id: 'swing' }, { t: 0.08, id: 'throw' }, { t: 0.2, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.14 }),
      // Twilight Shroud: drop low and smash the smoke bomb on the floor
      shroud: clip('shroud', base, [
        [0, { ...LEGS, wL: W([0.32, 1.45, 0.05], [0.2, 0.9, 0.2]), spine: [-6, 0, 0] }],
        [0.12, { hips: [0, -0.34, 0.04], thighL: [-70, -12, 12], shinL: [100, 0, 0], thighR: [-20, 18, -14], shinR: [90, 0, 0], spine: [34, 0, 0], chest: [14, 0, 0], head: [-20, 0, 0], wL: W([0.18, 0.3, 0.42], [0.1, -0.9, 0.3]), wR: W([-0.42, 0.7, -0.2], [-0.4, -0.2, -0.9]) }, Ease.outExpo],
        [0.45, { ...LEGS }, Ease.inOut],
      ], { events: [{ t: 0.1, id: 'smoke' }], fadeIn: 0.03, fadeOut: 0.15 }),
      // Shuriken Flip: snap the throw forward while the body starts the back flip
      flip: clip('flip', base, [
        [0, { ...LEGS, wR: W([-0.2, 1.5, -0.1], [-0.2, 0.9, -0.3]) }],
        [0.07, { ...LEGS, wR: W([-0.12, 1.3, 0.55], [-0.05, 0.1, 1]), spine: [10, 6, 0], chest: [6, 0, 0] }, Ease.outExpo],
        [0.3, { hips: [0, -0.2, 0], thighL: [-90, 0, 8], shinL: [120, 0, 0], thighR: [-80, 0, -8], shinR: [120, 0, 0], spine: [20, 0, 0], wR: W([-0.3, 1.0, 0.3], [-0.3, -0.4, 0.86]), wL: W([0.3, 1.0, 0.3], [0.3, -0.4, 0.86]) }, Ease.inOut],
      ], { events: [{ t: 0.06, id: 'throw' }], fadeIn: 0.02, fadeOut: 0.12 }),
      // dashes (shuriken follow-up, Perfect Execution): body low, blades swept back
      dash: c.glitch,
      exec: clip('exec', base, [
        [0, { wR: W([-0.3, 1.0, -0.32], [-0.3, 0.1, -0.95]), wL: W([0.3, 1.0, -0.32], [0.3, 0.1, -0.95]), spine: [40, 0, 0], chest: [10, 0, 0], head: [-30, 0, 0], hips: [0, -0.2, 0], thighL: [-60, 0, 8], shinL: [70, 0, 0], thighR: [30, 0, -8], shinR: [60, 0, 0] }],
        [0.16, { wR: W([0.3, 1.05, 0.45], [0.8, -0.2, 0.55]), wL: W([-0.3, 1.05, 0.45], [-0.8, -0.2, 0.55]), spine: [26, 0, 0], chest: [8, 0, 0], hips: [0, -0.18, 0.1], thighL: [-50, 0, 8], shinL: [60, 0, 0], thighR: [20, 0, -8], shinR: [50, 0, 0] }, Ease.outExpo],
        [0.4, { ...LEGS }, Ease.inOut],
      ], { events: [{ t: 0.02, id: 'swing' }, { t: 0.36, id: 'hitOff' }], fadeIn: 0.02, fadeOut: 0.12 }),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// QIYANA: one ring blade in the right hand, the free hand on the hip
// ---------------------------------------------------------------------------------------------

export function qiyanaAnims(): ChampionAnimSet {
  const legs: PoseSpec = {
    hips: [0, -0.07, 0],
    thighL: [-22, -12, 12], shinL: [34, 0, 0], footL: [-10, 12, -8],
    thighR: [10, 18, -14], shinR: [28, 0, 0], footR: [-16, -16, 10],
    spine: [8, 18, 0], chest: [0, 10, 0], neck: [0, -12, 0], head: [-4, -14, 4],
  };
  // free left arm: hand near the hip, elbow out
  const freeL: PoseSpec = { upperArmL: [8, -30, 34], foreArmL: [-78, 0, 0], handL: [0, 0, -10], wL: null };
  const idle = pose({ ...legs, ...freeL, wR: W([-0.36, 0.98, 0.3], [-0.25, -0.45, 0.86], [-0.2, 0.85, 0.4]) });
  const runArms = pose({ upperArmL: [30, 0, 10], foreArmL: [-60, 0, 0], wL: null, wR: W([-0.3, 0.95, -0.22], [-0.25, 0.05, -0.97]) });
  const airArms = pose({ upperArmL: [-20, 0, 45], foreArmL: [-30, 0, 0], wL: null, wR: W([-0.55, 1.12, 0.0], [-0.85, -0.25, -0.45]) });
  const flyArms = pose({ upperArmL: [-10, 0, 30], foreArmL: [-40, 0, 0], wL: null, wR: W([-0.3, 0.98, -0.3], [-0.3, 0.05, -0.95]) });
  const base = pose({ ...legs, ...freeL });
  const armL = (up: number, out: number, el: number): PoseSpec => ({ upperArmL: [up, 0, out], foreArmL: [el, 0, 0], wL: null });
  const clips = {
    ...sharedClips(idle),
    // c1: forehand slash right to left
    c1: clip('c1', base, [
      [0, { ...legs, ...armL(-20, 40, -40), wR: W([-0.5, 1.25, 0.05], [-0.9, 0.15, 0.4]), spine: [8, -24, 0], chest: [0, -14, 0] }],
      [0.08, { ...LUNGE, ...armL(10, 50, -20), wR: W([0.0, 1.15, 0.6], [0.2, 0.0, 0.98]), spine: [12, 14, 0], chest: [4, 12, 0] }, Ease.outQuart],
      [0.16, { ...LUNGE, ...armL(20, 45, -20), wR: W([0.45, 1.05, 0.25], [0.85, -0.1, -0.5]), spine: [14, 32, 0], chest: [4, 18, 0] }, Ease.outCubic],
      [0.36, { ...legs, ...freeL, wR: W([0.2, 1.0, 0.32], [0.6, -0.3, 0.7]) }, Ease.inOut],
    ], { events: [{ t: 0.02, id: 'swing' }, { t: 0.04, id: 'hitOn' }, { t: 0.15, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.12 }),
    // c2: rising backhand left to right
    c2: clip('c2', base, [
      [0, { ...legs, ...armL(-10, 30, -60), wR: W([0.35, 0.85, 0.25], [0.7, -0.4, 0.55]), spine: [10, 26, 0], chest: [2, 14, 0] }],
      [0.08, { ...LUNGE, ...armL(0, 55, -20), wR: W([-0.05, 1.35, 0.55], [-0.3, 0.45, 0.85]), spine: [8, -6, 0], chest: [0, -8, 0] }, Ease.outQuart],
      [0.16, { ...LUNGE, ...armL(0, 60, -20), wR: W([-0.5, 1.55, 0.2], [-0.8, 0.5, -0.2]), spine: [4, -26, 0], chest: [-4, -14, 0] }, Ease.outCubic],
      [0.36, { ...legs, ...freeL, wR: W([-0.3, 1.0, 0.32], [-0.4, -0.3, 0.86]) }, Ease.inOut],
    ], { events: [{ t: 0.02, id: 'swing' }, { t: 0.04, id: 'hitOn' }, { t: 0.15, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.12 }),
    // Elemental Wrath: ring overhead, then a long forward slash that releases the element
    wrath: clip('wrath', base, [
      [0, { ...legs, ...armL(-60, 30, -40), wR: W([-0.25, 1.75, -0.05], [-0.15, 0.85, -0.5]), spine: [-12, -10, 0], chest: [-8, -6, 0] }],
      [0.1, { hips: [0, -0.22, 0.2], thighL: [-58, -10, 12], shinL: [66, 0, 0], thighR: [30, 18, -14], shinR: [40, 0, 0], ...armL(20, 60, -10), wR: W([0.0, 1.0, 0.7], [0.0, -0.35, 0.94]), spine: [28, 6, 0], chest: [12, 0, 0] }, Ease.outExpo],
      [0.24, { hips: [0, -0.22, 0.2], thighL: [-58, -10, 12], shinL: [66, 0, 0], thighR: [30, 18, -14], shinR: [40, 0, 0], ...armL(20, 60, -10), wR: W([0.05, 0.85, 0.65], [0.1, -0.6, 0.8]), spine: [30, 6, 0], chest: [12, 0, 0] }],
      [0.5, { ...legs, ...freeL }, Ease.inOut],
    ], { events: [{ t: 0.04, id: 'swing' }, { t: 0.07, id: 'hitOn' }, { t: 0.09, id: 'wave' }, { t: 0.2, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.15 }),
    air: clip('air', base, [
      [0, { ...armL(-30, 50, -30), wR: W([-0.3, 0.8, 0.32], [-0.2, -0.65, 0.73]), thighL: [-70, 0, 10], shinL: [110, 0, 0], thighR: [-50, 0, -10], shinR: [100, 0, 0], spine: [16, 0, 0] }],
      [0.14, { ...armL(-60, 60, -20), wR: W([-0.26, 1.85, 0.25], [-0.2, 0.95, 0.22]), thighL: [-30, 0, 10], shinL: [50, 0, 0], thighR: [-10, 0, -10], shinR: [40, 0, 0], spine: [-14, 0, 0], chest: [-8, 0, 0] }, Ease.outExpo],
      [0.42, { ...armL(-30, 50, -30), wR: W([-0.3, 1.5, 0.3], [-0.3, 0.6, 0.7]), thighL: [-40, 0, 10], shinL: [60, 0, 0], thighR: [-20, 0, -10], shinR: [50, 0, 0] }, Ease.inOut],
    ], { events: [{ t: 0.01, id: 'swing' }, { t: 0.03, id: 'hitOn' }, { t: 0.18, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.14 }),
    // Terrashape: low dash, ring trailing behind
    terra: clip('terra', base, [
      [0, { ...armL(20, 40, -30), wR: W([-0.42, 0.95, -0.3], [-0.35, 0.1, -0.93]), spine: [36, 0, 0], chest: [10, 0, 0], head: [-26, 0, 0], hips: [0, -0.22, 0], thighL: [-62, 0, 8], shinL: [72, 0, 0], thighR: [28, 0, -8], shinR: [58, 0, 0] }],
      [0.32, { ...armL(20, 40, -30), wR: W([-0.42, 0.95, -0.3], [-0.35, 0.1, -0.93]), spine: [36, 0, 0], chest: [10, 0, 0], head: [-26, 0, 0], hips: [0, -0.22, 0], thighL: [-62, 0, 8], shinL: [72, 0, 0], thighR: [28, 0, -8], shinR: [58, 0, 0] }],
    ], { fadeIn: 0.02, fadeOut: 0.12 }),
    // Audacity: pounce with the ring raised, strike on landing
    audacity: clip('audacity', base, [
      [0, { ...armL(-40, 50, -30), wR: W([-0.3, 1.7, 0.1], [-0.25, 0.9, -0.35]), spine: [-10, 0, 0], chest: [-10, 0, 0], hips: [0, 0.02, 0], thighL: [-40, 0, 8], shinL: [60, 0, 0], thighR: [0, 0, -8], shinR: [40, 0, 0] }],
      [0.24, { ...armL(-40, 50, -30), wR: W([-0.3, 1.7, 0.1], [-0.25, 0.9, -0.35]), spine: [-10, 0, 0], chest: [-10, 0, 0], hips: [0, 0.02, 0], thighL: [-50, 0, 8], shinL: [80, 0, 0], thighR: [-20, 0, -8], shinR: [60, 0, 0] }],
      [0.34, { ...armL(20, 60, -10), wR: W([0.1, 0.85, 0.55], [0.3, -0.7, 0.65]), spine: [32, 0, 0], chest: [14, 0, 0], hips: [0, -0.24, 0.12], thighL: [-70, 0, 12], shinL: [100, 0, 0], thighR: [20, 0, -12], shinR: [70, 0, 0] }, Ease.outExpo],
      [0.6, { ...legs, ...freeL }, Ease.inOut],
    ], { events: [{ t: 0.26, id: 'swing' }, { t: 0.3, id: 'hitOn' }, { t: 0.42, id: 'hitOff' }], fadeIn: 0.02, fadeOut: 0.15 }),
    // Supreme Display of Talent: wind up behind, then hurl the shockwave forward
    ult: clip('ult', base, [
      [0, { ...legs, ...armL(-30, 40, -40), wR: W([-0.55, 1.35, -0.35], [-0.5, 0.4, -0.75]), spine: [-6, -30, 0], chest: [-6, -18, 0] }],
      [0.3, { ...legs, ...armL(-60, 50, -30), wR: W([-0.6, 1.6, -0.45], [-0.45, 0.6, -0.65]), spine: [-12, -40, 0], chest: [-8, -22, 0], hips: [0, -0.12, -0.04] }, Ease.inOut],
      [0.42, { hips: [0, -0.24, 0.24], thighL: [-62, -10, 12], shinL: [70, 0, 0], thighR: [34, 18, -14], shinR: [40, 0, 0], ...armL(10, 70, -10), wR: W([0.05, 1.2, 0.75], [0.15, 0.0, 0.99]), spine: [26, 20, 0], chest: [10, 14, 0] }, Ease.outExpo],
      [0.95, { ...legs, ...freeL }, Ease.inOut],
    ], { events: [{ t: 0.33, id: 'swing' }, { t: 0.4, id: 'wave' }, { t: 0.7, id: 'hitOff' }], fadeIn: 0.05, fadeOut: 0.2 }),
    // taunt: spin the ring around the wrist, then strike a pose
    taunt: clip('taunt', base, [
      [0, { ...legs, ...freeL }],
      [0.25, { ...legs, ...armL(-150, 20, -30), wR: W([-0.2, 1.85, 0.1], [0.6, 0.0, 0.8], [0, 1, 0]) }],
      [0.5, { ...legs, ...armL(-150, 20, -30), wR: W([-0.2, 1.85, 0.1], [-0.6, 0.0, -0.8], [0, 1, 0]) }, Ease.linear],
      [0.75, { ...legs, ...armL(-150, 20, -30), wR: W([-0.2, 1.85, 0.1], [0.6, 0.0, 0.8], [0, 1, 0]) }, Ease.linear],
      [1.05, { ...legs, ...freeL, hips: [0, -0.04, 0], spine: [-6, -14, 0], chest: [-4, -8, 0], head: [-8, 16, 8], wR: W([-0.32, 1.3, 0.35], [-0.3, 0.7, 0.65]) }, Ease.outBack],
      [1.7, { ...legs, ...freeL, hips: [0, -0.04, 0], spine: [-6, -14, 0], chest: [-4, -8, 0], head: [-8, 16, 8], wR: W([-0.32, 1.3, 0.35], [-0.3, 0.7, 0.65]) }],
      [2.0, { ...legs, ...freeL }, Ease.inOut],
    ], { events: [{ t: 0.05, id: 'swing' }, { t: 0.95, id: 'hitOff' }], fadeIn: 0.1, fadeOut: 0.2 }),
  };
  return { idle, runArms, airArms, flyArms, armSwing: [1, 0.35], offhandLoco: 0, runLean: 16, clips };
}

// ---------------------------------------------------------------------------------------------
// LOCKE: silver stake (right) + soul nail (left), Nova's dual-wield set with his own throws
// ---------------------------------------------------------------------------------------------

export function lockeAnims(): ChampionAnimSet {
  const nova = novaAnims();
  const base = pose(LEGS);
  const c = nova.clips;
  return {
    ...nova,
    clips: {
      ...c,
      // c1: stake thrust
      c1: clip('c1', base, [
        [0, { ...LEGS, wR: W([-0.32, 1.15, -0.05], [-0.1, 0.1, 0.99]), wL: W([0.32, 1.0, -0.15], [0.45, -0.3, -0.84]), spine: [6, -18, 0], chest: [0, -10, 0] }],
        [0.08, { ...LUNGE, wR: W([-0.12, 1.22, 0.62], [0.05, 0.05, 1]), wL: W([0.32, 1.0, -0.15], [0.45, -0.3, -0.84]), spine: [14, 10, 0], chest: [6, 8, 0] }, Ease.outExpo],
        [0.32, { ...LEGS, wR: W([-0.3, 1.0, 0.3], [-0.2, -0.3, 0.93]) }, Ease.inOut],
      ], { events: [{ t: 0.02, id: 'swing' }, { t: 0.05, id: 'hitOn' }, { t: 0.15, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.12 }),
      // Ritual Nails: snap the nails out of the left hand
      nails: clip('nails', base, [
        [0, { ...LEGS, wL: null, upperArmL: [-150, 0, 20], foreArmL: [-70, 0, 0], spine: [-4, 12, 0], chest: [-4, 8, 0] }],
        [0.09, { ...LEGS, wL: null, upperArmL: [-80, 0, 6], foreArmL: [-6, 0, 0], spine: [14, -16, 0], chest: [8, -12, 0], hips: [0, -0.08, 0.08] }, Ease.outQuart],
        [0.34, { ...LEGS }, Ease.inOut],
      ], { events: [{ t: 0.07, id: 'throw' }], fadeIn: 0.03, fadeOut: 0.12 }),
      // Ashen Pursuit: arrive in a crouch and cut all around
      pursuit: clip('pursuit', base, [
        [0, { wR: W([-0.5, 1.15, 0.1], [-0.95, 0.0, 0.3]), wL: W([0.5, 1.15, 0.1], [0.95, 0.0, 0.3]), hips: [0, -0.2, 0], thighL: [-60, 0, 10], shinL: [90, 0, 0], thighR: [-40, 0, -10], shinR: [90, 0, 0], spine: [16, 0, 0] }],
        [0.3, { wR: W([-0.55, 1.12, 0.1], [-0.95, 0.05, 0.3]), wL: W([0.55, 1.12, 0.1], [0.95, 0.05, 0.3]), hips: [0, -0.18, 0], thighL: [-50, 0, 10], shinL: [80, 0, 0], thighR: [-30, 0, -10], shinR: [80, 0, 0], spine: [12, 0, 0] }],
        [0.5, { ...LEGS }, Ease.outCubic],
      ], { events: [{ t: 0.02, id: 'swing' }, { t: 0.04, id: 'hitOn' }, { t: 0.3, id: 'hitOff' }], fadeIn: 0.02, fadeOut: 0.14 }),
      // empowered strike after Ashen Pursuit: lunge through the target
      lunge: c.phantom,
      // Purgatory: hurl the reliquary overhand
      purgatory: clip('purgatory', base, [
        [0, { ...LEGS, wR: null, upperArmR: [-160, 0, -20], foreArmR: [-60, 0, 0], spine: [-10, -14, 0], chest: [-8, -10, 0], wL: W([0.32, 1.0, -0.15], [0.45, -0.3, -0.84]) }],
        [0.22, { ...LEGS, wR: null, upperArmR: [-175, 0, -10], foreArmR: [-95, 0, 0], spine: [-14, -20, 0], chest: [-10, -12, 0], wL: W([0.32, 1.0, -0.15], [0.45, -0.3, -0.84]) }, Ease.inOut],
        [0.32, { ...LUNGE, wR: null, upperArmR: [-70, 0, -8], foreArmR: [-8, 0, 0], spine: [20, 18, 0], chest: [10, 12, 0], wL: W([0.32, 1.0, -0.15], [0.45, -0.3, -0.84]) }, Ease.outQuart],
        [0.7, { ...LEGS }, Ease.inOut],
      ], { events: [{ t: 0.3, id: 'throw' }], fadeIn: 0.05, fadeOut: 0.18 }),
    },
  };
}
