import * as THREE from 'three';
import { gradientToon, holoMaterial, neon, toon } from '../render/toon';
import { Rig, type BodySpec } from '../fighter/Rig';
import { ModelBuilder } from '../fighter/ModelBuilder';
import { ClothSheet, type BodySphere } from '../fighter/Cloth';
import { clip, Ease, pose, type PoseSpec } from '../fighter/Animator';
import type { ChampionAnimSet } from '../fighter/locomotion';
import { animeHead, cyl, ellipsoid, extrude, hairLock, lathe, limb, rbox, sweep, torus, xf, type V3 } from '../fighter/shapes';
import { makeBodySpheres } from './body';
import { assembleVisual, marker, sharedClips } from './common';
import type { ChampionVisual } from './types';
import { addAnimeEyes, eyeMaterial, type EyeStyle } from './face';
import { TINY_Y } from '../game/Fighter';

/**
 * ELISABBAT — "La Principessa Vampira". Built on the user's Meshy model (front / back / side
 * shots): Monster High doll proportions (big head, very slim limbs), long straight violet hair
 * with lighter streaks and a blunt fringe, pink eyes with heavy dark make-up, dark lips and
 * fangs, purple drop earrings. Dark lace top with a high collar and puffed shoulders, purple
 * satin bustier, black corset with purple criss-cross lacing, purple satin bubble puffs on the
 * hips over a three-tier grey ruffled skirt, purple bell cuffs at the elbows, bare legs and
 * black knee-high platform boots strapped with silver buckles.
 * No weapon: long purple claws. Her bat form is a second model inside the same root.
 */

/** the head is built at the standard female size and scaled up (doll proportions) */
const HEAD_S = 1.38;

const ELI_SPEC: BodySpec = {
  hipHeight: 0, // the rig derives it from the legs
  spineLen: 0.1,
  chestLen: 0.13,
  neckLen: 0.15,
  clavicle: 0.13,
  shoulderDrop: 0.115,
  upperArm: 0.26,
  foreArm: 0.23,
  hipWidth: 0.072,
  thigh: 0.41,
  shin: 0.4,
  footHeight: 0.12,
  bulk: 0.78,
  female: true,
};

const ELI_EYES: EyeStyle = {
  sclera: 0xffffff, irisTop: 0xc23aa8, irisBottom: 0xffb4ea, pupil: 0x2a0618, lash: 0x0b030a, brow: 0x24091f,
  glow: 0.22, female: true, x: 0.05, y: 0.1, w: 0.05, h: 0.047, tilt: 0.12, gaze: 0.04, browY: 0.012, browFierce: 0.05,
};

const VIOLET = 0xa24cff;
const CRIMSON = 0xff2e6a;

// ---------------------------------------------------------------------------------------------
// textures (data textures: they build in node too, for the pose tools)
// ---------------------------------------------------------------------------------------------

function dataTexture(w: number, h: number, px: (x: number, y: number) => number): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = px(x, y);
      const i = (y * w + x) * 4;
      data[i] = (c >> 16) & 255;
      data[i + 1] = (c >> 8) & 255;
      data[i + 2] = c & 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** deterministic hash noise */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** vertical hair streaks: dark violet base, brighter violet strands, near-black gaps */
function hairStreaks(): THREE.DataTexture {
  const W = 128;
  const cols: number[] = [];
  const palette = [0x40115e, 0x561878, 0x6e2398, 0x8d34c0, 0x2a0a3c, 0x60208a, 0xa955de];
  let x = 0;
  let k = 0;
  while (x < W) {
    const pick = Math.floor(hash(k * 3.1) * palette.length);
    const w = 2 + Math.floor(hash(k * 7.7) * 7);
    for (let i = 0; i < w && x < W; i++, x++) cols.push(palette[pick]);
    k++;
  }
  return dataTexture(W, 4, (px) => cols[px]);
}

/** dark lace: rings and dots on a hex grid over charcoal */
function laceTexture(): THREE.DataTexture {
  const N = 64;
  const base = new THREE.Color(0x2e2a34);
  const line = new THREE.Color(0x77707f);
  const c = new THREE.Color();
  return dataTexture(N, N, (x, y) => {
    // two staggered rows of cells per tile
    const cw = N / 4;
    const ch = N / 4;
    let best = 1e9;
    let dotD = 1e9;
    for (let j = -1; j <= 4; j++) {
      for (let i = -1; i <= 4; i++) {
        const cx = i * cw + (j % 2 ? cw / 2 : 0);
        const cy = j * ch;
        const d = Math.hypot(x - cx, y - cy);
        best = Math.min(best, Math.abs(d - cw * 0.42));
        dotD = Math.min(dotD, d);
      }
    }
    const k = Math.max(THREE.MathUtils.clamp(1 - best / 1.3, 0, 1), THREE.MathUtils.clamp(1 - dotD / 1.6, 0, 1) * 0.8);
    c.copy(base).lerp(line, k);
    return c.getHex();
  });
}

// ---------------------------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------------------------

const D2R = Math.PI / 180;

/**
 * Thick patch of an ellipsoid shell (hair caps, the blunt fringe): outer and inner layers plus
 * the borders. phi runs around +Y from +Z toward +X, theta down from the top pole (degrees).
 * `bump(u, v)` pushes the shell out (strand ridges), u across phi and v down theta (0..1).
 */
function shellPatch(o: { c: V3; r: V3; phi: [number, number]; theta: [number, number]; thick: number; seg: [number, number]; bump?: (u: number, v: number) => number; uScale?: number }): THREE.BufferGeometry {
  const [nu, nv] = o.seg;
  const outer: THREE.Vector3[] = [];
  const inner: THREE.Vector3[] = [];
  const uvs: number[] = [];
  const n = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      const ph = THREE.MathUtils.lerp(o.phi[0], o.phi[1], u) * D2R;
      const th = THREE.MathUtils.lerp(o.theta[0], o.theta[1], v) * D2R;
      const dx = Math.sin(th) * Math.sin(ph);
      const dy = Math.cos(th);
      const dz = Math.sin(th) * Math.cos(ph);
      const p = new THREE.Vector3(o.c[0] + dx * o.r[0], o.c[1] + dy * o.r[1], o.c[2] + dz * o.r[2]);
      n.set(dx / o.r[0], dy / o.r[1], dz / o.r[2]).normalize();
      p.addScaledVector(n, o.bump ? o.bump(u, v) : 0);
      outer.push(p);
      inner.push(p.clone().addScaledVector(n, -o.thick));
      uvs.push(u * (o.uScale ?? 1), v);
    }
  }
  const at = (i: number, j: number) => j * (nu + 1) + i;
  const surf = (pts: THREE.Vector3[], flip: boolean): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const idx: number[] = [];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i, j + 1);
        const d = at(i + 1, j + 1);
        // (a, c, b) faces outward for this parametrisation
        if (flip) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // borders: quads between the outer and inner rims, wound to face away from the patch
  const rim: number[] = [];
  const rimUv: number[] = [];
  const edge = (ids: number[], inward: (k: number) => number) => {
    for (let k = 0; k < ids.length - 1; k++) {
      const o0 = outer[ids[k]];
      const o1 = outer[ids[k + 1]];
      const i0 = inner[ids[k]];
      const i1 = inner[ids[k + 1]];
      const mid = o0.clone().add(o1).multiplyScalar(0.5);
      const away = mid.sub(outer[inward(k)]);
      const nrm = new THREE.Vector3().subVectors(i0, o0).cross(new THREE.Vector3().subVectors(o1, o0));
      const tri = nrm.dot(away) >= 0 ? [o0, i0, o1, o1, i0, i1] : [o0, o1, i0, o1, i1, i0];
      for (const p of tri) {
        rim.push(p.x, p.y, p.z);
        rimUv.push(0.5, 1);
      }
    }
  };
  const row = (j: number) => Array.from({ length: nu + 1 }, (_, i) => at(i, j));
  const col = (i: number) => Array.from({ length: nv + 1 }, (_, j) => at(i, j));
  edge(row(nv), (k) => at(k, nv - 1));
  edge(row(0), (k) => at(k, 1));
  edge(col(0), (k) => at(1, k));
  edge(col(nu), (k) => at(nu - 1, k));
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3));
  rg.setAttribute('uv', new THREE.Float32BufferAttribute(rimUv, 2));
  rg.computeVertexNormals();
  return mergeAll([surf(outer, false), surf(inner, true), rg]);
}

/**
 * Gathered satin bubble around a vertical axis (the hip puffs): radius from r0 (top) to r1
 * (bottom) plus a bulge, folds every 1/gathers of the arc, ends pinched back onto the body.
 */
function puffGeometry(o: { y0: number; y1: number; r0: number; r1: number; bulge: number; phi: [number, number]; gathers: number; depth: number; sx?: number; sz?: number; pinch?: number; seg?: [number, number] }): THREE.BufferGeometry {
  const [nu, nv] = o.seg ?? [40, 12];
  const pos: number[] = [];
  const uvs: number[] = [];
  for (let j = 0; j <= nv; j++) {
    const s = j / nv;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const ph = THREE.MathUtils.lerp(o.phi[0], o.phi[1], u) * D2R;
      const pin = o.pinch ?? 0.18;
      const env = THREE.MathUtils.smoothstep(u, 0, pin) * THREE.MathUtils.smoothstep(1 - u, 0, pin);
      const fold = 1 - o.depth * (0.5 - 0.5 * Math.cos(u * o.gathers * Math.PI * 2));
      const r = THREE.MathUtils.lerp(o.r0, o.r1, s) + o.bulge * Math.pow(Math.sin(Math.PI * s), 0.75) * env * fold;
      pos.push(Math.sin(ph) * r * (o.sx ?? 1), THREE.MathUtils.lerp(o.y0, o.y1, s), Math.cos(ph) * r * (o.sz ?? 1));
      uvs.push(u, s);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** merges geometries keeping each one's own normals (indexed inputs keep smooth shading) */
function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of parts) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of parts) {
    const c = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    const u = g.getAttribute('uv');
    if (u) uv.set(u.array as Float32Array, o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

/** a ring with a wavy edge (ruffles, frills): radius r, `waves` bumps of amplitude a */
function frillRing(r: number, y: number, waves: number, a: number, tube: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const N = waves * 6;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const rr = r + Math.sin(t * waves) * a;
    pts.push(new THREE.Vector3(Math.sin(t) * rr, y + Math.cos(t * waves) * a * 0.8, Math.cos(t) * rr));
  }
  return sweep(pts, () => tube, 5, N, false);
}

/** a point on the (unscaled) standard female head: arc x across the face, height y, lifted out by z */
function faceXf(g: THREE.BufferGeometry, yc: number): THREE.BufferGeometry {
  // standard female anime head: r 0.111 at (0, 0.11, 0.012), x squash 0.9, y stretch 1.06
  const R = 0.111;
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i) + yc;
    const z = p.getZ(i);
    const yr = THREE.MathUtils.clamp((y - 0.11) / (R * 1.06), -0.95, 0.95);
    let r = R * Math.sqrt(1 - yr * yr);
    let zf = 0;
    if (yr < 0) {
      // the jaw narrows toward the chin (animeHead with jaw 0.42)
      const t = Math.min(1, -yr);
      r *= 1 - 0.42 * t * t * 0.55;
      zf = 0.1 * R * t * t;
    }
    const a = x / Math.max(r * 0.9, 1e-4);
    p.setXYZ(i, Math.sin(a) * (r * 0.9 + z), y, Math.cos(a) * (r * 0.98 + z) + 0.012 + zf);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------------------------

export function buildElisabbat(): ChampionVisual {
  const stripes = hairStreaks();
  const stripesDark = hairStreaks();
  const lace = laceTexture();
  lace.repeat.set(9, 5);
  const M: Record<string, THREE.Material> = {
    skin: toon({ color: 0xf7ecf3, shade: 0xe6c8ee, rim: 0.28 }),
    skinDark: toon({ color: 0xc89ac2, rim: 0 }),
    lips: toon({ color: 0x4c1446, shade: 0xc090d0, spec: 0.7, specSize: 0.88, rim: 0.2 }),
    mouth: toon({ color: 0x14030f, rim: 0 }),
    fang: toon({ color: 0xffffff, shade: 0xffffff, rim: 0 }),
    eyes: eyeMaterial(ELI_EYES),
    shadow: toon({ color: 0x6c2c96, shade: 0xc6a0e0, rim: 0 }),
    hair: toon({ color: 0xffffff, map: stripes, shade: 0xc0a8f0, hairBand: 0.16, rim: 0.4 }),
    hairIn: toon({ color: 0x9c84c0, map: stripesDark, shade: 0xb8a0e8, rim: 0.1 }),
    lace: toon({ color: 0xffffff, map: lace, shade: 0xcfc4e2, rim: 0.55 }),
    satin: toon({ color: 0x7232c8, shade: 0xa88af0, spec: 0.75, specSize: 0.86, rim: 0.5 }),
    satinDark: toon({ color: 0x3d1474, shade: 0xc0a0ff, rim: 0.3 }),
    corset: toon({ color: 0x1d1724, spec: 0.4, specSize: 0.9, rim: 0.65 }),
    lacing: toon({ color: 0xa65cff, spec: 0.4, rim: 0.3 }),
    tulle: gradientToon({ color: 0x433f4b, colorB: 0x9d99aa, shade: 0xd0c8e8, from: 0.78, to: 0.97, rim: 0.5 }),
    tulleIn: toon({ color: 0x26232c, rim: 0.2 }),
    boot: toon({ color: 0x1b171f, shade: 0xd8c8ff, spec: 0.6, specSize: 0.9, rim: 0.65 }),
    sole: toon({ color: 0x121014, rim: 0.4 }),
    welt: toon({ color: 0x8f8a99, spec: 0.4, rim: 0.3 }),
    buckle: toon({ color: 0xdadae4, spec: 0.9, specSize: 0.84, rim: 0.4 }),
    nails: toon({ color: 0x8e3ee6, shade: 0xc49cff, spec: 0.85, specSize: 0.9, rim: 0.4 }),
    jewel: toon({ color: 0x9b4dff, shade: 0xd0b0ff, spec: 0.95, specSize: 0.82, rim: 0.4 }),
    batFur: toon({ color: 0x2d1a3d, shade: 0xc8b0ff, spec: 0.25, rim: 0.75 }),
    batWing: toon({ color: 0x46216c, shade: 0xc0a0ff, side: THREE.DoubleSide, rim: 0.45 }),
    batBone: toon({ color: 0x1f0f2c, rim: 0.3 }),
    batEye: neon(0xff5fb4, 2.6),
    clawGlow: neon(VIOLET, 1.8),
    holoWing: holoMaterial(VIOLET, CRIMSON, { intensity: 1.6, scan: 26, glitch: 0.35 }),
  };

  const rig = new Rig(ELI_SPEC);
  const B = rig.byName;
  const s = rig.spec;
  const b = new ModelBuilder(M);
  B.head.scale.setScalar(HEAD_S);

  // --- pelvis (under the skirt) and corset ----------------------------------------------------
  b.add(B.hips, lathe([[0, -0.1], [0.08, -0.092], [0.118, -0.05], [0.126, 0.0], [0.116, 0.05], [0.1, 0.085], [0, 0.095]], 18, 1.1, 0.78), 'corset');
  const corsetProf: [number, number][] = [[0.104, -0.075], [0.094, -0.03], [0.084, 0.02], [0.087, 0.07], [0.098, 0.11], [0.104, 0.13]];
  b.add(B.spine, lathe([[0, -0.08], ...corsetProf, [0, 0.135]], 22, 1.12, 0.8), 'corset');
  // corset point running down between the hip puffs
  const point = new THREE.Shape();
  point.moveTo(-0.045, 0);
  point.lineTo(0.045, 0);
  point.lineTo(0, -0.085);
  point.closePath();
  b.add(B.hips, xf(extrude(point, 0.012, 0.003), [0, 0.03, 0.098], [-12, 0, 0]), 'corset', 0.6);
  // purple trims (top and bottom) and the criss-cross lacing over the front
  b.add(B.spine, xf(torus(0.104, 0.007, 5, 30), [0, -0.072, 0], [90, 0, 0], [1.12, 0.8, 1]), 'satin', 0.4);
  b.add(B.spine, xf(torus(0.104, 0.007, 5, 30), [0, 0.128, 0], [90, 0, 0], [1.12, 0.8, 1]), 'satin', 0.4);
  const frontZ = (y: number) => {
    // corset profile radius at height y, squashed in z, plus a hair of lift
    let r = corsetProf[0][0];
    for (let i = 1; i < corsetProf.length; i++) {
      if (y <= corsetProf[i][1]) {
        const t = (y - corsetProf[i - 1][1]) / (corsetProf[i][1] - corsetProf[i - 1][1]);
        r = THREE.MathUtils.lerp(corsetProf[i - 1][0], corsetProf[i][0], THREE.MathUtils.clamp(t, 0, 1));
        break;
      }
      r = corsetProf[i][0];
    }
    return r * 0.8 + 0.004;
  };
  const LACE_Y = [-0.055, -0.02, 0.015, 0.05, 0.085, 0.115];
  for (let i = 0; i < LACE_Y.length - 1; i++) {
    const y0 = LACE_Y[i];
    const y1 = LACE_Y[i + 1];
    for (const sx of [1, -1]) {
      const a = new THREE.Vector3(sx * 0.022, y0, frontZ(y0));
      const c = new THREE.Vector3(-sx * 0.022, y1, frontZ(y1));
      const m = a.clone().add(c).multiplyScalar(0.5);
      m.z += 0.005;
      b.add(B.spine, sweep([a, m, c], () => 0.0042, 4, 6), 'lacing', 0);
    }
  }
  for (const y of LACE_Y) for (const sx of [1, -1]) b.add(B.spine, xf(torus(0.005, 0.0022, 4, 8), [sx * 0.024, y, frontZ(y) + 0.001]), 'buckle', 0);

  // --- chest: lace top, purple satin bustier ----------------------------------------------------
  const cw = 0.104;
  b.add(B.chest, xf(lathe([[0, -0.03], [cw * 0.95, -0.025], [cw, 0.04], [cw * 1.04, 0.1], [cw * 1.02, 0.135], [cw * 0.78, 0.165], [cw * 0.42, 0.18], [0, 0.185]], 22, 1.2, 0.74), [0, 0, 0.002]), 'lace');
  for (const sx of [1, -1]) {
    b.add(B.chest, xf(ellipsoid(0.058, 0.05, 0.043, 16, 12), [sx * 0.044, 0.035, 0.056], [10, sx * 12, 0]), 'satin', 0.8);
  }
  b.add(B.chest, xf(ellipsoid(0.042, 0.036, 0.03, 12, 10), [0, 0.028, 0.072]), 'satin', 0);
  b.add(B.chest, xf(torus(cw * 1.0, 0.012, 6, 28), [0, -0.01, 0.003], [90, 0, 0], [1.2, 0.76, 1]), 'satin', 0.6);
  // sweetheart neckline edge
  b.add(B.chest, sweep([new THREE.Vector3(0.108, 0.06, 0.02), new THREE.Vector3(0.08, 0.085, 0.068), new THREE.Vector3(0.04, 0.083, 0.088), new THREE.Vector3(0, 0.058, 0.09), new THREE.Vector3(-0.04, 0.083, 0.088), new THREE.Vector3(-0.08, 0.085, 0.068), new THREE.Vector3(-0.108, 0.06, 0.02)], () => 0.006, 5, 20), 'satin', 0.4);

  // --- neck and the high lace collar ----------------------------------------------------------------
  b.add(B.neck, xf(cyl(0.03, 0.036, 0.13, 12), [0, 0.03, 0.005]), 'skin');
  b.add(B.neck, xf(cyl(0.038, 0.046, 0.075, 16), [0, 0.0, 0.004]), 'lace');
  b.add(B.neck, frillRing(0.041, 0.04, 10, 0.004, 0.0045), 'lace', 0.4);
  b.add(B.neck, xf(torus(0.04, 0.004, 5, 18), [0, 0.012, 0.004], [90, 0, 0]), 'satin', 0);

  // --- head ----------------------------------------------------------------------------------------
  b.add(B.head, xf(animeHead(0.111, 0.36, 0.08, true), [0, 0.11, 0.012]), 'skin');
  const eyes = addAnimeEyes(b, B.head, 'eyes', ELI_EYES);
  // purple eyeshadow over the lids (wrapped on the face just under the brows)
  for (const sx of [1, -1]) {
    const sh = new THREE.Shape();
    const ex = sx * ELI_EYES.x!;
    const W = ELI_EYES.w!;
    sh.moveTo(ex - sx * W * 0.62, 0.0);
    sh.quadraticCurveTo(ex - sx * W * 0.1, 0.03, ex + sx * W * 0.7, 0.012);
    sh.quadraticCurveTo(ex + sx * W * 0.2, 0.012, ex - sx * W * 0.62, 0.0);
    b.add(B.head, faceXf(xf(extrude(sh, 0.0006, 0, 12), [0, 0, 0.0009]), ELI_EYES.y! + 0.012), 'shadow', 0, false);
  }
  // nose, lips, fangs
  b.add(B.head, xf(new THREE.ConeGeometry(0.0075, 0.02, 4), [0, 0.072, 0.012 + 0.111 * 0.985], [-22, 45, 0], [1, 1, 0.7]), 'skinDark', 0);
  const lipU = new THREE.Shape();
  lipU.moveTo(-0.027, 0.001);
  lipU.quadraticCurveTo(-0.014, 0.0105, -0.0045, 0.0095);
  lipU.lineTo(0, 0.0068);
  lipU.lineTo(0.0045, 0.0095);
  lipU.quadraticCurveTo(0.014, 0.0105, 0.027, 0.001);
  lipU.quadraticCurveTo(0, -0.0025, -0.027, 0.001);
  b.add(B.head, faceXf(xf(extrude(lipU, 0.004, 0.0012, 10), [0, 0, 0.001]), 0.046), 'lips', 0.4);
  const lipL = new THREE.Shape();
  lipL.moveTo(-0.024, 0);
  lipL.quadraticCurveTo(0, -0.003, 0.024, 0);
  lipL.quadraticCurveTo(0, -0.02, -0.024, 0);
  b.add(B.head, faceXf(xf(extrude(lipL, 0.005, 0.0014, 10), [0, -0.001, 0.0014]), 0.046), 'lips', 0.4);
  b.add(B.head, faceXf(xf(rbox(0.044, 0.0016, 0.002, 0.0008), [0, 0.0002, 0.0042]), 0.046), 'mouth', 0);
  for (const sx of [1, -1]) {
    const fang = new THREE.ConeGeometry(0.003, 0.011, 6);
    b.add(B.head, faceXf(xf(fang, [sx * 0.012, -0.004, 0.0062], [180, 0, 0]), 0.046), 'fang', 0.3);
  }
  // pointed vampire ears (the tips show through the hair) + purple drop earrings
  for (const sx of [1, -1]) {
    const ear = new THREE.ConeGeometry(0.019, 0.07, 8);
    b.add(B.head, xf(ear, [sx * 0.101, 0.115, -0.012], [-24, 0, sx * -38], [1, 1, 0.45]), 'skin', 0.6);
    b.add(B.head, xf(ellipsoid(0.007, 0.007, 0.007, 10, 8), [sx * 0.098, 0.066, 0.004]), 'jewel', 0.4);
    b.add(B.head, xf(ellipsoid(0.009, 0.013, 0.009, 10, 8), [sx * 0.099, 0.046, 0.004]), 'jewel', 0.4);
    b.add(B.head, xf(cyl(0.0015, 0.0015, 0.016, 4), [sx * 0.098, 0.074, 0.003]), 'buckle', 0);
  }

  // --- hair ------------------------------------------------------------------------------------------
  // cap: covers the crown and the back of the skull, open over the face
  b.add(B.head, shellPatch({ c: [0, 0.112, 0.004], r: [0.108, 0.122, 0.116], phi: [-180, 180], theta: [0, 58], thick: 0.012, seg: [48, 10], uScale: 6, bump: (u) => 0.009 + 0.002 * Math.abs(Math.sin(u * Math.PI * 30)) }), 'hair', 0.8);
  b.add(B.head, shellPatch({ c: [0, 0.112, 0.004], r: [0.108, 0.122, 0.116], phi: [62, 298], theta: [56, 112], thick: 0.012, seg: [40, 8], uScale: 5, bump: (u) => 0.01 + 0.002 * Math.abs(Math.sin(u * Math.PI * 24)) }), 'hair', 0.8);
  // the blunt fringe: straight cut just above the brows, slightly fuller at the bottom edge
  b.add(B.head, shellPatch({ c: [0, 0.112, 0.006], r: [0.106, 0.12, 0.116], phi: [-70, 70], theta: [6, 73], thick: 0.012, seg: [48, 12], uScale: 4, bump: (u, v) => 0.013 + 0.008 * v * v + 0.0026 * Math.abs(Math.sin(u * Math.PI * 24)) - 0.004 * Math.pow(Math.abs(u - 0.5) * 2, 4) }), 'hair', 0.8);
  // side hair hugging the head from the temples down past the ears, and a lock in front of each ear
  for (const sx of [1, -1]) {
    const phi: [number, number] = sx > 0 ? [58, 104] : [-104, -58];
    b.add(B.head, shellPatch({ c: [0, 0.112, 0.004], r: [0.106, 0.122, 0.114], phi, theta: [50, 128], thick: 0.012, seg: [10, 12], uScale: 2, bump: (u, v) => 0.012 + 0.012 * v + 0.002 * Math.abs(Math.sin(u * Math.PI * 7)) }), 'hair', 0.7);
    b.add(B.head, xf(hairLock(0.15, 0.03, 0.01, [sx * 0.004, 0, 0.012]), [sx * 0.098, 0.15, 0.045], [180 - 2, sx * 14, sx * -3]), 'hair', 0.5);
  }

  // --- arms: puffed lace shoulders, lace sleeves, purple bell cuffs, bare forearms ------------------
  const nailTips: THREE.Object3D[] = [];
  const clawBase: THREE.Object3D[] = [];
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const ua = B[`upperArm${side}`];
    const fa = B[`foreArm${side}`];
    const hand = B[`hand${side}`];
    b.add(ua, xf(ellipsoid(0.058, 0.056, 0.058, 16, 12), [sx * 0.012, -0.022, 0]), 'lace');
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      b.add(ua, xf(ellipsoid(0.03, 0.04, 0.03, 10, 8), [sx * 0.012 + Math.sin(a) * 0.04, -0.03, Math.cos(a) * 0.04]), 'lace', 0.5);
    }
    b.add(ua, limb(s.upperArm, 0.032, 0.027, { capTop: 0.4 }), 'lace');
    b.add(ua, xf(torus(0.031, 0.004, 5, 14), [0, -s.upperArm * 0.86, 0], [90, 0, 0]), 'satin', 0);
    // bell cuff: purple satin outside, lace frill peeking out
    const bell: [number, number][] = [[0.03, 0.02], [0.034, -0.015], [0.045, -0.048], [0.06, -0.078], [0.07, -0.095]];
    b.add(fa, lathe(bell, 18), 'satin');
    b.add(fa, xf(lathe(bell.map(([r, y]) => [r * 0.96, y]), 18), [0, 0, 0]), 'satinDark', 0);
    b.add(fa, frillRing(0.069, -0.098, 8, 0.006, 0.0055), 'satin', 0.5);
    b.add(fa, frillRing(0.05, -0.088, 9, 0.004, 0.0045), 'lace', 0);
    b.add(fa, limb(s.foreArm, 0.024, 0.018, { capTop: 0.3 }), 'skin');
    addClawHand(b, hand, sx, nailTips, clawBase);
  }

  // --- legs: bare, slim; knee-high platform boots with buckled straps -------------------------------
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const th = B[`thigh${side}`];
    const sh = B[`shin${side}`];
    const ft = B[`foot${side}`];
    b.add(th, xf(limb(s.thigh, 0.05, 0.033, { bulge: 0.004, bulgeAt: 0.2, capTop: 0.6 }), [sx * 0.003, 0, 0]), 'skin');
    b.add(sh, xf(ellipsoid(0.03, 0.034, 0.024, 10, 8), [0, -0.004, 0.018]), 'skin', 0.5);
    addPlatformBoot(b, sh, ft, sx, s.shin);
  }

  // --- hip puffs: two gathered satin bubbles, open at the front over the skirt ----------------------
  for (const sx of [1, -1]) {
    const phi: [number, number] = sx > 0 ? [24, 178] : [-178, -24];
    b.add(B.hips, puffGeometry({ y0: 0.092, y1: -0.105, r0: 0.112, r1: 0.13, bulge: 0.125, phi, gathers: 4, depth: 0.12, sx: 1.0, sz: 0.9, seg: [44, 16] }), 'satin', 1);
    b.add(B.hips, puffGeometry({ y0: 0.088, y1: -0.1, r0: 0.108, r1: 0.125, bulge: 0.114, phi, gathers: 4, depth: 0.16, sx: 1.0, sz: 0.9, seg: [44, 16] }), 'satinDark', 0);
  }

  // --- markers: hook launchers on the hips, gas nozzle under the hair, claw blades -------------------
  const gearL = marker(B.hips, 0.2, 0.0, 0.03, 'gearL');
  const gearR = marker(B.hips, -0.2, 0.0, 0.03, 'gearR');
  const nozzle = marker(B.spine, 0, 0.02, -0.13, 'nozzle');
  const muzzle = marker(B.handR, 0, -0.12, 0, 'muzzle');
  const blades = [0, 1].map((i) => ({ base: clawBase[i], tip: nailTips[i], colorA: new THREE.Color(VIOLET), colorB: new THREE.Color(CRIMSON), width: 1 }));

  // --- cloth: three ruffled skirt tiers and the long hair curtain -------------------------------------
  const spheres = makeBodySpheres(rig);
  const skirtSpheres: BodySphere[] = [
    ...spheres,
    { bone: B.hips, offset: new THREE.Vector3(0, -0.05, 0), radius: 0.15, world: new THREE.Vector3() },
  ];
  const tier = (y: number, rx: number, rz: number, len: number, flare: number, n: number, stiff: number) => {
    const cols = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const wob = i % 2 ? 1 : -1;
      cols.push({
        offset: new THREE.Vector3(Math.sin(a) * rx, y, Math.cos(a) * rz),
        restDir: new THREE.Vector3(Math.sin(a) * (flare + wob * 0.2), -1, Math.cos(a) * (flare * 0.9 + wob * 0.18)),
        length: len * (1 + wob * 0.06),
      });
    }
    return new ClothSheet({ anchor: B.hips, columns: cols, rows: 2, closed: true, stiffness: stiff, stiffFalloff: 0.3, damping: 0.88, gravity: 7, thickness: 0.012, outer: M.tulle, inner: M.tulleIn, smoothH: 2, smoothV: 2, slackH: 1.25 }, skirtSpheres);
  };
  const skirt3 = tier(-0.11, 0.158, 0.134, 0.24, 0.6, 32, 0.15);
  const skirt2 = tier(-0.08, 0.152, 0.128, 0.195, 0.68, 30, 0.17);
  const skirt1 = tier(-0.05, 0.146, 0.122, 0.15, 0.78, 28, 0.19);

  // hair curtain: hangs from a band around the back of the head down past the hips
  const headSphere: BodySphere = { bone: B.head, offset: new THREE.Vector3(0, 0.11, 0.0), radius: 0.118, world: new THREE.Vector3() };
  const hairSpheres: BodySphere[] = [
    ...spheres.filter((sp) => sp.bone !== B.upperArmL && sp.bone !== B.upperArmR),
    headSphere,
    { bone: B.neck, offset: new THREE.Vector3(0, 0.02, -0.01), radius: 0.07, world: new THREE.Vector3() },
    // shoulders on the chest (not the arms): a raised arm must not flip the hair over the face
    { bone: B.chest, offset: new THREE.Vector3(0.13, 0.115, -0.015), radius: 0.075, world: new THREE.Vector3() },
    { bone: B.chest, offset: new THREE.Vector3(-0.13, 0.115, -0.015), radius: 0.075, world: new THREE.Vector3() },
    { bone: B.chest, offset: new THREE.Vector3(0, 0.1, -0.05), radius: 0.14, world: new THREE.Vector3() },
    { bone: B.hips, offset: new THREE.Vector3(0.16, -0.01, -0.02), radius: 0.15, world: new THREE.Vector3() },
    { bone: B.hips, offset: new THREE.Vector3(-0.16, -0.01, -0.02), radius: 0.15, world: new THREE.Vector3() },
    { bone: B.hips, offset: new THREE.Vector3(0, -0.06, -0.08), radius: 0.2, world: new THREE.Vector3() },
  ];
  const hairCols = [];
  const HN = 19;
  for (let i = 0; i < HN; i++) {
    const t = i / (HN - 1);
    const ph = THREE.MathUtils.lerp(72, 288, t) * D2R;
    const side = Math.sin(ph);
    const back = (1 - Math.cos(ph)) / 2;
    // on the skull, from the temples (lower) over the crown at the back (higher)
    const th = THREE.MathUtils.lerp(64, 38, back) * D2R;
    hairCols.push({
      offset: new THREE.Vector3(Math.sin(th) * side * 0.118, 0.112 + Math.cos(th) * 0.13, 0.004 + Math.sin(th) * Math.cos(ph) * 0.122),
      restDir: new THREE.Vector3(side * 0.22, -1, Math.cos(ph) * 0.22 - 0.16),
      length: 0.52 + back * 0.3,
    });
  }
  const hair = new ClothSheet({ anchor: B.head, columns: hairCols, rows: 6, closed: false, stiffness: 0.05, stiffFalloff: 0.75, damping: 0.9, gravity: 9, thickness: 0.03, outer: M.hair, inner: M.hairIn, smoothH: 2, smoothV: 2, slackH: 1.5, restYawOnly: true }, hairSpheres);
  // --- bat form (hidden until she transforms) and the spectral wings of her ultimate -----------------
  const bat = buildBatForm(b);
  const ultWings = new THREE.Group();
  ultWings.name = 'ultWings';
  ultWings.visible = false;
  ultWings.position.set(0, 0.08, -0.12);
  B.chest.add(ultWings);
  for (const sx of [1, -1]) {
    const w = new THREE.Group();
    w.name = sx > 0 ? 'ultWingL' : 'ultWingR';
    w.position.x = sx * 0.06;
    ultWings.add(w);
    b.add(w, xf(wingMembrane(), [0, 0, 0], [90, 0, 0], [sx * 3.1, 3.1, 3.1]), 'holoWing', 0, false);
  }

  const anims = elisabbatAnims();
  const visual = assembleVisual({
    rig,
    builder: b,
    cloth: [skirt3, skirt2, skirt1, hair],
    bodySpheres: hairSpheres,
    blades,
    gear: { gearL, gearR, nozzle },
    weaponR: null,
    weaponL: null,
    offhandGrip: null,
    muzzle,
    materials: Object.values(M),
    anims,
    eyes,
    tick: (dt, t) => {
      if (bat.group.visible) {
        const flap = Math.sin(t * 19);
        bat.wingL.rotation.z = 0.15 + flap * 0.85;
        bat.wingR.rotation.z = -0.15 - flap * 0.85;
        bat.wingL.rotation.y = flap * 0.18;
        bat.wingR.rotation.y = -flap * 0.18;
        bat.body.position.y = -flap * 0.03;
      }
      if (ultWings.visible) {
        const f = Math.sin(t * 3.2);
        ultWings.children[0].rotation.y = -0.35 + f * 0.18;
        ultWings.children[1].rotation.y = 0.35 - f * 0.18;
      }
    },
  });
  visual.root.add(bat.group);
  return visual;
}

/** slender open hand with long fingers and purple claws; pushes the blade markers (base, tip) */
function addClawHand(b: ModelBuilder, hand: THREE.Object3D, sx: number, tips: THREE.Object3D[], bases: THREE.Object3D[]): void {
  // palm faces the body (-sx X), the thumb sits on the front (+Z), fingers run down -Y
  b.add(hand, xf(rbox(0.02, 0.062, 0.046, 0.009), [sx * 0.002, -0.032, 0.002]), 'skin', 0.7);
  const fingers: Array<[number, number]> = [[0.015, 0.06], [0.005, 0.067], [-0.006, 0.064], [-0.016, 0.054]];
  for (const [z, len] of fingers) {
    const curl = -sx * 14;
    const g = limb(len, 0.0062, 0.0048, { segments: 7, steps: 4 });
    b.add(hand, xf(g, [sx * 0.002, -0.062, z], [0, 0, curl]), 'skin', 0.55);
    // claw: a long pointed nail continuing the finger
    const tipY = -0.062 - len * Math.cos(curl * D2R);
    const tipX = sx * 0.002 + len * Math.sin(curl * D2R) * -1;
    const nail = new THREE.ConeGeometry(0.0055, 0.024, 6);
    b.add(hand, xf(nail, [tipX + sx * 0.0018, tipY - 0.009, z], [180, 0, curl]), 'nails', 0.4);
  }
  // thumb
  b.add(hand, xf(limb(0.045, 0.007, 0.0055, { segments: 7, steps: 4 }), [-sx * 0.004, -0.018, 0.022], [38, 0, -sx * 20]), 'skin', 0.55);
  b.add(hand, xf(new THREE.ConeGeometry(0.005, 0.018, 6), [-sx * 0.019, -0.052, 0.046], [180 + 38, 0, -sx * 20]), 'nails', 0.4);
  bases.push(marker(hand, 0, -0.05, 0, 'clawBase'));
  tips.push(marker(hand, sx * -0.01, -0.15, 0, 'clawTip'));
}

/** knee-high black boot: shaft with buckled straps, platform sole with a chunky heel */
function addPlatformBoot(b: ModelBuilder, shin: THREE.Object3D, foot: THREE.Object3D, sx: number, shinLen: number): void {
  // shaft from just under the knee to the ankle
  const top = -0.035;
  const prof: [number, number][] = [[0.057, top], [0.056, top - 0.06], [0.053, -0.16], [0.05, -0.27], [0.047, -shinLen + 0.03], [0.048, -shinLen - 0.01]];
  b.add(shin, lathe(prof, 18, 1, 1.04), 'boot');
  b.add(shin, xf(torus(0.057, 0.007, 5, 20), [0, top, 0], [90, 0, 0], [1, 1.04, 1]), 'boot', 0.5);
  // straps with silver buckles on the outer side
  const strapY = [-0.07, -0.12, -0.17, -0.22, -0.27, -0.32];
  for (const y of strapY) {
    const t = THREE.MathUtils.clamp((top - y) / (shinLen - 0.02), 0, 1);
    const r = THREE.MathUtils.lerp(0.057, 0.048, t) + 0.004;
    b.add(shin, xf(torus(r, 0.009, 4, 22), [0, y, 0], [90, 0, 0], [1, 1.04, 0.62]), 'sole', 0.5);
    b.add(shin, xf(rbox(0.008, 0.026, 0.028, 0.003), [sx * (r + 0.006), y, 0.006]), 'buckle', 0.4);
    b.add(shin, xf(rbox(0.009, 0.012, 0.014, 0.002), [sx * (r + 0.008), y, 0.006]), 'sole', 0);
  }
  // front lacing hooks
  for (let i = 0; i < 6; i++) b.add(shin, xf(ellipsoid(0.004, 0.004, 0.004, 6, 4), [0, -0.06 - i * 0.052, 0.053]), 'buckle', 0);
  // a dangling strap end at the back
  b.add(shin, xf(rbox(0.012, 0.06, 0.006, 0.003), [sx * 0.012, -0.12, -0.05], [8, 0, sx * 6]), 'sole', 0.4);
  // foot: sloping down toward the toes (the ankle sits on the platform heel)
  b.add(foot, xf(cyl(0.048, 0.05, 0.06, 14), [0, 0.0, -0.004]), 'boot');
  b.add(foot, xf(rbox(0.088, 0.075, 0.17, 0.032), [sx * 0.002, -0.032, 0.05], [14, 0, 0]), 'boot');
  b.add(foot, xf(ellipsoid(0.046, 0.036, 0.054, 12, 8), [sx * 0.002, -0.058, 0.118]), 'boot', 0.6);
  // platform under the forefoot, chunky heel, grey welt line
  b.add(foot, xf(rbox(0.1, 0.052, 0.13, 0.012), [sx * 0.002, -0.094, 0.105]), 'sole', 0.8);
  b.add(foot, xf(rbox(0.094, 0.09, 0.085, 0.01), [sx * 0.002, -0.075, -0.018]), 'sole', 0.8);
  b.add(foot, xf(rbox(0.098, 0.034, 0.08, 0.008), [sx * 0.002, -0.096, 0.048]), 'sole', 0.6);
  b.add(foot, xf(rbox(0.104, 0.008, 0.24, 0.003), [sx * 0.002, -0.067, 0.058], [4, 0, 0]), 'welt', 0);
  // tread grooves on the sole edge
  for (let i = 0; i < 5; i++) b.add(foot, xf(rbox(0.104, 0.006, 0.01, 0.002), [sx * 0.002, -0.113, 0.0 + i * 0.045]), 'welt', 0);
}

/** the bat wing membrane, flat in the XY plane (x outward along the span, y toward the front) */
function wingMembrane(): THREE.BufferGeometry {
  const w = new THREE.Shape();
  w.moveTo(0, 0.05);
  w.quadraticCurveTo(0.1, 0.1, 0.19, 0.075);
  w.lineTo(0.42, 0.02);
  w.quadraticCurveTo(0.36, -0.015, 0.34, -0.07);
  w.lineTo(0.37, -0.15);
  w.quadraticCurveTo(0.29, -0.11, 0.24, -0.13);
  w.lineTo(0.22, -0.22);
  w.quadraticCurveTo(0.16, -0.14, 0.1, -0.15);
  w.quadraticCurveTo(0.05, -0.1, 0, -0.08);
  w.closePath();
  return extrude(w, 0.006, 0.0015, 10);
}

/** the small bat she turns into: fuzzy body, big ears, pink eyes, fangs and her violet fringe */
function buildBatForm(b: ModelBuilder): { group: THREE.Group; wingL: THREE.Group; wingR: THREE.Group; body: THREE.Group } {
  const group = new THREE.Group();
  group.name = 'batForm';
  group.position.y = TINY_Y;
  group.visible = false;
  const body = new THREE.Group();
  body.name = 'batBody';
  group.add(body);
  b.add(body, xf(ellipsoid(0.075, 0.072, 0.115, 14, 10), [0, 0, -0.01]), 'batFur');
  b.add(body, xf(ellipsoid(0.05, 0.03, 0.08, 12, 8), [0, -0.04, 0.0]), 'batFur', 0.5);
  // head
  b.add(body, xf(ellipsoid(0.066, 0.06, 0.064, 14, 10), [0, 0.035, 0.11]), 'batFur');
  b.add(body, xf(ellipsoid(0.03, 0.022, 0.03, 10, 8), [0, 0.018, 0.165]), 'batFur', 0.6);
  for (const sx of [1, -1]) {
    b.add(body, xf(new THREE.ConeGeometry(0.03, 0.1, 8), [sx * 0.04, 0.1, 0.1], [-12, 0, sx * -22], [1, 1, 0.45]), 'batFur', 0.7);
    b.add(body, xf(new THREE.ConeGeometry(0.018, 0.07, 8), [sx * 0.041, 0.097, 0.108], [-12, 0, sx * -22], [1, 1, 0.3]), 'batWing', 0);
    b.add(body, xf(ellipsoid(0.013, 0.015, 0.008, 10, 8), [sx * 0.027, 0.048, 0.165]), 'batEye', 0);
    b.add(body, xf(new THREE.ConeGeometry(0.0045, 0.016, 5), [sx * 0.009, -0.004, 0.18], [180, 0, 0]), 'fang', 0.3);
    // tiny feet tucked under
    b.add(body, xf(cyl(0.006, 0.004, 0.04, 5), [sx * 0.03, -0.07, -0.08], [40, 0, 0]), 'batBone', 0.4);
  }
  // her fringe on the bat's forehead
  for (let i = -2; i <= 2; i++) {
    b.add(body, xf(hairLock(0.05, 0.014, 0.006, [0, 0, 0.012]), [i * 0.011, 0.085, 0.15], [180 - 50, i * 8, 0]), 'hair', 0.5);
  }
  const mkWing = (sx: number): THREE.Group => {
    const w = new THREE.Group();
    w.name = sx > 0 ? 'batWingL' : 'batWingR';
    w.position.set(sx * 0.055, 0.025, 0.02);
    body.add(w);
    b.add(w, xf(wingMembrane(), [0, 0, 0], [90, 0, 0], [sx, 1, 1]), 'batWing', 0.7);
    // arm and finger bones
    const P = (x: number, y: number) => new THREE.Vector3(sx * x, 0.004, y);
    b.add(w, sweep([P(0, 0.05), P(0.1, 0.095), P(0.19, 0.075)], () => 0.009, 5, 8), 'batBone', 0.5);
    for (const tip of [[0.42, 0.02], [0.37, -0.15], [0.22, -0.22]] as const) b.add(w, sweep([P(0.19, 0.075), P((0.19 + tip[0]) / 2, (0.075 + tip[1]) / 2 + 0.01), P(tip[0], tip[1])], (t) => 0.005 * (1 - t * 0.6), 4, 8), 'batBone', 0.4);
    return w;
  };
  return { group, wingL: mkWing(1), wingR: mkWing(-1), body };
}

// ---------------------------------------------------------------------------------------------
// animations
// ---------------------------------------------------------------------------------------------

function elisabbatAnims(): ChampionAnimSet {
  // doll stance: weight on the right leg, left hand on the hip, right hand loose with the claws
  const legs: PoseSpec = {
    hips: [0, -0.008, 0],
    thighL: [-8, -10, -3], shinL: [14, 0, 0], footL: [-4, 4, 0],
    thighR: [2, 8, 3], shinR: [3, 0, 0], footR: [-1, -6, 0],
    spine: [-2, 8, -3], chest: [-3, 6, 2], neck: [2, -6, 0], head: [4, -10, 7],
  };
  const onHip = { p: [0.185, 1.045, -0.025], d: [0, 0.85, 0.5], u: [0, 0.5, -0.85] } as const;
  const idle = pose({
    ...legs,
    wL: { p: [...onHip.p], d: [...onHip.d], u: [...onHip.u] },
    upperArmR: [4, 0, -12], foreArmR: [-22, 0, 0], handR: [0, -16, -12],
  });
  const runArms = pose({ upperArmL: [0, 0, 18], foreArmL: [-72, 0, 0], handL: [0, 0, 10], upperArmR: [0, 0, -18], foreArmR: [-72, 0, 0], handR: [0, 0, -10] });
  const airArms = pose({ upperArmL: [-16, 0, 52], foreArmL: [-34, 0, 0], upperArmR: [-16, 0, -52], foreArmR: [-34, 0, 0] });
  const flyArms = pose({ upperArmL: [34, 0, 30], foreArmL: [-26, 0, 0], handL: [0, 0, 20], upperArmR: [34, 0, -30], foreArmR: [-26, 0, 0], handR: [0, 0, -20] });
  const base = pose(legs);
  const stand: PoseSpec = { ...legs };
  const clips = {
    ...sharedClips(idle),
    // ---- RMB: Artigli di Velluto -------------------------------------------------------------
    c1: clip('c1', base, [
      [0, { ...stand, spine: [0, -24, 0], chest: [-4, -16, 0], upperArmR: [-40, 10, -112], foreArmR: [-70, 0, 0], handR: [0, 0, -20], upperArmL: [10, 0, 26], foreArmL: [-60, 0, 0] }],
      [0.09, { spine: [6, 18, 0], chest: [4, 14, 0], upperArmR: [-88, 34, -18], foreArmR: [-12, 0, 0], handR: [0, 0, 10], upperArmL: [14, 0, 30], foreArmL: [-70, 0, 0], thighL: [-20, -10, -3], shinL: [24, 0, 0], hips: [0, -0.03, 0.03] }, Ease.outQuart],
      [0.2, { spine: [8, 30, 0], chest: [6, 18, 0], upperArmR: [-46, 56, 14], foreArmR: [-34, 0, 0], handR: [0, 0, 20], upperArmL: [14, 0, 30], foreArmL: [-70, 0, 0], thighL: [-20, -10, -3], shinL: [24, 0, 0], hips: [0, -0.03, 0.03] }, Ease.outCubic],
      [0.34, { ...stand }, Ease.inOut],
    ], { events: [{ t: 0.03, id: 'swing' }, { t: 0.06, id: 'hitOn' }, { t: 0.19, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.12 }),
    c2: clip('c2', base, [
      [0, { ...stand, spine: [0, 24, 0], chest: [-4, 16, 0], upperArmL: [-40, -10, 112], foreArmL: [-70, 0, 0], handL: [0, 0, 20], upperArmR: [10, 0, -26], foreArmR: [-60, 0, 0] }],
      [0.09, { spine: [6, -18, 0], chest: [4, -14, 0], upperArmL: [-88, -34, 18], foreArmL: [-12, 0, 0], handL: [0, 0, -10], upperArmR: [14, 0, -30], foreArmR: [-70, 0, 0], thighR: [-18, 8, 3], shinR: [22, 0, 0], hips: [0, -0.03, 0.03] }, Ease.outQuart],
      [0.2, { spine: [8, -30, 0], chest: [6, -18, 0], upperArmL: [-46, -56, -14], foreArmL: [-34, 0, 0], handL: [0, 0, -20], upperArmR: [14, 0, -30], foreArmR: [-70, 0, 0], thighR: [-18, 8, 3], shinR: [22, 0, 0], hips: [0, -0.03, 0.03] }, Ease.outCubic],
      [0.34, { ...stand }, Ease.inOut],
    ], { events: [{ t: 0.03, id: 'swing' }, { t: 0.06, id: 'hitOn' }, { t: 0.19, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.12 }),
    // the finisher: arms cross high, then a double slash down and out (an X)
    c3: clip('c3', base, [
      [0, { ...stand }],
      [0.13, { ...stand, spine: [-10, 0, 0], chest: [-8, 0, 0], head: [-6, 0, 0], upperArmL: [-150, -30, 10], foreArmL: [-50, 0, 0], upperArmR: [-150, 30, -10], foreArmR: [-50, 0, 0], hips: [0, 0.03, 0], thighL: [-30, -6, 0], shinL: [50, 0, 0] }, Ease.outCubic],
      [0.22, { ...stand, spine: [22, 0, 0], chest: [10, 0, 0], head: [-14, 0, 0], upperArmL: [-60, 30, 40], foreArmL: [-8, 0, 0], upperArmR: [-60, -30, -40], foreArmR: [-8, 0, 0], hips: [0, -0.1, 0.04], thighL: [-50, -6, 0], shinL: [70, 0, 0], thighR: [10, 6, 0], shinR: [40, 0, 0] }, Ease.outQuart],
      [0.34, { ...stand, spine: [18, 0, 0], chest: [8, 0, 0], head: [-10, 0, 0], upperArmL: [-20, 30, 60], foreArmL: [-20, 0, 0], upperArmR: [-20, -30, -60], foreArmR: [-20, 0, 0], hips: [0, -0.08, 0.03], thighL: [-46, -6, 0], shinL: [64, 0, 0], thighR: [10, 6, 0], shinR: [36, 0, 0] }],
      [0.52, { ...stand }, Ease.inOut],
    ], { events: [{ t: 0.12, id: 'swing' }, { t: 0.17, id: 'hitOn' }, { t: 0.32, id: 'hitOff' }], fadeIn: 0.04, fadeOut: 0.15 }),
    // aerial: diving claws
    air: clip('air', base, [
      [0, { spine: [-10, 0, 0], chest: [-6, 0, 0], upperArmL: [-150, 0, 30], foreArmL: [-40, 0, 0], upperArmR: [-150, 0, -30], foreArmR: [-40, 0, 0], thighL: [-40, 0, 6], shinL: [80, 0, 0], thighR: [-20, 0, -6], shinR: [70, 0, 0] }],
      [0.1, { spine: [26, 0, 0], chest: [14, 0, 0], head: [-20, 0, 0], upperArmL: [-60, 20, 26], foreArmL: [-10, 0, 0], upperArmR: [-60, -20, -26], foreArmR: [-10, 0, 0], thighL: [10, 0, 6], shinL: [60, 0, 0], thighR: [20, 0, -6], shinR: [70, 0, 0] }, Ease.outQuart],
      [0.3, { spine: [20, 0, 0], chest: [10, 0, 0], head: [-16, 0, 0], upperArmL: [-20, 20, 40], foreArmL: [-20, 0, 0], upperArmR: [-20, -20, -40], foreArmR: [-20, 0, 0], thighL: [6, 0, 6], shinL: [50, 0, 0], thighR: [16, 0, -6], shinR: [60, 0, 0] }],
      [0.42, {}, Ease.inOut],
    ], { events: [{ t: 0.04, id: 'swing' }, { t: 0.07, id: 'hitOn' }, { t: 0.3, id: 'hitOff' }], fadeIn: 0.03, fadeOut: 0.12 }),
    // ---- LMB: Spellvamp ----------------------------------------------------------------------
    // the pounce toward the victim (held while she flies at it)
    lunge: clip('lunge', base, [
      [0, { spine: [34, 0, 0], chest: [10, 0, 0], neck: [-20, 0, 0], head: [-26, 0, 0], upperArmL: [-96, 0, 22], foreArmL: [-14, 0, 0], handL: [0, 0, 14], upperArmR: [-96, 0, -22], foreArmR: [-14, 0, 0], handR: [0, 0, -14], thighL: [24, 0, 4], shinL: [70, 0, 0], footL: [40, 0, 0], thighR: [40, 0, -4], shinR: [80, 0, 0], footR: [40, 0, 0], hips: [0, 0.02, 0] }],
      [0.3, { spine: [34, 0, 0], chest: [10, 0, 0], neck: [-20, 0, 0], head: [-26, 0, 0], upperArmL: [-100, 0, 20], foreArmL: [-18, 0, 0], handL: [0, 0, 14], upperArmR: [-100, 0, -20], foreArmR: [-18, 0, 0], handR: [0, 0, -14], thighL: [24, 0, 4], shinL: [70, 0, 0], footL: [40, 0, 0], thighR: [40, 0, -4], shinR: [80, 0, 0], footR: [40, 0, 0], hips: [0, 0.02, 0] }],
    ], { fadeIn: 0.04, fadeOut: 0.1 }),
    // grab the shoulders, sink the fangs, drink, push away
    bite: clip('bite', base, [
      [0, { ...stand, spine: [16, 0, 0], chest: [8, 0, 0], head: [-10, 0, 0], upperArmL: [-90, -14, 30], foreArmL: [-64, 0, 0], handL: [0, 0, 30], upperArmR: [-90, 14, -30], foreArmR: [-64, 0, 0], handR: [0, 0, -30] }],
      [0.08, { ...stand, spine: [22, 6, 0], chest: [12, 6, 0], neck: [16, 20, 10], head: [22, 26, 18], upperArmL: [-84, -16, 24], foreArmL: [-80, 0, 0], handL: [0, 0, 30], upperArmR: [-84, 16, -24], foreArmR: [-80, 0, 0], handR: [0, 0, -30], hips: [0, -0.02, 0.02] }, Ease.outQuart],
      [0.42, { ...stand, spine: [24, 6, 0], chest: [14, 6, 0], neck: [18, 22, 10], head: [24, 28, 20], upperArmL: [-84, -16, 24], foreArmL: [-84, 0, 0], handL: [0, 0, 30], upperArmR: [-84, 16, -24], foreArmR: [-84, 0, 0], handR: [0, 0, -30], hips: [0, -0.025, 0.02] }],
      [0.54, { ...stand, spine: [-10, 0, 0], chest: [-8, 0, 0], neck: [-10, 0, 0], head: [-22, -8, -6], upperArmL: [-40, 0, 44], foreArmL: [-20, 0, 0], upperArmR: [-40, 0, -44], foreArmR: [-20, 0, 0], hips: [0, 0.0, -0.03] }, Ease.outCubic],
      [0.8, { ...stand }, Ease.inOut],
    ], { events: [{ t: 0.06, id: 'bite' }, { t: 0.44, id: 'release' }], fadeIn: 0.04, fadeOut: 0.15 }),
    // ---- F: Sciame di Pipistrelli ------------------------------------------------------------
    swarm: clip('swarm', base, [
      [0, { ...stand, spine: [6, 0, 0], chest: [6, 0, 0], upperArmL: [-60, 40, -20], foreArmL: [-120, 0, 0], upperArmR: [-60, -40, 20], foreArmR: [-120, 0, 0] }],
      [0.12, { ...stand, spine: [10, 0, 0], chest: [10, 0, 0], head: [6, 0, 0], upperArmL: [-50, 50, -30], foreArmL: [-130, 0, 0], upperArmR: [-50, -50, 30], foreArmR: [-130, 0, 0], hips: [0, -0.03, 0] }, Ease.inQuad],
      [0.2, { ...stand, spine: [-8, 0, 0], chest: [-8, 0, 0], head: [-8, 0, 0], upperArmL: [-90, -20, 50], foreArmL: [-6, 0, 0], handL: [0, 0, 30], upperArmR: [-90, 20, -50], foreArmR: [-6, 0, 0], handR: [0, 0, -30], hips: [0, 0.01, -0.02] }, Ease.outQuart],
      [0.36, { ...stand, spine: [-6, 0, 0], chest: [-6, 0, 0], upperArmL: [-80, -20, 56], foreArmL: [-10, 0, 0], handL: [0, 0, 30], upperArmR: [-80, 20, -56], foreArmR: [-10, 0, 0], handR: [0, 0, -30] }],
      [0.6, { ...stand }, Ease.inOut],
    ], { events: [{ t: 0.15, id: 'release' }], fadeIn: 0.04, fadeOut: 0.18 }),
    // back from the bat form: crouched, rising
    unbat: clip('unbat', base, [
      [0, { ...stand, hips: [0, -0.2, 0], spine: [30, 0, 0], chest: [10, 0, 0], head: [-20, 0, 0], thighL: [-70, -10, -3], shinL: [100, 0, 0], footL: [-30, 0, 0], thighR: [-50, 8, 3], shinR: [90, 0, 0], footR: [-30, 0, 0], upperArmL: [-30, 0, 70], foreArmL: [-30, 0, 0], upperArmR: [-30, 0, -70], foreArmR: [-30, 0, 0] }],
      [0.36, { ...stand }, Ease.outCubic],
    ], { fadeIn: 0, fadeOut: 0.12 }),
    // ---- R: Notte Eterna ---------------------------------------------------------------------
    ult: clip('ult', base, [
      [0, { ...stand }],
      [0.4, { spine: [-12, 0, 0], chest: [-10, 0, 0], neck: [-8, 0, 0], head: [-16, 0, 0], upperArmL: [-30, 0, 112], foreArmL: [-18, 0, 0], handL: [0, 0, 20], upperArmR: [-30, 0, -112], foreArmR: [-18, 0, 0], handR: [0, 0, -20], thighL: [6, 0, 2], shinL: [18, 0, 0], footL: [40, 0, 0], thighR: [-4, 0, -2], shinR: [30, 0, 0], footR: [40, 0, 0] }, Ease.outCubic],
      [1.2, { spine: [-14, 0, 0], chest: [-12, 0, 0], neck: [-8, 0, 0], head: [-20, 0, 0], upperArmL: [-36, 0, 118], foreArmL: [-22, 0, 0], handL: [0, 0, 20], upperArmR: [-36, 0, -118], foreArmR: [-22, 0, 0], handR: [0, 0, -20], thighL: [8, 0, 2], shinL: [20, 0, 0], footL: [44, 0, 0], thighR: [-2, 0, -2], shinR: [34, 0, 0], footR: [44, 0, 0] }, Ease.inOut],
    ], { fadeIn: 0.08, fadeOut: 0.2 }),
    ultEnd: clip('ultEnd', base, [
      [0, { spine: [-14, 0, 0], chest: [-12, 0, 0], head: [-20, 0, 0], upperArmL: [-36, 0, 118], foreArmL: [-22, 0, 0], upperArmR: [-36, 0, -118], foreArmR: [-22, 0, 0] }],
      [0.14, { ...stand, spine: [20, 0, 0], chest: [12, 0, 0], head: [-10, 0, 0], upperArmL: [-90, 0, 30], foreArmL: [-6, 0, 0], handL: [0, 0, 30], upperArmR: [-90, 0, -30], foreArmR: [-6, 0, 0], handR: [0, 0, -30], hips: [0, -0.08, 0.03] }, Ease.outQuart],
      [0.5, { ...stand }, Ease.inOut],
    ], { events: [{ t: 0.12, id: 'finale' }], fadeIn: 0.03, fadeOut: 0.2 }),
    // ---- taunt: curtsy, hair flip, blown kiss ----------------------------------------------------
    taunt: clip('taunt', base, [
      [0, { ...stand }],
      [0.35, { ...stand, hips: [0, -0.12, -0.02], spine: [16, 0, 0], chest: [8, 0, 0], head: [16, 0, 6], thighL: [-30, -10, -3], shinL: [60, 0, 0], footL: [-20, 0, 0], thighR: [24, 8, 3], shinR: [56, 0, 0], footR: [16, 0, 0], upperArmL: [8, 0, 34], foreArmL: [-26, 0, 0], handL: [0, 0, 40], upperArmR: [8, 0, -34], foreArmR: [-26, 0, 0], handR: [0, 0, -40] }, Ease.inOut],
      [0.7, { ...stand, hips: [0, -0.12, -0.02], spine: [18, 0, 0], chest: [10, 0, 0], head: [18, 0, 6], thighL: [-30, -10, -3], shinL: [60, 0, 0], footL: [-20, 0, 0], thighR: [24, 8, 3], shinR: [56, 0, 0], footR: [16, 0, 0], upperArmL: [8, 0, 34], foreArmL: [-26, 0, 0], handL: [0, 0, 40], upperArmR: [8, 0, -34], foreArmR: [-26, 0, 0], handR: [0, 0, -40] }],
      [1.05, { ...stand, head: [-6, -14, -10], upperArmL: [16, -22, 34], foreArmL: [-104, 0, 0], handL: [0, 0, 24], upperArmR: [-150, 20, -30], foreArmR: [-100, 0, 0], handR: [0, 0, -20] }, Ease.inOut],
      [1.35, { ...stand, head: [-10, 10, 12], neck: [-4, 8, 6], upperArmL: [16, -22, 34], foreArmL: [-104, 0, 0], handL: [0, 0, 24], upperArmR: [-160, -10, -60], foreArmR: [-60, 0, 0], handR: [0, 0, -40] }, Ease.outCubic],
      [1.7, { ...stand, head: [2, -6, 4], upperArmL: [16, -22, 34], foreArmL: [-104, 0, 0], handL: [0, 0, 24], upperArmR: [-64, 36, -6], foreArmR: [-132, 0, 0], handR: [0, 0, 10] }, Ease.inOut],
      [1.95, { ...stand, head: [-4, -6, 4], spine: [-4, 8, -3], upperArmL: [16, -22, 34], foreArmL: [-104, 0, 0], handL: [0, 0, 24], upperArmR: [-96, 6, -14], foreArmR: [-12, 0, 0], handR: [0, 0, -10] }, Ease.outQuart],
      [2.6, { ...stand, upperArmL: [16, -22, 34], foreArmL: [-104, 0, 0], handL: [0, 0, 24], upperArmR: [4, 0, -12], foreArmR: [-22, 0, 0], handR: [0, -16, -12] }, Ease.inOut],
    ], { events: [{ t: 1.95, id: 'sparkle' }], fadeIn: 0.1, fadeOut: 0.25 }),
  };
  return { idle, runArms, airArms, flyArms, armSwing: [0.9, 0.9], offhandLoco: 0, runLean: 4, clips };
}
