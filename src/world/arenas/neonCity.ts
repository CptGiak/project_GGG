import * as THREE from 'three';
import { ArenaBuilder, type Arena } from '../ArenaBuilder';
import { groundMaterial, skyMaterial, windowMaterial } from '../materials';
import { equalizerMaterial, neon, toon } from '../../render/toon';
import { arenaMeta } from '../../../shared/arenas';

/**
 * SHIBUYA VELVET — crimson night city. Open scramble crossing in the middle, long avenues to
 * swing down, overpasses and an elevated rail for overhead anchors, rooftops to fight on.
 */
export function buildNeonCity(): Arena {
  const B = new ArenaBuilder(1337);
  const rng = B.rng;

  const facades = [
    windowMaterial({ color: 0x24131c, winA: 0xffcf7a, winB: 0xff3b4e, density: 0.4, rim: 0.25 }),
    windowMaterial({ color: 0x1b1626, winA: 0xffcf7a, winB: 0x6ef3ff, density: 0.35, rim: 0.25 }),
    windowMaterial({ color: 0x301822, winA: 0xffe2b0, winB: 0xff5c7a, density: 0.5, rim: 0.25, winSize: [1.8, 3.0] }),
    windowMaterial({ color: 0x15121c, winA: 0xff2d55, winB: 0xffd27a, density: 0.3, rim: 0.25, winSize: [2.6, 3.8] }),
  ];
  const roofMat = toon({ color: 0x120b10, rim: 0.2 });
  const trimMat = toon({ color: 0x0b070a, rim: 0.3 });
  const concrete = toon({ color: 0x3a2b33, rim: 0.2 });
  const steel = toon({ color: 0x4a4553, spec: 0.4, rim: 0.3 });
  const redPaint = toon({ color: 0xc8102e, rim: 0.4 });
  const whitePaint = toon({ color: 0xece6e8, rim: 0.2 });
  const neonRed = neon(0xff1f3d, 2.6);
  const neonPink = neon(0xff3fa0, 2.4);
  const neonCyan = neon(0x45e8ff, 2.2);
  const neonGold = neon(0xffc24a, 2.4);
  const neons = [neonRed, neonRed, neonPink, neonCyan, neonGold];

  // --- ground ----------------------------------------------------------------------------------
  const asphalt = groundMaterial({ color: 0x1c1519, line: 0xe8e2e4, pattern: 'crosswalk', rim: 0 });
  B.box([0, -1, 0], [300, 2, 300], asphalt, { outline: 0, tag: 'asphalt' });
  // sidewalks (raised slabs) around the plaza
  const sidewalk = groundMaterial({ color: 0x2c2228, line: 0x1a1216, pattern: 'tiles', scale: 1, rim: 0 });
  for (const [x, z, w, d] of [
    [0, 38, 92, 6], [0, -38, 92, 6], [38, 0, 6, 70], [-38, 0, 6, 70],
  ] as const) {
    B.box([x, 0.15, z], [w, 0.3, d], sidewalk, { outline: 0.6, tag: 'concrete' });
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
  const building = (x: number, z: number, w: number, d: number, h: number) => {
    const mat = rng.pick(facades);
    B.box([x, h / 2, z], [w, h, d], mat, { outline: 1.6 });
    // roof rim + parapet
    B.box([x, h + 0.4, z], [w + 0.8, 0.8, d + 0.8], trimMat, { outline: 1.2 });
    B.box([x, h + 0.05, z], [w - 1, 0.2, d - 1], roofMat, { collide: false, outline: 0 });
    // neon strip around the top
    const nm = rng.pick(neons);
    const sh = 0.22;
    B.addStatic(new THREE.BoxGeometry(w + 0.9, sh, 0.12), nm, [x, h - 0.6, z + d / 2 + 0.45]);
    B.addStatic(new THREE.BoxGeometry(w + 0.9, sh, 0.12), nm, [x, h - 0.6, z - d / 2 - 0.45]);
    B.addStatic(new THREE.BoxGeometry(0.12, sh, d + 0.9), nm, [x + w / 2 + 0.45, h - 0.6, z]);
    B.addStatic(new THREE.BoxGeometry(0.12, sh, d + 0.9), nm, [x - w / 2 - 0.45, h - 0.6, z]);
    // rooftop props
    const props = rng.int(1, 4);
    for (let i = 0; i < props; i++) {
      const px = x + rng.range(-w / 2 + 3, w / 2 - 3);
      const pz = z + rng.range(-d / 2 + 3, d / 2 - 3);
      if (rng.chance(0.45)) {
        B.cylinder([px, h + 2.6, pz], 1.6, 3.6, concrete, { seg: 12 });
        B.addStatic(new THREE.CylinderGeometry(1.7, 1.7, 0.3, 12), trimMat, [px, h + 4.5, pz]);
      } else {
        B.box([px, h + 1.1, pz], [rng.range(2, 4), 2.2, rng.range(2, 4)], steel, { outline: 1 });
      }
    }
    if (rng.chance(0.35)) {
      // antenna mast
      const ax = x + rng.range(-w / 4, w / 4);
      const az = z + rng.range(-d / 4, d / 4);
      B.box([ax, h + 7, az], [0.5, 14, 0.5], steel, { outline: 0.8 });
      B.addStatic(new THREE.SphereGeometry(0.45, 8, 6), neonRed, [ax, h + 14.2, az]);
    }
    occupied.push([x, z, w, d]);
    return mat;
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
    // railings
    for (const s of [-1, 1]) {
      const ox = Math.cos(yaw) * s * 2.4;
      const oz = -Math.sin(yaw) * s * 2.4;
      B.box([cx + ox, y + 1.2, cz + oz], [0.25, 1.1, len], redPaint, { yaw, outline: 1 });
      B.addStatic(new THREE.BoxGeometry(0.12, 0.12, len), neonRed, [cx + ox * 1.02, y - 0.55, cz + oz * 1.02], [0, yaw, 0]);
    }
  };
  bridge(-44, -20, 44, -20, 24);
  bridge(20, -44, 20, 44, 31);

  // --- elevated rail along the west side -----------------------------------------------------------
  const railY = 14;
  B.box([-46, railY, 0], [7, 1.6, 230], concrete, { outline: 1.6 });
  for (let z = -105; z <= 105; z += 21) {
    B.box([-46, railY / 2, z], [2.2, railY - 0.8, 2.2], concrete, { outline: 1.2 });
  }
  for (const s of [-1, 1]) {
    B.box([-46 + s * 3.3, railY + 1.1, 0], [0.3, 0.8, 230], steel, { outline: 0.8 });
  }
  // a parked train (red/white, Persona-esque)
  for (let i = 0; i < 3; i++) {
    const z = -30 + i * 19;
    B.box([-46, railY + 2.6, z], [3.4, 3.2, 18], whitePaint, { outline: 1.3 });
    B.box([-46, railY + 2.0, z], [3.5, 0.5, 18.1], redPaint, { collide: false, outline: 0 });
    B.addStatic(new THREE.BoxGeometry(3.52, 0.9, 16), neonGold, [-46, railY + 3.4, z]);
  }

  // --- central billboard tower (north-east corner of plaza) -------------------------------------
  B.box([42, 30, 42], [5, 60, 5], steel, { outline: 1.4 });
  B.box([42, 62, 42], [18, 9, 1.2], trimMat, { outline: 1.4 });
  const eq = equalizerMaterial(0xff1f3d, 0xffd27a, 24, 2.6);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(17, 8), eq);
  screen.position.set(42, 62, 41.3);
  screen.rotation.y = Math.PI;
  B.root.add(screen);
  const screen2 = screen.clone();
  screen2.position.z = 42.7;
  screen2.rotation.y = 0;
  B.root.add(screen2);

  // --- neon signs ------------------------------------------------------------------------------------
  const words = ['SHOWTIME', 'VELVET', 'ネオン', 'BASS DROP', 'GIG NIGHT', 'ライブ', 'HEARTBEAT', 'KAISER', 'NO.1 ARENA', 'ギグ', 'RESONANCE', 'ENCORE'];
  const colors = ['#ff2440', '#ff3fa0', '#45e8ff', '#ffc24a', '#ffffff'];
  let wi = 0;
  for (const [x, z, w, d, h] of ring) {
    // vertical sign on the plaza-facing side
    const facingX = Math.abs(x) > Math.abs(z);
    const sx = facingX ? x - Math.sign(x) * (w / 2 + 0.3) : x + rng.range(-w / 4, w / 4);
    const sz = facingX ? z + rng.range(-d / 4, d / 4) : z - Math.sign(z) * (d / 2 + 0.3);
    const yaw = facingX ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : z > 0 ? Math.PI : 0;
    const word = words[wi++ % words.length];
    const col = colors[wi % colors.length];
    B.sign(word, col, [sx, h * 0.55, sz], [Math.min(w * 0.8, 16), 4], yaw, 2.4, { flicker: rng.chance(0.3) });
  }
  // calling-card style billboard (red/black/white jagged)
  const card = B.sign('TAKE THE STAGE', '#ff2440', [-27, 34, 48.6], [22, 6], Math.PI, 2.6, { bg: 'rgba(10,0,4,0.85)' });
  card.renderOrder = 2;

  // --- street furniture: lamps, barriers -------------------------------------------------------------
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    for (const s of [-1, 1]) {
      const z = i * 14;
      B.box([s * 10.5, 4, z], [0.35, 8, 0.35], steel, { outline: 0.8 });
      B.box([s * 9.5, 8, z], [2.2, 0.3, 0.5], steel, { collide: false, outline: 0.8 });
      B.addStatic(new THREE.BoxGeometry(1.2, 0.15, 0.4), neonGold, [s * 9.1, 7.82, z]);
      const x = i * 14;
      B.box([x, 4, s * 10.5], [0.35, 8, 0.35], steel, { outline: 0.8 });
    }
  }
  // barriers around plaza edge
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const x = Math.cos(a) * 33;
    const z = Math.sin(a) * 33;
    if (Math.abs(x) < 10 || Math.abs(z) < 10) continue;
    B.box([x, 0.6, z], [2.6, 1.2, 0.8], k % 2 ? redPaint : whitePaint, { yaw: -a + Math.PI / 2, outline: 0.9 });
  }

  // --- distant skyline (no collision) ------------------------------------------------------------------
  const far = windowMaterial({ color: 0x140a10, winA: 0xff3b4e, winB: 0xffcf7a, density: 0.25, rim: 0, intensity: 1.2, winSize: [3, 4.5] });
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + rng.range(-0.03, 0.03);
    const r = rng.range(190, 260);
    const h = rng.range(40, 140);
    const w = rng.range(14, 30);
    B.addStatic(new THREE.BoxGeometry(w, h, w), far, [Math.cos(a) * r, h / 2, Math.sin(a) * r], [0, -a, 0]);
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
    sky: skyMaterial({ top: 0x14041a, mid: 0x3d0a1e, horizon: 0xc41a36, moon: 0xffe8de, moonDir: new THREE.Vector3(0.25, 0.42, -0.9), moonSize: 0.11 }),
    mood: {
      shade: new THREE.Color(0.66, 0.5, 0.78),
      lit: new THREE.Color(1.0, 0.95, 0.94),
      rim: 0xff4060,
      fog: 0x2a0a14,
      fogNear: 70,
      fogFar: 380,
      sunDir: new THREE.Vector3(0.35, 0.85, -0.4).normalize(),
      speedLines: 0xffffff,
    },
  });
}
