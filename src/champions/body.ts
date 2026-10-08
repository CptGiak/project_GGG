import * as THREE from 'three';
import type { ModelBuilder } from '../fighter/ModelBuilder';
import type { Rig } from '../fighter/Rig';
import type { BodySphere } from '../fighter/Cloth';
import { animeHead, cyl, ellipsoid, lathe, limb, poly, rbox, sweep, torus, wrapAroundY, xf, extrude, bentCone, type V3 } from '../fighter/shapes';

/**
 * Shared anatomy + common outfit pieces. Every champion assembles its body from these with
 * its own materials, then adds signature pieces (hair, coats, weapons) on top.
 */

export interface BodyMats {
  skin: string;
  top: string; // shirt / torso layer
  pants: string;
  boots: string;
  bootSole?: string;
  sleeve?: string; // upper arm (defaults to top)
  forearm?: string; // forearm (defaults to sleeve)
  glove?: string; // hands (defaults to skin)
  belt?: string;
  /** abdomen layer (e.g. skin for a crop top), defaults to top */
  abdomen?: string;
  /** pelvis layer, defaults to pants */
  pelvis?: string;
  /** shorts layer over the thighs, defaults to pelvis */
  shorts?: string;
}

export interface BodyOptions {
  bareUpperArm?: boolean;
  bareForearm?: boolean;
  bareThigh?: boolean;
  bareShin?: boolean;
  shorts?: boolean;
  bust?: number;
  pecs?: number;
}

export function buildBody(b: ModelBuilder, rig: Rig, m: BodyMats, o: BodyOptions = {}): void {
  const s = rig.spec;
  const B = rig.byName;
  const k = s.bulk;
  const f = s.female;

  // --- pelvis -----------------------------------------------------------------------------
  const pelvisW = f ? 1.1 : 1.0;
  b.add(B.hips, lathe([[0, -0.115], [0.095, -0.105], [0.148 * k, -0.06], [0.162 * k, 0.0], [0.152 * k, 0.06], [0.132 * k, 0.1], [0, 0.112]], 18, pelvisW, 0.7), m.pelvis ?? m.pants);

  // --- abdomen ----------------------------------------------------------------------------
  const waist = f ? 0.104 : 0.12 * k;
  b.add(B.spine, lathe([[0, -0.1], [waist + 0.012, -0.085], [waist, 0.0], [waist * 1.02, 0.08], [waist * 1.12, 0.16], [0, 0.2]], 18, f ? 1.04 : 1.08, 0.72), m.abdomen ?? m.top);

  // --- chest -------------------------------------------------------------------------------
  const cw = f ? 0.135 : 0.158 * k;
  b.add(
    B.chest,
    xf(lathe([[0, -0.05], [cw * 0.86, -0.04], [cw * 0.94, 0.04], [cw, 0.12], [cw * 0.98, 0.17], [cw * 0.82, 0.215], [cw * 0.42, 0.238], [0, 0.245]], 20, f ? 1.12 : 1.2, f ? 0.7 : 0.66), [0, 0, 0.004]),
    m.top,
  );
  if (!f && (o.pecs ?? 0.8) > 0) {
    const pk = o.pecs ?? 0.8;
    for (const sx of [1, -1]) {
      b.add(B.chest, xf(ellipsoid(0.075 * k, 0.058 * k, 0.035 * pk, 12, 10), [sx * 0.07, 0.11, 0.078 * k], [0, sx * 12, 0]), m.top);
    }
  }
  if (f && (o.bust ?? 1) > 0) {
    const bk = o.bust ?? 1;
    for (const sx of [1, -1]) {
      b.add(B.chest, xf(ellipsoid(0.058, 0.055, 0.05 * bk, 14, 12), [sx * 0.058, 0.098, 0.062], [8, sx * 18, 0]), m.top);
    }
  }

  // --- neck & head ---------------------------------------------------------------------------
  b.add(B.neck, xf(cyl(f ? 0.04 : 0.049 * k, f ? 0.045 : 0.056 * k, 0.15, 12), [0, 0.035, 0.0]), m.skin);
  b.add(B.head, xf(animeHead(f ? 0.111 : 0.117, f ? 0.4 : 0.34, f ? 0.12 : 0.1, f), [0, 0.11, 0.012]), m.skin);
  // ears
  for (const sx of [1, -1]) {
    b.add(B.head, xf(ellipsoid(0.014, 0.026, 0.018, 8, 6), [sx * (f ? 0.1 : 0.106), 0.1, -0.005], [0, 0, sx * -10]), m.skin, 0.6);
  }

  // --- arms -----------------------------------------------------------------------------------
  const sleeve = m.sleeve ?? m.top;
  const fore = m.forearm ?? sleeve;
  const glove = m.glove ?? m.skin;
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const ua = B[`upperArm${side}`];
    const fa = B[`foreArm${side}`];
    const hand = B[`hand${side}`];
    const ar = f ? 0.84 : k;
    b.add(ua, xf(ellipsoid(0.066 * ar, 0.07 * ar, 0.064 * ar, 14, 12), [sx * 0.008, -0.02, 0]), o.bareUpperArm ? m.skin : sleeve);
    b.add(ua, limb(s.upperArm, 0.056 * ar, 0.043 * ar, { bulge: 0.008 * ar, bulgeAt: 0.35, capTop: 0.4 }), o.bareUpperArm ? m.skin : sleeve);
    b.add(fa, limb(s.foreArm, 0.045 * ar, 0.032 * ar, { bulge: 0.007 * ar, bulgeAt: 0.22, sz: 0.9 }), o.bareForearm ? m.skin : fore);
    addHand(b, hand, glove, sx, f);
  }

  // --- legs -----------------------------------------------------------------------------------
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const th = B[`thigh${side}`];
    const sh = B[`shin${side}`];
    const ft = B[`foot${side}`];
    const lk = f ? 0.92 : k;
    b.add(th, xf(limb(s.thigh, 0.09 * lk, 0.056 * lk, { bulge: 0.01 * lk, bulgeAt: 0.25, sz: 1.05, capTop: 0.6 }), [sx * 0.004, 0, 0]), o.bareThigh ? m.skin : m.pants);
    b.add(sh, limb(s.shin, 0.056 * lk, 0.038 * lk, { bulge: 0.011 * lk, bulgeAt: 0.25, sz: 1.05 }), o.bareShin ? m.skin : m.pants);
    // knee cap
    b.add(sh, xf(ellipsoid(0.042 * lk, 0.045 * lk, 0.03, 10, 8), [0, -0.005, 0.03]), o.bareShin ? m.skin : m.pants, 0.5);
    addBoot(b, ft, m.boots, m.bootSole ?? m.boots, sx, f);
  }
  if (o.shorts) {
    for (const side of ['L', 'R'] as const) {
      const th = B[`thigh${side}`];
      b.add(th, xf(limb(0.13, 0.1 * (f ? 0.95 : k), 0.088 * (f ? 0.95 : k), { capTop: 0.2, capBottom: 0.2, sz: 1.06 }), [0, -0.01, 0]), m.shorts ?? m.pelvis ?? m.pants);
    }
  }
}

export function addHand(b: ModelBuilder, hand: THREE.Object3D, mat: string, sx: number, female: boolean): void {
  const k = female ? 0.88 : 1;
  // fist: palm block + knuckle ridge + thumb
  b.add(hand, xf(rbox(0.05 * k, 0.085 * k, 0.075 * k, 0.02 * k), [0, -0.045 * k, 0.004]), mat, 0.7);
  b.add(hand, xf(rbox(0.044 * k, 0.03 * k, 0.07 * k, 0.012 * k), [-sx * 0.012, -0.092 * k, 0.006]), mat, 0.7);
  b.add(hand, xf(limb(0.045 * k, 0.014 * k, 0.012 * k, {}), [-sx * 0.026 * k, -0.035 * k, 0.03 * k], [40, 0, -sx * 25]), mat, 0.6);
}

export function addBoot(b: ModelBuilder, foot: THREE.Object3D, mat: string, sole: string, sx: number, female: boolean): void {
  const k = female ? 0.9 : 1;
  // shaft
  b.add(foot, xf(cyl(0.05 * k, 0.056 * k, 0.12, 12), [0, 0.02, -0.005]), mat);
  // foot body
  b.add(foot, xf(rbox(0.096 * k, 0.085, 0.235 * k, 0.035), [sx * 0.003, -0.032, 0.045 * k]), mat);
  // sole
  b.add(foot, xf(rbox(0.104 * k, 0.026, 0.25 * k, 0.012), [sx * 0.003, -0.068, 0.046 * k]), sole, 0.8);
  // toe cap
  b.add(foot, xf(ellipsoid(0.048 * k, 0.04, 0.05, 12, 8), [sx * 0.003, -0.04, 0.14 * k]), mat, 0.6);
}

/** Body collision spheres used by cloth so coats don't clip through legs/torso. */
export function makeBodySpheres(rig: Rig): BodySphere[] {
  const B = rig.byName;
  const s = rig.spec;
  const mk = (bone: THREE.Object3D, off: V3, r: number): BodySphere => ({ bone, offset: new THREE.Vector3(...off), radius: r, world: new THREE.Vector3() });
  return [
    mk(B.hips, [0, -0.02, 0], 0.17 * s.bulk),
    mk(B.spine, [0, 0.06, 0], 0.15 * s.bulk),
    mk(B.chest, [0, 0.1, 0], 0.17 * s.bulk),
    mk(B.upperArmL, [0, -0.02, 0], 0.075 * s.bulk),
    mk(B.upperArmR, [0, -0.02, 0], 0.075 * s.bulk),
    mk(B.thighL, [0, -0.12, 0.01], 0.1),
    mk(B.thighR, [0, -0.12, 0.01], 0.1),
    mk(B.thighL, [0, -0.3, 0.01], 0.085),
    mk(B.thighR, [0, -0.3, 0.01], 0.085),
    mk(B.shinL, [0, -0.12, 0], 0.07),
    mk(B.shinR, [0, -0.12, 0], 0.07),
  ];
}

// ---------------------------------------------------------------------------------------------
// Face pieces
// ---------------------------------------------------------------------------------------------

/** Persona-style domino mask wrapped on the face, with glowing eye slits. */
export function addDominoMask(b: ModelBuilder, head: THREE.Object3D, maskMat: string, eyeMat: string, style: 'sharp' | 'wing' | 'elegant' = 'sharp', female = false): void {
  const r = female ? 0.108 : 0.114;
  let shape: THREE.Shape;
  if (style === 'wing') {
    shape = poly([-0.13, 0.03, -0.085, 0.055, -0.03, 0.03, 0, 0.012, 0.03, 0.03, 0.085, 0.055, 0.13, 0.03, 0.1, -0.005, 0.06, -0.03, 0.02, -0.02, 0, -0.008, -0.02, -0.02, -0.06, -0.03, -0.1, -0.005]);
  } else if (style === 'elegant') {
    shape = new THREE.Shape();
    shape.moveTo(-0.12, 0.05);
    shape.quadraticCurveTo(-0.06, 0.07, -0.02, 0.03);
    shape.quadraticCurveTo(0, 0.018, 0.02, 0.03);
    shape.quadraticCurveTo(0.06, 0.07, 0.12, 0.05);
    shape.quadraticCurveTo(0.1, -0.035, 0.05, -0.03);
    shape.quadraticCurveTo(0.015, -0.025, 0, -0.01);
    shape.quadraticCurveTo(-0.015, -0.025, -0.05, -0.03);
    shape.quadraticCurveTo(-0.1, -0.035, -0.12, 0.05);
  } else {
    shape = poly([-0.115, 0.022, -0.07, 0.042, -0.025, 0.028, 0, 0.012, 0.025, 0.028, 0.07, 0.042, 0.115, 0.022, 0.095, -0.012, 0.055, -0.03, 0.018, -0.02, 0, -0.006, -0.018, -0.02, -0.055, -0.03, -0.095, -0.012]);
  }
  // eye holes
  for (const sx of [1, -1]) {
    const hole = new THREE.Path();
    hole.absellipse(sx * 0.048, 0.008, 0.026, 0.012, 0, Math.PI * 2, false, sx * 0.18);
    shape.holes.push(hole);
  }
  const g = wrapAroundY(extrude(shape, 0.008, 0.002, 12), r + 0.006);
  b.add(head, xf(g, [0, 0.112, 0.012]), maskMat, 0.8);
  // eyes (glowing slits behind the holes)
  for (const sx of [1, -1]) {
    const eye = wrapAroundY(xf(ellipsoid(0.022, 0.0085, 0.004, 12, 6), [sx * 0.048, 0.007, 0], [0, 0, sx * 10]), r + 0.003);
    b.add(head, xf(eye, [0, 0.112, 0.012]), eyeMat, 0);
  }
}

/** Minimal anime face: nose wedge + mouth line (eyes come from masks/visors). */
export function addFace(b: ModelBuilder, head: THREE.Object3D, mat: string, female = false): void {
  const r = female ? 0.108 : 0.114;
  // nose: small wedge
  const nose = new THREE.ConeGeometry(0.009, 0.026, 4);
  b.add(head, xf(nose, [0, 0.082, 0.012 + r * 0.99], [-20, 45, 0], [1, 1, 0.7]), mat, 0);
  // mouth
  const mouth = wrapAroundY(xf(rbox(0.026, 0.0035, 0.003, 0.0015), [0, 0, 0]), r * 0.93);
  b.add(head, xf(mouth, [0, 0.045, 0.012]), mat, 0);
}

/** Curved visor band across the eyes. */
export function addVisor(b: ModelBuilder, head: THREE.Object3D, frameMat: string, lensMat: string, female = false, height = 0.034): void {
  const r = female ? 0.108 : 0.114;
  const lens = poly([-0.12, height * 0.5, 0.12, height * 0.5, 0.135, -height * 0.2, 0.06, -height * 0.55, 0, -height * 0.35, -0.06, -height * 0.55, -0.135, -height * 0.2]);
  b.add(head, xf(wrapAroundY(extrude(lens, 0.006, 0.0, 10), r + 0.01), [0, 0.112, 0.012]), lensMat, 0.7);
  const band = poly([-0.15, 0.006, 0.15, 0.006, 0.15, -0.006, -0.15, -0.006]);
  b.add(head, xf(wrapAroundY(extrude(band, 0.008, 0.0, 6), r + 0.013), [0, 0.112 + height * 0.5, 0.012]), frameMat, 0.6);
  // temple pieces
  for (const sx of [1, -1]) {
    b.add(head, xf(rbox(0.012, 0.022, 0.05, 0.005), [sx * (r + 0.004), 0.115, -0.02], [0, sx * 8, 0]), frameMat, 0.6);
  }
}

// ---------------------------------------------------------------------------------------------
// Hair
// ---------------------------------------------------------------------------------------------

export interface SpikeSpec {
  /** position on the head (unit sphere direction, head-local) */
  at: V3;
  len: number;
  r: number;
  /** tip bend offset in head space */
  bend: V3;
  flat?: number;
}

/** Hair cap + spikes. Spikes grow out from the skull along their direction. */
export function addSpikyHair(b: ModelBuilder, head: THREE.Object3D, mat: string, spikes: SpikeSpec[], female = false, cap = 1): void {
  const r = female ? 0.112 : 0.118;
  const c = new THREE.Vector3(0, 0.122, 0.0);
  // skull cap (slightly larger than head, cut at forehead)
  const capG = new THREE.SphereGeometry(r * 1.07 * cap, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.56);
  capG.scale(0.95, 1.05, 1.05);
  xf(capG, [0, 0.122, -0.006], [-14, 0, 0]);
  b.add(head, capG, mat);
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const sp of spikes) {
    dir.set(...sp.at).normalize();
    const g = bentCone(sp.len, sp.r, [0, 0, 0], 6, 6, sp.flat ?? 0.6);
    // orient +Y along dir
    q.setFromUnitVectors(up, dir);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    g.applyMatrix4(m);
    // bend in head space (applied after orientation): offset vertices by bend * t^2
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
      const t = THREE.MathUtils.clamp(v.dot(dir) / sp.len, 0, 1);
      v.addScaledVector(new THREE.Vector3(...sp.bend), t * t);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    const base = c.clone().addScaledVector(dir, r * 0.9);
    g.translate(base.x, base.y, base.z);
    b.add(head, g, mat, 0.8);
  }
}

/** A strand of hair/bang hanging from a point on the head following a list of points. */
export function addStrand(b: ModelBuilder, head: THREE.Object3D, mat: string, pts: V3[], r0: number, r1: number, flat = 0.55): void {
  const g = sweep(pts.map((p) => new THREE.Vector3(...p)), (t) => THREE.MathUtils.lerp(r0, r1, Math.pow(t, 0.8)), 7, 14, true, flat);
  b.add(head, g, mat, 0.7);
}

// ---------------------------------------------------------------------------------------------
// ODM gear (sleek, neon) – shared by all champions
// ---------------------------------------------------------------------------------------------

export function addODMGear(b: ModelBuilder, rig: Rig, mats: { body: string; accent: string; glow: string }): { gearL: THREE.Object3D; gearR: THREE.Object3D; nozzle: THREE.Object3D } {
  const hips = rig.byName.hips;
  const s = rig.spec;
  const w = s.female ? 0.19 : 0.205 * s.bulk;
  // belt
  b.add(hips, xf(torus(0.15 * s.bulk * (s.female ? 1.08 : 1), 0.022, 6, 28), [0, 0.06, 0], [90, 0, 0], [1, 0.72, 1]), mats.body, 0.7);
  const result: Record<string, THREE.Object3D> = {};
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const g = new THREE.Group();
    g.name = `gear${side}`;
    g.position.set(sx * w, -0.02, -0.02);
    hips.add(g);
    // canister
    b.add(g, xf(rbox(0.075, 0.1, 0.24, 0.03), [sx * 0.02, 0, -0.03], [0, sx * -6, 0]), mats.body);
    b.add(g, xf(rbox(0.08, 0.02, 0.18, 0.008), [sx * 0.021, 0.035, -0.03], [0, sx * -6, 0]), mats.accent, 0.5);
    b.add(g, xf(rbox(0.006, 0.05, 0.2, 0.003), [sx * 0.06, 0, -0.035], [0, sx * -6, 0]), mats.glow, 0);
    // hook launcher barrel (points forward)
    b.add(g, xf(cyl(0.022, 0.026, 0.09, 10), [sx * 0.02, 0.0, 0.11], [90, 0, 0]), mats.accent, 0.6);
    b.add(g, xf(torus(0.022, 0.006, 6, 14), [sx * 0.02, 0.0, 0.155], [0, 0, 0]), mats.glow, 0);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(sx * 0.02, 0.0, 0.16);
    g.add(muzzle);
    result[`gear${side}`] = muzzle;
  }
  // back gas unit
  const nozzleGroup = new THREE.Group();
  nozzleGroup.position.set(0, 0.02, -0.15 * s.bulk);
  hips.add(nozzleGroup);
  b.add(nozzleGroup, xf(rbox(0.16, 0.08, 0.06, 0.02), [0, 0, 0]), mats.body);
  for (const sx of [1, -1]) {
    b.add(nozzleGroup, xf(cyl(0.018, 0.026, 0.06, 10), [sx * 0.05, -0.01, -0.04], [-70, 0, 0]), mats.accent, 0.6);
  }
  b.add(nozzleGroup, xf(rbox(0.1, 0.008, 0.062, 0.003), [0, 0.03, 0]), mats.glow, 0);
  const nozzle = new THREE.Object3D();
  nozzle.position.set(0, -0.02, -0.07);
  nozzleGroup.add(nozzle);
  return { gearL: result.gearL, gearR: result.gearR, nozzle };
}

