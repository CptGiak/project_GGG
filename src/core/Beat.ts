/**
 * Music-synchronised pulses for visuals (weapon glow, equalizers, UI bounce).
 *
 * The procedural music scheduler pushes its kick / snare hits with their AudioContext times;
 * `update` fires them when the audio clock reaches them. Whenever no music is audible (muted,
 * autoplay-blocked context, headless tests) a free-running groove at the battle tempo keeps
 * everything breathing.
 */
class BeatClock {
  /** 1 on a kick, decays quickly */
  kick = 0;
  /** 1 on a snare / clap, decays quickly */
  snare = 0;
  /** beats since start (continuous, free-running estimate) */
  beats = 0;
  private queue: Array<{ t: number; snare: boolean }> = [];
  private audioNow: (() => number) | null = null;
  private lastFired = -1e9;
  private freeT = 0;
  private freeBeat = -1;
  bpm = 104;

  /** combined envelope for glow pulses */
  get pulse(): number {
    return Math.max(this.kick, this.snare * 0.85);
  }

  attachClock(now: () => number): void {
    this.audioNow = now;
  }

  push(t: number, snare: boolean): void {
    if (this.queue.length > 64) this.queue.shift();
    this.queue.push({ t, snare });
  }

  update(dt: number): void {
    this.kick *= Math.exp(-dt * 7.5);
    this.snare *= Math.exp(-dt * 9);
    this.beats += dt * (this.bpm / 60);
    const wall = performance.now() / 1000;
    if (this.audioNow && this.queue.length) {
      const now = this.audioNow();
      for (let i = 0; i < this.queue.length; ) {
        const e = this.queue[i];
        if (e.t <= now) {
          if (now - e.t < 0.15) {
            if (e.snare) this.snare = 1;
            else this.kick = 1;
            this.lastFired = wall;
          }
          this.queue.splice(i, 1);
        } else i++;
      }
    }
    if (wall - this.lastFired > 1.2) {
      // no live music: four-on-the-floor kick, snare on 2 and 4
      this.freeT += dt;
      const b = Math.floor(this.freeT * (this.bpm / 60));
      if (b !== this.freeBeat) {
        this.freeBeat = b;
        this.kick = 1;
        if (b % 2 === 1) this.snare = 1;
      }
    }
  }
}

export const Beat = new BeatClock();
