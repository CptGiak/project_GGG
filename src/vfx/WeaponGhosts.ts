import * as THREE from 'three';
import { holoMaterial } from '../render/toon';

interface Ghost {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  life: number;
  max: number;
  drift: THREE.Vector3;
}

interface WeaponSource {
  obj: THREE.Object3D;
  geo: THREE.BufferGeometry;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

/** Merges every visible mesh under `root` (outline hulls excluded) into root-local space. */
function mergeWeapon(root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateWorldMatrix(true, true);
  _inv.copy(root.matrixWorld).invert();
  const parts: Array<{ pos: Float32Array; nor: Float32Array }> = [];
  let total = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name.endsWith('_outline')) return;
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pa = src.getAttribute('position');
    const na = src.getAttribute('normal');
    if (!pa || !na) return;
    _m.multiplyMatrices(_inv, mesh.matrixWorld);
    const nm = new THREE.Matrix3().getNormalMatrix(_m);
    const pos = new Float32Array(pa.count * 3);
    const nor = new Float32Array(pa.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(_m);
      pos.set([v.x, v.y, v.z], i * 3);
      v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      nor.set([v.x, v.y, v.z], i * 3);
    }
    parts.push({ pos, nor });
    total += pa.count;
  });
  if (!total) return null;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.pos, o * 3);
    nor.set(p.nor, o * 3);
    o += p.pos.length / 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(total * 2), 2));
  g.computeBoundingSphere();
  return g;
}

/**
 * Holographic afterimages of a fighter's weapons while a swing is live: glitchy cyan/magenta
 * copies left along the arc that fade in a fifth of a second (True Damage-style smear).
 */
export class WeaponGhosts {
  private sources: WeaponSource[] = [];
  private pool: Ghost[] = [];
  private timer = 0;

  constructor(private scene: THREE.Scene, weapons: Array<THREE.Object3D | null>, colorA: THREE.Color, colorB: THREE.Color) {
    for (const w of weapons) {
      if (!w) continue;
      const geo = mergeWeapon(w);
      if (geo) this.sources.push({ obj: w, geo });
    }
    const n = this.sources.length * 7;
    for (let i = 0; i < n; i++) {
      const mat = holoMaterial(i % 2 ? colorA : colorB, i % 2 ? colorB : colorA, { intensity: 0.9, scan: 60, glitch: 1.5 });
      const mesh = new THREE.Mesh(this.sources[0]?.geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.pool.push({ mesh, mat, life: 0, max: 0.2, drift: new THREE.Vector3() });
    }
  }

  update(dt: number, emitting: boolean): void {
    for (const g of this.pool) {
      if (g.life <= 0) continue;
      g.life -= dt;
      if (g.life <= 0) {
        g.mesh.visible = false;
        continue;
      }
      const k = g.life / g.max;
      g.mat.uniforms.uIntensity.value = 0.95 * k * k;
      g.mesh.position.addScaledVector(g.drift, dt);
    }
    if (!emitting || !this.sources.length) {
      this.timer = 0;
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.034;
    for (const src of this.sources) this.spawn(src);
  }

  private spawn(src: WeaponSource): void {
    let g = this.pool.find((x) => x.life <= 0);
    if (!g) g = this.pool.reduce((a, b) => (a.life < b.life ? a : b));
    src.obj.matrixWorld.decompose(_p, _q, _s);
    g.mesh.geometry = src.geo;
    g.mesh.position.copy(_p);
    g.mesh.quaternion.copy(_q);
    g.mesh.scale.copy(_s);
    // glitch: a small random slip sideways (pool entries alternate the two colours)
    g.drift.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.6);
    g.mesh.position.addScaledVector(g.drift, 0.03);
    g.max = g.life = 0.2;
    g.mesh.visible = true;
  }

  dispose(): void {
    for (const g of this.pool) {
      this.scene.remove(g.mesh);
      g.mat.dispose();
    }
    for (const s of this.sources) s.geo.dispose();
  }
}
