/**
 * Score notation for the soundtrack, compiled once into per-track event lists.
 *
 * Sections are written bar by bar ('|' separates bars, every bar is checked to add up to 16
 * sixteenths, so a wrong note length fails loudly instead of slowly drifting the groove).
 *
 * Melody tokens   E5:4  F#4:2!  Bb3'  [C5,E5,G5]:8  -:2 (rest)  _:4 (tie: extends the last note)
 *                 length in sixteenths after ':' (sticky); flags: ! accent, ' staccato,
 *                 ^ scoop up into the note, ~ wide vibrato, / fall off at the end, m palm mute
 *                 (riffs), s single string (riffs)
 * Chords          Em:8 C/E:8 | D  (lengths sticky within the bar, a bare chord fills the bar; m 5 7 m7 maj7 dim dim7 aug
 *                 sus2 sus4 add9 m9 7b9 6 m6, slash bass)
 * Rhythm strings  16 characters per bar; the meaning of each character depends on the track
 *                 (see TRACK_CHARS); '-' holds the previous event, '.' is silence.
 */

export type DrumLane = 'k' | 's' | 'h' | 'c' | 't';
export type TrackId =
  | 'drums' | 'gtr' | 'bass' | 'brass' | 'brass2' | 'stabs' | 'strings' | 'pad' | 'choir'
  | 'lead' | 'synth' | 'bells' | 'timp' | 'hit';

export interface SectionDef {
  bars: number;
  chords: string;
  drums?: Partial<Record<DrumLane, string>>;
  /** drum fill replacing the last bar of the section (names in FILLS, 'a|b' picks one) */
  fill?: string;
  /** short fills on the last beat of every 4th bar (default on when the section has a snare) */
  minifill?: boolean;
  /** horns double the brass lead an octave below */
  oct?: boolean;
  /** rhythm string (follows the chords) or riff tokens (power chords on the written roots) */
  gtr?: string;
  /** bass rhythm string (R 5 8 3 7 a) or note tokens */
  bass?: string;
  /** lead brass line (note tokens) */
  brass?: string;
  /** brass harmony / counter line (note tokens) */
  brass2?: string;
  /** brass chord stabs on the chords: X x (stab) < (swell) */
  stabs?: string;
  /** string ostinato (1 3 5 8 7 9 chord tones) or a counter-melody in note tokens */
  strings?: string;
  /** sustained chord pad: 'strings' | 'choir' | 'both' */
  pad?: 'strings' | 'choir' | 'both';
  /** choir line in note tokens */
  choir?: string;
  /** lead guitar line (note tokens) */
  lead?: string;
  /** synth lead (note tokens) */
  synth?: string;
  bells?: string;
  /** timpani: R root, 5 fifth, r roll */
  timp?: string;
  /** orchestra hits on the chord: H */
  hit?: string;
  /** music intensity (0..1) a layer needs to play */
  gate?: Partial<Record<TrackId, number>>;
  /** volume scale per track for this section */
  mix?: Partial<Record<TrackId, number>>;
}

export interface SongDef {
  id: string;
  title: string;
  bpm: number;
  /** pitch class + octave reference of the tonic (midi) used by the pedal tone */
  tonic: number;
  /** scale of the key as semitone offsets from the tonic (used by tonal SFX) */
  scale: number[];
  sections: Record<string, SectionDef>;
  /** arrangement; an entry 'name+2' plays a section transposed up 2 semitones */
  order: string[];
  /** index in `order` the song loops back to */
  loopAt: number;
  /** arrangement for the last minute of a match (loops on its own) */
  climax?: string[];
  /** one-shot (jingles): do not loop */
  once?: boolean;
}

export interface NoteEvent {
  step: number;
  len: number;
  notes: number[];
  vel: number;
  flags: string;
}

export interface DrumEvent {
  step: number;
  lane: DrumLane;
  ch: string;
}

export interface ChordInfo {
  step: number;
  len: number;
  root: number;
  bass: number;
  /** chord tones as semitones above the root (ascending, root = 0) */
  tones: number[];
  name: string;
}

export interface CompiledSection {
  name: string;
  bars: number;
  steps: number;
  transpose: number;
  chords: ChordInfo[];
  drums: DrumEvent[];
  tracks: Partial<Record<TrackId, NoteEvent[]>>;
  /** guitar: 'riff' notes are roots; 'rhythm' events carry chord roots and the articulation */
  gtrMode: 'riff' | 'rhythm' | null;
  def: SectionDef;
}

export class ScoreError extends Error {}

const NOTE_RE = /^([A-Ga-g])(#|b)?(-?\d)$/;
const PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export function parsePitch(s: string): number {
  const m = NOTE_RE.exec(s);
  if (!m) throw new ScoreError(`bad pitch "${s}"`);
  const pc = PC[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 12 * (Number(m[3]) + 1) + pc;
}

const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '5': [0, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  m9: [0, 3, 7, 10, 14],
  '7b9': [0, 4, 7, 10, 13],
  '7sus4': [0, 5, 7, 10],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  mmaj7: [0, 3, 7, 11],
};

const CHORD_RE = /^([A-G])(#|b)?([a-z0-9#]*)(?:\/([A-G])(#|b)?)?$/;

export function parseChord(sym: string): { root: number; bass: number; tones: number[] } {
  const m = CHORD_RE.exec(sym);
  if (!m) throw new ScoreError(`bad chord "${sym}"`);
  const pc = (l: string, acc?: string) => (PC[l.toLowerCase()] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
  const root = pc(m[1], m[2]);
  const tones = QUALITIES[m[3]];
  if (!tones) throw new ScoreError(`unknown chord quality "${m[3]}" in "${sym}"`);
  const bass = m[4] ? pc(m[4], m[5]) : root;
  return { root, bass, tones };
}

function bars(src: string): string[] {
  return src.split('|').map((b) => b.trim());
}

/** cycle a list of per-bar strings over the section length */
function cycle<T>(list: T[], n: number): T[] {
  return Array.from({ length: n }, (_, i) => list[i % list.length]);
}

/** note tokens -> events; checks every bar adds up to 16 */
export function parseNotes(src: string, nBars: number, where: string, transpose = 0): NoteEvent[] {
  const out: NoteEvent[] = [];
  const barList = cycle(bars(src), nBars);
  let len = 4;
  let last: NoteEvent | null = null;
  barList.forEach((bar, bi) => {
    let pos = 0;
    for (const tok of bar.split(/\s+/).filter(Boolean)) {
      const m = /^(\[[^\]]+\]|[A-Ga-g](?:#|b)?-?\d|-|_)(?::(\d+))?([!'^~\/ms]*)$/.exec(tok);
      if (!m) throw new ScoreError(`${where}: bad token "${tok}" in bar ${bi + 1}`);
      if (m[2]) len = Number(m[2]);
      const step = bi * 16 + pos;
      if (m[1] === '-') last = null;
      else if (m[1] === '_') {
        if (!last) throw new ScoreError(`${where}: tie with nothing to extend in bar ${bi + 1}`);
        last.len += len;
      } else {
        const notes = m[1].startsWith('[') ? m[1].slice(1, -1).split(',').map((p) => parsePitch(p.trim()) + transpose) : [parsePitch(m[1]) + transpose];
        const flags = m[3] ?? '';
        last = { step, len, notes, vel: flags.includes('!') ? 1 : 0.8, flags };
        out.push(last);
      }
      pos += len;
    }
    if (pos !== 16) throw new ScoreError(`${where}: bar ${bi + 1} has ${pos} sixteenths ("${bar}")`);
  });
  return out;
}

function parseChords(src: string, nBars: number, where: string, transpose: number): ChordInfo[] {
  const out: ChordInfo[] = [];
  const barList = cycle(bars(src), nBars);
  barList.forEach((bar, bi) => {
    let pos = 0;
    // chord lengths are sticky within a bar only: a bare symbol fills a whole bar
    let len = 16;
    for (const tok of bar.split(/\s+/).filter(Boolean)) {
      const [sym, l] = tok.split(':');
      if (l) len = Number(l);
      const c = parseChord(sym);
      out.push({ step: bi * 16 + pos, len, root: (c.root + transpose + 120) % 12, bass: (c.bass + transpose + 120) % 12, tones: c.tones, name: sym });
      pos += len;
    }
    if (pos !== 16) throw new ScoreError(`${where}: chord bar ${bi + 1} has ${pos} sixteenths ("${bar}")`);
  });
  return out;
}

/** rhythm string -> one event per non-hold, non-rest character with its held length */
export function parseRhythm(src: string, nBars: number, where: string): Array<{ step: number; len: number; ch: string }> {
  const barList = cycle(bars(src), nBars).map((b) => b.replace(/\s+/g, ''));
  const flat = barList.join('');
  barList.forEach((b, i) => {
    if (b.length !== 16) throw new ScoreError(`${where}: rhythm bar ${i + 1} has ${b.length} steps ("${b}")`);
  });
  const out: Array<{ step: number; len: number; ch: string }> = [];
  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i];
    if (ch === '-' || ch === '.') continue;
    let len = 1;
    while (i + len < flat.length && flat[i + len] === '-') len++;
    out.push({ step: i, len, ch });
  }
  return out;
}

export function chordAt(chords: ChordInfo[], step: number): ChordInfo {
  let c = chords[0];
  for (const x of chords) if (x.step <= step) c = x;
  return c;
}

/** midi note of pitch class `pc` nearest to `near` */
export function nearestPc(pc: number, near: number): number {
  const base = near - (((near % 12) - pc + 12) % 12);
  return near - base > 6 ? base + 12 : base;
}

/** chord voicing in [lo, hi] with the smallest movement from the previous voicing */
export function voiceLead(tones: number[], root: number, lo: number, hi: number, prev: number[] | null, count = 4): number[] {
  const pcs = tones.map((t) => (root + t) % 12);
  // candidate voicings: every inversion stacked upward from each starting octave
  let best: number[] = [];
  let bestCost = Infinity;
  for (let inv = 0; inv < pcs.length; inv++) {
    for (let start = lo; start < lo + 12; start++) {
      if (start % 12 !== pcs[inv]) continue;
      const v = [start];
      for (let k = 1; k < count; k++) {
        const pc = pcs[(inv + k) % pcs.length];
        let n = v[v.length - 1] + 1;
        while (n % 12 !== pc) n++;
        v.push(n);
      }
      if (v[v.length - 1] > hi) continue;
      let cost = 0;
      if (prev && prev.length) for (let k = 0; k < v.length; k++) cost += Math.abs(v[k] - (prev[k] ?? prev[prev.length - 1]));
      else cost = Math.abs(v[0] - (lo + 4));
      if (cost < bestCost) {
        bestCost = cost;
        best = v;
      }
    }
  }
  return best.length ? best : pcs.slice(0, count).map((pc) => nearestPc(pc, lo + 6));
}

export function compileSection(name: string, def: SectionDef, transpose: number): CompiledSection {
  const where = (t: string) => `${name}.${t}`;
  const steps = def.bars * 16;
  const chords = parseChords(def.chords, def.bars, where('chords'), transpose);
  const drums: DrumEvent[] = [];
  for (const lane of ['k', 's', 'h', 'c', 't'] as DrumLane[]) {
    const src = def.drums?.[lane];
    if (!src) continue;
    for (const e of parseRhythm(src, def.bars, where(`drums.${lane}`))) drums.push({ step: e.step, lane, ch: e.ch });
  }
  const tracks: CompiledSection['tracks'] = {};
  const noteTracks: TrackId[] = ['brass', 'brass2', 'choir', 'lead', 'synth', 'bells'];
  for (const t of noteTracks) {
    const src = def[t as keyof SectionDef] as string | undefined;
    if (src) tracks[t] = parseNotes(src, def.bars, where(t), transpose);
  }
  let gtrMode: CompiledSection['gtrMode'] = null;
  if (def.gtr) {
    if (/[A-G]/.test(def.gtr)) {
      gtrMode = 'riff';
      tracks.gtr = parseNotes(def.gtr, def.bars, where('gtr'), transpose);
    } else {
      gtrMode = 'rhythm';
      tracks.gtr = parseRhythm(def.gtr, def.bars, where('gtr')).map((e) => {
        const c = chordAt(chords, e.step);
        return { step: e.step, len: e.len, notes: [c.bass], vel: e.ch === e.ch.toUpperCase() ? 1 : 0.8, flags: e.ch };
      });
    }
  }
  if (def.bass) {
    if (/[A-G]/.test(def.bass)) tracks.bass = parseNotes(def.bass, def.bars, where('bass'), transpose);
    else
      tracks.bass = parseRhythm(def.bass, def.bars, where('bass')).map((e) => {
        const c = chordAt(chords, e.step);
        const next = chordAt(chords, Math.min(steps - 1, e.step + e.len));
        const third = c.tones[1] ?? 4;
        const iv: Record<string, number> = { R: 0, r: 0, '5': 7, '8': 12, '3': third, '7': c.tones[3] ?? 10, b: 10, '4': 5, '2': 2, '6': 9 };
        let pc = c.bass;
        let off = iv[e.ch];
        if (e.ch === 'a') {
          pc = next.bass;
          off = -1;
        } else if (e.ch === 'A') {
          pc = next.bass;
          off = 1;
        }
        if (off === undefined) throw new ScoreError(`${where('bass')}: unknown bass step "${e.ch}"`);
        return { step: e.step, len: e.len, notes: [pc + off], vel: e.ch === 'R' ? 1 : 0.85, flags: e.ch };
      });
  }
  if (def.strings) {
    if (/[A-G]/.test(def.strings)) tracks.strings = parseNotes(def.strings, def.bars, where('strings'), transpose);
    else
      tracks.strings = parseRhythm(def.strings, def.bars, where('strings')).map((e) => {
        const c = chordAt(chords, e.step);
        const deg: Record<string, number> = { '1': 0, '3': c.tones[1] ?? 4, '5': c.tones[2] ?? 7, '8': 12, '7': c.tones[3] ?? 10, '9': 14, '2': 2, '4': 5, '6': 9 };
        const off = deg[e.ch];
        if (off === undefined) throw new ScoreError(`${where('strings')}: unknown ostinato step "${e.ch}"`);
        return { step: e.step, len: e.len, notes: [c.root + off], vel: 0.8, flags: 'o' };
      });
  }
  for (const t of ['stabs', 'timp', 'hit'] as const) {
    const src = def[t];
    if (!src) continue;
    tracks[t] = parseRhythm(src, def.bars, where(t)).map((e) => {
      const c = chordAt(chords, e.step);
      return { step: e.step, len: e.len, notes: [c.root], vel: e.ch === e.ch.toUpperCase() ? 1 : 0.75, flags: e.ch };
    });
  }
  return { name, bars: def.bars, steps, transpose, chords, drums, tracks, gtrMode, def };
}

/** compile every section the arrangement uses (validates the whole song) */
export function compileSong(song: SongDef): Map<string, CompiledSection> {
  const out = new Map<string, CompiledSection>();
  for (const entry of [...song.order, ...(song.climax ?? [])]) {
    if (out.has(entry)) continue;
    const [name, up] = entry.split('+');
    const def = song.sections[name];
    if (!def) throw new ScoreError(`${song.id}: unknown section "${name}"`);
    out.set(entry, compileSection(`${song.id}.${entry}`, def, Number(up ?? 0)));
  }
  return out;
}
