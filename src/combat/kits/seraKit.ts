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
const UP = new THREE.Vector3(0, 1, 0);

/**
 * SERA — holo diva caster.
 * LMB: Note Orb (homing) · RMB: Resonance (channelled beam, slows) · F: Echo Wave (knockback
 * ring) · R: Grand Finale (spotlight pillar at the aimed point + self heal).
 */
export class SeraKit extends BaseKit {
  private fireT = 0;
  private aimHold = 0;
  private channel = 0;
  private tickT = 0;
  private finale: THREE.Vector3 | null = null;
  private finaleT = 0;
  /** remote: channel visual on */
  private remoteChannel = false;

  constructor() {
    super('sera');
  }

  facesAim(f: Fighter): boolean {
    return this.aimHold > 0 || this.channel > 0 || super.facesAim(f);
  }

  private muzzle(f: Fighter, out: THREE.Vector3): THREE.Vector3 {
    return f.visual.muzzle ? f.visual.muzzle.getWorldPosition(out) : f.chest(out);
  }

  protected handleInput(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    this.fireT -= dt;
    this.aimHold = Math.max(0, this.aimHold - dt);
    if (this.act === 'ult') return;

    if (it.ultimatePressed && !this.act && this.channel <= 0 && this.useUlt(f, m)) {
      const { point } = this.aimPoint(f, m, this.data.abilities.ult.range);
      // drop the target onto the ground below the aim point
      const g = m.world.raycast(point.clone().setY(point.y + 0.5), new THREE.Vector3(0, -1, 0), 80);
      this.finale = g ? g.point.clone() : point.clone();
      this.finaleT = 1.05;
      this.startAction(f, 'ult', 1.4);
      f.anim.play('ult', { fadeIn: 0.06 });
      m.audio.play('ult', f.pos, 1);
      m.broadcastAction(f, { a: 'ult', p: [this.finale.x, this.finale.y, this.finale.z] });
      return;
    }
    if (it.abilityPressed && this.cd.abi <= 0 && !this.act && this.channel <= 0) {
      this.cd.abi = this.data.abilities.abi.cooldown;
      this.startAction(f, 'wave', 0.5);
      f.anim.play('wave', { fadeIn: 0.04 });
      m.broadcastAction(f, { a: 'wave' });
      return;
    }
    // channelled beam
    if (this.channel > 0) {
      this.channel -= dt;
      f.ctrl.aim = 1;
      f.ctrl.speedMul = 0.45;
      this.tickT -= dt;
      const end = this.beamUpdate(f, m, this.tickT <= 0);
      if (this.tickT <= 0) this.tickT = 0.1;
      void end;
      if (!it.secondary || this.channel <= 0) this.stopChannel(f, m);
      return;
    }
    if (it.secondaryPressed && this.cd.sec <= 0 && !this.act) {
      this.channel = 2.2;
      this.tickT = 0;
      f.anim.play('aim', { hold: true, fadeIn: 0.06 });
      m.audio.play('beam', f.pos, 0.8);
      m.broadcastAction(f, { a: 'res', n: 1 });
      return;
    }
    if (it.attack && !this.act) {
      f.ctrl.aim = 1;
      this.aimHold = 0.5;
      if (this.fireT <= 0) {
        this.fireT = 1 / 2.6;
        f.anim.play('cast', { fadeIn: 0.03 });
        this.shoot(f, m);
      }
    } else {
      f.ctrl.aim = this.aimHold > 0 ? 1 : 0;
    }
  }

  private shoot(f: Fighter, m: MatchContext): void {
    const from = this.muzzle(f, new THREE.Vector3());
    const { point, fighter } = this.aimPoint(f, m, 160);
    const target = fighter ?? this.findTarget(f, m, 90, 5);
    const dir = point.clone().sub(from).normalize();
    m.projectiles.spawn({ owner: f, kind: 'orb', pos: from, vel: dir.clone().multiplyScalar(62), radius: 0.26, life: 2.2, slot: 'atk', part: 'orb', color: f.champ.colors[0], color2: f.champ.colors[1], homing: target ? { target, strength: 1.7 } : undefined, kb: 2 });
    m.vfx.muzzle(from, dir, f.champ.colors[0]);
    m.audio.play('orb', from, 0.8);
    m.broadcastAction(f, { a: 'orb', p: [from.x, from.y, from.z], d: [dir.x, dir.y, dir.z], t: target?.id });
  }

  /** draws the beam this frame; deals a tick if `tick` */
  private beamUpdate(f: Fighter, m: MatchContext, tick: boolean): THREE.Vector3 {
    const from = this.muzzle(f, new THREE.Vector3());
    let to: THREE.Vector3;
    if (f.simulated) {
      to = this.aimPoint(f, m, 45).point.clone();
    } else {
      _v.set(Math.sin(f.aimYaw) * Math.cos(f.aimPitch), Math.sin(f.aimPitch), Math.cos(f.aimYaw) * Math.cos(f.aimPitch));
      to = from.clone().addScaledVector(_v, 45);
    }
    const dir = _v.subVectors(to, from).normalize().clone();
    const wh = m.world.raycast(from, dir, from.distanceTo(to));
    if (wh) to.copy(wh.point);
    const [c0, c1] = f.champ.colors;
    m.vfx.beam(from, to, c0, 0.16 + Math.sin(m.time * 40) * 0.03, 0.07);
    m.vfx.beam(from, to, 0xffffff, 0.05, 0.07);
    if (Math.random() < 0.7) m.vfx.add.emit({ pos: to.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4), life: 0.25, size: 0.18, size1: 0.02, color: Math.random() < 0.5 ? c0 : c1, shape: Shape.star });
    if (Math.random() < 0.3) m.vfx.ring(from.clone().addScaledVector(dir, Math.random() * from.distanceTo(to)), dir, c1, 0.1, 0.5, 0.25);
    if (tick && m.isAuthority(f)) {
      for (const o of m.fighters) {
        if (o === f || !o.alive) continue;
        capsule(o, _c1, _c2);
        if (segSegDist2(from, to, _c1, _c2, _a, _b) < (CAPSULE_R + 0.35) ** 2) {
          m.reportHit(f, o, { slot: 'sec', part: 'tick', at: _a.clone(), slow: 0.5, blockable: true });
        }
      }
      m.audio.play('beam', from, 0.35);
    }
    return to;
  }

  private stopChannel(f: Fighter, m: MatchContext): void {
    this.channel = 0;
    this.cd.sec = this.data.abilities.sec.cooldown;
    f.anim.action.stop(0.15);
    this.aimHold = 0.2;
    m.broadcastAction(f, { a: 'res', n: 0 });
  }

  protected tickAction(f: Fighter, _it: Intent, dt: number, m: MatchContext): void {
    if (this.act === 'ult') {
      f.ctrl.speedMul = 0.25;
      f.ctrl.noHooks = true;
      if (this.finale) {
        this.finaleT -= dt;
        this.telegraph(f, m, this.finale, dt);
        if (this.finaleT <= 0) {
          this.pillar(f, m, this.finale, true);
          this.finale = null;
        }
      }
    }
    if (this.act === 'wave') f.ctrl.lockMove = 0.05;
  }

  private telegraph(f: Fighter, m: MatchContext, p: THREE.Vector3, dt: number): void {
    if (Math.random() < dt * 14) m.vfx.ring(p.clone().setY(p.y + 0.08), UP, f.champ.colors[0], 5.2, 4.6, 0.3);
    if (Math.random() < dt * 30) m.vfx.add.emit({ pos: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 9, 0.2, (Math.random() - 0.5) * 9)), vel: new THREE.Vector3(0, 6 + Math.random() * 6, 0), life: 0.6, size: 0.08, color: f.champ.colors[1], shape: Shape.streak, stretch: 3 });
    m.vfx.beam(p.clone().setY(p.y + 60), p, f.champ.colors[0], 2.6, 0.06);
  }

  private pillar(f: Fighter, m: MatchContext, p: THREE.Vector3, authority: boolean): void {
    const [c0, c1] = f.champ.colors;
    m.vfx.beam(p.clone().setY(p.y + 80), p, c0, 4.5, 0.6);
    m.vfx.beam(p.clone().setY(p.y + 80), p, 0xffffff, 2.0, 0.45);
    m.vfx.shockwave(p, 8, c0);
    m.vfx.explosion(p.clone().setY(p.y + 1), 5, c0, c1);
    m.audio.play('slam', p, 1.2);
    m.audio.play('explosion', p, 1);
    m.shake(0.7, p);
    if (authority) {
      this.aoe(f, m, p.clone().setY(p.y + 1), 5.2, 'ult', 'pillar', { kb: 6, kbUp: 18, stun: 0.5, falloff: true });
      m.reportHeal(f, 220);
    }
  }

  onAnimEvent(f: Fighter, ev: string, m: MatchContext): void {
    if (ev === 'wave' && this.act === 'wave') this.wave(f, m, true);
  }

  private wave(f: Fighter, m: MatchContext, authority: boolean): void {
    const c = f.pos.clone().setY(f.pos.y + 0.3);
    const [c0, c1] = f.champ.colors;
    m.vfx.ring(c, UP, c0, 0.5, 11, 0.5);
    m.vfx.ring(c.clone().setY(c.y + 0.6), UP, c1, 0.5, 9, 0.45);
    m.vfx.ring(c.clone().setY(c.y + 1.2), UP, 0xffffff, 0.3, 7, 0.4);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      m.vfx.add.emit({ pos: c.clone(), vel: new THREE.Vector3(Math.cos(a) * 16, 1, Math.sin(a) * 16), life: 0.5, size: 0.14, color: i % 2 ? c0 : c1, shape: Shape.star, drag: 2 });
    }
    m.audio.play('wave', c, 1);
    m.shake(0.25, c);
    if (authority) this.aoe(f, m, f.chest(new THREE.Vector3()), 9, 'abi', 'wave', { kb: 14, kbUp: 6, slow: 1.5 });
  }

  cancel(f: Fighter): void {
    if (this.channel > 0) {
      this.channel = 0;
      this.cd.sec = this.data.abilities.sec.cooldown;
    }
    this.finale = null;
    super.cancel(f);
  }

  playRemote(f: Fighter, e: ActionEvent, m: MatchContext): void {
    switch (e.a) {
      case 'orb': {
        const p = new THREE.Vector3(...(e.p ?? [0, 0, 0]));
        const d = new THREE.Vector3(...(e.d ?? [0, 0, 1]));
        const target = e.t ? m.fighters.find((x) => x.id === e.t) ?? null : null;
        m.projectiles.spawn({ owner: f, kind: 'orb', pos: p, vel: d.multiplyScalar(62), radius: 0.26, life: 2.2, slot: 'atk', part: 'orb', color: f.champ.colors[0], color2: f.champ.colors[1], homing: target ? { target, strength: 1.7 } : undefined, visualOnly: true });
        f.anim.play('cast', { fadeIn: 0.03 });
        m.audio.play('orb', p, 0.8);
        this.aimHold = 0.5;
        break;
      }
      case 'res':
        this.remoteChannel = !!e.n;
        if (e.n) f.anim.play('aim', { hold: true });
        else f.anim.action.stop(0.15);
        break;
      case 'wave':
        f.anim.play('wave');
        this.wave(f, m, false);
        break;
      case 'ult':
        f.anim.play('ult');
        m.audio.play('ult', f.pos, 1);
        if (e.p) {
          this.finale = new THREE.Vector3(...e.p);
          this.finaleT = 1.05;
        }
        break;
      default:
        break;
    }
  }

  tickRemote(f: Fighter, dt: number, m: MatchContext): void {
    this.aimHold = Math.max(0, this.aimHold - dt);
    f.ctrl.aim = this.aimHold > 0 || this.remoteChannel ? 1 : 0;
    if (this.remoteChannel) this.beamUpdate(f, m, false);
    if (this.finale) {
      this.finaleT -= dt;
      this.telegraph(f, m, this.finale, dt);
      if (this.finaleT <= 0) {
        this.pillar(f, m, this.finale, false);
        this.finale = null;
      }
    }
  }
}
