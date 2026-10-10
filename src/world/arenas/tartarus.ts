import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ArenaBuilder, type Arena } from '../ArenaBuilder';
import { facadeMaterial, groundMaterial, skyMaterial } from '../materials';
import { artTexture } from '../ArenaArt';
import { toon } from '../../render/toon';
import { arenaMeta } from '../../../shared/arenas';

/** Profile of the Blender `rock` piece: (depth, radius) as fractions of its scale, top to tip. */
const ROCK: Array<[number, number]> = [
  [0, 0.54],
  [0.1, 0.5],
  [0.28, 0.38],
  [0.46, 0.24],
  [0.62, 0.1],
  [0.72, 0],
];

/** Depth (fraction of the rock's height scale) where its surface is `rho` (fraction of its width) from the axis. */
function rockDepth(rho: number): number {
  for (let i = 1; i < ROCK.length; i++) {
    const [d0, r0] = ROCK[i - 1];
    const [d1, r1] = ROCK[i];
    if (rho >= r1) return Math.max(0, d0 + ((d1 - d0) * (r0 - rho)) / (r0 - r1));
  }
  return ROCK[ROCK.length - 1][0];
}

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
function mtx(c: [number, number, number], yaw = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(...c), _q.setFromAxisAngle(_up, yaw), new THREE.Vector3(1, 1, 1));
}

/**
 * Horizontal quad w x d centred on the origin. UVs count `tile`-metre tiles, measured from the
 * point (-ox, -oz) so neighbouring quads continue the same pattern.
 */
function topQuad(w: number, d: number, tile: number, ox = 0, oz = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + ox) / tile, -(pos.getZ(i) + oz) / tile);
  return g;
}

/** Dial of the tower clock: dark teal face, cream ring, minute ticks and Roman numerals. */
function clockTexture(): THREE.CanvasTexture {
  const S = 1024;
  const R = S / 2;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  g.translate(R, R);
  const face = g.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
  face.addColorStop(0, '#1f4c44');
  face.addColorStop(1, '#10302a');
  g.fillStyle = face;
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#cfe3d4';
  g.lineWidth = 12;
  g.beginPath();
  g.arc(0, 0, R * 0.95, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 5;
  g.beginPath();
  g.arc(0, 0, R * 0.8, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#cfe3d4';
  for (let i = 0; i < 60; i++) {
    const long = i % 5 === 0;
    g.save();
    g.rotate((i / 60) * Math.PI * 2);
    g.fillRect(long ? -7 : -3, -R * 0.94, long ? 14 : 6, R * (long ? 0.12 : 0.06));
    g.restore();
  }
  const numerals = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  g.fillStyle = '#d9ecdf';
  g.font = `700 ${Math.round(R * 0.15)}px "Cinzel", "Trajan Pro", "Times New Roman", serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  numerals.forEach((t, i) => {
    g.save();
    g.rotate((i / 12) * Math.PI * 2);
    g.translate(0, -R * 0.66);
    g.fillText(t, 0, 0);
    g.restore();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * MIDNIGHT TARTARUS — the hidden hour. A huge pale moon, a stepped central tower, floating
 * checkered islands connected only by your grapple, and still water below.
 *
 * Restyle: ashlar tower tiers with arched lit windows (a maroon frieze every third tier), runed
 * obelisks, islands with moulded rims, checkered floors in a paved border and jagged rock beneath,
 * forged chains (some ending in a coffin), bracket lanterns, a clock frozen at midnight. Art from
 * tools/blender/arenas/tartarus.py. The green lives in values and a few dim lights instead of neon:
 * nothing blooms, nothing blinks, the water is calm. Collision boxes and the layout random stream
 * are unchanged.
 */
export function buildTartarus(): Arena {
  const B = new ArenaBuilder(777);
  const rng = B.rng;
  const meta = arenaMeta('tartarus');
  B.useKit('tartarus');

  const STONE = 0xd0d8d2;
  const tower = facadeMaterial({ color: STONE, map: artTexture('tartarus_tower'), cells: [1, 1], mode: 'selflit', intensity: 0.6, rim: 0.05 });
  const towerRed = facadeMaterial({ color: STONE, map: artTexture('tartarus_tower_red'), cells: [1, 1], mode: 'selflit', intensity: 0.6, rim: 0.05 });
  const obelisk = facadeMaterial({ color: 0xd4dcd8, map: artTexture('tartarus_obelisk'), cells: [1, 6], mode: 'selflit', intensity: 0.42, rim: 0.06 });
  const rimMat = toon({ color: STONE, map: artTexture('tartarus_rim'), rim: 0.05 });
  const stone = toon({ color: STONE, map: artTexture('tartarus_stone'), rim: 0.05 });
  const paving = toon({ color: STONE, map: artTexture('tartarus_slab'), rim: 0 });
  const checker = toon({ color: 0xdde3dd, map: artTexture('tartarus_checker'), rim: 0 });
  const brass = toon({ color: 0xa08a52, spec: 0.45, rim: 0.1 });
  const iron = toon({ color: 0x2e3433, spec: 0.3, rim: 0.08 });
  const clockStone = toon({ color: 0x7d8a84, rim: 0.06 });
  const brassBar = new THREE.BoxGeometry(1, 0.03, 0.08);

  // --- water floor -------------------------------------------------------------------------------------
  const moonDir = new THREE.Vector3(0.1, 0.55, -0.83);
  B.box([0, -1, 0], [300, 2, 300], groundMaterial({ color: 0x22403a, line: 0x6a9a90, pattern: 'water', glow: 0.6, moonDir, rim: 0 }), { outline: 0, tag: 'water' });

  // --- central tower (stepped, tapering) ----------------------------------------------------------------------
  let y = 0;
  let w = 26;
  for (let i = 0; i < 9; i++) {
    const hgt = 14 - i * 0.6;
    const yaw = i * 0.12;
    const c: [number, number, number] = [0, y + hgt / 2, 0];
    B.world.addBox(c, [w, hgt, w], yaw, { grapple: true });
    // one facade tile per tier height, whole window bays around each face
    B.addStatic(ArenaBuilder.tiledBox(w, hgt, w, 6, hgt, -hgt / 2, i, false, true), i % 3 === 2 ? towerRed : tower, c, [0, yaw, 0]);
    B.addStatic(topQuad(w, w, 4), paving, [0, y + hgt, 0], [0, yaw, 0]);
    B.addOutline(new THREE.BoxGeometry(w, hgt, w), mtx(c, yaw), 1.6);
    y += hgt;
    w *= 0.86;
  }
  // runed spire, pyramidion and a slowly turning crystal
  B.world.addBox([0, y + 14, 0], [3, 28, 3], 0, { grapple: true });
  B.addStatic(ArenaBuilder.tiledBox(3, 28, 3, 3, 6, -14, 0, false, true), obelisk, [0, y + 14, 0]);
  B.addOutline(new THREE.BoxGeometry(3, 28, 3), mtx([0, y + 14, 0]), 1.2);
  B.piece('pyramidion', [0, y + 28, 0], [0, 0, 0], [3.1, 4, 3.1], 1);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.6), toon({ color: 0x9fe8cc, emissive: 0x2f8f70, emissiveIntensity: 0.6, rim: 0.2 }));
  crystal.scale.set(1, 1.5, 1);
  crystal.position.set(0, y + 33.2, 0);
  B.root.add(crystal);

  // clock frozen at midnight (only the thin hand moves, once a minute), held by two iron arms
  const CY = y - 8;
  const CZ = 7.1;
  B.addStatic(new THREE.CylinderGeometry(5, 5, 0.5, 48), clockStone, [0, CY, CZ], [Math.PI / 2, 0, 0], 1, 1.2);
  B.addStatic(new THREE.TorusGeometry(4.85, 0.3, 8, 48), clockStone, [0, CY, CZ + 0.25]);
  B.addStatic(new THREE.TorusGeometry(4.62, 0.07, 6, 64), brass, [0, CY, CZ + 0.28]);
  B.addStatic(new THREE.BoxGeometry(0.42, 2.7, 0.08), brass, [0, CY + 1.1, CZ + 0.32]);
  B.addStatic(new THREE.BoxGeometry(0.28, 3.9, 0.08), brass, [0, CY + 1.7, CZ + 0.4]);
  B.addStatic(new THREE.CylinderGeometry(0.42, 0.42, 0.2, 16), brass, [0, CY, CZ + 0.42], [Math.PI / 2, 0, 0]);
  for (const sx of [-1, 1]) {
    B.addStatic(new THREE.BoxGeometry(0.3, 0.3, 4.2), iron, [sx * 2.4, CY + 2.8, CZ - 2.1], [0.25, 0, 0]);
  }
  const dial = new THREE.Mesh(new THREE.CircleGeometry(4.62, 64), new THREE.MeshBasicMaterial({ map: clockTexture(), color: new THREE.Color(0.85, 0.85, 0.85), fog: true }));
  dial.position.set(0, CY, CZ + 0.26);
  B.root.add(dial);
  const handGeo = new THREE.BoxGeometry(0.1, 4.6, 0.04);
  handGeo.translate(0, 1.5, 0);
  const hand = new THREE.Mesh(handGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9a3242).multiplyScalar(0.9), fog: true }));
  hand.position.set(0, CY, CZ + 0.5);
  B.root.add(hand);

  // --- floating islands ----------------------------------------------------------------------------------------
  let islandN = 0;
  const island = (x: number, top: number, z: number, size: number, thick = 3.2, emblem = false) => {
    const n = islandN++;
    const c: [number, number, number] = [x, top - thick / 2, z];
    B.world.addBox(c, [size, thick, size], 0, { grapple: true });
    // moulded rim (the moulding stays at the top whatever the thickness)
    B.addStatic(ArenaBuilder.tiledBox(size, thick, size, 4, 3.2, thick / 2 - 3.2, n), rimMat, c);
    B.addOutline(new THREE.BoxGeometry(size, thick, size), mtx(c), 1.5);
    // top: checkered field in a paved border with a brass line
    const bw = 0.8;
    const inner = size - 2 * bw;
    const off = size / 2 - bw / 2;
    B.addStatic(topQuad(inner, inner, 4), checker, [x, top, z]);
    for (const s of [-1, 1]) {
      B.addStatic(topQuad(size, bw, 4, 0, s * off), paving, [x, top, z + s * off]);
      B.addStatic(topQuad(bw, inner, 4, s * off, 0), paving, [x + s * off, top, z]);
      B.addStatic(brassBar, brass, [x, top + 0.015, z + (s * inner) / 2], [0, 0, 0], [inner + 0.08, 1, 1]);
      B.addStatic(brassBar, brass, [x + (s * inner) / 2, top + 0.015, z], [0, Math.PI / 2, 0], [inner + 0.08, 1, 1]);
    }
    if (emblem) {
      // spawn islands: a brass clock ring set in the floor
      B.addStatic(new THREE.TorusGeometry(3.2, 0.07, 4, 64), brass, [x, top + 0.01, z], [Math.PI / 2, 0, 0]);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        B.addStatic(brassBar, brass, [x + Math.sin(a) * 2.75, top + 0.015, z + Math.cos(a) * 2.75], [0, a + Math.PI / 2, 0], [k % 3 === 0 ? 0.7 : 0.4, 1, 1]);
      }
    }
    // jagged rock beneath (kept above the water so the island floats)
    const rockYaw = rng.range(0, 1);
    const rw = size * 0.92;
    const rh = Math.min(size * 1.05, (top - thick - 1.5) / 0.72);
    B.piece('rock', [x, top - thick + 0.02, z], [0, rockYaw, 0], [rw, rh, rw], 1.2);
    // corner pillars with bracket lanterns facing out
    if (size > 14) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          if (rng.chance(0.5)) continue;
          const ph = rng.range(4, 9);
          const px = x + sx * (size / 2 - 1.4);
          const pz = z + sz * (size / 2 - 1.4);
          const pc: [number, number, number] = [px, top + ph / 2, pz];
          B.world.addBox(pc, [1.6, ph, 1.6], 0, { grapple: true });
          B.addStatic(ArenaBuilder.tiledBox(1.6, ph, 1.6, 3, 3, -ph / 2, n), stone, pc);
          B.addOutline(new THREE.BoxGeometry(1.6, ph, 1.6), mtx(pc), 1.1);
          B.piece('pillar_base', [px, top, pz], [0, 0, 0], 1, 0.8);
          B.piece('pillar_cap', [px, top + ph - 0.6, pz], [0, 0, 0], 1, 0.8);
          B.piece('wall_lantern', [px + sx * 0.8, top + ph - 2.1, pz], [0, (sx * Math.PI) / 2, 0]);
        }
      }
    }
    // hanging chains: they come out of the rock and end in a ring or, now and then, a coffin
    const chains = rng.int(1, 3);
    for (let k = 0; k < chains; k++) {
      const cx = x + rng.range(-size / 3, size / 3);
      const cz = z + rng.range(-size / 3, size / 3);
      const len = rng.range(6, Math.max(7, top - 2));
      const from = top - thick - rockDepth(Math.hypot(cx - x, cz - z) / rw) * rh;
      const end = Math.max(2.5, top - thick - len);
      const links = Math.floor(Math.min(from - end, 14.4) / 2.4);
      if (links < 1) continue;
      const yaw = (n * 3 + k) * 0.9;
      // one piece starts inside the rock so the chain grows out of it
      for (let j = 0; j <= links; j++) B.piece('chain', [cx, from + 2.4 - j * 2.4, cz], [0, yaw, 0]);
      const yEnd = from - links * 2.4;
      B.piece('shackle', [cx, yEnd - 0.1, cz], [0, yaw + Math.PI / 2, 0]);
      if ((n + k) % 3 === 0) B.piece('coffin', [cx, yEnd - 0.95 - 2.35, cz], [0, yaw, 0], 1.15, 0.8);
    }
  };
  // four spawn islands at radius 34
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    island(Math.sin(a) * 34, 12, Math.cos(a) * 34, 16, 3.2, true);
  }
  // outer ring of islands, varied heights
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    const r = rng.range(58, 82);
    island(Math.cos(a) * r, rng.range(8, 34), Math.sin(a) * r, rng.range(11, 20));
  }
  // high perches
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 1.1;
    island(Math.cos(a) * 46, rng.range(40, 58), Math.sin(a) * 46, 9, 2.4);
  }

  // --- runed monoliths in the water (cover + low anchors) -------------------------------------------------------
  // spread over the whole map: their faces go into one batch (one draw call)
  const monoliths: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(24, 100);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(Math.abs(x) - 48) < 6 && Math.abs(Math.abs(z) - 48) < 6) continue;
    const hgt = rng.range(6, 22);
    const sx = rng.range(2.5, 5);
    const sz = rng.range(2.5, 5);
    const yaw = rng.range(0, Math.PI);
    B.world.addBox([x, hgt / 2, z], [sx, hgt, sz], yaw, { grapple: true });
    monoliths.push(ArenaBuilder.tiledBox(sx, hgt, sz, 2.5, 6, -hgt / 2, i, false, true).applyMatrix4(mtx([x, hgt / 2, z], yaw)));
    B.addStatic(topQuad(sx, sz, 3), stone, [x, hgt, z], [0, yaw, 0]);
    B.addOutline(new THREE.BoxGeometry(sx, hgt, sz), mtx([x, hgt / 2, z], yaw), 1.3);
  }
  B.addStatic(mergeGeometries(monoliths), obelisk, [0, 0, 0]);
  // spawn plinths on the water: paved, a brass ring with a soft inlay, lanterns on the corners
  const inlay = toon({ color: 0x0f2a24, emissive: 0x7fe8c0, emissiveIntensity: 0.55, rim: 0 });
  for (const s of meta.spawns.filter((p) => p.pos[1] < 2)) {
    const [x, , z] = s.pos;
    B.world.addBox([x, 0.2, z], [7, 0.4, 7], 0, { grapple: true });
    B.addStatic(ArenaBuilder.tiledBox(7, 0.4, 7, 3, 3, -0.2, 0), stone, [x, 0.2, z]);
    B.addStatic(topQuad(7, 7, 4), paving, [x, 0.4, z]);
    B.addOutline(new THREE.BoxGeometry(7, 0.4, 7), mtx([x, 0.2, z]), 1);
    B.addStatic(new THREE.TorusGeometry(2.8, 0.08, 4, 64), brass, [x, 0.41, z], [Math.PI / 2, 0, 0]);
    B.addStatic(new THREE.TorusGeometry(2.55, 0.05, 4, 64), inlay, [x, 0.41, z], [Math.PI / 2, 0, 0]);
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) B.piece('lantern', [x + cx * 3.05, 0.4, z + cz * 3.05], [0, 0, 0], 0.9);
  }

  // --- drifting stone shards (one instanced draw, slow) -------------------------------------------------------------
  const SHARDS = 26;
  const shardGeo = new THREE.IcosahedronGeometry(1, 0);
  const shardMesh = new THREE.InstancedMesh(shardGeo, toon({ color: 0x55625d, emissive: 0x0d2b24, rim: 0.25 }), SHARDS);
  const shards: Array<{ base: THREE.Vector3; ph: number; s: number }> = [];
  for (let i = 0; i < SHARDS; i++) {
    const s = rng.range(0.4, 1.2);
    const base = new THREE.Vector3(rng.range(-100, 100), rng.range(10, 70), rng.range(-100, 100));
    shards.push({ base, ph: rng.range(0, 6), s });
  }
  shardMesh.frustumCulled = false;
  B.root.add(shardMesh);
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _r = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _s = new THREE.Vector3();
  const placeShards = (t: number) => {
    shards.forEach((sh, i) => {
      _p.set(sh.base.x + Math.sin(t * 0.12 + sh.ph) * 3, sh.base.y + Math.sin(t * 0.25 + sh.ph) * 1.2, sh.base.z + Math.cos(t * 0.1 + sh.ph) * 3);
      _r.setFromEuler(_e.set(t * 0.08 + sh.ph, t * 0.11 + sh.ph * 0.5, 0));
      _s.set(sh.s * 0.8, sh.s * 1.9, sh.s * 0.7);
      shardMesh.setMatrixAt(i, _m.compose(_p, _r, _s));
    });
    shardMesh.instanceMatrix.needsUpdate = true;
  };
  placeShards(0);

  // --- distant ruined skyline (the Dark Hour: no lights, a few faint green windows) ------------------------------------
  const far = facadeMaterial({ color: 0x6f827b, map: artTexture('city_far'), cells: [4, 3], density: 0.04, intensity: 0.35, rim: 0, winA: 0x7fe8c0, winB: 0xbfe8d6 });
  const skyline: THREE.BufferGeometry[] = [];
  const _rot = new THREE.Euler();
  for (let i = 0; i < 50; i++) {
    const a = (i / 50) * Math.PI * 2;
    const r = rng.range(190, 250);
    const hgt = rng.range(30, 120);
    const bw = rng.range(10, 24);
    const rx = rng.range(-0.08, 0.08);
    const rz = rng.range(-0.08, 0.08);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, hgt / 2 - 6, Math.sin(a) * r), _q.setFromEuler(_rot.set(rx, -a, rz)), new THREE.Vector3(1, 1, 1));
    skyline.push(ArenaBuilder.tiledBox(bw, hgt, 14, 8, 8, -hgt / 2, i).applyMatrix4(m));
  }
  // always around the horizon: one batch
  B.addStatic(mergeGeometries(skyline), far, [0, 0, 0]);

  // --- bounds -----------------------------------------------------------------------------------------------------
  const L = 120;
  B.collider([0, 110, L + 2], [L * 2 + 8, 240, 4]);
  B.collider([0, 110, -L - 2], [L * 2 + 8, 240, 4]);
  B.collider([L + 2, 110, 0], [4, 240, L * 2 + 8]);
  B.collider([-L - 2, 110, 0], [4, 240, L * 2 + 8]);
  B.world.bounds = { minX: -L, maxX: L, minZ: -L, maxZ: L, maxY: 200 };

  for (const s of meta.spawns) B.spawn(s.pos[0], s.pos[1], s.pos[2], s.look[0], s.look[1]);

  return B.finish({
    id: 'tartarus',
    name: meta.name,
    sky: skyMaterial({ top: 0x050f12, mid: 0x10302c, horizon: 0x2a564e, moon: 0xcbd8ad, moonDir, moonSize: 0.17, stars: 0.45, halo: 0.3 }),
    mood: {
      shade: new THREE.Color(0.5, 0.6, 0.62),
      lit: new THREE.Color(0.95, 1.0, 0.93),
      rim: 0x9fe8cc,
      fog: 0x1d433d,
      fogNear: 70,
      fogFar: 330,
      sunDir: new THREE.Vector3(0.1, 0.85, -0.5).normalize(),
      speedLines: 0xd8fff0,
    },
    sunColor: 0xe6f5e8,
    extraTick: (_dt, t) => {
      hand.rotation.z = -t * ((Math.PI * 2) / 60);
      crystal.rotation.y = t * 0.15;
      placeShards(t);
    },
  });
}
