import * as THREE from 'three';
import { ArenaBuilder, type Arena } from '../ArenaBuilder';
import { groundMaterial, skyMaterial } from '../materials';
import { equalizerMaterial, holoMaterial, neon, toon } from '../../render/toon';
import { arenaMeta } from '../../../shared/arenas';

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
#include <common>
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
`;
const BEAM_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uIntensity;
void main() {
  float a = pow( vUv.y, 2.0 ) * 0.35 * uIntensity;
  gl_FragColor = vec4( uColor * a, a );
}
`;

/**
 * TRUE NOTE ARENA — a neon concert stadium. Main stage with an LED wall and speaker towers,
 * a giant lighting rig hanging over the pit (perfect for swinging), tiered stands to run on
 * and floating holo platforms.
 */
export function buildStage(): Arena {
  const B = new ArenaBuilder(4242);
  const rng = B.rng;
  const meta = arenaMeta('stage');

  const seat = toon({ color: 0x251a36, rim: 0.3 });
  const seatAlt = toon({ color: 0x2f1f45, rim: 0.3 });
  const black = toon({ color: 0x15111c, spec: 0.4, rim: 0.4 });
  const truss = toon({ color: 0x8c8aa0, spec: 0.6, rim: 0.4 });
  const gold = toon({ color: 0xf3c24f, spec: 0.8, rim: 0.4 });
  const stageTop = toon({ color: 0x0e0b14, spec: 0.6, specSize: 0.97, rim: 0.3 });
  const speakerFace = toon({ color: 0x1b1824, rim: 0.2 });
  const neonPurple = neon(0xb44bff, 2.6);
  const neonGold = neon(0xffc94a, 2.6);
  const neonTeal = neon(0x2ef2ff, 2.3);
  const neonPink = neon(0xff3fa0, 2.4);
  const holoEdge = holoMaterial(0xb44bff, 0x2ef2ff, { intensity: 1.6, scan: 6 });

  // --- floor / pit ---------------------------------------------------------------------------------
  B.box([0, -1, 0], [300, 2, 300], groundMaterial({ color: 0x140f1c, line: 0xb44bff, pattern: 'stage', scale: 0.55, glow: 1.4, rim: 0 }), { outline: 0, tag: 'stage' });

  // --- tiered stands (bowl) -----------------------------------------------------------------------
  const R0 = 84;
  const tiers = 7;
  const segs = 40;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    // leave the north side open for the main stage
    const north = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)) - Math.PI / 2) < 0.55;
    if (north) continue;
    const yaw = -a + Math.PI / 2;
    for (let t = 0; t < tiers; t++) {
      const r = R0 + t * 4.2;
      const hgt = 3 + t * 4.4;
      const w = (2 * Math.PI * r) / segs + 0.4;
      B.box([Math.cos(a) * r, hgt / 2, Math.sin(a) * r], [w, hgt, 4.4], t % 2 ? seat : seatAlt, { yaw, outline: t === tiers - 1 ? 1.4 : 0.7 });
    }
    // neon rail on the front edge
    B.addStatic(new THREE.BoxGeometry((2 * Math.PI * R0) / segs, 0.18, 0.18), i % 2 ? neonPurple : neonTeal, [Math.cos(a) * (R0 - 2.3), 3.1, Math.sin(a) * (R0 - 2.3)], [0, yaw, 0]);
    // light towers every few segments on the rim
    if (i % 5 === 0) {
      const r = R0 + tiers * 4.2 + 2;
      B.box([Math.cos(a) * r, 34, Math.sin(a) * r], [2.4, 68, 2.4], truss, { outline: 1.2 });
      B.box([Math.cos(a) * r, 68.5, Math.sin(a) * r], [7, 2, 3], black, { yaw, outline: 1.2 });
      B.addStatic(new THREE.BoxGeometry(6.2, 1.2, 0.2), neonGold, [Math.cos(a) * (r - 1.6), 68.5, Math.sin(a) * (r - 1.6)], [0, yaw, 0]);
    }
  }

  // --- main stage (north) ---------------------------------------------------------------------------
  const SZ = 64;
  B.box([0, 1.3, SZ], [56, 2.6, 26], stageTop, { outline: 1.4, tag: 'stage' });
  B.box([0, 1.3, SZ - 13.5], [56, 2.6, 1], black, { collide: false, outline: 0 });
  B.addStatic(new THREE.BoxGeometry(56, 0.2, 0.2), neonGold, [0, 2.65, SZ - 13.1]);
  // runway into the pit
  B.box([0, 1.3, SZ - 24], [8, 2.6, 22], stageTop, { outline: 1.2 });
  for (const s of [-1, 1]) B.addStatic(new THREE.BoxGeometry(0.2, 0.2, 22), neonPurple, [s * 4.1, 2.65, SZ - 24]);
  B.box([0, 1.3, SZ - 36], [14, 2.6, 6], stageTop, { outline: 1.2 });
  // LED wall
  B.box([0, 22, SZ + 12], [62, 40, 2], black, { outline: 1.6 });
  const led = new THREE.Mesh(new THREE.PlaneGeometry(56, 32), equalizerMaterial(0xb44bff, 0xffc94a, 40, 2.6));
  led.position.set(0, 23, SZ + 10.9);
  led.rotation.y = Math.PI;
  B.root.add(led);
  B.sign('TRUE NOTE', '#ffc94a', [0, 41.5, SZ + 10.8], [36, 6], Math.PI, 2.8);
  // speaker towers (grapple pillars)
  for (const s of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const x = s * (32 + k * 9);
      const hgt = 26 - k * 6;
      B.box([x, hgt / 2, SZ + 2 - k * 6], [7, hgt, 7], black, { outline: 1.5 });
      for (let j = 0; j < Math.floor(hgt / 4); j++) {
        const y = 2.4 + j * 4;
        B.addStatic(new THREE.CylinderGeometry(1.4, 1.6, 0.4, 20), speakerFace, [x, y, SZ + 2 - k * 6 - 3.6], [Math.PI / 2, 0, 0]);
        B.addStatic(new THREE.TorusGeometry(1.5, 0.08, 6, 24), j % 2 ? neonPurple : neonTeal, [x, y, SZ + 2 - k * 6 - 3.75]);
      }
      B.addStatic(new THREE.BoxGeometry(7.2, 0.3, 7.2), neonGold, [x, hgt + 0.1, SZ + 2 - k * 6]);
    }
  }
  // stage truss (overhead grapple bars)
  for (const z of [SZ - 8, SZ + 6]) B.box([0, 30, z], [70, 1.6, 1.6], truss, { outline: 1.2 });
  for (const x of [-34, 34]) B.box([x, 15, SZ - 1], [1.6, 30, 1.6], truss, { outline: 1 });

  // --- the giant lighting rig over the pit ------------------------------------------------------------
  const RING_R = 30;
  const RING_Y = 40;
  const ringSegs = 24;
  for (let i = 0; i < ringSegs; i++) {
    const a = (i / ringSegs) * Math.PI * 2;
    const w = (2 * Math.PI * RING_R) / ringSegs + 0.3;
    B.box([Math.cos(a) * RING_R, RING_Y, Math.sin(a) * RING_R], [w, 2.2, 2.2], truss, { yaw: -a + Math.PI / 2, outline: 1.2 });
    B.addStatic(new THREE.BoxGeometry(w, 0.25, 0.25), i % 2 ? neonGold : neonPurple, [Math.cos(a) * RING_R, RING_Y - 1.25, Math.sin(a) * RING_R], [0, -a + Math.PI / 2, 0]);
  }
  // inner cross beams
  B.box([0, RING_Y, 0], [RING_R * 2, 1.6, 1.6], truss, { outline: 1 });
  B.box([0, RING_Y, 0], [1.6, 1.6, RING_R * 2], truss, { outline: 1 });
  B.box([0, RING_Y - 3, 0], [8, 6, 8], black, { outline: 1.4 });
  B.sign('LIVE', '#ff3fa0', [0, RING_Y - 3, 4.05], [6, 2.4], 0, 2.6);
  B.sign('LIVE', '#ff3fa0', [0, RING_Y - 3, -4.05], [6, 2.4], Math.PI, 2.6);
  // suspension cables to the rim towers (visual)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const from = new THREE.Vector3(Math.cos(a) * RING_R, RING_Y, Math.sin(a) * RING_R);
    const to = new THREE.Vector3(Math.cos(a) * (R0 + 30), 68, Math.sin(a) * (R0 + 30));
    const len = from.distanceTo(to);
    const g = new THREE.CylinderGeometry(0.12, 0.12, len, 6);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    B.addStatic(g, truss, mid, [e.x, e.y, e.z]);
  }

  // --- floating holo platforms ---------------------------------------------------------------------------
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const r = 52;
    const y = 15 + (i % 2) * 6;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    B.box([x, y, z], [12, 1, 12], stageTop, { outline: 1.3 });
    B.addStatic(new THREE.BoxGeometry(12.4, 0.3, 12.4), holoEdge, [x, y - 0.6, z]);
    B.addStatic(new THREE.TorusGeometry(5, 0.12, 6, 36), i % 2 ? neonTeal : neonPink, [x, y - 1.2, z], [Math.PI / 2, 0, 0]);
  }

  // --- pit cover: speaker stacks, barricades ---------------------------------------------------------------
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const r = rng.range(20, 44);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (z > 30 && Math.abs(x) < 12) continue;
    const hgt = rng.range(3, 6);
    B.box([x, hgt / 2, z], [4, hgt, 3], black, { yaw: rng.range(0, Math.PI), outline: 1.2 });
    B.addStatic(new THREE.BoxGeometry(4.1, 0.2, 3.1), i % 2 ? neonPurple : neonGold, [x, hgt + 0.05, z], [0, 0, 0]);
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a)) - Math.PI / 2) < 0.6) continue;
    B.box([Math.cos(a) * 74, 0.7, Math.sin(a) * 74], [6, 1.4, 0.6], gold, { yaw: -a + Math.PI / 2, outline: 0.8 });
  }

  // --- sweeping volumetric spotlights (animated) ----------------------------------------------------------------
  const beams: Array<{ m: THREE.Mesh; base: number; speed: number }> = [];
  const colors = [0xb44bff, 0xffc94a, 0x2ef2ff, 0xff3fa0];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(colors[i % 4]) }, uIntensity: { value: 1 } },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const g = new THREE.CylinderGeometry(0.4, 5, 46, 20, 1, true);
    g.translate(0, -23, 0);
    const m = new THREE.Mesh(g, mat);
    m.position.set(Math.cos(a) * RING_R, RING_Y - 1.5, Math.sin(a) * RING_R);
    B.root.add(m);
    beams.push({ m, base: a, speed: 0.4 + (i % 3) * 0.15 });
  }

  // --- distant city glow ------------------------------------------------------------------------------------------
  const far = toon({ color: 0x1a1226, rim: 0 });
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2;
    const r = rng.range(200, 260);
    const hgt = rng.range(30, 110);
    B.addStatic(new THREE.BoxGeometry(rng.range(12, 26), hgt, 16), far, [Math.cos(a) * r, hgt / 2, Math.sin(a) * r], [0, -a, 0]);
  }

  // --- bounds ------------------------------------------------------------------------------------------------------
  const L = 118;
  B.collider([0, 110, L + 2], [L * 2 + 8, 240, 4]);
  B.collider([0, 110, -L - 2], [L * 2 + 8, 240, 4]);
  B.collider([L + 2, 110, 0], [4, 240, L * 2 + 8]);
  B.collider([-L - 2, 110, 0], [4, 240, L * 2 + 8]);
  B.world.bounds = { minX: -L, maxX: L, minZ: -L, maxZ: L, maxY: 180 };

  for (const s of meta.spawns) B.spawn(s.pos[0], s.pos[1], s.pos[2], s.look[0], s.look[1]);

  return B.finish({
    id: 'stage',
    name: meta.name,
    sky: skyMaterial({ top: 0x07030f, mid: 0x1c0b33, horizon: 0x5b1f8f, moon: 0xffe6a0, moonDir: new THREE.Vector3(-0.4, 0.5, 0.75), moonSize: 0.07, stars: 1.2 }),
    mood: {
      shade: new THREE.Color(0.6, 0.5, 0.84),
      lit: new THREE.Color(1.0, 0.96, 0.92),
      rim: 0xb44bff,
      fog: 0x12081f,
      fogNear: 80,
      fogFar: 360,
      sunDir: new THREE.Vector3(-0.3, 0.9, 0.35).normalize(),
      speedLines: 0xfff0c0,
    },
    sunColor: 0xfff2e0,
    extraTick: (_dt, t) => {
      for (const b of beams) {
        const s = t * b.speed + b.base;
        b.m.rotation.set(Math.sin(s) * 0.55, 0, Math.cos(s * 1.3) * 0.55);
      }
    },
  });
}
