import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { CHAMPIONS, kitOf, type ChampionId } from '../../shared/champions';
import { ModelBuilder } from '../fighter/ModelBuilder';
import type { BodySphere } from '../fighter/Cloth';
import { addOutline, toon } from '../render/toon';
import { makeBodySpheres } from './body';
import { assembleVisual, marker, weaponPivot } from './common';
import { instantiateGlb, type GlbMaterialSpec } from './glbModels';
import { kaiserAnims } from './kaiser';
import { novaAnims } from './nova';
import type { BladeRef, ChampionVisual } from './types';

/**
 * Champions imported from League of Legends (tools/blender/build_lol.py, public/models/lol/<id>.glb,
 * local files only): original mesh and textures, the game skeleton rebuilt from the skin weights,
 * the League weapons in the weapon pivots. They play with the kit of an original champion
 * (shared/champions.ts KIT_OF): same clips, IK and gameplay, scaled to the body (animScale).
 */

/** hand-painted textures already carry their lighting: soft toon on top */
const LOL_MATERIAL: GlbMaterialSpec = { rim: 0.05, rimCut: 0.72, spec: 0.08, specSize: 0.94 };

/** left-hand grip for two-handed moves, in the right weapon's pivot frame (kits with offhandGrip) */
const OFFHAND: Partial<Record<ChampionId, [number, number, number]>> = {
  // ring blade: on the rim, 30 degrees away from the main grip
  qiyana: [0, 0.2, 0.054],
};

export function buildLolGlb(id: ChampionId, gltf: GLTF): ChampionVisual {
  const kit = kitOf(id);
  const dual = kit === 'nova';
  const glb = instantiateGlb(gltf, { gripHands: dual ? ['L', 'R'] : ['R'], materials: {}, defaultMaterial: LOL_MATERIAL });
  const rig = glb.rig;
  const female = rig.spec.female;
  const source = (glb.extras.source ?? {}) as { animScale?: number };
  const colors = CHAMPIONS[id].colors;

  // driver pivots for the kit's weapon IK, visible weapons on the model's own hands
  const drvR = weaponPivot(rig.byName.handR, female);
  const drvL = dual ? weaponPivot(rig.byName.handL, female) : null;
  const meshes: Partial<Record<'L' | 'R', THREE.Mesh>> = {};
  glb.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && /^weapon_[LR]$/.test(m.name)) meshes[m.name.slice(-1) as 'L' | 'R'] = m;
  });
  const materials: THREE.Material[] = [...glb.materials];
  const blades: BladeRef[] = [];
  for (const side of ['R', 'L'] as const) {
    const w = meshes[side];
    if (!w) continue;
    w.removeFromParent();
    if (side === 'L' && !dual) continue;
    w.position.set(0, 0, 0);
    w.quaternion.identity();
    w.scale.set(1, 1, 1);
    const src = w.material as THREE.MeshStandardMaterial;
    const mat = toon({ color: 0xffffff, map: src.map ?? null, spec: 0.55, specSize: 0.9, rim: 0.5 });
    mat.name = src.name;
    w.material = mat;
    w.castShadow = true;
    w.frustumCulled = false;
    materials.push(mat);
    addOutline(w, 1.8);
    const pivot = glb.handPivot(side, female);
    pivot.add(w);
    // slash trail from near the grip to the farthest point of the weapon (blade tip, ring rim)
    const pos = w.geometry.getAttribute('position');
    const tip = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.lengthSq() > tip.lengthSq()) tip.copy(v);
    }
    const base = tip.clone().multiplyScalar(0.3);
    blades.push({
      base: marker(pivot, base.x, base.y, base.z, 'base'),
      tip: marker(pivot, tip.x, tip.y, tip.z, 'tip'),
      colorA: new THREE.Color(side === 'R' ? colors[0] : colors[1]),
      colorB: new THREE.Color(0xffffff),
      width: 1,
    });
  }
  const off = OFFHAND[id];
  const offhandGrip = !dual ? marker(drvR, ...(off ?? [0, 0.05, -0.115]), 'offhand') : null;

  // gameplay sockets (grapple launchers, gas nozzle) on the hips
  const hipH = rig.hipHeight;
  const socket = (k: string, fallback: [number, number, number]) => {
    const p = glb.sockets[k] ?? new THREE.Vector3(...fallback);
    return marker(rig.byName.hips, p.x, p.y - hipH, p.z, k);
  };
  // coat tails swing off the legs, hair off the head and the back
  const spheres: BodySphere[] = makeBodySpheres(rig);
  const headSphere: BodySphere = { bone: rig.byName.head, offset: new THREE.Vector3(0, 0.1, 0.0), radius: 0.12, world: new THREE.Vector3() };
  for (const c of glb.chains) c.spheres = [...spheres, headSphere];

  const v = assembleVisual({
    rig,
    builder: new ModelBuilder({}),
    cloth: glb.chains,
    bodySpheres: [...spheres, headSphere],
    blades,
    gear: { gearL: socket('gearL', [0.2, hipH, 0.05]), gearR: socket('gearR', [-0.2, hipH, 0.05]), nozzle: socket('nozzle', [0, hipH + 0.08, -0.16]) },
    weaponR: drvR,
    weaponL: drvL,
    offhandGrip,
    muzzle: blades[0]?.tip ?? null,
    materials,
    anims: dual ? novaAnims() : kaiserAnims(),
  });
  rig.root.add(glb.scene);
  v.syncPose = glb.syncPose;
  v.animScale = source.animScale ?? 1;
  return v;
}
