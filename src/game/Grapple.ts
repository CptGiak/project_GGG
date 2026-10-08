import * as THREE from 'three';
import { neon, toon, addOutline } from '../render/toon';

export type HookState = 'idle' | 'flying' | 'attached' | 'retract';

/** One grapple line of the ODM gear. Physics lives in Fighter; this holds state + visuals. */
export class Hook {
  state: HookState = 'idle';
  readonly anchor = new THREE.Vector3();
  readonly tip = new THREE.Vector3();
  readonly normal = new THREE.Vector3(0, 1, 0);
  /** fighter the hook is attached to (anchor follows it) */
  targetId: string | null = null;
  ropeLen = 0;
  /** true when the anchor is a valid surface (false = miss, will retract at max range) */
  valid = false;
  t = 0;
  /** length of the flight path when fired (for the wobble animation) */
  flightLen = 1;
  /** network: time (ms) a remote flight was started from an action event */
  remoteAt = 0;
  readonly visual: HookVisual;

  constructor(color: THREE.ColorRepresentation) {
    this.visual = new HookVisual(color);
  }

  get attached(): boolean {
    return this.state === 'attached';
  }

  reset(): void {
    this.state = 'idle';
    this.targetId = null;
    this.visual.setVisible(false);
  }
}

const ROPE_POINTS = 18;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _side = new THREE.Vector3();
const _view = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

const ROPE_VERT = /* glsl */ `
attribute float aSide;
varying float vSide;
varying float vAlong;
attribute float aAlong;
#include <common>
#include <fog_pars_vertex>
void main() {
  vSide = aSide;
  vAlong = aAlong;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const ROPE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying float vSide;
varying float vAlong;
#include <common>
#include <fog_pars_fragment>
void main() {
  float core = 1.0 - smoothstep( 0.0, 1.0, abs( vSide ) );
  float pulse = 0.8 + 0.2 * step( 0.5, fract( vAlong * 9.0 - uTime * 8.0 ) );
  vec3 col = mix( uColor * 2.2, vec3( 1.6 ), pow( core, 6.0 ) * 0.8 ) * pulse;
  gl_FragColor = vec4( col * ( 0.45 + core * 1.5 ), 0.4 + core * 0.6 );
  #include <fog_fragment>
}
`;

/** Camera-facing glowing wire + 3D hook head. */
export class HookVisual {
  readonly rope: THREE.Mesh;
  readonly head: THREE.Group;
  private pts: THREE.Vector3[] = [];
  private geo: THREE.BufferGeometry;
  readonly mat: THREE.ShaderMaterial;

  constructor(color: THREE.ColorRepresentation) {
    for (let i = 0; i < ROPE_POINTS; i++) this.pts.push(new THREE.Vector3());
    const n = ROPE_POINTS * 2;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const side = new Float32Array(n);
    const along = new Float32Array(n);
    for (let i = 0; i < ROPE_POINTS; i++) {
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
      along[i * 2] = along[i * 2 + 1] = i / (ROPE_POINTS - 1);
    }
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.geo.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
    const idx: number[] = [];
    for (let i = 0; i < ROPE_POINTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } }]),
      vertexShader: ROPE_VERT,
      fragmentShader: ROPE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.rope = new THREE.Mesh(this.geo, this.mat);
    this.rope.frustumCulled = false;
    this.rope.visible = false;
    this.rope.renderOrder = 5;

    // hook head: pointed spike with two prongs and a glowing ring
    this.head = new THREE.Group();
    const metal = toon({ color: 0xbfc4d6, spec: 0.8, rim: 0.4 });
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.26, 6), metal);
    spike.rotation.x = Math.PI / 2;
    spike.position.z = 0.1;
    addOutline(spike, 1.6);
    this.head.add(spike);
    for (const s of [1, -1]) {
      const prong = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.16, 4), metal);
      prong.position.set(s * 0.07, 0, -0.01);
      prong.rotation.set(-Math.PI / 2 - 0.4, 0, s * 0.6);
      addOutline(prong, 1.4);
      this.head.add(prong);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.014, 6, 16), neon(color, 2.4));
    ring.position.z = -0.03;
    this.head.add(ring);
    this.head.visible = false;
  }

  setVisible(v: boolean): void {
    this.rope.visible = v;
    this.head.visible = v;
  }

  /**
   * from: gear muzzle (world), to: hook tip (world).
   * wobble: 0..1 amplitude for the in-flight sine wave, sag: metres of slack.
   */
  update(from: THREE.Vector3, to: THREE.Vector3, camPos: THREE.Vector3, time: number, wobble: number, sag: number, headDir: THREE.Vector3): void {
    _t.subVectors(to, from);
    const len = _t.length();
    if (len < 1e-4) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    _t.divideScalar(len);
    // perpendicular for wobble
    _perp.crossVectors(_t, _up);
    if (_perp.lengthSq() < 1e-6) _perp.set(1, 0, 0);
    _perp.normalize();
    for (let i = 0; i < ROPE_POINTS; i++) {
      const u = i / (ROPE_POINTS - 1);
      const p = this.pts[i].copy(from).addScaledVector(_t, len * u);
      const env = Math.sin(u * Math.PI);
      if (wobble > 0) {
        const w = Math.sin(u * 14 - time * 45) * 0.28 * wobble * env;
        p.addScaledVector(_perp, w);
        p.y += Math.cos(u * 11 - time * 38) * 0.18 * wobble * env;
      }
      if (sag > 0) p.y -= sag * 4 * u * (1 - u);
    }
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < ROPE_POINTS; i++) {
      const p = this.pts[i];
      const q = this.pts[Math.min(i + 1, ROPE_POINTS - 1)];
      const pp = this.pts[Math.max(i - 1, 0)];
      _a.subVectors(q, pp).normalize();
      _view.subVectors(camPos, p);
      // roughly constant on-screen thickness: a thin cable up close, still readable far away
      const width = THREE.MathUtils.clamp(_view.length() * 0.0045, 0.014, 0.17);
      _view.normalize();
      _side.crossVectors(_a, _view).normalize().multiplyScalar(width);
      arr[i * 6] = p.x - _side.x;
      arr[i * 6 + 1] = p.y - _side.y;
      arr[i * 6 + 2] = p.z - _side.z;
      arr[i * 6 + 3] = p.x + _side.x;
      arr[i * 6 + 4] = p.y + _side.y;
      arr[i * 6 + 5] = p.z + _side.z;
    }
    pos.needsUpdate = true;
    this.mat.uniforms.uTime.value = time;
    // head
    this.head.position.copy(to);
    _b.copy(headDir).normalize();
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _b);
    this.head.quaternion.copy(_q);
  }
}
