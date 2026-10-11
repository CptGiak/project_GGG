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
 * Damped oscillator around 0 for impulse-driven channels (recoil, flinches, camera kicks).
 *
 * - `hit(peak)`: an impulse sets the velocity, the spring throws the value out and brings it back
 *   with a little undershoot. Peak lands at ~atan(wd / (zeta w)) / wd seconds after the kick
 *   (~1.6 f at 6.5 Hz, zeta 0.55): light shots.
 * - `hit(peak, rise, hang)`: the heavy-shot envelope. The value rises to +peak in `rise` seconds
 *   (outExpo), holds it for `hang` seconds drifting back 10% (a moving hold), then the spring
 *   returns it from rest, so the return eases in, removes most of it in ~1/(2 freq) s and settles
 *   with a small undershoot (zeta 0.6 -> ~9%, 0.7 -> ~5%).
 */
export class Kick {
  x = 0;
  v = 0;
  private w: number;
  private goal = 0;
  private riseLeft = 0;
  private riseK = 0;
  private hangLeft = 0;
  private hangDrift = 0;
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
  hit(peak: number, rise = 0, hang = 0): void {
    if (rise > 0 || hang > 0) {
      // a new envelope stacks on whatever is still ringing
      this.goal = (this.riseLeft > 0 ? this.goal : this.x) + peak;
      this.riseLeft = Math.max(rise, 1 / 240);
      this.riseK = 4 / this.riseLeft;
      this.hangLeft = hang;
      this.hangDrift = hang > 0 ? 0.1 / hang : 0;
      this.v = 0;
      return;
    }
    if (this.riseLeft > 0) {
      this.goal += peak;
      return;
    }
    this.hangLeft = 0;
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
      if (this.riseLeft > 0) {
        this.x += (this.goal - this.x) * (1 - Math.exp(-this.riseK * s));
        this.riseLeft -= s;
        this.v = 0;
      } else if (this.hangLeft > 0) {
        this.v = -this.x * this.hangDrift;
        this.x += this.v * s;
        this.hangLeft -= s;
      } else {
        this.v += (-this.w * this.w * this.x - 2 * this.zeta * this.w * this.v) * s;
        this.x += this.v * s;
      }
      left -= s;
    }
    if (this.riseLeft <= 0 && this.hangLeft <= 0 && Math.abs(this.x) < 1e-5 && Math.abs(this.v) < 1e-4) this.x = this.v = 0;
    return this.x;
  }
  /** true while the value is still moving or displaced */
  get active(): boolean {
    return this.x !== 0 || this.v !== 0 || this.riseLeft > 0;
  }
  reset(): void {
    this.x = this.v = 0;
    this.riseLeft = this.hangLeft = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Sub-step clock: time-correct anchor samples for fixed-rate secondary motion
// ---------------------------------------------------------------------------------------------

/**
 * Fixed sub-steps (90-120 Hz) inside variable frames, sampling a moving anchor at the exact time of
 * each sub-step. Frames that run no sub-step keep accumulating (no motion is lost), the anchor's
 * velocity is measured over the real time it covered, and `carry()` gives the offset that puts the
 * rendered points back on the anchor (the sim lags the frame by the leftover time). Identical
 * results from 30 to 144 fps. Own vectors only (never module temps).
 */
export class SubstepClock {
  acc = 0;
  span = 0;
  private owed0 = 0;
  private init = false;
  readonly prev = new THREE.Vector3();
  readonly now = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly velPrev = new THREE.Vector3();
  readonly lastSub = new THREE.Vector3();

  reset(a: THREE.Vector3): void {
    this.prev.copy(a);
    this.now.copy(a);
    this.lastSub.copy(a);
    this.vel.set(0, 0, 0);
    this.velPrev.set(0, 0, 0);
    this.acc = this.span = 0;
    this.init = true;
  }

  /** sub-steps to run this frame (0: nothing to do, the time carries over) */
  begin(dt: number, a: THREE.Vector3, h: number, maxSteps: number): number {
    if (!this.init) this.reset(a);
    this.span += dt;
    this.acc = Math.min(this.acc + dt, h * maxSteps);
    const n = Math.floor(this.acc / h);
    if (n === 0) return 0;
    this.now.copy(a);
    this.velPrev.copy(this.vel);
    this.vel.subVectors(this.now, this.prev).divideScalar(Math.max(this.span, 1e-5));
    this.owed0 = this.acc - this.span;
    return n;
  }

  /** the anchor at the end of sub-step k (k - 1 = its start) */
  at(k: number, h: number, out: THREE.Vector3): THREE.Vector3 {
    return out.lerpVectors(this.prev, this.now, THREE.MathUtils.clamp((k * h - this.owed0) / Math.max(this.span, 1e-5), -1, 1));
  }

  finish(n: number, h: number): void {
    this.at(n, h, this.lastSub);
    this.acc -= n * h;
    this.prev.copy(this.now);
    this.span = 0;
  }

  /** offset to add to rendered points: the anchor now minus where the sim's last sub-step had it */
  carry(aNow: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.subVectors(aNow, this.lastSub);
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
  /** air drag (1/s) on the world velocity minus wind, clamped to 12 m/s: a mild trail at speed */
  drag?: number;
  /** cone limit around the rest direction (degrees) */
  maxAngle?: number;
  /** extra damping toward the parent's motion (1 = none; prefer tuning zeta) */
  inertia?: number;
  /**
   * Share of the body's velocity changes the accessory feels (0 = carried rigidly ... 1 = a free
   * world pendulum). Fighters fall at 26 m/s^2 against the springs' 9.8: at 1 hanging props float
   * up on every jump; 0.4 keeps them hanging (and still swinging on stops and turns).
   */
  linearInertia?: number;
}

const _pw = new THREE.Vector3();
const _rest = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _rd = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _dv = new THREE.Vector3();
const _sp = new THREE.Vector3();
const _r0 = new THREE.Vector3();

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
  private restQ: THREE.Quaternion;
  /** the swung local rotation shown last frame (re-applied on frames that run no sub-step) */
  private shownQ = new THREE.Quaternion();
  private initialized = false;
  private readonly pivClock = new SubstepClock();
  private readonly restClock = new SubstepClock();
  private o: Required<SpringBoneOptions>;

  constructor(opts: SpringBoneOptions) {
    this.o = { freq: 4, zeta: 0.35, gravity: 0.6, drag: 0.5, maxAngle: 60, inertia: 1, linearInertia: 0.4, ...opts, restDir: opts.restDir.clone().normalize() };
    this.restQ = opts.pivot.quaternion.clone();
    this.shownQ.copy(this.restQ);
  }

  /** a velocity impulse on the accessory (m/s), e.g. a hit or a weapon kick */
  kick(v: THREE.Vector3): void {
    this.vel.add(v);
  }

  reset(): void {
    this.initialized = false;
  }

  update(dt: number, _wind?: THREE.Vector3): void {
    const o = this.o;
    const pivot = o.pivot;
    // rest frame this frame: the authored rotation under the (already posed) parent bone
    pivot.quaternion.copy(this.restQ);
    pivot.updateMatrixWorld(true);
    pivot.getWorldPosition(_pw);
    pivot.getWorldQuaternion(_q);
    _rd.copy(o.restDir).applyQuaternion(_q);
    _rest.copy(_pw).addScaledVector(_rd, o.length);
    // teleports, respawns, blinks (a dash covers at most ~1.6 m in a 20 fps frame)
    if (!this.initialized || _pw.distanceToSquared(this.prevPivot) > 2.5 * 2.5) {
      this.tip.copy(_rest);
      this.vel.set(0, 0, 0);
      this.prevPivot.copy(_pw);
      this.pivClock.reset(_pw);
      this.restClock.reset(_rest);
      this.shownQ.copy(this.restQ);
      this.initialized = true;
      return;
    }
    this.prevPivot.copy(_pw);
    const H = 1 / 120;
    const n = this.pivClock.begin(dt, _pw, H, 6);
    this.restClock.begin(dt, _rest, H, 6);
    if (n === 0) {
      pivot.quaternion.copy(this.shownQ);
      pivot.updateMatrixWorld(true);
      return;
    }
    const w = 2 * Math.PI * o.freq;
    const maxA = THREE.MathUtils.degToRad(o.maxAngle);
    // the rest point's velocity: damping is relative to it, so riding along at a constant speed
    // costs nothing; only accelerations, gravity and the air move the accessory
    const rv = this.restClock.vel;
    // partial linear inertia: the accessory feels only a share of the body's velocity change
    _ax.subVectors(rv, this.restClock.velPrev);
    _dv.copy(_ax).multiplyScalar(o.linearInertia).clampLength(0, 25 * this.restClock.span);
    this.vel.add(_ax.sub(_dv));
    for (let k = 1; k <= n; k++) {
      this.pivClock.at(k, H, _sp);
      this.restClock.at(k - 1, H, _r0);
      const ax = -w * w * (this.tip.x - _r0.x) - 2 * o.zeta * w * (this.vel.x - rv.x);
      const ay = -w * w * (this.tip.y - _r0.y) - 2 * o.zeta * w * (this.vel.y - rv.y) - 9.8 * o.gravity;
      const az = -w * w * (this.tip.z - _r0.z) - 2 * o.zeta * w * (this.vel.z - rv.z);
      this.vel.x += ax * H;
      this.vel.y += ay * H;
      this.vel.z += az * H;
      if (o.drag > 0) {
        // air drag on the world velocity (no arena wind), clamped
        _ax.copy(this.vel).clampLength(0, 12);
        this.vel.addScaledVector(_ax, -o.drag * H);
      }
      if (o.inertia < 1) this.vel.lerp(rv, (1 - o.inertia) * 0.5);
      this.tip.addScaledVector(this.vel, H);
      // rigid link + cone limit around the rest direction
      _dir.subVectors(this.tip, _sp);
      const len = _dir.length() || 1e-6;
      _dir.divideScalar(len);
      const ang = Math.acos(THREE.MathUtils.clamp(_dir.dot(_rd), -1, 1));
      if (ang > maxA) {
        _ax.crossVectors(_rd, _dir);
        if (_ax.lengthSq() < 1e-10) _ax.set(1, 0, 0);
        _ax.normalize();
        _dir.copy(_rd).applyAxisAngle(_ax, maxA);
        // bleed the motion relative to the body on the cone wall (not the body's own speed)
        this.vel.sub(rv).multiplyScalar(0.6).add(rv);
      }
      this.tip.copy(_sp).addScaledVector(_dir, o.length);
      // the link is rigid: drop the radial part of the relative velocity
      _ax.subVectors(this.vel, rv);
      this.vel.addScaledVector(_dir, -_ax.dot(_dir));
    }
    this.pivClock.finish(n, H);
    this.restClock.finish(n, H);
    // swing: rotate the pivot so its rest direction points at the simulated tip
    _dir.subVectors(this.tip, _sp).normalize();
    _q.setFromUnitVectors(_rd, _dir);
    pivot.parent!.getWorldQuaternion(_qp);
    _qi.copy(_qp).invert();
    // local = parent^-1 * swing * parent * rest
    pivot.quaternion.copy(_qi).multiply(_q).multiply(_qp).multiply(this.restQ);
    this.shownQ.copy(pivot.quaternion);
    pivot.updateMatrixWorld(true);
  }
}
