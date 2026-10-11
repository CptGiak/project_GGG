import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Input } from '../core/Input';
import type { AudioEngine } from '../core/Audio';
import { CHAMPION_IDS, CHAMPIONS, MATCH_RULES, type ChampionId } from '../../shared/champions';
import { COMBAT, MOVE, hitMultiplier, momentumK } from '../../shared/constants';
import { buildArena } from '../world/arenas';
import { applyMood, type Arena } from '../world/ArenaBuilder';
import { setKeyLight, ToonEnv } from '../render/toon';
import { Effects } from '../vfx/Effects';
import { SlashTrail } from '../vfx/Trails';
import { Projectiles } from '../combat/Projectiles';
import { createKit } from '../combat/kits';
import { buildVisual } from '../champions';
import { CameraRig } from './CameraRig';
import { Fighter, rightOf, wrapAngle } from './Fighter';
import { LocalController } from './LocalController';
import { BotController } from './BotController';
import { clearEdges, type ActionEvent, type HitInfo, type MatchContext } from './types';
import { HUD as HUDClass, type HUD } from '../ui/HUD';
import { WeaponGhosts } from '../vfx/WeaponGhosts';
import { Medals, type LastHit } from './Medals';
import { SpotMode } from './SpotMode';
import { SPOT, SPOT_DURATION_SEC, type ModeId } from '../../shared/modes';
import { renderPortraits } from '../ui/portraits';

export interface MatchOptions {
  arenaId: string;
  mode: 'practice' | 'online';
  localChampion: ChampionId;
  localName: string;
  localId?: string;
  bots?: Array<{ champion: ChampionId; difficulty: number; name: string }>;
  rules?: Partial<typeof MATCH_RULES>;
  /** game mode (default deathmatch) and the seed of its schedule */
  gameMode?: ModeId;
  seed?: number;
}

export interface NetBridge {
  sendHit(attacker: Fighter, target: Fighter, info: HitInfo): void;
  sendHeal(f: Fighter, amount: number): void;
  sendAction(f: Fighter, e: ActionEvent): void;
}

export interface KillEvent {
  killer: Fighter | null;
  victim: Fighter;
  slot?: string;
}

const _v = new THREE.Vector3();
const _r = new THREE.Vector3();

export class Match implements MatchContext {
  readonly scene = new THREE.Scene();
  readonly arena: Arena;
  readonly fighters: Fighter[] = [];
  readonly cam: CameraRig;
  readonly vfx = new Effects();
  readonly projectiles = new Projectiles();
  readonly camPos = new THREE.Vector3();
  readonly trails = new Map<Fighter, SlashTrail[]>();
  readonly ghosts = new Map<Fighter, WeaponGhosts>();
  private portraits = new Map<ChampionId, string>();
  /** winner showcased by the end-of-match camera */
  private victor: Fighter | null = null;
  private victorT = 0;
  /** victory camera start: angle, distance, height relative to the winner */
  private vcStart = new THREE.Vector3();
  local!: Fighter;
  time = 0;
  /** match clock (seconds remaining) */
  clock: number;
  state: 'countdown' | 'playing' | 'ended' = 'countdown';
  countdown = 3.2;
  rules: typeof MATCH_RULES;
  hud: HUD | null = null;
  net: NetBridge | null = null;
  readonly controller: LocalController;
  readonly bots: BotController[] = [];
  private hitStopT = 0;
  private lastCount = 4;
  private damageFlash = 0;
  private flash = 0;
  /** last 2D hit-confirm sound (rapid fire is throttled) */
  private confirmAt = -1;
  readonly medals = new Medals();
  /** how the latest blow on each fighter landed (medals for the killing blow) */
  private lastHit = new Map<string, LastHit>();
  /** counters of notable plays this match (dodges, parries, momentum hits, medals...) */
  readonly stats: Record<string, number> = {};
  /** RIFLETTORE runtime (null in deathmatch) */
  readonly spot: SpotMode | null = null;
  onKill: ((e: KillEvent) => void) | null = null;
  onDodge: ((def: Fighter, att: Fighter | null) => void) | null = null;
  onEnd: ((winner: Fighter | null) => void) | null = null;
  paused = false;

  constructor(
    readonly engine: Engine,
    readonly input: Input,
    readonly audio: AudioEngine,
    readonly opts: MatchOptions,
  ) {
    this.rules = { ...MATCH_RULES, ...opts.rules };
    if (opts.gameMode === 'spot') this.rules.durationSec = Math.ceil(SPOT_DURATION_SEC);
    this.clock = this.rules.durationSec;
    this.arena = buildArena(opts.arenaId);
    this.scene.add(this.arena.root);
    applyMood(this.scene, this.arena.mood);
    setKeyLight(this.arena.sun);
    engine.fx.uniforms.uLineColor.value.set(this.arena.mood.speedLines);
    engine.fx.uniforms.uTint.value.set(this.arena.mood.tint ?? 0xffffff);
    this.scene.add(this.vfx.group, this.projectiles.group);
    this.cam = new CameraRig(engine.aspect);
    this.controller = new LocalController(input, this.cam);
    // local fighter
    this.local = this.addFighter(opts.localId ?? 'local', opts.localName, opts.localChampion, 'local');
    if (opts.mode === 'practice') {
      opts.bots?.forEach((b, i) => {
        const f = this.addFighter(`bot${i}`, b.name, b.champion, 'bot');
        this.bots.push(new BotController(f, b.difficulty));
      });
      this.fighters.forEach((f, i) => this.respawn(f, i));
    } else {
      this.respawn(this.local, Math.floor(Math.random() * this.arena.spawns.length));
    }
    if (opts.gameMode === 'spot') this.spot = new SpotMode(this, opts.arenaId, opts.seed ?? Math.floor(Math.random() * 1e9), opts.mode === 'practice');
    this.cam.snapTo(this.local);
    engine.setView(this.scene, this.cam.camera);
    // eye close-ups for the ultimate cut-ins (rendered before the first full frame)
    this.portraits = renderPortraits(engine.renderer, CHAMPION_IDS);
  }

  get world() {
    return this.arena.world;
  }

  addFighter(id: string, name: string, champ: ChampionId, kind: 'local' | 'bot' | 'remote'): Fighter {
    const visual = buildVisual(champ);
    const f = new Fighter(id, name, champ, kind, visual);
    f.kit = createKit(champ);
    for (const o of f.sceneObjects) this.scene.add(o);
    const trails = visual.blades.map((bl) => {
      const t = new SlashTrail(bl.colorA, bl.colorB, 2.4);
      this.scene.add(t.mesh);
      return t;
    });
    this.trails.set(f, trails);
    // weapon afterimages / ultimate hologram (ranged champions use their palette)
    const bl = visual.blades[0];
    const ca = bl?.colorA ?? new THREE.Color(f.champ.colors[0]);
    const cb = bl?.colorB ?? new THREE.Color(f.champ.colors[1]);
    this.ghosts.set(f, new WeaponGhosts(this.scene, [visual.weaponR, visual.weaponL], ca, cb));
    this.fighters.push(f);
    return f;
  }

  removeFighter(id: string): void {
    const i = this.fighters.findIndex((f) => f.id === id);
    if (i < 0) return;
    const f = this.fighters[i];
    for (const o of f.sceneObjects) this.scene.remove(o);
    for (const t of this.trails.get(f) ?? []) this.scene.remove(t.mesh);
    this.trails.delete(f);
    this.ghosts.get(f)?.dispose();
    this.ghosts.delete(f);
    this.fighters.splice(i, 1);
  }

  getFighter(id: string): Fighter | undefined {
    return this.fighters.find((f) => f.id === id);
  }

  /** pick the spawn farthest from living enemies (and away from the spotlight) */
  bestSpawn(f: Fighter): number {
    let best = 0;
    let bestScore = -Infinity;
    const z = this.spot?.objective();
    this.arena.spawns.forEach((s, i) => {
      let minD = Infinity;
      for (const o of this.fighters) {
        if (o === f || !o.alive) continue;
        minD = Math.min(minD, o.pos.distanceTo(s.pos));
      }
      let score = (minD === Infinity ? 100 : minD) + Math.random() * 15;
      if (z && Math.hypot(s.pos.x - z.c[0], s.pos.z - z.c[2]) < SPOT.spawnClear) score -= 60;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  }

  /** server-driven respawn at an explicit position */
  respawnAt(f: Fighter, pos: THREE.Vector3, yaw: number): void {
    f.spawn(pos, yaw);
    this.vfx.spawnFx(pos, f.champ.colors[0]);
    if (f === this.local) {
      this.cam.snapTo(f);
      this.cam.yaw = yaw;
      this.cam.orbit = false;
      this.audio.play('respawn');
    }
  }

  /** swap the local champion (online champion change on respawn) */
  replaceLocal(champ: ChampionId): void {
    const old = this.local;
    this.removeFighter(old.id);
    const f = this.addFighter(old.id, old.name, champ, 'local');
    f.kills = old.kills;
    f.deaths = old.deaths;
    f.damageDealt = old.damageDealt;
    this.local = f;
    if (this.hud) {
      const c = this.hud.container;
      this.hud.dispose();
      this.hud = new HUDClass(c, f, this.input.bindings);
    }
  }

  respawn(f: Fighter, spawnIndex?: number): void {
    const i = spawnIndex ?? this.bestSpawn(f);
    const s = this.arena.spawns[i % this.arena.spawns.length];
    f.spawn(s.pos, s.yaw);
    this.vfx.spawnFx(s.pos, f.champ.colors[0]);
    if (f === this.local) {
      this.cam.snapTo(f);
      this.cam.orbit = false;
      this.audio.play('respawn');
    }
  }

  // ===========================================================================================
  // MatchContext
  // ===========================================================================================

  objective(): { c: [number, number, number]; r: number; h: number } | null {
    return this.spot?.objective() ?? null;
  }

  isAuthority(attacker: Fighter): boolean {
    return this.opts.mode === 'practice' ? attacker.kind !== 'remote' : attacker.kind === 'local';
  }

  reportHit(attacker: Fighter, target: Fighter, info: HitInfo): void {
    if (!target.alive || target.spawnProtect > 0) return;
    if (target.team !== 0 && target.team === attacker.team) return;
    const ab = CHAMPIONS[attacker.champId].abilities[info.slot];
    const stream = !!ab.stream?.includes(info.part);
    if (this.opts.mode === 'online') {
      // predicted feedback; the server confirms damage, or rules a dodge if the target was in i-frames
      const dodging = target.invuln > 0;
      if (dodging) {
        if (attacker === this.local) this.hud?.floatText(target, 'MISS', 'miss');
      } else {
        if (!stream) this.useCounter(attacker, info);
        if (target.punishT > 0) info.punish = true;
      }
      this.net?.sendHit(attacker, target, info);
      if (!dodging) this.hitFeedback(attacker, target, info, true);
      return;
    }
    // i-frames: every hit misses; inside a fresh dash it is a perfect dodge (not vs. rapid fire)
    if (target.invuln > 0) {
      if (target.dodgeT > 0 && !stream) this.applyDodge(target, attacker, attacker.pos.distanceTo(target.pos) <= COMBAT.offbeatRange);
      else if (attacker === this.local) this.hud?.floatText(target, 'MISS', 'miss');
      return;
    }
    if (!stream) this.useCounter(attacker, info);
    info.punish = target.punishT > 0;
    const base = ab.damage[info.part] ?? 0;
    const mo = ab.momentum?.includes(info.part) ? info.mo ?? 0 : 0;
    let dmg = base * (info.scale ?? 1) * hitMultiplier(!!info.crit, this.rules.critMultiplier, mo, info.punish);
    // guard (frontal)
    let blocked = false;
    let parried = false;
    if (target.guard && info.blockable !== false) {
      _v.subVectors(attacker.pos, target.pos).setY(0).normalize();
      const front = Math.sin(target.facing) * _v.x + Math.cos(target.facing) * _v.z;
      if (front > 0.2) {
        blocked = true;
        if (this.time - target.guardStart < 0.22) parried = true;
      }
    }
    if (parried) {
      this.applyParry(target, attacker);
      return;
    }
    if (blocked) dmg *= 0.25;
    if (info.punish) this.stat('punish');
    if (mo >= COMBAT.momentumMinSpeed) this.stat(`momentum:${mo >= 34 ? 'mach' : mo >= 26 ? 'high' : 'low'}`);
    this.stat(`hit:${attacker.champId}:${info.slot}:${info.part}`);
    this.applyDamage(attacker, target, Math.round(dmg), info, blocked);
  }

  /** the first hit after a perfect dodge or a parry is a guaranteed critical */
  private useCounter(attacker: Fighter, info: HitInfo): void {
    if (attacker.counterT <= 0 || !attacker.simulated) return;
    attacker.counterT = 0;
    info.crit = true;
    info.counter = true;
    this.stat('counter');
  }

  stat(key: string, n = 1): void {
    this.stats[key] = (this.stats[key] ?? 0) + n;
  }

  debugStats(): Record<string, number> {
    return { ...this.stats };
  }

  /** ultimate charge (0..1 of the bar); announces READY for the local player, `label` shows a chip */
  addUlt(f: Fighter, amount: number, label?: string): void {
    if (!f.alive || amount <= 0 || f.ult >= 1) return;
    const before = f.ult;
    f.ult = Math.min(1, f.ult + amount);
    if (f !== this.local) return;
    if (label) this.hud?.ultGain(label, amount);
    if (before < 1 && f.ult >= 1) {
      this.audio.play('ultReady');
      this.hud?.banner('ULTIMATE READY', 'ult');
    }
  }

  /**
   * A hit landed inside fresh dash i-frames: it misses, and the dodger (at most once per
   * COMBAT.dodgeRewardCd) gets a counter window, the dash gas back and some ultimate charge.
   * An attacker that close goes Fuori Tempo.
   */
  applyDodge(def: Fighter, att: Fighter | null, offbeat: boolean): void {
    if (!def.alive) return;
    const at = def.chest(new THREE.Vector3());
    if (def.dodgeCd > 0) {
      // already rewarded for this dodge: the hit still whiffs
      if (att === this.local) this.hud?.floatText(def, 'MISS', 'miss');
      return;
    }
    def.dodgeCd = COMBAT.dodgeRewardCd;
    def.dodges++;
    this.stat('perfectDodge');
    if (def.simulated) {
      def.counterT = COMBAT.counterSec;
      def.gas = Math.min(MOVE.gasMax, def.gas + COMBAT.dodgeGasRefund);
      this.addUlt(def, COMBAT.dodgeUlt, 'DODGE');
    }
    this.vfx.dodgeFlash(at, def.champ.colors[0], def.champ.colors[1]);
    this.audio.play('dodge', at, 1);
    if (def === this.local) {
      this.hud?.banner('PERFECT DODGE', 'dodge');
      if (this.opts.mode === 'practice') this.hitStop(0.12);
      this.flash = Math.max(this.flash, 0.3);
    } else if (att === this.local) {
      this.hud?.floatText(def, 'DODGED', 'miss');
    }
    if (att && offbeat) this.applyOffbeat(att);
    this.onDodge?.(def, att);
  }

  /** Fuori Tempo: the attacker of a perfect dodge runs at half speed and can be punished */
  applyOffbeat(f: Fighter): void {
    if (!f.alive) return;
    f.punishT = Math.max(f.punishT, COMBAT.offbeatSec);
    if (f.simulated) f.offbeatT = COMBAT.offbeatSec;
    this.stat('offbeat');
    const c = f.chest(new THREE.Vector3());
    this.vfx.ring(c, _v.set(0, 1, 0), 0xffffff, 0.4, 2.2, 0.35);
    if (f === this.local) {
      this.hud?.banner('FUORI TEMPO', 'offbeat');
      this.audio.play('glitch', undefined, 0.9);
    }
  }

  reportHeal(f: Fighter, amount: number): void {
    if (this.opts.mode === 'online') {
      this.net?.sendHeal(f, amount);
      return;
    }
    this.applyHeal(f, amount);
  }

  applyHeal(f: Fighter, amount: number): void {
    if (!f.alive) return;
    f.hp = Math.min(f.maxHp, f.hp + amount);
    this.hud?.floatText(f, `+${amount}`, 'heal');
  }

  broadcastAction(f: Fighter, e: ActionEvent): void {
    if (this.opts.mode === 'online' && f.kind === 'local') this.net?.sendAction(f, e);
  }

  announceUlt(f: Fighter, remote = false): void {
    if (!remote) this.broadcastAction(f, { a: 'ultcut' });
    this.stat(`ult:${f.champId}`);
    this.hud?.ultCutIn(f, f.champ.abilities.ult.name, this.portraits.get(f.champId) ?? null, f !== this.local);
    if (f === this.local) {
      this.audio.play('cutin');
      this.flash = Math.max(this.flash, 0.2);
    } else this.audio.play('cutin', undefined, 0.5);
  }

  shake(amount: number, at?: THREE.Vector3): void {
    let k = 1;
    if (at) k = THREE.MathUtils.clamp(1 - at.distanceTo(this.local.pos) / 40, 0, 1);
    this.cam.addTrauma(amount * k);
  }

  hitStop(seconds: number): void {
    this.hitStopT = Math.max(this.hitStopT, seconds);
  }

  // ===========================================================================================
  // Damage & death
  // ===========================================================================================

  /** feedback shared by offline application and online prediction */
  hitFeedback(attacker: Fighter, target: Fighter, info: HitInfo, predicted: boolean, blocked = false): void {
    const at = info.at ?? target.chest(new THREE.Vector3());
    const stream = !!CHAMPIONS[attacker.champId].abilities[info.slot].stream?.includes(info.part);
    const mk = momentumK(info.mo ?? 0);
    if (attacker === this.local) {
      this.hud?.hitMarker(blocked ? 'block' : info.counter ? 'counter' : mk > 0 ? 'mom' : info.crit ? 'crit' : 'hit');
      // 2D confirm: the attacker always hears a hit land, however far away it is
      if (!stream || this.time - this.confirmAt > 0.2) {
        this.confirmAt = this.time;
        this.audio.play(info.counter ? 'counter' : info.crit && !blocked ? 'dink' : 'tick', undefined, stream ? 0.35 : 0.8);
      }
      if (mk > 0 && !blocked) this.audio.play('slice', undefined, 0.5 + 0.5 * mk);
      // hit-stop grows with the play
      let hs = 0;
      if (info.slot === 'ult') hs = 0.12;
      else if (mk > 0) hs = 0.06 + 0.07 * mk;
      else if (info.counter) hs = 0.1;
      else if (info.slot !== 'atk' || info.crit) hs = 0.06;
      else if (CHAMPIONS[attacker.champId].role === 'melee') hs = 0.045;
      if (hs > 0 && !stream) this.hitStop(hs);
      if (mk > 0 && !blocked) {
        this.cam.addTrauma(0.15 + 0.3 * mk);
        if (mk >= 0.45) this.flash = Math.max(this.flash, 0.25 * mk);
      }
    }
    if (predicted) {
      _v.subVectors(at, attacker.chest(_r)).normalize();
      this.vfx.hitSpark(at, _v, attacker.champ.colors[1], !!info.crit || info.slot === 'ult' || !!info.counter);
      if (mk > 0 && !blocked) this.vfx.momentumBurst(at, attacker.vel, attacker.champ.colors[0], mk);
    }
  }

  applyDamage(attacker: Fighter | null, target: Fighter, amount: number, info: Partial<HitInfo>, blocked = false): void {
    if (!target.alive) return;
    const real = Math.min(amount, target.hp);
    target.hp = Math.max(0, target.hp - amount);
    target.hitFlash = 0.12;
    target.lastAttackerId = attacker?.id ?? null;
    const at = info.at ?? target.chest(new THREE.Vector3());
    if (attacker && attacker !== target) {
      attacker.damageDealt += amount;
      this.medals.onDamage(attacker, target, real, this.time);
      // ultimate charge: real damage only (no overkill) and never from the ultimate itself;
      // taking damage charges it too, so the one losing the fight gets their comeback sooner
      if (info.slot !== 'ult') this.addUlt(attacker, real / CHAMPIONS[attacker.champId].ultCharge);
      this.addUlt(target, (real * COMBAT.ultFromDamageTaken) / CHAMPIONS[target.champId].ultCharge);
      this.lastHit.set(target.id, {
        attacker: attacker.id,
        slot: info.slot,
        crit: !!info.crit,
        mo: info.mo ?? 0,
        counter: !!info.counter,
        punish: !!info.punish,
        aerial: !attacker.grounded && !target.grounded,
        t: this.time,
      });
    }
    // knockback / stun (only meaningful for simulated fighters)
    if (target.simulated && !blocked) {
      if (info.kb) {
        target.vel.multiplyScalar(0.3).add(info.kb);
        if (info.kb.y > 2) target.grounded = false;
      }
      if (info.stun) {
        target.stun = Math.max(target.stun, info.stun);
        target.kit?.cancel(target);
        target.anim.play('stun', { hold: true });
      }
      if (info.slow) target.slow = Math.max(target.slow, info.slow);
    } else if (!blocked && info.stun && info.stun >= 0.2) {
      // puppet: its own client runs the real stun; show the pose here so the opening is readable
      target.stun = Math.max(target.stun, info.stun);
      target.anim.play('stun', { hold: true });
    }
    if (!blocked) {
      // directional flinch: the body snaps the way the blow drives it
      _v.set(0, 0, 0);
      if (info.kb) _v.copy(info.kb);
      else if (attacker) _v.subVectors(target.pos, attacker.pos);
      _v.y = 0;
      if (_v.lengthSq() < 1e-6) _v.set(-Math.sin(target.facing), 0, -Math.cos(target.facing));
      _v.normalize();
      const fy = target.facing;
      const lx = _v.x * Math.cos(fy) - _v.z * Math.sin(fy);
      const lz = _v.x * Math.sin(fy) + _v.z * Math.cos(fy);
      target.anim.hitReact(lx, lz, THREE.MathUtils.clamp(amount / 110, 0.35, 1.3) * (info.crit ? 1.2 : 1));
      if (info.kb && info.kb.y > 6) target.startTumble();
    }
    // feedback
    if (blocked) {
      _v.subVectors(at, target.chest(_r)).normalize();
      this.vfx.blockSpark(at, _v);
      this.audio.play('block', at, 0.9);
    } else {
      this.audio.play(amount > 120 ? 'hitHeavy' : 'hit', at, 1);
      if (info.crit) this.audio.play('crit', at, 0.8);
    }
    if (attacker && attacker !== this.local && target !== this.local) {
      _v.subVectors(at, attacker.chest(_r)).normalize();
      this.vfx.hitSpark(at, _v, attacker.champ.colors[1], !!info.crit);
    } else if (attacker === this.local && this.opts.mode === 'practice') {
      this.hitFeedback(attacker, target, info as HitInfo, true, blocked);
    } else if (attacker === this.local && blocked) {
      this.hud?.hitMarker('block');
    }
    this.hud?.damageNumber(target, amount, !!info.crit, blocked, attacker === this.local, info.mo ?? 0, !!info.counter, !!info.punish);
    if (target === this.local) {
      this.damageFlash = Math.min(0.6, this.damageFlash + 0.25 + amount / 600);
      this.cam.addTrauma(Math.min(0.6, 0.15 + amount / 300));
      if (attacker && attacker !== target) this.hud?.damageFrom(attacker.pos, amount);
    }
    if (target.hp <= 0 && this.opts.mode === 'practice') this.kill(target, attacker, info.slot);
  }

  /**
   * Perfect guard: within COMBAT.parryRange the attacker is stunned and punishable, and the
   * defender gets a counter window (Kaiser: the Riposte).
   */
  /** `reward`: online, the server's ruling on the counter window (offline: the local cooldown) */
  applyParry(defender: Fighter, attacker: Fighter, reward?: boolean): void {
    const close = defender.pos.distanceTo(attacker.pos) <= COMBAT.parryRange;
    if (close) {
      attacker.punishT = Math.max(attacker.punishT, COMBAT.parryStun);
      attacker.stun = Math.max(attacker.stun, COMBAT.parryStun);
      if (attacker.simulated) {
        attacker.kit?.cancel(attacker);
        attacker.vel.set(0, attacker.vel.y, 0);
      }
      attacker.anim.play('stun', { hold: true });
    }
    // the reward needs a real exchange (close) and shares the dodge's cooldown: raising the
    // guard into rapid fire from across the map farms nothing
    const rewarded = defender.simulated && (reward ?? (close && defender.dodgeCd <= 0));
    this.stat(close ? 'parry:close' : 'parry:far');
    if (rewarded) {
      defender.dodgeCd = COMBAT.dodgeRewardCd;
      defender.counterT = COMBAT.counterSec;
      this.addUlt(defender, COMBAT.ultParry, 'PARRY');
      defender.kit?.onParry?.(defender, attacker, this, close);
    }
    const at = defender.chest(new THREE.Vector3());
    this.vfx.blockSpark(at, _v.subVectors(attacker.pos, defender.pos).normalize());
    this.vfx.ring(at, _v, 0xffffff, 0.3, 3, 0.3);
    this.audio.play('parry', at, 1);
    this.hitStop(0.15);
    if (defender === this.local || attacker === this.local) {
      this.hud?.banner(defender === this.local && rewarded ? 'PARRY! · RIPOSTA' : 'PARRY!', 'parry');
      this.flash = Math.max(this.flash, 0.2);
    }
  }

  kill(victim: Fighter, killer: Fighter | null, slot?: string): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.deadTime = 0;
    victim.hp = 0;
    victim.deaths++;
    victim.kit?.cancel(victim);
    victim.hooks.forEach((h) => h.reset());
    victim.anim.play('death', { hold: true });
    victim.offbeatT = victim.punishT = victim.counterT = 0;
    if (killer && killer !== victim) killer.kills++;
    this.audio.play('death', victim.pos, 1);
    if (victim === this.local) {
      this.cam.orbit = true;
      this.hud?.deathScreen(killer);
    }
    // medals, takedown rewards
    const rep = this.medals.onKill(killer, victim, this.fighters, this.time, this.lastHit.get(victim.id));
    this.lastHit.delete(victim.id);
    for (const md of rep.medals) this.stat(`medal:${md.name}`);
    this.stat('assist', rep.assists.length);
    if (killer && killer !== victim) {
      if (killer.simulated) {
        this.addUlt(killer, COMBAT.ultKill, 'TAKEDOWN');
        killer.kit?.onTakedown?.(killer, victim, this, true);
      }
      if (killer === this.local) {
        this.audio.play('kill');
        this.audio.play('killConfirm', undefined, 0.9);
        this.hud?.hitMarker('kill');
        this.hud?.killCutIn(this.local, victim);
        if (rep.medals.length) {
          this.hud?.medals(rep.medals);
          const top = rep.medals[0].tier;
          window.setTimeout(() => this.audio.play(top >= 3 ? 'medal3' : top === 2 ? 'medal2' : 'medal1', undefined, 0.8), 160);
        }
      }
    }
    for (const a of rep.assists) {
      if (!a.simulated) continue;
      this.addUlt(a, COMBAT.ultAssist, 'ASSIST');
      a.kit?.onTakedown?.(a, victim, this, false);
      if (a === this.local) this.hud?.medals([{ name: 'ASSIST', tier: 1 }]);
    }
    this.hud?.killFeed(killer, victim);
    for (const n of rep.notes) this.hud?.feedNote(n);
    this.onKill?.({ killer, victim, slot });
    if (this.opts.mode === 'practice' && !this.spot && killer && killer.kills >= this.rules.killsToWin) this.end(killer);
  }

  end(winner: Fighter | null): void {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.celebrate(winner);
    this.onEnd?.(winner);
  }

  /** match point: the winner strikes their taunt while the camera circles them */
  celebrate(winner: Fighter | null): void {
    this.victor = winner && winner.alive ? winner : null;
    this.victorT = 0;
    if (this.victor && this.victor.grounded) this.victor.startTaunt();
  }

  // ===========================================================================================
  // Frame
  // ===========================================================================================

  update(rawDt: number): void {
    const dt = Math.min(rawDt, 1 / 20);
    if (this.paused && this.opts.mode === 'practice') {
      // frozen: keep the camera & HUD alive, no simulation
      this.input.consumeMouse();
      this.hud?.update(0, this);
      this.input.endFrame();
      return;
    }
    // hit-stop slows the simulation, not the camera
    let simDt = dt;
    if (this.hitStopT > 0) {
      this.hitStopT -= dt;
      simDt = dt * 0.06;
    }
    this.time += simDt;

    // countdown / clock
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c !== this.lastCount && c > 0 && c <= 3) {
        this.audio.play('countdown');
        this.hud?.countdown(c);
      }
      this.lastCount = c;
      if (this.countdown <= 0) {
        this.state = 'playing';
        this.audio.play('go');
        this.hud?.countdown(0);
      }
    } else if (this.state === 'playing' && this.opts.mode === 'practice') {
      this.clock -= dt;
      if (this.clock <= 0) {
        this.clock = 0;
        const top = this.spot ? this.spot.leader() : [...this.fighters].sort((a, b) => b.kills - a.kills)[0];
        this.end(top ?? null);
      }
    }

    const canAct = this.state === 'playing' && !this.paused;
    // local input
    this.input.enabled = !this.paused;
    this.controller.update(this.local, this.world);
    if (!canAct) this.freezeIntent(this.local);
    for (const b of this.bots) {
      if (canAct) b.think(simDt, this);
      else this.freezeIntent(b.f);
    }

    // fighters
    for (const f of this.fighters) {
      // Fuori Tempo: an off-beat fighter's own simulation runs at half speed
      const ts = f.simulated && f.offbeatT > 0 ? COMBAT.offbeatScale : 1;
      f.offbeatT = Math.max(0, f.offbeatT - simDt);
      f.punishT = Math.max(0, f.punishT - simDt);
      f.update(simDt * ts, this);
      clearEdges(f.intent);
      if (f.punishT > 0 && f.alive) this.vfx.glitchMark(f, '#ffffff', f.champ.colors[1], simDt);
      // flash / spawn protection blink
      const blink = f.spawnProtect > 0 && Math.floor(this.time * 12) % 2 === 0;
      // stealth (smoke shroud...): hidden from the viewer, see-through for the stealthed player
      const hidden = f.isHiddenFrom(this.local);
      f.visual.root.visible = f.alive ? (!blink || f.spawnProtect <= 0) && !hidden : f.deadTime < 0.55;
      f.setGhost(f === this.local && f.stealthed);
      // cloth follows the body (a shapeshifted champion hides its body pivot)
      for (const o of f.visual.worldObjects) o.visible = f.visual.root.visible && f.visual.pivot.visible;
      if (hidden) for (const h of f.hooks) h.visual.setVisible(false);
      // death shatter + respawn (practice authority)
      if (!f.alive) {
        if (f.deadTime >= 0.55 && f.deadTime - simDt < 0.55) this.vfx.deathBurst(f.pos, f.champ.colors[0], f.champ.colors[1]);
        if (this.opts.mode === 'practice' && f.deadTime >= this.rules.respawnSec && this.state !== 'ended') this.respawn(f);
      }
      if (f.simulated && f.alive && f.pos.y < this.world.killY) {
        this.applyDamage(null, f, 9999, {});
        if (this.opts.mode === 'practice') this.kill(f, null);
      }
      // boost gas trail
      if (f.boosting && f.alive && !hidden) this.vfx.gasTrail(f.nozzleWorld(_v), f.vel, f.champ.colors[0], simDt);
      if (f.alive && !hidden && f.speed > 24) this.vfx.speedStreaks(f.pos, f.vel, f.champ.colors[0], Math.min(1, (f.speed - 24) / 30));
    }

    this.projectiles.update(simDt, this);
    this.spot?.update(dt);

    // camera
    this.cam.update(dt, this.local, this.world);
    if (this.state === 'ended' && this.victor) this.victoryCam(dt, this.victor);
    this.camPos.copy(this.cam.camera.position);
    rightOf(this.cam.yaw, _r);
    this.audio.setListener(this.camPos, _r);
    this.audio.updateLoops(this.local.alive ? this.local.speed : 0, this.local.boosting);

    // weapon afterimages + trails
    for (const [f, g] of this.ghosts) g.update(simDt, f.trailOn && f.alive && f.visual.root.visible, f.alive && f.ulting);
    for (const [f, trails] of this.trails) {
      f.visual.blades.forEach((bl, i) => {
        trails[i].emitting = f.trailOn && f.alive;
        trails[i].update(this.time, bl.base, bl.tip);
      });
    }
    this.vfx.update(simDt);
    this.arena.tick(simDt, this.time);

    // shadow camera follows the local player
    const sun = this.arena.sun;
    sun.target.position.copy(this.local.pos);
    sun.position.copy(this.local.pos).addScaledVector(this.arena.mood.sunDir, 120);

    // post fx
    const fx = this.engine.fx.uniforms;
    const sp = this.local.alive ? THREE.MathUtils.clamp((this.local.speed - 20) / 35, 0, 1) : 0;
    fx.uSpeed.value += (sp - fx.uSpeed.value) * (1 - Math.exp(-dt * 6));
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.8);
    fx.uDamage.value = Math.min(0.75, this.damageFlash + (this.local.alive ? Math.max(0, 0.3 - this.local.hp / this.local.maxHp) * 0.9 : 0));
    fx.uDesat.value += ((this.local.alive ? 0 : 0.75) - fx.uDesat.value) * (1 - Math.exp(-dt * 4));
    this.flash = Math.max(0, this.flash - dt * 3);
    fx.uFlash.value = this.flash * 0.5;
    this.audio.setMusicIntensity(THREE.MathUtils.clamp(0.4 + sp * 0.6, 0, 1));

    this.hud?.update(dt, this);
    this.input.endFrame();
  }

  private victoryCam(dt: number, v: Fighter): void {
    const cam = this.cam.camera;
    if (this.victorT === 0) {
      // remember where the gameplay camera was, relative to the winner
      this.vcStart.set(Math.atan2(cam.position.x - v.pos.x, cam.position.z - v.pos.z), Math.hypot(cam.position.x - v.pos.x, cam.position.z - v.pos.z), cam.position.y - v.pos.y);
    }
    this.victorT += dt;
    // swing around (never through) the winner to a slow orbit in front of them
    const k = Math.min(1, this.victorT * 1.1);
    const e = k * k * (3 - 2 * k);
    const orbit = v.facing + 0.45 - this.victorT * 0.2;
    const a = this.vcStart.x + wrapAngle(orbit - this.vcStart.x) * e;
    const r = THREE.MathUtils.lerp(this.vcStart.y, 2.9, e);
    const y = THREE.MathUtils.lerp(this.vcStart.z, 1.45, e);
    const eye = _r.copy(v.pos).setY(v.pos.y + 1.3);
    const target = _v.set(v.pos.x + Math.sin(a) * r, v.pos.y + y, v.pos.z + Math.cos(a) * r);
    const dir = target.clone().sub(eye);
    const len = dir.length();
    const hit = len > 0.01 ? this.world.raycast(eye, dir.divideScalar(len), len) : null;
    if (hit) target.copy(eye).addScaledVector(dir, Math.max(0.8, hit.distance - 0.3));
    cam.position.copy(target);
    cam.lookAt(v.pos.x, v.pos.y + 1.1, v.pos.z);
  }

  private freezeIntent(f: Fighter): void {
    const it = f.intent;
    it.move.set(0, 0);
    it.jump = it.hookL = it.hookR = it.attack = it.secondary = false;
    clearEdges(it);
  }

  render(): void {
    ToonEnv.outlineScale.value = 1;
    this.engine.render(this.time);
  }

  dispose(): void {
    this.spot?.dispose();
    for (const g of this.ghosts.values()) g.dispose();
    this.ghosts.clear();
    this.arena.dispose();
    this.vfx.clear();
    this.projectiles.clear();
    this.audio.silenceLoops();
  }
}
