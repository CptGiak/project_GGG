import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { BONES, Rig, type BodySpec } from '../fighter/Rig';
import type { Pose } from '../fighter/Animator';
import type { BodySphere } from '../fighter/Cloth';
import { neon, outlineMaterialSkinned, toon, type ToonOptions } from '../render/toon';
import type { ClothLike } from './types';

/**
 * Champion models made in Blender from the character sheets (tools/blender/build_<id>.py ->
 * public/models/<id>.glb). They are loaded once at startup; champions without a model (or if the
 * file is missing / fails to load) keep their procedural model.
 *
 * The GLB is bound in T-pose and carries the game skeleton (same bone names, hierarchy and joint
 * positions as Rig.ts, body proportions stored in the extras) plus extra bones: coat flaps and
 * fingers. In game the procedural `Rig` stays the animation driver: locomotion, clips, the weapon
 * IK and the weapons attached to its hands are untouched. After the IK, `syncPose` copies every
 * driver bone onto the GLB bone with the same name (model-space retarget, so the GLB bone axes do
 * not matter), closes the fingers on the grip, and verlet chains swing the coat flaps.
 */

const MODEL_IDS = ['kaiser'] as const;
const cache = new Map<string, GLTF>();

/** Loads the champion GLBs (call before building any visual). Never throws. */
export async function preloadChampionModels(params?: URLSearchParams, timeoutMs = 12000): Promise<void> {
  if (params?.get('models') === '0') return;
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL ?? '/';
  await Promise.all(
    MODEL_IDS.map(async (id) => {
      try {
        const gltf = await Promise.race([
          loader.loadAsync(`${base}models/${id}.glb`),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
        ]);
        cache.set(id, gltf);
      } catch (err) {
        console.info(`[models] ${id}.glb not available, using the procedural model`, err);
      }
    }),
  );
}

export function championModel(id: string): GLTF | undefined {
  return cache.get(id);
}

// ---------------------------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------------------------

export interface GlbMaterialSpec extends Partial<ToonOptions> {
  /** unlit neon (pulses with the music) with this intensity instead of a toon material */
  neon?: number;
  /** alpha-cut texture (decals) */
  alphaTest?: number;
  /** outline width factor, 0 = no outline */
  outline?: number;
}

export interface GlbChampionConfig {
  /** per material name (Blender material names) */
  materials: Record<string, GlbMaterialSpec>;
  /** hands holding a weapon all the time (fingers closed) */
  gripHands: Array<'L' | 'R'>;
}

export interface GlbInstance {
  /** cloned glTF scene: add under rig.root (model space) */
  scene: THREE.Object3D;
  /** driver skeleton with the GLB body proportions */
  rig: Rig;
  materials: THREE.Material[];
  /** sockets from the extras, model space (feet at the origin, +Z forward) */
  sockets: Record<string, THREE.Vector3>;
  /** coat-flap chains; pass the body spheres before use */
  chains: BoneChain[];
  syncPose(pose: Pose): void;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);
const IDENT = new THREE.Quaternion();

/** Driver-rig rotations in the T-pose the GLB is bound in (model space, per BONES index). */
function tposeQuats(): THREE.Quaternion[] {
  const left = new THREE.Quaternion().setFromAxisAngle(AX_Z, Math.PI / 2);
  const right = new THREE.Quaternion().setFromAxisAngle(AX_Z, -Math.PI / 2);
  return BONES.map((b) => {
    if (b === 'upperArmL' || b === 'foreArmL' || b === 'handL') return left.clone();
    if (b === 'upperArmR' || b === 'foreArmR' || b === 'handR') return right.clone();
    return new THREE.Quaternion();
  });
}

interface FingerDef {
  bone: THREE.Bone;
  parent: string;
  hand: 'L' | 'R';
  axis: THREE.Vector3;
  /** degrees at full grip */
  angle: number;
}

export function instantiateGlb(gltf: GLTF, cfg: GlbChampionConfig): GlbInstance {
  const scene = SkeletonUtils.clone(gltf.scene);
  scene.updateMatrixWorld(true);
  const found: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.userData?.ggg_spec) found.push(o);
  });
  const arm = found[0];
  if (!arm) throw new Error('GLB without ggg_spec extras');
  const spec = JSON.parse(arm.userData.ggg_spec as string) as BodySpec;
  const chainData = JSON.parse((arm.userData.ggg_chains as string) ?? '[]') as Array<{ bones: string[]; joints: number[][] }>;
  const socketData = JSON.parse((arm.userData.ggg_sockets as string) ?? '{}') as Record<string, number[]>;
  const rig = new Rig(spec);

  const bone = (name: string): THREE.Bone => {
    const b = scene.getObjectByName(name);
    if (!b) throw new Error(`GLB bone missing: ${name}`);
    return b as THREE.Bone;
  };
  const bindQ = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());
  const glbBones = BONES.map((n) => bone(n));
  const parentIdx = BONES.map((n) => {
    const p = rig.byName[n].parent;
    return p && p !== rig.root ? BONES.indexOf(p.name as (typeof BONES)[number]) : -1;
  });
  // model-space bind rotations of the GLB bones and offsets to the driver's T-pose frames
  const armQ = bindQ(arm);
  const armQinv = armQ.clone().invert();
  const armPos = arm.getWorldPosition(new THREE.Vector3());
  const tpose = tposeQuats();
  const bindB = glbBones.map(bindQ);
  const offset = bindB.map((b, i) => tpose[i].clone().invert().multiply(b));
  const handIdx = { L: BONES.indexOf('handL'), R: BONES.indexOf('handR') };
  const handBindInv = { L: bindB[handIdx.L].clone().invert(), R: bindB[handIdx.R].clone().invert() };

  // fingers (optional bones): curl about the T-pose knuckle axis (+-Z), thumbs about the arm axis
  const fingers: Array<FingerDef & { bind: THREE.Quaternion }> = [];
  for (const s of ['L', 'R'] as const) {
    const sign = s === 'L' ? -1 : 1;
    const defs: Array<[string, string, THREE.Vector3, number]> = [
      [`fingers${s}`, `hand${s}`, AX_Z, 62 * sign],
      [`fingertips${s}`, `fingers${s}`, AX_Z, 132 * sign],
      [`thumb${s}`, `hand${s}`, AX_X, 38],
    ];
    for (const [name, parent, axis, angle] of defs) {
      const b = scene.getObjectByName(name) as THREE.Bone | undefined;
      if (b) fingers.push({ bone: b, parent, hand: s, axis, angle, bind: bindQ(b) });
    }
  }

  // ---- materials ------------------------------------------------------------------------------
  const materials: THREE.Material[] = [];
  const made = new Map<THREE.Material, THREE.Material>();
  const skinned: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    skinned.push(m);
    const src = m.material as THREE.MeshStandardMaterial;
    let mat = made.get(src);
    if (!mat) {
      mat = convertMaterial(src, cfg.materials[src.name] ?? {});
      made.set(src, mat);
      materials.push(mat);
    }
    m.material = mat;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
  });
  // all primitives share one skeleton: compute the bone matrices once per frame
  const skeleton = skinned[0].skeleton;
  for (const m of skinned) if (m.skeleton !== skeleton) m.bind(skeleton, m.bindMatrix);
  // one merged inverted hull for the whole body
  const hull = new THREE.SkinnedMesh(outlineGeometry(gltf, cfg), outlineMaterialSkinned(0x07040c, 2.4, 6));
  hull.name = 'outline';
  hull.frustumCulled = false;
  skinned[0].parent!.add(hull);
  hull.bind(skeleton, skinned[0].bindMatrix);

  // ---- coat chains ------------------------------------------------------------------------------
  const hipsBone = glbBones[0];
  const hipsBindInv = new THREE.Matrix4().copy(hipsBone.matrixWorld).invert();
  const chains = chainData
    .filter((c) => c.joints?.length === c.bones.length + 1)
    .map((c) => new BoneChain(hipsBone, c.bones.map(bone), c.joints.map((j) => new THREE.Vector3(j[0], j[1], j[2]).applyMatrix4(hipsBindInv))));

  const sockets: Record<string, THREE.Vector3> = {};
  for (const [k, v] of Object.entries(socketData)) sockets[k] = new THREE.Vector3(v[0], v[1], v[2]);

  // ---- per-frame retarget -----------------------------------------------------------------------
  const drv = BONES.map(() => new THREE.Quaternion());
  const out = BONES.map(() => new THREE.Quaternion());
  const outFinger = new Map<string, THREE.Quaternion>();
  const grip = { L: cfg.gripHands.includes('L'), R: cfg.gripHands.includes('R') };
  const syncPose = (pose: Pose) => {
    for (let i = 0; i < BONES.length; i++) {
      const pi = parentIdx[i];
      drv[i].copy(pi < 0 ? IDENT : drv[pi]).multiply(rig.bones[i].quaternion);
      out[i].copy(drv[i]).multiply(offset[i]);
      _q.copy(pi < 0 ? armQ : out[pi]).invert();
      glbBones[i].quaternion.copy(_q).multiply(out[i]);
    }
    // hips translation (the only animated position)
    glbBones[0].position.copy(rig.bones[0].position).sub(armPos).applyQuaternion(armQinv);
    // fingers: full grip on weapon hands, the off hand follows the two-handed grip weight
    outFinger.clear();
    for (const f of fingers) {
      const curl = grip[f.hand] ? 1 : 0.22 + 0.78 * pose.off;
      const h = handIdx[f.hand];
      // hand delta from bind * curl (T-pose axes) * finger bind
      _q.copy(out[h]).multiply(handBindInv[f.hand]);
      _q2.setFromAxisAngle(f.axis, THREE.MathUtils.degToRad(f.angle * curl));
      const w = _q.multiply(_q2).multiply(f.bind).clone();
      outFinger.set(f.bone.name, w);
      const pw = outFinger.get(f.parent) ?? out[BONES.indexOf(f.parent as (typeof BONES)[number])];
      f.bone.quaternion.copy(_q2.copy(pw).invert()).multiply(w);
    }
    scene.updateMatrixWorld(true);
  };
  return { scene, rig, materials, sockets, chains, syncPose };
}

function convertMaterial(src: THREE.MeshStandardMaterial, s: GlbMaterialSpec): THREE.Material {
  const color = src.color.clone();
  if (s.neon !== undefined) {
    const m = neon(color.getHex(THREE.LinearSRGBColorSpace), s.neon);
    m.color.copy(color).multiplyScalar(s.neon);
    m.name = src.name;
    return m;
  }
  const m = toon({ ...s, color, map: src.map ?? null });
  if (s.alphaTest !== undefined) {
    m.alphaTest = s.alphaTest;
    m.side = THREE.FrontSide;
  }
  m.name = src.name;
  return m;
}

const hullCache = new WeakMap<GLTF, THREE.BufferGeometry>();

/**
 * All primitives merged into one hull geometry: positions + skin data, normals welded across
 * hard edges / material seams (so the hull has no cracks) and a per-vertex width factor taken from
 * the material spec (decals get none).
 */
function outlineGeometry(gltf: GLTF, cfg: GlbChampionConfig): THREE.BufferGeometry {
  const hit = hullCache.get(gltf);
  if (hit) return hit;
  const parts: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) parts.push(m);
  });
  const pos: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  const width: number[] = [];
  const index: number[] = [];
  for (const m of parts) {
    const spec = cfg.materials[(m.material as THREE.Material).name] ?? {};
    const w = spec.outline ?? 1;
    if (w <= 0) continue;
    const g = m.geometry;
    const base = pos.length / 3;
    const p = g.getAttribute('position');
    const si = g.getAttribute('skinIndex');
    const sw = g.getAttribute('skinWeight');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      skinIndex.push(si.getX(i), si.getY(i), si.getZ(i), si.getW(i));
      skinWeight.push(sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i));
      width.push(w);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) index.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) index.push(base + i);
  }
  // welded smooth normals: accumulate face normals per position
  const key = (i: number) => `${Math.round(pos[i * 3] * 2e4)},${Math.round(pos[i * 3 + 1] * 2e4)},${Math.round(pos[i * 3 + 2] * 2e4)}`;
  const acc = new Map<string, THREE.Vector3>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < index.length; t += 3) {
    a.fromArray(pos, index[t] * 3);
    b.fromArray(pos, index[t + 1] * 3);
    c.fromArray(pos, index[t + 2] * 3);
    const n = new THREE.Vector3().subVectors(c, b).cross(_v.subVectors(a, b));
    for (let k = 0; k < 3; k++) {
      const id = key(index[t + k]);
      const s = acc.get(id);
      if (s) s.add(n);
      else acc.set(id, n.clone());
    }
  }
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < pos.length / 3; i++) {
    const n = acc.get(key(i));
    _v2.copy(n ?? AX_Z).normalize();
    nrm.set([_v2.x, _v2.y, _v2.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geo.setAttribute('aOutline', new THREE.Float32BufferAttribute(width, 1));
  geo.setIndex(index);
  hullCache.set(gltf, geo);
  return geo;
}

// ---------------------------------------------------------------------------------------------
// Coat flaps: verlet chains in world space driving a bone chain
// ---------------------------------------------------------------------------------------------

/**
 * One coat flap: particles at the bone joints, anchored to the hips, pulled toward the bind
 * shape, pushed by the body spheres (legs!) and the wind. Each bone is then aimed at the next
 * particle, so the coat swings on its own instead of riding the thighs.
 */
export class BoneChain implements ClothLike {
  readonly objects: THREE.Object3D[] = [];
  spheres: BodySphere[] = [];
  private p: THREE.Vector3[];
  private prev: THREE.Vector3[];
  private seg: number[];
  private restLocal: THREE.Vector3[];
  private bindLocal: THREE.Quaternion[];
  private axis: THREE.Vector3[];
  private acc = 0;
  private initialized = false;
  private lastAnchor = new THREE.Vector3();
  constructor(
    readonly hips: THREE.Object3D,
    readonly bones: THREE.Bone[],
    /** joint positions in hips-local space (bind), bones.length + 1 */
    joints: THREE.Vector3[],
    readonly opts = { stiffness: 0.12, falloff: 0.55, damping: 0.92, gravity: 9.8 },
  ) {
    this.restLocal = joints;
    this.p = joints.map(() => new THREE.Vector3());
    this.prev = joints.map(() => new THREE.Vector3());
    this.seg = joints.slice(1).map((j, k) => j.distanceTo(joints[k]));
    this.bindLocal = bones.map((b) => b.quaternion.clone());
    // bone-local direction toward the next joint, measured in the bind pose
    hips.updateWorldMatrix(true, true);
    this.axis = bones.map((b, k) => {
      const w = b.getWorldQuaternion(new THREE.Quaternion()).invert();
      const d = joints[k + 1].clone().sub(joints[k]).applyQuaternion(hips.getWorldQuaternion(new THREE.Quaternion()));
      return d.applyQuaternion(w).normalize();
    });
  }

  reset(): void {
    this.initialized = false;
  }

  update(dt: number, wind?: THREE.Vector3): void {
    const n = this.p.length;
    const anchor = this.hips.localToWorld(_v.copy(this.restLocal[0]));
    if (!this.initialized || anchor.distanceToSquared(this.lastAnchor) > 36) {
      for (let i = 0; i < n; i++) {
        this.hips.localToWorld(this.p[i].copy(this.restLocal[i]));
        this.prev[i].copy(this.p[i]);
      }
      this.initialized = true;
    }
    this.lastAnchor.copy(anchor);
    const step = 1 / 90;
    this.acc = Math.min(this.acc + dt, step * 4);
    while (this.acc >= step) {
      this.acc -= step;
      this.simulate(step, wind);
    }
    this.pose();
  }

  private simulate(h: number, wind?: THREE.Vector3): void {
    const { stiffness, falloff, damping, gravity } = this.opts;
    const n = this.p.length;
    this.hips.localToWorld(this.p[0].copy(this.restLocal[0]));
    this.prev[0].copy(this.p[0]);
    const g = gravity * h * h;
    for (let i = 1; i < n; i++) {
      const p = this.p[i];
      _v.subVectors(p, this.prev[i]).multiplyScalar(damping);
      this.prev[i].copy(p);
      p.add(_v);
      p.y -= g;
      if (wind) p.addScaledVector(wind, h * h);
    }
    // shape keeping toward the bind shape (in the hips frame)
    for (let i = 1; i < n; i++) {
      const k = stiffness * (1 - (i / (n - 1)) * falloff);
      this.hips.localToWorld(_v.copy(this.restLocal[i]));
      _v2.copy(this.hips.localToWorld(_v2.copy(this.restLocal[i - 1])));
      _v.sub(_v2).add(this.p[i - 1]);
      this.p[i].lerp(_v, k);
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < n; i++) {
        const a = this.p[i - 1];
        const b = this.p[i];
        _v.subVectors(b, a);
        const d = _v.length() || 1e-6;
        const diff = (d - this.seg[i - 1]) / d;
        if (i === 1) b.addScaledVector(_v, -diff);
        else {
          a.addScaledVector(_v, diff * 0.5);
          b.addScaledVector(_v, -diff * 0.5);
        }
      }
      for (const s of this.spheres) {
        for (let i = 1; i < n; i++) {
          const p = this.p[i];
          _v.subVectors(p, s.world);
          const d2 = _v.lengthSq();
          if (d2 < s.radius * s.radius) {
            const d = Math.sqrt(d2) || 1e-6;
            p.addScaledVector(_v, (s.radius - d) / d);
          }
        }
      }
    }
  }

  /** aim every bone at the next particle */
  private pose(): void {
    const parentW = this.hips.getWorldQuaternion(new THREE.Quaternion());
    for (let k = 0; k < this.bones.length; k++) {
      const rest = _q.copy(parentW).multiply(this.bindLocal[k]);
      const cur = _v.copy(this.axis[k]).applyQuaternion(rest);
      const want = _v2.subVectors(this.p[k + 1], this.p[k]).normalize();
      _q2.setFromUnitVectors(cur, want).multiply(rest);
      this.bones[k].quaternion.copy(parentW.clone().invert().multiply(_q2));
      parentW.copy(_q2);
    }
    this.bones[0].updateMatrixWorld(true);
  }
}
