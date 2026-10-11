/**
 * Adaptive music sequencer: plays the composed songs (songs/*.ts) on the synthesized band with a
 * look-ahead clock, layers parts in and out with the match intensity, jumps to the climax
 * arrangement for the final minute, fires stingers, and publishes the current harmony so tonal
 * SFX can sit in key with the score.
 */
import { Beat } from '../Beat';
import type { Graph } from './graph';
import { Band } from './instruments';
import { renderRoom, ROOMS } from './reverb';
import type { DrumId, GuitarArt, SampleBank } from './samples';
import { chordAt, compileSong, nearestPc, voiceLead, type CompiledSection, type DrumEvent, type DrumLane, type NoteEvent, type SongDef, type TrackId } from './score';
import { FILLS, MINI_FILLS, SONGS } from './songs';

export interface Harmony {
  /** pitch class of the current chord root */
  root: number;
  /** chord tones above the root */
  tones: number[];
  /** pitch class of the key's tonic and its scale */
  tonic: number;
  scale: number[];
}

interface StepItem {
  track: TrackId;
  ev: NoteEvent;
}

interface Prepared {
  sec: CompiledSection;
  /** note events indexed by step */
  byStep: StepItem[][];
  drums: DrumEvent[][];
}

interface Playback {
  song: SongDef;
  sections: Map<string, Prepared>;
  order: string[];
  idx: number;
  step: number;
  nextTime: number;
  out: GainNode;
  climax: boolean;
  /** arrangement switch waiting for a phrase boundary */
  pending: 'climax' | null;
  voicings: Partial<Record<string, number[]>>;
  done: boolean;
  /** drum fill of the current bar */
  fill: Partial<Record<DrumLane, string>> | null;
  mini: Partial<Record<DrumLane, string>> | null;
}

const HAT_CYCLE = [1, 0.45, 0.7, 0.5];
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

export class MusicPlayer {
  readonly band: Band;
  /** where the band mixes (before glue compression and ducking) */
  private mix: GainNode;
  private duckGain: GainNode;
  private tone: BiquadFilterNode;
  private cur: Playback | null = null;
  private timer: number | null = null;
  private cache = new Map<string, Map<string, Prepared>>();
  intensity = 0.5;
  /** last chord heard (for the tonal SFX) */
  harmony: Harmony = { root: 2, tones: [0, 3, 7], tonic: 2, scale: [0, 2, 3, 5, 7, 9, 10] };

  constructor(
    readonly g: Graph,
    readonly bank: SampleBank,
    out: AudioNode,
  ) {
    const c = g.ctx;
    this.mix = g.gain(1);
    const glue = c.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.knee.value = 8;
    glue.ratio.value = 3;
    glue.attack.value = 0.012;
    glue.release.value = 0.16;
    this.duckGain = g.gain(1);
    this.tone = g.filter('lowpass', 20000, 0.5);
    this.mix.connect(glue).connect(this.tone).connect(this.duckGain).connect(out);
    // score reverb: a hall, with the returns kept out of the low end
    const conv = c.createConvolver();
    conv.buffer = renderRoom(c, ROOMS.hall, 77);
    const ret = g.gain(0.55);
    conv.connect(g.filter('highpass', 350, 0.6)).connect(g.filter('lowpass', 8000, 0.6)).connect(ret).connect(this.tone);
    this.band = new Band(g, bank, this.mix, conv);
  }

  get ctx(): BaseAudioContext {
    return this.g.ctx;
  }

  get songId(): string | null {
    return this.cur && !this.cur.done ? this.cur.song.id : null;
  }

  private prepare(song: SongDef): Map<string, Prepared> {
    let m = this.cache.get(song.id);
    if (m) return m;
    m = new Map();
    for (const [name, sec] of compileSong(song)) {
      const byStep: StepItem[][] = Array.from({ length: sec.steps }, () => []);
      for (const [track, evs] of Object.entries(sec.tracks) as Array<[TrackId, NoteEvent[]]>) for (const ev of evs) byStep[ev.step].push({ track, ev });
      const drums: DrumEvent[][] = Array.from({ length: sec.steps }, () => []);
      for (const d of sec.drums) drums[d.step].push(d);
      m.set(name, { sec, byStep, drums });
    }
    this.cache.set(song.id, m);
    return m;
  }

  /** render the samples a song needs ahead of time (spread over idle ticks) */
  prewarm(id: string): void {
    const song = SONGS[id];
    if (!song) return;
    const jobs: Array<() => void> = [];
    const seen = new Set<string>();
    for (const p of this.prepare(song).values()) {
      for (const ev of p.sec.tracks.gtr ?? []) {
        const { root, art } = this.gtrNote(p.sec, ev, song);
        const k = `g${root}${art}`;
        if (!seen.has(k)) {
          seen.add(k);
          jobs.push(() => this.bank.guitar(root, art));
        }
      }
      for (const ev of p.sec.tracks.bass ?? []) {
        const n = this.bassNote(ev, p.sec);
        if (!seen.has(`b${n}`)) {
          seen.add(`b${n}`);
          jobs.push(() => this.bank.bass(n));
        }
      }
      for (const ev of p.sec.tracks.lead ?? [])
        for (const n of ev.notes)
          if (!seen.has(`l${n}`)) {
            seen.add(`l${n}`);
            jobs.push(() => this.bank.guitar(n, 'lead'));
          }
    }
    this.bank.prewarm(jobs);
  }

  start(id: string, fadeIn = 0.02): void {
    const song = SONGS[id];
    if (!song) return;
    if (this.cur && !this.cur.done && this.cur.song.id === id) return;
    const c = this.ctx;
    const startAt = c.currentTime + 0.12;
    this.fadeOut(0.9);
    const out = this.g.gain(0, this.mix);
    out.gain.setValueAtTime(0.0001, startAt);
    out.gain.exponentialRampToValueAtTime(1, startAt + Math.max(0.02, fadeIn));
    this.cur = { song, sections: this.prepare(song), order: song.order, idx: 0, step: 0, nextTime: startAt, out, climax: false, pending: null, voicings: {}, done: false, fill: null, mini: null };
    Beat.bpm = song.bpm;
    if (this.timer === null && typeof window !== 'undefined' && !(c instanceof OfflineAudioContext)) this.timer = window.setInterval(() => this.tick(), 25);
  }

  fadeOut(time = 1): void {
    const p = this.cur;
    if (!p || p.done) return;
    const t = this.ctx.currentTime;
    p.out.gain.cancelScheduledValues(t);
    p.out.gain.setValueAtTime(p.out.gain.value || 1, t);
    p.out.gain.exponentialRampToValueAtTime(0.0001, t + time);
    p.done = true;
    const out = p.out;
    setTimeout(() => out.disconnect(), (time + 0.5) * 1000);
  }

  stop(): void {
    this.fadeOut(0.8);
  }

  /** last minute of a match: switch to the climax arrangement at the next phrase */
  setClimax(on: boolean): void {
    const p = this.cur;
    if (!p || p.done || !p.song.climax) return;
    if (on && !p.climax) p.pending = 'climax';
  }

  /** duck the score under a big moment (dB, seconds) */
  duck(db: number, hold: number, release: number): void {
    const t = this.ctx.currentTime;
    const p = this.duckGain.gain;
    const target = Math.pow(10, -Math.abs(db) / 20);
    p.cancelScheduledValues(t);
    p.setValueAtTime(Math.min(1, p.value), t);
    p.linearRampToValueAtTime(target, t + 0.03);
    p.setValueAtTime(target, t + 0.03 + hold);
    p.linearRampToValueAtTime(1, t + 0.03 + hold + release);
  }

  /** muffle the score (low health, death): 0 = clear, 1 = underwater */
  setMuffle(v: number): void {
    const f = 20000 * Math.pow(900 / 20000, Math.max(0, Math.min(1, v)));
    this.tone.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.15);
  }

  /** schedule everything up to `until` (offline renders call this directly) */
  scheduleUntil(until: number): void {
    const p = this.cur;
    if (!p || p.done) return;
    const s16 = 60 / p.song.bpm / 4;
    while (p.nextTime < until && !p.done) {
      this.playStep(p, p.nextTime, s16);
      p.nextTime += s16;
      p.step++;
      const sec = p.sections.get(p.order[p.idx])!.sec;
      if (p.step >= sec.steps || (p.pending && p.step % 64 === 0)) this.advance(p);
    }
  }

  private tick(): void {
    this.scheduleUntil(this.ctx.currentTime + 0.16);
  }

  private advance(p: Playback): void {
    p.step = 0;
    if (p.pending === 'climax' && p.song.climax) {
      p.order = p.song.climax;
      p.idx = 0;
      p.climax = true;
      p.pending = null;
      return;
    }
    p.idx++;
    if (p.idx >= p.order.length) {
      if (p.song.once) {
        p.done = true;
        return;
      }
      p.idx = p.climax ? 0 : p.song.loopAt;
    }
  }

  // -------------------------------------------------------------------------------------------

  private gtrNote(sec: CompiledSection, ev: NoteEvent, song: SongDef): { root: number; art: GuitarArt } {
    if (sec.gtrMode === 'riff') {
      const art = ev.flags.includes('m') ? 'mute' : ev.flags.includes('s') ? 'single' : 'open';
      return { root: ev.notes[0], art };
    }
    const ch = ev.flags;
    let pc = ev.notes[0];
    if (ch === 'p' || ch === 'P') pc = (song.tonic + sec.transpose) % 12;
    // power chords live between D2 and C#3
    let root = nearestPc(((pc % 12) + 12) % 12, 43);
    while (root < 38) root += 12;
    while (root > 49) root -= 12;
    const art = ch === 'm' || ch === 'M' || ch === 'p' ? 'mute' : 'open';
    return { root, art };
  }

  private bassNote(ev: NoteEvent, sec: CompiledSection): number {
    if (sec.def.bass && /[A-G]/.test(sec.def.bass)) return ev.notes[0];
    const n = ev.notes[0];
    const pc = ((n % 12) + 12) % 12;
    const off = n - pc;
    // root between E1 and D#2, then the interval on top
    let root = nearestPc(pc, 34);
    while (root < 28) root += 12;
    while (root > 39) root -= 12;
    return root + off;
  }

  private playStep(p: Playback, t: number, s16: number): void {
    const prep = p.sections.get(p.order[p.idx])!;
    const sec = prep.sec;
    const step = p.step;
    const band = this.band;
    const def = sec.def;
    const I = this.intensity;
    const gate = (tr: TrackId) => (def.gate?.[tr] ?? 0) <= I || p.climax;
    const vol = (tr: TrackId) => def.mix?.[tr] ?? 1;
    const bar = Math.floor(step / 16);
    const lastBar = bar === sec.bars - 1;

    // harmony for the tonal SFX
    if (step % 4 === 0) {
      const c = chordAt(sec.chords, step);
      this.harmony = { root: c.root, tones: c.tones, tonic: (p.song.tonic + sec.transpose) % 12, scale: p.song.scale };
    }

    // ---- drums
    const s = step % 16;
    if (s === 0) {
      // pick this bar's fill: the section's own on its last bar, a transition fill when the
      // arrangement is about to switch, otherwise a short random fill closing every 4th bar
      p.fill = null;
      p.mini = null;
      if (def.fill && lastBar) p.fill = FILLS[pick(def.fill.split('|'))] ?? null;
      else if (p.pending && bar % 4 === 3) p.fill = FILLS.snareRoll;
      else if (bar % 4 === 3 && def.minifill !== false && def.drums?.s) p.mini = pick(MINI_FILLS);
    }
    if (p.fill) {
      for (const [lane, src] of Object.entries(p.fill) as Array<[string, string]>) {
        const ch = src[s];
        if (ch && ch !== '.' && ch !== '-') this.drumHit({ step, lane: lane as DrumEvent['lane'], ch }, t, s16, s);
      }
      // keep the written crash on the downbeat of the fill bar
      for (const d of prep.drums[step]) if (d.lane === 'c' && s === 0) this.drumHit(d, t, s16, s);
    } else if (p.mini && s >= 12) {
      for (const d of prep.drums[step]) if (d.lane === 'k' || d.lane === 'c') this.drumHit(d, t, s16, s);
      for (const [lane, src] of Object.entries(p.mini) as Array<[string, string]>) {
        const ch = src[s - 12];
        if (ch && ch !== '.') this.drumHit({ step, lane: lane as DrumEvent['lane'], ch }, t, s16, s);
      }
    } else for (const d of prep.drums[step]) this.drumHit(d, t, s16, s);

    // ---- pitched parts
    for (const { track, ev } of prep.byStep[step]) {
      if (!gate(track)) continue;
      const dur = ev.len * s16;
      const v = ev.vel * vol(track);
      switch (track) {
        case 'gtr': {
          const { root, art } = this.gtrNote(sec, ev, p.song);
          const slide = ev.flags.includes('^') ? 2 : 0;
          band.guitar(root, art, t + (Math.random() - 0.5) * 0.004, art === 'mute' ? Math.min(dur, 0.3) : dur, v * (art === 'mute' ? 0.9 : 1), slide);
          break;
        }
        case 'bass':
          band.bass(this.bassNote(ev, sec), t, dur, v * 0.9);
          break;
        case 'brass':
          for (const n of ev.notes) {
            band.brass(n, t, dur, v, ev.flags, 'trumpet');
            if (def.oct || p.climax) band.brass(n - 12, t, dur, v * 0.75, ev.flags, 'horn', band.ch.horns);
          }
          break;
        case 'brass2':
          for (const n of ev.notes) band.brass(n, t, dur, v * 0.85, ev.flags, 'horn', band.ch.horns);
          break;
        case 'stabs': {
          const c = chordAt(sec.chords, step);
          const voicing = voiceLead(c.tones, c.root, 55, 76, p.voicings.stabs ?? null, 4);
          p.voicings.stabs = voicing;
          band.brassChord(voicing, t, dur, v, ev.flags);
          break;
        }
        case 'strings': {
          const short = ev.flags === 'o' && ev.len <= 2;
          for (let n of ev.notes) {
            if (ev.flags === 'o') {
              const pc = ((n % 12) + 12) % 12;
              n = nearestPc(pc, 64) + (n - pc);
              while (n > 81) n -= 12;
            }
            band.strings(n, t, dur, v, short);
            if (!short && I > 0.6) band.strings(n - 12, t, dur, v * 0.6, false);
          }
          break;
        }
        case 'choir':
          for (const n of ev.notes) band.choir(n, t, dur, v);
          break;
        case 'lead':
          for (const n of ev.notes) band.leadGuitar(n, t, dur, v, ev.flags);
          break;
        case 'synth':
          for (const n of ev.notes) band.synthLead(n, t, dur, v, ev.flags);
          break;
        case 'bells':
          for (const n of ev.notes) band.bell(n, t, v);
          break;
        case 'timp': {
          const c = chordAt(sec.chords, step);
          const pc = ev.flags === '5' ? (c.bass + 7) % 12 : c.bass;
          let n = nearestPc(pc, 45);
          while (n < 40) n += 12;
          while (n > 53) n -= 12;
          band.timpani(n, t, dur, v, ev.flags === 'r');
          break;
        }
        case 'hit': {
          const c = chordAt(sec.chords, step);
          const voicing = voiceLead(c.tones, c.root, 55, 76, p.voicings.stabs ?? null, 4);
          band.brassChord(voicing, t, Math.min(dur, 0.4), 1, 'X');
          for (const n of voicing) band.strings(n + 12, t, 0.12, 0.9, true);
          band.drum('crash', t, 0.9);
          band.drum('kick', t, 1);
          let tn = nearestPc(c.root, 45);
          while (tn < 40) tn += 12;
          band.timpani(tn, t, 0.3, 1, false);
          break;
        }
      }
    }

    // ---- sustained pads on each chord change
    if (def.pad) {
      const c = sec.chords.find((x) => x.step === step);
      if (c) {
        const dur = c.len * s16;
        const voicing = voiceLead(c.tones, c.root, 52, 72, p.voicings.pad ?? null, Math.min(4, c.tones.length + 1));
        p.voicings.pad = voicing;
        const v = 0.7 * vol('pad');
        if (def.pad !== 'choir') for (const n of voicing) band.strings(n, t, dur, v, false, band.ch.pad);
        if (def.pad !== 'strings' && (I > 0.35 || def.pad === 'choir')) for (const n of voicing.slice(0, 3)) band.choir(n, t, dur, v * 0.8);
      }
    }
  }

  private drumHit(d: DrumEvent, t: number, s16: number, s: number): void {
    const band = this.band;
    const hum = (ms: number) => ((Math.random() * 2 - 1) * ms) / 1000;
    const hit = (id: DrumId, v: number, at = t, pan = 0) => band.drum(id, at + hum(2.5), v * (0.92 + Math.random() * 0.12), pan);
    switch (d.lane) {
      case 'k':
        if (d.ch === 'g') hit('kick', 0.5);
        else {
          hit('kick', d.ch === 'X' ? 1 : 0.86);
          Beat.push(t, false);
        }
        break;
      case 's':
        switch (d.ch) {
          case 'x':
            hit('snare', 0.88, t - 0.003);
            Beat.push(t, true);
            break;
          case 'X':
            hit('snareRim', 1, t - 0.003);
            Beat.push(t, true);
            break;
          case 'g':
            if (Math.random() < 0.7) hit('ghost', 0.28 + Math.random() * 0.1);
            break;
          case 'f':
            hit('ghost', 0.45, t - 0.022);
            hit('snare', 0.95);
            Beat.push(t, true);
            break;
          case 'r':
            hit('snare', 0.55);
            hit('snare', 0.62, t + s16 / 2);
            break;
          case 'c':
            hit('clap', 0.8);
            Beat.push(t, true);
            break;
        }
        break;
      case 'h': {
        const cyc = HAT_CYCLE[s % 4];
        switch (d.ch) {
          case 'x':
            hit('hat', 0.62 * cyc + 0.12);
            break;
          case 'X':
            hit('hat', 0.95);
            break;
          case 'o':
            hit('hatOpen', 0.75);
            break;
          case 'p':
            hit('hatPedal', 0.5);
            break;
          case 'r':
            hit('ride', 0.55 * cyc + 0.25, t, 0.35);
            break;
          case 'R':
            hit('ride', 0.95, t, 0.35);
            break;
          case 'b':
            hit('rideBell', 0.8, t, 0.35);
            break;
        }
        break;
      }
      case 'c':
        switch (d.ch) {
          case 'c':
            hit(s % 8 === 0 ? 'crash' : 'crash2', 0.85, t, s % 8 === 0 ? -0.5 : 0.5);
            break;
          case 'C':
            hit('crash', 1, t, -0.55);
            hit('crash2', 0.85, t + 0.006, 0.55);
            break;
          case 'n':
            hit('china', 0.8, t, 0.45);
            break;
          case 's':
            hit('splash', 0.7, t, 0.3);
            break;
          case 'g':
            hit('gong', 0.9);
            break;
        }
        break;
      case 't': {
        const toms: Record<string, [DrumId, number]> = { '1': ['tom1', 0.45], '2': ['tom2', 0.15], '3': ['tom3', -0.2], '4': ['tom4', -0.4] };
        if (toms[d.ch]) hit(toms[d.ch][0], 0.9, t, toms[d.ch][1]);
        else if (d.ch === 'k') hit('taiko', 0.85);
        else if (d.ch === 'K') {
          hit('taiko', 1);
          Beat.push(t, false);
        }
        break;
      }
    }
  }

  /**
   * Stingers over the score.
   * power: a choir + brass swell on the current chord (ultimate);
   * rise: a short brass rip upward (kill streak).
   */
  stinger(kind: 'power' | 'rise'): void {
    const c = this.ctx;
    const t = c.currentTime + 0.02;
    const h = this.harmony;
    const voicing = voiceLead(h.tones, h.root, 55, 76, null, 4);
    const band = this.band;
    if (kind === 'power') {
      for (const n of voicing) {
        band.brass(n, t, 1.1, 0.95, '~', 'swell');
        band.choir(n + 12, t, 1.4, 0.8);
      }
      band.timpani(nearestPc(h.root, 45), t, 0.9, 0.9, true);
      band.drum('crash', t + 1.0, 1, -0.4);
      band.drum('crash2', t + 1.0, 0.9, 0.4);
      band.drum('kick', t + 1.0, 1);
    } else {
      voicing.forEach((n, i) => band.brass(n + 12, t + i * 0.04, 0.35, 0.8, '^', 'trumpet'));
      band.drum('splash', t, 0.7);
    }
  }
}
