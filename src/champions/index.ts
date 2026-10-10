import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { LOL_CHAMPIONS, type ChampionId } from '../../shared/champions';
import type { ChampionVisual } from './types';
import { buildKaiser } from './kaiser';
import { buildKaiserGlb } from './kaiserGlb';
import { buildNova } from './nova';
import { buildRex } from './rex';
import { buildSera } from './sera';
import { championModel } from './glbModels';
import { buildLolGlb } from './lolGlb';

export const VISUAL_BUILDERS: Record<string, () => ChampionVisual> = {
  kaiser: buildKaiser,
  nova: buildNova,
  rex: buildRex,
  sera: buildSera,
};

/** Champions with a Blender-made model (public/models/<id>.glb, see tools/blender). */
const GLB_BUILDERS: Record<string, (gltf: GLTF) => ChampionVisual> = {
  kaiser: buildKaiserGlb,
  akali: (g) => buildLolGlb('akali', g),
  qiyana: (g) => buildLolGlb('qiyana', g),
  locke: (g) => buildLolGlb('locke', g),
};

/**
 * Imported champions (League of Legends) need their model file: without it they are not
 * offered in the menus (other players' picks still show, with a lookalike procedural model).
 */
export function championAvailable(id: ChampionId): boolean {
  return !LOL_CHAMPIONS.includes(id) || !!championModel(id);
}

/** procedural stand-in when an imported champion's model file is missing */
const LOOKALIKE: Partial<Record<ChampionId, string>> = { akali: 'nova', qiyana: 'nova', locke: 'nova' };

export function buildVisual(id: string): ChampionVisual {
  const gltf = championModel(id);
  const fromGlb = GLB_BUILDERS[id];
  if (gltf && fromGlb) {
    try {
      return fromGlb(gltf);
    } catch (err) {
      console.warn(`[models] ${id}: GLB model failed, using the procedural one`, err);
    }
  }
  return (VISUAL_BUILDERS[id] ?? VISUAL_BUILDERS[LOOKALIKE[id as ChampionId] ?? ''] ?? buildKaiser)();
}
