import * as THREE from 'three';
import { MOVE } from '../../shared/constants';
import { CHAMPIONS, MATCH_RULES, type ChampionData, type ChampionId } from '../../shared/champions';
import type { ChampionVisual } from '../champions/types';
import { FighterAnimator } from '../fighter/FighterAnimator';
import { Hook, type HookState } from './Grapple';
import { newIntent, type Intent, type Kit, type MatchContext } from './types';
import type { RayHit } from '../world/Collision';

export type FighterKind = 'local' | 'bot' | 'remote';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _g = new THREE.Vector3();
const _u = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, box: null };
const _q = new THREE.Quaternion();
const WHITE = new THREE.Color(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

export function forwardOf(yaw: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}
export function rightOf(yaw: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-Math.cos(yaw), 0, Math.sin(yaw));
}
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function damp(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

/**
 * A champion in the arena. Simulated (local player / bot) or puppeted from the network.
 * Owns physics (capsule, dual grapple, dash, gas), combat status and the animated visual.
 */
export class Fighter {
  readonly champ: ChampionData;
  readonly anim: FighterAnimator;
  readonly hooks: [Hook, Hook];
  readonly intent: Intent = newIntent();

  // --- physics -------------------------------------------------------------------------------
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  grounded = false;
  private lastGroundedAt = -10;
  private wallNormal = new THREE.Vector3();
  private wallAt = -10;
  airJumps: number = MOVE.airJumps;
  facing = 0;
  aimYaw = 0;
  aimPitch = 0;
  gas: number = MOVE.gasMax;
  /** seconds until the gas tank starts refilling again */
  private gasWait = 0;
  /** tried to fire a hook with an empty tank (HUD feedback timer) */
  gasDenied = 0;
  boosting = false;
  dashTime = 0;
  dashCd = 0;
  private dashDir = new THREE.Vector3();
  private landImpact = 0;
  private prevVel = new THREE.Vector3();
  private bank = 0;
  private pitch = 0;
  private lateral = 0;
  /** wall-run timer (running up a building after hitting it at speed) */
  wallRun = 0;
  /** taunt emote time left */
  tauntT = 0;
  /** landing roll time left */
  rollT = 0;
  /** aerial flip (hook release / gas jump): time left; kind 0 = front flip, +-1 = barrel roll */
  flipT = 0;
  private flipDur = 0.6;
  private flipKind = 0;
  private flipCd = 0;
  /** launched by a big hit: backward somersault time left */
  tumbleT = 0;
  /** height the tucked body spins around (landing roll / aerial flip) */
  private tuckCentre = 0.95;
  private wasAttached = false;
  /** continuous wall-run time (capped so you eventually slide off) */
  private wallRunTotal = 0;
  /** velocity at the previous visual update (banking / lateral acceleration) */
  private visPrevVel = new THREE.Vector3();
  /** materials flashed white on hit */
  private flashMats: Array<{ m: THREE.MeshToonMaterial; base: THREE.Color }> = [];
  private flashing = false;

  // --- combat --------------------------------------------------------------------------------
  hp: number;
  maxHp: number;
  alive = true;
  deadTime = 0;
  ult = 0;
  invuln = 0;
  stun = 0;
  slow = 0;
  guard = false;
  guardStart = -10;
  spawnProtect = 0;
  kills = 0;
  deaths = 0;
  damageDealt = 0;
  lastAttackerId: string | null = null;
  /** flash timer for hit feedback */
  hitFlash = 0;
  /** weapon slash trails emitting */
  trailOn = false;

  /** per-frame overrides written by the kit */
  readonly ctrl = { lockMove: 0, gravityScale: 1, speedMul: 1, noHooks: false, aim: 0, noDash: false };

  kit: Kit | null = null;
  /** network smoothing target for remote puppets */
  readonly net = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), facing: 0, has: false };

  constructor(
    readonly id: string,
    public name: string,
    readonly champId: ChampionId,
    readonly kind: FighterKind,
    readonly visual: ChampionVisual,
    public team = 0,
  ) {
    this.champ = CHAMPIONS[champId];
    this.hp = this.maxHp = this.champ.hp;
    this.anim = new FighterAnimator(visual);
    const c = new THREE.Color(this.champ.colors[0]);
    this.hooks = [new Hook(c), new Hook(c)];
    for (const mat of visual.materials) {
      const tm = mat as THREE.MeshToonMaterial;
      if (tm.isMeshToonMaterial) this.flashMats.push({ m: tm, base: tm.emissive.clone() });
    }
  }

  get simulated(): boolean {
    return this.kind !== 'remote';
  }

  get hooked(): boolean {
    return this.hooks[0].attached || this.hooks[1].attached;
  }

  /** an ultimate is playing (local kit state or the replicated animation) */
  get ulting(): boolean {
    const act = (this.kit as unknown as { act: string | null } | null)?.act;
    if (act === 'ult' || act === 'ultRemote') return true;
    const a = this.anim.action;
    return a.active && (a.name === 'ult' || a.name === 'ultRise' || a.name === 'ultSlam');
  }

  get speed(): number {
    return this.vel.length();
  }

  /** objects to add to the scene */
  get sceneObjects(): THREE.Object3D[] {
    return [this.visual.root, ...this.visual.worldObjects, ...this.hooks.flatMap((h) => [h.visual.rope, h.visual.head])];
  }

  /** chest position (aim target) */
  chest(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos).setY(this.pos.y + 1.25);
  }

  head(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos).setY(this.pos.y + 1.68);
  }

  spawn(at: THREE.Vector3, yaw: number): void {
    this.pos.copy(at);
    this.vel.set(0, 0, 0);
    this.facing = this.aimYaw = yaw;
    this.aimPitch = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.gas = MOVE.gasMax;
    this.gasWait = 0;
    this.gasDenied = 0;
    this.stun = this.slow = this.dashTime = 0;
    this.spawnProtect = MATCH_RULES.spawnProtectSec;
    this.hooks.forEach((h) => h.reset());
    this.kit?.cancel(this);
    this.anim.action.stop(0);
    this.visual.root.visible = true;
    for (const o of this.visual.worldObjects) o.visible = true;
    for (const c of this.visual.cloth) c.reset();
    this.visual.root.position.copy(at);
    this.net.pos.copy(at);
    this.net.has = false;
  }

  // ===========================================================================================
  // Simulation (local + bots)
  // ===========================================================================================

  update(dt: number, m: MatchContext): void {
    this.timers(dt);
    if (this.simulated) {
      if (this.alive) {
        const it = this.intent;
        this.aimYaw = it.aimYaw;
        this.aimPitch = it.aimPitch;
        this.ctrl.gravityScale = 1;
        this.ctrl.speedMul = 1;
        this.ctrl.noHooks = false;
        this.ctrl.noDash = false;
        this.kit?.update(this, it, dt, m);
        this.updateTaunt(it, m);
        this.movement(dt, m);
        // letting go of the ropes while flying upward: release flip
        const attachedNow = this.hooked;
        if (this.wasAttached && !attachedNow) this.maybeFlip(m, 'release');
        this.wasAttached = attachedNow;
        // an attack started or a rope caught mid-flip: finish the rotation quickly
        if (this.flipT > 0 && (attachedNow || (this.kit as unknown as { act: string | null } | null)?.act)) this.flipT = Math.max(0, this.flipT - dt * 1.5);
      } else {
        // dead: drift with gravity a little, no control
        this.vel.multiplyScalar(Math.exp(-3 * dt));
      }
    } else {
      this.puppet(dt);
      this.kit?.tickRemote?.(this, dt, m);
    }
    this.updateVisual(dt, m);
  }

  /** start / cancel the champion taunt emote */
  private updateTaunt(it: Intent, m: MatchContext): void {
    const busy = (this.kit as unknown as { act: string | null } | null)?.act;
    if (it.tauntPressed && this.tauntT <= 0 && this.grounded && !busy && this.stun <= 0) {
      this.startTaunt();
      m.broadcastAction(this, { a: 'taunt' });
      return;
    }
    if (this.tauntT > 0) {
      const moving = it.move.lengthSq() > 0.01 || it.skillPressed || it.attackPressed || it.secondaryPressed || it.abilityPressed || it.ultimatePressed || it.jumpPressed || it.dashPressed || it.hookLPressed || it.hookRPressed;
      if (moving || !this.grounded || busy) this.stopTaunt();
    }
  }

  startTaunt(): void {
    const c = this.visual.anims.clips.taunt;
    if (!c) return;
    this.tauntT = c.duration;
    this.anim.play('taunt', { fadeIn: 0.1 });
  }

  stopTaunt(): void {
    if (this.tauntT <= 0) return;
    this.tauntT = 0;
    if (this.anim.action.name === 'taunt') this.anim.action.stop(0.15);
    this.trailOn = false;
  }

  private maybeFlip(m: MatchContext, why: 'release' | 'jump'): void {
    if (this.flipCd > 0 || this.grounded || !this.alive || this.stun > 0 || this.dashTime > 0 || this.guard) return;
    if ((this.kit as unknown as { act: string | null } | null)?.act || this.kit?.facesAim(this)) return;
    if (why === 'release' && (this.vel.y < 2 || this.speed < 12)) return;
    // leaving a hard sideways swing: barrel roll toward the lean, otherwise a front flip
    const kind = why === 'release' && Math.abs(this.bank) > 0.45 ? Math.sign(this.bank) : 0;
    this.startFlip(kind);
    m.broadcastAction(this, { a: 'flip', n: kind });
  }

  startFlip(kind: number): void {
    this.flipKind = kind;
    this.flipDur = kind === 0 ? 0.62 : 0.55;
    this.flipT = this.flipDur;
    this.flipCd = 0.9;
    this.tuckCentre = 0.95;
    const act = this.anim.action;
    if (!act.active || act.name === 'roll') this.anim.play('roll', { fadeIn: 0.08, fadeOut: 0.16, speed: 0.5 / this.flipDur });
  }

  /** knocked into the air: flailing backward somersault (visual only) */
  startTumble(): void {
    this.tumbleT = 0.9;
    this.flipT = 0;
    this.anim.tumble = 1;
  }

  private timers(dt: number): void {
    this.invuln = Math.max(0, this.invuln - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.slow = Math.max(0, this.slow - dt);
    this.dashTime = Math.max(0, this.dashTime - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.spawnProtect = Math.max(0, this.spawnProtect - dt);
    this.ctrl.lockMove = Math.max(0, this.ctrl.lockMove - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.tauntT = Math.max(0, this.tauntT - dt);
    this.rollT = Math.max(0, this.rollT - dt);
    this.flipT = Math.max(0, this.flipT - dt);
    this.flipCd = Math.max(0, this.flipCd - dt);
    this.tumbleT = Math.max(0, this.tumbleT - dt);
    this.gasDenied = Math.max(0, this.gasDenied - dt);
    if (this.wallRun > 0) this.wallRunTotal += dt;
    else if (this.hooked) this.wallRunTotal = 0;
    this.wallRun = Math.max(0, this.wallRun - dt);
    if (!this.alive) this.deadTime += dt;
  }

  private movement(dt: number, m: MatchContext): void {
    const it = this.intent;
    const w = m.world;
    const stunned = this.stun > 0;
    // wish direction
    forwardOf(this.aimYaw, _f);
    rightOf(this.aimYaw, _r);
    const wish = _w.set(0, 0, 0).addScaledVector(_f, it.move.y).addScaledVector(_r, it.move.x);
    if (wish.lengthSq() > 1) wish.normalize();
    if (this.ctrl.lockMove > 0 || stunned) wish.set(0, 0, 0);

    // hooks
    this.updateHook(0, it.hookL, it.hookLPressed && !stunned, dt, m);
    this.updateHook(1, it.hookR, it.hookRPressed && !stunned, dt, m);
    const attached = (this.hooks[0].attached ? 1 : 0) + (this.hooks[1].attached ? 1 : 0);

    // dash
    if (it.dashPressed && !stunned && !this.ctrl.noDash && this.dashCd <= 0 && this.gas >= MOVE.dashCost) {
      const dir = wish.lengthSq() > 0.01 ? _d.copy(wish).normalize() : forwardOf(this.aimYaw, _d);
      if (!this.grounded) {
        // in the air dash follows the camera pitch a bit
        dir.y += Math.sin(this.aimPitch) * 0.6 * (it.move.y >= 0 ? 1 : -1);
        dir.normalize();
      }
      this.startDash(dir, m);
    }

    // jump / wall-kick / gas air-jump
    if (it.jumpPressed && !stunned && attached === 0) {
      const now = m.time;
      if (this.grounded || now - this.lastGroundedAt < MOVE.coyoteTime) {
        this.vel.y = Math.max(this.vel.y, MOVE.jumpVel);
        this.grounded = false;
        this.lastGroundedAt = -10;
        m.audio.play('jump', this.pos, 0.5);
      } else if (now - this.wallAt < 0.18) {
        this.vel.copy(this.wallNormal).multiplyScalar(MOVE.wallKickVel);
        this.vel.y = MOVE.jumpVel;
        this.vel.addScaledVector(wish, 4);
        this.wallAt = -10;
        m.vfx.gasPuff(this.pos.clone().setY(this.pos.y + 0.8), this.wallNormal, this.champ.colors[0]);
        m.audio.play('wallkick', this.pos, 0.6);
      } else if (this.airJumps > 0 && this.gas >= MOVE.airJumpCost) {
        this.airJumps--;
        this.spendGas(MOVE.airJumpCost);
        this.vel.y = Math.max(this.vel.y * 0.3, 0) + MOVE.airJumpVel;
        this.vel.addScaledVector(wish, 3);
        m.vfx.gasBurst(this.nozzleWorld(_c), this.champ.colors[0]);
        m.audio.play('gasBurst', this.pos, 0.6);
        this.maybeFlip(m, 'jump');
      }
    }

    // boost
    const wantBoost = it.jump && attached > 0 && !stunned && this.gas > 0;
    if (wantBoost && !this.boosting) m.audio.play('boostStart', this.pos, 0.5);
    this.boosting = wantBoost;

    // integrate with substeps
    const spd = this.vel.length();
    const steps = THREE.MathUtils.clamp(Math.ceil((spd * dt) / 0.3), 1, 8);
    const h = dt / steps;
    const runSpeed = MOVE.runSpeed * this.champ.speed * this.ctrl.speedMul * (this.slow > 0 ? 0.55 : 1);
    this.prevVel.copy(this.vel);
    for (let s = 0; s < steps; s++) {
      _acc.set(0, -MOVE.gravity * this.ctrl.gravityScale * (attached > 0 ? MOVE.hookedGravity : 1), 0);
      if (this.dashTime > 0) _acc.y *= 0.12;
      const onGround = this.grounded && attached === 0 && this.vel.y <= 0.5;
      if (onGround) {
        _acc.y = Math.min(_acc.y, 0);
        this.groundMove(wish, runSpeed, h);
      } else if (this.dashTime <= 0) {
        if (attached === 0 && wish.lengthSq() > 0.001) {
          const along = this.vel.x * wish.x + this.vel.z * wish.z;
          if (along < MOVE.airMaxSpeed) _acc.addScaledVector(wish, MOVE.airAccel);
        }
        // quadratic drag
        const v = this.vel.length();
        this.vel.multiplyScalar(Math.max(0, 1 - MOVE.airDrag * v * h));
      }
      // grapple forces
      for (const hk of this.hooks) {
        if (!hk.attached) continue;
        this.ropeOrigin(_c);
        _d.subVectors(hk.anchor, _c);
        const dist = _d.length();
        if (dist < 1e-4) continue;
        _d.divideScalar(dist);
        const share = attached === 2 ? 0.62 : 1;
        _acc.addScaledVector(_d, (MOVE.reelAccel + (this.boosting ? MOVE.boostAccel : 0)) * share);
        if (wish.lengthSq() > 0.001) {
          _g.copy(wish).addScaledVector(_d, -wish.dot(_d));
          _acc.addScaledVector(_g, MOVE.swingAccel * share);
        }
        hk.ropeLen = Math.min(hk.ropeLen, dist);
      }
      this.vel.addScaledVector(_acc, h);
      this.pos.addScaledVector(this.vel, h);
      // rope constraints
      for (let iter = 0; iter < 2; iter++) {
        for (const hk of this.hooks) {
          if (!hk.attached) continue;
          this.ropeOrigin(_c);
          _d.subVectors(_c, hk.anchor);
          const dist = _d.length();
          if (dist > hk.ropeLen && dist > 1e-4) {
            _d.divideScalar(dist);
            this.pos.addScaledVector(_d, -(dist - hk.ropeLen));
            const vr = this.vel.dot(_d);
            if (vr > 0) this.vel.addScaledVector(_d, -vr);
          }
        }
      }
      this.collide(m, h);
    }

    // landing detection
    if (this.grounded && this.landImpact > 0) {
      const impact = this.landImpact;
      this.landImpact = 0;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (impact > 14 && hs > 11 && !(this.kit as unknown as { act: string | null } | null)?.act) {
        // fast landing with momentum: stylish forward roll instead of a crouch
        this.rollT = 0.42;
        this.flipT = 0;
        this.tuckCentre = 0.62;
        this.anim.play('roll', { fadeIn: 0.04, fadeOut: 0.12 });
        m.audio.play('land', this.pos, 0.6);
        m.vfx.landing(this.pos, this.champ.colors[0], 0.4);
      } else if (impact > 9) {
        this.anim.st.wLand = THREE.MathUtils.clamp((impact - 6) / 16, 0.25, 1);
        m.audio.play('land', this.pos, Math.min(1, impact / 25));
        if (impact > 20) {
          m.vfx.landing(this.pos, this.champ.colors[0], Math.min(1, impact / 35));
          if (this.kind === 'local') m.shake(Math.min(0.5, impact / 60));
        }
      }
    }

    // gas
    if (this.boosting) {
      this.spendGas(MOVE.boostCost * dt);
      if (this.gas <= 0) this.boosting = false;
    } else if (this.dashTime <= 0) {
      if (this.gasWait > 0) this.gasWait = Math.max(0, this.gasWait - dt);
      else this.gas = Math.min(MOVE.gasMax, this.gas + (this.grounded ? MOVE.gasRegenGround : MOVE.gasRegenAir) * dt);
    }

    // world bounds
    const b = w.bounds;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, b.minX, b.maxX);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, b.minZ, b.maxZ);
    if (this.pos.y > b.maxY) {
      this.pos.y = b.maxY;
      this.vel.y = Math.min(0, this.vel.y);
    }
  }

  private groundMove(wish: THREE.Vector3, maxSpeed: number, h: number): void {
    if (this.dashTime > 0) return;
    const vx = this.vel.x;
    const vz = this.vel.z;
    const vh = Math.hypot(vx, vz);
    const wl = wish.length();
    if (this.rollT > 0 && vh > 0.5) {
      // landing roll: keeps the momentum (almost no friction) and steers lightly toward the input
      const k = Math.exp(-1.6 * h);
      let dx = vx / vh;
      let dz = vz / vh;
      if (wl > 0.01) {
        const s = 1 - Math.exp(-4 * h);
        dx += (wish.x / wl - dx) * s;
        dz += (wish.z / wl - dz) * s;
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
      }
      this.vel.x = dx * vh * k;
      this.vel.z = dz * vh * k;
      return;
    }
    if (wl < 0.01) {
      const k = Math.exp(-MOVE.groundFriction * h);
      this.vel.x *= k;
      this.vel.z *= k;
      return;
    }
    if (vh > maxSpeed + 0.5 && vx * wish.x + vz * wish.z > 0) {
      // momentum slide after a fast landing: decay slowly, steer gently
      const k = Math.exp(-3.2 * h);
      this.vel.x = (vx * k) * 0.97 + wish.x * vh * k * 0.03;
      this.vel.z = (vz * k) * 0.97 + wish.z * vh * k * 0.03;
      return;
    }
    const tx = wish.x * maxSpeed;
    const tz = wish.z * maxSpeed;
    let dx = tx - vx;
    let dz = tz - vz;
    const dl = Math.hypot(dx, dz);
    const maxDv = MOVE.groundAccel * h;
    if (dl > maxDv) {
      dx = (dx / dl) * maxDv;
      dz = (dz / dl) * maxDv;
    }
    this.vel.x += dx;
    this.vel.z += dz;
  }

  private collide(m: MatchContext, _h: number): void {
    const w = m.world;
    let ground = false;
    const r = MOVE.capsuleRadius;
    for (const hgt of MOVE.capsuleHeights) {
      _c.set(this.pos.x, this.pos.y + hgt, this.pos.z);
      const push = w.resolveSphere(_c, r, _n);
      if (push.lengthSq() > 0) {
        this.pos.add(push);
        const vn = this.vel.dot(_n);
        if (vn < 0) {
          if (_n.y > 0.6 && this.vel.y < -1) this.landImpact = Math.max(this.landImpact, -this.vel.y);
          this.vel.addScaledVector(_n, -vn);
        }
        if (_n.y > 0.6) ground = true;
        else if (Math.abs(_n.y) < 0.5) {
          this.wallNormal.copy(_n).setY(0).normalize();
          this.wallAt = m.time;
          // wall-run: convert the impact into running up the wall while pushing toward it
          if (!this.grounded && this.simulated && this.alive && this.intent.move.y > 0.3 && Math.abs(_n.y) < 0.35 && this.wallRunTotal < 2.6) {
            const into = -vn;
            if (into > 7 || this.wallRun > 0) {
              const up = Math.min(Math.max(into * 0.65, this.wallRun > 0 ? 9 : 0), 22);
              if (this.vel.y < up) this.vel.y = up;
              if (this.wallRun <= 0) {
                m.vfx.gasPuff(_c.clone(), this.wallNormal, this.champ.colors[0]);
                m.audio.play('wallkick', this.pos, 0.5);
              }
              this.wallRun = 0.25;
              this.airJumps = MOVE.airJumps;
            }
          }
        }
      }
    }
    // ground probe (stick to the floor when walking down small steps)
    if (!ground && this.grounded && this.vel.y <= 0.1 && !this.hooked) {
      _c.set(this.pos.x, this.pos.y + 0.3, this.pos.z);
      const hit = w.raycast(_c, DOWN, 0.55, _hit);
      if (hit && hit.normal.y > 0.6) {
        this.pos.y = hit.point.y;
        this.vel.y = Math.min(this.vel.y, 0);
        ground = true;
      }
    }
    if (ground) {
      if (!this.grounded) this.airJumps = MOVE.airJumps;
      this.lastGroundedAt = m.time;
      this.wallRunTotal = 0;
    }
    this.grounded = ground;
  }

  private startDash(dir: THREE.Vector3, m: MatchContext): void {
    this.spendGas(MOVE.dashCost);
    this.dashTime = MOVE.dashTime;
    this.dashCd = MOVE.dashCooldown;
    this.invuln = Math.max(this.invuln, MOVE.dashIFrames);
    this.dashDir.copy(dir);
    const keep = this.vel.clone().multiplyScalar(0.35);
    this.vel.copy(dir).multiplyScalar(MOVE.dashSpeed).add(keep);
    if (this.grounded) this.vel.y = Math.max(this.vel.y, 1.5);
    m.vfx.gasBurst(this.nozzleWorld(_c), this.champ.colors[0]);
    m.vfx.dashLines(this, dir);
    m.audio.play('dash', this.pos, 0.7);
  }

  // ---------------------------------------------------------------------------------------------
  // Grapple
  // ---------------------------------------------------------------------------------------------

  ropeOrigin(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
  }

  gearWorld(i: number, out: THREE.Vector3): THREE.Vector3 {
    return (i === 0 ? this.visual.gearL : this.visual.gearR).getWorldPosition(out);
  }

  nozzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.visual.nozzle.getWorldPosition(out);
  }

  private updateHook(i: number, held: boolean, pressed: boolean, dt: number, m: MatchContext): void {
    const hk = this.hooks[i];
    this.gearWorld(i, _g);
    if (pressed && !this.ctrl.noHooks && (hk.state === 'idle' || hk.state === 'retract')) {
      if (this.gas < MOVE.hookCost) {
        // empty tank: the launcher just clicks
        if (this.gasDenied <= 0) m.audio.play('hookDry', this.pos, 0.8);
        this.gasDenied = 0.45;
        return;
      }
      this.spendGas(MOVE.hookCost);
      this.fireHook(i, m);
      return;
    }
    switch (hk.state) {
      case 'flying': {
        if (!held) {
          hk.state = 'retract';
          break;
        }
        hk.t += dt;
        _d.subVectors(hk.anchor, hk.tip);
        const left = _d.length();
        const step = MOVE.hookSpeed * dt;
        if (left <= step) {
          hk.tip.copy(hk.anchor);
          if (hk.valid) {
            hk.state = 'attached';
            hk.t = 0;
            this.ropeOrigin(_c);
            hk.ropeLen = _c.distanceTo(hk.anchor);
            this.airJumps = MOVE.airJumps;
            // punchy yank toward the anchor (lifts you off the ground)
            _d.subVectors(hk.anchor, _c).normalize();
            this.vel.addScaledVector(_d, MOVE.attachYank);
            if (this.grounded) {
              this.vel.y = Math.max(this.vel.y, 0) + 6;
              this.grounded = false;
            }
            m.vfx.hookImpact(hk.anchor, hk.normal, this.champ.colors[0]);
            m.audio.play('hookHit', hk.anchor, 0.8);
          } else {
            hk.state = 'retract';
          }
        } else {
          hk.tip.addScaledVector(_d, step / left);
        }
        break;
      }
      case 'attached': {
        hk.t += dt;
        if (hk.targetId) {
          const tgt = m.fighters.find((f) => f.id === hk.targetId);
          if (!tgt || !tgt.alive || hk.t > MOVE.playerHookMaxTime) {
            hk.state = 'retract';
            hk.targetId = null;
            break;
          }
          tgt.chest(hk.anchor);
          hk.tip.copy(hk.anchor);
        }
        if (!held || this.stun > 0) {
          hk.state = 'retract';
          hk.targetId = null;
          break;
        }
        this.ropeOrigin(_c);
        const dist = _c.distanceTo(hk.anchor);
        if (dist < MOVE.hookMinLen) {
          // arrived: release with a little vault
          hk.state = 'retract';
          hk.targetId = null;
          this.vel.y = Math.max(this.vel.y, 7);
        }
        break;
      }
      case 'retract': {
        _d.subVectors(_g, hk.tip);
        const left = _d.length();
        const step = MOVE.hookSpeed * 1.6 * dt;
        if (left <= step) {
          hk.state = 'idle';
          hk.visual.setVisible(false);
        } else hk.tip.addScaledVector(_d, step / left);
        break;
      }
      default:
        break;
    }
  }

  private spendGas(amount: number): void {
    this.gas = Math.max(0, this.gas - amount);
    this.gasWait = MOVE.gasRegenDelay;
  }

  private fireHook(i: number, m: MatchContext): void {
    const hk = this.hooks[i];
    this.gearWorld(i, _g);
    hk.tip.copy(_g);
    hk.t = 0;
    hk.targetId = null;
    const target = this.findHookTarget(i, m);
    if (target) {
      hk.anchor.copy(target.point);
      hk.normal.copy(target.normal);
      hk.valid = true;
      hk.targetId = target.fighterId;
    } else {
      hk.anchor.copy(_g).addScaledVector(this.intent.aimDir, MOVE.hookRange);
      hk.normal.copy(this.intent.aimDir).negate();
      hk.valid = false;
    }
    hk.flightLen = Math.max(1, _g.distanceTo(hk.anchor));
    hk.state = 'flying';
    m.audio.play('hookFire', this.pos, 0.7);
    m.broadcastAction(this, { a: i === 0 ? 'hookL' : 'hookR', p: [hk.anchor.x, hk.anchor.y, hk.anchor.z], n: hk.valid ? 1 : 0, t: hk.targetId ?? undefined });
  }

  /** Grapple target from the aim ray, with left/right offsets, enemy hooking and cone assist. */
  findHookTarget(i: number, m: MatchContext): { point: THREE.Vector3; normal: THREE.Vector3; fighterId: string | null } | null {
    const it = this.intent;
    const w = m.world;
    this.gearWorld(i, _g);
    // 1) enemies close to the crosshair
    let bestF: Fighter | null = null;
    let bestAng = THREE.MathUtils.degToRad(3.5);
    for (const f of m.fighters) {
      if (f === this || !f.alive) continue;
      f.chest(_c);
      const dist = _c.distanceTo(_g);
      if (dist > 60 || dist < 3) continue;
      _d.subVectors(_c, it.aimOrigin).normalize();
      const ang = _d.angleTo(it.aimDir);
      if (ang < bestAng) {
        // line of sight
        _v.subVectors(_c, _g);
        const l = _v.length();
        _v.divideScalar(l);
        if (!w.raycast(_g, _v, l - 0.5, _hit)) {
          bestAng = ang;
          bestF = f;
        }
      }
    }
    if (bestF) {
      const p = bestF.chest(new THREE.Vector3());
      return { point: p, normal: new THREE.Vector3().subVectors(_g, p).normalize(), fighterId: bestF.id };
    }
    // 2) crosshair ray (with slight per-hook yaw offset so both lines form a V)
    const range = MOVE.hookRange;
    const side = i === 0 ? 1 : -1;
    const tryDir = (dir: THREE.Vector3, fromCam: boolean): { point: THREE.Vector3; normal: THREE.Vector3; fighterId: null } | null => {
      const origin = fromCam ? it.aimOrigin : _g;
      const max = fromCam ? range + it.aimOrigin.distanceTo(_g) : range;
      const hit = w.raycast(origin, dir, max, _hit);
      if (!hit || !hit.box?.grapple) return null;
      if (hit.point.distanceTo(_g) > range) return null;
      return { point: hit.point.clone(), normal: hit.normal.clone(), fighterId: null };
    };
    _q.setFromAxisAngle(UP, THREE.MathUtils.degToRad(2.2 * side));
    _d.copy(it.aimDir).applyQuaternion(_q);
    let r = tryDir(_d, true) ?? tryDir(it.aimDir, true);
    if (r) return r;
    // 3) assist cone from the gear, biased upward and toward the hook side
    const base = it.aimDir.clone();
    let best: { point: THREE.Vector3; normal: THREE.Vector3; fighterId: null } | null = null;
    let bestA = Infinity;
    const right = new THREE.Vector3().crossVectors(base, UP).normalize();
    const up2 = new THREE.Vector3().crossVectors(right, base).normalize();
    for (const ringDeg of [5, 10, 15, MOVE.hookAssistDeg]) {
      const rr = THREE.MathUtils.degToRad(ringDeg);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const ox = Math.cos(a);
        const oy = Math.sin(a) * 0.8 + 0.35;
        _d.copy(base).addScaledVector(right, ox * Math.tan(rr) * -side * 0.9 + ox * Math.tan(rr) * 0.1).addScaledVector(up2, oy * Math.tan(rr)).normalize();
        r = tryDir(_d, false);
        if (r) {
          const ang = _d.angleTo(base) - (r.point.y > _g.y ? 0.05 : 0);
          if (ang < bestA) {
            bestA = ang;
            best = r;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Current aim-assist hook target for HUD (local player only). */
  previewHook(m: MatchContext): boolean {
    return !!this.findHookTarget(0, m);
  }

  // ---------------------------------------------------------------------------------------------
  // Remote puppet
  // ---------------------------------------------------------------------------------------------

  /** network: apply a remote hook state (from snapshots or action events) */
  applyRemoteHook(i: number, code: HookState, anchor?: [number, number, number]): void {
    const hk = this.hooks[i];
    const now = performance.now();
    if (anchor) hk.anchor.set(anchor[0], anchor[1], anchor[2]);
    if (code === hk.state) return;
    // snapshots lag behind action events: don't cancel a fresh flight with a stale 'idle'
    if ((code === 'idle' || code === 'retract') && hk.state === 'flying' && now - hk.remoteAt < 350) return;
    if (code === 'flying') {
      if (hk.state === 'attached') return;
      this.gearWorld(i, hk.tip);
      hk.flightLen = Math.max(1, hk.tip.distanceTo(hk.anchor));
      hk.state = 'flying';
      hk.valid = true;
      hk.remoteAt = now;
    } else if (code === 'attached') {
      hk.state = 'attached';
      hk.tip.copy(hk.anchor);
      this.ropeOrigin(_c);
      hk.ropeLen = _c.distanceTo(hk.anchor);
      hk.normal.subVectors(_c, hk.anchor).normalize();
    } else if (code === 'retract') {
      hk.state = 'retract';
    } else {
      hk.state = 'idle';
      hk.visual.setVisible(false);
    }
  }

  private puppetHooks(dt: number): void {
    for (let i = 0; i < 2; i++) {
      const hk = this.hooks[i];
      if (hk.state === 'flying') {
        _d.subVectors(hk.anchor, hk.tip);
        const left = _d.length();
        const step = MOVE.hookSpeed * dt;
        if (left <= step) hk.tip.copy(hk.anchor);
        else hk.tip.addScaledVector(_d, step / left);
      } else if (hk.state === 'retract') {
        this.gearWorld(i, _g);
        _d.subVectors(_g, hk.tip);
        const left = _d.length();
        const step = MOVE.hookSpeed * 1.6 * dt;
        if (left <= step) {
          hk.state = 'idle';
          hk.visual.setVisible(false);
        } else hk.tip.addScaledVector(_d, step / left);
      } else if (hk.state === 'attached') hk.tip.copy(hk.anchor);
    }
  }

  private puppet(dt: number): void {
    this.puppetHooks(dt);
    if (!this.net.has) return;
    // the network layer writes interpolated state into net.*; ease toward it
    this.pos.lerp(this.net.pos, 1 - Math.exp(-dt * 25));
    if (this.pos.distanceToSquared(this.net.pos) > 64) this.pos.copy(this.net.pos);
    this.vel.copy(this.net.vel);
  }

  // ---------------------------------------------------------------------------------------------
  // Visual
  // ---------------------------------------------------------------------------------------------

  private updateVisual(dt: number, m: MatchContext): void {
    const v = this.visual;
    const st = this.anim.st;
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    const hooked = this.hooked;
    const airborne = !this.grounded;
    const faceAim = (this.kit?.facesAim(this) ?? false) || this.guard;

    // facing
    let target = this.facing;
    let rate = 12;
    if (faceAim) {
      target = this.kit?.faceYaw ?? this.aimYaw;
      rate = 24;
    } else if (this.dashTime > 0) {
      target = Math.atan2(this.dashDir.x, this.dashDir.z);
      rate = 30;
    } else if (hspeed > 1.2) {
      target = Math.atan2(this.vel.x, this.vel.z);
      rate = airborne ? 7 : 13;
    }
    if (!this.simulated && !faceAim && hspeed <= 1.2) target = this.net.facing;
    if (this.wallRun > 0) {
      target = Math.atan2(-this.wallNormal.x, -this.wallNormal.z);
      rate = 25;
    }
    const prevFacing = this.facing;
    this.facing = wrapAngle(this.facing + wrapAngle(target - this.facing) * (1 - Math.exp(-rate * dt)));
    const turnRate = wrapAngle(this.facing - prevFacing) / Math.max(dt, 1e-4);

    v.root.position.copy(this.pos);
    v.root.rotation.y = this.facing + THREE.MathUtils.degToRad(this.kit?.spin ?? 0);

    // pivot pitch / bank (grapple flight)
    const flying = (hooked || (airborne && this.speed > 20)) && this.alive;
    const speed = this.speed;
    let pitchT = 0;
    let bankT = 0;
    if (flying && !faceAim) {
      const vyN = speed > 0.1 ? this.vel.y / speed : 0;
      const sf = THREE.MathUtils.clamp((speed - 6) / 30, 0, 1);
      pitchT = THREE.MathUtils.clamp(0.45 - vyN * 0.7, -0.5, 1.15) * sf;
      // lean into the curve: lateral (centripetal) acceleration relative to facing
      _v.subVectors(this.vel, this.visPrevVel).divideScalar(Math.max(dt, 1e-4));
      rightOf(this.facing, _r);
      this.lateral = damp(this.lateral, _v.dot(_r), 6, dt);
      bankT = THREE.MathUtils.clamp(this.lateral * 0.022 - turnRate * 0.12, -1.0, 1.0) * sf;
      // hanging from taut ropes the body lines up with the pull, like a pendulum
      const ropeW = hooked ? this.ropePull(_u) : 0;
      if (ropeW > 0) {
        _u.lerp(UP, 0.15).normalize();
        forwardOf(this.facing, _f);
        const rp = THREE.MathUtils.clamp(Math.atan2(_u.dot(_f), _u.y), -1.0, 1.35);
        const rb = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(_u.dot(_r), -1, 1)), -1.1, 1.1);
        pitchT = THREE.MathUtils.lerp(pitchT, rp, ropeW);
        bankT = THREE.MathUtils.lerp(bankT, rb, ropeW);
      }
    } else if (this.grounded && hspeed > 3 && !faceAim) {
      // slight lean when turning on the ground
      bankT = THREE.MathUtils.clamp(-turnRate * 0.06, -0.3, 0.3);
      pitchT = THREE.MathUtils.clamp(hspeed / 40, 0, 0.12);
    }
    if (this.dashTime > 0) pitchT = 0.35;
    if (this.wallRun > 0) {
      pitchT = -1.25;
      bankT = 0;
    }
    this.pitch = damp(this.pitch, pitchT, 8, dt);
    this.bank = damp(this.bank, bankT, 7, dt);
    // tuck (landing roll / aerial flip): the 'roll' clip drops the hips 0.35 m, so re-centre the
    // body on the pivot by exactly the clip weight and spin around the tucked hips
    const hipH = v.rig.hipHeight;
    const tw = this.anim.action.name === 'roll' ? this.anim.action.weight : 0;
    v.pivot.position.y = THREE.MathUtils.lerp(hipH, this.tuckCentre, tw);
    v.rig.root.position.y = -(hipH - 0.35 * tw);
    let rx = this.pitch;
    let rz = this.bank;
    if (this.rollT > 0) rx += (1 - this.rollT / 0.42) * Math.PI * 2;
    if (this.flipT > 0) {
      const u = 1 - this.flipT / this.flipDur;
      const a = u * u * (3 - 2 * u) * Math.PI * 2;
      if (this.flipKind === 0) rx += a;
      else rz += a * this.flipKind;
    }
    if (this.tumbleT > 0) {
      // touched down mid-spin: finish the rotation in a few frames instead of snapping
      if (this.grounded) this.tumbleT = Math.max(0, this.tumbleT - dt * 4);
      const u = 1 - this.tumbleT / 0.9;
      rx -= (1 - (1 - u) * (1 - u)) * Math.PI * 2;
    }
    v.pivot.rotation.set(rx, 0, rz, 'YXZ');

    // animation state
    const wallRunning = this.wallRun > 0;
    const runT = ((this.grounded && hspeed > 0.6) || wallRunning) && this.alive ? 1 : 0;
    st.wRun = damp(st.wRun, runT, wallRunning ? 25 : 12, dt);
    st.runIntensity = wallRunning ? 1.2 : THREE.MathUtils.clamp(hspeed / (MOVE.runSpeed * 1.0), 0, 1.25);
    const cycleSpeed = wallRunning ? Math.max(8, this.vel.y) : hspeed;
    st.runPhase += dt * (cycleSpeed / 2.3) * Math.PI * 2 * (faceAim && this.isMovingBack() ? -1 : 1);
    st.wAir = damp(st.wAir, airborne && !flying && !wallRunning ? 1 : 0, 10, dt);
    st.wFly = damp(st.wFly, flying && !faceAim && !wallRunning ? 1 : 0, 6, dt);
    st.vy = this.vel.y;
    if (hooked && speed > 1) {
      const vyN = this.vel.y / speed;
      st.swing = damp(st.swing, THREE.MathUtils.clamp(0.25 + vyN * 1.4, 0, 1), 4, dt);
    } else st.swing = damp(st.swing, 0, 3, dt);
    st.wDash = damp(st.wDash, this.dashTime > 0 ? 1 : 0, this.dashTime > 0 ? 30 : 8, dt);
    st.wLand = Math.max(0, st.wLand - dt * 3.5);
    st.lookYaw = THREE.MathUtils.radToDeg(wrapAngle(this.aimYaw - this.facing));
    st.lookPitch = THREE.MathUtils.radToDeg(-this.aimPitch);
    st.aim = damp(st.aim, this.ctrl.aim, 12, dt);
    // strafing: local movement relative to facing
    if (faceAim && this.grounded && hspeed > 0.5) {
      rightOf(this.facing, _r);
      forwardOf(this.facing, _f);
      const lx = (this.vel.x * _r.x + this.vel.z * _r.z) / hspeed;
      st.strafe = damp(st.strafe, THREE.MathUtils.clamp(lx, -1, 1) * 0.6, 8, dt);
    } else st.strafe = damp(st.strafe, 0, 8, dt);

    // wind for cloth: opposite of velocity (relative air)
    this.anim.wind.copy(this.vel).multiplyScalar(-0.6);
    this.anim.wind.y -= 2;

    this.anim.update(dt, airborne && !this.grounded);
    // anim events -> kit
    if (this.anim.action.events.length) {
      for (const ev of this.anim.action.events) {
        if (this.tauntT > 0 || this.anim.action.name === 'taunt') this.tauntEvent(ev, m);
        else this.kit?.onAnimEvent(this, ev, m);
      }
      this.anim.action.events.length = 0;
    }

    // hooks visuals
    for (let i = 0; i < 2; i++) {
      const hk = this.hooks[i];
      if (hk.state === 'idle' || !this.alive) {
        hk.visual.setVisible(false);
        continue;
      }
      this.gearWorld(i, _g);
      let wobble = 0;
      let sag = 0;
      if (hk.state === 'flying') wobble = 1 - Math.min(1, hk.tip.distanceTo(_g) / hk.flightLen);
      if (hk.state === 'retract') sag = 0.6;
      if (hk.state === 'attached') {
        this.ropeOrigin(_c);
        const slack = hk.ropeLen - _c.distanceTo(hk.anchor);
        sag = Math.max(0, Math.min(2, slack));
      }
      _d.subVectors(hk.tip, _g);
      if (hk.state === 'attached' && !hk.targetId) _d.copy(hk.normal).negate();
      hk.visual.update(_g, hk.tip, m.camPos, m.time, wobble * 0.8, sag, _d);
    }

    // weapon energy / champion idle fx
    v.tick(dt, m.time, this.boosting ? 1 : Math.min(1, this.speed / 30));
    this.visPrevVel.copy(this.vel);
    // Persona-style white hit flash
    if (this.hitFlash > 0 || this.flashing) {
      const k = this.hitFlash > 0 ? Math.min(1, this.hitFlash / 0.12) * 0.75 : 0;
      for (const fm of this.flashMats) fm.m.emissive.copy(fm.base).lerp(WHITE, k);
      this.flashing = this.hitFlash > 0;
    }
  }

  private tauntEvent(ev: string, m: MatchContext): void {
    if (ev === 'swing') this.trailOn = true;
    else if (ev === 'hitOff') this.trailOn = false;
    else if (ev === 'plant') {
      forwardOf(this.facing, _f);
      const p = this.pos.clone().addScaledVector(_f, 0.6);
      m.vfx.landing(p, this.champ.colors[0], 0.5);
      m.vfx.hitSpark(p.setY(p.y + 0.1), UP, this.champ.colors[0], false);
      m.audio.play('block', this.pos, 0.7);
      m.shake(0.15, this.pos);
    } else if (ev === 'sparkle') {
      const h = this.head(new THREE.Vector3());
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        m.vfx.add.emit({ pos: h.clone(), vel: new THREE.Vector3(Math.cos(a) * 3, 2 + Math.random() * 2, Math.sin(a) * 3), life: 0.6, size: 0.12, color: i % 2 ? this.champ.colors[0] : this.champ.colors[1], shape: 2, drag: 2 });
      }
      m.audio.play('note', this.pos, 0.6);
    }
  }

  /**
   * Direction of the combined rope pull (unit, written to out) and how taut the ropes are (0..1).
   */
  private ropePull(out: THREE.Vector3): number {
    out.set(0, 0, 0);
    this.ropeOrigin(_c);
    let taut = 0;
    for (const hk of this.hooks) {
      if (hk.state !== 'attached') continue;
      _d.subVectors(hk.anchor, _c);
      const dist = _d.length();
      if (dist < 0.6) continue;
      const k = THREE.MathUtils.clamp(1 - (hk.ropeLen - dist) / 1.2, 0, 1);
      out.addScaledVector(_d, k / dist);
      taut = Math.max(taut, k);
    }
    const l = out.length();
    if (l < 1e-3) return 0;
    out.divideScalar(l);
    return taut;
  }

  isMovingBack(): boolean {
    forwardOf(this.facing, _f);
    return this.vel.x * _f.x + this.vel.z * _f.z < -0.5;
  }
}

const DOWN = new THREE.Vector3(0, -1, 0);
