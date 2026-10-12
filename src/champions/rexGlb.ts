import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ModelBuilder } from '../fighter/ModelBuilder';
import { cyl, lathe, rbox, torus, xf } from '../fighter/shapes';
import { equalizerMaterial, neon, toon } from '../render/toon';
import { makeBodySpheres } from './body';
import { assembleVisual, marker, weaponPivot } from './common';
import { instantiateGlb, type GlbChampionConfig } from './glbModels';
import { rexAnims } from './rex';
import type { ChampionVisual } from './types';

/**
 * REX from a GLB, with the procedural model's HEADLINER, animations and sockets:
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

function headlinerMaterials(): Record<string, THREE.Material> {
  return {
    black: toon({ color: 0x16141c, spec: 0.5, specSize: 0.94, rim: 0.6 }),
    gunPurple: toon({ color: 0x4a2a8c, spec: 0.5, rim: 0.55 }),
    glove: toon({ color: 0x17161d, spec: 0.3 }),
    gold: toon({ color: 0xf3c24f, spec: 0.85, specSize: 0.88, shade: 0xffd2a0, rim: 0.4 }),
    neonViolet: neon(0xa46bff, 2.8),
    neonGold: neon(0xffc94a, 2.6),
    eq: equalizerMaterial(0xa46bff, 0xffc94a, 10, 2.8),
  };
}

export function buildRexGlb(gltf: GLTF): ChampionVisual {
  const glb = instantiateGlb(gltf, REX_GLB);
  const rig = glb.rig;
  const WM = headlinerMaterials();
  const b = new ModelBuilder(WM);
  // HEADLINER (same build as src/champions/rex.ts)
  const w = weaponPivot(rig.byName.handR);
  b.add(w, xf(rbox(0.09, 0.13, 0.52, 0.025), [0, 0.06, 0.12]), 'black');
  b.add(w, xf(rbox(0.094, 0.05, 0.4, 0.015), [0, 0.1, 0.14]), 'gunPurple', 0.8);
  b.add(w, xf(rbox(0.07, 0.1, 0.3, 0.02), [0, 0.03, -0.29], [6, 0, 0]), 'gunPurple');
  b.add(w, xf(rbox(0.075, 0.13, 0.04, 0.01), [0, 0.02, -0.44], [6, 0, 0]), 'black', 0.8);
  b.add(w, xf(cyl(0.045, 0.048, 0.46, 16), [0, 0.07, 0.6], [90, 0, 0]), 'black');
  for (const [i, z] of [0.46, 0.6, 0.74].entries()) b.add(w, xf(torus(0.063 - i * 0.004, 0.012, 6, 20), [0, 0.07, z]), 'neonViolet', 0);
  b.add(w, xf(torus(0.058, 0.01, 6, 20), [0, 0.07, 0.84]), 'gold', 0.5);
  b.add(w, xf(lathe([[0.045, 0.0], [0.07, 0.06], [0.074, 0.09], [0.06, 0.1], [0.04, 0.05]], 18), [0, 0.07, 0.83], [90, 0, 0]), 'black', 0.8);
  b.add(w, xf(cyl(0.085, 0.085, 0.07, 20), [0, -0.075, 0.16], [0, 0, 90]), 'black', 0.9);
  for (const sx of [1, -1]) {
    b.add(w, xf(lathe([[0.075, 0.0], [0.05, -0.012], [0.02, -0.018], [0.0, -0.016]], 16), [sx * 0.036, -0.075, 0.16], [0, 0, sx * 90]), 'gunPurple', 0.6);
    b.add(w, xf(cyl(0.02, 0.02, 0.006, 12), [sx * 0.04, -0.075, 0.16], [0, 0, 90]), 'neonGold', 0);
    b.add(w, xf(new THREE.PlaneGeometry(0.26, 0.06), [sx * 0.0465, 0.055, 0.12], [0, sx * 90, 0]), 'eq', 0, false);
  }
  b.add(w, xf(rbox(0.036, 0.12, 0.05, 0.012), [0, -0.035, -0.02], [-14, 0, 0]), 'glove', 0.7);
  b.add(w, xf(rbox(0.032, 0.1, 0.04, 0.01), [0, -0.03, 0.42], [8, 0, 0]), 'glove', 0.7);
  b.add(w, xf(cyl(0.026, 0.026, 0.16, 12), [0, 0.165, 0.12], [90, 0, 0]), 'black', 0.7);
  b.add(w, xf(cyl(0.022, 0.022, 0.004, 12), [0, 0.165, 0.202], [90, 0, 0]), 'neonViolet', 0);
  for (const sx of [1, -1]) b.add(w, xf(rbox(0.004, 0.012, 0.46, 0.002), [sx * 0.047, 0.11, 0.13]), 'gold', 0);
  const muzzle = marker(w, 0, 0.07, 0.95, 'muzzle');
  const offhand = marker(w, 0, 0.02, 0.42, 'offhand');

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
    weaponR: w,
    weaponL: null,
    offhandGrip: offhand,
    muzzle,
    materials: [...glb.materials, ...Object.values(WM)],
    anims: rexAnims(),
    tick: (_dt, _t, energy) => {
      (WM.eq as THREE.ShaderMaterial).uniforms.uEnergy.value = 0.6 + energy * 0.9;
    },
  });
  rig.root.add(glb.scene);
  v.syncPose = glb.syncPose;
  return v;
}
