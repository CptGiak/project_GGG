import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Procedural geometry helpers used to sculpt the champions out of primitives.
 * All helpers return indexed or non-indexed BufferGeometry with position/normal/uv.
 */

export type V3 = [number, number, number];

/** Lathe around +Y. profile: [radius, y] from bottom to top or top to bottom. */
export function lathe(profile: [number, number][], segments = 16, sx = 1, sz = 1, phiStartDeg = 0, phiLenDeg = 360): THREE.BufferGeometry {
  // LatheGeometry faces outward when the profile runs bottom -> top; auto-orient
  const ordered = profile.length > 1 && profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
  const pts = ordered.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  const g = new THREE.LatheGeometry(pts, segments, phiStartDeg * THREE.MathUtils.DEG2RAD, phiLenDeg * THREE.MathUtils.DEG2RAD);
  if (sx !== 1 || sz !== 1) g.scale(sx, 1, sz);
  return g;
}

export interface LimbOpts {
  bulge?: number;
  bulgeAt?: number;
  sx?: number;
  sz?: number;
  segments?: number;
  steps?: number;
  capTop?: number;
  capBottom?: number;
}

/** A tapered, rounded limb hanging from y=0 down to y=-len. */
export function limb(len: number, r0: number, r1: number, o: LimbOpts = {}): THREE.BufferGeometry {
  const steps = o.steps ?? 8;
  const bulge = o.bulge ?? 0;
  const at = o.bulgeAt ?? 0.35;
  const capT = o.capTop ?? 1;
  const capB = o.capBottom ?? 1;
  const prof: [number, number][] = [];
  // top cap (top -> bottom order, lathe needs consistent order: we go bottom->top later)
  const capSteps = 3;
  for (let i = 0; i <= capSteps; i++) {
    const a = (i / capSteps) * (Math.PI / 2);
    prof.push([Math.sin(a) * r0, Math.cos(a) * r0 * 0.75 * capT]);
  }
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    let r = THREE.MathUtils.lerp(r0, r1, t);
    const d = (t - at) / 0.35;
    r += bulge * Math.exp(-d * d);
    prof.push([r, -t * len]);
  }
  for (let i = 0; i <= capSteps; i++) {
    const a = (i / capSteps) * (Math.PI / 2);
    prof.push([Math.cos(a) * r1, -len - Math.sin(a) * r1 * 0.75 * capB]);
  }
  prof.reverse();
  return lathe(prof, o.segments ?? 12, o.sx ?? 1, o.sz ?? 1);
}

export function ellipsoid(rx: number, ry: number, rz: number, w = 14, h = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

export function rbox(w: number, h: number, d: number, r = 0.02, seg = 1): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

export function cyl(rTop: number, rBot: number, h: number, seg = 12, open = false): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
}

export function torus(r: number, tube: number, rSeg = 6, tSeg = 18, arc = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r, tube, rSeg, tSeg, arc);
}

/**
 * Cone from base (y=0) to tip (y=len) whose tip is bent by `bend` (offset at the tip,
 * quadratic falloff), great for hair spikes, horns and blades of grass.
 */
export function bentCone(len: number, r: number, bend: V3 = [0, 0, 0], seg = 6, hSeg = 6, flatten = 1): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, len, seg, hSeg);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / len;
    const k = t * t;
    p.setXYZ(i, p.getX(i) + bend[0] * k, y + bend[1] * k, p.getZ(i) * flatten + bend[2] * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A flat-ish blade/lock shape: a cone squashed along Z (hair strands, feathers). */
export function hairLock(len: number, width: number, thick: number, bend: V3, seg = 6): THREE.BufferGeometry {
  const g = bentCone(len, width, [0, 0, 0], seg, 7, 1);
  g.scale(1, 1, thick / width);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / len;
    const k = t * t;
    p.setXYZ(i, p.getX(i) + bend[0] * k, p.getY(i) + bend[1] * k, p.getZ(i) + bend[2] * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Extrude a 2D shape (XY plane) by depth along Z, centred on Z. */
export function extrude(shape: THREE.Shape, depth: number, bevel = 0, curveSegments = 10): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: bevel > 0 ? 2 : 0,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

/**
 * Wraps a geometry built in the XY plane around a vertical cylinder of `radius` (centre at the
 * origin, wrapping towards +Z). x becomes arc length, z becomes radial offset.
 */
export function wrapAroundY(g: THREE.BufferGeometry, radius: number): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = x / radius;
    const r = radius + z;
    p.setXYZ(i, Math.sin(a) * r, y, Math.cos(a) * r);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Bends flat geometry drawn in XY (as seen from the front, extruded along +Z) onto the BACK of
 * a lathe shell with the given profile and x/z squash: the piece is turned to face -Z and each
 * vertex is pushed onto the shell's elliptical cross-section at its height, `lift` metres out.
 */
export function wrapOnBack(g: THREE.BufferGeometry, prof: [number, number][], sx: number, sz: number, lift = 0.004): THREE.BufferGeometry {
  const pr = [...prof].sort((a, b) => a[1] - b[1]);
  const radiusAt = (y: number): number => {
    if (y <= pr[0][1]) return pr[0][0];
    for (let i = 1; i < pr.length; i++) {
      if (y <= pr[i][1]) {
        const t = (y - pr[i - 1][1]) / Math.max(pr[i][1] - pr[i - 1][1], 1e-6);
        return pr[i - 1][0] + (pr[i][0] - pr[i - 1][0]) * t;
      }
    }
    return pr[pr.length - 1][0];
  };
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    // 180 degree turn about Y (a rotation, so the winding stays valid), then onto the shell
    const x = -p.getX(i);
    const y = p.getY(i);
    const z = -p.getZ(i);
    const r = radiusAt(y);
    const s = THREE.MathUtils.clamp(x / (r * sx), -0.97, 0.97);
    p.setXYZ(i, x, y, -r * sz * Math.sqrt(1 - s * s) - lift + z);
  }
  g.computeVertexNormals();
  return g;
}

/** Shape helper from a flat list of points [x0,y0,x1,y1,...] */
export function poly(points: number[]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) s.lineTo(points[i], points[i + 1]);
  s.closePath();
  return s;
}

/** Tapered tube swept along points. radius(t) defines the profile. */
export function sweep(points: THREE.Vector3[], radius: (t: number) => number, radial = 6, tubular = 16, closedEnds = true, flat = 1): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const frames = curve.computeFrenetFrames(tubular, false);
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r * flat;
      verts.push(P.x + N.x * c + B.x * s, P.y + N.y * c + B.y * s, P.z + N.z * c + B.z * s);
      uvs.push(j / radial, t);
    }
  }
  // the ring runs N -> B (counter-clockwise around the tangent), so (a, a+1, b) faces outward
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  if (closedEnds) {
    for (const end of [0, tubular]) {
      curve.getPointAt(end / tubular, P);
      const ci = verts.length / 3;
      verts.push(P.x, P.y, P.z);
      uvs.push(0.5, end / tubular);
      for (let j = 0; j < radial; j++) {
        const a = end * (radial + 1) + j;
        if (end === 0) idx.push(ci, a, a + 1);
        else idx.push(ci, a + 1, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Anime head: sphere with a tapered V-shaped jaw. */
export function animeHead(r: number, jaw = 0.35, chinForward = 0.12, female = false): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 22, 16);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    // slightly taller skull, flatter sides
    x *= female ? 0.9 : 0.92;
    y *= 1.06;
    z *= 0.98;
    if (y < 0) {
      const t = Math.min(1, -y / r);
      // narrow toward the chin
      x *= 1 - jaw * t * t;
      z *= 1 - jaw * 0.35 * t * t;
      z += chinForward * r * t * t * (z > 0 ? 1 : 0.25);
      y *= 1 + 0.12 * t;
    }
    // flatten the back of the head a touch less than the face
    if (z < 0) z *= 1.04;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function noteGeometry(scale = 1): THREE.BufferGeometry {
  const head = new THREE.Shape();
  head.absellipse(0, 0, 0.11, 0.08, 0, Math.PI * 2, false, -0.4);
  const stem = poly([0.08, 0.0, 0.115, 0.0, 0.115, 0.42, 0.08, 0.42]);
  const flag = new THREE.Shape();
  flag.moveTo(0.1, 0.42);
  flag.quadraticCurveTo(0.24, 0.36, 0.25, 0.18);
  flag.quadraticCurveTo(0.2, 0.3, 0.1, 0.32);
  flag.closePath();
  const geos = [extrude(head, 0.04, 0.0), extrude(stem, 0.03), extrude(flag, 0.03)];
  const merged = mergeNonIndexed(geos);
  merged.scale(scale, scale, scale);
  merged.translate(-0.06 * scale, -0.15 * scale, 0);
  return merged;
}

/** Merge geometries after converting them to non-indexed with matching attributes. */
export function mergeNonIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = geos.map((g) => {
    let n = g.index ? g.toNonIndexed() : g.clone();
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    if (!n.getAttribute('uv')) {
      n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.getAttribute('position').count * 2), 2));
    }
    for (const name of Object.keys(n.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') n.deleteAttribute(name);
    }
    n.morphAttributes = {};
    return n;
  });
  let total = 0;
  for (const g of prepared) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of prepared) {
    const c = g.getAttribute('position').count;
    pos.set((g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array, o * 3);
    nor.set((g.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array, o * 3);
    uv.set((g.getAttribute('uv') as THREE.BufferAttribute).array as Float32Array, o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Transform helper: position, euler degrees (XYZ order), scale. Returns the same geometry. */
export function xf(g: THREE.BufferGeometry, pos: V3 = [0, 0, 0], rotDeg: V3 = [0, 0, 0], scale: V3 | number = 1): THREE.BufferGeometry {
  const d = THREE.MathUtils.DEG2RAD;
  _e.set(rotDeg[0] * d, rotDeg[1] * d, rotDeg[2] * d, 'XYZ');
  _q.setFromEuler(_e);
  if (typeof scale === 'number') _s.set(scale, scale, scale);
  else _s.set(scale[0], scale[1], scale[2]);
  _p.set(pos[0], pos[1], pos[2]);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  // a mirroring scale turns faces inside out: restore the winding
  if (_s.x * _s.y * _s.z < 0) flipWinding(g);
  return g;
}

export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = g.clone();
  c.scale(-1, 1, 1);
  flipWinding(c);
  c.computeVertexNormals();
  return c;
}

/** reverses every triangle so faces keep pointing outward after a reflection */
function flipWinding(c: THREE.BufferGeometry): void {
  if (c.index) {
    const a = c.index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    c.index.needsUpdate = true;
  } else {
    const pos = c.getAttribute('position') as THREE.BufferAttribute;
    const nor = c.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = c.getAttribute('uv') as THREE.BufferAttribute | undefined;
    for (let i = 0; i < pos.count; i += 3) {
      swapVert(pos, i + 1, i + 2);
      if (nor) swapVert(nor, i + 1, i + 2);
      if (uv) swapVert(uv, i + 1, i + 2);
    }
  }
}

function swapVert(attr: THREE.BufferAttribute, a: number, b: number) {
  const n = attr.itemSize;
  const arr = attr.array as Float32Array;
  for (let k = 0; k < n; k++) {
    const t = arr[a * n + k];
    arr[a * n + k] = arr[b * n + k];
    arr[b * n + k] = t;
  }
}
