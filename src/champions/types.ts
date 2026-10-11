import type * as THREE from 'three';
import type { Rig } from '../fighter/Rig';
import type { BodySphere } from '../fighter/Cloth';
import type { Pose } from '../fighter/Animator';
import type { ChampionAnimSet } from '../fighter/locomotion';

export interface BladeRef {
  base: THREE.Object3D;
  tip: THREE.Object3D;
  colorA: THREE.Color;
  colorB: THREE.Color;
  width?: number;
}

/** Secondary-motion simulation driven every frame (cloth meshes, bone chains). */
export interface ClothLike {
  update(dt: number, wind?: THREE.Vector3): void;
  reset(): void;
  /** world-space render objects to add to the scene (none for bone-driven chains) */
  readonly objects: THREE.Object3D[];
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
  cloth: ClothLike[];
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
  /** tints the weapon glow (element enchantments...), null = back to normal */
  weaponGlow?(color: THREE.ColorRepresentation | null): void;
  /** shows or hides a named prop of the model (Pooh's throwing pot...) */
  prop?(name: string, on: boolean): void;
  /** sees every animation event of its clips first (facial swaps such as Pooh shutting his eyes) */
  onAnimEvent?(ev: string): void;
  /**
   * Scales the positional parts of the animations (weapon targets, hip offsets) when a body
   * uses the clips of a champion with different proportions (imported models). Default 1.
   */
  animScale?: number;
  /**
   * Called after the animation pose and the weapon IK are applied to `rig` (before cloth):
   * skinned models copy the driver skeleton onto their own bones here.
   */
  syncPose?(pose: Pose): void;
}
