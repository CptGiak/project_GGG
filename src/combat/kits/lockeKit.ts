import * as THREE from 'three';
import type { AbilitySlot } from '../../../shared/champions';
import { BaseKit, type MeleeHit } from '../BaseKit';
import type { Fighter } from '../../game/Fighter';
import { forwardOf } from '../../game/Fighter';
import type { ActionEvent, HitInfo, Intent, MatchContext } from '../../game/types';
import { MASK_UPPER } from '../../fighter/Animator';
import { addOutline, toon } from '../../render/toon';
import { Shape } from '../../vfx/Particles';
import { Marks, afterimage, foe } from './lolShared';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

const COMBO = ['c1', 'c2', 'c3', 'c4'] as const;
const DUR: Record<string, number> = { c1: 0.32, c2: 0.3, c3: 0.4, c4: 0.58, air: 0.42, nails: 0.3, pursuit: 0.5, lunge: 0.5, purgatory: 0.7 };
/** Ritual Nails: three casts within the window, one real nail (pierces) + two visual ones */
const NAILS = { speed: 70, range: 26, casts: 3, window: 4, spacing: 0.45, stacks: 3, stackTime: 4 };
const PURSUIT = { dist: 10, radius: 3.4, empower: 4, lungeRange: 12, lungeSpeed: 40 };
/** Soul Ignition (C): for a few seconds, speed and 25% of the damage dealt back as health */
const IGNITE = { time: 4, speed: 0.35, vamp: 0.25, maxHeal: 220 };
const PURG = { max: 26, flight: 0.5, radius: 6.5, seal: 3, below: 0.25, pickup: 1.7, lifetime: 4.5, refund: 0.35 };

interface Reliquary {
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** match time of the landing */
  land: number;
  landed: boolean;
  sealed: Set<string>;
  pulse: number;
  /** owner side: the hits are decided here */
  owner: boolean;
}

/**
 * LOCKE — League of Legends port (the 2026 exorcist).
 * Passive Silver Stake: melee hits deal bonus damage based on the target's missing health;
 * Ritual Nails stacks are cashed in by the next melee hit.
 * Skill (LMB, his Q): Ritual Nails (pierce, slow, stack; up to 3 casts in 4 s) · Attack (RMB):
 * four-hit Exorcism combo · Secondary (C, his W): Soul Ignition (burst of speed, part of the
 * damage dealt healed back) · F (his E): Ashen Pursuit (blink + circular cut; the next attack
 * lunges onto the target) · R: Purgatory (throw the reliquary: area hit, then for 3 s enemies
 * under 25% health inside are sealed; walk over the reliquary to recover part of the ultimate).
 */
export class LockeKit extends BaseKit {
  private combo = 0;
  private comboTimer = 0;
  private queued = false;
  private fired = false;
  private readonly nails = new Marks();
  /** Ritual Nails recast window */
  private nailCasts = 0;
  private nailUntil = 0;
  private nailNext = 0;
  private nailQueued = false;
  /** empowered LMB after Ashen Pursuit */
  private empowered = 0;
  private lungeTarget: Fighter | null = null;
  private dashDir = new THREE.Vector3();
  /** Soul Ignition */
  private igniteT = 0;
  private ignitePool = 0;
  private flame = 0;
  /** Purgatory */
  private relic: Reliquary | null = null;
  /** the running air slash got the airtime's lift (rises with low gravity) */
  private airHang = false;
  private readonly relicMesh: THREE.Group;
  private readonly relicGlow: THREE.Mesh;
  readonly sceneObjects: THREE.Object3D[];

  constructor() {
    super('locke');
    this.relicMesh = buildReliquary(this.data.colors[0], this.data.colors[1]);
    this.relicGlow = this.relicMesh.getObjectByName('glow') as THREE.Mesh;
    this.relicMesh.visible = false;
    this.sceneObjects = [this.relicMesh];
  }

  update(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    if (this.igniteT > 0) {
      this.igniteT = Math.max(0, this.igniteT - dt);
      f.ctrl.speedMul *= 1 + IGNITE.speed;
      if (this.igniteT <= 0) this.endIgnite(f, m);
    }
    if (this.empowered > 0) this.empowered = Math.max(0, this.empowered - dt);
    if (this.nailCasts > 0 && this.nailUntil <= m.time) this.nailCasts = 0;
    super.update(f, it, dt, m);
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
    if (this.act === 'lunge' || this.act === 'purgatory') return;

    // ---- R: Purgatory -----------------------------------------------------------------------------
    if (it.ultimatePressed && (!this.act || this.act.startsWith('c') || this.act === 'air' || this.act === 'nails') && !this.relic && this.useUlt(f, m)) {
      if (this.act) this.endAction(f);
      this.startAction(f, 'purgatory', DUR.purgatory, f.aimYaw);
      f.anim.play('purgatory', { fadeIn: 0.05 });
      m.audio.play('ult', f.pos, 1);
      return;
    }
    // ---- F: Ashen Pursuit -----------------------------------------------------------------------
    if (it.abilityPressed && this.cd.abi <= 0 && (!this.act || this.act.startsWith('c') || this.act === 'nails')) {
      this.pursuit(f, it, m);
      return;
    }
    // ---- C: Soul Ignition (instant, never interrupts) -------------------------------------------
    if (it.secondaryPressed && this.cd.sec <= 0 && this.igniteT <= 0) {
      this.cd.sec = this.data.abilities.sec.cooldown;
      this.ignite(f, m);
    }
    // ---- LMB: Ritual Nails (recast twice; a recast pressed too early waits its turn) ---------------
    if (it.skillPressed && this.nailCasts > 0) this.nailQueued = true;
    if (this.nailCasts <= 0) this.nailQueued = false;
    const free = !this.act || this.act.startsWith('c') || (this.act === 'nails' && this.fired);
    if (this.nailQueued && free && m.time >= this.nailNext) {
      this.nailQueued = false;
      this.castNails(f, m);
      return;
    }
    if (it.skillPressed && free && this.nailCasts <= 0 && this.cd.sig <= 0) {
      this.cd.sig = this.data.abilities.sig.cooldown;
      this.nailCasts = NAILS.casts;
      this.nailUntil = m.time + NAILS.window;
      this.castNails(f, m);
      return;
    }
    // ---- RMB: Exorcism combo / empowered lunge ---------------------------------------------------
    if (it.attackPressed) {
      if (this.act && this.act !== 'pursuit' && this.actT > this.actDur * 0.4) this.queued = true;
      else if (!this.act || this.act === 'pursuit') this.attack(f, m);
    }
    if (!this.act && this.queued) this.attack(f, m);
  }

  private attack(f: Fighter, m: MatchContext): void {
    this.queued = false;
    if (this.empowered > 0) {
      const t = this.findTarget(f, m, PURSUIT.lungeRange, 35);
      if (t) {
        this.empowered = 0;
        this.startLunge(f, m, t);
        return;
      }
    }
    if (this.act) this.endAction(f);
    if (!f.grounded) {
      if (this.cd.atk > 0) return;
      this.startAction(f, 'air', DUR.air);
      f.anim.play('air', { fadeIn: 0.03 });
      // only the first air slash of a jump rises; mashing it can't keep him afloat
      this.airHang = this.takeAirLift();
      this.magnet(f, this.findTarget(f, m, 8, 45), 12, 1.5, this.airHang);
      if (this.airHang) f.vel.y = Math.max(f.vel.y, 8.5);
      this.cd.atk = 0.45;
      m.broadcastAction(f, { a: 'air' });
      return;
    }
    const name = COMBO[this.combo % 4];
    this.combo++;
    this.comboTimer = 0.8;
    this.startAction(f, name, DUR[name]);
    f.anim.play(name, { fadeIn: 0.03 });
    this.magnet(f, this.findTarget(f, m, 7, 40), name === 'c4' ? 12 : 10, 1.5);
    if (name === 'c4') {
      // the finisher hops: it spends the air lift so mashing on into air slashes can't climb
      f.vel.y = Math.max(f.vel.y, 4);
      this.airLift = false;
    }
    f.ctrl.lockMove = DUR[name] * 0.6;
    m.broadcastAction(f, { a: name });
  }

  // ---- Ritual Nails ---------------------------------------------------------------------------

  private castNails(f: Fighter, m: MatchContext): void {
    this.nailCasts--;
    this.nailNext = m.time + NAILS.spacing;
    if (this.act) this.endAction(f);
    this.startAction(f, 'nails', DUR.nails);
    f.anim.play('nails', { fadeIn: 0.02, mask: MASK_UPPER });
  }

  private throwNails(f: Fighter, m: MatchContext): void {
    const from = f.chest(new THREE.Vector3()).addScaledVector(UP, 0.15);
    const { point } = this.aimPoint(f, m, NAILS.range + 4);
    const dir = point.sub(from).normalize();
    this.spawnNails(f, m, from, dir, false);
    m.audio.play('swing', from, 0.9);
    m.broadcastAction(f, { a: 'nails', p: [from.x, from.y, from.z], d: [dir.x, dir.y, dir.z] });
  }

  private spawnNails(f: Fighter, m: MatchContext, from: THREE.Vector3, dir: THREE.Vector3, visualOnly: boolean): void {
    const [c0, c1] = f.champ.colors;
    const life = NAILS.range / NAILS.speed;
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    for (let i = -1; i <= 1; i++) {
      const p = from.clone().addScaledVector(side, i * 0.28).addScaledVector(dir, 0.5 + Math.abs(i) * -0.15);
      const real = i === 0 && !visualOnly;
      m.projectiles.spawn({
        owner: f, kind: 'blade', pos: p, vel: dir.clone().multiplyScalar(NAILS.speed), radius: real ? 0.42 : 0.1, life,
        slot: 'sig', part: 'q', color: i === 0 ? c0 : c1, color2: 0xffffff, kb: 2, slow: 0.6, pierce: true, visualOnly: !real,
        onHit: real ? (t) => this.nails.add(t.id, m.time, NAILS.stackTime, 1, NAILS.stacks) : undefined,
      });
    }
  }

  // ---- Ashen Pursuit --------------------------------------------------------------------------

  private pursuit(f: Fighter, it: Intent, m: MatchContext): void {
    this.cd.abi = this.data.abilities.abi.cooldown;
    forwardOf(f.aimYaw, _v);
    const right = _w.set(-Math.cos(f.aimYaw), 0, Math.sin(f.aimYaw));
    const dir = new THREE.Vector3().addScaledVector(_v, it.move.y).addScaledVector(right, it.move.x);
    if (dir.lengthSq() < 0.01) dir.copy(it.aimDir);
    if (f.grounded) dir.y = Math.max(0, dir.y);
    dir.normalize();
    const from = f.pos.clone().setY(f.pos.y + 1);
    const hit = m.world.raycast(from, dir, PURSUIT.dist + 0.8);
    const travel = hit ? Math.max(0, hit.distance - 0.8) : PURSUIT.dist;
    const to = from.clone().addScaledVector(dir, travel);
    afterimage(f, m, from, to);
    this.ashes(f, m, from);
    f.pos.copy(to).setY(to.y - 1);
    f.vel.copy(dir).multiplyScalar(6);
    f.invuln = Math.max(f.invuln, 0.25);
    f.hooks.forEach((h) => {
      if (h.state !== 'idle') h.state = 'retract';
    });
    if (this.act) this.endAction(f);
    this.startAction(f, 'pursuit', DUR.pursuit, Math.atan2(dir.x, dir.z));
    f.anim.play('pursuit', { fadeIn: 0 });
    this.empowered = PURSUIT.empower;
    m.broadcastAction(f, { a: 'pursuit', p: [from.x, from.y, from.z], d: [to.x, to.y, to.z] });
  }

  /** puff of ash where Locke vanishes / lands */
  private ashes(f: Fighter, m: MatchContext, at: THREE.Vector3): void {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      m.vfx.alpha.emit({ pos: at.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, (Math.random() - 0.5) * 1.2, Math.sin(a) * 0.4)), vel: new THREE.Vector3(Math.cos(a) * 1.5, 0.8 + Math.random(), Math.sin(a) * 1.5), life: 0.9, size: 0.7, size1: 1.3, color: 0x2b2a30, color1: f.champ.colors[0], alpha: 0.55, shape: Shape.puff, drag: 2 });
    }
  }

  private startLunge(f: Fighter, m: MatchContext, t: Fighter): void {
    if (this.act) this.endAction(f);
    this.lungeTarget = t;
    this.startAction(f, 'lunge', DUR.lunge);
    f.anim.play('lunge', { fadeIn: 0.02 });
    this.hitActive = { slot: 'atk', part: 'dash', range: 2.1, arc: 180, height: 2.6, kb: 6, kbUp: 3, stun: 0.2 };
    this.setTrail(f, true);
    m.audio.play('dash', f.pos, 1);
    m.broadcastAction(f, { a: 'lunge', t: t.id });
  }

  // ---- Soul Ignition ----------------------------------------------------------------------------

  private ignite(f: Fighter, m: MatchContext): void {
    this.igniteT = IGNITE.time;
    this.ignitePool = 0;
    this.igniteFx(f, m);
    m.broadcastAction(f, { a: 'ignite' });
  }

  private igniteFx(f: Fighter, m: MatchContext): void {
    const c = f.chest(new THREE.Vector3());
    m.vfx.ring(f.pos.clone().setY(f.pos.y + 0.1), UP, f.champ.colors[0], 0.3, 3, 0.45);
    m.vfx.ring(c, UP, f.champ.colors[1], 0.2, 1.8, 0.35);
    m.audio.play('boostStart', c, 0.9);
  }

  private endIgnite(f: Fighter, m: MatchContext): void {
    const heal = Math.round(Math.min(IGNITE.maxHeal, this.ignitePool));
    this.ignitePool = 0;
    if (heal >= 1 && f.alive) {
      m.reportHeal(f, heal);
      m.vfx.ring(f.chest(new THREE.Vector3()), UP, f.champ.colors[0], 0.2, 2.2, 0.4);
    }
  }

  /** damage estimate of a reported hit (Soul Ignition heals a share of it) */
  private dealt(slot: AbilitySlot, part: string, scale = 1, crit = false): void {
    if (this.igniteT <= 0) return;
    const base = this.data.abilities[slot].damage[part] ?? 0;
    this.ignitePool += base * Math.min(1, Math.max(0, scale)) * (crit ? 1.5 : 1) * IGNITE.vamp;
  }

  private report(f: Fighter, t: Fighter, m: MatchContext, info: HitInfo): void {
    m.reportHit(f, t, info);
    this.dealt(info.slot, info.part, info.scale, info.crit);
  }

  // ---- Purgatory ----------------------------------------------------------------------------------

  private throwRelic(f: Fighter, m: MatchContext): void {
    const from = f.chest(new THREE.Vector3()).addScaledVector(UP, 0.6);
    const { point } = this.aimPoint(f, m, PURG.max);
    // land on the floor under the aimed point (or right in front if there is none)
    const ground = m.world.raycast(point.clone().addScaledVector(UP, 0.5), DOWN, 40);
    const to = ground ? ground.point.clone() : f.pos.clone().addScaledVector(forwardOf(f.aimYaw, _v), 6);
    this.launchRelic(f, m, from, to, true);
    m.broadcastAction(f, { a: 'purg', p: [to.x, to.y, to.z], d: [from.x, from.y, from.z] });
  }

  private launchRelic(f: Fighter, m: MatchContext, from: THREE.Vector3, to: THREE.Vector3, owner: boolean): void {
    this.relic = { from, to, land: m.time + PURG.flight, landed: false, sealed: new Set(), pulse: 0, owner };
    this.relicMesh.visible = true;
    this.relicMesh.position.copy(from);
    this.relicMesh.scale.setScalar(1);
    m.audio.play('swingHeavy', from, 1);
    void f;
  }

  private landRelic(f: Fighter, m: MatchContext, r: Reliquary): void {
    r.landed = true;
    const [c0, c1] = f.champ.colors;
    const at = r.to;
    m.vfx.shockwave(at, PURG.radius, c0);
    m.vfx.ring(at.clone().setY(at.y + 0.08), UP, c1, 0.5, PURG.radius, 0.6);
    m.vfx.explosion(at.clone().setY(at.y + 0.6), 2.4, c0, c1);
    // a rain of nails into the circle
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * PURG.radius;
      const p = new THREE.Vector3(at.x + Math.cos(a) * d, at.y + 6 + Math.random() * 4, at.z + Math.sin(a) * d);
      m.vfx.add.emit({ pos: p, vel: new THREE.Vector3(0, -38, 0), life: 0.22 + Math.random() * 0.1, size: 0.09, color: i % 2 ? c0 : 0xffffff, shape: Shape.streak, stretch: 2.2 });
    }
    m.audio.play('explosion', at, 1);
    m.shake(0.4, at);
    if (!r.owner || !f.alive || !m.isAuthority(f)) return;
    const center = at.clone().setY(at.y + 1);
    for (const o of m.fighters) {
      if (!foe(f, o)) continue;
      const c = o.chest(new THREE.Vector3());
      if (c.distanceTo(center) > PURG.radius + 0.6 || Math.abs(c.y - center.y) > 4) continue;
      const kb = _v.subVectors(o.pos, at).setY(0).normalize().multiplyScalar(4).clone();
      kb.y = 4;
      this.report(f, o, m, { slot: 'ult', part: 'purg', at: c, kb, slow: 1.5, blockable: false });
      this.nails.add(o.id, m.time, NAILS.stackTime, NAILS.stacks, NAILS.stacks);
    }
  }

  private sealFx(f: Fighter, m: MatchContext, t: Fighter): void {
    const c = t.chest(new THREE.Vector3());
    const [c0, c1] = f.champ.colors;
    m.vfx.beam(c.clone().setY(c.y + 14), c, c1, 0.7, 0.55);
    m.vfx.beam(c.clone().setY(c.y + 14), c, 0xffffff, 0.25, 0.4);
    m.vfx.ring(t.pos.clone().setY(t.pos.y + 0.08), UP, c0, 0.3, 2.4, 0.5);
    m.vfx.ring(c, UP, c1, 1.6, 0.2, 0.5);
    m.vfx.hitSpark(c, UP, c1, true);
    m.audio.play('beam', c, 1);
  }

  /** reliquary flight, zone, seals and pickup + Soul Ignition flames + nail stacks (all fighters) */
  tickWorld(f: Fighter, dt: number, m: MatchContext): void {
    this.nails.draw(m, dt, f.champ.colors[1], 0.9);
    if (this.igniteT > 0 && f.alive) {
      if (!f.simulated) this.igniteT = Math.max(0, this.igniteT - dt);
      this.flame -= dt;
      while (this.flame <= 0) {
        this.flame += 0.018;
        const p = f.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.2 + Math.random() * 1.5, (Math.random() - 0.5) * 0.7));
        m.vfx.add.emit({ pos: p, vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 0.6), life: 0.5, size: 0.42, size1: 0.05, color: f.champ.colors[0], color1: f.champ.colors[1], shape: Shape.glow, drag: 1 });
      }
    }
    const r = this.relic;
    if (!r) return;
    const mesh = this.relicMesh;
    if (!r.landed) {
      // arc from the hand to the floor, tumbling
      const k = THREE.MathUtils.clamp(1 - (r.land - m.time) / PURG.flight, 0, 1);
      mesh.position.lerpVectors(r.from, r.to, k);
      mesh.position.y += Math.sin(k * Math.PI) * 3.2 + 0.35 * k;
      mesh.rotation.x += dt * 14;
      mesh.rotation.y += dt * 6;
      if (Math.random() < dt * 40) m.vfx.add.emit({ pos: mesh.position.clone(), life: 0.3, size: 0.22, size1: 0.02, color: f.champ.colors[0], shape: Shape.glow });
      if (k >= 1) {
        mesh.position.copy(r.to).setY(r.to.y + 0.35);
        mesh.rotation.set(0, mesh.rotation.y, 0);
        this.landRelic(f, m, r);
      }
      return;
    }
    const age = m.time - r.land;
    // reliquary hovering over the floor, crystal pulsing
    mesh.rotation.y += dt * 1.6;
    mesh.position.y = r.to.y + 0.35 + Math.sin(age * 4) * 0.06;
    (this.relicGlow.material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.sin(age * 10) * 0.12;
    if (age < PURG.seal) {
      // the seal zone: rim pulses and rising motes
      r.pulse -= dt;
      if (r.pulse <= 0) {
        r.pulse = 0.35;
        m.vfx.ring(r.to.clone().setY(r.to.y + 0.06), UP, f.champ.colors[0], PURG.radius - 0.25, PURG.radius, 0.4);
      }
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        m.vfx.add.emit({ pos: new THREE.Vector3(r.to.x + Math.cos(a) * PURG.radius, r.to.y + 0.1, r.to.z + Math.sin(a) * PURG.radius), vel: new THREE.Vector3(0, 2 + Math.random() * 2, 0), life: 0.6, size: 0.12, color: f.champ.colors[1], shape: Shape.streak, stretch: 1.5 });
      }
      if (r.owner && f.alive && m.isAuthority(f)) {
        const center = _w.copy(r.to).setY(r.to.y + 1);
        for (const o of m.fighters) {
          if (!foe(f, o) || r.sealed.has(o.id) || o.hp > o.maxHp * PURG.below) continue;
          if (o.chest(_v).distanceTo(center) > PURG.radius + 0.4) continue;
          r.sealed.add(o.id);
          this.report(f, o, m, { slot: 'ult', part: 'seal', at: _v.clone(), blockable: false });
          this.sealFx(f, m, o);
          m.broadcastAction(f, { a: 'seal', t: o.id });
        }
      }
    }
    // pick the reliquary up: part of the ultimate back
    if (r.owner && f.alive && f.pos.distanceTo(r.to) < PURG.pickup && age > 0.2) {
      f.ult = Math.min(1, f.ult + PURG.refund);
      m.vfx.ring(mesh.position.clone(), UP, f.champ.colors[1], 0.2, 2, 0.4);
      m.audio.play('ultReady', mesh.position, 0.6);
      m.broadcastAction(f, { a: 'pick' });
      this.dropRelic();
      return;
    }
    if (age > PURG.lifetime) {
      for (let i = 0; i < 10; i++) m.vfx.alpha.emit({ pos: mesh.position.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2), life: 0.7, size: 0.4, size1: 0.9, color: 0x2b2a30, color1: f.champ.colors[0], alpha: 0.5, shape: Shape.puff });
      this.dropRelic();
    }
  }

  private dropRelic(): void {
    this.relic = null;
    this.relicMesh.visible = false;
  }

  // -------------------------------------------------------------------------------------------
  // per frame (owner)
  // -------------------------------------------------------------------------------------------

  protected tickAction(f: Fighter, _it: Intent, dt: number, m: MatchContext): void {
    if (this.act === 'air' && this.airHang) f.ctrl.gravityScale = 0.6;
    if (this.act === 'c4') this.spin = Math.min(1, this.actT / 0.38) * 360;
    if (this.act === 'pursuit') this.spin = Math.min(1, this.actT / 0.3) * 360;
    if (this.act === 'nails' && !this.fired && this.actT >= 0.07) {
      this.fired = true;
      this.throwNails(f, m);
    } else if (this.act === 'purgatory') {
      f.ctrl.lockMove = 0.1;
      if (!this.fired && this.actT >= 0.3) {
        this.fired = true;
        this.throwRelic(f, m);
      }
    } else if (this.act === 'lunge') {
      f.ctrl.noHooks = true;
      f.ctrl.gravityScale = 0.2;
      const t = this.lungeTarget;
      if (!t || !t.alive || this.actT > 0.4) {
        f.vel.multiplyScalar(Math.exp(-10 * dt));
        this.lungeTarget = null;
        return;
      }
      this.dashDir.subVectors(t.chest(_w), f.chest(_v));
      const d = this.dashDir.length();
      this.dashDir.divideScalar(d || 1);
      this.faceYaw = Math.atan2(this.dashDir.x, this.dashDir.z);
      if (d < 1.3) {
        f.vel.multiplyScalar(0.2);
        this.lungeTarget = null;
      } else f.vel.copy(this.dashDir).multiplyScalar(PURSUIT.lungeSpeed);
    }
  }

  protected onSweepHit(f: Fighter, t: Fighter, h: MeleeHit, m: MatchContext): void {
    this.dealt(h.slot, h.part, h.scaleFn ? h.scaleFn(t) : h.scale);
    const at = t.chest(new THREE.Vector3());
    // Silver Stake: bonus on wounded targets
    const missing = 1 - t.hp / t.maxHp;
    if (h.slot === 'atk' && missing > 0.08) this.report(f, t, m, { slot: 'atk', part: 'stake', scale: missing, at, blockable: false });
    // Ritual Nails stacks cashed in
    const n = this.nails.consume(t.id, m.time);
    if (n > 0) {
      this.report(f, t, m, { slot: 'atk', part: 'nails', scale: n / NAILS.stacks, at, blockable: false });
      this.burstNails(f, m, at, n);
      m.broadcastAction(f, { a: 'burst', t: t.id, n });
    }
  }

  private burstNails(f: Fighter, m: MatchContext, at: THREE.Vector3, n: number): void {
    for (let i = 0; i < 6 * n; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
      m.vfx.add.emit({ pos: at.clone(), vel: d.multiplyScalar(7 + Math.random() * 5), life: 0.3, size: 0.1, color: i % 2 ? f.champ.colors[1] : 0xffffff, shape: Shape.streak, stretch: 1.6, drag: 3 });
    }
    m.vfx.ring(at, UP, f.champ.colors[1], 0.2, 1.2 + n * 0.3, 0.3);
  }

  protected endAction(f: Fighter): void {
    if (this.act === 'lunge') {
      this.lungeTarget = null;
      f.vel.multiplyScalar(0.4);
    }
    super.endAction(f);
  }

  onAnimEvent(f: Fighter, ev: string, m: MatchContext): void {
    if (!this.act) return;
    if (ev === 'swing') {
      this.setTrail(f, true);
      m.audio.play(this.act === 'c4' || this.act === 'pursuit' ? 'swingHeavy' : 'swing', f.pos, 0.8);
    } else if (ev === 'hitOn') {
      if (this.act === 'pursuit') {
        this.hitActive = { slot: 'abi', part: 'e', range: PURSUIT.radius, arc: 180, height: 2.6, kb: 7, kbUp: 3, stun: 0.25 };
        return;
      }
      if (!['c1', 'c2', 'c3', 'c4', 'air'].includes(this.act)) return;
      this.hitActive = {
        slot: 'atk',
        part: this.act,
        range: this.act === 'c1' ? 3.2 : this.act === 'c4' ? 3.0 : 2.8,
        arc: this.act === 'c4' ? 180 : this.act === 'c1' ? 45 : 70,
        kb: this.act === 'c4' ? 8 : 3,
        kbUp: this.act === 'air' ? 9 : this.act === 'c4' ? 5 : 1,
        stun: this.act === 'c4' ? 0.3 : 0.1,
      };
    } else if (ev === 'hitOff') {
      if (this.act === 'lunge') return;
      this.hitActive = null;
      this.setTrail(f, false);
    }
  }

  cooldowns() {
    const c = super.cooldowns();
    if (this.nailCasts > 0) c.sig = 0;
    return c;
  }

  hints() {
    const out: Partial<Record<AbilitySlot, string>> = {};
    if (this.nailCasts > 0) out.sig = `x${this.nailCasts}`;
    if (this.igniteT > 0) out.sec = 'ON';
    if (this.empowered > 0) out.atk = 'SCATTO';
    if (this.relic) out.ult = 'RACCOGLI';
    return out;
  }

  cancel(f: Fighter): void {
    super.cancel(f);
    this.queued = false;
    this.nailQueued = false;
    this.empowered = 0;
  }

  // -------------------------------------------------------------------------------------------
  // remote puppets
  // -------------------------------------------------------------------------------------------

  playRemote(f: Fighter, e: ActionEvent, m: MatchContext): void {
    switch (e.a) {
      case 'c1':
      case 'c2':
      case 'c3':
      case 'c4':
      case 'air':
        f.anim.play(e.a, { fadeIn: 0.03 });
        this.act = e.a === 'c4' ? 'remoteSpin' : 'remote';
        this.actT = 0;
        this.actDur = DUR[e.a] ?? 0.4;
        break;
      case 'nails':
        f.anim.play('nails', { fadeIn: 0.02, offset: 0.07, mask: MASK_UPPER });
        if (e.p && e.d) this.spawnNails(f, m, new THREE.Vector3(...e.p), new THREE.Vector3(...e.d), true);
        break;
      case 'pursuit':
        if (e.p && e.d) {
          const from = new THREE.Vector3(...e.p);
          afterimage(f, m, from, new THREE.Vector3(...e.d));
          this.ashes(f, m, from);
        }
        f.anim.play('pursuit', { fadeIn: 0 });
        this.act = 'remoteSpin';
        this.actT = 0;
        this.actDur = DUR.pursuit;
        break;
      case 'lunge':
        f.anim.play('lunge', { fadeIn: 0.02 });
        this.setTrail(f, true);
        m.audio.play('dash', f.pos, 1);
        this.act = 'remote';
        this.actT = 0;
        this.actDur = DUR.lunge;
        break;
      case 'ignite':
        this.igniteT = IGNITE.time;
        this.igniteFx(f, m);
        break;
      case 'purg':
        f.anim.play('purgatory', { fadeIn: 0.02, offset: 0.3 });
        if (e.p && e.d) this.launchRelic(f, m, new THREE.Vector3(...e.d), new THREE.Vector3(...e.p), false);
        break;
      case 'seal': {
        const t = m.fighters.find((o) => o.id === e.t);
        if (t) this.sealFx(f, m, t);
        break;
      }
      case 'pick':
        if (this.relic) m.vfx.ring(this.relicMesh.position.clone(), UP, f.champ.colors[1], 0.2, 2, 0.4);
        this.dropRelic();
        break;
      case 'burst': {
        const t = m.fighters.find((o) => o.id === e.t);
        if (t) this.burstNails(f, m, t.chest(new THREE.Vector3()), e.n ?? 1);
        break;
      }
      default:
        break;
    }
  }

  tickRemote(f: Fighter, dt: number): void {
    if (!this.act) return;
    this.actT += dt;
    if (this.act === 'remoteSpin') this.spin = Math.min(1, this.actT / 0.36) * 360;
    if (this.actT > this.actDur) this.endAction(f);
  }
}

/** Locke's reliquary: dark casket, silver trims, a glowing soul crystal on top */
function buildReliquary(c0: string, c1: string): THREE.Group {
  const g = new THREE.Group();
  g.name = 'reliquary';
  const dark = toon({ color: 0x2b2733, spec: 0.3, specSize: 0.9, rim: 0.4 });
  const silver = toon({ color: 0xc9d2dc, spec: 0.8, specSize: 0.86, rim: 0.5 });
  const glowMat = new THREE.MeshBasicMaterial({ color: c0, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.26), dark);
  g.add(body);
  for (const y of [-0.19, 0.19]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.05, 0.3), silver);
    band.position.y = y;
    g.add(band);
  }
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.27), silver);
  g.add(cross);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), new THREE.MeshBasicMaterial({ color: c1 }));
  crystal.position.y = 0.33;
  crystal.scale.set(0.8, 1.4, 0.8);
  g.add(crystal);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), glowMat);
  glow.name = 'glow';
  glow.position.y = 0.3;
  g.add(glow);
  for (const o of [...g.children]) {
    const mesh = o as THREE.Mesh;
    mesh.frustumCulled = false;
    if (mesh === glow) continue;
    mesh.castShadow = true;
    addOutline(mesh, 1.6);
  }
  return g;
}
