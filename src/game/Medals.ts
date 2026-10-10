import { COMBAT } from '../../shared/constants';
import { CHAMPIONS } from '../../shared/champions';
import type { Fighter } from './Fighter';
import type { MedalShow } from '../ui/HUD';

/** what the killing blow looked like (recorded by the match on every damage event) */
export interface LastHit {
  attacker: string | null;
  slot?: string;
  crit: boolean;
  mo: number;
  counter: boolean;
  punish: boolean;
  /** attacker and victim were both off the ground */
  aerial: boolean;
  t: number;
}

export interface KillReport {
  /** medals for the killer, best first */
  medals: MedalShow[];
  /** fighters credited with an assist */
  assists: Fighter[];
  /** announcements for everyone (kill feed) */
  notes: string[];
}

interface Run {
  streak: number;
  multi: number;
  lastKillAt: number;
}

const MULTI = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'ENCORE!'];
const STREAKS: Array<[number, string]> = [
  [12, 'LEGEND'],
  [8, 'HEADLINER'],
  [5, 'SOLD OUT'],
  [3, 'ON FIRE'],
];
/** kills closer together than this chain into a multi-kill (s) */
const MULTI_SEC = 4.5;

/**
 * Halo / Apex style medals: multi-kills, streaks, shutdowns, revenge and style kills (momentum,
 * nape cut, counter, headshot...). Pure bookkeeping, fed by the match on every client so the
 * same rules run offline and online.
 */
export class Medals {
  /** victim id -> attacker id -> recent damage */
  private dmg = new Map<string, Map<string, { amount: number; t: number }>>();
  private runs = new Map<string, Run>();
  /** who last killed each fighter (revenge) */
  private nemesis = new Map<string, string>();
  private firstBlood = false;

  private run(f: Fighter): Run {
    let r = this.runs.get(f.id);
    if (!r) this.runs.set(f.id, (r = { streak: 0, multi: 0, lastKillAt: -100 }));
    return r;
  }

  /** a match joined in progress: whether someone already scored (no FIRST BLOOD then) */
  seed(anyKills: boolean): void {
    this.firstBlood = anyKills;
  }

  streak(f: Fighter): number {
    return this.runs.get(f.id)?.streak ?? 0;
  }

  onDamage(att: Fighter, victim: Fighter, amount: number, t: number): void {
    if (att === victim || amount <= 0) return;
    let m = this.dmg.get(victim.id);
    if (!m) this.dmg.set(victim.id, (m = new Map()));
    const e = m.get(att.id);
    if (e && t - e.t <= COMBAT.assistSec) {
      e.amount += amount;
      e.t = t;
    } else m.set(att.id, { amount, t });
  }

  /** damage `att` dealt to `victim` in the last `sec` seconds */
  recentDamage(att: Fighter, victim: Fighter, t: number, sec = COMBAT.assistSec): number {
    const e = this.dmg.get(victim.id)?.get(att.id);
    return e && t - e.t <= sec ? e.amount : 0;
  }

  onKill(killer: Fighter | null, victim: Fighter, all: Fighter[], t: number, hit?: LastHit): KillReport {
    const out: KillReport = { medals: [], assists: [], notes: [] };
    const vr = this.run(victim);
    const victimStreak = vr.streak;
    vr.streak = 0;
    vr.multi = 0;
    // assists: anyone else who hurt the victim recently
    const log = this.dmg.get(victim.id);
    if (log) {
      for (const [id, e] of log) {
        if (id === killer?.id || id === victim.id || t - e.t > COMBAT.assistSec || e.amount < COMBAT.assistMinDamage) continue;
        const f = all.find((x) => x.id === id);
        if (f && f.alive) out.assists.push(f);
      }
    }
    this.dmg.delete(victim.id);
    if (!killer || killer === victim) return out;

    const kr = this.run(killer);
    kr.multi = t - kr.lastKillAt <= MULTI_SEC ? kr.multi + 1 : 1;
    kr.lastKillAt = t;
    kr.streak++;
    const medals = out.medals;
    const name = `<b>${esc(killer.name)}</b>`;
    if (!this.firstBlood) {
      this.firstBlood = true;
      medals.push({ name: 'FIRST BLOOD', tier: 2 });
      out.notes.push(`${name} FIRST BLOOD`);
    }
    if (kr.multi >= 2) medals.push({ name: MULTI[Math.min(kr.multi, 4)], tier: kr.multi >= 4 ? 3 : kr.multi === 3 ? 3 : 2 });
    for (const [n, label] of STREAKS) {
      if (kr.streak === n) {
        medals.push({ name: label, tier: n >= 8 ? 3 : 2, sub: `${n} DI FILA` });
        out.notes.push(`${name} ${label} · ${n} di fila`);
        break;
      }
    }
    if (victimStreak >= 3) {
      medals.push({ name: 'SHUTDOWN', tier: 2, sub: `${victimStreak} DI FILA` });
      out.notes.push(`${name} ferma <b>${esc(victim.name)}</b> · SHUTDOWN`);
    }
    if (this.nemesis.get(killer.id) === victim.id) {
      medals.push({ name: 'REVENGE', tier: 1 });
      this.nemesis.delete(killer.id);
    }
    this.nemesis.set(victim.id, killer.id);
    // style: how the last blow landed
    if (hit && hit.attacker === killer.id && t - hit.t < 1.5) {
      const melee = CHAMPIONS[killer.champId].role === 'melee';
      if (hit.counter) medals.push({ name: 'COUNTER', tier: 2 });
      else if (hit.punish) medals.push({ name: 'PUNISH', tier: 1 });
      if (hit.mo >= 34) medals.push({ name: 'MACH', tier: 3, sub: `${Math.round(hit.mo)} M/S` });
      else if (hit.mo >= 18) medals.push({ name: 'MOMENTUM', tier: 1, sub: `${Math.round(hit.mo)} M/S` });
      if (hit.crit && !hit.counter && melee && (hit.slot === 'atk' || hit.slot === 'abi')) medals.push({ name: 'NAPE CUT', tier: 2 });
      if (hit.crit && !hit.counter && !melee && (hit.slot === 'atk' || hit.slot === 'sec')) medals.push({ name: 'HEADSHOT', tier: 1 });
      if (hit.aerial) medals.push({ name: 'AERIAL', tier: 1 });
    }
    if (killer.alive && killer.hp / killer.maxHp < 0.15) medals.push({ name: 'CLUTCH', tier: 2 });
    medals.sort((a, b) => b.tier - a.tier);
    return out;
  }

  reset(): void {
    this.dmg.clear();
    this.runs.clear();
    this.nemesis.clear();
    this.firstBlood = false;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
