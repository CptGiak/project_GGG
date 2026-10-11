import * as THREE from 'three';
import type { MatchContext } from '../../game/types';
import type { ProjectileFx } from '../Projectiles';
import { Shape } from '../../vfx/Particles';
import { Seg, type SegSpec } from '../../vfx/Segments';
import { Decal } from '../../vfx/Decals';
import { bloomColor } from '../../vfx/color';
import { alongView, lineView, sprayDir } from '../../vfx/view';
import { Beat } from '../../core/Beat';

/**
 * REX's effects (design: references/vfx-design.md §10). Gameplay layer first: beam width = hit
 * width, the Sub Bomb telegraph is drawn at the exact blast radius, notes are as wide as their hit
 * sphere. Colours go through bloomColor() so violet and gold bloom alike at the same tier.
 * Everything here is visual only and runs for local, bot and remote copies alike.
 */

// palette (tiers: 0.3-0.9 mid, no bloom · 1.2 halo · 2 strong · 4 flash · 6 impact frame)
const V = '#9b5cff';
const G = '#ffc94a';
const WG = '#fff4dc';
const WV = '#f2e8ff';
const RED = '#ff3b6b';
const c = (hex: string, tier: number) => bloomColor(hex, tier);
const COL = {
  wg3: c(WG, 3), wg4: c(WG, 4), wg5: c(WG, 5), wg6: c(WG, 6),
  wv2: c(WV, 2),
  v04: c(V, 0.4), v06: c(V, 0.6), v07: c(V, 0.7), v09: c(V, 0.9), v12: c(V, 1.2), v2: c(V, 2),
  g06: c(G, 0.6), g08: c(G, 0.8), g12: c(G, 1.2), g15: c(G, 1.5), g2: c(G, 2), g25: c(G, 2.5),
  red12: c(RED, 1.2), red2: c(RED, 2),
  // mids that stay under the threshold: the body of a beam, fills
  vMid: c(V, 0.8), gMid: c(G, 0.85),
  // beam bodies: big areas, kept below the threshold with every channel <= ~1
  vBody: c(V, 0.36), gBody: c(G, 0.42), redBody: c(RED, 0.4),
  wg2: c(WG, 2),
  black: new THREE.Color(0, 0, 0),
  telV: c(V, 0.9), telFill: c(V, 0.12), telEnemy: c('#ff4a3d', 0.9), telEnemyFill: c('#ff4a3d', 0.12),
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _v = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);
const _seg: SegSpec = { a: _a, b: _b, w: 0.1, core: COL.wg3, edge: COL.v07, life: 0.1, style: Seg.tracer };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
function randDir(out: THREE.Vector3): THREE.Vector3 {
  const u = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(t), u, s * Math.sin(t));
}
/** a unit vector perpendicular to d (prefers the horizontal side) */
function sideOf(d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.crossVectors(d, _up);
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
  return out.normalize();
}

function seg(m: MatchContext, a: THREE.Vector3, b: THREE.Vector3, o: Omit<SegSpec, 'a' | 'b'>): void {
  _seg.a = a;
  _seg.b = b;
  _seg.w = o.w;
  _seg.w1 = o.w1;
  _seg.core = o.core;
  _seg.edge = o.edge;
  _seg.life = o.life;
  _seg.style = o.style;
  _seg.alpha = o.alpha;
  _seg.ink = o.ink;
  _seg.noise = o.noise;
  _seg.seed = o.seed;
  m.vfx.seg.emit(_seg);
}

/** ground height under p (within 12 m), or null */
function groundBelow(m: MatchContext, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null {
  const hit = m.world.raycast(p, _down, 12);
  if (!hit || hit.normal.y < 0.6) return null;
  return out.copy(hit.point);
}

// =============================================================================================
// hit tiers (§10.6)
// =============================================================================================

export type RexTier = 'light' | 'heavy' | 'crit';

/** impact on a fighter, by tier; `k` scales a light hit (falloff, escalating notes) */
export function rexHit(m: MatchContext, tier: RexTier, at: THREE.Vector3, dir: THREE.Vector3, k = 1): void {
  const fx = m.vfx;
  // On the line of fire (the shooter: target on the crosshair; the target: its own body in front of
  // the camera) the hit is a small sharp impact frame, then the target again. GGG's hitstop freezes
  // effects too, so everything emitted here is held for the stop: the sparks start already spread.
  const line = lineView(m.camPos, at, dir);
  if (tier === 'light') {
    const sl = k * (1 - 0.4 * line);
    fx.add.emit({ pos: at, life: 0.034, size: 0.2 * sl, size1: 0.24 * sl, color: COL.wg3, shape: Shape.star, rot: (Math.floor(Math.random() * 4) * Math.PI) / 8 });
    fx.add.emit({ pos: at, life: 0.12 - 0.04 * line, size: 0.22 * k, size1: 0.4 * k, color: COL.v12, shape: Shape.glow, alpha: 0.8 * (1 - 0.5 * line) });
    for (let i = 0; i < 7; i++) {
      sprayDir(_u, dir, 0.9, line);
      fx.add.emit({ pos: _w.copy(at).addScaledVector(_u, 0.05), vel: _v.copy(_u).multiplyScalar(rnd(6, 12)), life: rnd(0.12, 0.2), size: 0.05, color: i % 2 ? COL.g12 : COL.wg3, shape: Shape.streak, drag: 7, stretch: 2 });
    }
    fx.ring(at, dir, COL.v09, 0.05 * k, 0.22 * k, 0.15);
    // three EQ spikes along the normal
    for (let i = 0; i < 3; i++) {
      randDir(_u).multiplyScalar(0.12).add(dir).normalize();
      _a.copy(at).addScaledVector(sideOf(dir, _side), (i - 1) * 0.06);
      _b.copy(_a).addScaledVector(_u, rnd(0.2, 0.5) * k);
      seg(m, _a, _b, { w: 0.035, core: COL.g15, edge: COL.v12, life: 0.12, style: Seg.bar, seed: Math.random() });
    }
    return;
  }
  const crit = tier === 'crit';
  const s = crit ? 1.25 : 1;
  const so = s * (1 - 0.5 * line);
  const sg = s * (1 - 0.4 * line);
  fx.add.emit({ pos: at, life: 0.05, size: 0.5 * so, size1: 0.6 * so, color: line > 0.5 ? COL.wg4 : crit ? COL.wg6 : COL.wg5, shape: Shape.star6, rot: Math.random() * Math.PI });
  fx.add.emit({ pos: at, life: 0.2 - 0.08 * line, size: 0.35 * sg, size1: 0.8 * sg, color: crit ? COL.g2 : COL.v2, shape: Shape.glow, alpha: 0.75 * (1 - 0.7 * line) });
  fx.ring(at, dir, crit ? COL.g12 : COL.v09, 0.15, 1.1 * s, 0.25);
  if (crit) fx.after(1 / 30, () => fx.ring(at, dir, COL.wg3, 0.1, 0.75, 0.2));
  const n = Math.round((crit ? 26 : 17) * (1 - 0.45 * line));
  for (let i = 0; i < n; i++) {
    sprayDir(_u, dir, 0.8, line);
    fx.add.emit({ pos: _w.copy(at).addScaledVector(_u, 0.12), vel: _v.copy(_u).multiplyScalar(rnd(8, 16)), life: rnd(0.14, 0.3), size: 0.07, color: i % 3 ? COL.g15 : COL.wg3, shape: Shape.streak, drag: 5, stretch: 2.5 });
  }
  for (let i = 0; i < 3; i++) {
    randDir(_v).multiplyScalar(rnd(3, 6));
    fx.alpha.emit({ pos: at, vel: _v, life: rnd(0.4, 0.6), size: 0.1, color: 0x14081f, shape: Shape.shard, gravity: 12, spin: rnd(-12, 12) });
  }
  for (let i = 0; i < 4; i++) {
    randDir(_v).multiplyScalar(rnd(0.6, 1.4));
    fx.alpha.emit({ pos: at, vel: _v, life: rnd(0.45, 0.55), size: 0.18, size1: 0.45, color: 0x6c4aa8, shape: Shape.puff, drag: 3, alpha: 0.55 * (1 - 0.5 * line) });
  }
  // knockback streaks: three short lines leaving along the push
  for (let i = 0; i < 3; i++) {
    _a.copy(at).addScaledVector(randDir(_u), 0.25);
    _b.copy(_a).addScaledVector(dir, -0.6);
    seg(m, _b, _a, { w: 0.05, core: COL.wv2, edge: COL.v07, life: 0.15, style: Seg.tracer });
  }
}

// =============================================================================================
// Beat Shot (§10.1)
// =============================================================================================

/** muzzle of one Beat Shot; spread 0..1 (hot barrel), accent = on the music's kick */
export function beatShotMuzzle(m: MatchContext, from: THREE.Vector3, dir: THREE.Vector3, spread: number, accent: boolean): void {
  const fx = m.vfx;
  const k = accent ? 1.3 : 1;
  fx.add.emit({ pos: from, life: 0.034, size: 0.22 * k, size1: 0.26 * k, color: COL.wg3, shape: Shape.star, rot: (Math.floor(Math.random() * 4) * Math.PI) / 8 });
  fx.add.emit({ pos: from, life: 0.08, size: 0.16, size1: 0.3, color: COL.v12, shape: Shape.glow, alpha: 0.9 });
  sideOf(dir, _side);
  for (const sgn of [1, -1]) {
    _v.copy(_side).multiplyScalar(sgn * 5 * (1 + 0.3 * spread)).addScaledVector(dir, 2);
    fx.add.emit({ pos: from, vel: _v, life: 0.05, size: 0.06 * (1 + 0.3 * spread), color: COL.g12, shape: Shape.streak, stretch: 3 });
  }
  if (accent) {
    fx.ring(_w.copy(from).addScaledVector(dir, 0.1), dir, COL.g12, 0.04, 0.3, 0.18);
    for (let i = 0; i < 2; i++) {
      randDir(_v).addScaledVector(dir, 1.5).normalize().multiplyScalar(rnd(5, 9));
      fx.add.emit({ pos: from, vel: _v, life: 0.12, size: 0.04, color: COL.wg3, shape: Shape.streak, drag: 6, stretch: 2 });
    }
  }
}

/**
 * Projectile hooks for one Beat Shot: a stretched tracer each frame (+ the last frame at 35 %);
 * impacts shrink with the damage falloff (to 70 %).
 */
export function beatShotFx(m: MatchContext, origin: THREE.Vector3, falloff: { from: number; to: number; min: number }): ProjectileFx {
  const o = origin.clone();
  const scaleAt = (at: THREE.Vector3) => 1 - (1 - falloff.min) * THREE.MathUtils.clamp((at.distanceTo(o) - falloff.from) / (falloff.to - falloff.from), 0, 1);
  return {
    tick(pos, _prev, vel) {
      const sp = vel.length();
      const len = THREE.MathUtils.clamp(sp * (1 / 60) * 1.5, 0.6, 4);
      _v.copy(vel).divideScalar(sp || 1);
      // clipped at the muzzle on the first frame
      const back = Math.min(len, pos.distanceTo(o));
      _a.copy(pos).addScaledVector(_v, -back);
      seg(m, _a, pos, { w: 0.06, w1: 0.1, core: COL.wv2, edge: COL.v07, ink: 0.2, life: 0.0256, style: Seg.tracer });
    },
    hit(at, dir, crit) {
      const k = 0.7 + 0.3 * scaleAt(at);
      if (crit) {
        m.vfx.add.emit({ pos: at, life: 0.05, size: 0.3, size1: 0.34, color: COL.wg4, shape: Shape.star6, rot: Math.random() * Math.PI });
        rexHit(m, 'light', at, dir, 1.1);
      } else rexHit(m, 'light', at, dir, k);
      return true;
    },
    wall(at, normal) {
      // a "sound dent" in the surface
      m.vfx.ring(_w.copy(at).addScaledVector(normal, 0.02), normal, COL.v09, 0.03, 0.2, 0.25);
      for (let i = 0; i < 3; i++) {
        randDir(_v).addScaledVector(normal, 1.2).normalize().multiplyScalar(rnd(4, 8));
        m.vfx.add.emit({ pos: at, vel: _v, life: 0.15, size: 0.04, color: COL.g12, shape: Shape.streak, drag: 6, stretch: 2, gravity: 8 });
      }
      return true;
    },
  };
}

// =============================================================================================
// Lead Single (§10.2)
// =============================================================================================

export function slugCast(m: MatchContext, from: THREE.Vector3, dir: THREE.Vector3): void {
  const fx = m.vfx;
  const p = from.clone();
  const d = dir.clone();
  // seen from behind the cone rings are circles around the crosshair: under the bloom there
  const own = alongView(m.camPos, from, dir);
  const ringC = COL.g12.clone().multiplyScalar(1 - 0.7 * own);
  // three gold cone rings on f0 / f1 / f2, each pushing forward and widening
  for (let i = 0; i < 3; i++) {
    fx.after(i / 60, () => fx.ring(_w.copy(p).addScaledVector(d, 0.25 + i * 0.3), d, ringC, 0.15 * (i + 1), 0.24 * (i + 1), 0.12));
  }
  const fl = 1 - 0.35 * own;
  fx.add.emit({ pos: from, life: 0.05, size: 0.32 * fl, size1: 0.36 * fl, color: COL.wg4, shape: Shape.star6, rot: Math.random() * Math.PI });
  fx.add.emit({ pos: from, life: 0.14 - 0.06 * own, size: 0.2, size1: 0.45 * fl, color: COL.g12, shape: Shape.glow, alpha: 0.7 * (1 - 0.65 * own) });
  sideOf(dir, _side);
  for (let i = 0; i < 4; i++) {
    _v.copy(_side).multiplyScalar((i % 2 ? 1 : -1) * rnd(4, 7)).addScaledVector(dir, rnd(3, 6)).addScaledVector(_up, rnd(-1, 1));
    fx.add.emit({ pos: from, vel: _v, life: 0.1, size: 0.05, color: COL.wg3, shape: Shape.streak, drag: 5, stretch: 3 });
  }
}

/** the slug in flight: stretched gold head, two-layer ribbon, staff lines, a bass ripple every 4.5 m */
export function slugFx(m: MatchContext, origin: THREE.Vector3, onRefund: () => void): ProjectileFx {
  const o = origin.clone();
  let travelled = 0;
  let nextRipple = 1.5;
  return {
    tick(pos, prev, vel) {
      const sp = vel.length();
      _v.copy(vel).divideScalar(sp || 1);
      const step = pos.distanceTo(prev);
      travelled += step;
      const len = Math.min(4.5, sp / 60 * 2, pos.distanceTo(o));
      _a.copy(pos).addScaledVector(_v, -len);
      // head: gold core, violet body, ink rim
      seg(m, _a, pos, { w: 0.22, w1: 0.5, core: COL.wg4, edge: COL.g08, ink: 0.5, life: 0.0256, style: Seg.tracer });
      // ribbon: additive gold + a dark violet under-layer, 8 m long at 135 m/s
      seg(m, prev, pos, { w: 0.34, core: COL.g06, edge: COL.v06, life: 0.25, style: Seg.ribbon });
      seg(m, prev, pos, { w: 0.5, core: COL.black, edge: COL.black, ink: 0.35, life: 0.15, style: Seg.ribbon });
      // staff lines
      for (const s of [0.15, -0.15]) {
        _a.copy(prev).addScaledVector(_up, s);
        _b.copy(pos).addScaledVector(_up, s);
        seg(m, _a, _b, { w: 0.02, core: COL.g06, edge: COL.v06, life: 0.2, style: Seg.ribbon });
      }
      while (travelled >= nextRipple) {
        _w.copy(pos).addScaledVector(_v, nextRipple - travelled);
        m.vfx.ring(_w, _v, COL.v06, 0.15, 0.45, 0.2);
        nextRipple += 4.5;
      }
    },
    hit(at, dir, crit) {
      rexHit(m, crit ? 'crit' : 'heavy', at, dir);
      onRefund();
      return true;
    },
    wall(at, normal) {
      m.vfx.ring(_w.copy(at).addScaledVector(normal, 0.03), normal, COL.v09, 0.1, 0.6, 0.25);
      for (let i = 0; i < 6; i++) {
        randDir(_v).addScaledVector(normal, 1.2).normalize().multiplyScalar(rnd(5, 10));
        m.vfx.add.emit({ pos: at, vel: _v, life: rnd(0.15, 0.25), size: 0.05, color: COL.g12, shape: Shape.streak, drag: 5, stretch: 2, gravity: 8 });
      }
      if (normal.y > 0.6) m.vfx.decals.add({ pos: at, r: 0.7, color: COL.v12, fill: COL.v04, ink: 0.7, life: 1.5, style: Decal.scorch });
      return true;
    },
  };
}

/** refund tell: a gold ring contracting around the rifle */
export function refundTell(m: MatchContext, muzzle: THREE.Vector3, dir: THREE.Vector3): void {
  m.vfx.ring(muzzle, dir, COL.g08, 0.45, 0.15, 0.2);
}

// =============================================================================================
// Bass Charge (§10.3)
// =============================================================================================

/**
 * Per frame while charging: energy streaks drawn in toward the muzzle (12 -> 60 /s with the
 * charge), contracting rings at 0 / 0.32 / 0.64 s, overcharge sparks. `t` = seconds held.
 */
export function chargeTick(m: MatchContext, muzzle: THREE.Vector3, t: number, k: number, state: number, dt: number): void {
  const fx = m.vfx;
  const rate = state === 2 ? 20 : 12 + 48 * k * k;
  const nEmit = Math.floor(rate * dt + Math.random());
  for (let i = 0; i < nEmit; i++) {
    if (state === 2) {
      randDir(_v).multiplyScalar(rnd(3, 6));
      fx.add.emit({ pos: muzzle, vel: _v, life: rnd(0.12, 0.22), size: 0.04, color: COL.red12, shape: Shape.streak, stretch: 2, drag: 4 });
      continue;
    }
    // spawn 1.4 m out, fly in to arrive as the particle dies (0.3 s)
    randDir(_u);
    _w.copy(muzzle).addScaledVector(_u, 1.4);
    _v.copy(_u).multiplyScalar(-1.4 / 0.3);
    fx.add.emit({ pos: _w, vel: _v, life: 0.3, size: 0.035, size1: 0.02, color: k > 0.98 ? COL.g12 : COL.v12, shape: Shape.streak, stretch: 2.5 });
  }
  // contracting rings at 0 / 0.32 / 0.64 s
  for (const at of [0, 0.32, 0.64]) {
    if (t - dt < at && t >= at) fx.ring(muzzle, _u.copy(m.camPos).sub(muzzle).normalize(), COL.v06, 0.5, 0.08, 0.3);
  }
}

/** the perfect window opens: flash + the approach ring snapping onto the orb */
export function perfectSnap(m: MatchContext, muzzle: THREE.Vector3): void {
  m.vfx.add.emit({ pos: muzzle, life: 0.034, size: 0.26, size1: 0.32, color: COL.wg4, shape: Shape.star, rot: Math.PI / 4 });
  m.vfx.ring(muzzle, _u.copy(m.camPos).sub(muzzle).normalize(), COL.g12, 0.7, 0.5, 0.1);
}

/**
 * The beam (hit radius 0.2 m, perfect 0.35 m): drawn 1.4x the hit width for 1-2 frames, easing
 * to exactly the hit width, then erased from the muzzle toward the target while thinning; rings
 * every 6 m travel with the energy at 400 m/s; sparks along it; muzzle and impact caps.
 */
export function beamFx(m: MatchContext, from: THREE.Vector3, to: THREE.Vector3, k: number, perfect: boolean, over: number, wall: boolean): void {
  const fx = m.vfx;
  const hitW = 2 * (perfect ? 0.35 : 0.2) * (over > 0 ? 1 - 0.25 * over : 1);
  const len = from.distanceTo(to);
  const dir = _v.subVectors(to, from).divideScalar(len || 1);
  const life = perfect ? 0.3 : 0.24;
  const p0 = from.clone();
  const d0 = dir.clone();
  // the body in REX's colour stays under the bloom threshold (channels <= 1, the hue survives), only
  // the thin core blooms. A narrow throat for the first 3 m keeps the shooter's own view clear.
  const core = perfect ? COL.wg3 : COL.wg2;
  const body = over > 0 ? COL.redBody : perfect ? COL.gBody : COL.vBody;
  const throat = Math.min(3, len * 0.3);
  _a.copy(from).addScaledVector(dir, throat);
  seg(m, from, _a, { w: hitW * 0.3, w1: hitW, core, edge: body, ink: 0.3, noise: 0.3, life, style: Seg.beam });
  seg(m, _a, to, { w: hitW, core, edge: body, ink: 0.35, noise: over > 0 ? 1 : 0.5, life, style: Seg.beam });
  // caps (the shooter looks down the beam: the target's glow stays dim and short for them)
  const own = alongView(m.camPos, from, dir);
  const mf = 1 - 0.6 * own;
  fx.add.emit({ pos: from, life: 0.05, size: 0.3 * mf, size1: 0.34 * mf, color: perfect && own < 0.5 ? COL.wg4 : COL.wg3, shape: Shape.star6, rot: Math.random() * Math.PI });
  fx.add.emit({ pos: to, life: 0.05, size: 0.3, size1: 0.36, color: COL.wg3, shape: Shape.star, rot: Math.random() * Math.PI });
  fx.add.emit({ pos: to, life: 0.25 - 0.1 * own, size: 0.25, size1: 0.6, color: perfect ? COL.g12 : COL.v12, shape: Shape.glow, alpha: 0.6 * (1 - 0.6 * own) });
  if (wall) fx.ring(to, _u.copy(dir).negate(), COL.g12, 0.1, 0.8, 0.3);
  // rings riding the energy (every 6 m, cap 12) and sparks (one per 1.5 m, cap 40)
  const nRings = Math.min(12, Math.floor(len / 6));
  for (let i = 1; i <= nRings; i++) {
    const dist = i * 6;
    fx.after(dist / 400, () => fx.ring(_w.copy(p0).addScaledVector(d0, dist), d0, i % 2 ? COL.v06 : COL.g06, 0.15, 0.6 + k * 0.2, 0.3));
  }
  if (perfect) {
    const pc = COL.wg3.clone().multiplyScalar(1 - 0.85 * own);
    fx.ring(_w.copy(p0).addScaledVector(d0, 1.5), d0, pc, 0.1, 1.3, 0.3);
    fx.after(0.05, () => fx.ring(_w.copy(p0).addScaledVector(d0, 2.5), d0, pc, 0.1, 1.0, 0.28));
  }
  const nSparks = Math.min(40, Math.floor(len / 1.5));
  sideOf(dir, _side);
  for (let i = 0; i < nSparks; i++) {
    _w.copy(from).addScaledVector(dir, (i + Math.random()) * 1.5);
    randDir(_u).multiplyScalar(rnd(2, 5)).addScaledVector(dir, rnd(2, 6));
    fx.add.emit({ pos: _w, vel: _u, life: rnd(0.15, 0.35), size: 0.04, color: i % 3 ? COL.g12 : COL.wg3, shape: Shape.streak, drag: 3, stretch: 2 });
  }
}

/** stance ring under REX while he charges (he moves at half speed); returns a decal handle */
export function plantedRing(m: MatchContext, feet: THREE.Vector3): number {
  return m.vfx.decals.add({ pos: feet, r: 0.8, border: 0.04, color: COL.v06, life: Infinity, style: Decal.planted });
}

// =============================================================================================
// Sub Bomb (§10.4)
// =============================================================================================

export function bombRelease(m: MatchContext, hand: THREE.Vector3): void {
  m.vfx.add.emit({ pos: hand, life: 0.034, size: 0.15, size1: 0.2, color: COL.wg3, shape: Shape.star });
  m.vfx.add.emit({ pos: hand, life: 0.12, size: 0.12, size1: 0.3, color: COL.v12, shape: Shape.glow });
}

/**
 * Flight: violet ribbon, a sub ring on every eighth note, the fuse telegraph at the exact blast
 * radius from the first bounce (or 0.5 s), filling as it fuses and blinking for the last 150 ms.
 */
export function bombFx(m: MatchContext, radius: number, fuse: number, enemyView: boolean): ProjectileFx & { kill(): void } {
  let tel = -1;
  let bounced = false;
  let lastEighth = Math.floor(Beat.beats * 2);
  const ground = new THREE.Vector3();
  const kill = () => {
    if (tel >= 0) m.vfx.decals.kill(tel);
    tel = -1;
  };
  return {
    kill,
    tick(pos, prev, _vel, age) {
      seg(m, prev, pos, { w: 0.16, core: COL.g06, edge: COL.v07, life: 0.2, style: Seg.ribbon });
      const e = Math.floor(Beat.beats * 2);
      if (e !== lastEighth) {
        lastEighth = e;
        m.vfx.ring(pos, _u.copy(m.camPos).sub(pos).normalize(), COL.v06, 0.1, 0.4, 0.25);
      }
      if ((bounced || age > 0.5) && groundBelow(m, pos, ground)) {
        if (tel < 0) {
          tel = m.vfx.decals.add({
            pos: ground, r: radius, border: 0.08, ink: 0.5,
            color: enemyView ? COL.telEnemy : COL.telV, fill: enemyView ? COL.telEnemyFill : COL.telFill,
            life: Infinity, style: Decal.telegraph,
          });
        }
        m.vfx.decals.move(tel, ground);
        const left = fuse - age;
        m.vfx.decals.progress(tel, THREE.MathUtils.clamp(age / fuse, 0, 1), left < 0.15 && Math.floor(left * 30) % 2 === 0);
      } else if (tel >= 0 && !groundBelow(m, pos, ground)) kill();
    },
    bounce(at, normal) {
      bounced = true;
      if (normal.y > 0.6) m.vfx.decals.add({ pos: at, r: 0.6, r0: 0.15, border: 0.08, color: COL.v12, life: 0.2, style: Decal.ring });
      else m.vfx.ring(at, normal, COL.v12, 0.15, 0.6, 0.2);
      for (let i = 0; i < 6; i++) {
        randDir(_v).addScaledVector(normal, 1).normalize().multiplyScalar(rnd(1.5, 3));
        m.vfx.alpha.emit({ pos: at, vel: _v, life: 0.4, size: 0.12, size1: 0.3, color: 0xb9aab6, shape: Shape.puff, drag: 4, alpha: 0.7 });
      }
      m.vfx.add.emit({ pos: at, life: 0.034, size: 0.2, size1: 0.24, color: COL.wg3, shape: Shape.star });
    },
  };
}

/** detonation: flash, ground shockwave to the exact radius, air rings, an EQ burst, notes, dust */
export function bombBurst(m: MatchContext, pos: THREE.Vector3, radius: number): void {
  const fx = m.vfx;
  const p = pos.clone();
  fx.add.emit({ pos: p, life: 0.05, size: 1.4, size1: 1.6, color: COL.wg5, shape: Shape.glow });
  fx.add.emit({ pos: p, life: 0.3, size: 1.0, size1: radius * 0.6, color: COL.v2, shape: Shape.glow, alpha: 0.7 });
  fx.add.emit({ pos: p, life: 0.06, size: 0.9, size1: 1.1, color: COL.wg4, shape: Shape.star6, rot: Math.random() * Math.PI });
  const g = groundBelow(m, _w.copy(p).addScaledVector(_up, 0.5), new THREE.Vector3());
  if (g) {
    fx.decals.add({ pos: g, r: radius, r0: 0.5, border: 0.35, ink: 0.6, color: COL.v12, life: 0.25, style: Decal.ring });
    fx.decals.add({ pos: g, r: 2.5, color: COL.g12, fill: COL.v04, ink: 0.8, life: 1.8, style: Decal.scorch });
  }
  // three air cone rings f0 / f4 / f8
  for (let i = 0; i < 3; i++) fx.after((i * 4) / 60, () => fx.ring(p, _up, COL.v09, 0.5, 1.75, 0.25));
  // EQ burst: 24 bars standing on a 1.2 m circle
  const base = g ? g.y + 0.05 : p.y - 0.6;
  for (let i = 0; i < 24; i++) {
    const an = (i / 24) * Math.PI * 2;
    _a.set(p.x + Math.cos(an) * 1.2, base, p.z + Math.sin(an) * 1.2);
    _b.copy(_a).addScaledVector(_up, rnd(0.4, 1.2));
    seg(m, _a, _b, { w: 0.12, core: COL.wg3, edge: i % 2 ? COL.v12 : COL.g12, ink: 0.4, life: 0.42, style: Seg.bar, seed: Math.random() });
  }
  for (let i = 0; i < 30; i++) {
    randDir(_v).multiplyScalar(rnd(8, 16));
    _v.y = Math.abs(_v.y) * 0.6 + 1;
    fx.add.emit({ pos: p, vel: _v, life: rnd(0.2, 0.4), size: 0.07, color: i % 2 ? COL.v12 : COL.g12, shape: Shape.streak, drag: 5, stretch: 2 });
  }
  for (let i = 0; i < 8; i++) {
    _v.set(rnd(-2, 2), rnd(4, 7), rnd(-2, 2));
    fx.add.emit({ pos: p, vel: _v, life: rnd(0.9, 1.2), size: 0.15, color: i % 2 ? COL.v12 : COL.g12, shape: Shape.note, gravity: 6, rot: rnd(-0.3, 0.3), spin: rnd(-1.5, 1.5) });
  }
  for (let i = 0; i < 14; i++) {
    const an = (i / 14) * Math.PI * 2;
    _v.set(Math.cos(an), rnd(0.1, 0.3), Math.sin(an)).multiplyScalar(rnd(4, 6));
    fx.alpha.emit({ pos: _w.copy(p).setY(base + 0.3), vel: _v, life: rnd(0.6, 0.9), size: 0.3, size1: 0.8, color: 0xa898b0, shape: Shape.puff, drag: 3, alpha: 0.6 });
  }
  m.audio.play('explosion', p, 0.9);
  m.shake(0.35, p);
}

// =============================================================================================
// Drop The Beat (§10.5)
// =============================================================================================

/** everyone's warning: a gold column of light on REX */
export function ultAnnounce(m: MatchContext, feet: THREE.Vector3): void {
  _a.copy(feet);
  _b.copy(feet).addScaledVector(_up, 6);
  seg(m, _a, _b, { w: 0.6, core: COL.wg3, edge: COL.g15, life: 0.35, style: Seg.column });
  seg(m, _a, _b, { w: 1.4, core: COL.g06, edge: COL.v07, life: 0.5, style: Seg.column });
}

/** the 32-bar EQ ring at his feet, bouncing through the ult (call every frame; stepped at 20 fps) */
export function ultEqRing(m: MatchContext, feet: THREE.Vector3, t: number, dt: number): void {
  if (Math.floor((t - dt) * 20) === Math.floor(t * 20)) return;
  const pulse = 0.5 + 0.5 * Beat.pulse;
  for (let i = 0; i < 32; i++) {
    const an = (i / 32) * Math.PI * 2 + t * 0.6;
    _a.set(feet.x + Math.cos(an) * 1.1, feet.y + 0.04, feet.z + Math.sin(an) * 1.1);
    _b.copy(_a).addScaledVector(_up, (0.15 + 0.5 * Math.random()) * pulse);
    seg(m, _a, _b, { w: 0.07, core: COL.g15, edge: i % 2 ? COL.v12 : COL.g12, ink: 0.3, life: 0.055, style: Seg.bar, seed: i });
  }
}

/** one note in flight: thin tapering trail, sparkles, staff lines on every third note */
export function noteFx(m: MatchContext, index: number, onHit: (at: THREE.Vector3, dir: THREE.Vector3) => void): ProjectileFx {
  let sparkleT = 0;
  const gold = index % 2 === 0;
  return {
    tick(pos, prev, _vel, age) {
      seg(m, prev, pos, { w: 0.08, core: gold ? COL.g12 : COL.v12, edge: gold ? COL.g06 : COL.v07, life: 0.25, style: Seg.ribbon });
      if (index % 3 === 0) {
        for (const s of [0.12, -0.12]) {
          _a.copy(prev).addScaledVector(_up, s);
          _b.copy(pos).addScaledVector(_up, s);
          seg(m, _a, _b, { w: 0.015, core: COL.g06, edge: COL.v06, life: 0.2, style: Seg.ribbon });
        }
      }
      if (age - sparkleT > 0.08) {
        sparkleT = age;
        m.vfx.add.emit({ pos, vel: randDir(_v).multiplyScalar(0.6), life: 0.3, size: 0.05, size1: 0.01, color: COL.wg3, shape: Shape.star, spin: 4 });
      }
    },
    hit(at, dir) {
      onHit(at, dir);
      return true;
    },
    expire(pos) {
      for (let i = 0; i < 3; i++) {
        randDir(_v).multiplyScalar(1.2);
        m.vfx.add.emit({ pos, vel: _v, life: 0.3, size: 0.08, size1: 0.02, color: gold ? COL.g12 : COL.v12, shape: Shape.note, rot: rnd(-0.3, 0.3) });
      }
    },
  };
}

/** a note lands: light tier, escalating on the same target within 0.4 s; the 12th is a big one */
export function noteHit(m: MatchContext, at: THREE.Vector3, dir: THREE.Vector3, streak: number, last: boolean): void {
  if (last) {
    m.vfx.add.emit({ pos: at, life: 0.05, size: 0.6, size1: 0.7, color: COL.wg5, shape: Shape.star6, rot: Math.random() * Math.PI });
    rexHit(m, 'heavy', at, dir);
    return;
  }
  const k = 1 + 0.1 * Math.min(streak, 8);
  rexHit(m, 'light', at, dir, k);
}

/** launch pop at the muzzle */
export function noteLaunch(m: MatchContext, from: THREE.Vector3, gold: boolean): void {
  m.vfx.add.emit({ pos: from, life: 0.034, size: 0.18, size1: 0.22, color: COL.wg3, shape: Shape.star, rot: Math.random() * Math.PI });
  m.vfx.add.emit({ pos: from, life: 0.1, size: 0.15, size1: 0.35, color: gold ? COL.g12 : COL.v12, shape: Shape.glow });
}
