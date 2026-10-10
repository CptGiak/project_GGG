import * as THREE from 'three';
import { gradientToon, holoMaterial, neon, toon } from '../render/toon';
import { Rig, bodySpec } from '../fighter/Rig';
import { ModelBuilder } from '../fighter/ModelBuilder';
import { ClothChain, ClothSheet } from '../fighter/Cloth';
import { clip, Ease, pose, type PoseSpec, type WeaponSpec } from '../fighter/Animator';
import type { ChampionAnimSet } from '../fighter/locomotion';
import { cyl, ellipsoid, extrude, hairLock, lathe, limb, sweep, torus, xf } from '../fighter/shapes';
import { addDominoMask, addFace, addODMGear, addSpikyHair, buildBody, makeBodySpheres, type SpikeSpec } from './body';
import { assembleVisual, marker, sharedClips, weaponPivot } from './common';
import type { ChampionVisual } from './types';
import { addAnimeEyes, eyeMaterial, type EyeStyle } from './face';

const SERA_EYES: EyeStyle = {
  sclera: 0xfbf8ff, irisTop: 0x4a2290, irisBottom: 0xd2a6ff, pupil: 0x1a0a2e, lash: 0x2a1230, brow: null,
  glow: 0.2, female: true, x: 0.047, y: 0.1195, h: 0.036, tilt: 0.06, gaze: 0.05,
};

/**
 * SERA — "Holo Diva". Ranged caster idol.
 * Gold→lavender twin-tails, white masquerade mask, white & gold stage dress with a flowing
 * cloth skirt over a holographic petticoat, bell sleeves, floating holo halo, and ENCORE:
 * a microphone scepter with orbiting rings and a ribbon.
 */
export function buildSera(): ChampionVisual {
  const M: Record<string, THREE.Material> = {
    skin: toon({ color: 0xfbe0cf, shade: 0xffc8c8, rim: 0.3 }),
    skinDark: toon({ color: 0xc07070, rim: 0 }),
    hair: toon({ color: 0xffd56b, shade: 0xe0a8ff, hairBand: 0.4, rim: 0.5 }),
    eyes: eyeMaterial(SERA_EYES),
    dress: toon({ color: 0xf6f2fb, shade: 0xc8b8ff, rim: 0.45 }),
    dressIn: toon({ color: 0xd8c6ff, side: THREE.BackSide, rim: 0.2 }),
    pink: toon({ color: 0xff6fcf, shade: 0xffa8e8, rim: 0.4 }),
    pinkFront: toon({ color: 0xff6fcf, rim: 0.3 }),
    boot: toon({ color: 0xf4f0fa, shade: 0xc8b8ff, spec: 0.4, rim: 0.4 }),
    sole: toon({ color: 0xf3c24f, spec: 0.5 }),
    glove: toon({ color: 0xf8f6fc, rim: 0.3 }),
    gold: toon({ color: 0xf3c24f, spec: 0.85, specSize: 0.88, shade: 0xffd2a0, rim: 0.4 }),
    mask: toon({ color: 0xfaf8ff, spec: 0.7, specSize: 0.92 }),
    metal: toon({ color: 0xd8dbe8, spec: 0.8 }),
    gearBody: toon({ color: 0xe8e4f2, spec: 0.4, rim: 0.4 }),
    gearAccent: toon({ color: 0xf3c24f, spec: 0.6 }),
    neonPink: neon(0xff7ad9, 2.8),
    neonCyan: neon(0x7af6ff, 2.6),
    gearGlow: neon(0xff7ad9, 1.6),
    holo: holoMaterial(0xff7ad9, 0x7af6ff, { intensity: 1.4, scan: 50, glitch: 0.4 }),
    halo: holoMaterial(0x7af6ff, 0xff7ad9, { intensity: 2.2, scan: 20, glitch: 0.6 }),
  };

  const rig = new Rig(bodySpec('female'));
  const B = rig.byName;
  const s = rig.spec;
  const b = new ModelBuilder(M);

  buildBody(b, rig, { skin: 'skin', top: 'dress', abdomen: 'dress', pelvis: 'dress', pants: 'boot', boots: 'boot', bootSole: 'sole', sleeve: 'skin', forearm: 'skin', glove: 'glove' }, { bareUpperArm: true, bareForearm: true, bareThigh: true, bust: 1 });

  // --- bodice details ------------------------------------------------------------------------------
  // sweetheart neckline trim (gold) + pink bow at the chest
  b.add(B.chest, sweep([new THREE.Vector3(0.12, 0.17, 0.06), new THREE.Vector3(0.06, 0.15, 0.115), new THREE.Vector3(0, 0.12, 0.118), new THREE.Vector3(-0.06, 0.15, 0.115), new THREE.Vector3(-0.12, 0.17, 0.06)], () => 0.008, 5, 16), 'gold', 0.5);
  for (const sx of [1, -1]) b.add(B.chest, xf(ellipsoid(0.045, 0.028, 0.02), [sx * 0.04, 0.115, 0.125], [0, 0, sx * 25]), 'pink', 0.6);
  b.add(B.chest, xf(ellipsoid(0.016, 0.02, 0.016), [0, 0.112, 0.13]), 'gold', 0.5);
  b.add(B.chest, xf(new THREE.OctahedronGeometry(0.014), [0, 0.085, 0.13], [0, 0, 0], [0.8, 1.3, 0.6]), 'neonPink', 0);
  // corset lines
  for (const sx of [1, -1]) b.add(B.spine, sweep([new THREE.Vector3(sx * 0.05, -0.06, 0.082), new THREE.Vector3(sx * 0.045, 0.06, 0.08), new THREE.Vector3(sx * 0.055, 0.17, 0.09)], () => 0.004, 4, 8), 'gold', 0);
  // waist sash
  b.add(B.hips, xf(torus(0.15, 0.022, 6, 28), [0, 0.08, 0], [90, 0, 0], [1.06, 0.72, 1]), 'pink', 0.6);
  // shoulder frills (off-shoulder ribbons)
  for (const sx of [1, -1]) {
    b.add(B.chest, xf(torus(0.06, 0.018, 6, 16, Math.PI * 1.2), [sx * 0.15, 0.17, 0], [0, 90, -110 * sx], [1, 1, 0.7]), 'dress', 0.6);
  }
  // choker with star
  b.add(B.neck, xf(torus(0.043, 0.007, 5, 18), [0, 0.0, 0], [90, 0, 0]), 'pink', 0.4);
  b.add(B.neck, xf(new THREE.OctahedronGeometry(0.013), [0, -0.005, 0.048], [0, 0, 45]), 'gold', 0.4);

  // --- bell sleeves (detached, from the elbow) -----------------------------------------------------
  for (const side of ['L', 'R'] as const) {
    const fa = B[`foreArm${side}`];
    const prof: [number, number][] = [[0.046, 0.0], [0.05, -0.06], [0.058, -0.12], [0.072, -0.17], [0.088, -0.205]];
    const sleeve = lathe(prof, 18);
    b.add(fa, sleeve, 'dress');
    b.add(fa, sleeve.clone(), 'dressIn', 0);
    // ruffled hem: a wavy gold-trimmed frill instead of a plain hoop
    const frill: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const r = 0.09 + Math.sin(a * 9) * 0.006;
      frill.push(new THREE.Vector3(Math.cos(a) * r, -0.207 + Math.cos(a * 9) * 0.007, Math.sin(a) * r));
    }
    b.add(fa, sweep(frill, () => 0.0065, 5, 96, false), 'gold', 0.4);
    b.add(fa, xf(torus(0.048, 0.008, 5, 16), [0, 0.0, 0], [90, 0, 0]), 'pink', 0.4);
  }
  // thigh-high boot tops
  for (const side of ['L', 'R'] as const) {
    const th = B[`thigh${side}`];
    b.add(th, xf(limb(s.thigh * 0.55, 0.074, 0.06, { capTop: 0.15, capBottom: 0.4, sz: 1.04 }), [0, -s.thigh * 0.45, 0]), 'boot');
    b.add(th, xf(torus(0.074, 0.008, 5, 18), [0, -s.thigh * 0.45, 0], [90, 0, 0]), 'gold', 0.4);
  }

  // --- petticoat (holo) + cloth skirt ----------------------------------------------------------------
  b.add(B.hips, xf(cyl(0.16, 0.27, 0.22, 20, true), [0, -0.06, 0]), 'holo', 0, false);
  b.add(B.hips, xf(torus(0.27, 0.008, 5, 30), [0, -0.17, 0], [90, 0, 0]), 'neonCyan', 0);
  const spheres = makeBodySpheres(rig);
  const cols = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const back = (1 - Math.cos(a)) / 2;
    cols.push({
      offset: new THREE.Vector3(Math.sin(a) * 0.17, 0.06, Math.cos(a) * 0.13),
      restDir: new THREE.Vector3(Math.sin(a) * 0.75, -1, Math.cos(a) * 0.62),
      length: 0.3 + back * 0.08,
    });
  }
  const skirt = new ClothSheet({
    anchor: B.hips,
    columns: cols,
    rows: 3,
    closed: true,
    stiffness: 0.11,
    stiffFalloff: 0.4,
    damping: 0.9,
    gravity: 8,
    thickness: 0.016,
    outer: M.dress,
    inner: M.pinkFront,
    smoothH: 2,
    smoothV: 2,
    slackH: 1.35,
  }, spheres);

  // big bow at the back + ribbon tails
  for (const sx of [1, -1]) b.add(B.hips, xf(torus(0.06, 0.02, 6, 16), [sx * 0.06, 0.08, -0.15], [0, sx * 30, 90], [1.3, 0.75, 1]), 'pink', 0.7);
  b.add(B.hips, xf(ellipsoid(0.025, 0.03, 0.022), [0, 0.08, -0.155]), 'gold', 0.5);
  const ribbon = (sx: number) =>
    new ClothChain({
      anchor: B.hips,
      offset: new THREE.Vector3(sx * 0.03, 0.06, -0.16),
      restDir: new THREE.Vector3(sx * 0.15, -1, -0.25),
      segments: 7,
      length: 0.8,
      stiffness: 0.035,
      damping: 0.92,
      gravity: 7,
      render: 'ribbon',
      size: (t) => 0.032 * (1 - t * 0.2),
      thickness: 0.006,
      side: new THREE.Vector3(1, 0, 0),
      material: gradientToon({ color: 0xff6fcf, colorB: 0x7af6ff, side: THREE.DoubleSide, rim: 0.3, from: 0.4, to: 1 }),
    }, spheres);

  // --- ODM gear (white & gold variant) ------------------------------------------------------------
  const gear = addODMGear(b, rig, { body: 'gearBody', accent: 'gearAccent', glow: 'gearGlow' });

  // --- head: masquerade, hair, halo ------------------------------------------------------------------
  addDominoMask(b, B.head, 'mask', null, 'elegant', true);
  addFace(b, B.head, 'skinDark', true);
  const eyes = addAnimeEyes(b, B.head, 'eyes', SERA_EYES);
  for (const sx of [1, -1]) b.add(B.head, xf(new THREE.OctahedronGeometry(0.012), [sx * 0.115, 0.15, 0.08], [0, 0, 45]), 'neonPink', 0);
  const spikes: SpikeSpec[] = [
    { at: [0, 1, 0.05], len: 0.08, r: 0.05, bend: [0, -0.02, -0.05], flat: 0.55 },
    { at: [0.4, 0.85, -0.2], len: 0.08, r: 0.05, bend: [0.02, -0.04, -0.04], flat: 0.55 },
    { at: [-0.4, 0.85, -0.2], len: 0.08, r: 0.05, bend: [-0.02, -0.04, -0.04], flat: 0.55 },
    { at: [0, 0.7, -0.7], len: 0.1, r: 0.06, bend: [0, -0.06, -0.03] },
    { at: [0.5, 0.3, -0.75], len: 0.12, r: 0.05, bend: [0.02, -0.09, 0] },
    { at: [-0.5, 0.3, -0.75], len: 0.12, r: 0.05, bend: [-0.02, -0.09, 0] },
  ];
  addSpikyHair(b, B.head, 'hair', spikes, true, 1.03);
  // straight bangs + long side locks
  for (let i = -3; i <= 3; i++) {
    const x = i * 0.026;
    b.add(B.head, xf(hairLock(0.11 - Math.abs(i) * 0.008, 0.024, 0.01, [0, 0, 0.02]), [x, 0.225 - Math.abs(i) * 0.004, 0.09 - Math.abs(i) * 0.008], [180 - 18, i * 6, 0]), 'hair', 0.5);
  }
  for (const sx of [1, -1]) {
    b.add(B.head, xf(hairLock(0.26, 0.032, 0.012, [sx * 0.01, 0, 0.04]), [sx * 0.096, 0.2, 0.05], [180 - 4, 0, sx * -4]), 'hair', 0.6);
    // twin-tail ties (pink bows)
    b.add(B.head, xf(ellipsoid(0.035, 0.022, 0.018), [sx * 0.105, 0.21, -0.05], [0, 0, sx * 30]), 'pink', 0.6);
    b.add(B.head, xf(torus(0.022, 0.007, 5, 12), [sx * 0.1, 0.2, -0.06], [0, 90, 0]), 'gold', 0.4);
  }
  // halo (rotates in tick)
  const halo = new THREE.Group();
  halo.position.set(0, 0.2, -0.17);
  halo.rotation.x = -0.35;
  B.head.add(halo);
  b.add(halo, torus(0.17, 0.008, 6, 40), 'neonPink', 0);
  b.add(halo, torus(0.2, 0.004, 4, 40), 'neonCyan', 0);
  b.add(halo, xf(new THREE.RingGeometry(0.15, 0.22, 40, 1), [0, 0, 0]), 'halo', 0, false);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add(halo, xf(new THREE.OctahedronGeometry(0.014), [Math.cos(a) * 0.185, Math.sin(a) * 0.185, 0]), 'gold', 0);
  }

  // --- weapon: ENCORE mic scepter ------------------------------------------------------------------------
  const w = weaponPivot(B.handR, true);
  b.add(w, xf(cyl(0.016, 0.016, 1.15, 10), [0, 0, 0.2], [90, 0, 0]), 'metal', 0.7);
  for (const z of [-0.3, 0.0, 0.35, 0.6]) b.add(w, xf(torus(0.019, 0.005, 5, 12), [0, 0, z]), 'gold', 0.3);
  b.add(w, xf(new THREE.OctahedronGeometry(0.03), [0, 0, -0.4], [0, 0, 45], [1, 1, 1.4]), 'gold', 0.6);
  // mic head
  const mic = new THREE.Group();
  mic.position.set(0, 0, 0.86);
  w.add(mic);
  b.add(mic, ellipsoid(0.068, 0.068, 0.068, 18, 14), 'metal', 0.8);
  b.add(mic, xf(torus(0.07, 0.01, 6, 22), [0, 0, -0.01], [0, 0, 0]), 'gold', 0.5);
  b.add(mic, ellipsoid(0.05, 0.05, 0.05, 14, 10), 'neonPink', 0);
  b.add(mic, xf(cyl(0.03, 0.05, 0.06, 14), [0, 0, -0.08], [90, 0, 0]), 'gold', 0.6);
  // gold wings around the mic
  for (const sx of [1, -1]) {
    const wing = new THREE.Shape();
    wing.moveTo(0, 0);
    wing.quadraticCurveTo(0.08, 0.02, 0.12, 0.1);
    wing.quadraticCurveTo(0.07, 0.07, 0.05, 0.12);
    wing.quadraticCurveTo(0.04, 0.05, 0, 0.03);
    wing.closePath();
    b.add(mic, xf(extrude(wing, 0.008, 0.002, 8), [sx * 0.04, 0, -0.04], [90, 0, 0], [sx, 1, 1]), 'gold', 0.6);
  }
  // orbiting rings
  const rings = new THREE.Group();
  mic.add(rings);
  b.add(rings, torus(0.11, 0.006, 5, 30), 'neonCyan', 0);
  const rings2 = new THREE.Group();
  mic.add(rings2);
  b.add(rings2, xf(torus(0.13, 0.005, 5, 30), [0, 0, 0], [70, 0, 0]), 'neonPink', 0);
  const muzzle = marker(mic, 0, 0, 0.06, 'muzzle');
  // staff ribbon
  const staffRibbon = new ClothChain({
    anchor: mic,
    offset: new THREE.Vector3(0, 0, -0.1),
    restDir: new THREE.Vector3(0, -1, -0.3),
    segments: 6,
    length: 0.55,
    stiffness: 0.03,
    damping: 0.92,
    gravity: 6,
    render: 'ribbon',
    size: (t) => 0.022 * (1 - t * 0.3),
    thickness: 0.005,
    side: new THREE.Vector3(1, 0, 0),
    material: gradientToon({ color: 0xff6fcf, colorB: 0x7af6ff, side: THREE.DoubleSide, rim: 0.3, from: 0.2, to: 1 }),
  }, []);

  // --- twin tails ---------------------------------------------------------------------------------------
  const headSphere = { bone: B.head, offset: new THREE.Vector3(0, 0.11, 0.0), radius: 0.125, world: new THREE.Vector3() };
  const tail = (sx: number) =>
    new ClothChain({
      anchor: B.head,
      offset: new THREE.Vector3(sx * 0.11, 0.2, -0.07),
      restDir: new THREE.Vector3(sx * 0.3, -1, -0.65),
      segments: 8,
      length: 0.95,
      stiffness: 0.035,
      stiffFalloff: 0.85,
      damping: 0.91,
      gravity: 9,
      render: 'tube',
      size: (t) => 0.05 * (1 - t * 0.7) + 0.012 * Math.sin(t * Math.PI),
      material: gradientToon({ color: 0xffd56b, colorB: 0xb79cff, shade: 0xe0a8ff, spec: 0.25, specSize: 0.92, rim: 0.45, from: 0.45, to: 1.0 }),
      radial: 7,
    }, [...spheres, headSphere]);

  const anims = seraAnims();
  return assembleVisual({
    rig,
    builder: b,
    cloth: [skirt, ribbon(1), ribbon(-1), tail(1), tail(-1), staffRibbon],
    bodySpheres: [...spheres, headSphere],
    blades: [],
    gear,
    weaponR: w,
    weaponL: null,
    offhandGrip: null,
    muzzle,
    materials: Object.values(M),
    anims,
    eyes,
    tick: (dt, t, energy) => {
      halo.rotation.z += dt * 0.6;
      halo.position.y = 0.2 + Math.sin(t * 2) * 0.01;
      rings.rotation.x += dt * (1.5 + energy * 3);
      rings.rotation.y += dt * 1.1;
      rings2.rotation.z += dt * (2 + energy * 3);
    },
  });
}

function seraAnims(): ChampionAnimSet {
  const W = (p: [number, number, number], d: [number, number, number], u: [number, number, number] = [0, 0, -1]): WeaponSpec => ({ p, d, u });
  const legs: PoseSpec = {
    hips: [0, -0.01, 0],
    thighL: [-6, -6, 3], shinL: [8, 0, 0], footL: [-4, 6, 0],
    thighR: [4, 18, -6], shinR: [14, 0, 0], footR: [-6, -12, 4],
    spine: [0, 14, -3], chest: [-4, 8, 2], neck: [0, -10, 0], head: [-2, -12, 4],
  };
  // staff upright at the side, left hand on the hip
  const idle = pose({
    ...legs,
    wR: W([-0.27, 1.0, 0.16], [0.04, 0.98, 0.16]),
    upperArmL: [12, -20, 38], foreArmL: [-95, 0, 0], handL: [0, 0, 20],
  });
  const runArms = pose({ wR: W([-0.3, 0.92, -0.05], [-0.15, -0.2, -0.97], [0, 1, 0]), upperArmL: [0, 0, 14], foreArmL: [-70, 0, 0] });
  const airArms = pose({ wR: W([-0.42, 1.12, 0.05], [-0.4, 0.5, -0.76], [0, 1, 0]), upperArmL: [-20, 0, 60], foreArmL: [-30, 0, 0] });
  const flyArms = pose({ wR: W([-0.3, 0.98, -0.18], [-0.15, -0.1, -0.98], [0, 1, 0]), upperArmL: [30, 0, 40], foreArmL: [-40, 0, 0] });
  const castSpec: PoseSpec = { ...legs, spine: [2, 2, 0], chest: [0, 2, 0], head: [4, -4, 0], wR: W([-0.2, 1.36, 0.42], [0, 0.05, 1], [0, 1, 0]), upperArmL: [-40, 0, 30], foreArmL: [-50, 0, 0] };
  const base = pose(legs);
  const clips = {
    ...sharedClips(idle),
    cast: clip('cast', base, [
      [0, { ...castSpec, wR: W([-0.24, 1.42, 0.3], [0, 0.4, 0.92], [0, 1, 0]) }],
      [0.08, castSpec, Ease.outQuart],
      [0.3, castSpec],
    ], { events: [{ t: 0.07, id: 'fire' }], fadeIn: 0.05, fadeOut: 0.2 }),
    aim: clip('aim', base, [[0, castSpec], [0.5, castSpec]], { fadeIn: 0.07, fadeOut: 0.2 }),
    // signature skill: High Note – the scepter swings back over the shoulder and lobs the note forward
    lob: clip('lob', base, [
      [0, { ...legs, wR: W([-0.3, 1.62, -0.12], [-0.1, 0.7, -0.7], [0, 0.7, 0.7]), upperArmL: [-60, 0, 40], foreArmL: [-40, 0, 0], spine: [-12, -16, 0], chest: [-10, -12, 0], head: [-6, 10, 0], hips: [0, 0.02, -0.04], thighL: [-14, -6, 4], shinL: [16, 0, 0], thighR: [14, 18, -6], shinR: [20, 0, 0] }],
      [0.12, { wR: W([-0.22, 1.82, 0.22], [0, 0.98, 0.2], [0, 0.2, -0.98]), upperArmL: [-30, 0, 50], foreArmL: [-30, 0, 0], spine: [-4, 6, 0], chest: [-4, 6, 0], head: [-10, 0, 0], hips: [0, 0.04, 0.04], thighL: [-30, -6, 4], shinL: [36, 0, 0], thighR: [10, 18, -6], shinR: [18, 0, 0] }, Ease.outCubic],
      [0.2, { wR: W([-0.18, 1.3, 0.56], [0, 0.2, 0.98], [0, 1, -0.2]), upperArmL: [10, 0, 50], foreArmL: [-20, 0, 0], spine: [14, 12, 0], chest: [8, 10, 0], head: [-14, -4, 0], hips: [0, -0.06, 0.1], thighL: [-40, -6, 4], shinL: [50, 0, 0], thighR: [16, 18, -6], shinR: [24, 0, 0] }, Ease.outQuart],
      [0.5, { ...castSpec }, Ease.inOut],
    ], { events: [{ t: 0.05, id: 'swing' }, { t: 0.15, id: 'release' }], fadeIn: 0.05, fadeOut: 0.2 }),
    wave: clip('wave', base, [
      [0, { ...legs, wR: W([-0.15, 1.75, 0.2], [0, 0.95, 0.3]), upperArmL: [-150, 0, 30], foreArmL: [-20, 0, 0], spine: [-10, 0, 0], chest: [-8, 0, 0], hips: [0, 0.04, 0] }],
      [0.14, { wR: W([-0.12, 0.62, 0.42], [0.02, -0.98, 0.2], [0, 0, 1]), upperArmL: [-20, 0, 70], foreArmL: [-10, 0, 0], spine: [24, 0, 0], chest: [10, 0, 0], hips: [0, -0.22, 0.05], thighL: [-60, 0, 14], shinL: [90, 0, 0], thighR: [10, 0, -14], shinR: [70, 0, 0] }, Ease.inCubic],
      [0.55, { ...legs, wR: W([-0.27, 1.0, 0.16], [0.04, 0.98, 0.16]) }, Ease.inOut],
    ], { events: [{ t: 0.14, id: 'wave' }], fadeIn: 0.05, fadeOut: 0.2 }),
    // taunt: idol pose – staff up, peace sign, hip sway and a little hop
    taunt: clip('taunt', base, [
      [0, { ...legs, wR: W([-0.27, 1.0, 0.16], [0.04, 0.98, 0.16]) }],
      [0.25, { wR: W([-0.3, 1.55, 0.15], [-0.25, 0.95, 0.1]), upperArmL: [-60, -40, 40], foreArmL: [-120, 0, 0], handL: [0, -30, 0], spine: [0, 10, 10], chest: [-4, 6, 6], head: [0, -14, -12], hips: [0, 0.06, 0], thighL: [-20, 0, 4], shinL: [40, 0, 0], thighR: [6, 18, -6], shinR: [16, 0, 0] }, Ease.outBack],
      [0.45, { wR: W([-0.3, 1.5, 0.15], [-0.2, 0.96, 0.1]), upperArmL: [-60, -40, 40], foreArmL: [-120, 0, 0], handL: [0, -30, 0], spine: [0, 10, -8], chest: [-4, 6, -6], head: [0, -14, 10], hips: [0, -0.01, 0], thighL: [-6, -6, 3], shinL: [8, 0, 0], thighR: [4, 18, -6], shinR: [14, 0, 0] }],
      [0.7, { wR: W([-0.3, 1.55, 0.15], [-0.25, 0.95, 0.1]), upperArmL: [-60, -40, 40], foreArmL: [-120, 0, 0], handL: [0, -30, 0], spine: [0, 10, 10], chest: [-4, 6, 6], head: [0, -14, -12], hips: [0, -0.01, 0], thighL: [-6, -6, 3], shinL: [8, 0, 0], thighR: [4, 18, -6], shinR: [14, 0, 0] }],
      [0.95, { wR: W([-0.3, 1.5, 0.15], [-0.2, 0.96, 0.1]), upperArmL: [-60, -40, 40], foreArmL: [-120, 0, 0], handL: [0, -30, 0], spine: [0, 10, -8], chest: [-4, 6, -6], head: [0, -14, 10], hips: [0, -0.01, 0], thighL: [-6, -6, 3], shinL: [8, 0, 0], thighR: [4, 18, -6], shinR: [14, 0, 0] }],
      [1.2, { wR: W([-0.3, 1.6, 0.15], [-0.25, 0.95, 0.1]), upperArmL: [-60, -40, 40], foreArmL: [-120, 0, 0], handL: [0, -30, 0], spine: [-6, 10, 0], chest: [-6, 6, 0], head: [-10, -14, -6], hips: [0, 0.1, 0], thighL: [-40, 0, 4], shinL: [80, 0, 0], thighR: [-10, 18, -6], shinR: [60, 0, 0] }, Ease.outQuad],
      [1.45, { wR: W([-0.3, 1.55, 0.15], [-0.25, 0.95, 0.1]), upperArmL: [-60, -40, 40], foreArmL: [-120, 0, 0], handL: [0, -30, 0], spine: [0, 10, 0], chest: [-4, 6, 0], head: [-4, -14, -8], hips: [0, -0.02, 0], thighL: [-8, -6, 3], shinL: [10, 0, 0], thighR: [4, 18, -6], shinR: [14, 0, 0] }, Ease.inQuad],
      [2.0, { ...legs, wR: W([-0.27, 1.0, 0.16], [0.04, 0.98, 0.16]) }, Ease.inOut],
    ], { events: [{ t: 0.25, id: 'sparkle' }, { t: 1.2, id: 'sparkle' }], fadeIn: 0.1, fadeOut: 0.25 }),
    ult: clip('ult', base, [
      [0, { ...legs, wR: W([-0.1, 2.0, 0.15], [0, 1, 0.1]), upperArmL: [-170, 0, 20], foreArmL: [-10, 0, 0], spine: [-14, 0, 0], chest: [-10, 0, 0], head: [-22, 0, 0], hips: [0, 0.05, 0] }],
      [0.6, { ...legs, wR: W([-0.1, 2.02, 0.15], [0, 1, 0.1]), upperArmL: [-170, 0, 20], foreArmL: [-10, 0, 0], spine: [-14, 0, 0], chest: [-10, 0, 0], head: [-22, 0, 0], hips: [0, 0.06, 0] }],
      [0.85, castSpec, Ease.outBack],
      [1.3, castSpec],
    ], { events: [{ t: 0.85, id: 'fire' }], fadeIn: 0.08, fadeOut: 0.25 }),
  };
  return { idle, runArms, airArms, flyArms, armSwing: [1, 0], offhandLoco: 0, runLean: 6, clips };
}
