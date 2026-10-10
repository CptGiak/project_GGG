import * as THREE from 'three';
import type { AbilitySlot } from '../../../shared/champions';
import { BaseKit, type MeleeHit } from '../BaseKit';
import type { Fighter } from '../../game/Fighter';
import { forwardOf } from '../../game/Fighter';
import type { ActionEvent, Intent, MatchContext } from '../../game/types';
import { Marks, afterimage, enemiesInCone, smoke } from './lolShared';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const COMBO = ['c1', 'c2', 'c3'] as const;
const DUR: Record<string, number> = { c1: 0.3, c2: 0.3, c3: 0.4, fan: 0.46, air: 0.42 };
const FAN = { range: 12, half: 32, slowFrom: 7 };
const SHROUD = { radius: 5.2, time: 5 };
const DASH = { speed: 42, flipMax: 0.5, exec: 11 };

/**
 * AKALI — League of Legends port (True Damage).
 * Passive Assassin's Mark: kunai, shuriken and dashes mark enemies; the next blade hit on a
 * marked enemy deals bonus damage.
 * Skill (LMB, her Q): Five Point Strike (fan of 5 kunai, marks, slows at the tip) · Attack
 * (RMB): two kama slashes and a spin (air: rising slash) · Secondary (C, her W): Twilight
 * Shroud (smoke: invisible and faster inside) · F (her E): Shuriken Flip (back flip + shuriken;
 * F again within 3 s dashes onto the marked enemy) · R: Perfect Execution (dash, then within 5 s
 * a second dash that executes: more damage the more health is missing).
 */
export class AkaliKit extends BaseKit {
  private combo = 0;
  private comboTimer = 0;
  private queued = false;
  private readonly marks = new Marks();
  /** shuriken target for the recast dash */
  private flipTarget: { f: Fighter; until: number } | null = null;
  private execUntil = 0;
  private execReady = 0;
  private dashDir = new THREE.Vector3();
  private dashLen = 0;
  private dashTarget: Fighter | null = null;
  /** smoke cloud (owner and remote puppets) */
  private cloud: { at: THREE.Vector3; until: number } | null = null;
  private boost = 0;
  /** timed release of the current action (kunai, shuriken, smoke) already done */
  private fired = false;
  /** the running air slash got the airtime's lift (rises with low gravity) */
  private airHang = false;

  constructor() {
    super('akali');
  }

  protected startAction(f: Fighter, name: string, dur: number, faceYaw: number | null = null): void {
    super.startAction(f, name, dur, faceYaw);
    this.fired = false;
  }

  // -------------------------------------------------------------------------------------------
  // input
  // -------------------------------------------------------------------------------------------

  protected handleInput(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    this.comboTimer -= dt;
    if (this.comboTimer <= 0 && !this.act) this.combo = 0;
    if (this.boost > 0) {
      this.boost = Math.max(0, this.boost - dt);
      f.ctrl.speedMul *= 1 + 0.45 * Math.min(1, this.boost / 2);
    }
    if (this.act === 'exec' || this.act === 'flipDash') return;

    // ---- R: Perfect Execution ---------------------------------------------------------------
    if (it.ultimatePressed && (!this.act || this.act === 'fan' || this.act.startsWith('c'))) {
      if (this.execUntil > m.time && m.time >= this.execReady) {
        this.execUntil = 0;
        this.startExec(f, m, 2);
        return;
      }
      if (this.execUntil <= m.time && this.useUlt(f, m)) {
        this.execUntil = m.time + 5;
        this.execReady = m.time + 0.6;
        this.startExec(f, m, 1);
        return;
      }
    }
    // ---- F: Shuriken Flip / recast ------------------------------------------------------------
    if (it.abilityPressed && (!this.act || this.act.startsWith('c'))) {
      const t = this.flipTarget;
      if (t) {
        this.flipTarget = null;
        this.startFlipDash(f, m, t.f);
        return;
      }
      if (this.cd.abi <= 0) {
        this.shurikenFlip(f, m);
        return;
      }
    }
    // ---- C: Twilight Shroud ----------------------------------------------------------------------
    if (it.secondaryPressed && this.cd.sec <= 0 && (!this.act || this.act === 'fan' || this.act.startsWith('c'))) {
      this.cd.sec = this.data.abilities.sec.cooldown;
      if (this.act) this.endAction(f);
      this.startAction(f, 'shroud', 0.32);
      f.anim.play('shroud', { fadeIn: 0.02 });
      return;
    }
    // ---- LMB: Five Point Strike (cancels the recovery of a combo hit) -------------------------
    if ((!this.act || this.act.startsWith('c') || this.act === 'air') && this.skillReady()) {
      this.startFan(f, m);
      return;
    }
    // ---- RMB: kama combo ---------------------------------------------------------------------
    if (it.attackPressed) {
      if (this.act && this.actT > this.actDur * 0.4) this.queued = true;
      else if (!this.act) this.attack(f, m);
    }
    if (!this.act && this.queued) this.attack(f, m);
  }

  private attack(f: Fighter, m: MatchContext): void {
    this.queued = false;
    if (f.stealth > 0) f.reveal = 0.6;
    if (!f.grounded) {
      if (this.cd.atk > 0) return;
      this.startAction(f, 'air', DUR.air);
      f.anim.play('air', { fadeIn: 0.03 });
      const t = this.findTarget(f, m, 8, 45);
      // only the first air slash of a jump rises; mashing it can't keep her afloat
      this.airHang = this.takeAirLift();
      this.magnet(f, t, 12, 1.5, this.airHang);
      if (this.airHang) f.vel.y = Math.max(f.vel.y, 8.5);
      this.cd.atk = 0.45;
      m.broadcastAction(f, { a: 'air' });
      return;
    }
    const name = COMBO[this.combo % COMBO.length];
    this.combo++;
    this.comboTimer = 0.8;
    this.startAction(f, name, DUR[name]);
    f.anim.play(name, { fadeIn: 0.03 });
    this.magnet(f, this.findTarget(f, m, 7, 40), 10, 1.5);
    f.ctrl.lockMove = DUR[name] * 0.6;
    m.broadcastAction(f, { a: name });
  }

  /** Five Point Strike (LMB): the kunai leave a beat into the clip (see tickAction) */
  private startFan(f: Fighter, m: MatchContext): void {
    this.cd.sig = this.data.abilities.sig.cooldown;
    this.queued = false;
    if (f.stealth > 0) f.reveal = 0.6;
    if (this.act) this.endAction(f);
    this.startAction(f, 'fan', DUR.fan);
    f.anim.play('fan', { fadeIn: 0.03 });
    this.magnet(f, this.findTarget(f, m, FAN.range, 30), 4, 6);
    f.ctrl.lockMove = DUR.fan * 0.6;
    m.broadcastAction(f, { a: 'fan' });
  }

  /** Five Point Strike: instant cone, five visual kunai */
  private fan(f: Fighter, m: MatchContext): void {
    const origin = f.chest(new THREE.Vector3());
    const yaw = this.faceYaw ?? f.facing;
    const dir = forwardOf(yaw, new THREE.Vector3());
    this.kunaiFx(f, m, origin, dir);
    m.audio.play('swing', f.pos, 1);
    if (!m.isAuthority(f)) return;
    for (const { o, d } of enemiesInCone(f, m, origin, dir, FAN.range, FAN.half)) {
      const kb = _v.subVectors(o.pos, f.pos).setY(0).normalize().multiplyScalar(2.5).clone();
      m.reportHit(f, o, { slot: 'sig', part: 'q', at: o.chest(new THREE.Vector3()), kb, slow: d > FAN.slowFrom ? 1.2 : undefined, blockable: true });
      this.marks.add(o.id, m.time, 4);
    }
  }

  private kunaiFx(f: Fighter, m: MatchContext, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const [c0, c1] = f.champ.colors;
    for (let i = -2; i <= 2; i++) {
      const d = dir.clone().applyAxisAngle(UP, THREE.MathUtils.degToRad(i * 14)).normalize();
      m.projectiles.spawn({ owner: f, kind: 'blade', pos: origin.clone().addScaledVector(d, 0.4), vel: d.multiplyScalar(48), radius: 0.1, life: FAN.range / 48, slot: 'sig', part: 'q', color: c0, color2: c1, visualOnly: true, pierce: true });
    }
  }

  /** Twilight Shroud: smoke cloud, invisible inside, speed burst */
  private shroud(f: Fighter, m: MatchContext): void {
    const at = f.pos.clone();
    this.openCloud(f, m, at);
    this.boost = 2;
    m.broadcastAction(f, { a: 'shroud', p: [at.x, at.y, at.z] });
  }

  private openCloud(f: Fighter, m: MatchContext, at: THREE.Vector3): void {
    this.cloud = { at: at.clone(), until: m.time + SHROUD.time };
    f.stealth = SHROUD.time;
    f.stealthZone.copy(at);
    f.stealthRadius = SHROUD.radius;
    f.reveal = 0;
    m.vfx.ring(at.clone().setY(at.y + 0.08), UP, f.champ.colors[0], 0.6, SHROUD.radius, 0.5);
    m.vfx.ring(at.clone().setY(at.y + 0.08), UP, f.champ.colors[1], 0.4, SHROUD.radius * 0.8, 0.6);
    m.audio.play('dash', at, 0.9);
  }

  /** Shuriken Flip: back flip, shuriken along the aim */
  private shurikenFlip(f: Fighter, m: MatchContext): void {
    this.cd.abi = this.data.abilities.abi.cooldown;
    if (f.stealth > 0) f.reveal = 0.6;
    this.startAction(f, 'flip', 0.16);
    f.anim.play('flip', { fadeIn: 0.02 });
    forwardOf(f.aimYaw, _v);
    f.vel.set(-_v.x * 10, Math.max(f.vel.y, 6.5), -_v.z * 10);
    f.grounded = false;
    f.startFlip(2);
  }

  private throwShuriken(f: Fighter, m: MatchContext): void {
    const from = f.chest(new THREE.Vector3());
    const { point } = this.aimPoint(f, m, 34);
    const dir = point.sub(from).normalize();
    const [c0, c1] = f.champ.colors;
    m.projectiles.spawn({
      owner: f, kind: 'star', pos: from.clone().addScaledVector(dir, 0.5), vel: dir.clone().multiplyScalar(56), radius: 0.32, life: 0.58,
      slot: 'abi', part: 'flip1', color: c1, color2: c0, kb: 3,
      onHit: (t) => {
        this.flipTarget = { f: t, until: m.time + 3 };
        this.marks.add(t.id, m.time, 4);
      },
    });
    m.audio.play('swing', from, 0.9);
    // not 'flip': that event name is the movement flip, handled before the kit (OnlineSession)
    m.broadcastAction(f, { a: 'shuriken', p: [from.x, from.y, from.z], d: [dir.x, dir.y, dir.z] });
  }

  private startFlipDash(f: Fighter, m: MatchContext, t: Fighter): void {
    this.endAction(f);
    const from = f.chest(new THREE.Vector3());
    this.dashTarget = t;
    this.dashDir.subVectors(t.chest(_w), from).normalize();
    this.startAction(f, 'flipDash', DASH.flipMax, Math.atan2(this.dashDir.x, this.dashDir.z));
    f.anim.play('dash', { fadeIn: 0.02 });
    f.invuln = Math.max(f.invuln, DASH.flipMax);
    this.hitActive = { slot: 'abi', part: 'flip2', range: 1.9, arc: 180, height: 2.6, kb: 5, kbUp: 3, stun: 0.15 };
    this.setTrail(f, true);
    if (f.stealth > 0) f.reveal = 0.6;
    m.audio.play('dash', f.pos, 1);
    m.broadcastAction(f, { a: 'flipDash', p: [from.x, from.y, from.z], t: t.id });
  }

  /** Perfect Execution: dash 1 marks and wounds, dash 2 executes */
  private startExec(f: Fighter, m: MatchContext, n: 1 | 2): void {
    this.endAction(f);
    this.dashDir.copy(f.intent.aimDir);
    if (f.grounded && this.dashDir.y < 0.1) this.dashDir.y = 0;
    this.dashDir.normalize();
    this.dashLen = 0;
    this.dashTarget = null;
    this.startAction(f, 'exec', DASH.exec / DASH.speed + 0.12, Math.atan2(this.dashDir.x, this.dashDir.z));
    f.anim.play('exec', { fadeIn: 0.02 });
    f.invuln = Math.max(f.invuln, 0.45);
    this.hitActive = n === 1
      ? { slot: 'ult', part: 'ex1', range: 2.0, arc: 180, height: 2.6, kb: 4, kbUp: 2, stun: 0.2 }
      : { slot: 'ult', part: 'ex2', range: 2.0, arc: 180, height: 2.6, kb: 9, kbUp: 5, stun: 0.3, scaleFn: (t) => 0.3 + 0.7 * (1 - t.hp / t.maxHp) };
    this.setTrail(f, true);
    if (f.stealth > 0) f.reveal = 0.6;
    const from = f.chest(new THREE.Vector3());
    const to = from.clone().addScaledVector(this.dashDir, DASH.exec);
    afterimage(f, m, from, to, false);
    m.audio.play(n === 1 ? 'dash' : 'swingHeavy', f.pos, 1);
    if (n === 2) m.shake(0.25, f.pos);
    m.broadcastAction(f, { a: 'exec', n, p: [from.x, from.y, from.z], d: [to.x, to.y, to.z] });
  }

  // -------------------------------------------------------------------------------------------
  // per frame
  // -------------------------------------------------------------------------------------------

  protected tickAction(f: Fighter, _it: Intent, dt: number, m: MatchContext): void {
    // timed releases (kept off the anim events so they never depend on a clip)
    if (!this.fired) {
      if (this.act === 'fan' && this.actT >= 0.08) {
        this.fired = true;
        this.fan(f, m);
      } else if (this.act === 'flip' && this.actT >= 0.06) {
        this.fired = true;
        this.throwShuriken(f, m);
      } else if (this.act === 'shroud' && this.actT >= 0.1) {
        this.fired = true;
        this.shroud(f, m);
      }
    }
    if (this.act === 'air' && this.airHang) f.ctrl.gravityScale = 0.6;
    if (this.act === 'c3') this.spin = Math.min(1, this.actT / 0.3) * 360;
    if (this.act === 'flipDash') {
      f.ctrl.noHooks = true;
      f.ctrl.gravityScale = 0;
      const t = this.dashTarget;
      if (!t || !t.alive) {
        this.actT = this.actDur;
        return;
      }
      this.dashDir.subVectors(t.chest(_w), f.chest(_v));
      const d = this.dashDir.length();
      this.dashDir.divideScalar(d || 1);
      this.faceYaw = Math.atan2(this.dashDir.x, this.dashDir.z);
      if (d < 1.4) {
        f.vel.multiplyScalar(0.2);
        this.actT = Math.max(this.actT, this.actDur - 0.08);
      } else f.vel.copy(this.dashDir).multiplyScalar(DASH.speed);
    } else if (this.act === 'exec') {
      f.ctrl.noHooks = true;
      f.ctrl.gravityScale = 0;
      if (this.dashLen < DASH.exec) {
        f.vel.copy(this.dashDir).multiplyScalar(DASH.speed);
        this.dashLen += DASH.speed * dt;
        if (m.world.overlapsSphere(_v.copy(f.pos).setY(f.pos.y + 1).addScaledVector(this.dashDir, 0.9), 0.45)) this.dashLen = DASH.exec;
      } else {
        f.vel.multiplyScalar(Math.exp(-10 * dt));
        this.hitActive = null;
      }
    }
  }

  /** smoke, marks and recast windows: every frame (owner and remote puppets, alive or not) */
  tickWorld(f: Fighter, dt: number, m: MatchContext): void {
    if (this.flipTarget && (this.flipTarget.until <= m.time || !this.flipTarget.f.alive)) this.flipTarget = null;
    if (this.execUntil > 0 && this.execUntil <= m.time) this.execUntil = 0;
    if (this.cloud) {
      if (this.cloud.until <= m.time) this.cloud = null;
      else smoke(m, this.cloud.at, SHROUD.radius * 0.9, dt, f.champ.colors[0]);
    }
    this.marks.draw(m, dt, f.champ.colors[0]);
  }

  protected onSweepHit(f: Fighter, t: Fighter, h: MeleeHit, m: MatchContext): void {
    if (h.slot === 'atk') {
      // Assassin's Mark: the blade cashes the mark in
      if (this.marks.consume(t.id, m.time) > 0) {
        const at = t.chest(new THREE.Vector3());
        m.reportHit(f, t, { slot: 'atk', part: 'mark', at, blockable: false });
        m.vfx.ring(at, _v.subVectors(at, f.chest(_w)).normalize(), f.champ.colors[0], 0.2, 1.4, 0.3);
        m.vfx.hitSpark(at, _v, f.champ.colors[1], true);
      }
    } else this.marks.add(t.id, m.time, 4);
  }

  protected endAction(f: Fighter): void {
    if (this.act === 'flipDash' || this.act === 'exec') f.vel.multiplyScalar(0.35);
    this.dashTarget = null;
    super.endAction(f);
  }

  onAnimEvent(f: Fighter, ev: string, m: MatchContext): void {
    if (!this.act) return;
    if (ev === 'swing') {
      this.setTrail(f, true);
      m.audio.play('swing', f.pos, 0.8);
    } else if (ev === 'hitOn') {
      if (!['c1', 'c2', 'c3', 'air'].includes(this.act)) return;
      this.hitActive = {
        slot: 'atk',
        part: this.act,
        range: this.act === 'c3' ? 3.0 : 2.8,
        arc: this.act === 'c3' ? 180 : 70,
        kb: this.act === 'c3' ? 6 : 3,
        kbUp: this.act === 'air' ? 9 : this.act === 'c3' ? 3 : 1,
        stun: this.act === 'c3' ? 0.2 : 0.1,
      };
    } else if (ev === 'hitOff') {
      if (this.act === 'exec' || this.act === 'flipDash') return;
      this.hitActive = null;
      this.setTrail(f, false);
    }
  }

  cooldowns() {
    const c = super.cooldowns();
    if (this.flipTarget) c.abi = 0;
    return c;
  }

  hints() {
    const out: Partial<Record<AbilitySlot, string>> = {};
    if (this.flipTarget) out.abi = 'x2';
    if (this.execUntil > 0) out.ult = 'x2';
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // remote puppets
  // -------------------------------------------------------------------------------------------

  playRemote(f: Fighter, e: ActionEvent, m: MatchContext): void {
    switch (e.a) {
      case 'c1':
      case 'c2':
      case 'c3':
      case 'air':
      case 'fan':
        f.anim.play(e.a, { fadeIn: 0.03 });
        if (f.stealth > 0) f.reveal = 0.6;
        this.act = 'remote';
        this.actT = 0;
        this.actDur = DUR[e.a] ?? 0.4;
        if (e.a === 'fan') this.remoteFan = 0.08;
        break;
      case 'shroud':
        if (e.p) this.openCloud(f, m, new THREE.Vector3(...e.p));
        f.anim.play('shroud', { fadeIn: 0.02 });
        break;
      case 'shuriken':
        f.anim.play('flip', { fadeIn: 0.02 });
        f.startFlip(2);
        if (e.p && e.d) {
          const [c0, c1] = f.champ.colors;
          const from = new THREE.Vector3(...e.p);
          const dir = new THREE.Vector3(...e.d);
          m.projectiles.spawn({ owner: f, kind: 'star', pos: from, vel: dir.multiplyScalar(56), radius: 0.32, life: 0.58, slot: 'abi', part: 'flip1', color: c1, color2: c0, visualOnly: true });
        }
        break;
      case 'flipDash':
        f.anim.play('dash', { fadeIn: 0.02 });
        this.setTrail(f, true);
        this.act = 'remoteDash';
        this.actT = 0;
        this.actDur = 0.4;
        break;
      case 'exec':
        f.anim.play('exec', { fadeIn: 0.02 });
        if (e.p && e.d) afterimage(f, m, new THREE.Vector3(...e.p), new THREE.Vector3(...e.d), false);
        m.audio.play(e.n === 2 ? 'swingHeavy' : 'dash', f.pos, 1);
        this.setTrail(f, true);
        this.act = 'remoteDash';
        this.actT = 0;
        this.actDur = 0.4;
        break;
      default:
        break;
    }
  }

  private remoteFan = 0;

  tickRemote(f: Fighter, dt: number, m: MatchContext): void {
    if (this.remoteFan > 0) {
      this.remoteFan -= dt;
      if (this.remoteFan <= 0) this.kunaiFx(f, m, f.chest(new THREE.Vector3()), forwardOf(f.facing, new THREE.Vector3()));
    }
    if (!this.act) return;
    this.actT += dt;
    if (this.actT > this.actDur) this.endAction(f);
  }
}
