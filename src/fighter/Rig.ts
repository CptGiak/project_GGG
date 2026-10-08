import * as THREE from 'three';

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'foreArmL', 'handL',
  'shoulderR', 'upperArmR', 'foreArmR', 'handR',
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
] as const;

export type BoneName = (typeof BONES)[number];
export const BONE_COUNT = BONES.length;
export const BONE_INDEX: Record<BoneName, number> = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

const PARENT: Record<BoneName, BoneName | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  shoulderL: 'chest',
  upperArmL: 'shoulderL',
  foreArmL: 'upperArmL',
  handL: 'foreArmL',
  shoulderR: 'chest',
  upperArmR: 'shoulderR',
  foreArmR: 'upperArmR',
  handR: 'foreArmR',
  thighL: 'hips',
  shinL: 'thighL',
  footL: 'shinL',
  thighR: 'hips',
  shinR: 'thighR',
  footR: 'shinR',
};

/**
 * Body proportions. The character faces +Z, +X is the character's LEFT, +Y up.
 * At rest every bone has identity rotation; limbs hang straight down along -Y.
 */
export interface BodySpec {
  /** pelvis height from the ground (also sets leg length) */
  hipHeight: number;
  spineLen: number;
  chestLen: number;
  neckLen: number;
  clavicle: number;
  shoulderDrop: number;
  upperArm: number;
  foreArm: number;
  hipWidth: number;
  thigh: number;
  shin: number;
  footHeight: number;
  /** overall muscle / volume multiplier */
  bulk: number;
  female: boolean;
}

export function bodySpec(kind: 'male' | 'female' | 'heavy'): BodySpec {
  if (kind === 'female') {
    return {
      hipHeight: 0.93, spineLen: 0.1, chestLen: 0.15, neckLen: 0.17, clavicle: 0.165, shoulderDrop: 0.13,
      upperArm: 0.26, foreArm: 0.24, hipWidth: 0.09, thigh: 0.42, shin: 0.42, footHeight: 0.075, bulk: 0.86, female: true,
    };
  }
  if (kind === 'heavy') {
    return {
      hipHeight: 0.99, spineLen: 0.11, chestLen: 0.18, neckLen: 0.19, clavicle: 0.205, shoulderDrop: 0.15,
      upperArm: 0.29, foreArm: 0.27, hipWidth: 0.105, thigh: 0.44, shin: 0.44, footHeight: 0.08, bulk: 1.12, female: false,
    };
  }
  return {
    hipHeight: 0.99, spineLen: 0.11, chestLen: 0.17, neckLen: 0.19, clavicle: 0.19, shoulderDrop: 0.145,
    upperArm: 0.285, foreArm: 0.265, hipWidth: 0.098, thigh: 0.44, shin: 0.44, footHeight: 0.08, bulk: 1.0, female: false,
  };
}

export class Rig {
  readonly root = new THREE.Group();
  readonly bones: THREE.Object3D[] = [];
  readonly byName = {} as Record<BoneName, THREE.Object3D>;
  /** rest local positions, used to re-apply hip offsets every frame */
  readonly restPos: THREE.Vector3[] = [];
  constructor(readonly spec: BodySpec) {
    const s = spec;
    const pos: Record<BoneName, [number, number, number]> = {
      hips: [0, s.hipHeight, 0],
      spine: [0, s.spineLen, -0.005],
      chest: [0, s.chestLen, 0.0],
      neck: [0, s.shoulderDrop + 0.045, -0.01],
      head: [0, s.neckLen - 0.11, 0.012],
      shoulderL: [0.035, s.shoulderDrop, -0.01],
      upperArmL: [s.clavicle - 0.035, -0.01, 0],
      foreArmL: [0, -s.upperArm, 0],
      handL: [0, -s.foreArm, 0],
      shoulderR: [-0.035, s.shoulderDrop, -0.01],
      upperArmR: [-(s.clavicle - 0.035), -0.01, 0],
      foreArmR: [0, -s.upperArm, 0],
      handR: [0, -s.foreArm, 0],
      thighL: [s.hipWidth, -0.045, 0],
      shinL: [0, -s.thigh, 0],
      footL: [0, -s.shin, 0],
      thighR: [-s.hipWidth, -0.045, 0],
      shinR: [0, -s.thigh, 0],
      footR: [0, -s.shin, 0],
    };
    // make the feet touch the ground exactly
    const legDrop = 0.045 + s.thigh + s.shin + s.footHeight;
    pos.hips[1] = legDrop;

    for (const name of BONES) {
      const b = new THREE.Object3D();
      b.name = name;
      b.position.set(...pos[name]);
      b.rotation.order = 'YXZ';
      this.bones.push(b);
      this.byName[name] = b;
      this.restPos.push(b.position.clone());
    }
    for (const name of BONES) {
      const p = PARENT[name];
      (p ? this.byName[p] : this.root).add(this.byName[name]);
    }
  }

  get hipHeight(): number {
    return this.restPos[0].y;
  }
}
