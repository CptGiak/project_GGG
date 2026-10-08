import * as THREE from 'three';
import { ParticlePool, Shape } from './Particles';
import type { Fighter } from '../game/Fighter';

const _v = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
function randDir(out: THREE.Vector3): THREE.Vector3 {
  const u = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(t), u, s * Math.sin(t));
}

const RING_VERT = /* glsl */ `
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
const RING_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uThick;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length( p );
  float inner = 1.0 - uThick;
  float a = smoothstep( inner - 0.02, inner + 0.05, r ) * ( 1.0 - smoothstep( 0.95, 1.0, r ) );
  float hot = smoothstep( 0.9, 0.97, r ) * ( 1.0 - smoothstep( 0.97, 1.0, r ) );
  vec3 col = mix( uColor, vec3( 1.0 ), hot * 0.6 );
  a *= uAlpha;
  if ( a < 0.01 ) discard;
  gl_FragColor = vec4( col * a * 2.0, a );
  #include <fog_fragment>
}
`;

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  t: number;
  life: number;
  r0: number;
  r1: number;
  active: boolean;
}

interface Beam {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  life: number;
  width: number;
  active: boolean;
}

/** All transient visual effects: particles, shockwave rings, beams. */
export class Effects {
  readonly add = new ParticlePool(2400, true);
  readonly alpha = new ParticlePool(1400, false);
  readonly group = new THREE.Group();
  private rings: Ring[] = [];
  private beams: Beam[] = [];

  constructor() {
    this.group.add(this.add.mesh, this.alpha.mesh);
    const ringGeo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, uThick: { value: 0.2 } }]),
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: true,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 12;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, t: 0, life: 1, r0: 0, r1: 1, active: false });
    }
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    beamGeo.translate(0, 0.5, 0);
    beamGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 11;
      this.group.add(mesh);
      this.beams.push({ mesh, mat, t: 0, life: 1, width: 0.1, active: false });
    }
  }

  update(dt: number): void {
    this.add.update(dt);
    this.alpha.update(dt);
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      const s = r.r0 + (r.r1 - r.r0) * e;
      r.mesh.scale.set(s, s, s);
      r.mat.uniforms.uAlpha.value = 1 - k;
      r.mat.uniforms.uThick.value = 0.25 * (1 - k) + 0.04;
    }
    for (const b of this.beams) {
      if (!b.active) continue;
      b.t += dt;
      const k = b.t / b.life;
      if (k >= 1) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      const w = b.width * (1 - k * k);
      b.mesh.scale.x = w;
      b.mesh.scale.y = w;
      b.mat.opacity = 1 - k;
    }
  }

  clear(): void {
    this.add.clear();
    this.alpha.clear();
    for (const r of this.rings) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const b of this.beams) {
      b.active = false;
      b.mesh.visible = false;
    }
  }

  // -------------------------------------------------------------------------------------------
  // primitives
  // -------------------------------------------------------------------------------------------

  ring(pos: THREE.Vector3, normal: THREE.Vector3, color: THREE.ColorRepresentation, r0: number, r1: number, life: number): void {
    const r = this.rings.find((x) => !x.active) ?? this.rings[0];
    r.active = true;
    r.t = 0;
    r.life = life;
    r.r0 = r0;
    r.r1 = r1;
    r.mesh.visible = true;
    r.mesh.position.copy(pos);
    r.mesh.quaternion.setFromUnitVectors(_u.set(0, 0, 1), _v.copy(normal).normalize());
    r.mesh.scale.setScalar(r0);
    r.mat.uniforms.uColor.value.set(color);
  }

  beam(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation, width: number, life: number): void {
    const b = this.beams.find((x) => !x.active) ?? this.beams[0];
    b.active = true;
    b.t = 0;
    b.life = life;
    b.width = width;
    b.mesh.visible = true;
    b.mesh.position.copy(from);
    b.mesh.lookAt(to);
    b.mesh.scale.set(width, width, from.distanceTo(to));
    b.mat.color.set(color).multiplyScalar(2.5);
  }

  // -------------------------------------------------------------------------------------------
  // gameplay effects
  // -------------------------------------------------------------------------------------------

  gasPuff(pos: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation): void {
    for (let i = 0; i < 5; i++) {
      randDir(_v).multiplyScalar(1.2).addScaledVector(dir, rnd(2, 4));
      this.alpha.emit({ pos: _w.copy(pos).addScaledVector(randDir(_u), 0.15), vel: _v.clone(), life: rnd(0.35, 0.6), size: rnd(0.15, 0.25), size1: rnd(0.5, 0.8), color: 0xf4f0f8, shape: Shape.puff, drag: 4 });
    }
    this.add.emit({ pos, life: 0.25, size: 0.5, size1: 1.0, color, shape: Shape.glow, alpha: 0.7 });
  }

  gasBurst(pos: THREE.Vector3, color: THREE.ColorRepresentation): void {
    for (let i = 0; i < 10; i++) {
      randDir(_v).multiplyScalar(rnd(1.5, 4));
      _v.y -= 1.5;
      this.alpha.emit({ pos: _w.copy(pos).addScaledVector(randDir(_u), 0.2), vel: _v.clone(), life: rnd(0.4, 0.7), size: rnd(0.15, 0.3), size1: rnd(0.6, 1.0), color: 0xf6f2fa, shape: Shape.puff, drag: 3.5 });
    }
    for (let i = 0; i < 6; i++) {
      this.add.emit({ pos, vel: randDir(_v).multiplyScalar(rnd(4, 9)).clone(), life: rnd(0.15, 0.3), size: 0.12, color, shape: Shape.streak, drag: 6, stretch: 2 });
    }
    this.add.emit({ pos, life: 0.2, size: 0.6, size1: 1.4, color, shape: Shape.glow, alpha: 0.8 });
  }

  /** continuous gas jet while boosting (call every frame) */
  gasTrail(pos: THREE.Vector3, vel: THREE.Vector3, color: THREE.ColorRepresentation, dt: number): void {
    const n = Math.ceil(dt * 36);
    for (let i = 0; i < n; i++) {
      _v.copy(vel).multiplyScalar(-0.1).add(randDir(_u).multiplyScalar(1.0));
      _w.copy(pos).addScaledVector(vel, -dt * Math.random());
      this.alpha.emit({ pos: _w.clone(), vel: _v.clone(), life: rnd(0.25, 0.45), size: rnd(0.06, 0.1), size1: rnd(0.25, 0.4), color: 0xf2eef8, shape: Shape.puff, drag: 2.5, alpha: 0.85 });
    }
    if (Math.random() < 0.6) this.add.emit({ pos: pos.clone(), vel: _v.copy(vel).multiplyScalar(-0.05).clone(), life: 0.25, size: 0.2, size1: 0.05, color, shape: Shape.glow, alpha: 0.9 });
  }

  /** wind streaks around a fast-moving fighter */
  speedStreaks(pos: THREE.Vector3, vel: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number): void {
    if (Math.random() > intensity) return;
    randDir(_u).multiplyScalar(rnd(0.8, 2.2));
    _w.copy(pos).add(_u);
    _w.y += 1;
    this.add.emit({ pos: _w.clone(), vel: _v.copy(vel).multiplyScalar(0.92).clone(), life: rnd(0.12, 0.22), size: 0.05, color: Math.random() < 0.3 ? color : 0xffffff, shape: Shape.streak, stretch: 3, alpha: 0.55 });
  }

  hookImpact(pos: THREE.Vector3, normal: THREE.Vector3, color: THREE.ColorRepresentation): void {
    for (let i = 0; i < 12; i++) {
      randDir(_v).add(_u.copy(normal).multiplyScalar(1.2)).normalize().multiplyScalar(rnd(4, 11));
      this.add.emit({ pos, vel: _v.clone(), life: rnd(0.15, 0.35), size: 0.09, color: i % 3 === 0 ? color : 0xffe9b0, shape: Shape.streak, gravity: 14, drag: 2, stretch: 2 });
    }
    for (let i = 0; i < 4; i++) {
      this.alpha.emit({ pos: _w.copy(pos).addScaledVector(normal, 0.2), vel: _v.copy(normal).multiplyScalar(rnd(0.5, 1.5)).add(randDir(_u).multiplyScalar(0.6)).clone(), life: rnd(0.5, 0.8), size: 0.2, size1: 0.7, color: 0x8a7f88, shape: Shape.puff, drag: 2 });
    }
    this.add.emit({ pos, life: 0.18, size: 0.3, size1: 1.2, color, shape: Shape.star });
    this.ring(_w.copy(pos).addScaledVector(normal, 0.05), normal, color, 0.2, 1.4, 0.3);
  }

  landing(pos: THREE.Vector3, color: THREE.ColorRepresentation, strength: number): void {
    const n = Math.floor(8 + strength * 14);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      _v.set(Math.cos(a), 0.15, Math.sin(a)).multiplyScalar(rnd(3, 7) * (0.5 + strength));
      this.alpha.emit({ pos: _w.copy(pos).setY(pos.y + 0.15), vel: _v.clone(), life: rnd(0.4, 0.7), size: 0.25, size1: 0.8, color: 0x9a8a96, shape: Shape.puff, drag: 4 });
    }
    this.ring(_w.copy(pos).setY(pos.y + 0.06), _u.set(0, 1, 0), color, 0.3, 2.5 + strength * 3, 0.45);
  }

  dashLines(f: Fighter, dir: THREE.Vector3): void {
    const c = f.champ.colors[0];
    for (let i = 0; i < 10; i++) {
      _w.copy(f.pos).add(randDir(_u).multiplyScalar(0.5));
      _w.y += rnd(0.3, 1.7);
      this.add.emit({ pos: _w.clone(), vel: _v.copy(dir).multiplyScalar(-rnd(8, 16)).clone(), life: rnd(0.12, 0.25), size: 0.07, color: i % 2 ? c : 0xffffff, shape: Shape.streak, stretch: 3, drag: 5 });
    }
  }

  /** Persona-style impact: star flash, streaks, shards */
  hitSpark(pos: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation, big = false): void {
    const k = big ? 1.6 : 1;
    this.add.emit({ pos, life: 0.12 * k, size: 0.4 * k, size1: 1.4 * k, color: 0xffffff, shape: Shape.star, rot: Math.random() * 3 });
    this.add.emit({ pos, life: 0.2 * k, size: 0.6 * k, size1: 1.8 * k, color, shape: Shape.glow, alpha: 0.9 });
    const n = big ? 18 : 10;
    for (let i = 0; i < n; i++) {
      randDir(_v).addScaledVector(dir, 0.8).normalize().multiplyScalar(rnd(6, 16) * k);
      this.add.emit({ pos, vel: _v.clone(), life: rnd(0.12, 0.28), size: 0.08 * k, color: i % 2 ? color : 0xfff3c8, shape: Shape.streak, drag: 5, stretch: 2.5 });
    }
    for (let i = 0; i < (big ? 8 : 4); i++) {
      randDir(_v).multiplyScalar(rnd(3, 7));
      this.alpha.emit({ pos, vel: _v.clone(), life: rnd(0.3, 0.6), size: 0.12 * k, color: i % 2 ? 0x0a0408 : color, shape: Shape.shard, gravity: 12, spin: rnd(-12, 12) });
    }
    if (big) this.ring(pos, dir, color, 0.2, 2.2, 0.25);
  }

  blockSpark(pos: THREE.Vector3, normal: THREE.Vector3): void {
    for (let i = 0; i < 14; i++) {
      randDir(_v).addScaledVector(normal, 1.2).normalize().multiplyScalar(rnd(5, 12));
      this.add.emit({ pos, vel: _v.clone(), life: rnd(0.15, 0.3), size: 0.07, color: 0x9fe8ff, shape: Shape.streak, gravity: 10, stretch: 2 });
    }
    this.ring(pos, normal, 0x9fe8ff, 0.2, 1.1, 0.2);
  }

  shockwave(pos: THREE.Vector3, radius: number, color: THREE.ColorRepresentation): void {
    this.ring(_w.copy(pos).setY(pos.y + 0.1), _u.set(0, 1, 0), color, 0.5, radius, 0.5);
    this.ring(_w.copy(pos).setY(pos.y + 0.12), _u.set(0, 1, 0), 0xffffff, 0.3, radius * 0.7, 0.35);
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      _v.set(Math.cos(a), rnd(0.2, 0.8), Math.sin(a)).multiplyScalar(rnd(8, 16));
      this.alpha.emit({ pos: _w.copy(pos).setY(pos.y + 0.2), vel: _v.clone(), life: rnd(0.5, 0.9), size: 0.3, size1: 1.1, color: 0x7d6c78, shape: Shape.puff, drag: 3.5 });
      this.add.emit({ pos: _w.clone(), vel: _v.clone().multiplyScalar(1.4), life: rnd(0.2, 0.4), size: 0.12, color, shape: Shape.streak, drag: 3, stretch: 2 });
    }
    for (let i = 0; i < 14; i++) {
      randDir(_v);
      _v.y = Math.abs(_v.y) + 0.6;
      _v.multiplyScalar(rnd(6, 14));
      this.alpha.emit({ pos: _w.copy(pos).setY(pos.y + 0.3), vel: _v.clone(), life: rnd(0.6, 1.1), size: 0.18, color: 0x2b2228, shape: Shape.shard, gravity: 20, spin: rnd(-10, 10) });
    }
  }

  muzzle(pos: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation): void {
    this.add.emit({ pos, life: 0.07, size: 0.25, size1: 0.6, color: 0xffffff, shape: Shape.star });
    this.add.emit({ pos, life: 0.12, size: 0.3, size1: 0.8, color, shape: Shape.glow });
    this.ring(_w.copy(pos).addScaledVector(dir, 0.15), dir, color, 0.08, 0.6, 0.18);
    for (let i = 0; i < 4; i++) {
      _v.copy(dir).multiplyScalar(rnd(6, 12)).add(randDir(_u).multiplyScalar(2));
      this.add.emit({ pos, vel: _v.clone(), life: rnd(0.06, 0.14), size: 0.05, color, shape: Shape.streak, stretch: 2 });
    }
  }

  explosion(pos: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, color2: THREE.ColorRepresentation): void {
    this.add.emit({ pos, life: 0.2, size: radius * 0.4, size1: radius * 1.3, color: 0xffffff, shape: Shape.glow });
    this.add.emit({ pos, life: 0.35, size: radius * 0.6, size1: radius * 1.6, color, shape: Shape.glow, alpha: 0.8 });
    this.ring(pos, _u.set(0, 1, 0), color, 0.4, radius * 1.2, 0.4);
    this.ring(pos, randDir(_u), color2, 0.4, radius, 0.35);
    for (let i = 0; i < 24; i++) {
      randDir(_v).multiplyScalar(rnd(5, 15));
      this.add.emit({ pos, vel: _v.clone(), life: rnd(0.2, 0.45), size: 0.1, color: i % 2 ? color : color2, shape: Shape.streak, drag: 3, stretch: 2 });
    }
    for (let i = 0; i < 12; i++) {
      randDir(_v).multiplyScalar(rnd(2, 6));
      this.alpha.emit({ pos, vel: _v.clone(), life: rnd(0.6, 1.0), size: radius * 0.15, size1: radius * 0.5, color: 0x3a2a36, shape: Shape.puff, drag: 2.5 });
    }
  }

  /** Persona "shadow dissolve" on death: black/red shards + champion-colored sparks */
  deathBurst(pos: THREE.Vector3, colorA: THREE.ColorRepresentation, colorB: THREE.ColorRepresentation): void {
    const center = _w.copy(pos).setY(pos.y + 1);
    for (let i = 0; i < 40; i++) {
      randDir(_v).multiplyScalar(rnd(2, 9));
      _v.y += 3;
      this.alpha.emit({ pos: center.clone().add(randDir(_u).multiplyScalar(0.5)), vel: _v.clone(), life: rnd(0.8, 1.5), size: rnd(0.08, 0.2), color: i % 3 === 0 ? 0xd4002a : 0x060206, shape: Shape.shard, gravity: 6, drag: 1.2, spin: rnd(-14, 14) });
    }
    for (let i = 0; i < 30; i++) {
      randDir(_v).multiplyScalar(rnd(3, 10));
      this.add.emit({ pos: center.clone(), vel: _v.clone(), life: rnd(0.4, 0.9), size: 0.1, color: i % 2 ? colorA : colorB, shape: Shape.star, drag: 2, spin: rnd(-6, 6) });
    }
    for (let i = 0; i < 16; i++) {
      randDir(_v).multiplyScalar(rnd(0.5, 2));
      _v.y = Math.abs(_v.y) + 1;
      this.alpha.emit({ pos: center.clone().add(randDir(_u).multiplyScalar(0.4)), vel: _v.clone(), life: rnd(1.0, 1.6), size: 0.3, size1: 1.2, color: 0x12060c, shape: Shape.puff, drag: 1.5, alpha: 0.85 });
    }
    this.ring(_w.copy(pos).setY(pos.y + 0.05), _u.set(0, 1, 0), colorA, 0.3, 3.5, 0.6);
    this.add.emit({ pos: center.clone(), life: 0.3, size: 0.8, size1: 3.0, color: colorB, shape: Shape.glow });
  }

  spawnFx(pos: THREE.Vector3, color: THREE.ColorRepresentation): void {
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      _w.set(pos.x + Math.cos(a) * 1.2, pos.y + 0.1, pos.z + Math.sin(a) * 1.2);
      this.add.emit({ pos: _w.clone(), vel: _v.set(0, rnd(3, 8), 0).clone(), life: rnd(0.4, 0.8), size: 0.08, color, shape: Shape.streak, stretch: 3, drag: 1 });
    }
    this.ring(_w.copy(pos).setY(pos.y + 0.05), _u.set(0, 1, 0), color, 2.0, 0.2, 0.5);
  }
}
