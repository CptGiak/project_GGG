import * as THREE from 'three';
import { Beat } from './Beat';
import { Graph } from './audio/graph';
import { MusicPlayer } from './audio/music';
import { renderRoom, ROOMS } from './audio/reverb';
import { SampleBank } from './audio/samples';
import { SFX, type SfxCtx } from './audio/sfx';
import { ARENA_SONG } from './audio/songs';

/**
 * Fully synthesized audio: layered SFX (src/core/audio/sfx.ts) placed in a room that matches the
 * arena, and an adaptive orchestral-rock score (src/core/audio/songs) played by a synthesized band.
 *
 * Signal flow:
 *   world SFX -> distance lowpass -> pan -> worldDuck -> sfxBus --+
 *                              \-> room send -> arena reverb ----+
 *   2D confirms / UI ------------------------------> uiBus ------+-> master -> limiter -> out
 *   score -> MusicPlayer (glue comp, muffle, duck) -> musicBus --+
 */

const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface Voice {
  end: number;
  g: GainNode;
}

interface Source {
  pos: THREE.Vector3;
  champ: string;
  local: boolean;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  private uiBus!: GainNode;
  private worldDuck!: GainNode;
  private roomIn!: GainNode;
  private room!: ConvolverNode;
  private g!: Graph;
  private bank!: SampleBank;
  private listenerPos = new THREE.Vector3();
  private listenerRight = new THREE.Vector3(1, 0, 0);
  private listenerFwd = new THREE.Vector3(0, 0, -1);
  volumes = { master: 0.8, sfx: 0.9, music: 0.45 };
  private music: MusicPlayer | null = null;
  private lastPlay = new Map<string, number>();
  private voices = new Map<string, Voice[]>();
  /** recent plays per name+source, for combo escalation */
  private combos = new Map<string, { t: number; step: number }>();
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
    // master: a fast, high-ratio limiter so stacked layers never clip
    this.master = g.gain(this.volumes.master);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 2;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.master.connect(limiter).connect(ctx.destination);
    // SFX: a gentle glue compressor, then the world duck (big moments push the rest down)
    this.sfxBus = g.gain(this.volumes.sfx);
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.knee.value = 6;
    glue.ratio.value = 3;
    glue.attack.value = 0.004;
    glue.release.value = 0.15;
    this.sfxBus.connect(glue).connect(this.master);
    this.worldDuck = g.gain(1, this.sfxBus);
    this.uiBus = g.gain(1, this.sfxBus);
    // arena room
    this.room = ctx.createConvolver();
    this.roomIn = g.gain(1);
    this.roomIn.connect(g.filter('highpass', 220, 0.6)).connect(this.room);
    this.room.connect(g.gain(0.8, this.sfxBus));
    this.room.buffer = renderRoom(ctx, ROOMS[this.arena] ?? ROOMS.neon_city);
    this.musicBus = g.gain(this.volumes.music, this.master);
    this.bank.prewarmDrums();
    this.loops = new Loops(this);
  }

  setVolumes(v: Partial<AudioEngine['volumes']>): void {
    Object.assign(this.volumes, v);
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfxBus.gain.value = this.volumes.sfx;
    this.musicBus.gain.value = this.volumes.music;
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

  /** fighters are registered so sounds played at their position carry their sonic signature */
  registerFighter(pos: THREE.Vector3, champ: string, local: boolean): void {
    this.sources = this.sources.filter((s) => s.pos !== pos);
    this.sources.push({ pos, champ, local });
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
   * attacker's weapon).
   */
  play(name: string, pos?: THREE.Vector3, volume = 1, src?: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const def = SFX[name];
    if (!def) return;
    const now = ctx.currentTime;
    // identical sounds within 25 ms merge into one
    if (now - (this.lastPlay.get(name) ?? -1) < 0.025) return;
    this.lastPlay.set(name, now);
    const source = this.sourceAt(pos);
    const self = !!source?.local;
    let v = volume;
    let pan = 0;
    let cutoff = 20000;
    let send = 0.12;
    let delay = 0;
    let near = 1;
    const ui = def.ui || !pos;
    if (!ui && pos) {
      _v.subVectors(pos, this.listenerPos);
      const d = _v.length();
      v *= 1 / (1 + d * 0.045);
      if (v < 0.02) return;
      near = THREE.MathUtils.clamp(1 - d / 45, 0, 1);
      if (d > 0.5) {
        _v.multiplyScalar(1 / d);
        pan = THREE.MathUtils.clamp(_v.dot(this.listenerRight), -1, 1) * 0.75;
        // behind the head: duller, like the ear's own shadow
        if (_v.dot(this.listenerFwd) < -0.3) cutoff *= 0.55;
      }
      // air absorption and a wetter mix with distance
      cutoff *= THREE.MathUtils.clamp(Math.exp(-(d - 5) / 38), 0.19, 1);
      send = 0.1 + THREE.MathUtils.clamp(d / 55, 0, 1) * 0.55;
      // far explosions arrive late (sound travels ~340 m/s)
      if (def.duck && d > 25) delay = Math.min(0.12, d / 340);
    }
    if (self && !ui) {
      // your own actions sit closer and drier
      pan *= 0.4;
      send *= 0.6;
    }
    // voice limiting: steal the oldest instance of the same sound
    const list = (this.voices.get(name) ?? []).filter((x) => x.end > now);
    if (list.length >= (def.max ?? 4)) {
      const old = list.shift()!;
      old.g.gain.setTargetAtTime(0, now, 0.012);
    }
    const t = now + 0.004 + delay;
    const out = this.g.gain(v);
    list.push({ end: t + def.dur, g: out });
    this.voices.set(name, list);
    // routing
    if (ui) out.connect(this.uiBus);
    else {
      const lp = this.g.filter('lowpass', cutoff, 0.5);
      out.connect(lp);
      const p = this.g.pan(pan, this.worldDuck);
      lp.connect(p);
      lp.connect(this.g.gain(send * (def.rev ?? 1), this.roomIn));
    }
    // combo escalation: repeats from the same source within the window
    let step = 0;
    if (def.combo) {
      const key = `${name}:${source?.champ ?? src ?? (ui ? 'ui' : 'world')}`;
      const prev = this.combos.get(key);
      step = prev && now - prev.t < def.combo ? prev.step + 1 : 0;
      this.combos.set(key, { t: now, step });
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
    };
    def.fn(c);
    // the score makes room for big moments nearby; the world ducks under the loudest events
    if (def.duck && near > 0.35) {
      this.music?.duck(def.duck * near, 0.18, 0.6);
      if (def.duck >= 4) this.duckWorld(2.5 * near, 0.08, 0.4);
    }
    if (name === 'hit' || name === 'hitHeavy' || name === 'explosion' || name === 'slam') this.heat = Math.min(1, this.heat + (name === 'hit' ? 0.04 : 0.12) * near);
  }

  private duckWorld(db: number, hold: number, release: number): void {
    if (!this.ctx) return;
    const p = this.worldDuck.gain;
    const t = this.ctx.currentTime;
    const target = Math.pow(10, -db / 20);
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(target, t + 0.02);
    p.setValueAtTime(target, t + 0.02 + hold);
    p.linearRampToValueAtTime(1, t + 0.02 + hold + release);
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

  /** @internal used by the loops */
  get graph(): Graph {
    return this.g;
  }
  get sfxInput(): AudioNode {
    return this.worldDuck;
  }
  get roomInput(): AudioNode {
    return this.roomIn;
  }
  get arenaId(): string {
    return this.arena;
  }

  // ---------------------------------------------------------------------------------------------
  // music
  // ---------------------------------------------------------------------------------------------

  private ensureMusic(): MusicPlayer {
    if (!this.music) this.music = new MusicPlayer(this.g, this.bank, this.musicBus);
    return this.music;
  }

  startMusic(style: 'menu' | 'battle' | 'results'): void {
    if (!this.ctx) return;
    const m = this.ensureMusic();
    m.setMuffle(0);
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
 * Wind in three bands that open up with speed (rumble, rush, and a high whistle only near top
 * speed) with cloth flutter, the gas jet while boosting, a singing cable while hooked, and
 * footsteps whose cadence follows the run speed.
 */
class Loops {
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

  constructor(private a: AudioEngine) {
    const g = a.graph;
    const c = g.ctx;
    const out = a.sfxInput;
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
    loopNoise('brown', 0.7).connect(g.filter('lowpass', 260, 0.7)).connect(this.rumble);
    this.flutter = g.gain(1, out);
    this.rush = g.gain(0, this.flutter);
    this.rushF = g.filter('bandpass', 600, 0.7);
    loopNoise('pink').connect(this.rushF).connect(this.rush);
    this.whistle = g.gain(0, this.flutter);
    this.whistleF = g.filter('bandpass', 3000, 9);
    loopNoise('white').connect(this.whistleF).connect(this.whistle);
    // cloth flutter: amplitude modulation at a jittery 8-25 Hz
    const lfo = c.createOscillator();
    lfo.frequency.value = 13;
    const depth = g.gain(0.25);
    lfo.connect(depth).connect(this.flutter.gain);
    lfo.start();
    this.flutterLfo = lfo;
    // gas jet: hiss plus a resonant nozzle tone
    this.jet = g.gain(0, out);
    this.jetF = g.filter('bandpass', 2400, 1.2);
    loopNoise('white').connect(g.filter('highpass', 1500, 0.7)).connect(this.jetF).connect(this.jet);
    // cable hum: two slightly detuned triangles through a bandpass (a singing wire)
    this.cable = g.gain(0, out);
    const bp = g.filter('bandpass', 900, 3, this.cable);
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
    const t = this.a.graph.ctx.currentTime;
    const w = THREE.MathUtils.clamp((speed - 6) / 50, 0, 1);
    const airborne = st ? !st.grounded : true;
    const k = airborne ? 1 : 0.55;
    this.rumble.gain.setTargetAtTime(w * 0.3 * k, t, 0.12);
    this.rush.gain.setTargetAtTime(w * w * 0.32 * k, t, 0.1);
    this.rushF.frequency.setTargetAtTime(400 + w * 1100, t, 0.12);
    const top = THREE.MathUtils.clamp((speed - 38) / 20, 0, 1);
    this.whistle.gain.setTargetAtTime(top * 0.05 * k, t, 0.15);
    this.whistleF.frequency.setTargetAtTime(2200 + top * 2500 + Math.random() * 300, t, 0.2);
    this.flutterLfo.frequency.setTargetAtTime(8 + w * 14 + Math.random() * 3, t, 0.3);
    // gas
    this.jet.gain.setTargetAtTime(boosting ? 0.09 : 0, t, boosting ? 0.03 : 0.08);
    this.jetF.frequency.setTargetAtTime(2000 + Math.random() * 900, t, 0.05);
    // cable: pitch rises with speed (tension), only while hooked
    const hooked = st ? st.hooked > 0 : false;
    this.cable.gain.setTargetAtTime(hooked ? 0.012 + w * 0.025 : 0, t, hooked ? 0.06 : 0.1);
    const f = 150 + speed * 6;
    this.cableOsc[0].frequency.setTargetAtTime(f, t, 0.08);
    this.cableOsc[1].frequency.setTargetAtTime(f * 1.009, t, 0.08);
    // footsteps
    if (st && (st.grounded || st.wallRun) && speed > 1.5) {
      const rate = st.wallRun ? 7.5 : THREE.MathUtils.clamp(1.6 + speed * 0.16, 1.8, 4.6);
      this.stepT += st.dt * rate;
      if (this.stepT >= 1) {
        this.stepT -= 1;
        this.a.play('footstep', undefined, Math.min(1, 0.35 + speed / 25));
      }
    } else this.stepT = 0.6;
  }

  silence(): void {
    const t = this.a.graph.ctx.currentTime;
    for (const g of [this.rumble, this.rush, this.whistle, this.jet, this.cable]) g.gain.setTargetAtTime(0, t, 0.05);
  }
}
