import * as THREE from 'three';
import { applyPose, IKMemo, Pose, setWorldQuat, slerpNear, slerpUnitNear, solveTwoBone, type WeaponKey } from './Animator';
import { ActionLayer, Locomotion, newLocoState, type PlayOpts } from './locomotion';
import { updateBodySpheres } from './Cloth';
import { Kick } from './Springs';
import { Inertializer } from './Inertialize';
import { Beat } from '../core/Beat';
import { BONE_INDEX } from './Rig';
import type { ChampionVisual } from '../champions/types';

/**
 * One weapon kick, in degrees / metres at the peak. The springs throw the weapon and let it
 * settle with a small overshoot; the torso absorbs part of it so the arms never just jerk.
 */
export interface KickSpec {
  /** muzzle climb (deg) */
  pitch?: number;
  /** push back along the barrel (m) */
  back?: number;
  /** roll (deg, sign = direction) */
  roll?: number;
  /** sideways yaw (deg, sign = direction) */
  yaw?: number;
  /** how much the torso / hips take (0 arms only ... 1 heavy weapon, whole body rocks) */
  body?: number;
  /**
   * Return spring of the muzzle climb (Hz); the other channels scale with it. Light shots 6.5-8
   * snap back (default 6.5), heavy shots 3-4 return slowly, the biggest release 2.8-3.
   */
  freq?: number;
  /** damping ratio of the return: 0.6-0.7 = 3-8% undershoot (default 0.6) */
  zeta?: number;
  /** rise time (s): 0 = impulse, peak in ~2 f (light); heavy 0.03-0.035 (2 f, outExpo) */
  rise?: number;
  /** moving hold at the peak (s), heavy shots only: 0.035-0.1 (2-6 f), drifts back 10% */
  hang?: number;
}

/** default recoil springs (Hz, zeta) for pitch / back / roll / yaw: light-shot snap */
const KICK_TUNE = { p: [6.5, 0.6], b: [8.5, 0.62], r: [5.5, 0.42], y: [6, 0.5] } as const;

const _p = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
const _hq = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _off = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _lp = new THREE.Vector3();
const _lq = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _pa = new THREE.Vector3();
const _pe = new THREE.Vector3();
const _pk = new THREE.Vector3();
const _gd = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _rqi = new THREE.Quaternion();
const _da = new THREE.Vector3();
const _db = new THREE.Vector3();
const _dm = new THREE.Vector3();
const _e = new THREE.Euler();
const _aq = new THREE.Quaternion();
const _kq = new THREE.Quaternion();
const _kp = new THREE.Vector3();
const _cp1 = new THREE.Vector3();
const _cp2 = new THREE.Vector3();
const _cq0 = new THREE.Quaternion();
const _cq1 = new THREE.Quaternion();
const _cq2 = new THREE.Quaternion();
const _cq3 = new THREE.Quaternion();
const _cr1 = new THREE.Quaternion();
const _cr2 = new THREE.Quaternion();
/** bones that IK sets after the pose (their on-screen rotation is what inertialization remembers) */
const IK_BONES = (['upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'] as const).map((n) => BONE_INDEX[n]);
/** stand-in "weapon" for an empty hand: the key then targets the wrist + hand frame directly */
const BARE_HAND = new THREE.Object3D();
/** elbow pole directions (x = the arm's side, +1 left): armed hands keep the elbows low, bare hands flare out */
const POLE_ARMED: [number, number, number] = [0.5, -0.5, -0.3];
const POLE_BARE: [number, number, number] = [0.6, -0.3, -0.1];
/** support hand on a two-handed weapon's grip: elbow down and tucked */
const POLE_GRIP: [number, number, number] = [0.45, -0.55, -0.25];


/**
 * Drives one champion visual: locomotion blend -> action clip -> flinch overlay -> head look ->
 * FK -> weapon-driven IK for both hands -> off-hand grip -> skinned model sync -> cloth simulation.
 */
export class FighterAnimator {
  readonly loco: Locomotion;
  readonly action = new ActionLayer();
  readonly flinch = new ActionLayer();
  readonly st = newLocoState();
  readonly pose = new Pose();
  /** wind applied to cloth (world space, m/s^2) */
  readonly wind = new THREE.Vector3();
  /** recoil springs (deg, m) */
  private readonly kp = new Kick(KICK_TUNE.p[0], KICK_TUNE.p[1]);
  private readonly kb = new Kick(KICK_TUNE.b[0], KICK_TUNE.b[1]);
  private readonly kr = new Kick(KICK_TUNE.r[0], KICK_TUNE.r[1]);
  private readonly ky = new Kick(KICK_TUNE.y[0], KICK_TUNE.y[1]);
  private kickBody = 0.5;
  /** music groove weight (0..1, eased), driven by st.groove */
  private grooveW = 0;
  private readonly inert = new Inertializer();
  /** last frame's IK results per chain: partial IK weights blend the continuous way round */
  private readonly ik = {
    handR: new IKMemo(), handL: new IKMemo(), footL: new IKMemo(), footR: new IKMemo(),
    qHandR: { q: new THREE.Quaternion(), ok: false },
    qHandL: { q: new THREE.Quaternion(), ok: false },
    qMix: { q: new THREE.Quaternion(), ok: false },
    dMix: { q: new THREE.Vector3(), ok: false },
    qFootL: { q: new THREE.Quaternion(), ok: false },
    qFootR: { q: new THREE.Quaternion(), ok: false },
  };
  /**
   * Weapon tremble (degrees, Hz): charge strain, overcharge. Two incommensurate sines on the
   * weapon target, 40% of it on the chest. Set every frame by the kit (0 = off).
   */
  tremble = 0;
  trembleHz = 16;
  /** procedural hit reaction: push direction in model space (x = left, z = forward) */
  private reactX = 0;
  private reactZ = 0;
  private reactT = 9;
  private reactAmp = 0;
  /** limb flail while launched / tumbling (0..1, decays) */
  tumble = 0;
  /** ankle height when the foot is flat on the ground (model space) */
  private readonly ankleY: number;
  /** recoil hinge in the weapon's frame (where the stock meets the shoulder) */
  private readonly hinge: THREE.Vector3;
  /** shoulder pivot used to rotate the aimed weapon (model space) */
  private readonly aimPivot: THREE.Vector3;

  constructor(readonly v: ChampionVisual) {
    this.loco = new Locomotion(v.anims);
    this.ankleY = v.rig.spec.footHeight * (v.animScale ?? 1);
    // recoil hinge: the butt-plate marker if the weapon has one, else the stock line
    const stock = v.weaponR?.getObjectByName('stock');
    this.hinge = stock ? stock.position.clone() : new THREE.Vector3(0, 0, v.stockZ ?? -0.3);
    const r = v.rig.restPos;
    // hips + spine + chest + shoulder drop
    this.aimPivot = new THREE.Vector3(-0.08, r[0].y + r[1].y + r[2].y + v.rig.spec.shoulderDrop, 0);
  }

  play(name: string, opts: PlayOpts = {}): boolean {
    const c = this.v.anims.clips[name];
    if (!c) return false;
    if (c.opts.beats && opts.offset === undefined) {
      // on the beat: tempo-scaled, phased so clip t = 1 is the next downbeat
      opts = { ...opts, speed: (opts.speed ?? 1) * (Beat.bpm / 60), offset: Beat.beats % 1 };
    }
    const hl = this.v.anims.inertial ? (c.opts.inertia ?? this.v.anims.inertial) : 0;
    if (hl && !opts.hold) {
      // the new pose shows at once; the inertializer hides the jump
      this.action.play(c, { ...opts, fadeIn: Math.min(opts.fadeIn ?? 0, 0.02) });
      this.inert.trigger(hl);
    } else if (hl && opts.hold) {
      this.action.play(c, { ...opts, fadeIn: Math.min(opts.fadeIn ?? 0.03, 0.03) });
      this.inert.trigger(hl);
    } else this.action.play(c, opts);
    return true;
  }

  /** inertialized transition into whatever the layers produce next frame (stops, state cuts) */
  cut(halfLife = this.v.anims.inertial ?? 0.08): void {
    this.inert.trigger(halfLife);
  }

  /**
   * Directional flinch: the body snaps away from the hit (push = direction the blow drives the
   * target, in model space) and settles back with a little overshoot. strength ~0.3..1.3.
   */
  hitReact(pushX: number, pushZ: number, strength: number): void {
    const l = Math.hypot(pushX, pushZ) || 1;
    // a blow landing on a fresh flinch keeps part of the previous one
    const carry = this.reactT < 0.15 ? this.reactAmp * 0.5 : 0;
    this.reactX = pushX / l;
    this.reactZ = pushZ / l;
    this.reactT = 0;
    this.reactAmp = Math.min(1.5, Math.max(carry, strength));
  }

  playFlinch(name = 'hit'): void {
    const c = this.v.anims.clips[name];
    if (c) this.flinch.play(c, { fadeIn: 0.02, fadeOut: 0.12 });
  }

  update(dt: number, airborne: boolean, simulateCloth = true): void {
    const st = this.st;
    st.time += dt;
    const pose = this.pose;
    this.loco.evaluate(st, pose);
    this.action.update(dt);
    // recoil authored on clip events
    for (const k of this.action.kicks) this.kick(k);
    this.action.kicks.length = 0;
    this.action.apply(pose, airborne);
    this.flinch.update(dt);
    this.flinch.apply(pose, airborne);
    this.applyReact(dt, pose);
    // clips authored for another body size: weapon targets and hip offsets scale with the body
    const k = this.v.animScale ?? 1;
    if (k !== 1) {
      pose.wR.p.multiplyScalar(k);
      pose.wL.p.multiplyScalar(k);
      pose.fL.p.multiplyScalar(k);
      pose.fR.p.multiplyScalar(k);
      pose.hips.multiplyScalar(k);
    }

    // inertialized clip transitions: offsets on the layered clip pose and its IK targets. The
    // procedural layers below (look, aim, recoil, groove, tremble) are continuous on their own and
    // go on top, so a recoil still hinges exactly on the stock while a transition decays.
    if (this.v.anims.inertial) this.inert.apply(pose, dt);

    // head / chest look-at
    const lp = THREE.MathUtils.clamp(st.lookPitch, -55, 55);
    const ly = THREE.MathUtils.clamp(st.lookYaw, -75, 75);
    pose.preEuler('neck', lp * 0.3, ly * 0.35, 0);
    pose.preEuler('head', lp * 0.4, ly * 0.45, 0);
    if (st.aim > 0.001) {
      pose.preEuler('spine', lp * 0.18 * st.aim, ly * 0.2 * st.aim, 0);
      pose.preEuler('chest', lp * 0.3 * st.aim, ly * 0.25 * st.aim, 0);
    }

    // aimed weapons follow the camera pitch/yaw around the shoulder pivot
    if (st.aim > 0.001 && pose.wR.w > 0.001) {
      _e.set(lp * THREE.MathUtils.DEG2RAD * st.aim, ly * THREE.MathUtils.DEG2RAD * st.aim, 0, 'YXZ');
      _aq.setFromEuler(_e);
      pose.wR.p.sub(this.aimPivot).applyQuaternion(_aq).add(this.aimPivot);
      pose.wR.q.premultiply(_aq);
    }
    this.applyKick(dt, pose);
    this.applyGroove(dt, pose);
    if (this.tremble > 0.001 && pose.wR.w > 0.001) {
      const t = st.time * this.trembleHz * Math.PI * 2;
      const a = this.tremble;
      const px = a * (0.6 * Math.sin(t) + 0.4 * Math.sin(t * 1.37 + 1.3));
      const py = a * (0.6 * Math.sin(t * 1.13 + 2.1) + 0.4 * Math.sin(t * 0.71 + 0.4));
      _e.set(px * THREE.MathUtils.DEG2RAD, py * THREE.MathUtils.DEG2RAD, 0, 'YXZ');
      _kq.setFromEuler(_e);
      pose.wR.q.multiply(_kq);
      pose.preEuler('chest', px * 0.4, py * 0.4, 0);
    }


    applyPose(pose, this.v.rig);
    this.v.root.updateMatrixWorld(true);
    this.solveFeet();
    this.solveWeapons();
    if (this.v.anims.inertial) this.inert.rememberVisible(this.v.rig.bones, IK_BONES);
    this.v.syncPose?.(pose);

    if (simulateCloth) {
      updateBodySpheres(this.v.bodySpheres);
      for (const c of this.v.cloth) c.update(dt, this.wind);
    }
  }

  /**
   * Fire a weapon kick (adds to any kick still ringing). Light rifle shot
   * ~{ pitch: 3, back: 0.035, body: 0.35 }; heavy slug
   * ~{ pitch: 16, back: 0.05, body: 1, freq: 3.6, zeta: 0.62, rise: 0.03, hang: 0.065 }.
   */
  kick(k: KickSpec): void {
    // the return speed is per shot: a heavy kick re-tunes all four springs, a light one restores them
    const s = (k.freq ?? KICK_TUNE.p[0]) / KICK_TUNE.p[0];
    const z = k.zeta;
    this.kp.tune(KICK_TUNE.p[0] * s, z ?? KICK_TUNE.p[1]);
    this.kb.tune(KICK_TUNE.b[0] * s, z ?? KICK_TUNE.b[1]);
    this.kr.tune(KICK_TUNE.r[0] * s, z !== undefined ? z * 0.75 : KICK_TUNE.r[1]);
    this.ky.tune(KICK_TUNE.y[0] * s, z ?? KICK_TUNE.y[1]);
    const rise = k.rise ?? 0;
    const hang = k.hang ?? 0;
    if (k.pitch) this.kp.hit(k.pitch, rise, hang);
    if (k.back) this.kb.hit(k.back, rise, hang);
    if (k.roll) this.kr.hit(k.roll, rise, hang * 0.5);
    if (k.yaw) this.ky.hit(k.yaw, rise, hang * 0.5);
    this.kickBody = k.body ?? 0.5;
  }

  /** weapon recoil: rotate about the stock (shoulder contact), push back, torso absorbs */
  private applyKick(dt: number, pose: Pose): void {
    const p = this.kp.update(dt);
    const b = this.kb.update(dt);
    const r = this.kr.update(dt);
    const y = this.ky.update(dt);
    if (pose.wR.w < 0.001 || (p === 0 && b === 0 && r === 0 && y === 0)) return;
    const D = THREE.MathUtils.DEG2RAD;
    // the stock on the shoulder is the hinge: grip = stock + R * (grip - stock)
    _off.copy(this.hinge).applyQuaternion(pose.wR.q);
    _kp.copy(pose.wR.p).add(_off);
    _e.set(-p * D, y * D, r * D, 'YXZ');
    _kq.setFromEuler(_e);
    pose.wR.q.multiply(_kq);
    _off.copy(this.hinge).negate().applyQuaternion(pose.wR.q);
    pose.wR.p.copy(_kp).add(_off);
    // the stock compresses the shoulder a little: only 30% of the shove slides along the barrel,
    // the rest is carried by the body below (the stock never leaves the pocket)
    _off.set(0, 0, -b * 0.3).applyQuaternion(pose.wR.q);
    pose.wR.p.add(_off);
    const a = this.kickBody;
    // heavy kicks push the hips back and down (planted feet: the knees take it); the weapon rides along
    if (a > 0.6) {
      const h = (a - 0.6) / 0.4;
      const hz = b * 0.55 * h;
      const hy = Math.abs(b) * 0.25 * h;
      pose.hips.z -= hz;
      pose.hips.y -= hy;
      pose.wR.p.z -= hz;
      pose.wR.p.y -= hy;
      pose.addEuler('thighL', -b * 60 * h, 0, 0).addEuler('thighR', -b * 60 * h, 0, 0);
      pose.addEuler('shinL', b * 90 * h, 0, 0).addEuler('shinR', b * 90 * h, 0, 0);
    }
    // the torso takes the rest: spine and chest rock back and twist the right shoulder back
    // (muzzle drifts up and right, as a right-handed shooter's does); the head holds the eye line
    const lean = (p * 0.32 + b * 70) * a;
    const twist = -b * 150 * a;
    const sx = -lean * 0.4;
    const sy = -y * 0.3 * a + twist * 0.35;
    const sz = -r * 0.2 * a;
    const cx = -lean * 0.6;
    const cy = -y * 0.4 * a + twist * 0.65;
    const cz = -r * 0.3 * a;
    // the shouldered weapon rides on the chest exactly, so the stock stays in the pocket
    this.carry(pose, sx, sy, sz, cx, cy, cz);
    pose.preEuler('spine', sx, sy, sz);
    pose.preEuler('chest', cx, cy, cz);
    pose.preEuler('neck', 0, -twist * 0.4, 0);
    pose.preEuler('head', lean * 0.55, -twist * 0.6, r * 0.15 * a);
    pose.preEuler('shoulderR', -p * 0.25 * a, -b * 60 * a, -p * 0.15 * a);
  }

  /**
   * Moves the weapon target rigidly with the chest for spine / chest pre-rotations (degrees, parent
   * space, as Pose.preEuler) that are about to be applied: the model-space rotation of each one is
   * parentWorld * e * parentWorld^-1 about its joint. Call it before the preEulers.
   */
  private carry(pose: Pose, sx: number, sy: number, sz: number, cx: number, cy: number, cz: number): void {
    if (pose.wR.w < 0.001) return;
    const D = THREE.MathUtils.DEG2RAD;
    const rest = this.v.rig.restPos;
    const hq = pose.getQuat('hips', _cq0);
    // spine joint and the spine's world rotation, before the change
    _cp1.copy(rest[1]).applyQuaternion(hq).add(rest[0]).add(pose.hips);
    _cq1.copy(hq).multiply(pose.getQuat('spine', _cq2));
    // R1 about the spine joint
    _cq2.setFromEuler(_e.set(sx * D, sy * D, sz * D, 'YXZ'));
    _cr1.copy(hq).multiply(_cq2).multiply(_cq3.copy(hq).invert());
    // chest joint after R1, spine world after R1
    _cp2.copy(rest[2]).applyQuaternion(_cq1).applyQuaternion(_cr1).add(_cp1);
    _cq1.premultiply(_cr1);
    // R2 about the (moved) chest joint
    _cq2.setFromEuler(_e.set(cx * D, cy * D, cz * D, 'YXZ'));
    _cr2.copy(_cq1).multiply(_cq2).multiply(_cq3.copy(_cq1).invert());
    const w = pose.wR;
    w.p.sub(_cp1).applyQuaternion(_cr1).add(_cp1).sub(_cp2).applyQuaternion(_cr2).add(_cp2);
    w.q.premultiply(_cr1).premultiply(_cr2);
  }

  /**
   * Music groove: a head nod on the beat and a small bounce, for champions whose anim set asks
   * for it (st.groove is the gameplay's "free to vibe" weight: idle, grounded, not acting).
   */
  private applyGroove(dt: number, pose: Pose): void {
    const amt = this.v.anims.groove ?? 0;
    const target = amt * this.st.groove;
    this.grooveW += (target - this.grooveW) * (1 - Math.exp(-dt * (target > this.grooveW ? 2.5 : 8)));
    const w = this.grooveW;
    if (w < 0.01) return;
    // the beat phase drives the nod (down on the beat), the kick envelope adds a snap
    const ph = (Beat.beats % 1) * Math.PI * 2;
    const nod = Math.pow(Math.max(0, Math.cos(ph)), 3) * 0.7 + Beat.kick * 0.3;
    const sway = Math.sin(ph * 0.5);
    pose.preEuler('head', 9 * nod * w, 4 * sway * w, 0);
    pose.preEuler('neck', 4 * nod * w, 0, 0);
    this.carry(pose, 0, 0, 0, 2.5 * nod * w, 3 * sway * w, -1.5 * sway * w);
    pose.preEuler('chest', 2.5 * nod * w, 3 * sway * w, -1.5 * sway * w);
    pose.preEuler('shoulderL', 0, 0, 3 * Beat.snare * w);
    pose.preEuler('shoulderR', 0, 0, -3 * Beat.snare * w);
    pose.hips.y -= 0.018 * nod * w;
  }

  private applyReact(dt: number, pose: Pose): void {
    if (this.reactT < 0.7 && this.reactAmp > 0) {
      this.reactT += dt;
      const t = this.reactT;
      // the impact pose shows at once (55 %, it holds through a hit-stop), completes in 50 ms,
      // then a damped return with a small overshoot
      const env = t < 0.05 ? 0.55 + 0.45 * (t / 0.05) : Math.exp(-(t - 0.05) * 7.5) * Math.cos((t - 0.05) * 9);
      const k = env * this.reactAmp;
      const px = this.reactX;
      const pz = this.reactZ;
      pose.addEuler('spine', pz * 13 * k, px * 6 * k, -px * 10 * k);
      pose.addEuler('chest', pz * 9 * k, px * 8 * k, -px * 7 * k);
      pose.addEuler('neck', pz * 8 * k, 0, -px * 7 * k);
      pose.addEuler('head', pz * 15 * k, -px * 10 * k, -px * 12 * k);
      // arms fly out a little, more on the side the blow came from
      pose.preEuler('upperArmL', -12 * k, 0, (14 + Math.max(0, -px) * 16) * k);
      pose.preEuler('upperArmR', -12 * k, 0, -(14 + Math.max(0, px) * 16) * k);
      pose.hips.x += px * 0.045 * k;
      pose.hips.z += pz * 0.05 * k;
      // heavy blows buckle the knees
      const heavy = Math.max(0, this.reactAmp - 0.7) * env;
      if (heavy > 0) {
        pose.hips.y -= 0.12 * heavy;
        pose.addEuler('thighL', -30 * heavy, 0, 0).addEuler('thighR', -26 * heavy, 0, 0);
        pose.addEuler('shinL', 55 * heavy, 0, 0).addEuler('shinR', 50 * heavy, 0, 0);
      }
    }
    // launched: limbs spread and flail
    if (this.tumble > 0.001) {
      const w = this.tumble;
      const t = this.st.time;
      const fl = Math.sin(t * 17) * 10;
      pose.addEuler('spine', -22 * w, 0, 0).addEuler('chest', -12 * w, 0, 0).addEuler('head', -18 * w, 0, 0);
      pose.preEuler('upperArmL', (-60 + fl) * w, 0, 70 * w).preEuler('upperArmR', (-60 - fl) * w, 0, -70 * w);
      pose.addEuler('foreArmL', -30 * w, 0, 0).addEuler('foreArmR', -30 * w, 0, 0);
      pose.addEuler('thighL', (-35 - fl) * w, 0, 18 * w).addEuler('thighR', (10 + fl) * w, 0, -18 * w);
      pose.addEuler('shinL', 60 * w, 0, 0).addEuler('shinR', 35 * w, 0, 0);
      this.tumble = Math.max(0, this.tumble - dt * 1.1);
    }
  }

  private solveWeapons(): void {
    const p = this.pose;
    const v = this.v;
    const B = v.rig.byName;
    const ik = this.ik;
    const rr = v.rig.root;
    rr.getWorldQuaternion(_rq);
    if (p.wR.w > 0.001) {
      const pole = v.weaponR ? POLE_ARMED : POLE_BARE;
      this.wristTarget(v.weaponR ?? BARE_HAND, p.wR, _p, _hq);
      B.upperArmR.getWorldPosition(_sh);
      this.armPole(_pole, _sh, -pole[0], pole[1], pole[2], p.wR.e);
      const w = Math.min(1, p.wR.w);
      solveTwoBone(B.upperArmR, B.foreArmR, B.handR, _p, _pole, w, false, ik.handR);
      setWorldQuat(B.handR, _hq, w, ik.qHandR);
    } else ik.handR.ok = ik.qHandR.ok = false;
    // Left arm: ONE chain whose wrist target is blended between the off-hand grip on the two-handed
    // weapon and the wL key (a bare-hand gesture or a second weapon). Two solves in a row fighting
    // over the same bones swing the elbow through the shoulder while one fades out and the other in.
    const offW = v.offhandGrip ? THREE.MathUtils.clamp(p.off, 0, 1) : 0;
    const keyW = THREE.MathUtils.clamp(p.wL.w, 0, 1);
    const total = Math.min(1, offW + keyW);
    if (total > 0.001) {
      const mix = offW > 0 ? keyW / (offW + keyW) : 1;
      const kp = v.weaponL ? POLE_ARMED : POLE_BARE;
      if (keyW > 0) this.wristTarget(v.weaponL ?? BARE_HAND, p.wL, _lp, _lq);
      B.upperArmL.getWorldPosition(_sh);
      if (offW > 0) {
        v.offhandGrip!.getWorldPosition(_p);
        v.offhandGrip!.getWorldQuaternion(_q);
        if (mix > 0) {
          // the wrist swings round the shoulder (direction slerp + distance lerp): a straight line
          // from the grip to a gesture on the other side of the body cuts through the shoulder
          _da.subVectors(_p, _sh);
          _db.subVectors(_lp, _sh);
          const ra = _da.length();
          const rb = _db.length();
          if (ra > 1e-4 && rb > 1e-4) {
            _da.divideScalar(ra);
            _db.divideScalar(rb);
            slerpUnitNear(_dm, _da, _db, mix, ik.dMix.ok ? ik.dMix.q : undefined);
            ik.dMix.q.copy(_dm);
            ik.dMix.ok = true;
            _p.copy(_sh).addScaledVector(_dm, ra + (rb - ra) * mix);
          } else _p.lerp(_lp, mix);
          slerpNear(_hq, _q, _lq, mix, ik.qMix.ok ? ik.qMix.q : undefined);
          ik.qMix.q.copy(_hq);
          ik.qMix.ok = true;
        } else {
          _hq.copy(_q);
          ik.qMix.ok = ik.dMix.ok = false;
        }
      } else {
        _p.copy(_lp);
        _hq.copy(_lq);
        ik.qMix.ok = ik.dMix.ok = false;
      }
      // pole: the grip's (elbow down and tucked, or under the weapon) toward the key's (default
      // or its elbow hint)
      _gd.set(POLE_GRIP[0], POLE_GRIP[1], POLE_GRIP[2]).normalize();
      if (v.gripElbow && v.weaponR && offW > 0) {
        v.weaponR.getWorldQuaternion(_wq);
        _rqi.copy(_rq).invert();
        _gd.set(v.gripElbow[0], v.gripElbow[1], v.gripElbow[2]).normalize().applyQuaternion(_wq).applyQuaternion(_rqi);
      }
      _pe.copy(p.wL.e).multiplyScalar(mix);
      _pk.set(kp[0], kp[1], kp[2]).normalize();
      this.armPole(
        _pole, _sh,
        _gd.x + (_pk.x - _gd.x) * mix,
        _gd.y + (_pk.y - _gd.y) * mix,
        _gd.z + (_pk.z - _gd.z) * mix,
        _pe,
      );
      solveTwoBone(B.upperArmL, B.foreArmL, B.handL, _p, _pole, total, false, ik.handL);
      setWorldQuat(B.handL, _hq, total, ik.qHandL);
    } else ik.handL.ok = ik.qHandL.ok = ik.qMix.ok = ik.dMix.ok = false;
  }

  /** wrist target (world) and hand world rotation that put `weapon` at the key's transform */
  private wristTarget(weapon: THREE.Object3D, key: WeaponKey, outP: THREE.Vector3, outQ: THREE.Quaternion): void {
    const rr = this.v.rig.root;
    // desired weapon world transform
    outP.copy(key.p);
    rr.localToWorld(outP);
    _q2.copy(_rq).multiply(key.q);
    // hand world rotation so the attached weapon ends up with that
    _inv.copy(weapon.quaternion).invert();
    outQ.copy(_q2).multiply(_inv);
    // wrist target
    _off.copy(weapon.position).applyQuaternion(outQ);
    outP.sub(_off);
  }

  /**
   * Elbow pole (world point): the chain's default direction (model space, x signed for the side),
   * overridden by the key's elbow hint `e` (length = override weight).
   */
  private armPole(out: THREE.Vector3, shoulder: THREE.Vector3, x: number, y: number, z: number, e: THREE.Vector3): void {
    _pa.set(x, y, z).normalize();
    const k = Math.min(1, e.length());
    if (k > 1e-4) _pa.multiplyScalar(1 - k).add(e).normalize();
    _pa.applyQuaternion(_rq);
    out.copy(shoulder).addScaledVector(_pa, 0.6);
  }

  /** planted feet: two-bone leg IK to the ankle targets, knees toward the toes */
  private solveFeet(): void {
    const p = this.pose;
    if (p.fL.w < 0.001 && p.fR.w < 0.001) {
      this.ik.footL.ok = this.ik.footR.ok = this.ik.qFootL.ok = this.ik.qFootR.ok = false;
      return;
    }
    const B = this.v.rig.byName;
    const rr = this.v.rig.root;
    rr.getWorldQuaternion(_rq);
    for (const side of [1, -1]) {
      const key = side > 0 ? p.fL : p.fR;
      const memo = side > 0 ? this.ik.footL : this.ik.footR;
      const qm = side > 0 ? this.ik.qFootL : this.ik.qFootR;
      if (key.w < 0.001) {
        memo.ok = qm.ok = false;
        continue;
      }
      const thigh = side > 0 ? B.thighL : B.thighR;
      const shin = side > 0 ? B.shinL : B.shinR;
      const foot = side > 0 ? B.footL : B.footR;
      // ground: a planted ankle never goes below its rest height (a transition offset or a
      // hop key easing back down must not push the foot through the floor)
      _p.copy(key.p);
      _p.y = Math.max(_p.y, this.ankleY);
      rr.localToWorld(_p);
      // pole: in front of the knee along the toe direction, a little outward
      _q.copy(_rq).multiply(key.q);
      thigh.getWorldPosition(_pole);
      _off.set(side * 0.12, -0.35, 0.6).applyQuaternion(_q);
      _pole.add(_off);
      const w = Math.min(1, key.w);
      solveTwoBone(thigh, shin, foot, _p, _pole, w, true, memo);
      setWorldQuat(foot, _q, w, qm);
    }
  }


}
