import * as THREE from 'three';
import { ArenaBuilder, type Arena, type SignStyle } from '../ArenaBuilder';
import { facadeMaterial, groundMaterial, skyMaterial, worldMaterial } from '../materials';
import { artTexture } from '../ArenaArt';
import { equalizerMaterial, toon, type ToonMaterial } from '../../render/toon';
import { Rng } from '../../core/Random';
import { arenaMeta } from '../../../shared/arenas';

/**
 * SHIBUYA VELVET — night city around the scramble crossing. Open crossing in the middle, long
 * avenues to swing down, overpasses and an elevated rail for overhead anchors, rooftops to fight on.
 *
 * Restyle: facades, shop fronts, floors and props come from Blender (tools/blender/arenas/city.py).
 * Buildings read as podium (lit shops) + body (windows) + crown (cornice, rooftop plant), in calm
 * mid-tones; colour comes from signage, one hue per side of the plaza (N crimson, E teal, S amber,
 * W pink) to help orientation. Collision boxes and the layout random stream are unchanged.
 */

interface FacadeStyle {
  mats: ToonMaterial[];
  tileW: number;
  tileH: number;
}

const QUAD_STYLES: Record<'n' | 'e' | 's' | 'w', SignStyle[]> = {
  n: [
    { bg: '#b81d33', fg: '#fff1e6' },
    { bg: '#f3ece2', fg: '#b81d33' },
  ],
  e: [
    { bg: '#0f6f78', fg: '#e9fffb' },
    { bg: '#e8f6f4', fg: '#0d5d66' },
  ],
  s: [
    { bg: '#e0a42c', fg: '#2a1606' },
    { bg: '#2b1b0c', fg: '#ffcf6a' },
  ],
  w: [
    { bg: '#c23a7d', fg: '#fff0f7' },
    { bg: '#f6e7ef', fg: '#a3285f' },
  ],
};

const quadOf = (x: number, z: number): 'n' | 'e' | 's' | 'w' => (Math.abs(x) > Math.abs(z) ? (x > 0 ? 'e' : 'w') : z > 0 ? 'n' : 's');

export function buildNeonCity(): Arena {
  const B = new ArenaBuilder(1337);
  const rng = B.rng;
  // decoration only: never interleaved with `rng`, which drives the collision layout
  const deco = new Rng(90210);
  B.useKit('city');

  // night tint shared by the Blender textures: keeps the city in the mid-tones, characters pop
  const NIGHT = 0xbdb9d2;
  const win = { winA: 0xffbf78, winB: 0xd9e2f5, intensity: 0.8, rim: 0.03 };
  const facadeStyles: FacadeStyle[] = [
    { mats: [facadeMaterial({ color: NIGHT, map: artTexture('city_office'), cells: [4, 2], density: 0.17, ...win })], tileW: 6.4, tileH: 7.2 },
    {
      mats: [facadeMaterial({ color: NIGHT, map: artTexture('city_tile'), cells: [2, 2], density: 0.24, ...win }), facadeMaterial({ color: 0xaab0cc, map: artTexture('city_tile'), cells: [2, 2], density: 0.2, ...win })],
      tileW: 7.2,
      tileH: 7.2,
    },
    { mats: [facadeMaterial({ color: NIGHT, map: artTexture('city_mansion'), cells: [2, 2], density: 0.28, ...win })], tileW: 7.2, tileH: 6.0 },
    { mats: [facadeMaterial({ color: 0xc2c6da, map: artTexture('city_glass'), cells: [4, 2], density: 0.14, ...win, winA: 0xd5def2, winB: 0xffc788 })], tileW: 6.4, tileH: 7.2 },
  ];
  const storeMats = ['a', 'b', 'c', 'd'].map((v) => facadeMaterial({ color: NIGHT, map: artTexture(`city_store_${v}`), cells: [2, 1], mode: 'selflit', intensity: 0.55, rim: 0.03 }));
  const roofTop = worldMaterial({ color: 0xa3a2b8, topTex: artTexture('city_roof'), topScale: 6, sideTint: 0xc4c0c8, rim: 0.03 });
  const coping = toon({ color: 0x7a7688, rim: 0.03 });
  const belt = toon({ color: 0x67626f, rim: 0.03 });
  const canopy = toon({ color: 0x3f3a48, rim: 0.05 });
  const concrete = worldMaterial({ color: 0x86828f, rim: 0.04 });
  const steel = toon({ color: 0x4f5260, spec: 0.3, rim: 0.15 });
  const girder = toon({ color: 0x3b3d48, spec: 0.2, rim: 0.12 });
  const signBody = toon({ color: 0x23202a, rim: 0.12 });
  const towerCore = toon({ color: 0x2c2b35, rim: 0.1 });
  // kept in the same order as before: rng.pick() below must keep consuming the same numbers
  const neons = [0, 1, 2, 3, 4];

  // --- ground ----------------------------------------------------------------------------------
  const asphalt = groundMaterial({ color: 0xd2cfe0, line: 0xd9d5cf, pattern: 'crosswalk', rim: 0, tex: artTexture('city_asphalt'), texScale: 8, paint: 0.62 });
  B.box([0, -1, 0], [300, 2, 300], asphalt, { outline: 0, tag: 'asphalt' });
  // sidewalks (raised slabs) around the plaza, with the yellow tactile strip on the plaza side
  const sidewalk = worldMaterial({ color: 0x9c99aa, topTex: artTexture('city_pavers'), topScale: 2.4, sideTint: 0xb0aab4, rim: 0 });
  const tactile = toon({ color: 0xa88b3c, rim: 0 });
  for (const [x, z, w, d] of [
    [0, 38, 92, 6], [0, -38, 92, 6], [38, 0, 6, 70], [-38, 0, 6, 70],
  ] as const) {
    B.box([x, 0.15, z], [w, 0.3, d], sidewalk, { outline: 0.6, tag: 'concrete' });
    const inner = Math.abs(x) > Math.abs(z) ? [x - Math.sign(x) * (w / 2 - 0.9), z] : [x, z - Math.sign(z) * (d / 2 - 0.9)];
    B.addStatic(new THREE.BoxGeometry(Math.abs(x) > Math.abs(z) ? 0.3 : w - 1, 0.02, Math.abs(x) > Math.abs(z) ? d - 1 : 0.3), tactile, [inner[0], 0.31, inner[1]]);
  }

  // --- buildings -------------------------------------------------------------------------------
  const occupied: Array<[number, number, number, number]> = [];
  const canPlace = (x: number, z: number, w: number, d: number) => {
    if (Math.abs(x) < 44 + w / 2 && Math.abs(z) < 44 + d / 2) return false; // plaza
    if (Math.abs(x) < 9 + w / 2 || Math.abs(z) < 9 + d / 2) return false; // avenues on the axes
    if (Math.abs(Math.abs(x) - 82) < 6 + w / 2 && Math.abs(z) > 50) return false; // side streets
    if (Math.abs(Math.abs(z) - 82) < 6 + d / 2 && Math.abs(x) > 50) return false;
    for (const [ox, oz, ow, od] of occupied) {
      if (Math.abs(ox - x) < (ow + w) / 2 + 3 && Math.abs(oz - z) < (od + d) / 2 + 3) return false;
    }
    return true;
  };
  const PODIUM = 4.8;
  const building = (x: number, z: number, w: number, d: number, h: number) => {
    const style = rng.pick(facadeStyles);
    const seed = deco.int(0, 999);
    // body (collider unchanged: the full w x h x d box)
    B.world.addBox([x, h / 2, z], [w, h, d], 0);
    const bodyH = h - PODIUM;
    B.addStaticMatrix(ArenaBuilder.tiledBox(w, bodyH, d, style.tileW, style.tileH, -bodyH / 2, seed), deco.pick(style.mats), new THREE.Matrix4().makeTranslation(x, PODIUM + bodyH / 2, z), 1.6);
    // podium with shop fronts, belt course above it and a canopy over the pavement
    B.addStaticMatrix(ArenaBuilder.tiledBox(w + 0.3, PODIUM, d + 0.3, 8, PODIUM, -PODIUM / 2, seed + 1), deco.pick(storeMats), new THREE.Matrix4().makeTranslation(x, PODIUM / 2, z), 1.2);
    B.addStatic(new THREE.BoxGeometry(w + 0.6, 0.4, d + 0.6), belt, [x, PODIUM + 0.2, z], [0, 0, 0], 1, 1);
    B.addStatic(new THREE.BoxGeometry(w + 1.8, 0.22, d + 1.8), canopy, [x, 3.72, z], [0, 0, 0], 1, 0.8);
    // crown: stepped cornice under the roof slab (the slab is the walkable roof, collider unchanged)
    B.addStatic(new THREE.BoxGeometry(w + 0.36, 0.5, d + 0.36), coping, [x, h - 0.25, z], [0, 0, 0], 1, 0.9);
    B.box([x, h + 0.4, z], [w + 0.8, 0.8, d + 0.8], roofTop, { outline: 1.2 });
    rng.pick(neons); // the old roof-edge neon strip: gone, its random draw stays
    // rooftop plant: same colliders as before, Blender models on top
    const roofY = h + 0.8;
    const taken: Array<[number, number, number]> = [];
    const props = rng.int(1, 4);
    for (let i = 0; i < props; i++) {
      const px = x + rng.range(-w / 2 + 3, w / 2 - 3);
      const pz = z + rng.range(-d / 2 + 3, d / 2 - 3);
      if (rng.chance(0.45)) {
        // water tank (octagonal collider of the old cylinder)
        B.world.addBox([px, h + 2.6, pz], [2.56, 3.6, 2.56], 0);
        B.world.addBox([px, h + 2.6, pz], [2.56, 3.6, 2.56], Math.PI / 4);
        B.piece(deco.chance(0.6) ? 'tank_square' : 'tank_round', [px, roofY, pz], [0, deco.int(0, 3) * (Math.PI / 2), 0], 1, 1);
        taken.push([px, pz, 1.8]);
      } else {
        const sx = rng.range(2, 4);
        const sz = rng.range(2, 4);
        B.world.addBox([px, h + 1.1, pz], [sx, 2.2, sz], 0);
        B.piece(deco.chance(0.75) ? 'hvac' : 'stair_hut', [px, roofY, pz], [0, 0, 0], [sx, 1.4, sz], 1);
        taken.push([px, pz, Math.max(sx, sz) * 0.7]);
      }
    }
    if (rng.chance(0.35)) {
      // antenna mast
      const ax = x + rng.range(-w / 4, w / 4);
      const az = z + rng.range(-d / 4, d / 4);
      B.world.addBox([ax, h + 7, az], [0.5, 14, 0.5], 0);
      B.piece('mast', [ax, roofY, az], [0, deco.range(0, Math.PI), 0], [1, 13.2 / 14, 1]);
    }
    // clutter along a roof edge (no collision, kept clear of the props above)
    const clutter = deco.int(0, 2);
    for (let k = 0; k < clutter; k++) {
      const side = deco.int(0, 3);
      const along = deco.range(-0.35, 0.35);
      const cx = side < 2 ? x + along * w : x + (side === 2 ? 1 : -1) * (w / 2 - 1.6);
      const cz = side < 2 ? z + (side === 0 ? 1 : -1) * (d / 2 - 1.6) : z + along * d;
      if (taken.some(([tx, tz, r]) => Math.hypot(tx - cx, tz - cz) < r + 2)) continue;
      const yaw = side < 2 ? (side === 0 ? 0 : Math.PI) : side === 2 ? Math.PI / 2 : -Math.PI / 2;
      B.piece(deco.chance(0.7) ? 'ac_rack' : 'dish', [cx, roofY, cz], [0, yaw + Math.PI, 0]);
      taken.push([cx, cz, 1.5]);
    }
    occupied.push([x, z, w, d]);
  };

  // ring of tall buildings facing the plaza (fixed for good grapple lines)
  const ring: Array<[number, number, number, number, number]> = [
    [27, 60, 26, 22, 62], [-27, 60, 26, 22, 48], [27, -60, 26, 22, 54], [-27, -60, 26, 22, 70],
    [60, 27, 22, 26, 44], [60, -27, 22, 26, 66], [-60, 27, 22, 26, 58], [-60, -27, 22, 26, 40],
    [62, 62, 24, 24, 80], [-62, -62, 24, 24, 76], [62, -62, 24, 24, 52], [-62, 62, 24, 24, 60],
  ];
  for (const [x, z, w, d, h] of ring) building(x, z, w, d, h);
  // outer city, random
  for (let gx = -110; gx <= 110; gx += 26) {
    for (let gz = -110; gz <= 110; gz += 26) {
      const x = gx + rng.range(-5, 5);
      const z = gz + rng.range(-5, 5);
      const w = rng.range(12, 22);
      const d = rng.range(12, 22);
      if (!canPlace(x, z, w, d)) continue;
      const far = Math.max(Math.abs(x), Math.abs(z));
      building(x, z, w, d, rng.range(26, 50) + far * 0.18);
    }
  }

  // --- overpasses across the plaza (overhead anchors) ------------------------------------------
  const bridge = (x0: number, z0: number, x1: number, z1: number, y: number) => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    B.box([cx, y, cz], [5, 1.4, len], concrete, { yaw, outline: 1.4 });
    // steel girders under the deck
    for (const s of [-1, 1]) {
      const gx = Math.cos(yaw) * s * 1.5;
      const gz = -Math.sin(yaw) * s * 1.5;
      B.addStatic(new THREE.BoxGeometry(0.5, 0.9, len), girder, [cx + gx, y - 1.1, cz + gz], [0, yaw, 0], 1, 0.8);
    }
    // railings: old colliders, Blender railing segments every 2 m
    for (const s of [-1, 1]) {
      const ox = Math.cos(yaw) * s * 2.4;
      const oz = -Math.sin(yaw) * s * 2.4;
      B.world.addBox([cx + ox, y + 1.2, cz + oz], [0.25, 1.1, len], yaw);
      const n = Math.floor(len / 2);
      for (let k = 0; k < n; k++) {
        const t = -len / 2 + (len - n * 2) / 2 + 1 + k * 2;
        B.piece('rail_seg', [cx + ox + Math.sin(yaw) * t, y + 0.7, cz + oz + Math.cos(yaw) * t], [0, yaw - Math.PI / 2, 0]);
      }
    }
  };
  bridge(-44, -20, 44, -20, 24);
  bridge(20, -44, 20, 44, 31);

  // --- elevated rail along the west side -----------------------------------------------------------
  const railY = 14;
  B.box([-46, railY, 0], [7, 1.6, 230], concrete, { outline: 1.6 });
  B.addStatic(new THREE.BoxGeometry(7.4, 0.5, 230), girder, [-46, railY - 1.05, 0], [0, 0, 0], 1, 0.8);
  for (let z = -105; z <= 105; z += 21) {
    B.box([-46, railY / 2, z], [2.2, railY - 0.8, 2.2], concrete, { outline: 1.2 });
    B.piece('pier_cap', [-46, railY - 0.8 - 1.4 + 0.05, z], [0, 0, 0], 1, 1);
  }
  for (const s of [-1, 1]) {
    B.box([-46 + s * 3.3, railY + 1.1, 0], [0.3, 0.8, 230], steel, { outline: 0.8 });
  }
  // a parked train
  for (let i = 0; i < 3; i++) {
    const z = -30 + i * 19;
    B.world.addBox([-46, railY + 2.6, z], [3.4, 3.2, 18], 0);
    B.piece('train_car', [-46, railY + 0.8, z], [0, 0, 0], 1, 1.2);
  }

  // --- central billboard tower (north-east corner of plaza) -------------------------------------
  B.world.addBox([42, 30, 42], [5, 60, 5], 0);
  B.addStatic(new THREE.BoxGeometry(3.4, 60, 3.4), towerCore, [42, 30, 42], [0, 0, 0], 1, 1);
  for (let k = 0; k < 15; k++) B.piece('lattice', [42, k * 4, 42], [0, 0, 0], [5, 4, 5]);
  B.box([42, 62, 42], [18, 9, 1.2], signBody, { outline: 1.4 });
  const eq = equalizerMaterial(0xe0405a, 0xffd27a, 24, 1.1);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(17, 8), eq);
  screen.position.set(42, 62, 41.3);
  screen.rotation.y = Math.PI;
  B.root.add(screen);
  const screen2 = screen.clone();
  screen2.position.z = 42.7;
  screen2.rotation.y = 0;
  B.root.add(screen2);

  // --- signage -------------------------------------------------------------------------------------
  const words = ['SHOWTIME', 'VELVET', 'ネオン', 'BASS DROP', 'GIG NIGHT', 'ライブ', 'HEARTBEAT', 'KAISER', 'NO.1 ARENA', 'ギグ', 'RESONANCE', 'ENCORE'];
  let wi = 0;
  for (const [x, z, w, d, h] of ring) {
    // big lightbox on the plaza-facing side, coloured by quadrant
    const facingX = Math.abs(x) > Math.abs(z);
    const sw = Math.min(w * 0.8, 16);
    const sx = facingX ? x - Math.sign(x) * (w / 2 + 0.55) : x + rng.range(-w / 4, w / 4);
    const sz = facingX ? z + rng.range(-d / 4, d / 4) : z - Math.sign(z) * (d / 2 + 0.55);
    const yaw = facingX ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : z > 0 ? Math.PI : 0;
    const styles = QUAD_STYLES[quadOf(x, z)];
    B.lightbox(words[wi++ % words.length], styles[wi % 2], [sx, h * 0.55, sz], [sw, 3.6, 0.5], yaw, signBody, 1.15);
  }
  // calling-card billboard
  B.lightbox('TAKE THE STAGE', { bg: '#14070c', fg: '#ff4d64' }, [-27, 34, 48.4], [22, 6, 0.6], Math.PI, signBody, 1.25);
  // vertical (tategaki) signs on building corners along the streets
  const vWords = ['カラオケ', 'ラーメン', '居酒屋', 'ホテル', '営業中', 'ゲーム', '書店', '焼肉', '喫茶', 'ネオン', '本日', 'ライブ'];
  for (const [x, z, w, d] of occupied) {
    if (!deco.chance(0.55)) continue;
    const q = quadOf(x, z);
    const styles = QUAD_STYLES[deco.chance(0.7) ? q : (['n', 'e', 's', 'w'] as const)[deco.int(0, 3)]];
    // corner nearest to the plaza, on the face looking along the street
    const cx = x - Math.sign(x) * (w / 2);
    const cz = z - Math.sign(z) * (d / 2);
    // blade sign sticking out of one of the two faces meeting at that corner
    const onXFace = deco.chance(0.5);
    const hgt = deco.range(7, 11);
    const off = 1.1;
    const px = onXFace ? cx - Math.sign(x) * off : cx + Math.sign(x) * 1.6;
    const pz = onXFace ? cz + Math.sign(z) * 1.6 : cz - Math.sign(z) * off;
    const text = vWords[deco.int(0, vWords.length - 1)];
    const style = { ...deco.pick(styles), vertical: true };
    B.lightbox(text, style, [px, PODIUM + 1.5 + hgt / 2, pz], [1.3, hgt, 0.45], onXFace ? 0 : Math.PI / 2, signBody, 1.1, 0.8);
  }

  // --- street furniture: lamps, barriers -------------------------------------------------------------
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    for (const s of [-1, 1]) {
      const z = i * 14;
      B.world.addBox([s * 10.5, 4, z], [0.35, 8, 0.35], 0);
      B.piece('lamp', [s * 10.5, 0, z], [0, s > 0 ? Math.PI : 0, 0], 1, 0.6);
      const x = i * 14;
      B.world.addBox([x, 4, s * 10.5], [0.35, 8, 0.35], 0);
      B.piece('lamp', [x, 0, s * 10.5], [0, s * (Math.PI / 2), 0], 1, 0.6);
    }
  }
  // barriers around plaza edge
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const x = Math.cos(a) * 33;
    const z = Math.sin(a) * 33;
    if (Math.abs(x) < 10 || Math.abs(z) < 10) continue;
    B.world.addBox([x, 0.6, z], [2.6, 1.2, 0.8], -a + Math.PI / 2);
    B.piece('barrier', [x, 0, z], [0, -a + Math.PI / 2, 0], 1, 0.8);
  }

  // --- distant skyline (no collision) ------------------------------------------------------------------
  const far = facadeMaterial({ color: 0x8e88a8, map: artTexture('city_far'), cells: [4, 3], density: 0.16, intensity: 0.55, rim: 0, winA: 0xffbf78, winB: 0xd9e2f5 });
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + rng.range(-0.03, 0.03);
    const r = rng.range(190, 260);
    const h = rng.range(40, 140);
    const w = rng.range(14, 30);
    B.addStaticMatrix(ArenaBuilder.tiledBox(w, h, w, 8, 8, -h / 2, i), far, new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, h / 2, Math.sin(a) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a), new THREE.Vector3(1, 1, 1)));
  }

  // --- invisible bounds ---------------------------------------------------------------------------------------
  const L = 128;
  B.collider([0, 110, L + 2], [L * 2 + 8, 240, 4]);
  B.collider([0, 110, -L - 2], [L * 2 + 8, 240, 4]);
  B.collider([L + 2, 110, 0], [4, 240, L * 2 + 8]);
  B.collider([-L - 2, 110, 0], [4, 240, L * 2 + 8]);
  B.world.bounds = { minX: -L, maxX: L, minZ: -L, maxZ: L, maxY: 200 };

  // --- spawns ---------------------------------------------------------------------------------------------------
  for (const s of arenaMeta('neon_city').spawns) B.spawn(s.pos[0], s.pos[1], s.pos[2], s.look[0], s.look[1]);

  return B.finish({
    id: 'neon_city',
    name: 'SHIBUYA VELVET',
    sky: skyMaterial({ top: 0x0c0a20, mid: 0x261a40, horizon: 0x6e2a45, moon: 0xf2e6d6, moonDir: new THREE.Vector3(0.25, 0.42, -0.9), moonSize: 0.1, halo: 0.28, stars: 0.8 }),
    mood: {
      shade: new THREE.Color(0.56, 0.52, 0.74),
      lit: new THREE.Color(1.0, 0.96, 0.95),
      rim: 0xff5a78,
      fog: 0x2a2036,
      fogNear: 60,
      fogFar: 330,
      sunDir: new THREE.Vector3(0.35, 0.85, -0.4).normalize(),
      speedLines: 0xffffff,
    },
  });
}
