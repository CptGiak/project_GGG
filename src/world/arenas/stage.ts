import * as THREE from 'three';
import { ArenaBuilder, type Arena, type SignStyle } from '../ArenaBuilder';
import { facadeMaterial, groundMaterial, ledScreenMaterial, skyMaterial, worldMaterial } from '../materials';
import { artTexture } from '../ArenaArt';
import { neon, toon, type ToonMaterial } from '../../render/toon';
import { arenaMeta } from '../../../shared/arenas';

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
varying float vCam;
#include <common>
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vFacing = abs( dot( normalize( normalMatrix * normal ), normalize( -mv.xyz ) ) );
  vCam = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const BEAM_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
varying float vCam;
uniform vec3 uColor;
uniform float uIntensity;
void main() {
  // bright at the lens, soft cone edges, fades out when the camera is inside the beam
  float a = pow( vUv.y, 1.8 ) * vFacing * vFacing * smoothstep( 4.0, 22.0, vCam ) * uIntensity;
  gl_FragColor = vec4( uColor * a, a );
}
`;

type Side = 'e' | 's' | 'w';

/**
 * TRUE NOTE ARENA — a concert stadium. Main stage with an LED wall and speaker towers, a giant
 * lighting rig hanging over the pit (perfect for swinging), tiered stands to run on and floating
 * drone platforms.
 *
 * Restyle: floor, seating, risers, deck, speakers and trusses are Blender tiles; fixtures, flight
 * cases, barriers and floodlights come from the Blender kit (tools/blender/arenas/stage.py). The
 * stands are coloured by side (east teal, south violet, west rose) for orientation. Light is
 * moderate and steady: no neon tubes, a calm LED wall, slow dim beams. Collision boxes and the
 * layout random stream are unchanged.
 */
export function buildStage(): Arena {
  const B = new ArenaBuilder(4242);
  const rng = B.rng;
  const meta = arenaMeta('stage');
  B.useKit('stage');

  const NIGHT = 0xc9c3dc;
  const steel = toon({ color: 0x55545f, spec: 0.25, rim: 0.08 });
  const darkSteel = toon({ color: 0x34323b, spec: 0.2, rim: 0.08 });
  const truss = toon({ color: 0xd8d6e2, map: artTexture('stage_truss'), rim: 0.06 });
  const speaker = toon({ color: NIGHT, map: artTexture('stage_speaker'), rim: 0.05 });
  const deck = worldMaterial({ color: NIGHT, topTex: artTexture('stage_deck'), topScale: [4.8, 2.4], sideTex: artTexture('stage_skirt'), sideScale: [2.6, 2.6], rim: 0.04 });
  const platform = worldMaterial({ color: 0xbab6c8, topTex: artTexture('stage_grate'), topScale: 2, sideTint: 0x8c8898, rim: 0.05 });
  const concrete = worldMaterial({ color: 0x7c7886, rim: 0.03 });
  const aisle = toon({ color: 0x8f8a98, rim: 0 });
  const signBody = toon({ color: 0x1f1a28, rim: 0.1 });
  // LEDs: steady and below the bloom threshold
  const ledGold = neon(0xffc35a, 0.9);
  const ledViolet = neon(0xb98aff, 0.8);
  const ledTeal = neon(0x6fe6f0, 0.8);
  const ledPink = neon(0xff8cc4, 0.8);

  // --- floor / pit ---------------------------------------------------------------------------------
  B.box([0, -1, 0], [300, 2, 300], groundMaterial({ color: 0xd9d4e6, line: 0xb39552, pattern: 'stage', rim: 0, tex: artTexture('stage_floor'), texScale: 4, paint: 0.5 }), { outline: 0, tag: 'stage' });

  // --- tiered stands (bowl) -----------------------------------------------------------------------
  // colliders: the same 4.4 m deep boxes as before; visuals: flat-faced segments meeting exactly at
  // the joints (seat rows on top, a riser with an LED ribbon board in front, aisles over the joints)
  const R0 = 84;
  const tiers = 7;
  const segs = 40;
  const half = Math.PI / segs;
  const seatMats = {} as Record<Side, ToonMaterial>;
  const riserMats = {} as Record<Side, ToonMaterial>;
  for (const s of ['e', 's', 'w'] as Side[]) {
    seatMats[s] = toon({ color: NIGHT, map: artTexture(`stage_seats_${s}`), rim: 0.03 });
    riserMats[s] = facadeMaterial({ color: 0xb3adc8, map: artTexture(`stage_riser_${s}`), cells: [1, 1], mode: 'selflit', steady: true, intensity: 0.6, rim: 0.03 });
  }
  const sideOf = (a: number): Side => {
    const x = Math.cos(a);
    const z = Math.sin(a);
    return z < -Math.abs(x) ? 's' : x > 0 ? 'e' : 'w';
  };
  const I = new THREE.Matrix4();
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    // leave the north side open for the main stage
    const north = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)) - Math.PI / 2) < 0.55;
    if (north) continue;
    const yaw = -a + Math.PI / 2;
    const side = sideOf(a);
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    // point on the plane at distance d along the segment normal, on the joint line at angle `ang`
    const P = (d: number, ang: number, y: number) => new THREE.Vector3((Math.cos(ang) * d) / Math.cos(half), y, (Math.sin(ang) * d) / Math.cos(half));
    const along = (p: THREE.Vector3) => -p.x * nz + p.z * nx;
    // ends of the bowl beside the stage opening: segment 6 ends at a + half, segment 14 at a - half
    const endHi = i === 6;
    const endLo = i === 14;
    for (let t = 0; t < tiers; t++) {
      const r = R0 + t * 4.2;
      const hgt = 3 + t * 4.4;
      const w = (2 * Math.PI * r) / segs + 0.4;
      B.world.addBox([nx * r, hgt / 2, nz * r], [w, hgt, 4.4], yaw);
      const rf = r - 2.2;
      const rb = t === tiers - 1 ? r + 2.2 : r + 2.0;
      const y0 = t === 0 ? 0 : 3 + (t - 1) * 4.4;
      const fl = P(rf, a - half, hgt);
      const fr = P(rf, a + half, hgt);
      const br = P(rb, a + half, hgt);
      const bl = P(rb, a - half, hgt);
      // seats (u: along the row in 3 m tiles, v: depth from the front edge in 4.2 m)
      const uv = (p: THREE.Vector3) => [along(p) / 3, (p.x * nx + p.z * nz - rf) / 4.2] as [number, number];
      B.addStaticMatrix(quad([fl, fr, br, bl], [uv(fl), uv(fr), uv(br), uv(bl)]), seatMats[side], I);
      // riser: visible part only, LED ribbon at the top edge
      const fl0 = fl.clone().setY(y0);
      const fr0 = fr.clone().setY(y0);
      const rv = (p: THREE.Vector3) => [along(p) / 6, (p.y - (hgt - 4.4)) / 4.4] as [number, number];
      B.addStaticMatrix(quad([fl0, fr0, fr, fl], [rv(fl0), rv(fr0), rv(fr), rv(fl)]), riserMats[side], I);
      // stepped ends of the bowl beside the stage, outer wall behind the top tier
      if (endLo) B.addStaticMatrix(quad([P(rb, a - half, 0), P(rf, a - half, 0), fl, bl]), concrete, I);
      if (endHi) B.addStaticMatrix(quad([P(rf, a + half, 0), P(rb, a + half, 0), br, fr]), concrete, I);
      if (t === tiers - 1) B.addStaticMatrix(quad([P(rb, a + half, 0), P(rb, a - half, 0), bl, br]), concrete, I);
      B.addOutline(prism(P(rf, a - half, 0), P(rf, a + half, 0), P(rb, a + half, 0), P(rb, a - half, 0), hgt), I, t === tiers - 1 ? 1.4 : 0.7);
      // aisle steps over the joint on the right
      if (!endHi) {
        const j = a + half;
        const mid = (rf + rb) / 2 / Math.cos(half);
        B.addStatic(new THREE.BoxGeometry(1.1, 0.06, rb - rf), aisle, [Math.cos(j) * mid, hgt + 0.03, Math.sin(j) * mid], [0, -j + Math.PI / 2, 0]);
      }
    }
    // light towers every few segments on the rim: lattice mast + floodlight head facing the pit
    if (i % 5 === 0) {
      const r = R0 + tiers * 4.2 + 2;
      B.world.addBox([nx * r, 34, nz * r], [2.4, 68, 2.4], 0);
      B.addStatic(ArenaBuilder.beamBox(68, 2.4, 2.4, 3), truss, [nx * r, 34, nz * r], [0, 0, Math.PI / 2], 1, 1.2);
      B.world.addBox([nx * r, 68.5, nz * r], [7, 2, 3], yaw);
      B.piece('flood_head', [nx * r, 67.5, nz * r], [0, yaw + Math.PI, 0], 1, 1);
    }
  }

  // --- main stage (north) ---------------------------------------------------------------------------
  const SZ = 64;
  B.box([0, 1.3, SZ], [56, 2.6, 26], deck, { outline: 1.4, tag: 'stage' });
  B.box([0, 1.3, SZ - 13.5], [56, 2.6, 1], deck, { collide: false, outline: 0 });
  B.addStatic(new THREE.BoxGeometry(56, 0.07, 0.07), ledGold, [0, 2.62, SZ - 14.02]);
  // runway into the pit
  B.box([0, 1.3, SZ - 24], [8, 2.6, 22], deck, { outline: 1.2 });
  for (const s of [-1, 1]) B.addStatic(new THREE.BoxGeometry(0.07, 0.07, 22), ledViolet, [s * 4.02, 2.62, SZ - 24]);
  B.box([0, 1.3, SZ - 36], [14, 2.6, 6], deck, { outline: 1.2 });
  for (const x of [-20, -12, 12, 20]) B.piece('wedge', [x, 2.6, SZ - 11.8], [0, 0, 0], 1, 0.6);
  for (const x of [-3.4, 3.4]) B.piece('wedge', [x, 2.6, SZ - 36.6], [0, x > 0 ? 0.35 : -0.35, 0], 1, 0.6);
  // LED wall
  B.box([0, 22, SZ + 12], [62, 40, 2], darkSteel, { outline: 1.6 });
  const led = new THREE.Mesh(new THREE.PlaneGeometry(56, 32), ledScreenMaterial({ colorA: 0xffc65a, colorB: 0xc24f9e, bg: 0x2a1640, pixels: [224, 128], intensity: 0.75 }));
  led.position.set(0, 23, SZ + 10.9);
  led.rotation.y = Math.PI;
  B.root.add(led);
  B.lightbox('TRUE NOTE', { bg: '#1c0f2c', fg: '#ffcb5c' }, [0, 41.6, SZ + 10.55], [34, 4.6, 0.6], Math.PI, signBody, 1.05, 1.2);
  // speaker towers (grapple pillars)
  for (const s of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const x = s * (32 + k * 9);
      const hgt = 26 - k * 6;
      const z = SZ + 2 - k * 6;
      B.world.addBox([x, hgt / 2, z], [7, hgt, 7], 0);
      B.addStaticMatrix(ArenaBuilder.tiledBox(7, hgt, 7, 3.6, 4, -hgt / 2, k * 2 + (s > 0 ? 1 : 0)), speaker, new THREE.Matrix4().makeTranslation(x, hgt / 2, z), 1.5);
      B.piece('light_cap', [x, hgt, z], [0, Math.PI, 0], 1, 0.8);
    }
  }
  // stage truss (overhead grapple bars) with PAR bars hanging off the front one
  for (const z of [SZ - 8, SZ + 6]) {
    B.world.addBox([0, 30, z], [70, 1.6, 1.6], 0);
    B.addStatic(ArenaBuilder.beamBox(70, 1.6, 1.6, 2), truss, [0, 30, z], [0, 0, 0], 1, 1.2);
  }
  for (const x of [-34, 34]) {
    B.world.addBox([x, 15, SZ - 1], [1.6, 30, 1.6], 0);
    B.addStatic(ArenaBuilder.beamBox(30, 1.6, 1.6, 2), truss, [x, 15, SZ - 1], [0, 0, Math.PI / 2], 1, 1);
  }
  for (let x = -28; x <= 28; x += 8) B.piece('par_bar', [x, 29.2, SZ - 8], [0, Math.PI, 0]);

  // --- the giant lighting rig over the pit ------------------------------------------------------------
  const RING_R = 30;
  const RING_Y = 40;
  const ringSegs = 24;
  for (let i = 0; i < ringSegs; i++) {
    const a = (i / ringSegs) * Math.PI * 2;
    const w = (2 * Math.PI * RING_R) / ringSegs + 0.3;
    const yaw = -a + Math.PI / 2;
    B.world.addBox([Math.cos(a) * RING_R, RING_Y, Math.sin(a) * RING_R], [w, 2.2, 2.2], yaw);
    B.addStatic(ArenaBuilder.beamBox(w, 2.2, 2.2, 2.75), truss, [Math.cos(a) * RING_R, RING_Y, Math.sin(a) * RING_R], [0, yaw, 0], 1, 1.2);
    B.addStatic(new THREE.BoxGeometry(w, 0.08, 0.08), ledGold, [Math.cos(a) * (RING_R - 1.12), RING_Y - 1.0, Math.sin(a) * (RING_R - 1.12)], [0, yaw, 0]);
    B.piece('moving_head', [Math.cos(a) * RING_R, RING_Y - 1.1, Math.sin(a) * RING_R], [0, yaw, 0]);
  }
  // inner cross beams
  B.world.addBox([0, RING_Y, 0], [RING_R * 2, 1.6, 1.6], 0);
  B.addStatic(ArenaBuilder.beamBox(RING_R * 2, 1.6, 1.6, 2), truss, [0, RING_Y, 0], [0, 0, 0], 1, 1);
  B.world.addBox([0, RING_Y, 0], [1.6, 1.6, RING_R * 2], 0);
  B.addStatic(ArenaBuilder.beamBox(RING_R * 2, 1.6, 1.6, 2), truss, [0, RING_Y, 0], [0, Math.PI / 2, 0], 1, 1);
  // centre-hung video cube
  B.box([0, RING_Y - 3, 0], [8, 6, 8], darkSteel, { outline: 1.4 });
  const cubeStyle: SignStyle = { bg: '#24113a', fg: '#ff8cc4' };
  const cubeStyle2: SignStyle = { bg: '#24113a', fg: '#ffcb5c' };
  for (let k = 0; k < 4; k++) {
    const yawK = (k * Math.PI) / 2;
    B.signFace(k % 2 ? 'TRUE NOTE' : 'LIVE', k % 2 ? cubeStyle2 : cubeStyle, [Math.sin(yawK) * 4.03, RING_Y - 3, Math.cos(yawK) * 4.03], [7.2, 4.4], yawK, 1.05);
  }
  // suspension cables to the rim towers (visual)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const from = new THREE.Vector3(Math.cos(a) * RING_R, RING_Y, Math.sin(a) * RING_R);
    const to = new THREE.Vector3(Math.cos(a) * (R0 + 30), 68, Math.sin(a) * (R0 + 30));
    const len = from.distanceTo(to);
    const g = new THREE.CylinderGeometry(0.1, 0.1, len, 6);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    B.addStatic(g, steel, mid, [e.x, e.y, e.z]);
  }

  // --- floating drone platforms ------------------------------------------------------------------------
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const r = 52;
    const y = 15 + (i % 2) * 6;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    B.box([x, y, z], [12, 1, 12], platform, { outline: 1.3 });
    B.addStatic(new THREE.BoxGeometry(12.08, 0.1, 12.08), i % 2 ? ledTeal : ledPink, [x, y - 0.2, z]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.piece('drone_fan', [x + sx * 4.2, y - 0.5, z + sz * 4.2], [0, 0, 0]);
  }

  // --- pit cover: flight-case stacks, barricades ------------------------------------------------------------
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const r = rng.range(20, 44);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (z > 30 && Math.abs(x) < 12) continue;
    const hgt = rng.range(3, 6);
    const yaw = rng.range(0, Math.PI);
    B.world.addBox([x, hgt / 2, z], [4, hgt, 3], yaw);
    B.piece('case_stack', [x, 0, z], [0, yaw, 0], [1, hgt / 4.5, 1], 1.1);
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a)) - Math.PI / 2) < 0.6) continue;
    B.world.addBox([Math.cos(a) * 74, 0.7, Math.sin(a) * 74], [6, 1.4, 0.6], -a + Math.PI / 2);
    B.piece('barricade', [Math.cos(a) * 74, 0, Math.sin(a) * 74], [0, -a + Math.PI / 2, 0], 1, 0.7);
  }

  // --- slow, dim spotlight beams from the rig (animated) ----------------------------------------------------
  const beams: Array<{ m: THREE.Mesh; base: number; speed: number }> = [];
  const colors = [0xb98aff, 0xffd08a, 0x8fe8f0, 0xff9cc8];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(colors[i % 4]) }, uIntensity: { value: 0.22 } },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const g = new THREE.CylinderGeometry(0.25, 4.5, 44, 24, 1, true);
    g.translate(0, -22, 0);
    const m = new THREE.Mesh(g, mat);
    // from the lens of the moving head at ring segment 3 * i
    const am = ((i * 3) / ringSegs) * Math.PI * 2;
    m.position.set(Math.cos(am) * RING_R, RING_Y - 2.05, Math.sin(am) * RING_R);
    B.root.add(m);
    beams.push({ m, base: a, speed: 0.12 + (i % 3) * 0.05 });
  }

  // --- distant city -------------------------------------------------------------------------------------------
  const far = facadeMaterial({ color: 0x7f7898, map: artTexture('city_far'), cells: [4, 3], density: 0.12, intensity: 0.45, rim: 0, winA: 0xffbf78, winB: 0xd9e2f5 });
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2;
    const r = rng.range(200, 260);
    const hgt = rng.range(30, 110);
    const w = rng.range(12, 26);
    B.addStaticMatrix(ArenaBuilder.tiledBox(w, hgt, 16, 8, 8, -hgt / 2, i), far, new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, hgt / 2, Math.sin(a) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a), new THREE.Vector3(1, 1, 1)));
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
    sky: skyMaterial({ top: 0x0b0718, mid: 0x231538, horizon: 0x5a2d6c, moon: 0xf3e2bd, moonDir: new THREE.Vector3(-0.4, 0.5, 0.75), moonSize: 0.06, halo: 0.14, stars: 0.7 }),
    mood: {
      shade: new THREE.Color(0.58, 0.52, 0.78),
      lit: new THREE.Color(1.0, 0.96, 0.92),
      rim: 0xb98aff,
      fog: 0x1d1430,
      fogNear: 80,
      fogFar: 360,
      sunDir: new THREE.Vector3(-0.3, 0.9, 0.35).normalize(),
      speedLines: 0xfff0c0,
    },
    sunColor: 0xfff2e0,
    extraTick: (_dt, t) => {
      for (const b of beams) {
        const s = t * b.speed + b.base;
        b.m.rotation.set(Math.sin(s) * 0.35, 0, Math.cos(s * 1.3) * 0.35);
      }
    },
  });
}

/** Two triangles a-b-c, a-c-d (counter-clockwise seen from the front) with optional UVs. */
function quad(p: THREE.Vector3[], uv?: Array<[number, number]>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const order = [0, 1, 2, 0, 2, 3];
  g.setAttribute('position', new THREE.Float32BufferAttribute(order.flatMap((i) => [p[i].x, p[i].y, p[i].z]), 3));
  const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).normalize();
  g.setAttribute('normal', new THREE.Float32BufferAttribute(order.flatMap(() => [n.x, n.y, n.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(order.flatMap((i) => (uv ? uv[i] : [0, 0])), 2));
  return g;
}

/** Closed prism over a floor quad (a, b, c, d at y = 0) up to `h` (outline hull of a stand segment). */
function prism(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, h: number): THREE.BufferGeometry {
  const lo = [a, b, c, d].map((p) => p.clone().setY(0));
  const hi = lo.map((p) => p.clone().setY(h));
  // a-b-c-d run counter-clockwise seen from above: outward winding for every face
  const faces = [
    [hi[0], hi[1], hi[2], hi[3]],
    [lo[0], lo[3], lo[2], lo[1]],
    [lo[0], lo[1], hi[1], hi[0]],
    [lo[1], lo[2], hi[2], hi[1]],
    [lo[2], lo[3], hi[3], hi[2]],
    [lo[3], lo[0], hi[0], hi[3]],
  ];
  const pos: number[] = [];
  for (const f of faces) for (const i of [0, 1, 2, 0, 2, 3]) pos.push(f[i].x, f[i].y, f[i].z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
