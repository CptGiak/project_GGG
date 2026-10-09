import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionWorld } from './Collision';
import { outlineMaterial, smoothNormalGeometry, ToonEnv } from '../render/toon';
import { Rng } from '../core/Random';
import { mergeNonIndexed } from '../fighter/shapes';
import { Beat } from '../core/Beat';
import { kitNow, whenKit, type ArtTheme, type Kit } from './ArenaArt';

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

interface KitPlacement {
  name: string;
  m: THREE.Matrix4;
  outline: number;
}

export interface SignStyle {
  /** face colour */
  bg: string;
  /** text colour */
  fg: string;
  /** stack the characters (tategaki) */
  vertical?: boolean;
  font?: string;
}

interface SignFace {
  key: string;
  text: string;
  style: SignStyle;
  w: number;
  h: number;
  m: THREE.Matrix4;
  intensity: number;
}

/** texels per metre of sign face */
const SIGN_PX = 40;
const SIGN_FONT = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Anton", "Impact", sans-serif';

/** static geometry is batched per material AND per spatial chunk so frustum culling works */
const CHUNK = 56;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

function compose(pos: THREE.Vector3 | [number, number, number], rot: [number, number, number], scale: number | [number, number, number], out: THREE.Matrix4): THREE.Matrix4 {
  const p = Array.isArray(pos) ? _p.set(pos[0], pos[1], pos[2]) : _p.copy(pos);
  _e.set(rot[0], rot[1], rot[2], 'YXZ');
  _q.setFromEuler(_e);
  if (typeof scale === 'number') _s.set(scale, scale, scale);
  else _s.set(scale[0], scale[1], scale[2]);
  return out.compose(p, _q, _s);
}

const SIDES: Array<[number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

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
  private kitTheme: ArtTheme | null = null;
  private placements: KitPlacement[] = [];
  private signFaces: SignFace[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  /** Add a static geometry (already in local space) with a world transform. */
  addStatic(geo: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3 | [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: number | [number, number, number] = 1, outline = 0): void {
    this.addStaticMatrix(geo, mat, compose(pos, rot, scale, _m), outline);
  }

  /** Same as addStatic with a ready-made world matrix. */
  addStaticMatrix(geo: THREE.BufferGeometry, mat: THREE.Material, matrix: THREE.Matrix4, outline = 0): void {
    const g = geo.clone().applyMatrix4(matrix);
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
      const o = smoothNormalGeometry(geo).clone().applyMatrix4(matrix);
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
  sign(text: string, color: string, center: [number, number, number], size: [number, number], yaw: number, intensity = 2.2, opts: { font?: string; bg?: string } = {}): THREE.Mesh {
    const aspect = size[0] / size[1];
    const tex = ArenaBuilder.neonTexture(text, color, { w: Math.min(1024, Math.round(256 * aspect)), h: 256, font: opts.font, bg: opts.bg });
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(color).multiplyScalar(intensity), depthWrite: false, side: THREE.DoubleSide, fog: true });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), mat);
    m.position.set(...center);
    m.rotation.y = yaw;
    this.root.add(m);
    return m;
  }

  // ---------------------------------------------------------------------------------------------
  // Blender art (kit pieces, tiled facades, lightbox signs)
  // ---------------------------------------------------------------------------------------------

  /** Kit GLB used by piece() (see ArenaArt). */
  useKit(theme: ArtTheme): void {
    this.kitTheme = theme;
  }

  /**
   * Places a Blender kit piece (visual only: colliders stay explicit so gameplay shapes never depend
   * on the art). Origin at the piece's bottom centre, front towards +Z before `rot`.
   */
  piece(name: string, pos: THREE.Vector3 | [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: number | [number, number, number] = 1, outline = 0): void {
    this.placements.push({ name, m: compose(pos, rot, scale, new THREE.Matrix4()), outline });
  }

  private addPieces(kit: Kit): void {
    for (const p of this.placements) {
      const kp = kit.pieces.get(p.name);
      if (!kp) {
        console.info(`[arena art] missing kit piece ${p.name}`);
        continue;
      }
      if (kp.atlas) this.addStaticMatrix(kp.atlas, kit.atlasMat, p.m, p.outline);
      if (kp.glow) this.addStaticMatrix(kp.glow, kit.glowMat, p.m, 0);
    }
  }

  /**
   * Box whose side UVs count texture tiles, measured from the face's left edge and from world height
   * `v0`: a facade tile of `tileW` x `tileH` metres repeats exactly, so windows line up on every
   * floor. Face widths snap to whole half-tiles (one bay) so no window is cut at a corner. `seed`
   * shifts the UVs by whole tiles (same look, different lit windows). Bottom face omitted.
   */
  static tiledBox(w: number, h: number, d: number, tileW: number, tileH: number, v0: number, seed: number, top = false): THREE.BufferGeometry {
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const quad = (a: number[], b: number[], c: number[], e: number[], n: number[], ua: number[], ub: number[], uc: number[], ue: number[]) => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...e);
      for (let i = 0; i < 6; i++) nor.push(...n);
      uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ue);
    };
    const hw = w / 2;
    const hd = d / 2;
    const y0 = -h / 2;
    const y1 = h / 2;
    SIDES.forEach(([nx, , nz], i) => {
      // right = up x n
      const rx = nz;
      const rz = -nx;
      const half = nx !== 0 ? hd : hw;
      const off = nx !== 0 ? hw : hd;
      const width = half * 2;
      const tiles = Math.max(1, Math.round((width / tileW) * 2)) / 2;
      const u0 = Math.floor((seed * 7 + i * 13) % 97);
      const left = [nx * off - rx * half, nz * off - rz * half];
      const right = [nx * off + rx * half, nz * off + rz * half];
      const va = (y0 - v0) / tileH;
      const vb = (y1 - v0) / tileH;
      quad([left[0], y0, left[1]], [right[0], y0, right[1]], [right[0], y1, right[1]], [left[0], y1, left[1]], [nx, 0, nz], [u0, va], [u0 + tiles, va], [u0 + tiles, vb], [u0, vb]);
    });
    if (top) {
      quad([-hw, y1, hd], [hw, y1, hd], [hw, y1, -hd], [-hw, y1, -hd], [0, 1, 0], [0, 0], [w / tileW, 0], [w / tileW, d / tileW], [0, d / tileW]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  }

  /**
   * Lightbox sign (opaque face, text on both sides). The faces of every sign are packed into one
   * canvas atlas at finish(), so all signs cost a single draw call; the body is batched geometry.
   */
  lightbox(text: string, style: SignStyle, center: [number, number, number], size: [number, number, number], yaw: number, body: THREE.Material, intensity = 1.2, outline = 1): void {
    const [w, h, d] = size;
    this.addStatic(new THREE.BoxGeometry(w + 0.18, h + 0.18, d), body, center, [0, yaw, 0], 1, outline);
    const key = `${text}|${style.bg}|${style.fg}|${style.vertical ? 1 : 0}|${w.toFixed(2)}x${h.toFixed(2)}`;
    for (const side of [0, Math.PI]) {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(center[0] + Math.sin(yaw + side) * (d / 2 + 0.02), center[1], center[2] + Math.cos(yaw + side) * (d / 2 + 0.02)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + side, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      this.signFaces.push({ key, text, style, w, h, m, intensity });
    }
  }

  private buildSigns(): void {
    if (!this.signFaces.length) return;
    // shelf-pack one image per distinct sign
    const ATLAS_W = 2048;
    const slots = new Map<string, { x: number; y: number; w: number; h: number; face: SignFace }>();
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const f of this.signFaces) {
      if (slots.has(f.key)) continue;
      const pw = Math.min(ATLAS_W, Math.max(16, Math.round(f.w * SIGN_PX)));
      const ph = Math.max(16, Math.round(f.h * SIGN_PX));
      if (x + pw > ATLAS_W) {
        x = 0;
        y += rowH + 2;
        rowH = 0;
      }
      slots.set(f.key, { x, y, w: pw, h: ph, face: f });
      x += pw + 2;
      rowH = Math.max(rowH, ph);
    }
    const atlasH = THREE.MathUtils.ceilPowerOfTwo(y + rowH);
    const c = document.createElement('canvas');
    c.width = ATLAS_W;
    c.height = atlasH;
    const ctx = c.getContext('2d')!;
    for (const s of slots.values()) drawSign(ctx, s.face.text, s.face.style, s.x, s.y, s.w, s.h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    // one quad per face, brightness in the vertex colour
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const v = new THREE.Vector3();
    for (const f of this.signFaces) {
      const s = slots.get(f.key)!;
      const u0 = s.x / ATLAS_W;
      const u1 = (s.x + s.w) / ATLAS_W;
      const v1 = 1 - s.y / atlasH;
      const v0 = 1 - (s.y + s.h) / atlasH;
      const corners: Array<[number, number, number, number]> = [
        [-f.w / 2, -f.h / 2, u0, v0],
        [f.w / 2, -f.h / 2, u1, v0],
        [f.w / 2, f.h / 2, u1, v1],
        [-f.w / 2, f.h / 2, u0, v1],
      ];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const [cx, cy, cu, cv] = corners[i];
        v.set(cx, cy, 0).applyMatrix4(f.m);
        pos.push(v.x, v.y, v.z);
        uv.push(cu, cv);
        col.push(f.intensity, f.intensity, f.intensity);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, fog: true }));
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    this.signFaces = [];
  }

  /** Merges the pending batches into meshes under `target`. */
  private mergeBatches(target: THREE.Object3D): void {
    for (const b of this.batches.values()) {
      const merged = mergeNonIndexed(b.geos);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      target.add(mesh);
      if (b.outline.length) {
        const og = mergeGeometries(b.outline, false);
        if (og) {
          og.computeBoundingSphere();
          const om = new THREE.Mesh(og, outlineMaterial(0x05030a, 2.0, 30));
          om.matrixAutoUpdate = false;
          target.add(om);
        }
      }
    }
    this.batches.clear();
  }

  /** Merge every batch into meshes and return the finished arena. */
  finish(args: { id: string; name: string; mood: ArenaMood; sky: THREE.Material; extraTick?: (dt: number, t: number) => void; sunColor?: THREE.ColorRepresentation }): Arena {
    // kit pieces join the same batches when the GLB is already loaded, otherwise they arrive later
    const kit = this.kitTheme ? kitNow(this.kitTheme) : null;
    if (kit) this.addPieces(kit);
    this.mergeBatches(this.root);
    this.buildSigns();
    let disposed = false;
    if (this.kitTheme && !kit && this.placements.length) {
      whenKit(this.kitTheme, (k) => {
        if (!k || disposed) return;
        const late = new THREE.Group();
        this.addPieces(k);
        this.mergeBatches(late);
        this.root.add(late);
      });
    }
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
    // stage screens / equalizers bounce with the music
    const eqs = new Set<{ value: number }>();
    this.root.traverse((o) => {
      const u = ((o as THREE.Mesh).material as THREE.ShaderMaterial | undefined)?.uniforms?.uEnergy as { value: number } | undefined;
      if (u) eqs.add(u);
    });
    if (eqs.size) {
      const base = new Map([...eqs].map((u) => [u, u.value] as const));
      this.tickers.push(() => {
        for (const [u, v] of base) u.value = v * (0.85 + Beat.kick * 0.55 + Beat.snare * 0.3);
      });
    }
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
        disposed = true;
        this.root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        });
      },
    };
  }
}

/** Paints a lightbox face: flat colour, thin inner border, bold text (stacked when vertical). */
function drawSign(ctx: CanvasRenderingContext2D, text: string, style: SignStyle, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = style.bg;
  ctx.fillRect(x, y, w, h);
  const inset = Math.max(2, Math.min(w, h) * 0.06);
  ctx.strokeStyle = style.fg;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, inset * 0.25);
  ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = style.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const font = style.font ?? SIGN_FONT;
  if (style.vertical) {
    const chars = [...text];
    const cell = Math.min((h - inset * 3) / chars.length, w * 0.78);
    ctx.font = `900 ${Math.floor(cell * 0.86)}px ${font}`;
    const top = y + (h - cell * chars.length) / 2 + cell / 2;
    chars.forEach((ch, i) => ctx.fillText(ch, x + w / 2, top + i * cell));
  } else {
    let size = Math.floor(h * 0.6);
    ctx.font = `900 ${size}px ${font}`;
    const max = w - inset * 4;
    const tw = ctx.measureText(text).width;
    if (tw > max) {
      size = Math.floor((size * max) / tw);
      ctx.font = `900 ${size}px ${font}`;
    }
    ctx.fillText(text, x + w / 2, y + h / 2 + h * 0.03);
  }
  ctx.restore();
}

/** Applies an arena's mood to the global toon uniforms and scene fog. */
export function applyMood(scene: THREE.Scene, mood: ArenaMood): void {
  ToonEnv.shade.value.set(mood.shade);
  ToonEnv.lit.value.set(mood.lit);
  ToonEnv.rimColor.value.set(mood.rim);
  scene.fog = new THREE.Fog(mood.fog, mood.fogNear, mood.fogFar);
  scene.background = new THREE.Color(mood.fog);
}
