import * as THREE from 'three';
import { ArenaBuilder, type Arena } from '../ArenaBuilder';
import { groundMaterial, skyMaterial } from '../materials';
import { holoMaterial, neon, toon } from '../../render/toon';
import { arenaMeta } from '../../../shared/arenas';

/**
 * MIDNIGHT TARTARUS — the hidden hour. A huge green moon, a stepped central tower, floating
 * checkered islands connected only by your grapple, and shallow glowing water below.
 */
export function buildTartarus(): Arena {
  const B = new ArenaBuilder(777);
  const rng = B.rng;
  const meta = arenaMeta('tartarus');

  const stoneA = toon({ color: 0x1b2a2a, rim: 0.35 });
  const stoneB = toon({ color: 0x223636, rim: 0.35 });
  const dark = toon({ color: 0x0c1414, rim: 0.4, spec: 0.3 });
  const tileTop = groundMaterial({ color: 0x14201f, line: 0x2e4a46, pattern: 'tiles', scale: 0.8, rim: 0 });
  const chainMat = toon({ color: 0x3c4a48, spec: 0.6, rim: 0.3 });
  const neonGreen = neon(0x3cffb4, 2.4);
  const neonTeal = neon(0x48e8ff, 1.5);
  const neonBlood = neon(0xff3355, 2.0);
  const holo = holoMaterial(0x3cffb4, 0x48e8ff, { intensity: 1.3, scan: 8 });

  // --- water floor -----------------------------------------------------------------------------------
  B.box([0, -1, 0], [300, 2, 300], groundMaterial({ color: 0x061514, line: 0x3cffb4, pattern: 'water', scale: 1, glow: 0.9, rim: 0 }), { outline: 0, tag: 'water' });

  // --- central tower (stepped, tapering) ---------------------------------------------------------------
  let y = 0;
  let w = 26;
  for (let i = 0; i < 9; i++) {
    const hgt = 14 - i * 0.6;
    const mat = i % 2 ? stoneA : stoneB;
    B.box([0, y + hgt / 2, 0], [w, hgt, w], mat, { yaw: i * 0.12, outline: 1.6 });
    // glowing seams
    B.addStatic(new THREE.BoxGeometry(w + 0.4, 0.25, w + 0.4), i % 3 === 2 ? neonBlood : neonGreen, [0, y + hgt, 0], [0, i * 0.12, 0]);
    // window slits on each face
    for (let f = 0; f < 4; f++) {
      const a = (f / 4) * Math.PI * 2 + i * 0.12;
      const nx = Math.sin(a);
      const nz = Math.cos(a);
      B.addStatic(new THREE.BoxGeometry(w * 0.42, hgt * 0.07, 0.2), neonTeal, [nx * (w / 2 + 0.11), y + hgt * 0.55, nz * (w / 2 + 0.11)], [0, a, 0]);
    }
    y += hgt;
    w *= 0.86;
  }
  // spire + clock face
  B.box([0, y + 14, 0], [3, 28, 3], dark, { outline: 1.2 });
  B.addStatic(new THREE.OctahedronGeometry(3.4), neonGreen, [0, y + 30, 0]);
  const clock = new THREE.Mesh(new THREE.RingGeometry(4.2, 5, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3cffb4).multiplyScalar(2.5), side: THREE.DoubleSide, fog: true }));
  clock.position.set(0, y - 8, 7.1);
  B.root.add(clock);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3355).multiplyScalar(2.5), fog: true }));
  hand.geometry.translate(0, 2, 0);
  hand.position.set(0, y - 8, 7.2);
  B.root.add(hand);

  // --- floating islands --------------------------------------------------------------------------------------
  const island = (x: number, top: number, z: number, size: number, thick = 3.2) => {
    B.box([x, top - thick / 2, z], [size, thick, size], tileTop, { outline: 1.5 });
    // tapered rocky underside
    B.addStatic(new THREE.CylinderGeometry(size * 0.55, size * 0.12, size * 0.7, 6), stoneA, [x, top - thick - size * 0.35, z], [0, rng.range(0, 1), 0]);
    B.addStatic(new THREE.BoxGeometry(size + 0.3, 0.2, size + 0.3), neonGreen, [x, top - 0.25, z]);
    // corner pillars
    if (size > 14) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          if (rng.chance(0.5)) continue;
          const ph = rng.range(4, 9);
          B.box([x + sx * (size / 2 - 1.4), top + ph / 2, z + sz * (size / 2 - 1.4)], [1.6, ph, 1.6], stoneB, { outline: 1.1 });
          B.addStatic(new THREE.OctahedronGeometry(0.6), neonTeal, [x + sx * (size / 2 - 1.4), top + ph + 1, z + sz * (size / 2 - 1.4)]);
        }
      }
    }
    // hanging chains
    const chains = rng.int(1, 3);
    for (let c = 0; c < chains; c++) {
      const cx = x + rng.range(-size / 3, size / 3);
      const cz = z + rng.range(-size / 3, size / 3);
      const len = rng.range(6, Math.max(7, top - 2));
      B.addStatic(new THREE.CylinderGeometry(0.12, 0.12, len, 5), chainMat, [cx, top - thick - len / 2, cz]);
      B.addStatic(new THREE.TorusGeometry(0.35, 0.1, 5, 10), chainMat, [cx, top - thick - len, cz], [0, 0, Math.PI / 2]);
    }
  };
  // four spawn islands at radius 34
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    island(Math.sin(a) * 34, 12, Math.cos(a) * 34, 16);
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

  // --- monoliths in the water (cover + low anchors) --------------------------------------------------------
  for (let i = 0; i < 12; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(24, 100);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(Math.abs(x) - 48) < 6 && Math.abs(Math.abs(z) - 48) < 6) continue;
    const hgt = rng.range(6, 22);
    B.box([x, hgt / 2, z], [rng.range(2.5, 5), hgt, rng.range(2.5, 5)], dark, { yaw: rng.range(0, Math.PI), outline: 1.3 });
    B.addStatic(new THREE.BoxGeometry(0.2, hgt * 0.8, 0.2), i % 3 === 0 ? neonBlood : neonGreen, [x, hgt * 0.5, z]);
  }
  // spawn pads on the water
  for (const s of meta.spawns.filter((p) => p.pos[1] < 2)) {
    B.box([s.pos[0], 0.2, s.pos[2]], [7, 0.4, 7], stoneB, { outline: 1 });
    B.addStatic(new THREE.TorusGeometry(2.8, 0.1, 6, 30), holo, [s.pos[0], 0.45, s.pos[2]], [Math.PI / 2, 0, 0]);
  }

  // --- floating "shadow" shards drifting around (animated) -------------------------------------------------------
  const shards: Array<{ m: THREE.Mesh; base: THREE.Vector3; ph: number }> = [];
  const shardMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3cffb4).multiplyScalar(1.6), fog: true });
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(rng.range(0.4, 1.2)), shardMat);
    const base = new THREE.Vector3(rng.range(-100, 100), rng.range(10, 70), rng.range(-100, 100));
    m.position.copy(base);
    B.root.add(m);
    shards.push({ m, base, ph: rng.range(0, 6) });
  }

  // --- distant ruined skyline -------------------------------------------------------------------------------------
  const far = toon({ color: 0x0b1a18, rim: 0 });
  for (let i = 0; i < 50; i++) {
    const a = (i / 50) * Math.PI * 2;
    const r = rng.range(190, 250);
    const hgt = rng.range(30, 120);
    B.addStatic(new THREE.BoxGeometry(rng.range(10, 24), hgt, 14), far, [Math.cos(a) * r, hgt / 2 - 6, Math.sin(a) * r], [rng.range(-0.08, 0.08), -a, rng.range(-0.08, 0.08)]);
  }

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
    sky: skyMaterial({ top: 0x020807, mid: 0x0a2420, horizon: 0x1f6a55, moon: 0xd8ffd0, moonDir: new THREE.Vector3(0.1, 0.55, -0.83), moonSize: 0.2, stars: 0.6 }),
    mood: {
      shade: new THREE.Color(0.42, 0.6, 0.58),
      lit: new THREE.Color(0.94, 1.0, 0.92),
      rim: 0x3cffb4,
      fog: 0x061c18,
      fogNear: 70,
      fogFar: 340,
      sunDir: new THREE.Vector3(0.1, 0.85, -0.5).normalize(),
      speedLines: 0xd8fff0,
    },
    sunColor: 0xe0ffe8,
    extraTick: (_dt, t) => {
      hand.rotation.z = -t * 0.5;
      for (const s of shards) {
        s.m.position.set(s.base.x + Math.sin(t * 0.3 + s.ph) * 4, s.base.y + Math.sin(t * 0.7 + s.ph) * 2, s.base.z + Math.cos(t * 0.25 + s.ph) * 4);
        s.m.rotation.set(t * 0.5 + s.ph, t * 0.7, 0);
      }
    },
  });
}
