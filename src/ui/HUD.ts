import * as THREE from 'three';
import { COMBAT, MOVE } from '../../shared/constants';
import type { Fighter } from '../game/Fighter';
import { forwardOf, rightOf } from '../game/Fighter';
import type { Match } from '../game/Match';
import { abilityIcon } from './icons';
import type { AbilitySlot } from '../../shared/champions';

const _v = new THREE.Vector3();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

interface FloatNum {
  e: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  life: number;
  vx: number;
  /** running damage number: later hits on the same target add into it */
  target?: Fighter;
  sum?: number;
  /** strongest tags seen so far (crit, momentum speed, counter) */
  crit?: boolean;
  mo?: number;
  counter?: boolean;
  punish?: boolean;
}

export type HitMarkKind = 'hit' | 'crit' | 'mom' | 'counter' | 'kill' | 'block';

export interface MedalShow {
  name: string;
  tier: 1 | 2 | 3;
  sub?: string;
}

/** where recent damage came from (directional indicator around the crosshair) */
interface DmgArc {
  e: HTMLDivElement;
  from: THREE.Vector3;
  t: number;
  life: number;
}

const SLOTS: AbilitySlot[] = ['atk', 'sec', 'abi', 'ult'];

/** Persona-style in-match HUD. Pure DOM; updated every frame with minimal writes. */
export class HUD {
  readonly root: HTMLDivElement;
  private timer: HTMLSpanElement;
  private score: HTMLDivElement;
  private feed: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpGhost: HTMLDivElement;
  private hpNum: HTMLDivElement;
  private gasBar: HTMLDivElement;
  private gasCells: HTMLElement[] = [];
  private cross: HTMLDivElement;
  private hookL: HTMLDivElement;
  private hookR: HTMLDivElement;
  private hitm: HTMLDivElement;
  private chargeRing: HTMLDivElement;
  private chargeFg: SVGCircleElement;
  private abs: Record<AbilitySlot, { root: HTMLDivElement; cd: HTMLDivElement; cdt: HTMLDivElement; last: number; extra?: HTMLDivElement; fill?: HTMLDivElement }>;
  private floatLayer: HTMLDivElement;
  private plateLayer: HTMLDivElement;
  private plates = new Map<string, { e: HTMLDivElement; bar: HTMLElement; lastHp: number }>();
  private floats: FloatNum[] = [];
  private bannerBox: HTMLDivElement;
  private cutin: HTMLDivElement;
  private count: HTMLDivElement;
  private death: HTMLDivElement;
  private deathRs: HTMLDivElement;
  private board: HTMLDivElement;
  private hint: HTMLDivElement;
  private pauseHint: HTMLDivElement;
  private lastHp = -1;
  private lastGas = -1;
  private lastTimer = '';
  private lastScore = '';
  private hookPreviewT = 0;
  private canHook = false;
  private counterInd: HTMLDivElement;
  private counterBar: HTMLElement;
  private hookedWarn: HTMLDivElement;
  private wasHooked = false;
  private arcs: DmgArc[] = [];
  private medalBox: HTMLDivElement;
  private chipBox: HTMLDivElement;
  private missAt = new Map<string, number>();
  private clock = 0;
  /** objective / mode panel under the timer */
  readonly modeBox: HTMLDivElement;
  private camera: THREE.PerspectiveCamera | null = null;
  private w = 1;
  private h = 1;

  constructor(readonly container: HTMLElement, readonly local: Fighter) {
    this.root = el('div', 'hud');
    const c = local.champ;
    this.root.style.setProperty('--accent', c.colors[0]);
    this.root.style.setProperty('--accent2', c.colors[1]);

    // top
    const top = el('div', 'hud-top');
    const tbox = el('div', 'hud-timer');
    this.timer = el('span');
    tbox.append(this.timer);
    this.score = el('div', 'hud-score');
    top.append(tbox, this.score);
    this.feed = el('div', 'hud-feed');

    // player panel
    const player = el('div', 'hud-player');
    const name = el('div', 'hud-name', `<span class="champ">${c.name}</span><span class="title">${c.title.toUpperCase()}</span>`);
    const hp = el('div', 'hp-wrap');
    this.hpGhost = el('div', 'hp-ghost');
    this.hpFill = el('div', 'hp-fill');
    this.hpNum = el('div', 'hp-num');
    hp.append(this.hpGhost, this.hpFill, el('div', 'hp-ticks'), this.hpNum);
    const gasRow = el('div', 'gas-row', '<span class="gas-label">GAS</span>');
    this.gasBar = el('div', 'gas-bar');
    for (let i = 0; i < 20; i++) {
      const cell = el('i');
      this.gasCells.push(cell);
      this.gasBar.append(cell);
    }
    gasRow.append(this.gasBar);
    player.append(name, hp, gasRow);

    // crosshair
    const crossWrap = el('div', 'hud-cross');
    this.cross = el('div', 'cross', `<svg viewBox="-22 -22 44 44"><polygon class="tick" points="0,-20 -3,-11 3,-11"/><polygon class="tick" points="0,20 -3,11 3,11"/><polygon class="tick" points="-20,0 -11,-3 -11,3"/><polygon class="tick" points="20,0 11,-3 11,3"/><rect class="dot" x="-1.8" y="-1.8" width="3.6" height="3.6" transform="rotate(45)"/></svg>`);
    this.hookL = el('div', 'hook-ind l', '◀');
    this.hookR = el('div', 'hook-ind r', '▶');
    this.hitm = el('div', 'hitmarker', '<svg viewBox="-18 -18 36 36"><line x1="-14" y1="-14" x2="-6" y2="-6"/><line x1="14" y1="-14" x2="6" y2="-6"/><line x1="-14" y1="14" x2="-6" y2="6"/><line x1="14" y1="14" x2="6" y2="6"/></svg>');
    this.chargeRing = el('div', 'charge-ring', '<svg viewBox="0 0 68 68"><circle class="bg" cx="34" cy="34" r="30"/><circle class="fg" cx="34" cy="34" r="30" stroke-dasharray="188.5" stroke-dashoffset="188.5"/></svg>');
    this.chargeFg = this.chargeRing.querySelector('.fg') as SVGCircleElement;
    // counter window after a perfect dodge / parry
    this.counterInd = el('div', 'counter-ind', '<span>COUNTER</span><b><i></i></b>');
    this.counterBar = this.counterInd.querySelector('i') as HTMLElement;
    this.hookedWarn = el('div', 'hooked-warn', 'AGGANCIATO! <b>SHIFT</b>');
    crossWrap.append(this.cross, this.hookL, this.hookR, this.hitm, this.chargeRing, this.counterInd, this.hookedWarn);
    for (let i = 0; i < 4; i++) {
      const a = el('div', 'dmg-arc', '<svg viewBox="-50 -50 100 100"><path d="M -21 -43 A 48 48 0 0 1 21 -43"/></svg>');
      crossWrap.append(a);
      this.arcs.push({ e: a, from: new THREE.Vector3(), t: 1, life: 1 });
    }

    // abilities
    const abWrap = el('div', 'hud-abilities');
    this.abs = {} as HUD['abs'];
    for (const slot of SLOTS) {
      const a = c.abilities[slot];
      const card = el('div', `ab ${slot === 'ult' ? 'ult' : ''}`);
      const inner = el('div', 'inner');
      inner.innerHTML = `<div class="icon" style="color:${slot === 'ult' ? c.colors[0] : '#fff'}">${abilityIcon(c.id, slot)}</div><div class="name">${a.name.toUpperCase()}</div>`;
      const fill = slot === 'ult' ? el('div', 'fillult') : undefined;
      const extra = slot === 'ult' ? el('div', 'pct', '0%') : undefined;
      if (extra) inner.append(extra);
      const cd = el('div', 'cd');
      cd.style.transform = 'scaleY(0)';
      const cdt = el('div', 'cdt');
      if (fill) card.append(fill);
      card.append(inner, cd, cdt, el('div', 'key', a.key));
      abWrap.append(card);
      this.abs[slot] = { root: card, cd, cdt, last: 0, extra, fill };
    }

    this.floatLayer = el('div', 'hud-float');
    this.plateLayer = el('div', 'hud-plates');
    this.medalBox = el('div', 'hud-medals');
    this.chipBox = el('div', 'ult-chips');
    this.modeBox = el('div', 'hud-mode');
    abWrap.append(this.chipBox);
    this.bannerBox = el('div', 'hud-banner');
    this.cutin = el('div', 'hud-cutin');
    this.count = el('div', 'hud-count');
    this.death = el('div', 'hud-death', '<div class="ko">KNOCKED OUT</div><div class="by"></div><div class="rs"></div>');
    this.deathRs = this.death.querySelector('.rs') as HTMLDivElement;
    this.board = el('div', 'hud-board');
    this.hint = el('div', 'hud-hint', '<b>Q / E</b> rampini &nbsp;·&nbsp; <b>SPAZIO</b> gas &nbsp;·&nbsp; <b>SHIFT</b> scatto &nbsp;·&nbsp; <b>LMB/RMB/F/R</b> abilità');
    this.pauseHint = el('div', 'pause-hint', 'CLICCA PER COMBATTERE');
    top.append(this.modeBox);
    this.root.append(this.plateLayer, this.floatLayer, top, this.feed, player, crossWrap, abWrap, this.medalBox, this.bannerBox, this.cutin, this.count, this.death, this.board, this.hint, this.pauseHint);
    container.append(this.root);
    window.setTimeout(() => this.hint.classList.add('off'), 9000);
  }

  dispose(): void {
    this.root.remove();
  }

  setPauseHint(on: boolean): void {
    this.pauseHint.classList.toggle('on', on);
  }

  // ===========================================================================================
  // per-frame
  // ===========================================================================================

  update(dt: number, m: Match): void {
    const f = this.local;
    this.camera = m.cam.camera;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    // timer & score
    const secs = Math.max(0, Math.ceil(m.clock));
    const ts = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    if (ts !== this.lastTimer) {
      this.timer.textContent = ts;
      this.lastTimer = ts;
    }
    let sc: string;
    if (m.spot) {
      // RIFLETTORE: the panel under the timer carries the points; keep the kill count small
      sc = `<div>KO <b>${f.kills}</b> &nbsp;·&nbsp; PUNTI <b>${m.spot.score(f)}</b></div>`;
    } else {
      const sorted = [...m.fighters].sort((a, b) => b.kills - a.kills);
      const leader = sorted[0];
      sc = `<div>TU <b>${f.kills}</b> &nbsp;·&nbsp; ${leader && leader !== f ? `${esc(leader.name)} <b>${leader.kills}</b>` : 'IN TESTA'} &nbsp;/ ${m.rules.killsToWin}</div>`;
    }
    if (sc !== this.lastScore) {
      this.score.innerHTML = sc;
      this.lastScore = sc;
    }
    // hp
    const hp = Math.max(0, Math.round(f.hp));
    if (hp !== this.lastHp) {
      const k = hp / f.maxHp;
      this.hpFill.style.transform = `scaleX(${k})`;
      this.hpGhost.style.transform = `scaleX(${k})`;
      this.hpFill.classList.toggle('low', k < 0.3);
      this.hpNum.textContent = String(hp);
      this.lastHp = hp;
    }
    // gas
    const gas = Math.round((f.gas / MOVE.gasMax) * 20);
    if (gas !== this.lastGas) {
      this.gasCells.forEach((c, i) => c.classList.toggle('on', i < gas));
      this.gasBar.classList.toggle('empty', gas === 0);
      this.lastGas = gas;
    }
    this.gasBar.classList.toggle('boost', f.boosting);
    // hooks
    this.hookPreviewT -= dt;
    if (this.hookPreviewT <= 0) {
      this.hookPreviewT = 0.1;
      this.canHook = f.alive && f.previewHook(m);
    }
    for (const [i, ind] of [this.hookL, this.hookR].entries()) {
      const s = f.hooks[i].state;
      ind.classList.toggle('att', s === 'attached');
      ind.classList.toggle('fly', s === 'flying');
      ind.classList.toggle('can', s === 'idle' && this.canHook);
    }
    // crosshair on enemy
    const kit = f.kit;
    let onEnemy = false;
    if (kit && 'findTarget' in kit) {
      const t = (kit as unknown as { findTarget: (f: Fighter, m: Match, d: number, c: number) => Fighter | null }).findTarget(f, m, 120, 2.2);
      onEnemy = !!t;
    }
    this.cross.classList.toggle('enemy', onEnemy);
    // charge ring (perfect-release window / overcharge exposed by the kit)
    const charge = kit?.charge ?? 0;
    this.chargeRing.classList.toggle('on', charge > 0.01);
    this.chargeFg.style.strokeDashoffset = String(188.5 * (1 - charge));
    const cfx = kit?.chargeFx ?? 0;
    this.chargeRing.classList.toggle('perfect', cfx === 1);
    this.chargeRing.classList.toggle('over', cfx === 2);
    // counter window
    const ctr = f.alive && f.counterT > 0;
    this.counterInd.classList.toggle('on', ctr);
    if (ctr) this.counterBar.style.transform = `scaleX(${Math.min(1, f.counterT / COMBAT.counterSec)})`;
    // an enemy rope is on you
    let hooked = false;
    if (f.alive) {
      for (const o of m.fighters) {
        if (o === f || !o.alive || (o.team !== 0 && o.team === f.team)) continue;
        if (o.hooks.some((hk) => hk.targetId === f.id && (hk.state === 'attached' || hk.state === 'flying'))) hooked = true;
      }
    }
    if (hooked && !this.wasHooked) m.audio.play('alarm', undefined, 0.8);
    this.wasHooked = hooked;
    this.hookedWarn.classList.toggle('on', hooked);
    this.updateArcs(dt, m);
    // abilities
    if (kit) {
      const cds = kit.cooldowns();
      for (const slot of SLOTS) {
        const a = this.abs[slot];
        if (slot === 'ult') {
          const pct = Math.floor(f.ult * 100);
          if (a.extra) a.extra.textContent = pct >= 100 ? 'READY' : `${pct}%`;
          if (a.fill) a.fill.style.transform = `scaleY(${f.ult})`;
          a.root.classList.toggle('ready', f.ult >= 1);
          continue;
        }
        const total = f.champ.abilities[slot].cooldown;
        const rem = cds[slot];
        const k = total > 0 ? Math.min(1, rem / total) : 0;
        a.cd.style.transform = `scaleY(${k})`;
        const txt = rem > 0.05 && total >= 1 ? rem.toFixed(rem < 1 ? 1 : 0) : '';
        if (a.cdt.textContent !== txt) a.cdt.textContent = txt;
        if (a.last > 0 && rem <= 0 && total >= 1) {
          a.root.classList.remove('ready-flash');
          void a.root.offsetWidth;
          a.root.classList.add('ready-flash');
        }
        a.last = rem;
      }
    }
    // death screen countdown
    if (!f.alive) {
      const r = Math.max(0, m.rules.respawnSec - f.deadTime);
      this.deathRs.textContent = r > 0 ? `RIENTRO IN ${r.toFixed(1)}s` : '';
    } else if (this.death.classList.contains('on')) this.death.classList.remove('on');
    // scoreboard
    const showBoard = m.input.held('scoreboard') || m.state === 'ended';
    this.board.classList.toggle('on', showBoard);
    if (showBoard) this.renderBoard(m);

    this.updatePlates(m);
    this.updateFloats(dt);
    this.clock += dt;
  }

  /** red arcs around the crosshair pointing at whoever hurt you, following the camera */
  private updateArcs(dt: number, m: Match): void {
    const yaw = m.cam.yaw;
    forwardOf(yaw, _v);
    const fx = _v.x;
    const fz = _v.z;
    rightOf(yaw, _v);
    for (const a of this.arcs) {
      if (a.t >= a.life) continue;
      a.t += dt;
      const k = a.t / a.life;
      if (k >= 1) {
        a.e.style.opacity = '0';
        continue;
      }
      const dx = a.from.x - this.local.pos.x;
      const dz = a.from.z - this.local.pos.z;
      const ang = Math.atan2(dx * _v.x + dz * _v.z, dx * fx + dz * fz);
      a.e.style.transform = `rotate(${ang}rad)`;
      a.e.style.opacity = String((1 - k) * Number(a.e.dataset.w ?? 1));
    }
  }

  private renderBoard(m: Match): void {
    const spot = m.spot;
    const rows = [...m.fighters]
      .sort((a, b) => (spot ? spot.score(b) - spot.score(a) : 0) || b.kills - a.kills || a.deaths - b.deaths)
      .map((p) => `<tr class="${p === this.local ? 'me' : ''}"><td><span class="cdot" style="background:${p.champ.colors[0]}"></span>${esc(p.name)}</td><td>${p.champ.name}</td>${spot ? `<td>${spot.score(p)}</td>` : ''}<td>${p.kills}</td><td>${p.deaths}</td><td>${Math.round(p.damageDealt)}</td></tr>`)
      .join('');
    const html = `<h2>CLASSIFICA</h2><table><tr><th>GIOCATORE</th><th>CAMPIONE</th>${spot ? '<th>PUNTI</th>' : ''}<th>K</th><th>D</th><th>DANNI</th></tr>${rows}</table>`;
    if (this.board.innerHTML !== html) this.board.innerHTML = html;
  }

  private project(p: THREE.Vector3): { x: number; y: number; visible: boolean; dist: number } {
    const cam = this.camera!;
    _v.copy(p).project(cam);
    const visible = _v.z < 1 && _v.z > -1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2;
    return { x: (_v.x * 0.5 + 0.5) * this.w, y: (-_v.y * 0.5 + 0.5) * this.h, visible, dist: cam.position.distanceTo(p) };
  }

  private updatePlates(m: Match): void {
    const seen = new Set<string>();
    for (const f of m.fighters) {
      if (f === this.local || !f.alive) continue;
      const head = f.head(new THREE.Vector3());
      head.y += 0.55;
      const pr = this.project(head);
      if (!pr.visible || pr.dist > 90) continue;
      seen.add(f.id);
      let p = this.plates.get(f.id);
      if (!p) {
        const e = el('div', 'plate', `<div class="pn">${esc(f.name)}</div><div class="pb"><i></i></div>`);
        e.style.setProperty('--pc', f.champ.colors[0]);
        this.plateLayer.append(e);
        p = { e, bar: e.querySelector('i') as HTMLElement, lastHp: -1 };
        this.plates.set(f.id, p);
      }
      const s = THREE.MathUtils.clamp(14 / pr.dist, 0.55, 1.1);
      p.e.style.transform = `translate(${pr.x}px, ${pr.y}px) translate(-50%, -100%) scale(${s})`;
      p.e.style.display = '';
      if (p.lastHp !== f.hp) {
        p.bar.style.transform = `scaleX(${f.hp / f.maxHp})`;
        p.lastHp = f.hp;
      }
    }
    for (const [id, p] of this.plates) {
      if (!seen.has(id)) {
        if (!m.getFighter(id)) {
          p.e.remove();
          this.plates.delete(id);
        } else p.e.style.display = 'none';
      }
    }
  }

  private updateFloats(dt: number): void {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const n = this.floats[i];
      n.t += dt;
      const k = n.t / n.life;
      if (k >= 1 || !this.camera) {
        n.e.remove();
        this.floats.splice(i, 1);
        continue;
      }
      const pr = this.project(n.pos);
      if (!pr.visible) {
        n.e.style.opacity = '0';
        continue;
      }
      const rise = -60 * Math.sqrt(k) - 10;
      const pop = k < 0.12 ? 1.6 - (k / 0.12) * 0.6 : 1;
      const alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      n.e.style.opacity = String(alpha);
      n.e.style.transform = `translate(${pr.x + n.vx * k * 60}px, ${pr.y + rise}px) translate(-50%, -50%) scale(${pop}) rotate(-6deg)`;
    }
  }

  // ===========================================================================================
  // events
  // ===========================================================================================

  damageNumber(f: Fighter, n: number, crit: boolean, blocked: boolean, mine: boolean, mo = 0, counter = false, punish = false): void {
    if (!mine && f !== this.local) return;
    // a number still rising over this target sums the new hit (fast multi-hits stay readable)
    if (mine && f !== this.local && !blocked) {
      const run = this.floats.find((x) => x.target === f && x.t < 0.7);
      if (run) {
        run.sum = (run.sum ?? 0) + n;
        run.crit = run.crit || crit;
        run.mo = Math.max(run.mo ?? 0, mo);
        run.counter = run.counter || counter;
        run.punish = run.punish || punish;
        this.styleNumber(run.e, run.sum, !!run.crit, false, 'mine', run.mo ?? 0, !!run.counter, !!run.punish);
        run.t = Math.min(run.t, 0.04);
        run.life = Math.min(1.6, run.life + 0.25);
        return;
      }
    }
    const e = el('div');
    this.styleNumber(e, n, crit, blocked, f === this.local ? 'taken' : 'mine', mo, counter, punish);
    this.floatLayer.append(e);
    const pos = f.head(new THREE.Vector3());
    pos.x += (Math.random() - 0.5) * 0.6;
    this.floats.push({ e, pos, t: 0, life: crit || mo || counter || punish ? 1.1 : 0.8, vx: (Math.random() - 0.5) * 1.5, target: mine && f !== this.local && !blocked ? f : undefined, sum: n, crit, mo, counter, punish });
    if (this.floats.length > 40) {
      const old = this.floats.shift()!;
      old.e.remove();
    }
  }

  private styleNumber(e: HTMLDivElement, n: number, crit: boolean, blocked: boolean, who: string, mo: number, counter: boolean, punish = false): void {
    const momentum = mo >= COMBAT.momentumMinSpeed;
    e.className = `dmg ${who} ${crit ? 'crit' : ''} ${blocked ? 'blocked' : ''} ${momentum ? 'mom' : ''} ${counter ? 'counter' : ''} ${punish && !counter ? 'punish' : ''}`;
    e.textContent = blocked ? `${n} BLOCK` : String(n);
    if (counter) e.dataset.tag = 'COUNTER';
    else if (punish) e.dataset.tag = momentum ? `PUNISH · ${Math.round(mo)} M/S` : 'PUNISH';
    else if (momentum) e.dataset.tag = `${Math.round(mo)} M/S`;
    else if (crit) e.dataset.tag = 'CRITICAL';
    else delete e.dataset.tag;
  }

  floatText(f: Fighter, text: string, kind: string): void {
    // misses can come in streams (beams, auto-fire): one label per target at a time
    if (kind === 'miss') {
      const last = this.missAt.get(f.id) ?? -10;
      if (this.clock - last < 0.45) return;
      this.missAt.set(f.id, this.clock);
    }
    const e = el('div', `dmg ${kind}`);
    e.textContent = text;
    this.floatLayer.append(e);
    this.floats.push({ e, pos: f.head(new THREE.Vector3()), t: 0, life: 1, vx: 0 });
  }

  hitMarker(kind: HitMarkKind = 'hit'): void {
    this.hitm.classList.remove('show', 'crit', 'mom', 'counter', 'kill', 'block');
    void this.hitm.offsetWidth;
    if (kind !== 'hit') this.hitm.classList.add(kind);
    this.hitm.classList.add('show');
  }

  /** damage taken from `from`: a red arc on the crosshair ring points at it */
  damageFrom(from: THREE.Vector3, amount: number): void {
    const a = this.arcs.reduce((best, x) => (x.t / x.life > best.t / best.life ? x : best), this.arcs[0]);
    a.from.copy(from);
    a.t = 0;
    a.life = 1.2;
    a.e.dataset.w = String(Math.min(1, 0.35 + amount / 120));
    a.e.classList.toggle('big', amount >= 150);
  }

  /** a stack of Persona-style medal labels next to the crosshair (max 3 at a time) */
  medals(list: MedalShow[]): void {
    list.slice(0, 3).forEach((md, i) => {
      const e = el('div', `medal t${md.tier}`, `<b>${esc(md.name)}</b>${md.sub ? `<span>${esc(md.sub)}</span>` : ''}`);
      e.style.animationDelay = `${i * 0.18}s`;
      this.medalBox.append(e);
      while (this.medalBox.children.length > 3) this.medalBox.firstElementChild?.remove();
      window.setTimeout(() => e.remove(), 2000 + i * 180);
    });
  }

  /** ultimate charge gained from a play ("+8% TAKEDOWN"), stacked over the ultimate card */
  ultGain(label: string, frac: number): void {
    const e = el('div', 'chip', `+${Math.round(frac * 100)}% ${esc(label)}`);
    this.chipBox.append(e);
    while (this.chipBox.children.length > 3) this.chipBox.firstElementChild?.remove();
    window.setTimeout(() => e.remove(), 1300);
  }

  /** global announcement in the kill feed (streaks, shutdowns, first blood) */
  feedNote(html: string): void {
    const item = el('div', 'feed-item note', html);
    this.feed.prepend(item);
    while (this.feed.children.length > 6) this.feed.lastElementChild?.remove();
    window.setTimeout(() => item.classList.add('fade'), 4500);
    window.setTimeout(() => item.remove(), 5000);
  }

  banner(text: string, kind: string): void {
    const b = el('div', `banner ${kind}`);
    b.textContent = text;
    this.bannerBox.innerHTML = '';
    this.bannerBox.append(b);
    window.setTimeout(() => b.remove(), 1500);
  }

  countdown(n: number): void {
    this.count.innerHTML = n > 0 ? `<div class="n">${n}</div>` : '<div class="go">SHOWTIME!</div>';
    window.setTimeout(() => {
      if (n === 0) this.count.innerHTML = '';
    }, 1300);
  }

  killFeed(killer: Fighter | null, victim: Fighter): void {
    const me = killer === this.local || victim === this.local;
    const item = el('div', `feed-item ${me ? 'me' : ''}`, killer && killer !== victim
      ? `<span style="color:${killer.champ.colors[0]}">${esc(killer.name)}</span><span class="slash">✕</span><span>${esc(victim.name)}</span>`
      : `<span class="slash">✕</span><span>${esc(victim.name)}</span>`);
    this.feed.prepend(item);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    window.setTimeout(() => item.classList.add('fade'), 5000);
    window.setTimeout(() => item.remove(), 5500);
  }

  killCutIn(me: Fighter, victim: Fighter): void {
    const c = el('div', 'cutin', `<div class="band"></div><div class="stripe a"></div><div class="stripe b"></div><div class="txt"><div class="big">TAKE DOWN!</div><div class="sub">${esc(me.champ.name)} ✕ <b>${esc(victim.name)}</b></div></div>`);
    this.cutin.innerHTML = '';
    this.cutin.append(c);
    window.setTimeout(() => c.remove(), 1700);
  }

  /**
   * Persona-style ultimate cut-in: a skewed band slams across the screen with the champion's
   * eyes and the move name. Enemy ultimates get a smaller warning strip at the top.
   */
  ultCutIn(f: Fighter, move: string, portrait: string | null, enemy: boolean): void {
    const [c1, c2] = f.champ.colors;
    const eyes = portrait ? `<div class="eyes" style="background-image:url(${portrait})"></div>` : '';
    const c = el('div', `ucut ${enemy ? 'enemy' : 'me'}`, `<div class="band" style="--c1:${c1};--c2:${c2}">${eyes}<div class="shade"></div></div><div class="txt"><div class="who">${esc(f.champ.name)}${enemy ? ` · <span>${esc(f.name)}</span>` : ''}</div><div class="move">${esc(move.toUpperCase())}</div></div>`);
    if (!enemy) this.cutin.innerHTML = '';
    else this.cutin.querySelectorAll('.ucut.enemy').forEach((n) => n.remove());
    this.cutin.append(c);
    window.setTimeout(() => c.remove(), enemy ? 1600 : 1250);
  }

  deathScreen(killer: Fighter | null): void {
    const by = this.death.querySelector('.by') as HTMLDivElement;
    by.innerHTML = killer && killer !== this.local ? `ABBATTUTO DA <b>${esc(killer.name)}</b> · ${killer.champ.name}` : 'FUORI DALL\'ARENA';
    this.death.classList.add('on');
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
