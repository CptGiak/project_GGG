import * as THREE from 'three';
import { BaseKit, type MeleeHit } from '../BaseKit';
import type { Fighter } from '../../game/Fighter';
import { forwardOf } from '../../game/Fighter';
import type { ActionEvent, Intent, MatchContext } from '../../game/types';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _w = new THREE.Vector3();

/** after a close perfect parry, LMB within this window (s) is the Riposte */
const RIPOSTE_WINDOW = 1.0;
/** a landed Riposte takes this much (s) off Drop Dive's cooldown */
const RIPOSTE_DIVE_REFUND = 3;

/**
 * KAISER — greatsword bruiser.
 * LMB: 3-hit Verse Combo (air: spin Cleave) · RMB: Mute Guard (parry window; a close perfect
 * parry opens the Riposte: LMB lunges into an unblockable counter crit) · F: Drop Dive
 * (piercing lunge along the aim, can dive from the air) · R: Encore Break.
 */
export class KaiserKit extends BaseKit {
  private combo = 0;
  private comboTimer = 0;
  private queued = false;
  private guardCd = 0;
  private diveDir = new THREE.Vector3();
  private ultPhase: 'rise' | 'slam' | null = null;
  /** Riposte window left after a close perfect parry, and who to lunge at */
  riposteT = 0;
  private riposteTarget: Fighter | null = null;

  constructor() {
    super('kaiser');
  }

  onParry(f: Fighter, attacker: Fighter, m: MatchContext, close: boolean): void {
    if (!close) return;
    this.riposteT = RIPOSTE_WINDOW;
    this.riposteTarget = attacker;
    m.audio.play('perfectTick', f.pos, 0.9);
  }

  protected handleInput(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    this.comboTimer -= dt;
    this.guardCd = Math.max(0, this.guardCd - dt);
    this.riposteT = Math.max(0, this.riposteT - dt);
    if (this.comboTimer <= 0 && !this.act) this.combo = 0;

    // ---- riposte (LMB right after a close perfect parry, straight out of the guard) ---------
    if (this.riposteT > 0 && it.attackPressed && !this.act) {
      if (f.guard) this.dropGuard(f, m);
      this.startRiposte(f, m);
      return;
    }

    // ---- guard (hold RMB) ------------------------------------------------------------------
    if (f.guard) {
      if (!it.secondary || this.act) {
        this.dropGuard(f, m);
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

  private dropGuard(f: Fighter, m: MatchContext): void {
    f.guard = false;
    f.anim.action.stop(0.12);
    this.guardCd = 0.5;
    m.broadcastAction(f, { a: 'guard', n: 0 });
  }

  /** Riposte: a short homing lunge at whoever was parried; the parry's counter window makes it crit */
  private startRiposte(f: Fighter, m: MatchContext): void {
    this.riposteT = 0;
    const t = this.riposteTarget?.alive ? this.riposteTarget : this.findTarget(f, m, 12, 40);
    this.riposteTarget = t;
    this.startAction(f, 'riposte', 0.5);
    f.anim.play('dive', { fadeIn: 0.02, speed: 1.25 });
    if (t) this.diveDir.subVectors(t.chest(_v), f.chest(_d)).normalize();
    else this.diveDir.copy(f.intent.aimDir).normalize();
    this.faceYaw = Math.atan2(this.diveDir.x, this.diveDir.z);
    this.setTrail(f, true);
    m.audio.play('slice', f.pos, 1);
    m.audio.play('dash', f.pos, 0.8);
    m.vfx.gasBurst(f.nozzleWorld(_v), f.champ.colors[1]);
    m.vfx.dashLines(f, this.diveDir);
    m.broadcastAction(f, { a: 'riposte', d: [this.diveDir.x, this.diveDir.y, this.diveDir.z] });
  }

  protected onSweepHit(_f: Fighter, _o: Fighter, h: MeleeHit): void {
    if (h.part === 'riposte') this.cd.abi = Math.max(0, this.cd.abi - RIPOSTE_DIVE_REFUND);
  }

  private attack(f: Fighter, m: MatchContext): void {
    this.queued = false;
    if (!f.grounded) {
      if (this.cd.atk > 0) return;
      this.startAction(f, 'atkAir', 0.5);
      f.anim.play('air', { speed: 1, fadeIn: 0.04 });
      const t = this.findTarget(f, m, 9, 40);
      this.magnet(f, t, 16, 1.8, true);
      f.vel.y = Math.max(f.vel.y, 2);
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
      case 'riposte': {
        f.ctrl.noHooks = true;
        if (this.actT < 0.32) {
          f.ctrl.gravityScale = 0;
          // home in on the parried attacker (they are stunned), stop just in front of them
          const t = this.riposteTarget;
          let d = 99;
          if (t && t.alive) {
            _d.subVectors(t.chest(_v), f.chest(_w));
            d = _d.length();
            if (d > 0.05) this.diveDir.copy(_d).divideScalar(d);
          }
          f.vel.copy(this.diveDir).multiplyScalar(d > 1.8 ? 24 : 3);
          this.faceYaw = Math.atan2(this.diveDir.x, this.diveDir.z);
          if (this.actT >= 0.04) this.hitActive = { slot: 'sec', part: 'riposte', range: 2.6, arc: 110, height: 2.4, kb: 10, kbUp: 5, stun: 0.3, blockable: false };
        } else {
          this.hitActive = null;
          f.vel.multiplyScalar(Math.exp(-9 * dt));
          f.ctrl.lockMove = 0.05;
        }
        break;
      }
      case 'atkAir': {
        f.ctrl.gravityScale = 0.35;
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
      m.audio.play(this.act === 'atk3' ? 'swingHeavy' : 'swing', f.pos, 0.9);
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
      case 'riposte':
        f.anim.play('dive', { speed: 1.25 });
        this.act = 'diveRemote';
        this.actT = 0;
        this.actDur = 0.5;
        this.setTrail(f, true);
        m.audio.play('slice', f.pos, 1);
        if (e.d) m.vfx.dashLines(f, new THREE.Vector3(...e.d));
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

  tickRemote(f: Fighter, dt: number): void {
    if (!this.act) return;
    this.actT += dt;
    if (this.act === 'atkAirRemote') this.spin = Math.min(1, this.actT / 0.4) * 360;
    if (this.actT > this.actDur) this.endAction(f);
  }
}
