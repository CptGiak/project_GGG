import type { ChampionId } from '../../shared/champions';
import { DEFAULT_VOLUMES, SLIDER_RANGE_DB, sliderGain } from './audio/mix';
import type { Action } from './Input';
import type { ModeId } from '../../shared/modes';

export interface Settings {
  name: string;
  sensitivity: number;
  invertY: boolean;
  quality: 'low' | 'medium' | 'high';
  fov: number;
  master: number;
  music: number;
  sfx: number;
  champ: ChampionId;
  bots: number;
  botDifficulty: number;
  arena: string;
  room: string;
  /** player key overrides (missing actions use the defaults) */
  bindings: Partial<Record<Action, string[]>>;
  /** practice game mode */
  mode: ModeId;
  /** version of the volume curve the three volumes were saved with (2: dB-scaled sliders) */
  audioMix?: number;
}

const KEY = 'ggg.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  sensitivity: 1,
  invertY: false,
  quality: 'medium',
  fov: 74,
  master: DEFAULT_VOLUMES.master,
  music: DEFAULT_VOLUMES.music,
  sfx: DEFAULT_VOLUMES.sfx,
  champ: 'kaiser',
  bots: 3,
  botDifficulty: 0.5,
  arena: 'neon_city',
  room: '',
  bindings: {},
  mode: 'dm',
  audioMix: 2,
};

/** the defaults the first mix shipped with (linear sliders) */
const OLD_VOLUMES = { master: 0.8, music: 0.45, sfx: 0.9 };

/**
 * Settings saved before the new mix: volumes nobody touched move to the new defaults; volumes a
 * player changed keep their distance from the old default (half as loud stays half as loud).
 */
function migrateVolumes(saved: Partial<Settings>, s: Settings): void {
  if (saved.audioMix === 2) return;
  for (const k of ['master', 'music', 'sfx'] as const) {
    const old = saved[k];
    if (typeof old !== 'number' || Math.abs(old - OLD_VOLUMES[k]) < 0.005) s[k] = DEFAULT_VOLUMES[k];
    else if (old <= 0.001) s[k] = 0;
    else {
      const gain = sliderGain(DEFAULT_VOLUMES[k]) * (old / OLD_VOLUMES[k]);
      const db = 20 * Math.log10(gain);
      s[k] = Math.round(Math.max(0.05, Math.min(1, 1 + db / SLIDER_RANGE_DB)) * 100) / 100;
    }
  }
  s.audioMix = 2;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw) as Partial<Settings>;
    const s = { ...DEFAULT_SETTINGS, ...saved };
    migrateVolumes(saved, s);
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) – settings stay in memory */
  }
}
