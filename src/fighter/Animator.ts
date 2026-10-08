import * as THREE from 'three';
import { BONES, BONE_COUNT, BONE_INDEX, type BoneName, Rig } from './Rig';

/**
 * Pose = local rotation for every bone + hip offset. Poses are authored in degrees (Euler YXZ,
 * same order as the rig) or as limb directions, compiled to quaternions and blended with nlerp.
 */
/** Weapon-driven IK channel: desired weapon transform in model space + IK weight. */
export class WeaponKey {
  readonly p = new THREE.Vector3();
  readonly q = new THREE.Quaternion();
  w = 0;
  copy(k: WeaponKey): this {
    this.p.copy(k.p);
    this.q.copy(k.q);
    this.w = k.w;
    return this;
  }
  lerpKeys(a: WeaponKey, b: WeaponKey, t: number): this {
    if (a.w < 1e-4) {
      this.p.copy(b.p);
      this.q.copy(b.q);
    } else if (b.w < 1e-4) {
      this.p.copy(a.p);
      this.q.copy(a.q);
    } else {
      this.p.lerpVectors(a.p, b.p, t);
      this.q.slerpQuaternions(a.q, b.q, t);
    }
    this.w = a.w + (b.w - a.w) * t;
    return this;
  }
}

export class Pose {
  readonly q = new Float32Array(BONE_COUNT * 4);
  readonly hips = new THREE.Vector3();
  /** right / left hand weapon targets */
  readonly wR = new WeaponKey();
  readonly wL = new WeaponKey();
  /** left hand on the two-handed weapon's off-hand grip */
  off = 0;
  constructor() {
    this.identity();
  }
  identity(): this {
    this.q.fill(0);
    for (let i = 0; i < BONE_COUNT; i++) this.q[i * 4 + 3] = 1;
    this.hips.set(0, 0, 0);
    this.wR.w = 0;
    this.wL.w = 0;
    this.off = 0;
    return this;
  }
  copy(p: Pose): this {
    this.q.set(p.q);
    this.hips.copy(p.hips);
    this.wR.copy(p.wR);
    this.wL.copy(p.wL);
    this.off = p.off;
    return this;
  }
  clone(): Pose {
    return new Pose().copy(this);
  }
  setQuat(bone: BoneName, q: THREE.Quaternion): this {
    const i = BONE_INDEX[bone] * 4;
    this.q[i] = q.x;
    this.q[i + 1] = q.y;
    this.q[i + 2] = q.z;
    this.q[i + 3] = q.w;
    return this;
  }
  getQuat(bone: BoneName, out: THREE.Quaternion): THREE.Quaternion {
    const i = BONE_INDEX[bone] * 4;
    return out.set(this.q[i], this.q[i + 1], this.q[i + 2], this.q[i + 3]);
  }
  setEuler(bone: BoneName, x: number, y: number, z: number): this {
    _e.set(x * D2R, y * D2R, z * D2R, 'YXZ');
    _qa.setFromEuler(_e);
    return this.setQuat(bone, _qa);
  }
  /** post-multiplies an extra local rotation (degrees) onto a bone */
  addEuler(bone: BoneName, x: number, y: number, z: number, w = 1): this {
    if (w === 0) return this;
    _e.set(x * D2R * w, y * D2R * w, z * D2R * w, 'YXZ');
    _qa.setFromEuler(_e);
    this.getQuat(bone, _qb).multiply(_qa);
    return this.setQuat(bone, _qb);
  }
  /** pre-multiplies (rotation in parent space) */
  preEuler(bone: BoneName, x: number, y: number, z: number, w = 1): this {
    if (w === 0) return this;
    _e.set(x * D2R * w, y * D2R * w, z * D2R * w, 'YXZ');
    _qa.setFromEuler(_e);
    this.getQuat(bone, _qb).premultiply(_qa);
    return this.setQuat(bone, _qb);
  }
}

const D2R = Math.PI / 180;
const _e = new THREE.Euler();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _v = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

export type JointSpec = [number, number, number] | { dir: [number, number, number]; twist?: number };
/** p = grip position (model space, feet at origin, facing +Z), d = blade direction, u = weapon "up" (spine side) */
export interface WeaponSpec {
  p: [number, number, number];
  d: [number, number, number];
  u: [number, number, number];
  w?: number;
}
export type PoseSpec = Partial<Record<BoneName, JointSpec>> & {
  hips?: [number, number, number];
  wR?: WeaponSpec | null;
  wL?: WeaponSpec | null;
  off?: number;
};

const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _bm = new THREE.Matrix4();
export function weaponQuat(d: [number, number, number], u: [number, number, number], out: THREE.Quaternion): THREE.Quaternion {
  _bz.set(d[0], d[1], d[2]).normalize();
  _by.set(u[0], u[1], u[2]);
  _by.addScaledVector(_bz, -_by.dot(_bz));
  if (_by.lengthSq() < 1e-8) _by.set(0, 1, 0).addScaledVector(_bz, -_bz.y);
  _by.normalize();
  _bx.crossVectors(_by, _bz).normalize();
  _bm.makeBasis(_bx, _by, _bz);
  return out.setFromRotationMatrix(_bm);
}

function applyWeaponSpec(k: WeaponKey, w: WeaponSpec | null | undefined): void {
  if (w === undefined) return;
  if (w === null) {
    k.w = 0;
    return;
  }
  k.p.set(w.p[0], w.p[1], w.p[2]);
  weaponQuat(w.d, w.u, k.q);
  k.w = w.w ?? 1;
}

export function pose(spec: PoseSpec, base?: Pose): Pose {
  const p = base ? base.clone() : new Pose();
  for (const name of BONES) {
    const j = spec[name];
    if (!j) continue;
    if (Array.isArray(j)) p.setEuler(name, j[0], j[1], j[2]);
    else {
      _v.set(j.dir[0], j.dir[1], j.dir[2]).normalize();
      _qa.setFromUnitVectors(DOWN, _v);
      if (j.twist) {
        _qb.setFromAxisAngle(DOWN, j.twist * D2R);
        _qa.multiply(_qb);
      }
      p.setQuat(name, _qa);
    }
  }
  if (spec.hips) p.hips.set(spec.hips[0], spec.hips[1], spec.hips[2]);
  applyWeaponSpec(p.wR, spec.wR);
  applyWeaponSpec(p.wL, spec.wL);
  if (spec.off !== undefined) p.off = spec.off;
  return p;
}

/** Bone weight masks for layering. */
export type Mask = Float32Array;
export function mask(bones: BoneName[], weight = 1): Mask {
  const m = new Float32Array(BONE_COUNT);
  for (const b of bones) m[BONE_INDEX[b]] = weight;
  return m;
}
export const UPPER_BODY: BoneName[] = ['spine', 'chest', 'neck', 'head', 'shoulderL', 'upperArmL', 'foreArmL', 'handL', 'shoulderR', 'upperArmR', 'foreArmR', 'handR'];
export const ARMS: BoneName[] = ['shoulderL', 'upperArmL', 'foreArmL', 'handL', 'shoulderR', 'upperArmR', 'foreArmR', 'handR'];
export const LEGS: BoneName[] = ['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
export const MASK_UPPER = mask(UPPER_BODY);
export const MASK_ARMS = mask(ARMS);
export const MASK_FULL = mask([...BONES]);

/** out = lerp(a, b, t) per bone (nlerp, shortest path), optional per-bone mask. */
export function blendPose(out: Pose, a: Pose, b: Pose, t: number, m?: Mask, hips = true): Pose {
  const qa = a.q;
  const qb = b.q;
  const qo = out.q;
  for (let i = 0; i < BONE_COUNT; i++) {
    const w = m ? t * m[i] : t;
    const k = i * 4;
    if (w <= 0) {
      qo[k] = qa[k];
      qo[k + 1] = qa[k + 1];
      qo[k + 2] = qa[k + 2];
      qo[k + 3] = qa[k + 3];
      continue;
    }
    if (w >= 1) {
      qo[k] = qb[k];
      qo[k + 1] = qb[k + 1];
      qo[k + 2] = qb[k + 2];
      qo[k + 3] = qb[k + 3];
      continue;
    }
    let bx = qb[k];
    let by = qb[k + 1];
    let bz = qb[k + 2];
    let bw = qb[k + 3];
    const dot = qa[k] * bx + qa[k + 1] * by + qa[k + 2] * bz + qa[k + 3] * bw;
    if (dot < 0) {
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }
    const x = qa[k] + (bx - qa[k]) * w;
    const y = qa[k + 1] + (by - qa[k + 1]) * w;
    const z = qa[k + 2] + (bz - qa[k + 2]) * w;
    const ww = qa[k + 3] + (bw - qa[k + 3]) * w;
    const l = Math.hypot(x, y, z, ww) || 1;
    qo[k] = x / l;
    qo[k + 1] = y / l;
    qo[k + 2] = z / l;
    qo[k + 3] = ww / l;
  }
  if (hips) out.hips.lerpVectors(a.hips, b.hips, t);
  else out.hips.copy(a.hips);
  const wr = m ? t * m[IDX_HAND_R] : t;
  const wl = m ? t * m[IDX_HAND_L] : t;
  out.wR.lerpKeys(a.wR, b.wR, wr);
  out.wL.lerpKeys(a.wL, b.wL, wl);
  out.off = a.off + (b.off - a.off) * wl;
  return out;
}
const IDX_HAND_R = BONE_INDEX.handR;
const IDX_HAND_L = BONE_INDEX.handL;

export function applyPose(p: Pose, rig: Rig): void {
  for (let i = 0; i < BONE_COUNT; i++) {
    const b = rig.bones[i];
    const k = i * 4;
    b.quaternion.set(p.q[k], p.q[k + 1], p.q[k + 2], p.q[k + 3]);
  }
  rig.bones[0].position.copy(rig.restPos[0]).add(p.hips);
}

// ---------------------------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------------------------

export type Ease = (t: number) => number;
export const Ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  smooth: (t: number) => t * t * (3 - 2 * t),
};

// ---------------------------------------------------------------------------------------------
// Keyframe clips
// ---------------------------------------------------------------------------------------------

export interface Key {
  t: number;
  pose: Pose;
  /** easing used when blending INTO this key from the previous one */
  ease?: Ease;
}

export interface ClipEvent {
  t: number;
  id: string;
}

export class Clip {
  readonly duration: number;
  constructor(
    readonly name: string,
    readonly keys: Key[],
    readonly opts: { loop?: boolean; events?: ClipEvent[]; mask?: Mask; fadeIn?: number; fadeOut?: number } = {},
  ) {
    this.keys.sort((a, b) => a.t - b.t);
    this.duration = this.keys[this.keys.length - 1].t;
  }
  get loop(): boolean {
    return !!this.opts.loop;
  }
  sample(time: number, out: Pose): Pose {
    const keys = this.keys;
    let t = time;
    if (this.opts.loop && this.duration > 0) t = ((t % this.duration) + this.duration) % this.duration;
    if (t <= keys[0].t) return out.copy(keys[0].pose);
    for (let i = 1; i < keys.length; i++) {
      const k1 = keys[i];
      if (t <= k1.t) {
        const k0 = keys[i - 1];
        const span = k1.t - k0.t;
        const a = span > 0 ? (t - k0.t) / span : 1;
        return blendPose(out, k0.pose, k1.pose, (k1.ease ?? Ease.inOut)(a));
      }
    }
    return out.copy(keys[keys.length - 1].pose);
  }
}

/** Convenience to build a clip from [time, spec, ease?] tuples layered over a base pose. */
export function clip(name: string, base: Pose, frames: Array<[number, PoseSpec, Ease?]>, opts: ConstructorParameters<typeof Clip>[2] = {}): Clip {
  return new Clip(
    name,
    frames.map(([t, spec, ease]) => ({ t, pose: pose(spec, base), ease })),
    opts,
  );
}

// ---------------------------------------------------------------------------------------------
// Two-bone IK (used to put the off hand on two-handed weapons)
// ---------------------------------------------------------------------------------------------

const _a = new THREE.Vector3();
const _t = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

function setWorldBasis(bone: THREE.Object3D, yAxis: THREE.Vector3, bendHint: THREE.Vector3) {
  // bone +Y points back toward the parent joint (limbs extend along -Y)
  _y.copy(yAxis).normalize();
  _z.copy(bendHint).addScaledVector(_y, -bendHint.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z);
  _qw.setFromRotationMatrix(_m);
  bone.parent!.getWorldQuaternion(_qp).invert();
  bone.quaternion.copy(_qp.multiply(_qw));
  bone.updateMatrixWorld(true);
}

/**
 * Solves upper/lower so that the end bone origin reaches `target` (world). `pole` is a world
 * point the elbow/knee should point toward. Weight blends with the current FK pose.
 */
export function solveTwoBone(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  end: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  weight = 1,
): void {
  if (weight <= 0) return;
  const lenA = lower.position.length();
  const lenB = end.position.length();
  upper.getWorldPosition(_a);
  const fkUpper = upper.quaternion.clone();
  const fkLower = lower.quaternion.clone();
  _t.copy(target);
  _dir.subVectors(_t, _a);
  let d = _dir.length();
  const maxD = (lenA + lenB) * 0.999;
  d = THREE.MathUtils.clamp(d, 0.01, maxD);
  _dir.normalize();
  const cosA = THREE.MathUtils.clamp((lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _pole.subVectors(pole, _a);
  _pole.addScaledVector(_dir, -_pole.dot(_dir));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, 0, -1);
  _pole.normalize();
  _e2.copy(_a).addScaledVector(_dir, lenA * cosA).addScaledVector(_pole, lenA * sinA);
  // upper: -Y along (elbow - shoulder); bend hint: elbow points to -Z (bone back side) => z = -pole
  const yU = new THREE.Vector3().subVectors(_a, _e2);
  const hint = _pole.clone().negate();
  setWorldBasis(upper, yU, hint);
  const endPos = _t.clone();
  if (target.distanceTo(_a) > maxD) endPos.copy(_a).addScaledVector(_dir, maxD);
  const yL = new THREE.Vector3().subVectors(_e2, endPos);
  setWorldBasis(lower, yL, hint);
  if (weight < 1) {
    upper.quaternion.slerpQuaternions(fkUpper, upper.quaternion, weight);
    lower.quaternion.slerpQuaternions(fkLower, lower.quaternion, weight);
    upper.updateMatrixWorld(true);
  }
}

/** Sets a bone's world rotation (blended by weight). */
export function setWorldQuat(bone: THREE.Object3D, q: THREE.Quaternion, weight = 1): void {
  bone.parent!.getWorldQuaternion(_qp).invert();
  _qw.copy(_qp).multiply(q);
  if (weight >= 1) bone.quaternion.copy(_qw);
  else bone.quaternion.slerp(_qw, weight);
  bone.updateMatrixWorld(true);
}
