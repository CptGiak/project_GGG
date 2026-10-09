import type { AbilitySlot, ChampionId } from './champions';
import type { ModeId } from './modes';

/** Wire protocol (JSON over WebSocket). Keep messages small: arrays for vectors. */
export const PROTOCOL_VERSION = 2;

export type V3 = [number, number, number];

/** Replicated per-player movement/animation state (client -> server -> others, ~20 Hz). */
export interface PlayerState {
  p: V3;
  v: V3;
  /** facing yaw */
  f: number;
  /** aim yaw / pitch */
  ay: number;
  ap: number;
  /** flags: 1 grounded, 2 boosting, 4 dashing, 8 guard, 16 wallrun, 32 dash i-frames (perfect dodge) */
  fl: number;
  /** hook states (0 idle, 1 flying, 2 attached, 3 retract) */
  h: [number, number];
  /** hook anchors (only meaningful when not idle) */
  ha?: V3;
  hb?: V3;
}

export interface PlayerInfo {
  id: string;
  name: string;
  champ: ChampionId;
  kills: number;
  deaths: number;
  hp: number;
  alive: boolean;
  /** RIFLETTORE points (spotlight mode only) */
  score?: number;
}

export interface ActionMsg {
  a: string;
  p?: V3;
  d?: V3;
  t?: string;
  n?: number;
}

export interface HitMsg {
  target: string;
  slot: AbilitySlot;
  part: string;
  scale?: number;
  crit?: boolean;
  kb?: V3;
  stun?: number;
  slow?: number;
  blockable?: boolean;
  at?: V3;
  /** momentum strike: impact speed (m/s), capped by the server to the attacker's recent speed */
  mo?: number;
  /** counter hit (first hit after a perfect dodge): the server checks the window it granted */
  ctr?: boolean;
}

export type C2S =
  /** `mode`: the mode a new private room plays (public rooms rotate) */
  | { t: 'hello'; v: number; name: string; champ: ChampionId; room?: string; mode?: ModeId }
  | { t: 'state'; s: PlayerState }
  | { t: 'act'; e: ActionMsg }
  | ({ t: 'hit' } & HitMsg)
  | { t: 'heal'; amount: number }
  | { t: 'champ'; champ: ChampionId }
  | { t: 'ping'; c: number };

/**
 * The match's mode. `t0` is the server time (the `time` of snaps and pongs) the match went
 * live: RIFLETTORE's beat clock and zone schedule (from `seed`) run from it.
 */
export interface MatchModeMsg {
  mode: ModeId;
  seed: number;
  t0: number;
}

export interface MatchRulesMsg {
  killsToWin: number;
  durationSec: number;
  respawnSec: number;
}

export type S2C =
  | ({ t: 'welcome'; id: string; room: string; arena: string; rules: MatchRulesMsg; players: PlayerInfo[]; clock: number; time: number; phase: 'playing' | 'ended' } & MatchModeMsg)
  | { t: 'join'; p: PlayerInfo }
  | { t: 'leave'; id: string }
  | { t: 'snap'; time: number; clock: number; ps: Array<[string, PlayerState]> }
  | { t: 'act'; id: string; e: ActionMsg }
  | { t: 'dmg'; src: string | null; tgt: string; amt: number; hp: number; crit?: boolean; blocked?: boolean; kb?: V3; stun?: number; slow?: number; at?: V3; slot?: string; mo?: number; ctr?: boolean; pun?: boolean }
  | { t: 'parry'; def: string; att: string }
  /** perfect dodge (rewarded); ft = the attacker was close enough to go Fuori Tempo */
  | { t: 'dodge'; def: string; att: string; ft?: boolean }
  | { t: 'heal'; id: string; amt: number; hp: number }
  | { t: 'kill'; killer: string | null; victim: string; slot?: string }
  | { t: 'spawn'; id: string; pos: V3; yaw: number; champ: ChampionId }
  | { t: 'end'; winner: string | null; players: PlayerInfo[]; next: number }
  | ({ t: 'start'; arena: string; clock: number; players: PlayerInfo[] } & MatchModeMsg)
  /** RIFLETTORE beat `b` scored: the zone's owner (alone in it), whether it was contested, the points */
  | { t: 'spot'; b: number; own: string | null; ctd?: boolean; sc: Array<[string, number]> }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; msg: string };
