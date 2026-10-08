import { blendPose, type Clip, MASK_ARMS, MASK_FULL, type Mask, Pose } from './Animator';
import { BONE_INDEX } from './Rig';

/**
 * Generic locomotion (idle / run / air / grapple flight / dash / landing) shared by every
 * champion, customised by a champion "anim set" (weapon stance, arm poses, attack clips).
 */

export interface ChampionAnimSet {
  /** full-body combat idle stance */
  idle: Pose;
  /** arm pose while running (masked to arms) */
  runArms: Pose;
  /** arm pose while airborne */
  airArms: Pose;
  /** arm pose during grapple flight */
  flyArms: Pose;
  /** run arm swing multipliers [left, right] */
  armSwing: [number, number];
  /** off-hand IK weight in locomotion (two-handed weapons) */
  offhandLoco: number;
  /** extra forward lean while running, degrees */
  runLean: number;
  clips: Record<string, Clip>;
}

export interface LocoState {
  time: number;
  runPhase: number;
  /** 0 walk-ish ... 1 full sprint */
  runIntensity: number;
  vy: number;
  wRun: number;
  wAir: number;
  wFly: number;
  /** 0 = dive pose, 1 = swing pose (legs forward) */
  swing: number;
  wDash: number;
  wLand: number;
  /** -1..1 lateral / backward movement relative to facing (strafing) */
  strafe: number;
  back: number;
  lookPitch: number;
  lookYaw: number;
  aim: number;
}

export function newLocoState(): LocoState {
  return { time: 0, runPhase: 0, runIntensity: 0, vy: 0, wRun: 0, wAir: 0, wFly: 0, swing: 0, wDash: 0, wLand: 0, strafe: 0, back: 0, lookPitch: 0, lookYaw: 0, aim: 0 };
}

const tmpA = new Pose();
const tmpB = new Pose();
const tmpC = new Pose();

export class Locomotion {
  constructor(readonly set: ChampionAnimSet) {}

  evaluate(st: LocoState, out: Pose): Pose {
    const set = this.set;
    // ---- ground: idle -> run -------------------------------------------------------------
    this.idle(st, out);
    if (st.wRun > 0.001) {
      this.run(st, tmpA);
      blendPose(out, out, tmpA, st.wRun);
    }
    // ---- air -------------------------------------------------------------------------------
    if (st.wAir > 0.001) {
      this.air(st, tmpB);
      blendPose(out, out, tmpB, st.wAir);
    }
    // ---- grapple flight ------------------------------------------------------------------------
    if (st.wFly > 0.001) {
      this.fly(st, tmpC);
      blendPose(out, out, tmpC, st.wFly);
    }
    // ---- dash --------------------------------------------------------------------------------
    if (st.wDash > 0.001) {
      this.dash(st, tmpA);
      blendPose(out, out, tmpA, st.wDash);
    }
    // ---- landing crouch (additive) -------------------------------------------------------
    if (st.wLand > 0.001) {
      const w = st.wLand;
      out.hips.y -= 0.16 * w;
      out.addEuler('thighL', -55, 0, 0, w).addEuler('thighR', -50, 0, 0, w);
      out.addEuler('shinL', 95, 0, 0, w).addEuler('shinR', 90, 0, 0, w);
      out.addEuler('footL', -40, 0, 0, w).addEuler('footR', -40, 0, 0, w);
      out.addEuler('spine', 18, 0, 0, w).addEuler('chest', 10, 0, 0, w);
    }
    void set;
    return out;
  }

  idle(st: LocoState, out: Pose): void {
    out.copy(this.set.idle);
    const t = st.time;
    const br = Math.sin(t * 2.1);
    out.addEuler('chest', br * 1.6, 0, 0);
    out.addEuler('neck', -br * 1.0, 0, 0);
    out.addEuler('upperArmL', br * 1.2, 0, br * 1.2);
    out.addEuler('upperArmR', br * 1.2, 0, -br * 1.2);
    out.hips.y += Math.sin(t * 2.1 + 0.6) * 0.006;
    out.addEuler('spine', 0, Math.sin(t * 0.7) * 1.5, 0);
  }

  run(st: LocoState, out: Pose): void {
    const set = this.set;
    const s = 0.55 + 0.45 * st.runIntensity;
    const ph = st.runPhase;
    const sn = Math.sin(ph);
    const cs = Math.cos(ph);
    out.identity();
    // legs
    const A = 30 + 26 * s;
    const lean = 8 * s;
    const swingL = Math.max(0, cs);
    const swingR = Math.max(0, -cs);
    const thL = -A * sn - lean;
    const thR = A * sn - lean;
    const knL = 12 + (40 + 55 * s) * Math.pow(swingL, 1.3) + 10 * Math.max(0, -sn);
    const knR = 12 + (40 + 55 * s) * Math.pow(swingR, 1.3) + 10 * Math.max(0, sn);
    out.setEuler('thighL', thL, 0, 2);
    out.setEuler('thighR', thR, 0, -2);
    out.setEuler('shinL', knL, 0, 0);
    out.setEuler('shinR', knR, 0, 0);
    out.setEuler('footL', -thL * 0.35 - knL * 0.25 + 12, 0, 0);
    out.setEuler('footR', -thR * 0.35 - knR * 0.25 + 12, 0, 0);
    // torso
    const bob = 0.035 * s;
    out.hips.set(0, -0.03 * s - bob + bob * Math.cos(ph * 2), 0);
    out.setEuler('hips', 4 * s, -9 * s * sn, 0);
    out.setEuler('spine', 7 + 9 * s + set.runLean, 5 * s * sn, 0);
    out.setEuler('chest', 4 * s, 9 * s * sn, -2 * s * sn);
    out.setEuler('neck', -6 * s, -6 * s * sn, 0);
    out.setEuler('head', -6 * s - set.runLean * 0.5, -4 * s * sn, 0);
    // arms: champion pose + swing
    blendPose(out, out, set.runArms, 1, MASK_ARMS, false);
    const aw = 28 + 22 * s;
    out.preEuler('upperArmL', aw * sn * set.armSwing[0], 0, 0);
    out.preEuler('upperArmR', -aw * sn * set.armSwing[1], 0, 0);
    out.addEuler('foreArmL', -12 * set.armSwing[0] * Math.max(0, -sn), 0, 0);
    out.addEuler('foreArmR', -12 * set.armSwing[1] * Math.max(0, sn), 0, 0);
    // strafing / backpedal: twist hips toward movement, keep chest forward
    if (Math.abs(st.strafe) > 0.05) {
      out.preEuler('hips', 0, -st.strafe * 35, 0);
      out.preEuler('spine', 0, st.strafe * 20, 0);
      out.preEuler('chest', 0, st.strafe * 15, 0);
    }
  }

  air(st: LocoState, out: Pose): void {
    const set = this.set;
    const k = Math.min(1, Math.max(0, (st.vy + 3) / 9)); // 1 rising, 0 falling
    const t = st.time;
    out.identity();
    const flutter = Math.sin(t * 7) * 4 * (1 - k);
    out.setEuler('thighL', -20 - 35 * k + flutter, 0, 6);
    out.setEuler('thighR', -5 - 12 * k - flutter, 0, -6);
    out.setEuler('shinL', 35 + 55 * k, 0, 0);
    out.setEuler('shinR', 25 + 25 * k, 0, 0);
    out.setEuler('footL', 25, 0, 0);
    out.setEuler('footR', 30, 0, 0);
    out.setEuler('spine', 6 * k - 4 * (1 - k), 0, 0);
    out.setEuler('chest', 3, 0, 0);
    out.setEuler('head', -4 * (1 - k), 0, 0);
    out.hips.set(0, 0, 0);
    blendPose(out, out, set.airArms, 1, MASK_ARMS, false);
    out.preEuler('upperArmL', 0, 0, 18 * (1 - k) + Math.sin(t * 6) * 3 * (1 - k));
    out.preEuler('upperArmR', 0, 0, -18 * (1 - k) - Math.sin(t * 6 + 1) * 3 * (1 - k));
  }

  fly(st: LocoState, out: Pose): void {
    const set = this.set;
    const t = st.time;
    const sw = st.swing;
    out.identity();
    // dive / superhero pose
    const wob = Math.sin(t * 9) * 3;
    out.setEuler('thighL', -8 - 42 * sw + wob, 0, 5);
    out.setEuler('thighR', 18 - 30 * sw - wob, 0, -6);
    out.setEuler('shinL', 55 - 10 * sw, 0, 0);
    out.setEuler('shinR', 85 - 30 * sw, 0, 0);
    out.setEuler('footL', 35, 0, 0);
    out.setEuler('footR', 40, 0, 0);
    out.setEuler('spine', -6 + 14 * sw, 0, 0);
    out.setEuler('chest', -4 + 6 * sw, 0, 0);
    // keep the eyes on the horizon: the body pivot pitches forward when diving
    out.setEuler('neck', -18 * (1 - sw), 0, 0);
    out.setEuler('head', -22 * (1 - sw), 0, 0);
    blendPose(out, out, set.flyArms, 1, MASK_ARMS, false);
  }

  dash(st: LocoState, out: Pose): void {
    const set = this.set;
    out.identity();
    out.setEuler('thighL', -55, 0, 8);
    out.setEuler('thighR', 35, 0, -6);
    out.setEuler('shinL', 50, 0, 0);
    out.setEuler('shinR', 65, 0, 0);
    out.setEuler('footL', 10, 0, 0);
    out.setEuler('footR', 40, 0, 0);
    out.setEuler('spine', 22, 0, 0);
    out.setEuler('chest', 8, 0, 0);
    out.setEuler('head', -20, 0, 0);
    out.hips.set(0, -0.08, 0);
    blendPose(out, out, set.flyArms, 1, MASK_ARMS, false);
    out.preEuler('upperArmL', 25, 0, 0);
    out.preEuler('upperArmR', 25, 0, 0);
    void st;
  }
}

// ---------------------------------------------------------------------------------------------
// Action layer: one-shot or held clips (attacks, abilities, hit reactions, guard)
// ---------------------------------------------------------------------------------------------

export interface PlayOpts {
  speed?: number;
  fadeIn?: number;
  fadeOut?: number;
  mask?: Mask;
  /** keep the last frame until stop() is called */
  hold?: boolean;
  /** start time offset */
  offset?: number;
  /** for aerial use: only upper body when airborne */
  upperOnlyInAir?: boolean;
}

const tmpAct = new Pose();

export class ActionLayer {
  clip: Clip | null = null;
  time = 0;
  weight = 0;
  private target = 0;
  private opts: PlayOpts = {};
  private stopping = false;
  /** events fired since last poll */
  readonly events: string[] = [];

  play(clip: Clip, opts: PlayOpts = {}): void {
    this.clip = clip;
    this.time = opts.offset ?? 0;
    this.opts = opts;
    this.target = 1;
    this.stopping = false;
    if ((opts.fadeIn ?? clip.opts.fadeIn ?? 0.06) <= 0) this.weight = 1;
  }

  stop(fadeOut?: number): void {
    if (!this.clip) return;
    this.stopping = true;
    this.target = 0;
    if (fadeOut !== undefined) this.opts.fadeOut = fadeOut;
  }

  get active(): boolean {
    return !!this.clip && (this.weight > 0.001 || this.target > 0);
  }

  get name(): string | null {
    return this.clip ? this.clip.name : null;
  }

  /** normalized progress 0..1 */
  get progress(): number {
    return this.clip ? Math.min(1, this.time / Math.max(this.clip.duration, 1e-4)) : 1;
  }

  update(dt: number): void {
    const c = this.clip;
    if (!c) return;
    const speed = this.opts.speed ?? 1;
    const prevT = this.time;
    if (!this.stopping) this.time += dt * speed;
    // events
    if (c.opts.events) {
      for (const e of c.opts.events) {
        if (e.t > prevT && e.t <= this.time) this.events.push(e.id);
        else if (prevT === 0 && e.t === 0 && this.time > 0) this.events.push(e.id);
      }
    }
    const fadeIn = this.opts.fadeIn ?? c.opts.fadeIn ?? 0.06;
    const fadeOut = this.opts.fadeOut ?? c.opts.fadeOut ?? 0.15;
    if (!c.loop && !this.opts.hold && !this.stopping && this.time >= c.duration - fadeOut * speed) {
      this.target = 0;
      this.stopping = true;
    }
    if (this.target > this.weight) this.weight = Math.min(this.target, this.weight + dt / Math.max(fadeIn, 1e-3));
    else this.weight = Math.max(this.target, this.weight - dt / Math.max(fadeOut, 1e-3));
    if (this.weight <= 0.0001 && this.target === 0) {
      this.clip = null;
      this.weight = 0;
    }
  }

  apply(out: Pose, airborne: boolean): void {
    const c = this.clip;
    if (!c || this.weight <= 0) return;
    const t = this.opts.hold ? Math.min(this.time, c.duration) : this.time;
    c.sample(t, tmpAct);
    let m = this.opts.mask ?? c.opts.mask ?? MASK_FULL;
    if (airborne && this.opts.upperOnlyInAir) m = UPPER_AND_HIPS_ROT;
    blendPose(out, out, tmpAct, this.weight, m, !(airborne && this.opts.upperOnlyInAir));
  }
}

const UPPER_AND_HIPS_ROT = (() => {
  const m = new Float32Array(MASK_FULL.length);
  for (const b of ['spine', 'chest', 'neck', 'head', 'shoulderL', 'upperArmL', 'foreArmL', 'handL', 'shoulderR', 'upperArmR', 'foreArmR', 'handR'] as const) m[BONE_INDEX[b]] = 1;
  return m;
})();
