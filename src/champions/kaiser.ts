import * as THREE from 'three';
import { equalizerMaterial, neon, toon } from '../render/toon';
import { Rig, bodySpec } from '../fighter/Rig';
import { ModelBuilder } from '../fighter/ModelBuilder';
import { ClothSheet, ClothChain } from '../fighter/Cloth';
import { clip, Ease, pose, type PoseSpec } from '../fighter/Animator';
import type { ChampionAnimSet } from '../fighter/locomotion';
import { cyl, ellipsoid, extrude, hairLock, lathe, poly, rbox, sweep, torus, wrapOnBack, xf } from '../fighter/shapes';
import { addDominoMask, addFace, addODMGear, addSpikyHair, buildBody, makeBodySpheres, type SpikeSpec } from './body';
import { assembleVisual, marker, sharedClips, weaponPivot } from './common';
import type { ChampionVisual } from './types';
import { addAnimeEyes, eyeMaterial, type EyeStyle } from './face';

const KAISER_EYES: EyeStyle = {
  sclera: 0xf7f3ff, irisTop: 0x8a4a00, irisBottom: 0xffc94a, pupil: 0x2a1200, lash: 0x0c0810, brow: null,
  glow: 0.5, female: false, x: 0.047, y: 0.1195, tilt: 0.2, gaze: 0.05,
};

/**
 * KAISER — "Bass Drop" greatsword idol. Melee bruiser.
 * Silver FF-style spikes, black long coat with magenta lining and gold trim, domino mask,
 * and BASSLINE: a black holo-greatsword with a neon gold edge and a live equalizer core.
 */

export const KAISER_COLORS = {
  primary: new THREE.Color(0xffc24a),
  secondary: new THREE.Color(0xff2e88),
};

export function buildKaiser(): ChampionVisual {
  const M: Record<string, THREE.Material> = {
    skin: toon({ color: 0xf4cdb4, shade: 0xffc8c0, rim: 0.3 }),
    skinDark: toon({ color: 0x9a5a52, rim: 0 }),
    hair: toon({ color: 0xe2e7f4, shade: 0xb4aee8, hairBand: 0.45, rim: 0.5 }),
    eyes: eyeMaterial(KAISER_EYES),
    coat: toon({ color: 0x2b2738, rim: 0.85, rimCut: 0.62 }),
    lining: toon({ color: 0xb8195f, side: THREE.BackSide, rim: 0.2 }),
    liningFront: toon({ color: 0xb8195f, rim: 0.2 }),
    top: toon({ color: 0x34313f, rim: 0.6, rimCut: 0.64 }),
    pants: toon({ color: 0x24222f, rim: 0.7, rimCut: 0.62 }),
    boots: toon({ color: 0x15141b, spec: 0.35, rim: 0.5 }),
    sole: toon({ color: 0xf1ede4 }),
    glove: toon({ color: 0x131219, spec: 0.3 }),
    gold: toon({ color: 0xf3c24f, spec: 0.85, specSize: 0.88, shade: 0xffd2a0, rim: 0.4 }),
    metal: toon({ color: 0xa3a8ba, spec: 0.7 }),
    mask: toon({ color: 0x0f0f15, spec: 0.7, specSize: 0.9 }),
    blade: toon({ color: 0x17141f, spec: 0.45, specSize: 0.975, rim: 0.6 }),
    gearBody: toon({ color: 0x1d1c25, spec: 0.4, rim: 0.5 }),
    neonGold: neon(0xffc24a, 2.6),
    gearGlow: neon(0xffc24a, 1.7),
    neonPink: neon(0xff2e88, 2.6),
    eq: equalizerMaterial(0xff2e88, 0xffd34a, 18, 3.2),
  };

  const rig = new Rig(bodySpec('male'));
  const B = rig.byName;
  const b = new ModelBuilder(M);

  buildBody(b, rig, { skin: 'skin', top: 'top', pants: 'pants', boots: 'boots', bootSole: 'sole', sleeve: 'coat', forearm: 'coat', glove: 'glove' }, { pecs: 0.9 });

  // --- long coat: chest + abdomen shells (open front) ---------------------------------------
  const cw = 0.158;
  const chestShell = lathe([[cw * 0.88 + 0.018, -0.07], [cw * 0.95 + 0.016, 0.04], [cw + 0.016, 0.12], [cw * 0.98 + 0.017, 0.17], [cw * 0.84 + 0.02, 0.215], [cw * 0.52 + 0.022, 0.245]], 22, 1.2, 0.68, 30, 300);
  b.add(B.chest, chestShell, 'coat');
  b.add(B.chest, chestShell.clone(), 'lining', 0);
  const absShell = lathe([[0.152, -0.135], [0.142, -0.05], [0.138, 0.02], [0.142, 0.09], [0.154, 0.17], [0.162, 0.215]], 22, 1.08, 0.74, 26, 308);
  b.add(B.spine, absShell, 'coat');
  b.add(B.spine, absShell.clone(), 'lining', 0);
  // high collar
  const collar = lathe([[0.084, 0.212], [0.09, 0.255], [0.102, 0.3], [0.118, 0.335]], 20, 1.15, 1.02, 42, 276);
  b.add(B.chest, collar, 'coat');
  b.add(B.chest, collar.clone(), 'lining', 0);
  // gold trim along the coat opening
  const edgePts = (prof: [number, number][], phiDeg: number, sx: number, sz: number, push = 0.004) =>
    prof.map(([r, y]) => new THREE.Vector3(Math.sin((phiDeg * Math.PI) / 180) * (r + push) * sx, y, Math.cos((phiDeg * Math.PI) / 180) * (r + push) * sz));
  const chestProf: [number, number][] = [[cw * 0.88 + 0.018, -0.07], [cw * 0.95 + 0.016, 0.04], [cw + 0.016, 0.12], [cw * 0.98 + 0.017, 0.17], [cw * 0.84 + 0.02, 0.215], [cw * 0.52 + 0.022, 0.245]];
  const absProf: [number, number][] = [[0.152, -0.135], [0.142, -0.05], [0.138, 0.02], [0.142, 0.09], [0.154, 0.17], [0.162, 0.215]];
  const collarProf: [number, number][] = [[0.084, 0.212], [0.09, 0.255], [0.102, 0.3], [0.118, 0.335]];
  for (const phi of [30, 330]) {
    b.add(B.chest, sweep(edgePts(chestProf, phi, 1.2, 0.68), () => 0.007, 5, 12), 'gold', 0.5);
    b.add(B.spine, sweep(edgePts(absProf, phi + (phi > 180 ? 4 : -4), 1.08, 0.74), () => 0.007, 5, 12), 'gold', 0.5);
  }
  for (const phi of [42, 318]) b.add(B.chest, sweep(edgePts(collarProf, phi, 1.15, 1.02), () => 0.006, 5, 8), 'gold', 0.5);
  const collarTop: THREE.Vector3[] = [];
  for (let phi = 42; phi <= 318; phi += 12) {
    const a = (phi * Math.PI) / 180;
    collarTop.push(new THREE.Vector3(Math.sin(a) * 0.122 * 1.15, 0.335, Math.cos(a) * 0.122 * 1.02));
  }
  b.add(B.chest, sweep(collarTop, () => 0.006, 5, 40), 'gold', 0.4);

  // back crest: winged speaker with a bass "drop" (what you see of Kaiser most of the match)
  {
    const cy = 0.105;
    const onBack = (shape: THREE.Shape, depth: number, dy = 0) => wrapOnBack(xf(extrude(shape, depth, 0, 16), [0, cy + dy, 0]), chestProf, 1.2, 0.68, 0.003);
    const ring = new THREE.Shape();
    ring.absarc(0, 0, 0.031, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.022, 0, Math.PI * 2, true);
    ring.holes.push(hole);
    b.add(B.chest, onBack(ring, 0.003), 'neonPink', 0);
    const cone = new THREE.Shape();
    cone.absarc(0, 0, 0.014, 0, Math.PI * 2, false);
    b.add(B.chest, onBack(cone, 0.005), 'gold', 0.4);
    for (const sx of [1, -1]) {
      for (let i = 0; i < 3; i++) {
        const f = poly([0.03, 0.014 - i * 0.011, 0.106 - i * 0.017, 0.036 - i * 0.022, 0.098 - i * 0.017, 0.023 - i * 0.022, 0.03, 0.003 - i * 0.011].map((v, k) => (k % 2 === 0 ? v * sx : v)));
        b.add(B.chest, onBack(f, 0.003), 'gold', 0.4);
      }
    }
    b.add(B.chest, onBack(poly([-0.017, -0.037, 0.017, -0.037, 0, -0.066]), 0.003), 'neonPink', 0);
    for (let i = -2; i <= 2; i++) {
      const h = [0.012, 0.02, 0.026, 0.018, 0.01][i + 2];
      b.add(B.chest, onBack(poly([i * 0.011 - 0.0035, 0.036, i * 0.011 + 0.0035, 0.036, i * 0.011 + 0.0035, 0.036 + h, i * 0.011 - 0.0035, 0.036 + h]), 0.003), 'gold', 0.3);
    }
  }

  // chest harness strap + buckle, chain necklace + pendant
  b.add(B.chest, sweep([new THREE.Vector3(0.1, 0.215, 0.07), new THREE.Vector3(0.05, 0.14, 0.112), new THREE.Vector3(-0.02, 0.06, 0.112), new THREE.Vector3(-0.09, -0.03, 0.098)], () => 0.011, 4, 14, true, 0.35), 'gearBody', 0.6);
  b.add(B.chest, xf(rbox(0.04, 0.032, 0.014, 0.004), [0.018, 0.1, 0.118], [0, 0, 48]), 'gold', 0.6);
  b.add(B.chest, sweep([new THREE.Vector3(0.062, 0.228, 0.06), new THREE.Vector3(0.03, 0.175, 0.104), new THREE.Vector3(0, 0.158, 0.112), new THREE.Vector3(-0.03, 0.175, 0.104), new THREE.Vector3(-0.062, 0.228, 0.06)], () => 0.0045, 4, 16), 'gold', 0.4);
  b.add(B.chest, xf(new THREE.OctahedronGeometry(0.018), [0, 0.138, 0.118], [0, 0, 0], [0.8, 1.2, 0.5]), 'neonPink', 0);

  // right shoulder pauldron (layered lathe plates with gold rims)
  for (let i = 0; i < 3; i++) {
    const r = 0.092 + i * 0.01;
    const h = 0.05 - i * 0.008;
    const plate = lathe([[0.0, h], [r * 0.45, h * 0.92], [r * 0.8, h * 0.62], [r, 0.0], [r + 0.006, -0.012], [r - 0.004, -0.014], [r * 0.75, h * 0.5 - 0.012], [0, h - 0.012]], 18);
    const rim = xf(torus(r + 0.003, 0.0065, 5, 22), [0, -0.008, 0], [90, 0, 0]);
    const place = (g: THREE.BufferGeometry) => xf(g, [-0.03 - i * 0.022, 0.035 - i * 0.05, 0], [0, 0, 28 + i * 16], [1, 1, 1.12]);
    b.add(B.upperArmR, place(plate), i === 0 ? 'gold' : 'gearBody', 0.8);
    b.add(B.upperArmR, place(rim), i === 0 ? 'gearBody' : 'gold', 0.4);
  }
  // left arm band + coat cuffs with gold trim
  b.add(B.upperArmL, xf(torus(0.058, 0.009, 6, 20), [0, -0.12, 0], [90, 0, 0]), 'gold', 0.5);
  for (const side of ['L', 'R'] as const) {
    const fa = B[`foreArm${side}`];
    b.add(fa, xf(cyl(0.05, 0.056, 0.07, 14, true), [0, -rig.spec.foreArm + 0.05, 0]), 'coat');
    b.add(fa, xf(torus(0.055, 0.006, 5, 18), [0, -rig.spec.foreArm + 0.016, 0], [90, 0, 0]), 'gold', 0.4);
    // knuckle plate
    b.add(B[`hand${side}`], xf(rbox(0.054, 0.02, 0.06, 0.006), [0, -0.075, 0.034], [0, 0, 0]), 'gold', 0.5);
  }
  // hip chain
  b.add(B.hips, sweep([new THREE.Vector3(0.15, 0.03, 0.06), new THREE.Vector3(0.17, -0.06, 0.03), new THREE.Vector3(0.16, -0.1, -0.04), new THREE.Vector3(0.12, 0.02, -0.11)], () => 0.005, 4, 16), 'metal', 0.4);

  // --- ODM gear ----------------------------------------------------------------------------------
  const gear = addODMGear(b, rig, { body: 'gearBody', accent: 'gold', glow: 'gearGlow' });

  // --- head: mask, hair --------------------------------------------------------------------------
  addDominoMask(b, B.head, 'mask', null, 'sharp');
  addFace(b, B.head, 'skinDark', false);
  const eyes = addAnimeEyes(b, B.head, 'eyes', KAISER_EYES);
  const spikes: SpikeSpec[] = [
    { at: [0, 1, 0.25], len: 0.17, r: 0.048, bend: [0, -0.01, -0.13] },
    { at: [0.32, 0.9, -0.05], len: 0.19, r: 0.046, bend: [0.06, -0.03, -0.13] },
    { at: [-0.32, 0.9, -0.05], len: 0.19, r: 0.046, bend: [-0.06, -0.03, -0.13] },
    { at: [0, 0.72, -0.68], len: 0.27, r: 0.056, bend: [0, -0.07, -0.14] },
    { at: [0.46, 0.62, -0.6], len: 0.23, r: 0.05, bend: [0.09, -0.09, -0.09] },
    { at: [-0.46, 0.62, -0.6], len: 0.23, r: 0.05, bend: [-0.09, -0.09, -0.09] },
    { at: [0, 0.28, -0.96], len: 0.21, r: 0.05, bend: [0, -0.13, -0.05] },
    { at: [0.52, 0.22, -0.82], len: 0.15, r: 0.042, bend: [0.05, -0.1, 0] },
    { at: [-0.52, 0.22, -0.82], len: 0.15, r: 0.042, bend: [-0.05, -0.1, 0] },
    { at: [0.86, 0.4, -0.25], len: 0.13, r: 0.04, bend: [0.05, -0.07, -0.06] },
    { at: [-0.86, 0.4, -0.25], len: 0.13, r: 0.04, bend: [-0.05, -0.07, -0.06] },
    { at: [0.18, 0.78, 0.6], len: 0.15, r: 0.036, bend: [0.03, -0.12, 0.07], flat: 0.5 },
    { at: [-0.22, 0.74, 0.63], len: 0.17, r: 0.036, bend: [-0.05, -0.14, 0.05], flat: 0.5 },
    { at: [0.02, 0.9, 0.44], len: 0.15, r: 0.04, bend: [0.0, 0.03, 0.06], flat: 0.55 },
    { at: [0.58, 0.58, 0.5], len: 0.12, r: 0.032, bend: [0.03, -0.1, 0.03], flat: 0.5 },
    { at: [-0.58, 0.58, 0.5], len: 0.12, r: 0.032, bend: [-0.03, -0.1, 0.03], flat: 0.5 },
  ];
  addSpikyHair(b, B.head, 'hair', spikes);
  // sideburn locks framing the face
  for (const sx of [1, -1]) {
    b.add(B.head, xf(hairLock(0.13, 0.03, 0.012, [sx * 0.012, 0, 0.02]), [sx * 0.098, 0.2, 0.06], [180 - 8, 0, sx * -8]), 'hair', 0.6);
    b.add(B.head, xf(hairLock(0.1, 0.026, 0.01, [sx * 0.01, 0, 0.015]), [sx * 0.108, 0.19, 0.0], [180 - 4, 0, sx * -12]), 'hair', 0.6);
  }
  // gold ear cuff
  b.add(B.head, xf(torus(0.012, 0.0035, 5, 12), [0.108, 0.085, -0.005], [0, 90, 0]), 'gold', 0.3);

  // --- weapon: BASSLINE ---------------------------------------------------------------------------
  const { weapon, bladeBase, bladeTip, offhandGrip } = addBassline(b, B.handR);

  // --- cloth: coat skirt ------------------------------------------------------------------------
  const spheres = makeBodySpheres(rig);
  const cols = [];
  const N = 11;
  for (let i = 0; i < N; i++) {
    const deg = 46 + (i / (N - 1)) * (360 - 92);
    const a = (deg * Math.PI) / 180;
    const back = (1 - Math.cos(a)) / 2;
    cols.push({
      offset: new THREE.Vector3(Math.sin(a) * 0.178, 0.045, Math.cos(a) * 0.132),
      restDir: new THREE.Vector3(Math.sin(a) * 0.26, -1, Math.cos(a) * 0.3 - 0.05),
      length: 0.5 + 0.26 * back,
    });
  }
  const skirt = new ClothSheet({
    anchor: B.hips,
    columns: cols,
    rows: 5,
    stiffness: 0.075,
    stiffFalloff: 0.55,
    damping: 0.93,
    gravity: 9,
    thickness: 0.02,
    outer: M.coat,
    inner: M.liningFront,
    smoothH: 2,
    smoothV: 2,
    slackH: 1.25,
  }, spheres);
  // two thin ribbons hanging from the belt (back), True Damage streetwear detail
  const ribbonL = new ClothChain({
    anchor: B.hips,
    offset: new THREE.Vector3(0.07, 0.03, -0.14),
    restDir: new THREE.Vector3(0.1, -1, -0.25),
    segments: 6,
    length: 0.55,
    stiffness: 0.05,
    damping: 0.92,
    render: 'ribbon',
    size: (t) => 0.022 * (1 - t * 0.3),
    thickness: 0.008,
    side: new THREE.Vector3(1, 0, 0),
    material: toon({ color: 0xf3c24f, spec: 0.5, side: THREE.DoubleSide }),
  }, spheres);

  // --- animation -----------------------------------------------------------------------------------
  const anims = kaiserAnims();

  const materials = Object.values(M);
  return assembleVisual({
    rig,
    builder: b,
    cloth: [skirt, ribbonL],
    bodySpheres: spheres,
    blades: [{ base: bladeBase, tip: bladeTip, colorA: new THREE.Color(0xff2e88), colorB: new THREE.Color(0xffc24a), width: 1 }],
    gear,
    weaponR: weapon,
    weaponL: null,
    offhandGrip,
    muzzle: bladeTip,
    materials,
    anims,
    eyes,
    tick: (_dt, _t, energy) => {
      const eq = M.eq as THREE.ShaderMaterial;
      eq.uniforms.uEnergy.value = 0.6 + energy * 0.9;
    },
  });
}

/** Materials used by BASSLINE (shared by the procedural model and the GLB model). */
export function kaiserWeaponMaterials(): Record<string, THREE.Material> {
  return {
    glove: toon({ color: 0x131219, spec: 0.3 }),
    gold: toon({ color: 0xf3c24f, spec: 0.85, specSize: 0.88, shade: 0xffd2a0, rim: 0.4 }),
    blade: toon({ color: 0x17141f, spec: 0.45, specSize: 0.975, rim: 0.6 }),
    neonGold: neon(0xffc24a, 2.6),
    neonPink: neon(0xff2e88, 2.6),
    eq: equalizerMaterial(0xff2e88, 0xffd34a, 18, 3.2),
  };
}

/**
 * BASSLINE: black holo-greatsword with a neon gold edge and a live equalizer core, built on a
 * weapon pivot in the given hand. The builder needs the kaiserWeaponMaterials() keys.
 */
export function addBassline(b: ModelBuilder, hand: THREE.Object3D): { weapon: THREE.Group; bladeBase: THREE.Object3D; bladeTip: THREE.Object3D; offhandGrip: THREE.Object3D } {
  const weapon = weaponPivot(hand);
  const blade = new THREE.Shape();
  blade.moveTo(0, -0.1);
  blade.lineTo(0.06, -0.118);
  blade.lineTo(1.12, -0.118);
  blade.lineTo(1.38, 0.0);
  blade.lineTo(1.32, 0.09);
  blade.lineTo(1.2, 0.128);
  blade.lineTo(0.42, 0.128);
  blade.lineTo(0.38, 0.098);
  blade.lineTo(0.26, 0.098);
  blade.lineTo(0.22, 0.128);
  blade.lineTo(0.0, 0.12);
  blade.closePath();
  const slot = new THREE.Path();
  slot.moveTo(0.3, -0.036);
  slot.lineTo(1.0, -0.036);
  slot.lineTo(1.07, 0.0);
  slot.lineTo(1.0, 0.04);
  slot.lineTo(0.3, 0.04);
  slot.lineTo(0.27, 0.0);
  slot.closePath();
  blade.holes.push(slot);
  b.add(weapon, xf(extrude(blade, 0.026, 0.006, 4), [0, 0, 0.14], [0, -90, 0]), 'blade', 1.0);
  const edge = poly([0.06, -0.126, 1.124, -0.126, 1.393, 0.0, 1.332, 0.1, 1.31, 0.082, 1.364, 0.0, 1.114, -0.106, 0.06, -0.106]);
  b.add(weapon, xf(extrude(edge, 0.044, 0, 2), [0, 0, 0.14], [0, -90, 0]), 'neonGold', 0);
  const eqPlane = new THREE.PlaneGeometry(0.72, 0.07);
  b.add(weapon, xf(eqPlane, [0, 0.002, 0.14 + 0.65], [0, -90, 0]), 'eq', 0, false);
  for (const sx of [1, -1]) {
    b.add(weapon, xf(rbox(0.006, 0.012, 0.74, 0.003), [sx * 0.02, 0.11, 0.14 + 0.8]), 'gold', 0);
    b.add(weapon, xf(rbox(0.006, 0.05, 0.05, 0.003), [sx * 0.021, -0.07, 0.14 + 0.2]), 'neonPink', 0);
  }
  // guard: speaker cone
  b.add(weapon, xf(lathe([[0.02, 0.0], [0.128, 0.045], [0.136, 0.06], [0.122, 0.068], [0.02, 0.03]], 20), [0, 0, 0.085], [90, 0, 0], [0.5, 1, 1]), 'blade', 0.8);
  b.add(weapon, xf(torus(0.131, 0.01, 6, 26), [0, 0, 0.145], [0, 0, 0], [0.5, 1, 1]), 'gold', 0.5);
  b.add(weapon, xf(ellipsoid(0.03, 0.03, 0.02), [0, 0, 0.13], [0, 0, 0], [0.6, 1, 1]), 'neonPink', 0);
  // handle
  b.add(weapon, xf(cyl(0.021, 0.023, 0.27, 12), [0, 0, -0.045], [90, 0, 0]), 'glove', 0.8);
  for (const z of [-0.13, -0.05, 0.03]) b.add(weapon, xf(torus(0.024, 0.0055, 5, 14), [0, 0, z]), 'gold', 0.3);
  b.add(weapon, xf(new THREE.OctahedronGeometry(0.036), [0, 0, -0.205], [0, 0, 45], [1, 1, 1.3]), 'gold', 0.6);
  b.add(weapon, xf(new THREE.OctahedronGeometry(0.016), [0, 0, -0.245], [0, 0, 45], [1, 1, 1.4]), 'neonPink', 0);
  const bladeBase = marker(weapon, 0, 0, 0.36, 'bladeBase');
  const bladeTip = marker(weapon, 0, 0, 1.46, 'bladeTip');
  const offhandGrip = marker(weapon, 0, 0.05, -0.115, 'offhand');
  return { weapon, bladeBase, bladeTip, offhandGrip };
}

// ---------------------------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------------------------

export function kaiserAnims(): ChampionAnimSet {
  const legsIdle: PoseSpec = {
    hips: [0, -0.03, 0],
    thighL: [-8, -10, 9], shinL: [14, 0, 0], footL: [-6, 10, -8],
    thighR: [10, 12, -10], shinR: [16, 0, 0], footR: [-8, -10, 9],
    spine: [5, 14, 0], chest: [-2, 10, 0], neck: [0, -10, 0], head: [2, -12, 0],
  };
  const idle = pose({
    ...legsIdle,
    upperArmL: [6, 0, 14], foreArmL: [-18, 0, 0], handL: [0, 0, 0],
    // greatsword resting on the right shoulder
    wR: { p: [-0.24, 1.36, 0.26], d: [0.08, 0.38, -0.92], u: [-1, 0, 0] },
    off: 0,
  });
  const runArms = pose({
    upperArmL: [0, 0, 10], foreArmL: [-75, 0, 0],
    wR: { p: [-0.36, 0.86, -0.12], d: [-0.12, -0.32, -0.94], u: [-0.2, 1, 0] },
  });
  const airArms = pose({
    upperArmL: [-10, 0, 55], foreArmL: [-35, 0, 0],
    wR: { p: [-0.42, 1.0, -0.06], d: [-0.3, -0.25, -0.92], u: [0, 1, 0] },
  });
  const flyArms = pose({
    upperArmL: [30, 0, 30], foreArmL: [-40, 0, 0],
    wR: { p: [-0.36, 0.92, -0.2], d: [-0.2, -0.15, -0.97], u: [-0.3, 1, 0] },
  });

  const base = pose(legsIdle);
  const two = (p: [number, number, number], d: [number, number, number], u: [number, number, number]) => ({ p, d, u });

  const clips = {
    ...sharedClips(idle),
    // diagonal slash: high right -> low left
    atk1: clip('atk1', base, [
      [0, { ...legsIdle, wR: two([-0.28, 1.74, 0.02], [-0.2, 0.55, -0.81], [-0.55, -0.2, -0.6]), off: 1, spine: [-4, -26, 0], chest: [-6, -16, 0], hips: [0, -0.04, -0.04], thighL: [-22, -10, 8], shinL: [26, 0, 0], thighR: [16, 10, -8], shinR: [20, 0, 0] }],
      [0.13, { wR: two([-0.02, 1.25, 0.56], [0.35, 0.12, 0.93], [-0.55, 0.83, 0]), off: 1, spine: [14, 14, 0], chest: [8, 18, 0], head: [0, -20, 0], hips: [0, -0.1, 0.12], thighL: [-42, -8, 8], shinL: [48, 0, 0], footL: [-8, 0, 0], thighR: [24, 8, -8], shinR: [26, 0, 0] }, Ease.outQuart],
      [0.24, { wR: two([0.3, 0.74, 0.34], [0.55, -0.55, 0.62], [-0.6, 0.45, 0.65]), off: 1, spine: [24, 36, 0], chest: [10, 24, 0], head: [-6, -32, 0], hips: [0, -0.13, 0.14], thighL: [-46, -8, 8], shinL: [54, 0, 0], footL: [-10, 0, 0], thighR: [28, 8, -8], shinR: [28, 0, 0] }, Ease.outCubic],
      [0.56, { ...legsIdle, wR: two([0.22, 0.9, 0.4], [0.4, -0.4, 0.8], [-0.6, 0.6, 0.4]), off: 1, spine: [14, 24, 0], chest: [4, 14, 0], hips: [0, -0.08, 0.06] }, Ease.inOut],
    ], { events: [{ t: 0.07, id: 'swing' }, { t: 0.1, id: 'hitOn' }, { t: 0.22, id: 'hitOff' }], fadeIn: 0.04, fadeOut: 0.18 }),
    // rising reverse slash: low left -> high right
    atk2: clip('atk2', base, [
      [0, { wR: two([0.3, 0.74, 0.34], [0.55, -0.55, 0.62], [-0.6, 0.45, 0.65]), off: 1, spine: [24, 36, 0], chest: [10, 24, 0], hips: [0, -0.12, 0.1], thighL: [-40, -8, 8], shinL: [48, 0, 0], thighR: [26, 8, -8], shinR: [28, 0, 0] }],
      [0.12, { wR: two([-0.02, 1.2, 0.58], [-0.38, 0.28, 0.88], [0.55, -0.82, 0.1]), off: 1, spine: [10, -6, 0], chest: [2, -14, 0], hips: [0, -0.08, 0.14], thighL: [-30, -6, 6], shinL: [36, 0, 0], thighR: [30, 10, -8], shinR: [30, 0, 0] }, Ease.outQuart],
      [0.24, { wR: two([-0.36, 1.72, 0.16], [-0.5, 0.78, 0.3], [0.6, 0.15, 0.78]), off: 1, spine: [-8, -30, 0], chest: [-8, -18, 0], head: [-10, 16, 0], hips: [0, -0.02, 0.1], thighL: [-20, -6, 6], shinL: [22, 0, 0], thighR: [20, 10, -8], shinR: [20, 0, 0] }, Ease.outCubic],
      [0.52, { ...legsIdle, wR: two([-0.3, 1.5, 0.2], [-0.3, 0.6, -0.2], [0.6, 0.3, 0.7]), off: 1, spine: [-2, -10, 0] }, Ease.inOut],
    ], { events: [{ t: 0.05, id: 'swing' }, { t: 0.08, id: 'hitOn' }, { t: 0.2, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.18 }),
    // overhead jumping slam
    atk3: clip('atk3', base, [
      [0, { wR: two([-0.05, 1.95, -0.02], [0, 0.45, -0.89], [0, -0.9, -0.45]), off: 1, spine: [-16, 0, 0], chest: [-12, 0, 0], head: [-10, 0, 0], hips: [0, 0.06, 0], thighL: [-40, 0, 6], shinL: [60, 0, 0], thighR: [-10, 0, -6], shinR: [50, 0, 0] }],
      [0.14, { wR: two([0, 1.5, 0.58], [0, 0.35, 0.94], [0, 0.94, -0.35]), off: 1, spine: [6, 0, 0], chest: [4, 0, 0], hips: [0, 0.02, 0.1], thighL: [-50, 0, 6], shinL: [60, 0, 0], thighR: [10, 0, -6], shinR: [40, 0, 0] }, Ease.inQuad],
      [0.22, { wR: two([0, 0.56, 0.78], [0, -0.45, 0.89], [0, 0.89, 0.45]), off: 1, spine: [36, 0, 0], chest: [16, 0, 0], head: [-24, 0, 0], hips: [0, -0.26, 0.16], thighL: [-72, 0, 10], shinL: [100, 0, 0], footL: [-20, 0, 0], thighR: [14, 0, -10], shinR: [70, 0, 0], footR: [-10, 0, 0] }, Ease.outExpo],
      [0.42, { wR: two([0, 0.58, 0.76], [0, -0.42, 0.9], [0, 0.9, 0.42]), off: 1, spine: [32, 0, 0], chest: [14, 0, 0], head: [-20, 0, 0], hips: [0, -0.24, 0.14], thighL: [-68, 0, 10], shinL: [96, 0, 0], footL: [-20, 0, 0], thighR: [12, 0, -10], shinR: [66, 0, 0], footR: [-10, 0, 0] }],
      [0.75, { ...legsIdle, wR: two([-0.2, 1.1, 0.4], [-0.1, 0.5, 0.86], [-0.9, 0.2, 0]), off: 1 }, Ease.inOut],
    ], { events: [{ t: 0.08, id: 'swing' }, { t: 0.15, id: 'hitOn' }, { t: 0.22, id: 'slam' }, { t: 0.26, id: 'hitOff' }], fadeIn: 0.05, fadeOut: 0.2 }),
    // aerial spin cleave (root spin handled by the fighter)
    air: clip('air', base, [
      [0, { wR: two([-0.5, 1.2, -0.12], [-0.92, 0.1, -0.38], [0, 1, 0]), off: 1, spine: [0, -30, 0], chest: [0, -20, 0], thighL: [-50, 0, 8], shinL: [80, 0, 0], thighR: [-20, 0, -8], shinR: [70, 0, 0] }],
      [0.18, { wR: two([0.02, 1.15, 0.62], [0.35, 0.0, 0.94], [0, 1, 0]), off: 1, spine: [6, 10, 0], chest: [0, 12, 0], thighL: [-40, 0, 8], shinL: [70, 0, 0], thighR: [-10, 0, -8], shinR: [60, 0, 0] }, Ease.linear],
      [0.36, { wR: two([0.5, 1.2, -0.12], [0.92, 0.1, -0.38], [0, 1, 0]), off: 1, spine: [0, 30, 0], chest: [0, 20, 0], thighL: [-50, 0, 8], shinL: [80, 0, 0], thighR: [-20, 0, -8], shinR: [70, 0, 0] }, Ease.linear],
      [0.5, { wR: two([0.3, 1.0, 0.3], [0.6, -0.2, 0.7], [0, 1, 0]), off: 1, spine: [6, 14, 0], thighL: [-30, 0, 8], shinL: [60, 0, 0], thighR: [-10, 0, -8], shinR: [50, 0, 0] }, Ease.outCubic],
    ], { events: [{ t: 0.02, id: 'swing' }, { t: 0.04, id: 'hitOn' }, { t: 0.42, id: 'hitOff' }], fadeIn: 0.04, fadeOut: 0.15 }),
    // guard: blade upright in front, two hands
    guard: clip('guard', base, [
      [0, { wR: two([-0.04, 1.12, 0.4], [0.08, 0.96, 0.18], [1, 0, 0]), off: 1, spine: [10, 0, 0], chest: [6, 0, 0], head: [-6, 0, 0], hips: [0, -0.1, 0], thighL: [-30, -10, 10], shinL: [40, 0, 0], footL: [-10, 10, -8], thighR: [8, 12, -12], shinR: [34, 0, 0], footR: [-18, -10, 10] }],
      [0.2, { wR: two([-0.04, 1.13, 0.41], [0.08, 0.96, 0.18], [1, 0, 0]), off: 1, spine: [11, 0, 0], chest: [6, 0, 0], head: [-6, 0, 0], hips: [0, -0.11, 0], thighL: [-30, -10, 10], shinL: [41, 0, 0], footL: [-10, 10, -8], thighR: [8, 12, -12], shinR: [35, 0, 0], footR: [-18, -10, 10] }],
    ], { fadeIn: 0.06, fadeOut: 0.12 }),
    // F: Drop Dive – forward thrust held during the dash
    dive: clip('dive', base, [
      [0, { wR: two([-0.2, 1.25, -0.05], [0, 0.1, -1], [0, 1, 0]), off: 1, spine: [10, -20, 0], chest: [4, -10, 0], hips: [0, -0.1, -0.05], thighL: [-30, 0, 6], shinL: [50, 0, 0], thighR: [10, 0, -6], shinR: [40, 0, 0] }],
      [0.1, { wR: two([0.02, 1.2, 0.8], [0, -0.02, 1], [0, 1, 0]), off: 1, spine: [30, 0, 0], chest: [8, 0, 0], head: [-26, 0, 0], hips: [0, -0.16, 0.2], thighL: [-62, 0, 6], shinL: [60, 0, 0], footL: [-10, 0, 0], thighR: [42, 0, -6], shinR: [30, 0, 0], footR: [30, 0, 0] }, Ease.outExpo],
      [0.6, { wR: two([0.02, 1.2, 0.82], [0, -0.02, 1], [0, 1, 0]), off: 1, spine: [30, 0, 0], chest: [8, 0, 0], head: [-26, 0, 0], hips: [0, -0.16, 0.2], thighL: [-62, 0, 6], shinL: [60, 0, 0], footL: [-10, 0, 0], thighR: [42, 0, -6], shinR: [30, 0, 0], footR: [30, 0, 0] }],
    ], { fadeIn: 0.03, fadeOut: 0.15 }),
    // taunt: plant the blade, lean on it and beckon
    taunt: clip('taunt', base, [
      [0, { ...legsIdle, wR: two([-0.24, 1.36, 0.26], [0.08, 0.38, -0.92], [-1, 0, 0]) }],
      [0.3, { wR: two([0.0, 1.35, 0.5], [0, 0.98, 0.15], [0, 0, 1]), spine: [-6, 0, 0], hips: [0, 0.02, 0], thighL: [-8, -10, 9], shinL: [10, 0, 0], thighR: [6, 12, -10], shinR: [10, 0, 0], upperArmL: [0, 0, 14], foreArmL: [-20, 0, 0] }, Ease.outBack],
      [0.55, { wR: two([0.0, 1.12, 0.5], [0, -0.99, 0.08], [0, 0, 1]), spine: [12, 8, 0], chest: [4, 6, 0], hips: [0, -0.06, 0], thighL: [-14, -10, 9], shinL: [20, 0, 0], thighR: [10, 14, -10], shinR: [18, 0, 0], upperArmL: [0, 0, 14], foreArmL: [-20, 0, 0], head: [-6, -10, 0] }, Ease.inQuad],
      [0.9, { wR: two([0.0, 1.12, 0.5], [0, -0.99, 0.08], [0, 0, 1]), spine: [14, 10, 0], chest: [4, 8, 0], hips: [0, -0.07, 0], thighL: [-14, -10, 9], shinL: [20, 0, 0], thighR: [10, 14, -10], shinR: [18, 0, 0], upperArmL: [-70, 30, 30], foreArmL: [-60, 0, 0], handL: [0, 0, -30], head: [-8, -16, 0] }],
      [1.1, { wR: two([0.0, 1.12, 0.5], [0, -0.99, 0.08], [0, 0, 1]), spine: [14, 10, 0], chest: [4, 8, 0], hips: [0, -0.07, 0], thighL: [-14, -10, 9], shinL: [20, 0, 0], thighR: [10, 14, -10], shinR: [18, 0, 0], upperArmL: [-70, 30, 30], foreArmL: [-110, 0, 0], handL: [0, 0, -30], head: [-8, -16, 0] }],
      [1.3, { wR: two([0.0, 1.12, 0.5], [0, -0.99, 0.08], [0, 0, 1]), spine: [14, 10, 0], chest: [4, 8, 0], hips: [0, -0.07, 0], thighL: [-14, -10, 9], shinL: [20, 0, 0], thighR: [10, 14, -10], shinR: [18, 0, 0], upperArmL: [-70, 30, 30], foreArmL: [-60, 0, 0], handL: [0, 0, -30], head: [-8, -16, 0] }],
      [1.5, { wR: two([0.0, 1.12, 0.5], [0, -0.99, 0.08], [0, 0, 1]), spine: [14, 10, 0], chest: [4, 8, 0], hips: [0, -0.07, 0], thighL: [-14, -10, 9], shinL: [20, 0, 0], thighR: [10, 14, -10], shinR: [18, 0, 0], upperArmL: [-70, 30, 30], foreArmL: [-110, 0, 0], handL: [0, 0, -30], head: [-8, -16, 0] }],
      [2.1, { ...legsIdle, wR: two([-0.24, 1.36, 0.26], [0.08, 0.38, -0.92], [-1, 0, 0]) }, Ease.inOut],
    ], { events: [{ t: 0.55, id: 'plant' }], fadeIn: 0.1, fadeOut: 0.25 }),
    // R: Encore Break – rise with the blade overhead (held), then slam
    ultRise: clip('ultRise', base, [
      [0, { wR: two([-0.2, 1.0, 0.3], [-0.3, -0.4, 0.86], [0, 1, 0]), off: 1, spine: [20, 0, 0], hips: [0, -0.2, 0], thighL: [-60, 0, 8], shinL: [100, 0, 0], thighR: [-10, 0, -8], shinR: [80, 0, 0] }],
      [0.25, { wR: two([0, 2.1, 0.12], [0, 1, 0.08], [0, 0, -1]), off: 1, spine: [-14, 0, 0], chest: [-10, 0, 0], head: [-16, 0, 0], thighL: [-30, 0, 8], shinL: [60, 0, 0], thighR: [10, 0, -8], shinR: [30, 0, 0] }, Ease.outBack],
    ], { fadeIn: 0.05, fadeOut: 0.1 }),
    ultSlam: clip('ultSlam', base, [
      [0, { wR: two([0, 2.1, 0.12], [0, 1, 0.08], [0, 0, -1]), off: 1, spine: [-14, 0, 0], chest: [-10, 0, 0], head: [-16, 0, 0], thighL: [-30, 0, 8], shinL: [60, 0, 0], thighR: [10, 0, -8], shinR: [30, 0, 0] }],
      [0.12, { wR: two([0, 0.5, 0.8], [0, -0.5, 0.86], [0, 0.86, 0.5]), off: 1, spine: [40, 0, 0], chest: [18, 0, 0], head: [-26, 0, 0], hips: [0, -0.3, 0.18], thighL: [-78, 0, 10], shinL: [110, 0, 0], footL: [-24, 0, 0], thighR: [18, 0, -10], shinR: [76, 0, 0] }, Ease.inCubic],
      [0.55, { wR: two([0, 0.52, 0.8], [0, -0.48, 0.87], [0, 0.87, 0.48]), off: 1, spine: [38, 0, 0], chest: [16, 0, 0], head: [-24, 0, 0], hips: [0, -0.28, 0.16], thighL: [-76, 0, 10], shinL: [106, 0, 0], footL: [-24, 0, 0], thighR: [16, 0, -10], shinR: [74, 0, 0] }],
      [0.9, { ...legsIdle, wR: two([-0.24, 1.36, 0.26], [0.08, 0.38, -0.92], [-1, 0, 0]) }, Ease.inOut],
    ], { events: [{ t: 0.12, id: 'slam' }], fadeIn: 0.02, fadeOut: 0.2 }),
  };

  return { idle, runArms, airArms, flyArms, armSwing: [1, 0], offhandLoco: 0, runLean: 4, clips };
}
