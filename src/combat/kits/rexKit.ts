import * as THREE from 'three';
import { BaseKit } from '../BaseKit';
import type { Fighter } from '../../game/Fighter';
import type { ActionEvent, HitInfo, Intent, MatchContext } from '../../game/types';
import { CAPSULE_R, capsule, segSegDist2 } from '../Projectiles';
import { Beat } from '../../core/Beat';
import {
  beatShotFx, beatShotMuzzle, beamFx, bombBurst, bombFx, bombRelease, chargeTick, noteFx, noteHit, noteLaunch,
  perfectSnap, plantedRing, refundTell, rexHit, slugCast, slugFx, ultAnnounce, ultEqRing,
} from './rexFx';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

/** Lead Single: slug speed and the cooldown refund when it connects */
const SLUG_SPEED = 135;
const SLUG_REFUND = 1.5;

/** Beat Shot keeps full power up to ~28 m, then fades to 62% at 60 m (the rifle rewards closing in) */
const BEAT_FALLOFF = { from: 28, to: 60, min: 0.62 };

/** Sub Bomb: blast radius and fuse (the telegraph is drawn at exactly this radius) */
const BOMB_RADIUS = 4.6;
const BOMB_FUSE = 1.3;

/** Bass Charge: seconds to full, then the perfect-release window, then overcharge */
const CHARGE_SEC = 0.95;
const PERFECT_SEC = 0.18;
const OVER_AFTER = 0.6;
const OVER_DECAY_SEC = 1;
const OVER_MIN = 0.75;

/**
 * REX — sharpshooter.
 * Skill: Lead Single (one heavy slug; a hit refunds cooldowns) · Attack: Beat Shot (auto,
 * headshots crit, loses power past ~28 m) · Secondary: Bass Charge (hold, piercing beam;
 * releasing right as it fills is a PERFECT shot, holding too long bleeds power) · F: Sub Bomb
 * (bouncing sonic grenade) · R: Drop The Beat (12 homing note missiles).
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
  private kickSide = 1;
  /** visual state shared by local and remote copies */
  private planted = -1;
  private remoteChargeT = -1;
  private ultFxT = -1;
  private noteIndex = 0;
  private noteStreak = 0;
  private noteLastHit = -9;

  constructor() {
    super('rex');
  }

  /** REX's projectiles and beam draw their own impact tiers (rexFx.rexHit) */
  ownsHitFx(info: HitInfo): boolean {
    return info.part === 'shot' || info.part === 'slug' || info.part === 'note' || info.part === 'charge' || info.part === 'perfect';
  }

  facesAim(f: Fighter): boolean {
    return this.aimHold > 0 || this.charging || super.facesAim(f);
  }

  protected handleInput(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    // (cooldown only: skillReady() consumes the buffered press)
    f.visual.cue?.('ready', this.cd.sig <= 0 && !this.act ? 1 : 0);
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
      m.audio.play('rex.ult', f.pos);
      this.ultStartFx(f, m);
      m.broadcastAction(f, { a: 'ult' });
      return;
    }
    // signature: Lead Single
    if (!this.charging && !this.act && this.skillReady()) {
      this.cd.sig = this.data.abilities.sig.cooldown;
      this.startAction(f, 'single', 0.42);
      f.anim.play('single', { fadeIn: 0.04 });
      this.aimHold = 0.6;
      f.ctrl.aim = 1;
      m.audio.play('rex.load', f.pos);
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
      // the perfect window opens: an audible cue (Gears of War active reload) and a visible snap
      if (before < CHARGE_SEC && this.chargeT >= CHARGE_SEC) {
        m.audio.play('rex.chargeFull', f.pos);
        perfectSnap(m, this.muzzle(f, _v));
        f.anim.kick({ pitch: -0.8, back: -0.01, body: 0.3 });
      }
      this.chargeVisuals(f, m, this.chargeT, dt);
      if (!it.secondary || it.secondaryReleased) this.releaseCharge(f, m);
      return;
    }
    if (it.secondaryPressed && this.cd.sec <= 0 && !this.act) {
      this.charging = true;
      this.charge = 0;
      this.chargeT = 0;
      this.chargeFx = 0;
      f.anim.play('charge', { hold: true, fadeIn: 0.08 });
      m.audio.play('rex.charge', f.pos);
      this.chargeStartFx(f, m);
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
    m.projectiles.spawn({ owner: f, kind: 'bolt', pos: from, vel: dir.clone().multiplyScalar(150), radius: 0.12, life: 1.4, slot: 'atk', part: 'shot', color: f.champ.colors[0], color2: f.champ.colors[1], headshots: true, falloff: BEAT_FALLOFF, mesh: false, sparks: false, fx: beatShotFx(m, from, BEAT_FALLOFF) });
    this.shotFx(f, m, from, dir);
    m.broadcastAction(f, { a: 'shot', p: [from.x, from.y, from.z], d: [dir.x, dir.y, dir.z] });
  }

  /** one Beat Shot's muzzle, sound, weapon detail and recoil (local and remote copies) */
  private shotFx(f: Fighter, m: MatchContext, from: THREE.Vector3, dir: THREE.Vector3): void {
    beatShotMuzzle(m, from, dir, this.bloom, Beat.kick > 0.6);
    m.audio.play('rex.shot', from, 1, undefined, { on: Beat.kick > 0.6 });
    f.visual.cue?.('shot');
    this.shotKick(f);
    // own small shots never shake the screen: a sub-degree view kick only
    m.cameraKick(f, 0.35, (Math.random() - 0.5) * 0.2, this.kickSide * 0.25);
  }

  /** one Beat Shot: a short climb with a random lean, alternating roll so a burst wobbles */
  private shotKick(f: Fighter): void {
    this.kickSide = -this.kickSide;
    f.anim.kick({ pitch: 3.2 + Math.random() * 1.2, back: 0.035, roll: this.kickSide * (0.6 + Math.random() * 0.6), yaw: (Math.random() - 0.5) * 1.2, body: 0.35 });
  }

  /** the heavy slug: big bolt, headshots crit, a hit cuts every other cooldown */
  private fireSlug(f: Fighter, m: MatchContext): void {
    const from = this.muzzle(f, new THREE.Vector3());
    const { point } = this.aimPoint(f, m, 220);
    const dir = point.clone().sub(from).normalize();
    m.projectiles.spawn({
      owner: f, kind: 'bolt', pos: from, vel: dir.clone().multiplyScalar(SLUG_SPEED), radius: 0.24, life: 1.25, slot: 'sig', part: 'slug',
      color: f.champ.colors[1], color2: f.champ.colors[0], headshots: true, kb: 7, scale: 2.1, mesh: false, sparks: false,
      fx: slugFx(m, from, () => refundTell(m, this.muzzle(f, _a), f.intent.aimDir)),
      onHit: () => {
        for (const s of ['sig', 'sec', 'abi'] as const) this.cd[s] = Math.max(0, this.cd[s] - SLUG_REFUND);
      },
    });
    this.slugFx(f, m, from, dir);
    f.vel.addScaledVector(dir, -3.5);
    m.broadcastAction(f, { a: 'slug', p: [from.x, from.y, from.z], d: [dir.x, dir.y, dir.z] });
  }

  /** the slug's cast (local and remote copies); the rifle's kick comes with the clip's 'fire' event */
  private slugFx(f: Fighter, m: MatchContext, from: THREE.Vector3, dir: THREE.Vector3): void {
    slugCast(m, from, dir);
    m.audio.play('rex.slug', from, 1, f);
    f.visual.cue?.('slug');
    // heavy shot: a view kick, a 3-degree FOV punch in (focus), a little self trauma
    m.cameraKick(f, 1.6, 0, this.kickSide * 0.6, -3);
    m.shake(0.12, from);
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
    this.chargeEndFx(f, m);
    this.aimHold = 0.5;
    if (k < 0.15) {
      f.anim.play('aim', { hold: true, fadeIn: 0.02 });
      this.cd.sec = 0.3;
      m.broadcastAction(f, { a: 'charge', n: 0 });
      return;
    }
    // the biggest kick of the kit: the release clip (rear foot hops back, hang, heavy settle)
    f.anim.play('release');
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
    this.beamFx(f, m, from, to, fxK, over, !!wallHit);
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
          rexHit(m, perfect || crit ? 'crit' : 'heavy', _a, _b.copy(_v).negate());
        }
      }
    }
    f.vel.addScaledVector(_v, -6 * k);
    // n: beam strength (1.4 = perfect); an overcharged release is sent as -(1 + overcharge)
    m.broadcastAction(f, { a: 'beam', p: [from.x, from.y, from.z], d: [to.x, to.y, to.z], n: over > 0 ? -(1 + over) : fxK });
  }

  /** beam visuals, recoil and camera (local and remote copies); k = 1.4 for a perfect release */
  private beamFx(f: Fighter, m: MatchContext, from: THREE.Vector3, to: THREE.Vector3, k: number, over = 0, wall = true): void {
    const perfect = k > 1.2;
    beamFx(m, from, to, Math.min(k, 1), perfect, over, wall);
    m.audio.play('rex.release', from, 1, undefined, { k, over });
    f.visual.cue?.('beam', k);
    const kk = Math.min(k, 1.4);
    f.anim.kick({ pitch: 9 + 8 * kk, back: 0.07 + 0.05 * kk, roll: 2, body: 1, freq: 2.9, zeta: 0.62, rise: 0.035, hang: 0.085 });
    m.cameraKick(f, 2.2 + 1.6 * kk, 0, 1.2, perfect ? -6 : -4);
    m.shake(perfect ? 0.22 : 0.16 * k, from);
  }

  // --- Bass Charge visuals (local and remote) -------------------------------------------------

  private chargeStartFx(f: Fighter, m: MatchContext): void {
    if (this.planted >= 0) m.vfx.decals.kill(this.planted);
    this.planted = plantedRing(m, f.pos);
  }

  private chargeVisuals(f: Fighter, m: MatchContext, t: number, dt: number): void {
    const k = Math.min(1, t / CHARGE_SEC);
    const state = t >= CHARGE_SEC && t <= CHARGE_SEC + PERFECT_SEC ? 1 : t > CHARGE_SEC + OVER_AFTER ? 2 : 0;
    f.visual.cue?.('charge', k);
    f.visual.cue?.('chargeState', state);
    m.audio.play('rex.chargeHold', f.pos, 1, undefined, { k, s: state });
    chargeTick(m, this.muzzle(f, _c1), t, k, state, dt);
    if (this.planted >= 0) m.vfx.decals.move(this.planted, f.pos);
    // strain: the weapon trembles harder as the charge builds; dead still in the perfect window;
    // overcharge shakes slower and wider
    if (state === 1) f.anim.tremble = 0;
    else if (state === 2) {
      f.anim.tremble = 2.2;
      f.anim.trembleHz = 10;
    } else {
      f.anim.tremble = 0.2 + 1.0 * k * k;
      f.anim.trembleHz = 16;
    }
  }

  private chargeEndFx(f: Fighter, m: MatchContext): void {
    f.visual.cue?.('charge', 0);
    f.visual.cue?.('chargeState', 0);
    f.anim.tremble = 0;
    if (this.planted >= 0) m.vfx.decals.kill(this.planted);
    this.planted = -1;
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
    m.projectiles.spawn({ owner: f, kind: 'grenade', pos: from, vel, radius: 0.22, life: BOMB_FUSE, gravity: 22, bounce: 2, explode: BOMB_RADIUS, kb: 14, slot: 'abi', part: 'blast', color: f.champ.colors[0], color2: f.champ.colors[1], ...this.bombVisuals(f, m) });
    bombRelease(m, f.visual.rig.byName.handL.getWorldPosition(_c2));
    m.audio.play('rex.throw', from, 1, f);
    m.broadcastAction(f, { a: 'bomb', p: [from.x, from.y, from.z], d: [vel.x, vel.y, vel.z] });
  }

  /** the Sub Bomb's visuals: telegraph at the exact radius, bounces, the EQ burst (blast drawn here) */
  private bombVisuals(f: Fighter, m: MatchContext) {
    const fx = bombFx(m, BOMB_RADIUS, BOMB_FUSE, f !== m.local && (f.team === 0 || f.team !== m.local.team));
    return {
      fx,
      blast: false,
      onBurst: (p: THREE.Vector3) => {
        fx.kill();
        bombBurst(m, p, BOMB_RADIUS);
      },
    };
  }

  protected tickAction(f: Fighter, _it: Intent, dt: number, m: MatchContext): void {
    if (this.act === 'single') {
      f.ctrl.aim = 1;
      f.ctrl.speedMul = 0.6;
    }
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
        const i = 11 - this.ultShots;
        m.projectiles.spawn({ owner: f, kind: 'note', pos: from, vel: up.clone().multiplyScalar(34), radius: 0.3, life: 3, slot: 'ult', part: 'note', color: this.ultShots % 2 ? f.champ.colors[0] : f.champ.colors[1], color2: 0xffffff, homing: { target, strength: 7, delay: 0.22 }, kb: 4, sparks: false, fx: this.noteVisuals(m, i) });
        this.noteLaunchFx(f, m, from, i);
        m.broadcastAction(f, { a: 'note', p: [from.x, from.y, from.z], d: [up.x, up.y, up.z], t: target?.id });
      }
    }
    if (this.act === 'ult') this.ultTickFx(f, m, dt);
  }

  // --- Drop The Beat visuals (local and remote) -----------------------------------------------

  private ultStartFx(f: Fighter, m: MatchContext): void {
    ultAnnounce(m, f.pos);
    this.ultFxT = 0;
    this.noteIndex = 0;
  }

  private ultTickFx(f: Fighter, m: MatchContext, dt: number): void {
    if (this.ultFxT < 0) return;
    this.ultFxT += dt;
    if (this.ultFxT > 1.4) this.ultFxT = -1;
    else ultEqRing(m, f.pos, this.ultFxT, dt);
  }

  private noteVisuals(m: MatchContext, i: number) {
    return noteFx(m, i, (at, dir) => {
      // hits close together escalate (+10 % each); the 12th note lands big
      this.noteStreak = m.time - this.noteLastHit < 0.4 ? this.noteStreak + 1 : 0;
      this.noteLastHit = m.time;
      noteHit(m, at, dir, this.noteStreak, i === 11);
    });
  }

  private noteLaunchFx(f: Fighter, m: MatchContext, from: THREE.Vector3, i: number): void {
    noteLaunch(m, from, i % 2 === 0);
    m.audio.play(i === 11 ? 'rex.drop' : 'rex.note', from, 1, undefined, { i });
    f.visual.cue?.('note');
    this.kickSide = -this.kickSide;
    f.anim.kick({ pitch: 2.2, back: 0.02, roll: this.kickSide * 1.2, body: 0.4 });
    m.cameraKick(f, 0.3, 0, this.kickSide * 0.3);
  }

  onAnimEvent(f: Fighter, ev: string, m: MatchContext): void {
    if (ev === 'release' && this.act === 'throw') this.throwBomb(f, m);
    else if (ev === 'fire' && this.act === 'single') this.fireSlug(f, m);
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
    f.visual.cue?.('charge', 0);
    f.visual.cue?.('chargeState', 0);
    f.anim.tremble = 0;
    this.remoteChargeT = -1;
    this.ultFxT = -1;
    super.cancel(f);
  }

  playRemote(f: Fighter, e: ActionEvent, m: MatchContext): void {
    const p = e.p ? new THREE.Vector3(...e.p) : f.chest(new THREE.Vector3());
    switch (e.a) {
      case 'shot': {
        const d = new THREE.Vector3(...(e.d ?? [0, 0, 1]));
        m.projectiles.spawn({ owner: f, kind: 'bolt', pos: p, vel: d.clone().multiplyScalar(150), radius: 0.12, life: 1.4, slot: 'atk', part: 'shot', color: f.champ.colors[0], color2: f.champ.colors[1], visualOnly: true, mesh: false, sparks: false, fx: beatShotFx(m, p, BEAT_FALLOFF) });
        this.shotFx(f, m, p, d);
        if (f.anim.action.name !== 'aim') f.anim.play('aim', { hold: true });
        this.aimHold = 0.55;
        break;
      }
      case 'charge':
        if (e.n) {
          f.anim.play('charge', { hold: true });
          m.audio.play('rex.charge', f.pos);
          this.remoteChargeT = 0;
          this.chargeStartFx(f, m);
        } else {
          this.remoteChargeT = -1;
          this.chargeEndFx(f, m);
        }
        break;
      case 'slug': {
        const d = new THREE.Vector3(...(e.d ?? [0, 0, 1]));
        m.projectiles.spawn({ owner: f, kind: 'bolt', pos: p, vel: d.clone().multiplyScalar(SLUG_SPEED), radius: 0.24, life: 1.25, slot: 'sig', part: 'slug', color: f.champ.colors[1], color2: f.champ.colors[0], scale: 2.1, visualOnly: true, mesh: false, sparks: false, fx: slugFx(m, p, () => refundTell(m, this.muzzle(f, _a), d)) });
        // two frames before the fire event, so the clip's recoil still fires on this copy
        f.anim.play('single', { offset: 0.067 });
        this.aimHold = 0.5;
        this.slugFx(f, m, p, d);
        break;
      }
      case 'beam':
        this.remoteChargeT = -1;
        this.chargeEndFx(f, m);
        if (e.d) {
          const n = e.n ?? 1;
          this.beamFx(f, m, p, new THREE.Vector3(...e.d), n < 0 ? 1 : n, n < 0 ? -n - 1 : 0);
        }
        f.anim.play('release');
        this.aimHold = 0.5;
        break;
      case 'bomb':
        f.anim.play('throw', { offset: 0.1 });
        m.projectiles.spawn({ owner: f, kind: 'grenade', pos: p, vel: new THREE.Vector3(...(e.d ?? [0, 0, 1])), radius: 0.22, life: BOMB_FUSE, gravity: 22, bounce: 2, explode: BOMB_RADIUS, slot: 'abi', part: 'blast', color: f.champ.colors[0], color2: f.champ.colors[1], visualOnly: true, ...this.bombVisuals(f, m) });
        bombRelease(m, p);
        m.audio.play('rex.throw', p, 1, f);
        break;
      case 'ult':
        f.anim.play('ult', { hold: true });
        m.audio.play('rex.ult', f.pos);
        this.ultStartFx(f, m);
        this.act = 'ultRemote';
        this.actT = 0;
        this.actDur = 1.5;
        break;
      case 'note': {
        const target = e.t ? m.fighters.find((x) => x.id === e.t) ?? null : null;
        const i = this.noteIndex++;
        m.projectiles.spawn({ owner: f, kind: 'note', pos: p, vel: new THREE.Vector3(...(e.d ?? [0, 1, 0])).multiplyScalar(34), radius: 0.3, life: 3, slot: 'ult', part: 'note', color: i % 2 ? f.champ.colors[0] : f.champ.colors[1], color2: 0xffffff, homing: { target, strength: 7, delay: 0.22 }, visualOnly: true, sparks: false, fx: this.noteVisuals(m, i) });
        this.noteLaunchFx(f, m, p, i);
        break;
      }
      default:
        break;
    }
  }

  tickRemote(f: Fighter, dt: number, m?: MatchContext): void {
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
    if (!m) return;
    // a remote charge: the same orb, streaks and strain as the local one, from the start event
    if (this.remoteChargeT >= 0) {
      this.remoteChargeT += dt;
      this.chargeVisuals(f, m, this.remoteChargeT, dt);
    }
    if (this.act === 'ultRemote') this.ultTickFx(f, m, dt);
  }
}
