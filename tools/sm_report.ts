/**
 * Numeric QA for secondary motion (hair, cloth, strings, props), driven through the real builder and
 * FighterAnimator without a browser:
 *   npx tsx tools/sm_report.ts <champ> [fps]          (NOCOL=1 disables the body colliders)
 *
 * Moves the root along fixed tracks (idle, a 9.6 m/s run, a 30 m/s dive, an instant stop from
 * 10 m/s, a 720°/s spin, a 26 m/s² fall, a 5 m blink, a 28 m teleport) and prints, per item, the
 * peak / final angle off its rest direction (degrees) and the worst chain stretch. Run it at 30, 60
 * and 144 fps: the numbers should agree (secondary-motion.md §11).
 */
import * as THREE from 'three';
import { buildVisual } from '../src/champions';
import { FighterAnimator } from '../src/fighter/FighterAnimator';
import { SpringBone } from '../src/fighter/Springs';
import { ClothChain } from '../src/fighter/Cloth';

const [champ = 'rex', fpsArg = '60'] = process.argv.slice(2);
const fps = Number(fpsArg);
const dt = 1 / fps;
const tracks: Record<string, [number, (t: number, r: THREE.Object3D) => void]> = {
  idle: [3, () => {}],
  cruise9: [2, (t, r) => { r.position.z = t < 0.5 ? 9.6 * t * t : 2.4 + 9.6 * (t - 0.5); }],
  cruise30: [2, (t, r) => { r.position.z = t < 0.5 ? 30 * t * t : 7.5 + 30 * (t - 0.5); }],
  stop10: [2.1, (t, r) => { r.position.z = 10 * Math.min(t, 0.6); }],
  spin720: [1, (t, r) => { r.rotation.y = 4 * Math.PI * t; }],
  fall26: [0.8, (t, r) => { r.position.y = -13 * t * t; }],
  tele5: [1, (t, r) => { r.position.x = t >= 0.5 ? 5 : 0; }],
  away20: [2, (_t, r) => { r.position.set(20, 0, 20); }],
};

type Pivoted = { o: { pivot: THREE.Object3D } };
const angleOf = (c: unknown): number => {
  if (c instanceof SpringBone) return 2 * Math.acos(Math.min(1, Math.abs((c as unknown as Pivoted).o.pivot.quaternion.w))) * 57.3;
  if (!(c instanceof ClothChain)) return NaN; // sheets and GLB bone chains are not measured here
  const q = c.o.anchor.getWorldQuaternion(new THREE.Quaternion());
  return c.p[c.o.segments].clone().sub(c.p[0]).angleTo(c.o.restDir.clone().applyQuaternion(q)) * 57.3;
};
const stretchOf = (c: unknown): number => {
  if (!(c instanceof ClothChain)) return 0;
  let L = 0;
  for (let i = 1; i <= c.o.segments; i++) L += c.p[i].distanceTo(c.p[i - 1]);
  return L / c.o.length - 1;
};
const label = (c: unknown, k: number) => (c instanceof SpringBone ? (c as unknown as Pivoted).o.pivot.name || `spring${k}` : c instanceof ClothChain ? `chain${k}` : `item${k}`);

console.log(`${champ} @ ${fps} fps — per item: peak/final degrees off rest; stretch = worst chain`);
for (const [name, [dur, track]] of Object.entries(tracks)) {
  const v = buildVisual(champ as never);
  const a = new FighterAnimator(v);
  if (process.env.NOCOL) for (const c of v.cloth) if (c instanceof ClothChain) (c as unknown as { colliders: unknown[] }).colliders.length = 0;
  // settle for a second before the track starts
  for (let i = 0; i < fps; i++) a.update(dt, false);
  const peak = v.cloth.map(() => 0);
  const end = v.cloth.map(() => 0);
  let maxStretch = 0;
  for (let i = 1; i <= Math.round(dur * fps); i++) {
    track(i * dt, v.root);
    // still air (the game feeds arena wind)
    a.wind.set(0, 0, 0);
    a.update(dt, false);
    v.cloth.forEach((c, k) => {
      end[k] = angleOf(c);
      peak[k] = Math.max(peak[k], end[k]);
      maxStretch = Math.max(maxStretch, stretchOf(c));
    });
  }
  const items = v.cloth.map((c, k) => (Number.isNaN(end[k]) ? '' : `${label(c, k)} ${peak[k].toFixed(0)}/${end[k].toFixed(0)}`)).filter(Boolean);
  console.log(name.padEnd(9), 'stretch', `${(maxStretch * 100).toFixed(0)}%`.padStart(4), ' ', items.join('  '));
}
