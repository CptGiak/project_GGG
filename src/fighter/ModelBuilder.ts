import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { outlineMaterial, smoothNormalGeometry } from '../render/toon';
import { mergeNonIndexed } from './shapes';

interface PartEntry {
  geo: THREE.BufferGeometry;
  mat: string;
  outline: number;
  shadow: boolean;
}

/**
 * Collects primitive parts per bone (or any Object3D), then merges them into one mesh per
 * (bone, material) plus one outline hull per bone. Keeps draw calls low even though the
 * characters are sculpted out of dozens of primitives.
 */
export class ModelBuilder {
  private parts = new Map<THREE.Object3D, PartEntry[]>();
  readonly meshes: THREE.Mesh[] = [];
  readonly outlineMeshes: THREE.Mesh[] = [];

  constructor(
    readonly mats: Record<string, THREE.Material>,
    readonly outlineColor: THREE.ColorRepresentation = 0x07040c,
    readonly outlineWidth = 2.4,
  ) {}

  add(target: THREE.Object3D, geo: THREE.BufferGeometry, mat: string, outline = 1, shadow = true): this {
    if (!this.mats[mat]) throw new Error(`ModelBuilder: unknown material '${mat}'`);
    let list = this.parts.get(target);
    if (!list) {
      list = [];
      this.parts.set(target, list);
    }
    list.push({ geo, mat, outline, shadow });
    return this;
  }

  build(): void {
    const outlineMat = outlineMaterial(this.outlineColor, this.outlineWidth, 6);
    for (const [target, list] of this.parts) {
      const byMat = new Map<string, PartEntry[]>();
      for (const p of list) {
        let arr = byMat.get(p.mat);
        if (!arr) byMat.set(p.mat, (arr = []));
        arr.push(p);
      }
      for (const [matKey, entries] of byMat) {
        const geo = mergeNonIndexed(entries.map((e) => e.geo));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, this.mats[matKey]);
        mesh.name = `${target.name}_${matKey}`;
        mesh.castShadow = entries.some((e) => e.shadow);
        mesh.receiveShadow = true;
        target.add(mesh);
        this.meshes.push(mesh);
      }
      const outlined = list.filter((p) => p.outline > 0);
      if (outlined.length) {
        const geos = outlined.map((p) => {
          const g = smoothNormalGeometry(p.geo).clone();
          if (p.outline !== 1) (g.getAttribute('aOutline') as THREE.BufferAttribute).array.fill(p.outline);
          return g;
        });
        const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const o = new THREE.Mesh(merged, outlineMat);
        o.name = `${target.name}_outline`;
        target.add(o);
        this.outlineMeshes.push(o);
      }
    }
    this.parts.clear();
  }
}
