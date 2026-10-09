import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toon, type ToonMaterial } from '../render/toon';

/**
 * Art made in Blender for the arenas (tools/blender/arenas -> public/models/arenas/):
 *  - texture tiles (facades, floors) with the glow mask in the alpha channel;
 *  - one kit GLB per theme: static pieces (tanks, lamps, trusses...) UV-mapped onto a small palette
 *    atlas, with two materials named `atlas` (cel shaded) and `glow` (unlit).
 *
 * Everything starts loading as soon as this module is imported, so it is normally ready before a
 * match starts. Textures can be used right away (they fill in when loaded); kit pieces placed before
 * the GLB arrives are added to the arena as soon as it does. Missing files only log: the arena keeps
 * its plain geometry.
 */

export type ArtTheme = 'city' | 'stage' | 'tartarus';

export interface KitPiece {
  /** cel-shaded part (palette atlas) */
  atlas: THREE.BufferGeometry | null;
  /** unlit emissive part */
  glow: THREE.BufferGeometry | null;
  /** bounding box of the whole piece (game axes, origin at the bottom centre) */
  bounds: THREE.Box3;
}

export interface Kit {
  pieces: Map<string, KitPiece>;
  atlasMat: ToonMaterial;
  glowMat: THREE.MeshBasicMaterial;
}

const BASE = `${import.meta.env.BASE_URL ?? '/'}models/arenas/`;
const texLoader = new THREE.TextureLoader();
const textures = new Map<string, THREE.Texture>();
const kits = new Map<ArtTheme, Kit | null>();
const kitWaiters = new Map<ArtTheme, Array<(k: Kit | null) => void>>();

/** Repeating sRGB texture from public/models/arenas/<name>.png (cached). */
export function artTexture(name: string, opts: { repeat?: boolean; nearest?: boolean; flipY?: boolean } = {}): THREE.Texture {
  let t = textures.get(name);
  if (t) return t;
  t = texLoader.load(`${BASE}${name}.png`, undefined, undefined, () => console.info(`[arena art] ${name}.png missing`));
  t.colorSpace = THREE.SRGBColorSpace;
  if (opts.flipY === false) t.flipY = false;
  if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (opts.nearest) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  } else {
    t.anisotropy = 8;
  }
  textures.set(name, t);
  return t;
}

/** The theme's kit if it is already loaded. */
export function kitNow(theme: ArtTheme): Kit | null {
  return kits.get(theme) ?? null;
}

/** Calls back with the kit once loaded (null if it failed); immediately when already settled. */
export function whenKit(theme: ArtTheme, cb: (k: Kit | null) => void): void {
  if (kits.has(theme)) {
    cb(kits.get(theme) ?? null);
    return;
  }
  let list = kitWaiters.get(theme);
  if (!list) kitWaiters.set(theme, (list = []));
  list.push(cb);
  loadKit(theme);
}

const loading = new Set<ArtTheme>();

function loadKit(theme: ArtTheme): void {
  if (loading.has(theme) || kits.has(theme)) return;
  loading.add(theme);
  const settle = (k: Kit | null) => {
    kits.set(theme, k);
    for (const cb of kitWaiters.get(theme) ?? []) cb(k);
    kitWaiters.delete(theme);
  };
  new GLTFLoader().load(
    `${BASE}${theme}.glb`,
    (gltf) => settle(parseKit(theme, gltf.scene)),
    undefined,
    (err) => {
      console.info(`[arena art] ${theme}.glb not available`, err);
      settle(null);
    },
  );
}

function parseKit(theme: ArtTheme, scene: THREE.Group): Kit {
  // glTF UVs have their origin at the top left
  const atlasTex = artTexture(`${theme}_atlas`, { repeat: false, nearest: true, flipY: false });
  const kit: Kit = {
    pieces: new Map(),
    atlasMat: toon({ color: 0xffffff, map: atlasTex, rim: 0.12 }),
    glowMat: new THREE.MeshBasicMaterial({ map: atlasTex, color: new THREE.Color(1, 1, 1).multiplyScalar(1.25), fog: true }),
  };
  scene.updateMatrixWorld(true);
  for (const node of scene.children) {
    const piece: KitPiece = { atlas: null, glow: null, bounds: new THREE.Box3() };
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      g.computeBoundingBox();
      piece.bounds.union(g.boundingBox!);
      const name = (mesh.material as THREE.Material).name;
      if (name === 'glow') piece.glow = g;
      else piece.atlas = g;
    });
    kit.pieces.set(node.name, piece);
  }
  return kit;
}

// start downloading right away (the arenas are built synchronously when a match starts)
for (const t of ['city', 'stage', 'tartarus'] as ArtTheme[]) loadKit(t);
