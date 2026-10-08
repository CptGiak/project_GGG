import type * as THREE from 'three';
import type { Rig } from '../fighter/Rig';
import type { BodySphere, ClothChain, ClothSheet } from '../fighter/Cloth';
import type { ChampionAnimSet } from '../fighter/locomotion';

export interface BladeRef {
  base: THREE.Object3D;
  tip: THREE.Object3D;
  colorA: THREE.Color;
  colorB: THREE.Color;
  width?: number;
}

/** Everything the game needs from a champion's 3D model. */
export interface ChampionVisual {
  rig: Rig;
  /** top-level group, positioned at the fighter's feet, yawed by the fighter */
  root: THREE.Group;
  /** bank / pitch pivot at hip height (child of root) */
  pivot: THREE.Group;
  /** objects simulated in world space (cloth); add them to the scene directly */
  worldObjects: THREE.Object3D[];
  cloth: Array<ClothChain | ClothSheet>;
  bodySpheres: BodySphere[];
  blades: BladeRef[];
  /** hook launch points on the ODM gear */
  gearL: THREE.Object3D;
  gearR: THREE.Object3D;
  /** gas thruster nozzle */
  nozzle: THREE.Object3D;
  /** main weapon pivot (child of the right hand) */
  weaponR: THREE.Object3D | null;
  weaponL: THREE.Object3D | null;
  /** IK target for the left hand on two-handed weapons */
  offhandGrip: THREE.Object3D | null;
  /** muzzle / projectile spawn point */
  muzzle: THREE.Object3D | null;
  /** every toon material of the model (hit flash, dissolve) */
  materials: THREE.Material[];
  /** called every frame for champion-specific idle effects (weapon glow, floating rings...) */
  tick(dt: number, time: number, energy: number): void;
  anims: ChampionAnimSet;
}
