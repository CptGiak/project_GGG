import * as THREE from 'three';
import { outlineMaterial } from '../render/toon';

/**
 * Verlet chains for secondary motion: coat tails, scarves, ponytails, ribbons.
 * They simulate in world space so they trail behind naturally during grapple flight.
 */

export interface BodySphere {
  bone: THREE.Object3D;
  offset: THREE.Vector3;
  radius: number;
  world: THREE.Vector3;
}

export interface ChainOptions {
  anchor: THREE.Object3D;
  /** anchor point in the anchor bone's local space */
  offset: THREE.Vector3;
  /** rest direction in anchor-local space (chain hangs/points this way when idle) */
  restDir: THREE.Vector3;
  segments: number;
  length: number;
  /** 0..1, how strongly each point is pulled toward the rest shape (per step) */
  stiffness?: number;
  /** stiffness falloff toward the tip: stiffness * (1 - t * falloff) */
  stiffFalloff?: number;
  damping?: number;
  gravity?: number;
  /** extra "air" drag pulling points against world velocity, 0..1 */
  drag?: number;
  render: 'tube' | 'ribbon';
  /** tube radius / ribbon half width as a function of t (0 root -> 1 tip) */
  size: (t: number) => number;
  /** ribbon thickness */
  thickness?: number;
  /** ribbon width direction in anchor-local space */
  side?: THREE.Vector3;
  material: THREE.Material;
  outline?: number;
  radial?: number;
  /** subdivide rendering with Catmull-Rom between sim points */
  smooth?: number;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _rest = new THREE.Vector3();
const _side = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ref = new THREE.Vector3();

export class ClothChain {
  readonly p: THREE.Vector3[] = [];
  readonly prev: THREE.Vector3[] = [];
  readonly segLen: number;
  readonly mesh: THREE.Mesh;
  readonly outline: THREE.Mesh | null = null;
  private geo: THREE.BufferGeometry;
  private renderPts: THREE.Vector3[] = [];
  private initialized = false;
  private acc = 0;
  private lastAnchor = new THREE.Vector3();
  private upRef = new THREE.Vector3(0, 1, 0);
  constructor(readonly o: ChainOptions, readonly colliders: BodySphere[] = []) {
    this.segLen = o.length / o.segments;
    for (let i = 0; i <= o.segments; i++) {
      this.p.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }
    const smooth = o.smooth ?? 2;
    const nRender = o.segments * smooth + 1;
    for (let i = 0; i < nRender; i++) this.renderPts.push(new THREE.Vector3());
    const ring = o.render === 'tube' ? (o.radial ?? 6) : 4;
    const vCount = nRender * ring + 2;
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const idx: number[] = [];
    for (let i = 0; i < nRender - 1; i++) {
      for (let j = 0; j < ring; j++) {
        const a = i * ring + j;
        const b = i * ring + ((j + 1) % ring);
        const c = (i + 1) * ring + j;
        const d = (i + 1) * ring + ((j + 1) % ring);
        idx.push(a, b, c, b, d, c);
      }
    }
    // end caps
    const capA = nRender * ring;
    const capB = capA + 1;
    for (let j = 0; j < ring; j++) {
      idx.push(capA, (j + 1) % ring, j);
      const base = (nRender - 1) * ring;
      idx.push(capB, base + j, base + ((j + 1) % ring));
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aOutline', new THREE.BufferAttribute(new Float32Array(vCount).fill(1), 1));
    const tAttr = new Float32Array(vCount);
    for (let i = 0; i < nRender; i++) for (let j = 0; j < ring; j++) tAttr[i * ring + j] = i / (nRender - 1);
    tAttr[nRender * ring] = 0;
    tAttr[nRender * ring + 1] = 1;
    this.geo.setAttribute('aT', new THREE.BufferAttribute(tAttr, 1));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, o.material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    if ((o.outline ?? 1) > 0) {
      this.outline = new THREE.Mesh(this.geo, outlineMaterial(0x07040c, 2.2 * (o.outline ?? 1), 6));
      this.outline.frustumCulled = false;
      this.outline.matrixAutoUpdate = false;
    }
  }

  /** objects to add to the scene (world-space geometry) */
  get objects(): THREE.Object3D[] {
    return this.outline ? [this.mesh, this.outline] : [this.mesh];
  }

  reset(): void {
    this.initialized = false;
  }

  private anchorWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.o.anchor.localToWorld(out.copy(this.o.offset));
  }

  private restDirWorld(out: THREE.Vector3): THREE.Vector3 {
    this.o.anchor.getWorldQuaternion(_q);
    return out.copy(this.o.restDir).normalize().applyQuaternion(_q);
  }

  update(dt: number, wind?: THREE.Vector3): void {
    const o = this.o;
    const a = this.anchorWorld(_v);
    if (!this.initialized || a.distanceToSquared(this.lastAnchor) > 36) {
      this.restDirWorld(_rest);
      for (let i = 0; i <= o.segments; i++) {
        this.p[i].copy(a).addScaledVector(_rest, i * this.segLen);
        this.prev[i].copy(this.p[i]);
      }
      this.initialized = true;
    }
    this.lastAnchor.copy(a);
    const step = 1 / 90;
    this.acc = Math.min(this.acc + dt, step * 4);
    while (this.acc >= step) {
      this.acc -= step;
      this.simulate(step, wind);
    }
    this.rebuild();
  }

  private simulate(h: number, wind?: THREE.Vector3): void {
    const o = this.o;
    const n = o.segments;
    const damping = o.damping ?? 0.9;
    const g = (o.gravity ?? 9.8) * h * h;
    const stiff = o.stiffness ?? 0.08;
    const fall = o.stiffFalloff ?? 0.6;
    const drag = o.drag ?? 0;
    const anchor = this.anchorWorld(_w);
    this.restDirWorld(_rest);
    this.p[0].copy(anchor);
    this.prev[0].copy(anchor);
    for (let i = 1; i <= n; i++) {
      const p = this.p[i];
      const pr = this.prev[i];
      _v.subVectors(p, pr).multiplyScalar(damping);
      if (drag > 0) _v.multiplyScalar(1 - drag);
      pr.copy(p);
      p.add(_v);
      p.y -= g;
      if (wind) p.addScaledVector(wind, h * h);
    }
    // shape keeping: pull toward rest shape built from the previous (already solved) point
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const k = stiff * (1 - t * fall);
      if (k <= 0) continue;
      _b.copy(this.p[i - 1]).addScaledVector(_rest, this.segLen);
      this.p[i].lerp(_b, k);
    }
    // distance constraints
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i <= n; i++) {
        const a = this.p[i - 1];
        const b = this.p[i];
        _dir.subVectors(b, a);
        const d = _dir.length() || 1e-6;
        const diff = (d - this.segLen) / d;
        if (i === 1) {
          b.addScaledVector(_dir, -diff);
        } else {
          a.addScaledVector(_dir, diff * 0.5);
          b.addScaledVector(_dir, -diff * 0.5);
        }
      }
      // body collisions
      for (const c of this.colliders) {
        for (let i = 1; i <= n; i++) {
          const p = this.p[i];
          _n.subVectors(p, c.world);
          const d2 = _n.lengthSq();
          const r = c.radius;
          if (d2 < r * r) {
            const d = Math.sqrt(d2) || 1e-6;
            p.addScaledVector(_n, (r - d) / d);
          }
        }
      }
    }
  }

  private rebuild(): void {
    const o = this.o;
    const smooth = o.smooth ?? 2;
    const pts = this.renderPts;
    const n = o.segments;
    // Catmull-Rom subdivision
    let k = 0;
    for (let i = 0; i < n; i++) {
      const p0 = this.p[Math.max(i - 1, 0)];
      const p1 = this.p[i];
      const p2 = this.p[i + 1];
      const p3 = this.p[Math.min(i + 2, n)];
      for (let s = 0; s < smooth; s++) {
        const t = s / smooth;
        catmull(p0, p1, p2, p3, t, pts[k++]);
      }
    }
    pts[k].copy(this.p[n]);
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = this.geo.getAttribute('normal') as THREE.BufferAttribute;
    const pa = pos.array as Float32Array;
    const na = nor.array as Float32Array;
    const count = pts.length;
    const ring = o.render === 'tube' ? (o.radial ?? 6) : 4;
    if (o.render === 'ribbon') {
      this.o.anchor.getWorldQuaternion(_q);
      _side.copy(o.side ?? new THREE.Vector3(1, 0, 0)).applyQuaternion(_q).normalize();
    }
    // reference normal for tube frames
    _ref.copy(this.upRef);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const p = pts[i];
      if (i < count - 1) _dir.subVectors(pts[i + 1], p);
      else _dir.subVectors(p, pts[i - 1]);
      _dir.normalize();
      const size = o.size(t);
      if (o.render === 'tube') {
        // parallel-transport-ish frame
        _n.copy(_ref).addScaledVector(_dir, -_ref.dot(_dir));
        if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0).addScaledVector(_dir, -_dir.x);
        _n.normalize();
        _ref.copy(_n);
        _b.crossVectors(_dir, _n);
        for (let j = 0; j < ring; j++) {
          const ang = (j / ring) * Math.PI * 2;
          const c = Math.cos(ang);
          const s = Math.sin(ang);
          const vi = (i * ring + j) * 3;
          const nx = _n.x * c + _b.x * s;
          const ny = _n.y * c + _b.y * s;
          const nz = _n.z * c + _b.z * s;
          pa[vi] = p.x + nx * size;
          pa[vi + 1] = p.y + ny * size;
          pa[vi + 2] = p.z + nz * size;
          na[vi] = nx;
          na[vi + 1] = ny;
          na[vi + 2] = nz;
        }
      } else {
        const th = (o.thickness ?? 0.015) * 0.5;
        // side vector orthogonal to the chain direction
        _v.copy(_side).addScaledVector(_dir, -_side.dot(_dir));
        if (_v.lengthSq() < 1e-6) _v.set(1, 0, 0);
        _v.normalize();
        _n.crossVectors(_v, _dir).normalize();
        const corners: [number, number][] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
        for (let j = 0; j < 4; j++) {
          const [sx, sy] = corners[j];
          const vi = (i * ring + j) * 3;
          pa[vi] = p.x + _v.x * sx * size + _n.x * sy * th;
          pa[vi + 1] = p.y + _v.y * sx * size + _n.y * sy * th;
          pa[vi + 2] = p.z + _v.z * sx * size + _n.z * sy * th;
          // mostly-flat normals with a slight bevel so the outline hull wraps the edge
          const nx = _n.x * sy + _v.x * sx * 0.35;
          const ny = _n.y * sy + _v.y * sx * 0.35;
          const nz = _n.z * sy + _v.z * sx * 0.35;
          const l = Math.hypot(nx, ny, nz) || 1;
          na[vi] = nx / l;
          na[vi + 1] = ny / l;
          na[vi + 2] = nz / l;
        }
      }
    }
    // caps
    const capA = count * ring * 3;
    const first = pts[0];
    const last = pts[count - 1];
    pa[capA] = first.x;
    pa[capA + 1] = first.y;
    pa[capA + 2] = first.z;
    pa[capA + 3] = last.x;
    pa[capA + 4] = last.y;
    pa[capA + 5] = last.z;
    _dir.subVectors(pts[1], first).normalize();
    na[capA] = -_dir.x;
    na[capA + 1] = -_dir.y;
    na[capA + 2] = -_dir.z;
    _dir.subVectors(last, pts[count - 2]).normalize();
    na[capA + 3] = _dir.x;
    na[capA + 4] = _dir.y;
    na[capA + 5] = _dir.z;
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
    if (this.outline) this.outline.visible = v;
  }
}

function catmull(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const f0 = -0.5 * t3 + t2 - 0.5 * t;
  const f1 = 1.5 * t3 - 2.5 * t2 + 1;
  const f2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
  const f3 = 0.5 * t3 - 0.5 * t2;
  out.set(
    p0.x * f0 + p1.x * f1 + p2.x * f2 + p3.x * f3,
    p0.y * f0 + p1.y * f1 + p2.y * f2 + p3.y * f3,
    p0.z * f0 + p1.z * f1 + p2.z * f2 + p3.z * f3,
  );
  return out;
}

export function updateBodySpheres(spheres: BodySphere[]): void {
  for (const s of spheres) s.bone.localToWorld(s.world.copy(s.offset));
}

// ---------------------------------------------------------------------------------------------
// Cloth sheet: a grid of particles hanging from a row of anchors (coats, skirts, capes).
// Rendered as a thin closed "lens" (outer + inner layer meeting at the borders) so it gets
// an outline and a different lining colour on the inside.
// ---------------------------------------------------------------------------------------------

export interface SheetColumn {
  offset: THREE.Vector3;
  restDir: THREE.Vector3;
  length: number;
}

export interface SheetOptions {
  anchor: THREE.Object3D;
  columns: SheetColumn[];
  rows: number;
  /** wrap around (full skirt) */
  closed?: boolean;
  stiffness?: number;
  stiffFalloff?: number;
  damping?: number;
  gravity?: number;
  thickness?: number;
  outer: THREE.Material;
  inner: THREE.Material;
  outline?: number;
  smoothH?: number;
  smoothV?: number;
  /** horizontal stretch allowed before the constraint kicks in (flare) */
  slackH?: number;
}

export class ClothSheet {
  readonly cols: number;
  readonly rows: number;
  readonly p: THREE.Vector3[];
  readonly prev: THREE.Vector3[];
  readonly mesh: THREE.Mesh;
  readonly outline: THREE.Mesh | null = null;
  private restV: number[];
  private restH: number[] = [];
  private geo: THREE.BufferGeometry;
  private U: number;
  private V: number;
  private colPts: THREE.Vector3[][];
  private grid: THREE.Vector3[];
  private gridN: THREE.Vector3[];
  private initialized = false;
  private acc = 0;
  private lastAnchor = new THREE.Vector3();
  private restDirs: THREE.Vector3[];

  constructor(readonly o: SheetOptions, readonly colliders: BodySphere[] = []) {
    this.cols = o.columns.length;
    this.rows = o.rows;
    const n = this.cols * (this.rows + 1);
    this.p = Array.from({ length: n }, () => new THREE.Vector3());
    this.prev = Array.from({ length: n }, () => new THREE.Vector3());
    this.restV = o.columns.map((c) => c.length / o.rows);
    this.restDirs = o.columns.map(() => new THREE.Vector3());
    const sh = o.smoothH ?? 2;
    const sv = o.smoothV ?? 2;
    const segH = o.closed ? this.cols : this.cols - 1;
    this.U = segH * sh + (o.closed ? 0 : 1);
    this.V = this.rows * sv + 1;
    this.colPts = Array.from({ length: this.cols }, () => Array.from({ length: this.V }, () => new THREE.Vector3()));
    this.grid = Array.from({ length: this.U * this.V }, () => new THREE.Vector3());
    this.gridN = Array.from({ length: this.U * this.V }, () => new THREE.Vector3());

    const U = this.U;
    const V = this.V;
    const layer = U * V;
    const pos = new Float32Array(layer * 2 * 3);
    const nor = new Float32Array(layer * 2 * 3);
    const idxOuter: number[] = [];
    const idxInner: number[] = [];
    const uMax = o.closed ? U : U - 1;
    for (let v = 0; v < V - 1; v++) {
      for (let u = 0; u < uMax; u++) {
        const u1 = (u + 1) % U;
        const a = v * U + u;
        const b = v * U + u1;
        const c = (v + 1) * U + u;
        const d = (v + 1) * U + u1;
        idxOuter.push(a, c, b, b, c, d);
        idxInner.push(layer + a, layer + b, layer + c, layer + b, layer + d, layer + c);
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aOutline', new THREE.BufferAttribute(new Float32Array(layer * 2).fill(1), 1));
    this.geo.setIndex([...idxOuter, ...idxInner]);
    this.geo.addGroup(0, idxOuter.length, 0);
    this.geo.addGroup(idxOuter.length, idxInner.length, 1);
    this.mesh = new THREE.Mesh(this.geo, [o.outer, o.inner]);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    if ((o.outline ?? 1) > 0) {
      this.outline = new THREE.Mesh(this.geo, outlineMaterial(0x07040c, 2.2 * (o.outline ?? 1), 6));
      this.outline.frustumCulled = false;
      this.outline.matrixAutoUpdate = false;
    }
  }

  get objects(): THREE.Object3D[] {
    return this.outline ? [this.mesh, this.outline] : [this.mesh];
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
    if (this.outline) this.outline.visible = v;
  }

  reset(): void {
    this.initialized = false;
  }

  private idx(c: number, r: number): number {
    return c * (this.rows + 1) + r;
  }

  private computeAnchors(): void {
    const o = this.o;
    o.anchor.getWorldQuaternion(_q);
    for (let c = 0; c < this.cols; c++) {
      const col = o.columns[c];
      o.anchor.localToWorld(this.p[this.idx(c, 0)].copy(col.offset));
      this.prev[this.idx(c, 0)].copy(this.p[this.idx(c, 0)]);
      this.restDirs[c].copy(col.restDir).normalize().applyQuaternion(_q);
    }
  }

  update(dt: number, wind?: THREE.Vector3): void {
    const o = this.o;
    o.anchor.localToWorld(_v.copy(o.columns[0].offset));
    if (!this.initialized || _v.distanceToSquared(this.lastAnchor) > 36) {
      this.computeAnchors();
      for (let c = 0; c < this.cols; c++) {
        const a = this.p[this.idx(c, 0)];
        for (let r = 1; r <= this.rows; r++) {
          const i = this.idx(c, r);
          this.p[i].copy(a).addScaledVector(this.restDirs[c], r * this.restV[c]);
          this.prev[i].copy(this.p[i]);
        }
      }
      // horizontal rest lengths measured on the rest shape
      this.restH = [];
      const cmax = o.closed ? this.cols : this.cols - 1;
      for (let r = 0; r <= this.rows; r++) {
        for (let c = 0; c < cmax; c++) {
          const c1 = (c + 1) % this.cols;
          this.restH.push(this.p[this.idx(c, r)].distanceTo(this.p[this.idx(c1, r)]));
        }
      }
      this.initialized = true;
    }
    this.lastAnchor.copy(_v);
    const step = 1 / 90;
    this.acc = Math.min(this.acc + dt, step * 4);
    while (this.acc >= step) {
      this.acc -= step;
      this.simulate(step, wind);
    }
    this.rebuild();
  }

  private simulate(h: number, wind?: THREE.Vector3): void {
    const o = this.o;
    const damping = o.damping ?? 0.9;
    const g = (o.gravity ?? 9.8) * h * h;
    const stiff = o.stiffness ?? 0.06;
    const fall = o.stiffFalloff ?? 0.5;
    const slack = o.slackH ?? 1.15;
    this.computeAnchors();
    for (let c = 0; c < this.cols; c++) {
      for (let r = 1; r <= this.rows; r++) {
        const i = this.idx(c, r);
        const p = this.p[i];
        const pr = this.prev[i];
        _v.subVectors(p, pr).multiplyScalar(damping);
        pr.copy(p);
        p.add(_v);
        p.y -= g;
        if (wind) p.addScaledVector(wind, h * h);
      }
    }
    for (let c = 0; c < this.cols; c++) {
      for (let r = 1; r <= this.rows; r++) {
        const k = stiff * (1 - (r / this.rows) * fall);
        _b.copy(this.p[this.idx(c, r - 1)]).addScaledVector(this.restDirs[c], this.restV[c]);
        this.p[this.idx(c, r)].lerp(_b, k);
      }
    }
    const cmax = o.closed ? this.cols : this.cols - 1;
    for (let it = 0; it < 4; it++) {
      // vertical
      for (let c = 0; c < this.cols; c++) {
        const L = this.restV[c];
        for (let r = 1; r <= this.rows; r++) {
          const a = this.p[this.idx(c, r - 1)];
          const b = this.p[this.idx(c, r)];
          _dir.subVectors(b, a);
          const d = _dir.length() || 1e-6;
          const diff = (d - L) / d;
          if (r === 1) b.addScaledVector(_dir, -diff);
          else {
            a.addScaledVector(_dir, diff * 0.5);
            b.addScaledVector(_dir, -diff * 0.5);
          }
        }
      }
      // horizontal (only resists stretching beyond slack and compression below 60%)
      let k = 0;
      for (let r = 0; r <= this.rows; r++) {
        for (let c = 0; c < cmax; c++, k++) {
          if (r === 0) continue;
          const c1 = (c + 1) % this.cols;
          const a = this.p[this.idx(c, r)];
          const b = this.p[this.idx(c1, r)];
          _dir.subVectors(b, a);
          const d = _dir.length() || 1e-6;
          const L = this.restH[k];
          let target = d;
          if (d > L * slack) target = L * slack;
          else if (d < L * 0.6) target = L * 0.6;
          else continue;
          const diff = (d - target) / d;
          a.addScaledVector(_dir, diff * 0.5);
          b.addScaledVector(_dir, -diff * 0.5);
        }
      }
      for (const s of this.colliders) {
        const rr = s.radius;
        for (let c = 0; c < this.cols; c++) {
          for (let r = 1; r <= this.rows; r++) {
            const p = this.p[this.idx(c, r)];
            _n.subVectors(p, s.world);
            const d2 = _n.lengthSq();
            if (d2 < rr * rr) {
              const d = Math.sqrt(d2) || 1e-6;
              p.addScaledVector(_n, (rr - d) / d);
            }
          }
        }
      }
    }
  }

  private rebuild(): void {
    const o = this.o;
    const sv = o.smoothV ?? 2;
    const sh = o.smoothH ?? 2;
    const U = this.U;
    const V = this.V;
    // vertical subdivision per column
    for (let c = 0; c < this.cols; c++) {
      const out = this.colPts[c];
      let k = 0;
      for (let r = 0; r < this.rows; r++) {
        const p0 = this.p[this.idx(c, Math.max(r - 1, 0))];
        const p1 = this.p[this.idx(c, r)];
        const p2 = this.p[this.idx(c, r + 1)];
        const p3 = this.p[this.idx(c, Math.min(r + 2, this.rows))];
        for (let s = 0; s < sv; s++) catmull(p0, p1, p2, p3, s / sv, out[k++]);
      }
      out[k].copy(this.p[this.idx(c, this.rows)]);
    }
    // horizontal subdivision
    const C = this.cols;
    for (let v = 0; v < V; v++) {
      let k = 0;
      const segs = o.closed ? C : C - 1;
      for (let c = 0; c < segs; c++) {
        const cm = o.closed ? (c - 1 + C) % C : Math.max(c - 1, 0);
        const c1 = o.closed ? (c + 1) % C : c + 1;
        const c2 = o.closed ? (c + 2) % C : Math.min(c + 2, C - 1);
        for (let s = 0; s < sh; s++) catmull(this.colPts[cm][v], this.colPts[c][v], this.colPts[c1][v], this.colPts[c2][v], s / sh, this.grid[v * U + k++]);
      }
      if (!o.closed) this.grid[v * U + k].copy(this.colPts[C - 1][v]);
    }
    // normals (outward = away from anchor axis)
    o.anchor.getWorldPosition(_w);
    for (let v = 0; v < V; v++) {
      for (let u = 0; u < U; u++) {
        const i = v * U + u;
        const ul = o.closed ? (u - 1 + U) % U : Math.max(u - 1, 0);
        const ur = o.closed ? (u + 1) % U : Math.min(u + 1, U - 1);
        const vu = Math.max(v - 1, 0);
        const vd = Math.min(v + 1, V - 1);
        _side.subVectors(this.grid[v * U + ur], this.grid[v * U + ul]);
        _dir.subVectors(this.grid[vd * U + u], this.grid[vu * U + u]);
        const nn = this.gridN[i].crossVectors(_dir, _side).normalize();
        // orient outward
        _v.subVectors(this.grid[i], _w);
        _v.y = 0;
        if (nn.dot(_v) < 0) nn.negate();
      }
    }
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = this.geo.getAttribute('normal') as THREE.BufferAttribute;
    const pa = pos.array as Float32Array;
    const na = nor.array as Float32Array;
    const layer = U * V;
    const th = (o.thickness ?? 0.02) * 0.5;
    for (let v = 0; v < V; v++) {
      for (let u = 0; u < U; u++) {
        const i = v * U + u;
        const p = this.grid[i];
        const nrm = this.gridN[i];
        // border detection -> taper thickness & tilt normals outward along the border
        const edgeU = !o.closed && (u === 0 || u === U - 1);
        const edgeV = v === V - 1;
        let t = th;
        _b.set(0, 0, 0);
        if (edgeU) {
          const inner = this.grid[v * U + (u === 0 ? 1 : U - 2)];
          _b.subVectors(p, inner).normalize();
          t = 0;
        }
        if (edgeV) {
          _v.subVectors(p, this.grid[(v - 1) * U + u]).normalize();
          _b.add(_v);
          t = 0;
        }
        const o3 = i * 3;
        const i3 = (layer + i) * 3;
        pa[o3] = p.x + nrm.x * t;
        pa[o3 + 1] = p.y + nrm.y * t;
        pa[o3 + 2] = p.z + nrm.z * t;
        pa[i3] = p.x - nrm.x * t;
        pa[i3 + 1] = p.y - nrm.y * t;
        pa[i3 + 2] = p.z - nrm.z * t;
        const bx = _b.x * 0.8;
        const by = _b.y * 0.8;
        const bz = _b.z * 0.8;
        let lx = nrm.x + bx;
        let ly = nrm.y + by;
        let lz = nrm.z + bz;
        let l = Math.hypot(lx, ly, lz) || 1;
        na[o3] = lx / l;
        na[o3 + 1] = ly / l;
        na[o3 + 2] = lz / l;
        lx = -nrm.x + bx;
        ly = -nrm.y + by;
        lz = -nrm.z + bz;
        l = Math.hypot(lx, ly, lz) || 1;
        na[i3] = lx / l;
        na[i3 + 1] = ly / l;
        na[i3 + 2] = lz / l;
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }
}
