import * as THREE from 'three';
import type { ClothLike } from '../champions/types';

/**
 * Procedural follow-through: second-order dynamics and spring-driven accessories.
 *
 * SecondOrder (t3ssel8r, "Giving Personality to Procedural Animations using Math") makes a value
 * chase a target like a damped spring, described by feel instead of stiffness numbers:
 *   f    natural frequency in Hz (how fast it responds; 1-2 lazy, 4-6 lively, 8+ snappy)
 *   zeta damping (0 rings forever, 0.3-0.6 overshoots and settles, 1 critical, >1 sluggish)
 *   r    initial response (0 eases in, 1 follows at once, >1 overshoots, <0 anticipates)
 * The update is pole-matched, so it stays stable for any dt and any frequency.
 */
export class SecondOrder {
  readonly y: Float32Array;
  readonly yd: Float32Array;
  private xp: Float32Array;
  private k1 = 0;
  private k2 = 0;
  private k3 = 0;
  private w = 0;
  private z = 0;
  private d = 0;

  constructor(
    readonly dim: number,
    f: number,
    zeta: number,
    r = 0,
    x0?: ArrayLike<number>,
  ) {
    this.y = new Float32Array(dim);
    this.yd = new Float32Array(dim);
    this.xp = new Float32Array(dim);
    this.tune(f, zeta, r);
    if (x0) this.reset(x0);
  }

  tune(f: number, zeta: number, r = 0): void {
    this.w = 2 * Math.PI * f;
    this.z = zeta;
    this.d = this.w * Math.sqrt(Math.abs(zeta * zeta - 1));
    this.k1 = zeta / (Math.PI * f);
    this.k2 = 1 / (this.w * this.w);
    this.k3 = (r * zeta) / this.w;
  }

  reset(x: ArrayLike<number>): void {
    for (let i = 0; i < this.dim; i++) {
      this.y[i] = this.xp[i] = x[i];
      this.yd[i] = 0;
    }
  }

  /** advance toward target x; xd = target velocity if known (else estimated) */
  update(dt: number, x: ArrayLike<number>, xd?: ArrayLike<number>): Float32Array {
    if (dt <= 0) return this.y;
    let k1s: number;
    let k2s: number;
    if (this.w * dt < this.z) {
      k1s = this.k1;
      k2s = Math.max(this.k2, (dt * dt) / 2 + (dt * this.k1) / 2, dt * this.k1);
    } else {
      const t1 = Math.exp(-this.z * this.w * dt);
      const alpha = 2 * t1 * (this.z <= 1 ? Math.cos(dt * this.d) : Math.cosh(dt * this.d));
      const beta = t1 * t1;
      const t2 = dt / (1 + beta - alpha);
      k1s = (1 - beta) * t2;
      k2s = dt * t2;
    }
    for (let i = 0; i < this.dim; i++) {
      const v = xd ? xd[i] : (x[i] - this.xp[i]) / dt;
      this.xp[i] = x[i];
      this.y[i] += dt * this.yd[i];
      this.yd[i] += (dt * (x[i] + this.k3 * v - this.y[i] - k1s * this.yd[i])) / k2s;
    }
    return this.y;
  }

  /** kick the output (impulse in units/s) without moving the target */
  impulse(i: number, v: number): void {
    this.yd[i] += v;
  }
}

/**
 * Damped oscillator around 0 for impulse-driven channels (recoil, flinches, camera kicks): an
 * impulse sets the velocity, the spring throws the value out and brings it back with a little
 * overshoot. Peak lands at ~atan(wd / (zeta w)) / wd seconds after the kick.
 */
export class Kick {
  x = 0;
  v = 0;
  private w: number;
  constructor(
    public freq: number,
    public zeta: number,
  ) {
    this.w = 2 * Math.PI * freq;
  }
  tune(freq: number, zeta: number): void {
    this.freq = freq;
    this.zeta = zeta;
    this.w = 2 * Math.PI * freq;
  }
  /** add velocity so the peak displacement is roughly `peak` */
  hit(peak: number): void {
    // for a velocity impulse the first peak is v0/w * exp(-zeta*phi/sqrt(1-z^2)) with phi = atan(sqrt(1-z^2)/z)
    const z = Math.min(this.zeta, 0.95);
    const s = Math.sqrt(1 - z * z);
    const phi = Math.atan2(s, z);
    this.v += (peak * this.w) / Math.exp((-z * phi) / s);
  }
  update(dt: number): number {
    // semi-implicit Euler at a fixed sub-step: stable for the frequencies used here (< 30 Hz)
    const h = 1 / 240;
    let left = Math.min(dt, 0.1);
    while (left > 1e-6) {
      const s = Math.min(h, left);
      this.v += (-this.w * this.w * this.x - 2 * this.zeta * this.w * this.v) * s;
      this.x += this.v * s;
      left -= s;
    }
    if (Math.abs(this.x) < 1e-5 && Math.abs(this.v) < 1e-4) this.x = this.v = 0;
    return this.x;
  }
  reset(): void {
    this.x = this.v = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Spring bones: rigid accessories that swing from a bone (pendants, headphones, hair spikes,
// charms, antennae, earrings, weapon straps)
// ---------------------------------------------------------------------------------------------

export interface SpringBoneOptions {
  /** pivot object (child of a bone); the accessory meshes hang under it */
  pivot: THREE.Object3D;
  /** direction from the pivot to the accessory's centre of mass, in the pivot's rest frame */
  restDir: THREE.Vector3;
  /** pivot -> centre of mass distance (m) */
  length: number;
  /** spring frequency toward the rest direction (Hz): 1.5 floppy chain ... 8 stiff hair spike */
  freq?: number;
  /** damping ratio relative to the parent (0.15 jangly ... 0.7 settles at once) */
  zeta?: number;
  /** gravity multiplier (1 hangs, 0 holds the authored shape) */
  gravity?: number;
  /** absolute air drag 0..1 (trails behind when the body moves fast) */
  drag?: number;
  /** cone limit around the rest direction (degrees) */
  maxAngle?: number;
  /** how much of the body's own (inertial) acceleration the accessory feels, 0..1 */
  inertia?: number;
}

const _pw = new THREE.Vector3();
const _rest = new THREE.Vector3();
const _rv = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _rd = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qi = new THREE.Quaternion();

/**
 * A one-link pendulum in world space: the accessory's centre of mass lags behind the pivot's
 * motion, is pulled back to its authored direction by a spring, sags with gravity, and the pivot
 * rotates so the accessory points at it. Works with any bone (it reads the bone's world matrix
 * after the pose and IK), resets itself on teleports.
 */
export class SpringBone implements ClothLike {
  readonly objects: THREE.Object3D[] = [];
  private tip = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private prevPivot = new THREE.Vector3();
  private prevRestTip = new THREE.Vector3();
  private restQ: THREE.Quaternion;
  private initialized = false;
  private acc = 0;
  private o: Required<SpringBoneOptions>;

  constructor(opts: SpringBoneOptions) {
    this.o = { freq: 4, zeta: 0.35, gravity: 0.6, drag: 0.02, maxAngle: 60, inertia: 1, ...opts, restDir: opts.restDir.clone().normalize() };
    this.restQ = opts.pivot.quaternion.clone();
  }

  reset(): void {
    this.initialized = false;
  }

  update(dt: number, wind?: THREE.Vector3): void {
    const o = this.o;
    const pivot = o.pivot;
    // rest frame this frame: the authored rotation under the (already posed) parent bone
    pivot.quaternion.copy(this.restQ);
    pivot.updateMatrixWorld(true);
    pivot.getWorldPosition(_pw);
    pivot.getWorldQuaternion(_q);
    _rd.copy(o.restDir).applyQuaternion(_q);
    _rest.copy(_pw).addScaledVector(_rd, o.length);
    if (!this.initialized || _pw.distanceToSquared(this.prevPivot) > 4) {
      this.tip.copy(_rest);
      this.vel.set(0, 0, 0);
      this.prevPivot.copy(_pw);
      this.prevRestTip.copy(_rest);
      this.initialized = true;
      return;
    }
    const step = 1 / 120;
    this.acc = Math.min(this.acc + dt, step * 6);
    const w = 2 * Math.PI * o.freq;
    const maxA = THREE.MathUtils.degToRad(o.maxAngle);
    // the rest point's velocity this frame: damping is relative to it, so riding along at a
    // constant speed does not drag the accessory, only accelerations (and gravity / air) do
    _rv.subVectors(_rest, this.prevRestTip).divideScalar(Math.max(dt, 1e-4));
    while (this.acc >= step) {
      this.acc -= step;
      const ax = -w * w * (this.tip.x - _rest.x) - 2 * o.zeta * w * (this.vel.x - _rv.x);
      const ay = -w * w * (this.tip.y - _rest.y) - 2 * o.zeta * w * (this.vel.y - _rv.y) - 9.8 * o.gravity;
      const az = -w * w * (this.tip.z - _rest.z) - 2 * o.zeta * w * (this.vel.z - _rv.z);
      this.vel.x += ax * step;
      this.vel.y += ay * step;
      this.vel.z += az * step;
      if (wind) this.vel.addScaledVector(wind, step * 0.15);
      if (o.drag > 0) this.vel.multiplyScalar(1 - o.drag);
      // partial inertia: a stiff part rides with the body more than a free pendulum would
      if (o.inertia < 1) this.vel.lerp(_rv, (1 - o.inertia) * 0.5);
      this.tip.addScaledVector(this.vel, step);
      // rigid link + cone limit around the rest direction
      _dir.subVectors(this.tip, _pw);
      const len = _dir.length() || 1e-6;
      _dir.divideScalar(len);
      const ang = Math.acos(THREE.MathUtils.clamp(_dir.dot(_rd), -1, 1));
      if (ang > maxA) {
        _ax.crossVectors(_rd, _dir);
        if (_ax.lengthSq() < 1e-10) _ax.set(1, 0, 0);
        _ax.normalize();
        _dir.copy(_rd).applyAxisAngle(_ax, maxA);
        // bleed energy on the cone wall so it does not stick there
        this.vel.multiplyScalar(0.6);
      }
      this.tip.copy(_pw).addScaledVector(_dir, o.length);
    }
    this.prevPivot.copy(_pw);
    this.prevRestTip.copy(_rest);
    // swing: rotate the pivot so its rest direction points at the simulated tip
    _dir.subVectors(this.tip, _pw).normalize();
    _q.setFromUnitVectors(_rd, _dir);
    pivot.parent!.getWorldQuaternion(_qp);
    _qi.copy(_qp).invert();
    // local = parent^-1 * swing * parent * rest
    pivot.quaternion.copy(_qi).multiply(_q).multiply(_qp).multiply(this.restQ);
    pivot.updateMatrixWorld(true);
  }
}
