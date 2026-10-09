import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { ChampionVisual } from './types';
import { buildKaiser } from './kaiser';
import { buildKaiserGlb } from './kaiserGlb';
import { buildNova } from './nova';
import { buildRex } from './rex';
import { buildSera } from './sera';
import { championModel } from './glbModels';

export const VISUAL_BUILDERS: Record<string, () => ChampionVisual> = {
  kaiser: buildKaiser,
  nova: buildNova,
  rex: buildRex,
  sera: buildSera,
};

/** Champions with a Blender-made model (public/models/<id>.glb, see tools/blender). */
const GLB_BUILDERS: Record<string, (gltf: GLTF) => ChampionVisual> = {
  kaiser: buildKaiserGlb,
};

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
  return (VISUAL_BUILDERS[id] ?? buildKaiser)();
}
