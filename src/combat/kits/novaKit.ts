import * as THREE from 'three';
import { BaseKit } from '../BaseKit';
import type { Fighter } from '../../game/Fighter';
import { forwardOf } from '../../game/Fighter';
import type { ActionEvent, Intent, MatchContext } from '../../game/types';
import { CAPSULE_R, capsule, segSegDist2 } from '../Projectiles';
import { Shape } from '../../vfx/Particles';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

const COMBO = ['c1', 'c2', 'c3', 'c4'] as const;
const DUR: Record<string, number> = { c1: 0.3, c2: 0.3, c3: 0.4, c4: 0.58, air: 0.42 };
/** Glitch Step marks whoever it cuts for this long (s) */
const MARK_SEC = 4;

/**
 * NOVA — dual-blade assassin.
 * LMB: 4-hit Sample Flurry (air: Rising Remix) · RMB: Glitch Step (invulnerable blink through
 * enemies, marks them) · F: Phantom Cut (teleport behind the target, guaranteed crit; prefers a
 * marked target, half cooldown on one) · R: Remix Barrage. A takedown resets Glitch Step and
 * halves Phantom Cut's cooldown (Katarina / Akali style resets).
 */
export class NovaKit extends BaseKit {
  private combo = 0;
  private comboTimer = 0;
  private queued = false;
  private barrage = 0;
  private barrageT = 0;
  private barrageIdx = 0;
  /** glitch marks: target -> match time they expire */
  private marks = new Map<Fighter, number>();

  constructor() {
    super('nova');
  }

  update(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    super.update(f, it, dt, m);
    for (const [t, until] of this.marks) {
      if (!t.alive || m.time > until) this.marks.delete(t);
      else m.vfx.glitchMark(t, f.champ.colors[0], f.champ.colors[1], dt);
    }
  }

  onTakedown(f: Fighter, _victim: Fighter, m: MatchContext): void {
    this.cd.sec = 0;
    this.cd.abi *= 0.5;
    m.audio.play('chord', f.pos, 0.7);
    m.vfx.ring(f.chest(new THREE.Vector3()), new THREE.Vector3(0, 1, 0), f.champ.colors[0], 0.4, 2.4, 0.35);
  }

  /** clear line between two chests (Phantom Cut can't go through walls) */
  private los(f: Fighter, t: Fighter, m: MatchContext): boolean {
    const from = f.chest(_a);
    const d = _b.subVectors(t.chest(_v), from);
    const len = d.length();
    return len < 1 || !m.world.raycast(from, d.divideScalar(len), len - 0.6);
  }
  protected handleInput(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    this.comboTimer -= dt;
    if (this.comboTimer <= 0 && !this.act) this.combo = 0;
    if (this.act === 'ult') return;

    if (it.ultimatePressed && !this.act && this.useUlt(f, m)) {
      this.startUlt(f, m);
      return;
    }
    if (it.abilityPressed && this.cd.abi <= 0 && (!this.act || this.act.startsWith('c'))) {
      if (this.phantom(f, m)) return;
    }
    if (it.secondaryPressed && this.cd.sec <= 0) {
      this.glitchStep(f, it, m);
      return;
    }
    if (it.attackPressed) {
      if (this.act && this.actT > this.actDur * 0.4 && this.act !== 'phantom') this.queued = true;
      else if (!this.act) this.attack(f, m);
    }
    if (!this.act && this.queued) this.attack(f, m);
  }

  private attack(f: Fighter, m: MatchContext): void {
    this.queued = false;
    if (!f.grounded) {
      if (this.cd.atk > 0) return;
      this.startAction(f, 'air', DUR.air);
      f.anim.play('air', { fadeIn: 0.03 });
      const t = this.findTarget(f, m, 8, 45);
      this.magnet(f, t, 12, 1.5, true);
      f.vel.y = Math.max(f.vel.y, 8.5);
      this.cd.atk = 0.45;
      m.broadcastAction(f, { a: 'air' });
      return;
    }
    const name = COMBO[this.combo % 4];
    this.combo++;
    this.comboTimer = 0.75;
    this.startAction(f, name, DUR[name]);
    f.anim.play(name, { fadeIn: 0.03 });
    const t = this.findTarget(f, m, 7, 40);
    this.magnet(f, t, name === 'c4' ? 13 : 10, 1.5);
    if (name === 'c4') f.vel.y = Math.max(f.vel.y, 5);
    f.ctrl.lockMove = DUR[name] * 0.6;
    m.broadcastAction(f, { a: name });
  }

  /** instant blink along the move (or aim) direction, damaging enemies crossed */
  private glitchStep(f: Fighter, it: Intent, m: MatchContext): void {
    this.cd.sec = this.data.abilities.sec.cooldown;
    forwardOf(f.aimYaw, _v);
    const right = _w.set(-Math.cos(f.aimYaw), 0, Math.sin(f.aimYaw));
    const dir = new THREE.Vector3().addScaledVector(_v, it.move.y).addScaledVector(right, it.move.x);
    if (dir.lengthSq() < 0.01) dir.copy(it.aimDir);
    if (f.grounded) dir.y = Math.max(0, dir.y);
    dir.normalize();
    const dist = 9;
    const from = new THREE.Vector3().copy(f.pos).setY(f.pos.y + 1);
    const hit = m.world.raycast(from, dir, dist + 0.8);
    const travel = hit ? Math.max(0, hit.distance - 0.8) : dist;
    const to = from.clone().addScaledVector(dir, travel);
    // damage along the path; everyone cut is marked for Phantom Cut
    if (m.isAuthority(f)) {
      for (const o of m.fighters) {
        if (o === f || !o.alive) continue;
        if (o.team !== 0 && o.team === f.team) continue;
        capsule(o, _c1, _c2);
        if (segSegDist2(from, to, _c1, _c2, _a, _b) < (CAPSULE_R + 0.9) ** 2) {
          m.reportHit(f, o, { slot: 'sec', part: 'pass', at: _b.clone(), kb: dir.clone().multiplyScalar(5), stun: 0.2, blockable: false, mo: this.passMomentum(f, o) });
          if (o.invuln <= 0) this.marks.set(o, m.time + MARK_SEC);
        }
      }
    }
    this.afterimage(f, m, from, to);
    f.pos.copy(to).setY(to.y - 1);
    f.vel.copy(dir).multiplyScalar(14);
    f.invuln = Math.max(f.invuln, 0.25);
    this.faceYaw = Math.atan2(dir.x, dir.z);
    this.endAction(f);
    this.startAction(f, 'glitch', 0.22, this.faceYaw);
    f.anim.play('glitch', { fadeIn: 0.0, fadeOut: 0.12 });
    m.broadcastAction(f, { a: 'glitch', p: [from.x, from.y, from.z], d: [to.x, to.y, to.z] });
  }

  private afterimage(f: Fighter, m: MatchContext, from: THREE.Vector3, to: THREE.Vector3): void {
    const n = 14;
    const [c0, c1] = f.champ.colors;
    for (let i = 0; i <= n; i++) {
      const p = from.clone().lerp(to, i / n);
      p.y += (Math.random() - 0.5) * 0.8;
      m.vfx.add.emit({ pos: p, life: 0.35 + Math.random() * 0.2, size: 0.25, size1: 0.02, color: i % 2 ? c0 : c1, shape: Shape.square, alpha: 0.9, rot: 0 });
      m.vfx.add.emit({ pos: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), vel: new THREE.Vector3(0, 0, 0), life: 0.25, size: 0.06, color: 0xffffff, shape: Shape.streak, stretch: 1 });
    }
    m.vfx.ring(from, to.clone().sub(from).normalize(), c0, 0.3, 1.6, 0.3);
    m.vfx.ring(to, to.clone().sub(from).normalize(), c1, 1.6, 0.2, 0.3);
    m.vfx.beam(from, to, c0, 0.08, 0.2);
    m.audio.play('teleport', to, 1);
  }

  /** Glitch Step momentum: the speed Nova carried into the blink (the blink itself is instant) */
  private passMomentum(f: Fighter, o: Fighter): number | undefined {
    this.captureEntry(f);
    const mo = Math.round(this.impactSpeed(f, o));
    return mo >= 15 ? mo : undefined;
  }

  /** Phantom Cut target: a marked enemy in range with line of sight, else the one under the crosshair */
  private phantomPick(f: Fighter, m: MatchContext): { t: Fighter; marked: boolean } | null {
    let best: Fighter | null = null;
    let bestD = Infinity;
    for (const [t, until] of this.marks) {
      if (!t.alive || m.time > until) continue;
      const d = t.pos.distanceTo(f.pos);
      if (d < this.data.abilities.abi.range && d < bestD && this.los(f, t, m)) {
        best = t;
        bestD = d;
      }
    }
    if (best) return { t: best, marked: true };
    const t = this.findTarget(f, m, 30, 12);
    return t && this.los(f, t, m) ? { t, marked: false } : null;
  }

  /** teleport behind the target under the crosshair */
  private phantom(f: Fighter, m: MatchContext): boolean {
    const pick = this.phantomPick(f, m);
    if (!pick) {
      m.audio.play('uiBack', f.pos, 0.6);
      return false;
    }
    const t = pick.t;
    this.cd.abi = this.data.abilities.abi.cooldown * (pick.marked ? 0.5 : 1);
    if (pick.marked) {
      this.marks.delete(t);
      m.audio.play('glitch', f.pos, 0.8);
    }
    const from = f.chest(new THREE.Vector3());
    forwardOf(t.facing, _v);
    const dest = t.pos.clone().addScaledVector(_v, -1.5);
    // keep out of walls
    if (m.world.overlapsSphere(_w.copy(dest).setY(dest.y + 1), 0.45)) dest.copy(t.pos).addScaledVector(_a.subVectors(f.pos, t.pos).setY(0).normalize(), 1.5);
    this.afterimage(f, m, from, dest.clone().setY(dest.y + 1));
    f.pos.copy(dest);
    f.vel.set(0, Math.min(0, f.vel.y), 0);
    f.hooks.forEach((h) => {
      if (h.state !== 'idle') h.state = 'retract';
    });
    this.endAction(f);
    this.startAction(f, 'phantom', 0.5, Math.atan2(t.pos.x - dest.x, t.pos.z - dest.z));
    this.phantomTarget = t;
    f.anim.play('phantom', { fadeIn: 0.0 });
    f.invuln = Math.max(f.invuln, 0.2);
    m.broadcastAction(f, { a: 'phantom', p: [from.x, from.y, from.z], d: [dest.x, dest.y + 1, dest.z], t: t.id });
    return true;
  }
  private phantomTarget: Fighter | null = null;

  private startUlt(f: Fighter, m: MatchContext): void {
    this.startAction(f, 'ult', 1.75);
    this.barrage = 8;
    this.barrageT = 0.05;
    this.barrageIdx = 0;
    f.invuln = Math.max(f.invuln, 1.8);
    m.audio.play('ult', f.pos, 1);
    m.vfx.ring(f.pos.clone().setY(f.pos.y + 0.1), new THREE.Vector3(0, 1, 0), f.champ.colors[1], 0.5, 5, 0.5);
    m.broadcastAction(f, { a: 'ult' });
  }

  protected tickAction(f: Fighter, _it: Intent, dt: number, m: MatchContext): void {
    if (this.act === 'c4' || this.act === 'cRemote4') this.spin = Math.min(1, this.actT / 0.38) * 360;
    if (this.act === 'air') f.ctrl.gravityScale = 0.6;
    if (this.act === 'ult') {
      f.ctrl.noHooks = true;
      f.ctrl.lockMove = 0.1;
      f.ctrl.gravityScale = 0.15;
      f.vel.multiplyScalar(Math.exp(-6 * dt));
      this.barrageT -= dt;
      if (this.barrage > 0 && this.barrageT <= 0) {
        this.barrageT = 0.2;
        this.barrage--;
        this.barrageStrike(f, m);
      }
    }
  }

  private barrageStrike(f: Fighter, m: MatchContext): void {
    const enemies = m.fighters.filter((o) => o !== f && o.alive && (o.team === 0 || o.team !== f.team) && o.pos.distanceTo(f.pos) < 16);
    const clipName = ['c1', 'c2', 'c3'][this.barrageIdx % 3];
    this.barrageIdx++;
    f.anim.play(clipName, { speed: 1.8, fadeIn: 0.0 });
    this.setTrail(f, true);
    m.audio.play('swing', f.pos, 0.9);
    if (!enemies.length) {
      this.spin = (this.spin + 120) % 360;
      return;
    }
    const t = enemies[this.barrageIdx % enemies.length];
    const ang = Math.random() * Math.PI * 2;
    const from = f.chest(new THREE.Vector3());
    const dest = t.pos.clone().add(new THREE.Vector3(Math.cos(ang) * 1.6, 0.1, Math.sin(ang) * 1.6));
    if (m.world.overlapsSphere(_w.copy(dest).setY(dest.y + 1), 0.45)) dest.copy(f.pos);
    f.pos.copy(dest);
    this.faceYaw = Math.atan2(t.pos.x - dest.x, t.pos.z - dest.z);
    m.vfx.beam(from, dest.clone().setY(dest.y + 1), this.barrageIdx % 2 ? f.champ.colors[0] : f.champ.colors[1], 0.1, 0.18);
    if (m.isAuthority(f)) {
      const kb = _a.subVectors(t.pos, f.pos).setY(0).normalize().multiplyScalar(2).clone();
      kb.y = 2;
      m.reportHit(f, t, { slot: 'ult', part: 'hit', at: t.chest(new THREE.Vector3()), kb, stun: 0.25, blockable: false });
    }
  }

  protected endAction(f: Fighter): void {
    if (this.act === 'ult') this.setTrail(f, false);
    super.endAction(f);
  }

  onAnimEvent(f: Fighter, ev: string, m: MatchContext): void {
    if (!this.act) return;
    if (ev === 'swing') {
      this.setTrail(f, true);
      m.audio.play('swing', f.pos, 0.8);
    } else if (ev === 'hitOn') {
      if (this.act === 'phantom') {
        const t = this.phantomTarget;
        if (t && t.alive && t.pos.distanceTo(f.pos) < 4.5 && m.isAuthority(f)) {
          m.reportHit(f, t, { slot: 'abi', part: 'cut', crit: true, at: t.chest(new THREE.Vector3()), kb: _a.subVectors(t.pos, f.pos).setY(0).normalize().multiplyScalar(7).setY(4).clone(), stun: 0.4, blockable: false });
        }
        return;
      }
      if (this.act === 'ult' || this.act === 'glitch') return;
      const part = this.act === 'air' ? 'air' : this.act;
      this.hitActive = {
        slot: 'atk',
        part,
        range: this.act === 'c4' ? 3.0 : 2.8,
        arc: this.act === 'c4' ? 180 : 70,
        kb: this.act === 'c4' ? 8 : 3,
        kbUp: this.act === 'air' ? 9 : this.act === 'c4' ? 5 : 1,
        stun: this.act === 'c4' ? 0.3 : 0.1,
      };
    } else if (ev === 'hitOff') {
      this.hitActive = null;
      if (this.act !== 'ult') this.setTrail(f, false);
    }
  }

  playRemote(f: Fighter, e: ActionEvent, m: MatchContext): void {
    switch (e.a) {
      case 'c1':
      case 'c2':
      case 'c3':
      case 'c4':
      case 'air':
        f.anim.play(e.a, { fadeIn: 0.03 });
        this.act = e.a === 'c4' ? 'cRemote4' : 'remote';
        this.actT = 0;
        this.actDur = DUR[e.a] ?? 0.4;
        break;
      case 'glitch':
        if (e.p && e.d) this.afterimage(f, m, new THREE.Vector3(...e.p), new THREE.Vector3(...e.d));
        f.anim.play('glitch', { fadeIn: 0, fadeOut: 0.12 });
        // the puppet is invulnerable too, so attackers here don't predict a hit the server rejects
        f.invuln = Math.max(f.invuln, 0.25);
        break;
      case 'phantom':
        if (e.p && e.d) this.afterimage(f, m, new THREE.Vector3(...e.p), new THREE.Vector3(...e.d));
        f.anim.play('phantom', { fadeIn: 0 });
        f.invuln = Math.max(f.invuln, 0.2);
        this.act = 'remote';
        this.actT = 0;
        this.actDur = 0.5;
        break;
      case 'ult':
        f.invuln = Math.max(f.invuln, 1.8);
        m.audio.play('ult', f.pos, 1);
        this.act = 'ultRemote';
        this.actT = 0;
        this.actDur = 1.75;
        this.setTrail(f, true);
        break;
      default:
        break;
    }
  }

  tickRemote(f: Fighter, dt: number): void {
    if (!this.act) return;
    this.actT += dt;
    if (this.act === 'cRemote4') this.spin = Math.min(1, this.actT / 0.38) * 360;
    if (this.act === 'ultRemote' && Math.floor(this.actT / 0.2) !== Math.floor((this.actT - dt) / 0.2)) {
      f.anim.play(['c1', 'c2', 'c3'][Math.floor(this.actT / 0.2) % 3], { speed: 1.8, fadeIn: 0 });
    }
    if (this.actT > this.actDur) this.endAction(f);
  }
}
