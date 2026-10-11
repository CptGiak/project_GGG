import * as THREE from 'three';
import { BONE_COUNT, BONES } from './Rig';
import type { Pose, WeaponKey } from './Animator';

/**
 * Inertialization (Gears of War 4 / D. Holden): a transition shows the new pose at once (zero
 * latency, no crossfade lag) and hides the jump with an offset that starts at "what was on screen
 * minus what is wanted now" and decays to zero like a critically damped spring.
 *
 * It runs on the final POSE, before IK: bone rotations, pelvis offset, the weapon / hand / foot IK
 * targets and their weights all carry an offset, so hands stay on the weapon and planted feet stay
 * planted while the body blends.
 */
const LN2 = Math.LN2;
const negexp = (x: number) => 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _r = new THREE.Vector3();

function quatToRotVec(q: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  const s = q.w < 0 ? -1 : 1;
  const len = Math.hypot(q.x, q.y, q.z);
  const k = len < 1e-7 ? 2 * s : (2 * Math.atan2(len, q.w * s) * s) / len;
  return out.set(q.x * k, q.y * k, q.z * k);
}

function rotVecToQuat(x: number, y: number, z: number, out: THREE.Quaternion): THREE.Quaternion {
  const a = Math.hypot(x, y, z);
  const k = a < 1e-7 ? 0.5 : Math.sin(a * 0.5) / a;
  return out.set(x * k, y * k, z * k, Math.cos(a * 0.5));
}

/** channel layout: 19 bone rotations (3 each), hips (3), 4 IK keys × (pos 3 + rot 3 + weight 1 + joint hint 3), off (1) */
const KEYS = ['wR', 'wL', 'fL', 'fR'] as const;
const KC = 10;
const N = BONE_COUNT * 3 + 3 + KEYS.length * KC + 1;
/** scalar memory per key: pos 3, weight 1, joint hint 3 */
const KS = 7;

export class Inertializer {
  private x = new Float32Array(N);
  private v = new Float32Array(N);
  /** last two outputs, flattened the same way (rotations as quaternions kept separately) */
  private prevQ = new Float32Array((BONE_COUNT + KEYS.length) * 4);
  private prev2Q = new Float32Array((BONE_COUNT + KEYS.length) * 4);
  private prevS = new Float32Array(3 + KEYS.length * KS + 1);
  private prev2S = new Float32Array(3 + KEYS.length * KS + 1);
  private history = 0;
  private active = false;
  private halfLife = 0.08;
  private pending = 0;
  private lastDt = 1 / 60;

  /** start a transition this frame (before apply) */
  trigger(halfLife: number): void {
    this.pending = Math.max(this.pending, halfLife);
  }

  reset(): void {
    this.history = 0;
    this.active = false;
    this.pending = 0;
  }

  apply(pose: Pose, dt: number): void {
    if (this.pending > 0 && this.history >= 2) this.capture(pose);
    this.pending = 0;
    if (this.active) this.decayAndAdd(pose, dt);
    this.remember(pose);
    this.lastDt = dt;
  }

  private key(pose: Pose, i: number): WeaponKey {
    return pose[KEYS[i]];
  }

  /** offset = previous output - new target, velocity = the previous output's velocity */
  private capture(pose: Pose): void {
    this.halfLife = this.pending;
    const h = Math.max(this.lastDt, 1e-4);
    const x = this.x;
    const v = this.v;
    const rot = (qi: number, ox: number, nq: THREE.Quaternion) => {
      const k = qi * 4;
      _q.set(this.prevQ[k], this.prevQ[k + 1], this.prevQ[k + 2], this.prevQ[k + 3]);
      _qi.copy(nq).invert();
      quatToRotVec(_q.multiply(_qi), _r);
      x[ox] = _r.x;
      x[ox + 1] = _r.y;
      x[ox + 2] = _r.z;
      _q.set(this.prevQ[k], this.prevQ[k + 1], this.prevQ[k + 2], this.prevQ[k + 3]);
      _qi.set(this.prev2Q[k], this.prev2Q[k + 1], this.prev2Q[k + 2], this.prev2Q[k + 3]).invert();
      quatToRotVec(_q.multiply(_qi), _r).divideScalar(h);
      v[ox] = _r.x;
      v[ox + 1] = _r.y;
      v[ox + 2] = _r.z;
    };
    const sc = (si: number, ox: number, now: number) => {
      x[ox] = this.prevS[si] - now;
      v[ox] = (this.prevS[si] - this.prev2S[si]) / h;
    };
    for (let i = 0; i < BONE_COUNT; i++) {
      pose.getQuat(boneName(i), _qb);
      rot(i, i * 3, _qb);
    }
    let o = BONE_COUNT * 3;
    sc(0, o, pose.hips.x);
    sc(1, o + 1, pose.hips.y);
    sc(2, o + 2, pose.hips.z);
    o += 3;
    for (let k = 0; k < KEYS.length; k++) {
      const key = this.key(pose, k);
      const s0 = 3 + k * KS;
      const prevW = this.prevS[s0 + 3];
      if (prevW > 1e-3 && key.w > 1e-3) {
        sc(s0, o, key.p.x);
        sc(s0 + 1, o + 1, key.p.y);
        sc(s0 + 2, o + 2, key.p.z);
        rot(BONE_COUNT + k, o + 3, key.q);
      } else for (let c = 0; c < 6; c++) x[o + c] = v[o + c] = 0;
      sc(s0 + 3, o + 6, key.w);
      sc(s0 + 4, o + 7, key.e.x);
      sc(s0 + 5, o + 8, key.e.y);
      sc(s0 + 6, o + 9, key.e.z);
      o += KC;
    }
    sc(3 + KEYS.length * KS, o, pose.off);
    this.active = true;
  }

  private decayAndAdd(pose: Pose, dt: number): void {
    const y = (2 * LN2) / Math.max(this.halfLife, 1e-4);
    const e = negexp(y * dt);
    const x = this.x;
    const v = this.v;
    let energy = 0;
    for (let i = 0; i < N; i++) {
      const j1 = v[i] + x[i] * y;
      x[i] = e * (x[i] + j1 * dt);
      v[i] = e * (v[i] - j1 * y * dt);
      energy += Math.abs(x[i]);
    }
    for (let i = 0; i < BONE_COUNT; i++) {
      const name = boneName(i);
      pose.getQuat(name, _qb);
      rotVecToQuat(x[i * 3], x[i * 3 + 1], x[i * 3 + 2], _q);
      pose.setQuat(name, _q.multiply(_qb));
    }
    let o = BONE_COUNT * 3;
    pose.hips.x += x[o];
    pose.hips.y += x[o + 1];
    pose.hips.z += x[o + 2];
    o += 3;
    for (let k = 0; k < KEYS.length; k++) {
      const key = this.key(pose, k);
      key.p.x += x[o];
      key.p.y += x[o + 1];
      key.p.z += x[o + 2];
      rotVecToQuat(x[o + 3], x[o + 4], x[o + 5], _q);
      key.q.premultiply(_q);
      key.w = THREE.MathUtils.clamp(key.w + x[o + 6], 0, 1);
      key.e.x += x[o + 7];
      key.e.y += x[o + 8];
      key.e.z += x[o + 9];
      o += KC;
    }
    pose.off = THREE.MathUtils.clamp(pose.off + x[o], 0, 1);
    if (energy < 1e-4) this.active = false;
  }

  /**
   * After IK: remember what the limb bones actually showed. A clip that drives an arm by FK after
   * one that held it by IK then starts from where the arm was on screen, not from the hidden FK
   * angles under the IK (often the rest pose: the arm would drop and swing back up).
   */
  rememberVisible(bones: readonly THREE.Object3D[], indices: readonly number[]): void {
    for (const i of indices) {
      const q = bones[i].quaternion;
      const k = i * 4;
      this.prevQ[k] = q.x;
      this.prevQ[k + 1] = q.y;
      this.prevQ[k + 2] = q.z;
      this.prevQ[k + 3] = q.w;
    }
  }

  private remember(pose: Pose): void {
    this.prev2Q.set(this.prevQ);
    this.prev2S.set(this.prevS);
    // (no allocations: this runs every frame)
    this.prevQ.set(pose.q);
    this.prevS[0] = pose.hips.x;
    this.prevS[1] = pose.hips.y;
    this.prevS[2] = pose.hips.z;
    for (let k = 0; k < KEYS.length; k++) {
      const key = this.key(pose, k);
      const qi = (BONE_COUNT + k) * 4;
      this.prevQ[qi] = key.q.x;
      this.prevQ[qi + 1] = key.q.y;
      this.prevQ[qi + 2] = key.q.z;
      this.prevQ[qi + 3] = key.q.w;
      const si = 3 + k * KS;
      this.prevS[si] = key.p.x;
      this.prevS[si + 1] = key.p.y;
      this.prevS[si + 2] = key.p.z;
      this.prevS[si + 3] = key.w;
      this.prevS[si + 4] = key.e.x;
      this.prevS[si + 5] = key.e.y;
      this.prevS[si + 6] = key.e.z;
    }
    this.prevS[3 + KEYS.length * KS] = pose.off;
    this.history = Math.min(this.history + 1, 2);
  }
}

const _qb = new THREE.Quaternion();
const boneName = (i: number) => BONES[i];
