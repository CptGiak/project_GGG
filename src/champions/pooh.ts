import * as THREE from 'three';
import { toon } from '../render/toon';
import { Rig, type BodySpec } from '../fighter/Rig';
import { ModelBuilder } from '../fighter/ModelBuilder';
import { clip, Ease, pose, type PoseSpec, type WeaponSpec } from '../fighter/Animator';
import type { ChampionAnimSet } from '../fighter/locomotion';
import { cyl, ellipsoid, lathe, limb, sweep, torus, xf } from '../fighter/shapes';
import { makeBodySpheres } from './body';
import { assembleVisual, marker, sharedClips, weaponPivot } from './common';
import type { ChampionVisual } from './types';

/**
 * POOH — the bear of very little brain, as a guest star: golden plush body with a jointed
 * teddy-bear build (short legs, big round tummy, short arms), a red crop shirt that rides up
 * over the belly, round ears, a muzzle with a dark nose, button eyes. He carries a HUNNY pot in
 * the left paw all the time; a second pot appears in the right paw when he throws.
 */

/** Rig.ts layout: hips sit at 0.045 + thigh + shin + foot = 0.495, shoulders at ~1.0, head at 1.08 */
export const POOH_SPEC: BodySpec = {
  hipHeight: 0.495, spineLen: 0.2, chestLen: 0.22, neckLen: 0.13, clavicle: 0.215, shoulderDrop: 0.1,
  upperArm: 0.23, foreArm: 0.2, hipWidth: 0.13, thigh: 0.2, shin: 0.17, footHeight: 0.08, bulk: 1.3, female: false,
};
/** the hand targets below were first authored with hips at 0.585: shift them with the body */
const DY = POOH_SPEC.hipHeight - 0.585;

export const POOH_FUR = 0xf2b23a;
export const POOH_SHIRT = 0xd8262f;
const HONEY = 0xffa51c;

/** "HUNNY" label for the pots (canvas texture; plain colour outside the browser) */
let labelTex: THREE.Texture | null = null;
function hunnyLabel(): THREE.Texture | null {
  if (labelTex || typeof document === 'undefined') return labelTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#f6e7c4';
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#8a5a2b';
  g.lineWidth = 4;
  g.strokeRect(4, 4, 248, 56);
  g.fillStyle = '#5a3416';
  g.font = 'bold 40px "Comic Sans MS", "Chalkboard SE", "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('HUNNY', 128, 34);
  labelTex = new THREE.CanvasTexture(c);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  return labelTex;
}

/** a honey pot centred on its belly (height ~0.22 m), honey spilling over the rim */
export function honeyPotGeometry(b: ModelBuilder, parent: THREE.Object3D, scale = 1, keys = { pot: 'pot', label: 'label', honey: 'honey' }): void {
  const s = scale;
  b.add(parent, xf(lathe([[0.001, -0.1], [0.06, -0.1], [0.09, -0.07], [0.103, -0.02], [0.1, 0.03], [0.085, 0.07], [0.07, 0.09], [0.078, 0.105], [0.07, 0.112], [0.001, 0.112]], 18), [0, 0, 0], [0, 0, 0], s), keys.pot);
  // label band on the belly of the pot
  const band = new THREE.CylinderGeometry(0.1045, 0.1045, 0.06, 24, 1, true, -Math.PI * 0.42, Math.PI * 0.84);
  b.add(parent, xf(band, [0, -0.015 * s, 0], [0, 0, 0], s), keys.label, 0);
  // honey: a dome in the mouth and drips down the neck
  b.add(parent, xf(ellipsoid(0.072, 0.03, 0.072, 14, 8), [0, 0.112 * s, 0], [0, 0, 0], s), keys.honey, 0.6);
  for (const [a, len] of [[0.3, 0.06], [1.6, 0.045], [2.5, 0.07], [4.1, 0.05], [5.2, 0.04]] as const) {
    const x = Math.sin(a) * 0.08;
    const z = Math.cos(a) * 0.08;
    b.add(parent, xf(limb(len, 0.016, 0.012, { segments: 8, steps: 3 }), [x * s, 0.108 * s, z * s], [0, 0, 0], s), keys.honey, 0);
  }
}

/** a beehive (the one from the bee tree: round, banded, with the hole in front), ~0.5 m tall */
export function beehiveGeometry(b: ModelBuilder, parent: THREE.Object3D, scale = 1): void {
  const s = scale;
  b.add(parent, xf(ellipsoid(0.2, 0.24, 0.2, 18, 14), [0, 0, 0], [0, 0, 0], s), 'hive');
  for (const [y, r] of [[-0.15, 0.158], [-0.05, 0.198], [0.05, 0.198], [0.15, 0.158]] as const) b.add(parent, xf(torus(r, 0.024, 8, 26), [0, y * s, 0], [90, 0, 0], s), 'hiveBand', 0.6);
  b.add(parent, xf(ellipsoid(0.058, 0.046, 0.03, 12, 8), [0, -0.08 * s, 0.178 * s], [0, 0, 0], s), 'hole', 0);
  b.add(parent, xf(cyl(0.028, 0.04, 0.07, 10), [0, 0.26 * s, 0], [0, 0, 0], s), 'hiveBand');
}

let propMats: Record<string, THREE.Material> | null = null;
function propMaterials(): Record<string, THREE.Material> {
  const label = hunnyLabel();
  propMats ??= {
    pot: toon({ color: 0xc77a35, shade: 0xffa070, spec: 0.35, specSize: 0.9, rim: 0.35 }),
    label: label ? toon({ color: 0xffffff, map: label, rim: 0.1 }) : toon({ color: 0xf6e7c4, rim: 0.1 }),
    honey: toon({ color: HONEY, shade: 0xffd07a, spec: 0.95, specSize: 0.86, rim: 0.6 }),
    hive: toon({ color: 0xe0a83e, shade: 0xffc070, spec: 0.2, rim: 0.45 }),
    hiveBand: toon({ color: 0xb7781f, shade: 0xffa060, rim: 0.25 }),
    hole: toon({ color: 0x1a0f08, rim: 0 }),
  };
  return propMats;
}

/** stand-alone HUNNY pot (thrown pots, pickups) */
export function makeHoneyPot(): THREE.Group {
  const g = new THREE.Group();
  const b = new ModelBuilder(propMaterials());
  honeyPotGeometry(b, g);
  b.build();
  return g;
}

/** stand-alone beehive (the ultimate's projectile) */
export function makeBeehive(): THREE.Group {
  const g = new THREE.Group();
  const b = new ModelBuilder(propMaterials());
  beehiveGeometry(b, g);
  b.build();
  return g;
}

export function buildPooh(): ChampionVisual {
  const label = hunnyLabel();
  const M: Record<string, THREE.Material> = {
    fur: toon({ color: POOH_FUR, shade: 0xffb070, rim: 0.4, rimCut: 0.66 }),
    furDark: toon({ color: 0xd99522, shade: 0xffa060, rim: 0.2 }),
    shirt: toon({ color: POOH_SHIRT, shade: 0xff7a90, rim: 0.45 }),
    nose: toon({ color: 0x2b1a12, spec: 0.85, specSize: 0.9, rim: 0.2 }),
    eye: toon({ color: 0x120c0a, spec: 1, specSize: 0.93, rim: 0 }),
    brow: toon({ color: 0x6b3d17, rim: 0 }),
    mouth: toon({ color: 0x5a2a14, rim: 0 }),
    pot: toon({ color: 0xc77a35, shade: 0xffa070, spec: 0.35, specSize: 0.9, rim: 0.35 }),
    label: label ? toon({ color: 0xffffff, map: label, rim: 0.1 }) : toon({ color: 0xf6e7c4, rim: 0.1 }),
    honey: toon({ color: HONEY, shade: 0xffd07a, spec: 0.95, specSize: 0.86, rim: 0.6 }),
    hive: toon({ color: 0xe0a83e, shade: 0xffc070, spec: 0.2, rim: 0.45 }),
    hiveBand: toon({ color: 0xb7781f, shade: 0xffa060, rim: 0.25 }),
    hole: toon({ color: 0x1a0f08, rim: 0 }),
  };

  const rig = new Rig(POOH_SPEC);
  const B = rig.byName;
  const s = rig.spec;
  const b = new ModelBuilder(M);

  // --- torso: bum, the big tummy, the chest under the red crop shirt ------------------------------
  b.add(B.hips, xf(ellipsoid(0.27, 0.23, 0.26, 18, 14), [0, 0.06, -0.01]), 'fur');
  b.add(B.spine, xf(ellipsoid(0.325, 0.3, 0.315, 22, 18), [0, 0.0, 0.05]), 'fur');
  // belly button
  b.add(B.spine, xf(ellipsoid(0.018, 0.022, 0.01, 8, 6), [0, -0.02, 0.362]), 'furDark', 0);
  b.add(B.chest, xf(ellipsoid(0.27, 0.2, 0.24, 18, 14), [0, 0.03, 0.0]), 'fur');
  // the shirt is a size too small: it covers the chest and rides up over the belly
  b.add(B.chest, xf(ellipsoid(0.292, 0.212, 0.258, 22, 16), [0, 0.036, 0.008]), 'shirt');
  // short sleeves: caps over the shoulders
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    b.add(B[`upperArm${side}`], xf(ellipsoid(0.104, 0.1, 0.1, 14, 12), [sx * 0.004, -0.04, 0]), 'shirt');
  }
  b.add(B.neck, xf(cyl(0.15, 0.17, 0.12, 16), [0, 0.03, 0.0]), 'fur', 0.4);

  // --- head -----------------------------------------------------------------------------------------
  const H = B.head;
  b.add(H, xf(ellipsoid(0.26, 0.235, 0.24, 22, 18), [0, 0.2, 0.03]), 'fur');
  // chubby cheeks and the muzzle
  for (const sx of [1, -1]) b.add(H, xf(ellipsoid(0.105, 0.09, 0.09, 14, 10), [sx * 0.12, 0.13, 0.16]), 'fur', 0.6);
  b.add(H, xf(ellipsoid(0.125, 0.092, 0.11, 16, 12), [0, 0.125, 0.2]), 'fur', 0.8);
  b.add(H, xf(ellipsoid(0.058, 0.04, 0.04, 12, 8), [0, 0.168, 0.308], [-10, 0, 0]), 'nose', 0.7);
  // a gentle smile under the muzzle
  b.add(H, sweep([new THREE.Vector3(-0.055, 0.092, 0.278), new THREE.Vector3(-0.025, 0.074, 0.298), new THREE.Vector3(0.025, 0.074, 0.298), new THREE.Vector3(0.055, 0.092, 0.278)], () => 0.0055, 5, 12), 'mouth', 0);
  // button eyes (their own group, so they can blink / shut tight while he thinks) and the eyebrows
  const eyesOpen = new THREE.Group();
  eyesOpen.name = 'eyesOpen';
  H.add(eyesOpen);
  const eyesShut = new THREE.Group();
  eyesShut.name = 'eyesShut';
  eyesShut.visible = false;
  H.add(eyesShut);
  for (const sx of [1, -1]) {
    b.add(eyesOpen, xf(ellipsoid(0.021, 0.029, 0.012, 10, 8), [sx * 0.076, 0.255, 0.252], [0, sx * 18, 0]), 'eye', 0);
    b.add(eyesShut, sweep([new THREE.Vector3(sx * 0.05, 0.262, 0.249), new THREE.Vector3(sx * 0.076, 0.249, 0.259), new THREE.Vector3(sx * 0.102, 0.262, 0.246)], () => 0.006, 5, 8), 'eye', 0);
    b.add(H, sweep([new THREE.Vector3(sx * 0.048, 0.306, 0.248), new THREE.Vector3(sx * 0.08, 0.318, 0.24), new THREE.Vector3(sx * 0.112, 0.31, 0.222)], () => 0.0065, 5, 8), 'brow', 0);
  }
  // round ears
  for (const sx of [1, -1]) {
    b.add(H, xf(ellipsoid(0.074, 0.074, 0.036, 14, 10), [sx * 0.168, 0.392, 0.01], [0, sx * -10, sx * -25]), 'fur', 0.8);
    b.add(H, xf(ellipsoid(0.048, 0.048, 0.012, 12, 8), [sx * 0.163, 0.388, 0.042], [0, sx * -10, sx * -25]), 'furDark', 0);
  }

  // --- arms -------------------------------------------------------------------------------------------
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    b.add(B[`upperArm${side}`], limb(s.upperArm, 0.084, 0.07, { capTop: 0.6, segments: 14 }), 'fur');
    b.add(B[`foreArm${side}`], limb(s.foreArm, 0.072, 0.066, { segments: 14 }), 'fur');
    const hand = B[`hand${side}`];
    b.add(hand, xf(ellipsoid(0.07, 0.085, 0.066, 14, 12), [0, -0.055, 0.004]), 'fur', 0.8);
    b.add(hand, xf(ellipsoid(0.03, 0.036, 0.03, 10, 8), [-sx * 0.052, -0.045, 0.032]), 'fur', 0.6);
  }

  // --- legs: stubby, no shoes ------------------------------------------------------------------------
  for (const side of ['L', 'R'] as const) {
    b.add(B[`thigh${side}`], limb(s.thigh, 0.142, 0.122, { capTop: 0.6, segments: 14, bulge: 0.01, bulgeAt: 0.3 }), 'fur');
    b.add(B[`shin${side}`], limb(s.shin, 0.12, 0.108, { segments: 14 }), 'fur');
    const ft = B[`foot${side}`];
    b.add(ft, xf(ellipsoid(0.11, 0.072, 0.16, 14, 10), [0, -0.01, 0.055]), 'fur');
    b.add(ft, xf(ellipsoid(0.094, 0.012, 0.138, 12, 6), [0, -0.075, 0.057]), 'furDark', 0);
  }

  // --- the pots: always one in the left paw, the throwing one in the right ----------------------------------
  const drvR = weaponPivot(B.handR);
  const drvL = weaponPivot(B.handL);
  const potL = new THREE.Group();
  potL.name = 'potL';
  potL.position.set(0.0, 0.0, 0.05);
  drvL.add(potL);
  honeyPotGeometry(b, potL);
  const potR = new THREE.Group();
  potR.name = 'potR';
  potR.position.set(0.0, 0.0, 0.05);
  potR.visible = false;
  drvR.add(potR);
  honeyPotGeometry(b, potR);
  // the beehive he winds up with for the ultimate
  const hive = new THREE.Group();
  hive.name = 'hive';
  hive.position.set(0.0, 0.0, 0.1);
  hive.visible = false;
  drvR.add(hive);
  beehiveGeometry(b, hive, 0.8);

  // gameplay sockets: the ropes leave from his hips, the gas from his back
  const gearL = marker(B.hips, 0.24, 0.02, 0.0, 'gearL');
  const gearR = marker(B.hips, -0.24, 0.02, 0.0, 'gearR');
  const nozzle = marker(B.spine, 0, 0.05, -0.28, 'nozzle');

  const v = assembleVisual({
    rig,
    builder: b,
    cloth: [],
    bodySpheres: makeBodySpheres(rig),
    blades: [],
    gear: { gearL, gearR, nozzle },
    weaponR: drvR,
    weaponL: drvL,
    offhandGrip: null,
    muzzle: drvR,
    materials: Object.values(M),
    anims: poohAnims(),
  });
  // the kit shows the throwing pot (or the beehive) while the arm winds up, hides the left pot on the balloon
  v.prop = (name, on) => {
    if (name === 'pot') potR.visible = on;
    else if (name === 'potL') potL.visible = on;
    else if (name === 'hive') hive.visible = on;
  };
  // eyes: a blink now and then, shut tight from the 'shut' clip event until the Idea (or a timeout)
  let shutT = 0;
  let blinkIn = 2 + Math.random() * 3;
  const eyes = (closed: boolean) => {
    eyesShut.visible = closed;
    eyesOpen.visible = !closed;
  };
  v.onAnimEvent = (ev) => {
    if (ev === 'shut') shutT = 1.2;
    else if (ev === 'idea' || ev === 'open') shutT = 0;
    else return;
    eyes(shutT > 0);
  };
  const tick = v.tick.bind(v);
  v.tick = (dt, time, energy) => {
    tick(dt, time, energy);
    if (shutT > 0) {
      shutT -= dt;
      if (shutT <= 0) eyes(false);
      return;
    }
    blinkIn -= dt;
    if (blinkIn < 0.12) eyes(blinkIn > 0);
    if (blinkIn <= 0) {
      blinkIn = 2.5 + Math.random() * 3.5;
      eyes(false);
    }
  };
  return v;
}

// ---------------------------------------------------------------------------------------------
// Animations (authored for POOH_SPEC; model space +Z forward, right hand on -X)
// ---------------------------------------------------------------------------------------------

const W = (p: [number, number, number], d: [number, number, number] = [0, 0, 1], u: [number, number, number] = [0, 1, 0]): WeaponSpec => ({ p: [p[0], p[1] + DY, p[2]], d, u });
/** hand target in the current body's model space (from tools/pose_probe.ts) */
const WA = (p: [number, number, number], d: [number, number, number] = [0, 0, 1], u: [number, number, number] = [0, 1, 0]): WeaponSpec => ({ p, d, u });

/** relaxed stance: feet apart, tummy out */
const LEGS: PoseSpec = {
  hips: [0, -0.012, 0],
  thighL: [-3, 0, 8], shinL: [6, 0, 0], footL: [-3, 0, -8],
  thighR: [-3, 0, -8], shinR: [6, 0, 0], footR: [-3, 0, 8],
  spine: [-5, 0, 0], chest: [0, 0, 0], neck: [8, 0, 0], head: [3, 0, 0],
};
/** the pot held against the left side of the tummy */
const POT_L = W([0.25, 0.86, 0.27], [0.25, 0, 0.97], [0, 1, 0]);
/** the Idea!: chest out, looking up at the paw raised beside the head */
const IDEA: PoseSpec = { ...LEGS, spine: [-6, 0, 0], chest: [-4, 0, 0], neck: [-2, 0, 0], head: [-14, -4, -4], shoulderR: [0, 0, -14] };
/** hanging from the balloon: left paw up on the string, right paw free to throw, legs dangling */
const BAL: PoseSpec = {
  hips: [0, 0, 0], spine: [-4, 0, 0], chest: [-4, 0, 0], neck: [0, 0, 0], head: [-14, 0, 0],
  thighL: [-16, 0, 8], shinL: [28, 0, 0], footL: [20, 0, 0], thighR: [-6, 0, -8], shinR: [22, 0, 0], footR: [20, 0, 0],
  shoulderL: [0, 0, 12],
  wL: WA([0.18, 1.45, 0.0], [0, 0, 1], [0, -1, 0]),
  wR: W([-0.3, 0.94, 0.22], [-0.2, 0, 0.98]),
};
/** right paw resting on the tummy */
const PAW_R = W([-0.24, 0.8, 0.33], [0.35, -0.2, 0.9], [0.3, 0.9, 0.1]);

export function poohAnims(): ChampionAnimSet {
  const idle = pose({ ...LEGS, wL: POT_L, wR: PAW_R });
  const base = pose({ ...LEGS, wL: POT_L, wR: PAW_R });
  const runArms = pose({ wL: W([0.3, 0.92, 0.2], [0.2, 0, 0.98]), wR: W([-0.4, 0.96, 0.06], [-0.3, -0.2, 0.93]) });
  const airArms = pose({ wL: W([0.32, 1.0, 0.18], [0.2, 0.1, 0.97]), wR: W([-0.46, 1.25, 0.02], [-0.5, 0.4, 0.75]) });
  const flyArms = pose({ wL: W([0.3, 0.98, 0.2], [0.2, 0, 0.98]), wR: W([-0.28, 1.15, 0.36], [-0.1, 0.1, 0.99]) });

  const clips = {
    ...sharedClips(idle),
    // honey pot: overhand lob with the right paw (the kit shows the pot until the release)
    throw: clip('throw', base, [
      [0, { ...LEGS, wL: POT_L, wR: W([-0.3, 1.4, -0.16], [0.1, 0.6, -0.8], [0, 0.8, 0.6]), spine: [-10, -16, 0], chest: [-6, -12, 0], head: [2, 12, 0] }],
      [0.13, { ...LEGS, wL: POT_L, wR: W([-0.2, 1.32, 0.4], [0.05, 0.3, 0.95], [0, 0.95, -0.3]), spine: [6, 14, 0], chest: [4, 10, 0], head: [6, -6, 0] }, Ease.outExpo],
      [0.42, { ...LEGS, wL: POT_L, wR: PAW_R }, Ease.inOut],
    ], { events: [{ t: 0.12, id: 'release' }], fadeIn: 0.04, fadeOut: 0.14 }),
    // Panzata: lean back, then throw the tummy forward with the arms swept back
    bump: clip('bump', base, [
      [0, { ...LEGS, hips: [0, -0.06, -0.05], spine: [8, 0, 0], chest: [6, 0, 0], head: [10, 0, 0], wL: W([0.36, 0.94, -0.16], [0.3, -0.3, -0.9]), wR: W([-0.36, 0.94, -0.16], [-0.3, -0.3, -0.9]) }],
      [0.1, { hips: [0, -0.02, 0.1], spine: [-30, 0, 0], chest: [-14, 0, 0], neck: [6, 0, 0], head: [16, 0, 0], thighL: [-38, 0, 6], shinL: [40, 0, 0], thighR: [24, 0, -6], shinR: [18, 0, 0], wL: W([0.4, 1.02, -0.22], [0.3, -0.2, -0.93]), wR: W([-0.4, 1.02, -0.22], [-0.3, -0.2, -0.93]) }, Ease.outExpo],
      [0.38, { hips: [0, -0.02, 0.1], spine: [-30, 0, 0], chest: [-14, 0, 0], neck: [6, 0, 0], head: [16, 0, 0], thighL: [-34, 0, 6], shinL: [36, 0, 0], thighR: [20, 0, -6], shinR: [16, 0, 0], wL: W([0.4, 1.02, -0.22], [0.3, -0.2, -0.93]), wR: W([-0.4, 1.02, -0.22], [-0.3, -0.2, -0.93]) }],
      [0.6, { ...LEGS, wL: POT_L, wR: PAW_R }, Ease.inOut],
    ], { fadeIn: 0.03, fadeOut: 0.16 }),
    // Think, think, think: the right paw taps the side of his head three times, eyes up, then an Idea!
    think: clip('think', base, [
      [0, { ...LEGS, wL: POT_L, wR: PAW_R }],
      ...thinkTaps(),
      [1.32, { ...IDEA, wL: POT_L, wR: WA([-0.31, 1.46, 0.08], [1, 0, 0], [0, -1, 0]) }, Ease.outBack],
      [1.62, { ...IDEA, head: [-12, -4, -4], wL: POT_L, wR: WA([-0.31, 1.47, 0.08], [1, 0, 0], [0, -1, 0]) }],
      [1.9, { ...LEGS, wL: POT_L, wR: PAW_R }, Ease.inOut],
    ], { events: [{ t: 0.24, id: 'shut' }, { t: 0.42, id: 'tap' }, { t: 0.74, id: 'tap' }, { t: 1.06, id: 'tap' }, { t: 1.3, id: 'idea' }], fadeIn: 0.08, fadeOut: 0.2 }),
    // Little black rain cloud: hanging from the balloon string (left paw), legs dangling
    balloon: clip('balloon', base, [
      [0, { ...BAL }],
      [0.8, { ...BAL, spine: [-4, 0, 4], chest: [-4, 0, 2], head: [-14, 6, 0], thighL: [-8, 0, 8], shinL: [20, 0, 0], thighR: [-18, 0, -8], shinR: [30, 0, 0] }, Ease.inOut],
      [1.6, { ...BAL }, Ease.inOut],
    ], { loop: true, fadeIn: 0.15, fadeOut: 0.2 }),
    // a pot thrown from up there
    balloonThrow: clip('balloonThrow', base, [
      [0, { ...BAL, wR: W([-0.3, 1.4, -0.16], [0.1, 0.6, -0.8], [0, 0.8, 0.6]), spine: [-10, -16, 0], chest: [-6, -12, 0], head: [-10, 12, 0] }],
      [0.13, { ...BAL, wR: W([-0.2, 1.32, 0.4], [0.05, 0.3, 0.95], [0, 0.95, -0.3]), spine: [6, 14, 0], chest: [4, 10, 0], head: [-8, -6, 0] }, Ease.outExpo],
      [0.42, { ...BAL }, Ease.inOut],
    ], { events: [{ t: 0.12, id: 'release' }], fadeIn: 0.04, fadeOut: 0.1 }),
    // Bee Swarm: a big wind-up and the beehive goes flying
    ult: clip('ult', base, [
      [0, { ...LEGS, wL: POT_L, wR: PAW_R }],
      [0.3, { ...LEGS, hips: [0, -0.04, -0.04], spine: [-14, -22, 0], chest: [-10, -16, 0], head: [-4, 14, 0], wL: POT_L, wR: WA([-0.27, 1.36, -0.25], [0.1, 0.7, -0.7], [0, 0.7, 0.7]) }, Ease.inOut],
      [0.44, { ...LEGS, hips: [0, -0.04, 0.08], spine: [12, 18, 0], chest: [8, 12, 0], head: [8, -8, 0], wL: POT_L, wR: W([-0.16, 1.36, 0.46], [0.05, 0.25, 0.97], [0, 0.97, -0.25]) }, Ease.outExpo],
      [0.9, { ...LEGS, wL: POT_L, wR: PAW_R }, Ease.inOut],
    ], { events: [{ t: 0.42, id: 'release' }], fadeIn: 0.06, fadeOut: 0.18 }),
    // taunt: a paw in the pot, licked clean, then a happy tummy rub
    taunt: clip('taunt', base, [
      [0, { ...LEGS, wL: POT_L, wR: PAW_R }],
      [0.35, { ...LEGS, head: [16, 10, 0], wL: W([0.18, 0.92, 0.3], [0, 0, 1]), wR: W([0.1, 1.02, 0.32], [0.2, -0.8, 0.5], [0.9, 0.3, 0]) }, Ease.inOut],
      [0.7, { ...LEGS, head: [-6, 0, 0], wL: W([0.18, 0.92, 0.3], [0, 0, 1]), wR: W([-0.04, 1.3, 0.34], [0.3, 0.6, -0.7], [0.9, 0.3, 0]) }, Ease.inOut],
      [1.0, { ...LEGS, head: [-8, -4, 0], wL: W([0.18, 0.92, 0.3], [0, 0, 1]), wR: W([-0.04, 1.32, 0.33], [0.3, 0.6, -0.7], [0.9, 0.3, 0]) }],
      [1.3, { ...LEGS, head: [16, 10, 0], wL: W([0.18, 0.92, 0.3], [0, 0, 1]), wR: W([0.1, 1.02, 0.32], [0.2, -0.8, 0.5], [0.9, 0.3, 0]) }, Ease.inOut],
      [1.6, { ...LEGS, head: [-6, 0, 0], wL: W([0.18, 0.92, 0.3], [0, 0, 1]), wR: W([-0.04, 1.3, 0.34], [0.3, 0.6, -0.7], [0.9, 0.3, 0]) }, Ease.inOut],
      [1.95, { ...LEGS, spine: [-10, 0, 0], head: [-4, 0, 0], wL: POT_L, wR: W([-0.16, 0.78, 0.36], [0.6, -0.2, 0.75], [0.2, 0.95, 0]) }, Ease.inOut],
      [2.2, { ...LEGS, spine: [-10, 0, 0], head: [-4, 0, 0], wL: POT_L, wR: W([0.06, 0.78, 0.37], [0.6, -0.2, 0.75], [0.2, 0.95, 0]) }, Ease.inOut],
      [2.45, { ...LEGS, spine: [-10, 0, 0], head: [-4, 0, 0], wL: POT_L, wR: W([-0.16, 0.78, 0.36], [0.6, -0.2, 0.75], [0.2, 0.95, 0]) }, Ease.inOut],
      [2.8, { ...LEGS, wL: POT_L, wR: PAW_R }, Ease.inOut],
    ], { fadeIn: 0.1, fadeOut: 0.2 }),
  };
  return { idle, runArms, airArms, flyArms, armSwing: [0.35, 0.9], offhandLoco: 0, runLean: 9, clips };
}

/** the three taps of "think, think, think": paw on the temple, lift, tap */
function thinkTaps(): Array<[number, PoseSpec, Ease?]> {
  // upright, the head leaning into the paw and looking up a little more at every tap
  const head = (k: number): PoseSpec => ({ ...LEGS, spine: [2, 3, 3], chest: [2, 3, 3], neck: [0, 2, 10], head: [-8 - k * 2, 4, 14], shoulderR: [0, 0, -12] });
  // palm on the upper right side of the forehead, fingers toward the crown, the thumb back
  // (tools/think_probe.ts: skull surface along [-0.9, 0.7, 0.7]); between taps it lifts 4-5 cm off
  const D: [number, number, number] = [-0.697, -0.123, -0.706];
  const U: [number, number, number] = [-0.087, -0.963, 0.253];
  const on = WA([-0.359, 1.294, 0.253], D, U);
  const off = WA([-0.391, 1.305, 0.282], D, U);
  const out: Array<[number, PoseSpec, Ease?]> = [];
  out.push([0.3, { ...head(0), wL: POT_L, wR: on }, Ease.inOut]);
  for (let i = 0; i < 3; i++) {
    const t = 0.3 + i * 0.32;
    out.push([t + 0.06, { ...head(i), wL: POT_L, wR: off }, Ease.outCubic]);
    out.push([t + 0.12, { ...head(i), wL: POT_L, wR: on }, Ease.inCubic]);
  }
  out.push([1.18, { ...head(3), wL: POT_L, wR: on }]);
  return out;
}
