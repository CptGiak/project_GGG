/** Movement tuning shared by every fighter (champion speed multipliers apply on top). */
export const MOVE = {
  gravity: 26,
  runSpeed: 9.6,
  groundAccel: 75,
  groundFriction: 11,
  airAccel: 16,
  airMaxSpeed: 11,
  airDrag: 0.013,
  jumpVel: 10.5,
  coyoteTime: 0.12,
  airJumpVel: 9.5,
  airJumps: 2,
  wallKickVel: 11,

  hookRange: 95,
  hookSpeed: 280,
  hookAssistDeg: 22,
  hookMinLen: 1.8,
  reelAccel: 14,
  boostAccel: 42,
  swingAccel: 22,
  hookedGravity: 0.62,
  attachYank: 8,
  playerHookMaxTime: 1.6,

  dashSpeed: 31,
  dashTime: 0.2,
  dashCooldown: 0.55,

  // gas: a big tank that refills slowly, so hooks, boosts and dashes are a resource to manage
  gasMax: 200,
  /** per hook shot (Q / E); no gas, no hook */
  hookCost: 10,
  boostCost: 20,
  dashCost: 18,
  airJumpCost: 14,
  gasRegenGround: 14,
  gasRegenAir: 4,
  /** seconds after the last spend before the tank starts refilling */
  gasRegenDelay: 1.0,

  capsuleRadius: 0.4,
  capsuleHeights: [0.4, 0.95, 1.5] as const,
  height: 1.85,
};

/**
 * Combat tuning shared by client and server: the server re-derives the same limits from the
 * replicated movement state to validate what clients claim.
 */
export const COMBAT = {
  // --- perfect dodge: a hit that lands inside the dash i-frames misses and rewards the dodger
  /** window after a perfect dodge in which the next hit is a guaranteed critical (s) */
  counterSec: 1.5,
  /** a perfect dodge pays out at most once per this many seconds (s) */
  dodgeRewardCd: 1.2,
  /** gas given back by a perfect dodge (the dash cost) */
  dodgeGasRefund: 18,
  /** ultimate charge granted by a perfect dodge (fraction of the bar) */
  dodgeUlt: 0.06,
  /** server: a hit arriving this long after the target's i-frames ended still misses (ms) */
  dodgeLookbackMs: 170,
  /** server: dash i-frame flags held longer than this are ignored (ms) */
  maxDodgeMs: 200,
  /** dashes closer together than this form a chain (s) */
  dashChainSec: 1.5,
  /** i-frames of the 1st, 2nd and later dashes of a chain: spamming dash stops working (Smash staling) */
  dashIFrames: [0.14, 0.07, 0] as readonly number[],
  /** Fuori Tempo: whoever attacked a perfect dodge from this close (m) runs at half speed for a moment */
  offbeatRange: 12,
  offbeatSec: 0.9,
  offbeatScale: 0.5,

  // --- punish: a fighter caught off-beat or parried takes heavier hits (fighting-game punish counter)
  punishMultiplier: 1.3,
  /** a parry stuns the attacker only within this distance (m), and opens the defender's counter window */
  parryRange: 12,
  parryStun: 0.9,

  // --- momentum strikes: melee hits started at speed hit harder (Attack-on-Titan style)
  momentumMinSpeed: 15,
  momentumMaxSpeed: 40,
  momentumMaxBonus: 0.6,
  /** extra knockback at full momentum (fraction) */
  momentumKnockback: 0.8,
  /** critical x momentum never exceeds this */
  maxHitMultiplier: 2,
  /** server: claimed impact speed may exceed the attacker's recent top speed by this much (m/s) */
  momentumSlack: 3,
  /** the speed a strike measures decays this fast after you slow down (m/s per s) */
  speedPeakDecay: 30,
  /** a dash's own burst of speed is not momentum: the peak ignores it for this long (s) */
  dashMomentumLockout: 0.4,
  /** server: speed history used to validate momentum claims (ms) */
  momentumWindowMs: 1500,

  // --- ultimate economy (Overwatch / Valorant style: charge comes from plays, not only damage)
  /** ultimate charge from damage taken, relative to damage dealt */
  ultFromDamageTaken: 0.35,
  /** bar fractions granted by a perfect parry, a takedown and an assist */
  ultParry: 0.06,
  ultKill: 0.08,
  ultAssist: 0.04,
  /** damage dealt to the victim within this window (s) and above this amount counts as an assist */
  assistSec: 8,
  assistMinDamage: 60,
};

/** 0..1: how far `speed` (m/s) sits between the momentum thresholds */
export function momentumK(speed: number): number {
  const k = (speed - COMBAT.momentumMinSpeed) / (COMBAT.momentumMaxSpeed - COMBAT.momentumMinSpeed);
  return Math.min(1, Math.max(0, k));
}

/**
 * Damage multiplier of a hit, shared by the offline match and the server: critical x1.5 or
 * punish x1.3 (the larger), times the momentum bonus (up to x1.6 at `mo` m/s of impact speed),
 * all together capped.
 */
export function hitMultiplier(crit: boolean, critMul: number, mo = 0, punish = false): number {
  const base = Math.max(crit ? critMul : 1, punish ? COMBAT.punishMultiplier : 1);
  return Math.min(base * (1 + COMBAT.momentumMaxBonus * momentumK(mo)), COMBAT.maxHitMultiplier);
}

/** i-frames (s) of a dash that is the `chain`-th (0 = fresh) within COMBAT.dashChainSec */
export function dashIFrames(chain: number): number {
  const t = COMBAT.dashIFrames;
  return t[Math.min(chain, t.length - 1)];
}
