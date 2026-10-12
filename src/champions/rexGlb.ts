import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ModelBuilder } from '../fighter/ModelBuilder';
import { makeBodySpheres } from './body';
import { assembleVisual, marker } from './common';
import { instantiateGlb, type GlbChampionConfig } from './glbModels';
import { addHeadliner, headlinerMaterials, rexAnims, stockZFor } from './rex';
import type { ChampionVisual } from './types';

/**
 * REX from a GLB, with the procedural model's HEADLINER (same build, same weapon VFX: addHeadliner),
 * animations and sockets:
 * - public/models/rex.glb (?rex=glb, tools/blender/build_rex.py): the sculpted model (SDF + hand
 *   pass) on the 'heavy' skeleton, flat colours per material;
 * - public/models/generated/rex.glb (?rex=meshy, tools/meshy + tools/blender/import_generated.py):
 *   the model made with Meshy, one textured material, bones on the Rig formula for its proportions.
 */
const REX_GLB: GlbChampionConfig = {
  gripHands: ['R', 'L'],
  materials: {
    skin: { shade: 0xffb8a8, rim: 0.35, outline: 0.8 },
    hair: { shade: 0xb0a8ff, hairBand: 0.42, rim: 0.6, outline: 0.85 },
    teal: { shade: 0x9fd8ff, spec: 0.2, rim: 0.4, outline: 0.7 },
    hoodie: { shade: 0xc0a0ff, rim: 0.7, rimCut: 0.62 },
    tee: { rim: 0.55 },
    pants: { rim: 0.65, rimCut: 0.62 },
    pocket: { rim: 0.4, outline: 0.7 },
    shoe: { rim: 0.3 },
    sole: { spec: 0.5, outline: 0.8 },
    glove: { spec: 0.3, outline: 0.8 },
    gold: { spec: 0.85, specSize: 0.88, shade: 0xffd2a0, rim: 0.4, outline: 0.5 },
    black: { spec: 0.5, specSize: 0.94, rim: 0.6 },
    gear: { spec: 0.4, rim: 0.5 },
    neon: { neon: 2.8, outline: 0 },
    lens: { neon: 1.4, outline: 0.6 },
    // the Meshy model: its colour map already carries the detail, the toon adds light and rim
    generated: { rim: 0.4, rimCut: 0.66, spec: 0.12, specSize: 0.94 },
  },
};

export function buildRexGlb(gltf: GLTF): ChampionVisual {
  const glb = instantiateGlb(gltf, REX_GLB);
  const rig = glb.rig;
  const WM = headlinerMaterials();
  const b = new ModelBuilder(WM);
  // the stock fits the model's arms (the Meshy Rex has shorter ones than the procedural Rex)
  const gun = addHeadliner(b, rig.byName.handR, WM, stockZFor(rig.spec));

  const spheres = makeBodySpheres(rig);
  for (const c of glb.chains) c.spheres = spheres;
  const hipH = rig.hipHeight;
  const socket = (k: string, fallback: [number, number, number]) => {
    const p = glb.sockets[k] ?? new THREE.Vector3(...fallback);
    return marker(rig.byName.hips, p.x, p.y - hipH, p.z, k);
  };
  const v = assembleVisual({
    rig,
    builder: b,
    cloth: glb.chains,
    bodySpheres: spheres,
    blades: [],
    gear: { gearL: socket('gearL', [0.215, 0.955, 0.03]), gearR: socket('gearR', [-0.215, 0.955, 0.03]), nozzle: socket('nozzle', [0, 0.985, -0.2]) },
    ...gun,
    weaponL: null,
    materials: [...glb.materials, ...Object.values(WM)],
    anims: rexAnims(rig.spec),
  });
  rig.root.add(glb.scene);
  v.syncPose = glb.syncPose;
  return v;
}
