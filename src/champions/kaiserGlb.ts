import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ModelBuilder } from '../fighter/ModelBuilder';
import { makeBodySpheres } from './body';
import { assembleVisual, marker } from './common';
import { addBassline, kaiserAnims, kaiserWeaponMaterials } from './kaiser';
import { instantiateGlb, type GlbChampionConfig } from './glbModels';
import type { ChampionVisual } from './types';

/**
 * KAISER from public/models/kaiser.glb (tools/blender/build_kaiser.py): the sheet-matched
 * model with the same animations, weapon and gameplay sockets as the procedural one.
 * Toon settings per Blender material; colours come from the GLB (sampled from the sheets).
 */
const KAISER_GLB: GlbChampionConfig = {
  gripHands: ['R'],
  materials: {
    coat: { rim: 0.85, rimCut: 0.62 },
    lining: { rim: 0.2 },
    top: { rim: 0.6, rimCut: 0.64 },
    pants: { rim: 0.7, rimCut: 0.62 },
    boots: { spec: 0.35, rim: 0.5 },
    sole: { outline: 0.8 },
    glove: { spec: 0.3, outline: 0.8 },
    gold: { spec: 0.85, specSize: 0.88, shade: 0xffd2a0, rim: 0.4, outline: 0.55 },
    metal: { spec: 0.6, specSize: 0.9, rim: 0.5 },
    metal_hi: { spec: 0.4 },
    canister: { spec: 0.5, rim: 0.4, outline: 0.8 },
    dial: { rim: 0, outline: 0.6 },
    strap: { spec: 0.3, rim: 0.4, outline: 0.7 },
    mask: { spec: 0.7, specSize: 0.9, outline: 0.9 },
    skin: { shade: 0xffc8c0, rim: 0.3, outline: 0.8 },
    face: { shade: 0xffc8c0, rim: 0.3, outline: 0.8 },
    hair: { shade: 0xb4aee8, hairBand: 0.45, rim: 0.5, outline: 0.85 },
    emblem: { alphaTest: 0.5, rim: 0.3, outline: 0 },
    pendant: { neon: 2.4, outline: 0 },
  },
};

export function buildKaiserGlb(gltf: GLTF): ChampionVisual {
  const glb = instantiateGlb(gltf, KAISER_GLB);
  const rig = glb.rig;
  const WM = kaiserWeaponMaterials();
  const b = new ModelBuilder(WM);
  const { weapon, bladeBase, bladeTip, offhandGrip } = addBassline(b, rig.byName.handR);
  const spheres = makeBodySpheres(rig);
  for (const c of glb.chains) c.spheres = spheres;
  // grapple launchers / gas nozzle on the hips, where the model has its canisters
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
    blades: [{ base: bladeBase, tip: bladeTip, colorA: new THREE.Color(0xff2e88), colorB: new THREE.Color(0xffc24a), width: 1 }],
    gear: { gearL: socket('gearL', [0.22, 1.03, 0.13]), gearR: socket('gearR', [-0.22, 1.03, 0.13]), nozzle: socket('nozzle', [0, 1.05, -0.21]) },
    weaponR: weapon,
    weaponL: null,
    offhandGrip,
    muzzle: bladeTip,
    materials: [...glb.materials, ...Object.values(WM)],
    anims: kaiserAnims(),
    tick: (_dt, _t, energy) => {
      (WM.eq as THREE.ShaderMaterial).uniforms.uEnergy.value = 0.6 + energy * 0.9;
    },
  });
  rig.root.add(glb.scene);
  v.syncPose = glb.syncPose;
  return v;
}
