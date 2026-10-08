import * as THREE from 'three';

/**
 * Fully synthesized audio: SFX via Web Audio graphs and a procedural "True Damage"-ish beat
 * (kick / snare / hats / sub bass / chord stabs) scheduled with a look-ahead clock.
 */

type SfxFn = (a: AudioEngine, out: AudioNode, t: number, v: number) => void;

const _v = new THREE.Vector3();

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  private noise!: AudioBuffer;
  private listenerPos = new THREE.Vector3();
  private listenerRight = new THREE.Vector3(1, 0, 0);
  volumes = { master: 0.8, sfx: 0.9, music: 0.45 };
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private boostGain: GainNode | null = null;
  private music: MusicPlayer | null = null;
  private lastPlay = new Map<string, number>();

  /** must be called from a user gesture */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumes.master;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.musicBus.connect(this.master);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.setupLoops();
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
  }

  /** play a named SFX, optionally positioned in the world */
  play(name: string, pos?: THREE.Vector3, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const fn = SFX[name];
    if (!fn) return;
    // throttle identical sounds within 25ms
    const now = ctx.currentTime;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < 0.025) return;
    this.lastPlay.set(name, now);
    let v = volume;
    let pan = 0;
    if (pos) {
      _v.subVectors(pos, this.listenerPos);
      const d = _v.length();
      v *= 1 / (1 + d * 0.045);
      if (v < 0.02) return;
      pan = d > 0.5 ? THREE.MathUtils.clamp(_v.normalize().dot(this.listenerRight), -1, 1) * 0.7 : 0;
    }
    const g = ctx.createGain();
    g.gain.value = v;
    let out: AudioNode = g;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.sfxBus);
    } else g.connect(this.sfxBus);
    out = g;
    fn(this, out, now + 0.005, 1);
  }

  // ---------------------------------------------------------------------------------------------
  // building blocks
  // ---------------------------------------------------------------------------------------------

  noiseSrc(t: number, dur: number): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return s;
  }

  osc(type: OscillatorType, f0: number, f1: number, t: number, dur: number, out: AudioNode, vol: number, attack = 0.002): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseHit(t: number, dur: number, out: AudioNode, vol: number, type: BiquadFilterType, f0: number, f1: number, q = 1, attack = 0.002): void {
    const c = this.ctx!;
    const s = this.noiseSrc(t, dur);
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
  }

  // ---------------------------------------------------------------------------------------------
  // loops: wind + boost hiss
  // ---------------------------------------------------------------------------------------------

  private setupLoops(): void {
    const c = this.ctx!;
    const wind = c.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    this.windFilter = c.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.sfxBus);
    wind.start();
    const boost = c.createBufferSource();
    boost.buffer = this.noise;
    boost.loop = true;
    const bf = c.createBiquadFilter();
    bf.type = 'highpass';
    bf.frequency.value = 1800;
    this.boostGain = c.createGain();
    this.boostGain.gain.value = 0;
    boost.connect(bf).connect(this.boostGain).connect(this.sfxBus);
    boost.start();
  }

  /** speed in m/s of the listener's fighter, boosting flag */
  updateLoops(speed: number, boosting: boolean): void {
    if (!this.ctx || !this.windGain || !this.boostGain || !this.windFilter) return;
    const t = this.ctx.currentTime;
    const w = THREE.MathUtils.clamp((speed - 8) / 50, 0, 1);
    this.windGain.gain.setTargetAtTime(w * w * 0.35, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + w * 1400, t, 0.1);
    this.boostGain.gain.setTargetAtTime(boosting ? 0.07 : 0, t, 0.05);
  }

  silenceLoops(): void {
    if (!this.ctx || !this.windGain || !this.boostGain) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0, t, 0.05);
    this.boostGain.gain.setTargetAtTime(0, t, 0.05);
  }

  // ---------------------------------------------------------------------------------------------
  // music
  // ---------------------------------------------------------------------------------------------

  startMusic(style: 'menu' | 'battle'): void {
    if (!this.ctx) return;
    if (!this.music) this.music = new MusicPlayer(this);
    this.music.start(style);
  }

  stopMusic(): void {
    this.music?.stop();
  }

  setMusicIntensity(v: number): void {
    if (this.music) this.music.intensity = v;
  }
}

// =============================================================================================
// SFX recipes
// =============================================================================================

const SFX: Record<string, SfxFn> = {
  hookFire: (a, o, t) => {
    a.noiseHit(t, 0.14, o, 0.5, 'bandpass', 3800, 700, 2.5);
    a.osc('square', 1900, 900, t, 0.035, o, 0.08);
  },
  hookHit: (a, o, t) => {
    a.osc('sine', 430, 400, t, 0.18, o, 0.3);
    a.osc('sine', 1180, 1100, t, 0.12, o, 0.15);
    a.noiseHit(t, 0.05, o, 0.4, 'highpass', 3000, 3000);
  },
  jump: (a, o, t) => a.noiseHit(t, 0.18, o, 0.25, 'lowpass', 900, 300),
  gasBurst: (a, o, t) => {
    a.noiseHit(t, 0.3, o, 0.45, 'highpass', 1400, 2400, 0.7, 0.005);
    a.osc('sine', 110, 55, t, 0.12, o, 0.3);
  },
  boostStart: (a, o, t) => a.noiseHit(t, 0.25, o, 0.35, 'highpass', 900, 2600, 0.7, 0.01),
  dash: (a, o, t) => {
    a.noiseHit(t, 0.22, o, 0.5, 'bandpass', 380, 2600, 1.4, 0.01);
    a.osc('sine', 160, 70, t, 0.1, o, 0.25);
  },
  wallkick: (a, o, t) => {
    a.osc('sine', 140, 60, t, 0.12, o, 0.4);
    a.noiseHit(t, 0.2, o, 0.3, 'highpass', 1600, 2400);
  },
  land: (a, o, t) => {
    a.osc('sine', 95, 45, t, 0.18, o, 0.55);
    a.noiseHit(t, 0.15, o, 0.3, 'lowpass', 1200, 200);
  },
  swing: (a, o, t) => a.noiseHit(t, 0.2, o, 0.45, 'bandpass', 300, 1800, 1.8, 0.03),
  swingHeavy: (a, o, t) => {
    a.noiseHit(t, 0.32, o, 0.55, 'bandpass', 180, 1100, 1.5, 0.05);
    a.osc('sine', 70, 50, t, 0.25, o, 0.2, 0.05);
  },
  hit: (a, o, t) => {
    a.osc('sine', 180, 55, t, 0.14, o, 0.7);
    a.noiseHit(t, 0.08, o, 0.55, 'bandpass', 2400, 900, 1.2);
    a.osc('square', 90, 60, t, 0.05, o, 0.12);
  },
  hitHeavy: (a, o, t) => {
    a.osc('sine', 140, 35, t, 0.35, o, 0.9);
    a.noiseHit(t, 0.15, o, 0.7, 'bandpass', 1800, 400, 1);
    a.osc('sawtooth', 60, 30, t, 0.3, o, 0.15);
  },
  crit: (a, o, t) => {
    a.osc('triangle', 1760, 1760, t, 0.25, o, 0.22);
    a.osc('triangle', 2640, 2640, t + 0.04, 0.3, o, 0.16);
  },
  block: (a, o, t) => {
    a.osc('square', 820, 760, t, 0.12, o, 0.12);
    a.osc('sine', 1650, 1500, t, 0.2, o, 0.2);
    a.noiseHit(t, 0.06, o, 0.4, 'highpass', 4000, 4000);
  },
  parry: (a, o, t) => {
    a.osc('sine', 2200, 2400, t, 0.5, o, 0.3);
    a.osc('sine', 3300, 3600, t, 0.4, o, 0.18);
    a.noiseHit(t, 0.3, o, 0.3, 'highpass', 5000, 8000);
  },
  shot: (a, o, t) => {
    a.osc('sawtooth', 900, 120, t, 0.12, o, 0.22);
    a.osc('sine', 120, 50, t, 0.12, o, 0.45);
    a.noiseHit(t, 0.06, o, 0.25, 'highpass', 2500, 2500);
  },
  chargeShot: (a, o, t) => {
    a.osc('sawtooth', 220, 40, t, 0.5, o, 0.35);
    a.osc('sine', 80, 30, t, 0.6, o, 0.7);
    a.noiseHit(t, 0.3, o, 0.5, 'lowpass', 4000, 300, 0.8);
  },
  charge: (a, o, t) => a.osc('triangle', 180, 900, t, 0.9, o, 0.12, 0.2),
  orb: (a, o, t) => {
    a.osc('sine', 880, 1320, t, 0.18, o, 0.2);
    a.osc('sine', 1760, 1760, t, 0.1, o, 0.08);
  },
  note: (a, o, t) => {
    a.osc('triangle', 1046, 1046, t, 0.3, o, 0.16);
    a.osc('sine', 1568, 1568, t, 0.25, o, 0.1);
  },
  beam: (a, o, t) => {
    a.osc('sawtooth', 330, 340, t, 0.5, o, 0.12, 0.05);
    a.osc('sine', 660, 680, t, 0.5, o, 0.12, 0.05);
  },
  explosion: (a, o, t) => {
    a.noiseHit(t, 0.7, o, 0.9, 'lowpass', 2400, 120, 0.7, 0.005);
    a.osc('sine', 90, 30, t, 0.6, o, 0.9);
  },
  wave: (a, o, t) => {
    a.osc('sine', 220, 880, t, 0.4, o, 0.35, 0.02);
    a.noiseHit(t, 0.45, o, 0.4, 'bandpass', 600, 3000, 1.2, 0.02);
  },
  teleport: (a, o, t) => {
    a.osc('square', 1600, 200, t, 0.15, o, 0.1);
    a.noiseHit(t, 0.12, o, 0.3, 'bandpass', 5000, 800, 3);
  },
  ultReady: (a, o, t) => {
    a.osc('triangle', 523, 523, t, 0.2, o, 0.15);
    a.osc('triangle', 784, 784, t + 0.1, 0.2, o, 0.15);
    a.osc('triangle', 1046, 1046, t + 0.2, 0.35, o, 0.15);
  },
  ult: (a, o, t) => {
    a.osc('sawtooth', 110, 880, t, 0.6, o, 0.25, 0.1);
    a.noiseHit(t, 0.7, o, 0.4, 'bandpass', 400, 6000, 1, 0.1);
  },
  slam: (a, o, t) => {
    a.osc('sine', 120, 28, t, 0.8, o, 1.0);
    a.noiseHit(t, 0.5, o, 0.8, 'lowpass', 3000, 150, 0.6);
    a.osc('square', 55, 40, t, 0.4, o, 0.15);
  },
  death: (a, o, t) => {
    for (let i = 0; i < 6; i++) a.noiseHit(t + i * 0.03, 0.12, o, 0.35, 'highpass', 3000 + i * 600, 6000, 2);
    a.osc('sine', 880, 110, t, 0.6, o, 0.2);
  },
  kill: (a, o, t) => {
    a.osc('square', 660, 660, t, 0.12, o, 0.12);
    a.osc('square', 990, 990, t + 0.09, 0.2, o, 0.12);
    a.osc('sine', 1320, 1320, t + 0.18, 0.35, o, 0.12);
  },
  uiMove: (a, o, t) => a.osc('square', 1400, 1400, t, 0.04, o, 0.06),
  uiSelect: (a, o, t) => {
    a.osc('square', 880, 880, t, 0.06, o, 0.08);
    a.osc('square', 1320, 1320, t + 0.05, 0.1, o, 0.08);
  },
  uiBack: (a, o, t) => a.osc('square', 700, 450, t, 0.08, o, 0.08),
  countdown: (a, o, t) => a.osc('square', 660, 660, t, 0.15, o, 0.12),
  go: (a, o, t) => {
    a.osc('square', 990, 990, t, 0.4, o, 0.14);
    a.osc('sawtooth', 495, 495, t, 0.4, o, 0.08);
  },
  respawn: (a, o, t) => {
    a.osc('sine', 330, 990, t, 0.4, o, 0.2, 0.05);
    a.noiseHit(t, 0.4, o, 0.2, 'bandpass', 800, 4000, 1, 0.1);
  },
};

// =============================================================================================
// Procedural music
// =============================================================================================

class MusicPlayer {
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private style: 'menu' | 'battle' = 'menu';
  intensity = 0.5;
  private out: GainNode;
  constructor(private a: AudioEngine) {
    this.out = a.ctx!.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(a.musicBus);
  }

  start(style: 'menu' | 'battle'): void {
    this.style = style;
    if (this.timer !== null) return;
    this.nextTime = this.a.ctx!.currentTime + 0.1;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const ctx = this.a.ctx!;
    const bpm = this.style === 'menu' ? 92 : 104;
    const s16 = 60 / bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, s16);
      // swing on odd 16ths
      this.nextTime += s16 * (this.step % 2 === 0 ? 1.08 : 0.92);
      this.step = (this.step + 1) % 128;
    }
  }

  private playStep(step: number, t: number, s16: number): void {
    const a = this.a;
    const o = this.out;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const battle = this.style === 'battle';
    const I = this.intensity;
    // A minor-ish progression: Am - F - C - G (two bars each)
    const roots = [45, 41, 48, 43];
    const chordIdx = Math.floor(bar / 2) % 4;
    const root = roots[chordIdx];
    const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
    // kick
    const kickPat = battle ? [0, 3, 8, 10] : [0, 7, 10];
    if (kickPat.includes(s)) {
      a.osc('sine', 150, 42, t, 0.32, o, 0.75);
      a.osc('square', 60, 40, t, 0.04, o, 0.1);
    }
    // snare / clap
    if (s === 4 || s === 12) {
      a.noiseHit(t, 0.18, o, 0.35, 'bandpass', 1800, 1200, 0.8);
      a.osc('triangle', 220, 160, t, 0.08, o, 0.25);
      if (battle) a.noiseHit(t + 0.012, 0.12, o, 0.2, 'highpass', 2500, 2500);
    }
    // hats
    const hatOn = battle ? true : s % 2 === 0;
    if (hatOn) {
      const open = s % 8 === 6;
      a.noiseHit(t, open ? 0.14 : 0.035, o, (s % 4 === 2 ? 0.13 : 0.07) * (0.6 + I * 0.5), 'highpass', 7000, 7000);
    }
    if (battle && I > 0.6 && (s === 14 || s === 15)) a.noiseHit(t, 0.03, o, 0.07, 'highpass', 8000, 8000);
    // sub bass
    const bassPat = [0, 3, 6, 10, 13];
    if (bassPat.includes(s)) {
      const n = root - 12 + (s === 10 ? 7 : s === 13 ? 10 : 0);
      const c = a.ctx!;
      const os = c.createOscillator();
      os.type = 'sawtooth';
      os.frequency.value = midi(n);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900 + I * 900, t);
      f.frequency.exponentialRampToValueAtTime(160, t + s16 * 2.5);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + s16 * 2.8);
      os.connect(f).connect(g).connect(o);
      os.start(t);
      os.stop(t + s16 * 3);
      a.osc('sine', midi(n), midi(n), t, s16 * 2.8, o, 0.35);
    }
    // chord stabs (off-beat)
    if ((s === 2 || s === 9) && (battle || bar % 2 === 0)) {
      const third = chordIdx === 0 ? 3 : 4;
      for (const iv of [12, 12 + third, 19, 24]) {
        a.osc('sawtooth', midi(root + iv), midi(root + iv), t, s16 * 1.6, o, 0.035);
        a.osc('square', midi(root + iv) * 1.004, midi(root + iv) * 1.004, t, s16 * 1.4, o, 0.018);
      }
    }
    // lead arp in battle at high intensity
    if (battle && I > 0.45 && s % 2 === 1) {
      const scale = [0, 3, 5, 7, 10, 12];
      const n = root + 24 + scale[(step * 7 + bar) % scale.length];
      a.osc('triangle', midi(n), midi(n), t, s16 * 0.9, o, 0.05 * I);
    }
  }
}
