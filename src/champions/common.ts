import * as THREE from 'three';
import { clip, Ease, MASK_UPPER, pose, type Clip, type Pose, type PoseSpec } from '../fighter/Animator';
import type { Rig } from '../fighter/Rig';
import type { BodySphere, ClothChain, ClothSheet } from '../fighter/Cloth';
import type { ModelBuilder } from '../fighter/ModelBuilder';
import type { ChampionAnimSet } from '../fighter/locomotion';
import type { BladeRef, ChampionVisual } from './types';
import { blinker } from './face';
import { Beat } from '../core/Beat';

/** Wraps a built rig into the pivot hierarchy the game expects. */
export function assembleVisual(args: {
  rig: Rig;
  builder: ModelBuilder;
  cloth: Array<ClothChain | ClothSheet>;
  bodySpheres: BodySphere[];
  blades: BladeRef[];
  gear: { gearL: THREE.Object3D; gearR: THREE.Object3D; nozzle: THREE.Object3D };
  weaponR: THREE.Object3D | null;
  weaponL: THREE.Object3D | null;
  offhandGrip: THREE.Object3D | null;
  muzzle: THREE.Object3D | null;
  materials: THREE.Material[];
  anims: ChampionAnimSet;
  tick?: ChampionVisual['tick'];
  /** blinking eye mesh (face.ts) */
  eyes?: THREE.Object3D | null;
}): ChampionVisual {
  const { rig } = args;
  args.builder.build();
  // champions read better against dark arenas: brighter shadow tone + stronger rim
  const seen = new Set<THREE.Material>();
  const boost = (m: THREE.Material) => {
    if (seen.has(m)) return;
    seen.add(m);
    const t = (m as THREE.Material & { userData: { toon?: { shadeMat: { value: THREE.Color }; rim: { value: number } } } }).userData.toon;
    if (!t) return;
    t.shadeMat.value.multiplyScalar(1.22);
    t.rim.value = Math.min(1.2, t.rim.value + 0.25);
  };
  args.materials.forEach(boost);
  for (const c of args.cloth) {
    const mats = (c.mesh.material as THREE.Material | THREE.Material[]);
    (Array.isArray(mats) ? mats : [mats]).forEach(boost);
  }
  const root = new THREE.Group();
  root.name = 'champion';
  const pivot = new THREE.Group();
  pivot.position.y = rig.hipHeight;
  rig.root.position.y = -rig.hipHeight;
  pivot.add(rig.root);
  root.add(pivot);
  const worldObjects: THREE.Object3D[] = [];
  for (const c of args.cloth) worldObjects.push(...c.objects);
  const champTick: ChampionVisual['tick'] = args.tick ?? (() => {});
  const blink = args.eyes ? blinker(args.eyes) : null;
  // True Damage feel: every neon surface and equalizer of the champion pumps with the music
  const neons = args.materials.filter((m): m is THREE.MeshBasicMaterial => (m as THREE.MeshBasicMaterial).isMeshBasicMaterial);
  const eqs = args.materials
    .map((m) => (m as THREE.ShaderMaterial).uniforms?.uEnergy as { value: number } | undefined)
    .filter((u): u is { value: number } => !!u);
  let neonMul = 1;
  let eqAdd = 0;
  const baseTick: ChampionVisual['tick'] = (dt, t, e) => {
    // undo last frame's boost so champion ticks always start from their own values
    for (const m of neons) m.color.multiplyScalar(1 / neonMul);
    for (const u of eqs) u.value -= eqAdd;
    champTick(dt, t, e);
    neonMul = 1 + Beat.pulse * 0.42;
    eqAdd = Beat.kick * 0.8 + Beat.snare * 0.4;
    for (const m of neons) m.color.multiplyScalar(neonMul);
    for (const u of eqs) u.value += eqAdd;
  };
  return {
    rig,
    root,
    pivot,
    worldObjects,
    cloth: args.cloth,
    bodySpheres: args.bodySpheres,
    blades: args.blades,
    gearL: args.gear.gearL,
    gearR: args.gear.gearR,
    nozzle: args.gear.nozzle,
    weaponR: args.weaponR,
    weaponL: args.weaponL,
    offhandGrip: args.offhandGrip,
    muzzle: args.muzzle,
    materials: args.materials,
    tick: blink ? (dt, t, e) => { baseTick(dt, t, e); blink(dt); } : baseTick,
    anims: args.anims,
  };
}

/** Attach a weapon pivot to a hand at the palm centre (weapon +Z runs through the fist). */
export function weaponPivot(hand: THREE.Object3D, female = false): THREE.Group {
  const g = new THREE.Group();
  g.name = `${hand.name}_weapon`;
  g.position.set(0, -0.05 * (female ? 0.88 : 1), 0.006);
  hand.add(g);
  return g;
}

export function marker(parent: THREE.Object3D, x: number, y: number, z: number, name = 'marker'): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

// ---------------------------------------------------------------------------------------------
// Shared reaction clips (FK, weapon IK released)
// ---------------------------------------------------------------------------------------------

export function sharedClips(base: Pose): Record<string, Clip> {
  const hit: PoseSpec = { spine: [-12, 8, 4], chest: [-10, 6, 0], neck: [-8, 0, 0], head: [-14, -10, 6], upperArmL: [-10, 0, 35], upperArmR: [-10, 0, -35], foreArmL: [-30, 0, 0], foreArmR: [-30, 0, 0] };
  const hit2: PoseSpec = { spine: [-6, 4, 2], chest: [-4, 3, 0], head: [-6, -4, 2] };
  return {
    hit: clip('hit', base, [
      [0, {}],
      [0.06, hit, Ease.outCubic],
      [0.32, hit2, Ease.inOut],
      [0.42, {}],
    ], { mask: MASK_UPPER, fadeIn: 0.02, fadeOut: 0.12 }),
    stun: clip('stun', pose({}), [
      [0, { spine: [18, 0, 8], chest: [10, 0, 6], neck: [12, 0, 0], head: [20, 15, 10], upperArmL: [8, 0, 12], upperArmR: [8, 0, -12], foreArmL: [-15, 0, 0], foreArmR: [-15, 0, 0], thighL: [-8, 0, 4], thighR: [6, 0, -4], shinL: [25, 0, 0], shinR: [18, 0, 0], hips: [0, -0.06, 0] }],
      [0.5, { spine: [14, 0, -8], chest: [10, 0, -6], neck: [10, 0, 0], head: [18, -15, -10], upperArmL: [8, 0, 10], upperArmR: [8, 0, -14], foreArmL: [-18, 0, 0], foreArmR: [-12, 0, 0], thighL: [-4, 0, 4], thighR: [4, 0, -4], shinL: [20, 0, 0], shinR: [24, 0, 0], hips: [0, -0.07, 0] }],
      [1.0, { spine: [18, 0, 8], chest: [10, 0, 6], neck: [12, 0, 0], head: [20, 15, 10], upperArmL: [8, 0, 12], upperArmR: [8, 0, -12], foreArmL: [-15, 0, 0], foreArmR: [-15, 0, 0], thighL: [-8, 0, 4], thighR: [6, 0, -4], shinL: [25, 0, 0], shinR: [18, 0, 0], hips: [0, -0.06, 0] }],
    ], { loop: true, fadeIn: 0.1 }),
    death: clip('death', pose({}), [
      [0, {}],
      [0.12, { spine: [-20, 10, 0], chest: [-15, 0, 0], head: [-25, 0, 0], upperArmL: [-30, 0, 50], upperArmR: [-30, 0, -50], hips: [0, 0.02, -0.05] }, Ease.outCubic],
      [0.55, { spine: [35, 0, 0], chest: [20, 0, 0], head: [25, 0, 0], thighL: [-80, 0, 10], thighR: [-70, 0, -10], shinL: [130, 0, 0], shinR: [125, 0, 0], footL: [-50, 0, 0], footR: [-50, 0, 0], upperArmL: [10, 0, 15], upperArmR: [10, 0, -15], foreArmL: [-20, 0, 0], foreArmR: [-20, 0, 0], hips: [0, -0.5, 0.1] }, Ease.inQuad],
      [1.0, { spine: [45, 0, 0], chest: [25, 0, 0], head: [30, 0, 0], thighL: [-85, 0, 10], thighR: [-75, 0, -10], shinL: [140, 0, 0], shinR: [135, 0, 0], footL: [-50, 0, 0], footR: [-50, 0, 0], upperArmL: [15, 0, 10], upperArmR: [15, 0, -10], foreArmL: [-25, 0, 0], foreArmR: [-25, 0, 0], hips: [0, -0.55, 0.12] }],
    ], { fadeIn: 0.05, fadeOut: 0.1 }),
    // tucked somersault pose (the fighter rotates the pivot for the actual roll)
    roll: clip('roll', pose({}), [
      [0, { hips: [0, -0.35, 0], spine: [45, 0, 0], chest: [25, 0, 0], neck: [20, 0, 0], head: [25, 0, 0], thighL: [-120, 0, 8], thighR: [-115, 0, -8], shinL: [140, 0, 0], shinR: [140, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0], upperArmL: [-60, 0, 25], upperArmR: [-60, 0, -25], foreArmL: [-110, 0, 0], foreArmR: [-110, 0, 0], wR: null, wL: null, off: 0 }],
      [0.5, { hips: [0, -0.35, 0], spine: [45, 0, 0], chest: [25, 0, 0], neck: [20, 0, 0], head: [25, 0, 0], thighL: [-120, 0, 8], thighR: [-115, 0, -8], shinL: [140, 0, 0], shinR: [140, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0], upperArmL: [-60, 0, 25], upperArmR: [-60, 0, -25], foreArmL: [-110, 0, 0], foreArmR: [-110, 0, 0], wR: null, wL: null, off: 0 }],
    ], { fadeIn: 0.05, fadeOut: 0.12 }),
    victory: clip('victory', base, [
      [0, {}],
      [0.4, { spine: [-8, 0, 0], chest: [-6, 0, 0], head: [-12, 0, 0] }, Ease.outBack],
      [1.2, { spine: [-6, 0, 0], chest: [-4, 0, 0], head: [-10, 0, 0] }],
    ], { fadeIn: 0.15 }),
  };
}

export function deg(v: number): number {
  return v * THREE.MathUtils.DEG2RAD;
}
