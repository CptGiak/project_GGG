import * as THREE from 'three';
import type { Fighter } from '../game/Fighter';
import type { HitInfo, MatchContext } from '../game/types';
import { neon, toon, addOutline } from '../render/toon';
import { noteGeometry } from '../fighter/shapes';
import { Shape } from '../vfx/Particles';

export type ProjKind = 'bolt' | 'orb' | 'note' | 'grenade';

export interface ProjectileSpec {
  owner: Fighter;
  kind: ProjKind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  life: number;
  slot: HitInfo['slot'];
  part: string;
  color: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  gravity?: number;
  homing?: { target: Fighter | null; strength: number; delay?: number };
  pierce?: boolean;
  bounce?: number;
  kb?: number;
  stun?: number;
  slow?: number;
  /** explode with this radius on impact / expiry (area damage) */
  explode?: number;
  headshots?: boolean;
  /** remote-owned: visuals only, no hit reporting */
  visualOnly?: boolean;
  scale?: number;
}

interface Proj extends ProjectileSpec {
  obj: THREE.Object3D;
  age: number;
  hitIds: Set<string>;
  dead: boolean;
  bounces: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _n = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

/** Closest points between segments p1q1 and p2q2; returns squared distance, writes c1 & c2. */
export function segSegDist2(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, c1: THREE.Vector3, c2: THREE.Vector3): number {
  const d1 = _a.subVectors(q1, p1);
  const d2 = _b.subVectors(q2, p2);
  const r = _d.subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s: number;
  let t: number;
  if (a <= 1e-9 && e <= 1e-9) {
    c1.copy(p1);
    c2.copy(p2);
    return c1.distanceToSquared(c2);
  }
  if (a <= 1e-9) {
    s = 0;
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-9) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceToSquared(c2);
}

/** Capsule of a fighter (world): returns endpoints */
export function capsule(f: Fighter, a: THREE.Vector3, b: THREE.Vector3): void {
  a.set(f.pos.x, f.pos.y + 0.45, f.pos.z);
  b.set(f.pos.x, f.pos.y + 1.5, f.pos.z);
}

export const CAPSULE_R = 0.45;

export class Projectiles {
  readonly group = new THREE.Group();
  private list: Proj[] = [];
  private pools = new Map<ProjKind, THREE.Object3D[]>();
  private noteGeo = noteGeometry(1.6);

  spawn(s: ProjectileSpec): void {
    const obj = this.take(s.kind, s.color, s.color2 ?? s.color);
    obj.position.copy(s.pos);
    obj.scale.setScalar(s.scale ?? 1);
    obj.visible = true;
    this.list.push({ ...s, pos: s.pos.clone(), vel: s.vel.clone(), obj, age: 0, hitIds: new Set(), dead: false, bounces: 0 });
  }

  clear(): void {
    for (const p of this.list) this.release(p);
    this.list.length = 0;
  }

  private take(kind: ProjKind, color: THREE.ColorRepresentation, color2: THREE.ColorRepresentation): THREE.Object3D {
    const pool = this.pools.get(kind) ?? [];
    this.pools.set(kind, pool);
    let o = pool.pop();
    if (!o) {
      o = this.make(kind);
      this.group.add(o);
    }
    // recolour
    o.traverse((c) => {
      const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m && c.userData.tint === 1) m.color.set(color).multiplyScalar(c.userData.k ?? 2.5);
      if (m && c.userData.tint === 2) m.color.set(color2).multiplyScalar(c.userData.k ?? 2.5);
    });
    return o;
  }

  private release(p: Proj): void {
    p.obj.visible = false;
    const pool = this.pools.get(p.kind)!;
    pool.push(p.obj);
  }

  private make(kind: ProjKind): THREE.Object3D {
    const g = new THREE.Group();
    if (kind === 'bolt') {
      const core = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.9, 4, 8), neon(0xffffff, 3));
      core.rotation.x = Math.PI / 2;
      core.userData = { tint: 0 };
      const glow = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 1.1, 4, 8), neon(0xffffff, 2.2, { additive: true, opacity: 0.6 }));
      glow.rotation.x = Math.PI / 2;
      glow.userData = { tint: 1, k: 1.6 };
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 16), neon(0xffffff, 2.5));
      ring.position.z = -0.25;
      ring.userData = { tint: 2 };
      g.add(core, glow, ring);
    } else if (kind === 'orb') {
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), neon(0xffffff, 3));
      const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), neon(0xffffff, 2, { additive: true, opacity: 0.5 }));
      glow.userData = { tint: 1, k: 1.4 };
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.02, 6, 24), neon(0xffffff, 2.4));
      ring.userData = { tint: 2, spin: 1 };
      g.add(core, glow, ring);
    } else if (kind === 'note') {
      const note = new THREE.Mesh(this.noteGeo, neon(0xffffff, 2.8));
      note.userData = { tint: 1, k: 2.8, spin: 2 };
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), neon(0xffffff, 1.5, { additive: true, opacity: 0.35 }));
      glow.userData = { tint: 2, k: 1.2 };
      g.add(note, glow);
    } else {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), toon({ color: 0x1b1622, spec: 0.6 }));
      addOutline(body, 1.6);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 20), neon(0xffffff, 2.6));
      band.userData = { tint: 1 };
      const band2 = band.clone();
      band2.rotation.y = Math.PI / 2;
      band2.material = neon(0xffffff, 2.6);
      band2.userData = { tint: 2 };
      g.add(body, band, band2);
      g.userData.spin = 1;
    }
    return g;
  }

  update(dt: number, m: MatchContext): void {
    for (const p of this.list) {
      if (p.dead) continue;
      p.age += dt;
      if (p.age >= p.life) {
        if (p.explode) this.detonate(p, m);
        p.dead = true;
        continue;
      }
      // homing
      if (p.homing && p.homing.target && p.homing.target.alive && p.age > (p.homing.delay ?? 0)) {
        // exponential seek toward the target's chest; guidance tightens as it closes in
        p.homing.target.chest(_p);
        _d.subVectors(_p, p.pos);
        const dist = _d.length();
        _d.divideScalar(dist || 1);
        const spd = p.vel.length();
        const k = p.homing.strength * (dist < 10 ? 1.8 : 1);
        _n.copy(_d).multiplyScalar(spd);
        p.vel.lerp(_n, 1 - Math.exp(-k * dt));
        p.vel.setLength(spd);
      }
      if (p.gravity) p.vel.y -= p.gravity * dt;
      const from = _p.copy(p.pos);
      const to = _q.copy(p.pos).addScaledVector(p.vel, dt);
      const segLen = from.distanceTo(to);
      // fighters
      let hitFighter: Fighter | null = null;
      let hitPoint = new THREE.Vector3();
      let best = Infinity;
      const ca = new THREE.Vector3();
      const cb = new THREE.Vector3();
      const c1 = new THREE.Vector3();
      const c2 = new THREE.Vector3();
      for (const f of m.fighters) {
        if (f === p.owner || !f.alive || p.hitIds.has(f.id)) continue;
        if (f.team !== 0 && f.team === p.owner.team) continue;
        capsule(f, ca, cb);
        const d2 = segSegDist2(from, to, ca, cb, c1, c2);
        const rr = CAPSULE_R + p.radius;
        if (d2 < rr * rr) {
          const along = c1.distanceTo(from);
          if (along < best) {
            best = along;
            hitFighter = f;
            hitPoint = c1.clone();
          }
        }
      }
      // world
      let worldHit = false;
      if (segLen > 1e-5) {
        _d.subVectors(to, from).divideScalar(segLen);
        const wh = m.world.raycast(from, _d, segLen + p.radius);
        if (wh && wh.distance < best) {
          worldHit = true;
          if (p.bounce && p.bounces < p.bounce) {
            p.bounces++;
            const vn = p.vel.dot(wh.normal);
            p.vel.addScaledVector(wh.normal, -1.6 * vn).multiplyScalar(0.6);
            p.pos.copy(wh.point).addScaledVector(wh.normal, p.radius + 0.02);
            m.audio.play('hookHit', p.pos, 0.3);
            hitFighter = null;
          } else {
            p.pos.copy(wh.point);
            if (p.explode) this.detonate(p, m);
            else m.vfx.hitSpark(wh.point, wh.normal, p.color, false);
            p.dead = true;
          }
        }
      }
      if (!p.dead && hitFighter && (!worldHit || best < Infinity)) {
        const f = hitFighter;
        if (f.invuln > 0 && f.invuln < 5) {
          // dodged through i-frames: keep flying
          p.hitIds.add(f.id);
        } else {
          p.hitIds.add(f.id);
          if (p.explode) {
            p.pos.copy(hitPoint);
            this.detonate(p, m);
            p.dead = true;
          } else {
            const crit = !!p.headshots && hitPoint.y > f.pos.y + 1.48;
            if (!p.visualOnly && m.isAuthority(p.owner)) {
              const kb = p.kb ? p.vel.clone().normalize().multiplyScalar(p.kb) : undefined;
              m.reportHit(p.owner, f, { slot: p.slot, part: p.part, crit, kb, stun: p.stun, slow: p.slow, at: hitPoint, blockable: true });
            }
            m.vfx.hitSpark(hitPoint, _n.copy(p.vel).normalize().negate(), p.color, crit);
            if (!p.pierce) p.dead = true;
          }
        }
      }
      if (!p.dead && !worldHit) p.pos.copy(to);
      // visuals
      p.obj.position.copy(p.pos);
      if (p.kind === 'bolt' || p.kind === 'note') {
        _n.copy(p.vel).normalize();
        if (_n.lengthSq() > 0) p.obj.quaternion.setFromUnitVectors(Z, _n);
      }
      p.obj.children.forEach((c) => {
        if (c.userData.spin) c.rotation.z += dt * 6 * c.userData.spin;
      });
      if (p.obj.userData.spin) p.obj.rotation.x += dt * 10;
      // trail sparks
      if (p.kind !== 'grenade' && Math.random() < 0.8) {
        m.vfx.add.emit({ pos: p.pos.clone(), vel: p.vel.clone().multiplyScalar(0.05), life: 0.2, size: p.kind === 'bolt' ? 0.12 : 0.16, size1: 0.02, color: p.color2 ?? p.color, shape: Shape.glow, alpha: 0.8 });
      }
    }
    // cleanup
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].dead) {
        this.release(this.list[i]);
        this.list.splice(i, 1);
      }
    }
  }

  private detonate(p: Proj, m: MatchContext): void {
    const r = p.explode ?? 3;
    m.vfx.explosion(p.pos, r, p.color, p.color2 ?? p.color);
    m.audio.play('explosion', p.pos, 0.9);
    m.shake(0.25, p.pos);
    if (p.visualOnly || !m.isAuthority(p.owner)) return;
    for (const f of m.fighters) {
      if (f === p.owner || !f.alive) continue;
      if (f.team !== 0 && f.team === p.owner.team) continue;
      f.chest(_a);
      const d = _a.distanceTo(p.pos);
      if (d > r + CAPSULE_R) continue;
      const fall = THREE.MathUtils.clamp(1 - Math.max(0, d - 1) / (r + 0.5), 0.35, 1);
      const kb = _b.subVectors(_a, p.pos).setY(0).normalize().multiplyScalar((p.kb ?? 10) * fall);
      kb.y = 6 * fall;
      m.reportHit(p.owner, f, { slot: p.slot, part: p.part, scale: fall, kb: kb.clone(), stun: p.stun, slow: p.slow, at: _a.clone(), blockable: false });
    }
  }
}
