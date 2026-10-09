/**
 * Evaluates Kaiser's real game poses (locomotion + clips + weapon IK, exactly as in a match)
 * on the GLB skeleton proportions and writes the model-space bone transforms to JSON, so the
 * Blender build can render the same poses to check the skin weights.
 *
 *   npx tsx tools/blender/dump_poses.ts docs/art/blender/kaiser_measurements.json out.json
 */
import * as fs from 'node:fs';
import * as THREE from 'three';
import { BONES, Rig, type BodySpec } from '../../src/fighter/Rig';
import { FighterAnimator } from '../../src/fighter/FighterAnimator';
import { applyPose, pose } from '../../src/fighter/Animator';
import { kaiserAnims } from '../../src/champions/kaiser';
import { marker, weaponPivot } from '../../src/champions/common';
import type { ChampionVisual } from '../../src/champions/types';

const [measPath, outPath] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(measPath, 'utf8')).spec as BodySpec;

function visual(): ChampionVisual {
  const rig = new Rig(spec);
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.y = rig.hipHeight;
  rig.root.position.y = -rig.hipHeight;
  pivot.add(rig.root);
  root.add(pivot);
  const weapon = weaponPivot(rig.byName.handR);
  const offhandGrip = marker(weapon, 0, 0.05, -0.115, 'offhand');
  const dummy = new THREE.Object3D();
  return {
    rig, root, pivot, worldObjects: [], cloth: [], bodySpheres: [], blades: [],
    gearL: dummy, gearR: dummy, nozzle: dummy, weaponR: weapon, weaponL: null, offhandGrip, muzzle: null,
    materials: [], tick: () => {}, anims: kaiserAnims(),
  };
}

type Spec = { name: string; label: string; setup: (a: FighterAnimator) => void };
const SPECS: Spec[] = [
  { name: 'rest', label: 'braccia lungo i fianchi', setup: () => {} },
  { name: 'idle', label: 'idle (spadone in spalla)', setup: (a) => { a.st.time = 0.4; } },
  { name: 'run', label: 'corsa', setup: (a) => { a.st.wRun = 1; a.st.runIntensity = 1; a.st.runPhase = Math.PI * 0.5; } },
  { name: 'atk1', label: 'attacco: fendente', setup: (a) => { a.play('atk1', { speed: 0, hold: true, fadeIn: 0, offset: 0.16 }); } },
  { name: 'atk3', label: 'attacco: schianto', setup: (a) => { a.play('atk3', { speed: 0, hold: true, fadeIn: 0, offset: 0.24 }); } },
];

const out: Record<string, unknown> = {};
for (const s of SPECS) {
  const v = visual();
  const a = new FighterAnimator(v);
  if (s.name === 'rest') {
    // arms hanging along the sides (rest pose with the arms just clear of the coat)
    applyPose(pose({ upperArmL: [0, 0, 10], upperArmR: [0, 0, -10], foreArmL: [-8, 0, 0], foreArmR: [-8, 0, 0] }), v.rig);
  } else {
    s.setup(a);
    for (let i = 0; i < 90; i++) a.update(1 / 60, false);
  }
  v.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(v.rig.root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const bones: Record<string, { p: number[]; q: number[] }> = {};
  for (const name of BONES) {
    m.multiplyMatrices(inv, v.rig.byName[name].matrixWorld).decompose(p, q, sc);
    bones[name] = { p: p.toArray(), q: q.toArray() };
  }
  m.multiplyMatrices(inv, v.weaponR!.matrixWorld).decompose(p, q, sc);
  out[s.name] = { label: s.label, bones, weapon: { p: p.toArray(), q: q.toArray() }, off: a.pose.off };
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log('poses:', Object.keys(out).join(', '));
