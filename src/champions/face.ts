import * as THREE from 'three';
import { toon, type ToonMaterial } from '../render/toon';
import type { ModelBuilder } from '../fighter/ModelBuilder';

/**
 * Anime eyes: layered flat shapes (sclera, two-tone iris, pupil, catch-lights, lash line, brows)
 * wrapped onto the head's ellipsoidal face. Every layer samples one cell of a tiny palette
 * texture through its UVs, so a whole face is a single material / draw call. The eyes live in
 * their own mesh (pivoted at eye height) so they can blink.
 */

export interface EyeStyle {
  sclera: number;
  irisTop: number;
  irisBottom: number;
  pupil: number;
  lash: number;
  /** eyebrow colour, or null when a mask covers the brows */
  brow: number | null;
  /** iris self-illumination 0..1 (Persona "awakened" glow) */
  glow?: number;
  female: boolean;
  /** eye centre height in head-bone space */
  y?: number;
  /** distance of each eye centre from the face midline (arc length) */
  x?: number;
  w?: number;
  h?: number;
  /** outer-corner lift */
  tilt?: number;
  /** brow lift above the eye, and inner-end drop (positive = fierce) */
  browY?: number;
  browFierce?: number;
  /** iris shift toward the nose (0..1 of the eye width) - slight cross gaze reads as focus */
  gaze?: number;
}

const CELLS = 8;
const enum Cell { sclera, irisTop, irisBottom, pupil, light, lash, brow, spare }

const HEAD_CENTRE_Y = 0.11;
const HEAD_CENTRE_Z = 0.012;

function paletteTexture(colors: number[]): THREE.DataTexture {
  const data = new Uint8Array(CELLS * 4);
  const c = new THREE.Color();
  for (let i = 0; i < CELLS; i++) {
    c.setHex(colors[i] ?? 0);
    data[i * 4] = Math.round(c.r * 255);
    data[i * 4 + 1] = Math.round(c.g * 255);
    data[i * 4 + 2] = Math.round(c.b * 255);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, CELLS, 1, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Palette material for one champion's eyes + brows. */
export function eyeMaterial(s: EyeStyle): ToonMaterial {
  const glow = s.glow ?? 0;
  const g = (hex: number) => new THREE.Color(hex).multiplyScalar(glow).getHex();
  const map = paletteTexture([s.sclera, s.irisTop, s.irisBottom, s.pupil, 0xffffff, s.lash, s.brow ?? s.lash, 0xff8fa8]);
  const emissive = paletteTexture([0x000000, g(s.irisTop), g(s.irisBottom), 0x000000, 0xffffff, 0x000000, 0x000000, 0x000000]);
  // eyes keep most of their brightness in shadow (anime faces never go muddy)
  const m = toon({ color: 0xffffff, map, shade: 0xd8d0ff, rim: 0, spec: 0 });
  m.emissive.set(0xffffff);
  m.emissiveMap = emissive;
  return m;
}

type V2 = [number, number];

function quad(a: V2, c: V2, b: V2, t: number): V2 {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}

/** y of a polyline (sorted by x) at x, clamped to its ends */
function curveY(pts: V2[], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / Math.max(x1 - x0, 1e-6);
    }
  }
  return pts[pts.length - 1][1];
}

class FaceSheet {
  readonly geos: THREE.BufferGeometry[] = [];
  /** adds a flat polygon (eye-local u/v, u pointing to the outer corner) on a given layer */
  poly(pts: V2[], cell: Cell, depth: number, side: number, cx: number): void {
    const shape = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(cx + side * u, v)));
    const g = new THREE.ShapeGeometry(shape, 1);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const cu = (cell + 0.5) / CELLS;
    for (let i = 0; i < p.count; i++) {
      p.setZ(i, depth);
      uv.setXY(i, cu, 0.5);
    }
    this.geos.push(g);
  }
  ellipse(cxu: number, cyv: number, rx: number, ry: number, n = 20): V2[] {
    const out: V2[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push([cxu + Math.cos(a) * rx, cyv + Math.sin(a) * ry]);
    }
    return out;
  }
}

/** wrap flat face-sheet geometry onto the head's horizontal ellipse (radius r, x/z squash) */
function wrapFace(g: THREE.BufferGeometry, r: number, sx: number, sz: number): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = x / r;
    p.setXYZ(i, Math.sin(a) * (r * sx + z), y, Math.cos(a) * (r * sz + z) + HEAD_CENTRE_Z);
  }
  g.computeVertexNormals();
  return g;
}

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  const prepared = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of prepared) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of prepared) {
    const c = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    uv.set(g.getAttribute('uv').array as Float32Array, o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

/**
 * Builds both eyes (returned as a blinkable mesh parented to the head) and adds the brows to
 * the builder (static, merged with the head). `matKey` must map to `eyeMaterial(style)`.
 */
export function addAnimeEyes(b: ModelBuilder, head: THREE.Object3D, matKey: string, s: EyeStyle): THREE.Mesh {
  const f = s.female;
  const headR = f ? 0.111 : 0.117;
  const squashX = f ? 0.9 : 0.92;
  const squashZ = 0.98;
  const eyeY = s.y ?? 0.117;
  const yRel = eyeY - HEAD_CENTRE_Y;
  // horizontal radius of the (y-stretched) head sphere at eye height
  const r = headR * Math.sqrt(Math.max(0.5, 1 - (yRel / (headR * 1.06)) ** 2));
  const X = s.x ?? (f ? 0.044 : 0.046);
  const W = s.w ?? (f ? 0.036 : 0.035);
  const H = s.h ?? (f ? 0.034 : 0.026);
  const tilt = s.tilt ?? (f ? 0.1 : 0.16);
  const gaze = s.gaze ?? 0.06;

  const eyes = new FaceSheet();
  const brows = new FaceSheet();
  for (const side of [1, -1]) {
    const cx = side * X;
    // sclera outline: arched top, flatter bottom, lifted outer corner (u > 0 = outer)
    const I: V2 = [-W / 2, -0.06 * H];
    const O: V2 = [W / 2, 0.1 * H + tilt * W];
    const T: V2 = [-0.1 * W, (f ? 0.86 : 0.7) * H];
    const Bc: V2 = [0.08 * W, (f ? -0.62 : -0.5) * H];
    const top: V2[] = [];
    const bot: V2[] = [];
    const N = 18;
    for (let i = 0; i <= N; i++) top.push(quad(I, T, O, i / N));
    for (let i = 0; i <= N; i++) bot.push(quad(I, Bc, O, i / N));
    const clampIn = (pts: V2[], pad = 0.0003): V2[] => pts.map(([u, v]) => [
      THREE.MathUtils.clamp(u, I[0] + 0.0015, O[0] - 0.0015),
      THREE.MathUtils.clamp(v, curveY(bot, u) + pad, curveY(top, u) - pad * 0.3),
    ]);
    eyes.poly([...top, ...bot.slice(1, -1).reverse()], Cell.sclera, 0.0012, side, cx);

    // iris: two-tone (dark top, bright lower crescent), pupil, two catch-lights
    const iu = -gaze * W;
    const iv = -0.04 * H;
    const rx = W * (f ? 0.27 : 0.25);
    const ry = H * (f ? 0.42 : 0.47);
    eyes.poly(clampIn(eyes.ellipse(iu, iv, rx, ry)), Cell.irisTop, 0.0018, side, cx);
    eyes.poly(clampIn(eyes.ellipse(iu, iv - ry * 0.3, rx * 0.78, ry * 0.58)), Cell.irisBottom, 0.0022, side, cx);
    eyes.poly(clampIn(eyes.ellipse(iu, iv + ry * 0.08, rx * 0.42, ry * 0.5, 16)), Cell.pupil, 0.0026, side, cx);
    eyes.poly(clampIn(eyes.ellipse(iu + rx * 0.38, iv + ry * 0.36, rx * 0.3, rx * 0.3, 12)), Cell.light, 0.003, side, cx);
    eyes.poly(clampIn(eyes.ellipse(iu - rx * 0.32, iv - ry * 0.42, rx * 0.14, rx * 0.14, 10)), Cell.light, 0.003, side, cx);

    // upper lash line: thin at the inner corner, heavy toward the outer corner, with a flick
    const thick = f ? 0.0042 : 0.0032;
    const upper: V2[] = [];
    const lower: V2[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const [u, v] = top[i];
      const th = THREE.MathUtils.lerp(0.0008, thick, THREE.MathUtils.smoothstep(t, 0.05, 0.7));
      upper.push([u, v + th]);
      lower.push([u, v - 0.0009]);
    }
    const flick: V2[] = f
      ? [[O[0] + 0.0055, O[1] + 0.0042], [O[0] + 0.0028, O[1] + 0.0004]]
      : [[O[0] + 0.004, O[1] + 0.0018], [O[0] + 0.0015, O[1] - 0.0006]];
    eyes.poly([...upper, ...flick, ...lower.reverse()], Cell.lash, 0.0034, side, cx);
    if (f) {
      // two lash spikes off the outer corner
      for (const [t, len] of [[0.78, 0.0045], [0.92, 0.0052]] as const) {
        const [u, v] = quad(I, T, O, t);
        eyes.poly([[u - 0.0016, v + 0.002], [u + 0.0035, v + 0.002 + len], [u + 0.0016, v + 0.0015]], Cell.lash, 0.0034, side, cx);
      }
    }
    // lower lash: short line under the outer third
    const lowLash: V2[] = [];
    const lowIn: V2[] = [];
    for (let i = Math.round(N * 0.55); i <= N; i++) {
      const t = i / N;
      const [u, v] = bot[i];
      const th = 0.0009 * Math.sin(((t - 0.55) / 0.45) * Math.PI * 0.9 + 0.1);
      lowLash.push([u, v + 0.0002]);
      lowIn.push([u, v - Math.max(0.0003, th)]);
    }
    eyes.poly([...lowLash, ...lowIn.reverse()], Cell.lash, 0.0032, side, cx);

    // brow
    if (s.brow !== null) {
      const by = (s.browY ?? 0.012) + H * 0.5;
      const fierce = s.browFierce ?? 0.2;
      const B0: V2 = [-0.5 * W, by - fierce * 0.006];
      const B2: V2 = [0.62 * W, by + 0.002 - tilt * 0.004];
      const B1: V2 = [0.02 * W, by + 0.0062];
      const bu: V2[] = [];
      const bl: V2[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const [u, v] = quad(B0, B1, B2, t);
        const th = THREE.MathUtils.lerp(f ? 0.0024 : 0.0032, 0.0006, t * t);
        bu.push([u, v + th * 0.5]);
        bl.push([u, v - th * 0.5]);
      }
      brows.poly([...bu, ...bl.reverse()], Cell.brow, 0.0012, side, cx);
    }
  }

  const eyeGeo = wrapFace(merge(eyes.geos), r, squashX, squashZ);
  const mesh = new THREE.Mesh(eyeGeo, b.mats[matKey]);
  mesh.name = 'eyes';
  mesh.position.y = eyeY;
  head.add(mesh);
  if (brows.geos.length) {
    const g = wrapFace(merge(brows.geos), r, squashX, squashZ);
    g.translate(0, eyeY, 0);
    b.add(head, g, matKey, 0, false);
  }
  return mesh;
}

/** Natural blinking: quick close/open every few seconds, sometimes a double blink. */
export function blinker(eyes: THREE.Object3D): (dt: number) => void {
  let wait = 1 + Math.random() * 3;
  let t = -1;
  let doubleBlink = false;
  return (dt: number) => {
    if (t < 0) {
      wait -= dt;
      if (wait <= 0) {
        t = 0;
        doubleBlink = Math.random() < 0.2;
        wait = 2.2 + Math.random() * 3.5;
      }
      return;
    }
    t += dt;
    const d = 0.13;
    let k = t < d * 0.45 ? t / (d * 0.45) : t < d ? 1 - (t - d * 0.45) / (d * 0.55) : 0;
    if (t >= d) {
      if (doubleBlink) {
        doubleBlink = false;
        t = 0;
      } else t = -1;
      k = 0;
    }
    eyes.scale.y = 1 - 0.92 * Math.min(1, k);
  };
}
