import type { ChampionVisual } from './types';
import { buildKaiser } from './kaiser';
import { buildNova } from './nova';
import { buildRex } from './rex';
import { buildSera } from './sera';

export const VISUAL_BUILDERS: Record<string, () => ChampionVisual> = {
  kaiser: buildKaiser,
  nova: buildNova,
  rex: buildRex,
  sera: buildSera,
};

export function buildVisual(id: string): ChampionVisual {
  return (VISUAL_BUILDERS[id] ?? buildKaiser)();
}
