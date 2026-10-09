import * as THREE from 'three';
import { BaseKit } from '../BaseKit';
import type { Fighter } from '../../game/Fighter';
import type { ActionEvent, Intent, MatchContext } from '../../game/types';
import { CAPSULE_R, capsule, segSegDist2 } from '../Projectiles';
import { Shape } from '../../vfx/Particles';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

/** Beat Shot keeps full power up to ~28 m, then fades to 62% at 60 m (the rifle rewards closing in) */
const BEAT_FALLOFF = { from: 28, to: 60, min: 0.62 };

/** Bass Charge: seconds to full, then the perfect-release window, then overcharge */
const CHARGE_SEC = 0.95;
const PERFECT_SEC = 0.18;
const OVER_AFTER = 0.6;
const OVER_DECAY_SEC = 1;
const OVER_MIN = 0.75;

/**
 * REX — sharpshooter.
 * LMB: Beat Shot (auto, headshots crit, loses power past ~28 m) · RMB: Bass Charge (hold,
 * piercing beam; releasing right as it fills is a PERFECT shot, holding too long bleeds power) ·
 * F: Sub Bomb (bouncing sonic grenade) · R: Drop The Beat (12 homing note missiles).
 */
export class RexKit extends BaseKit {
  private fireT = 0;
  private bloom = 0;
  private aimHold = 0;
  private charging = false;
  /** seconds the charge has been held */
  private chargeT = 0;
  chargeFx = 0;
  private ultShots = 0;
  private ultT = 0;
  private ultTargets: Fighter[] = [];

  constructor() {
    super('rex');
  }

  facesAim(f: Fighter): boolean {
    return this.aimHold > 0 || this.charging || super.facesAim(f);
  }

  protected handleInput(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    this.fireT -= dt;
    this.aimHold = Math.max(0, this.aimHold - dt);
    this.bloom = Math.max(0, this.bloom - dt * (it.attack ? 0.4 : 2.5));
    this.faceYaw = null;

    if (this.act === 'ult') return;
    // ultimate
    if (it.ultimatePressed && !this.act && !this.charging && this.useUlt(f, m)) {
      this.startAction(f, 'ult', 1.5);
      f.anim.play('ult', { hold: true });
      this.ultShots = 12;
      this.ultT = 0.15;
      this.ultTargets = m.fighters.filter((o) => o !== f && o.alive && (o.team === 0 || o.team !== f.team) && o.pos.distanceTo(f.pos) < this.data.abilities.ult.range);
      m.audio.play('ult', f.pos, 1);
      m.broadcastAction(f, { a: 'ult' });
      return;
    }
    // grenade
    if (it.abilityPressed && this.cd.abi <= 0 && !this.charging && !this.act) {
      this.cd.abi = this.data.abilities.abi.cooldown;
      this.startAction(f, 'throw', 0.42);
      f.anim.play('throw', { fadeIn: 0.04 });
      return;
    }
    // charge beam
    if (this.charging) {
      f.ctrl.aim = 1;
      f.ctrl.speedMul = 0.5;
      const before = this.chargeT;
      this.chargeT += dt;
      this.charge = Math.min(1, this.chargeT / CHARGE_SEC);
      this.chargeFx = this.perfectWindow ? 1 : this.chargeT > CHARGE_SEC + OVER_AFTER ? 2 : 0;
      // the perfect window opens: an audible cue (Gears of War active reload)
      if (before < CHARGE_SEC && this.chargeT >= CHARGE_SEC) m.audio.play('perfectTick', f.pos, 1);
      if (!it.secondary || it.secondaryReleased) this.releaseCharge(f, m);
      return;
    }
    if (it.secondaryPressed && this.cd.sec <= 0 && !this.act) {
      this.charging = true;
      this.charge = 0;
      this.chargeT = 0;
      this.chargeFx = 0;
      f.anim.play('charge', { hold: true, fadeIn: 0.08 });
      m.audio.play('charge', f.pos, 0.8);
      m.broadcastAction(f, { a: 'charge', n: 1 });
      return;
    }
    // auto fire
    if (it.attack && !this.act) {
      f.ctrl.aim = 1;
      f.ctrl.speedMul = 0.82;
      if (this.aimHold <= 0) f.anim.play('aim', { hold: true, fadeIn: 0.06 });
      this.aimHold = 0.55;
      if (this.fireT <= 0) {
        this.fireT = 1 / 7;
        this.shoot(f, m);
      }
    } else if (this.aimHold > 0) {
      f.ctrl.aim = 1;
    } else {
      f.ctrl.aim = 0;
      if (f.anim.action.name === 'aim') f.anim.action.stop(0.18);
    }
  }

  private muzzle(f: Fighter, out: THREE.Vector3): THREE.Vector3 {
    return f.visual.muzzle ? f.visual.muzzle.getWorldPosition(out) : f.chest(out);
  }

  private shoot(f: Fighter, m: MatchContext): void {
    const from = this.muzzle(f, new THREE.Vector3());
    const { point } = this.aimPoint(f, m, 220);
    const dir = point.clone().sub(from).normalize();
    // spread grows with sustained fire
    const spread = THREE.MathUtils.degToRad(0.5 + this.bloom * 2.6);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    this.bloom = Math.min(1, this.bloom + 0.12);
    m.projectiles.spawn({ owner: f, kind: 'bolt', pos: from, vel: dir.clone().multiplyScalar(150), radius: 0.12, life: 1.4, slot: 'atk', part: 'shot', color: f.champ.colors[0], color2: f.champ.colors[1], headshots: true, falloff: BEAT_FALLOFF });
    m.vfx.muzzle(from, dir, f.champ.colors[0]);
    m.audio.play('shot', from, 0.85);
    f.anim.recoil = Math.min(1, f.anim.recoil + 0.55);
    m.broadcastAction(f, { a: 'shot', p: [from.x, from.y, from.z], d: [dir.x, dir.y, dir.z] });
  }

  private get perfectWindow(): boolean {
    return this.chargeT >= CHARGE_SEC && this.chargeT <= CHARGE_SEC + PERFECT_SEC;
  }

  /** past the overcharge point the beam bleeds power (down to OVER_MIN) and the aim wobbles */
  private get overK(): number {
    return THREE.MathUtils.clamp((this.chargeT - CHARGE_SEC - OVER_AFTER) / OVER_DECAY_SEC, 0, 1);
  }

  private releaseCharge(f: Fighter, m: MatchContext): void {
    const k = this.charge;
    const perfect = this.perfectWindow;
    const over = this.overK;
    this.charging = false;
    this.charge = 0;
    this.chargeFx = 0;
    f.anim.play('aim', { hold: true, fadeIn: 0.02 });
    this.aimHold = 0.5;
    if (k < 0.15) {
      this.cd.sec = 0.3;
      m.broadcastAction(f, { a: 'charge', n: 0 });
      return;
    }
    this.cd.sec = this.data.abilities.sec.cooldown * (perfect ? 0.5 : 1);
    const from = this.muzzle(f, new THREE.Vector3());
    const { point } = this.aimPoint(f, m, 180);
    _v.subVectors(point, from).normalize();
    if (over > 0) {
      // overcharged: the shot shakes off the crosshair
      const w = THREE.MathUtils.degToRad(2.2) * over;
      _v.x += (Math.random() - 0.5) * w * 2;
      _v.y += (Math.random() - 0.5) * w * 2;
      _v.z += (Math.random() - 0.5) * w * 2;
      _v.normalize();
      point.copy(from).addScaledVector(_v, from.distanceTo(point));
    }
    const wallHit = m.world.raycast(from, _v, from.distanceTo(point));
    const to = wallHit ? wallHit.point.clone() : point.clone();
    const fxK = perfect ? 1.4 : k;
    this.beamFx(f, m, from, to, fxK);
    if (perfect) {
      m.audio.play('chord', from, 1);
      m.vfx.ring(from.clone(), _v, 0xffffff, 0.2, 2.4, 0.3);
    }
    if (m.isAuthority(f)) {
      const radius = perfect ? 0.35 : 0.2;
      const scale = perfect ? 1 : (0.3 + 0.7 * k) * (1 - (1 - OVER_MIN) * over);
      for (const o of m.fighters) {
        if (o === f || !o.alive) continue;
        if (o.team !== 0 && o.team === f.team) continue;
        capsule(o, _c1, _c2);
        const d2 = segSegDist2(from, to, _c1, _c2, _a, _b);
        if (d2 < (CAPSULE_R + radius) ** 2) {
          const crit = !perfect && _b.y > o.pos.y + 1.45;
          const kb = _v.clone().multiplyScalar(8 * Math.min(1, k) * (perfect ? 1.5 : 1)).setY(perfect ? 3 : 2);
          m.reportHit(f, o, { slot: 'sec', part: perfect ? 'perfect' : 'charge', scale, crit, at: _a.clone(), kb, blockable: true });
        }
      }
    }
    f.anim.recoil = 1;
    f.vel.addScaledVector(_v, -6 * k);
    m.shake(0.35 * fxK, from);
    m.broadcastAction(f, { a: 'beam', p: [from.x, from.y, from.z], d: [to.x, to.y, to.z], n: fxK });
  }

  private beamFx(f: Fighter, m: MatchContext, from: THREE.Vector3, to: THREE.Vector3, k: number): void {
    const [c0, c1] = f.champ.colors;
    m.vfx.beam(from, to, c0, 0.18 + k * 0.25, 0.35);
    m.vfx.beam(from, to, 0xffffff, 0.05 + k * 0.07, 0.25);
    const dir = _v.subVectors(to, from).normalize().clone();
    const len = from.distanceTo(to);
    for (let d = 2; d < Math.min(len, 60); d += 4) m.vfx.ring(from.clone().addScaledVector(dir, d), dir, d % 8 < 4 ? c0 : c1, 0.15, 0.6 + k, 0.3 + d * 0.004);
    m.vfx.muzzle(from, dir, c1);
    m.vfx.hitSpark(to, dir.clone().negate(), c1, true);
    m.audio.play('chargeShot', from, 1);
  }

  private throwBomb(f: Fighter, m: MatchContext): void {
    const from = f.chest(new THREE.Vector3()).addScaledVector(f.intent.aimDir, 0.6);
    from.y += 0.3;
    // aim at the point under the crosshair (the camera is offset over the shoulder)
    const { point } = this.aimPoint(f, m, 80);
    const dir = point.sub(from).normalize();
    const vel = dir.multiplyScalar(26);
    vel.y += 4;
    vel.add(f.vel.clone().multiplyScalar(0.5));
    m.projectiles.spawn({ owner: f, kind: 'grenade', pos: from, vel, radius: 0.22, life: 1.3, gravity: 22, bounce: 2, explode: 4.6, kb: 14, slot: 'abi', part: 'blast', color: f.champ.colors[0], color2: f.champ.colors[1] });
    m.audio.play('swing', from, 0.6);
    m.broadcastAction(f, { a: 'bomb', p: [from.x, from.y, from.z], d: [vel.x, vel.y, vel.z] });
  }

  protected tickAction(f: Fighter, _it: Intent, dt: number, m: MatchContext): void {
    if (this.act === 'ult') {
      f.ctrl.aim = 0;
      f.ctrl.speedMul = 0.3;
      this.ultT -= dt;
      if (this.ultShots > 0 && this.ultT <= 0) {
        this.ultT = 0.09;
        this.ultShots--;
        const from = this.muzzle(f, new THREE.Vector3());
        const live = this.ultTargets.filter((t) => t.alive);
        const target = live.length ? live[this.ultShots % live.length] : null;
        const up = new THREE.Vector3((Math.random() - 0.5) * 0.8, 1, (Math.random() - 0.5) * 0.8).add(f.intent.aimDir.clone().multiplyScalar(0.8)).normalize();
        m.projectiles.spawn({ owner: f, kind: 'note', pos: from, vel: up.multiplyScalar(34), radius: 0.3, life: 3, slot: 'ult', part: 'note', color: this.ultShots % 2 ? f.champ.colors[0] : f.champ.colors[1], color2: 0xffffff, homing: { target, strength: 7, delay: 0.22 }, kb: 4 });
        m.vfx.muzzle(from, up, f.champ.colors[1]);
        m.audio.play('note', from, 0.8);
        m.broadcastAction(f, { a: 'note', p: [from.x, from.y, from.z], d: [up.x, up.y, up.z], t: target?.id });
      }
    }
  }

  onAnimEvent(f: Fighter, ev: string, m: MatchContext): void {
    if (ev === 'release' && this.act === 'throw') this.throwBomb(f, m);
  }

  protected endAction(f: Fighter): void {
    if (this.act === 'ult') f.anim.action.stop(0.2);
    super.endAction(f);
  }

  cancel(f: Fighter): void {
    this.charging = false;
    this.chargeT = 0;
    this.chargeFx = 0;
    this.aimHold = 0;
    super.cancel(f);
  }

  playRemote(f: Fighter, e: ActionEvent, m: MatchContext): void {
    const p = e.p ? new THREE.Vector3(...e.p) : f.chest(new THREE.Vector3());
    switch (e.a) {
      case 'shot': {
        const d = new THREE.Vector3(...(e.d ?? [0, 0, 1]));
        m.projectiles.spawn({ owner: f, kind: 'bolt', pos: p, vel: d.clone().multiplyScalar(150), radius: 0.12, life: 1.4, slot: 'atk', part: 'shot', color: f.champ.colors[0], color2: f.champ.colors[1], visualOnly: true });
        m.vfx.muzzle(p, d, f.champ.colors[0]);
        m.audio.play('shot', p, 0.85);
        f.anim.recoil = Math.min(1, f.anim.recoil + 0.55);
        if (f.anim.action.name !== 'aim') f.anim.play('aim', { hold: true });
        this.aimHold = 0.55;
        break;
      }
      case 'charge':
        if (e.n) f.anim.play('charge', { hold: true });
        break;
      case 'beam':
        if (e.d) this.beamFx(f, m, p, new THREE.Vector3(...e.d), e.n ?? 1);
        if ((e.n ?? 0) > 1.2) m.audio.play('chord', p, 1);
        f.anim.play('aim', { hold: true });
        this.aimHold = 0.5;
        break;
      case 'bomb':
        f.anim.play('throw');
        m.projectiles.spawn({ owner: f, kind: 'grenade', pos: p, vel: new THREE.Vector3(...(e.d ?? [0, 0, 1])), radius: 0.22, life: 1.3, gravity: 22, bounce: 2, explode: 4.6, slot: 'abi', part: 'blast', color: f.champ.colors[0], color2: f.champ.colors[1], visualOnly: true });
        break;
      case 'ult':
        f.anim.play('ult', { hold: true });
        m.audio.play('ult', f.pos, 1);
        this.act = 'ultRemote';
        this.actT = 0;
        this.actDur = 1.5;
        break;
      case 'note': {
        const target = e.t ? m.fighters.find((x) => x.id === e.t) ?? null : null;
        m.projectiles.spawn({ owner: f, kind: 'note', pos: p, vel: new THREE.Vector3(...(e.d ?? [0, 1, 0])).multiplyScalar(34), radius: 0.3, life: 3, slot: 'ult', part: 'note', color: f.champ.colors[1], color2: 0xffffff, homing: { target, strength: 7, delay: 0.22 }, visualOnly: true });
        m.audio.play('note', p, 0.8);
        break;
      }
      default:
        break;
    }
  }

  tickRemote(f: Fighter, dt: number): void {
    this.aimHold = Math.max(0, this.aimHold - dt);
    f.ctrl.aim = this.aimHold > 0 ? 1 : 0;
    if (this.aimHold <= 0 && f.anim.action.name === 'aim') f.anim.action.stop(0.18);
    if (this.act) {
      this.actT += dt;
      if (this.actT > this.actDur) {
        this.endAction(f);
        f.anim.action.stop(0.2);
      }
    }
    void Shape;
  }
}
