import * as THREE from 'three';
import { Beat } from './Beat';
import { Graph } from './audio/graph';
import { impactFor } from './audio/impacts';
import { CATS, DEFAULT_VOLUMES, dbToGain, distanceGain, sliderGain, type Cat } from './audio/mix';
import { MusicPlayer } from './audio/music';
import { renderRoom, ROOMS } from './audio/reverb';
import { SampleBank } from './audio/samples';
import { SFX, type SfxCtx } from './audio/sfx';
import { ARENA_SONG } from './audio/songs';
import { TRIMS } from './audio/trims';

/**
 * Fully synthesized audio: layered SFX (src/core/audio/sfx.ts and kits/) placed in a room that
 * matches the arena, and an adaptive orchestral-rock score (src/core/audio/songs) played by a
 * synthesized band.
 *
 * Signal flow:
 *   voice (trim, distance) -> air low-pass -> pan -> category bus (level, EQ, duck) --+
 *                         \-> room send -> arena reverb -------------------------------+-> sfx (slider) -> glue
 *   2D confirms / UI -> category bus ------------------------------------------------+
 *   score -> MusicPlayer (glue comp, muffle, duck) -> music (slider) ------------------> master (slider) -> safety limiter
 *
 * The mix lives in data: every SFX is loudness-normalised (trims.ts) and belongs to a category
 * (mix.ts) with a level, a distance range, an EQ and a voice budget.
 */

const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** the score's level under the SFX at equal slider positions (combat) */
const MUSIC_DB = -6;
/** menus and results have no SFX to make room for: the score comes up this much there */
const MUSIC_MENU_DB = 3;

interface Voice {
  end: number;
  g: GainNode;
  /** effective level (for the category's voice budget) */
  level: number;
}

interface Source {
  pos: THREE.Vector3;
  champ: string;
  local: boolean;
  id: string;
}

interface CatBus {
  input: GainNode;
  duck: GainNode;
  voices: Voice[];
}

export interface ImpactInfo {
  champ: string | null;
  slot?: string;
  part?: string;
  at: THREE.Vector3;
  amount: number;
  crit?: boolean;
  counter?: boolean;
  blocked?: boolean;
  attackerId?: string;
  victimId: string;
  victimLocal: boolean;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  /** safety limiter and SFX glue (exposed for level diagnostics: their `reduction` in dB) */
  limiter!: DynamicsCompressorNode;
  glue!: DynamicsCompressorNode;
  /** context offset on the score (menus louder than combat) */
  private musicCtx!: GainNode;
  private buses = {} as Record<Cat, CatBus>;
  private roomIn!: GainNode;
  private room!: ConvolverNode;
  private g!: Graph;
  private bank!: SampleBank;
  private listenerPos = new THREE.Vector3();
  private listenerRight = new THREE.Vector3(1, 0, 0);
  private listenerFwd = new THREE.Vector3(0, 0, -1);
  volumes = { ...DEFAULT_VOLUMES };
  private music: MusicPlayer | null = null;
  /** last play per name+source (merge and rate limits) */
  private lastPlay = new Map<string, number>();
  private voices = new Map<string, Voice[]>();
  /** recent plays per name+source, for combo escalation */
  private combos = new Map<string, { t: number; step: number }>();
  private lastImpact = new Map<string, { t: number; w: number }>();
  private lastConfirm = -1;
  private sources: Source[] = [];
  private arena = 'neon_city';
  private battleSong = 'city';
  private loops: Loops | null = null;
  private musicIntensity = 0.5;
  private heat = 0;

  /** must be called from a user gesture */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    Beat.attachClock(() => ctx.currentTime);
    const g = new Graph(ctx);
    this.g = g;
    this.bank = new SampleBank(ctx);
    // master: a safety limiter only (the mix is built to stay under it)
    this.master = g.gain(sliderGain(this.volumes.master));
    const limiter = ctx.createDynamicsCompressor();
    this.limiter = limiter;
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    this.master.connect(limiter).connect(ctx.destination);
    // SFX: a light glue compressor (2:1, slow enough to keep transients)
    this.sfxBus = g.gain(sliderGain(this.volumes.sfx));
    const glue = ctx.createDynamicsCompressor();
    this.glue = glue;
    glue.threshold.value = -15;
    glue.knee.value = 10;
    glue.ratio.value = 2;
    glue.attack.value = 0.012;
    glue.release.value = 0.2;
    this.sfxBus.connect(glue).connect(this.master);
    // one bus per category: level, EQ, a duck stage
    for (const [cat, spec] of Object.entries(CATS) as [Cat, (typeof CATS)[Cat]][]) {
      const duck = g.gain(1, this.sfxBus);
      const pres = g.filter('peaking', 3000, 0.8, duck, spec.presence ?? 0);
      const lp = g.filter('lowpass', spec.lp, 0.6, pres);
      const hp = g.filter('highpass', spec.hp, 0.7, lp);
      const input = g.gain(dbToGain(spec.db), hp);
      this.buses[cat] = { input, duck, voices: [] };
    }
    // arena room
    this.room = ctx.createConvolver();
    this.roomIn = g.gain(1);
    this.roomIn.connect(g.filter('highpass', 250, 0.6)).connect(g.filter('lowpass', 7000, 0.6)).connect(this.room);
    this.room.connect(g.gain(0.7, this.sfxBus));
    this.room.buffer = renderRoom(ctx, ROOMS[this.arena] ?? ROOMS.neon_city);
    this.musicBus = g.gain(sliderGain(this.volumes.music) * dbToGain(MUSIC_DB), this.master);
    this.musicCtx = g.gain(dbToGain(MUSIC_MENU_DB), this.musicBus);
    this.bank.prewarmDrums();
    this.loops = new Loops(g, this.buses.move.input, this.buses.foley.input, (vol) => this.play('footstep', undefined, vol));
  }

  /** slider positions 0..1 (mapped to dB inside) */
  setVolumes(v: Partial<AudioEngine['volumes']>): void {
    Object.assign(this.volumes, v);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(sliderGain(this.volumes.master), t, 0.02);
    this.sfxBus.gain.setTargetAtTime(sliderGain(this.volumes.sfx), t, 0.02);
    this.musicBus.gain.setTargetAtTime(sliderGain(this.volumes.music) * dbToGain(MUSIC_DB), t, 0.02);
  }

  setListener(pos: THREE.Vector3, right: THREE.Vector3): void {
    this.listenerPos.copy(pos);
    this.listenerRight.copy(right);
    this.listenerFwd.crossVectors(UP, right).normalize();
  }

  /** the arena sets the room, the footstep surface and the battle theme */
  setArena(id: string): void {
    this.arena = id;
    this.battleSong = ARENA_SONG[id] ?? 'city';
    if (this.ctx) {
      this.room.buffer = renderRoom(this.ctx, ROOMS[id] ?? ROOMS.neon_city);
      this.ensureMusic().prewarm(this.battleSong);
    }
  }

  /** fighters are registered so sounds played at their position carry their identity */
  registerFighter(pos: THREE.Vector3, champ: string, local: boolean, id = champ): void {
    this.sources = this.sources.filter((s) => s.pos !== pos);
    this.sources.push({ pos, champ, local, id });
  }

  clearFighters(): void {
    this.sources = [];
  }

  private sourceAt(pos: THREE.Vector3 | undefined): Source | null {
    if (!pos) return null;
    let best: Source | null = null;
    let bd = 2.5 * 2.5;
    for (const s of this.sources) {
      if (s.pos === pos) return s;
      const d = s.pos.distanceToSquared(pos);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /**
   * Play a named SFX, optionally positioned in the world. `src` names the champion responsible
   * when the position belongs to someone else (a hit lands on the victim but sounds like the
   * attacker's weapon); `arg` carries per-play data to the recipe.
   */
  play(name: string, pos?: THREE.Vector3, volume = 1, src?: string, arg?: Record<string, unknown>): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const def = SFX[name];
    if (!def) return;
    const spec = CATS[def.cat];
    const bus = this.buses[def.cat];
    const now = ctx.currentTime;
    const source = this.sourceAt(pos);
    const self = !!source?.local;
    // confirms are personal feedback: someone else's perfect timing is not yours to hear
    if (def.cat === 'confirm' && source && !self) return;
    // identical sounds from one source within 25 ms merge; `gap` rate-limits rapid fire and ticks
    const key = `${name}:${source?.id ?? (pos ? 'world' : '2d')}`;
    const last = this.lastPlay.get(key) ?? -1;
    if (now - last < Math.max(0.025, def.gap ?? 0)) return;
    const ui = !!spec.ui || !pos;
    let v = volume * dbToGain((TRIMS[name] ?? 0) + (def.lvl ?? 0));
    let pan = 0;
    let cutoff = 20000;
    let send = 0;
    let delay = 0;
    let near = 1;
    if (!ui && pos) {
      _v.subVectors(pos, this.listenerPos);
      const d = _v.length();
      const [n0, far] = def.range ?? [spec.near, spec.far];
      const dg = self ? 1 : distanceGain(d, n0, far);
      if (dg * volume < 0.004) return;
      v *= dg;
      near = THREE.MathUtils.clamp(1 - d / 45, 0, 1);
      if (d > 0.5) {
        _v.multiplyScalar(1 / d);
        pan = THREE.MathUtils.clamp(_v.dot(this.listenerRight), -1, 1) * 0.75;
        // behind the head: duller, like the ear's own shadow
        if (_v.dot(this.listenerFwd) < -0.3) cutoff *= 0.6;
      }
      // air absorption and a wetter mix with distance
      cutoff *= THREE.MathUtils.clamp(Math.exp(-(d - n0) / 40), 0.15, 1);
      send = spec.rev * (def.rev ?? 1) * (0.08 + THREE.MathUtils.clamp(d / 50, 0, 1) * 0.5);
      // far explosions arrive late (sound travels ~340 m/s)
      if (def.duck && d > 25) delay = Math.min(0.12, d / 340);
      if (self) {
        // your own actions sit closer and drier
        pan *= 0.4;
        send *= 0.6;
      }
    }
    // category voice budget: drop the quietest voice, or this one if it is the quietest
    bus.voices = bus.voices.filter((x) => x.end > now);
    if (bus.voices.length >= spec.voices) {
      let qi = 0;
      for (let i = 1; i < bus.voices.length; i++) if (bus.voices[i].level < bus.voices[qi].level) qi = i;
      if (bus.voices[qi].level > v && !self) return;
      bus.voices[qi].g.gain.setTargetAtTime(0, now, 0.012);
      bus.voices[qi].end = now;
    }
    // per-sound instance cap: steal the oldest
    const list = (this.voices.get(name) ?? []).filter((x) => x.end > now);
    if (list.length >= (def.max ?? 4)) {
      const old = list.shift()!;
      old.g.gain.setTargetAtTime(0, now, 0.012);
    }
    this.lastPlay.set(key, now);
    const t = now + 0.004 + delay;
    const out = this.g.gain(v);
    const voice = { end: t + def.dur, g: out, level: v };
    list.push(voice);
    this.voices.set(name, list);
    bus.voices.push(voice);
    // routing
    if (ui) out.connect(bus.input);
    else {
      const lp = this.g.filter('lowpass', cutoff, 0.5);
      out.connect(lp);
      lp.connect(this.g.pan(pan, bus.input));
      if (send > 0.001) lp.connect(this.g.gain(send, this.roomIn));
    }
    // combo escalation: repeats from the same source within the window
    let step = 0;
    if (def.combo) {
      const ck = `${name}:${source?.id ?? src ?? (ui ? 'ui' : 'world')}`;
      const prev = this.combos.get(ck);
      step = prev && now - prev.t < def.combo ? prev.step + 1 : 0;
      this.combos.set(ck, { t: now, step });
    }
    const vary = def.vary ?? 0.035;
    const c: SfxCtx = {
      g: this.g,
      t,
      out,
      p: 1 + (Math.random() * 2 - 1) * vary,
      v: volume,
      r: Math.random,
      step,
      champ: src ?? source?.champ ?? null,
      self,
      h: this.ensureMusic().harmony,
      arena: this.arena,
      arg,
    };
    def.fn(c);
    // the score makes room for big moments nearby; the busy categories duck under the loudest
    if (def.duck && (ui || near > 0.35)) {
      const k = ui ? 1 : near;
      this.music?.duck(def.duck * k, 0.18, 0.6);
      if (def.duck >= 3) this.duckCats(['basic', 'move', 'foley'], 2 + def.duck * 0.5 * k, 0.1, 0.45);
    }
  }

  /**
   * A hit landed: one world impact in the attacker's ability material (rate-limited for rapid
   * fire and ticks, one per victim per 40 ms), plus the body blow when the local player is hit.
   */
  impact(o: ImpactInfo): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const spec = impactFor(o.champ, o.slot, o.part, o.amount);
    if (spec.gap) {
      const k = `impact:${o.attackerId ?? o.champ}:${o.slot}.${o.part}`;
      if (now - (this.lastPlay.get(k) ?? -1) < spec.gap) return;
      this.lastPlay.set(k, now);
    }
    const w = THREE.MathUtils.clamp(spec.w + (o.amount - 70) / 500 + (o.crit ? 0.1 : 0) + (o.counter ? 0.15 : 0), 0, 1);
    const prev = this.lastImpact.get(o.victimId);
    if (prev && now - prev.t < 0.04 && prev.w >= w) return;
    this.lastImpact.set(o.victimId, { t: now, w });
    const name = o.blocked ? 'hit.block' : `hit.${spec.mat}`;
    if (o.victimLocal) {
      this.play(name, o.at, 0.6, o.champ ?? undefined, { w, crit: o.crit });
      if (!o.blocked) this.play('hurt', undefined, THREE.MathUtils.clamp(o.amount / 150, 0.3, 1));
    } else this.play(name, o.at, 1, o.champ ?? undefined, { w, crit: o.crit });
    this.heat = Math.min(1, this.heat + 0.03 + 0.06 * w);
  }

  /** the local player's own 2D feedback for a hit they landed */
  confirm(kind: 'hit' | 'crit' | 'counter' | 'block' | 'kill', o: { stream?: boolean; momentum?: number } = {}): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (kind !== 'kill') {
      if (now - this.lastConfirm < (o.stream ? 0.2 : 0.06)) return;
      this.lastConfirm = now;
    }
    this.play(`confirm.${kind}`, undefined, o.stream ? 0.55 : 1);
    if (o.momentum && o.momentum > 0 && kind !== 'block') this.play('confirm.momentum', undefined, 0.5 + 0.5 * o.momentum);
  }

  private duckCats(cats: Cat[], db: number, hold: number, release: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const target = dbToGain(-db);
    for (const cat of cats) {
      const p = this.buses[cat].duck.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(target, t + 0.02);
      p.setValueAtTime(target, t + 0.02 + hold);
      p.linearRampToValueAtTime(1, t + 0.02 + hold + release);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // loops: wind, gas jet, cable, footsteps
  // ---------------------------------------------------------------------------------------------

  /** speed in m/s of the listener's fighter, boosting flag, and its movement state */
  updateLoops(speed: number, boosting: boolean, st?: { grounded: boolean; hooked: number; wallRun: boolean; dt: number }): void {
    if (!this.ctx || !this.loops) return;
    this.loops.update(speed, boosting, st);
    // combat heat cools down; it lifts the score's intensity while fights are on
    this.heat = Math.max(0, this.heat - (st?.dt ?? 1 / 60) * 0.08);
    if (this.music) this.music.intensity = Math.max(this.musicIntensity, this.heat * 0.9 + 0.25);
  }

  silenceLoops(): void {
    this.loops?.silence();
  }

  /** @internal */
  get graph(): Graph {
    return this.g;
  }
  get arenaId(): string {
    return this.arena;
  }

  // ---------------------------------------------------------------------------------------------
  // music
  // ---------------------------------------------------------------------------------------------

  private ensureMusic(): MusicPlayer {
    if (!this.music) this.music = new MusicPlayer(this.g, this.bank, this.musicCtx);
    return this.music;
  }

  startMusic(style: 'menu' | 'battle' | 'results'): void {
    if (!this.ctx) return;
    const m = this.ensureMusic();
    m.setMuffle(0);
    this.musicCtx.gain.setTargetAtTime(dbToGain(style === 'battle' ? 0 : MUSIC_MENU_DB), this.ctx.currentTime, 0.6);
    if (style === 'menu') {
      m.intensity = this.musicIntensity = 0.6;
      m.start('menu', 1.5);
      m.prewarm(this.battleSong);
    } else if (style === 'battle') {
      this.musicIntensity = 0.5;
      m.start(this.battleSong, 0.4);
    } else m.start('results', 1.5);
  }

  stopMusic(): void {
    this.music?.stop();
  }

  setMusicIntensity(v: number): void {
    this.musicIntensity = v;
  }

  /** final minute of the match */
  setClimax(on: boolean): void {
    this.music?.setClimax(on);
  }

  /** low health / death muffles the score */
  setDanger(v: number): void {
    this.music?.setMuffle(v);
  }

  /** a musical stinger over the score (the local player's ultimate) */
  stinger(kind: 'power' | 'rise'): void {
    this.music?.stinger(kind);
  }

  /** end of match: fanfare or lament, then the results loop */
  matchEnd(won: boolean): void {
    if (!this.ctx) return;
    const m = this.ensureMusic();
    m.setMuffle(0);
    this.musicCtx.gain.setTargetAtTime(dbToGain(MUSIC_MENU_DB), this.ctx.currentTime, 0.4);
    m.start(won ? 'victory' : 'defeat', 0.02);
    const id = won ? 'victory' : 'defeat';
    window.setTimeout(() => {
      if (this.music?.songId === null || this.music?.songId === id) this.music?.start('results', 2);
    }, won ? 9500 : 12000);
  }
}

// =============================================================================================
// Continuous movement sounds
// =============================================================================================

/**
 * Wind in two bands that open up with speed (a low rumble and a band-passed rush, a faint
 * whistle only near top speed), a gentle cloth flutter, the gas jet while boosting, a singing
 * cable while hooked, and footsteps whose cadence follows the run speed. All of it is a bed:
 * felt, never louder than the action.
 */
export class Loops {
  private rumble: GainNode;
  private rush: GainNode;
  private rushF: BiquadFilterNode;
  private whistle: GainNode;
  private whistleF: BiquadFilterNode;
  private flutter: GainNode;
  private jet: GainNode;
  private jetF: BiquadFilterNode;
  private cable: GainNode;
  private cableOsc: OscillatorNode[] = [];
  private flutterLfo: OscillatorNode;
  private stepT = 0;

  constructor(
    private g: Graph,
    out: AudioNode,
    _foley: AudioNode,
    private step: (vol: number) => void,
  ) {
    const c = g.ctx;
    const loopNoise = (color: 'white' | 'pink' | 'brown', rate = 1) => {
      const s = c.createBufferSource();
      s.buffer = g.noise[color];
      s.loop = true;
      s.playbackRate.value = rate;
      s.start();
      return s;
    };
    // wind
    this.rumble = g.gain(0, out);
    loopNoise('brown', 0.7).connect(g.filter('lowpass', 240, 0.7)).connect(this.rumble);
    this.flutter = g.gain(1, out);
    this.rush = g.gain(0, this.flutter);
    this.rushF = g.filter('bandpass', 600, 0.8);
    loopNoise('pink').connect(this.rushF).connect(this.rush);
    this.whistle = g.gain(0, this.flutter);
    this.whistleF = g.filter('bandpass', 1800, 6);
    loopNoise('pink').connect(this.whistleF).connect(this.whistle);
    // cloth flutter: a gentle amplitude wobble at a jittery 6-14 Hz
    const lfo = c.createOscillator();
    lfo.frequency.value = 9;
    const depth = g.gain(0.12);
    lfo.connect(depth).connect(this.flutter.gain);
    lfo.start();
    this.flutterLfo = lfo;
    // gas jet: a band-passed roar with a low burner under it
    this.jet = g.gain(0, out);
    this.jetF = g.filter('bandpass', 1300, 1);
    loopNoise('pink').connect(this.jetF).connect(this.jet);
    loopNoise('brown', 0.8).connect(g.filter('lowpass', 420, 0.7)).connect(g.gain(0.8, this.jet));
    // cable hum: two slightly detuned triangles through a band-pass (a singing wire)
    this.cable = g.gain(0, out);
    const bp = g.filter('bandpass', 800, 3, this.cable);
    for (const f of [180, 181.7]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(bp);
      o.start();
      this.cableOsc.push(o);
    }
  }

  update(speed: number, boosting: boolean, st?: { grounded: boolean; hooked: number; wallRun: boolean; dt: number }): void {
    const t = this.g.ctx.currentTime;
    const w = THREE.MathUtils.clamp((speed - 8) / 50, 0, 1);
    const airborne = st ? !st.grounded : true;
    const k = airborne ? 1 : 0.5;
    this.rumble.gain.setTargetAtTime(w * 0.4 * k, t, 0.15);
    this.rush.gain.setTargetAtTime(w * w * 0.28 * k, t, 0.12);
    this.rushF.frequency.setTargetAtTime(400 + w * 900, t, 0.15);
    const top = THREE.MathUtils.clamp((speed - 40) / 20, 0, 1);
    this.whistle.gain.setTargetAtTime(top * 0.03 * k, t, 0.2);
    this.whistleF.frequency.setTargetAtTime(1500 + top * 1000 + Math.random() * 150, t, 0.3);
    this.flutterLfo.frequency.setTargetAtTime(6 + w * 8 + Math.random() * 2, t, 0.3);
    // gas
    this.jet.gain.setTargetAtTime(boosting ? 0.05 : 0, t, boosting ? 0.04 : 0.1);
    this.jetF.frequency.setTargetAtTime(1100 + Math.random() * 400, t, 0.08);
    // cable: pitch rises with speed (tension), only while hooked
    const hooked = st ? st.hooked > 0 : false;
    this.cable.gain.setTargetAtTime(hooked ? 0.01 + w * 0.02 : 0, t, hooked ? 0.06 : 0.1);
    const f = 150 + speed * 5;
    this.cableOsc[0].frequency.setTargetAtTime(f, t, 0.08);
    this.cableOsc[1].frequency.setTargetAtTime(f * 1.009, t, 0.08);
    // footsteps
    if (st && (st.grounded || st.wallRun) && speed > 1.5) {
      const rate = st.wallRun ? 7.5 : THREE.MathUtils.clamp(1.6 + speed * 0.16, 1.8, 4.6);
      this.stepT += st.dt * rate;
      if (this.stepT >= 1) {
        this.stepT -= 1;
        this.step(Math.min(1, 0.4 + speed / 25));
      }
    } else this.stepT = 0.6;
  }

  silence(): void {
    const t = this.g.ctx.currentTime;
    for (const g of [this.rumble, this.rush, this.whistle, this.jet, this.cable]) g.gain.setTargetAtTime(0, t, 0.05);
  }
}
