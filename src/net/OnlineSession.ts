import * as THREE from 'three';
import type { ChampionId } from '../../shared/champions';
import type { PlayerInfo, PlayerState, S2C, V3 } from '../../shared/protocol';
import type { Fighter } from '../game/Fighter';
import { wrapAngle } from '../game/Fighter';
import type { Match, NetBridge } from '../game/Match';
import type { ActionEvent, HitInfo } from '../game/types';
import type { HookState } from '../game/Grapple';
import { NetClient } from './NetClient';

const HOOK_CODES: HookState[] = ['idle', 'flying', 'attached', 'retract'];
const INTERP_DELAY = 110;

interface Sample {
  t: number;
  s: PlayerState;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Bridges the server and the local Match: sends the local fighter's state, interpolates
 * remote fighters, applies authoritative damage/kills/respawns, and replays remote actions.
 */
export class OnlineSession implements NetBridge {
  readonly net = new NetClient();
  match: Match | null = null;
  myId = '';
  room = '';
  arena = '';
  players = new Map<string, PlayerInfo>();
  private buffers = new Map<string, Sample[]>();
  private offset: number | null = null;
  private sendT = 0;
  /** fired when the server starts a new match (arena change) */
  onNewMatch: ((arena: string) => void) | null = null;
  onEnd: ((winner: string | null, players: PlayerInfo[], next: number) => void) | null = null;
  onDisconnect: ((reason: string) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  /** messages that arrived before the match existed */
  private pendingSpawns: Extract<S2C, { t: 'spawn' }>[] = [];

  async connect(name: string, champ: ChampionId, room?: string): Promise<Extract<S2C, { t: 'welcome' }>> {
    const w = await this.net.connect(name, champ, room);
    this.myId = w.id;
    this.room = w.room;
    this.arena = w.arena;
    for (const p of w.players) this.players.set(p.id, p);
    this.offset = w.time - performance.now();
    this.net.onClose = (r) => this.onDisconnect?.(r);
    return w;
  }

  /** attach to a freshly built Match (also after arena changes) */
  attach(m: Match): void {
    this.match = m;
    m.net = this;
    for (const p of this.players.values()) {
      if (p.id === this.myId) {
        m.local.kills = p.kills;
        m.local.deaths = p.deaths;
        continue;
      }
      this.ensureRemote(p);
    }
    for (const s of this.pendingSpawns) this.onSpawn(s);
    this.pendingSpawns.length = 0;
  }

  close(): void {
    this.net.close();
    this.match = null;
  }

  private ensureRemote(p: PlayerInfo): Fighter | null {
    const m = this.match;
    if (!m) return null;
    let f = m.getFighter(p.id);
    if (f && f.champId !== p.champ) {
      m.removeFighter(p.id);
      f = undefined;
    }
    if (!f) {
      f = m.addFighter(p.id, p.name, p.champ, 'remote');
      f.kills = p.kills;
      f.deaths = p.deaths;
      f.alive = p.alive;
      f.hp = p.hp;
      f.visual.root.visible = p.alive;
    }
    return f;
  }

  // ===========================================================================================
  // NetBridge
  // ===========================================================================================

  sendHit(_attacker: Fighter, target: Fighter, info: HitInfo): void {
    this.net.send({
      t: 'hit',
      target: target.id,
      slot: info.slot,
      part: info.part,
      scale: info.scale,
      crit: info.crit,
      kb: info.kb ? (info.kb.toArray().map((v) => +v.toFixed(2)) as V3) : undefined,
      stun: info.stun,
      slow: info.slow,
      blockable: info.blockable,
      at: info.at ? (info.at.toArray().map((v) => +v.toFixed(2)) as V3) : undefined,
    });
  }

  sendHeal(_f: Fighter, amount: number): void {
    this.net.send({ t: 'heal', amount });
  }

  sendAction(_f: Fighter, e: ActionEvent): void {
    this.net.send({ t: 'act', e });
  }

  changeChampion(champ: ChampionId): void {
    this.net.send({ t: 'champ', champ });
  }

  // ===========================================================================================
  // per frame
  // ===========================================================================================

  update(dt: number): void {
    // drain messages
    while (this.net.queue.length) this.handle(this.net.queue.shift()!);
    const m = this.match;
    if (!m) return;
    // send local state at 20 Hz
    this.sendT -= dt;
    if (this.sendT <= 0 && m.local.alive) {
      this.sendT = 0.05;
      this.net.send({ t: 'state', s: this.localState(m.local) });
    }
    this.interpolate();
  }

  private localState(f: Fighter): PlayerState {
    const r = (v: number) => Math.round(v * 100) / 100;
    const hk = f.hooks;
    const s: PlayerState = {
      p: [r(f.pos.x), r(f.pos.y), r(f.pos.z)],
      v: [r(f.vel.x), r(f.vel.y), r(f.vel.z)],
      f: r(f.facing),
      ay: r(f.aimYaw),
      ap: r(f.aimPitch),
      fl: (f.grounded ? 1 : 0) | (f.boosting ? 2 : 0) | (f.dashTime > 0 ? 4 : 0) | (f.guard ? 8 : 0) | (f.wallRun > 0 ? 16 : 0),
      h: [HOOK_CODES.indexOf(hk[0].state), HOOK_CODES.indexOf(hk[1].state)],
    };
    if (hk[0].state !== 'idle') s.ha = [r(hk[0].anchor.x), r(hk[0].anchor.y), r(hk[0].anchor.z)];
    if (hk[1].state !== 'idle') s.hb = [r(hk[1].anchor.x), r(hk[1].anchor.y), r(hk[1].anchor.z)];
    return s;
  }

  private serverNow(): number {
    return performance.now() + (this.offset ?? 0);
  }

  private interpolate(): void {
    const m = this.match!;
    const rt = this.serverNow() - INTERP_DELAY;
    for (const [id, buf] of this.buffers) {
      const f = m.getFighter(id);
      if (!f || f.kind !== 'remote' || !buf.length) continue;
      while (buf.length > 2 && buf[1].t <= rt) buf.shift();
      const s0 = buf[0];
      let s1 = buf[buf.length > 1 ? 1 : 0];
      let k = 0;
      if (buf.length > 1 && s1.t > s0.t) k = THREE.MathUtils.clamp((rt - s0.t) / (s1.t - s0.t), 0, 1.25);
      if (rt < s0.t) {
        s1 = s0;
        k = 0;
      }
      const a = s0.s;
      const b = s1.s;
      _a.fromArray(a.p);
      _b.fromArray(b.p);
      f.net.pos.lerpVectors(_a, _b, k);
      // extrapolate slightly past the last sample using velocity
      if (k > 1) f.net.pos.addScaledVector(_b.fromArray(b.v), ((k - 1) * (s1.t - s0.t)) / 1000);
      _a.fromArray(a.v);
      _b.fromArray(b.v);
      f.net.vel.lerpVectors(_a, _b, Math.min(k, 1));
      f.net.facing = a.f + wrapAngle(b.f - a.f) * Math.min(k, 1);
      f.net.has = true;
      f.aimYaw = a.ay + wrapAngle(b.ay - a.ay) * Math.min(k, 1);
      f.aimPitch = a.ap + (b.ap - a.ap) * Math.min(k, 1);
      const fl = b.fl;
      f.grounded = (fl & 1) !== 0;
      f.boosting = (fl & 2) !== 0;
      f.dashTime = (fl & 4) !== 0 ? 0.05 : 0;
      f.guard = (fl & 8) !== 0;
      f.wallRun = (fl & 16) !== 0 ? 0.1 : 0;
      // hooks
      for (let i = 0; i < 2; i++) {
        const code = HOOK_CODES[b.h[i]] ?? 'idle';
        const anchor = i === 0 ? b.ha : b.hb;
        f.applyRemoteHook(i, code, anchor);
      }
    }
  }

  // ===========================================================================================
  // messages
  // ===========================================================================================

  private handle(msg: S2C): void {
    const m = this.match;
    switch (msg.t) {
      case 'snap': {
        const sample = msg.time - performance.now();
        this.offset = this.offset === null ? sample : Math.max(sample, this.offset + (sample - this.offset) * 0.05);
        if (m) m.clock = msg.clock;
        for (const [id, s] of msg.ps) {
          if (id === this.myId) continue;
          let buf = this.buffers.get(id);
          if (!buf) this.buffers.set(id, (buf = []));
          buf.push({ t: msg.time, s });
          if (buf.length > 30) buf.shift();
        }
        break;
      }
      case 'join':
        this.players.set(msg.p.id, msg.p);
        if (m) {
          this.ensureRemote(msg.p);
          m.hud?.banner(`${msg.p.name} È ENTRATO`, 'join');
        }
        break;
      case 'leave': {
        const p = this.players.get(msg.id);
        this.players.delete(msg.id);
        this.buffers.delete(msg.id);
        if (m) {
          m.removeFighter(msg.id);
          if (p) m.hud?.banner(`${p.name} È USCITO`, 'join');
        }
        break;
      }
      case 'act': {
        const f = m?.getFighter(msg.id);
        if (!f || !m) break;
        if (msg.e.a === 'taunt') {
          f.startTaunt();
        } else if (msg.e.a === 'flip') {
          f.startFlip(Math.sign(msg.e.n ?? 0));
        } else if (msg.e.a === 'hookL' || msg.e.a === 'hookR') {
          f.applyRemoteHook(msg.e.a === 'hookL' ? 0 : 1, 'flying', msg.e.p);
          m.audio.play('hookFire', f.pos, 0.6);
        } else f.kit?.playRemote(f, msg.e, m);
        break;
      }
      case 'dmg': {
        if (!m) break;
        const tgt = m.getFighter(msg.tgt);
        if (!tgt) break;
        const src = msg.src ? m.getFighter(msg.src) ?? null : null;
        m.applyDamage(src, tgt, msg.amt, {
          kb: msg.kb ? new THREE.Vector3(...msg.kb) : undefined,
          stun: msg.stun,
          slow: msg.slow,
          crit: msg.crit,
          at: msg.at ? new THREE.Vector3(...msg.at) : undefined,
          slot: msg.slot as HitInfo['slot'] | undefined,
        }, msg.blocked);
        tgt.hp = msg.hp;
        break;
      }
      case 'parry': {
        if (!m) break;
        const def = m.getFighter(msg.def);
        const att = m.getFighter(msg.att);
        if (def && att) m.applyParry(def, att);
        break;
      }
      case 'heal': {
        const f = m?.getFighter(msg.id);
        if (f && m) {
          m.applyHeal(f, msg.amt);
          f.hp = msg.hp;
        }
        break;
      }
      case 'kill': {
        if (!m) break;
        const victim = m.getFighter(msg.victim);
        const killer = msg.killer ? m.getFighter(msg.killer) ?? null : null;
        if (victim) m.kill(victim, killer, msg.slot);
        const pv = this.players.get(msg.victim);
        if (pv) {
          pv.deaths++;
          pv.alive = false;
        }
        const pk = msg.killer ? this.players.get(msg.killer) : undefined;
        if (pk && msg.killer !== msg.victim) pk.kills++;
        break;
      }
      case 'spawn':
        if (!m) this.pendingSpawns.push(msg);
        else this.onSpawn(msg);
        break;
      case 'end':
        for (const p of msg.players) this.players.set(p.id, p);
        if (m) m.state = 'ended';
        this.onEnd?.(msg.winner, msg.players, msg.next);
        break;
      case 'start':
        this.arena = msg.arena;
        this.players.clear();
        for (const p of msg.players) this.players.set(p.id, p);
        this.buffers.clear();
        this.onNewMatch?.(msg.arena);
        break;
      case 'error':
        this.onError?.(msg.msg);
        break;
      default:
        break;
    }
  }

  private onSpawn(msg: Extract<S2C, { t: 'spawn' }>): void {
    const m = this.match!;
    const info = this.players.get(msg.id);
    if (info) {
      info.alive = true;
      info.champ = msg.champ;
    }
    let f = m.getFighter(msg.id === this.myId ? m.local.id : msg.id);
    if (msg.id === this.myId) {
      if (f && f.champId !== msg.champ) {
        // champion swap on respawn: rebuild the local fighter
        m.replaceLocal(msg.champ);
        f = m.local;
      }
    } else if (info) {
      f = this.ensureRemote(info) ?? undefined;
    }
    if (!f) return;
    const pos = new THREE.Vector3(...msg.pos);
    m.respawnAt(f, pos, msg.yaw);
    this.buffers.delete(msg.id);
  }
}
