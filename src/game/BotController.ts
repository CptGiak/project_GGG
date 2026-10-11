import * as THREE from 'three';
import { MOVE } from '../../shared/constants';
import type { Fighter } from './Fighter';
import { forwardOf, wrapAngle } from './Fighter';
import type { MatchContext } from './types';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _goal = new THREE.Vector3();
const _from = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _p = new THREE.Vector3();

/** climb anchors around a raised zone: [past its centre from us (× radius), above its floor (m)] */
const CLIMB_AIMS: Array<[number, number]> = [[0.6, 10], [1, 4], [0.3, 18], [0, 30]];
/** its side, scanned top-down for the highest grip */
const CLIMB_FACE: Array<[number, number]> = [[0, 0.6], [0, -0.4], [0, -1.5], [0, -3], [0, -5], [0, -8]];

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
  /** perfect dodge: a dash scheduled into the enemy's attack (match time), the action it answers */
  private dodgeAt = -1;
  private seenAct: string | null = null;
  private lastDashAt = -10;
  /** game mode objective: whether this bot is currently playing it (re-rolled every few seconds) */
  private objFocus = true;
  private objT = 0;
  /** the held hook was fired by `climb` (it lets go by its own rules); time stuck on it */
  private climbing = false;
  private stallT = 0;
  /** step away from the wall before the next try */
  private backOff = false;
  /** vaulting over a ledge that capped a wall-run: back off, then jump up and over (s left) */
  private vaultT = 0;

  constructor(readonly f: Fighter, readonly difficulty = 0.5) {}

  /** set the move intent from a world-space direction (intent moves are relative to the aim yaw) */
  private steer(it: Fighter['intent'], dx: number, dz: number): void {
    const yaw = it.aimYaw;
    it.move.set(dx * -Math.cos(yaw) + dz * Math.sin(yaw), dx * Math.sin(yaw) + dz * Math.cos(yaw));
    if (it.move.lengthSq() > 1) it.move.normalize();
  }

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
    // ---- game mode objective (RIFLETTORE zone) ---------------------------------------------------
    const obj = m.objective?.() ?? null;
    this.objT -= dt;
    if (this.objT <= 0) {
      this.objT = 4 + Math.random() * 4;
      this.objFocus = Math.random() < 0.55 + 0.4 * diff;
    }
    const nearObj = (o: Fighter) => !!obj && Math.hypot(o.pos.x - obj.c[0], o.pos.z - obj.c[2]) < obj.r + 6 && Math.abs(o.pos.y - obj.c[1]) < obj.h + 4;
    // ---- target selection -------------------------------------------------------------------
    this.retargetT -= dt;
    if (this.target?.isHiddenFrom(f)) this.target = null; // lost in the smoke
    if (this.retargetT <= 0 || !this.target || !this.target.alive) {
      this.retargetT = 0.6 + Math.random() * 0.5;
      let best: Fighter | null = null;
      let bestD = Infinity;
      for (const o of m.fighters) {
        if (o === f || !o.alive || o.isHiddenFrom(f)) continue;
        if (o.team !== 0 && o.team === f.team) continue;
        // in the spotlight mode whoever stands in the light is the one to remove
        const d = o.pos.distanceTo(f.pos) * (o.kind === 'local' ? 0.85 : 1) * (this.objFocus && nearObj(o) ? 0.55 : 1);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      this.target = best;
    }
    const t = this.target;
    const melee = f.champ.role === 'melee';
    // head for the zone unless a fight is right here
    let goal: THREE.Vector3 | null = null;
    let holdZone = false;
    if (obj && this.objFocus) {
      _goal.set(obj.c[0], obj.c[1], obj.c[2]);
      const inside = Math.hypot(f.pos.x - _goal.x, f.pos.z - _goal.z) < obj.r * 0.85 && f.pos.y > _goal.y - 1.5 && f.pos.y < _goal.y + obj.h;
      if (inside) holdZone = true;
      else if (!t || t.pos.distanceTo(f.pos) > 9) goal = _goal;
    }

    // ---- aim ---------------------------------------------------------------------------------
    this.aimErrT -= dt;
    if (this.aimErrT <= 0) {
      this.aimErrT = 0.25 + Math.random() * 0.35;
      const e = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(7, 1.2, diff));
      this.aimErr.set((Math.random() - 0.5) * e * 2, (Math.random() - 0.5) * e, 0);
    }
    if (goal) {
      _aim.copy(goal).setY(goal.y + 1.5);
    } else if (t) {
      t.chest(_aim);
      // lead moving targets for ranged champions
      if (!melee) {
        const dist = _aim.distanceTo(f.pos);
        const projSpeed = f.champId === 'rex' ? 120 : f.champId === 'pooh' ? 30 : 60;
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
    if (goal && obj) {
      this.goTo(dt, m, goal, obj.r);
      return;
    }
    if (!t) {
      if (holdZone && obj) {
        // nobody around: keep the light, near its centre
        this.releaseHooks();
        const cx = obj.c[0] - f.pos.x;
        const cz = obj.c[2] - f.pos.z;
        if (Math.hypot(cx, cz) > obj.r * 0.35) this.steer(it, cx, cz);
        else it.move.set(0, 0);
        return;
      }
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
    if (melee && f.speedPeak > 18 && dist < 9 && f.kit!.cooldowns().atk <= 0 && Math.random() < 0.35 + diff * 0.6) {
      // flying in fast: let go and turn the swing into a momentum strike
      this.releaseHooks();
      it.attackPressed = true;
    } else if (travel && !holdZone) {
      this.travel(dt, m, t.pos, dist);
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
    if (holdZone && obj) {
      // hold the light: drift back toward its centre instead of kiting out of it
      const cx = obj.c[0] - f.pos.x;
      const cz = obj.c[2] - f.pos.z;
      if (Math.hypot(cx, cz) > obj.r * 0.45) this.steer(it, cx, cz);
      else if (!melee || flat > 4) it.move.set(this.strafe * 0.6, 0);
    }

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

    // ---- reactions: guard / perfect dodge ----------------------------------------------------
    // a new enemy action close by: guard it (Kaiser) or time a fresh dash into its active frames
    this.reaction -= dt;
    const threat = (t.kit as unknown as { act: string | null } | null)?.act ?? null;
    const fresh = threat !== null && threat !== this.seenAct;
    this.seenAct = threat;
    if (fresh && this.reaction <= 0 && dist < (t.champ.role === 'melee' ? 7 : 10)) {
      this.reaction = THREE.MathUtils.lerp(0.9, 0.25, diff);
      if (f.champId === 'kaiser' && Math.random() < 0.35 + diff * 0.35) this.holdGuard = 0.45 + Math.random() * 0.3;
      else if (Math.random() < 0.25 + diff * 0.5 && f.gas > MOVE.dashCost && m.time - this.lastDashAt > 1.5) {
        // good bots wait for the swing, weak ones flinch early
        this.dodgeAt = m.time + THREE.MathUtils.lerp(0, 0.06, diff) + Math.random() * THREE.MathUtils.lerp(0.16, 0.05, diff);
      }
    }
    if (this.dodgeAt > 0 && m.time >= this.dodgeAt) {
      this.dodgeAt = -1;
      it.move.set(this.strafe, -0.3);
      it.dashPressed = true;
      this.lastDashAt = m.time;
    }
    // Kaiser's riposte after a parry, anyone's counter after a perfect dodge
    if ((f.kit as unknown as { riposteT?: number }).riposteT) {
      this.holdGuard = 0;
      it.attackPressed = true;
    }
    if (this.holdGuard > 0) {
      this.holdGuard -= dt;
      it.secondary = true;
      it.secondaryPressed = this.holdGuard > 0.4;
      return;
    }
    if (f.counterT > 0 && melee && dist < 4.5) it.attackPressed = true;

    // ---- attack -------------------------------------------------------------------------------
    const aimDot = _v.subVectors(_aim, it.aimOrigin).normalize().dot(it.aimDir);
    const onTarget = aimDot > Math.cos(THREE.MathUtils.degToRad(melee ? 40 : 6));
    const kit = f.kit!;
    const cds = kit.cooldowns();
    if (melee) {
      if (dist < 3.6 && onTarget) {
        if (Math.random() < dt * THREE.MathUtils.lerp(3, 7, diff)) it.attackPressed = true;
      }
      // signature skill: Kaiser's wave reaches ~8 m, Nova's kunai ~12 m
      // signature skills: Kaiser's wave ~8 m, Nova's X ~13 m, Akali's fan ~12 m, Qiyana's line ~8.5 m
      const sigRange: Record<string, number> = { kaiser: 7.5, nova: 12, akali: 11, qiyana: 8, elisabbat: 9 };
      if (f.champId !== 'locke' && cds.sig <= 0 && dist < (sigRange[f.champId] ?? 8) && onTarget && Math.random() < dt * (0.8 + diff * 1.5)) it.skillPressed = true;
      if (cds.abi <= 0 && dist > 5 && dist < 18 && onTarget && Math.random() < dt * (0.6 + diff)) it.abilityPressed = true;
      if (f.champId === 'nova' && cds.sec <= 0 && dist < 9 && Math.random() < dt * 0.4) it.secondaryPressed = true;
      // League ports: smoke when engaging or hurt, nails as a ranged poke, Terrashape to close in
      if (f.champId === 'akali' && cds.sec <= 0 && (dist < 6 || f.hp < f.maxHp * 0.5) && Math.random() < dt * 0.5) it.secondaryPressed = true;
      // Locke: Ritual Nails need a precise aim (they're a line), Soul Ignition when hurt or brawling
      if (f.champId === 'locke' && cds.sig <= 0 && dist > 4 && dist < 22 && aimDot > 0.995 && Math.random() < dt * 1.2) it.skillPressed = true;
      if (f.champId === 'locke' && cds.sec <= 0 && (f.hp < f.maxHp * 0.4 || dist < 5) && Math.random() < dt * 0.8) it.secondaryPressed = true;
      if (f.champId === 'qiyana' && cds.sec <= 0 && dist > 4 && dist < 14 && Math.random() < dt * 0.6) it.secondaryPressed = true;
      // Elisabbat: bat form to dive in from afar or to flee when hurt, then bite out of it;
      // Spellvamp more eagerly when hurt (it heals)
      if (f.champId === 'elisabbat') {
        const bat = kit.hints?.().sec === 'UMANA';
        if (bat) {
          if (f.hp < f.maxHp * 0.3) it.move.set(this.strafe * 0.5, -1);
          else {
            it.move.set(0, 1);
            if (dist < 7 && cds.sig <= 0) it.skillPressed = true;
            else if (dist < 3) it.attackPressed = true;
          }
        } else if (cds.sec <= 0 && ((dist > 12 && dist < 30) || (f.hp < f.maxHp * 0.3 && dist < 10)) && Math.random() < dt * (0.4 + diff * 0.6)) it.secondaryPressed = true;
        if (!bat && cds.sig <= 0 && dist < 9 && onTarget && f.hp < f.maxHp * 0.7 && Math.random() < dt * 1.5) it.skillPressed = true;
      }
      if (f.ult >= 1 && dist < 9 && Math.random() < dt * 0.8) it.ultimatePressed = true;
      // second cast of a two-part ultimate
      if (kit.hints?.().ult === 'x2' && dist < 12 && Math.random() < dt * 1.5) it.ultimatePressed = true;
    } else {
      // Pooh's Panzata is a belly bump: only up close
      const sigReach = f.champId === 'sera' ? 38 : f.champId === 'pooh' ? 8 : 75;
      if (onTarget && cds.sig <= 0 && dist < sigReach && this.chargeT <= 0 && Math.random() < dt * (0.6 + diff)) it.skillPressed = true;
      // Pooh: the balloon to get away from a brawl
      if (f.champId === 'pooh' && cds.sec <= 0 && dist < 6 && f.hp < f.maxHp * 0.7 && Math.random() < dt * 0.5) it.secondaryPressed = true;
      if (onTarget && dist < (f.champId === 'pooh' ? 46 : 90)) {
        // Bass Charge: release right as it fills (perfect window 0.95-1.13 s); weak bots overshoot
        if (f.champId === 'rex' && cds.sec <= 0 && dist > 25 && this.chargeT <= 0 && Math.random() < dt * 0.4) this.chargeT = 0.98 + Math.random() * THREE.MathUtils.lerp(0.5, 0.12, diff);
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
      if (f.champId === 'pooh') {
        // Think, Think, Think: only with room to stand still (or when it's worth the risk)
        if (cds.abi <= 0 && dist > 12 && (f.hp < f.maxHp * 0.8 || cds.sig > 0) && Math.random() < dt * (0.4 + diff)) it.abilityPressed = true;
      } else if (cds.abi <= 0 && dist < (f.champId === 'sera' ? 8 : 30) && Math.random() < dt * (0.5 + diff)) it.abilityPressed = true;
      if (f.ult >= 1 && dist < 45 && onTarget && Math.random() < dt * 0.6) it.ultimatePressed = true;
    }
  }

  /** objective travel: swing / run to a zone's floor (climbing to raised ones), aiming at it */
  private goTo(dt: number, m: MatchContext, goal: THREE.Vector3, r: number): void {
    const f = this.f;
    const it = f.intent;
    const flat = Math.hypot(goal.x - f.pos.x, goal.z - f.pos.z);
    const dy = goal.y - f.pos.y;
    this.hookTimer -= dt;
    if (this.vaultT > 0) {
      this.vaultT -= dt;
      if (this.vaultT > 0.45) it.move.set(0, -1);
      else {
        it.move.set(0, 1);
        if (f.vel.y < 0.5) it.jumpPressed = true;
      }
      return;
    }
    if (this.landingAssist(goal, r, flat, dy)) return;
    if ((dy > 2.5 && flat < r + 30) || (this.climbing && this.hookHold >= 0)) this.climb(dt, m, goal, r, flat, dy);
    else if (flat > 14) {
      // swing over, letting go early enough to not overshoot it at speed
      this.climbing = false;
      this.travel(dt, m, goal, flat - 0.45 * Math.hypot(f.vel.x, f.vel.z));
    } else {
      this.releaseHooks();
      it.move.set(0, 1);
      if (dy > 1.2 && f.grounded) {
        it.jumpPressed = true;
        it.jump = true;
      }
    }
    // stuck against something: hop
    if (f.grounded && Math.hypot(f.vel.x, f.vel.z) < 1.5) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 0.4) {
      it.jumpPressed = true;
      it.jump = true;
      this.stuckT = 0;
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
    this.climbing = false;
  }

  /**
   * Raised zone: hook something above its floor near it (a wall behind it) and let go over the
   * floor, or the highest point of its own side we can grab, riding the line up and hopping over
   * the rim. Anything well above us near it is a step up. From under the floor, step out first.
   */
  private climb(dt: number, m: MatchContext, goal: THREE.Vector3, r: number, flat: number, dy: number): void {
    const f = this.f;
    const it = f.intent;
    const under = flat < r + 1.5;
    const hk = this.hookHold >= 0 ? f.hooks[this.hookHold] : null;
    if (f.wallRun > 0) {
      // running up the side: keep pushing into it (a line to a lower anchor would drag us back)
      if (hk && hk.anchor.y < f.pos.y + 1) this.releaseHooks();
      else if (hk) {
        if (this.hookHold === 0) it.hookL = true;
        else it.hookR = true;
      }
      it.move.set(0, 1);
      // capped by a ledge near the top: let go of the wall, back off under it and vault over
      if (f.vel.y < 1 && dy < 5) {
        this.vaultT = 0.8;
        it.move.set(0, -1);
      }
      return;
    }
    if (hk && (hk.state === 'flying' || hk.state === 'attached')) {
      const toAnchor = _v.subVectors(hk.anchor, f.pos).length();
      // pinned under a ledge: not moving while the line pulls
      this.stallT = hk.state === 'attached' && f.speed < 3 ? this.stallT + dt : 0;
      if (this.stallT > 0.6) {
        this.releaseHooks();
        this.stallT = 0;
        this.hookTimer = 0.5;
        this.backOff = true;
      } else if ((dy < -0.3 && flat < r * 0.85) || this.hookTimer < -3) {
        // over the floor (or the line goes nowhere): drop onto it
        this.releaseHooks();
        this.hookTimer = 0.2;
      } else if (dy < 0.5 && flat < r + 10 && this.closingOn(goal) > 4) {
        // level with the floor and already flying at it: glide in
        this.releaseHooks();
        this.hookTimer = 0.3;
      } else if (hk.state === 'attached' && toAnchor < 4) {
        // at the anchor, usually the rim: let go and hop over it
        this.releaseHooks();
        this.hookTimer = 0.35;
        it.jumpPressed = true;
      } else {
        if (this.hookHold === 0) it.hookL = true;
        else it.hookR = true;
        it.jump = hk.state === 'attached' && f.gas > 15;
        it.move.set(0, 1);
      }
      return;
    }
    if (this.hookHold >= 0) this.releaseHooks();
    if (this.hookTimer > 0) {
      if ((under && dy > 2.5) || this.backOff) this.steer(it, f.pos.x - goal.x, f.pos.z - goal.z);
      else it.move.set(0, 1);
      return;
    }
    this.backOff = false;
    if (f.grounded && f.gas < 45) {
      // the climb needs gas for the boost and the hops: catch breath first
      it.move.set(0, 0);
      this.hookTimer = 0.2;
      return;
    }
    if (!under || dy <= 2.5) {
      const side = Math.random() < 0.5 ? 0 : 1;
      f.ropeOrigin(_from);
      _fwd.set(goal.x - f.pos.x, 0, goal.z - f.pos.z);
      if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, 1);
      _fwd.normalize();
      const saveDir = it.aimDir.clone();
      const saveOrigin = it.aimOrigin.clone();
      // 1) above the floor, around or past the zone: the swing carries us over it
      // 2) its side, as high as we can grab: the first ray from the top down that hits
      // 3) anything well above us near it
      for (let pass = 0; pass < 3; pass++) {
        const aims = pass === 1 ? CLIMB_FACE : CLIMB_AIMS;
        for (const [along, up] of aims) {
          _p.copy(goal).addScaledVector(_fwd, along * r);
          _p.y += up;
          it.aimDir.subVectors(_p, _from).normalize();
          it.aimOrigin.copy(_from);
          const hit = f.findHookTarget(side, m);
          if (!hit || hit.fighterId) {
            continue;
          }
          const a = hit.point;
          if (a.distanceTo(_from) < 6) continue;
          const aFlat = Math.hypot(a.x - goal.x, a.z - goal.z);
          // the underside of the zone's own floor would only pin us beneath it
          if (aFlat < r && a.y < goal.y - 0.3) continue;
          const ok = pass === 0 ? a.y > goal.y + 1 && aFlat < r + 18
            : pass === 1 ? a.y > goal.y - 9 && a.y > f.pos.y + 2 && aFlat > r * 0.5 && aFlat < r + 18
              : a.y > f.pos.y + 8 && aFlat < r + 25;
          if (!ok) {
            // the face scan goes top-down: the first ray that hits is the highest grip
            if (pass === 1) break;
            continue;
          }
          // fire along this aim (the fighter reads the intent after think)
          if (side === 0) {
            it.hookL = true;
            it.hookLPressed = true;
          } else {
            it.hookR = true;
            it.hookRPressed = true;
          }
          this.hookHold = side;
          this.climbing = true;
          this.hookTimer = 0;
          return;
        }
      }
      it.aimDir.copy(saveDir);
      it.aimOrigin.copy(saveOrigin);
    }
    // nothing to grab from here: step out from under the floor or back off the wall for an
    // angle on its upper side, or walk in and hop
    this.hookTimer = 0.25;
    if (dy > 6 && flat < r + 22) {
      this.backOff = true;
      this.hookTimer = 0.6;
      this.steer(it, f.pos.x - goal.x, f.pos.z - goal.z);
    } else if (under && dy > 2.5) this.steer(it, f.pos.x - goal.x, f.pos.z - goal.z);
    else {
      it.move.set(0, 1);
      if (f.grounded && dy > 1.2) it.jumpPressed = true;
    }
  }

  /** horizontal speed toward a point (m/s) */
  private closingOn(goal: THREE.Vector3): number {
    const f = this.f;
    const dx = goal.x - f.pos.x;
    const dz = goal.z - f.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    return (f.vel.x * dx + f.vel.z * dz) / l;
  }

  /**
   * Airborne beside a zone at about its floor height: steer at it, air-jump before dropping
   * below the rim and dash in when drifting. Returns whether it took over.
   */
  private landingAssist(goal: THREE.Vector3, r: number, flat: number, dy: number): boolean {
    const f = this.f;
    const it = f.intent;
    if (f.grounded || flat < r * 0.6 || flat > r + 14 || dy > 2 || dy < -6) return false;
    if (this.hookHold >= 0) this.releaseHooks();
    this.steer(it, goal.x - f.pos.x, goal.z - f.pos.z);
    if (flat > r * 0.9 && f.vel.y < 0.5 && dy > -1.2 && f.airJumps > 0 && f.gas >= MOVE.airJumpCost) it.jumpPressed = true;
    else if (flat > r + 2 && dy < 0.5 && f.dashCd <= 0 && f.gas >= MOVE.dashCost + MOVE.airJumpCost && this.closingOn(goal) < 4) it.dashPressed = true;
    return true;
  }


  /** Swing toward a point: fire a hook at a surface above & ahead, boost, release past it. */
  private travel(dt: number, m: MatchContext, goal: THREE.Vector3, dist: number): void {
    const f = this.f;
    const it = f.intent;
    const hk = this.hookHold >= 0 ? f.hooks[this.hookHold] : null;
    if (hk && (hk.state === 'flying' || hk.state === 'attached')) {
      // keep holding while the anchor is still ahead of us, boost when far
      const toAnchor = _v.subVectors(hk.anchor, f.pos);
      const toTarget = _w.subVectors(goal, f.pos);
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
    // hooks cost gas: keep a small reserve for dashes, otherwise run
    if (f.gas < MOVE.hookCost + 12) {
      this.hookTimer = 0.6;
      it.move.set(0, 1);
      return;
    }
    // choose an anchor: aim above and beyond the goal
    const side = Math.random() < 0.5 ? 0 : 1;
    const anchorAim = _v.copy(goal).add(_w.set(0, 16 + Math.random() * 10, 0));
    const from = f.ropeOrigin(new THREE.Vector3());
    const dir = anchorAim.sub(from).normalize();
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
