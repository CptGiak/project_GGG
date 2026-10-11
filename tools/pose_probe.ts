/**
 * Prints where a champion's hands, head and feet end up in its clips (model space), to tune
 * IK targets numerically: npx tsx tools/pose_probe.ts <champ> <clip@t> [...]
 */
import * as THREE from 'three';
import { buildVisual } from '../src/champions';
import { FighterAnimator } from '../src/fighter/FighterAnimator';

const [champ, ...specs] = process.argv.slice(2);
const fmt = (v: THREE.Vector3) => `[${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}]`;
for (const spec of specs.length ? specs : ['idle']) {
  const v = buildVisual(champ);
  const a = new FighterAnimator(v);
  const [name, t] = spec.split('@');
  if (name !== 'idle') a.play(name, { speed: 0, hold: true, fadeIn: 0, offset: Number(t ?? 0) });
  for (let i = 0; i < 30; i++) a.update(1 / 60, false, false);
  v.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(v.rig.root.matrixWorld).invert();
  const at = (o: THREE.Object3D, local = new THREE.Vector3()) => o.localToWorld(local.clone()).applyMatrix4(inv);
  const B = v.rig.byName;
  // paw centre: 5.5 cm down the hand bone; head centre: the skull ellipsoid
  // right temple: the side of the skull, a little above and in front of its centre (paw radius out)
  const temple = at(B.head, new THREE.Vector3(-0.255, 0.27, 0.1));
  const out = at(B.head, new THREE.Vector3(-0.355, 0.29, 0.11)).sub(temple).normalize();
  console.log(spec.padEnd(12), 'temple', fmt(temple), 'out', fmt(out));
  console.log(spec.padEnd(12), 'pawR', fmt(at(B.handR, new THREE.Vector3(0, -0.055, 0))), 'pawL', fmt(at(B.handL, new THREE.Vector3(0, -0.055, 0))), 'head', fmt(at(B.head, new THREE.Vector3(0, 0.2, 0.03))), 'shR', fmt(at(B.upperArmR)));
}
