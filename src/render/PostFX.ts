import * as THREE from 'three';

/**
 * Persona-flavoured final grade: saturation/contrast, anime speed lines, vignette, damage
 * vignette, chromatic aberration, white flash and death desaturation.
 */
export const PersonaFXShader = {
  name: 'PersonaFX',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAspect: { value: 16 / 9 },
    uSpeed: { value: 0 },
    uDamage: { value: 0 },
    uDesat: { value: 0 },
    uFlash: { value: 0 },
    uChroma: { value: 0.0012 },
    uVignette: { value: 0.55 },
    uSat: { value: 1.12 },
    uContrast: { value: 1.06 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uLineColor: { value: new THREE.Color(1, 1, 1) },
    uHalftone: { value: 0 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAspect;
    uniform float uSpeed;
    uniform float uDamage;
    uniform float uDesat;
    uniform float uFlash;
    uniform float uChroma;
    uniform float uVignette;
    uniform float uSat;
    uniform float uContrast;
    uniform vec3 uTint;
    uniform vec3 uLineColor;
    uniform float uHalftone;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash( float n ) { return fract( sin( n * 12.9898 ) * 43758.5453 ); }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      c.x *= uAspect;
      float r = length( c );
      float ca = ( uChroma + uSpeed * 0.006 + uDamage * 0.01 ) * r * r * 4.0;
      vec2 dir = ( uv - 0.5 );
      vec3 col;
      col.r = texture2D( tDiffuse, uv + dir * ca ).r;
      col.g = texture2D( tDiffuse, uv ).g;
      col.b = texture2D( tDiffuse, uv - dir * ca ).b;

      // grade
      float l = dot( col, vec3( 0.299, 0.587, 0.114 ) );
      col = mix( vec3( l ), col, uSat );
      col = ( col - 0.5 ) * uContrast + 0.5;
      col *= uTint;
      col = mix( col, vec3( l * 0.9 ), uDesat );

      // halftone in the shadows (optional comic flavour)
      if ( uHalftone > 0.0 ) {
        vec2 px = uv * uResolution / 6.0;
        vec2 cell = fract( px ) - 0.5;
        float dotR = ( 1.0 - smoothstep( 0.0, 0.35, l ) ) * 0.45;
        float d = smoothstep( dotR, dotR - 0.08, length( cell ) );
        col = mix( col, col * 0.55, d * uHalftone );
      }

      // anime speed lines
      if ( uSpeed > 0.01 ) {
        float a = atan( c.y, c.x ) / 6.2831853 + 0.5;
        float n = 170.0;
        float cell = floor( a * n );
        float tick = floor( uTime * 16.0 );
        float h = hash( cell * 1.37 + tick * 3.1 );
        float on = step( 0.62, h );
        float start = 0.32 + 0.38 * hash( cell * 7.13 + tick );
        float grow = smoothstep( start, start + 0.3, r );
        float w = fract( a * n );
        float width = 0.12 + 0.4 * grow;
        float dd = abs( w - 0.5 );
        float lineMask = on * ( 1.0 - smoothstep( width * 0.5 - 0.08, width * 0.5, dd ) ) * grow;
        col = mix( col, uLineColor, lineMask * clamp( uSpeed, 0.0, 1.0 ) * 0.6 );
      }

      // vignette
      col *= mix( 1.0, smoothstep( 1.05, 0.3, r ), uVignette );
      // damage vignette
      col = mix( col, vec3( 0.95, 0.04, 0.12 ), uDamage * smoothstep( 0.25, 0.95, r ) * 0.75 );
      // flash
      col = mix( col, vec3( 1.0 ), uFlash );
      gl_FragColor = vec4( col, 1.0 );
    }
  `,
};
