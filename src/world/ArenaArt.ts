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
 * the GLB arrives are added to the arena as soon as it does. Missing files only log: a missing
 * texture turns plain grey without glow (the materials keep their flat colours) and a missing kit
 * leaves the arena with its plain geometry.
 *
 * Static builds (VITE_STATIC, hosts without a file server for .glb) read the same files from
 * arenas.json next to the page: { "models/arenas/<file>": base64 }.
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
const STATIC = import.meta.env.VITE_STATIC === '1';
const imgLoader = new THREE.ImageLoader();
const textures = new Map<string, THREE.Texture>();
const kits = new Map<ArtTheme, Kit | null>();
const kitWaiters = new Map<ArtTheme, Array<(k: Kit | null) => void>>();

/** Repeating sRGB texture from public/models/arenas/<name>.png (cached). */
export function artTexture(name: string, opts: { repeat?: boolean; nearest?: boolean; flipY?: boolean } = {}): THREE.Texture {
  const cached = textures.get(name);
  if (cached) return cached;
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.flipY === false) tex.flipY = false;
  if (opts.repeat !== false) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (opts.nearest) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
  } else {
    tex.anisotropy = 8;
  }
  textures.set(name, tex);

  const missing = () => {
    console.info(`[arena art] ${name}.png missing`);
    // a texture that never loaded samples black: use the tiles' average grey with no glow instead
    tex.image = new ImageData(new Uint8ClampedArray([112, 112, 112, 0]), 1, 1);
    tex.needsUpdate = true;
  };
  const load = (url: string, done?: () => void) =>
    imgLoader.load(
      url,
      (img) => {
        tex.image = img;
        tex.needsUpdate = true;
        done?.();
      },
      undefined,
      () => {
        missing();
        done?.();
      },
    );
  if (STATIC) {
    void packed(`${name}.png`).then((bytes) => {
      if (!bytes) return missing();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      load(url, () => URL.revokeObjectURL(url));
    });
  } else {
    load(`${BASE}${name}.png`);
  }
  return tex;
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
  const loader = new GLTFLoader();
  const onLoad = (gltf: { scene: THREE.Group }) => settle(parseKit(theme, gltf.scene));
  const onError = (err: unknown) => {
    console.info(`[arena art] ${theme}.glb not available`, err);
    settle(null);
  };
  if (STATIC) {
    void packed(`${theme}.glb`).then((bytes) => {
      if (bytes) loader.parse(bytes, '', onLoad, onError);
      else onError(new Error('not in arenas.json'));
    });
  } else {
    loader.load(`${BASE}${theme}.glb`, onLoad, undefined, onError);
  }
}

let pack: Promise<Record<string, string> | null> | null = null;

/** A file of public/models/arenas/ from arenas.json (static builds), or null. */
function packed(file: string): Promise<ArrayBuffer | null> {
  pack ??= fetch(`${import.meta.env.BASE_URL ?? '/'}arenas.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : null))
    .catch(() => null);
  return pack.then((p) => {
    const key = `models/arenas/${file}`;
    const b64 = p?.[key];
    if (!b64) return null;
    // every file is read once (textures and kits are cached): free the string
    delete p[key];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  });
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
