import * as THREE from 'three';
import type { AbilitySlot } from '../../../shared/champions';
import { BaseKit, type MeleeHit } from '../BaseKit';
import type { Fighter } from '../../game/Fighter';
import { forwardOf, rightOf, wrapAngle } from '../../game/Fighter';
import type { ActionEvent, HitInfo, Intent, MatchContext } from '../../game/types';
import { MASK_UPPER } from '../../fighter/Animator';
import { toon } from '../../render/toon';
import { Shape } from '../../vfx/Particles';
import { CAPSULE_R, capsule, segSegDist2 } from '../Projectiles';
import { Marks, foe, slashArc } from './lolShared';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const VIOLET = 0xa24cff;
const CRIMSON = 0xff2e6a;
const BLOOD = 0xd0103a;

const COMBO = ['c1', 'c2', 'c3'] as const;
const DUR: Record<string, number> = { c1: 0.3, c2: 0.3, c3: 0.48, air: 0.42, swarm: 0.46, bite: 0.72, unbat: 0.3, ultEnd: 0.5 };
/** Spellvamp: lunge onto the aimed enemy, latch on, bite, drink (half the damage comes back as health) */
const BITE = { range: 10, batRange: 13, cone: 30, speed: 34, lunge: 0.42, whiff: 0.3, whiffSpeed: 24, reach: 1.35, latch: 0.44, stun: 0.6, vamp: 0.5 };
/** Forma di Pipistrello: free flight where she aims, tiny hitbox, i-frames as she bursts into a bat */
const BAT = { time: 3, speed: 17, accel: 6, iframes: 0.45, pop: 4 };
/** Sciame di Pipistrelli */
const SWARM = { count: 6, speed: 25, life: 1.6, homing: 3.4, spread: 0.3, range: 40, slow: 0.5 };
/** Notte Eterna: a vortex of bats around her, then they all dive on whoever is inside */
const STORM = { time: 3, radius: 7, height: 3.6, tick: 0.25, slow: 0.6, rise: 1.4, vamp: 0.3, bats: 56 };
/** Marchio di Sangue: claws and bats stack it, Spellvamp cashes it in */
const MARK = { time: 5, max: 3 };
/** the server takes one heal every 3 s (max 220): a heal inside the gap waits its turn */
const HEAL = { gap: 3.1, max: 220 };

/**
 * ELISABBAT — vampire princess.
 * Passive Marchio di Sangue: claw hits and bat bites stack Blood Marks (3 max, 5 s).
 * Skill (LMB): Spellvamp (lunge onto the aimed enemy, latch on and bite: a short stun, damage
 * plus 35 per Blood Mark consumed, half of it healed back; from the bat form it is a swooping
 * bite) · Attack (RMB): Velvet Claws (three-hit combo, the third an X slash; air: diving claws)
 * · Secondary (C): Bat Form (3 s of free flight as a small bat: tiny hitbox, i-frames on the
 * transformation; C again, or any attack, turns her back) · F: Bat Swarm (six homing bats that
 * mark and slow) · R: Eternal Night (rises on spectral wings while a vortex of bats shreds and
 * slows everyone around her for 3 s, then the bats dive on them; heals 30% of it).
 */
export class ElisabbatKit extends BaseKit {
  private combo = 0;
  private comboTimer = 0;
  private queued = false;
  /** timed release of the current action already done (bite, swarm, finale) */
  private fired = false;
  private airHang = false;
  private readonly marks = new Marks();
  /** Spellvamp: the victim, the direction she bites along, the marks the bite consumed */
  private prey: Fighter | null = null;
  private preyDir = new THREE.Vector3(0, 0, 1);
  private feast = 0;
  private biteDealt = 0;
  /** bat form (owner and remote puppets) */
  private morphed = false;
  private batT = 0;
  private batObj: THREE.Object3D | null = null;
  private lastFacing = 0;
  private batTrail = 0;
  /** Eternal Night (owner and remote puppets) */
  private stormT = 0;
  private stormTick = 0;
  private stormPool = 0;
  private stormRing = 0;
  private stormAge = 0;
  /** heals waiting for the server's 3 s window */
  private healPool = 0;
  private lastHealAt = -10;
  private match: MatchContext | null = null;
  private readonly vortex: THREE.InstancedMesh;
  private readonly seeds: Array<{ a: number; r: number; h: number; w: number; ph: number }> = [];
  readonly sceneObjects: THREE.Object3D[];

  constructor() {
    super('elisabbat');
    this.vortex = new THREE.InstancedMesh(vortexBatGeometry(), toon({ color: 0x2a1238, shade: 0xc0a0ff, side: THREE.DoubleSide, rim: 0.9, rimCut: 0.5 }), STORM.bats);
    this.vortex.frustumCulled = false;
    this.vortex.visible = false;
    this.vortex.name = 'elisabbatVortex';
    for (let i = 0; i < STORM.bats; i++) {
      const k = i / STORM.bats;
      this.seeds.push({
        a: k * Math.PI * 2 * 3.7,
        r: 1.4 + Math.pow((i * 0.618) % 1, 0.7) * (STORM.radius - 1.6),
        h: 0.25 + ((i * 0.37) % 1) * STORM.height,
        w: (2.4 + ((i * 0.53) % 1) * 2.2) * (i % 5 === 0 ? -1 : 1),
        ph: i * 1.7,
      });
    }
    this.sceneObjects = [this.vortex];
  }

  update(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    this.match = m;
    super.update(f, it, dt, m);
    this.flushHeal(f, m);
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

    // ---- bat form: C again turns her back; an attack turns her back into that attack ---------
    if (this.act === 'bat') {
      if (it.secondaryPressed && this.actT > 0.15) {
        this.leaveBat(f, m, true);
        return;
      }
      if (it.ultimatePressed && f.ult >= 1) this.leaveBat(f, m, false);
      else if (it.skillPressed && this.cd.sig <= 0) {
        this.leaveBat(f, m, false);
        this.spellvamp(f, m, true);
        return;
      } else if (it.abilityPressed && this.cd.abi <= 0) {
        this.leaveBat(f, m, false);
        this.startSwarm(f, m);
        return;
      } else if (it.attackPressed) {
        this.leaveBat(f, m, false);
        this.attack(f, m);
        return;
      } else return;
    }
    if (this.act === 'lunge' || this.act === 'bite' || this.act === 'ult' || this.act === 'ultEnd') return;
    const free = !this.act || this.act.startsWith('c') || this.act === 'air' || this.act === 'unbat';

    // ---- R: Notte Eterna ----------------------------------------------------------------------
    if (it.ultimatePressed && free && this.useUlt(f, m)) {
      this.startStorm(f, m);
      return;
    }
    // ---- C: Forma di Pipistrello ------------------------------------------------------------
    if (it.secondaryPressed && this.cd.sec <= 0 && (free || this.act === 'swarm')) {
      this.enterBat(f, m);
      return;
    }
    // ---- F: Sciame di Pipistrelli -----------------------------------------------------------
    if (it.abilityPressed && this.cd.abi <= 0 && free) {
      this.startSwarm(f, m);
      return;
    }
    // ---- LMB: Spellvamp (cancels the recovery of a claw hit) ------------------------------------
    if (free && this.skillReady()) {
      this.spellvamp(f, m, false);
      return;
    }
    // ---- RMB: Velvet Claws ----------------------------------------------------------------------
    if (it.attackPressed) {
      if (this.act && this.act !== 'unbat' && this.actT > this.actDur * 0.4) this.queued = true;
      else if (!this.act || this.act === 'unbat') this.attack(f, m);
    }
    if (!this.act && this.queued) this.attack(f, m);
  }

  private attack(f: Fighter, m: MatchContext): void {
    this.queued = false;
    if (this.act) this.endAction(f);
    if (!f.grounded) {
      if (this.cd.atk > 0) return;
      this.startAction(f, 'air', DUR.air);
      f.anim.play('air', { fadeIn: 0.03 });
      // only the first air attack of a jump hangs; mashing it can't keep her afloat
      this.airHang = this.takeAirLift();
      this.magnet(f, this.findTarget(f, m, 8, 45), 13, 1.4, this.airHang);
      if (this.airHang) f.vel.y = Math.max(f.vel.y, 7.5);
      this.cd.atk = 0.42;
      m.broadcastAction(f, { a: 'air' });
      return;
    }
    const name = COMBO[this.combo % 3];
    this.combo++;
    this.comboTimer = 0.8;
    this.startAction(f, name, DUR[name]);
    f.anim.play(name, { fadeIn: 0.03 });
    this.magnet(f, this.findTarget(f, m, 7, 40), name === 'c3' ? 12 : 10, 1.4);
    if (name === 'c3') {
      // the finisher hops: it spends the air lift so mashing on into air claws can't climb
      f.vel.y = Math.max(f.vel.y, 3.5);
      this.airLift = false;
    }
    f.ctrl.lockMove = DUR[name] * 0.6;
    m.broadcastAction(f, { a: name });
  }

  // -------------------------------------------------------------------------------------------
  // Spellvamp
  // -------------------------------------------------------------------------------------------

  private spellvamp(f: Fighter, m: MatchContext, fromBat: boolean): void {
    this.cd.sig = this.data.abilities.sig.cooldown;
    this.skillBuf = 0;
    if (this.act) this.endAction(f);
    const t = this.findTarget(f, m, fromBat ? BITE.batRange : BITE.range, BITE.cone);
    this.prey = t;
    forwardOf(f.aimYaw, this.preyDir);
    this.startAction(f, 'lunge', t ? BITE.lunge : BITE.whiff);
    f.anim.play('lunge', { fadeIn: 0.04, hold: true });
    this.setTrail(f, true);
    f.hooks.forEach((h) => {
      if (h.state !== 'idle') h.state = 'retract';
    });
    m.audio.play('dash', f.pos, 0.8);
    m.audio.play('hiss', f.pos, 0.7);
    m.broadcastAction(f, { a: 'lunge', t: t?.id });
  }

  /** first enemy whose body is within `r` of her chest */
  private touching(f: Fighter, m: MatchContext, r: number): Fighter | null {
    f.chest(_a);
    for (const o of m.fighters) {
      if (!foe(f, o)) continue;
      capsule(o, _c1, _c2);
      if (segSegDist2(_a, _a, _c1, _c2, _v, _w) < (CAPSULE_R + r) ** 2) return o;
    }
    return null;
  }

  private latch(f: Fighter, m: MatchContext, t: Fighter): void {
    this.prey = t;
    this.feast = 0;
    this.biteDealt = 0;
    this.preyDir.subVectors(t.pos, f.pos).setY(0);
    if (this.preyDir.lengthSq() < 1e-6) forwardOf(f.facing, this.preyDir);
    this.preyDir.normalize();
    // dodged through i-frames or caught on a raised guard: the jaws snap shut on nothing
    _v.subVectors(f.pos, t.pos).setY(0).normalize();
    const guarded = t.guard && Math.sin(t.facing) * _v.x + Math.cos(t.facing) * _v.z > 0.2;
    if (t.invuln > 0 || guarded) {
      m.reportHit(f, t, { slot: 'sig', part: 'bite', at: this.neck(t, new THREE.Vector3()), blockable: true });
      this.prey = null;
      this.endAction(f);
      f.vel.multiplyScalar(0.3);
      m.audio.play('block', f.pos, 0.5);
      return;
    }
    this.startAction(f, 'bite', DUR.bite, Math.atan2(this.preyDir.x, this.preyDir.z));
    f.anim.play('bite', { fadeIn: 0.03 });
    f.vel.copy(t.vel);
    m.broadcastAction(f, { a: 'bite', t: t.id });
  }

  private neck(t: Fighter, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(t.pos).setY(t.pos.y + (t.tiny ? 1.0 : 1.48));
  }

  private sinkFangs(f: Fighter, m: MatchContext, t: Fighter): void {
    const at = this.neck(t, new THREE.Vector3());
    const info: HitInfo = { slot: 'sig', part: 'bite', at, stun: BITE.stun, blockable: true };
    m.reportHit(f, t, info);
    this.biteDealt = this.data.abilities.sig.damage.bite * (info.crit ? 1.5 : 1);
    this.feast = this.marks.consume(t.id, m.time);
    this.bloodBurst(m, at, 1);
    m.audio.play('bite', at, 1);
    m.shake(0.2, at);
  }

  private releaseBite(f: Fighter, m: MatchContext): void {
    const t = this.prey;
    this.prey = null;
    if (t && t.alive && this.feast > 0) {
      const at = this.neck(t, new THREE.Vector3());
      const info: HitInfo = { slot: 'sig', part: 'feast', scale: this.feast / MARK.max, at, blockable: false, kb: this.preyDir.clone().multiplyScalar(5).setY(3) };
      m.reportHit(f, t, info);
      this.biteDealt += this.data.abilities.sig.damage.feast * (this.feast / MARK.max) * (info.crit ? 1.5 : 1);
      this.bloodBurst(m, at, 1.5);
    }
    if (this.biteDealt > 0) {
      this.queueHeal(f, m, this.biteDealt * BITE.vamp);
      m.vfx.ring(f.chest(new THREE.Vector3()), UP, CRIMSON, 0.2, 1.6, 0.4);
      m.audio.play('drink', f.pos, 0.9);
    }
    this.biteDealt = 0;
    this.feast = 0;
    // push off the victim with a little hop
    f.vel.copy(this.preyDir).multiplyScalar(-6);
    f.vel.y = 4.5;
    f.grounded = false;
  }

  /** crimson droplets flying off the bite */
  private bloodBurst(m: MatchContext, at: THREE.Vector3, k: number): void {
    for (let i = 0; i < 14 * k; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      m.vfx.add.emit({ pos: at.clone(), vel: d.multiplyScalar(3 + Math.random() * 5), life: 0.35 + Math.random() * 0.2, size: 0.07, size1: 0.02, color: i % 3 ? BLOOD : CRIMSON, shape: Shape.glow, gravity: 12, drag: 1.5 });
    }
    m.vfx.hitSpark(at, UP, CRIMSON, true);
  }

  /** the life she drinks: a stream of crimson motes from the victim's neck to her mouth */
  private drainFx(f: Fighter, t: Fighter, m: MatchContext, dt: number): void {
    const from = this.neck(t, _a);
    const to = _b.copy(f.pos).setY(f.pos.y + 1.5);
    const n = Math.ceil(dt * 70);
    for (let i = 0; i < n; i++) {
      const p = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3));
      const vel = to.clone().sub(p).multiplyScalar(3.4);
      m.vfx.add.emit({ pos: p, vel, life: 0.28, size: 0.09, size1: 0.03, color: i % 2 ? CRIMSON : 0xff8fb4, shape: Shape.glow, alpha: 0.9 });
    }
  }

  // -------------------------------------------------------------------------------------------
  // bat form
  // -------------------------------------------------------------------------------------------

  private enterBat(f: Fighter, m: MatchContext): void {
    this.cd.sec = this.data.abilities.sec.cooldown;
    if (this.act) this.endAction(f);
    this.startAction(f, 'bat', BAT.time + 5);
    this.batT = BAT.time;
    f.invuln = Math.max(f.invuln, BAT.iframes);
    f.vel.y = Math.max(f.vel.y, BAT.pop);
    f.grounded = false;
    f.hooks.forEach((h) => {
      if (h.state !== 'idle') h.state = 'retract';
    });
    f.anim.action.stop(0);
    this.morph(f, m, true);
    m.broadcastAction(f, { a: 'bat' });
  }

  private leaveBat(f: Fighter, m: MatchContext, anim: boolean): void {
    if (!this.morphed) return;
    this.morph(f, m, false);
    this.act = null;
    this.hitActive = null;
    this.faceYaw = null;
    f.vel.multiplyScalar(0.6);
    if (anim) {
      this.startAction(f, 'unbat', DUR.unbat);
      f.anim.play('unbat', { fadeIn: 0 });
    }
    m.broadcastAction(f, { a: 'unbat' });
  }

  /** swaps the body for the bat (both sides of the network) */
  private morph(f: Fighter, m: MatchContext | null, on: boolean): void {
    if (on === this.morphed) return;
    this.morphed = on;
    f.tiny = on;
    f.visual.pivot.visible = !on;
    this.batObj ??= f.visual.root.getObjectByName('batForm') ?? null;
    if (this.batObj) {
      this.batObj.visible = on;
      this.batObj.rotation.set(0, 0, 0);
    }
    this.lastFacing = f.facing;
    // the cloth catches up with the body cleanly instead of stretching from where it was
    if (!on) for (const c of f.visual.cloth) c.reset();
    if (m) this.poof(f, m);
  }

  /** the burst into (or out of) the bat: violet smoke and a handful of bats scattering */
  private poof(f: Fighter, m: MatchContext): void {
    const c = f.pos.clone().setY(f.pos.y + 1.0);
    for (let i = 0; i < 12; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 - 0.2, Math.random() - 0.5).normalize();
      m.vfx.alpha.emit({ pos: c.clone().addScaledVector(d, 0.35), vel: d.clone().multiplyScalar(2 + Math.random() * 2), life: 0.45 + Math.random() * 0.25, size: 0.22, size1: 0.55, color: 0x2a1438, color1: VIOLET, alpha: 0.45, shape: Shape.puff, drag: 3 });
    }
    for (let i = 0; i < 5; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5).normalize();
      m.projectiles.spawn({ owner: f, kind: 'bat', pos: c.clone(), vel: d.multiplyScalar(7 + Math.random() * 4), radius: 0.05, life: 0.45 + Math.random() * 0.2, slot: 'sec', part: 'none', color: VIOLET, color2: CRIMSON, visualOnly: true, pierce: true, scale: 0.7 });
    }
    m.vfx.ring(c, UP, VIOLET, 0.2, 1.4, 0.3);
    m.audio.play('batPoof', c, 1);
  }

  /** free flight toward where she aims (W/S along the camera, A/D sideways, SPACE up) */
  private fly(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    f.ctrl.gravityScale = 0;
    f.ctrl.noHooks = true;
    f.ctrl.noDash = true;
    // SPACE climbs instead of jumping
    it.jumpPressed = false;
    this.batT -= dt;
    if (this.batT <= 0) {
      this.leaveBat(f, m, true);
      return;
    }
    _v.copy(it.aimDir).multiplyScalar(it.move.y);
    _v.addScaledVector(rightOf(f.aimYaw, _w), it.move.x);
    if (it.jump) _v.y += 1;
    if (_v.lengthSq() > 1) _v.normalize();
    _v.multiplyScalar(BAT.speed * (f.slow > 0 ? 0.6 : 1));
    f.vel.lerp(_v, 1 - Math.exp(-BAT.accel * dt));
    // skim the floor instead of walking on it
    if (f.grounded && f.vel.y < 1) f.vel.y = 1;
    const hs = Math.hypot(f.vel.x, f.vel.z);
    this.faceYaw = hs > 1.5 ? Math.atan2(f.vel.x, f.vel.z) : f.aimYaw;
  }

  // -------------------------------------------------------------------------------------------
  // bat swarm
  // -------------------------------------------------------------------------------------------

  private startSwarm(f: Fighter, m: MatchContext): void {
    this.cd.abi = this.data.abilities.abi.cooldown;
    if (this.act) this.endAction(f);
    this.startAction(f, 'swarm', DUR.swarm, f.aimYaw);
    f.anim.play('swarm', { fadeIn: 0.03, mask: f.grounded ? undefined : MASK_UPPER });
    m.audio.play('bats', f.pos, 0.9);
  }

  private releaseSwarm(f: Fighter, m: MatchContext): void {
    forwardOf(f.aimYaw, _v);
    const from = f.chest(new THREE.Vector3()).addScaledVector(UP, 0.1).addScaledVector(_v, 0.35);
    const { point, fighter } = this.aimPoint(f, m, SWARM.range);
    const dir = point.clone().sub(from).normalize();
    const target = fighter ?? this.findTarget(f, m, SWARM.range, 22);
    this.spawnSwarm(f, m, from, dir, target, false);
    m.broadcastAction(f, { a: 'swarm', p: [from.x, from.y, from.z], d: [dir.x, dir.y, dir.z], t: target?.id });
  }

  private spawnSwarm(f: Fighter, m: MatchContext, from: THREE.Vector3, dir: THREE.Vector3, target: Fighter | null, visualOnly: boolean): void {
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    for (let i = 0; i < SWARM.count; i++) {
      const k = (i / (SWARM.count - 1)) * 2 - 1;
      const d = dir.clone().addScaledVector(side, k * SWARM.spread).addScaledVector(UP, (i % 2 ? 0.12 : -0.04) + (i * 0.37) % 0.08).normalize();
      m.projectiles.spawn({
        owner: f,
        kind: 'bat',
        pos: from.clone().addScaledVector(side, k * 0.3),
        vel: d.multiplyScalar(SWARM.speed * (0.92 + ((i * 0.29) % 0.16))),
        radius: 0.3,
        life: SWARM.life,
        slot: 'abi',
        part: 'bat',
        color: VIOLET,
        color2: CRIMSON,
        homing: { target, strength: SWARM.homing, delay: 0.1 + i * 0.025 },
        slow: SWARM.slow,
        kb: 2,
        visualOnly,
        onHit: visualOnly ? undefined : (t) => this.marks.add(t.id, m.time, MARK.time, 1, MARK.max),
      });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Eternal Night
  // -------------------------------------------------------------------------------------------

  private startStorm(f: Fighter, m: MatchContext): void {
    if (this.act) this.endAction(f);
    this.startAction(f, 'ult', STORM.time + 1);
    this.stormPool = 0;
    this.stormTick = 0.12;
    f.anim.play('ult', { fadeIn: 0.08, hold: true });
    f.hooks.forEach((h) => {
      if (h.state !== 'idle') h.state = 'retract';
    });
    this.openStorm(f, m);
    m.broadcastAction(f, { a: 'ult' });
  }

  /** wings, vortex and the opening burst (owner and remote copies) */
  private openStorm(f: Fighter, m: MatchContext): void {
    this.stormT = STORM.time;
    this.stormAge = 0;
    this.setWings(f, true);
    const c = f.pos.clone().setY(f.pos.y + 1.2);
    m.vfx.shockwave(f.pos.clone().setY(f.pos.y + 0.1), STORM.radius, VIOLET);
    m.vfx.ring(c, UP, CRIMSON, 0.4, STORM.radius, 0.6);
    m.audio.play('ult', c, 1);
    m.audio.play('storm', c, 1);
    m.shake(0.3, c);
  }

  private setWings(f: Fighter, on: boolean): void {
    const w = f.visual.root.getObjectByName('ultWings');
    if (w) w.visible = on;
  }

  /** one tick of the vortex: everyone inside is cut and slowed */
  private stormPulse(f: Fighter, m: MatchContext): void {
    if (!m.isAuthority(f)) return;
    const c = _p.copy(f.pos).setY(f.pos.y + 1);
    for (const o of m.fighters) {
      if (!foe(f, o)) continue;
      const oc = o.chest(new THREE.Vector3());
      if (Math.abs(oc.y - c.y) > STORM.height || Math.hypot(oc.x - c.x, oc.z - c.z) > STORM.radius + 0.4) continue;
      const info: HitInfo = { slot: 'ult', part: 'storm', slow: STORM.slow, at: oc, blockable: false };
      m.reportHit(f, o, info);
      this.stormPool += this.data.abilities.ult.damage.storm * (info.crit ? 1.5 : 1);
      if (Math.random() < 0.5) m.vfx.hitSpark(oc, UP, CRIMSON, false);
    }
  }

  private startFinale(f: Fighter, m: MatchContext): void {
    this.endAction(f);
    this.startAction(f, 'ultEnd', DUR.ultEnd, f.aimYaw);
    f.anim.play('ultEnd', { fadeIn: 0.03 });
    m.broadcastAction(f, { a: 'ultEnd' });
  }

  /** the bats dive on everyone in the vortex; she drinks 30% of the night's damage */
  private finale(f: Fighter, m: MatchContext, owner: boolean): void {
    this.stormT = 0;
    this.setWings(f, false);
    const c = f.pos.clone().setY(f.pos.y + 1);
    m.vfx.explosion(c, 2.6, VIOLET, CRIMSON);
    m.vfx.shockwave(f.pos.clone().setY(f.pos.y + 0.1), STORM.radius, CRIMSON);
    m.audio.play('explosion', c, 0.9);
    m.audio.play('bats', c, 1);
    for (const o of m.fighters) {
      if (!foe(f, o)) continue;
      const oc = o.chest(new THREE.Vector3());
      if (Math.abs(oc.y - c.y) > STORM.height || Math.hypot(oc.x - c.x, oc.z - c.z) > STORM.radius + 0.6) continue;
      // a burst of bats converging on each victim
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        const from = oc.clone().add(new THREE.Vector3(Math.cos(a) * 2.5, 1 + Math.random(), Math.sin(a) * 2.5));
        m.projectiles.spawn({ owner: f, kind: 'bat', pos: from, vel: oc.clone().sub(from).normalize().multiplyScalar(18), radius: 0.05, life: 0.16, slot: 'ult', part: 'none', color: VIOLET, color2: CRIMSON, visualOnly: true, pierce: true, scale: 0.8 });
      }
      this.bloodBurst(m, oc, 0.8);
      if (!owner || !m.isAuthority(f)) continue;
      const kb = new THREE.Vector3().subVectors(o.pos, f.pos).setY(0).normalize().multiplyScalar(9);
      kb.y = 6;
      const info: HitInfo = { slot: 'ult', part: 'finale', at: oc, kb, blockable: false };
      m.reportHit(f, o, info);
      this.stormPool += this.data.abilities.ult.damage.finale * (info.crit ? 1.5 : 1);
    }
    if (owner && this.stormPool > 0) this.queueHeal(f, m, this.stormPool * STORM.vamp);
    this.stormPool = 0;
  }

  // -------------------------------------------------------------------------------------------
  // heals
  // -------------------------------------------------------------------------------------------

  private queueHeal(f: Fighter, m: MatchContext, amount: number): void {
    this.healPool = Math.min(HEAL.max, this.healPool + amount);
    this.flushHeal(f, m);
  }

  private flushHeal(f: Fighter, m: MatchContext): void {
    if (this.healPool < 1 || !f.alive || m.time - this.lastHealAt < HEAL.gap) return;
    const amt = Math.round(this.healPool);
    this.healPool = 0;
    this.lastHealAt = m.time;
    m.reportHeal(f, amt);
    const c = f.chest(new THREE.Vector3());
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      m.vfx.add.emit({ pos: c.clone().add(new THREE.Vector3(Math.cos(a) * 0.6, -0.6, Math.sin(a) * 0.6)), vel: new THREE.Vector3(-Math.cos(a) * 0.8, 2.2, -Math.sin(a) * 0.8), life: 0.6, size: 0.1, size1: 0.02, color: i % 2 ? CRIMSON : 0xff9ac0, shape: Shape.glow });
    }
  }

  // -------------------------------------------------------------------------------------------
  // per frame (owner)
  // -------------------------------------------------------------------------------------------

  protected tickAction(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    const a = this.act;
    if (a === 'air' && this.airHang) f.ctrl.gravityScale = 0.6;
    else if (a === 'c3') this.spin = Math.min(1, this.actT / 0.2) * 360;
    else if (a === 'bat') this.fly(f, it, dt, m);
    else if (a === 'lunge') {
      f.ctrl.noHooks = true;
      f.ctrl.noDash = true;
      f.ctrl.gravityScale = 0.15;
      const t = this.prey;
      if (t) {
        if (!t.alive) {
          this.prey = null;
          this.endAction(f);
          return;
        }
        _v.subVectors(t.chest(_a), f.chest(_w));
        const d = _v.length();
        _v.divideScalar(d || 1);
        this.faceYaw = Math.atan2(_v.x, _v.z);
        if (d <= BITE.reach) {
          this.latch(f, m, t);
          return;
        }
        f.vel.copy(_v).multiplyScalar(BITE.speed);
      } else {
        // nobody in reach: a short pounce, biting whoever it meets
        f.vel.x = this.preyDir.x * BITE.whiffSpeed;
        f.vel.z = this.preyDir.z * BITE.whiffSpeed;
        this.faceYaw = Math.atan2(this.preyDir.x, this.preyDir.z);
        const hit = this.touching(f, m, 0.9);
        if (hit) this.latch(f, m, hit);
      }
    } else if (a === 'bite') {
      f.ctrl.noHooks = true;
      f.ctrl.noDash = true;
      const t = this.prey;
      if (this.actT < BITE.latch && t) {
        f.ctrl.gravityScale = 0;
        f.ctrl.lockMove = 0.1;
        if (!t.alive) {
          this.releaseBite(f, m);
          return;
        }
        // cling to the victim
        _v.copy(t.pos).addScaledVector(this.preyDir, -0.78);
        f.pos.lerp(_v, 1 - Math.exp(-dt * 30));
        f.vel.copy(t.vel);
        this.faceYaw = Math.atan2(this.preyDir.x, this.preyDir.z);
        if (!this.fired && this.actT >= 0.06) {
          this.fired = true;
          this.sinkFangs(f, m, t);
        }
        if (this.fired) this.drainFx(f, t, m, dt);
      } else if (t) this.releaseBite(f, m);
    } else if (a === 'swarm') {
      if (!this.fired && this.actT >= 0.15) {
        this.fired = true;
        this.releaseSwarm(f, m);
      }
    } else if (a === 'ult') {
      f.ctrl.noHooks = true;
      f.ctrl.noDash = true;
      f.ctrl.gravityScale = 0;
      // rise on the wings, then hover and drift slowly
      const vy = this.actT < 0.45 ? STORM.rise / 0.45 : 0;
      f.vel.y += (vy - f.vel.y) * (1 - Math.exp(-10 * dt));
      const k = Math.exp(-3 * dt);
      f.vel.x *= k;
      f.vel.z *= k;
      this.stormTick -= dt;
      if (this.stormTick <= 0) {
        this.stormTick += STORM.tick;
        this.stormPulse(f, m);
      }
      if (this.actT >= STORM.time) this.startFinale(f, m);
    } else if (a === 'ultEnd') {
      f.ctrl.gravityScale = 0.4;
      if (!this.fired && this.actT >= 0.12) {
        this.fired = true;
        this.finale(f, m, true);
      }
    }
  }

  protected onSweepHit(f: Fighter, t: Fighter, _h: MeleeHit, m: MatchContext): void {
    this.marks.add(t.id, m.time, MARK.time, 1, MARK.max);
    const at = t.chest(new THREE.Vector3());
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.5, Math.random() - 0.5).normalize();
      m.vfx.add.emit({ pos: at.clone(), vel: d.multiplyScalar(4 + Math.random() * 3), life: 0.3, size: 0.06, color: BLOOD, shape: Shape.glow, gravity: 10 });
    }
  }

  protected endAction(f: Fighter): void {
    const a = this.act;
    if (a === 'bat' && this.morphed) {
      // stunned / killed out of the bat form
      this.morph(f, this.match, false);
      this.match?.broadcastAction(f, { a: 'unbat' });
    } else if (a === 'lunge') {
      f.vel.multiplyScalar(0.35);
      if (f.anim.action.name === 'lunge') f.anim.action.stop(0.1);
    } else if (a === 'ult') {
      this.stormT = 0;
      this.setWings(f, false);
    }
    super.endAction(f);
  }

  onAnimEvent(f: Fighter, ev: string, m: MatchContext): void {
    if (!this.act) return;
    if (ev === 'swing') {
      this.setTrail(f, true);
      m.audio.play(this.act === 'c3' ? 'swingHeavy' : 'swing', f.pos, 0.8);
      m.audio.play('claw', f.pos, 0.6);
    } else if (ev === 'hitOn') {
      if (this.act !== 'c1' && this.act !== 'c2' && this.act !== 'c3' && this.act !== 'air') return;
      const c3 = this.act === 'c3';
      this.hitActive = {
        slot: 'atk',
        part: this.act,
        range: c3 ? 3.1 : 2.8,
        arc: c3 ? 110 : this.act === 'air' ? 80 : 70,
        kb: c3 ? 7 : 3,
        kbUp: this.act === 'air' ? 8 : c3 ? 4 : 1,
        stun: c3 ? 0.3 : 0.1,
      };
      if (c3) {
        forwardOf(f.facing, _v);
        const at = f.chest(new THREE.Vector3()).addScaledVector(_v, 1.2);
        slashArc(m, at, _v, 1.4, VIOLET, CRIMSON);
      }
    } else if (ev === 'hitOff') {
      this.hitActive = null;
      this.setTrail(f, false);
    }
  }

  cooldowns() {
    const c = super.cooldowns();
    // in bat form C turns her back: the card reads ready
    if (this.act === 'bat') c.sec = 0;
    return c;
  }

  hints() {
    const out: Partial<Record<AbilitySlot, string>> = {};
    if (this.act === 'bat') out.sec = 'UMANA';
    if (this.stormT > 0) out.ult = 'NOTTE';
    return out;
  }

  cancel(f: Fighter): void {
    super.cancel(f);
    this.queued = false;
    this.prey = null;
    this.feast = 0;
    this.biteDealt = 0;
    this.stormT = 0;
    this.setWings(f, false);
    if (this.morphed) this.morph(f, null, false);
  }

  // -------------------------------------------------------------------------------------------
  // effects that outlive the actions (every fighter, owner or remote)
  // -------------------------------------------------------------------------------------------

  tickWorld(f: Fighter, dt: number, m: MatchContext): void {
    this.marks.draw(m, dt, CRIMSON, 0.9);
    // the bat: pitch with the climb, bank into the turns, a faint violet trail
    if (this.morphed && this.batObj) {
      const spd = f.vel.length();
      const pitch = spd > 1 ? THREE.MathUtils.clamp(-f.vel.y / Math.max(spd, 6), -0.9, 0.9) * 0.7 : 0;
      this.batObj.rotation.x += (pitch - this.batObj.rotation.x) * (1 - Math.exp(-8 * dt));
      const turn = wrapAngle(f.facing - this.lastFacing) / Math.max(dt, 1e-4);
      this.lastFacing = f.facing;
      const bank = THREE.MathUtils.clamp(-turn * 0.12, -0.8, 0.8);
      this.batObj.rotation.z += (bank - this.batObj.rotation.z) * (1 - Math.exp(-6 * dt));
      this.batTrail -= dt;
      if (this.batTrail <= 0 && f.alive) {
        this.batTrail = 0.03;
        m.vfx.add.emit({ pos: f.pos.clone().setY(f.pos.y + 1.0).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.3)), vel: f.vel.clone().multiplyScalar(-0.1), life: 0.4, size: 0.09, size1: 0.01, color: Math.random() < 0.5 ? VIOLET : CRIMSON, shape: Shape.star, alpha: 0.8 });
      }
    }
    // the vortex of bats
    if (this.stormT > 0 && !f.simulated) this.stormT = Math.max(0, this.stormT - dt);
    const vis = this.stormT > 0 && f.alive;
    this.vortex.visible = vis;
    if (!vis) return;
    this.stormAge += dt;
    const t = m.time;
    const grow = Math.min(1, this.stormAge / 0.4);
    for (let i = 0; i < STORM.bats; i++) {
      const s = this.seeds[i];
      const ang = s.a + t * s.w;
      const r = s.r * (0.35 + 0.65 * grow);
      _p.set(f.pos.x + Math.cos(ang) * r, f.pos.y + s.h * grow + Math.sin(t * 3 + s.ph) * 0.25, f.pos.z + Math.sin(ang) * r);
      const dir = Math.sign(s.w);
      _q.setFromAxisAngle(UP, Math.atan2(-Math.sin(ang) * dir, Math.cos(ang) * dir));
      _s.set(0.35 + 0.65 * Math.abs(Math.sin(t * 22 + s.ph)), 1, 1);
      _m4.compose(_p, _q, _s);
      this.vortex.setMatrixAt(i, _m4);
    }
    this.vortex.instanceMatrix.needsUpdate = true;
    // swirling motes and the edge of the storm on the floor
    for (let i = 0; i < 3; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * STORM.radius;
      m.vfx.add.emit({ pos: new THREE.Vector3(f.pos.x + Math.cos(ang) * r, f.pos.y + Math.random() * STORM.height, f.pos.z + Math.sin(ang) * r), vel: new THREE.Vector3(-Math.sin(ang) * 6, 0.5, Math.cos(ang) * 6), life: 0.4, size: 0.12, size1: 0.02, color: i % 2 ? VIOLET : CRIMSON, shape: Shape.streak, stretch: 2 });
    }
    this.stormRing -= dt;
    if (this.stormRing <= 0) {
      this.stormRing = 0.3;
      m.vfx.ring(f.pos.clone().setY(f.pos.y + 0.08), UP, VIOLET, STORM.radius - 0.3, STORM.radius, 0.4);
    }
  }

  // -------------------------------------------------------------------------------------------
  // remote puppets
  // -------------------------------------------------------------------------------------------

  playRemote(f: Fighter, e: ActionEvent, m: MatchContext): void {
    const find = (id?: string) => (id ? m.fighters.find((o) => o.id === id) ?? null : null);
    switch (e.a) {
      case 'c1':
      case 'c2':
      case 'c3':
      case 'air':
        f.anim.play(e.a, { fadeIn: 0.03 });
        this.act = e.a === 'c3' ? 'remoteSpin' : 'remote';
        this.actT = 0;
        this.actDur = DUR[e.a] ?? 0.4;
        break;
      case 'lunge':
        f.anim.play('lunge', { fadeIn: 0.04, hold: true });
        this.setTrail(f, true);
        m.audio.play('dash', f.pos, 0.8);
        m.audio.play('hiss', f.pos, 0.7);
        this.act = 'remote';
        this.actT = 0;
        this.actDur = BITE.lunge + 0.1;
        break;
      case 'bite':
        this.prey = find(e.t);
        f.anim.play('bite', { fadeIn: 0.03 });
        this.act = 'remoteBite';
        this.actT = 0;
        this.actDur = DUR.bite;
        if (this.prey) this.bloodBurst(m, this.neck(this.prey, new THREE.Vector3()), 1);
        m.audio.play('bite', f.pos, 1);
        break;
      case 'bat':
        this.act = null;
        this.morph(f, m, true);
        // safety net if the 'unbat' never arrives
        this.batT = BAT.time + 0.8;
        break;
      case 'unbat':
        this.morph(f, m, false);
        f.anim.play('unbat', { fadeIn: 0 });
        break;
      case 'swarm':
        f.anim.play('swarm', { fadeIn: 0.03, offset: 0.15 });
        if (e.p && e.d) this.spawnSwarm(f, m, new THREE.Vector3(...e.p), new THREE.Vector3(...e.d), find(e.t), true);
        m.audio.play('bats', f.pos, 0.9);
        break;
      case 'ult':
        f.anim.play('ult', { fadeIn: 0.08, hold: true });
        this.openStorm(f, m);
        this.act = 'ultRemote';
        this.actT = 0;
        this.actDur = STORM.time + 0.8;
        break;
      case 'ultEnd':
        f.anim.play('ultEnd', { fadeIn: 0.03 });
        this.finale(f, m, false);
        this.act = 'remote';
        this.actT = 0;
        this.actDur = DUR.ultEnd;
        break;
      default:
        break;
    }
  }

  tickRemote(f: Fighter, dt: number, m: MatchContext): void {
    if (this.morphed) {
      this.batT -= dt;
      if (this.batT <= 0) this.morph(f, m, false);
    }
    if (!this.act) return;
    this.actT += dt;
    if (this.act === 'remoteSpin') this.spin = Math.min(1, this.actT / 0.2) * 360;
    if (this.act === 'remoteBite' && this.prey && this.actT > 0.06 && this.actT < BITE.latch) this.drainFx(f, this.prey, m, dt);
    if (this.actT > this.actDur) {
      if (this.act === 'ultRemote') {
        this.stormT = 0;
        this.setWings(f, false);
      }
      this.prey = null;
      super.endAction(f);
    }
  }
}

/** a flat bat silhouette for the vortex (wings spread along X, facing +Z) */
function vortexBatGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.07);
  s.quadraticCurveTo(0.05, 0.05, 0.08, 0.03);
  s.lineTo(0.2, 0.06);
  s.quadraticCurveTo(0.18, 0.0, 0.2, -0.05);
  s.quadraticCurveTo(0.14, -0.02, 0.12, -0.07);
  s.quadraticCurveTo(0.08, -0.03, 0.04, -0.06);
  s.lineTo(0, -0.09);
  s.lineTo(-0.04, -0.06);
  s.quadraticCurveTo(-0.08, -0.03, -0.12, -0.07);
  s.quadraticCurveTo(-0.14, -0.02, -0.2, -0.05);
  s.quadraticCurveTo(-0.18, 0.0, -0.2, 0.06);
  s.lineTo(-0.08, 0.03);
  s.quadraticCurveTo(-0.05, 0.05, 0, 0.07);
  const g = new THREE.ShapeGeometry(s, 4);
  // lie flat (wings horizontal), the head toward +Z
  g.rotateX(-Math.PI / 2);
  g.scale(1.6, 1, 1.6);
  return g;
}
