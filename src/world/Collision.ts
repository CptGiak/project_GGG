import * as THREE from 'three';

/**
 * Lightweight collision world made of oriented boxes (yaw-rotated) and a uniform XZ grid for
 * broad-phase. Supports ray casts (grapple aiming, projectiles, camera) and sphere resolution
 * (character capsules approximated by stacked spheres).
 */

export interface BoxCollider {
  id: number;
  center: THREE.Vector3;
  half: THREE.Vector3;
  /** yaw rotation (radians) around Y */
  yaw: number;
  cos: number;
  sin: number;
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** can grapple hooks attach to it */
  grapple: boolean;
  /** surface tag for VFX/audio */
  tag: string;
}

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  box: BoxCollider | null;
}

const CELL = 12;

export class CollisionWorld {
  readonly boxes: BoxCollider[] = [];
  private grid = new Map<number, number[]>();
  private stamp: Uint32Array = new Uint32Array(0);
  private stampId = 1;
  /** kill plane (fall out of the world) */
  killY = -60;
  bounds = { minX: -150, maxX: 150, minZ: -150, maxZ: 150, maxY: 220 };

  addBox(center: THREE.Vector3 | [number, number, number], size: THREE.Vector3 | [number, number, number], yaw = 0, opts: { grapple?: boolean; tag?: string } = {}): BoxCollider {
    const c = Array.isArray(center) ? new THREE.Vector3(...center) : center.clone();
    const s = Array.isArray(size) ? new THREE.Vector3(...size) : size.clone();
    const half = s.multiplyScalar(0.5);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // world AABB of the rotated box
    const ex = Math.abs(cos) * half.x + Math.abs(sin) * half.z;
    const ez = Math.abs(sin) * half.x + Math.abs(cos) * half.z;
    const box: BoxCollider = {
      id: this.boxes.length,
      center: c,
      half,
      yaw,
      cos,
      sin,
      min: new THREE.Vector3(c.x - ex, c.y - half.y, c.z - ez),
      max: new THREE.Vector3(c.x + ex, c.y + half.y, c.z + ez),
      grapple: opts.grapple ?? true,
      tag: opts.tag ?? 'concrete',
    };
    this.boxes.push(box);
    const x0 = Math.floor(box.min.x / CELL);
    const x1 = Math.floor(box.max.x / CELL);
    const z0 = Math.floor(box.min.z / CELL);
    const z1 = Math.floor(box.max.z / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = key(x, z);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(box.id);
      }
    }
    if (this.stamp.length < this.boxes.length) {
      const n = new Uint32Array(Math.max(64, this.boxes.length * 2));
      n.set(this.stamp);
      this.stamp = n;
    }
    return box;
  }

  clear(): void {
    this.boxes.length = 0;
    this.grid.clear();
  }

  // -------------------------------------------------------------------------------------------
  // queries
  // -------------------------------------------------------------------------------------------

  private nextStamp(): number {
    this.stampId++;
    if (this.stampId > 0xfffffff0) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    return this.stampId;
  }

  /** Visit candidate boxes overlapping an XZ rectangle. */
  private forEachInRect(minX: number, minZ: number, maxX: number, maxZ: number, fn: (b: BoxCollider) => boolean | void): void {
    const st = this.nextStamp();
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const list = this.grid.get(key(x, z));
        if (!list) continue;
        for (const id of list) {
          if (this.stamp[id] === st) continue;
          this.stamp[id] = st;
          if (fn(this.boxes[id]) === true) return;
        }
      }
    }
  }

  /**
   * Ray cast. dir must be normalized. Returns the closest hit within maxDist.
   * Uses a DDA walk over the grid so long rays stay cheap.
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out?: RayHit, filter?: (b: BoxCollider) => boolean): RayHit | null {
    let best = maxDist;
    let bestBox: BoxCollider | null = null;
    const bestN = _n0.set(0, 0, 0);
    const st = this.nextStamp();
    // grid traversal (2D DDA on XZ)
    let cx = Math.floor(origin.x / CELL);
    let cz = Math.floor(origin.z / CELL);
    const stepX = dir.x > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dir.x) > 1e-9 ? CELL / Math.abs(dir.x) : Infinity;
    const tDeltaZ = Math.abs(dir.z) > 1e-9 ? CELL / Math.abs(dir.z) : Infinity;
    let tMaxX = Math.abs(dir.x) > 1e-9 ? ((dir.x > 0 ? (cx + 1) * CELL - origin.x : origin.x - cx * CELL) / Math.abs(dir.x)) : Infinity;
    let tMaxZ = Math.abs(dir.z) > 1e-9 ? ((dir.z > 0 ? (cz + 1) * CELL - origin.z : origin.z - cz * CELL) / Math.abs(dir.z)) : Infinity;
    let t = 0;
    let guard = 0;
    while (t <= best && guard++ < 512) {
      const list = this.grid.get(key(cx, cz));
      if (list) {
        for (const id of list) {
          if (this.stamp[id] === st) continue;
          this.stamp[id] = st;
          const b = this.boxes[id];
          if (filter && !filter(b)) continue;
          const d = rayBox(origin, dir, b, best, _n1);
          if (d >= 0 && d < best) {
            best = d;
            bestBox = b;
            bestN.copy(_n1);
          }
        }
      }
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        cz += stepZ;
      }
      if (t > maxDist) break;
    }
    if (!bestBox) return null;
    const hit = out ?? { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, box: null };
    hit.point.copy(origin).addScaledVector(dir, best);
    hit.normal.copy(bestN);
    hit.distance = best;
    hit.box = bestBox;
    return hit;
  }

  /** Pushes a sphere out of all boxes. Returns accumulated push; `normalOut` gets the dominant contact normal. */
  resolveSphere(center: THREE.Vector3, radius: number, normalOut?: THREE.Vector3): THREE.Vector3 {
    const total = _push.set(0, 0, 0);
    let bestUp = -2;
    if (normalOut) normalOut.set(0, 0, 0);
    this.forEachInRect(center.x - radius, center.z - radius, center.x + radius, center.z + radius, (b) => {
      if (center.y - radius > b.max.y || center.y + radius < b.min.y) return;
      if (spherePush(center, radius, b, _n1)) {
        center.add(_n1);
        total.add(_n1);
        if (normalOut) {
          const l = _n1.length();
          if (l > 1e-6) {
            _n1.divideScalar(l);
            if (_n1.y > bestUp) {
              bestUp = _n1.y;
              normalOut.copy(_n1);
            }
          }
        }
      }
    });
    return total;
  }

  /** True if a sphere overlaps any box (no resolution). */
  overlapsSphere(center: THREE.Vector3, radius: number): boolean {
    let hit = false;
    this.forEachInRect(center.x - radius, center.z - radius, center.x + radius, center.z + radius, (b) => {
      if (center.y - radius > b.max.y || center.y + radius < b.min.y) return;
      if (spherePush(center, radius, b, _n1)) {
        hit = true;
        return true;
      }
    });
    return hit;
  }

  /** Ground height below a point (top of the highest box under it), or -Infinity. */
  groundHeight(x: number, z: number, fromY: number): number {
    const r = this.raycast(_o.set(x, fromY, z), _down, fromY - this.killY);
    return r ? r.point.y : -Infinity;
  }
}

function key(x: number, z: number): number {
  return (x + 2048) * 4096 + (z + 2048);
}

const _n0 = new THREE.Vector3();
const _n1 = new THREE.Vector3();
const _push = new THREE.Vector3();
const _o = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _lo = new THREE.Vector3();
const _ld = new THREE.Vector3();

/** Ray vs oriented box (yaw only). Returns distance or -1. normal in world space. */
export function rayBox(origin: THREE.Vector3, dir: THREE.Vector3, b: BoxCollider, maxDist: number, normal: THREE.Vector3): number {
  // quick AABB reject
  if (!rayAABB(origin, dir, b.min, b.max, maxDist)) return -1;
  // to local space
  const ox = origin.x - b.center.x;
  const oz = origin.z - b.center.z;
  _lo.set(ox * b.cos - oz * b.sin, origin.y - b.center.y, ox * b.sin + oz * b.cos);
  _ld.set(dir.x * b.cos - dir.z * b.sin, dir.y, dir.x * b.sin + dir.z * b.cos);
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = -1;
  let sign = 0;
  const h = b.half;
  for (let i = 0; i < 3; i++) {
    const o = i === 0 ? _lo.x : i === 1 ? _lo.y : _lo.z;
    const d = i === 0 ? _ld.x : i === 1 ? _ld.y : _ld.z;
    const e = i === 0 ? h.x : i === 1 ? h.y : h.z;
    if (Math.abs(d) < 1e-9) {
      if (o < -e || o > e) return -1;
      continue;
    }
    let t1 = (-e - o) / d;
    let t2 = (e - o) / d;
    let s = -1;
    if (t1 > t2) {
      const tt = t1;
      t1 = t2;
      t2 = tt;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  if (tmin < 0) {
    // origin inside the box
    return -1;
  }
  if (tmin > maxDist) return -1;
  // local normal
  let nx = 0;
  let ny = 0;
  let nz = 0;
  if (axis === 0) nx = sign;
  else if (axis === 1) ny = sign;
  else nz = sign;
  // back to world (inverse yaw)
  normal.set(nx * b.cos + nz * b.sin, ny, -nx * b.sin + nz * b.cos);
  return tmin;
}

function rayAABB(o: THREE.Vector3, d: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3, maxDist: number): boolean {
  let tmin = 0;
  let tmax = maxDist;
  for (let i = 0; i < 3; i++) {
    const oi = i === 0 ? o.x : i === 1 ? o.y : o.z;
    const di = i === 0 ? d.x : i === 1 ? d.y : d.z;
    const mn = i === 0 ? min.x : i === 1 ? min.y : min.z;
    const mx = i === 0 ? max.x : i === 1 ? max.y : max.z;
    if (Math.abs(di) < 1e-9) {
      if (oi < mn || oi > mx) return false;
      continue;
    }
    let t1 = (mn - oi) / di;
    let t2 = (mx - oi) / di;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/** Computes the push needed to move a sphere out of a box. Returns false if no overlap. */
function spherePush(c: THREE.Vector3, r: number, b: BoxCollider, out: THREE.Vector3): boolean {
  const ox = c.x - b.center.x;
  const oz = c.z - b.center.z;
  const lx = ox * b.cos - oz * b.sin;
  const ly = c.y - b.center.y;
  const lz = ox * b.sin + oz * b.cos;
  const h = b.half;
  const qx = Math.max(-h.x, Math.min(h.x, lx));
  const qy = Math.max(-h.y, Math.min(h.y, ly));
  const qz = Math.max(-h.z, Math.min(h.z, lz));
  const dx = lx - qx;
  const dy = ly - qy;
  const dz = lz - qz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return false;
  let px: number;
  let py: number;
  let pz: number;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    px = dx * k;
    py = dy * k;
    pz = dz * k;
  } else {
    // centre inside: push out along the axis of least penetration
    const penX = h.x - Math.abs(lx);
    const penY = h.y - Math.abs(ly);
    const penZ = h.z - Math.abs(lz);
    px = py = pz = 0;
    if (penY <= penX && penY <= penZ) py = (ly >= 0 ? 1 : -1) * (penY + r);
    else if (penX <= penZ) px = (lx >= 0 ? 1 : -1) * (penX + r);
    else pz = (lz >= 0 ? 1 : -1) * (penZ + r);
  }
  // back to world
  out.set(px * b.cos + pz * b.sin, py, -px * b.sin + pz * b.cos);
  return true;
}
