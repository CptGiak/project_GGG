import * as THREE from 'three';
import type { CollisionWorld } from '../world/Collision';
import type { Fighter } from './Fighter';

/** Per-frame control intent, produced by the local player, a bot, or nothing (remote). */
export interface Intent {
  /** x = strafe right(+)/left(-), y = forward(+)/back(-) relative to aimYaw */
  move: THREE.Vector2;
  aimYaw: number;
  aimPitch: number;
  /** aim ray (camera) */
  aimOrigin: THREE.Vector3;
  aimDir: THREE.Vector3;
  jump: boolean;
  jumpPressed: boolean;
  dashPressed: boolean;
  hookL: boolean;
  hookLPressed: boolean;
  hookR: boolean;
  hookRPressed: boolean;
  attack: boolean;
  attackPressed: boolean;
  secondary: boolean;
  secondaryPressed: boolean;
  secondaryReleased: boolean;
  abilityPressed: boolean;
  ultimatePressed: boolean;
}

export function newIntent(): Intent {
  return {
    move: new THREE.Vector2(),
    aimYaw: 0,
    aimPitch: 0,
    aimOrigin: new THREE.Vector3(),
    aimDir: new THREE.Vector3(0, 0, 1),
    jump: false,
    jumpPressed: false,
    dashPressed: false,
    hookL: false,
    hookLPressed: false,
    hookR: false,
    hookRPressed: false,
    attack: false,
    attackPressed: false,
    secondary: false,
    secondaryPressed: false,
    secondaryReleased: false,
    abilityPressed: false,
    ultimatePressed: false,
  };
}

export function clearEdges(i: Intent): void {
  i.jumpPressed = false;
  i.dashPressed = false;
  i.hookLPressed = false;
  i.hookRPressed = false;
  i.attackPressed = false;
  i.secondaryPressed = false;
  i.secondaryReleased = false;
  i.abilityPressed = false;
  i.ultimatePressed = false;
}

/** Network-replicated action (ability start) so remote clients can play the visuals. */
export interface ActionEvent {
  /** ability/action id, e.g. 'atk1', 'dive', 'shot' */
  a: string;
  /** optional aim / target data */
  p?: [number, number, number];
  d?: [number, number, number];
  t?: string;
  n?: number;
}

/** What the match exposes to fighters and kits. */
export interface MatchContext {
  readonly world: CollisionWorld;
  readonly fighters: Fighter[];
  readonly time: number;
  readonly scene: THREE.Scene;
  readonly camPos: THREE.Vector3;
  /** true if this client decides hits for `attacker` (local player, or bots offline) */
  isAuthority(attacker: Fighter): boolean;
  /** report a hit: the authority applies it (offline) or sends it to the server (online) */
  reportHit(attacker: Fighter, target: Fighter, info: HitInfo): void;
  /** heal (self-heal abilities) */
  reportHeal(f: Fighter, amount: number): void;
  /** broadcast an action so remote clients can play it */
  broadcastAction(f: Fighter, e: ActionEvent): void;
  readonly vfx: import('../vfx/Effects').Effects;
  readonly audio: import('../core/Audio').AudioEngine;
  readonly projectiles: import('../combat/Projectiles').Projectiles;
  /** small camera shake (only applied if `f` is the viewed fighter or near it) */
  shake(amount: number, at?: THREE.Vector3): void;
  /** hit-stop / freeze frames */
  hitStop(seconds: number): void;
}

export interface HitInfo {
  slot: 'atk' | 'sec' | 'abi' | 'ult';
  part: string;
  /** 0..1 damage multiplier (charge level, falloff) */
  scale?: number;
  crit?: boolean;
  /** knockback velocity applied to the target (world) */
  kb?: THREE.Vector3;
  stun?: number;
  slow?: number;
  /** hit position for VFX */
  at?: THREE.Vector3;
  /** guard can block it (most melee & projectiles) */
  blockable?: boolean;
}

/** Per-champion combat logic. */
export interface Kit {
  /** read intent, start/advance actions (only for simulated fighters) */
  update(f: Fighter, it: Intent, dt: number, m: MatchContext): void;
  /** clip event from the animator ('hitOn', 'slam', ...) */
  onAnimEvent(f: Fighter, ev: string, m: MatchContext): void;
  /** replay an action received from the network (visual only) */
  playRemote(f: Fighter, e: ActionEvent, m: MatchContext): void;
  /** interrupt current action (stun, death) */
  cancel(f: Fighter): void;
  /** true while an action wants the body to face the aim direction */
  facesAim(f: Fighter): boolean;
  /** cooldown readout for the HUD: remaining seconds per slot */
  cooldowns(): Record<'atk' | 'sec' | 'abi' | 'ult', number>;
  /** extra yaw for spin attacks (degrees) */
  spin: number;
  /** yaw the body should face during an action (null = aim yaw) */
  faceYaw: number | null;
  /** advance visual-only state for remote puppets */
  tickRemote?(f: Fighter, dt: number, m: MatchContext): void;
  /** currently charging (0..1) for HUD / anims */
  charge: number;
}
