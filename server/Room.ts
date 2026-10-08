import type { WebSocket } from 'ws';
import { CHAMPIONS, CHAMPION_IDS, MATCH_RULES, type ChampionId } from '../shared/champions';
import { ARENA_META, arenaMeta } from '../shared/arenas';
import type { C2S, HitMsg, PlayerInfo, PlayerState, S2C, V3 } from '../shared/protocol';

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
 * One deathmatch room: relays movement, validates hit claims against shared champion data,
 * owns HP / kills / respawns and the match clock. Rotates arenas between matches.
 */
export class Room {
  readonly players = new Map<string, Player>();
  arena: string;
  phase: 'playing' | 'ended' = 'playing';
  clockEnd = 0;
  nextStart = 0;
  private timer: NodeJS.Timeout;
  private arenaIdx: number;
  private readonly startedAt = now();

  constructor(readonly id: string, readonly isPrivate: boolean, private onEmpty: (r: Room) => void) {
    this.arenaIdx = Math.floor(Math.random() * ARENA_META.length);
    this.arena = ARENA_META[this.arenaIdx].id;
    this.clockEnd = now() + MATCH_RULES.durationSec * 1000;
    this.timer = setInterval(() => this.tick(), TICK_MS);
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
    };
    this.players.set(id, p);
    const spawn = this.pickSpawn(p);
    this.send(p, {
      t: 'welcome',
      id,
      room: this.id,
      arena: this.arena,
      rules: { killsToWin: MATCH_RULES.killsToWin, durationSec: MATCH_RULES.durationSec, respawnSec: MATCH_RULES.respawnSec },
      players: this.infos(),
      clock: Math.max(0, (this.clockEnd - now()) / 1000),
      time: this.time(),
      phase: this.phase,
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
    return { id: p.id, name: p.name, champ: p.champ, kills: p.kills, deaths: p.deaths, hp: Math.round(p.hp), alive: p.alive };
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
    const scale = Math.min(1, Math.max(0, finite(h.scale, 1)));
    let dmg = base * scale * (h.crit ? MATCH_RULES.critMultiplier : 1);
    // guard: frontal block, parry window right after raising guard
    let blocked = false;
    if (tgt.guard && h.blockable !== false && att.state && tgt.state) {
      const dx = att.state.p[0] - tgt.state.p[0];
      const dz = att.state.p[2] - tgt.state.p[2];
      const l = Math.hypot(dx, dz) || 1;
      const front = Math.sin(tgt.state.f) * (dx / l) + Math.cos(tgt.state.f) * (dz / l);
      if (front > 0.2) {
        if (t - tgt.guardStart < 260) {
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
      crit: !!h.crit,
      blocked,
      kb: kb && !blocked ? (kb.map((x) => Math.max(-40, Math.min(40, x))) as V3) : undefined,
      stun: blocked ? undefined : Math.min(1, finite(h.stun)) || undefined,
      slow: Math.min(2, finite(h.slow)) || undefined,
      at: vec(h.at) ?? undefined,
      slot: h.slot,
    });
    if (tgt.hp <= 0) this.kill(tgt, att, h.slot);
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
    if (killer && killer.kills >= MATCH_RULES.killsToWin) this.endMatch(killer);
  }

  // -------------------------------------------------------------------------------------------
  // match flow
  // -------------------------------------------------------------------------------------------

  private pickSpawn(p: Player): { pos: V3; yaw: number } {
    const spawns = arenaMeta(this.arena).spawns;
    let best = spawns[0];
    let bestScore = -Infinity;
    for (const s of spawns) {
      let minD = 1000;
      for (const o of this.players.values()) {
        if (o === p || !o.alive || !o.state) continue;
        minD = Math.min(minD, dist(o.state.p, s.pos));
      }
      const score = minD + Math.random() * 12;
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
    this.clockEnd = now() + MATCH_RULES.durationSec * 1000;
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.alive = true;
      if (p.pendingChamp) {
        p.champ = p.pendingChamp;
        p.pendingChamp = null;
      }
      p.hp = CHAMPIONS[p.champ].hp;
    }
    this.broadcast({ t: 'start', arena: this.arena, clock: MATCH_RULES.durationSec, players: this.infos() });
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
      if (t >= this.clockEnd) {
        const top = [...this.players.values()].sort((a, b) => b.kills - a.kills)[0] ?? null;
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
