import * as THREE from 'three';
import { BaseKit } from '../BaseKit';
import type { Fighter } from '../../game/Fighter';
import { forwardOf } from '../../game/Fighter';
import { Shape } from '../../vfx/Particles';
import type { ActionEvent, Intent, MatchContext } from '../../game/types';
import { CAPSULE_R, capsule, segSegDist2 } from '../Projectiles';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Power Chord wave: length, half width, and where the sweet spot starts */
const CHORD_LEN = 8.2;
const CHORD_HALF_W = 1.15;
const CHORD_TIP = 5.4;

/**
 * KAISER — greatsword bruiser.
 * Skill: Power Chord (overhead slam, forward shock wave with a sweet spot at the tip) ·
 * Attack: 3-hit Verse Combo (air: spin Cleave) · Secondary: Mute Guard (parry window) ·
 * F: Drop Dive (piercing lunge along the aim, can dive from the air) · R: Encore Break.
 */
export class KaiserKit extends BaseKit {
  private combo = 0;
  private comboTimer = 0;
  private queued = false;
  private guardCd = 0;
  private diveDir = new THREE.Vector3();
  private ultPhase: 'rise' | 'slam' | null = null;
  /** the running air cleave got the airtime's lift (hangs with low gravity) */
  private airHang = false;
  /** Power Chord: direction of the wave, picked when the slam starts */
  private chordDir = new THREE.Vector3();

  constructor() {
    super('kaiser');
  }

  protected handleInput(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    this.comboTimer -= dt;
    this.guardCd = Math.max(0, this.guardCd - dt);
    if (this.comboTimer <= 0 && !this.act) this.combo = 0;

    // ---- guard (hold the secondary key) -----------------------------------------------------
    if (f.guard) {
      if (!it.secondary || this.act) {
        f.guard = false;
        f.anim.action.stop(0.12);
        this.guardCd = 0.5;
      } else {
        f.ctrl.speedMul = 0.42;
        f.ctrl.noDash = false;
        this.faceYaw = f.aimYaw;
        return;
      }
    }
    if (it.secondaryPressed && !this.act && this.guardCd <= 0) {
      f.guard = true;
      f.guardStart = m.time;
      f.anim.play('guard', { hold: true, fadeIn: 0.05 });
      m.broadcastAction(f, { a: 'guard', n: 1 });
      m.audio.play('block', f.pos, 0.35);
      return;
    }

    // ---- ultimate -----------------------------------------------------------------------------
    if (it.ultimatePressed && !this.act && this.useUlt(f, m)) {
      this.startUlt(f, m);
      m.broadcastAction(f, { a: 'ult' });
      return;
    }

    // ---- signature: Power Chord --------------------------------------------------------------
    if ((!this.act || this.act.startsWith('atk')) && this.skillReady()) {
      this.startChord(f, m);
      return;
    }

    // ---- ability: Drop Dive ----------------------------------------------------------------
    if (it.abilityPressed && this.cd.abi <= 0 && (!this.act || this.act.startsWith('atk'))) {
      this.startDive(f, m, it.aimDir);
      m.broadcastAction(f, { a: 'dive', d: [this.diveDir.x, this.diveDir.y, this.diveDir.z] });
      return;
    }

    // ---- basic attacks ----------------------------------------------------------------------------
    if (it.attackPressed) {
      if (this.act && this.act.startsWith('atk') && this.actT > this.actDur * 0.45) this.queued = true;
      else if (!this.act) this.attack(f, m);
    }
    if (!this.act && this.queued) this.attack(f, m);
  }

  private attack(f: Fighter, m: MatchContext): void {
    this.queued = false;
    if (!f.grounded) {
      if (this.cd.atk > 0) return;
      this.startAction(f, 'atkAir', 0.5);
      f.anim.play('air', { speed: 1, fadeIn: 0.04 });
      const t = this.findTarget(f, m, 9, 40);
      // only the first cleave of a jump homes vertically and hangs; the rest fall normally
      this.airHang = this.takeAirLift();
      this.magnet(f, t, 16, 1.8, this.airHang);
      if (this.airHang) f.vel.y = Math.max(f.vel.y, 2);
      this.cd.atk = 0.62;
      this.setTrail(f, true);
      m.audio.play('swingHeavy', f.pos, 0.9);
      m.broadcastAction(f, { a: 'atkAir' });
      return;
    }
    const n = (this.combo % 3) + 1;
    this.combo = n;
    this.comboTimer = 0.95;
    const durs = [0.5, 0.48, 0.74];
    this.startAction(f, `atk${n}`, durs[n - 1]);
    f.anim.play(`atk${n}`, { fadeIn: n === 1 ? 0.06 : 0.03 });
    const t = this.findTarget(f, m, 7.5, 35);
    this.magnet(f, t, n === 3 ? 13 : 10);
    f.ctrl.lockMove = durs[n - 1] * 0.7;
    m.broadcastAction(f, { a: `atk${n}` });
  }

  private startChord(f: Fighter, m: MatchContext): void {
    this.cd.sig = this.data.abilities.sig.cooldown;
    this.queued = false;
    this.combo = 0;
    this.startAction(f, 'chord', 0.85);
    f.anim.play('chord', { fadeIn: 0.05 });
    // aim the wave at the enemy under the crosshair, else straight along the aim
    const t = this.findTarget(f, m, CHORD_LEN + 1, 18);
    if (t) this.chordDir.subVectors(t.pos, f.pos);
    else this.chordDir.copy(f.intent.aimDir);
    if (f.grounded) this.chordDir.y = 0;
    else this.chordDir.y = THREE.MathUtils.clamp(this.chordDir.y, -0.8 * this.chordDir.length(), 0.3 * this.chordDir.length());
    if (this.chordDir.lengthSq() < 1e-4) forwardOf(f.aimYaw, this.chordDir);
    this.chordDir.normalize();
    this.faceYaw = Math.atan2(this.chordDir.x, this.chordDir.z);
    f.ctrl.lockMove = 0.55;
    m.broadcastAction(f, { a: 'chord', d: [this.chordDir.x, this.chordDir.y, this.chordDir.z] });
  }

  /** the slam lands: shock wave along chordDir; the far end is the sweet spot */
  private chordWave(f: Fighter, m: MatchContext, dir: THREE.Vector3, authority: boolean): void {
    const [c0, c1] = f.champ.colors;
    const start = f.pos.clone().addScaledVector(dir, 1.0);
    start.y += f.grounded ? 0.08 : 0.9;
    // impact: rings and sparks only (no dust cloud), so the target stays readable
    m.vfx.ring(start.clone().setY(start.y + 0.05), UP, c0, 0.4, 2.4, 0.4);
    m.vfx.ring(start.clone().setY(start.y + 0.08), UP, 0xffffff, 0.3, 1.5, 0.3);
    this.sparks(m, start, dir, c0, c1, 10);
    m.audio.play('slam', start, 0.9);
    m.shake(0.45, start);
    m.hitStop(0.05);
    // the wave front runs out over ~0.16 s; the tip lights up the sweet spot
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const d = (i / steps) * CHORD_LEN;
      const p = start.clone().addScaledVector(dir, d - 0.6);
      const tip = d >= CHORD_TIP;
      this.later(m, i * 0.026, () => {
        // a vertical sound-wave front rolling forward, plus a ground ripple
        m.vfx.ring(p.clone().setY(p.y + 0.8), dir, i % 2 ? c0 : c1, 0.5, tip ? 2.1 : 1.5, 0.24);
        m.vfx.ring(p, UP, i % 2 ? c1 : c0, 0.3, tip ? 2.0 : 1.3, 0.3);
        for (let k = 0; k < 4; k++) {
          const s = (Math.random() - 0.5) * CHORD_HALF_W * 2;
          m.vfx.add.emit({ pos: p.clone().add(new THREE.Vector3(-dir.z * s, 0.1, dir.x * s)), vel: new THREE.Vector3((Math.random() - 0.5) * 2, 5 + Math.random() * 6, (Math.random() - 0.5) * 2), life: 0.35 + Math.random() * 0.2, size: 0.12, size1: 0.02, color: tip ? c1 : c0, shape: Shape.shard, drag: 2 });
        }
        if (i === steps) {
          // the sweet spot: a bright flash and a spray of sparks
          m.vfx.add.emit({ pos: p.clone().setY(p.y + 0.7), life: 0.16, size: 0.5, size1: 2.2, color: 0xffffff, shape: Shape.glow });
          m.vfx.add.emit({ pos: p.clone().setY(p.y + 0.7), life: 0.3, size: 0.7, size1: 2.6, color: c1, shape: Shape.glow, alpha: 0.75 });
          this.sparks(m, p, dir, c1, 0xffffff, 16);
          m.vfx.ring(p.clone().setY(p.y + 0.9), dir, 0xffffff, 0.6, 2.8, 0.3);
          m.vfx.ring(p.clone().setY(p.y + 0.05), UP, 0xffffff, 0.4, 3, 0.4);
          m.audio.play('explosion', p, 0.7);
        }
      });
    }
    m.vfx.beam(start, start.clone().addScaledVector(dir, CHORD_LEN), c0, 0.5, 0.22);
    if (!authority) return;
    // damage: a capsule along the wave; targets past CHORD_TIP take the sweet-spot hit
    const a = start.clone().setY(start.y + (f.grounded ? 0.9 : 0));
    const b = a.clone().addScaledVector(dir, CHORD_LEN);
    for (const o of m.fighters) {
      if (o === f || !o.alive) continue;
      if (o.team !== 0 && o.team === f.team) continue;
      capsule(o, _c1, _c2);
      if (segSegDist2(a, b, _c1, _c2, _a, _b) > (CAPSULE_R + CHORD_HALF_W) ** 2) continue;
      if (m.world.raycast(a, _v.subVectors(_b, a).normalize(), a.distanceTo(_b))) continue;
      const tip = _a.distanceTo(a) >= CHORD_TIP;
      const kb = dir.clone().setY(0).normalize().multiplyScalar(tip ? 7 : 5);
      kb.y = tip ? 13 : 3;
      m.reportHit(f, o, { slot: 'sig', part: tip ? 'tip' : 'wave', kb, stun: tip ? 0.4 : 0.15, at: _b.clone(), blockable: true });
    }
  }

  private sparks(m: MatchContext, at: THREE.Vector3, dir: THREE.Vector3, ca: THREE.ColorRepresentation, cb: THREE.ColorRepresentation, n: number): void {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 8, 4 + Math.random() * 9, (Math.random() - 0.5) * 8).addScaledVector(dir, 4);
      m.vfx.add.emit({ pos: at.clone().setY(at.y + 0.3), vel: v, life: 0.25 + Math.random() * 0.25, size: 0.1, color: i % 2 ? ca : cb, shape: Shape.streak, drag: 2.5, stretch: 2 });
    }
  }

  private startDive(f: Fighter, m: MatchContext, aim: THREE.Vector3): void {
    this.cd.abi = this.data.abilities.abi.cooldown;
    this.startAction(f, 'dive', 0.62);
    f.anim.play('dive', { fadeIn: 0.03 });
    const t = this.findTarget(f, m, 22, 14);
    if (t) this.diveDir.subVectors(t.chest(_v), f.chest(_d)).normalize();
    else this.diveDir.copy(aim).normalize();
    if (f.grounded && this.diveDir.y < 0) this.diveDir.y = 0;
    this.diveDir.normalize();
    this.faceYaw = Math.atan2(this.diveDir.x, this.diveDir.z);
    this.setTrail(f, true);
    m.audio.play('dash', f.pos, 1);
    m.audio.play('swingHeavy', f.pos, 1);
    m.vfx.gasBurst(f.nozzleWorld(_v), f.champ.colors[0]);
  }

  private startUlt(f: Fighter, m: MatchContext): void {
    this.startAction(f, 'ult', 2.2);
    this.ultPhase = 'rise';
    f.anim.play('ultRise', { hold: true, fadeIn: 0.05 });
    f.vel.set(f.vel.x * 0.2, 17, f.vel.z * 0.2);
    f.grounded = false;
    f.hooks.forEach((h) => (h.state = h.state === 'attached' ? 'retract' : h.state));
    m.audio.play('ult', f.pos, 1);
    m.vfx.gasBurst(f.nozzleWorld(_v), f.champ.colors[0]);
    m.vfx.ring(f.pos.clone().setY(f.pos.y + 0.1), new THREE.Vector3(0, 1, 0), f.champ.colors[0], 0.5, 4, 0.5);
  }

  protected tickAction(f: Fighter, _it: Intent, dt: number, m: MatchContext): void {
    switch (this.act) {
      case 'chord': {
        f.ctrl.noHooks = this.actT < 0.3;
        if (!f.grounded) f.ctrl.gravityScale = this.actT < 0.25 ? 0.25 : 1;
        break;
      }
      case 'atkAir': {
        if (this.airHang) f.ctrl.gravityScale = 0.35;
        this.spin = Math.min(1, this.actT / 0.4) * 360;
        break;
      }
      case 'dive': {
        f.ctrl.noHooks = true;
        if (this.actT < 0.4) {
          f.ctrl.gravityScale = 0;
          f.vel.copy(this.diveDir).multiplyScalar(this.actT < 0.06 ? 10 : 38);
          if (this.actT >= 0.06) this.hitActive = { slot: 'abi', part: 'dive', range: 2.0, arc: 180, height: 2.4, kb: 9, kbUp: 6, stun: 0.25 };
          // stop on walls
          if (this.actT > 0.1 && m.world.overlapsSphere(_v.copy(f.pos).setY(f.pos.y + 1).addScaledVector(this.diveDir, 1.0), 0.5)) this.actT = 0.4;
        } else {
          this.hitActive = null;
          f.vel.multiplyScalar(Math.exp(-8 * dt));
          f.ctrl.lockMove = 0.05;
        }
        break;
      }
      case 'ult': {
        f.ctrl.noHooks = true;
        f.ctrl.lockMove = 0.1;
        if (this.ultPhase === 'rise') {
          f.ctrl.gravityScale = 0.6;
          if (this.actT > 0.5 || f.vel.y < 0) {
            this.ultPhase = 'slam';
            f.anim.play('ultSlam', { speed: 0.001, hold: true, fadeIn: 0.02 });
            const t = this.findTarget(f, m, 30, 35);
            _d.set(0, -1, 0);
            if (t) _d.subVectors(t.pos, f.pos).normalize();
            else {
              forwardOf(f.aimYaw, _v);
              _d.addScaledVector(_v, 0.35).normalize();
            }
            if (_d.y > -0.4) {
              _d.y = -0.4;
              _d.normalize();
            }
            f.vel.copy(_d).multiplyScalar(48);
            this.faceYaw = Math.atan2(_d.x, _d.z);
            this.setTrail(f, true);
          }
        } else if (this.ultPhase === 'slam') {
          f.ctrl.gravityScale = 1.5;
          if (f.grounded || this.actT > 1.6) {
            this.ultPhase = null;
            this.actT = Math.max(this.actT, 1.4);
            this.actDur = this.actT + 0.7;
            f.anim.play('ultSlam', { offset: 0.12, fadeIn: 0.0 });
            f.vel.set(0, 0, 0);
            const c = f.pos.clone();
            m.broadcastAction(f, { a: 'ultSlam' });
            m.vfx.shockwave(c, 11, f.champ.colors[0]);
            m.vfx.shockwave(c, 7, f.champ.colors[1]);
            m.vfx.explosion(c.clone().setY(c.y + 0.5), 4, f.champ.colors[0], f.champ.colors[1]);
            m.audio.play('slam', c, 1.2);
            m.shake(0.9, c);
            m.hitStop(0.1);
            this.aoe(f, m, c, 9, 'ult', 'slam', { kb: 12, kbUp: 15, stun: 0.6, falloff: true });
            this.setTrail(f, false);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  protected endAction(f: Fighter): void {
    this.ultPhase = null;
    super.endAction(f);
  }

  onAnimEvent(f: Fighter, ev: string, m: MatchContext): void {
    const isAtk = this.act?.startsWith('atk');
    if (ev === 'swing') {
      this.setTrail(f, true);
      m.audio.play(this.act === 'atk3' || this.act === 'chord' ? 'swingHeavy' : 'swing', f.pos, 0.9);
    } else if (ev === 'hitOn' && isAtk) {
      const parts: Record<string, string> = { atk1: 'c1', atk2: 'c2', atk3: 'c3', atkAir: 'air' };
      const part = parts[this.act!] ?? 'c1';
      this.hitActive = {
        slot: 'atk',
        part,
        range: this.act === 'atkAir' ? 3.4 : 3.2,
        arc: this.act === 'atkAir' ? 180 : 75,
        kb: this.act === 'atk3' ? 10 : 4,
        kbUp: this.act === 'atk3' ? 6 : 1.5,
        stun: this.act === 'atk3' ? 0.35 : 0.12,
      };
    } else if (ev === 'hitOff') {
      this.hitActive = null;
      if (this.act !== 'atkAir') this.setTrail(f, false);
    } else if (ev === 'chord' && this.act === 'chord') {
      this.chordWave(f, m, this.chordDir, true);
      this.later(m, 0.15, () => {
        if (this.act === 'chord') this.setTrail(f, false);
      });
    } else if (ev === 'slam' && this.act === 'atk3') {
      forwardOf(this.faceYaw ?? f.facing, _v);
      const c = f.pos.clone().addScaledVector(_v, 2.2);
      m.vfx.shockwave(c, 4, f.champ.colors[0]);
      m.audio.play('slam', c, 0.7);
      m.shake(0.3, c);
      this.aoe(f, m, c, 3.2, 'atk', 'shock', { kb: 6, kbUp: 7 });
    }
  }

  playRemote(f: Fighter, e: ActionEvent, m: MatchContext): void {
    switch (e.a) {
      case 'atk1':
      case 'atk2':
      case 'atk3':
        f.anim.play(e.a, { fadeIn: 0.04 });
        this.act = e.a;
        this.actT = 0;
        this.actDur = 0.6;
        this.faceYaw = null;
        break;
      case 'atkAir':
        f.anim.play('air');
        this.act = 'atkAirRemote';
        this.actT = 0;
        this.actDur = 0.5;
        this.setTrail(f, true);
        break;
      case 'chord':
        f.anim.play('chord', { fadeIn: 0.04 });
        this.act = 'chordRemote';
        this.actT = 0;
        this.actDur = 0.85;
        this.chordDir.set(...(e.d ?? [0, 0, 1]));
        break;
      case 'guard':
        if (e.n) f.anim.play('guard', { hold: true });
        else f.anim.action.stop(0.12);
        break;
      case 'dive':
        f.anim.play('dive');
        this.act = 'diveRemote';
        this.actT = 0;
        this.actDur = 0.6;
        this.setTrail(f, true);
        m.audio.play('swingHeavy', f.pos, 1);
        break;
      case 'ult':
        f.anim.play('ultRise', { hold: true });
        m.audio.play('ult', f.pos, 1);
        break;
      case 'ultSlam':
        f.anim.play('ultSlam', { offset: 0.12 });
        m.vfx.shockwave(f.pos, 11, f.champ.colors[0]);
        m.audio.play('slam', f.pos, 1.2);
        m.shake(0.6, f.pos);
        break;
      default:
        break;
    }
  }

  tickRemote(f: Fighter, dt: number, m: MatchContext): void {
    this.tickFx(m);
    if (!this.act) return;
    const before = this.actT;
    this.actT += dt;
    // the slam lands at the clip's 'chord' event time
    if (this.act === 'chordRemote' && before < 0.25 && this.actT >= 0.25) this.chordWave(f, m, this.chordDir, false);
    if (this.act === 'atkAirRemote') this.spin = Math.min(1, this.actT / 0.4) * 360;
    if (this.actT > this.actDur) this.endAction(f);
  }
}
