/**
 * Game modes shared by client and server. RIFLETTORE (spotlight) is king-of-the-hill on the beat:
 * a spotlight zone that jumps around the arena with the music, scoring once per beat for whoever
 * stands in it alone. Its schedule is a pure function of (arena, seed, beat), so the server and
 * every client agree on it without sending positions or timers.
 */

import { arenaMeta } from './arenas';

export type ModeId = 'dm' | 'spot';

export interface ModeInfo {
  id: ModeId;
  name: string;
  sub: string;
}

export const MODES: Record<ModeId, ModeInfo> = {
  dm: { id: 'dm', name: 'DEATHMATCH', sub: 'Il primo a 15 KO vince' },
  spot: { id: 'spot', name: 'RIFLETTORE', sub: 'Resta da solo sotto il riflettore: 1 punto a battuta' },
};
export const MODE_IDS: ModeId[] = ['dm', 'spot'];

/** battle music tempo: the spotlight scores and moves on its beats */
export const BPM = 104;
export const BEAT_MS = 60000 / BPM;

export const SPOT = {
  /** beats before the first spotlight goes live (it is previewed during them) */
  warmupBeats: 16,
  /** beats each zone stays live (~37 s) */
  zoneBeats: 64,
  /** the next zone is announced this many beats before it goes live */
  previewBeats: 8,
  /** zones per match; the last one is always the arena's Gran Finale */
  zones: 9,
  /** points that win the match */
  scoreToWin: 120,
  /** points per beat in the Gran Finale */
  finaleMult: 2,
  /** spawns closer than this to the live zone are avoided (m) */
  spawnClear: 26,
};

/** total length of a RIFLETTORE match (s) */
export const SPOT_DURATION_SEC = ((SPOT.warmupBeats + SPOT.zones * SPOT.zoneBeats) * BEAT_MS) / 1000;

export interface SpotZone {
  name: string;
  /** centre of the floor of the zone */
  c: [number, number, number];
  /** radius (m) */
  r: number;
  /** height of the column above the floor that still counts (m) */
  h: number;
  finale?: boolean;
}

/**
 * Zones per arena: floors you can stand on, from wide pits to tiny peaks; the finale is the
 * highest point. An arena without a table here can't host RIFLETTORE (the server skips it).
 */
export const SPOT_ZONES: Record<string, SpotZone[]> = {
  stage: [
    { name: 'LA FOSSA', c: [0, 0, 0], r: 11, h: 6 },
    { name: 'PEDANA EST', c: [52, 15.5, 0], r: 6.5, h: 6 },
    { name: 'IL PALCO', c: [0, 2.6, 60], r: 10, h: 6 },
    { name: 'CURVA SUD', c: [0, 25, -106], r: 7, h: 6 },
    { name: 'PEDANA OVEST', c: [-52, 15.5, 0], r: 6.5, h: 6 },
    { name: 'TORRE CASSE', c: [-41, 20, 60], r: 4.5, h: 6 },
    { name: 'PEDANA SUD', c: [0, 21.5, -52], r: 6.5, h: 6 },
    { name: 'LIVE', c: [0, 40, 0], r: 5.5, h: 6, finale: true },
  ],
  tartarus: [
    { name: 'ISOLA NORD', c: [0, 12, 34], r: 7.5, h: 6 },
    { name: 'PICCO EST', c: [45.4, 56.9, -7.2], r: 4.5, h: 6 },
    { name: 'ISOLA GRANDE SUD', c: [-0.3, 10.8, -71.6], r: 8.5, h: 6 },
    { name: 'FARO OVEST', c: [-62, 33.1, 20.4], r: 5.5, h: 6 },
    { name: 'ISOLA EST', c: [34, 12, 0], r: 7.5, h: 6 },
    { name: 'PICCO SUD-OVEST', c: [-41, 43.4, -20.9], r: 4.5, h: 6 },
    { name: 'ISOLA NORD-EST', c: [42.8, 25.9, 58.4], r: 6.5, h: 6 },
    { name: 'ISOLA OVEST', c: [-34, 12, 0], r: 7.5, h: 6 },
    { name: 'MEZZANOTTE', c: [0, 104.4, 0], r: 5.5, h: 6, finale: true },
  ],
  neon_city: [
    { name: 'SCRAMBLE', c: [0, 0, 0], r: 12, h: 8 },
    { name: 'INCROCIO PONTI', c: [20, 24.7, -20], r: 6, h: 9 },
    { name: 'TETTO EST', c: [60, 66.8, -27], r: 9, h: 6 },
    { name: 'IL TRENO', c: [-46, 14.8, -11], r: 7, h: 6 },
    { name: 'TETTO NORD', c: [27, 62.8, 60], r: 9, h: 6 },
    { name: 'TETTO SUD', c: [-27, 70.8, -60], r: 9, h: 6 },
    { name: 'TETTO BASSO OVEST', c: [-60, 40.8, -27], r: 9, h: 6 },
    { name: 'LA VETTA', c: [62, 80.8, 62], r: 10, h: 6, finale: true },
  ],
};

/** deterministic PRNG (mulberry32) so the schedule is identical everywhere */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** the match's zone order: a seeded shuffle of the arena's zones (cycled to fill), finale last */
export function spotSchedule(arena: string, seed: number): SpotZone[] {
  // unknown ids load the default arena: use its zones
  const all = SPOT_ZONES[arenaMeta(arena).id] ?? SPOT_ZONES.stage;
  const finale = all.find((z) => z.finale) ?? all[all.length - 1];
  const pool = all.filter((z) => z !== finale);
  const r = rng(seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out: SpotZone[] = [];
  for (let i = 0; i < SPOT.zones - 1; i++) out.push(pool[i % pool.length]);
  out.push(finale);
  return out;
}

export interface SpotPhase {
  /** zone index (0..zones-1) live now; -1 during the warm-up, `zones` once over */
  idx: number;
  zone: SpotZone | null;
  /** the zone announced next (during the preview window and the warm-up) */
  next: SpotZone | null;
  /** beats until the next switch */
  beatsLeft: number;
  over: boolean;
}

/** where the spotlight is at `beat` (beats since the match started) */
export function spotPhase(schedule: SpotZone[], beat: number): SpotPhase {
  const b = beat - SPOT.warmupBeats;
  if (b < 0) return { idx: -1, zone: null, next: schedule[0], beatsLeft: -b, over: false };
  const idx = Math.floor(b / SPOT.zoneBeats);
  if (idx >= schedule.length) return { idx: schedule.length, zone: null, next: null, beatsLeft: 0, over: true };
  const beatsLeft = SPOT.zoneBeats - (b % SPOT.zoneBeats);
  const next = beatsLeft <= SPOT.previewBeats ? schedule[idx + 1] ?? null : null;
  return { idx, zone: schedule[idx], next, beatsLeft, over: false };
}

/** the zone worth heading for: the live one, or the next one when it is about to open */
export function spotTarget(ph: SpotPhase): SpotZone | null {
  if (ph.zone && (!ph.next || ph.beatsLeft > 3)) return ph.zone;
  return ph.next ?? ph.zone;
}

/** a position (feet) counts as inside the zone's column */
export function inSpot(z: SpotZone, x: number, y: number, zz: number): boolean {
  const dx = x - z.c[0];
  const dz = zz - z.c[2];
  return dx * dx + dz * dz <= z.r * z.r && y >= z.c[1] - 1.5 && y <= z.c[1] + z.h;
}
