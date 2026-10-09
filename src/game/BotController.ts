import * as THREE from 'three';
import { MOVE } from '../../shared/constants';
import type { Fighter } from './Fighter';
import { forwardOf, wrapAngle } from './Fighter';
import type { MatchContext } from './types';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();

/**
 * Practice-mode AI. Travels with the grapple when far (anchors above/beyond the target),
 * fights with champion-appropriate spacing, guards/dodges reactively and uses its kit.
 * difficulty 0..1 controls reaction time, aim error and aggression.
 */
export class BotController {
  private target: Fighter | null = null;
  private retargetT = 0;
  private strafeT = 0;
  private strafe = 1;
  private reaction = 0;
  private hookHold = -1;
  private hookTimer = 0;
  private holdAttack = 0;
  private holdGuard = 0;
  private chargeT = 0;
  private stuckT = 0;
  private aimErr = new THREE.Vector3();
  private aimErrT = 0;
  private jumpT = 0;
  private wanderTarget = new THREE.Vector3();

  constructor(readonly f: Fighter, readonly difficulty = 0.5) {}

  think(dt: number, m: MatchContext): void {
    const f = this.f;
    const it = f.intent;
    if (!f.alive) {
      it.move.set(0, 0);
      it.attack = it.secondary = it.hookL = it.hookR = it.jump = false;
      this.hookHold = -1;
      return;
    }
    const diff = this.difficulty;
    // ---- target selection -------------------------------------------------------------------
    this.retargetT -= dt;
    if (this.target?.isHiddenFrom(f)) this.target = null; // lost in the smoke
    if (this.retargetT <= 0 || !this.target || !this.target.alive) {
      this.retargetT = 0.6 + Math.random() * 0.5;
      let best: Fighter | null = null;
      let bestD = Infinity;
      for (const o of m.fighters) {
        if (o === f || !o.alive || o.isHiddenFrom(f)) continue;
        const d = o.pos.distanceTo(f.pos) * (o.kind === 'local' ? 0.85 : 1);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      this.target = best;
    }
    const t = this.target;
    const melee = f.champ.role === 'melee';

    // ---- aim ---------------------------------------------------------------------------------
    this.aimErrT -= dt;
    if (this.aimErrT <= 0) {
      this.aimErrT = 0.25 + Math.random() * 0.35;
      const e = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(7, 1.2, diff));
      this.aimErr.set((Math.random() - 0.5) * e * 2, (Math.random() - 0.5) * e, 0);
    }
    if (t) {
      t.chest(_aim);
      // lead moving targets for ranged champions
      if (!melee) {
        const dist = _aim.distanceTo(f.pos);
        const projSpeed = f.champId === 'rex' ? 120 : 60;
        _aim.addScaledVector(t.vel, (dist / projSpeed) * THREE.MathUtils.lerp(0.4, 1, diff));
      }
    } else {
      _aim.copy(this.wanderTarget).setY(1.5);
    }
    _dir.subVectors(_aim, _v.copy(f.pos).setY(f.pos.y + 1.4)).normalize();
    let yaw = Math.atan2(_dir.x, _dir.z) + this.aimErr.x;
    let pitch = Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1)) + this.aimErr.y;
    // smooth aim (reaction)
    const turn = THREE.MathUtils.lerp(5, 14, diff);
    it.aimYaw = wrapAngle(it.aimYaw + wrapAngle(yaw - it.aimYaw) * (1 - Math.exp(-turn * dt)));
    it.aimPitch += (pitch - it.aimPitch) * (1 - Math.exp(-turn * dt));
    yaw = it.aimYaw;
    pitch = it.aimPitch;
    it.aimDir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    it.aimOrigin.copy(f.pos).setY(f.pos.y + 1.6).addScaledVector(it.aimDir, -0.5);

    // reset edge inputs
    it.attack = false;
    it.secondary = false;
    it.jump = false;
    if (!t) {
      this.wander(dt, m);
      return;
    }

    const toT = _w.subVectors(t.pos, f.pos);
    const dist = toT.length();
    const dy = toT.y;
    const flat = Math.hypot(toT.x, toT.z);

    // ---- travel with grapple when far or target is high ----------------------------------------
    const travel = dist > (melee ? 16 : 42) || dy > 7;
    this.hookTimer -= dt;
    if (travel) {
      this.travel(dt, m, t, dist);
    } else {
      this.releaseHooks();
    }

    // ---- ground movement -------------------------------------------------------------------------
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 0.6 + Math.random() * 1.4;
      this.strafe = Math.random() < 0.5 ? -1 : 1;
    }
    const wantDist = melee ? 2.2 : THREE.MathUtils.lerp(16, 24, (f.id.charCodeAt(f.id.length - 1) % 3) / 2);
    let fwd = 0;
    if (flat > wantDist + 1.5) fwd = 1;
    else if (flat < wantDist - (melee ? 0.8 : 5)) fwd = -1;
    const side = melee && flat < 5 ? this.strafe * 0.4 : this.strafe * (melee ? 0.3 : 0.9);
    it.move.set(side, fwd);
    if (it.move.lengthSq() > 1) it.move.normalize();

    // stuck detection: wants to move but slow -> jump / hook up
    if (f.grounded && fwd !== 0 && Math.hypot(f.vel.x, f.vel.z) < 1.5) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    this.jumpT -= dt;
    if ((this.stuckT > 0.4 || (Math.random() < dt * 0.25 * diff && !melee)) && this.jumpT <= 0) {
      it.jumpPressed = true;
      it.jump = true;
      this.jumpT = 0.8;
      this.stuckT = 0;
    }

    // ---- reactions: guard / dodge ------------------------------------------------------------
    this.reaction -= dt;
    const threat = t.kit && (t.kit as unknown as { act: string | null }).act;
    if (threat && this.reaction <= 0 && dist < (melee ? 6 : 10)) {
      this.reaction = THREE.MathUtils.lerp(0.9, 0.25, diff);
      if (f.champId === 'kaiser' && Math.random() < 0.35 + diff * 0.35) this.holdGuard = 0.45 + Math.random() * 0.3;
      else if (Math.random() < 0.25 + diff * 0.4 && f.gas > MOVE.dashCost) {
        it.move.set(this.strafe, -0.3);
        it.dashPressed = true;
      }
    }
    if (this.holdGuard > 0) {
      this.holdGuard -= dt;
      it.secondary = true;
      it.secondaryPressed = this.holdGuard > 0.4;
      return;
    }

    // ---- attack -------------------------------------------------------------------------------
    const aimDot = _v.subVectors(_aim, it.aimOrigin).normalize().dot(it.aimDir);
    const onTarget = aimDot > Math.cos(THREE.MathUtils.degToRad(melee ? 40 : 6));
    const kit = f.kit!;
    const cds = kit.cooldowns();
    if (melee) {
      if (dist < 3.6 && onTarget) {
        if (Math.random() < dt * THREE.MathUtils.lerp(3, 7, diff)) it.attackPressed = true;
      }
      if (cds.abi <= 0 && dist > 5 && dist < 18 && onTarget && Math.random() < dt * (0.6 + diff)) it.abilityPressed = true;
      if (f.champId === 'nova' && cds.sec <= 0 && dist < 9 && Math.random() < dt * 0.4) it.secondaryPressed = true;
      // League ports: smoke when engaging or hurt, nails as a ranged poke, Terrashape to close in
      if (f.champId === 'akali' && cds.sec <= 0 && (dist < 6 || f.hp < f.maxHp * 0.5) && Math.random() < dt * 0.5) it.secondaryPressed = true;
      if (f.champId === 'locke' && cds.sec <= 0 && dist > 4 && dist < 22 && aimDot > 0.995 && Math.random() < dt * 1.2) it.secondaryPressed = true;
      if (f.champId === 'qiyana' && cds.sec <= 0 && dist > 4 && dist < 14 && Math.random() < dt * 0.6) it.secondaryPressed = true;
      if (f.ult >= 1 && dist < 9 && Math.random() < dt * 0.8) it.ultimatePressed = true;
      // second cast of a two-part ultimate
      if (kit.hints?.().ult === 'x2' && dist < 12 && Math.random() < dt * 1.5) it.ultimatePressed = true;
    } else {
      if (onTarget && dist < 90) {
        if (f.champId === 'rex' && cds.sec <= 0 && dist > 25 && this.chargeT <= 0 && Math.random() < dt * 0.4) this.chargeT = 0.9 + Math.random() * 0.4;
        if (this.chargeT > 0) {
          this.chargeT -= dt;
          it.secondary = true;
          if (this.chargeT <= dt) it.secondaryReleased = true;
          if (!it.secondaryPressed && this.chargeT > 0.85) it.secondaryPressed = true;
        } else {
          this.holdAttack -= dt;
          if (this.holdAttack <= 0 && Math.random() < dt * 2.5) this.holdAttack = 0.5 + Math.random() * 0.9;
          if (this.holdAttack > 0) {
            it.attack = true;
            if (Math.random() < 0.2) it.attackPressed = true;
          }
        }
        if (f.champId === 'sera' && cds.sec <= 0 && dist < 30 && Math.random() < dt * 0.3) {
          it.secondaryPressed = true;
          it.secondary = true;
        }
      }
      if (cds.abi <= 0 && dist < (f.champId === 'sera' ? 8 : 30) && Math.random() < dt * (0.5 + diff)) it.abilityPressed = true;
      if (f.ult >= 1 && dist < 45 && onTarget && Math.random() < dt * 0.6) it.ultimatePressed = true;
    }
  }

  private wander(dt: number, m: MatchContext): void {
    const f = this.f;
    const it = f.intent;
    if (f.pos.distanceTo(this.wanderTarget) < 4 || this.wanderTarget.lengthSq() === 0) {
      const s = m.world.bounds;
      this.wanderTarget.set(THREE.MathUtils.randFloat(s.minX * 0.4, s.maxX * 0.4), 0, THREE.MathUtils.randFloat(s.minZ * 0.4, s.maxZ * 0.4));
    }
    it.move.set(0, 1);
    void dt;
  }

  private releaseHooks(): void {
    const it = this.f.intent;
    it.hookL = it.hookR = false;
    this.hookHold = -1;
  }

  /** Swing toward the target: fire a hook at a surface above & ahead, boost, release past it. */
  private travel(dt: number, m: MatchContext, t: Fighter, dist: number): void {
    const f = this.f;
    const it = f.intent;
    const hk = this.hookHold >= 0 ? f.hooks[this.hookHold] : null;
    if (hk && (hk.state === 'flying' || hk.state === 'attached')) {
      // keep holding while the anchor is still ahead of us, boost when far
      const toAnchor = _v.subVectors(hk.anchor, f.pos);
      const toTarget = _w.subVectors(t.pos, f.pos);
      const ahead = toAnchor.dot(toTarget) > 0;
      const passed = hk.state === 'attached' && (!ahead || toAnchor.length() < 6 || this.hookTimer < -2.2);
      if (passed || dist < 10) {
        this.releaseHooks();
        this.hookTimer = 0.15 + Math.random() * 0.2;
        if (!f.grounded && f.gas > 30 && Math.random() < 0.5) it.jumpPressed = true;
      } else {
        if (this.hookHold === 0) it.hookL = true;
        else it.hookR = true;
        it.jump = hk.state === 'attached' && f.gas > 15 && dist > 20;
        it.move.set(0, 1);
      }
      return;
    }
    if (this.hookTimer > 0) {
      it.move.set(0, 1);
      return;
    }
    // choose an anchor: aim above and beyond the target
    const side = Math.random() < 0.5 ? 0 : 1;
    const goal = _v.copy(t.pos).add(_w.set(0, 16 + Math.random() * 10, 0));
    const from = f.ropeOrigin(new THREE.Vector3());
    const dir = goal.sub(from).normalize();
    // bias upward
    dir.y = Math.max(dir.y, 0.35);
    dir.normalize();
    // temporarily point the intent aim at the anchor direction for this shot
    const saveDir = it.aimDir.clone();
    const saveOrigin = it.aimOrigin.clone();
    it.aimDir.copy(dir);
    it.aimOrigin.copy(from);
    const target = f.findHookTarget(side, m);
    if (target && target.point.distanceTo(from) > 12) {
      if (side === 0) {
        it.hookL = true;
        it.hookLPressed = true;
      } else {
        it.hookR = true;
        it.hookRPressed = true;
      }
      this.hookHold = side;
      this.hookTimer = 0;
      // keep the aim dir until the hook fires this frame (fighter reads intent after think)
      return;
    }
    it.aimDir.copy(saveDir);
    it.aimOrigin.copy(saveOrigin);
    this.hookTimer = 0.3;
    // no anchor: run & jump toward the target
    forwardOf(it.aimYaw, _w);
    it.move.set(0, 1);
    void dt;
  }
}
