import type { Arena } from '../ArenaBuilder';
import { buildNeonCity } from './neonCity';
import { buildStage } from './stage';
import { buildTartarus } from './tartarus';

const BUILDERS: Record<string, () => Arena> = {
  neon_city: buildNeonCity,
  stage: buildStage,
  tartarus: buildTartarus,
};

export function buildArena(id: string): Arena {
  return (BUILDERS[id] ?? buildNeonCity)();
}
