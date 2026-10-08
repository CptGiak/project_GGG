import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionWorld } from './Collision';
import { outlineMaterial, smoothNormalGeometry, ToonEnv } from '../render/toon';
import { Rng } from '../core/Random';
import { mergeNonIndexed } from '../fighter/shapes';

export interface SpawnPoint {
  pos: THREE.Vector3;
  yaw: number;
}

export interface ArenaMood {
  shade: THREE.ColorRepresentation;
  lit: THREE.ColorRepresentation;
  rim: THREE.ColorRepresentation;
  fog: THREE.ColorRepresentation;
  fogNear: number;
  fogFar: number;
  sunDir: THREE.Vector3;
  speedLines: THREE.ColorRepresentation;
  /** post grade tint */
  tint?: THREE.ColorRepresentation;
}

export interface Arena {
  id: string;
  name: string;
  root: THREE.Group;
  world: CollisionWorld;
  spawns: SpawnPoint[];
  mood: ArenaMood;
  sun: THREE.DirectionalLight;
  /** animated bits (spinning lights, holograms) */
  tick(dt: number, time: number): void;
  dispose(): void;
}

interface Batch {
  mat: THREE.Material;
  geos: THREE.BufferGeometry[];
  outline: THREE.BufferGeometry[];
}

/** static geometry is batched per material AND per spatial chunk so frustum culling works */
const CHUNK = 56;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

/**
 * Accumulates static geometry per material (merged at the end -> few draw calls), creates the
 * matching colliders, and offers higher-level helpers (buildings, platforms, neon signs).
 */
export class ArenaBuilder {
  readonly root = new THREE.Group();
  readonly world = new CollisionWorld();
  readonly spawns: SpawnPoint[] = [];
  readonly rng: Rng;
  private batches = new Map<string, Batch>();
  private matIds = new Map<THREE.Material, number>();
  readonly tickers: Array<(dt: number, t: number) => void> = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  /** Add a static geometry (already in local space) with a world transform. */
  addStatic(geo: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3 | [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: number | [number, number, number] = 1, outline = 0): void {
    const p = Array.isArray(pos) ? _p.set(pos[0], pos[1], pos[2]) : _p.copy(pos);
    _e.set(rot[0], rot[1], rot[2], 'YXZ');
    _q.setFromEuler(_e);
    if (typeof scale === 'number') _s.set(scale, scale, scale);
    else _s.set(scale[0], scale[1], scale[2]);
    _m.compose(p, _q, _s);
    const g = geo.clone().applyMatrix4(_m);
    g.computeBoundingBox();
    const c = g.boundingBox!.getCenter(_p);
    const size = g.boundingBox!.getSize(_s);
    // very large pieces (floors, rails) get their own chunk key so they don't bloat a cell
    const big = Math.max(size.x, size.z) > CHUNK * 1.5;
    let mid = this.matIds.get(mat);
    if (mid === undefined) this.matIds.set(mat, (mid = this.matIds.size));
    const key = big ? `${mid}:big` : `${mid}:${Math.floor(c.x / CHUNK)}:${Math.floor(c.z / CHUNK)}`;
    let b = this.batches.get(key);
    if (!b) this.batches.set(key, (b = { mat, geos: [], outline: [] }));
    b.geos.push(g);
    if (outline > 0) {
      const o = smoothNormalGeometry(geo).clone().applyMatrix4(_m);
      (o.getAttribute('aOutline') as THREE.BufferAttribute).array.fill(outline);
      b.outline.push(o);
    }
  }

  /** Solid box: visual + collider. */
  box(center: [number, number, number], size: [number, number, number], mat: THREE.Material, opts: { yaw?: number; collide?: boolean; grapple?: boolean; outline?: number; tag?: string } = {}): void {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
    this.addStatic(g, mat, center, [0, opts.yaw ?? 0, 0], 1, opts.outline ?? 1.4);
    if (opts.collide !== false) this.world.addBox(center, size, opts.yaw ?? 0, { grapple: opts.grapple ?? true, tag: opts.tag });
  }

  /** Invisible collider only. */
  collider(center: [number, number, number], size: [number, number, number], opts: { yaw?: number; grapple?: boolean } = {}): void {
    this.world.addBox(center, size, opts.yaw ?? 0, { grapple: opts.grapple ?? false, tag: 'invisible' });
  }

  /** Cylinder (visual) approximated by a box collider. */
  cylinder(center: [number, number, number], r: number, h: number, mat: THREE.Material, opts: { collide?: boolean; seg?: number; outline?: number; rTop?: number } = {}): void {
    const g = new THREE.CylinderGeometry(opts.rTop ?? r, r, h, opts.seg ?? 16);
    this.addStatic(g, mat, center, [0, 0, 0], 1, opts.outline ?? 1.2);
    if (opts.collide !== false) {
      // octagon-ish: two boxes
      const s = r * 1.6;
      this.world.addBox(center, [s, h, s], 0);
      this.world.addBox(center, [s, h, s], Math.PI / 4);
    }
  }

  spawn(x: number, y: number, z: number, faceX = 0, faceZ = 0): void {
    const yaw = Math.atan2(faceX - x, faceZ - z);
    this.spawns.push({ pos: new THREE.Vector3(x, y, z), yaw });
  }

  /** A canvas texture with neon text. */
  static neonTexture(text: string, color: string, opts: { font?: string; w?: number; h?: number; bg?: string; stroke?: string } = {}): THREE.CanvasTexture {
    const w = opts.w ?? 512;
    const h = opts.h ?? 128;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = opts.bg ?? 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = opts.font ?? `900 ${Math.floor(h * 0.62)}px "Anton", "Impact", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = h * 0.12;
    ctx.lineWidth = h * 0.05;
    ctx.strokeStyle = opts.stroke ?? color;
    ctx.strokeText(text, w / 2, h / 2 + h * 0.03);
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = h * 0.05;
    ctx.fillText(text, w / 2, h / 2 + h * 0.03);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /** Emissive sign plane (not batched – textures differ). */
  sign(text: string, color: string, center: [number, number, number], size: [number, number], yaw: number, intensity = 2.2, opts: { font?: string; bg?: string; flicker?: boolean } = {}): THREE.Mesh {
    const aspect = size[0] / size[1];
    const tex = ArenaBuilder.neonTexture(text, color, { w: Math.min(1024, Math.round(256 * aspect)), h: 256, font: opts.font, bg: opts.bg });
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(color).multiplyScalar(intensity), depthWrite: false, side: THREE.DoubleSide, fog: true });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), mat);
    m.position.set(...center);
    m.rotation.y = yaw;
    this.root.add(m);
    if (opts.flicker) {
      const base = mat.color.clone();
      const seed = this.rng.next() * 100;
      this.tickers.push((_dt, t) => {
        const f = Math.sin(t * 13 + seed) > 0.97 || Math.sin(t * 7.3 + seed * 2) > 0.985 ? 0.25 : 1;
        mat.color.copy(base).multiplyScalar(f);
      });
    }
    return m;
  }

  /** Merge every batch into meshes and return the finished arena. */
  finish(args: { id: string; name: string; mood: ArenaMood; sky: THREE.Material; extraTick?: (dt: number, t: number) => void; sunColor?: THREE.ColorRepresentation }): Arena {
    for (const b of this.batches.values()) {
      const mat = b.mat;
      const merged = mergeNonIndexed(b.geos);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      if (b.outline.length) {
        const og = mergeGeometries(b.outline, false);
        if (og) {
          og.computeBoundingSphere();
          const om = new THREE.Mesh(og, outlineMaterial(0x05030a, 2.0, 30));
          om.matrixAutoUpdate = false;
          this.root.add(om);
        }
      }
    }
    this.batches.clear();
    // sky
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), args.sky);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.root.add(sky);
    // key light
    const sun = new THREE.DirectionalLight(args.sunColor ?? 0xffffff, 3);
    sun.position.copy(args.mood.sunDir).multiplyScalar(120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 1;
    sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.root.add(sun, sun.target);
    const tickers = this.tickers;
    return {
      id: args.id,
      name: args.name,
      root: this.root,
      world: this.world,
      spawns: this.spawns,
      mood: args.mood,
      sun,
      tick: (dt, t) => {
        for (const f of tickers) f(dt, t);
        args.extraTick?.(dt, t);
      },
      dispose: () => {
        this.root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        });
      },
    };
  }
}

/** Applies an arena's mood to the global toon uniforms and scene fog. */
export function applyMood(scene: THREE.Scene, mood: ArenaMood): void {
  ToonEnv.shade.value.set(mood.shade);
  ToonEnv.lit.value.set(mood.lit);
  ToonEnv.rimColor.value.set(mood.rim);
  scene.fog = new THREE.Fog(mood.fog, mood.fogNear, mood.fogFar);
  scene.background = new THREE.Color(mood.fog);
}
