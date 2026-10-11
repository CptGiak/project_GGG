/**
 * Numeric QA for a champion clip, sampled through the real FighterAnimator (same IK as the game):
 *   npx tsx tools/anim_report.ts <champ> <clip|idle|run|air|fly|dash> [--dur s] [--json out.json] [--hold] [--nofade]
 *
 * Prints key times and events, local angular-speed peaks per bone (pops), weapon IK error (arm can't
 * reach), off-hand slip, elbow / knee straightening, foot sliding, and the speed profile of the
 * muzzle (or right hand). --json writes every frame's tracked points and joint positions for
 * plot_paths.py (motion paths, spacing dots, stick-figure key poses).
 */
import * as THREE from 'three';
import fs from 'node:fs';
import { buildVisual } from '../src/champions';
import { FighterAnimator } from '../src/fighter/FighterAnimator';
import { BONES } from '../src/fighter/Rig';

const BOOL = new Set(['hold', 'nofade']);
const pos: string[] = [];
const opts: Record<string, string | true> = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) pos.push(k);
    else if (BOOL.has(k.slice(2))) opts[k.slice(2)] = true;
    else opts[k.slice(2)] = argv[++i];
  }
}
const flag = (k: string) => opts[k] === true;
const opt = (k: string, d?: string) => (typeof opts[k] === 'string' ? (opts[k] as string) : d);
const [champ, clipName = 'idle'] = pos;
if (!champ) {
  console.log('usage: npx tsx tools/anim_report.ts <champ> <clip> [--dur s] [--json out.json] [--hold] [--nofade]');
  process.exit(1);
}

const FPS = 60;
const dt = 1 / FPS;
const v = buildVisual(champ as Parameters<typeof buildVisual>[0]);
const a = new FighterAnimator(v);
const clip = v.anims.clips[clipName];
const loco = ['idle', 'run', 'air', 'fly', 'dash'].includes(clipName);
if (!clip && !loco) {
  console.log(`no clip "${clipName}". clips: ${Object.keys(v.anims.clips).join(', ')}`);
  process.exit(1);
}
// settle in idle first so fades start from the real stance
for (let i = 0; i < 20; i++) a.update(dt, false, false);
const st = a.st;
if (clipName === 'run') {
  st.wRun = 1;
  st.runIntensity = 1;
} else if (clipName === 'air') {
  st.wAir = 1;
  st.vy = 2;
} else if (clipName === 'fly') st.wFly = 1;
else if (clipName === 'dash') st.wDash = 1;
else if (clip) a.play(clipName, { hold: flag('hold'), ...(flag('nofade') ? { fadeIn: 0 } : {}) });

const dur = Number(opt('dur', String(clip ? clip.duration + 0.25 : clipName === 'run' ? 0.9 : 2)));
const frames = Math.round(dur * FPS) + 1;

const B = v.rig.byName;
const root = v.rig.root;
const inv = new THREE.Matrix4();
const tmp = new THREE.Vector3();
const local = (o: THREE.Object3D, off?: THREE.Vector3) => {
  o.localToWorld(tmp.copy(off ?? new THREE.Vector3()));
  return tmp.applyMatrix4(inv).clone();
};
const track: Record<string, THREE.Object3D | null> = {
  muzzle: v.muzzle,
  weaponR: v.weaponR,
  handR: B.handR,
  handL: B.handL,
  head: B.head,
  chest: B.chest,
  hips: B.hips,
  footL: B.footL,
  footR: B.footR,
};
type Frame = { t: number; pts: Record<string, number[]>; joints: Record<string, number[]> };
const out: Frame[] = [];
const prevQ = BONES.map(() => new THREE.Quaternion());
const peak: Record<string, { v: number; f: number }> = {};
let ikErr = { v: 0, f: 0 };
let offErr = { v: 0, f: 0 };
const elbow = { L: [999, 0], R: [999, 0] };
const knee = { L: [999, 0], R: [999, 0] };
const straightFrames = { L: 0, R: 0 };
const footBase: Record<string, THREE.Vector3 | null> = { footL: null, footR: null };
const slide: Record<string, number> = { footL: 0, footR: 0 };
const ankleY = v.rig.spec.footHeight;

const angleAt = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) => {
  const u = p0.clone().sub(p1).normalize();
  const w = p2.clone().sub(p1).normalize();
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(u.dot(w), -1, 1)));
};

for (let f = 0; f < frames; f++) {
  if (f > 0) a.update(dt, clipName === 'air' || clipName === 'fly', false);
  v.root.updateMatrixWorld(true);
  inv.copy(root.matrixWorld).invert();
  const fr: Frame = { t: f * dt, pts: {}, joints: {} };
  for (const [k, o] of Object.entries(track)) if (o) fr.pts[k] = local(o).toArray();
  for (const name of BONES) fr.joints[name] = local(B[name]).toArray();
  // local angular speed (deg/s): what reads as a "pop" when it spikes
  BONES.forEach((name, i) => {
    const q = B[name].quaternion;
    if (f > 0) {
      const d = Math.min(1, Math.abs(prevQ[i].dot(q)));
      const w = THREE.MathUtils.radToDeg(2 * Math.acos(d)) / dt;
      if (!peak[name] || w > peak[name].v) peak[name] = { v: w, f };
    }
    prevQ[i].copy(q);
  });
  // weapon IK error: where the weapon is vs where the pose asked for it
  if (v.weaponR && a.pose.wR.w > 0.99) {
    const e = local(v.weaponR).distanceTo(a.pose.wR.p);
    if (e > ikErr.v) ikErr = { v: e, f };
  }
  if (v.offhandGrip && a.pose.off > 0.99) {
    const e = local(B.handL).distanceTo(local(v.offhandGrip).sub(new THREE.Vector3()));
    // the hand bone origin is the wrist; the grip sits ~6 cm into the palm
    const slip = Math.max(0, e - 0.075);
    if (slip > offErr.v) offErr = { v: slip, f };
  }
  for (const s of ['L', 'R'] as const) {
    const ea = angleAt(local(B[`upperArm${s}`]), local(B[`foreArm${s}`]), local(B[`hand${s}`]));
    elbow[s][0] = Math.min(elbow[s][0], ea);
    elbow[s][1] = Math.max(elbow[s][1], ea);
    if (ea > 172) straightFrames[s]++;
    const ka = angleAt(local(B[`thigh${s}`]), local(B[`shin${s}`]), local(B[`foot${s}`]));
    knee[s][0] = Math.min(knee[s][0], ka);
    knee[s][1] = Math.max(knee[s][1], ka);
  }
  for (const k of ['footL', 'footR'] as const) {
    const p = local(B[k]);
    if (p.y < ankleY + 0.035) {
      if (!footBase[k]) footBase[k] = p.clone();
      else slide[k] = Math.max(slide[k], Math.hypot(p.x - footBase[k]!.x, p.z - footBase[k]!.z));
    } else footBase[k] = null;
  }
  out.push(fr);
}

const fmt = (n: number, d = 2) => n.toFixed(d);
const keyTimes = clip ? clip.keys.map((k) => fmt(k.t)).join(' ') : '(procedural)';
const events = clip?.opts.events?.map((e) => `${e.id}@${fmt(e.t)}`).join(' ') ?? '';
console.log(`\n${champ.toUpperCase()} · ${clipName}  ${fmt(dur)} s, ${frames} frames @${FPS}  keys: ${keyTimes}${events ? `  events: ${events}` : ''}`);

const peaks = Object.entries(peak).sort((x, y) => y[1].v - x[1].v);
console.log('\nangular speed peaks (local, °/s) — >900 on a non-impact frame usually reads as a pop:');
console.log('  ' + peaks.slice(0, 8).map(([n, p]) => `${n} ${Math.round(p.v)}@f${p.f}`).join('  '));

console.log('\nIK:');
console.log(`  weapon target miss  ${fmt(ikErr.v, 3)} m @f${ikErr.f}${ikErr.v > 0.01 ? '  <- arm cannot reach: the pose asks for more than the arm length' : ''}`);
if (v.offhandGrip) console.log(`  off-hand slip       ${fmt(offErr.v, 3)} m @f${offErr.f}${offErr.v > 0.015 ? '  <- support hand leaves the grip' : ''}`);
console.log(`  elbow L ${Math.round(elbow.L[0])}°..${Math.round(elbow.L[1])}°  R ${Math.round(elbow.R[0])}°..${Math.round(elbow.R[1])}°  (180 = locked straight; locked frames L ${straightFrames.L} R ${straightFrames.R})`);
console.log(`  knee  L ${Math.round(knee.L[0])}°..${Math.round(knee.L[1])}°  R ${Math.round(knee.R[0])}°..${Math.round(knee.R[1])}°`);
console.log(`  foot slide while planted: L ${fmt(slide.footL, 3)} m  R ${fmt(slide.footR, 3)} m${Math.max(slide.footL, slide.footR) > 0.03 ? '  <- feet skate' : ''}`);

// speed profile of the lead point
const lead = out[0].pts.muzzle ? 'muzzle' : 'handR';
const sp = out.map((fr, i) => (i === 0 ? 0 : new THREE.Vector3(...fr.pts[lead]).distanceTo(new THREE.Vector3(...out[i - 1].pts[lead])) / dt));
const pk = sp.reduce((b, s, i) => (s > sp[b] ? i : b), 0);
const bars = sp.map((s) => ' ▁▂▃▄▅▆▇█'[Math.min(8, Math.round((s / Math.max(sp[pk], 1e-6)) * 8))]).join('');
console.log(`\n${lead} speed (peak ${fmt(sp[pk])} m/s @f${pk}):`);
console.log('  ' + bars);
const h0 = out[0].pts.head;
let hp = 0;
for (const fr of out) hp = Math.max(hp, Math.hypot(fr.pts.head[0] - h0[0], fr.pts.head[1] - h0[1], fr.pts.head[2] - h0[2]));
console.log(`  head travel (max from start) ${fmt(hp, 3)} m`);

const json = opt('json');
if (json) {
  fs.writeFileSync(json, JSON.stringify({ champ, clip: clipName, fps: FPS, keys: clip?.keys.map((k) => k.t) ?? [], events: clip?.opts.events ?? [], frames: out }));
  console.log(`\nwrote ${json} (plot: python3 .claude/skills/animation-vfx/scripts/plot_paths.py ${json} --out paths.png)`);
}
