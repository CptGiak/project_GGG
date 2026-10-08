import * as THREE from 'three';
import { toon, type ToonOptions, ToonEnv } from '../render/toon';

/**
 * Building material: cel-shaded facade with procedural lit windows on vertical faces
 * (world-space grid, axis-aligned buildings) – instant night city.
 */
export function windowMaterial(opts: ToonOptions & { winA: THREE.ColorRepresentation; winB: THREE.ColorRepresentation; winSize?: [number, number]; density?: number; intensity?: number; frame?: THREE.ColorRepresentation }): THREE.MeshToonMaterial {
  const mat = toon(opts);
  const base = mat.onBeforeCompile;
  const winA = new THREE.Color(opts.winA);
  const winB = new THREE.Color(opts.winB);
  const size = new THREE.Vector2(...(opts.winSize ?? [2.2, 3.4]));
  const density = opts.density ?? 0.42;
  const intensity = opts.intensity ?? 1.7;
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    shader.uniforms.uWinA = { value: winA };
    shader.uniforms.uWinB = { value: winB };
    shader.uniforms.uWinSize = { value: size };
    shader.uniforms.uWinDensity = { value: density };
    shader.uniforms.uWinIntensity = { value: intensity };
    shader.uniforms.uTime = ToonEnv.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNor;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvWNor = normalize( mat3( modelMatrix ) * objectNormal );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec3 vWNor;
uniform vec3 uWinA;
uniform vec3 uWinB;
uniform vec2 uWinSize;
uniform float uWinDensity;
uniform float uWinIntensity;
uniform float uTime;
float wHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 an = abs( vWNor );
  if ( an.y < 0.4 && vWPos.y > 1.2 ) {
    vec2 uv = an.x > an.z ? vWPos.zy : vWPos.xy;
    vec2 g = uv / uWinSize;
    vec2 cell = floor( g );
    vec2 f = fract( g );
    float win = step( 0.16, f.x ) * step( f.x, 0.84 ) * step( 0.22, f.y ) * step( f.y, 0.78 );
    float h = wHash( cell + floor( vWPos.x * 0.02 ) * 17.0 + floor( vWPos.z * 0.02 ) * 31.0 );
    float lit = step( 1.0 - uWinDensity, h );
    // a few windows flicker
    lit *= 1.0 - step( 0.985, h ) * step( 0.5, fract( uTime * 3.0 + h * 10.0 ) );
    vec3 wc = mix( uWinA, uWinB, step( 0.5, wHash( cell * 1.7 + 3.0 ) ) );
    float grad = 0.75 + 0.25 * f.y;
    totalEmissiveRadiance += wc * win * lit * uWinIntensity * grad;
    diffuseColor.rgb *= 1.0 - win * 0.45;
  }
}`);
  };
  mat.customProgramCacheKey = () => 'ggg-toon-windows-v1';
  return mat;
}

/** Ground with painted lines / tiles from world position (asphalt, crosswalks, stage floor). */
export function groundMaterial(opts: ToonOptions & { line: THREE.ColorRepresentation; pattern: 'crosswalk' | 'tiles' | 'stage' | 'water'; scale?: number; glow?: number }): THREE.MeshToonMaterial {
  const mat = toon(opts);
  const base = mat.onBeforeCompile;
  const line = new THREE.Color(opts.line);
  const pat = { crosswalk: 0, tiles: 1, stage: 2, water: 3 }[opts.pattern];
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    shader.uniforms.uLine = { value: line };
    shader.uniforms.uPat = { value: pat };
    shader.uniforms.uScale = { value: opts.scale ?? 1 };
    shader.uniforms.uGlow = { value: opts.glow ?? 0 };
    shader.uniforms.uTime = ToonEnv.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform vec3 uLine;
uniform float uPat;
uniform float uScale;
uniform float uGlow;
uniform float uTime;
float gHash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 p = vWPos.xz * uScale;
  float m = 0.0;
  if ( uPat < 0.5 ) {
    // Shibuya scramble: four zebra crossings + two diagonal ones + lane dashes
    float ax = abs( p.x );
    float ay = abs( p.y );
    float ns = step( 21.0, ay ) * step( ay, 28.0 ) * step( ax, 17.0 ) * step( 0.5, fract( p.x / 1.4 ) );
    float ew = step( 21.0, ax ) * step( ax, 28.0 ) * step( ay, 17.0 ) * step( 0.5, fract( p.y / 1.4 ) );
    float u = ( p.x + p.y ) * 0.70710678;
    float v = ( p.x - p.y ) * 0.70710678;
    float inBox = step( ax, 18.0 ) * step( ay, 18.0 );
    float d1 = step( abs( v ), 3.2 ) * step( 0.5, fract( u / 1.4 ) );
    float d2 = step( abs( u ), 3.2 ) * step( 0.5, fract( v / 1.4 ) );
    float center = step( abs( u ), 3.2 ) * step( abs( v ), 3.2 );
    float diag = max( d1, d2 ) * inBox * ( 1.0 - center );
    float dashX = step( 30.0, ax ) * step( ay, 0.2 ) * step( 0.5, fract( p.x / 6.0 ) );
    float dashY = step( 30.0, ay ) * step( ax, 0.2 ) * step( 0.5, fract( p.y / 6.0 ) );
    float stop = ( step( abs( ay - 29.5 ), 0.25 ) * step( ax, 17.0 ) ) + ( step( abs( ax - 29.5 ), 0.25 ) * step( ay, 17.0 ) );
    float edge = step( abs( ax - 9.2 ), 0.12 ) * step( 30.0, ay ) + step( abs( ay - 9.2 ), 0.12 ) * step( 30.0, ax );
    m = clamp( ns + ew + diag + dashX + dashY + stop + edge * 0.7, 0.0, 1.0 );
  } else if ( uPat < 1.5 ) {
    vec2 f = abs( fract( p / 4.0 ) - 0.5 );
    m = step( 0.47, max( f.x, f.y ) );
    diffuseColor.rgb *= 0.92 + 0.16 * gHash( floor( p / 4.0 ) );
  } else if ( uPat < 2.5 ) {
    // stage: concentric rings + radial spokes, glowing
    float r = length( p );
    float a = atan( p.y, p.x );
    float rings = step( 0.92, fract( r / 6.0 ) );
    float spokes = step( 0.97, fract( a / 6.2831853 * 24.0 ) ) * step( 10.0, r );
    m = clamp( rings + spokes, 0.0, 1.0 );
    totalEmissiveRadiance += uLine * m * uGlow * ( 0.7 + 0.3 * sin( uTime * 2.0 - r * 0.15 ) );
  } else {
    // water: moving caustic lines
    float w = sin( p.x * 0.35 + uTime * 0.8 ) * sin( p.y * 0.3 - uTime * 0.6 ) + sin( ( p.x + p.y ) * 0.21 + uTime );
    m = smoothstep( 1.1, 1.25, w );
    totalEmissiveRadiance += uLine * m * uGlow;
  }
  diffuseColor.rgb = mix( diffuseColor.rgb, uLine, m * ( uPat > 2.5 ? 0.0 : 0.78 ) );
}`);
  };
  mat.customProgramCacheKey = () => 'ggg-toon-ground-v1';
  return mat;
}

/** Sky dome: vertical gradient, stars, a huge moon (Persona 3 vibes) and a horizon glow. */
export function skyMaterial(opts: { top: THREE.ColorRepresentation; mid: THREE.ColorRepresentation; horizon: THREE.ColorRepresentation; moon?: THREE.ColorRepresentation; moonDir?: THREE.Vector3; moonSize?: number; stars?: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(opts.top) },
      uMid: { value: new THREE.Color(opts.mid) },
      uHorizon: { value: new THREE.Color(opts.horizon) },
      uMoon: { value: new THREE.Color(opts.moon ?? 0xffffff) },
      uMoonDir: { value: (opts.moonDir ?? new THREE.Vector3(0.3, 0.45, -0.85)).clone().normalize() },
      uMoonSize: { value: opts.moonSize ?? 0.12 },
      uStars: { value: opts.stars ?? 1 },
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
      uniform float uTime;
      float h3( vec3 p ) { return fract( sin( dot( p, vec3( 17.1, 113.7, 63.3 ) ) ) * 43758.5453 ); }
      void main() {
        vec3 d = normalize( vDir );
        float y = d.y;
        vec3 col = mix( uHorizon, uMid, smoothstep( -0.05, 0.25, y ) );
        col = mix( col, uTop, smoothstep( 0.25, 0.85, y ) );
        // stars
        vec3 sp = floor( d * 180.0 );
        float s = step( 0.9965, h3( sp ) ) * smoothstep( 0.05, 0.4, y );
        float tw = 0.6 + 0.4 * sin( uTime * 3.0 + h3( sp + 1.0 ) * 40.0 );
        col += vec3( s * tw * 1.4 ) * uStars;
        // moon with crisp toon edge + halo
        float md = acos( clamp( dot( d, uMoonDir ), -1.0, 1.0 ) );
        float disc = 1.0 - smoothstep( uMoonSize - 0.004, uMoonSize, md );
        float halo = exp( -max( md - uMoonSize, 0.0 ) * 9.0 ) * 0.55;
        // simple crater shading
        float cr = h3( floor( d * 60.0 ) );
        vec3 moonCol = uMoon * ( 1.0 - 0.12 * step( 0.7, cr ) );
        col = mix( col, moonCol * 1.6, disc );
        col += uMoon * halo * ( 1.0 - disc );
        gl_FragColor = vec4( col, 1.0 );
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}
