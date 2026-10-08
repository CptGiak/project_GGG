import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Persona-style cel shading.
 *
 * Every toon material shares a set of global uniforms (light reference, shade/lit tints, rim
 * colour) so an arena can re-grade the whole cast with a handful of values. Lighting is a hard
 * two-tone split (lit / shade) driven by the single key light, with optional anime specular
 * highlight and a rim term. Hemisphere / ambient lights are ignored on purpose: the "shade" tint
 * plays the role of ambient, which keeps shadows saturated and hue-shifted instead of grey.
 */
/** Call whenever the key light colour/intensity changes so shadows are detected correctly. */
export function setKeyLight(light: THREE.DirectionalLight): void {
  const c = light.color;
  ToonEnv.lightRef.value = Math.hypot(c.r, c.g, c.b) * light.intensity;
}

export const ToonEnv = {
  lightRef: { value: 1.0 },
  shade: { value: new THREE.Color(0.55, 0.47, 0.76) },
  lit: { value: new THREE.Color(1.0, 0.97, 0.94) },
  rimColor: { value: new THREE.Color(1.0, 0.35, 0.45) },
  time: { value: 0 },
  resolution: { value: new THREE.Vector2(1920, 1080) },
  outlineScale: { value: 1.0 },
};

const TOON_LIGHTS = /* glsl */ `
varying vec3 vViewPosition;

struct ToonMaterial {
  vec3 diffuseColor;
};

uniform float uLightRef;
uniform vec3 uShade;
uniform vec3 uLit;
uniform vec3 uShadeMat;
uniform float uSpec;
uniform float uSpecSize;
uniform float uBandOffset;

float gToonLit = 0.0;

void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  float NdotL = dot( geometryNormal, directLight.direction );
  float sh = clamp( length( directLight.color ) / max( uLightRef, 1e-4 ), 0.0, 1.0 );
  float w = clamp( fwidth( NdotL ) * 1.2, 0.004, 0.08 );
  float lit = smoothstep( uBandOffset - w, uBandOffset + w, NdotL ) * smoothstep( 0.35, 0.65, sh );
  gToonLit = max( gToonLit, lit );
  vec3 tone = mix( uShade * uShadeMat, uLit, lit );
  vec3 col = material.diffuseColor * tone;
  if ( uSpec > 0.0 ) {
    vec3 H = normalize( directLight.direction + geometryViewDir );
    float NdotH = max( dot( geometryNormal, H ), 0.0 );
    float sw = max( fwidth( NdotH ), 0.002 );
    col += smoothstep( uSpecSize - sw, uSpecSize + sw, NdotH ) * lit * uSpec * uLit;
  }
  reflectedLight.directDiffuse += col;
}

void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
}

#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;

const TOON_RIM = /* glsl */ `
{
  float ndv = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  float rw = max( fwidth( ndv ), 0.002 );
  float rim = smoothstep( uRimCut - rw, uRimCut + rw, ndv ) * uRim;
  outgoingLight += uRimColor * rim * ( 1.0 - 0.65 * gToonLit ) * mix( vec3( 1.0 ), diffuseColor.rgb, 0.3 );
  if ( uHairBand > 0.0 ) {
    // anime "angel ring": a band at a fixed view-space latitude of the hair, smooth on top and
    // breaking into downward spikes underneath
    float tri = abs( fract( normal.x * 6.5 + 0.3 ) - 0.5 ) * 2.0;
    float tri2 = abs( fract( normal.x * 15.0 + 0.1 ) - 0.5 ) * 2.0;
    float lo = 0.4 - pow( tri, 3.0 ) * 0.1 - tri2 * 0.025;
    float bw = max( fwidth( normal.y ), 0.002 );
    float ring = smoothstep( lo - bw, lo + bw, normal.y ) * ( 1.0 - smoothstep( 0.47 - bw, 0.47 + bw, normal.y ) );
    ring *= smoothstep( 0.12, 0.38, normal.z );
    outgoingLight += mix( diffuseColor.rgb, vec3( 1.0 ), 0.55 ) * ring * uHairBand * ( 0.45 + 0.55 * gToonLit ) * uLit;
  }
}
#include <opaque_fragment>
`;

export interface ToonOptions {
  color: THREE.ColorRepresentation;
  /** Multiplies the global shade tint (e.g. warmer shadows on skin). */
  shade?: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  /** Anime specular highlight strength (0 = off). */
  spec?: number;
  /** NdotH threshold for the highlight, closer to 1 = smaller spot. */
  specSize?: number;
  /** Rim strength (0 = off). */
  rim?: number;
  rimCut?: number;
  /** Shifts the lit/shade terminator (positive = more shade). */
  band?: number;
  /** Anime hair "angel ring" highlight strength (0 = off). */
  hairBand?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
  map?: THREE.Texture | null;
  transparent?: boolean;
  opacity?: number;
}

export type ToonMaterial = THREE.MeshToonMaterial & {
  userData: { toon: { shadeMat: { value: THREE.Color }; rim: { value: number } } };
};

export function toon(opts: ToonOptions): ToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: opts.color,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    vertexColors: opts.vertexColors ?? false,
    map: opts.map ?? null,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  }) as ToonMaterial;

  const shadeMat = { value: new THREE.Color(opts.shade ?? 0xffffff) };
  const spec = { value: opts.spec ?? 0 };
  const specSize = { value: opts.specSize ?? 0.94 };
  const rim = { value: opts.rim ?? 0.45 };
  const rimCut = { value: opts.rimCut ?? 0.68 };
  const band = { value: opts.band ?? 0.0 };
  const hairBand = { value: opts.hairBand ?? 0.0 };
  mat.userData.toon = { shadeMat, rim };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLightRef = ToonEnv.lightRef;
    shader.uniforms.uShade = ToonEnv.shade;
    shader.uniforms.uLit = ToonEnv.lit;
    shader.uniforms.uRimColor = ToonEnv.rimColor;
    shader.uniforms.uShadeMat = shadeMat;
    shader.uniforms.uSpec = spec;
    shader.uniforms.uSpecSize = specSize;
    shader.uniforms.uRim = rim;
    shader.uniforms.uRimCut = rimCut;
    shader.uniforms.uBandOffset = band;
    shader.uniforms.uHairBand = hairBand;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_toon_pars_fragment>', TOON_LIGHTS)
      .replace('#include <opaque_fragment>', TOON_RIM)
      .replace('void main() {', 'uniform vec3 uRimColor;\nuniform float uRim;\nuniform float uRimCut;\nuniform float uHairBand;\nvoid main() {');
  };
  mat.customProgramCacheKey = () => 'ggg-toon-v2';
  return mat;
}

/**
 * Toon material whose colour blends from `color` to `colorB` along the `aT` vertex attribute
 * (0 at the root of a cloth chain, 1 at the tip) – gradient hair, scarves, ribbons.
 */
export function gradientToon(opts: ToonOptions & { colorB: THREE.ColorRepresentation; from?: number; to?: number }): ToonMaterial {
  const mat = toon(opts);
  const base = mat.onBeforeCompile;
  const colB = new THREE.Color(opts.colorB);
  const range = new THREE.Vector2(opts.from ?? 0.35, opts.to ?? 0.95);
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    shader.uniforms.uColorB = { value: colB };
    shader.uniforms.uGradRange = { value: range };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aT;\nvarying float vT;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvT = aT;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vT;\nuniform vec3 uColorB;\nuniform vec2 uGradRange;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, uColorB, smoothstep( uGradRange.x, uGradRange.y, vT ) );');
  };
  mat.customProgramCacheKey = () => 'ggg-toon-gradient-v2';
  return mat;
}

/** Pure emissive material (unlit) – values above 1 feed the bloom pass. */
export function neon(color: THREE.ColorRepresentation, intensity = 2.5, opts: { transparent?: boolean; opacity?: number; side?: THREE.Side; additive?: boolean } = {}): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  return new THREE.MeshBasicMaterial({
    color: c,
    transparent: opts.transparent ?? !!opts.additive,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !opts.additive,
    fog: true,
  });
}

// ---------------------------------------------------------------------------------------------
// Outlines (inverted hull, pushed in clip space so the line width is in pixels)
// ---------------------------------------------------------------------------------------------

const OUTLINE_VERT = /* glsl */ `
uniform float uWidth;
uniform float uRefDist;
uniform vec2 uResolution;
uniform float uOutlineScale;
attribute float aOutline;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  vec3 nView = normalize( normalMatrix * normal );
  vec4 clip = projectionMatrix * mvPosition;
  vec2 nc = ( projectionMatrix * vec4( nView, 0.0 ) ).xy;
  float l = length( nc );
  nc = l > 1e-5 ? nc / l : vec2( 0.0 );
  float dist = max( -mvPosition.z, 0.05 );
  float px = uWidth * aOutline * uOutlineScale * clamp( uRefDist / dist, 0.28, 1.25 ) * ( uResolution.y / 1080.0 );
  clip.xy += nc * px * 2.0 / uResolution * clip.w;
  // nudge back slightly so the hull never z-fights the surface it outlines
  clip.z += 0.00002 * clip.w;
  gl_Position = clip;
  #include <fog_vertex>
}
`;

const OUTLINE_FRAG = /* glsl */ `
uniform vec3 uColor;
#include <common>
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4( uColor, 1.0 );
  #include <fog_fragment>
}
`;

const outlineCache = new Map<string, THREE.ShaderMaterial>();

export function outlineMaterial(color: THREE.ColorRepresentation = 0x07040c, width = 2.2, refDist = 7): THREE.ShaderMaterial {
  const key = `${new THREE.Color(color).getHexString()}_${width}_${refDist}`;
  let m = outlineCache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uColor: { value: new THREE.Color(color) },
          uWidth: { value: width },
          uRefDist: { value: refDist },
        },
      ]),
      vertexShader: OUTLINE_VERT,
      fragmentShader: OUTLINE_FRAG,
      side: THREE.BackSide,
      fog: true,
    });
    // share resolution / scale globally
    m.uniforms.uResolution = ToonEnv.resolution;
    m.uniforms.uOutlineScale = ToonEnv.outlineScale;
    outlineCache.set(key, m);
  }
  return m;
}

const smoothCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** Geometry with only position + smooth (welded) normals, ideal for inverted-hull outlines. */
export function smoothNormalGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = smoothCache.get(geo);
  if (cached) return cached;
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position').clone());
  if (geo.index) g.setIndex(geo.index.clone());
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  g.setAttribute('aOutline', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(1), 1));
  smoothCache.set(geo, g);
  return g;
}

/** Adds an outline hull as a child of `mesh` (shares transforms). */
export function addOutline(mesh: THREE.Mesh, width = 2.2, color: THREE.ColorRepresentation = 0x07040c, refDist = 7): THREE.Mesh {
  const o = new THREE.Mesh(smoothNormalGeometry(mesh.geometry), outlineMaterial(color, width, refDist));
  o.name = `${mesh.name}_outline`;
  o.castShadow = false;
  o.receiveShadow = false;
  o.renderOrder = mesh.renderOrder;
  mesh.add(o);
  return o;
}

// ---------------------------------------------------------------------------------------------
// Hologram (True-Damage style weapon energy)
// ---------------------------------------------------------------------------------------------

const HOLO_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
varying vec2 vUv;
uniform float uTime;
uniform float uGlitch;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  // horizontal glitch slices
  float slice = floor( p.y * 18.0 + floor( uTime * 14.0 ) * 3.1 );
  float g = step( 0.93, fract( sin( slice * 91.7 + floor( uTime * 9.0 ) ) * 4375.5 ) ) * uGlitch;
  p.x += g * 0.04 * sin( uTime * 80.0 + slice );
  vLocal = position;
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );
  vN = normalize( normalMatrix * normal );
  vV = normalize( -mvPosition.xyz );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const HOLO_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
varying vec2 vUv;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uTime;
uniform float uIntensity;
uniform float uScan;
uniform float uAxis;
#include <common>
#include <fog_pars_fragment>
void main() {
  float fres = pow( 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) ), 1.6 );
  float along = uAxis > 0.5 ? vLocal.z : vLocal.y;
  float scan = 0.65 + 0.35 * step( 0.5, fract( along * uScan - uTime * 2.2 ) );
  float band = smoothstep( 0.0, 1.0, fract( along * 1.3 - uTime * 0.9 ) );
  vec3 col = mix( uColorA, uColorB, clamp( band * 0.7 + fres * 0.6, 0.0, 1.0 ) );
  float flicker = 0.9 + 0.1 * sin( uTime * 53.0 ) * sin( uTime * 17.0 );
  float a = clamp( ( 0.35 + fres * 0.9 ) * scan * flicker, 0.0, 1.0 );
  gl_FragColor = vec4( col * uIntensity * ( 0.6 + fres ), a );
  #include <fog_fragment>
}
`;

export function holoMaterial(colorA: THREE.ColorRepresentation, colorB: THREE.ColorRepresentation, opts: { intensity?: number; scan?: number; axisZ?: boolean; glitch?: number } = {}): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uColorA: { value: new THREE.Color(colorA) },
        uColorB: { value: new THREE.Color(colorB) },
        uIntensity: { value: opts.intensity ?? 2.2 },
        uScan: { value: opts.scan ?? 40 },
        uAxis: { value: opts.axisZ ? 1 : 0 },
        uGlitch: { value: opts.glitch ?? 1 },
      },
    ]),
    vertexShader: HOLO_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
  });
  m.uniforms.uTime = ToonEnv.time;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Equalizer panel – animated spectrum bars, used on weapons and arena screens
// ---------------------------------------------------------------------------------------------

const EQ_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uTime;
uniform float uBars;
uniform float uIntensity;
uniform float uEnergy;
#include <common>
#include <fog_pars_fragment>
float h11( float n ) { return fract( sin( n * 127.1 ) * 43758.5453 ); }
void main() {
  float idx = floor( vUv.x * uBars );
  float local = fract( vUv.x * uBars );
  float t = uTime * 2.4;
  float a = h11( idx + floor( t ) * 13.0 );
  float b = h11( idx + floor( t + 1.0 ) * 13.0 );
  float lvl = mix( a, b, smoothstep( 0.0, 1.0, fract( t ) ) );
  lvl = 0.18 + 0.82 * lvl * ( 0.55 + 0.45 * sin( idx * 0.7 + uTime * 6.0 ) ) * uEnergy;
  float bar = step( 0.18, local ) * step( local, 0.82 );
  float seg = step( 0.25, fract( vUv.y * 10.0 ) );
  float on = step( vUv.y, lvl ) * bar * seg;
  vec3 col = mix( uColorA, uColorB, vUv.y );
  if ( on < 0.5 ) discard;
  gl_FragColor = vec4( col * uIntensity, 1.0 );
  #include <fog_fragment>
}
`;

const SIMPLE_UV_VERT = /* glsl */ `
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

export function equalizerMaterial(colorA: THREE.ColorRepresentation, colorB: THREE.ColorRepresentation, bars = 16, intensity = 2.5): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uColorA: { value: new THREE.Color(colorA) },
        uColorB: { value: new THREE.Color(colorB) },
        uBars: { value: bars },
        uIntensity: { value: intensity },
        uEnergy: { value: 1 },
      },
    ]),
    vertexShader: SIMPLE_UV_VERT,
    fragmentShader: EQ_FRAG,
    side: THREE.DoubleSide,
    fog: true,
  });
  m.uniforms.uTime = ToonEnv.time;
  return m;
}

export const SimpleUvVert = SIMPLE_UV_VERT;
