import type { ChampionId } from '../../shared/champions';
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
}

const KEY = 'ggg.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  sensitivity: 1,
  invertY: false,
  quality: 'medium',
  fov: 74,
  master: 0.8,
  music: 0.45,
  sfx: 0.9,
  champ: 'kaiser',
  bots: 3,
  botDifficulty: 0.5,
  arena: 'neon_city',
  room: '',
  bindings: {},
  mode: 'dm',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
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
