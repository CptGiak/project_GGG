import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { CHAMPIONS, type ChampionId } from '../../shared/champions';
import { ModelBuilder } from '../fighter/ModelBuilder';
import type { BodySphere } from '../fighter/Cloth';
import type { ChampionAnimSet } from '../fighter/locomotion';
import { addOutline, toon } from '../render/toon';
import { makeBodySpheres } from './body';
import { assembleVisual, marker, weaponPivot } from './common';
import { instantiateGlb, type GlbMaterialSpec } from './glbModels';
import { akaliAnims, lockeAnims, lolAnimScale, qiyanaAnims } from './lolAnims';
import type { BladeRef, ChampionVisual } from './types';

/**
 * Champions imported from League of Legends (tools/blender/build_lol.py, public/models/lol/<id>.glb):
 * original mesh and textures, the game skeleton rebuilt from the skin weights, the League
 * weapons in the weapon pivots. Each one has its own kit and clips (src/champions/lolAnims.ts),
 * authored for bodySpec('female') and scaled to the model's body (animScale).
 */

/** hand-painted textures already carry their lighting: soft toon on top */
const LOL_MATERIAL: GlbMaterialSpec = { rim: 0.05, rimCut: 0.72, spec: 0.08, specSize: 0.94 };

/** clip set and weapon hands of each port */
const SETUP: Partial<Record<ChampionId, { anims: () => ChampionAnimSet; hands: Array<'L' | 'R'> }>> = {
  akali: { anims: akaliAnims, hands: ['L', 'R'] },
  qiyana: { anims: qiyanaAnims, hands: ['R'] },
  locke: { anims: lockeAnims, hands: ['L', 'R'] },
};

export function buildLolGlb(id: ChampionId, gltf: GLTF): ChampionVisual {
  const setup = SETUP[id] ?? SETUP.akali!;
  const hands = setup.hands;
  const glb = instantiateGlb(gltf, { gripHands: hands, materials: {}, defaultMaterial: LOL_MATERIAL });
  const rig = glb.rig;
  const female = rig.spec.female;
  const colors = CHAMPIONS[id].colors;

  // driver pivots for the clips' weapon IK, visible weapons on the model's own hands
  const drvR = weaponPivot(rig.byName.handR, female);
  const drvL = hands.includes('L') ? weaponPivot(rig.byName.handL, female) : null;
  const meshes: Partial<Record<'L' | 'R', THREE.Mesh>> = {};
  glb.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && /^weapon_[LR]$/.test(m.name)) meshes[m.name.slice(-1) as 'L' | 'R'] = m;
  });
  const materials: THREE.Material[] = [...glb.materials];
  const blades: BladeRef[] = [];
  const glows: THREE.Mesh[] = [];
  for (const side of ['R', 'L'] as const) {
    const w = meshes[side];
    if (!w) continue;
    w.removeFromParent();
    if (!hands.includes(side)) continue;
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
    const glow = glowShell(w);
    pivot.add(glow);
    glows.push(glow);
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

  // weapon enchantment (Qiyana's elements...): additive shell over the weapons, pulsing
  let glowOn = false;
  const tick: ChampionVisual['tick'] = (_dt, time) => {
    if (!glowOn) return;
    for (const g of glows) (g.material as THREE.MeshBasicMaterial).opacity = 0.42 + Math.sin(time * 9) * 0.16;
  };

  const v = assembleVisual({
    rig,
    builder: new ModelBuilder({}),
    cloth: glb.chains,
    bodySpheres: [...spheres, headSphere],
    blades,
    gear: { gearL: socket('gearL', [0.2, hipH, 0.05]), gearR: socket('gearR', [-0.2, hipH, 0.05]), nozzle: socket('nozzle', [0, hipH + 0.08, -0.16]) },
    weaponR: drvR,
    weaponL: drvL,
    offhandGrip: null,
    muzzle: blades[0]?.tip ?? null,
    materials,
    anims: setup.anims(),
    tick,
  });
  rig.root.add(glb.scene);
  v.syncPose = glb.syncPose;
  v.animScale = lolAnimScale(rig.spec);
  v.weaponGlow = (color) => {
    glowOn = color !== null;
    for (const g of glows) {
      g.visible = glowOn;
      if (color !== null) (g.material as THREE.MeshBasicMaterial).color.set(color);
    }
  };
  return v;
}

/** the weapon pushed out along its normals, additive: shown while the weapon is enchanted */
function glowShell(w: THREE.Mesh): THREE.Mesh {
  const geo = w.geometry.clone();
  const pos = geo.getAttribute('position');
  let nrm = geo.getAttribute('normal');
  if (!nrm) {
    geo.computeVertexNormals();
    nrm = geo.getAttribute('normal');
  }
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) + nrm.getX(i) * 0.014, pos.getY(i) + nrm.getY(i) * 0.014, pos.getZ(i) + nrm.getZ(i) * 0.014);
  }
  pos.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const shell = new THREE.Mesh(geo, mat);
  shell.name = `${w.name}_glow`;
  shell.visible = false;
  shell.frustumCulled = false;
  shell.renderOrder = 5;
  return shell;
}
