import * as THREE from 'three';
import { BaseKit, type MeleeHit } from '../BaseKit';
import type { Fighter } from '../../game/Fighter';
import { forwardOf } from '../../game/Fighter';
import type { ActionEvent, HitInfo, Intent, MatchContext } from '../../game/types';
import { Shape } from '../../vfx/Particles';
import { enemiesAlong, enemiesInCone, foe, slashArc } from './lolShared';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export type Element = 'rock' | 'water' | 'grass';
const ELEMENTS: Element[] = ['rock', 'water', 'grass'];
export const ELEMENT_COLOR: Record<Element, number> = { rock: 0xffa630, water: 0x3fc8ff, grass: 0x4dff7a };
const ELEMENT_LABEL: Record<Element, string> = { rock: 'TERRA', water: 'ACQUA', grass: 'ERBA' };
const COMBO = ['c1', 'c2'] as const;
const DUR: Record<string, number> = { c1: 0.32, c2: 0.32, wrath: 0.5, air: 0.42 };
const WRATH = { length: 8.5, width: 0.9 };
const TERRA = { dist: 8, speed: 38 };
const AUD = { range: 18, speed: 40, max: 0.55 };
const ULT = { range: 22, half: 28, burst: 4.5 };

/**
 * QIYANA — League of Legends port (True Damage).
 * Passive Royal Privilege: the first hit on each enemy deals bonus damage (again after 12 s).
 * Skill (LMB, her Q): Edge of Ixtal / Elemental Wrath (line slash; with an element: Rock deals
 * more to wounded enemies, Water roots and slows, Grass turns her invisible and fast) ·
 * Attack (RMB): two ring-blade slashes (air: rising slash) · Secondary (C, her W): Terrashape
 * (dash; the element comes from where she lands: a wall = Rock, the ground = Water, the air =
 * Grass; it refreshes Edge of Ixtal) · F (her E): Audacity (pounce on the targeted enemy) ·
 * R: Supreme Display of Talent (shockwave; it explodes against walls and stuns).
 */
export class QiyanaKit extends BaseKit {
  private combo = 0;
  private comboTimer = 0;
  private queued = false;
  private element: Element | null = null;
  /** the running air slash got the airtime's lift (rises with low gravity) */
  private airHang = false;
  private readonly privilege = new Map<string, number>();
  private dashDir = new THREE.Vector3();
  private dashLen = 0;
  private dashTarget: Fighter | null = null;
  private fired = false;
  private boost = 0;
  /** element carried by the running Wrath (consumed when it starts) */
  private wrathElement: Element | null = null;

  constructor() {
    super('qiyana');
  }

  update(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    if (this.boost > 0) this.boost = Math.max(0, this.boost - dt);
    super.update(f, it, dt, m);
  }

  protected startAction(f: Fighter, name: string, dur: number, faceYaw: number | null = null): void {
    super.startAction(f, name, dur, faceYaw);
    this.fired = false;
  }

  protected handleInput(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    this.comboTimer -= dt;
    if (this.comboTimer <= 0 && !this.act) this.combo = 0;
    if (this.boost > 0) f.ctrl.speedMul *= 1 + 0.4 * Math.min(1, this.boost);
    if (this.act === 'terra' || this.act === 'audacity' || this.act === 'ult') return;

    // ---- R: Supreme Display of Talent -------------------------------------------------------------
    if (it.ultimatePressed && (!this.act || this.act === 'c1' || this.act === 'c2' || this.act === 'air') && this.useUlt(f, m)) {
      if (this.act) this.endAction(f);
      this.startAction(f, 'ult', 0.95, f.aimYaw);
      f.anim.play('ult', { fadeIn: 0.05 });
      m.audio.play('ult', f.pos, 1);
      if (f.stealth > 0) f.reveal = 0.6;
      return;
    }
    // ---- F: Audacity --------------------------------------------------------------------------------------------
    if (it.abilityPressed && this.cd.abi <= 0 && (!this.act || this.act.startsWith('c'))) {
      const t = this.findTarget(f, m, AUD.range, 14);
      if (!t) m.audio.play('uiBack', f.pos, 0.6);
      else {
        this.cd.abi = this.data.abilities.abi.cooldown;
        this.startAudacity(f, m, t);
        return;
      }
    }
    // ---- C: Terrashape ------------------------------------------------------------------------------------
    if (it.secondaryPressed && this.cd.sec <= 0 && (!this.act || this.act === 'c1' || this.act === 'c2')) {
      this.cd.sec = this.data.abilities.sec.cooldown;
      if (this.act) this.endAction(f);
      this.startTerrashape(f, it, m);
      return;
    }
    // ---- LMB: Edge of Ixtal / Elemental Wrath (cancels the recovery of a slash) ---------------------------
    if ((!this.act || this.act === 'c1' || this.act === 'c2' || this.act === 'air') && this.skillReady()) {
      this.startWrath(f, m);
      return;
    }
    // ---- RMB: slashes -------------------------------------------------------------------------------------
    if (it.attackPressed) {
      if (this.act && this.actT > this.actDur * 0.45) this.queued = true;
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
      // only the first air slash of a jump rises; mashing it can't keep her afloat
      this.airHang = this.takeAirLift();
      this.magnet(f, this.findTarget(f, m, 8, 45), 12, 1.5, this.airHang);
      if (this.airHang) f.vel.y = Math.max(f.vel.y, 8.5);
      this.cd.atk = 0.45;
      m.broadcastAction(f, { a: 'air' });
      return;
    }
    const name = COMBO[this.combo % COMBO.length];
    this.combo++;
    this.comboTimer = 0.85;
    this.startAction(f, name, DUR[name]);
    f.anim.play(name, { fadeIn: 0.03 });
    this.magnet(f, this.findTarget(f, m, 7, 40), 10, 1.5);
    f.ctrl.lockMove = DUR[name] * 0.6;
    m.broadcastAction(f, { a: name });
  }

  /** Edge of Ixtal (LMB): a line slash, Elemental Wrath while the ring carries an element */
  private startWrath(f: Fighter, m: MatchContext): void {
    this.cd.sig = this.data.abilities.sig.cooldown;
    this.queued = false;
    if (f.stealth > 0) f.reveal = 0.6;
    if (this.act) this.endAction(f);
    this.startAction(f, 'wrath', DUR.wrath);
    f.anim.play('wrath', { fadeIn: 0.03 });
    this.magnet(f, this.findTarget(f, m, 9, 40), 9, 3);
    f.ctrl.lockMove = DUR.wrath * 0.6;
    this.wrathElement = this.element;
    this.setElement(f, null);
    m.broadcastAction(f, { a: 'wrath', n: this.elementIndex(this.wrathElement) });
  }

  private elementIndex(e: Element | null): number {
    return e ? ELEMENTS.indexOf(e) + 1 : 0;
  }

  private setElement(f: Fighter, e: Element | null): void {
    this.element = e;
    f.visual.weaponGlow?.(e ? ELEMENT_COLOR[e] : null);
  }

  /** Elemental Wrath: a slash wave along a line in front */
  private wrath(f: Fighter, m: MatchContext, el: Element | null): void {
    const yaw = this.faceYaw ?? f.facing;
    const dir = forwardOf(yaw, new THREE.Vector3());
    const from = f.chest(new THREE.Vector3()).addScaledVector(dir, 0.4);
    const to = from.clone().addScaledVector(dir, WRATH.length);
    const hit = m.world.raycast(from, dir, WRATH.length);
    if (hit) to.copy(from).addScaledVector(dir, hit.distance);
    this.wrathFx(f, m, from, to, el);
    if (!m.isAuthority(f)) return;
    for (const o of enemiesAlong(f, m, from, to, WRATH.width)) {
      const info: HitInfo = { slot: 'sig', part: 'q', at: o.chest(new THREE.Vector3()), kb: dir.clone().multiplyScalar(5), blockable: true };
      if (el === 'rock') {
        info.part = 'qRock';
        info.scale = o.hp / o.maxHp < 0.5 ? 1 : 85 / 125;
      } else if (el === 'water') {
        info.part = 'qWater';
        info.slow = 1.6;
        info.stun = 0.45;
      } else if (el === 'grass') info.part = 'qGrass';
      m.reportHit(f, o, info);
      this.royal(f, o, m);
    }
    if (el === 'grass') this.veil(f, m, 2.6);
  }

  private wrathFx(f: Fighter, m: MatchContext, from: THREE.Vector3, to: THREE.Vector3, el: Element | null): void {
    const c = el ? ELEMENT_COLOR[el] : f.champ.colors[0];
    const c2 = el ? 0xffffff : f.champ.colors[1];
    const dir = to.clone().sub(from);
    const len = dir.length();
    dir.divideScalar(len || 1);
    for (let d = 0.5; d < len; d += 1.1) slashArc(m, from.clone().addScaledVector(dir, d), dir, 0.9 + d * 0.06, c, c2);
    if (el === 'rock') for (let i = 0; i < 10; i++) m.vfx.alpha.emit({ pos: from.clone().addScaledVector(dir, Math.random() * len).setY(from.y - 1), vel: new THREE.Vector3((Math.random() - 0.5) * 3, 4 + Math.random() * 4, (Math.random() - 0.5) * 3), life: 0.7, size: 0.35, color: 0x8a6a48, shape: Shape.shard, gravity: 18 });
    if (el === 'water') m.vfx.ring(to, dir, c, 0.3, 2.2, 0.35);
    if (el === 'grass') for (let i = 0; i < 14; i++) m.vfx.add.emit({ pos: from.clone().addScaledVector(dir, Math.random() * len), vel: new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2), life: 0.8, size: 0.16, color: c, shape: Shape.star, drag: 2 });
    m.audio.play(el ? 'wave' : 'swingHeavy', from, 0.9);
  }

  /** Grass: invisible for a moment, with a burst of speed */
  private veil(f: Fighter, m: MatchContext, time: number): void {
    f.stealth = time;
    f.stealthRadius = 0;
    f.reveal = 0;
    this.boost = 1.6;
    m.broadcastAction(f, { a: 'veil', n: time });
  }

  // ---- Terrashape ---------------------------------------------------------------------------------------------

  private startTerrashape(f: Fighter, it: Intent, m: MatchContext): void {
    forwardOf(f.aimYaw, _v);
    const right = _w.set(-Math.cos(f.aimYaw), 0, Math.sin(f.aimYaw));
    this.dashDir.set(0, 0, 0).addScaledVector(_v, it.move.y).addScaledVector(right, it.move.x);
    if (this.dashDir.lengthSq() < 0.01) this.dashDir.copy(it.aimDir);
    if (f.grounded) this.dashDir.y = Math.max(0, this.dashDir.y);
    this.dashDir.normalize();
    this.dashLen = 0;
    this.startAction(f, 'terra', TERRA.dist / TERRA.speed + 0.1, Math.atan2(this.dashDir.x, this.dashDir.z));
    f.anim.play('terra', { fadeIn: 0.02 });
    m.audio.play('dash', f.pos, 1);
    m.vfx.dashLines(f, this.dashDir);
  }

  /** element from the surroundings: a wall close by = Rock, standing on the ground = Water, air = Grass */
  private sense(f: Fighter, m: MatchContext): Element {
    const c = f.chest(new THREE.Vector3());
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (m.world.raycast(c, _v.set(Math.sin(a), 0, Math.cos(a)), 2.8)) return 'rock';
    }
    const below = m.world.raycast(c, DOWN, 2.4);
    return f.grounded || below ? 'water' : 'grass';
  }

  private endTerrashape(f: Fighter, m: MatchContext): void {
    const el = this.sense(f, m);
    this.setElement(f, el);
    // League-style: Terrashape refreshes Edge of Ixtal
    this.cd.sig = 0;
    this.elementBurst(f, m, el);
    m.broadcastAction(f, { a: 'terra', n: this.elementIndex(el) });
  }

  private elementBurst(f: Fighter, m: MatchContext, el: Element): void {
    const c = ELEMENT_COLOR[el];
    const at = f.chest(new THREE.Vector3());
    m.vfx.ring(f.pos.clone().setY(f.pos.y + 0.1), UP, c, 0.4, 2.6, 0.45);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      m.vfx.add.emit({ pos: at.clone(), vel: new THREE.Vector3(Math.cos(a) * 5, 1 + Math.random() * 2, Math.sin(a) * 5), life: 0.5, size: 0.2, size1: 0.02, color: c, shape: el === 'grass' ? Shape.star : el === 'water' ? Shape.glow : Shape.shard, drag: 3 });
    }
    m.audio.play('wave', at, 0.6);
  }

  // ---- Audacity --------------------------------------------------------------------------------------------

  private startAudacity(f: Fighter, m: MatchContext, t: Fighter): void {
    this.dashTarget = t;
    this.startAction(f, 'audacity', AUD.max + 0.2);
    f.anim.play('audacity', { fadeIn: 0.02 });
    this.hitActive = { slot: 'abi', part: 'e', range: 2.0, arc: 180, height: 2.6, kb: 6, kbUp: 4, stun: 0.25 };
    this.setTrail(f, true);
    if (f.stealth > 0) f.reveal = 0.6;
    m.audio.play('dash', f.pos, 1);
    m.broadcastAction(f, { a: 'aud', t: t.id });
  }

  // ---- Supreme Display of Talent ----------------------------------------------------------------------------

  /** shockwave + terrain explosions (also replayed by remote puppets) */
  private wave(f: Fighter, m: MatchContext, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const flat = dir.clone().setY(0).normalize();
    // wave front
    for (let d = 1.5; d < ULT.range; d += 1.6) slashArc(m, origin.clone().addScaledVector(flat, d), flat, 1.2 + d * Math.tan(THREE.MathUtils.degToRad(ULT.half)), f.champ.colors[0], f.champ.colors[1]);
    m.vfx.ring(origin, flat, f.champ.colors[1], 0.5, 6, 0.4);
    m.audio.play('wave', origin, 1.2);
    m.shake(0.5, origin);
    // terrain: walls inside the cone explode
    const bursts: THREE.Vector3[] = [];
    for (let i = -4; i <= 4; i++) {
      const rd = flat.clone().applyAxisAngle(UP, THREE.MathUtils.degToRad((i / 4) * ULT.half));
      const hit = m.world.raycast(origin, rd, ULT.range);
      if (!hit) continue;
      const p = hit.point.clone().addScaledVector(rd, -0.6);
      if (bursts.every((b) => b.distanceTo(p) > 3)) bursts.push(p);
    }
    if (!bursts.length) bursts.push(origin.clone().addScaledVector(flat, ULT.range * 0.8));
    for (const b of bursts) {
      m.vfx.explosion(b, ULT.burst * 0.8, f.champ.colors[1], f.champ.colors[0]);
      m.vfx.shockwave(b.clone().setY(b.y - 0.8), ULT.burst, f.champ.colors[1]);
    }
    m.audio.play('explosion', bursts[0], 1);
    if (!m.isAuthority(f)) return;
    for (const { o } of enemiesInCone(f, m, origin, flat, ULT.range, ULT.half, 5)) {
      const kb = _v.subVectors(o.pos, f.pos).setY(0).normalize().multiplyScalar(14).clone();
      kb.y = 5;
      m.reportHit(f, o, { slot: 'ult', part: 'wave', at: o.chest(new THREE.Vector3()), kb, blockable: false });
      this.royal(f, o, m);
    }
    const stunned = new Set<string>();
    for (const b of bursts) {
      for (const o of m.fighters) {
        if (!foe(f, o) || stunned.has(o.id)) continue;
        if (o.chest(_w).distanceTo(b) > ULT.burst) continue;
        stunned.add(o.id);
        m.reportHit(f, o, { slot: 'ult', part: 'burst', at: _w.clone(), stun: 0.9, kb: new THREE.Vector3(0, 6, 0), blockable: false });
      }
    }
  }

  // ---- passive ------------------------------------------------------------------------------------------------

  /** Royal Privilege: first hit on each enemy deals bonus damage (12 s per enemy) */
  private royal(f: Fighter, t: Fighter, m: MatchContext): void {
    if ((this.privilege.get(t.id) ?? -1) > m.time) return;
    this.privilege.set(t.id, m.time + 12);
    const at = t.head(new THREE.Vector3());
    m.reportHit(f, t, { slot: 'atk', part: 'royal', at, blockable: false });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      m.vfx.add.emit({ pos: at.clone().setY(at.y + 0.35), vel: new THREE.Vector3(Math.cos(a) * 1.6, 1.4, Math.sin(a) * 1.6), life: 0.55, size: 0.14, color: 0xffd34a, shape: Shape.star, drag: 2 });
    }
  }

  protected onSweepHit(f: Fighter, t: Fighter, _h: MeleeHit, m: MatchContext): void {
    this.royal(f, t, m);
  }

  // ---- per frame -------------------------------------------------------------------------------------------

  protected tickAction(f: Fighter, _it: Intent, dt: number, m: MatchContext): void {
    if (this.act === 'air' && this.airHang) f.ctrl.gravityScale = 0.6;
    if (this.act === 'wrath' && !this.fired && this.actT >= 0.09) {
      this.fired = true;
      this.wrath(f, m, this.wrathElement);
      this.wrathElement = null;
    } else if (this.act === 'terra') {
      f.ctrl.noHooks = true;
      f.ctrl.gravityScale = 0;
      if (this.dashLen < TERRA.dist) {
        f.vel.copy(this.dashDir).multiplyScalar(TERRA.speed);
        this.dashLen += TERRA.speed * dt;
        if (m.world.overlapsSphere(_v.copy(f.pos).setY(f.pos.y + 1).addScaledVector(this.dashDir, 0.9), 0.45)) this.dashLen = TERRA.dist;
      } else if (!this.fired) {
        this.fired = true;
        f.vel.multiplyScalar(0.25);
        this.endTerrashape(f, m);
        this.actT = this.actDur;
      }
    } else if (this.act === 'audacity') {
      f.ctrl.noHooks = true;
      f.ctrl.gravityScale = 0.2;
      const t = this.dashTarget;
      if (!t || !t.alive) {
        this.actT = Math.max(this.actT, this.actDur - 0.1);
        return;
      }
      this.dashDir.subVectors(t.chest(_w), f.chest(_v));
      const d = this.dashDir.length();
      this.dashDir.divideScalar(d || 1);
      this.faceYaw = Math.atan2(this.dashDir.x, this.dashDir.z);
      if (d < 1.5 || this.actT > AUD.max) {
        f.vel.multiplyScalar(0.15);
        this.dashTarget = null;
      } else f.vel.copy(this.dashDir).multiplyScalar(AUD.speed);
    } else if (this.act === 'ult') {
      f.ctrl.lockMove = 0.1;
      if (!this.fired && this.actT >= 0.4) {
        this.fired = true;
        const origin = f.chest(new THREE.Vector3());
        const dir = forwardOf(this.faceYaw ?? f.facing, new THREE.Vector3());
        this.wave(f, m, origin, dir);
        m.broadcastAction(f, { a: 'ult', p: [origin.x, origin.y, origin.z], d: [dir.x, dir.y, dir.z] });
      }
    }
  }

  protected endAction(f: Fighter): void {
    if (this.act === 'audacity') this.dashTarget = null;
    super.endAction(f);
  }

  onAnimEvent(f: Fighter, ev: string, m: MatchContext): void {
    if (!this.act) return;
    if (ev === 'swing') {
      this.setTrail(f, true);
      m.audio.play('swing', f.pos, 0.8);
    } else if (ev === 'hitOn') {
      if (this.act !== 'c1' && this.act !== 'c2' && this.act !== 'air') return;
      this.hitActive = { slot: 'atk', part: this.act, range: 2.9, arc: 75, kb: 3, kbUp: this.act === 'air' ? 9 : 1, stun: 0.1 };
    } else if (ev === 'hitOff') {
      if (this.act === 'audacity') return;
      this.hitActive = null;
      this.setTrail(f, false);
    }
  }

  hints() {
    return this.element ? { sig: ELEMENT_LABEL[this.element] } : {};
  }


  // ---- remote puppets ------------------------------------------------------------------------------------

  private remoteWrath: { t: number; el: Element | null } | null = null;

  playRemote(f: Fighter, e: ActionEvent, m: MatchContext): void {
    switch (e.a) {
      case 'c1':
      case 'c2':
      case 'air':
      case 'wrath':
        f.anim.play(e.a, { fadeIn: 0.03 });
        if (f.stealth > 0) f.reveal = 0.6;
        this.act = 'remote';
        this.actT = 0;
        this.actDur = DUR[e.a] ?? 0.4;
        if (e.a === 'wrath') {
          this.remoteWrath = { t: 0.09, el: e.n ? ELEMENTS[e.n - 1] : null };
          f.visual.weaponGlow?.(null);
        }
        break;
      case 'terra': {
        f.anim.play('terra', { fadeIn: 0.02 });
        const el = e.n ? ELEMENTS[e.n - 1] : null;
        if (el) {
          f.visual.weaponGlow?.(ELEMENT_COLOR[el]);
          this.elementBurst(f, m, el);
        }
        break;
      }
      case 'veil':
        f.stealth = e.n ?? 2.5;
        f.stealthRadius = 0;
        f.reveal = 0;
        break;
      case 'aud':
        f.anim.play('audacity', { fadeIn: 0.02 });
        this.setTrail(f, true);
        this.act = 'remote';
        this.actT = 0;
        this.actDur = 0.6;
        break;
      case 'ult':
        f.anim.play('ult', { offset: 0.4, fadeIn: 0.02 });
        if (e.p && e.d) this.wave(f, m, new THREE.Vector3(...e.p), new THREE.Vector3(...e.d));
        break;
      default:
        break;
    }
  }

  tickRemote(f: Fighter, dt: number, m: MatchContext): void {
    if (this.remoteWrath) {
      this.remoteWrath.t -= dt;
      if (this.remoteWrath.t <= 0) {
        const dir = forwardOf(f.facing, new THREE.Vector3());
        const from = f.chest(new THREE.Vector3()).addScaledVector(dir, 0.4);
        this.wrathFx(f, m, from, from.clone().addScaledVector(dir, WRATH.length), this.remoteWrath.el);
        this.remoteWrath = null;
      }
    }
    if (!this.act) return;
    this.actT += dt;
    if (this.actT > this.actDur) this.endAction(f);
  }
}
