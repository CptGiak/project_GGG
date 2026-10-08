import * as THREE from 'three';

/**
 * Instanced billboard particles with procedural shapes. One pool per blending mode.
 * Shapes: 0 glow, 1 toon puff, 2 sparkle star, 3 streak (velocity aligned), 4 ring, 5 shard, 6 square
 */
export const Shape = { glow: 0, puff: 1, star: 2, streak: 3, ring: 4, shard: 5, square: 6 } as const;

export interface ParticleSpec {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life: number;
  size: number;
  size1?: number;
  color: THREE.ColorRepresentation;
  color1?: THREE.ColorRepresentation;
  alpha?: number;
  shape?: number;
  drag?: number;
  gravity?: number;
  rot?: number;
  spin?: number;
  /** streak length multiplier */
  stretch?: number;
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iColor;
attribute vec4 iData; // size, rot, shape, stretch
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = iColor;
  float camDist = length( ( modelViewMatrix * vec4( iPos, 1.0 ) ).xyz );
  // fade out near the lens; big particles (dust, smoke) start fading further away
  vColor.a *= smoothstep( 0.6 + iData.x * 1.3, 2.2 + iData.x * 3.0, camDist );
  vShape = iData.z;
  vec4 mvCenter = modelViewMatrix * vec4( iPos, 1.0 );
  vec2 corner = position.xy;
  float size = iData.x;
  if ( iData.z > 2.5 && iData.z < 3.5 ) {
    // streak: align with projected velocity
    vec3 vv = ( modelViewMatrix * vec4( iVel, 0.0 ) ).xyz;
    vec2 d = vv.xy;
    float l = length( d );
    d = l > 1e-4 ? d / l : vec2( 1.0, 0.0 );
    vec2 n = vec2( -d.y, d.x );
    float len = size * ( 1.0 + l * 0.06 * iData.w );
    vec2 p = d * corner.x * len + n * corner.y * size * 0.18;
    mvCenter.xy += p;
  } else {
    float c = cos( iData.y );
    float s = sin( iData.y );
    mvCenter.xy += vec2( c * corner.x - s * corner.y, s * corner.x + c * corner.y ) * size;
  }
  vec4 mvPosition = mvCenter;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
uniform float uAdditive;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length( p );
  float a = 0.0;
  vec3 col = vColor.rgb;
  if ( vShape < 0.5 ) {
    a = pow( max( 0.0, 1.0 - r ), 2.2 );
  } else if ( vShape < 1.5 ) {
    // toon puff: hard edge, lit top-left half
    float edge = 1.0 - smoothstep( 0.86, 0.9, r );
    float lit = step( 0.0, dot( p, normalize( vec2( -0.6, 0.8 ) ) ) + 0.25 );
    col *= mix( 0.62, 1.0, lit );
    float rim = smoothstep( 0.72, 0.8, r ) * ( 1.0 - smoothstep( 0.86, 0.9, r ) );
    col = mix( col, col * 0.45, rim * 0.6 );
    a = edge;
  } else if ( vShape < 2.5 ) {
    float star = max( 1.0 - abs( p.x ) * 6.0 - abs( p.y ) * 1.1, 1.0 - abs( p.y ) * 6.0 - abs( p.x ) * 1.1 );
    a = clamp( star, 0.0, 1.0 ) + pow( max( 0.0, 1.0 - r ), 4.0 );
  } else if ( vShape < 3.5 ) {
    a = ( 1.0 - smoothstep( 0.4, 1.0, abs( p.y ) ) ) * ( 1.0 - smoothstep( 0.2, 1.0, abs( p.x ) ) );
  } else if ( vShape < 4.5 ) {
    a = smoothstep( 0.72, 0.8, r ) * ( 1.0 - smoothstep( 0.9, 1.0, r ) );
  } else if ( vShape < 5.5 ) {
    // shard (triangle)
    a = step( abs( p.x ) * 1.7, 1.0 - ( p.y * 0.5 + 0.5 ) ) * step( -1.0, p.y );
  } else {
    a = step( max( abs( p.x ), abs( p.y ) ), 0.8 );
  }
  a *= vColor.a;
  if ( a < 0.01 ) discard;
  gl_FragColor = uAdditive > 0.5 ? vec4( col * a, a ) : vec4( col, a );
  #include <fog_fragment>
}
`;

interface P {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size0: number;
  size1: number;
  c0: THREE.Color;
  c1: THREE.Color;
  alpha: number;
  shape: number;
  drag: number;
  gravity: number;
  rot: number;
  spin: number;
  stretch: number;
}

export class ParticlePool {
  readonly mesh: THREE.Mesh;
  private ps: P[] = [];
  private free: number[] = [];
  private iPos: THREE.InstancedBufferAttribute;
  private iVel: THREE.InstancedBufferAttribute;
  private iColor: THREE.InstancedBufferAttribute;
  private iData: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private cursor = 0;

  constructor(readonly capacity: number, additive: boolean) {
    const base = new THREE.PlaneGeometry(2, 2);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iVel = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iData = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iVel', this.iVel);
    this.geo.setAttribute('iColor', this.iColor);
    this.geo.setAttribute('iData', this.iData);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAdditive: { value: additive ? 1 : 0 } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 15;
    for (let i = 0; i < capacity; i++) {
      this.ps.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, size0: 1, size1: 1, c0: new THREE.Color(), c1: new THREE.Color(), alpha: 1, shape: 0, drag: 0, gravity: 0, rot: 0, spin: 0, stretch: 1 });
      this.free.push(capacity - 1 - i);
    }
  }

  emit(s: ParticleSpec): void {
    let idx = this.free.pop();
    if (idx === undefined) {
      // recycle oldest-ish
      idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
    }
    const p = this.ps[idx];
    p.alive = true;
    p.pos.copy(s.pos);
    if (s.vel) p.vel.copy(s.vel);
    else p.vel.set(0, 0, 0);
    p.life = 0;
    p.max = s.life;
    p.size0 = s.size;
    p.size1 = s.size1 ?? s.size;
    p.c0.set(s.color);
    p.c1.set(s.color1 ?? s.color);
    p.alpha = s.alpha ?? 1;
    p.shape = s.shape ?? 0;
    p.drag = s.drag ?? 0;
    p.gravity = s.gravity ?? 0;
    p.rot = s.rot ?? Math.random() * Math.PI * 2;
    p.spin = s.spin ?? 0;
    p.stretch = s.stretch ?? 1;
  }

  update(dt: number): void {
    let n = 0;
    const pa = this.iPos.array as Float32Array;
    const va = this.iVel.array as Float32Array;
    const ca = this.iColor.array as Float32Array;
    const da = this.iData.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.ps[i];
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.alive = false;
        this.free.push(i);
        continue;
      }
      const t = p.life / p.max;
      if (p.drag > 0) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.rot += p.spin * dt;
      pa[n * 3] = p.pos.x;
      pa[n * 3 + 1] = p.pos.y;
      pa[n * 3 + 2] = p.pos.z;
      va[n * 3] = p.vel.x;
      va[n * 3 + 1] = p.vel.y;
      va[n * 3 + 2] = p.vel.z;
      const fade = t < 0.1 ? t / 0.1 : 1 - Math.pow((t - 0.1) / 0.9, 1.6);
      ca[n * 4] = p.c0.r + (p.c1.r - p.c0.r) * t;
      ca[n * 4 + 1] = p.c0.g + (p.c1.g - p.c0.g) * t;
      ca[n * 4 + 2] = p.c0.b + (p.c1.b - p.c0.b) * t;
      ca[n * 4 + 3] = p.alpha * (p.shape === 1 ? (t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1) : fade);
      da[n * 4] = p.size0 + (p.size1 - p.size0) * (p.shape === 1 ? 1 - Math.pow(1 - t, 3) : t);
      da[n * 4 + 1] = p.rot;
      da[n * 4 + 2] = p.shape;
      da[n * 4 + 3] = p.stretch;
      n++;
    }
    this.geo.instanceCount = n;
    if (n > 0) {
      this.iPos.addUpdateRange(0, n * 3);
      this.iVel.addUpdateRange(0, n * 3);
      this.iColor.addUpdateRange(0, n * 4);
      this.iData.addUpdateRange(0, n * 4);
      this.iPos.needsUpdate = true;
      this.iVel.needsUpdate = true;
      this.iColor.needsUpdate = true;
      this.iData.needsUpdate = true;
    }
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.ps[i].alive) {
        this.ps[i].alive = false;
        this.free.push(i);
      }
    }
    this.geo.instanceCount = 0;
  }
}
