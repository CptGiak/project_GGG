import * as THREE from 'three';
import { gradientToon, holoMaterial, neon, toon } from '../render/toon';
import { Rig, bodySpec } from '../fighter/Rig';
import { ModelBuilder } from '../fighter/ModelBuilder';
import { ClothChain } from '../fighter/Cloth';
import { clip, Ease, pose, type PoseSpec, type WeaponSpec } from '../fighter/Animator';
import type { ChampionAnimSet } from '../fighter/locomotion';
import { cyl, ellipsoid, extrude, hairLock, lathe, limb, poly, rbox, sweep, torus, wrapOnBack, xf } from '../fighter/shapes';
import { addFace, addODMGear, addSpikyHair, addVisor, buildBody, makeBodySpheres, type SpikeSpec } from './body';
import { assembleVisual, marker, sharedClips, weaponPivot } from './common';
import type { ChampionVisual } from './types';
import { addAnimeEyes, eyeMaterial, type EyeStyle } from './face';

const NOVA_EYES: EyeStyle = {
  sclera: 0xfaf6ff, irisTop: 0x7a1060, irisBottom: 0xff5fd0, pupil: 0x24061c, lash: 0x1a0814, brow: 0xd0388f,
  glow: 0.25, female: true, y: 0.113, tilt: 0.16, gaze: 0.05, browFierce: 0.35,
};

/**
 * NOVA — "Glitch Ronin". Fast dual-blade assassin.
 * Hot-pink high ponytail, cyan holo visor, cropped bomber with neon trims, long pink→cyan scarf,
 * twin holo-katanas SYNTH (cyan) & SAMPLE (magenta).
 */
export function buildNova(): ChampionVisual {
  const M: Record<string, THREE.Material> = {
    skin: toon({ color: 0xf6d2bb, shade: 0xffc4c0, rim: 0.3 }),
    skinDark: toon({ color: 0xa85f60, rim: 0 }),
    hair: toon({ color: 0xff4fb6, shade: 0xc89cff, hairBand: 0.4, rim: 0.55 }),
    eyes: eyeMaterial(NOVA_EYES),
    jacket: toon({ color: 0x1b1a24, rim: 0.85, rimCut: 0.62 }),
    jacketIn: toon({ color: 0x14d6e8, side: THREE.BackSide, rim: 0.2 }),
    crop: toon({ color: 0x2a2836, rim: 0.6 }),
    shorts: toon({ color: 0x15141c, rim: 0.7, rimCut: 0.62 }),
    tights: toon({ color: 0x3a2350, rim: 0.65, rimCut: 0.62 }),
    shoe: toon({ color: 0xf2eff5, rim: 0.3 }),
    sole: toon({ color: 0xff4fb6 }),
    glove: toon({ color: 0x1b1a24, spec: 0.3 }),
    wrap: toon({ color: 0xece8f0, rim: 0.2 }),
    pad: toon({ color: 0x24232e, spec: 0.5, rim: 0.5 }),
    gold: toon({ color: 0xf3c24f, spec: 0.8, specSize: 0.88, shade: 0xffd2a0 }),
    metal: toon({ color: 0xa7acbe, spec: 0.7 }),
    blade: toon({ color: 0x15131c, spec: 0.6, specSize: 0.96, rim: 0.6 }),
    gearBody: toon({ color: 0x1d1c26, spec: 0.4, rim: 0.5 }),
    neonCyan: neon(0x2ef2ff, 2.6),
    neonPink: neon(0xff3fd0, 2.6),
    gearGlow: neon(0x2ef2ff, 1.7),
    visorLens: holoMaterial(0x2ef2ff, 0xb0ffff, { intensity: 1.6, scan: 90, glitch: 0.3 }),
    holoCyan: holoMaterial(0x2ef2ff, 0xffffff, { intensity: 2.0, scan: 30, axisZ: true }),
    holoPink: holoMaterial(0xff3fd0, 0xffffff, { intensity: 2.0, scan: 30, axisZ: true }),
  };

  const rig = new Rig(bodySpec('female'));
  const B = rig.byName;
  const s = rig.spec;
  const b = new ModelBuilder(M);

  buildBody(b, rig, { skin: 'skin', top: 'crop', abdomen: 'skin', pelvis: 'shorts', shorts: 'shorts', pants: 'tights', boots: 'shoe', bootSole: 'sole', sleeve: 'jacket', forearm: 'jacket', glove: 'glove' }, { bust: 0.9, shorts: true });

  // --- cropped bomber jacket ---------------------------------------------------------------------
  const cw = 0.135;
  const jprof: [number, number][] = [[cw * 0.92 + 0.03, 0.03], [cw * 0.98 + 0.028, 0.09], [cw + 0.03, 0.15], [cw * 0.95 + 0.03, 0.2], [cw * 0.7 + 0.03, 0.24], [cw * 0.45 + 0.03, 0.258]];
  const jacket = lathe(jprof, 22, 1.26, 0.8, 34, 292);
  b.add(B.chest, jacket, 'jacket');
  // back print: a glitched "N" split into cyan / magenta channels with stray scanline bars
  {
    // off-centre like a patch, clear of the ponytail hanging down the spine
    const onBack = (shape: THREE.Shape, depth: number, dx: number, dy: number) => wrapOnBack(xf(extrude(shape, depth, 0, 4), [0.075 + dx, 0.15 + dy, 0], [0, 0, 0], 0.72), jprof, 1.26, 0.8, 0.003);
    const N = () => poly([-0.036, -0.04, -0.02, -0.04, -0.02, 0.01, 0.02, -0.04, 0.036, -0.04, 0.036, 0.04, 0.02, 0.04, 0.02, -0.01, -0.02, 0.04, -0.036, 0.04]);
    b.add(B.chest, onBack(N(), 0.002, -0.006, 0.003), 'neonCyan', 0);
    b.add(B.chest, onBack(N(), 0.002, 0.006, -0.003), 'neonPink', 0);
    b.add(B.chest, onBack(N(), 0.004, 0, 0), 'wrap', 0.3);
    const bar = (x0: number, x1: number, y: number, h: number) => poly([x0, y, x1, y, x1, y + h, x0, y + h]);
    b.add(B.chest, onBack(bar(0.044, 0.078, 0.018, 0.006), 0.002, 0, 0), 'neonCyan', 0);
    b.add(B.chest, onBack(bar(-0.082, -0.046, -0.022, 0.005), 0.002, 0, 0), 'neonPink', 0);
    b.add(B.chest, onBack(bar(-0.06, -0.044, 0.03, 0.004), 0.002, 0, 0), 'neonCyan', 0);
  }
  b.add(B.chest, jacket.clone(), 'jacketIn', 0);
  // ribbed hem + collar
  const hemPts: THREE.Vector3[] = [];
  for (let phi = 34; phi <= 326; phi += 10) {
    const a = (phi * Math.PI) / 180;
    hemPts.push(new THREE.Vector3(Math.sin(a) * (cw * 0.92 + 0.034) * 1.26, 0.03, Math.cos(a) * (cw * 0.92 + 0.034) * 0.8));
  }
  b.add(B.chest, sweep(hemPts, () => 0.014, 6, 40), 'jacket', 0.7);
  const collar = lathe([[0.075, 0.235], [0.088, 0.27], [0.096, 0.3]], 18, 1.2, 1.1, 50, 260);
  b.add(B.chest, collar, 'jacket');
  b.add(B.chest, collar.clone(), 'jacketIn', 0);
  // neon trims along the opening
  const edge = (phi: number) => jprof.map(([r, y]) => new THREE.Vector3(Math.sin((phi * Math.PI) / 180) * (r + 0.004) * 1.26, y, Math.cos((phi * Math.PI) / 180) * (r + 0.004) * 0.8));
  for (const phi of [34, 326]) b.add(B.chest, sweep(edge(phi), () => 0.0055, 5, 12), 'neonCyan', 0);
  // oversized sleeves with neon stripe
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    b.add(B[`upperArm${side}`], xf(limb(s.upperArm * 0.95, 0.068, 0.062, { capTop: 0.6, capBottom: 0.2 }), [sx * 0.004, -0.005, 0]), 'jacket');
    b.add(B[`upperArm${side}`], xf(rbox(0.008, s.upperArm * 0.8, 0.016, 0.004), [sx * 0.066, -s.upperArm * 0.45, 0]), 'neonPink', 0);
    b.add(B[`foreArm${side}`], xf(lathe([[0.05, 0.0], [0.058, -0.08], [0.064, -0.14], [0.06, -0.16], [0.052, -0.16]], 14), [0, 0, 0]), 'jacket');
    b.add(B[`foreArm${side}`], xf(torus(0.061, 0.007, 5, 16), [0, -0.15, 0], [90, 0, 0]), 'neonCyan', 0);
    // wrist wraps
    for (let i = 0; i < 3; i++) b.add(B[`foreArm${side}`], xf(torus(0.036 + i * 0.001, 0.008, 5, 14), [0, -s.foreArm + 0.025 + i * 0.022, 0], [90, 0, 6 * sx]), 'wrap', 0.5);
  }
  // crop top neon band + choker
  b.add(B.chest, xf(torus(cw * 0.95, 0.008, 5, 26), [0, 0.035, 0.006], [90, 0, 0], [1.12, 0.74, 1]), 'neonPink', 0);
  b.add(B.neck, xf(torus(0.044, 0.008, 5, 18), [0, 0.0, 0], [90, 0, 0]), 'neonCyan', 0);
  // belt + pouch + chain on the shorts
  b.add(B.hips, xf(rbox(0.06, 0.07, 0.035, 0.012), [-0.15, 0.02, 0.07], [0, -30, 0]), 'pad');
  b.add(B.hips, sweep([new THREE.Vector3(0.13, 0.05, 0.1), new THREE.Vector3(0.16, -0.03, 0.06), new THREE.Vector3(0.17, -0.05, -0.02), new THREE.Vector3(0.14, 0.04, -0.1)], () => 0.0045, 4, 14), 'metal', 0.4);
  // knee pads
  for (const side of ['L', 'R'] as const) {
    b.add(B[`shin${side}`], xf(rbox(0.07, 0.085, 0.04, 0.018), [0, -0.01, 0.045]), 'pad', 0.7);
    b.add(B[`shin${side}`], xf(rbox(0.04, 0.012, 0.042, 0.004), [0, -0.01, 0.06]), 'neonCyan', 0);
  }

  // --- ODM gear ----------------------------------------------------------------------------------
  const gear = addODMGear(b, rig, { body: 'gearBody', accent: 'metal', glow: 'gearGlow' });

  // --- head: visor, hair ---------------------------------------------------------------------------
  addVisor(b, B.head, 'gearBody', 'visorLens', true, 0.03);
  addFace(b, B.head, 'skinDark', true);
  const eyes = addAnimeEyes(b, B.head, 'eyes', NOVA_EYES);
  const spikes: SpikeSpec[] = [
    { at: [0, 1, 0.1], len: 0.1, r: 0.05, bend: [0, -0.02, -0.08], flat: 0.55 },
    { at: [0.35, 0.9, 0.0], len: 0.11, r: 0.048, bend: [0.04, -0.04, -0.07], flat: 0.55 },
    { at: [-0.35, 0.9, 0.0], len: 0.11, r: 0.048, bend: [-0.04, -0.04, -0.07], flat: 0.55 },
    { at: [0.2, 0.85, -0.45], len: 0.1, r: 0.05, bend: [0.02, -0.05, -0.06], flat: 0.55 },
    { at: [-0.2, 0.85, -0.45], len: 0.1, r: 0.05, bend: [-0.02, -0.05, -0.06], flat: 0.55 },
    { at: [0.7, 0.55, 0.1], len: 0.1, r: 0.04, bend: [0.03, -0.08, 0.0], flat: 0.5 },
    { at: [-0.7, 0.55, 0.1], len: 0.1, r: 0.04, bend: [-0.03, -0.08, 0.0], flat: 0.5 },
    { at: [0.25, 0.9, 0.45], len: 0.12, r: 0.04, bend: [0.05, -0.08, 0.05], flat: 0.5 },
    { at: [-0.1, 0.92, 0.42], len: 0.13, r: 0.042, bend: [0.07, -0.09, 0.05], flat: 0.5 },
    { at: [0.45, 0.7, 0.5], len: 0.13, r: 0.036, bend: [0.03, -0.11, 0.03], flat: 0.5 },
    { at: [0, 0.6, -0.8], len: 0.1, r: 0.05, bend: [0, -0.05, -0.04] },
    { at: [0.6, 0.4, -0.6], len: 0.1, r: 0.045, bend: [0.03, -0.06, -0.02] },
    { at: [-0.6, 0.4, -0.6], len: 0.1, r: 0.045, bend: [-0.03, -0.06, -0.02] },
  ];
  addSpikyHair(b, B.head, 'hair', spikes, true, 1.02);
  // long side-swept bang over one eye + side locks
  b.add(B.head, xf(hairLock(0.17, 0.045, 0.014, [0.06, 0, 0.04]), [-0.06, 0.215, 0.085], [180 - 20, 0, 40]), 'hair', 0.6);
  for (const sx of [1, -1]) {
    b.add(B.head, xf(hairLock(0.2, 0.03, 0.012, [sx * 0.01, 0, 0.03]), [sx * 0.094, 0.2, 0.055], [180 - 6, 0, sx * -6]), 'hair', 0.6);
  }
  // ponytail base + tie
  b.add(B.head, xf(ellipsoid(0.04, 0.035, 0.04), [0, 0.215, -0.085]), 'hair', 0.7);
  b.add(B.head, xf(torus(0.03, 0.009, 6, 14), [0, 0.218, -0.11], [20, 0, 0]), 'neonCyan', 0);
  // ear piercings
  for (const sx of [1, -1]) b.add(B.head, xf(torus(0.008, 0.0025, 4, 10), [sx * 0.1, 0.075, 0.0], [0, 90, 0]), 'gold', 0.2);

  // --- twin katanas ----------------------------------------------------------------------------------
  const blades: { base: THREE.Object3D; tip: THREE.Object3D; colorA: THREE.Color; colorB: THREE.Color }[] = [];
  const katana = (hand: THREE.Object3D, holo: string, glow: string, ca: number, cb: number) => {
    const w = weaponPivot(hand, true);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.016);
    shape.quadraticCurveTo(0.45, 0.026, 0.8, 0.05);
    shape.lineTo(0.86, 0.036);
    shape.quadraticCurveTo(0.45, -0.006, 0, -0.016);
    shape.closePath();
    b.add(w, xf(extrude(shape, 0.007, 0.002, 12), [0, 0, 0.11], [0, -90, 0]), 'blade', 0.9);
    // neon cutting edge + holo afterglow
    const edgeS = new THREE.Shape();
    edgeS.moveTo(0.02, -0.017);
    edgeS.quadraticCurveTo(0.45, -0.009, 0.855, 0.034);
    edgeS.lineTo(0.84, 0.04);
    edgeS.quadraticCurveTo(0.45, 0.0, 0.02, -0.008);
    edgeS.closePath();
    b.add(w, xf(extrude(edgeS, 0.012, 0, 12), [0, 0, 0.11], [0, -90, 0]), glow, 0);
    const holoS = new THREE.Shape();
    holoS.moveTo(0.02, 0.03);
    holoS.quadraticCurveTo(0.45, 0.045, 0.83, 0.075);
    holoS.lineTo(0.88, 0.03);
    holoS.quadraticCurveTo(0.45, -0.035, 0.02, -0.035);
    holoS.closePath();
    b.add(w, xf(extrude(holoS, 0.002, 0, 12), [0, 0, 0.11], [0, -90, 0]), holo, 0, false);
    // tsuba, handle, pommel
    b.add(w, xf(cyl(0.04, 0.04, 0.012, 8), [0, 0, 0.095], [90, 0, 0], [0.75, 1, 1]), 'gold', 0.6);
    b.add(w, xf(cyl(0.017, 0.018, 0.2, 10), [0, 0, -0.01], [90, 0, 0]), 'glove', 0.7);
    for (const z of [-0.08, -0.03, 0.02, 0.07]) b.add(w, xf(torus(0.019, 0.004, 4, 10), [0, 0, z], [0, 0, 45]), 'wrap', 0.2);
    b.add(w, xf(torus(0.02, 0.006, 5, 12), [0, 0, -0.115], [0, 0, 0]), glow, 0);
    blades.push({ base: marker(w, 0, 0, 0.2, 'base'), tip: marker(w, 0, 0.03, 0.95, 'tip'), colorA: new THREE.Color(ca), colorB: new THREE.Color(cb) });
    return w;
  };
  const wR = katana(B.handR, 'holoCyan', 'neonCyan', 0x2ef2ff, 0xffffff);
  const wL = katana(B.handL, 'holoPink', 'neonPink', 0xff3fd0, 0xffffff);

  // --- cloth: ponytail + scarf ------------------------------------------------------------------------
  const spheres = makeBodySpheres(rig);
  const headSphere = { bone: B.head, offset: new THREE.Vector3(0, 0.11, 0.01), radius: 0.13, world: new THREE.Vector3() };
  const ponytail = new ClothChain({
    anchor: B.head,
    offset: new THREE.Vector3(0, 0.22, -0.12),
    restDir: new THREE.Vector3(0, -0.35, -1),
    segments: 7,
    length: 0.62,
    stiffness: 0.045,
    stiffFalloff: 0.85,
    damping: 0.9,
    gravity: 9,
    render: 'tube',
    size: (t) => 0.042 * (1 - t * 0.75) + 0.008 * Math.sin(t * Math.PI),
    material: gradientToon({ color: 0xff4fb6, colorB: 0x7af6ff, shade: 0xc89cff, spec: 0.3, specSize: 0.9, rim: 0.5, from: 0.55, to: 1.0 }),
    radial: 7,
  }, [...spheres, headSphere]);
  const scarf = new ClothChain({
    anchor: B.neck,
    offset: new THREE.Vector3(0.03, 0.02, -0.06),
    restDir: new THREE.Vector3(0.15, -0.6, -1),
    segments: 9,
    length: 1.35,
    stiffness: 0.05,
    stiffFalloff: 0.8,
    damping: 0.93,
    gravity: 5,
    render: 'ribbon',
    size: (t) => 0.06 * (1 - t * 0.35),
    thickness: 0.012,
    side: new THREE.Vector3(1, 0, 0),
    material: gradientToon({ color: 0xff3fd0, colorB: 0x2ef2ff, side: THREE.DoubleSide, rim: 0.4, from: 0.1, to: 0.9 }),
  }, spheres);
  // scarf wrap around the neck
  b.add(B.neck, xf(torus(0.06, 0.022, 6, 18), [0, 0.0, -0.005], [90, 0, 0], [1, 1.1, 1]), 'neonPink', 0.6);

  const anims = novaAnims();
  return assembleVisual({
    rig,
    builder: b,
    cloth: [ponytail, scarf],
    bodySpheres: [...spheres, headSphere],
    blades,
    gear,
    weaponR: wR,
    weaponL: wL,
    offhandGrip: null,
    muzzle: blades[0].tip,
    materials: Object.values(M),
    anims,
    eyes,
  });
}

export function novaAnims(): ChampionAnimSet {
  const W = (p: [number, number, number], d: [number, number, number], u: [number, number, number] = [0, 1, 0]): WeaponSpec => ({ p, d, u });
  const legs: PoseSpec = {
    hips: [0, -0.1, 0],
    thighL: [-32, -16, 15], shinL: [48, 0, 0], footL: [-14, 16, -10],
    thighR: [14, 22, -18], shinR: [38, 0, 0], footR: [-22, -20, 14],
    spine: [12, 26, 0], chest: [2, 12, 0], neck: [0, -16, 0], head: [-4, -18, 0],
  };
  const idle = pose({
    ...legs,
    wR: W([-0.34, 0.9, 0.34], [-0.2, -0.38, 0.9], [0.1, 1, 0.3]),
    wL: W([0.3, 0.98, -0.12], [0.4, -0.35, -0.85], [0, 1, 0]),
  });
  const runArms = pose({
    wR: W([-0.27, 0.95, -0.28], [-0.22, 0.12, -0.97]),
    wL: W([0.27, 0.95, -0.28], [0.22, 0.12, -0.97]),
  });
  const airArms = pose({
    wR: W([-0.5, 1.12, 0.0], [-0.82, -0.3, -0.48]),
    wL: W([0.5, 1.12, 0.0], [0.82, -0.3, -0.48]),
  });
  const flyArms = pose({
    wR: W([-0.3, 0.98, -0.3], [-0.3, 0.05, -0.95]),
    wL: W([0.3, 0.98, -0.3], [0.3, 0.05, -0.95]),
  });
  const base = pose(legs);
  const backL = W([0.32, 1.0, -0.15], [0.45, -0.3, -0.84]);
  const backR = W([-0.32, 1.0, -0.15], [-0.45, -0.3, -0.84]);
  const clips = {
    ...sharedClips(idle),
    c1: clip('c1', base, [
      [0, { ...legs, wR: W([-0.48, 1.25, 0.02], [-0.9, 0.12, 0.42]), wL: backL, spine: [8, -22, 0], chest: [0, -14, 0] }],
      [0.08, { wR: W([-0.02, 1.15, 0.55], [0.25, 0.0, 0.97]), wL: backL, spine: [12, 16, 0], chest: [4, 14, 0], hips: [0, -0.12, 0.1], thighL: [-40, -10, 12], shinL: [50, 0, 0], thighR: [22, 18, -14], shinR: [30, 0, 0] }, Ease.outQuart],
      [0.16, { wR: W([0.42, 1.05, 0.18], [0.85, -0.12, -0.5]), wL: backL, spine: [14, 34, 0], chest: [4, 20, 0], hips: [0, -0.13, 0.12], thighL: [-42, -10, 12], shinL: [52, 0, 0], thighR: [24, 18, -14], shinR: [30, 0, 0] }, Ease.outCubic],
      [0.34, { ...legs, wR: W([0.2, 1.0, 0.3], [0.6, -0.3, 0.7]), wL: backL }, Ease.inOut],
    ], { events: [{ t: 0.02, id: 'swing' }, { t: 0.04, id: 'hitOn' }, { t: 0.14, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.12 }),
    c2: clip('c2', base, [
      [0, { ...legs, wL: W([0.48, 1.25, 0.02], [0.9, 0.12, 0.42]), wR: backR, spine: [8, 30, 0], chest: [0, 18, 0] }],
      [0.08, { wL: W([0.02, 1.12, 0.55], [-0.25, 0.0, 0.97]), wR: backR, spine: [12, -12, 0], chest: [4, -12, 0], hips: [0, -0.12, 0.12], thighL: [-20, -10, 12], shinL: [40, 0, 0], thighR: [-30, 18, -14], shinR: [45, 0, 0] }, Ease.outQuart],
      [0.16, { wL: W([-0.42, 1.02, 0.18], [-0.85, -0.12, -0.5]), wR: backR, spine: [14, -28, 0], chest: [4, -18, 0], hips: [0, -0.13, 0.14], thighL: [-20, -10, 12], shinL: [40, 0, 0], thighR: [-32, 18, -14], shinR: [46, 0, 0] }, Ease.outCubic],
      [0.34, { ...legs, wL: W([-0.2, 1.0, 0.3], [-0.6, -0.3, 0.7]), wR: backR }, Ease.inOut],
    ], { events: [{ t: 0.02, id: 'swing' }, { t: 0.04, id: 'hitOn' }, { t: 0.14, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.12 }),
    c3: clip('c3', base, [
      [0, { ...legs, wR: W([-0.36, 1.62, 0.12], [-0.35, 0.88, 0.3]), wL: W([0.36, 1.62, 0.12], [0.35, 0.88, 0.3]), spine: [-8, 0, 0], chest: [-8, 0, 0], hips: [0, -0.04, 0] }],
      [0.1, { wR: W([0.14, 0.92, 0.5], [0.5, -0.6, 0.62]), wL: W([-0.14, 0.92, 0.5], [-0.5, -0.6, 0.62]), spine: [26, 0, 0], chest: [12, 0, 0], hips: [0, -0.18, 0.14], thighL: [-50, -10, 12], shinL: [70, 0, 0], thighR: [16, 18, -14], shinR: [50, 0, 0] }, Ease.outExpo],
      [0.4, { ...legs, wR: W([0.1, 0.95, 0.48], [0.45, -0.55, 0.7]), wL: W([-0.1, 0.95, 0.48], [-0.45, -0.55, 0.7]) }, Ease.inOut],
    ], { events: [{ t: 0.03, id: 'swing' }, { t: 0.05, id: 'hitOn' }, { t: 0.16, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.14 }),
    c4: clip('c4', base, [
      [0, { wR: W([-0.5, 1.15, 0.1], [-0.95, 0.0, 0.3]), wL: W([0.5, 1.15, 0.1], [0.95, 0.0, 0.3]), hips: [0, 0.12, 0], thighL: [-60, 0, 10], shinL: [100, 0, 0], thighR: [-40, 0, -10], shinR: [100, 0, 0], spine: [6, 0, 0] }],
      [0.4, { wR: W([-0.55, 1.18, 0.1], [-0.95, 0.05, 0.3]), wL: W([0.55, 1.18, 0.1], [0.95, 0.05, 0.3]), hips: [0, 0.1, 0], thighL: [-50, 0, 10], shinL: [90, 0, 0], thighR: [-30, 0, -10], shinR: [90, 0, 0], spine: [8, 0, 0] }],
      [0.6, { ...legs, wR: W([-0.35, 0.95, 0.3], [-0.4, -0.4, 0.82]), wL: W([0.35, 0.95, 0.3], [0.4, -0.4, 0.82]) }, Ease.outCubic],
    ], { events: [{ t: 0.02, id: 'swing' }, { t: 0.04, id: 'hitOn' }, { t: 0.4, id: 'hitOff' }], fadeIn: 0.04, fadeOut: 0.14 }),
    air: clip('air', base, [
      [0, { wR: W([-0.3, 0.8, 0.32], [-0.2, -0.65, 0.73]), wL: W([0.3, 0.8, 0.32], [0.2, -0.65, 0.73]), thighL: [-70, 0, 10], shinL: [110, 0, 0], thighR: [-50, 0, -10], shinR: [100, 0, 0], spine: [16, 0, 0] }],
      [0.14, { wR: W([-0.26, 1.85, 0.25], [-0.2, 0.95, 0.22]), wL: W([0.26, 1.85, 0.25], [0.2, 0.95, 0.22]), thighL: [-30, 0, 10], shinL: [50, 0, 0], thighR: [-10, 0, -10], shinR: [40, 0, 0], spine: [-14, 0, 0], chest: [-8, 0, 0] }, Ease.outExpo],
      [0.42, { wR: W([-0.3, 1.5, 0.3], [-0.3, 0.6, 0.7]), wL: W([0.3, 1.5, 0.3], [0.3, 0.6, 0.7]), thighL: [-40, 0, 10], shinL: [60, 0, 0], thighR: [-20, 0, -10], shinR: [50, 0, 0] }, Ease.inOut],
    ], { events: [{ t: 0.01, id: 'swing' }, { t: 0.03, id: 'hitOn' }, { t: 0.18, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.14 }),
    // taunt: twirl both blades, then a crossed-blade pose
    taunt: clip('taunt', base, [
      [0, { ...legs }],
      [0.2, { wR: W([-0.4, 1.2, 0.2], [-0.6, 0.6, 0.5]), wL: W([0.4, 1.2, 0.2], [0.6, 0.6, 0.5]), spine: [0, 0, 0], hips: [0, -0.04, 0], thighL: [-10, -10, 8], shinL: [14, 0, 0], thighR: [6, 12, -8], shinR: [12, 0, 0] }],
      [0.4, { wR: W([-0.4, 1.2, 0.2], [-0.6, -0.6, -0.5]), wL: W([0.4, 1.2, 0.2], [0.6, -0.6, -0.5]), spine: [0, 0, 0], hips: [0, -0.04, 0], thighL: [-10, -10, 8], shinL: [14, 0, 0], thighR: [6, 12, -8], shinR: [12, 0, 0] }, Ease.linear],
      [0.6, { wR: W([-0.4, 1.2, 0.2], [-0.6, 0.6, 0.5]), wL: W([0.4, 1.2, 0.2], [0.6, 0.6, 0.5]), spine: [0, 0, 0], hips: [0, -0.04, 0], thighL: [-10, -10, 8], shinL: [14, 0, 0], thighR: [6, 12, -8], shinR: [12, 0, 0] }, Ease.linear],
      [0.8, { wR: W([-0.4, 1.2, 0.2], [-0.6, -0.6, -0.5]), wL: W([0.4, 1.2, 0.2], [0.6, -0.6, -0.5]), spine: [0, 0, 0], hips: [0, -0.04, 0], thighL: [-10, -10, 8], shinL: [14, 0, 0], thighR: [6, 12, -8], shinR: [12, 0, 0] }, Ease.linear],
      [1.05, { wR: W([0.12, 1.45, 0.35], [0.5, 0.7, 0.5]), wL: W([-0.12, 1.45, 0.35], [-0.5, 0.7, 0.5]), spine: [-6, -10, 0], chest: [-4, -6, 0], head: [-6, 14, 6], hips: [0, -0.02, 0], thighL: [-16, -10, 8], shinL: [20, 0, 0], thighR: [10, 18, -10], shinR: [16, 0, 0] }, Ease.outBack],
      [1.7, { wR: W([0.12, 1.45, 0.35], [0.5, 0.7, 0.5]), wL: W([-0.12, 1.45, 0.35], [-0.5, 0.7, 0.5]), spine: [-6, -10, 0], chest: [-4, -6, 0], head: [-6, 14, 6], hips: [0, -0.02, 0], thighL: [-16, -10, 8], shinL: [20, 0, 0], thighR: [10, 18, -10], shinR: [16, 0, 0] }],
      [2.0, { ...legs }, Ease.inOut],
    ], { events: [{ t: 0.05, id: 'swing' }, { t: 0.95, id: 'hitOff' }], fadeIn: 0.1, fadeOut: 0.2 }),
    glitch: clip('glitch', base, [
      [0, { wR: W([-0.3, 1.0, -0.32], [-0.3, 0.1, -0.95]), wL: W([0.3, 1.0, -0.32], [0.3, 0.1, -0.95]), spine: [40, 0, 0], chest: [10, 0, 0], head: [-30, 0, 0], hips: [0, -0.2, 0], thighL: [-60, 0, 8], shinL: [70, 0, 0], thighR: [30, 0, -8], shinR: [60, 0, 0] }],
      [0.3, { wR: W([-0.3, 1.0, -0.32], [-0.3, 0.1, -0.95]), wL: W([0.3, 1.0, -0.32], [0.3, 0.1, -0.95]), spine: [40, 0, 0], chest: [10, 0, 0], head: [-30, 0, 0], hips: [0, -0.2, 0], thighL: [-60, 0, 8], shinL: [70, 0, 0], thighR: [30, 0, -8], shinR: [60, 0, 0] }],
    ], { fadeIn: 0.02, fadeOut: 0.1 }),
    phantom: clip('phantom', base, [
      [0, { wR: W([-0.3, 1.72, 0.1], [-0.25, 0.9, -0.35]), wL: W([0.3, 1.72, 0.1], [0.25, 0.9, -0.35]), spine: [-10, 0, 0], chest: [-10, 0, 0], hips: [0, 0.02, 0], thighL: [-40, 0, 8], shinL: [60, 0, 0], thighR: [0, 0, -8], shinR: [40, 0, 0] }],
      [0.1, { wR: W([0.16, 0.85, 0.52], [0.4, -0.7, 0.6]), wL: W([-0.16, 0.85, 0.52], [-0.4, -0.7, 0.6]), spine: [32, 0, 0], chest: [14, 0, 0], hips: [0, -0.24, 0.12], thighL: [-70, 0, 12], shinL: [100, 0, 0], thighR: [20, 0, -12], shinR: [70, 0, 0] }, Ease.outExpo],
      [0.5, { ...legs, wR: W([0.14, 0.88, 0.5], [0.4, -0.65, 0.64]), wL: W([-0.14, 0.88, 0.5], [-0.4, -0.65, 0.64]) }, Ease.inOut],
    ], { events: [{ t: 0.03, id: 'swing' }, { t: 0.06, id: 'hitOn' }, { t: 0.16, id: 'hitOff' }], fadeIn: 0.02, fadeOut: 0.15 }),
  };
  return { idle, runArms, airArms, flyArms, armSwing: [0, 0], offhandLoco: 0, runLean: 18, clips };
}
