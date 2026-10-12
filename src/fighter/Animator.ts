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
  /**
   * Elbow / knee hint: model-space direction the joint points toward, length = how much it
   * overrides the chain's default pole (0 = default, 1 = this direction). Keys lerp it.
   */
  readonly e = new THREE.Vector3();
  copy(k: WeaponKey): this {
    this.p.copy(k.p);
    this.q.copy(k.q);
    this.w = k.w;
    this.e.copy(k.e);
    return this;
  }
  lerpKeys(a: WeaponKey, b: WeaponKey, t: number): this {
    if (a.w < 1e-4) {
      this.p.copy(b.p);
      this.q.copy(b.q);
      this.e.copy(b.e);
    } else if (b.w < 1e-4) {
      this.p.copy(a.p);
      this.q.copy(a.q);
      this.e.copy(a.e);
    } else {
      this.p.lerpVectors(a.p, b.p, t);
      this.q.slerpQuaternions(a.q, b.q, t);
      this.e.lerpVectors(a.e, b.e, t);
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
  /** planted-foot targets (ankle position + foot rotation, model space): leg IK */
  readonly fL = new WeaponKey();
  readonly fR = new WeaponKey();
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
    this.fL.w = 0;
    this.fR.w = 0;
    this.off = 0;
    return this;
  }
  copy(p: Pose): this {
    this.q.set(p.q);
    this.hips.copy(p.hips);
    this.wR.copy(p.wR);
    this.wL.copy(p.wL);
    this.fL.copy(p.fL);
    this.fR.copy(p.fR);
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
  /**
   * Elbow hint (model space, x = the character's left): where the elbow points in this key. Set
   * it whenever the wrist target lines up with the chain's default pole (hand hanging at the
   * side, straight out, overhead...) or the elbow flips; keys in between lerp it with the hand.
   */
  e?: [number, number, number];
}
/**
 * Planted foot: the ankle (foot bone origin) goes to `p` (model space; y = footHeight is flat on
 * the ground) and the knee bends by IK; yaw turns the toes (+ = toward the left), pitch lifts
 * them (+ = toes up). The FK leg angles of the pose are used again when the weight fades.
 */
export interface FootSpec {
  p: [number, number, number];
  yaw?: number;
  pitch?: number;
  w?: number;
}
export type PoseSpec = Partial<Record<Exclude<BoneName, 'hips'>, JointSpec>> & {
  /** pelvis translation (m) from its rest position */
  hips?: [number, number, number];
  /** pelvis rotation (degrees YXZ, like any bone): contrapposto, weight shifts, recoil hip turn */
  pelvis?: JointSpec;
  wR?: WeaponSpec | null;
  wL?: WeaponSpec | null;
  fL?: FootSpec | null;
  fR?: FootSpec | null;
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
  if (w.e) k.e.set(w.e[0], w.e[1], w.e[2]).normalize();
  else k.e.set(0, 0, 0);
}

function applyFootSpec(k: WeaponKey, f: FootSpec | null | undefined): void {
  if (f === undefined) return;
  if (f === null) {
    k.w = 0;
    return;
  }
  k.p.set(f.p[0], f.p[1], f.p[2]);
  _e.set(-(f.pitch ?? 0) * D2R, (f.yaw ?? 0) * D2R, 0, 'YXZ');
  k.q.setFromEuler(_e);
  k.w = f.w ?? 1;
}

export function pose(spec: PoseSpec, base?: Pose): Pose {
  const p = base ? base.clone() : new Pose();
  for (const name of BONES) {
    const j = name === 'hips' ? spec.pelvis : spec[name];
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
  applyFootSpec(p.fL, spec.fL);
  applyFootSpec(p.fR, spec.fR);
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
  out.fL.lerpKeys(a.fL, b.fL, m ? t * m[IDX_FOOT_L] : t);
  out.fR.lerpKeys(a.fR, b.fR, m ? t * m[IDX_FOOT_R] : t);
  out.off = a.off + (b.off - a.off) * wl;
  return out;
}
const IDX_HAND_R = BONE_INDEX.handR;
const IDX_HAND_L = BONE_INDEX.handL;
const IDX_FOOT_L = BONE_INDEX.footL;
const IDX_FOOT_R = BONE_INDEX.footR;

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
  outSine: (t: number) => Math.sin((t * Math.PI) / 2),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  /** held key: no in-between (limited animation, Guilty Gear Xrd style); jumps at the next key */
  step: (t: number) => (t < 1 ? 0 : 1),
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
  /**
   * Weapon kick fired with the event (see FighterAnimator.kick): recoil authored with the clip, so
   * every copy of the clip (local, remote, viewer) kicks the same.
   */
  kick?: { pitch?: number; back?: number; roll?: number; yaw?: number; body?: number; freq?: number; zeta?: number; rise?: number; hang?: number };
}

export interface ClipOptions {
  loop?: boolean;
  events?: ClipEvent[];
  mask?: Mask;
  fadeIn?: number;
  fadeOut?: number;
  /**
   * Ease for keys that do not name one. The historical default is inOut, which stops the motion
   * dead at every key: prefer outCubic into extremes and linear through passing keys.
   */
  ease?: Ease;
  /**
   * Overlap: these bones play the clip this many frames (1/60 s) late, so the head trails the
   * chest that trails the spine (e.g. { chest: 1, neck: 2, head: 3 }).
   */
  lag?: Partial<Record<BoneName, number>>;
  /**
   * Key times are in BEATS of the music: the animator plays the clip at the track tempo and
   * phases it so t = 1 lands on the next beat (0..1 is the lead-in / anticipation).
   */
  beats?: boolean;
  /**
   * Inertialization half-life for this clip (s), overriding the champion's `inertial`: fast
   * actions whose key pose must show within a few frames (a throw that releases at f6) want
   * 0.025-0.035; slow emotes 0.1.
   */
  inertia?: number;
}

const _lagPose = new Pose();

export class Clip {
  readonly duration: number;
  private lagGroups: Array<{ dt: number; bones: number[] }> = [];
  constructor(
    readonly name: string,
    readonly keys: Key[],
    readonly opts: ClipOptions = {},
  ) {
    this.keys.sort((a, b) => a.t - b.t);
    this.duration = this.keys[this.keys.length - 1].t;
    if (opts.lag) {
      const by = new Map<number, number[]>();
      for (const [b, f] of Object.entries(opts.lag) as Array<[BoneName, number]>) {
        if (!f) continue;
        if (!by.has(f)) by.set(f, []);
        by.get(f)!.push(BONE_INDEX[b]);
      }
      for (const [f, bones] of by) this.lagGroups.push({ dt: f / 60, bones });
    }
  }
  get loop(): boolean {
    return !!this.opts.loop;
  }
  sample(time: number, out: Pose): Pose {
    this.sampleRaw(time, out);
    for (const g of this.lagGroups) {
      this.sampleRaw(this.opts.loop ? time - g.dt : Math.max(0, time - g.dt), _lagPose);
      for (const i of g.bones) for (let c = 0; c < 4; c++) out.q[i * 4 + c] = _lagPose.q[i * 4 + c];
    }
    return out;
  }
  private sampleRaw(time: number, out: Pose): Pose {
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
        return blendPose(out, k0.pose, k1.pose, (k1.ease ?? this.opts.ease ?? Ease.inOut)(a));
      }
    }
    return out.copy(keys[keys.length - 1].pose);
  }
}

/** Convenience to build a clip from [time, spec, ease?] tuples layered over a base pose. */
export function clip(name: string, base: Pose, frames: Array<[number, PoseSpec, Ease?]>, opts: ClipOptions = {}): Clip {
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
const _e2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

const _ik = new THREE.Quaternion();
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
 *
 * Partial weights blend in the limb's own terms, not per-bone rotations: the reach direction
 * (slerp on the sphere around the root joint, so the end never cuts through the shoulder), the
 * reach distance (lerp) and the swivel of the elbow/knee around the root-end axis, from where FK
 * had them to the target and pole; then the chain is solved fully. A per-bone slerp between two
 * limb poses 120+ degrees apart takes the wrong way round and spins the limb; lerping the target
 * point folds the elbow when the path passes the shoulder. This does neither.
 */
export function solveTwoBone(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  end: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  weight = 1,
  /** legs: the joint (knee) points toward the pole on the bone's front (+Z) side */
  frontJoint = false,
  /** last frame's result of this chain (temporal coherence of the weight fade-in) */
  memo?: IKMemo,
): void {
  if (weight <= 0) {
    if (memo) {
      memo.remember(upper.quaternion, lower.quaternion);
      memo.okDir = false;
    }
    return;
  }
  const lenA = lower.position.length();
  const lenB = end.position.length();
  upper.getWorldPosition(_a);
  if (weight < 1) {
    _fkU.copy(upper.quaternion);
    _fkL.copy(lower.quaternion);
    end.getWorldPosition(_fkEnd);
    lower.getWorldPosition(_fkJoint);
    const reach = (lenA + lenB) * 0.999;
    // reach direction and distance, FK and IK
    _u1.subVectors(target, _a);
    let r1 = _u1.length();
    if (r1 < 1e-5) _u1.set(0, -1, 0);
    else _u1.divideScalar(r1);
    _u0.subVectors(_fkEnd, _a);
    let r0 = _u0.length();
    if (r0 < 1e-5) _u0.copy(_u1);
    else _u0.divideScalar(r0);
    r0 = Math.min(r0, reach);
    r1 = Math.min(r1, reach);
    const near = memo?.okDir;
    slerpUnitNear(_u, _u0, _u1, weight, near ? memo!.dir : undefined);
    _tgt.copy(_a).addScaledVector(_u, r0 + (r1 - r0) * weight);
    // swivel: FK's bend direction and the pole's, each carried onto the blended axis, then blended
    perpUnit(_s0, _fkJoint, _u0, _u1);
    _sq.setFromUnitVectors(_u0, _u);
    _s0.applyQuaternion(_sq);
    perpUnit(_s1, pole, _u1, _s0);
    _sq.setFromUnitVectors(_u1, _u);
    _s1.applyQuaternion(_sq);
    slerpUnitNear(_sw, _s0, _s1, weight, near ? memo!.swv : undefined);
    if (memo) {
      memo.dir.copy(_u);
      memo.swv.copy(_sw);
      memo.okDir = true;
    }
    _pl.copy(_a).addScaledVector(_u, 0.25).addScaledVector(_sw, 0.5);
    solveChain(upper, lower, lenA, lenB, _tgt, _pl, frontJoint);
    // at weight 0 the solve lands on FK's joint positions but sets each bone's twist from the bend
    // plane: fade that in over the first part of the weight (a small, unambiguous rotation)
    if (weight < IK_FADE) {
      const k = weight / IK_FADE;
      const nearQ = memo?.ok;
      _ik.copy(upper.quaternion);
      slerpNear(upper.quaternion, _fkU, _ik, k, nearQ ? memo!.upper : undefined);
      _ik.copy(lower.quaternion);
      slerpNear(lower.quaternion, _fkL, _ik, k, nearQ ? memo!.lower : undefined);
      upper.updateMatrixWorld(true);
    }
  } else {
    solveChain(upper, lower, lenA, lenB, target, pole, frontJoint);
    if (memo) memo.okDir = false;
  }
  if (memo) memo.remember(upper.quaternion, lower.quaternion);
}

const _u0 = new THREE.Vector3();
const _u1 = new THREE.Vector3();
const _u = new THREE.Vector3();
const _s0 = new THREE.Vector3();
const _s1 = new THREE.Vector3();
const _sw = new THREE.Vector3();
const _sq = new THREE.Quaternion();

/** unit-vector slerp (antipodal: turns about any axis perpendicular to a) */
function slerpUnit(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  const c = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  if (c > 0.9999) return out.lerpVectors(a, b, t).normalize();
  if (c < -0.9999) {
    _perp.set(1, 0, 0).cross(a);
    if (_perp.lengthSq() < 1e-6) _perp.set(0, 1, 0).cross(a);
    _perp.normalize();
    return out.copy(a).applyAxisAngle(_perp, Math.PI * t);
  }
  const th = Math.acos(c);
  const sn = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / sn;
  const kb = Math.sin(t * th) / sn;
  return out.set(a.x * ka + b.x * kb, a.y * ka + b.y * kb, a.z * ka + b.z * kb).normalize();
}
const _perp = new THREE.Vector3();
const _ca = new THREE.Vector3();
const _cb = new THREE.Vector3();

/**
 * Unit-vector slerp that keeps to last frame's side: when a and b are more than ~125 degrees apart
 * the short arc can swap sides from one frame to the next (exactly opposite, it is undefined);
 * then the arc (short or long) that lands closer to `near` is used.
 */
export function slerpUnitNear(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number, near?: THREE.Vector3): THREE.Vector3 {
  const c = a.dot(b);
  if (!near || c > -0.6) return slerpUnit(out, a, b, t);
  const th = Math.acos(THREE.MathUtils.clamp(c, -1, 1));
  // the plane of the arc: through a and b, or (opposite) through a and last frame's result
  _perp.crossVectors(a, b);
  if (_perp.lengthSq() < 1e-8) _perp.crossVectors(a, near);
  if (_perp.lengthSq() < 1e-8) return slerpUnit(out, a, b, t);
  _perp.normalize();
  _ca.copy(a).applyAxisAngle(_perp, th * t);
  _cb.copy(a).applyAxisAngle(_perp, -(2 * Math.PI - th) * t);
  return out.copy(_ca.dot(near) >= _cb.dot(near) ? _ca : _cb);
}

/** unit direction from the root (_a) to p, perpendicular to axis; `fallback` when p is on the axis */
function perpUnit(out: THREE.Vector3, p: THREE.Vector3, axis: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 {
  out.subVectors(p, _a);
  out.addScaledVector(axis, -out.dot(axis));
  if (out.lengthSq() < 1e-8) {
    out.copy(fallback).addScaledVector(axis, -fallback.dot(axis));
    if (out.lengthSq() < 1e-8) out.set(0, 0, -1).addScaledVector(axis, -axis.z);
  }
  return out.normalize();
}

const IK_FADE = 0.2;
const _fkU = new THREE.Quaternion();
const _fkL = new THREE.Quaternion();
const _fkEnd = new THREE.Vector3();
const _fkJoint = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _pl = new THREE.Vector3();
const _yU = new THREE.Vector3();
const _yL = new THREE.Vector3();
const _hint = new THREE.Vector3();
const _endP = new THREE.Vector3();

/** the analytic two-bone solve (shoulder position in _a) */
function solveChain(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  lenA: number,
  lenB: number,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  frontJoint: boolean,
): void {
  _dir.subVectors(target, _a);
  const dist = _dir.length();
  const maxD = (lenA + lenB) * 0.999;
  // reach floor: a target closer than this would fold the limb shut (and the bend plane goes
  // undefined at the root joint): keep the joint at >= ~30 degrees (full elbow flexion)
  const minD = Math.max(Math.abs(lenA - lenB) + 0.01, (lenA + lenB) * 0.25);
  const d = THREE.MathUtils.clamp(dist, minD, maxD);
  if (dist < 1e-6) _dir.set(0, -1, 0);
  else _dir.divideScalar(dist);
  const cosA = THREE.MathUtils.clamp((lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _pole.subVectors(pole, _a);
  _pole.addScaledVector(_dir, -_pole.dot(_dir));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, 0, -1);
  _pole.normalize();
  _e2.copy(_a).addScaledVector(_dir, lenA * cosA).addScaledVector(_pole, lenA * sinA);
  // upper: -Y along (elbow - shoulder); bend hint: elbow points to -Z (bone back side) => z = -pole
  _yU.subVectors(_a, _e2);
  _hint.copy(_pole);
  if (!frontJoint) _hint.negate();
  setWorldBasis(upper, _yU, _hint);
  _endP.copy(target);
  if (dist > maxD || dist < minD) _endP.copy(_a).addScaledVector(_dir, d);
  _yL.subVectors(_e2, _endP);
  setWorldBasis(lower, _yL, _hint);
}

/** per-chain memory of the last solved local rotations (temporal coherence of IK blends) */
export class IKMemo {
  readonly upper = new THREE.Quaternion();
  readonly lower = new THREE.Quaternion();
  ok = false;
  /** blended reach direction and swivel of the last partial-weight solve */
  readonly dir = new THREE.Vector3();
  readonly swv = new THREE.Vector3();
  okDir = false;
  remember(u: THREE.Quaternion, l: THREE.Quaternion): void {
    this.upper.copy(u);
    this.lower.copy(l);
    this.ok = true;
  }
}

const _sa = new THREE.Quaternion();
const _sb = new THREE.Quaternion();
/** slerp without the shortest-way sign fix (goes the long way round when a.b < 0) */
function slerpRaw(out: THREE.Quaternion, a: THREE.Quaternion, b: THREE.Quaternion, t: number): THREE.Quaternion {
  const c = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const th = Math.acos(c);
  const sn = Math.sin(th);
  if (sn < 1e-5) return out.copy(a);
  const ka = Math.sin((1 - t) * th) / sn;
  const kb = Math.sin(t * th) / sn;
  return out.set(a.x * ka + b.x * kb, a.y * ka + b.y * kb, a.z * ka + b.z * kb, a.w * ka + b.w * kb).normalize();
}

/**
 * Slerp a -> b by t, the way round that lands closer to `near` (this blend's result last frame).
 * Near a 180-degree difference the shortest way flips from one frame to the next as the poses move
 * and a blended bone spins round in a frame; keeping to last frame's side removes that. Without
 * `near`, or when a and b are less than ~74 degrees apart, it is the plain shortest slerp.
 */
export function slerpNear(out: THREE.Quaternion, a: THREE.Quaternion, b: THREE.Quaternion, t: number, near?: THREE.Quaternion): THREE.Quaternion {
  const d = a.dot(b);
  if (!near || Math.abs(d) > 0.8) return out.copy(a).slerp(b, t);
  // shortest way and the other way
  _sb.copy(b);
  if (d < 0) _sb.set(-b.x, -b.y, -b.z, -b.w);
  slerpRaw(_sa, a, _sb, t);
  _sb.set(-_sb.x, -_sb.y, -_sb.z, -_sb.w);
  slerpRaw(out, a, _sb, t);
  if (Math.abs(_sa.dot(near)) >= Math.abs(out.dot(near))) out.copy(_sa);
  return out;
}

/** Sets a bone's world rotation (blended by weight). */
export function setWorldQuat(bone: THREE.Object3D, q: THREE.Quaternion, weight = 1, memo?: { q: THREE.Quaternion; ok: boolean }): void {
  bone.parent!.getWorldQuaternion(_qp).invert();
  _qw.copy(_qp).multiply(q);
  if (weight >= 1) bone.quaternion.copy(_qw);
  else if (weight > 0) {
    _ik.copy(bone.quaternion);
    slerpNear(bone.quaternion, _ik, _qw, weight, memo?.ok ? memo.q : undefined);
  }
  bone.updateMatrixWorld(true);
  if (memo) {
    memo.q.copy(bone.quaternion);
    memo.ok = true;
  }
}
