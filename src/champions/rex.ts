import * as THREE from 'three';
import { equalizerMaterial, holoMaterial, neon, toon } from '../render/toon';
import { Rig, bodySpec } from '../fighter/Rig';
import { ModelBuilder } from '../fighter/ModelBuilder';
import { ClothChain } from '../fighter/Cloth';
import { clip, Ease, pose, type PoseSpec, type WeaponSpec } from '../fighter/Animator';
import type { ChampionAnimSet } from '../fighter/locomotion';
import { cyl, ellipsoid, lathe, limb, noteGeometry, rbox, sweep, torus, xf } from '../fighter/shapes';
import { addFace, addODMGear, addSpikyHair, addVisor, buildBody, makeBodySpheres, type SpikeSpec } from './body';
import { assembleVisual, marker, sharedClips, weaponPivot } from './common';
import type { ChampionVisual } from './types';

/**
 * REX — "The Headliner". Sharpshooter / producer.
 * Black hair with a teal undercut, purple holo shades, oversized purple hoodie with gold trim,
 * headphones around the neck, gold note chain, and HEADLINER: a bass-cannon rifle with
 * speaker-ring barrel, sub-woofer drum mag and a live equalizer side screen.
 */
export function buildRex(): ChampionVisual {
  const M: Record<string, THREE.Material> = {
    skin: toon({ color: 0xb47a56, shade: 0xffb8a8, rim: 0.35 }),
    skinDark: toon({ color: 0x5e3426, rim: 0 }),
    hair: toon({ color: 0x1c1a24, shade: 0xb0a8ff, spec: 0.35, specSize: 0.92, rim: 0.6 }),
    teal: toon({ color: 0x2ad6c8, shade: 0x9fd8ff, spec: 0.2, rim: 0.4 }),
    hoodie: toon({ color: 0x5b2fb4, shade: 0xc0a0ff, rim: 0.7, rimCut: 0.62 }),
    hoodieIn: toon({ color: 0x1a1622, side: THREE.BackSide, rim: 0.2 }),
    tee: toon({ color: 0x1c1b22, rim: 0.55 }),
    pants: toon({ color: 0x2c2a36, rim: 0.65, rimCut: 0.62 }),
    pocket: toon({ color: 0x24222c, rim: 0.4 }),
    shoe: toon({ color: 0xf3f0e8, rim: 0.3 }),
    sole: toon({ color: 0xf3c24f, spec: 0.5 }),
    glove: toon({ color: 0x17161d, spec: 0.3 }),
    gold: toon({ color: 0xf3c24f, spec: 0.85, specSize: 0.88, shade: 0xffd2a0, rim: 0.4 }),
    metal: toon({ color: 0x9ea3b6, spec: 0.7 }),
    black: toon({ color: 0x16141c, spec: 0.5, specSize: 0.94, rim: 0.6 }),
    gunPurple: toon({ color: 0x4a2a8c, spec: 0.5, rim: 0.55 }),
    gearBody: toon({ color: 0x1d1c26, spec: 0.4, rim: 0.5 }),
    neonViolet: neon(0xa46bff, 2.8),
    neonGold: neon(0xffc94a, 2.6),
    gearGlow: neon(0xa46bff, 1.7),
    lens: holoMaterial(0xa46bff, 0xffc94a, { intensity: 1.5, scan: 80, glitch: 0.2 }),
    eq: equalizerMaterial(0xa46bff, 0xffc94a, 10, 2.8),
  };

  const rig = new Rig(bodySpec('heavy'));
  const B = rig.byName;
  const s = rig.spec;
  const b = new ModelBuilder(M);

  buildBody(b, rig, { skin: 'skin', top: 'tee', pants: 'pants', boots: 'shoe', bootSole: 'sole', sleeve: 'hoodie', forearm: 'skin', glove: 'glove' }, { bareForearm: true, pecs: 1 });

  // --- oversized hoodie (open zip) --------------------------------------------------------------
  const cw = 0.158 * s.bulk;
  const hProf: [number, number][] = [[cw * 0.9 + 0.026, -0.06], [cw * 0.96 + 0.026, 0.04], [cw + 0.028, 0.12], [cw * 0.98 + 0.03, 0.17], [cw * 0.84 + 0.032, 0.215], [cw * 0.5 + 0.03, 0.25]];
  const hood = lathe(hProf, 22, 1.22, 0.72, 22, 316);
  b.add(B.chest, hood, 'hoodie');
  b.add(B.chest, hood.clone(), 'hoodieIn', 0);
  const aProf: [number, number][] = [[0.164 * s.bulk, -0.13], [0.152 * s.bulk, -0.05], [0.146 * s.bulk, 0.02], [0.15 * s.bulk, 0.09], [0.162 * s.bulk, 0.17], [0.17 * s.bulk, 0.21]];
  const abs = lathe(aProf, 22, 1.1, 0.76, 20, 320);
  b.add(B.spine, abs, 'hoodie');
  b.add(B.spine, abs.clone(), 'hoodieIn', 0);
  // ribbed waist band
  const band: THREE.Vector3[] = [];
  for (let phi = 20; phi <= 340; phi += 10) {
    const a = (phi * Math.PI) / 180;
    band.push(new THREE.Vector3(Math.sin(a) * 0.168 * s.bulk * 1.1, -0.125, Math.cos(a) * 0.168 * s.bulk * 0.76));
  }
  b.add(B.spine, sweep(band, () => 0.018, 6, 36), 'hoodie', 0.7);
  // gold zipper edges
  for (const phi of [22, 338]) {
    const pts = hProf.map(([r, y]) => new THREE.Vector3(Math.sin((phi * Math.PI) / 180) * (r + 0.004) * 1.22, y, Math.cos((phi * Math.PI) / 180) * (r + 0.004) * 0.72));
    b.add(B.chest, sweep(pts, () => 0.006, 5, 12), 'gold', 0.5);
    const pts2 = aProf.map(([r, y]) => new THREE.Vector3(Math.sin(((phi > 180 ? phi + 2 : phi - 2) * Math.PI) / 180) * (r + 0.004) * 1.1, y, Math.cos(((phi > 180 ? phi + 2 : phi - 2) * Math.PI) / 180) * (r + 0.004) * 0.76));
    b.add(B.spine, sweep(pts2, () => 0.006, 5, 12), 'gold', 0.5);
  }
  // hood bunched at the back of the neck
  const hoodBack = new THREE.SphereGeometry(0.13, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
  b.add(B.chest, xf(hoodBack, [0, 0.21, -0.1], [-120, 0, 0], [1.25, 0.9, 0.75]), 'hoodie');
  b.add(B.chest, xf(hoodBack.clone(), [0, 0.21, -0.1], [-120, 0, 0], [1.2, 0.86, 0.7]), 'hoodieIn', 0);
  // drawstrings
  for (const sx of [1, -1]) {
    b.add(B.chest, sweep([new THREE.Vector3(sx * 0.055, 0.235, 0.1), new THREE.Vector3(sx * 0.06, 0.16, 0.13), new THREE.Vector3(sx * 0.058, 0.08, 0.13)], () => 0.005, 4, 8), 'shoe', 0.4);
    b.add(B.chest, xf(cyl(0.008, 0.008, 0.03, 6), [sx * 0.058, 0.065, 0.13]), 'gold', 0.3);
  }
  // pushed-up sleeves (bunched cuff at the elbow)
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    b.add(B[`upperArm${side}`], xf(limb(s.upperArm * 0.92, 0.074, 0.066, { capTop: 0.6, capBottom: 0.3 }), [sx * 0.006, -0.005, 0]), 'hoodie');
    b.add(B[`upperArm${side}`], xf(torus(0.064, 0.02, 6, 16), [0, -s.upperArm * 0.92, 0], [90, 0, 0]), 'hoodie', 0.7);
    b.add(B[`upperArm${side}`], xf(rbox(0.006, s.upperArm * 0.7, 0.02, 0.003), [sx * 0.073, -s.upperArm * 0.45, 0]), 'gold', 0);
  }
  // left tech bracer
  b.add(B.foreArmL, xf(cyl(0.046, 0.052, 0.13, 12), [0, -s.foreArm + 0.09, 0]), 'black', 0.7);
  b.add(B.foreArmL, xf(rbox(0.03, 0.08, 0.012, 0.004), [0, -s.foreArm + 0.09, 0.048]), 'neonViolet', 0);
  b.add(B.foreArmR, xf(torus(0.04, 0.008, 5, 14), [0, -s.foreArm + 0.03, 0], [90, 0, 0]), 'gold', 0.4);

  // headphones resting on the collarbones
  b.add(B.chest, xf(torus(0.11, 0.014, 6, 24, Math.PI * 1.1), [0, 0.215, 0.02], [70, 0, -100]), 'black', 0.7);
  for (const sx of [1, -1]) {
    b.add(B.chest, xf(cyl(0.05, 0.05, 0.035, 16), [sx * 0.105, 0.2, 0.06], [0, 0, 90]), 'black', 0.9);
    b.add(B.chest, xf(torus(0.05, 0.008, 6, 16), [sx * 0.124, 0.2, 0.06], [0, 90, 0]), 'gold', 0.4);
    b.add(B.chest, xf(cyl(0.025, 0.025, 0.005, 12), [sx * 0.125, 0.2, 0.06], [0, 0, 90]), 'neonViolet', 0);
  }
  // gold chain + music-note pendant
  b.add(B.chest, sweep([new THREE.Vector3(0.07, 0.235, 0.07), new THREE.Vector3(0.04, 0.16, 0.122), new THREE.Vector3(0, 0.13, 0.13), new THREE.Vector3(-0.04, 0.16, 0.122), new THREE.Vector3(-0.07, 0.235, 0.07)], () => 0.0065, 4, 16), 'gold', 0.4);
  b.add(B.chest, xf(noteGeometry(0.22), [0.0, 0.105, 0.135]), 'gold', 0.5);
  // cargo pockets + knee straps
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    b.add(B[`thigh${side}`], xf(rbox(0.04, 0.12, 0.1, 0.012), [sx * 0.085, -0.22, 0.0]), 'pocket', 0.7);
    b.add(B[`thigh${side}`], xf(rbox(0.042, 0.02, 0.06, 0.004), [sx * 0.087, -0.17, 0.0]), 'gold', 0.3);
    b.add(B[`shin${side}`], xf(torus(0.06, 0.008, 5, 14), [0, -0.06, 0], [90, 0, 0]), 'black', 0.5);
  }

  // --- ODM gear ----------------------------------------------------------------------------------
  const gear = addODMGear(b, rig, { body: 'gearBody', accent: 'gold', glow: 'gearGlow' });

  // --- head ----------------------------------------------------------------------------------------
  addVisor(b, B.head, 'gold', 'lens', false, 0.036);
  addFace(b, B.head, 'skinDark', false);
  // teal undercut sides
  for (const sx of [1, -1]) b.add(B.head, xf(ellipsoid(0.03, 0.06, 0.085), [sx * 0.095, 0.15, -0.02], [0, 0, sx * 8]), 'teal', 0.6);
  const spikes: SpikeSpec[] = [
    { at: [0, 1, 0.35], len: 0.14, r: 0.05, bend: [0, 0.02, -0.08] },
    { at: [0.2, 1, 0.15], len: 0.15, r: 0.05, bend: [0.02, 0.0, -0.1] },
    { at: [-0.2, 1, 0.15], len: 0.15, r: 0.05, bend: [-0.02, 0.0, -0.1] },
    { at: [0, 0.95, -0.2], len: 0.16, r: 0.055, bend: [0, -0.02, -0.12] },
    { at: [0.18, 0.85, -0.45], len: 0.13, r: 0.05, bend: [0.02, -0.05, -0.08] },
    { at: [-0.18, 0.85, -0.45], len: 0.13, r: 0.05, bend: [-0.02, -0.05, -0.08] },
    { at: [0.1, 0.92, 0.5], len: 0.12, r: 0.04, bend: [0.0, 0.03, 0.04], flat: 0.55 },
  ];
  addSpikyHair(b, B.head, 'hair', spikes, false, 0.97);
  b.add(B.head, xf(torus(0.012, 0.0035, 5, 12), [0.112, 0.085, -0.005], [0, 90, 0]), 'gold', 0.3);
  b.add(B.head, xf(torus(0.012, 0.0035, 5, 12), [-0.112, 0.085, -0.005], [0, 90, 0]), 'gold', 0.3);

  // --- weapon: HEADLINER ------------------------------------------------------------------------------
  const w = weaponPivot(B.handR);
  b.add(w, xf(rbox(0.09, 0.13, 0.52, 0.025), [0, 0.06, 0.12]), 'black');
  b.add(w, xf(rbox(0.094, 0.05, 0.4, 0.015), [0, 0.1, 0.14]), 'gunPurple', 0.8);
  b.add(w, xf(rbox(0.07, 0.1, 0.3, 0.02), [0, 0.03, -0.29], [6, 0, 0]), 'gunPurple');
  b.add(w, xf(rbox(0.075, 0.13, 0.04, 0.01), [0, 0.02, -0.44], [6, 0, 0]), 'black', 0.8);
  b.add(w, xf(cyl(0.045, 0.048, 0.46, 16), [0, 0.07, 0.6], [90, 0, 0]), 'black');
  for (const [i, z] of [0.46, 0.6, 0.74].entries()) b.add(w, xf(torus(0.063 - i * 0.004, 0.012, 6, 20), [0, 0.07, z]), 'neonViolet', 0);
  b.add(w, xf(torus(0.058, 0.01, 6, 20), [0, 0.07, 0.84]), 'gold', 0.5);
  b.add(w, xf(lathe([[0.045, 0.0], [0.07, 0.06], [0.074, 0.09], [0.06, 0.1], [0.04, 0.05]], 18), [0, 0.07, 0.83], [90, 0, 0]), 'black', 0.8);
  // sub-woofer drum magazine
  b.add(w, xf(cyl(0.085, 0.085, 0.07, 20), [0, -0.075, 0.16], [0, 0, 90]), 'black', 0.9);
  for (const sx of [1, -1]) {
    b.add(w, xf(lathe([[0.075, 0.0], [0.05, -0.012], [0.02, -0.018], [0.0, -0.016]], 16), [sx * 0.036, -0.075, 0.16], [0, 0, sx * 90]), 'gunPurple', 0.6);
    b.add(w, xf(cyl(0.02, 0.02, 0.006, 12), [sx * 0.04, -0.075, 0.16], [0, 0, 90]), 'neonGold', 0);
    // live equalizer side screen
    b.add(w, xf(new THREE.PlaneGeometry(0.26, 0.06), [sx * 0.0465, 0.055, 0.12], [0, sx * 90, 0]), 'eq', 0, false);
  }
  // grips
  b.add(w, xf(rbox(0.036, 0.12, 0.05, 0.012), [0, -0.035, -0.02], [-14, 0, 0]), 'glove', 0.7);
  b.add(w, xf(rbox(0.032, 0.1, 0.04, 0.01), [0, -0.03, 0.42], [8, 0, 0]), 'glove', 0.7);
  // scope + gold trims
  b.add(w, xf(cyl(0.026, 0.026, 0.16, 12), [0, 0.165, 0.12], [90, 0, 0]), 'black', 0.7);
  b.add(w, xf(cyl(0.022, 0.022, 0.004, 12), [0, 0.165, 0.202], [90, 0, 0]), 'neonViolet', 0);
  for (const sx of [1, -1]) b.add(w, xf(rbox(0.004, 0.012, 0.46, 0.002), [sx * 0.047, 0.11, 0.13]), 'gold', 0);
  const muzzle = marker(w, 0, 0.07, 0.95, 'muzzle');
  const offhand = marker(w, 0, 0.02, 0.42, 'offhand');

  // --- cloth: hoodie drawstring tassels (tiny chains) -----------------------------------------------
  const spheres = makeBodySpheres(rig);
  const charm = new ClothChain({
    anchor: B.hips,
    offset: new THREE.Vector3(-0.16, 0.0, 0.06),
    restDir: new THREE.Vector3(0, -1, 0.1),
    segments: 4,
    length: 0.22,
    stiffness: 0.04,
    damping: 0.9,
    render: 'tube',
    size: () => 0.006,
    material: M.gold,
    radial: 4,
  }, spheres);

  const anims = rexAnims();
  return assembleVisual({
    rig,
    builder: b,
    cloth: [charm],
    bodySpheres: spheres,
    blades: [],
    gear,
    weaponR: w,
    weaponL: null,
    offhandGrip: offhand,
    muzzle,
    materials: Object.values(M),
    anims,
  });
}

function rexAnims(): ChampionAnimSet {
  const W = (p: [number, number, number], d: [number, number, number], u: [number, number, number] = [0, 1, 0]): WeaponSpec => ({ p, d, u });
  const legs: PoseSpec = {
    hips: [0, -0.03, 0],
    thighL: [-10, -12, 10], shinL: [16, 0, 0], footL: [-6, 12, -8],
    thighR: [8, 14, -11], shinR: [16, 0, 0], footR: [-8, -12, 9],
    spine: [4, 20, 0], chest: [0, 12, 0], neck: [0, -14, 0], head: [2, -16, 0],
  };
  // low ready: muzzle forward-down, two hands
  const lowReady = W([-0.16, 1.12, 0.3], [0.08, -0.32, 0.94], [0, 1, 0.3]);
  const idle = pose({ ...legs, wR: lowReady, off: 1 });
  const runArms = pose({ wR: W([-0.12, 1.12, 0.26], [0.62, 0.38, 0.68], [-0.4, 0.9, 0.1]), off: 1 });
  const airArms = pose({ wR: W([-0.18, 1.18, 0.32], [0.05, -0.35, 0.94], [0, 1, 0.3]), off: 1 });
  const flyArms = pose({ wR: W([-0.36, 1.0, -0.18], [-0.2, -0.25, -0.95]), off: 0, upperArmL: [10, 0, 45], foreArmL: [-30, 0, 0] });
  // shouldered aim (rotated by the aim pitch at runtime)
  const aimSpec: PoseSpec = { ...legs, spine: [2, 4, 0], chest: [0, 4, 0], neck: [0, -4, 0], head: [6, -6, 0], wR: W([-0.17, 1.4, 0.3], [0, 0, 1]), off: 1 };
  // taunt keys: wrist targets for the bare left hand (palm up overhead / palm down pointing)
  const shoulderRest = W([-0.22, 1.5, 0.05], [0.1, 0.6, -0.8], [-1, 0, 0]);
  const roofUp = W([0.3, 1.8, 0.04], [-1, 0, 0], [0, 0, 1]);
  const roofLow = W([0.33, 1.6, 0.1], [-1, 0, 0], [0, 0, 1]);
  const pointAt = W([0.17, 1.42, 0.5], [-1, 0, 0], [0, 0, -1]);
  const tauntPose = (hand: WeaponSpec, nod: number, dip: number): PoseSpec => ({
    ...legs, spine: [0, 8, 0], chest: [0, 4, 0], neck: [nod * 0.4, -4, 0], head: [nod, -6, nod * 0.3],
    hips: [0, dip, 0], wR: shoulderRest, wL: hand, off: 0,
  });
  const base = pose(legs);
  const clips = {
    ...sharedClips(idle),
    aim: clip('aim', base, [[0, aimSpec], [0.5, aimSpec]], { fadeIn: 0.07, fadeOut: 0.18 }),
    charge: clip('charge', base, [
      [0, aimSpec],
      [0.6, { ...aimSpec, hips: [0, -0.08, 0], thighL: [-22, -12, 12], shinL: [30, 0, 0], thighR: [14, 14, -12], shinR: [28, 0, 0] }],
    ], { fadeIn: 0.08, fadeOut: 0.18 }),
    throw: clip('throw', base, [
      [0, { ...legs, wR: W([-0.24, 1.05, 0.22], [0.2, -0.45, 0.87]), off: 0, upperArmL: [-150, 0, 25], foreArmL: [-60, 0, 0], spine: [-6, -10, 0], chest: [-4, -10, 0] }],
      [0.12, { wR: W([-0.24, 1.05, 0.22], [0.2, -0.45, 0.87]), off: 0, upperArmL: [-70, 0, 10], foreArmL: [-10, 0, 0], spine: [16, 18, 0], chest: [8, 14, 0], hips: [0, -0.06, 0.08], thighL: [-30, -10, 10], shinL: [34, 0, 0] }, Ease.outQuart],
      [0.4, { ...legs, wR: lowReady, off: 1 }, Ease.inOut],
    ], { events: [{ t: 0.1, id: 'release' }], fadeIn: 0.05, fadeOut: 0.15 }),
    // taunt: rifle propped on the shoulder, the free hand "raises the roof" on the beat, then
    // points the crowd at the target
    taunt: clip('taunt', base, [
      [0, { ...legs, wR: lowReady, off: 1 }],
      [0.28, tauntPose(roofLow, -6, -0.03), Ease.outBack],
      [0.45, tauntPose(roofUp, 14, -0.08)],
      [0.62, tauntPose(roofLow, -8, -0.03)],
      [0.79, tauntPose(roofUp, 14, -0.08)],
      [0.96, tauntPose(roofLow, -8, -0.03)],
      [1.13, tauntPose(roofUp, 14, -0.08)],
      [1.3, tauntPose(roofLow, -8, -0.03)],
      [1.46, { ...tauntPose(pointAt, 4, -0.05), spine: [2, -6, 0], chest: [2, -4, 0] }, Ease.outBack],
      [1.75, { ...tauntPose(pointAt, 2, -0.04), spine: [2, -6, 0], chest: [2, -4, 0] }],
      [2.0, { ...legs, wR: lowReady, off: 1 }, Ease.inOut],
    ], { fadeIn: 0.1, fadeOut: 0.25 }),
    ult: clip('ult', base, [
      [0, { ...legs, wR: W([-0.15, 1.5, 0.22], [0, 0.82, 0.57]), off: 1, spine: [-12, 0, 0], chest: [-10, 0, 0], head: [-20, 0, 0], hips: [0, -0.06, 0], thighL: [-24, -10, 12], shinL: [30, 0, 0] }],
      [1.4, { ...legs, wR: W([-0.15, 1.5, 0.22], [0, 0.82, 0.57]), off: 1, spine: [-12, 0, 0], chest: [-10, 0, 0], head: [-20, 0, 0], hips: [0, -0.06, 0], thighL: [-24, -10, 12], shinL: [30, 0, 0] }],
    ], { fadeIn: 0.08, fadeOut: 0.2 }),
  };
  return { idle, runArms, airArms, flyArms, armSwing: [0, 0], offhandLoco: 1, runLean: 2, clips };
}
