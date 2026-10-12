# VFX implementation in three.js r186 (PROJECT GGG)

**Use this file for** building effects in this codebase: what the engine already has (and its
quirks), r186 API facts, blending, particle pools, ribbons, the GLSL library, bloom maths with
`bloomColor()`, budgets, performance and testing. Look and timing live in `vfx-design.md`
(L×1 = luminance 1.45, f = 1/60 s).

**Contents:** §1 Engine baseline · §2 r186 API · §3 Blending & render order · §4 Particle architecture ·
§5 GPU burst pool · §6 Ribbons & tracers · §7 Shader library (7.1 noise · 7.2 erosion · 7.3 fresnel ·
7.4 ramps · 7.5 rings & telegraphs · 7.6 SDF flare & note · 7.7 beams · 7.8 EQ ring · 7.9 soft
particles · 7.10 distortion · 7.11 dithering) · §8 HDR & bloom · §9 Budgets · §10 Motion · §11 Performance ·
§12 Testing · Sources

**Verified** = `tsc --strict` against three@0.186 and rendered in headless Chromium (SwiftShader,
WebGL2), 0 GL errors, identical frames across runs. Every other snippet typechecks and compiles on
r186 but has not been looked at: check it visually first.

---

## 1. Engine baseline (before the current VFX pass)

**Render chain** (`core/Engine.ts`): `WebGLRenderer` (`:40–44`; no MSAA, `preserveDrawingBuffer:
false`, sRGB output, `NoToneMapping`) → `RenderPass` into HalfFloat targets (linear HDR) →
`UnrealBloomPass` (`:49`; strength 0.42, radius 0.32, threshold 1.45, `smoothWidth` 0.01; off on Low)
→ `PersonaFX` (`render/PostFX.ts`, linear HDR: saturation 1.12, contrast 1.06, chroma, speed lines,
vignette, `uFlash`) → `OutputPass` (sRGB, per-channel clip) → `FXAAPass`. DPR: Low 0.75, Medium 1, High ≤ 2.

| Module | Provides | Facts that matter |
|---|---|---|
| `Effects` | `add` (2,400) + `alpha` (1,400) pools, 16 rings, 10 beams; `muzzle`, `hitSpark`, `ring`, `beam`, `explosion`, `shockwave`… | each ring/beam is a mesh (1 draw); a full pool steals slot 0. Ring: additive, colour × 2a², easeOutCubic radius, order 12. Beam: open cylinder, radius = `width`, colour × 2.5, order 11 |
| `ParticlePool` | CPU-simulated instanced quads: glow, puff, star, streak, ring, shard, square | 14 floats uploaded per live particle per frame; `size` = half-extent, lerped linearly; alpha fades in over 10 % of life, then `1 − ((t − 0.1)/0.9)^1.6`; near-camera fade; order 20 / 15 |
| `SlashTrail` | two-rail base→tip strip, 28 samples × 3 Catmull–Rom steps, 0.16 s, additive | order 10 |
| `WeaponGhosts` | holo afterimages every 34 ms (0.2 s); ult shells on `Beat.pulse` | 1 draw per ghost, order 4 |
| `toon.ts` | `neon(color, k)` (hue-blind ×k), `holoMaterial`, `equalizerMaterial`, `addOutline`, `ToonEnv.time` | |
| `Projectiles` | per-kind `Group`s of `neon()` meshes built on first spawn; glow-sprite trail; `hitSpark` on hits; `explode` → `vfx.explosion` unless `blast: false`; `onBurst`; `visualOnly` copies | 2–4 draws per projectile |

Newer modules may have landed in `src/vfx/`: list it first.

**Quirks**
1. **Additive = a²:** the pools, ring and `SlashTrail` write `vec4(col·a, a)` with non-premultiplied
   `AdditiveBlending` (`SRC_ALPHA, ONE` [S59]): alpha 0.5 gives 25 % brightness.
2. **LDR particles:** a hex `ParticleSpec.color` is ≤ 1 per channel, so a lone particle never blooms.
   Pass a `THREE.Color` above 1 (`bloomColor()`, §8) for cores.
3. **First drawn frame is aged dt/life:** a 2–3 f flash needs life ≈ 0.04–0.05 s.
4. **`Shape.streak` is centred** (2·size·(1 + 0.06·speed·stretch) long): use §5 for direction.
5. **Fog:** stock `fog_fragment` paints fog colour over premultiplied quads (arena fog from 60–80 m): §3.
6. **Allocations:** spec literals and `.clone()`s per `emit()` in `Effects.*` (though `emit()` copies
   them), vectors per projectile per frame in `Projectiles.update`, clone + shift in `SlashTrail.update`.
7. **Frame-rate-dependent emission:** per-frame `Math.random()` gates (projectile trail sprites,
   `gasTrail`, `speedStreaks`): accumulate by time or distance instead.
8. **No precompile;** projectile materials build on first spawn, so first casts hitch (§9).
9. **Hitstop slows all VFX** to 6 % (`Match.update` passes the scaled dt to `vfx.update`).
10. **Draw calls:** a full-length Bass Charge (15 rings + 2 beams) or Drop The Beat (12 notes × 2
    meshes) spends 17–24 of the 40-call budget.
11. **`fract(sin())` hashes** (`PersonaFX`, `holoMaterial`): new shaders use §7.1.

---

## 2. three.js r186: API changes since r150, shader conventions

- **r152/r154:** `outputColorSpace` / `SRGBColorSpace`; `ColorManagement` on (hex `Color`s are
  linear); `<colorspace_fragment>` replaced `encodings_fragment`.
- **r153/r155:** HalfFloat composer targets; tone mapping only on the canvas (end with `OutputPass`).
- **r151/r159:** `InstancedMesh` is frustum-culled; `addUpdateRange(start, count)` replaced
  `updateRange` (three merges and clears the ranges). **r163:** no WebGL1. **r183:** `Clock` → `Timer`.
- **r182+:** `outputBufferType` + `setEffects()` (GGG keeps `EffectComposer`); WebGPU/TSL can't run
  GLSL `ShaderMaterial`. `LightningStrike` is gone; `Mesh.count` exists (don't shadow it).

**Conventions:** three prefixes `#version 300 es` and maps `attribute`, `varying`, `texture2D`,
`gl_FragColor`; `fwidth` and integer loops are core. Write linear HDR (`<colorspace_fragment>` is a
no-op in the composer). Pools get a per-match clock restarted at match start; noise panning gets
`t % 1000`. Share uniform objects (`uTime = ToonEnv.time`). Never toggle `defines` at runtime.

---

## 3. Blending and render order

**Convention:** `{ transparent: true, depthWrite: false, premultipliedAlpha: true, blending:
THREE.NormalBlending }` = `ONE, ONE_MINUS_SRC_ALPHA` [S59]. Output `vec4(emission, occlusion)`:
occlusion 0 is additive, > 0 darkens, so one draw mixes glow and smoke [S57][S48]; fade RGB **and**
alpha to 0 [S57].

**Sorting:** three sorts objects (`groupOrder` → `renderOrder` → depth), never particles in a mesh:
keep occlusion ≤ 0.3–0.5 in unsorted pools or draw dark bodies first as their own mesh (slots:
vfx-design.md §1.7). `depthTest` on, `depthWrite` off.

**Premultiplied fog** (replaces `#include <fog_fragment>`; keep `fog: true` and `UniformsLib.fog`):
```glsl
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogF = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor *= 1.0 - fogF;   // emission and occlusion fade together
#endif
```

---

## 4. Particle architecture

- **Primitive:** `InstancedBufferGeometry` + `ShaderMaterial` quads, billboarded or stretched in the
  vertex shader, as fast as `InstancedMesh` [S75][S64] (`ParticlePool` does this). `Points` clip at the
  view edge; `InstancedMesh` costs 16 floats per moving particle per frame.
- **Simulation:** CPU pools re-upload every live particle every frame [S80]; analytic GPU pools (§5)
  write spawn data once; GPGPU [S76] only for one 64k+ hero flow. Ship ≈ 90 % analytic (hits, sparks,
  dust) plus a CPU pool ≤ 256 for particles that steer or collide (bats, notes, orbs).
- **Batching:** one pool per shape family × render slot (premultiplied output drops blend mode from the
  key); `frustumCulled = false`; ring buffers; no allocation in `emit()`; hide idle pools.
- **Meshes** for volume and gameplay-accurate shapes (slashes, rings, beams, domes); **particles** for
  count and chaos [S57].

---

## 5. Stateless GPU burst pool (verified)

**Motion** (drag k, gravity g): p = p₀ + v₀F₁ + gF₂, F₁ = (1 − e^(−kt))/k, F₂ = (t − F₁)/k; direct
F₂ loses 12 % in float32 at kt = 10⁻³, so kt < 0.05 uses the series. 16 floats per particle, 1–2
uploads per `emit()`; ramps are rows of a HalfFloat `DataTexture`; dead particles go to clip
(2, 2, 2, 1); `STRETCH` puts the head on the particle and foreshortens naturally (clamp `len` for
tracers). Burst `size` is the full quad width, unlike `ParticleSpec.size`.

```ts
// GpuBurstPool.ts
import * as THREE from 'three';

export interface SoftUniforms {
  uDepth: THREE.IUniform<THREE.Texture | null>;
  uScreen: THREE.IUniform<THREE.Vector2>;
  uCam: THREE.IUniform<THREE.Vector2>;
  uSoftDist: THREE.IUniform<number>;
}
export const createSoftUniforms = (): SoftUniforms => ({
  uDepth: { value: null }, uScreen: { value: new THREE.Vector2(1, 1) },
  uCam: { value: new THREE.Vector2(0.1, 100) }, uSoftDist: { value: 0.35 },
});

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RampStop { t: number; color: THREE.ColorRepresentation; intensity?: number; alpha?: number }

export function createRampAtlas(ramps: RampStop[][], width = 64): THREE.DataTexture {
  const rows = ramps.length, data = new Uint16Array(width * rows * 4);
  const ca = new THREE.Color(), cb = new THREE.Color(), h = THREE.DataUtils.toHalfFloat;
  for (let r = 0; r < rows; r++) {
    const s = ramps[r];
    for (let x = 0; x < width; x++) {
      const t = x / (width - 1);
      let i = 0;
      while (i < s.length - 2 && t > s[i + 1].t) i++;
      const a = s[i], b = s[Math.min(i + 1, s.length - 1)];
      const k = b.t > a.t ? THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
      ca.set(a.color).multiplyScalar(a.intensity ?? 1);
      cb.set(b.color).multiplyScalar(b.intensity ?? 1);
      ca.lerp(cb, k);
      const o = (r * width + x) * 4;
      data[o] = h(ca.r); data[o + 1] = h(ca.g); data[o + 2] = h(ca.b);
      data[o + 3] = h(THREE.MathUtils.lerp(a.alpha ?? 1, b.alpha ?? 1, k));
    }
  }
  const tex = new THREE.DataTexture(data, width, rows, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export interface Burst {
  position: THREE.Vector3;
  direction?: THREE.Vector3;
  cone?: number;
  count: number;
  speed?: [number, number];
  life?: [number, number];
  size?: [number, number];
  drag?: number;
  gravity?: number;
  spin?: number;
  ramp?: number;
  intensity?: number;
  stretch?: number;
  spread?: number;
  radius?: number;
  inherit?: THREE.Vector3;
}

export interface PoolOptions {
  ramp: THREE.DataTexture;
  capacity?: number;
  shape?: 'soft' | 'spark' | 'ring';
  stretch?: boolean;
  additive?: boolean;
  sizeCurve?: [number, number, number, number];
  soft?: SoftUniforms | null;
  rand?: () => number;
}

const STRIDE = 16;
const _q = new THREE.Quaternion(), _d = new THREE.Vector3(), _axis = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1);

const VERT = /* glsl */ `
uniform float uTime;
uniform vec4 uSizeCurve;
uniform sampler2D uRamp;
uniform vec2 uRampSize;
attribute vec3 aOrigin;
attribute vec3 aVelocity;
attribute vec4 aTime;
attribute vec4 aShape;
attribute vec2 aLook;
varying vec2 vUv;
varying vec4 vColor;
varying float vViewZ;
void main() {
  float t = uTime - aTime.x;
  if (t < 0.0 || t >= aTime.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float age = t / aTime.y, k = aTime.z, kt = k * t;
  float F1 = kt < 0.05 ? t * (1.0 - kt * (0.5 - kt * (1.0 / 6.0 - kt / 24.0))) : (1.0 - exp(-kt)) / k;
  float F2 = kt < 0.05 ? t * t * (0.5 - kt * (1.0 / 6.0 - kt / 24.0)) : (t - F1) / k;
  vec3 g = vec3(0.0, -aTime.w, 0.0);
  vec3 pos = aOrigin + aVelocity * F1 + g * F2;
  vec3 vel = aVelocity * exp(-kt) + g * F1;
  float pk = max(uSizeCurve.w, 1e-3);
  float size = aShape.x * (age < pk ? mix(uSizeCurve.x, uSizeCurve.y, age / pk)
                                    : mix(uSizeCurve.y, uSizeCurve.z, (age - pk) / max(1.0 - pk, 1e-3)));
  vec4 ramp = texture2D(uRamp, vec2((0.5 + age * (uRampSize.x - 1.0)) / uRampSize.x, (aLook.x + 0.5) / uRampSize.y));
  vColor = vec4(ramp.rgb * aLook.y, ramp.a);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec2 c = position.xy;
#ifdef STRETCH
  vec2 vv = (modelViewMatrix * vec4(vel, 0.0)).xy;
  float sp = length(vv);
  vec2 dir = sp > 1e-4 ? vv / sp : vec2(1.0, 0.0);
  float len = size + sp * aShape.w;
  mv.xy += dir * (c.x - 0.5) * len + vec2(-dir.y, dir.x) * c.y * size;
#else
  float ang = aShape.y + aShape.z * t, cs = cos(ang), sn = sin(ang);
  mv.xy += mat2(cs, sn, -sn, cs) * c * size;
#endif
  vViewZ = mv.z;
  vUv = uv;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
#include <packing>
varying vec2 vUv;
varying vec4 vColor;
varying float vViewZ;
#ifdef SOFT
uniform sampler2D uDepth;
uniform vec2 uScreen;
uniform vec2 uCam;
uniform float uSoftDist;
#endif
void main() {
  vec2 d = vUv * 2.0 - 1.0;
#if SHAPE == 1
  float m = max(1.0 - d.y * d.y, 0.0) * vUv.x * vUv.x;
#elif SHAPE == 2
  float r = length(d);
  float m = smoothstep(0.5, 0.8, r) * (1.0 - smoothstep(0.8, 1.0, r));
#else
  float m = max(1.0 - dot(d, d), 0.0); m *= m;
#endif
  m *= vColor.a;
#ifdef SOFT
  float sceneZ = -perspectiveDepthToViewZ(texture2D(uDepth, gl_FragCoord.xy / uScreen).x, uCam.x, uCam.y);
  float partZ = -vViewZ;
  m *= clamp((sceneZ - partZ) / uSoftDist, 0.0, 1.0)
     * clamp((partZ - uCam.x) / 0.3, 0.0, 1.0);
#endif
  if (m < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb * m, m * ALPHA_COVERAGE);
}`;

export class GpuBurstPool extends THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> {
  readonly capacity: number;
  private readonly buf: THREE.InstancedInterleavedBuffer;
  private readonly rand: () => number;
  private head = 0;
  private aliveUntil = -Infinity;

  constructor(o: PoolOptions) {
    const capacity = o.capacity ?? 2048;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    const arr = new Float32Array(capacity * STRIDE);
    for (let i = 0; i < capacity; i++) { arr[i * STRIDE + 6] = -1e9; arr[i * STRIDE + 7] = 1; }
    const buf = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOrigin', new THREE.InterleavedBufferAttribute(buf, 3, 0));
    geo.setAttribute('aVelocity', new THREE.InterleavedBufferAttribute(buf, 3, 3));
    geo.setAttribute('aTime', new THREE.InterleavedBufferAttribute(buf, 4, 6));
    geo.setAttribute('aShape', new THREE.InterleavedBufferAttribute(buf, 4, 10));
    geo.setAttribute('aLook', new THREE.InterleavedBufferAttribute(buf, 2, 14));
    geo.instanceCount = capacity;
    const img = o.ramp.image as { width: number; height: number };
    const defines: Record<string, string | number> = {
      SHAPE: o.shape === 'spark' ? 1 : o.shape === 'ring' ? 2 : 0,
      ALPHA_COVERAGE: o.additive === false ? '1.0' : '0.0',
    };
    if (o.stretch) defines.STRETCH = '';
    if (o.soft) defines.SOFT = '';
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uRamp: { value: o.ramp },
        uRampSize: { value: new THREE.Vector2(img.width, img.height) },
        uSizeCurve: { value: new THREE.Vector4(...(o.sizeCurve ?? [0.4, 1, 0, 0.15])) },
        ...(o.soft ?? {}),
      },
      defines, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: THREE.NormalBlending, premultipliedAlpha: true,
    });
    super(geo, mat);
    this.capacity = capacity;
    this.buf = buf;
    this.rand = o.rand ?? Math.random;
    this.frustumCulled = false;
    this.matrixAutoUpdate = false;
    this.visible = false;
  }

  emit(b: Burst, now: number): void {
    const n = Math.min(b.count | 0, this.capacity);
    if (n <= 0) return;
    const a = this.buf.array as Float32Array, rnd = this.rand;
    const cosMax = Math.cos(b.cone ?? Math.PI);
    _q.setFromUnitVectors(_Z, _axis.copy(b.direction ?? _Y).normalize());
    const [s0, s1] = b.speed ?? [2, 6], [l0, l1] = b.life ?? [0.4, 0.8], [z0, z1] = b.size ?? [0.08, 0.16];
    const spin = b.spin ?? 0, spread = b.spread ?? 0, rad = b.radius ?? 0, iv = b.inherit;
    const first = this.head;
    for (let i = 0; i < n; i++) {
      const o = this.head * STRIDE;
      this.head = (this.head + 1) % this.capacity;
      const cosT = 1 - rnd() * (1 - cosMax), sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
      const phi = rnd() * Math.PI * 2;
      _d.set(Math.cos(phi) * sinT, Math.sin(phi) * sinT, cosT).applyQuaternion(_q);
      const sp = s0 + (s1 - s0) * rnd(), r = rad * Math.cbrt(rnd()), life = l0 + (l1 - l0) * rnd();
      a[o] = b.position.x + _d.x * r; a[o + 1] = b.position.y + _d.y * r; a[o + 2] = b.position.z + _d.z * r;
      a[o + 3] = _d.x * sp + (iv ? iv.x : 0); a[o + 4] = _d.y * sp + (iv ? iv.y : 0); a[o + 5] = _d.z * sp + (iv ? iv.z : 0);
      a[o + 6] = now + spread * rnd(); a[o + 7] = life; a[o + 8] = b.drag ?? 0; a[o + 9] = b.gravity ?? 0;
      a[o + 10] = z0 + (z1 - z0) * rnd(); a[o + 11] = rnd() * Math.PI * 2; a[o + 12] = (rnd() * 2 - 1) * spin;
      a[o + 13] = b.stretch ?? 0; a[o + 14] = b.ramp ?? 0; a[o + 15] = b.intensity ?? 1;
      this.aliveUntil = Math.max(this.aliveUntil, a[o + 6] + life);
    }
    const end = first + n;
    if (end <= this.capacity) this.buf.addUpdateRange(first * STRIDE, n * STRIDE);
    else {
      this.buf.addUpdateRange(first * STRIDE, (this.capacity - first) * STRIDE);
      this.buf.addUpdateRange(0, (end - this.capacity) * STRIDE);
    }
    this.buf.needsUpdate = true;
    this.visible = true;
  }

  update(now: number): void {
    this.material.uniforms.uTime.value = now;
    this.visible = now < this.aliveUntil;
  }
}
```

**In GGG** (no `soft` until the composer has a depth texture, §7.9):
```ts
const sparks = new GpuBurstPool({ shape: 'spark', stretch: true, capacity: 1024, rand: mulberry32(7),
  ramp: createRampAtlas([[{ t: 0, color: '#fff4dc', intensity: 4.4 }, { t: 0.35, color: '#ffc94a', intensity: 1.6 },
    { t: 1, color: '#9b5cff', intensity: 0.4, alpha: 0 }]]) });   // L×2.8 core → L×0.7 gold → dim violet tail
sparks.renderOrder = 20; scene.add(sparks);                         // every frame: sparks.update(vfxNow)
sparks.emit({ position: hit, direction: normal, cone: 1.1, count: 18, speed: [8, 16], life: [0.12, 0.3],
  size: [0.05, 0.08], drag: 6, gravity: 9, stretch: 0.03 }, vfxNow);
```
`stretch` = seconds of travel shown (sparks 0.025–0.04, tracers 1.5/60). **Charge-up streaks:** a
negative speed flies inward (offset and velocity share a direction): `{ position: orb, cone: Math.PI,
radius: 1.4, speed: [-4.7, -4.7], life: [0.3, 0.3] }` reaches the core at ≈ end of life.

---

## 6. Ribbons and tracers

MeshLine has no miter clamp and `setPoints()` allocates per call [S65][S80]. **`RibbonTrail`
(verified):** a ring buffer of `[x, y, z, t]` samples, head glued to the tip; commit after 0.04 m, or
1/30 s while moving; centripetal Catmull–Rom resampling (subdiv 4: fast swings turn 30–60° per frame);
2 vertices per point (`position`, `aPrev`, `aNext`, `aSide` ±1, `aData` = birth time, arc length in m);
prefix-only uploads, `setDrawRange` on a static index; 24 samples, life 0.22 s, width 0.35 → 0. The
fragment: body `smoothstep(0, 0.7, across)·(1 − age)²·mix(0.55, 1, vnoise)`, core `smoothstep(0.75, 1, across)·(1 − age)⁴`.
```ts
// RibbonTrail.ts (excerpt): vertex shader
const VERT = /* glsl */ `
uniform float uTime, uLife, uTaper;
uniform vec2 uWidth;
attribute vec3 aPrev, aNext;
attribute float aSide;
attribute vec2 aData;
varying vec2 vUv;
varying float vAge;
void main() {
  vec3 P = (modelViewMatrix * vec4(position, 1.0)).xyz;
  vec3 A = (modelViewMatrix * vec4(aPrev, 1.0)).xyz;
  vec3 B = (modelViewMatrix * vec4(aNext, 1.0)).xyz;
  vec3 t1 = P - A, t2 = B - P;
  float l1 = length(t1), l2 = length(t2);
  t1 = l1 > 1e-6 ? t1 / l1 : (l2 > 1e-6 ? t2 / l2 : vec3(1.0, 0.0, 0.0));
  t2 = l2 > 1e-6 ? t2 / l2 : t1;
  vec3 T = t1 + t2;
  T = length(T) > 1e-6 ? normalize(T) : t1;
  vec3 E = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-P);
  vec3 N = cross(T, E);
  N = length(N) > 1e-6 ? normalize(N) : vec3(0.0, 1.0, 0.0);
  vec3 n1 = cross(t1, E);
  float dm = length(n1) > 1e-6 ? abs(dot(N, normalize(n1))) : 1.0;
  float miter = 1.0 / max(dm, 0.5);
  float age = clamp((uTime - aData.x) / uLife, 0.0, 1.0);
  float w = mix(uWidth.x, uWidth.y, pow(age, uTaper));
  P += N * aSide * 0.5 * w * miter;
  vUv = vec2(aData.y, aSide * 0.5 + 0.5);
  vAge = age;
  gl_Position = projectionMatrix * vec4(P, 1.0);
}`;
```
Centripetal Catmull–Rom (Barry–Goldman): knots tᵢ₊₁ = tᵢ + max(|pᵢ₊₁ − pᵢ|^½, 10⁻⁴); for t ∈ [t₁, t₂]
lerp p₀…p₃ pairwise by (t − tᵢ)/(tᵢ₊₁ − tᵢ), then the three results by (t − tⱼ)/(tⱼ₊₂ − tⱼ), then the two
by (t − t₁)/(t₂ − t₁). Keep trails un-parented; for melee the two-rail `SlashTrail` is the better
shape. **Two-layer trail** [S16]: a second ribbon on the same tip, 60 % of the life, drawn first,
output `vec4(dark * k, k * 0.5)`: contrast stays at the head.

**Tracers:** fast physical shots use §5's stretch. Line (hitscan) tracers use §7.7's strip with U in
metres (`vUv.x / tile`), head at `min(L, t·v)`, tail at `max(0, (t − delay)·v)` [S18].

---

## 7. Shader library

### 7.1 Noise, panning, IGN, stepped time
The value-noise half is verified; `hash22` onward is not.
```ts
// glsl.ts — sin-free hashes (Hoskins), value + gradient noise, fBm, panning, IGN, stepped time
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float fbm2(vec2 p) {
  const mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = R * p * 2.03 + 11.7; a *= 0.5; }
  return s / 0.9375;
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise3(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.875;
}
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float gnoise(vec2 p) {                       // gradient noise, ~[-1, 1]
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float a = dot(hash22(i) * 2.0 - 1.0, f);
  float b = dot(hash22(i + vec2(1, 0)) * 2.0 - 1.0, f - vec2(1, 0));
  float c = dot(hash22(i + vec2(0, 1)) * 2.0 - 1.0, f - vec2(0, 1));
  float d = dot(hash22(i + vec2(1, 1)) * 2.0 - 1.0, f - vec2(1, 1));
  return 1.4 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float gfbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 3; k++) { s += a * gnoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; } return s; }
float panNoise(vec2 uv, vec2 speed, float scale, float warp, float t) {   // 0..1, travels along +speed
  vec2 p = uv * scale;
  vec2 w = vec2(gnoise(p * 0.5 + t * 0.31), gnoise(p * 0.5 - t * 0.27 + 5.2));
  return gfbm(p + w * warp - t * speed) * 0.5 + 0.5;
}
float ign(vec2 fc) { return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715)))); } // interleaved gradient noise
float stepTime(float t, float fps) { return floor(t * fps) / fps; }  // on twos = 30, on threes = 20
`;
```
ALU: `hash12` 10, `vnoise` / `gnoise` 40, `snoise` 60, `gfbm` 130, `fbm2` 160, `fbm3` 250 [S82][S66].
Quads over 25 % of the screen: one octave or a baked 256² noise texture. `fract(sin())` hashes break on
mediump and some ANGLE back-ends. Keep integer scales so textures tile [S57]; `stepTime` = LYGIA
`decimate` [S67].

### 7.2 Alpha erosion (burn band) and mesh dissolve
```glsl
// m: erosion map 0..1 (shape × noise; low values die first). e: 0 intact → 1 gone.
float erode(float m, float e, float soft) { float th = e * (1.0 + soft); return smoothstep(th, th + soft, m); }
void erodeEdge(float m, float e, float soft, float band, out float a, out float edge) {
  a = erode(m, e, soft);
  edge = a - erode(m, min(e + band, 1.0), soft);   // pixels that die within the next `band`
}
// float m = shape * mix(1.0, panNoise(vUv, vec2(0.0, 1.2), 4.0, 0.6, uTime), 0.65);
// float a, edge; erodeEdge(m, smoothstep(0.3, 1.0, uAge), 0.04, 0.12, a, edge);
// vec3 col = mix(uMid, uHot, edge) * (1.0 + 3.0 * edge);   // the burn band runs hot
// gl_FragColor = vec4(col * a, a * uOcclusion);            // 0 additive, 0.3–0.8 darkening body
```
The threshold spans `[0, 1 + soft]` so feathered maps fully erode (a bare `step` aliases); `soft`
0.02–0.04 = toon, 0.15–0.25 = smoke; maps stay linear; erosion **subtracts** from the mask [S57].
**Toon meshes (verified chunks):** `vObjPos = position` in the vertex shader, `DISSOLVE_PARS` above
`main`, `DISSOLVE_APPLY` first in `main`, after cel shading `col = mix(col, uEdgeColor, edge)` (HDR edge).
Share the uniforms with the outline hull; for edge sparks evaluate the same hash in TS [S85].
```ts
// materials.ts (part; header and imports in §7.7): toon + dissolve drop-in chunks
export const DISSOLVE_PARS = /* glsl */ `
uniform float uDissolve;
uniform float uEdgeWidth;
uniform float uNoiseScale;
uniform vec3 uEdgeColor;
varying vec3 vObjPos;
${NOISE_GLSL}`;
export const DISSOLVE_APPLY = /* glsl */ `
  float dn = fbm3(vObjPos * uNoiseScale);
  float dd = dn - (uDissolve * (1.0 + uEdgeWidth) - uEdgeWidth);
  if (dd < 0.0) discard;
  float edge = 1.0 - smoothstep(0.0, uEdgeWidth, dd);`;
```

### 7.3 Fresnel rim
```glsl
// vertex: vN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz);
uniform vec3 uRim, uFill; uniform float uPower, uToon;   // uPower 2–5 (Schlick 5)
varying vec3 vN; varying vec3 vV;
void main() {
  float f = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), uPower); // abs(): DoubleSide
  float aa = fwidth(f);
  f = mix(f, smoothstep(0.5 - aa, 0.5 + aa, f), uToon);   // uToon = 1 → hard two-tone rim
  gl_FragColor = vec4(mix(uFill, uRim, f) * (0.15 + 0.85 * f), 0.0);
}
```
Shields, domes, holo blades, orbs [S57][S69].

### 7.4 Gradient ramps
```glsl
vec3 ramp4(float x, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {   // dark edge → saturated → hot → white core
  x = clamp(x, 0.0, 1.0);
  vec3 c = mix(c0, c1, smoothstep(0.00, 0.35, x));
  c = mix(c, c2, smoothstep(0.35, 0.75, x));
  return mix(c, c3, smoothstep(0.75, 0.95, x));
}
vec3 ramp3Toon(float x, vec3 c0, vec3 c1, vec3 c2, float t1, float t2) {   // 3 hard bands, ~1 px AA
  float aa = fwidth(x) + 1e-4;
  return mix(mix(c0, c1, smoothstep(t1 - aa, t1 + aa, x)), c2, smoothstep(t2 - aa, t2 + aa, x));
}
// heat drop: x = mask * (1.0 - 0.6 * uAge) → the white core cools first
```
Gradient mapping of a greyscale mask [S57][S27]; HDR only in the top colour; many ramps per pool: `createRampAtlas()` rows (§5).

### 7.5 Shockwave rings and telegraph decals
**Verified ring:** `R = 1 − (1 − t)³`, sharp front, squared wake, noise at `p / r` (no `atan` seam);
`PlaneGeometry(2, 2)` rotated −π/2 on X, scaled to the maximum radius.
```ts
// materials.ts (part; header and imports in §7.7)
const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const RING_FRAG = /* glsl */ `
uniform float uT, uThickness, uSeed;
uniform vec3 uColor;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float R = 1.0 - pow(1.0 - uT, 3.0);
  float w = uThickness * (1.0 - 0.5 * uT);
  float band = (1.0 - smoothstep(R, R + 0.02, r)) * pow(smoothstep(R - w, R, r), 2.0);
  vec2 dir = p / max(r, 1e-4);
  float br = mix(0.45, 1.0, vnoise(dir * 3.0 + uSeed)) * mix(0.6, 1.0, vnoise(dir * 11.0 + uT * 4.0 - uSeed));
  float fade = 1.0 - smoothstep(0.5, 1.0, uT);
  gl_FragColor = vec4(uColor * band * br * fade, 0.0);
}`;

export function createShockwaveRing(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uThickness: { value: 0.18 }, uSeed: { value: 0 }, uColor: { value: new THREE.Color(0xffb040).multiplyScalar(4) } },
    vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, blending: THREE.NormalBlending, premultipliedAlpha: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.rotation.x = -Math.PI / 2; // ground-aligned; scale = max radius (m)
  return mesh;
}
```
**Toon/ink variant** (GGG spec, unverified): quad half-size = radius / 0.95, `R = 0.95·(1 − 2^(−10t))`,
band width `0.25·(1 − t)² + 0.01` behind the front (`d = r − R`), `front = 1 − smoothstep(0, w, −d)`,
colour `ramp3Toon(front, dark, mid, hot·gain, 0.35, 0.8)`, output `vec4(col·a, a·0.35·(1 − front))`:
the trailing band darkens (ink) while the front glows.

**Telegraph decal** (unverified; vfx-design.md §4): quad half-size = radius + border width, so the
border's outer edge is exactly the gameplay radius.
```glsl
uniform float uBorder, uAge, uFuse, uEnemy, uTime;   // uBorder = border width / quad half-size
uniform vec3 uRimCol;                                // bloomColor(rim, 0.8): never blooms
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;  float r = length(p), aa = fwidth(r);
  float outer = 1.0 - uBorder, inner = outer - uBorder;     // outer edge of the border = radius
  float ring = smoothstep(inner - aa, inner, r) * (1.0 - smoothstep(outer - aa, outer, r));
  float dash = uEnemy > 0.5 ? step(0.35, fract(atan(p.y, p.x) / 6.2831853 * 48.0)) : 1.0;  // enemy: dashed
  float k = clamp(uAge / uFuse, 0.0, 1.0);
  float fill = (1.0 - smoothstep(k * inner - aa, k * inner, r)) * mix(0.08, 0.18, k);   // grows outward
  float blink = (uFuse - uAge < 0.15 && mod(floor(uTime * 30.0), 2.0) < 1.0) ? 1.875 : 1.0; // → L×1.5, 2 f on/off
  gl_FragColor = vec4(uRimCol * (ring * dash * blink + fill), (ring * dash + fill) * 0.5);
}
```
`renderOrder` 1–3, lifted 0.02 m, following the projectile's ground point.

### 7.6 SDF star flare and music note
```glsl
float sdStar(vec2 p, float r, float n, float k) {   // n points; k inner/outer (0.2 spiky … 0.6 chunky)
  float an = 3.14159265 / n;
  float s = mod(atan(p.y, p.x) + an, 2.0 * an) - an;   // fold into one point's sector
  vec2 q = length(p) * vec2(cos(s), abs(sin(s)));
  vec2 tip = vec2(r, 0.0), inn = k * r * vec2(cos(an), sin(an));
  vec2 e = inn - tip, w = q - tip;
  float dist = length(w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0));
  return (e.x * w.y - e.y * w.x) > 0.0 ? -dist : dist;  // negative inside
}
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float sdEighthNote(vec2 p) {                          // p in ~[-.5, .5]², note ≈ 0.9 tall
  vec2 h = mat2(0.9, -0.436, 0.436, 0.9) * (p - vec2(-0.12, -0.30));  // head tilted ~26°
  float head = (length(h / vec2(0.19, 0.13)) - 1.0) * 0.13;          // approximate ellipse SDF
  float stem = sdSeg(p, vec2(0.05, -0.28), vec2(0.05, 0.42)) - 0.032;
  float flag = sdSeg(p, vec2(0.05, 0.42), vec2(0.25, 0.14)) - 0.04;
  return min(head, min(stem, flag));
}
uniform float uPoints, uSharp, uAge, uRot, uGain; uniform vec3 uCore, uMid;
varying vec2 vUv;
void main() {                                         // flare = toon star + white core + halo + streak
  vec2 p = vUv * 2.0 - 1.0;  float cr = cos(uRot), sr = sin(uRot);  p = mat2(cr, sr, -sr, cr) * p;
  float d = sdStar(p / (1.0 + 0.25 * uAge), 0.85, uPoints, uSharp), aa = fwidth(d) * 1.5;
  float star = 1.0 - smoothstep(-aa, aa, d);
  float core = 1.0 - smoothstep(-aa, aa, d + 0.18);
  float halo = exp(-max(d, 0.0) * 6.0) * 0.35;
  float streak = exp(-abs(p.y) * 40.0) * (1.0 - smoothstep(0.0, 1.0, abs(p.x)));
  float life = 1.0 - smoothstep(0.0, 1.0, uAge);
  gl_FragColor = vec4((uMid * (star + halo + 0.6 * streak) + uCore * core) * uGain * life, 0.0);
}
// ink-outlined note (premultiplied: the fill emits, the outline occludes)
//   float d = sdEighthNote(p), aa = fwidth(d);
//   float fill = 1.0 - smoothstep(-aa, aa, d);
//   float ink  = (1.0 - smoothstep(-aa, aa, d - 0.045)) - fill;
//   gl_FragColor = vec4(uColor * uGain * fill, 0.2 * fill + 0.9 * ink);
```
Unverified. Quantize `uRot` to 4 values, step `uAge` per frame for f0/f1 holds. Alternatives: LYGIA
`starSDF` / `flowerSDF` [S67]. An SDF note quad gives the ink outline and the threat-rim swap for free.

### 7.7 Beams
**Verified axial billboard strip:** x along, y = ±1 across, `side = cross(dir, toCam)`; fBm-modulated
Gaussian glow plus a `smoothstep` core, noise in metres. Lightning = `uJag > 0` (seed jumps
`uFlickerHz` times per second, ends pinned by `sin(πx)`); branches are short extra beams.
```ts
// materials.ts — beam/lightning and ring shaders, dissolve chunks
import * as THREE from 'three';
import { NOISE_GLSL } from './glsl';

const BEAM_VERT = /* glsl */ `
uniform vec3 uStart, uEnd;
uniform float uWidth, uTime, uJag, uFlickerHz;
varying vec2 vUv;
varying float vLen;
${NOISE_GLSL}
void main() {
  vec3 axis = uEnd - uStart;
  float L = max(length(axis), 1e-4);
  vec3 dir = axis / L;
  vec3 P = uStart + axis * position.x;
  vec3 toCam = normalize(cameraPosition - P);
  vec3 side = cross(dir, toCam);
  side = length(side) > 1e-5 ? normalize(side) : vec3(0.0, 1.0, 0.0);
  float seed = floor(uTime * uFlickerHz);
  float env = sin(3.14159265 * position.x);
  float jag = (vnoise(vec2(position.x * L * 2.5, seed * 7.31)) - 0.5) * 2.0 * uJag * env;
  P += side * (position.y * uWidth * 0.5 + jag);
  vUv = vec2(position.x * L, position.y);
  vLen = L;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uCore, uGlow;
uniform float uIntensity, uTime, uScroll, uFade;
varying vec2 vUv;
varying float vLen;
${NOISE_GLSL}
void main() {
  float y = abs(vUv.y);
  float n = fbm2(vec2(vUv.x * 1.2 - uTime * uScroll, vUv.y * 0.75 + uTime * 0.5));
  float glow = exp(-y * y * (7.0 - 4.0 * n));
  float core = 1.0 - smoothstep(0.08, 0.26, y + (n - 0.5) * 0.1);
  float ends = smoothstep(0.0, 0.25, vUv.x) * smoothstep(0.0, 0.25, vLen - vUv.x);
  vec3 col = (uGlow * glow * (0.3 + n) + uCore * core) * uIntensity * ends * uFade;
  gl_FragColor = vec4(col, 0.0);
}`;

export function createBeam(segments = 32): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    pos.push(i / segments, -1, 0, i / segments, 1, 0);
    if (i < segments) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uStart: { value: new THREE.Vector3() }, uEnd: { value: new THREE.Vector3(0, 0, -10) },
      uWidth: { value: 0.6 }, uTime: { value: 0 }, uJag: { value: 0 }, uFlickerHz: { value: 20 },
      uCore: { value: new THREE.Color(1, 1, 1) }, uGlow: { value: new THREE.Color(0x30c8ff) },
      uIntensity: { value: 3 }, uScroll: { value: 6 }, uFade: { value: 1 },
    },
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, blending: THREE.NormalBlending, premultipliedAlpha: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
```
**GGG beam body** (unverified fragment for the same vertex shader; vfx-design.md §3, §10.3). `uF` =
frames since release; `uWidth` = 2 × hit radius / `uHitFrac`; needs `gnoise`.
```glsl
uniform float uTime, uF, uBeat, uGain, uHitFrac, uScroll;   // uHitFrac ≈ 0.6, uScroll 30–40 m/s
uniform vec3 uCore, uMid, uEdge;
varying vec2 vUv;          // x: metres from the muzzle, y: -1..1 across
varying float vLen;
void main() {
  float across = abs(vUv.y);
  float env = uF < 2.0 ? 1.4 : (uF < 6.0 ? mix(1.4, 1.0, smoothstep(2.0, 6.0, uF))
                                         : mix(1.0, 0.2, smoothstep(6.0, 13.0, uF)));
  env *= uHitFrac * (1.0 + 0.12 * uBeat);                                    // ±12 % on the beat
  float n = gnoise(vec2((vUv.x - uTime * uScroll) * 0.7, vUv.y * 2.0)) * 0.5 + 0.5; // travels forward
  float edgeW = env * (0.78 + 0.22 * n), aa = fwidth(across) * 1.5;
  float body = 1.0 - smoothstep(edgeW - aa, edgeW + aa, across);
  float core = 1.0 - smoothstep(0.25 * env - aa, 0.25 * env + aa, across);
  float sweep = smoothstep(6.0, 13.0, uF);                                   // erase muzzle → target
  float alive = smoothstep(sweep - 0.02, sweep, vUv.x / vLen);
  vec3 col = mix(uEdge, uMid, smoothstep(0.0, 0.6, 1.0 - across / max(edgeW, 1e-3)));
  col = mix(col, uCore, core);
  float flash = mix(3.0, 1.0, smoothstep(0.0, 2.0, uF));                     // ≈ 2 f HDR flash
  gl_FragColor = vec4(col * body * alive * uGain * flash, 0.0);
}
```
`uCore = bloomColor('#fff4dc', 4)`, `uMid` ≤ 1 per channel.

### 7.8 Procedural EQ ring
```glsl
// quad: 32 bars, stepped re-roll, the kick drives height (needs hash12, stepTime)
uniform float uBeat, uTime; uniform vec3 uColA, uColB; varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;  float r = length(p), a = atan(p.y, p.x) / 6.2831853 + 0.5;
  float id = floor(a * 32.0), f = fract(a * 32.0);
  float h = hash12(vec2(id, stepTime(uTime, 8.0)));                    // re-roll 8×/s
  float r0 = 0.55, r1 = r0 + 0.4 * (0.25 + 0.75 * h * (0.35 + 0.65 * uBeat));
  float bar = step(0.18, f) * step(f, 0.82) * step(r0, r) * step(r, r1) * step(0.25, fract((r - r0) * 20.0)); // LED segments
  gl_FragColor = vec4(mix(uColA, uColB, smoothstep(r0, r0 + 0.4, r)) * (1.0 + 2.5 * uBeat) * bar, 0.0);
}
```
`uBeat = Beat.kick` (flavour only). `equalizerMaterial` (`toon.ts`) is the rectangular panel.

### 7.9 Soft particles
**Default (no depth texture):** fade at the floor, plus `ParticlePool`'s near-camera fade.
```glsl
varying float vWorldY;  uniform float uGroundY;           // VS: vWorldY = (modelMatrix * vec4(pos, 1.0)).y
float groundFade() { return smoothstep(0.0, 0.35, vWorldY - uGroundY); }
```
**Depth-faded (verified; the `SOFT` block in §5):** `clamp((sceneZ − particleZ) / softDist, 0, 1)` via
`perspectiveDepthToViewZ` [S47][S57][S60]. A framebuffer's own depth can't be sampled while drawing,
so a `SceneVfxPass` replaces `RenderPass`:
```ts
cam.layers.set(0); renderer.setRenderTarget(sceneRT); renderer.clear(); renderer.render(scene, cam); // HalfFloat + DepthTexture
cam.layers.set(VFX_LAYER); scene.background = null; renderer.shadowMap.autoUpdate = false;
soft.uDepth.value = sceneRT.depthTexture; soft.uScreen.value.set(vfxRT.width, vfxRT.height); soft.uCam.value.set(cam.near, cam.far);
renderer.setRenderTarget(vfxRT); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false); renderer.render(scene, cam);
// restore clear colour, background, shadow autoUpdate and cam.layers.mask, then a full-screen quad:
// gl_FragColor = vec4(scene.rgb * (1.0 - vfx.a) + vfx.rgb, 1.0);
```
`vfxRT` is half-res and depth-less (≈ 4× less fill [S49][S57]). Adopting it means every VFX mesh on
`VFX_LAYER` and every VFX material premultiplied with alpha = occlusion (today's additive pools write
alpha and would darken the scene under every glow). A High-preset candidate.

### 7.10 Distortion (post)
```glsl
// tDistort: half-res HalfFloat RT, cleared to 0, where sprites add signed offsets in RG; a shockwave
// sprite writes vec4(normalize(p) * exp(-pow((length(p) - R) / 0.08, 2.0)) * (1.0 - uAge), 0.0, 0.0)
uniform sampler2D tDiffuse, tDistort; uniform float uStrength, uSplit;   // uStrength ≈ 0.01
varying vec2 vUv;
void main() {
  vec2 o = texture2D(tDistort, vUv).rg * uStrength;
  float r = texture2D(tDiffuse, vUv + o * (1.0 + uSplit)).r;            // chroma split = "bass" glitch
  gl_FragColor = vec4(r, texture2D(tDiffuse, vUv + o).gb, 1.0);
}
```
Screen-space refraction of the resolved frame (transmission re-renders the scene) [S57][S81]. Keep
the split at 1–2 px outside impact frames [S69]. High preset only.

### 7.11 Dithering
three's dither shifts channels by up to ±0.5/255 [S61]. With `ign(gl_FragCoord.xy)`: add
`(ign − 0.5) / 255` to wide dark gradients, or `if (alpha < ign) discard;` (depth write on) for opaque
shards and bodies: no sorting, no overdraw [S57]. It stipples below ~0.3 alpha: use it for the last
30 % of a fade.

---

## 8. HDR and bloom without white mush

**`UnrealBloomPass`** [S58][S78]: a half-res bright pass keeps the **full texel colour** weighted by
`smoothstep(T, T + smoothWidth, luminance)` (Rec.709; T is not subtracted); 5 mips (kernels
6/10/14/18/22, weights 1.0/0.8/0.6/0.4/0.2 bent by `radius`), × strength, added over the scene.

**Rules for GGG** (strength 0.42, radius 0.32, threshold 1.45, `NoToneMapping`)
1. **Normalise by luminance:** violet `#9b5cff` (linear 0.328, 0.107, 1.0; luminance 0.218) needs ×6.6
   to reach T, gold `#ffc94a` (0.635) ×2.3; `neon(0xa46bff, 2.8)` = L×0.49, `neon(0xffc94a, 2.6)` = L×1.14.
2. **Clipping shifts hue:** channels > 1 clip per channel at output (violet → pink → white, gold →
   yellow-white). Mids ≤ 1; only small cores past T; the halo keeps the hue because bloom blurs the HDR
   colour [S29][S50]. Tone mappers whiten too (Neutral desaturates, AgX clamps) [S62].
3. **Soft knee:** at `smoothWidth` 0.01 a fading halo pops. Set once (it is not reset per frame):
   `(engine.bloom.highPassUniforms as Record<string, THREE.IUniform>).smoothWidth.value = 0.6;` (≈ 0.4 T;
   bloom ramps in between L×1.0 and L×1.4).
4. **Separate what blooms** (emissives 10–100× the rest [S30]); on Low (no bloom) add a halo sprite
   at L×0.6 behind cores when `engine.quality.bloom` is false.
5. **Optional hue-safe clamp** at the end of `PersonaFX`:
   `col = mix(min(col, 1.0), col / max(1.0, max(col.r, max(col.g, col.b))), uHueSafe);`.
6. **Selective bloom** if ever needed: layers + dark-material swap (doubles scene draws) [S63] or an
   MRT mask; pmndrs `SelectiveBloomEffect` costs as much as layers [S83].

Reference implementation (if `src/vfx` already exports a `bloomColor`, use that one):

```ts
const _lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear Rec.709, as three's luminance()
/** Equal perceived bloom for any hue: tier 1 = exactly the bloom threshold. Pass `out` in hot paths. */
export function bloomColor(hex: THREE.ColorRepresentation, tier: number, out = new THREE.Color(), threshold = 1.45): THREE.Color {
  out.set(hex);
  return out.multiplyScalar((tier * threshold) / Math.max(_lum(out), 1e-4));
}
// tiers: 0.3–0.9 mid (no bloom) · 1.2 soft halo · 2 strong · 4 flash (≤ 3 f) · 6+ ult / impact frames only
// L×4 violet = (8.7, 2.8, 26.6): core clips white, halo violet → pink. L×4 gold = (9.1, 5.3, 0.6).
```
**Impact frame** (verified feel pass; `PersonaFX` `uImpact` = 1 for 1–2 frames, 0.25–0.4 shooter-only):
```glsl
float l = dot(clamp(col, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
col = mix(col, vec3(1.0) - mix(vec3(0.02), vec3(1.0), step(0.5, l)), uImpact);   // inverted two-tone frame
```

---

## 9. Pooling and budgets

| Item (iGPU, 1080p, DPR 1, Medium) | Budget |
|---|---|
| VFX draw calls | ≤ 40 (typical 10–25); post adds ≈ 16 |
| Live particles | ≤ 3,000 (≤ 1,200 Low); vertex cost is negligible, fill and upload are not |
| Transparent coverage | ≤ 3 screens sustained (aim ≤ 2), ≤ 6 for ≤ 300 ms: the biggest risk |
| Quads > 25 % of screen | one noise octave or baked noise; ≤ 10 screen-filling sprites |
| VFX GPU / CPU | ≤ 3 ms / ≤ 0.5 ms typical, ≤ 1.5 ms at a 4-ult peak (frame: GPU ≤ 11, JS ≤ 4 ms) |
| Programs · targets | ≤ 40, precompiled · ≤ 150 MB (1080p HalfFloat ≈ 16.6 MB each) |
| Allocations · lights | 0 per frame · fixed count |

**Cost:** overdraw first, then emission, ALU, screen size [S49][S57]. CPU pools upload only the live
range (`addUpdateRange(0, live * itemSize)`).

**Rules**
- One premultiplied pool per shape family; oldest recycled first; caps drop flavour before gameplay.
- No lights added or removed mid-match (light counts key every lit program: all toon materials
  recompile); 2–4 pooled point lights at intensity 0.
- Program cache = source + parameters; `defines`, `transparent`, fog, lights or `needsUpdate` may
  recompile [S81]. `Engine.setQuality` flags every material: menus only.
- **Precompile at match load** with every pool, VFX mesh and one hidden projectile of each kind in the
  scene (`compile` walks hidden objects but takes colour-space variants from the bound target):
```ts
renderer.setRenderTarget(engine.composer.readBuffer);  // the linear HalfFloat target RenderPass draws into
await renderer.compileAsync(scene, camera);             // parallel when KHR_parallel_shader_compile exists
renderer.setRenderTarget(null);
engine.render(0);                                        // warm-up frame with every effect alive (post quads aren't in the scene)
```

---

## 10. Motion helpers

- `Ease` (`fighter/Animator.ts`): `outExpo` / `outBack` for scale pops, `step` for holds.
- `SecondOrder(dim, f, ζ, r)` (`fighter/Springs.ts`), stable for any dt: a charge orb lagging the
  muzzle (f 6, ζ 0.5), a decal following a bouncing puck (f 8, ζ 1). `Kick.hit(peak, rise, hang)`
  for snaps (perfect-charge ring snap, flare recoil).
- `slerp` takes the shortest arc; never blend Euler; `MathUtils.damp` = `lerp(x, y, 1 − e^(−λdt))`.
  Squash and stretch a visual root by `(1/√s, s, 1/√s)`, never a skinned bone.

**Instanced vertex motion** (bats, notes):
```glsl
attribute float aPhase;                                     // per instance, ±20 % spread
uniform float uTime, uFlapW;                                // bats 18–25 rad/s, bees 60–90
float ts = floor(uTime * 30.0) / 30.0;                      // look stepped at 30 fps; positions stay 60
vec3 p = position;
p.y += abs(p.x) * 0.6 * sin(ts * uFlapW + aPhase);          // wing tips move most
```
Spirals for ≤ 12 homing heads are cheaper in TS: `pos + (side·cos θ + up·sin θ)·A` (vfx-design.md §5).

---

## 11. Performance

- **No steady-state allocation:** module-scope scratch vectors, ring buffers, reused specs, no
  closures in per-particle loops; 1–2 `addUpdateRange` per buffer per frame.
- **Fill:** fit quads to the visible mask; DPR ≤ 1.25 and no MSAA on integrated GPUs.
- **Profiling:** the composer renders many times a frame, so `renderer.info.autoReset = false` plus one
  `reset()` per frame; Spector.js for GL calls [S84], Chrome's performance panel for GC.

| Symptom | Cause → fix |
|---|---|
| Hitch on first cast or when a light appears | compile on use, light count changed → §9 |
| GC sawtooth in fights | clones / literals per emit → scratch objects, ring buffers |
| Tracer reads as dots | head shorter than per-frame travel → stretch over 1–1.5 frames |
| Halo pops while fading | `smoothWidth` 0.01 → 0.6 (§8) |
| Violet pink/white, or dim next to gold | clipping, hue-blind multipliers → `bloomColor`, mids ≤ 1 |
| Haze squares, vanishing or frozen effects | §1 quirks 5, 9 and the ring/beam pool steal |

---

## 12. Testing and verification

Start with the skill's capture tools (SKILL.md §5.2: `scripts/capture.mjs scenario`). Beyond sheets:
1. **Headless GPU:** `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
   --ignore-gpu-blocklist` [S84] (WebGL2, `EXT_color_buffer_float`, synchronous compiles); 640×360, DPR 1.
2. **Determinism:** fixed dt, seeded VFX PRNG, and `Math.random` seeded before load (effects use it) [S84].
3. **Same-task readback:** `preserveDrawingBuffer: false` (`Engine.ts:40`) blanks a later
   `toDataURL()`; read right after rendering or screenshot the canvas element.
4. **Assert:** run-to-run pixelmatch = 0 (threshold 0.1); goldens ≤ 0.5 % differing pixels; budgets;
   no console or GL errors; semantic checks (bright pixels at the projected hit point, a ring edge at
   the projected radius) beat goldens.
5. **Overdraw view:** VFX materials → premultiplied additive `vec4(0.05, 0.05, 0.05, 0.0)`, bloom and
   `engine.fx` off, linear output: mean pixel / 0.05 = screens of coverage, max / 0.05 = worst layers.

Dev-only harness hooks: `warmup()` (bind `engine.composer.readBuffer`, `compileAsync`, one frame,
return the program count) and `step(n, dt)` (fixed-dt steps, one frame, return calls, triangles,
`gl.getError()`, PNG).

---

## Sources

- S16 McSheehan, two-layer trails: https://realtimevfx.com/t/shannon-mcsheehan-lol-fx-knowledge-share/1133
- S18 Hitscan tracers: https://realtimevfx.com/t/need-advice-on-how-to-create-a-hit-scan-tracer-bullet-effect-using-beams-in-ue4/3876
- S27 Trümpler, Battlefront II: https://simonschreibt.de/gat/battlefront-ii-layered-explosion/
- S29 Trümpler, GTA V glow: https://simonschreibt.de/gat/gta-v-underestimated-glow/
- S30 McCurdy, emission and bloom: https://www.donmccurdy.com/2024/04/27/emission-and-bloom/
- S47 NVIDIA soft particles: https://developer.download.nvidia.com/whitepapers/2007/SDK10/SoftParticles_hi.pdf
- S48 Wicked Engine, blend states: https://wickedengine.net/2017/10/which-blend-state-for-me
- S49 Epic particle performance: https://dev.epicgames.com/documentation/en-us/unreal-engine/getting-results?application_version=4.27
- S50 Bloom whitening: https://realtimevfx.com/t/vfx-graph-color-intensity-become-white-only/21679
- S57 Iché, VFXDoc: https://github.com/peeweek/VFXDoc
- S58 UnrealBloomPass: https://github.com/mrdoob/three.js/blob/dev/examples/jsm/postprocessing/UnrealBloomPass.js
- S59 WebGLState: https://github.com/mrdoob/three.js/blob/dev/src/renderers/webgl/WebGLState.js
- S60 packing chunk: https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/packing.glsl.js
- S61 dithering chunk: https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/dithering_pars_fragment.glsl.js
- S62 tone-mapping chunk: https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js
- S63 selective bloom: https://github.com/mrdoob/three.js/blob/dev/examples/webgl_postprocessing_unreal_bloom_selective.html
- S64 three.quarks: https://github.com/Alchemist0823/three.quarks
- S65 MeshLine: https://github.com/pmndrs/meshline
- S66 webgl-noise: https://github.com/stegu/webgl-noise
- S67 LYGIA: https://github.com/patriciogonzalezvivo/lygia
- S69 Lettier, game shaders: https://github.com/lettier/3d-game-shaders-for-beginners
- S75 r186 examples: https://github.com/mrdoob/three.js/tree/r186/examples
- S76 GPUComputationRenderer: https://github.com/mrdoob/three.js/blob/r186/examples/jsm/misc/GPUComputationRenderer.js
- S78 LuminosityHighPassShader: https://github.com/mrdoob/three.js/blob/dev/examples/jsm/shaders/LuminosityHighPassShader.js
- S80 three-nebula; drei Trail: https://github.com/creativelifeform/three-nebula · https://github.com/pmndrs/drei/blob/master/src/core/Trail.tsx
- S81 three.js manual; Heckel: https://github.com/mrdoob/three.js/tree/r186/manual · https://github.com/MaximeHeckel/blog.maximeheckel.com
- S82 Book of Shaders ch. 11–13: https://github.com/patriciogonzalezvivo/thebookofshaders/tree/master/11
- S83 pmndrs/postprocessing: https://github.com/pmndrs/postprocessing
- S84 Playwright, SwiftShader, pixelmatch, Spector.js: https://github.com/microsoft/playwright/blob/main/docs/src/clock.md · https://github.com/chromium/chromium/blob/main/docs/gpu/swiftshader.md · https://github.com/mapbox/pixelmatch · https://github.com/BabylonJS/Spector.js
- S85 Codrops, dissolve: https://tympanus.net/codrops/?p=86603
