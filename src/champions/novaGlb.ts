import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ModelBuilder } from '../fighter/ModelBuilder';
import type { BodySphere } from '../fighter/Cloth';
import { cyl, extrude, torus, xf } from '../fighter/shapes';
import { holoMaterial, neon, toon } from '../render/toon';
import { makeBodySpheres } from './body';
import { assembleVisual, marker, weaponPivot } from './common';
import { instantiateGlb, type GlbChampionConfig } from './glbModels';
import { novaAnims } from './nova';
import type { BladeRef, ChampionVisual } from './types';

/**
 * NOVA from public/models/generated/nova.glb (?nova=meshy): the model made with Meshy, rigged by
 * tools/blender/import_generated.py (tools/meshy/briefs/nova.json). Ponytail and scarf tails are
 * bone chains in the GLB that swing like the procedural cloth; the twin katanas SYNTH and SAMPLE,
 * the clips and the sockets are the procedural Nova's.
 */
const NOVA_GLB: GlbChampionConfig = {
  gripHands: ['R', 'L'],
  materials: {
    // the Meshy colour map already carries the detail, the toon adds light and rim
    generated: { rim: 0.4, rimCut: 0.66, spec: 0.12, specSize: 0.94 },
  },
};

function katanaMaterials(): Record<string, THREE.Material> {
  return {
    blade: toon({ color: 0x15131c, spec: 0.6, specSize: 0.96, rim: 0.6 }),
    gold: toon({ color: 0xf3c24f, spec: 0.8, specSize: 0.88, shade: 0xffd2a0 }),
    glove: toon({ color: 0x1b1a24, spec: 0.3 }),
    wrap: toon({ color: 0xece8f0, rim: 0.2 }),
    neonCyan: neon(0x2ef2ff, 2.6),
    neonPink: neon(0xff3fd0, 2.6),
    holoCyan: holoMaterial(0x2ef2ff, 0xffffff, { intensity: 2.0, scan: 30, axisZ: true }),
    holoPink: holoMaterial(0xff3fd0, 0xffffff, { intensity: 2.0, scan: 30, axisZ: true }),
  };
}

export function buildNovaGlb(gltf: GLTF): ChampionVisual {
  const glb = instantiateGlb(gltf, NOVA_GLB);
  const rig = glb.rig;
  const M = katanaMaterials();
  const b = new ModelBuilder(M);

  // twin katanas (same build as src/champions/nova.ts)
  const blades: BladeRef[] = [];
  const katana = (hand: THREE.Object3D, holo: string, glow: string, ca: number, cb: number) => {
    const w = weaponPivot(hand, true);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.016);
    shape.quadraticCurveTo(0.45, 0.026, 0.8, 0.05);
    shape.lineTo(0.86, 0.036);
    shape.quadraticCurveTo(0.45, -0.006, 0, -0.016);
    shape.closePath();
    b.add(w, xf(extrude(shape, 0.007, 0.002, 12), [0, 0, 0.11], [0, -90, 0]), 'blade', 0.9);
    const edgeS = new THREE.Shape();
    edgeS.moveTo(0.02, -0.017);
    edgeS.quadraticCurveTo(0.45, -0.009, 0.855, 0.034);
    edgeS.lineTo(0.84, 0.04);
    edgeS.quadraticCurveTo(0.45, 0.0, 0.02, -0.008);
    edgeS.closePath();
    b.add(w, xf(extrude(edgeS, 0.012, 0, 12), [0, 0, 0.11], [0, -90, 0]), glow, 0);
    const holoS = new THREE.Shape();
    holoS.moveTo(0.02, 0.03);
    holoS.quadraticCurveTo(0.45, 0.045, 0.83, 0.075);
    holoS.lineTo(0.88, 0.03);
    holoS.quadraticCurveTo(0.45, -0.035, 0.02, -0.035);
    holoS.closePath();
    b.add(w, xf(extrude(holoS, 0.002, 0, 12), [0, 0, 0.11], [0, -90, 0]), holo, 0, false);
    b.add(w, xf(cyl(0.04, 0.04, 0.012, 8), [0, 0, 0.095], [90, 0, 0], [0.75, 1, 1]), 'gold', 0.6);
    b.add(w, xf(cyl(0.017, 0.018, 0.2, 10), [0, 0, -0.01], [90, 0, 0]), 'glove', 0.7);
    for (const z of [-0.08, -0.03, 0.02, 0.07]) b.add(w, xf(torus(0.019, 0.004, 4, 10), [0, 0, z], [0, 0, 45]), 'wrap', 0.2);
    b.add(w, xf(torus(0.02, 0.006, 5, 12), [0, 0, -0.115], [0, 0, 0]), glow, 0);
    blades.push({ base: marker(w, 0, 0, 0.2, 'base'), tip: marker(w, 0, 0.03, 0.95, 'tip'), colorA: new THREE.Color(ca), colorB: new THREE.Color(cb) });
    return w;
  };
  const wR = katana(rig.byName.handR, 'holoCyan', 'neonCyan', 0x2ef2ff, 0xffffff);
  const wL = katana(rig.byName.handL, 'holoPink', 'neonPink', 0xff3fd0, 0xffffff);

  // ponytail and scarf chains swing off the body and the head
  const spheres = makeBodySpheres(rig);
  const headSphere: BodySphere = { bone: rig.byName.head, offset: new THREE.Vector3(0, 0.11, 0.01), radius: 0.13, world: new THREE.Vector3() };
  for (const c of glb.chains) c.spheres = [...spheres, headSphere];

  const hipH = rig.hipHeight;
  const socket = (k: string, fallback: [number, number, number]) => {
    const p = glb.sockets[k] ?? new THREE.Vector3(...fallback);
    return marker(rig.byName.hips, p.x, p.y - hipH, p.z, k);
  };
  const v = assembleVisual({
    rig,
    builder: b,
    cloth: glb.chains,
    bodySpheres: [...spheres, headSphere],
    blades,
    gear: { gearL: socket('gearL', [0.2, hipH, 0.05]), gearR: socket('gearR', [-0.2, hipH, 0.05]), nozzle: socket('nozzle', [0, hipH + 0.08, -0.16]) },
    weaponR: wR,
    weaponL: wL,
    offhandGrip: null,
    muzzle: blades[0].tip,
    materials: [...glb.materials, ...Object.values(M)],
    anims: novaAnims(),
  });
  rig.root.add(glb.scene);
  v.syncPose = glb.syncPose;
  return v;
}
