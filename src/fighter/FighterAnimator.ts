import * as THREE from 'three';
import { applyPose, Pose, setWorldQuat, solveTwoBone, type WeaponKey } from './Animator';
import { ActionLayer, Locomotion, newLocoState, type PlayOpts } from './locomotion';
import { updateBodySpheres } from './Cloth';
import { Kick } from './Springs';
import { Beat } from '../core/Beat';
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
}

const _p = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
const _hq = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _off = new THREE.Vector3();
const _e = new THREE.Euler();
const _aq = new THREE.Quaternion();
const _kq = new THREE.Quaternion();
const _kp = new THREE.Vector3();
/** stand-in "weapon" for an empty hand: the key then targets the wrist + hand frame directly */
const BARE_HAND = new THREE.Object3D();
/** elbow pole offsets (x mirrored per side): armed hands keep the elbows low, bare hands flare out */
const POLE_ARMED: [number, number, number] = [0.5, -0.5, -0.3];
const POLE_BARE: [number, number, number] = [0.6, -0.3, -0.1];

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
  private readonly kp = new Kick(6.5, 0.42);
  private readonly kb = new Kick(8.5, 0.5);
  private readonly kr = new Kick(5.5, 0.35);
  private readonly ky = new Kick(6, 0.4);
  private kickBody = 0.5;
  /** music groove weight (0..1, eased), driven by st.groove */
  private grooveW = 0;
  /** procedural hit reaction: push direction in model space (x = left, z = forward) */
  private reactX = 0;
  private reactZ = 0;
  private reactT = 9;
  private reactAmp = 0;
  /** limb flail while launched / tumbling (0..1, decays) */
  tumble = 0;
  /** shoulder pivot used to rotate the aimed weapon (model space) */
  private readonly aimPivot: THREE.Vector3;
  /** base of the spine (model space): the torso rocks around it when it absorbs a kick */
  private readonly spinePivot: THREE.Vector3;

  constructor(readonly v: ChampionVisual) {
    this.loco = new Locomotion(v.anims);
    const r = v.rig.restPos;
    // hips + spine + chest + shoulder drop
    this.aimPivot = new THREE.Vector3(-0.08, r[0].y + r[1].y + r[2].y + v.rig.spec.shoulderDrop, 0);
    this.spinePivot = new THREE.Vector3(0, r[0].y + r[1].y, 0);
  }

  play(name: string, opts: PlayOpts = {}): boolean {
    const c = this.v.anims.clips[name];
    if (!c) return false;
    this.action.play(c, opts);
    return true;
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
    this.action.apply(pose, airborne);
    this.flinch.update(dt);
    this.flinch.apply(pose, airborne);
    this.applyReact(dt, pose);
    // clips authored for another body size: weapon targets and hip offsets scale with the body
    const k = this.v.animScale ?? 1;
    if (k !== 1) {
      pose.wR.p.multiplyScalar(k);
      pose.wL.p.multiplyScalar(k);
      pose.hips.multiplyScalar(k);
    }

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

    applyPose(pose, this.v.rig);
    this.v.root.updateMatrixWorld(true);
    this.solveWeapons();
    this.v.syncPose?.(pose);

    if (simulateCloth) {
      updateBodySpheres(this.v.bodySpheres);
      for (const c of this.v.cloth) c.update(dt, this.wind);
    }
  }

  /**
   * Fire a weapon kick (adds to any kick still ringing). Light rifle shot ~{ pitch: 3, back: 0.035 },
   * heavy slug ~{ pitch: 16, back: 0.1, body: 1 }.
   */
  kick(k: KickSpec): void {
    if (k.pitch) this.kp.hit(k.pitch);
    if (k.back) this.kb.hit(k.back);
    if (k.roll) this.kr.hit(k.roll);
    if (k.yaw) this.ky.hit(k.yaw);
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
    const pivotZ = this.v.stockZ ?? -0.3;
    // the stock on the shoulder is the hinge: grip = stock + R * (grip - stock)
    _off.set(0, 0, pivotZ).applyQuaternion(pose.wR.q);
    _kp.copy(pose.wR.p).add(_off);
    _e.set(-p * D, y * D, r * D, 'YXZ');
    _kq.setFromEuler(_e);
    pose.wR.q.multiply(_kq);
    _off.set(0, 0, -pivotZ).applyQuaternion(pose.wR.q);
    pose.wR.p.copy(_kp).add(_off);
    // shove back along the barrel
    _off.set(0, 0, -b).applyQuaternion(pose.wR.q);
    pose.wR.p.add(_off);
    // the body takes part of it: chest and spine rock back, the head stays on target
    const a = this.kickBody;
    const lean = (p * 0.32 + b * 70) * a;
    pose.preEuler('spine', -lean * 0.4, -y * 0.3 * a, -r * 0.2 * a);
    pose.preEuler('chest', -lean * 0.6, -y * 0.4 * a, -r * 0.3 * a);
    pose.preEuler('head', lean * 0.55, 0, r * 0.15 * a);
    pose.preEuler('shoulderR', -p * 0.25 * a, 0, -p * 0.15 * a);
    // move the weapon with the chest so the arms do not stretch
    _e.set(-lean * D, 0, 0, 'YXZ');
    _kq.setFromEuler(_e);
    pose.wR.p.sub(this.spinePivot).applyQuaternion(_kq).add(this.spinePivot);
    pose.wR.q.premultiply(_kq);
    // heavy kicks rock the hips back and bend the knees a touch
    if (a > 0.6) {
      const h = (a - 0.6) / 0.4;
      pose.hips.z -= b * 0.55 * h;
      pose.hips.y -= Math.abs(b) * 0.25 * h;
      pose.addEuler('thighL', -b * 60 * h, 0, 0).addEuler('thighR', -b * 60 * h, 0, 0);
      pose.addEuler('shinL', b * 90 * h, 0, 0).addEuler('shinR', b * 90 * h, 0, 0);
    }
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
    pose.preEuler('chest', 2.5 * nod * w, 3 * sway * w, -1.5 * sway * w);
    pose.preEuler('shoulderL', 0, 0, 3 * Beat.snare * w);
    pose.preEuler('shoulderR', 0, 0, -3 * Beat.snare * w);
    pose.hips.y -= 0.018 * nod * w;
  }

  private applyReact(dt: number, pose: Pose): void {
    if (this.reactT < 0.7 && this.reactAmp > 0) {
      this.reactT += dt;
      const t = this.reactT;
      // 50 ms snap, then a damped return with a small overshoot
      const env = t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) * 7.5) * Math.cos((t - 0.05) * 9);
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
    if (p.wR.w > 0.001) this.solveHand(-1, v.weaponR ?? BARE_HAND, p.wR, v.weaponR ? POLE_ARMED : POLE_BARE);
    if (p.wL.w > 0.001) this.solveHand(1, v.weaponL ?? BARE_HAND, p.wL, v.weaponL ? POLE_ARMED : POLE_BARE);
    if (p.off > 0.001 && v.offhandGrip) {
      v.offhandGrip.getWorldPosition(_p);
      v.offhandGrip.getWorldQuaternion(_q);
      v.rig.root.getWorldQuaternion(_rq);
      B.upperArmL.getWorldPosition(_pole);
      _off.set(0.45, -0.55, -0.25).applyQuaternion(_rq);
      _pole.add(_off);
      solveTwoBone(B.upperArmL, B.foreArmL, B.handL, _p, _pole, p.off);
      setWorldQuat(B.handL, _q, p.off);
    }
  }

  /** side: -1 right, +1 left */
  private solveHand(side: number, weapon: THREE.Object3D, key: WeaponKey, pole: [number, number, number]): void {
    const v = this.v;
    const B = v.rig.byName;
    const upper = side < 0 ? B.upperArmR : B.upperArmL;
    const lower = side < 0 ? B.foreArmR : B.foreArmL;
    const hand = side < 0 ? B.handR : B.handL;
    const rr = v.rig.root;
    rr.getWorldQuaternion(_rq);
    // desired weapon world transform
    _p.copy(key.p);
    rr.localToWorld(_p);
    _q.copy(_rq).multiply(key.q);
    // hand world rotation so the attached weapon ends up with _q
    _inv.copy(weapon.quaternion).invert();
    _hq.copy(_q).multiply(_inv);
    // wrist target
    _off.copy(weapon.position).applyQuaternion(_hq);
    _p.sub(_off);
    upper.getWorldPosition(_pole);
    _off.set(side * pole[0], pole[1], pole[2]).applyQuaternion(_rq);
    _pole.add(_off);
    solveTwoBone(upper, lower, hand, _p, _pole, key.w);
    setWorldQuat(hand, _hq, key.w);
  }
}
