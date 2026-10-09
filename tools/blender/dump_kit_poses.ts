/**
 * Like dump_poses.ts, for the champions imported from League of Legends: evaluates their real
 * game poses (locomotion + clips of src/champions/lolAnims.ts + weapon IK, with the body-size
 * animScale) on the model's proportions and writes the model-space bone and weapon-pivot
 * transforms to JSON.
 *
 *   npx tsx tools/blender/dump_kit_poses.ts in.json out.json
 *   in.json: { "spec": BodySpec, "champ": "akali" | "qiyana" | "locke", "grip": ["L", "R"] }
 */
import * as fs from 'node:fs';
import * as THREE from 'three';
import { BONES, Rig, type BodySpec } from '../../src/fighter/Rig';
import { FighterAnimator } from '../../src/fighter/FighterAnimator';
import { applyPose, pose } from '../../src/fighter/Animator';
import { akaliAnims, lockeAnims, lolAnimScale, qiyanaAnims } from '../../src/champions/lolAnims';
import { weaponPivot } from '../../src/champions/common';
import type { ChampionVisual } from '../../src/champions/types';

const [inPath, outPath] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(inPath, 'utf8')) as { spec: BodySpec; champ: 'akali' | 'qiyana' | 'locke'; grip: Array<'L' | 'R'> };
const ANIMS = { akali: akaliAnims, qiyana: qiyanaAnims, locke: lockeAnims };
const dual = cfg.grip.includes('L');

function visual(): ChampionVisual {
  const rig = new Rig(cfg.spec);
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.y = rig.hipHeight;
  rig.root.position.y = -rig.hipHeight;
  pivot.add(rig.root);
  root.add(pivot);
  const wR = weaponPivot(rig.byName.handR, cfg.spec.female);
  const wL = dual ? weaponPivot(rig.byName.handL, cfg.spec.female) : null;
  const dummy = new THREE.Object3D();
  return {
    rig, root, pivot, worldObjects: [], cloth: [], bodySpheres: [], blades: [],
    gearL: dummy, gearR: dummy, nozzle: dummy, weaponR: wR, weaponL: wL, offhandGrip: null, muzzle: null,
    materials: [], tick: () => {}, anims: ANIMS[cfg.champ](), animScale: lolAnimScale(cfg.spec),
  };
}

type Spec = { name: string; label: string; setup: (a: FighterAnimator) => void };
const SPECS: Spec[] = dual
  ? [
      { name: 'rest', label: 'braccia lungo i fianchi', setup: () => {} },
      { name: 'idle', label: 'idle', setup: (a) => { a.st.time = 0.4; } },
      { name: 'run', label: 'corsa', setup: (a) => { a.st.wRun = 1; a.st.runIntensity = 1; a.st.runPhase = Math.PI * 0.5; } },
      { name: 'c1', label: 'attacco: fendente', setup: (a) => { a.play('c1', { speed: 0, hold: true, fadeIn: 0, offset: 0.1 }); } },
      { name: 'c3', label: 'attacco: doppio affondo', setup: (a) => { a.play('c3', { speed: 0, hold: true, fadeIn: 0, offset: 0.12 }); } },
    ]
  : [
      { name: 'rest', label: 'braccia lungo i fianchi', setup: () => {} },
      { name: 'idle', label: 'idle', setup: (a) => { a.st.time = 0.4; } },
      { name: 'run', label: 'corsa', setup: (a) => { a.st.wRun = 1; a.st.runIntensity = 1; a.st.runPhase = Math.PI * 0.5; } },
      { name: 'c1', label: 'attacco: fendente', setup: (a) => { a.play('c1', { speed: 0, hold: true, fadeIn: 0, offset: 0.1 }); } },
      { name: 'wrath', label: "attacco: ira degli elementi", setup: (a) => { a.play('wrath', { speed: 0, hold: true, fadeIn: 0, offset: 0.12 }); } },
    ];

const out: Record<string, unknown> = {};
for (const s of SPECS) {
  const v = visual();
  const a = new FighterAnimator(v);
  if (s.name === 'rest') {
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
  const weapons: Record<string, { p: number[]; q: number[] }> = {};
  for (const [side, w] of [['R', v.weaponR], ['L', v.weaponL]] as const) {
    if (!w) continue;
    m.multiplyMatrices(inv, w.matrixWorld).decompose(p, q, sc);
    weapons[side] = { p: p.toArray(), q: q.toArray() };
  }
  const resting = s.name === 'rest';
  out[s.name] = { label: s.label, bones, weapons, off: resting ? 0 : a.pose.off, grip: { R: resting ? 0 : a.pose.wR.w, L: resting ? 0 : a.pose.wL.w } };
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log('poses:', Object.keys(out).join(', '));
