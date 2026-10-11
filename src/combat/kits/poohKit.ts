import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AbilitySlot } from '../../../shared/champions';
import { BaseKit, type MeleeHit } from '../BaseKit';
import type { Fighter } from '../../game/Fighter';
import { forwardOf } from '../../game/Fighter';
import type { ActionEvent, Intent, MatchContext } from '../../game/types';
import { MASK_UPPER } from '../../fighter/Animator';
import { addOutline, neon, toon } from '../../render/toon';
import { Shape } from '../../vfx/Particles';
import { foe } from './lolShared';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Object3D();
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

const HONEY = 0xffa51c;
const HONEY_LIGHT = 0xffd36a;

/** honey pots: lob gravity, range, throw interval, splash radius, mesh scale (Super Pots: bigger) */
const POT = { g: 24, range: 45, every: 0.5, release: 0.12, r: 2.0, bigR: 3.0, scale: 1.6, bigScale: 2.4 };
/** puddles: radius, life, goo tick per target, pool size; Pooh licks one up for `heal` */
const PUDDLE = { r: 1.7, bigR: 2.5, life: 5, tick: 0.5, max: 6, heal: 55 };
/** seconds a pot hit leaves an enemy coated in honey (the bees sting harder) */
const HONEYED = 4;
/** belly bump: wind-up, dash speed and length, recovery after the bounce */
const BUMP = { windup: 0.08, speed: 26, dist: 7.5, recover: 0.22 };
/** balloon: float time, rise speed for the first seconds, then a slow drift up */
const BALLOON = { time: 4, rise: 4.5, riseT: 1.1, hover: 0.4 };
/** think: the Idea comes at `idea` s (the action ends at `dur`), heal, Super Pots */
const THINK = { idea: 1.3, dur: 1.6, heal: 180, pots: 3 };
/** bee swarm: life, seek radius, speed, sting radius and interval, bees drawn */
const SWARM = { life: 4.5, seek: 16, speed: 7.5, r: 2.3, every: 0.35, bees: 16 };
/** beehive: lob gravity, range, impact radius, wind-up until the release */
const HIVE = { g: 24, range: 50, r: 3.4, release: 0.42 };
/** the server takes one heal every 3 s */
const HEAL_GAP = 3.1;

interface Puddle {
  obj: THREE.Group;
  pos: THREE.Vector3;
  r: number;
  t: number;
  active: boolean;
}

interface Swarm {
  mesh: THREE.InstancedMesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  t: number;
  /** > 0 while the bees scatter at the end */
  fade: number;
  target: Fighter | null;
  retarget: number;
  tickT: number;
  buzzT: number;
  active: boolean;
  /** per bee: orbit phase, radius, angular speed, height */
  seeds: Float32Array;
}

/** a honey puddle: a wobbly blob with a glossy highlight */
function puddleObject(seed: number): THREE.Group {
  const blob = (k: number) => {
    const shape = new THREE.Shape();
    const n = 30;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = k * (1 + 0.11 * Math.sin(3 * a + seed) + 0.07 * Math.sin(5 * a + seed * 2.3) + 0.04 * Math.sin(8 * a + seed * 0.7));
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    return new THREE.ShapeGeometry(shape, 1).rotateX(-Math.PI / 2);
  };
  const base = toon({ color: 0xf29a12, shade: 0xffc060, spec: 0.35, specSize: 0.94, rim: 0.15 });
  base.polygonOffset = true;
  base.polygonOffsetFactor = -2;
  base.polygonOffsetUnits = -2;
  const shine = toon({ color: HONEY_LIGHT, shade: 0xfff0b0, spec: 0.5, specSize: 0.92, rim: 0.1 });
  shine.polygonOffset = true;
  shine.polygonOffsetFactor = -3;
  shine.polygonOffsetUnits = -3;
  const g = new THREE.Group();
  const m0 = new THREE.Mesh(blob(1), base);
  const m1 = new THREE.Mesh(blob(0.42), shine);
  m1.position.set(0.18, 0.006, -0.12);
  m0.receiveShadow = true;
  g.add(m0, m1);
  g.visible = false;
  return g;
}

/** one cartoon bee (striped body, white wings, stinger), vertex coloured, +Z forward */
function beeGeometry(): THREE.BufferGeometry {
  const paint = (g: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => number) => {
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.set(fn(pos.getX(i), pos.getY(i), pos.getZ(i)));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const body = paint(new THREE.SphereGeometry(1, 10, 8).scale(0.075, 0.066, 0.115), (_x, _y, z) => {
    if (z > 0.072) return 0x1a1208;
    return Math.floor((z + 0.115) / 0.042) % 2 ? 0x1a1208 : 0xffc21a;
  });
  const wings = [-1, 1].map((sx) =>
    paint(new THREE.SphereGeometry(1, 8, 6).scale(0.072, 0.012, 0.046).rotateZ(sx * 0.35).translate(sx * 0.07, 0.07, -0.015), () => 0xf2f8ff),
  );
  const sting = paint(new THREE.ConeGeometry(0.02, 0.06, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.14), () => 0x1a1208);
  return mergeGeometries([body, ...wings, sting], false)!;
}

/**
 * POOH — guest star from the Hundred Acre Wood, a slow ranged brawler.
 * Passive Ghiotto di Miele: pots leave honey puddles that slow enemies; Pooh licks one up as he
 * walks over it and heals (one every 3 s) · Skill (LMB): Panzata, a belly-bump dash (momentum
 * strike, stuns) · Attack (RMB, hold): lobbed HUNNY pots that splash, slow and coat in honey ·
 * Secondary (C): Little Black Rain Cloud, he floats up on a blue balloon for 4 s (C again lets
 * go) · F: Think, Think, Think, he stops to tap his head; the Idea heals him, readies the
 * Panzata and turns the next 3 pots into Super Pots · R: Bee Swarm, a beehive lobbed at the aim
 * point: the bees chase the nearest enemy for 5 s, honey-coated ones get stung harder.
 */
export class PoohKit extends BaseKit {
  readonly sceneObjects: THREE.Object3D[] = [];
  private fireT = 0;
  private aimHold = 0;
  /** pot release countdown (the arm winds up first), whether it is a Super Pot */
  private throwT = 0;
  private superPots = 0;
  /** ult: hive release countdown */
  private hiveT = 0;
  /** think: the Idea already came */
  private ideaDone = false;
  /** belly bump state */
  private dashDir = new THREE.Vector3(0, 0, 1);
  private dashLen = 0;
  private dashSpeed = BUMP.speed;
  private dashing = false;
  private bumped = false;
  /** balloon: float time left (0 = not floating), let go while stunned (broadcast on the next update) */
  private bal = 0;
  private letGoPending = false;
  private readonly balloon: THREE.Group;
  private readonly string: THREE.Line;
  /** the balloon after he lets go: drifts away */
  private freeT = 0;
  private readonly freeVel = new THREE.Vector3();
  /** remote puppet: floating */
  private remoteBal = false;
  private remoteTrailT = 0;
  private remoteHiveT = 0;
  private readonly bulb: THREE.Group;
  private bulbT = 0;
  private readonly puddles: Puddle[] = [];
  private readonly swarms: Swarm[] = [];
  /** enemy id -> time its honey coat runs out */
  private readonly honeyed = new Map<string, number>();
  /** enemy id -> next goo tick */
  private readonly gooAt = new Map<string, number>();
  private healAt = -10;
  private pendingHeal = 0;

  constructor() {
    super('pooh');
    for (let i = 0; i < PUDDLE.max; i++) {
      const obj = puddleObject(i * 1.7 + 0.4);
      this.puddles.push({ obj, pos: new THREE.Vector3(), r: PUDDLE.r, t: 0, active: false });
      this.sceneObjects.push(obj);
    }
    const beeGeo = beeGeometry();
    const beeMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.InstancedMesh(beeGeo, beeMat, SWARM.bees);
      mesh.frustumCulled = false;
      mesh.visible = false;
      const seeds = new Float32Array(SWARM.bees * 4);
      for (let b = 0; b < SWARM.bees; b++) seeds.set([Math.random() * Math.PI * 2, 0.35 + Math.random() * 0.9, (2.5 + Math.random() * 3) * (Math.random() < 0.5 ? -1 : 1), (Math.random() - 0.5) * 0.9], b * 4);
      this.swarms.push({ mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), t: 0, fade: 0, target: null, retarget: 0, tickT: 0, buzzT: 0, active: false, seeds });
      this.sceneObjects.push(mesh);
    }
    // the blue balloon and its string
    this.balloon = new THREE.Group();
    const skin = toon({ color: 0x2f7cff, shade: 0xa8d4ff, spec: 0.95, specSize: 0.86, rim: 0.55 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.62, 22, 16).scale(1, 1.15, 1), skin);
    addOutline(ball, 1.6);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 8), skin);
    knot.position.y = -0.74;
    this.balloon.add(ball, knot);
    this.balloon.visible = false;
    this.string = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: 0x2a2320 }));
    this.string.frustumCulled = false;
    this.string.visible = false;
    // the Idea! lightbulb
    this.bulb = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12).scale(1, 1.1, 1), neon(0xfff2a0, 1.35));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), neon(0xffe066, 1, { additive: true, opacity: 0.22 }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.068, 0.13, 12), toon({ color: 0x9aa1ad, spec: 0.8, specSize: 0.9, rim: 0.3 }));
    cap.position.y = -0.2;
    addOutline(cap, 1.4);
    this.bulb.add(glass, glow, cap);
    this.bulb.visible = false;
    this.sceneObjects.push(this.balloon, this.string, this.bulb);
  }

  facesAim(f: Fighter): boolean {
    return this.aimHold > 0 || super.facesAim(f);
  }

  update(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    super.update(f, it, dt, m);
    if (this.letGoPending) {
      this.letGoPending = false;
      m.audio.play('pop', f.pos, 0.6);
      m.broadcastAction(f, { a: 'bal', n: 0 });
    }
    if (this.throwT > 0) {
      this.throwT -= dt;
      if (this.throwT <= 0) this.releasePot(f, m);
    }
    if (this.pendingHeal > 0 && m.time >= this.healAt && f.alive) {
      m.reportHeal(f, this.pendingHeal);
      this.pendingHeal = 0;
      this.healAt = m.time + HEAL_GAP;
    }
  }

  protected handleInput(f: Fighter, it: Intent, dt: number, m: MatchContext): void {
    this.fireT -= dt;
    this.aimHold = Math.max(0, this.aimHold - dt);
    if (this.bal > 0) this.floatTick(f, dt, m);
    if (this.act === 'think' || this.act === 'bump' || this.act === 'ult') return;

    // ---- R: Bee Swarm -------------------------------------------------------------------------------
    if (it.ultimatePressed && !this.act && this.useUlt(f, m)) {
      this.startUlt(f, m);
      return;
    }
    // ---- F: Think, Think, Think (on his feet only: he stops to think) ---------------------------------
    if (it.abilityPressed && this.cd.abi <= 0 && !this.act) {
      if (!f.grounded || this.bal > 0) m.audio.play('uiBack', f.pos, 0.5);
      else {
        this.startThink(f, m);
        return;
      }
    }
    // ---- C: balloon / let go ------------------------------------------------------------------------
    if (it.secondaryPressed) {
      if (this.bal > 0) this.letGo(f, m, true);
      else if (this.cd.sec <= 0 && !this.act) this.startBalloon(f, m);
    }
    // ---- LMB: Panzata -------------------------------------------------------------------------------
    if (!this.act && this.skillReady()) {
      this.startBump(f, it, m);
      return;
    }
    // ---- RMB: honey pots (hold) -----------------------------------------------------------------------
    if (it.attack && !this.act) {
      f.ctrl.aim = 1;
      this.aimHold = 0.45;
      if (this.fireT <= 0 && this.throwT <= 0) {
        this.fireT = POT.every;
        this.beginThrow(f);
      }
    } else f.ctrl.aim = this.aimHold > 0 ? 1 : 0;
  }

  private paw(f: Fighter, out: THREE.Vector3): THREE.Vector3 {
    return f.visual.muzzle ? f.visual.muzzle.getWorldPosition(out) : f.chest(out);
  }

  /** ballistic velocity from `from` that lands on `to` */
  private lobVel(from: THREE.Vector3, to: THREE.Vector3, g: number, speed: number): THREE.Vector3 {
    const delta = to.clone().sub(from);
    const t = THREE.MathUtils.clamp(delta.length() / speed, 0.25, 1.1);
    const vel = delta.multiplyScalar(1 / t);
    vel.y += 0.5 * g * t;
    return vel;
  }

  // ---- honey pots ---------------------------------------------------------------------------------

  private beginThrow(f: Fighter): void {
    this.throwT = POT.release;
    if (this.bal > 0) f.anim.play('balloonThrow', { fadeIn: 0.04 });
    else f.anim.play('throw', { fadeIn: 0.04, mask: MASK_UPPER });
    f.visual.prop?.('pot', true);
  }

  private releasePot(f: Fighter, m: MatchContext): void {
    f.visual.prop?.('pot', false);
    const big = this.superPots > 0;
    if (big) this.superPots--;
    const from = this.paw(f, new THREE.Vector3());
    const { point } = this.aimPoint(f, m, POT.range);
    const vel = this.lobVel(from, point, POT.g, 30);
    this.spawnPot(f, m, from, vel, big, false);
    this.aimHold = 0.35;
    m.broadcastAction(f, { a: 'pot', p: [from.x, from.y, from.z], d: [vel.x, vel.y, vel.z], n: big ? 1 : 0 });
  }

  private spawnPot(f: Fighter, m: MatchContext, from: THREE.Vector3, vel: THREE.Vector3, big: boolean, visualOnly: boolean): void {
    m.projectiles.spawn({
      owner: f, kind: 'pot', pos: from, vel, radius: big ? 0.36 : 0.26, life: 1.9, gravity: POT.g, explode: big ? POT.bigR : POT.r, kb: big ? 6 : 3, kbUp: 2.5, blast: false,
      slot: 'atk', part: big ? 'big' : 'pot', slow: big ? 1.6 : 1, color: HONEY, color2: HONEY_LIGHT, scale: big ? POT.bigScale : POT.scale, visualOnly,
      onHit: (o) => this.coat(f, o, m, true),
      onBurst: (p) => this.splash(f, m, p, big),
    });
    m.audio.play('lob', from, big ? 0.9 : 0.6);
    if (big) m.vfx.ring(from, UP, HONEY_LIGHT, 0.2, 1, 0.25);
  }

  /** the pot breaks: honey everywhere, clay shards, a puddle on the ground below */
  private splash(f: Fighter, m: MatchContext, p: THREE.Vector3, big: boolean): void {
    const n = big ? 28 : 16;
    const spread = big ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = spread * (0.35 + Math.random() * 0.8);
      m.vfx.alpha.emit({ pos: p.clone().setY(p.y + 0.25), vel: new THREE.Vector3(Math.cos(a) * s, 3 + Math.random() * 5, Math.sin(a) * s), life: 0.55 + Math.random() * 0.35, size: 0.15 + Math.random() * 0.14, size1: 0.05, color: i % 3 ? HONEY : HONEY_LIGHT, shape: Shape.glow, gravity: 22, drag: 1 });
    }
    for (let i = 0; i < (big ? 10 : 6); i++) {
      const a = Math.random() * Math.PI * 2;
      m.vfx.alpha.emit({ pos: p.clone().setY(p.y + 0.2), vel: new THREE.Vector3(Math.cos(a) * 5, 4 + Math.random() * 3, Math.sin(a) * 5), life: 0.7, size: 0.13, color: 0xc77a35, shape: Shape.shard, gravity: 20, spin: 9 });
    }
    m.vfx.ring(p.clone().setY(p.y + 0.12), UP, HONEY, 0.3, (big ? POT.bigR : POT.r) * 1.15, 0.35);
    m.audio.play('splat', p, big ? 1 : 0.75);
    const g = m.world.raycast(p.clone().setY(p.y + 0.4), DOWN, 6);
    if (g && g.normal.y > 0.55) this.addPuddle(g.point, g.normal, big ? PUDDLE.bigR : PUDDLE.r);
    void f;
  }

  /** an enemy covered in honey: the bees sting it harder (`announce`: tell the other clients) */
  private coat(f: Fighter, o: Fighter, m: MatchContext, announce: boolean): void {
    const was = this.honeyed.get(o.id) ?? 0;
    this.honeyed.set(o.id, Math.max(was, m.time + (announce ? HONEYED : 2)));
    if (announce && was - m.time < 1.5) m.broadcastAction(f, { a: 'honey', t: o.id });
  }

  private isHoneyed(o: Fighter, m: MatchContext): boolean {
    return (this.honeyed.get(o.id) ?? 0) > m.time;
  }

  private addPuddle(point: THREE.Vector3, normal: THREE.Vector3, r: number): void {
    // landing on (or next to) a fresh puddle feeds it instead of stacking a new one
    for (const pd of this.puddles) {
      if (pd.active && pd.pos.distanceTo(point) < Math.max(pd.r, r) * 0.7) {
        pd.t = Math.min(pd.t, 0.15);
        pd.r = Math.min(PUDDLE.bigR * 1.2, Math.max(pd.r, r) + 0.2);
        return;
      }
    }
    let pd = this.puddles.find((x) => !x.active);
    if (!pd) pd = this.puddles.reduce((a, b) => (a.t > b.t ? a : b));
    pd.active = true;
    pd.t = 0;
    pd.r = r;
    pd.pos.copy(point);
    pd.obj.position.copy(point).addScaledVector(normal, 0.03);
    pd.obj.quaternion.setFromUnitVectors(UP, normal);
    pd.obj.rotateY(Math.random() * Math.PI * 2);
    pd.obj.scale.set(0.01, 1, 0.01);
    pd.obj.visible = true;
  }

  private removePuddle(pd: Puddle, m: MatchContext): void {
    pd.active = false;
    pd.obj.visible = false;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      m.vfx.add.emit({ pos: pd.pos.clone().add(new THREE.Vector3(Math.cos(a) * pd.r * 0.6, 0.1, Math.sin(a) * pd.r * 0.6)), vel: new THREE.Vector3(-Math.cos(a) * 2, 2.5 + Math.random() * 2, -Math.sin(a) * 2), life: 0.5, size: 0.14, size1: 0.02, color: HONEY_LIGHT, shape: Shape.glow, drag: 2 });
    }
    m.audio.play('slurp', pd.pos, 0.8);
  }

  private tickPuddles(f: Fighter, dt: number, m: MatchContext): void {
    const authority = m.isAuthority(f);
    for (const pd of this.puddles) {
      if (!pd.active) continue;
      pd.t += dt;
      if (pd.t >= PUDDLE.life) {
        pd.active = false;
        pd.obj.visible = false;
        continue;
      }
      const k = Math.min(1, pd.t / 0.15) * Math.min(1, (PUDDLE.life - pd.t) / 0.6);
      pd.obj.scale.set(pd.r * k, 1, pd.r * k);
      // Pooh licks it up when he walks over it hurt (one every 3 s, the heal is server-checked)
      if (f.simulated && f.alive && f.grounded && f.hp < f.maxHp && m.time >= this.healAt && this.pendingHeal <= 0 && Math.hypot(f.pos.x - pd.pos.x, f.pos.z - pd.pos.z) < pd.r * 0.8 && Math.abs(f.pos.y - pd.pos.y) < 0.8) {
        m.reportHeal(f, PUDDLE.heal);
        this.healAt = m.time + HEAL_GAP;
        this.removePuddle(pd, m);
        m.broadcastAction(f, { a: 'eat', p: [pd.pos.x, pd.pos.y, pd.pos.z] });
        continue;
      }
      if (!authority) continue;
      // sticky: enemies wading through it are slowed and take a little damage
      for (const o of m.fighters) {
        if (!foe(f, o)) continue;
        if (Math.hypot(o.pos.x - pd.pos.x, o.pos.z - pd.pos.z) > pd.r + 0.25 || Math.abs(o.pos.y - pd.pos.y) > 1) continue;
        if ((this.gooAt.get(o.id) ?? 0) > m.time) continue;
        this.gooAt.set(o.id, m.time + PUDDLE.tick);
        m.reportHit(f, o, { slot: 'atk', part: 'goo', slow: 0.8, at: o.pos.clone().setY(o.pos.y + 0.3), blockable: false });
        this.coat(f, o, m, false);
      }
    }
  }

  // ---- Panzata (belly bump) ---------------------------------------------------------------------------

  private startBump(f: Fighter, it: Intent, m: MatchContext): void {
    this.cd.sig = this.data.abilities.sig.cooldown;
    if (this.bal > 0) this.letGo(f, m, true);
    this.dropThrow(f);
    if (f.grounded) forwardOf(f.aimYaw, this.dashDir);
    else {
      // in the air he dives along the camera (not too steep)
      const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(it.aimDir.y, -1, 1)), -0.7, 0.45);
      this.dashDir.set(Math.sin(f.aimYaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(f.aimYaw) * Math.cos(pitch));
    }
    this.startAction(f, 'bump', BUMP.windup + BUMP.dist / BUMP.speed + BUMP.recover + 0.08, Math.atan2(this.dashDir.x, this.dashDir.z));
    this.dashLen = 0;
    this.dashSpeed = Math.max(BUMP.speed, f.vel.length() * 0.9);
    this.dashing = false;
    this.bumped = false;
    f.anim.play('bump', { fadeIn: 0.03 });
    m.audio.play('swingHeavy', f.pos, 0.7);
    m.broadcastAction(f, { a: 'bump', d: [this.dashDir.x, this.dashDir.y, this.dashDir.z] });
  }

  private tickBump(f: Fighter, dt: number, m: MatchContext): void {
    f.ctrl.noHooks = true;
    f.ctrl.noDash = true;
    if (this.actT < BUMP.windup) {
      f.ctrl.lockMove = 0.05;
      return;
    }
    if (!this.dashing && !this.bumped && this.dashLen < BUMP.dist) {
      this.dashing = true;
      this.hitActive = { slot: 'sig', part: 'bump', range: 1.4, arc: 80, height: 2.4, kb: 17, kbUp: 8, stun: 0.5 };
      this.setTrail(f, true);
      m.vfx.dashLines(f, this.dashDir);
      m.audio.play('dash', f.pos, 0.9);
    }
    if (!this.dashing) {
      f.ctrl.lockMove = 0.05;
      return;
    }
    f.ctrl.gravityScale = 0;
    f.vel.copy(this.dashDir).multiplyScalar(this.dashSpeed);
    if (f.grounded && f.vel.y < 0) f.vel.y = 0;
    this.dashLen += this.dashSpeed * dt;
    if (Math.random() < dt * 30) m.vfx.alpha.emit({ pos: f.pos.clone().setY(f.pos.y + 0.2), vel: new THREE.Vector3((Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2), life: 0.45, size: 0.25, size1: 0.6, color: 0xe8dcc4, shape: Shape.puff, drag: 3 });
    const wall = m.world.overlapsSphere(_v.copy(f.pos).setY(f.pos.y + 1).addScaledVector(this.dashDir, 0.9), 0.45);
    if (wall || this.dashLen >= BUMP.dist) {
      this.dashing = false;
      this.dashLen = BUMP.dist;
      this.hitActive = null;
      this.setTrail(f, false);
      if (wall) {
        // tummy first into the wall: boing
        f.vel.copy(this.dashDir).multiplyScalar(-5);
        f.vel.y = 4;
        this.bumpFx(m, f.chest(new THREE.Vector3()).addScaledVector(this.dashDir, 0.6), this.dashDir);
      } else f.vel.multiplyScalar(0.3);
      this.actT = Math.max(this.actT, this.actDur - BUMP.recover);
    }
  }

  protected onSweepHit(f: Fighter, o: Fighter, h: MeleeHit, m: MatchContext): void {
    if (h.part !== 'bump' || this.bumped) return;
    this.bumped = true;
    this.dashing = false;
    this.hitActive = null;
    this.setTrail(f, false);
    // he bounces off his own tummy
    f.vel.copy(this.dashDir).multiplyScalar(-6);
    f.vel.y = 5;
    this.actT = Math.max(this.actT, this.actDur - BUMP.recover);
    const at = o.chest(new THREE.Vector3()).lerp(f.chest(_w), 0.4);
    this.bumpFx(m, at, this.dashDir);
    m.hitStop(0.06);
    m.broadcastAction(f, { a: 'boing', p: [at.x, at.y, at.z], d: [this.dashDir.x, this.dashDir.y, this.dashDir.z] });
  }

  private bumpFx(m: MatchContext, at: THREE.Vector3, dir: THREE.Vector3): void {
    m.vfx.ring(at, dir, 0xffffff, 0.3, 2.2, 0.3);
    m.vfx.ring(at, dir, HONEY, 0.2, 1.4, 0.25);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      m.vfx.add.emit({ pos: at.clone(), vel: new THREE.Vector3(Math.cos(a) * 5, 2 + Math.sin(a) * 3, Math.sin(a) * 5), life: 0.6, size: 0.24, size1: 0.06, color: i % 2 ? 0xfff27a : 0xffffff, shape: Shape.star, drag: 3, spin: 6 });
    }
    m.audio.play('boing', at, 1);
    m.shake(0.3, at);
  }

  // ---- Little Black Rain Cloud (balloon) -------------------------------------------------------------

  private startBalloon(f: Fighter, m: MatchContext): void {
    this.cd.sec = this.data.abilities.sec.cooldown;
    this.bal = BALLOON.time;
    this.dropThrow(f);
    f.vel.y = Math.max(f.vel.y, 2.5);
    f.grounded = false;
    f.anim.play('balloon', { fadeIn: 0.15 });
    f.visual.prop?.('potL', false);
    this.freeT = 0;
    this.balloon.visible = true;
    this.balloon.scale.setScalar(1);
    this.string.visible = true;
    m.audio.play('boostStart', f.pos, 0.6);
    m.broadcastAction(f, { a: 'bal', n: 1 });
  }

  private floatTick(f: Fighter, dt: number, m: MatchContext): void {
    this.bal -= dt;
    f.ctrl.gravityScale = 0;
    f.ctrl.noHooks = true;
    const vy = BALLOON.time - this.bal < BALLOON.riseT ? BALLOON.rise : BALLOON.hover;
    f.vel.y += (vy - f.vel.y) * (1 - Math.exp(-4 * dt));
    // keep hanging from the string (a throw or a flinch interrupts the clip)
    const clip = f.anim.action.name;
    if (!f.anim.action.active || (clip !== 'balloon' && clip !== 'balloonThrow')) f.anim.play('balloon', { fadeIn: 0.12 });
    this.rainCloud(f, m, dt);
    if (this.bal <= 0) this.letGo(f, m, true);
  }

  /** a little black rain cloud: dark puffs round his tummy and a few drops falling */
  private rainCloud(f: Fighter, m: MatchContext, dt: number): void {
    if (Math.random() < dt * 9) m.vfx.alpha.emit({ pos: f.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.2 + Math.random() * 0.5, (Math.random() - 0.5) * 1.2)), vel: new THREE.Vector3(0, -0.3, 0), life: 0.7, size: 0.2, size1: 0.38, color: 0x4a5162, shape: Shape.puff, alpha: 0.6, drag: 1 });
    if (Math.random() < dt * 16) m.vfx.add.emit({ pos: f.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.2, (Math.random() - 0.5) * 0.9)), vel: new THREE.Vector3(0, -7, 0), life: 0.45, size: 0.05, color: 0x7fb7ff, shape: Shape.streak, stretch: 4 });
  }

  /** lets go of the balloon (`fx`: sound now; from cancel() it is sent on the next update) */
  private letGo(f: Fighter, m: MatchContext | null, fx: boolean): void {
    if (this.bal <= 0) return;
    this.bal = 0;
    f.visual.prop?.('potL', true);
    const clip = f.anim.action.name;
    if (clip === 'balloon' || clip === 'balloonThrow') f.anim.action.stop(0.2);
    this.releaseBalloon();
    if (m && fx) {
      m.audio.play('pop', f.pos, 0.6);
      m.broadcastAction(f, { a: 'bal', n: 0 });
    } else this.letGoPending = true;
  }

  private releaseBalloon(): void {
    this.freeT = 1.6;
    this.freeVel.set((Math.random() - 0.5) * 1.5, 5, (Math.random() - 0.5) * 1.5);
    this.string.visible = false;
  }

  /** balloon visuals: on the left paw while floating, drifting away after */
  private tickBalloon(f: Fighter, dt: number, floating: boolean, m: MatchContext): void {
    if (floating) {
      const paw = f.visual.weaponL ? f.visual.weaponL.getWorldPosition(_v) : f.head(_v);
      const sway = Math.sin(m.time * 2.1) * 0.12;
      this.balloon.position.set(paw.x + sway, paw.y + 1.75, paw.z + Math.cos(m.time * 1.7) * 0.1);
      this.balloon.rotation.z = sway * 0.6;
      const pos = this.string.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, paw.x, paw.y + 0.05, paw.z);
      pos.setXYZ(1, this.balloon.position.x, this.balloon.position.y - 0.8, this.balloon.position.z);
      pos.needsUpdate = true;
      this.balloon.visible = true;
      this.string.visible = true;
      return;
    }
    if (this.freeT > 0) {
      this.freeT -= dt;
      this.balloon.position.addScaledVector(this.freeVel, dt);
      this.balloon.scale.setScalar(Math.max(0.01, Math.min(1, this.freeT / 0.5)));
      if (this.freeT <= 0) this.balloon.visible = false;
    } else this.balloon.visible = false;
    this.string.visible = false;
  }

  // ---- Think, Think, Think ------------------------------------------------------------------------

  private startThink(f: Fighter, m: MatchContext): void {
    this.cd.abi = this.data.abilities.abi.cooldown;
    this.dropThrow(f);
    this.startAction(f, 'think', THINK.dur, f.facing);
    this.ideaDone = false;
    f.vel.x *= 0.2;
    f.vel.z *= 0.2;
    f.anim.play('think', { fadeIn: 0.08 });
    m.broadcastAction(f, { a: 'think' });
  }

  private idea(f: Fighter, m: MatchContext): void {
    this.ideaDone = true;
    this.charge = 0;
    // the Panzata is ready again, the next pots are Super Pots
    this.cd.sig = 0;
    this.superPots = THINK.pots;
    if (m.time >= this.healAt) {
      m.reportHeal(f, THINK.heal);
      this.healAt = m.time + HEAL_GAP;
    } else this.pendingHeal = Math.max(this.pendingHeal, THINK.heal);
    this.showBulb(f, m);
    m.broadcastAction(f, { a: 'idea' });
  }

  private showBulb(f: Fighter, m: MatchContext): void {
    this.bulbT = 1.2;
    this.bulb.visible = true;
    const at = f.head(new THREE.Vector3());
    at.y += 0.75;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      m.vfx.add.emit({ pos: at.clone(), vel: new THREE.Vector3(Math.cos(a) * 3.2, Math.sin(a) * 3.2, 0).applyAxisAngle(UP, f.facing), life: 0.45, size: 0.09, color: 0xfff27a, shape: Shape.streak, stretch: 3, drag: 4 });
    }
    m.vfx.ring(at, UP, 0xfff27a, 0.2, 0.9, 0.3);
    m.audio.play('idea', at, 1);
  }

  private tickBulb(f: Fighter, dt: number): void {
    if (this.bulbT <= 0) return;
    this.bulbT -= dt;
    const age = 1.2 - this.bulbT;
    f.head(this.bulb.position);
    this.bulb.position.y += 0.75 + Math.sin(age * 9) * 0.03;
    // pop in with an overshoot, shrink away at the end
    const k = age < 0.18 ? THREE.MathUtils.lerp(0.2, 1.25, age / 0.18) : age < 0.3 ? THREE.MathUtils.lerp(1.25, 1, (age - 0.18) / 0.12) : Math.min(1, this.bulbT / 0.25);
    this.bulb.scale.setScalar(Math.max(0.01, k));
    if (this.bulbT <= 0) this.bulb.visible = false;
  }

  // ---- Bee Swarm --------------------------------------------------------------------------------------

  private startUlt(f: Fighter, m: MatchContext): void {
    if (this.bal > 0) this.letGo(f, m, true);
    this.dropThrow(f);
    this.startAction(f, 'ult', 0.8);
    this.hiveT = HIVE.release;
    f.anim.play('ult', { fadeIn: 0.05 });
    f.visual.prop?.('hive', true);
    m.audio.play('ult', f.pos, 1);
    m.audio.play('buzz', f.pos, 0.7);
    m.broadcastAction(f, { a: 'ult' });
  }

  private releaseHive(f: Fighter, m: MatchContext): void {
    f.visual.prop?.('hive', false);
    const from = this.paw(f, new THREE.Vector3());
    const { point } = this.aimPoint(f, m, HIVE.range);
    const vel = this.lobVel(from, point, HIVE.g, 32);
    this.spawnHive(f, m, from, vel, false);
    m.broadcastAction(f, { a: 'hive', p: [from.x, from.y, from.z], d: [vel.x, vel.y, vel.z] });
  }

  private spawnHive(f: Fighter, m: MatchContext, from: THREE.Vector3, vel: THREE.Vector3, visualOnly: boolean): void {
    m.projectiles.spawn({
      owner: f, kind: 'hive', pos: from, vel, radius: 0.42, life: 2.4, gravity: HIVE.g, explode: HIVE.r, kb: 8, kbUp: 5, blast: false,
      slot: 'ult', part: 'hive', slow: 1.2, color: 0xffd34a, color2: 0xffa51c, scale: 1.7, visualOnly,
      onHit: (o) => this.coat(f, o, m, true),
      onBurst: (p) => this.hiveBurst(f, m, p),
    });
    m.audio.play('lob', from, 1);
  }

  private hiveBurst(f: Fighter, m: MatchContext, p: THREE.Vector3): void {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      m.vfx.alpha.emit({ pos: p.clone().setY(p.y + 0.3), vel: new THREE.Vector3(Math.cos(a) * 7, 4 + Math.random() * 5, Math.sin(a) * 7), life: 0.8, size: 0.16, color: i % 2 ? 0xe0a83e : 0xb7781f, shape: Shape.shard, gravity: 20, spin: 8 });
    }
    this.splash(f, m, p, true);
    m.vfx.shockwave(p, HIVE.r, 0xffd34a);
    m.audio.play('buzz', p, 1.2);
    m.shake(0.4, p);
    const s = this.swarms.find((x) => !x.active) ?? this.swarms[0];
    s.active = true;
    s.pos.copy(p).setY(p.y + 1.1);
    s.vel.set(0, 0, 0);
    s.t = SWARM.life;
    s.fade = 0;
    s.target = null;
    s.retarget = 0;
    s.tickT = 0.25;
    s.buzzT = 0;
    s.mesh.visible = true;
  }

  private tickSwarms(f: Fighter, dt: number, m: MatchContext): void {
    const authority = m.isAuthority(f);
    for (const s of this.swarms) {
      if (!s.active) continue;
      if (s.fade > 0) {
        s.fade -= dt;
        s.pos.y += dt * 3;
        if (s.fade <= 0) {
          s.active = false;
          s.mesh.visible = false;
          continue;
        }
      } else {
        s.t -= dt;
        if (s.t <= 0) s.fade = 0.5;
        // chase the nearest enemy (hidden ones lose the bees)
        s.retarget -= dt;
        if (s.retarget <= 0 || (s.target && !s.target.alive)) {
          s.retarget = 0.25;
          s.target = null;
          let best = SWARM.seek;
          for (const o of m.fighters) {
            if (!foe(f, o) || o.isHiddenFrom(f)) continue;
            const d = o.chest(_v).distanceTo(s.pos);
            if (d < best) {
              best = d;
              s.target = o;
            }
          }
        }
        if (s.target) {
          _v.subVectors(s.target.chest(_w), s.pos);
          const d = _v.length();
          if (d > 0.2) _v.multiplyScalar(SWARM.speed / d);
          s.vel.lerp(_v, 1 - Math.exp(-4 * dt));
        } else s.vel.multiplyScalar(Math.exp(-3 * dt));
        s.pos.addScaledVector(s.vel, dt);
        // stings
        s.tickT -= dt;
        if (s.tickT <= 0) {
          s.tickT = SWARM.every;
          if (authority) {
            for (const o of m.fighters) {
              if (!foe(f, o)) continue;
              const at = o.chest(new THREE.Vector3());
              if (at.distanceTo(s.pos) > SWARM.r + 0.45) continue;
              m.reportHit(f, o, { slot: 'ult', part: this.isHoneyed(o, m) ? 'sting2' : 'sting', slow: 0.4, at, blockable: false });
            }
          }
        }
        s.buzzT -= dt;
        if (s.buzzT <= 0) {
          s.buzzT = 0.32;
          m.audio.play('buzz', s.pos, 0.55);
        }
        if (Math.random() < dt * 10) m.vfx.add.emit({ pos: s.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.6)), vel: new THREE.Vector3(0, 0.5, 0), life: 0.4, size: 0.1, size1: 0.02, color: 0xffd34a, shape: Shape.glow, alpha: 0.7 });
      }
      // the bees: orbits around the swarm centre, facing where they fly
      const grow = Math.min(1, (SWARM.life - s.t) / 0.3);
      const k = s.fade > 0 ? s.fade / 0.5 : grow;
      const spread = s.fade > 0 ? 1 + (0.5 - s.fade) * 6 : 1;
      for (let i = 0; i < SWARM.bees; i++) {
        const ph = s.seeds[i * 4];
        const rr = s.seeds[i * 4 + 1] * spread;
        const w = s.seeds[i * 4 + 2];
        const hh = s.seeds[i * 4 + 3];
        const a = ph + m.time * w;
        _d.position.set(s.pos.x + Math.cos(a) * rr, s.pos.y + hh + Math.sin(m.time * Math.abs(w) * 1.7 + ph) * 0.3, s.pos.z + Math.sin(a) * rr);
        _d.rotation.set(0, Math.atan2(-Math.sin(a) * Math.sign(w), Math.cos(a) * Math.sign(w)), Math.sin(m.time * 40 + ph) * 0.3);
        _d.scale.setScalar(Math.max(0.01, k) * 2);
        _d.updateMatrix();
        s.mesh.setMatrixAt(i, _d.matrix);
      }
      s.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** golden drips on enemies coated in honey */
  private tickHoney(m: MatchContext, dt: number): void {
    for (const [id, until] of this.honeyed) {
      if (until <= m.time) {
        this.honeyed.delete(id);
        continue;
      }
      if (Math.random() > dt * 8) continue;
      const o = m.fighters.find((x) => x.id === id);
      if (!o || !o.alive || o.isHiddenFrom(null)) continue;
      m.vfx.alpha.emit({ pos: o.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.9, (Math.random() - 0.5) * 0.6)), vel: new THREE.Vector3(0, -0.5, 0), life: 0.6, size: 0.1, size1: 0.06, color: HONEY, shape: Shape.glow, gravity: 9 });
    }
  }

  // ---- per frame ----------------------------------------------------------------------------------

  protected tickAction(f: Fighter, _it: Intent, dt: number, m: MatchContext): void {
    if (this.act === 'bump') this.tickBump(f, dt, m);
    else if (this.act === 'think') {
      f.ctrl.lockMove = 0.1;
      f.ctrl.noHooks = true;
      f.ctrl.noDash = true;
      if (!this.ideaDone) {
        this.charge = Math.min(1, this.actT / THINK.idea);
        if (this.actT >= THINK.idea) this.idea(f, m);
      }
    } else if (this.act === 'ult') {
      f.ctrl.noHooks = true;
      if (this.actT < 0.5) f.ctrl.lockMove = 0.05;
      if (this.hiveT > 0) {
        this.hiveT -= dt;
        if (this.hiveT <= 0) this.releaseHive(f, m);
      }
    }
  }

  protected endAction(f: Fighter): void {
    if (this.act === 'think') this.charge = 0;
    if (this.act === 'bump') this.dashing = false;
    super.endAction(f);
  }

  /** a throw wound up but not released yet is dropped (another action took over) */
  private dropThrow(f: Fighter): void {
    if (this.throwT > 0) {
      this.throwT = 0;
      this.fireT = 0;
      f.visual.prop?.('pot', false);
    }
  }

  onAnimEvent(f: Fighter, ev: string, m: MatchContext): void {
    if (ev !== 'tap' || f.anim.action.name !== 'think') return;
    // think, think, think: a soft tap and a few thought bubbles by his head
    const at = f.head(new THREE.Vector3());
    m.audio.play('tap', at, 0.7);
    _v.set(-Math.cos(f.facing), 0, Math.sin(f.facing));
    for (let i = 0; i < 3; i++) m.vfx.add.emit({ pos: at.clone().addScaledVector(_v, 0.45).setY(at.y + 0.2 + i * 0.16), vel: new THREE.Vector3(0, 0.9, 0), life: 0.55, size: 0.05 + i * 0.03, size1: 0.02, color: 0xffffff, shape: Shape.ring, alpha: 0.9 });
  }

  tickWorld(f: Fighter, dt: number, m: MatchContext): void {
    this.tickPuddles(f, dt, m);
    this.tickSwarms(f, dt, m);
    this.tickHoney(m, dt);
    this.tickBalloon(f, dt, f.simulated ? this.bal > 0 && f.alive : this.remoteBal && f.alive, m);
    this.tickBulb(f, dt);
  }

  hints() {
    const out: Partial<Record<AbilitySlot, string>> = {};
    if (this.superPots > 0) out.atk = `SUPER x${this.superPots}`;
    if (this.bal > 0) out.sec = 'LASCIA';
    if (this.act === 'think' && !this.ideaDone) out.abi = 'PENSA...';
    return out;
  }

  cancel(f: Fighter): void {
    this.dropThrow(f);
    if (this.hiveT > 0) {
      this.hiveT = 0;
      f.visual.prop?.('hive', false);
    }
    if (this.bal > 0) this.letGo(f, null, false);
    this.dashing = false;
    super.cancel(f);
  }

  // ---- remote puppets ---------------------------------------------------------------------------------

  playRemote(f: Fighter, e: ActionEvent, m: MatchContext): void {
    switch (e.a) {
      case 'pot':
        if (e.p && e.d) this.spawnPot(f, m, new THREE.Vector3(...e.p), new THREE.Vector3(...e.d), !!e.n, true);
        f.anim.play(this.remoteBal ? 'balloonThrow' : 'throw', { offset: POT.release, fadeIn: 0.03, mask: this.remoteBal ? undefined : MASK_UPPER });
        this.aimHold = 0.45;
        break;
      case 'bump':
        f.anim.play('bump', { fadeIn: 0.03 });
        if (e.d) m.vfx.dashLines(f, new THREE.Vector3(...e.d));
        this.setTrail(f, true);
        this.remoteTrailT = 0.4;
        m.audio.play('dash', f.pos, 0.9);
        break;
      case 'boing':
        if (e.p) this.bumpFx(m, new THREE.Vector3(...e.p), new THREE.Vector3(...(e.d ?? [0, 0, 1])));
        break;
      case 'bal':
        this.remoteBal = !!e.n;
        f.visual.prop?.('potL', !e.n);
        if (e.n) {
          this.freeT = 0;
          this.balloon.scale.setScalar(1);
          f.anim.play('balloon', { fadeIn: 0.15 });
        } else {
          if (f.anim.action.name === 'balloon') f.anim.action.stop(0.2);
          this.releaseBalloon();
          m.audio.play('pop', f.pos, 0.6);
        }
        break;
      case 'think':
        f.anim.play('think', { fadeIn: 0.08 });
        break;
      case 'idea':
        this.showBulb(f, m);
        break;
      case 'ult':
        f.anim.play('ult', { fadeIn: 0.05 });
        f.visual.prop?.('hive', true);
        this.remoteHiveT = HIVE.release + 0.1;
        m.audio.play('ult', f.pos, 1);
        break;
      case 'hive':
        f.visual.prop?.('hive', false);
        this.remoteHiveT = 0;
        if (e.p && e.d) this.spawnHive(f, m, new THREE.Vector3(...e.p), new THREE.Vector3(...e.d), true);
        break;
      case 'eat': {
        if (!e.p) break;
        const p = new THREE.Vector3(...e.p);
        const pd = this.puddles.filter((x) => x.active).sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p))[0];
        if (pd && pd.pos.distanceTo(p) < 1.5) this.removePuddle(pd, m);
        break;
      }
      case 'honey': {
        const o = e.t ? m.fighters.find((x) => x.id === e.t) : null;
        if (o) this.honeyed.set(o.id, m.time + HONEYED);
        break;
      }
      default:
        break;
    }
  }

  tickRemote(f: Fighter, dt: number, m: MatchContext): void {
    this.aimHold = Math.max(0, this.aimHold - dt);
    f.ctrl.aim = this.aimHold > 0 ? 1 : 0;
    if (this.remoteTrailT > 0) {
      this.remoteTrailT -= dt;
      if (this.remoteTrailT <= 0) this.setTrail(f, false);
    }
    if (this.remoteHiveT > 0) {
      this.remoteHiveT -= dt;
      if (this.remoteHiveT <= 0) f.visual.prop?.('hive', false);
    }
    if (this.remoteBal && f.alive) {
      const clip = f.anim.action.name;
      if (!f.anim.action.active || (clip !== 'balloon' && clip !== 'balloonThrow' && clip !== 'stun')) f.anim.play('balloon', { fadeIn: 0.12 });
      this.rainCloud(f, m, dt);
    }
  }
}
