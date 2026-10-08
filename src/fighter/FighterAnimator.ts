import * as THREE from 'three';
import { applyPose, Pose, setWorldQuat, solveTwoBone, type WeaponKey } from './Animator';
import { ActionLayer, Locomotion, newLocoState, type PlayOpts } from './locomotion';
import { updateBodySpheres } from './Cloth';
import type { ChampionVisual } from '../champions/types';

const _p = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
const _hq = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _off = new THREE.Vector3();
const _e = new THREE.Euler();
const _aq = new THREE.Quaternion();

/**
 * Drives one champion visual: locomotion blend -> action clip -> flinch overlay -> head look ->
 * FK -> weapon-driven IK for both hands -> off-hand grip -> cloth simulation.
 */
export class FighterAnimator {
  readonly loco: Locomotion;
  readonly action = new ActionLayer();
  readonly flinch = new ActionLayer();
  readonly st = newLocoState();
  readonly pose = new Pose();
  /** wind applied to cloth (world space, m/s^2) */
  readonly wind = new THREE.Vector3();
  /** weapon recoil impulse (0..1, decays) */
  recoil = 0;
  /** shoulder pivot used to rotate the aimed weapon (model space) */
  private readonly aimPivot: THREE.Vector3;

  constructor(readonly v: ChampionVisual) {
    this.loco = new Locomotion(v.anims);
    const r = v.rig.restPos;
    // hips + spine + chest + shoulder drop
    this.aimPivot = new THREE.Vector3(-0.08, r[0].y + r[1].y + r[2].y + v.rig.spec.shoulderDrop, 0);
  }

  play(name: string, opts: PlayOpts = {}): boolean {
    const c = this.v.anims.clips[name];
    if (!c) return false;
    this.action.play(c, opts);
    return true;
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

    // head / chest look-at
    const lp = THREE.MathUtils.clamp(st.lookPitch, -55, 55);
    const ly = THREE.MathUtils.clamp(st.lookYaw, -75, 75);
    pose.preEuler('neck', lp * 0.3, ly * 0.35, 0);
    pose.preEuler('head', lp * 0.4, ly * 0.45, 0);
    if (st.aim > 0.001) {
      pose.preEuler('spine', lp * 0.18 * st.aim, ly * 0.2 * st.aim, 0);
      pose.preEuler('chest', lp * 0.3 * st.aim, ly * 0.25 * st.aim, 0);
    }

    // aimed weapons follow the camera pitch/yaw around the shoulder pivot (+ recoil)
    this.recoil = Math.max(0, this.recoil - dt * 9);
    if (st.aim > 0.001 && pose.wR.w > 0.001) {
      _e.set(lp * THREE.MathUtils.DEG2RAD * st.aim - this.recoil * 0.12, ly * THREE.MathUtils.DEG2RAD * st.aim, 0, 'YXZ');
      _aq.setFromEuler(_e);
      pose.wR.p.sub(this.aimPivot).applyQuaternion(_aq).add(this.aimPivot);
      pose.wR.q.premultiply(_aq);
      if (this.recoil > 0) {
        _off.set(0, 0, -1).applyQuaternion(pose.wR.q);
        pose.wR.p.addScaledVector(_off, this.recoil * 0.08);
      }
    }

    applyPose(pose, this.v.rig);
    this.v.root.updateMatrixWorld(true);
    this.solveWeapons();

    if (simulateCloth) {
      updateBodySpheres(this.v.bodySpheres);
      for (const c of this.v.cloth) c.update(dt, this.wind);
    }
  }

  private solveWeapons(): void {
    const p = this.pose;
    const v = this.v;
    const B = v.rig.byName;
    if (p.wR.w > 0.001 && v.weaponR) this.solveHand(-1, v.weaponR, p.wR);
    if (p.wL.w > 0.001 && v.weaponL) this.solveHand(1, v.weaponL, p.wL);
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
  private solveHand(side: number, weapon: THREE.Object3D, key: WeaponKey): void {
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
    _off.set(side * 0.5, -0.5, -0.3).applyQuaternion(_rq);
    _pole.add(_off);
    solveTwoBone(upper, lower, hand, _p, _pole, key.w);
    setWorldQuat(hand, _hq, key.w);
  }
}
