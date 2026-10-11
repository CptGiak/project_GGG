import * as THREE from 'three';

/**
 * Flat ground decals in ONE instanced draw call: area telegraphs drawn at the exact gameplay
 * radius, expanding ground rings, scorch marks, "planted" stance rings. Premultiplied blending
 * (rgb adds light, alpha darkens: scorches and ink rims). Handles let an owner move a decal every
 * frame (a telegraph following a bouncing grenade). Zero allocations per frame.
 */
export const Decal = {
  /** area of effect: border exactly at r, fill rising with `progress`, blinking when `blink` */
  telegraph: 0,
  /** ring expanding from r0 to r (outExpo), thinning as it fades */
  ring: 1,
  /** dark scorch with a short glowing core */
  scorch: 2,
  /** thin steady ring (stance / channel marker) */
  planted: 3,
} as const;

export interface DecalSpec {
  /** centre on the ground (world) */
  pos: THREE.Vector3;
  /** radius (m): telegraph = gameplay radius, ring = final radius */
  r: number;
  /** ring: start radius */
  r0?: number;
  /** border width (m) */
  border?: number;
  /** HDR border colour */
  color: THREE.Color;
  /** fill colour (HDR, keep it low: 0.1-0.4) */
  fill?: THREE.Color;
  /** seconds; Infinity = until kill() */
  life: number;
  style: number;
  /** 0..1 dark rim outside the border */
  ink?: number;
  alpha?: number;
}

const VERT = /* glsl */ `
attribute vec3 iP;
attribute vec4 iR;   // r, r0, border, ink
attribute vec4 iC;   // border rgb, style
attribute vec4 iF;   // fill rgb, progress
attribute vec4 iT;   // age01, seed, blink, alpha
varying vec2 vXY;
varying vec4 vR;
varying vec4 vC;
varying vec4 vF;
varying vec4 vT;
void main() {
  float ext = max( iR.x, iR.y ) * 1.12 + iR.z;
  vec3 P = iP + vec3( position.x * ext, 0.03, position.y * ext );
  vXY = position.xy * ext;
  vR = iR;
  vC = iC;
  vF = iF;
  vT = iT;
  gl_Position = projectionMatrix * viewMatrix * vec4( P, 1.0 );
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vXY;
varying vec4 vR;
varying vec4 vC;
varying vec4 vF;
varying vec4 vT;
void main() {
  float style = vC.w;
  float age = vT.x;
  float dist = length( vXY );
  float aa = 0.04;
  vec3 col = vec3( 0.0 );
  float occ = 0.0;
  if ( style < 0.5 ) {
    float r = vR.x;
    float bw = vR.z;
    float border = smoothstep( r - bw - aa, r - bw, dist ) * ( 1.0 - smoothstep( r, r + aa, dist ) );
    float inside = 1.0 - smoothstep( r - aa, r, dist );
    float p = vF.w;
    // fill rises with progress, a soft sweep ring closes in toward the centre as it fuses
    float sweepR = r * ( 1.0 - p );
    float sweep = exp( -pow( ( dist - sweepR ) / ( 0.12 * r + 0.05 ), 2.0 ) ) * inside * 0.6;
    float fill = inside * ( 0.35 + 0.65 * p );
    float blink = vT.z > 0.5 ? 1.6 : 1.0;
    col = vC.rgb * border * blink + vF.rgb * ( fill + sweep ) * blink;
    occ = vR.w * smoothstep( r, r + aa, dist ) * ( 1.0 - smoothstep( r + aa, r + bw * 2.5 + aa, dist ) );
  } else if ( style < 1.5 ) {
    float e = 1.0 - pow( 2.0, -10.0 * age );
    float r = mix( vR.y, vR.x, e );
    float bw = max( vR.z * ( 1.0 - age ), 0.015 );
    float ring = smoothstep( r - bw - aa, r - bw, dist ) * ( 1.0 - smoothstep( r, r + aa, dist ) );
    col = vC.rgb * ring * ( 1.0 - age );
    occ = vR.w * ring * ( 1.0 - age ) * 0.5;
  } else if ( style < 2.5 ) {
    float r = vR.x;
    float disk = 1.0 - smoothstep( r * 0.55, r, dist );
    float rim = smoothstep( r * 0.6, r * 0.85, dist ) * ( 1.0 - smoothstep( r * 0.85, r, dist ) );
    float fade = 1.0 - smoothstep( 0.6, 1.0, age );
    occ = ( disk * 0.35 + rim * 0.35 ) * fade * vR.w;
    float glow = ( 1.0 - smoothstep( 0.0, 0.25, age ) ) * ( 1.0 - smoothstep( 0.0, r * 0.7, dist ) );
    col = vC.rgb * glow + vF.rgb * rim * fade;
  } else {
    float r = vR.x;
    float bw = vR.z;
    float ring = smoothstep( r - bw - aa, r - bw, dist ) * ( 1.0 - smoothstep( r, r + aa, dist ) );
    float pulse = 0.75 + 0.25 * sin( uTime * 9.0 + vT.y * 6.28 );
    col = vC.rgb * ring * pulse;
  }
  float a = vT.w;
  col *= a;
  occ = clamp( occ * a, 0.0, 1.0 );
  if ( col.r + col.g + col.b + occ < 0.002 ) discard;
  gl_FragColor = vec4( col, occ );
}
`;

interface Slot {
  alive: boolean;
  gen: number;
  pos: THREE.Vector3;
  r: number;
  r0: number;
  border: number;
  ink: number;
  color: THREE.Color;
  fill: THREE.Color;
  style: number;
  age: number;
  life: number;
  progress: number;
  blink: boolean;
  alpha: number;
  seed: number;
}

export class Decals {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly slots: Slot[] = [];
  private readonly iP: THREE.InstancedBufferAttribute;
  private readonly iR: THREE.InstancedBufferAttribute;
  private readonly iC: THREE.InstancedBufferAttribute;
  private readonly iF: THREE.InstancedBufferAttribute;
  private readonly iT: THREE.InstancedBufferAttribute;
  private time = 0;

  constructor(readonly capacity = 64) {
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    this.geo.setIndex([0, 2, 1, 2, 3, 1]);
    const inst = (k: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * k), k).setUsage(THREE.DynamicDrawUsage);
    this.iP = inst(3);
    this.iR = inst(4);
    this.iC = inst(4);
    this.iF = inst(4);
    this.iT = inst(4);
    this.geo.setAttribute('iP', this.iP);
    this.geo.setAttribute('iR', this.iR);
    this.geo.setAttribute('iC', this.iC);
    this.geo.setAttribute('iF', this.iF);
    this.geo.setAttribute('iT', this.iT);
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    // before the additive layers (a darkening scorch must not dim glows drawn on top)
    this.mesh.renderOrder = 2;
    for (let i = 0; i < capacity; i++) {
      this.slots.push({ alive: false, gen: 0, pos: new THREE.Vector3(), r: 1, r0: 0, border: 0.08, ink: 0, color: new THREE.Color(), fill: new THREE.Color(), style: 0, age: 0, life: 1, progress: 0, blink: false, alpha: 1, seed: 0 });
    }
  }

  /** returns a handle for move / progress / kill */
  add(s: DecalSpec): number {
    let i = this.slots.findIndex((x) => !x.alive);
    if (i < 0) {
      // full: reuse the oldest
      let oldest = 0;
      for (let k = 1; k < this.slots.length; k++) if (this.slots[k].age > this.slots[oldest].age) oldest = k;
      i = oldest;
    }
    const d = this.slots[i];
    d.alive = true;
    d.gen = (d.gen + 1) % 1024;
    d.pos.copy(s.pos);
    d.r = s.r;
    d.r0 = s.r0 ?? 0;
    d.border = s.border ?? 0.08;
    d.ink = s.ink ?? 0;
    d.color.copy(s.color);
    if (s.fill) d.fill.copy(s.fill);
    else d.fill.setRGB(0, 0, 0);
    d.style = s.style;
    d.age = 0;
    d.life = s.life;
    d.progress = 0;
    d.blink = false;
    d.alpha = s.alpha ?? 1;
    d.seed = Math.random();
    return i + d.gen * 4096;
  }

  private get(h: number): Slot | null {
    const d = this.slots[h % 4096];
    return d && d.alive && d.gen === Math.floor(h / 4096) ? d : null;
  }

  move(h: number, pos: THREE.Vector3): void {
    this.get(h)?.pos.copy(pos);
  }

  /** telegraph: 0..1 fill / fuse progress, blink flag */
  progress(h: number, p: number, blink = false): void {
    const d = this.get(h);
    if (!d) return;
    d.progress = p;
    d.blink = blink;
  }

  kill(h: number): void {
    const d = this.get(h);
    if (d) d.alive = false;
  }

  update(dt: number): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    const P = this.iP.array as Float32Array;
    const R = this.iR.array as Float32Array;
    const C = this.iC.array as Float32Array;
    const F = this.iF.array as Float32Array;
    const T = this.iT.array as Float32Array;
    let n = 0;
    for (const d of this.slots) {
      if (!d.alive) continue;
      d.age += dt;
      if (d.age >= d.life) {
        d.alive = false;
        continue;
      }
      P[n * 3] = d.pos.x;
      P[n * 3 + 1] = d.pos.y;
      P[n * 3 + 2] = d.pos.z;
      R[n * 4] = d.r;
      R[n * 4 + 1] = d.r0;
      R[n * 4 + 2] = d.border;
      R[n * 4 + 3] = d.ink;
      C[n * 4] = d.color.r;
      C[n * 4 + 1] = d.color.g;
      C[n * 4 + 2] = d.color.b;
      C[n * 4 + 3] = d.style;
      F[n * 4] = d.fill.r;
      F[n * 4 + 1] = d.fill.g;
      F[n * 4 + 2] = d.fill.b;
      F[n * 4 + 3] = d.progress;
      T[n * 4] = Number.isFinite(d.life) ? d.age / d.life : 0;
      T[n * 4 + 1] = d.seed;
      T[n * 4 + 2] = d.blink ? 1 : 0;
      T[n * 4 + 3] = d.alpha;
      n++;
    }
    this.geo.instanceCount = n;
    if (n > 0) {
      this.iP.clearUpdateRanges();
      this.iP.addUpdateRange(0, n * 3);
      this.iP.needsUpdate = true;
      for (const a of [this.iR, this.iC, this.iF, this.iT]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * 4);
        a.needsUpdate = true;
      }
    }
  }

  clear(): void {
    for (const d of this.slots) d.alive = false;
    this.geo.instanceCount = 0;
  }
}
