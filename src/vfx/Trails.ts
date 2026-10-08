import * as THREE from 'three';
import { ToonEnv } from '../render/toon';

const MAX_SAMPLES = 28;
const SUB = 3;

const VERT = /* glsl */ `
varying vec2 vUv;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uA;
uniform vec3 uB;
uniform float uTime;
uniform float uIntensity;
#include <common>
#include <fog_pars_fragment>
void main() {
  float age = vUv.x;
  float across = vUv.y;
  float fade = pow( 1.0 - age, 1.4 );
  float baseFade = smoothstep( 0.0, 0.35, across );
  float hot = smoothstep( 0.82, 1.0, across ) * ( 1.0 - age * 0.6 );
  float stripes = 0.78 + 0.22 * step( 0.5, fract( age * 16.0 - uTime * 6.0 ) );
  vec3 col = mix( uA, uB, across ) * stripes;
  col = mix( col, vec3( 1.0 ), hot * 0.7 );
  float a = fade * baseFade;
  gl_FragColor = vec4( col * a * uIntensity, a );
  #include <fog_fragment>
}
`;

/** True-Damage style weapon swoosh: ribbon between blade base and tip over the last ~0.2 s. */
export class SlashTrail {
  readonly mesh: THREE.Mesh;
  emitting = false;
  life = 0.16;
  private bases: THREE.Vector3[] = [];
  private tips: THREE.Vector3[] = [];
  private times: number[] = [];
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private tmpB = new THREE.Vector3();
  private tmpT = new THREE.Vector3();

  constructor(colorA: THREE.Color, colorB: THREE.Color, intensity = 2.2) {
    const maxVerts = MAX_SAMPLES * SUB * 2;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(maxVerts * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < MAX_SAMPLES * SUB - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uA: { value: colorA.clone() }, uB: { value: colorB.clone() }, uIntensity: { value: intensity } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mat.uniforms.uTime = ToonEnv.time;
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  setColors(a: THREE.Color, b: THREE.Color): void {
    this.mat.uniforms.uA.value.copy(a);
    this.mat.uniforms.uB.value.copy(b);
  }

  /** call every frame with the blade's world base/tip */
  update(time: number, base: THREE.Object3D, tip: THREE.Object3D): void {
    if (this.emitting) {
      base.getWorldPosition(this.tmpB);
      tip.getWorldPosition(this.tmpT);
      const last = this.tips.length - 1;
      if (last < 0 || this.tips[last].distanceToSquared(this.tmpT) > 0.0004) {
        this.bases.push(this.tmpB.clone());
        this.tips.push(this.tmpT.clone());
        this.times.push(time);
        if (this.bases.length > MAX_SAMPLES) {
          this.bases.shift();
          this.tips.shift();
          this.times.shift();
        }
      }
    }
    while (this.times.length && time - this.times[0] > this.life) {
      this.bases.shift();
      this.tips.shift();
      this.times.shift();
    }
    const n = this.bases.length;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const uv = this.geo.getAttribute('uv') as THREE.BufferAttribute;
    const pa = pos.array as Float32Array;
    const ua = uv.array as Float32Array;
    let v = 0;
    const tb = this.tmpB;
    const tt = this.tmpT;
    for (let i = n - 1; i >= 1; i--) {
      // newest first
      for (let s = 0; s < SUB; s++) {
        const f = s / SUB;
        cr(this.bases, i, -f, tb);
        cr(this.tips, i, -f, tt);
        const age = Math.min(1, (time - (this.times[i] + (this.times[i - 1] - this.times[i]) * f)) / this.life);
        pa[v * 3] = tb.x;
        pa[v * 3 + 1] = tb.y;
        pa[v * 3 + 2] = tb.z;
        ua[v * 2] = age;
        ua[v * 2 + 1] = 0;
        v++;
        pa[v * 3] = tt.x;
        pa[v * 3 + 1] = tt.y;
        pa[v * 3 + 2] = tt.z;
        ua[v * 2] = age;
        ua[v * 2 + 1] = 1;
        v++;
      }
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    const segs = v / 2 - 1;
    this.geo.setDrawRange(0, Math.max(0, segs) * 6);
  }

  clear(): void {
    this.bases.length = 0;
    this.tips.length = 0;
    this.times.length = 0;
    this.geo.setDrawRange(0, 0);
  }
}

/** Catmull-Rom between samples i and i-1 (f from 0 to -1 walks toward i-1). */
function cr(arr: THREE.Vector3[], i: number, f: number, out: THREE.Vector3): THREE.Vector3 {
  const t = -f;
  const p0 = arr[Math.min(i + 1, arr.length - 1)];
  const p1 = arr[i];
  const p2 = arr[Math.max(i - 1, 0)];
  const p3 = arr[Math.max(i - 2, 0)];
  const t2 = t * t;
  const t3 = t2 * t;
  const f0 = -0.5 * t3 + t2 - 0.5 * t;
  const f1 = 1.5 * t3 - 2.5 * t2 + 1;
  const f2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
  const f3 = 0.5 * t3 - 0.5 * t2;
  return out.set(
    p0.x * f0 + p1.x * f1 + p2.x * f2 + p3.x * f3,
    p0.y * f0 + p1.y * f1 + p2.y * f2 + p3.y * f3,
    p0.z * f0 + p1.z * f1 + p2.z * f2 + p3.z * f3,
  );
}
