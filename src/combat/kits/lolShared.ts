import * as THREE from 'three';
import type { Fighter } from '../../game/Fighter';
import type { MatchContext } from '../../game/types';
import { Shape } from '../../vfx/Particles';
import { CAPSULE_R, capsule, segSegDist2 } from '../Projectiles';

/** Shared helpers of the League of Legends ports (Akali, Qiyana, Locke). */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Per-enemy marks / stacks with expiry (attacker-side bookkeeping). */
export class Marks {
  private map = new Map<string, { until: number; n: number }>();
  private pulse = 0;

  add(id: string, now: number, dur: number, n = 1, max = 1): void {
    const e = this.map.get(id);
    if (e && e.until > now) {
      e.n = Math.min(max, e.n + n);
      e.until = now + dur;
    } else this.map.set(id, { until: now + dur, n: Math.min(max, n) });
  }

  stacks(id: string, now: number): number {
    const e = this.map.get(id);
    return e && e.until > now ? e.n : 0;
  }

  consume(id: string, now: number): number {
    const n = this.stacks(id, now);
    this.map.delete(id);
    return n;
  }

  clear(): void {
    this.map.clear();
  }

  /** pulsing ground rings under the marked enemies */
  draw(m: MatchContext, dt: number, color: THREE.ColorRepresentation, size = 1): void {
    this.pulse -= dt;
    if (this.pulse > 0) return;
    this.pulse = 0.45;
    for (const [id, e] of this.map) {
      if (e.until <= m.time) {
        this.map.delete(id);
        continue;
      }
      const t = m.fighters.find((o) => o.id === id);
      if (!t || !t.alive) continue;
      for (let i = 0; i < e.n; i++) m.vfx.ring(_v.copy(t.pos).setY(t.pos.y + 0.06 + i * 0.12), UP, color, 0.75 * size, 1.05 * size, 0.42);
    }
  }
}

/** `o` can be hit by `f`: alive, not `f`, not a teammate */
export function foe(f: Fighter, o: Fighter): boolean {
  return o !== f && o.alive && !(o.team !== 0 && o.team === f.team);
}

/** enemies whose capsule passes within `r` of the segment a-b */
export function enemiesAlong(f: Fighter, m: MatchContext, a: THREE.Vector3, b: THREE.Vector3, r: number): Fighter[] {
  const out: Fighter[] = [];
  for (const o of m.fighters) {
    if (!foe(f, o)) continue;
    capsule(o, _c1, _c2);
    if (segSegDist2(a, b, _c1, _c2, _a, _b) < (CAPSULE_R + r) ** 2) out.push(o);
  }
  return out;
}

/** enemies in a horizontal cone in front of `origin` (with line of sight) */
export function enemiesInCone(f: Fighter, m: MatchContext, origin: THREE.Vector3, dir: THREE.Vector3, range: number, halfAngleDeg: number, maxDy = 3): Array<{ o: Fighter; d: number }> {
  const out: Array<{ o: Fighter; d: number }> = [];
  const flat = _v.set(dir.x, 0, dir.z).normalize().clone();
  const cos = Math.cos(THREE.MathUtils.degToRad(halfAngleDeg));
  for (const o of m.fighters) {
    if (!foe(f, o)) continue;
    const c = o.chest(new THREE.Vector3());
    const to = c.clone().sub(origin);
    if (Math.abs(to.y) > maxDy) continue;
    const d = to.length();
    if (d > range + CAPSULE_R) continue;
    const h = to.clone().setY(0);
    if (h.lengthSq() > 0.36 && h.normalize().dot(flat) < cos) continue;
    const hit = m.world.raycast(origin, to.clone().normalize(), d);
    if (hit && hit.distance < d - 0.6) continue;
    out.push({ o, d });
  }
  return out;
}

/** blink / dash afterimage: coloured squares and streaks along the path, rings at both ends */
export function afterimage(f: Fighter, m: MatchContext, from: THREE.Vector3, to: THREE.Vector3, sound = true): void {
  const n = 14;
  const [c0, c1] = f.champ.colors;
  const dir = to.clone().sub(from);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  for (let i = 0; i <= n; i++) {
    const p = from.clone().lerp(to, i / n);
    p.y += (Math.random() - 0.5) * 0.8;
    m.vfx.add.emit({ pos: p, life: 0.35 + Math.random() * 0.2, size: 0.25, size1: 0.02, color: i % 2 ? c0 : c1, shape: Shape.square, alpha: 0.9, rot: 0 });
    m.vfx.add.emit({ pos: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), vel: new THREE.Vector3(0, 0, 0), life: 0.25, size: 0.06, color: 0xffffff, shape: Shape.streak, stretch: 1 });
  }
  m.vfx.ring(from, dir, c0, 0.3, 1.6, 0.3);
  m.vfx.ring(to, dir, c1, 1.6, 0.2, 0.3);
  m.vfx.beam(from, to, c0, 0.08, 0.2);
  if (sound) m.audio.play('teleport', to, 1);
}

/**
 * A frame of a smoke cloud (call every frame while it lasts): a thick wall of smoke on the rim,
 * a thin mist inside so the fighters in it stay readable.
 */
export function smoke(m: MatchContext, center: THREE.Vector3, radius: number, dt: number, tint: THREE.ColorRepresentation): void {
  const n = Math.min(4, Math.ceil(dt * 45));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const rim = Math.random() < 0.8;
    const r = rim ? radius * (0.84 + Math.random() * 0.16) : Math.sqrt(Math.random()) * radius * 0.8;
    const p = new THREE.Vector3(center.x + Math.cos(a) * r, center.y + 0.15 + Math.random() * (rim ? 2.0 : 0.5), center.z + Math.sin(a) * r);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4);
    if (rim) m.vfx.alpha.emit({ pos: p, vel, life: 1.3 + Math.random() * 0.5, size: 1.1 + Math.random() * 0.8, size1: 1.9, color: 0x221b2c, color1: tint, alpha: 0.32, shape: Shape.puff, drag: 1.2 });
    else m.vfx.alpha.emit({ pos: p, vel, life: 1.2, size: 1.0, size1: 1.6, color: 0x2a2236, color1: tint, alpha: 0.16, shape: Shape.puff, drag: 1.2 });
  }
  // glints in the smoke
  if (Math.random() < dt * 6) {
    const a = Math.random() * Math.PI * 2;
    const r = radius * Math.random();
    m.vfx.add.emit({ pos: new THREE.Vector3(center.x + Math.cos(a) * r, center.y + 0.3 + Math.random() * 1.6, center.z + Math.sin(a) * r), vel: new THREE.Vector3(0, 0.6, 0), life: 0.5, size: 0.14, size1: 0.02, color: tint, shape: Shape.star });
  }
}

/** short-lived coloured slash arc in front of a point (wave / blade releases) */
export function slashArc(m: MatchContext, at: THREE.Vector3, dir: THREE.Vector3, width: number, color: THREE.ColorRepresentation, color2: THREE.ColorRepresentation): void {
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  for (let i = -6; i <= 6; i++) {
    const t = i / 6;
    const p = at.clone().addScaledVector(side, t * width).addScaledVector(dir, (1 - t * t) * width * 0.35);
    m.vfx.add.emit({ pos: p, vel: dir.clone().multiplyScalar(6), life: 0.28, size: 0.32, size1: 0.05, color: i % 2 ? color : color2, shape: Shape.streak, stretch: 1.4, drag: 3 });
  }
}
