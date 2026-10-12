import * as THREE from 'three';

/**
 * Axial billboards between two world points, all in ONE instanced draw call: tracers, beams,
 * ribbon trails (a chain of short segments), light columns, EQ bars, push streaks.
 *
 * Premultiplied blending: rgb is light added on top, alpha is "ink" (how much of what is behind
 * is darkened). One pool therefore draws both glowing cores and the dark rims that keep a bright
 * effect readable on a bright background. Zero allocations per frame.
 *
 * Own-view safety (in the shader): pieces fade close to the lens, and wide tracers / beams /
 * ribbons seen end-on fade instead of piling up into a blob: to 20 % from behind (the shooter's
 * own beam on the crosshair), to 50 % from the front (an incoming shot stays a visible threat).
 */
export const Seg = {
  /** bright sharp head at b, soft dim tail toward a; fades over its life (emit one per frame) */
  tracer: 0,
  /** a beam's life: 1.4x width for the first 8%, eases to width by 40%, then thins to 0.2x while
   * it erases from a (muzzle) to b (target); noisy edges (life ~14 frames: f0-1 / f2-6 / f6-13) */
  beam: 1,
  /** soft light column (a = foot, b = top), fades in and out */
  column: 2,
  /** EQ bar: flat bar standing on a, its height stepping at 20 fps, eroding with age */
  bar: 3,
  /** soft trail piece: tapers and fades with age (chain one per frame behind a projectile); `ink`
   * makes it a dark under-layer */
  ribbon: 4,
} as const;

export interface SegSpec {
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** width at a (m) */
  w: number;
  /** width at b (m), default w */
  w1?: number;
  /** HDR colour of the hot core (see bloomColor) */
  core: THREE.Color;
  /** HDR colour of the body / edge */
  edge: THREE.Color;
  life: number;
  style: number;
  /** 0..1 overall intensity (default 1) */
  alpha?: number;
  /** 0..1 dark rim ("ink") that occludes the background (default 0) */
  ink?: number;
  /** 0..1 beam edge noise (default 0) */
  noise?: number;
  /** per-instance random (EQ bar heights) */
  seed?: number;
}

const VERT = /* glsl */ `
attribute vec3 iA;
attribute vec3 iB;
attribute vec4 iW;   // w0, w1, ink, noise
attribute vec4 iC0;  // core rgb, alpha
attribute vec4 iC1;  // edge rgb, style
attribute vec4 iT;   // age01, seed
varying vec2 vUv;
varying vec2 vCap;
varying float vLen;
varying vec4 vC0;
varying vec4 vC1;
varying vec4 vT;
varying vec4 vW;
varying float vFade;
void main() {
  float style = iC1.w;
  float age = iT.x;
  vec3 ax = iB - iA;
  float len = max( length( ax ), 1e-4 );
  vec3 dir = ax / len;
  float wf = 1.0;
  if ( style > 0.5 && style < 1.5 ) {
    wf = age < 0.08 ? 1.4 : ( age < 0.4 ? mix( 1.4, 1.0, ( age - 0.08 ) / 0.32 ) : mix( 1.0, 0.2, smoothstep( 0.4, 1.0, age ) ) );
  } else if ( style > 3.5 ) {
    wf = 1.0 - age;
  }
  float w0 = iW.x * wf;
  float w1 = iW.y * wf;
  float capA = w0 * 0.5;
  float capB = w1 * 0.5;
  // quad: position.x 0..1 runs from the cap behind a to the cap past b, position.y -1..1 across
  float along = mix( -capA, len + capB, position.x );
  float t = clamp( along / len, 0.0, 1.0 );
  vec3 P = iA + dir * along;
  vec3 toCam = normalize( cameraPosition - P );
  vec3 side = cross( dir, toCam );
  float sl = length( side );
  side = sl > 1e-4 ? side / sl : normalize( cross( dir, vec3( 0.31, 0.95, 0.07 ) ) );
  P += side * position.y * mix( w0, w1, t ) * 0.5;
  vUv = vec2( along / len, position.y );
  vCap = vec2( capA, capB ) / len;
  vLen = len;
  vC0 = iC0;
  vC1 = iC1;
  vT = iT;
  vW = iW;
  vec4 mv = viewMatrix * vec4( P, 1.0 );
  // fade out close to the lens: the shooter's own beam or a tracer passing the head never blinds
  float wmax = max( w0, w1 );
  vFade = smoothstep( 0.6 + wmax, 2.6 + 3.0 * wmax, -mv.z );
  // a wide tracer / beam / ribbon seen end-on collapses into a blob: running AWAY from the camera
  // it sits on the shooter's crosshair (own beam or slug from behind) and fades to 20 %; running
  // toward the camera it is a threat and keeps half. Thin tracers keep their full strength.
  if ( style < 1.5 || style > 3.5 ) {
    float al = dot( dir, toCam );
    float endOn = smoothstep( 0.85, 0.99, abs( al ) ) * smoothstep( 0.12, 0.3, max( iW.x, iW.y ) );
    vFade *= 1.0 - endOn * ( al < 0.0 ? 0.8 : 0.5 );
  }
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec2 vCap;
varying float vLen;
varying vec4 vC0;
varying vec4 vC1;
varying vec4 vT;
varying vec4 vW;
varying float vFade;
float hash( float n ) { return fract( sin( n ) * 43758.5453 ); }
float noise1( float x ) { float i = floor( x ); float f = fract( x ); return mix( hash( i ), hash( i + 1.0 ), f * f * ( 3.0 - 2.0 * f ) ); }
void main() {
  float style = vC1.w;
  float age = vT.x;
  float x = vUv.x;
  // distance from the axis in half-widths, round caps past the ends
  float d = abs( vUv.y );
  if ( x < 0.0 ) d = length( vec2( x / max( vCap.x, 1e-4 ), vUv.y ) );
  else if ( x > 1.0 ) d = length( vec2( ( x - 1.0 ) / max( vCap.y, 1e-4 ), vUv.y ) );
  float xa = clamp( x, 0.0, 1.0 );
  float a = 0.0;
  float core = 0.0;
  float occ = 0.0;
  if ( style < 0.5 ) {
    float along = pow( xa, 1.8 );
    float body = 1.0 - smoothstep( 0.55, 1.0, d );
    float life = 1.0 - age;
    a = body * along * life;
    core = ( 1.0 - smoothstep( 0.0, 0.42, d ) ) * pow( xa, 3.0 ) * life;
    occ = vW.z * smoothstep( 0.55, 0.8, d ) * ( 1.0 - smoothstep( 0.8, 1.0, d ) ) * along * life;
  } else if ( style < 1.5 ) {
    float erase = smoothstep( 0.4, 1.0, age );
    if ( xa < erase ) discard;
    float n = ( noise1( x * vLen / 0.6 - uTime * 66.0 ) - 0.5 ) * 0.44 * vW.w;
    float dd = d * ( 1.0 + n );
    float env = 1.0 - smoothstep( 0.75, 1.0, age );
    float body = 1.0 - smoothstep( 0.72, 1.0, dd );
    a = body * env;
    core = ( 1.0 - smoothstep( 0.0, 0.14, dd ) ) * env;
    occ = vW.z * smoothstep( 0.78, 0.95, dd ) * ( 1.0 - smoothstep( 0.95, 1.0, dd ) ) * env;
  } else if ( style < 2.5 ) {
    float env = smoothstep( 0.0, 0.12, age ) * ( 1.0 - smoothstep( 0.45, 1.0, age ) );
    a = exp( -d * d * 3.0 ) * pow( 1.0 - xa, 0.6 ) * env;
    core = exp( -d * d * 22.0 ) * a;
  } else if ( style < 3.5 ) {
    float h = 0.25 + 0.75 * hash( vT.y * 17.0 + floor( uTime * 20.0 ) );
    if ( x > h || x < 0.0 ) discard;
    float chunk = hash( floor( x * vLen * 14.0 ) + vT.y * 31.0 );
    if ( chunk < age * 1.25 - 0.25 ) discard;
    a = 1.0 - smoothstep( 0.86, 1.0, d );
    core = smoothstep( h - 0.14, h, x ) * a;
    occ = vW.z * a * 0.6;
  } else {
    float life = 1.0 - age;
    float body = 1.0 - smoothstep( 0.3, 1.0, d );
    a = body * life * life;
    core = ( 1.0 - smoothstep( 0.0, 0.3, d ) ) * a * 0.6;
    occ = vW.z * body * life * life;
  }
  a *= vC0.w * vFade;
  core *= vC0.w * vFade;
  vec3 col = vC1.rgb * a + vC0.rgb * core;
  occ = clamp( occ * vC0.w * vFade, 0.0, 1.0 );
  if ( col.r + col.g + col.b + occ < 0.002 ) discard;
  gl_FragColor = vec4( col, occ );
}
`;

export class Segments {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly iA: THREE.InstancedBufferAttribute;
  private readonly iB: THREE.InstancedBufferAttribute;
  private readonly iW: THREE.InstancedBufferAttribute;
  private readonly iC0: THREE.InstancedBufferAttribute;
  private readonly iC1: THREE.InstancedBufferAttribute;
  private readonly iT: THREE.InstancedBufferAttribute;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  /** emitted since the last update: shown once at age 0 before it starts ageing */
  private readonly fresh: Uint8Array;
  private readonly attrs: Array<[THREE.InstancedBufferAttribute, number]>;
  private n = 0;
  private cursor = 0;
  private time = 0;

  constructor(readonly capacity = 512) {
    this.geo = new THREE.InstancedBufferGeometry();
    // 2 x 2 quad: x 0..1 along, y -1..1 across
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3));
    this.geo.setIndex([0, 1, 2, 2, 1, 3]);
    const inst = (k: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * k), k).setUsage(THREE.DynamicDrawUsage);
    this.iA = inst(3);
    this.iB = inst(3);
    this.iW = inst(4);
    this.iC0 = inst(4);
    this.iC1 = inst(4);
    this.iT = inst(4);
    this.geo.setAttribute('iA', this.iA);
    this.geo.setAttribute('iB', this.iB);
    this.geo.setAttribute('iW', this.iW);
    this.geo.setAttribute('iC0', this.iC0);
    this.geo.setAttribute('iC1', this.iC1);
    this.geo.setAttribute('iT', this.iT);
    this.geo.instanceCount = 0;
    this.attrs = [[this.iA, 3], [this.iB, 3], [this.iW, 4], [this.iC0, 4], [this.iC1, 4], [this.iT, 4]];
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.fresh = new Uint8Array(capacity);
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
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
  }

  get live(): number {
    return this.n;
  }

  emit(s: SegSpec): void {
    let i: number;
    if (this.n < this.capacity) i = this.n++;
    else {
      // full: overwrite the oldest-ish slot
      i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
    }
    const A = this.iA.array as Float32Array;
    const Bv = this.iB.array as Float32Array;
    const W = this.iW.array as Float32Array;
    const C0 = this.iC0.array as Float32Array;
    const C1 = this.iC1.array as Float32Array;
    const T = this.iT.array as Float32Array;
    A[i * 3] = s.a.x;
    A[i * 3 + 1] = s.a.y;
    A[i * 3 + 2] = s.a.z;
    Bv[i * 3] = s.b.x;
    Bv[i * 3 + 1] = s.b.y;
    Bv[i * 3 + 2] = s.b.z;
    W[i * 4] = s.w;
    W[i * 4 + 1] = s.w1 ?? s.w;
    W[i * 4 + 2] = s.ink ?? 0;
    W[i * 4 + 3] = s.noise ?? 0;
    C0[i * 4] = s.core.r;
    C0[i * 4 + 1] = s.core.g;
    C0[i * 4 + 2] = s.core.b;
    C0[i * 4 + 3] = s.alpha ?? 1;
    C1[i * 4] = s.edge.r;
    C1[i * 4 + 1] = s.edge.g;
    C1[i * 4 + 2] = s.edge.b;
    C1[i * 4 + 3] = s.style;
    T[i * 4] = 0;
    T[i * 4 + 1] = s.seed ?? Math.random();
    T[i * 4 + 2] = 0;
    T[i * 4 + 3] = 0;
    this.age[i] = 0;
    this.life[i] = Math.max(1e-3, s.life);
    this.fresh[i] = 1;
  }

  update(dt: number): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    const T = this.iT.array as Float32Array;
    let i = 0;
    while (i < this.n) {
      if (this.fresh[i]) this.fresh[i] = 0;
      else this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.remove(i);
        continue;
      }
      T[i * 4] = this.age[i] / this.life[i];
      i++;
    }
    if (this.cursor >= this.n) this.cursor = 0;
    this.geo.instanceCount = this.n;
    if (this.n > 0) {
      for (const [attr, k] of this.attrs) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, this.n * k);
        attr.needsUpdate = true;
      }
    }
  }

  clear(): void {
    this.n = 0;
    this.cursor = 0;
    this.geo.instanceCount = 0;
  }

  /** swap-remove: the last live instance moves into slot i */
  private remove(i: number): void {
    const last = this.n - 1;
    if (i !== last) {
      for (const [attr, k] of this.attrs) {
        const arr = attr.array as Float32Array;
        arr.copyWithin(i * k, last * k, last * k + k);
      }
      this.age[i] = this.age[last];
      this.life[i] = this.life[last];
      this.fresh[i] = this.fresh[last];
    }
    this.n--;
  }
}
