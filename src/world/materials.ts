import * as THREE from 'three';
import { toon, type ToonOptions, ToonEnv, type ToonMaterial } from '../render/toon';

/**
 * Arena materials. Comfort rules shared by all of them:
 *  - painted / procedural patterns are box-filtered (fwidth), so stripes and grids never shimmer or
 *    turn into moiré while the camera swings;
 *  - per-window lights fade to their average once a window is smaller than a couple of pixels, so
 *    distant facades don't sparkle;
 *  - nothing flickers; animated glows move slowly.
 */

/** GLSL helpers: anti-aliased steps and box-filtered stripe trains. */
const AA_GLSL = /* glsl */ `
float aaStep( float e, float x ) {
  float w = max( fwidth( x ), 1e-5 ) * 0.75;
  return smoothstep( e - w, e + w, x );
}
float aaBand( float x, float a, float b ) { return aaStep( a, x ) * ( 1.0 - aaStep( b, x ) ); }
float pulseInt( float x, float d ) { return floor( x ) * d + clamp( fract( x ), 0.0, d ); }
// share of [x - w/2, x + w/2] covered by the pulses [k, k + d)
float stripesW( float x, float d, float w ) {
  w = max( w, 1e-5 );
  return clamp( ( pulseInt( x + 0.5 * w, d ) - pulseInt( x - 0.5 * w, d ) ) / w, 0.0, 1.0 );
}
float stripes( float x, float d ) { return stripesW( x, d, fwidth( x ) ); }
float gHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
`;

const WORLD_VARYINGS_VERT = /* glsl */ `#include <common>
varying vec3 vWPos;
varying vec3 vWNor;`;

const WORLD_VARYINGS_ASSIGN = /* glsl */ `#include <worldpos_vertex>
vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vWNor = normalize( mat3( modelMatrix ) * objectNormal );`;

// ---------------------------------------------------------------------------------------------
// Facades
// ---------------------------------------------------------------------------------------------

export interface FacadeOptions extends ToonOptions {
  /** facade tile from Blender: albedo in RGB, glow mask in A */
  map: THREE.Texture;
  /** windows per texture tile (columns, floors): one random light state per window */
  cells: [number, number];
  /** 'windows': masked glass lights up at random (offices, homes); 'selflit': the masked texels glow
   *  with their own colour (shop fronts, signboards) */
  mode?: 'windows' | 'selflit';
  winA?: THREE.ColorRepresentation;
  winB?: THREE.ColorRepresentation;
  /** share of lit windows */
  density?: number;
  intensity?: number;
}

/**
 * Cel-shaded facade textured with a Blender tile. UVs count tiles (see ArenaBuilder.tiledBox), so
 * every window has an integer cell id for its random light state.
 */
export function facadeMaterial(opts: FacadeOptions): ToonMaterial {
  const mat = toon(opts);
  const base = mat.onBeforeCompile;
  const uniforms = {
    uCells: { value: new THREE.Vector2(...opts.cells) },
    uWinA: { value: new THREE.Color(opts.winA ?? 0xffd9a0) },
    uWinB: { value: new THREE.Color(opts.winB ?? 0xfff3e0) },
    uDensity: { value: opts.density ?? 0.3 },
    uIntensity: { value: opts.intensity ?? 1.0 },
  };
  const selfLit = opts.mode === 'selflit';
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec2 uCells;
uniform vec3 uWinA;
uniform vec3 uWinB;
uniform float uDensity;
uniform float uIntensity;
${AA_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 fTex = texture2D( map, vMapUv );
diffuseColor.rgb *= fTex.rgb;
float fGlow = fTex.a;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec2 cuv = vMapUv * uCells;
  vec2 cell = floor( cuv );
  float h = gHash( cell );
  float h2 = gHash( cell + 17.31 );
  vec2 fw = fwidth( cuv );
  float far = smoothstep( 0.2, 0.65, max( fw.x, fw.y ) );
  ${
    selfLit
      ? `float on = mix( 0.75 + 0.25 * h2, 0.85, far ) * step( 0.1, mix( h, 1.0, far ) );
  totalEmissiveRadiance += fTex.rgb * fGlow * on * uIntensity;`
      : `float lit = step( 1.0 - uDensity, h );
  // ceiling lights: a lit window is brighter towards its top
  vec3 wc = mix( uWinA, uWinB, step( 0.8, h2 ) ) * ( 0.55 + 0.45 * fract( h2 * 7.13 ) ) * ( 0.7 + 0.45 * fract( cuv.y ) );
  vec3 avg = mix( uWinA, uWinB, 0.35 ) * 0.78 * uDensity;
  totalEmissiveRadiance += mix( wc * lit, avg, far ) * fGlow * uIntensity;
  diffuseColor.rgb *= 1.0 - 0.4 * fGlow * lit * ( 1.0 - far );`
  }
}`,
      );
  };
  mat.customProgramCacheKey = () => `ggg-toon-facade-${selfLit ? 's' : 'w'}-v1`;
  return mat;
}

// ---------------------------------------------------------------------------------------------
// World-mapped surfaces (floors, curbs, stands, rock)
// ---------------------------------------------------------------------------------------------

export interface WorldMaterialOptions extends ToonOptions {
  /** texture on faces looking up, mapped on world XZ, one tile every `topScale` metres */
  topTex?: THREE.Texture;
  topScale?: number;
  /** texture on the sides (world XY / ZY) */
  sideTex?: THREE.Texture;
  sideScale?: number;
  /** tint of the sides relative to `color` */
  sideTint?: THREE.ColorRepresentation;
}

/** Toon material sampling textures in world space by face orientation: no UVs needed. */
export function worldMaterial(opts: WorldMaterialOptions): ToonMaterial {
  const mat = toon(opts);
  const base = mat.onBeforeCompile;
  const uniforms = {
    uTop: { value: opts.topTex ?? null },
    uTopScale: { value: opts.topScale ?? 4 },
    uSide: { value: opts.sideTex ?? null },
    uSideScale: { value: opts.sideScale ?? 4 },
    uSideTint: { value: new THREE.Color(opts.sideTint ?? 0xffffff) },
  };
  const defs = `${opts.topTex ? '#define W_TOP\n' : ''}${opts.sideTex ? '#define W_SIDE\n' : ''}`;
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', WORLD_VARYINGS_VERT).replace('#include <worldpos_vertex>', WORLD_VARYINGS_ASSIGN);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${defs}
varying vec3 vWPos;
varying vec3 vWNor;
uniform sampler2D uTop;
uniform float uTopScale;
uniform sampler2D uSide;
uniform float uSideScale;
uniform vec3 uSideTint;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 an = abs( vWNor );
  if ( an.y > 0.6 ) {
    #ifdef W_TOP
    diffuseColor.rgb *= texture2D( uTop, vWPos.xz / uTopScale ).rgb;
    #endif
  } else {
    diffuseColor.rgb *= uSideTint;
    #ifdef W_SIDE
    vec2 suv = ( an.x > an.z ? vWPos.zy : vWPos.xy ) / uSideScale;
    diffuseColor.rgb *= texture2D( uSide, suv ).rgb;
    #endif
  }
}`,
      );
  };
  mat.customProgramCacheKey = () => `ggg-toon-world-${opts.topTex ? 1 : 0}${opts.sideTex ? 1 : 0}-v1`;
  return mat;
}

// ---------------------------------------------------------------------------------------------
// Ground with painted patterns
// ---------------------------------------------------------------------------------------------

/** Ground with painted lines / tiles from world position (asphalt, crosswalks, stage floor). */
export function groundMaterial(opts: ToonOptions & { line: THREE.ColorRepresentation; pattern: 'crosswalk' | 'tiles' | 'stage' | 'water'; scale?: number; glow?: number; tex?: THREE.Texture; texScale?: number; paint?: number }): ToonMaterial {
  const mat = toon(opts);
  const base = mat.onBeforeCompile;
  const line = new THREE.Color(opts.line);
  const pat = { crosswalk: 0, tiles: 1, stage: 2, water: 3 }[opts.pattern];
  const uniforms = {
    uLine: { value: line },
    uPat: { value: pat },
    uScale: { value: opts.scale ?? 1 },
    uGlow: { value: opts.glow ?? 0 },
    uPaint: { value: opts.paint ?? 0.78 },
    uTex: { value: opts.tex ?? null },
    uTexScale: { value: opts.texScale ?? 8 },
    uTime: ToonEnv.time,
  };
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', WORLD_VARYINGS_VERT).replace('#include <worldpos_vertex>', WORLD_VARYINGS_ASSIGN);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${opts.tex ? '#define G_TEX' : ''}
varying vec3 vWPos;
varying vec3 vWNor;
uniform vec3 uLine;
uniform float uPat;
uniform float uScale;
uniform float uGlow;
uniform float uPaint;
uniform float uTime;
uniform sampler2D uTex;
uniform float uTexScale;
${AA_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 p = vWPos.xz * uScale;
  float texL = 1.0;
  #ifdef G_TEX
  vec3 gt = texture2D( uTex, vWPos.xz / uTexScale ).rgb;
  diffuseColor.rgb *= gt;
  texL = clamp( dot( gt, vec3( 0.3, 0.59, 0.11 ) ) * 3.0, 0.6, 1.2 );
  #endif
  float m = 0.0;
  if ( uPat < 0.5 ) {
    // Shibuya scramble: four zebra crossings + two diagonal ones + lane dashes
    float ax = abs( p.x );
    float ay = abs( p.y );
    float ns = aaBand( ay, 21.0, 28.0 ) * ( 1.0 - aaStep( 17.0, ax ) ) * stripes( p.x / 1.4 - 0.5, 0.5 );
    float ew = aaBand( ax, 21.0, 28.0 ) * ( 1.0 - aaStep( 17.0, ay ) ) * stripes( p.y / 1.4 - 0.5, 0.5 );
    float u = ( p.x + p.y ) * 0.70710678;
    float v = ( p.x - p.y ) * 0.70710678;
    float inBox = ( 1.0 - aaStep( 18.0, ax ) ) * ( 1.0 - aaStep( 18.0, ay ) );
    float d1 = ( 1.0 - aaStep( 3.2, abs( v ) ) ) * stripes( u / 1.4 - 0.5, 0.5 );
    float d2 = ( 1.0 - aaStep( 3.2, abs( u ) ) ) * stripes( v / 1.4 - 0.5, 0.5 );
    float center = ( 1.0 - aaStep( 3.2, abs( u ) ) ) * ( 1.0 - aaStep( 3.2, abs( v ) ) );
    float diag = max( d1, d2 ) * inBox * ( 1.0 - center );
    float dashX = aaStep( 30.0, ax ) * ( 1.0 - aaStep( 0.2, ay ) ) * stripes( p.x / 6.0 - 0.5, 0.5 );
    float dashY = aaStep( 30.0, ay ) * ( 1.0 - aaStep( 0.2, ax ) ) * stripes( p.y / 6.0 - 0.5, 0.5 );
    float stop = ( 1.0 - aaStep( 0.25, abs( ay - 29.5 ) ) ) * ( 1.0 - aaStep( 17.0, ax ) ) + ( 1.0 - aaStep( 0.25, abs( ax - 29.5 ) ) ) * ( 1.0 - aaStep( 17.0, ay ) );
    float edge = ( 1.0 - aaStep( 0.12, abs( ax - 9.2 ) ) ) * aaStep( 30.0, ay ) + ( 1.0 - aaStep( 0.12, abs( ay - 9.2 ) ) ) * aaStep( 30.0, ax );
    m = clamp( ns + ew + diag + dashX + dashY + stop + edge * 0.7, 0.0, 1.0 );
    m *= texL;
  } else if ( uPat < 1.5 ) {
    vec2 q = p / 4.0 + 0.03;
    m = max( stripes( q.x, 0.06 ), stripes( q.y, 0.06 ) );
    float far = smoothstep( 0.1, 0.4, max( fwidth( q.x ), fwidth( q.y ) ) );
    diffuseColor.rgb *= mix( 0.92 + 0.16 * gHash( floor( p / 4.0 ) ), 1.0, far );
  } else if ( uPat < 2.5 ) {
    // stage: concentric rings + radial spokes
    float r = length( p );
    float a = atan( p.y, p.x ) / 6.2831853 * 24.0;
    float wa = length( fwidth( p ) ) / max( r, 1e-3 ) * 24.0 / 6.2831853;
    float rings = stripes( r / 6.0 - 0.92, 0.08 );
    float spokes = stripesW( a - 0.97, 0.03, wa ) * aaStep( 10.0, r );
    m = clamp( rings + spokes, 0.0, 1.0 );
    totalEmissiveRadiance += uLine * m * uGlow * ( 0.85 + 0.15 * sin( uTime * 0.8 - r * 0.08 ) );
  } else {
    // water: slow ripple lines
    float w = sin( p.x * 0.35 + uTime * 0.35 ) * sin( p.y * 0.3 - uTime * 0.25 ) + sin( ( p.x + p.y ) * 0.21 + uTime * 0.4 );
    float fw = max( fwidth( w ), 1e-4 );
    m = smoothstep( 1.18 - fw, 1.18 + fw, w ) * ( 1.0 - smoothstep( 1.26 - fw, 1.26 + fw, w ) );
    m *= 1.0 - smoothstep( 0.15, 0.6, fw );
    totalEmissiveRadiance += uLine * m * uGlow;
  }
  diffuseColor.rgb = mix( diffuseColor.rgb, uLine, m * ( uPat > 2.5 ? 0.0 : uPaint ) );
}`,
      );
  };
  mat.customProgramCacheKey = () => `ggg-toon-ground-${opts.tex ? 't' : 'n'}-v2`;
  return mat;
}

// ---------------------------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------------------------

/** Sky dome: vertical gradient, stars, a big moon with a soft halo and a horizon glow. */
export function skyMaterial(opts: { top: THREE.ColorRepresentation; mid: THREE.ColorRepresentation; horizon: THREE.ColorRepresentation; moon?: THREE.ColorRepresentation; moonDir?: THREE.Vector3; moonSize?: number; stars?: number; halo?: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(opts.top) },
      uMid: { value: new THREE.Color(opts.mid) },
      uHorizon: { value: new THREE.Color(opts.horizon) },
      uMoon: { value: new THREE.Color(opts.moon ?? 0xffffff) },
      uMoonDir: { value: (opts.moonDir ?? new THREE.Vector3(0.3, 0.45, -0.85)).clone().normalize() },
      uMoonSize: { value: opts.moonSize ?? 0.12 },
      uStars: { value: opts.stars ?? 1 },
      uHalo: { value: opts.halo ?? 0.55 },
      uTime: ToonEnv.time,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize( position );
        vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      uniform vec3 uMoon;
      uniform vec3 uMoonDir;
      uniform float uMoonSize;
      uniform float uStars;
      uniform float uHalo;
      uniform float uTime;
      float h3( vec3 p ) { return fract( sin( dot( p, vec3( 17.1, 113.7, 63.3 ) ) ) * 43758.5453 ); }
      void main() {
        vec3 d = normalize( vDir );
        float y = d.y;
        vec3 col = mix( uHorizon, uMid, smoothstep( -0.05, 0.25, y ) );
        col = mix( col, uTop, smoothstep( 0.25, 0.85, y ) );
        // stars (slow, gentle twinkle)
        vec3 sp = floor( d * 180.0 );
        float s = step( 0.9965, h3( sp ) ) * smoothstep( 0.05, 0.4, y );
        float tw = 0.75 + 0.25 * sin( uTime * 0.9 + h3( sp + 1.0 ) * 40.0 );
        col += vec3( s * tw * 0.9 ) * uStars;
        // moon with crisp toon edge + halo
        float md = acos( clamp( dot( d, uMoonDir ), -1.0, 1.0 ) );
        float disc = 1.0 - smoothstep( uMoonSize - 0.004, uMoonSize, md );
        float halo = exp( -max( md - uMoonSize, 0.0 ) * 9.0 ) * uHalo;
        float cr = h3( floor( d * 60.0 ) );
        vec3 moonCol = uMoon * ( 1.0 - 0.12 * step( 0.7, cr ) );
        col = mix( col, moonCol * 1.15, disc );
        col += uMoon * halo * ( 1.0 - disc );
        gl_FragColor = vec4( col, 1.0 );
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}
