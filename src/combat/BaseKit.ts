import * as THREE from 'three';
import type { AbilitySlot } from '../../shared/champions';
import { CHAMPIONS } from '../../shared/champions';
import type { Fighter } from '../game/Fighter';
import { forwardOf } from '../game/Fighter';
import type { ActionEvent, Intent, Kit, MatchContext } from '../game/types';
import { CAPSULE_R, capsule, segSegDist2 } from './Projectiles';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

export interface MeleeHit {
  slot: AbilitySlot;
  part: string;
  range: number;
  /** half angle in degrees (180 = all around) */
  arc: number;
  height?: number;
  kb?: number;
  kbUp?: number;
  stun?: number;
  slow?: number;
  scale?: number;
}

/** Shared plumbing for champion kits: cooldowns, actions, melee sweeps, magnetism. */
export abstract class BaseKit implements Kit {
  spin = 0;
  charge = 0;
  protected cd: Record<AbilitySlot, number> = { atk: 0, sec: 0, abi: 0, ult: 0 };
  /** name of the running action, time in it */
  protected act: string | null = null;
  protected actT = 0;
  protected actDur = 0;
  /** melee: targets already hit during the current swing */
  protected swingHits = new Set<string>();
  protected hitActive: MeleeHit | null = null;
  protected trailOn = false;
  /** yaw the body should face during the action (null = aim yaw) */
  faceYaw: number | null = null;
  /**
   * One lifted air attack per airtime: it is refilled on the ground, on a wall or when a hook
   * bites, so mashing the attack button in the air can't keep a fighter afloat.
   */
  protected airLift = true;

  constructor(readonly champId: keyof typeof CHAMPIONS) {}

  get data() {
    return CHAMPIONS[this.champId];
  }

  update(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    for (const k of Object.keys(this.cd) as AbilitySlot[]) this.cd[k] = Math.max(0, this.cd[k] - dt);
    if (f.grounded || f.hooked || f.wallRun > 0) this.airLift = true;
    if (this.act) {
      this.actT += dt;
      this.tickAction(f, it, dt, m);
      if (this.act && this.actT >= this.actDur) this.endAction(f);
    }
    if (this.hitActive) this.sweep(f, this.hitActive, m);
    if (f.stun > 0) return;
    this.handleInput(f, it, dt, m);
  }

  protected abstract handleInput(f: Fighter, it: Intent, dt: number, m: MatchContext): void;
  protected tickAction(_f: Fighter, _it: Intent, _dt: number, _m: MatchContext): void {}

  protected startAction(f: Fighter, name: string, dur: number, faceYaw: number | null = null): void {
    this.act = name;
    this.actT = 0;
    this.actDur = dur;
    this.faceYaw = faceYaw;
    this.swingHits.clear();
    this.hitActive = null;
    void f;
  }

  protected endAction(f: Fighter): void {
    this.act = null;
    this.hitActive = null;
    this.faceYaw = null;
    this.setTrail(f, false);
    this.spin = 0;
  }

  onAnimEvent(f: Fighter, ev: string, m: MatchContext): void {
    void f;
    void ev;
    void m;
  }

  playRemote(f: Fighter, e: ActionEvent, m: MatchContext): void {
    void f;
    void e;
    void m;
  }

  cancel(f: Fighter): void {
    this.endAction(f);
    this.charge = 0;
    f.guard = false;
    f.ctrl.aim = 0;
  }

  /** spends the air lift if still available: true = this air attack may rise / hang */
  protected takeAirLift(): boolean {
    const ok = this.airLift;
    this.airLift = false;
    return ok;
  }

  facesAim(f: Fighter): boolean {
    return this.act !== null || f.ctrl.aim > 0;
  }

  cooldowns(): Record<AbilitySlot, number> {
    return { ...this.cd };
  }

  protected setTrail(f: Fighter, on: boolean): void {
    this.trailOn = on;
    f.trailOn = on;
  }

  // -------------------------------------------------------------------------------------------
  // targeting helpers
  // -------------------------------------------------------------------------------------------

  /** Best enemy near the crosshair / in front within range (for magnetism & target abilities). */
  findTarget(f: Fighter, m: MatchContext, maxDist: number, coneDeg: number, useCamera = true): Fighter | null {
    let best: Fighter | null = null;
    let bestScore = Infinity;
    const it = f.intent;
    const cos = Math.cos(THREE.MathUtils.degToRad(coneDeg));
    for (const o of m.fighters) {
      if (o === f || !o.alive) continue;
      if (o.team !== 0 && o.team === f.team) continue;
      o.chest(_v);
      const d = _v.distanceTo(f.pos);
      if (d > maxDist) continue;
      if (useCamera) {
        _w.subVectors(_v, it.aimOrigin).normalize();
        const dot = _w.dot(it.aimDir);
        if (dot < cos) continue;
        const score = (1 - dot) * 60 + d * 0.15;
        if (score < bestScore) {
          bestScore = score;
          best = o;
        }
      } else {
        forwardOf(f.aimYaw, _w);
        _a.subVectors(_v, f.pos).setY(0).normalize();
        const dot = _a.dot(_w);
        if (dot < cos) continue;
        const score = d * (2 - dot);
        if (score < bestScore) {
          bestScore = score;
          best = o;
        }
      }
    }
    return best;
  }

  /** Magnetism: face the target and lunge toward it, stopping at `stopDist`. */
  protected magnet(f: Fighter, target: Fighter | null, lunge: number, stopDist = 1.7, vertical = false): void {
    if (!target) {
      this.faceYaw = f.aimYaw;
      forwardOf(f.aimYaw, _v);
      f.vel.x = f.vel.x * 0.4 + _v.x * lunge * 0.55;
      f.vel.z = f.vel.z * 0.4 + _v.z * lunge * 0.55;
      return;
    }
    _v.subVectors(target.pos, f.pos);
    const dy = _v.y;
    _v.y = 0;
    const d = _v.length();
    if (d > 1e-3) _v.divideScalar(d);
    this.faceYaw = Math.atan2(_v.x, _v.z);
    const spd = Math.min(lunge, Math.max(0, (d - stopDist) / 0.16));
    f.vel.x = f.vel.x * 0.25 + _v.x * spd;
    f.vel.z = f.vel.z * 0.25 + _v.z * spd;
    if (vertical && !f.grounded) f.vel.y = THREE.MathUtils.clamp(dy * 4, -14, 10);
  }

  /** Melee hit test for this frame (call while the hit window is open). */
  protected sweep(f: Fighter, h: MeleeHit, m: MatchContext): void {
    if (!m.isAuthority(f)) return;
    const yaw = this.faceYaw ?? f.facing;
    forwardOf(yaw, _w);
    const cosArc = Math.cos(THREE.MathUtils.degToRad(h.arc));
    const origin = _a.set(f.pos.x, f.pos.y + 1.1, f.pos.z);
    for (const o of m.fighters) {
      if (o === f || !o.alive || this.swingHits.has(o.id)) continue;
      if (o.team !== 0 && o.team === f.team) continue;
      capsule(o, _c1, _c2);
      // closest point on target capsule to attacker chest
      const d2 = segSegDist2(origin, origin, _c1, _c2, _v, _b);
      const d = Math.sqrt(d2) - CAPSULE_R;
      if (d > h.range) continue;
      const dy = Math.abs(_b.y - origin.y);
      if (dy > (h.height ?? 2.2) + 0.5) continue;
      _v.subVectors(_b, origin).setY(0);
      const l = _v.length();
      if (l > 0.6) {
        _v.divideScalar(l);
        if (_v.dot(_w) < cosArc) continue;
      }
      this.swingHits.add(o.id);
      const kb = new THREE.Vector3();
      if (h.kb || h.kbUp) {
        kb.subVectors(o.pos, f.pos).setY(0).normalize().multiplyScalar(h.kb ?? 0);
        kb.y = h.kbUp ?? 0;
      }
      const at = _b.clone().lerp(origin, 0.3);
      m.reportHit(f, o, { slot: h.slot, part: h.part, kb, stun: h.stun, slow: h.slow, at, scale: h.scale, blockable: true, crit: this.isBackstab(f, o) });
    }
  }

  protected isBackstab(f: Fighter, o: Fighter): boolean {
    forwardOf(o.facing, _v);
    _w.subVectors(f.pos, o.pos).setY(0).normalize();
    return _v.dot(_w) < -0.55;
  }

  /** Area damage around a point. */
  protected aoe(f: Fighter, m: MatchContext, center: THREE.Vector3, radius: number, slot: AbilitySlot, part: string, opts: { kb?: number; kbUp?: number; stun?: number; slow?: number; falloff?: boolean } = {}): number {
    if (!m.isAuthority(f)) return 0;
    let n = 0;
    for (const o of m.fighters) {
      if (o === f || !o.alive) continue;
      if (o.team !== 0 && o.team === f.team) continue;
      o.chest(_v);
      const d = _v.distanceTo(center);
      if (d > radius + CAPSULE_R) continue;
      const fall = opts.falloff ? THREE.MathUtils.clamp(1 - d / (radius + 1), 0.4, 1) : 1;
      const kb = new THREE.Vector3().subVectors(o.pos, center).setY(0).normalize().multiplyScalar((opts.kb ?? 0) * fall);
      kb.y = (opts.kbUp ?? 0) * fall;
      m.reportHit(f, o, { slot, part, scale: fall, kb, stun: opts.stun, slow: opts.slow, at: _v.clone(), blockable: false });
      n++;
    }
    return n;
  }

  /** World point under the crosshair (fighters first, then the world). */
  aimPoint(f: Fighter, m: MatchContext, max = 220, out = new THREE.Vector3()): { point: THREE.Vector3; fighter: Fighter | null } {
    const it = f.intent;
    let best = max;
    let bestF: Fighter | null = null;
    _b.copy(it.aimOrigin).addScaledVector(it.aimDir, max);
    for (const o of m.fighters) {
      if (o === f || !o.alive) continue;
      capsule(o, _c1, _c2);
      const d2 = segSegDist2(it.aimOrigin, _b, _c1, _c2, _v, _w);
      if (d2 < CAPSULE_R * CAPSULE_R) {
        const along = _v.distanceTo(it.aimOrigin);
        if (along < best) {
          best = along;
          bestF = o;
        }
      }
    }
    const hit = m.world.raycast(it.aimOrigin, it.aimDir, best);
    if (hit) {
      bestF = null;
      best = hit.distance;
    }
    out.copy(it.aimOrigin).addScaledVector(it.aimDir, best);
    return { point: out, fighter: bestF };
  }

  /** consumes the ultimate if ready (and plays the cut-in) */
  protected useUlt(f: Fighter, m: MatchContext): boolean {
    if (f.ult < 1) return false;
    f.ult = 0;
    m.announceUlt(f);
    return true;
  }
}
