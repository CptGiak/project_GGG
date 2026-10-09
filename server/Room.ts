import type { WebSocket } from 'ws';
import { CHAMPIONS, CHAMPION_IDS, MATCH_RULES, type AbilityData, type ChampionId } from '../shared/champions';
import { COMBAT, MOVE, dashIFrames, hitMultiplier } from '../shared/constants';
import { ARENA_META, arenaMeta } from '../shared/arenas';
import { BEAT_MS, MODE_IDS, SPOT, SPOT_DURATION_SEC, SPOT_ZONES, inSpot, spotPhase, spotSchedule, spotTarget, type ModeId, type SpotZone } from '../shared/modes';
import type { C2S, HitMsg, MatchModeMsg, PlayerInfo, PlayerState, S2C, V3 } from '../shared/protocol';

interface Player {
  id: string;
  name: string;
  champ: ChampionId;
  ws: WebSocket;
  state: PlayerState | null;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  respawnAt: number;
  spawnedAt: number;
  guard: boolean;
  guardStart: number;
  /** recent hit timestamps per slot (rate limiting) */
  hitLog: Record<string, number[]>;
  lastHeal: number;
  pendingChamp: ChampionId | null;
  joinedAt: number;
  /** recent movement speeds from states, [time, m/s] (momentum strike validation) */
  spd: Array<[number, number]>;
  /** dash i-frames seen in states (a hit inside them is a perfect dodge) */
  dodge: IFrames;
  /** invulnerability granted by abilities (Nova's blinks and ultimate), opened by their actions */
  invulnUntil: number;
  /** last time each invulnerable action was accepted (rate limited by its cooldown) */
  ivActAt: Record<string, number>;
  /** last perfect dodge rewarded (one per COMBAT.dodgeRewardCd) and the counter window it opened */
  dodgeRewardAt: number;
  counterUntil: number;
  /** the counter crit was already spent */
  counterUsed: boolean;
  /** off-beat (attacked a perfect dodge from close) or parried: hits on this player are punish counters */
  punishUntil: number;
  /** RIFLETTORE points this match */
  score: number;
}

/**
 * Tracks the dash i-frame state flag with the same rules the client plays by, so a client can't
 * claim permanent or spammed invulnerability: a run lasts at most a dash's i-frames (plus network
 * jitter), runs can't start faster than the dash cooldown, and chained dashes get shorter i-frames
 * (none from the third) and never count as a perfect dodge.
 */
interface IFrames {
  /** last state arrival that showed the flag (and passed the checks) */
  seen: number;
  /** start of the current run of states with the flag */
  since: number;
  /** start of the previous accepted run */
  lastRun: number;
  /** dashes in the current chain (0 = fresh) */
  chain: number;
  /** the run `seen` belongs to was a fresh dash (a hit in it is a perfect dodge) */
  fresh: boolean;
  on: boolean;
  /** this run broke a limit: ignored until the flag drops */
  bad: boolean;
}

function iframes(): IFrames {
  return { seen: -1e9, since: 0, lastRun: -1e9, chain: 0, fresh: false, on: false, bad: false };
}

/** feed one state's dash i-frame flag */
function trackIFrames(f: IFrames, on: boolean, t: number): void {
  if (!on) {
    f.on = false;
    return;
  }
  if (!f.on) {
    f.on = true;
    f.since = t;
    const gap = t - f.lastRun;
    f.bad = gap < MOVE.dashCooldown * 800;
    if (!f.bad) {
      f.chain = gap < COMBAT.dashChainSec * 1000 ? f.chain + 1 : 0;
      f.lastRun = t;
      f.bad = dashIFrames(f.chain) <= 0;
    }
  }
  if (f.bad || t - f.since > Math.min(COMBAT.maxDodgeMs, dashIFrames(f.chain) * 1000 + 60)) {
    f.bad = true;
    return;
  }
  f.seen = t;
  f.fresh = f.chain === 0;
}

const TICK_MS = 50;
const now = () => Date.now();

function finite(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function vec(v: unknown): V3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map((x) => finite(x, NaN)) as V3;
  return out.some((x) => Number.isNaN(x)) ? null : out;
}
function dist(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * One PvP room: relays movement, validates hit claims against shared champion data, owns HP /
 * kills / respawns, the match clock and RIFLETTORE's score. Rotates arenas and modes between
 * matches.
 */
export class Room {
  readonly players = new Map<string, Player>();
  arena: string;
  mode: ModeId;
  phase: 'playing' | 'ended' = 'playing';
  clockEnd = 0;
  nextStart = 0;
  private timer: NodeJS.Timeout;
  private arenaIdx: number;
  private readonly startedAt = now();
  /** RIFLETTORE: the zone schedule's seed, the server time the match went live, the last scored beat */
  private seed = 0;
  private t0 = 0;
  private schedule: SpotZone[] = [];
  private beat = -1;

  /** `fixedMode`: every match plays it (private rooms); otherwise modes rotate */
  constructor(readonly id: string, readonly isPrivate: boolean, private onEmpty: (r: Room) => void, private readonly fixedMode?: ModeId) {
    this.arenaIdx = Math.floor(Math.random() * ARENA_META.length);
    this.arena = ARENA_META[this.arenaIdx].id;
    this.mode = fixedMode ?? MODE_IDS[Math.floor(Math.random() * MODE_IDS.length)];
    this.setupMode();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** match length for the current mode (s) */
  private durationSec(): number {
    return this.mode === 'spot' ? Math.ceil(SPOT_DURATION_SEC) : MATCH_RULES.durationSec;
  }

  /** a new match of the current mode on the current arena starts now */
  private setupMode(): void {
    if (!SPOT_ZONES[this.arena]) this.mode = 'dm';
    this.seed = Math.floor(Math.random() * 1e9);
    this.schedule = spotSchedule(this.arena, this.seed);
    this.t0 = this.time();
    this.beat = -1;
    this.clockEnd = now() + this.durationSec() * 1000;
  }

  private modeMsg(): MatchModeMsg {
    return { mode: this.mode, seed: this.seed, t0: this.t0 };
  }

  get full(): boolean {
    return this.players.size >= MATCH_RULES.maxPlayers;
  }

  private time(): number {
    return now() - this.startedAt;
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  // -------------------------------------------------------------------------------------------
  // membership
  // -------------------------------------------------------------------------------------------

  join(ws: WebSocket, name: string, champ: ChampionId): Player {
    const id = Math.random().toString(36).slice(2, 10);
    const p: Player = {
      id,
      name: name.slice(0, 16) || 'PLAYER',
      champ,
      ws,
      state: null,
      hp: CHAMPIONS[champ].hp,
      alive: true,
      kills: 0,
      deaths: 0,
      respawnAt: 0,
      spawnedAt: now(),
      guard: false,
      guardStart: 0,
      hitLog: {},
      lastHeal: 0,
      pendingChamp: null,
      joinedAt: now(),
      spd: [],
      dodge: iframes(),
      invulnUntil: 0,
      ivActAt: {},
      dodgeRewardAt: -1e9,
      counterUntil: 0,
      counterUsed: true,
      punishUntil: 0,
      score: 0,
    };
    this.players.set(id, p);
    const spawn = this.pickSpawn(p);
    this.send(p, {
      t: 'welcome',
      id,
      room: this.id,
      arena: this.arena,
      rules: { killsToWin: MATCH_RULES.killsToWin, durationSec: this.durationSec(), respawnSec: MATCH_RULES.respawnSec },
      players: this.infos(),
      clock: Math.max(0, (this.clockEnd - now()) / 1000),
      time: this.time(),
      phase: this.phase,
      ...this.modeMsg(),
    });
    this.broadcast({ t: 'join', p: this.info(p) }, p.id);
    this.broadcast({ t: 'spawn', id, pos: spawn.pos, yaw: spawn.yaw, champ: p.champ });
    return p;
  }

  leave(id: string): void {
    if (!this.players.delete(id)) return;
    this.broadcast({ t: 'leave', id });
    if (this.players.size === 0) this.onEmpty(this);
  }

  info(p: Player): PlayerInfo {
    return { id: p.id, name: p.name, champ: p.champ, kills: p.kills, deaths: p.deaths, hp: Math.round(p.hp), alive: p.alive, score: this.mode === 'spot' ? p.score : undefined };
  }

  infos(): PlayerInfo[] {
    return [...this.players.values()].map((p) => this.info(p));
  }

  // -------------------------------------------------------------------------------------------
  // messages
  // -------------------------------------------------------------------------------------------

  handle(p: Player, msg: C2S): void {
    switch (msg.t) {
      case 'state':
        this.onState(p, msg.s);
        break;
      case 'act':
        if (msg.e && typeof msg.e.a === 'string' && msg.e.a.length < 24) {
          if (msg.e.a === 'guard') {
            p.guard = !!msg.e.n;
            if (p.guard) p.guardStart = now();
          }
          this.onActIFrames(p, msg.e.a);
          this.broadcast({ t: 'act', id: p.id, e: msg.e }, p.id);
        }
        break;
      case 'hit':
        this.onHit(p, msg);
        break;
      case 'heal':
        this.onHeal(p, finite(msg.amount));
        break;
      case 'champ':
        if (CHAMPION_IDS.includes(msg.champ)) p.pendingChamp = msg.champ;
        break;
      case 'ping':
        this.send(p, { t: 'pong', c: finite(msg.c), s: this.time() });
        break;
      default:
        break;
    }
  }

  private onState(p: Player, s: PlayerState): void {
    if (!s) return;
    const pos = vec(s.p);
    const vel = vec(s.v);
    if (!pos || !vel) return;
    p.state = {
      p: pos,
      v: vel,
      f: finite(s.f),
      ay: finite(s.ay),
      ap: finite(s.ap),
      fl: finite(s.fl) | 0,
      h: [finite(s.h?.[0]) | 0, finite(s.h?.[1]) | 0],
      ha: vec(s.ha) ?? undefined,
      hb: vec(s.hb) ?? undefined,
    };
    const t = now();
    // speed history (momentum strikes are capped to it)
    p.spd.push([t, Math.min(90, Math.hypot(vel[0], vel[1], vel[2]))]);
    while (p.spd.length && t - p.spd[0][0] > COMBAT.momentumWindowMs) p.spd.shift();
    // dash i-frames: no longer than a dash, no more often than the dash cooldown allows
    trackIFrames(p.dodge, (p.state.fl & 32) !== 0, t);
    const g = (p.state.fl & 8) !== 0;
    if (!g) p.guard = false;
    else if (!p.guard) {
      p.guard = true;
      p.guardStart = now();
    }
  }

  private onHit(att: Player, h: HitMsg): void {
    if (this.phase !== 'playing' || !att.alive) return;
    const tgt = this.players.get(h.target);
    if (!tgt || tgt === att || !tgt.alive) return;
    if (now() - tgt.spawnedAt < MATCH_RULES.spawnProtectSec * 1000) return;
    const champ = CHAMPIONS[att.champ];
    const ab = champ.abilities[h.slot];
    if (!ab) return;
    const base = ab.damage[h.part];
    if (base === undefined) return;
    // rate limit per slot
    const t = now();
    const log = (att.hitLog[h.slot] ??= []);
    while (log.length && t - log[0] > 1000) log.shift();
    if (log.length >= ab.maxRate * 1.5 + 2) return;
    log.push(t);
    // distance sanity (generous: positions are ~100ms stale, fighters move fast)
    if (att.state && tgt.state) {
      const d = dist(att.state.p, tgt.state.p);
      const speedSlack = Math.hypot(...att.state.v) * 0.35 + Math.hypot(...tgt.state.v) * 0.35;
      if (d > ab.range + 10 + speedSlack) return;
    }
    // i-frames: the attacker sees the target ~100-200 ms late, so a hit on a target that was
    // invulnerable that recently misses; inside a fresh dash it is a perfect dodge (rewarded once
    // per COMBAT.dodgeRewardCd, which opens a counter window for the dodger and puts a close
    // attacker Fuori Tempo). Rapid-fire / channelled parts only miss.
    const stream = !!ab.stream?.includes(h.part);
    const dashed = t - tgt.dodge.seen <= COMBAT.dodgeLookbackMs;
    if (dashed || t - COMBAT.dodgeLookbackMs <= tgt.invulnUntil) {
      if (dashed && tgt.dodge.fresh && !stream && t - tgt.dodgeRewardAt >= COMBAT.dodgeRewardCd * 1000) {
        tgt.dodgeRewardAt = t;
        tgt.counterUntil = t + COMBAT.counterSec * 1000 + 250;
        tgt.counterUsed = false;
        const close = !!att.state && !!tgt.state && dist(att.state.p, tgt.state.p) <= COMBAT.offbeatRange + 3;
        if (close) att.punishUntil = t + COMBAT.offbeatSec * 1000 + 150;
        this.broadcast({ t: 'dodge', def: tgt.id, att: att.id, ft: close || undefined });
      }
      return;
    }
    const scale = Math.min(1, Math.max(0, finite(h.scale, 1)));
    // criticals: checked per kind (always / from behind / on the head), or the counter hit after a
    // perfect dodge or parry (one per window)
    let crit = false;
    let ctr = false;
    if (h.crit) {
      if (h.ctr && !stream && !att.counterUsed && t <= att.counterUntil) {
        crit = ctr = true;
        att.counterUsed = true;
      } else crit = this.critValid(ab, h, att, tgt);
    }
    // momentum strike: the claimed impact speed can't beat the attacker's recent top speed
    let mo = 0;
    if (ab.momentum?.includes(h.part)) mo = Math.max(0, Math.min(finite(h.mo), this.peakSpeed(att, t) + COMBAT.momentumSlack));
    const punish = t <= tgt.punishUntil;
    let dmg = base * scale * hitMultiplier(crit, MATCH_RULES.critMultiplier, mo, punish);
    // guard: frontal block, parry window right after raising guard
    let blocked = false;
    if (tgt.guard && h.blockable !== false && att.state && tgt.state) {
      const dx = att.state.p[0] - tgt.state.p[0];
      const dz = att.state.p[2] - tgt.state.p[2];
      const l = Math.hypot(dx, dz) || 1;
      const front = Math.sin(tgt.state.f) * (dx / l) + Math.cos(tgt.state.f) * (dz / l);
      if (front > 0.2) {
        if (t - tgt.guardStart < 260) {
          // perfect parry: a close attacker is stunned (punishable), the defender gets a counter window
          if (l <= COMBAT.parryRange + 3) {
            att.punishUntil = t + COMBAT.parryStun * 1000 + 150;
            tgt.counterUntil = t + COMBAT.counterSec * 1000 + 250;
            tgt.counterUsed = false;
          }
          this.broadcast({ t: 'parry', def: tgt.id, att: att.id });
          return;
        }
        blocked = true;
        dmg *= 0.25;
      }
    }
    dmg = Math.round(dmg);
    tgt.hp = Math.max(0, tgt.hp - dmg);
    const kb = vec(h.kb);
    this.broadcast({
      t: 'dmg',
      src: att.id,
      tgt: tgt.id,
      amt: dmg,
      hp: Math.round(tgt.hp),
      crit,
      blocked,
      kb: kb && !blocked ? (kb.map((x) => Math.max(-40, Math.min(40, x))) as V3) : undefined,
      stun: blocked ? undefined : Math.min(1, finite(h.stun)) || undefined,
      slow: Math.min(2, finite(h.slow)) || undefined,
      at: vec(h.at) ?? undefined,
      slot: h.slot,
      mo: mo >= COMBAT.momentumMinSpeed ? Math.round(mo) : undefined,
      ctr: ctr || undefined,
      pun: punish || undefined,
    });
    if (tgt.hp <= 0) this.kill(tgt, att, h.slot);
  }

  /**
   * A claimed critical that isn't a counter: parts that always crit, backstabs (the target was
   * facing away, by the server's copy of its state) and headshots (the hit point sits at head
   * height on the target).
   */
  private critValid(ab: AbilityData, h: HitMsg, att: Player, tgt: Player): boolean {
    if (ab.crit?.includes(h.part)) return true;
    if (!att.state || !tgt.state) return false;
    const tp = tgt.state.p;
    if (ab.backstab?.includes(h.part)) {
      const dx = att.state.p[0] - tp[0];
      const dz = att.state.p[2] - tp[2];
      const l = Math.hypot(dx, dz) || 1;
      return Math.sin(tgt.state.f) * (dx / l) + Math.cos(tgt.state.f) * (dz / l) < -0.3;
    }
    if (ab.headshot?.includes(h.part)) {
      const at = vec(h.at);
      if (!at) return false;
      // positions are ~100 ms stale: allow what the target could have moved
      const slack = Math.hypot(...tgt.state.v) * 0.2;
      const rise = at[1] - tp[1];
      return rise >= 1.3 - slack && rise <= 2.3 + slack && Math.hypot(at[0] - tp[0], at[2] - tp[2]) <= 1.2 + slack;
    }
    return false;
  }

  /** abilities with invulnerability open a server-side window, at most once per their cooldown */
  private onActIFrames(p: Player, a: string): void {
    const iv = CHAMPIONS[p.champ].invulnActs?.[a];
    if (!iv || !p.alive) return;
    const t = now();
    if (t - (p.ivActAt[a] ?? -1e9) < iv.every * 1000) return;
    p.ivActAt[a] = t;
    p.invulnUntil = Math.max(p.invulnUntil, t + iv.sec * 1000);
  }

  /** top speed (m/s) the player's states showed in the momentum window */
  private peakSpeed(p: Player, t: number): number {
    let best = 0;
    for (const [at, v] of p.spd) if (t - at <= COMBAT.momentumWindowMs && v > best) best = v;
    return best;
  }

  private onHeal(p: Player, amount: number): void {
    if (!p.alive) return;
    const t = now();
    if (t - p.lastHeal < 3000) return;
    p.lastHeal = t;
    const amt = Math.max(0, Math.min(220, amount));
    p.hp = Math.min(CHAMPIONS[p.champ].hp, p.hp + amt);
    this.broadcast({ t: 'heal', id: p.id, amt, hp: Math.round(p.hp) });
  }

  private kill(victim: Player, killer: Player | null, slot?: string): void {
    victim.alive = false;
    victim.deaths++;
    victim.respawnAt = now() + MATCH_RULES.respawnSec * 1000;
    victim.guard = false;
    if (killer && killer !== victim) killer.kills++;
    this.broadcast({ t: 'kill', killer: killer?.id ?? null, victim: victim.id, slot });
    // in RIFLETTORE kills only clear the stage: points win
    if (this.mode === 'dm' && killer && killer.kills >= MATCH_RULES.killsToWin) this.endMatch(killer);
  }

  // -------------------------------------------------------------------------------------------
  // RIFLETTORE
  // -------------------------------------------------------------------------------------------

  private spotBeat(): number {
    return Math.floor((this.time() - this.t0) / BEAT_MS);
  }

  /**
   * Scores each new beat: whoever stands alone in the live zone (by the latest state they sent)
   * gets a point, two in the Gran Finale. Every client runs the same beat clock from `t0`, so
   * only the outcome is sent.
   */
  private spotTick(): void {
    const beat = this.spotBeat();
    if (beat <= this.beat) return;
    this.beat = beat;
    const ph = spotPhase(this.schedule, beat);
    if (ph.over) {
      this.endMatch(this.spotLeader());
      return;
    }
    const z = ph.zone;
    if (!z) return;
    const inside: Player[] = [];
    for (const p of this.players.values()) if (p.alive && p.state && inSpot(z, p.state.p[0], p.state.p[1], p.state.p[2])) inside.push(p);
    const own = inside.length === 1 ? inside[0] : null;
    if (own) own.score += z.finale ? SPOT.finaleMult : 1;
    this.broadcast({
      t: 'spot',
      b: beat,
      own: own?.id ?? null,
      ctd: inside.length > 1 || undefined,
      sc: [...this.players.values()].map((p) => [p.id, p.score]),
    });
    if (own && own.score >= SPOT.scoreToWin) this.endMatch(own);
  }

  /** most points (ties: most kills); nobody if no one scored */
  private spotLeader(): Player | null {
    let best: Player | null = null;
    for (const p of this.players.values()) {
      if (p.score <= 0) continue;
      if (!best || p.score > best.score || (p.score === best.score && p.kills > best.kills)) best = p;
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------
  // match flow
  // -------------------------------------------------------------------------------------------

  private pickSpawn(p: Player): { pos: V3; yaw: number } {
    const spawns = arenaMeta(this.arena).spawns;
    // RIFLETTORE: nobody respawns on the stage
    const z = this.mode === 'spot' ? spotTarget(spotPhase(this.schedule, this.spotBeat())) : null;
    let best = spawns[0];
    let bestScore = -Infinity;
    for (const s of spawns) {
      let minD = 1000;
      for (const o of this.players.values()) {
        if (o === p || !o.alive || !o.state) continue;
        minD = Math.min(minD, dist(o.state.p, s.pos));
      }
      let score = minD + Math.random() * 12;
      if (z && Math.hypot(s.pos[0] - z.c[0], s.pos[2] - z.c[2]) < SPOT.spawnClear) score -= 60;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    const yaw = Math.atan2(best.look[0] - best.pos[0], best.look[1] - best.pos[2]);
    p.state = { p: [...best.pos] as V3, v: [0, 0, 0], f: yaw, ay: yaw, ap: 0, fl: 1, h: [0, 0] };
    return { pos: best.pos, yaw };
  }

  private respawn(p: Player): void {
    if (p.pendingChamp) {
      p.champ = p.pendingChamp;
      p.pendingChamp = null;
    }
    p.hp = CHAMPIONS[p.champ].hp;
    p.alive = true;
    p.spawnedAt = now();
    const s = this.pickSpawn(p);
    this.broadcast({ t: 'spawn', id: p.id, pos: s.pos, yaw: s.yaw, champ: p.champ });
  }

  private endMatch(winner: Player | null): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.nextStart = now() + 12000;
    this.broadcast({ t: 'end', winner: winner?.id ?? null, players: this.infos(), next: 12 });
  }

  private startMatch(): void {
    this.phase = 'playing';
    this.arenaIdx = (this.arenaIdx + 1) % ARENA_META.length;
    this.arena = ARENA_META[this.arenaIdx].id;
    this.mode = this.fixedMode ?? MODE_IDS[(MODE_IDS.indexOf(this.mode) + 1) % MODE_IDS.length];
    this.setupMode();
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.score = 0;
      p.alive = true;
      if (p.pendingChamp) {
        p.champ = p.pendingChamp;
        p.pendingChamp = null;
      }
      p.hp = CHAMPIONS[p.champ].hp;
    }
    this.broadcast({ t: 'start', arena: this.arena, clock: this.durationSec(), players: this.infos(), ...this.modeMsg() });
    for (const p of this.players.values()) {
      p.spawnedAt = now();
      const s = this.pickSpawn(p);
      this.broadcast({ t: 'spawn', id: p.id, pos: s.pos, yaw: s.yaw, champ: p.champ });
    }
  }

  private tick(): void {
    const t = now();
    if (this.phase === 'playing') {
      for (const p of this.players.values()) if (!p.alive && t >= p.respawnAt) this.respawn(p);
      if (this.mode === 'spot') this.spotTick();
      if (this.phase === 'playing' && t >= this.clockEnd) {
        const top = this.mode === 'spot' ? this.spotLeader() : [...this.players.values()].sort((a, b) => b.kills - a.kills)[0] ?? null;
        this.endMatch(top);
      }
    } else if (t >= this.nextStart) {
      this.startMatch();
    }
    if (this.players.size === 0) return;
    const ps: Array<[string, PlayerState]> = [];
    for (const p of this.players.values()) if (p.state && p.alive) ps.push([p.id, p.state]);
    this.broadcast({ t: 'snap', time: this.time(), clock: Math.max(0, (this.clockEnd - t) / 1000), ps });
  }

  // -------------------------------------------------------------------------------------------

  send(p: Player, msg: S2C): void {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  broadcast(msg: S2C, except?: string): void {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id === except) continue;
      if (p.ws.readyState === 1) p.ws.send(data);
    }
  }
}
