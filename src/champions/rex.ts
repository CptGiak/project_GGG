import * as THREE from 'three';
import { bloomColor } from '../vfx/color';
import { equalizerMaterial, holoMaterial, neon, toon } from '../render/toon';
import { Rig, bodySpec } from '../fighter/Rig';
import { ModelBuilder } from '../fighter/ModelBuilder';
import { ClothChain } from '../fighter/Cloth';
import { applyPose, clip, Ease, pose, weaponQuat, type PoseSpec, type WeaponSpec } from '../fighter/Animator';
import type { ChampionAnimSet } from '../fighter/locomotion';
import { SecondOrder, SpringBone } from '../fighter/Springs';
import { cyl, ellipsoid, extrude, lathe, limb, noteGeometry, poly, rbox, sweep, torus, wrapOnBack, xf } from '../fighter/shapes';
import { addFace, addODMGear, addSpikyHair, addVisor, buildBody, makeBodySpheres, type SpikeSpec } from './body';
import { assembleVisual, marker, sharedClips, weaponPivot } from './common';
import type { ChampionVisual } from './types';
import { addAnimeEyes, eyeMaterial, type EyeStyle } from './face';
import { Beat } from '../core/Beat';

const REX_EYES: EyeStyle = {
  sclera: 0xf6f2fa, irisTop: 0x0a5a5a, irisBottom: 0x3ff0dc, pupil: 0x031a1a, lash: 0x08080c, brow: 0x17151d,
  glow: 0.3, female: false, y: 0.114, h: 0.023, tilt: 0.08, gaze: 0.04, browFierce: 0.05,
};

/** where the stock's butt plate sits on the barrel axis (weapon-local z): the recoil hinge */
const STOCK_Z = -0.37;

/**
 * REX — "The Headliner". Sharpshooter / producer.
 * Black hair with a teal undercut, purple holo shades, oversized purple hoodie with gold trim,
 * headphones around the neck, gold note chain, and HEADLINER: a bass-cannon rifle with
 * speaker-ring barrel, sub-woofer drum mag and a live equalizer side screen.
 *
 * Secondary motion: the hair spikes, headphones, pendant, bunched hood and cargo pockets ride on
 * spring bones; the hood drawstrings and the hip charm are relative-damped chains. The rifle's
 * speaker rings pump on every shot, the drum indexes round by round and spins up while charging,
 * the barrel heats from violet to gold, the equalizer jumps with the shots (cue()).
 */
export function buildRex(): ChampionVisual {
  const M: Record<string, THREE.Material> = {
    skin: toon({ color: 0xb47a56, shade: 0xffb8a8, rim: 0.35 }),
    skinDark: toon({ color: 0x5e3426, rim: 0 }),
    hair: toon({ color: 0x1c1a24, shade: 0xb0a8ff, hairBand: 0.42, rim: 0.6 }),
    eyes: eyeMaterial(REX_EYES),
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
    // the barrel's speaker rings heat up while firing: their own material
    ringGlow: neon(0xa46bff, 2.8),
    lens: holoMaterial(0xa46bff, 0xffc94a, { intensity: 1.5, scan: 80, glitch: 0.2 }),
    eq: equalizerMaterial(0xa46bff, 0xffc94a, 10, 2.8),
  };

  const rig = new Rig(bodySpec('heavy'));
  const B = rig.byName;
  const s = rig.spec;
  const b = new ModelBuilder(M);
  /** spring pivot: a child of `parent` at `at` (parts added to it are built relative to it) */
  const pivotAt = (parent: THREE.Object3D, at: [number, number, number], name: string) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(...at);
    parent.add(g);
    return g;
  };
  const rel = (g: THREE.BufferGeometry, p: THREE.Object3D) => g.translate(-p.position.x, -p.position.y, -p.position.z);

  buildBody(b, rig, { skin: 'skin', top: 'tee', pants: 'pants', boots: 'shoe', bootSole: 'sole', sleeve: 'hoodie', forearm: 'skin', glove: 'glove' }, { bareForearm: true, pecs: 1 });

  // --- oversized hoodie (open zip) --------------------------------------------------------------
  const cw = 0.158 * s.bulk;
  const hProf: [number, number][] = [[cw * 0.9 + 0.026, -0.06], [cw * 0.96 + 0.026, 0.04], [cw + 0.028, 0.12], [cw * 0.98 + 0.03, 0.17], [cw * 0.84 + 0.032, 0.215], [cw * 0.5 + 0.03, 0.25]];
  const hood = lathe(hProf, 22, 1.22, 0.72, 22, 316);
  b.add(B.chest, hood, 'hoodie');
  // back print: the Headliner crown over a big music note, neon underline
  {
    const onBack = (g: THREE.BufferGeometry, dy: number) => wrapOnBack(xf(g, [0, dy, 0]), hProf, 1.22, 0.72, 0.003);
    const crown = poly([-0.05, 0, 0.05, 0, 0.05, 0.03, 0.03, 0.012, 0.015, 0.042, 0, 0.016, -0.015, 0.042, -0.03, 0.012, -0.05, 0.03]);
    b.add(B.chest, onBack(xf(extrude(crown, 0.004, 0, 4), [0, 0, 0], [0, 0, 0], 0.85), 0.098), 'gold', 0.4);
    b.add(B.chest, onBack(xf(noteGeometry(0.3), [0.006, 0, 0]), -0.005), 'gold', 0.4);
    b.add(B.chest, onBack(extrude(poly([-0.055, 0, 0.055, 0, 0.05, 0.006, -0.05, 0.006]), 0.002, 0, 2), -0.058), 'neonViolet', 0);
  }
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
  // hood bunched at the back of the neck: bounces on a spring at the collar
  const hoodPivot = pivotAt(B.chest, [0, 0.232, -0.1], 'hoodBack');
  const hoodBack = new THREE.SphereGeometry(0.13, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
  // (xf transforms in place: give each layer its own copy)
  b.add(hoodPivot, xf(hoodBack.clone(), [0, 0, 0], [-120, 0, 0], [1.12, 0.78, 0.64]), 'hoodie');
  b.add(hoodPivot, xf(hoodBack.clone(), [0, 0, 0], [-120, 0, 0], [1.07, 0.74, 0.59]), 'hoodieIn', 0);
  // drawstring eyelets (the strings themselves are simulated chains, below)
  for (const sx of [1, -1]) b.add(B.chest, xf(torus(0.009, 0.003, 4, 10), [sx * 0.055, 0.236, 0.104], [70, 0, 0]), 'gold', 0.3);
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

  // headphones resting on the collarbones: one rigid piece on a stiff spring at the neck base
  const phones = pivotAt(B.chest, [0, 0.215, 0.02], 'headphones');
  b.add(phones, xf(torus(0.11, 0.014, 6, 24, Math.PI * 1.1), [0, 0, 0], [70, 0, -100]), 'black', 0.7);
  for (const sx of [1, -1]) {
    b.add(phones, xf(cyl(0.05, 0.05, 0.035, 16), [sx * 0.105, -0.015, 0.04], [0, 0, 90]), 'black', 0.9);
    b.add(phones, xf(torus(0.05, 0.008, 6, 16), [sx * 0.124, -0.015, 0.04], [0, 90, 0]), 'gold', 0.4);
    b.add(phones, xf(cyl(0.025, 0.025, 0.005, 12), [sx * 0.125, -0.015, 0.04], [0, 0, 90]), 'neonViolet', 0);
  }
  // gold chain; the music-note pendant swings from its lowest link
  b.add(B.chest, sweep([new THREE.Vector3(0.07, 0.235, 0.07), new THREE.Vector3(0.04, 0.16, 0.122), new THREE.Vector3(0, 0.13, 0.13), new THREE.Vector3(-0.04, 0.16, 0.122), new THREE.Vector3(-0.07, 0.235, 0.07)], () => 0.0065, 4, 16), 'gold', 0.4);
  const pendant = pivotAt(B.chest, [0, 0.13, 0.132], 'pendant');
  b.add(pendant, rel(xf(noteGeometry(0.22), [0.0, 0.105, 0.135]), pendant), 'gold', 0.5);
  // cargo pockets (they flap a little on the steps) + knee straps
  const pockets: THREE.Object3D[] = [];
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const pk = pivotAt(B[`thigh${side}`], [sx * 0.087, -0.165, 0], `pocket${side}`);
    pockets.push(pk);
    b.add(pk, rel(xf(rbox(0.04, 0.12, 0.1, 0.012), [sx * 0.085, -0.22, 0.0]), pk), 'pocket', 0.7);
    b.add(pk, rel(xf(rbox(0.042, 0.02, 0.06, 0.004), [sx * 0.087, -0.17, 0.0]), pk), 'gold', 0.3);
    b.add(B[`shin${side}`], xf(torus(0.06, 0.008, 5, 14), [0, -0.06, 0], [90, 0, 0]), 'black', 0.5);
  }

  // --- ODM gear ----------------------------------------------------------------------------------
  const gear = addODMGear(b, rig, { body: 'gearBody', accent: 'gold', glow: 'gearGlow' });

  // --- head ----------------------------------------------------------------------------------------
  addVisor(b, B.head, 'gold', 'lens', false, 0.036);
  addFace(b, B.head, 'skinDark', false);
  const eyes = addAnimeEyes(b, B.head, 'eyes', REX_EYES);
  // teal undercut sides
  // (flush with the skull so they read as shaved sides, not ear muffs)
  for (const sx of [1, -1]) b.add(B.head, xf(ellipsoid(0.014, 0.05, 0.075), [sx * 0.1, 0.152, -0.025], [0, 0, sx * 10]), 'teal', 0.4);
  // spikes in three groups (front, crown, back), each a stiff spring so the silhouette holds
  const hairFront = pivotAt(B.head, [0, 0.235, 0.06], 'hairFront');
  const hairTop = pivotAt(B.head, [0, 0.245, -0.03], 'hairTop');
  const hairBack = pivotAt(B.head, [0, 0.2, -0.09], 'hairBack');
  const spikes: SpikeSpec[] = [
    { at: [0, 1, 0.35], len: 0.14, r: 0.05, bend: [0, 0.02, -0.08], pivot: hairFront },
    { at: [0.2, 1, 0.15], len: 0.15, r: 0.05, bend: [0.02, 0.0, -0.1], pivot: hairTop },
    { at: [-0.2, 1, 0.15], len: 0.15, r: 0.05, bend: [-0.02, 0.0, -0.1], pivot: hairTop },
    { at: [0, 0.95, -0.2], len: 0.16, r: 0.055, bend: [0, -0.02, -0.12], pivot: hairBack },
    { at: [0.18, 0.85, -0.45], len: 0.13, r: 0.05, bend: [0.02, -0.05, -0.08], pivot: hairBack },
    { at: [-0.18, 0.85, -0.45], len: 0.13, r: 0.05, bend: [-0.02, -0.05, -0.08], pivot: hairBack },
    { at: [0.1, 0.92, 0.5], len: 0.12, r: 0.04, bend: [0.0, 0.03, 0.04], flat: 0.55, pivot: hairFront },
  ];
  addSpikyHair(b, B.head, 'hair', spikes, false, 0.97);
  b.add(B.head, xf(torus(0.012, 0.0035, 5, 12), [0.112, 0.085, -0.005], [0, 90, 0]), 'gold', 0.3);
  b.add(B.head, xf(torus(0.012, 0.0035, 5, 12), [-0.112, 0.085, -0.005], [0, 90, 0]), 'gold', 0.3);

  // --- weapon: HEADLINER ------------------------------------------------------------------------------
  const w = weaponPivot(B.handR);
  b.add(w, xf(rbox(0.09, 0.13, 0.52, 0.025), [0, 0.06, 0.12]), 'black');
  b.add(w, xf(rbox(0.094, 0.05, 0.4, 0.015), [0, 0.1, 0.14]), 'gunPurple', 0.8);
  // stock: length of pull 0.37 m (grip -> butt plate), sized for Rex's reach
  b.add(w, xf(rbox(0.07, 0.1, 0.24, 0.02), [0, 0.035, -0.235], [6, 0, 0]), 'gunPurple');
  b.add(w, xf(rbox(0.075, 0.13, 0.04, 0.01), [0, 0.025, STOCK_Z], [6, 0, 0]), 'black', 0.8);
  b.add(w, xf(cyl(0.045, 0.048, 0.46, 16), [0, 0.07, 0.6], [90, 0, 0]), 'black');
  // speaker rings: each on its own pivot so a shot can pump them in a wave toward the muzzle
  const rings: THREE.Object3D[] = [];
  for (const [i, z] of [0.46, 0.6, 0.74].entries()) {
    const rp = pivotAt(w, [0, 0.07, z], `ring${i}`);
    rings.push(rp);
    b.add(rp, torus(0.063 - i * 0.004, 0.012, 6, 20), 'ringGlow', 0);
  }
  b.add(w, xf(torus(0.058, 0.01, 6, 20), [0, 0.07, 0.84]), 'gold', 0.5);
  b.add(w, xf(lathe([[0.045, 0.0], [0.07, 0.06], [0.074, 0.09], [0.06, 0.1], [0.04, 0.05]], 18), [0, 0.07, 0.83], [90, 0, 0]), 'black', 0.8);
  // sub-woofer drum magazine (indexes round by round, spins while charging); the support hand
  // holds it
  const drum = pivotAt(w, [0, -0.075, 0.16], 'drum');
  b.add(drum, xf(cyl(0.085, 0.085, 0.07, 20), [0, 0, 0], [0, 0, 90]), 'black', 0.9);
  for (const sx of [1, -1]) {
    b.add(drum, xf(lathe([[0.075, 0.0], [0.05, -0.012], [0.02, -0.018], [0.0, -0.016]], 16), [sx * 0.036, 0, 0], [0, 0, sx * 90]), 'gunPurple', 0.6);
    b.add(drum, xf(cyl(0.02, 0.02, 0.006, 12), [sx * 0.04, 0, 0], [0, 0, 90]), 'neonGold', 0);
    // index notches: the indexing reads on the rim
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      b.add(drum, xf(rbox(0.012, 0.008, 0.014, 0.002), [sx * 0.03, Math.cos(a) * 0.086, Math.sin(a) * 0.086], [(-a * 180) / Math.PI, 0, 0]), 'gold', 0);
    }
  }
  for (const sx of [1, -1]) {
    // live equalizer side screen
    b.add(w, xf(new THREE.PlaneGeometry(0.26, 0.06), [sx * 0.0465, 0.055, 0.12], [0, sx * 90, 0]), 'eq', 0, false);
  }
  // pistol grip
  b.add(w, xf(rbox(0.036, 0.12, 0.05, 0.012), [0, -0.035, -0.02], [-14, 0, 0]), 'glove', 0.7);
  // scope + gold trims
  b.add(w, xf(cyl(0.026, 0.026, 0.16, 12), [0, 0.165, 0.12], [90, 0, 0]), 'black', 0.7);
  b.add(w, xf(cyl(0.022, 0.022, 0.004, 12), [0, 0.165, 0.202], [90, 0, 0]), 'neonViolet', 0);
  for (const sx of [1, -1]) b.add(w, xf(rbox(0.004, 0.012, 0.46, 0.002), [sx * 0.047, 0.11, 0.13]), 'gold', 0);
  const muzzle = marker(w, 0, 0.07, 0.95, 'muzzle');
  // support hand: wrist over the drum's left speaker, fingers wrapping down its side
  const offhand = marker(w, 0.045, 0.012, 0.16, 'offhand');
  marker(w, 0, 0.03, STOCK_Z, 'stock');
  // muzzle orb (camera-facing): the "Lead Single ready" pulse, the Bass Charge orb, its perfect
  // glint and overcharge flicker; and the approach ring that closes onto it exactly at full charge
  const orbMat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 0.05 }, uOffset: { value: new THREE.Vector3() }, uCore: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() }, uAlpha: { value: 0 }, uGlint: { value: 0 }, uTime: { value: 0 } },
    vertexShader: BILLBOARD_VERT,
    fragmentShader: ORB_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const quad = new THREE.PlaneGeometry(2, 2);
  const orb = new THREE.Mesh(quad, orbMat);
  orb.position.copy(muzzle.position);
  orb.frustumCulled = false;
  orb.renderOrder = 22;
  orb.userData.noGhost = true;
  w.add(orb);
  const approachMat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 1.6 }, uOffset: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uThick: { value: 0.06 } },
    vertexShader: BILLBOARD_VERT,
    fragmentShader: APPROACH_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const approach = new THREE.Mesh(quad, approachMat);
  approach.position.copy(muzzle.position);
  approach.frustumCulled = false;
  approach.renderOrder = 22;
  approach.visible = false;
  approach.userData.noGhost = true;
  w.add(approach);

  // --- secondary motion -------------------------------------------------------------------------------
  const spheres = makeBodySpheres(rig);
  const springs = [
    new SpringBone({ pivot: hairFront, restDir: new THREE.Vector3(0.05, 0.9, 0.45), length: 0.09, freq: 6.5, zeta: 0.5, gravity: 0, maxAngle: 10, drag: 0.2 }),
    new SpringBone({ pivot: hairTop, restDir: new THREE.Vector3(0, 1, 0.15), length: 0.1, freq: 6, zeta: 0.5, gravity: 0, maxAngle: 10, drag: 0.2 }),
    new SpringBone({ pivot: hairBack, restDir: new THREE.Vector3(0, 0.85, -0.5), length: 0.1, freq: 5, zeta: 0.5, gravity: 0, maxAngle: 12, drag: 0.2 }),
    new SpringBone({ pivot: phones, restDir: new THREE.Vector3(0, -0.3, 1), length: 0.05, freq: 7, zeta: 0.4, gravity: 0.2, maxAngle: 8 }),
    new SpringBone({ pivot: pendant, restDir: new THREE.Vector3(0, -1, 0.12), length: 0.035, freq: 2.2, zeta: 0.2, gravity: 1, maxAngle: 35, drag: 0.3 }),
    new SpringBone({ pivot: hoodPivot, restDir: new THREE.Vector3(0, -0.4, -1), length: 0.07, freq: 3.5, zeta: 0.4, gravity: 0.5, maxAngle: 10 }),
    ...pockets.map((pk) => new SpringBone({ pivot: pk, restDir: new THREE.Vector3(0, -1, 0), length: 0.06, freq: 8, zeta: 0.35, gravity: 0.3, maxAngle: 6 })),
  ];
  // hood drawstrings: light chains hanging down the chest, heavier aglet at the tip
  const strings = [1, -1].map((sx) => new ClothChain({
    anchor: B.chest,
    offset: new THREE.Vector3(sx * 0.055, 0.233, 0.105),
    restDir: new THREE.Vector3(sx * 0.04, -1, 0.22),
    segments: 4,
    length: 0.17,
    stiffness: 0.035,
    stiffFalloff: 0.7,
    damping: 0.94,
    render: 'tube',
    size: (t) => (t > 0.86 ? 0.0085 : 0.0048),
    material: M.shoe,
    radial: 5,
    outline: 0.7,
    relative: true,
    airDrag: 0.5,
  }, spheres));
  // hip charm (gold chain)
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
    relative: true,
    airDrag: 0.6,
  }, spheres);

  // --- weapon detail animation ------------------------------------------------------------------------
  const ringBase = new THREE.Color(0xa46bff).multiplyScalar(2.8);
  const ringHot = new THREE.Color(0xffc94a).multiplyScalar(3.4);
  const ringWhite = new THREE.Color(0xfff4dc).multiplyScalar(4.2);
  const ringMat = M.ringGlow as THREE.MeshBasicMaterial;
  const eqU = (M.eq as THREE.ShaderMaterial).uniforms;
  // drum: indexes 1/8 turn per round with a mechanical anticipate-and-snap (r < 0)
  const drumSpring = new SecondOrder(1, 6, 0.55, -0.35, [0]);
  let drumTarget = 0;
  let drumSpin = 0;
  const ringPulse = [0, 0, 0];
  const ringDelay: number[][] = [[], [], []];
  let heat = 0;
  let charge = 0;
  let chargeState = 0;
  let ready = 0;
  let eqKick = 0;
  let time = 0;
  let overT = 0;
  const cue: ChampionVisual['cue'] = (id, value = 1) => {
    switch (id) {
      case 'shot':
      case 'slug':
      case 'note': {
        const k = id === 'slug' ? 1.6 : id === 'note' ? 0.7 : 1;
        // speaker rings pump back-to-front, 25 ms apart: the bass travels to the muzzle
        for (let i = 0; i < 3; i++) ringDelay[i].push(time + i * 0.025, k);
        drumTarget += (Math.PI * 2) / 8;
        heat = Math.min(1.4, heat + (id === 'slug' ? 0.45 : 0.1));
        eqKick = Math.min(1.5, eqKick + 0.6 * k);
        break;
      }
      case 'beam':
        // (a 2.2x pump turned the rings into a white blob right in front of the shooter's camera)
        for (let i = 0; i < 3; i++) ringDelay[i].push(time + i * 0.02, 1.6 * Math.max(0.6, value));
        heat = Math.min(1.4, heat + 0.6 * value);
        eqKick = 1.5;
        break;
      case 'charge':
        charge = value;
        break;
      case 'chargeState':
        chargeState = value;
        break;
      case 'ready':
        ready = value;
        break;
      default:
        break;
    }
  };
  const tick: ChampionVisual['tick'] = (dt, _t, energy) => {
    time += dt;
    // ring pumps
    for (let i = 0; i < 3; i++) {
      const q = ringDelay[i];
      while (q.length && q[0] <= time) {
        q.shift();
        ringPulse[i] = Math.max(ringPulse[i], q.shift() ?? 1);
      }
      ringPulse[i] *= Math.exp(-dt * 16);
      const charged = charge * (0.12 + 0.05 * Math.sin(time * 30 + i * 2));
      const sc = 1 + 0.32 * ringPulse[i] + charged;
      rings[i].scale.set(sc, sc, 1 + 0.6 * ringPulse[i]);
      rings[i].rotation.z += dt * (charge * 22 + (i % 2 ? -1 : 1) * 0.5);
    }
    // drum: index + charge spin-up
    drumSpin += dt * charge * charge * 40;
    drumSpring.update(dt, [drumTarget]);
    drum.rotation.x = drumSpring.y[0] + drumSpin;
    // barrel heat: violet -> gold -> white, cooling over ~1.5 s
    heat = Math.max(0, heat - dt * 0.7);
    const hk = Math.min(1, heat);
    ringMat.color.copy(ringBase).lerp(ringHot, Math.min(1, hk * 1.4));
    if (hk > 0.85) ringMat.color.lerp(ringWhite, (hk - 0.85) / 0.15);
    ringMat.color.multiplyScalar(1 + 0.6 * charge + (chargeState === 1 ? 0.8 : 0));
    // equalizer: louder with the music, jumps with every shot, maxed by a charge
    eqKick = Math.max(0, eqKick - dt * 3);
    eqU.uEnergy.value = 0.75 + 0.25 * energy + eqKick + charge * 0.8;
    // muzzle orb: ready pulse on the beat / charge orb (0.08 -> 0.30 m, easeInQuad, violet -> gold,
    // core tier 1 -> 2.5) / perfect: locked, gold, rotating glint, 30 Hz shimmer / overcharge: red,
    // flicker and jitter stepped at 20 fps
    const ou = orbMat.uniforms;
    ou.uTime.value = time;
    const step20 = Math.floor(time * 20);
    if (charge > 0) {
      const k = charge;
      const r = 0.04 + 0.11 * k * k;
      let size = r * 2.4;
      if (chargeState === 1) size *= 1 + 0.04 * Math.sin(time * Math.PI * 2 * 30);
      bloomColor(V_HEX, 0.9, ou.uEdge.value).lerp(bloomColor(G_HEX, 0.9, _c1), k * k);
      bloomColor(WV_HEX, 1 + 1.5 * k, ou.uCore.value).lerp(bloomColor(WG_HEX, 1 + 1.5 * k, _c1), k);
      ou.uGlint.value = chargeState === 1 ? 1 : 0;
      ou.uOffset.value.set(0, 0, 0);
      let alpha = 1;
      if (chargeState === 2) {
        bloomColor(RED_HEX, 1.1, ou.uEdge.value);
        bloomColor(RED_HEX, 2, ou.uCore.value);
        alpha = 1 + 0.25 * (hash1(step20) * 2 - 1);
        const j = 0.02 + 0.06 * Math.min(1, overT);
        ou.uOffset.value.set((hash1(step20 + 7) - 0.5) * 2 * j, (hash1(step20 + 13) - 0.5) * 2 * j, 0);
      }
      ou.uSize.value = size;
      ou.uAlpha.value = alpha;
      // approach ring: from 0.9 m onto the orb exactly at full charge (time-linear)
      approach.visible = chargeState === 0 && k < 1;
      if (approach.visible) {
        const au = approachMat.uniforms;
        au.uSize.value = THREE.MathUtils.lerp(0.9, size * 0.6, k);
        au.uAlpha.value = THREE.MathUtils.smoothstep(k, 0, 0.08) * 0.9;
        bloomColor(V_HEX, 0.9, au.uColor.value).lerp(bloomColor(G_HEX, 1.2, _c1), Math.max(0, (k - 0.7) / 0.3));
        au.uThick.value = 0.03 + 0.05 * k;
      }
    } else {
      approach.visible = false;
      const pulse = ready * (0.25 + 0.35 * Beat.pulse);
      ou.uSize.value = 0.09;
      ou.uAlpha.value = pulse;
      ou.uGlint.value = 0;
      ou.uOffset.value.set(0, 0, 0);
      bloomColor(V_HEX, 0.8, ou.uEdge.value);
      bloomColor(WV_HEX, 1, ou.uCore.value);
    }
    overT = chargeState === 2 ? overT + dt : 0;
  };

  const anims = rexAnims();
  const v = assembleVisual({
    rig,
    builder: b,
    cloth: [...springs, ...strings, charm],
    bodySpheres: spheres,
    blades: [],
    gear,
    weaponR: w,
    weaponL: null,
    offhandGrip: offhand,
    muzzle,
    materials: Object.values(M),
    anims,
    eyes,
    tick,
    stockZ: STOCK_Z,
    // support elbow under the rifle, a little out and back toward the stock, whatever the aim
    gripElbow: [0.35, -0.85, -0.25],
    cue,
  });
  return v;
}

const V_HEX = '#9b5cff';
const G_HEX = '#ffc94a';
const WV_HEX = '#f2e8ff';
const WG_HEX = '#fff4dc';
const RED_HEX = '#ff3b6b';
const _c1 = new THREE.Color();
const hash1 = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

/** camera-facing quad of uSize metres (half-size) at the object's origin, offset in view space */
const BILLBOARD_VERT = /* glsl */ `
uniform float uSize;
uniform vec3 uOffset;
varying vec2 vUv;
void main() {
  vUv = position.xy;
  vec4 mv = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  mv.xyz += uOffset;
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;
const ORB_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uAlpha;
uniform float uGlint;
uniform float uTime;
varying vec2 vUv;
void main() {
  float r = length( vUv );
  float core = exp( -r * r * 14.0 );
  float halo = exp( -r * r * 3.2 ) * 0.55;
  float an = uTime * 3.0;
  vec2 q = vec2( cos( an ) * vUv.x + sin( an ) * vUv.y, -sin( an ) * vUv.x + cos( an ) * vUv.y );
  float star = clamp( max( 1.0 - abs( q.x ) * 9.0 - abs( q.y ) * 0.9, 1.0 - abs( q.y ) * 9.0 - abs( q.x ) * 0.9 ), 0.0, 1.0 ) * uGlint;
  vec3 col = ( uEdge * halo + uCore * core + vec3( 2.5 ) * star ) * uAlpha;
  if ( col.r + col.g + col.b < 0.004 ) discard;
  gl_FragColor = vec4( col, 1.0 );
}
`;
const APPROACH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uThick;
varying vec2 vUv;
void main() {
  float r = length( vUv );
  float ring = smoothstep( 1.0 - uThick - 0.03, 1.0 - uThick, r ) * ( 1.0 - smoothstep( 0.97, 1.0, r ) );
  vec3 col = uColor * ring * uAlpha;
  if ( col.r + col.g + col.b < 0.004 ) discard;
  gl_FragColor = vec4( col, 1.0 );
}
`;

/** the right shoulder pocket, chest-local (where a shouldered stock sits) */
const POCKET = new THREE.Vector3(-0.13, 0.1, 0.09);

function rexAnims(): ChampionAnimSet {
  const W = (p: [number, number, number], d: [number, number, number], u: [number, number, number] = [0, 1, 0], e?: [number, number, number]): WeaponSpec => ({ p, d, u, e });
  // Shouldered rifle keys are solved, not guessed: pose a scratch rig with the key's torso and put
  // the grip where the butt plate lands on the shoulder pocket. Lean the chest back and the gun
  // goes with it, so the stock never floats off the shoulder or sinks into it.
  const scratch = new Rig(bodySpec('heavy'));
  const _bq = new THREE.Quaternion();
  const shouldered = (spec: PoseSpec, d: [number, number, number], u: [number, number, number] = [0, 1, 0], push = 0): WeaponSpec => {
    applyPose(pose(spec), scratch);
    scratch.root.updateMatrixWorld(true);
    const pocket = scratch.byName.chest.localToWorld(POCKET.clone());
    weaponQuat(d, u, _bq);
    const butt = new THREE.Vector3(0, 0.03, STOCK_Z).applyQuaternion(_bq);
    // push > 0 pulls the gun forward off the shoulder (follow-through, unshouldered moments)
    const p = pocket.sub(butt).addScaledVector(new THREE.Vector3(...d).normalize(), push);
    return { p: [p.x, p.y, p.z], d, u };
  };
  /** a key that keeps the rifle shouldered on whatever torso the key has */
  const sh = (spec: PoseSpec, d: [number, number, number] = [0, 0, 1], u: [number, number, number] = [0, 1, 0]): PoseSpec => ({ ...spec, wR: shouldered(spec, d, u), off: 1 });
  // --- stances ---------------------------------------------------------------------------------
  // Rifle stance, right-handed: the torso is bladed ~40 degrees (left shoulder toward the target,
  // the stock in the right shoulder pocket), the head counter-turns to look down the barrel,
  // left foot forward, weight on the back (right) leg.
  // Feet are planted by leg IK (ankle targets, y = 0.08 is flat on the floor); the FK leg angles
  // only matter when a clip fades the targets out.
  const FL = (x: number, z: number, yaw: number, pitch = 0, y = 0.08) => ({ p: [x, y, z] as [number, number, number], yaw, pitch });
  // one foot placement for every standing pose (idle, aim, charge, relaxed, taunt): switching
  // between them never slides a planted foot
  const feet = { fL: FL(0.15, 0.19, -18), fR: FL(-0.19, -0.23, -60) };
  const stance: PoseSpec = {
    hips: [-0.02, -0.045, 0],
    pelvis: [0, -14, 0],
    thighL: [-16, 12, 7], shinL: [18, 0, 0], footL: [-2, 4, -6],
    thighR: [10, 8, -9], shinR: [16, 0, 0], footR: [-26, -6, 8],
    spine: [4, -13, 0], chest: [3, -13, 0],
    neck: [0, 15, 0], head: [4, 23, 3],
    shoulderL: [0, -8, 0],
    ...feet,
  };
  const braceFeet = feet;
  // shouldered aim: butt plate in the pocket, muzzle level (aim pitch / yaw rotate it at runtime)
  const aimSpec: PoseSpec = sh({ ...stance, head: [6, 22, 6] });
  // combat idle: high ready, muzzle 14 degrees down, still shouldered
  const readyDir: [number, number, number] = [0, -0.24, 0.97];
  const readyUp: [number, number, number] = [0, 0.97, 0.24];
  const readyGun = shouldered(stance, readyDir, readyUp);
  const idle = pose({ ...stance, wR: readyGun, off: 1 });
  // relaxed idle (after a few calm seconds): rifle propped on the right shoulder, free hand on
  // the hip, square stance, head free to nod to the beat
  const relaxedSpec: PoseSpec = {
    hips: [-0.025, -0.02, 0], pelvis: [0, -6, 3],
    thighL: [-4, 8, 7], shinL: [8, 0, 0], footL: [-4, 0, -6],
    thighR: [2, -6, -4], shinR: [5, 0, 0], footR: [-7, 4, 4],
    ...feet,
    spine: [-2, -4, -2], chest: [-3, -4, -2], neck: [0, 4, 2], head: [-2, 6, 3],
    wR: W([-0.23, 1.44, 0.12], [0.12, 0.62, -0.78], [-0.95, 0.2, 0]),
    wL: W([0.215, 1.0, -0.01], [0, -0.3, 0.95], [0.6, -0.1, -0.2], [1, 0, -0.2]),
    off: 0,
  };
  const relaxed = pose(relaxedSpec);
  // on the way between ready and relaxed the rifle swings up past the right side of the head
  const relaxVia = pose({ ...stance, wR: W([-0.3, 1.42, 0.16], [0.05, 0.9, 0.35], [-0.95, -0.1, 0.1]), off: 0, upperArmL: [-20, 0, 18], foreArmL: [-40, 0, 0] });
  // port arms for the run: diagonal across the chest, muzzle up-left
  const runArms = pose({ wR: W([-0.12, 1.14, 0.25], [0.55, 0.42, 0.72], [-0.45, 0.88, 0.1]), off: 1 });
  const airArms = pose({ wR: W([-0.16, 1.24, 0.3], [0.1, -0.2, 0.97], [0, 0.97, 0.2]), off: 1 });
  const flyArms = pose({ wR: W([-0.36, 1.0, -0.18], [-0.2, -0.25, -0.95]), off: 0, upperArmL: [10, 0, 45], foreArmL: [-30, 0, 0] });

  // taunt hand keys (bare left hand, wrist targets): palm up overhead / pointing
  const shoulderRest = relaxedSpec.wR!;
  // elbow hints (e): out at the hip, down-and-back while the hand swings out in front, down-and-out
  // under the raised palm; without them the elbow flips where the wrist lines up with the pole
  const roofUp = W([0.3, 1.86, 0.06], [-1, 0, 0], [0, 0, 1], [0.9, -0.4, 0]);
  const roofLow = W([0.34, 1.64, 0.1], [-1, 0, 0], [0, 0, 1], [0.55, -0.83, 0]);
  const roofVia = W([0.42, 1.27, 0.24], [-0.7, 0, 0.7], [0, 0.6, 0.8], [0.3, -0.75, -0.6]);
  const pointAt = W([0.19, 1.45, 0.52], [-1, 0, 0], [0, 0, -1], [0.45, -0.89, 0]);
  // the rifle on the shoulder rides the body's dip (a fixed model-space grip would fold the arm)
  const restDip = relaxedSpec.hips![1];
  const tauntPose = (hand: WeaponSpec, nod: number, dip: number): PoseSpec => ({
    ...relaxedSpec, spine: [-2, 2, 0], chest: [-4, 4, 0], neck: [nod * 0.4, 0, 0], head: [nod, 2, nod * 0.3],
    hips: [-0.02, dip, 0], wL: hand, off: 0,
    wR: { ...shoulderRest, p: [shoulderRest.p[0], shoulderRest.p[1] + (dip - restDip), shoulderRest.p[2]] },
  });
  const base = pose(stance);
  const F = (n: number) => n / 60;

  const clips = {
    ...sharedClips(idle),
    aim: clip('aim', base, [[0, aimSpec], [0.5, aimSpec]], { fadeIn: 0.07, fadeOut: 0.18 }),
    // Bass Charge: plant (wide, low), then keep sinking while the power builds (inQuad)
    charge: clip('charge', base, [
      [0, aimSpec],
      [0.15, sh({ ...aimSpec, ...braceFeet, hips: [-0.02, -0.085, 0], spine: [6, -13, 0] }), Ease.outCubic],
      [0.95, sh({ ...aimSpec, ...braceFeet, hips: [-0.02, -0.13, -0.01], spine: [8, -13, 0], chest: [4, -13, 0] }), Ease.inQuad],
    ], { fadeIn: 0.08, fadeOut: 0.18 }),
    // Lead Single: compress (load) into the shot, the body takes the kick (the gun climb itself is
    // the recoil spring), a moving hold, a slow heavy recovery with a small undershoot
    single: clip('single', base, [
      [0, aimSpec],
      [F(4), sh({ ...aimSpec, ...braceFeet, hips: [-0.02, -0.1, 0.01], spine: [8, -13, 0], chest: [6, -13, 0] }), Ease.outCubic],
      [F(6), sh({ ...aimSpec, ...braceFeet, hips: [-0.02, -0.11, 0.01], spine: [8, -13, 0], chest: [6, -13, 0] }), Ease.linear],
      [F(9), sh({ ...aimSpec, ...braceFeet, hips: [-0.02, -0.09, -0.07], pelvis: [-4, -14, 0], spine: [-6, -12, 0], chest: [-5, -12, 0], neck: [-2, 15, 0], head: [8, 22, 6] }), Ease.outExpo],
      [F(16), sh({ ...aimSpec, ...braceFeet, hips: [-0.02, -0.085, -0.065], pelvis: [-3, -14, 0], spine: [-5, -12, 0], chest: [-4, -12, 0], head: [8, 22, 6] }), Ease.linear],
      [F(30), sh({ ...aimSpec, hips: [-0.02, -0.055, -0.02], spine: [2, -13, 0], chest: [1, -13, 0] }), Ease.outCubic],
      [F(40), sh({ ...aimSpec, hips: [-0.02, -0.04, 0.005], spine: [5, -13, 0], chest: [4, -13, 0] }), Ease.inOut],
      [F(50), aimSpec, Ease.inOut],
    ], { events: [{ t: F(6), id: 'fire', kick: { pitch: 16, back: 0.05, roll: 3, body: 1, freq: 3.6, zeta: 0.62, rise: 0.03, hang: 0.065 } }], fadeIn: 0.05, fadeOut: 0.2, lag: { neck: 2, head: 3 } }),
    // Bass Charge release: the biggest kick of the kit — the rear foot hops back, a 5-frame hang,
    // then a heavy settle back to the aim (the recoil spring throws the gun on top)
    release: clip('release', base, [
      [0, sh({ ...aimSpec, ...braceFeet, hips: [-0.02, -0.13, -0.01], spine: [8, -13, 0] })],
      // the kick drives the body back first; the rear foot follows with a quick hop-step (lifted
      // on f2-f4, planted 12 cm back on f6): a planted foot never skids
      [F(2), sh({ ...aimSpec, fR: FL(-0.19, -0.25, -60, -4, 0.11), hips: [-0.02, -0.11, -0.08], pelvis: [-5, -15, 0], spine: [-9, -11, 0], chest: [-8, -11, 0], neck: [-3, 15, 0], head: [10, 22, 6] }), Ease.outExpo],
      [F(4), sh({ ...aimSpec, fR: FL(-0.2, -0.31, -60, -8, 0.15), hips: [-0.02, -0.105, -0.11], pelvis: [-6, -15, 0], spine: [-10, -11, 0], chest: [-9, -11, 0], neck: [-3, 15, 0], head: [10, 22, 6] }), Ease.outCubic],
      [F(6), sh({ ...aimSpec, fR: FL(-0.2, -0.35, -60), hips: [-0.02, -0.1, -0.12], pelvis: [-6, -15, 0], spine: [-10, -11, 0], chest: [-9, -11, 0], neck: [-3, 15, 0], head: [10, 22, 6] }), Ease.inQuad],
      [F(10), sh({ ...aimSpec, fR: FL(-0.2, -0.35, -60), hips: [-0.02, -0.095, -0.115], pelvis: [-5, -15, 0], spine: [-9, -11, 0], chest: [-8, -11, 0], head: [10, 22, 6] }), Ease.linear],
      // recovery step: the rear foot lifts and comes back under the body
      [F(18), sh({ ...aimSpec, fR: FL(-0.2, -0.3, -60, 8, 0.13), hips: [-0.02, -0.07, -0.06], spine: [-2, -12, 0], chest: [-2, -12, 0] }), Ease.outCubic],
      [F(26), sh({ ...aimSpec, hips: [-0.02, -0.06, -0.02], spine: [2, -13, 0], chest: [1, -13, 0] }), Ease.inOut],
      [F(38), aimSpec, Ease.inOut],
    ], { fadeIn: 0.02, fadeOut: 0.2, inertia: 0.035, lag: { neck: 2, head: 3 } }),
    // Sub Bomb: a left-hand lob. Coil (weight back, chest turned away, arm cocked), then the
    // kinetic chain unwinds pelvis -> chest -> arm -> forearm (lag), release at f6, follow-through
    // across the body, back to the rifle
    throw: clip('throw', base, [
      [0, { ...stance, wR: W([-0.2, 1.08, 0.24], [0.15, -0.5, 0.85]), off: 0, pelvis: [0, 4, 0], spine: [-6, 8, 0], chest: [-6, 12, 0], upperArmL: [-150, 0, 28], foreArmL: [-70, 0, 0], hips: [-0.04, -0.06, -0.02], shinR: [24, 0, 0] }],
      [F(6), { ...stance, wR: W([-0.22, 1.06, 0.26], [0.2, -0.6, 0.78]), off: 0, pelvis: [0, -24, 0], spine: [14, -16, 0], chest: [10, -18, 0], upperArmL: [-95, 0, 10], foreArmL: [-8, 0, 0], hips: [0.02, -0.07, 0.07], shinL: [36, 0, 0] }, Ease.outQuart],
      [F(15), { ...stance, wR: W([-0.22, 1.06, 0.26], [0.2, -0.6, 0.78]), off: 0, pelvis: [0, -28, 0], spine: [20, -18, 0], chest: [14, -22, 0], upperArmL: [-35, -25, -8], foreArmL: [-20, 0, 0], hips: [0.03, -0.08, 0.08], footR: [-50, -6, 8] }, Ease.outCubic],
      [F(30), { ...stance, wR: readyGun, off: 1 }, Ease.inOutCubic],
    ], { events: [{ t: F(6), id: 'release' }], fadeIn: 0.04, fadeOut: 0.15, inertia: 0.03, lag: { chest: 1, upperArmL: 1, foreArmL: 1, head: 2 } }),
    // Drop The Beat (1.5 s; 12 notes from 0.15 s, one every 90 ms): count-in dip, the rifle
    // swings skyward (outBack), each launch is a recoil kick from the kit, then "the drop":
    // rifle onto the shoulder and a head bang
    ult: clip('ult', base, [
      [0, { ...aimSpec }],
      [F(5), { ...stance, ...braceFeet, wR: W([-0.17, 1.26, 0.3], [0, 0.15, 0.99]), off: 1, hips: [-0.02, -0.14, 0], spine: [10, -13, 0] }, Ease.outCubic],
      [F(10), { ...stance, ...braceFeet, wR: W([-0.15, 1.5, 0.2], [0, 0.82, 0.57]), off: 1, spine: [-12, -10, 0], chest: [-10, -10, 0], neck: [-6, 12, 0], head: [-18, 20, 0], hips: [-0.02, -0.06, 0], shinL: [30, 0, 0] }, Ease.outBack],
      [1.14, { ...stance, ...braceFeet, wR: W([-0.15, 1.52, 0.2], [0, 0.85, 0.53]), off: 1, spine: [-13, -10, 0], chest: [-11, -10, 0], neck: [-6, 12, 0], head: [-20, 20, 0], hips: [-0.02, -0.07, 0], shinL: [32, 0, 0] }, Ease.linear],
      // the rifle swings out to the right on its way down to the shoulder (clear of the head)
      [1.21, { ...relaxedSpec, wR: W([-0.36, 1.48, 0.12], [-0.35, 0.92, 0.18], [-0.9, -0.3, 0.2]), wL: W([0.24, 1.62, 0.2], [-0.8, 0.3, 0.5], [0, 0.6, 0.8], [0.6, -0.7, -0.3]), head: [4, 8, 0], neck: [2, 4, 0], hips: [-0.025, -0.065, 0] }, Ease.inOut],
      [1.28, { ...relaxedSpec, wL: W([0.3, 1.8, 0.05], [-1, 0, 0], [0, 0, 1], [0.9, -0.4, 0]), head: [8, 10, 2], neck: [4, 4, 0], hips: [-0.025, -0.06, 0] }, Ease.outCubic],
      [1.5, { ...relaxedSpec, wL: W([0.3, 1.8, 0.05], [-1, 0, 0], [0, 0, 1], [0.9, -0.4, 0]), head: [14, 4, 4], neck: [6, 2, 0], hips: [-0.025, -0.07, 0] }, Ease.outCubic],
    ], { fadeIn: 0.06, fadeOut: 0.25, lag: { head: 2 } }),
    // taunt in BEATS (played on the music): lead-in to the shoulder, four "raise the roof" pumps
    // on the beat (up on the beat, down on the "and"), point at the target, button pose
    taunt: clip('taunt', base, [
      [0, { ...relaxedSpec }],
      [0.45, tauntPose(roofVia, 0, -0.03), Ease.outCubic],
      [0.75, tauntPose(roofLow, -4, -0.05), Ease.inOut],
      [1, tauntPose(roofUp, 14, -0.09), Ease.outExpo],
      [1.5, tauntPose(roofLow, -8, -0.03), Ease.inOut],
      [2, tauntPose(roofUp, 14, -0.09), Ease.outExpo],
      [2.5, tauntPose(roofLow, -8, -0.03), Ease.inOut],
      [3, tauntPose(roofUp, 14, -0.09), Ease.outExpo],
      [3.5, tauntPose(roofLow, -8, -0.03), Ease.inOut],
      [4, tauntPose(roofUp, 16, -0.1), Ease.outExpo],
      [4.75, tauntPose(roofLow, -6, -0.04), Ease.inOut],
      [5, { ...tauntPose(pointAt, 4, -0.06), spine: [2, -8, 0], chest: [2, -8, 0] }, Ease.outBack],
      [6, { ...tauntPose(pointAt, 2, -0.05), spine: [2, -8, 0], chest: [2, -8, 0] }, Ease.linear],
      [6.6, { ...relaxedSpec }, Ease.inOut],
    ], { fadeIn: 0.1, fadeOut: 0.25, beats: true, lag: { head: 2, neck: 1 } }),
  };
  return {
    idle, runArms, airArms, flyArms, armSwing: [0, 0], offhandLoco: 1, runLean: 2, clips,
    groove: 1, inertial: 0.07, stride: 3.2, runBob: 0.045, legSwing: 1.12,
    relaxed, relaxVia, idleLife: 1, landDepth: 1.25, landRecover: 0.42,
  };
}
