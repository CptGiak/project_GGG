# Secondary motion: springs, spring bones, cloth, hair and props

**Use this file for** anything that moves because something else moved: hair, hood strings,
pendants, charms, headphones, pockets, skirts, capes, ribbons, weapon dangles, and detail channels
such as the drum and the equalizer. It tells you which engine type to use, how to turn Hz and
damping ratio into its options, what breaks at grapple speed, what REX and Elisabbat run today, and
how to prove a result with numbers. Values marked *measured* come from running the real classes
headlessly (§11.4) on the 2026-10-11 working tree; re-measure after engine changes. File:line
references are from that date and drift as src/ changes, so grep the quoted code if one looks off.
SKILL.md §3 is the authoritative API summary.

**Contents:** §0 Summary · §1 Spring maths · §2 Shipping systems · §3 Verlet/PBD/XPBD (§3.1
stability under 30+ m/s motion) · §4 Hair · §5 Cloth costumes · §6 Rigid props on `SpringBone` ·
§7 Physics with keyframes · §8 Wind · §9 Parameter table · §10 REX and Elisabbat · §11 QA ·
§12 Sources

**Conventions.**
- f in Hz, ω = 2πf, ζ = damping ratio.
- h = substep: 1/90 s for chains and sheets, 1/120 s for `SpringBone`, 1/240 s for `Kick`.
- Rig axes: +Z forward, +X = the character's left, Y up.
- Game gravity is 26 m/s² (`MOVE.gravity`, shared/constants.ts:3). Cloth and springs use 9.8.

---

## 0. Summary

**Pick the type by what moves.**

| What moves | Engine type |
|---|---|
| Detail channel that follows a target: drum index, EQ bars, prop twist, weapon overlap | `SecondOrder(dim, f, ζ, r, x0?)` (Springs.ts:14) |
| Impulse that rings back to 0: recoil, landing bob, hit wobble | `Kick(freq, ζ)` with `hit(peak[, rise, hang])` (Springs.ts:97) |
| Rigid prop on a pivot: spikes, headphones, pendant, bunched hood, pockets, earrings | `SpringBone` (Springs.ts:214) |
| Strand: drawstring, charm chain, tail, ribbon, lock | `ClothChain` with `relative: true` (Cloth.ts:67) |
| Drape: skirt, cape, coat, hair curtain | `ClothSheet` (Cloth.ts:437) |
| GLB coat flaps | `BoneChain` (glbModels.ts:410) |

The last four are `ClothLike` objects (`update(dt, wind)`, `reset()`, `objects`) listed in the
visual's `cloth: [...]`. `FighterAnimator.update` runs them after IK, right after
`updateBodySpheres` (FighterAnimator.ts:256–258), and the model's `tick()` runs after that
(Fighter.ts:1112).

**Rules.**
1. **Tune in f and ζ.** `SpringBone` takes them directly (mind the gravity term, §6.2); chains and
   sheets convert them with §1.5 or use §9.
2. **Damp relative to the anchor**, with a separate clamped air drag. World-space damping d is air
   drag of (1 − d)/h, so strands stream flat (§3.1).
3. **Sample anchors at true substep times** and render with a carry (`SubstepClock`, §3.1).
4. **Feel only part of the body's acceleration.** The body falls at 26 m/s², cloth at 9.8, so at
   full inertia every strand stands up in a jump. λ_L ≈ 0.38 fixes it.
5. **Discontinuous moves are teleports**: a 5 m blink stretches chains 650 % (measured).
6. **Hair moves as shapes**: rigid spike groups at 5–7 Hz, chains for locks, clumped sheets for
   curtains.
7. **No collider may contain an anchor**; use short per-strand collider lists, planes, capsules.
8. **Art-direct** with per-move profiles, impulses on events and `cue()`, and Blender bakes (§7).
9. **Prove it** with §11. Budget: ≤ 0.25 ms per character at LOD0.

> **Read the §3.1 engine status before tuning.** The REX pass fixed the chain anchor aliasing,
> the sub-step clock, `SpringBone`'s cone pinning and radial velocity, teleport resets, partial
> linear inertia and the collider-contains-root case; sheets (`ClothSheet`, `BoneChain`) still damp
> in world space. Tune on the current engine, not on numbers measured before those fixes.

---

## 1. Spring maths

### 1.1 Rules of thumb
Model: x″ = −ω²(x − g) − 2ζω·x′.
- **Halflife** [Holden]: c = 2ζω = 4 ln2/halflife. For a critical spring, halflife ≈ 0.22/f
  (73.5 ms at 3 Hz).
- **Decay over a duration** [Chou]: ζ = −ln(p_d)/(ω·t_d), where p_d is the fraction left after
  t_d.
- **Overshoot** = e^(−πζ/√(1−ζ²)): ζ 0.2 → 53 %, 0.3 → 37 %, 0.4 → 25 %, 0.5 → 16 %, 0.7 → 5 %.
- **2 % settling time** ≈ 4/(ζω): 0.91 s at 2 Hz, ζ 0.35.
- **Static sag** = g/ω²: 1 Hz 25 cm, 1.2 Hz 17 cm, 1.5 Hz 11 cm, 2 Hz 6.2 cm, 3 Hz 2.8 cm, 5 Hz
  1 cm. This is why soft hair under full gravity looks "wet and limp" (§4 gScale).
- **Zero crossings give the damped frequency**, f·√(1−ζ²) (0.87·f at ζ 0.5). Allow for this when
  you verify a tuning.

### 1.2 Integrators in the engine
Explicit Euler gains energy, so never use it. Semi-implicit Euler is fine while ωh is small.
Implicit Euler is stable but adds damping [Chou]. The closed form is exact at any dt [Juckett;
Holden].

| Type | Integrator | Step |
|---|---|---|
| `SecondOrder` | semi-implicit + k₂ clamp; pole matching when ωT ≥ ζ, stable at any dt [t3ssel8r] | frame dt |
| `Kick` | semi-implicit Euler, fine below ~30 Hz | 1/240 s |
| `SpringBone` | semi-implicit Euler + rigid-link projection | 1/120 s, ≤ 6 steps |
| `ClothChain`, `ClothSheet`, `BoneChain` | position verlet; 4 iterations with sphere push-out | 1/90 s, ≤ 4 steps |

The frame dt is clamped to 1/20 s (Match.ts:659). Hitstop multiplies the sim dt by 0.06
(Match.ts:672), so secondary motion slows with the body.

### 1.3 Rotations and spin
- **Rotation springs.** Express the error as e = log(q·target⁻¹), taking the shortest arc.
  Spring each component, then rebuild q = exp(e)·target. Clamping |e| gives a free cone limit
  [Holden]. `SpringBone` swings a point (2 DOF) and cannot twist.
- **Spin lag.** A world-space spring chasing a target that spins at ω_s lags ≈ 2ζω_s/ω₀ rad (57°
  at 720°/s, 4 Hz, ζ 1). Relative damping removes this lag and leaves only the centrifugal offset
  (ω_s/ω₀)²·r⊥, where r⊥ is the distance from the spin axis. At 720°/s the offset is 0.16·r⊥ at
  5 Hz, 0.11·r⊥ at 6 Hz and 0.08·r⊥ at 7 Hz. REX's spikes flare 4–6° (measured with the §3.1
  fixes).
- **Twist** (a pendant glint): drive a child of the pivot with `SecondOrder(1, 1.5, 0.15)` and
  call `impulse(0, ±0.5)` on hits.

### 1.4 `SecondOrder`
API (Springs.ts:14–84): `new SecondOrder(dim, f, zeta, r = 0, x0?)`, `tune`, `reset(x)`,
`update(dt, x, xd?) → y`, `impulse(i, v)`. It solves y + k₁y′ + k₂y″ = x + k₃x′, with
k₁ = ζ/(πf), k₂ = 1/(2πf)² and k₃ = rζ/(2πf) [t3ssel8r].
- **f**: 1–2 lazy, 4–6 lively, 8+ snappy.
- **ζ**: 0 never settles, 0.3–0.6 overshoots, 1 is critical.
- **r**: 0 eases in, 1 immediate, > 1 overshoots on attack, < 0 anticipates (−0.3…−0.5 is a
  mechanical pull-back-then-go).

Pass `xd` when you know the target velocity; otherwise lower r on noisy inputs. Typical channels:
- drum index `(1, 6, 0.55, −0.35)`;
- EQ bars `(10, 9, 0.4, 2)`;
- weapon follow `(3, 5, 0.7)` on Euler deltas;
- twist `(1, 1.5, 0.15)`.

Update it once per frame in `tick()`.

### 1.5 Mapping GGG verlet (s, d) to (f, ζ)
Per substep: x̃ = x + d(x − x_prev), then x = lerp(x̃, target, s). The deviation follows
e_{n+1} = (1 − s)[(1 + d)e_n − d·e_{n−1}]. Matching its poles to the exact oscillator, with
P = e^(−2ζωh) and S = 2e^(−ζωh)·cos(ω√(1−ζ²)h), gives:

**s = 1 − S + P,  d = P/(S − P)** (round-trips exactly)

```ts
// tuning helpers (not in the engine)
export function verletFromSpring(f: number, zeta: number, h = 1 / 90) {
  const w = 2 * Math.PI * f, sig = zeta * w, P = Math.exp(-2 * sig * h);
  const wd = w * Math.sqrt(Math.abs(1 - zeta * zeta)) * h;
  const S = 2 * Math.exp(-sig * h) * (zeta < 1 ? Math.cos(wd) : Math.cosh(wd));
  return { s: 1 - S + P, d: P / (S - P) };                 // d > 1: zeta too low for verlet
}
export function springFromVerlet(s: number, d: number, h = 1 / 90) {
  const P = (1 - s) * d, S = (1 - s) * (1 + d), disc = S * S - 4 * P;
  let sum: number, prod: number;
  if (disc < 0) { const lr = 0.5 * Math.log(P), th = Math.acos(S / (2 * Math.sqrt(P)));
    sum = (2 * lr) / h; prod = (lr * lr + th * th) / (h * h); }
  else { const l1 = Math.log((S + Math.sqrt(disc)) / 2) / h, l2 = Math.log((S - Math.sqrt(disc)) / 2) / h;
    sum = l1 + l2; prod = l1 * l2; }
  const w = Math.sqrt(prod); return { f: w / (2 * Math.PI), zeta: -sum / (2 * w) };
}
```

**In the engine:**
- **Per-particle stiffness.** Particle i of n (segments, or rows for a sheet) uses
  k_i = `stiffness`·(1 − (i/n)·`stiffFalloff`), pulled toward the previous particle +
  restDir·segment. The per-segment (f, ζ) is therefore approximate; verify it with the suite.
- **Hitting root and tip targets.** For a root A = s(i = 1) and tip B = s(i = n), set
  **stiffness = B + (A − B)·n/(n − 1)** and **stiffFalloff = (A − B)·n/((n − 1)·stiffness)**. The
  falloff is linear; approximate the research's t^1.5 curve with more segments.
- **One `damping` per strand.** ζ rises toward the tip as k falls, so choose d for the tip.
  Relative chains damp velocity relative to the anchor; sheets damp world velocity. `airDrag` k
  adds ≈ k/(2ω) to ζ.

**Consequences:**
- **Stiffness** ω ≈ √(s/(1−s))/h. At d 0.9: s 0.01 → 1.5 Hz, 0.02 → 2.1 Hz, 0.05 → 3.3 Hz,
  0.1 → 4.8 Hz, 0.2 → 7.0 Hz.
- **The lerp also damps.** With d ≤ 1, ζ cannot go below ≈ ωh/2 (0.07 at 2 Hz, 0.17 at 5 Hz,
  0.26 at 8 Hz). A 5 Hz antenna at ζ 0.12 needs d = 1.04, so make it a `SpringBone`.
- **Changing the rate.** The exponent rule 1 − (1 − s)^(h′/h) [Kawaii; NvCloth] is exact only for
  pure decay: 2 Hz/0.3 at 60 Hz becomes 2.43 Hz/0.25 at 90 Hz. Convert through (f, ζ) instead.

**Current presets:**

| Preset | Where | s root→tip | d | f (Hz) | ζ |
|---|---|---|---|---|---|
| REX drawstrings | rex.ts:245 | 0.029→0.0105 | 0.94 | 2.5→1.5 | 0.26→0.35 |
| REX hip charm | rex.ts:263 | 0.034→0.016 | 0.90 | 2.7→1.9 | 0.37→0.47 |
| Elisabbat hair | elisabbat.ts:577 | 0.044→0.0125 | 0.90 | 3.1→1.65 | 0.35→0.51 |
| Elisabbat skirt top/mid/bottom | elisabbat.ts:544–546 | 0.16→0.13 / 0.14→0.12 / 0.13→0.105 | 0.88 | 6.25→5.6 / 5.9→5.3 / 5.5→5.0 | 0.34–0.35 |
| `ClothChain` defaults (4 segments) | Cloth.ts:188–191 | 0.068→0.032 | 0.90 | 3.9→2.65 | 0.32→0.37 |
| `ClothSheet` defaults (4 rows) | Cloth.ts:595–598 | 0.0525→0.03 | 0.90 | 3.4→2.6 | 0.33→0.38 |

Kawaii's defaults come to ≈ 2.2 Hz/ζ 0.34 in these terms.

---

## 2. Shipping systems: numbers worth reusing
- **VRM SpringBone** [VRM]: inertia (cur − prev)(1 − drag), a stiffness push along the rest axis,
  length re-projected; inertia in an optional `center` node (our relative frame). Defaults:
  stiffness 1.0, drag 0.4, gravity 0, hitRadius 0.02 m. Per frame, no substeps (frame-rate
  dependent).
- **Kawaii Physics** [Kawaii]: only 20 % of world motion is felt (WorldDamping 0.8); teleport at
  300 cm / 10° per frame; per-substep pose interpolation; final bone-length restore; SyncBone (legs
  drive the skirt); trapezoid gusts.
- **SPCRJointDynamics** [SPCR]: Resistance 1 % → 5 % per step, Hardness 5 % → 0.1 %, collider
  friction 0.7; root slide 5 m/s and rotate 540°/s limits, beyond which root motion is rigid.
- **UE** [UE-RigidBody; UE-AnimDyn]: VelocityScaleZ 0–1 "to reduce the effects of jumping and
  crouching"; MaxAngularVelocity ≈ 6 rad/s against fly-out in spins; clamped applied acceleration.
- **Same ideas, other names:** NvCloth's linear/angular/centrifugal inertia [NvCloth] = our λ
  shares; Chaos's Fictitious Angular Scale and LRA tethers [Chaos]; Unity's `worldVelocityScale`
  [Unity] = airDrag; Dynamic Bone's Inert [DynBone] and PhysBones' Immobile [PhysBones] = 1 − λ_L;
  EZSoftBone's Gravity Aligner [EZSoftBone] = gScale.
- **Studios:** Genshin reads as stiff spring bones plus keyed cinematics [HoYo]; Guilty Gear Xrd
  authors secondary shapes per pose [ArcSys]; Blizzard simulates then bakes [Blizzard]; Insomniac
  scopes where cloth can be used [Insomniac].

---

## 3. Verlet, PBD and XPBD
- **Jakobsen** [Jakobsen]: verlet, iterative relaxation, projection collisions; stiffness depends
  on the iteration count. This is `Cloth.ts` (4 iterations).
- **PBD** [PBD]: stiffness k′ = 1 − (1 − k)^(1/n); damp only the deviation from rigid motion,
  Δvᵢ = v_cm + ω×rᵢ − vᵢ.
- **XPBD** [XPBD]: Δλ = (−C − α̃λ)/(∇C·M⁻¹∇Cᵀ + α̃), α̃ = α/h²; compliance α = 1/k does not depend
  on step or iterations. Use it for bending (α 1e-4–1e-3).
- **Small Steps** [SmallSteps]: n substeps × 1 iteration beats 1 step × n iterations.
- **LRA** [LRA]: a unilateral tether at the rest *path* length stops stretch in one pass. In code:
  if |p − anchor| > maxLen (≈ 102 %), put p back on that sphere.
- **FTL** [FTL]: root → tip, move only the child onto its parent's sphere (exact
  inextensibility); velocity −= s_damp·dᵢ₊₁/h, s_damp ≈ 0.9; hair friction blends velocities toward
  the local average.
- **Ten Minute Physics** [TMP14; TMP15]: cloth stretches 0–5 %, so zero-compliance edges;
  collision distance = min(2r, rest); substeps instead of CCD; cap relative speed at r·n_sub/Δt
  (1.8 m/s per substep at r 2 cm, 90 Hz).
- **Oriented particles** [OrientedParticles]: skin particles as colliders, normals pick the
  push-out side.
- **Half-space planes**: keep dot(p − p0, n) ≥ r (chest, face and back planes); cheaper than
  capsules and cannot be tunnelled.

The engine lacks the helpers below (they work on its `THREE.Vector3[]` `p` and `prev`). Per
substep: distance iterations → collisions → one more distance pass → tethers and `ftlRestore`.
Checked numerically: exact lengths, a particle that crossed a capsule axis returns to its old
side, a 40° inward swing clamps to an 8° inward limit.

```ts
const _e = new THREE.Vector3(), _ab = new THREE.Vector3(), _cp = new THREE.Vector3(),
  _nn = new THREE.Vector3(), _pp = new THREE.Vector3(), _vt = new THREE.Vector3();
export function ftlRestore(p: THREE.Vector3[], prev: THREE.Vector3[], seg: number, sDamp = 0.9): void {
  for (let i = 1; i < p.length; i++) {
    _e.subVectors(p[i], p[i - 1]).multiplyScalar(seg / (p[i].distanceTo(p[i - 1]) || 1e-6) - 1);
    p[i].add(_e);
    if (i > 1) prev[i - 1].addScaledVector(_e, sDamp);   // DFTL: parent velocity -= sDamp * d_i
  }
}
// capsule a-b, r = limb + strand radius; a particle that crossed the axis returns to its old side
export function collideCapsule(p: THREE.Vector3, prev: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3,
  r: number, friction = 0): boolean {
  _ab.subVectors(b, a);
  const t = THREE.MathUtils.clamp(_nn.subVectors(p, a).dot(_ab) / (_ab.lengthSq() || 1), 0, 1);
  _cp.copy(a).addScaledVector(_ab, t);
  const d = _nn.subVectors(p, _cp).length();
  if (d >= r) return false;
  _pp.subVectors(prev, _cp);
  if (d < 1e-6 || _nn.dot(_pp) < 0) _nn.copy(_pp);
  if (_nn.lengthSq() < 1e-12) _nn.set(0, 1, 0);
  p.copy(_cp).addScaledVector(_nn.normalize(), r);
  if (friction > 0) { _vt.subVectors(p, prev); _vt.addScaledVector(_nn, -_vt.dot(_nn)); p.addScaledVector(_vt, -friction); }
  return true;
}
// elliptical/asymmetric cone around rest axis ax (u, v perpendicular unit axes; limits in rad)
export function coneLimit(parent: THREE.Vector3, child: THREE.Vector3, ax: THREE.Vector3, u: THREE.Vector3,
  v: THREE.Vector3, uPos: number, uNeg: number, vPos: number, vNeg: number): void {
  _e.subVectors(child, parent); const len = _e.length(); if (len < 1e-9) return; _e.divideScalar(len);
  const cu = _e.dot(u), cv = _e.dot(v), sp = Math.hypot(cu, cv); if (sp < 1e-7) return;
  const nu = cu / sp, nv = cv / sp, lim = 1 / Math.hypot(nu / (nu > 0 ? uPos : uNeg), nv / (nv > 0 ? vPos : vNeg));
  if (Math.atan2(sp, _e.dot(ax)) <= lim) return;
  const c = Math.cos(lim) * len, s = Math.sin(lim) * len;
  child.copy(parent).addScaledVector(ax, c).addScaledVector(u, nu * s).addScaledVector(v, nv * s);
}
```
Collider recipes: a chest plane 1 cm in front of the hoodie (strings, pendants), a face plane
1.5 cm in front of the eyes (bangs), a back plane (long hair), and capsules for thighs (hip → knee,
radius thigh + 1.5 cm), shins, upper arms and neck. There is no per-particle `hitRadius`, so
`BodySphere` radii must include the strand radius.

### 3.1 Stability under 30+ m/s motion: the "chain streams flat" bug and relative damping

**Why chains stream flat.** World-space verlet with velocity retention d is air drag of
(1 − d)/h against the world. At d 0.9 and 90 Hz that is 9 s⁻¹, or 270 m/s² (≈ 27 g) at 30 m/s.
A 2 Hz lock has ω² ≈ 160 s⁻², so it streams flat. Stiffening it to compensate kills the motion at
low speed. The fix: damp the velocity relative to the anchor, and give air drag its own clamped
term on (v_world − v_wind).

Measured on a 30 cm chain (4 segments, stiffness 0.05, damping 0.9, no colliders), angle from
vertical while cruising:

| Speed | World-space damping (sheets today) | `relative: true`, airDrag 0.6, maxAir 12, with the fixes below |
|---|---|---|
| 2 m/s | 27–34° | 2.6° |
| 9.6 m/s (run) | 35–73°, depends on fps | 12.1° |
| 30 m/s (grapple) | 68–85° | 15.0° |

The relative column is identical at 30–144 fps. Elisabbat's sheets today trail 26–27° (skirt) and
56° (hair) at 9.6 m/s, and the skirt reaches 59–69° with up to 77 % stretch at 30 m/s.

**What the engine already has:** `ClothChain relative: true` (damping against the anchor's linear
velocity, anchor position interpolated across substeps, `airDrag` on (v − wind) clamped at
`maxAir`), and `SpringBone` (damping against the rest point's velocity, drag clamped at 12 m/s).

**Engine status** (measured before the REX pass; the last column says what changed):

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | Chains misbehave around the world origin. Near it, REX's drawstrings thrash (62 % stretch, 215 mm jitter) and the charm sits crumpled 120° off. Beyond 6 m, every chain resets to straight rest each frame | `a = this.anchorWorld(_v)` aliased a module temp that `simulate()` overwrote before `lastAnchor.copy(a)` | **FIXED**: `anchorNow` is the chain's own vector |
| 2 | ±5–7° flicker at 30 Hz at 60 fps; at 144 fps, roots detach up to 6.7 cm at 9.6 m/s and 21 cm at 30 m/s | Substep fraction k/n; frames with no substep render stale points | **FIXED** for relative chains and `SpringBone`: `SubstepClock` (Springs.ts) + render carry; collider centres are moved back to each sub-step's time with the anchor |
| 3 | Every `SpringBone` pinned on its cone above ≈ 2 m/s | End-of-frame pivot in every substep; the cone wall bled *absolute* velocity | **FIXED** (§6.3): per-sub-step pivot and rest point, relative bleed. REX's spikes now trail ~1° at 9.6 and 30 m/s |
| 4 | REX's pendant never swung | Radial velocity survived the link projection | **FIXED**: the radial relative velocity is dropped; the pendant trails 10–12° and swings to its cone on stops |
| 5 | Drawstrings rested 15.6° off and swung 77° at 30 m/s | Anchors inside body spheres; colliders sampled once per frame | **FIXED (pragmatic)**: a sphere that contains the strand's root is shrunk to just inside the root for that strand; centres are time-aligned per sub-step. REX idle 9°, run (9.6 m/s) 9–20° at 30-240 fps. Per-strand lists / planes / capsules remain the better tool |
| 6 | A 5 m blink stretched chains 650 % and Elisabbat's sheets 140–600 % | Resets only above 2 m/frame (springs) or 6 m/frame (chains, sheets); blinks move `f.pos` silently | **FIXED** for relative chains and springs (reset above 2.5 m/frame); sheets still 6 m: call `reset()` from the kit on blinks |
| 7 | Relative strands trailed too much (speed counted 1.6×) | `wind = −0.6·vel − 2ŷ` read as air velocity | **FIXED**: relative chains and springs ignore `wind` (their drag acts on the world velocity, clamped); `wind` stays an acceleration for world-space sheets |
| 8 | Strands stood up for the whole jump | The body falls at 26 m/s², cloth at 9.8 | **FIXED**: `linearInertia` (λ_L, default 0.4) on relative chains and `SpringBone`s |
| 9 | Elisabbat streams (measured above) | `ClothSheet`/`BoneChain` damp world velocity; sheets add wind as acceleration (Cloth.ts:610) | Relative mode per column |
| 10 | A relative chain still streams | `drag` multiplies the total velocity (Cloth.ts:213) | `drag` 0; use `airDrag` |
| 11 | A spring lags or fights an animated part | `tick()` runs after `anim.update` (Fighter.ts:1112); `SpringBone` rewrites its pivot from `restQ` (Springs.ts:227/238) | Spring a child, or animate the parent before `anim.update` |
| 12 | Rest directions jump in spins | The end-of-frame rotation is used in every substep (Cloth.ts:194/600) | Slerp the rotation per substep |

**`SubstepClock`** (fixes #2). Use one per chain, sheet column or spring. Validated: identical
from 30 to 144 fps, with a root gap of 0.

```ts
export class SubstepClock {                       // time-correct sub-step anchor samples + render carry
  acc = 0; span = 0; private owed0 = 0; private init = false;
  readonly prev = new THREE.Vector3(); readonly now = new THREE.Vector3();  // own vectors, never module temps
  readonly vel = new THREE.Vector3(); readonly velPrev = new THREE.Vector3(); readonly lastSub = new THREE.Vector3();
  reset(a: THREE.Vector3): void {
    this.prev.copy(a); this.now.copy(a); this.lastSub.copy(a);
    this.vel.set(0, 0, 0); this.velPrev.set(0, 0, 0); this.acc = this.span = 0; this.init = true;
  }
  begin(dt: number, a: THREE.Vector3, h: number, maxSteps: number): number {   // sub-steps to run now
    if (!this.init) this.reset(a);
    this.span += dt;
    this.acc = Math.min(this.acc + dt, h * maxSteps);
    const n = Math.floor(this.acc / h);
    if (n === 0) return 0;                                     // keep prev + span: no motion lost
    this.now.copy(a);
    this.velPrev.copy(this.vel);
    this.vel.subVectors(this.now, this.prev).divideScalar(this.span);
    this.owed0 = this.acc - this.span;                         // sim time owed when prev was sampled
    return n;
  }
  at(k: number, h: number, out: THREE.Vector3): THREE.Vector3 { // end of sub-step k; k - 1 = its start
    return out.lerpVectors(this.prev, this.now, THREE.MathUtils.clamp((k * h - this.owed0) / this.span, -1, 1));
  }
  finish(n: number, h: number): void { this.at(n, h, this.lastSub); this.acc -= n * h; this.prev.copy(this.now); this.span = 0; }
  carry(aNow: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 { return out.subVectors(aNow, this.lastSub); } // add to rendered points
}
```

Wiring in `ClothChain.update`: `n = clock.begin(dt, a, 1/90, 4)` and `anchorVel = clock.vel`;
per substep `clock.at(k, h, subAnchor)` then `simulate`; then `clock.finish(n, h)`; offset rendered
points by `clock.carry(a)`; `reset()` calls `clock.reset(a)`. Sheets use one clock per column top
(each column then damps its own ω×r). Sample collider centres the same way.

**Partial linear inertia** (fixes #8). λ_L is the share of the body's velocity change that the
strand feels; Dynamic Bone's Inert is 1 − λ_L. Run this after `begin()` returns n > 0:

```ts
_dv.subVectors(clock.vel, clock.velPrev);                               // anchor velocity change
_felt.copy(_dv).multiplyScalar(lambda).clampLength(0, maxAccel * clock.span);
_dv.sub(_felt).multiplyScalar(1 / 90);                                  // carried share as one kick
for (let i = 1; i < p.length; i++) p[i].add(_dv);                       // prev unchanged -> v += carried
```

Measured in a 26 m/s² free fall (chain rest tilted 11°): λ 1 → 179°, 0.6 → 23°, 0.38 → 14°.
Cruise is unaffected.

**General local-frame model** (relative chains approximate its linear part):
a_rel = R⁻¹[g·gScale − λ_L·a_F] − λ_A(α×r + 2ω×v_rel) − λ_C·ω×(ω×r) − k_drag·clamp(v_world − v_wind).
λ = 1 is world physics (the research prototype matched it within 3–5 cm over 1 s); λ = 0 is
rigidly local. Prototype at λ 0.5/0.5/0.6, drag 0.8, clamp 12: 9° at 30 m/s cruise (78° world
space), 11° peak stopping from 10 m/s, 0° on a 50 m teleport, 0°/16°/35° flare at 12 rad/s with
λ_C 0/0.6/1.

**Starting values.**
- **Shares:** λ_L 0.3–0.6 (0.38 makes the 26 m/s² fall weightless), λ_A 0.3–0.6, λ_C 0.4–1.0.
- **Clamps:** maxAccel 20–30 m/s² (a 30 m/s swing on a 15 m rope pulls 60 m/s²), maxOmega
  10–14 rad/s, maxAlpha 150–250 rad/s²; compare UE's ≈ 6 rad/s [UE-RigidBody] and SPCR's 5 m/s,
  540°/s [SPCR].
- **Teleports:** 1 m or 60° per substep in a local frame [Kawaii: 300 cm / 10° per frame]; here,
  > 2.5 m per frame or a kit-side `reset()` (respawn, Fighter.ts:247, and the bat form,
  elisabbatKit.ts:371, already reset).
- **Acceleration:** finite differences lag a substep; prefer the controller's, or low-pass
  (20–40 ms halflife).
- **Network:** remote cloth follows the puppet (lerp 25/s, snap above 8 m, Fighter.ts:935–936),
  so a 2–8 m correction is a ~50 m/s burst; the air clamp and λ_L absorb it.
- **Anchor frame:** head for hair; chest for strings, pendant, cape, hood; hips for skirts, coat
  tails, charms; weapon for dangles.

---

## 4. Hair
- **Shapes, not strands.** 5–9 locks of 3–6 segments, or a curtain split into clumps. Couple
  tightly inside a clump (horizontal slack 1.05–1.2, velocity averaging vᵢ ← (1 − c)vᵢ + c·avg,
  c 0.15–0.3 [FTL]) and weakly between clumps. Vary f and phase ±10–15 % per lock.
- **Root stiff, tip loose:** f_tip ≈ 0.45–0.6·f_root, ζ slightly higher at the root. The engine's
  single `damping` damps the tip more; raise d if the root must calm down.
- **Keep the sculpt:** per-segment rest directions (a gap: one `restDir` per chain). Blend the
  target between the anchor frame (shape) and the parent frame (whip): β ≈ 0 for bangs and spikes,
  0.5–0.8 for long locks.
- **Gravity compensation** [EZSoftBone; PhysBones]: gScale = base + (1 − base)·(1 − up_anchor·up_world)/2,
  base 0.15–0.3. Hair holds its shape upright and falls in flips. `restYawOnly` (Cloth.ts:434,
  sheets only) is the crude version.
- **Collisions:** head sphere = tube radius + 1 cm; neck capsule; shoulder spheres on the *chest*
  so a raised arm cannot flip hair over the face (elisabbat.ts:554–556); back plane; upper-arm
  capsules only for side locks.
- **Limits:** bangs 10–20° (≤ 5° backward), side locks 30–50°, long locks 35° root → 70° tip,
  never past ≈ 100°; a face plane.
- **Big actions:** a profile such as `{stiffMul 0.7, centrifugal 0.9, gScale 0.5}` (rise 0.05 s,
  hold, decay 0.3 s) plus authored impulses, e.g. a hair sweep along the spin tangent [Kawaii].
- **Rigid groups** (REX): `addSpikyHair` with `SpikeSpec.pivot` (body.ts:230–276) builds each
  spike relative to a pivot that is a head child with identity rotation (rex.ts `pivotAt`,
  :69–75). Hang the pivot on a `SpringBone`.
- **Cel-shading hygiene:** a dead zone (no pull under 1 mm and 2 cm/s); centripetal Catmull-Rom
  (the engine's `catmull` is uniform, Cloth.ts:381); parallel-transported frames, never Frenet;
  idle tip second-difference RMS < 0.5 mm.

## 5. Cloth costumes
- **Skirts:**
  - 12–32 columns × 2–4 rows on the hips (`closed: true`); inextensible verticals tethered at
    ≈ 102 %.
  - Unilateral horizontals: compress to 60–70 %, stretch ≤ 105–125 % [SPCR]. The engine has
    `slackH` (default 1.15) and a fixed 0.6 floor (Cloth.ts:599/651).
  - Bending: skip-one verticals at α 1e-4–1e-3.
  - **Leg-following rest directions:** restDirₖ = normalize(lerp(restHip, thighDir, wₖ)),
    wₖ = 0.6·max(0, cos(θₖ − θ_leg))² [Kawaii SyncBone], so kicks open the skirt before collision
    has to.
  - Thigh capsules (radius thigh + 1.5 cm) and shin capsules, previous-side push, friction
    0.2–0.3.
  - Cones inward ≤ 5–10°, outward ≤ 75–85° (never inverts in dives).
  - Centrifugal 0.8–1.0, λ_L ≈ 0.5 (0.38 for weightless jumps).
  - Lining and outline from the same particles (as `ClothSheet` does).
- **Hoodies and coats:** simulate only hems, tails, hood and strings. Coat tails get leg and seat
  capsules, a fore-aft hinge and LRA. A hood that is down is a `SpringBone`.
- **Capes and scarves in flight:** drag k 1.5–3 s⁻¹, air clamp 12–15 m/s. Deflection ≈ k·v_max/ω²;
  aim for 0.5–0.8 of the length at max speed (27 cm at 1.5 Hz, k 2, 12 m/s). Flutter from gust
  noise at ≈ 0.3·v/L Hz. Never cover the head or the camera.
- **Anti-explosion checklist** (✓ engine has it, ✗ missing): accumulator cap ✓; NaN guard + reset
  + warm-up ✗; max per-step displacement r·n_sub ✗; tethers and final length restore ✗; clamped
  frame inputs ✗ (air speed only); colliders per substep ✗; collide once per substep then one more
  constraint pass ✗ (collisions run in every iteration); no contradictory constraints ✗ (REX
  anchors inside colliders); unilateral slack ✓ (sheets); 10–30 warm-up substeps after reset ✗
  (reset snaps to straight rest).
- **LOD:** LOD0 ≤ 0.25 ms per character (typed arrays, no allocations, ~6 colliders per skirt, ~8
  per head of hair). LOD1 (> 15 m or < 25 % screen height): 45 Hz, 2 iterations, spheres. LOD2
  (> 35 m): springs only, sheets frozen. Off-screen: carry, then 6 warm-up substeps. At most 10
  simulated characters.

## 6. Rigid props on `SpringBone`
Static children read as plastic. Hang every rigid prop on a pivot.

### 6.1 API and behaviour
Constructor (Springs.ts:177–228):
`new SpringBone({ pivot, restDir, length, freq = 4, zeta = 0.35, gravity = 0.6, drag = 0.5, maxAngle = 60, inertia = 1 })`.
- It models the centre of mass as a point at `length` along `restDir`.
- A spring pulls the point to rest, damped relative to the rest point's velocity, so riding at a
  constant speed costs nothing.
- Gravity adds `gravity`·9.8 m/s². `drag` (1/s) acts on (v − wind), clamped at 12 m/s.
- The point is projected onto the link and clamped to a `maxAngle` cone, and the pivot rotates to
  aim at it.
- It runs at 120 Hz and resets when the pivot moves > 2 m in a frame.
- It captures `restQ` at construction and rewrites `pivot.quaternion` every frame.

`inertia` < 1 is not a fictitious-force share. It lerps the tip velocity toward the rest velocity
by (1 − inertia)/2 per substep, which is extra damping of −120·ln(1 − (1 − inertia)/2) s⁻¹ (0.9 →
6 s⁻¹, 0.8 → 13 s⁻¹, 0.5 → 35 s⁻¹). Leave it at 1 and tune ζ instead.

### 6.2 Tuning maths (validated with the §6.3 fix)
- **For hanging props, gravity is a second spring.**
  - **f_eff = √(f² + g_s·g/(4π²L))** and ζ_eff = ζ·f/f_eff.
  - A pendulum alone is (1/2π)√(g/L): 2.66 Hz at 3.5 cm, 2.03 Hz at 6 cm.
  - REX's pendant (`freq 2.2, gravity 1, length 0.035`) therefore swings at 3.45 Hz with ζ_eff
    0.13 (measured 3.43 Hz).
  - For a lazy 2 Hz swing, use `length 0.06` and `freq` 0.3–0.6.
- **Near-horizontal props droop**: θ ≈ g_s·g·cos(elevation)/(ω²L).
  - REX's hood sits 7.7° low inside its 10° cone (measured 7.7°).
  - Keep the droop under ⅓ of `maxAngle` (gravity 0.15 gives 2.3°), or pre-droop `restDir`.
- **Drag trail**: θ ≈ drag·min(v_air, 12)/(ω²L + g_s·g). REX's pendant trails 12.5° (measured
  12.5°); spikes trail ≈ 1°.
- **Spin**: flare is (ω_s/ω₀)²·r⊥, with no lag at constant spin (§1.3).
- **Airtime at full inertia**: gravity-0 spikes lean 2–4°, and hanging props pin on their cones
  (#8).

### 6.3 Fix for #3 and #4 (sketch, validated)
Sample the pivot and the rest point with two `SubstepClock`s:

```ts
// n === 0: re-apply last frame's pivot quaternion and return (update() has just written restQ)
for (let k = 1; k <= n; k++) {
  pivClock.at(k, H, _sp); restClock.at(k - 1, H, _r0);     // pivot at step end, rest point at step start
  const rv = restClock.vel;
  _a.subVectors(tip, _r0).multiplyScalar(-w * w).addScaledVector(_t.subVectors(vel, rv), -2 * zeta * w);
  _a.y -= 9.8 * gravity;
  vel.addScaledVector(_a, H);                               // then the clamped drag, unchanged
  tip.addScaledVector(vel, H);
  _dir.subVectors(tip, _sp).normalize();
  if (_dir.angleTo(_rd) > maxA) { /* clamp _dir as today */ vel.sub(rv).multiplyScalar(0.6).add(rv); } // relative bleed
  tip.copy(_sp).addScaledVector(_dir, length);
  vel.addScaledVector(_dir, -_t.subVectors(vel, rv).dot(_dir)); // drop radial velocity (#4)
}
// finish both clocks; aim the pivot from the last sub-step pivot _sp
```

Measured after the fix, identical from 30 to 144 fps: spikes trail 0.8° at 9.6 m/s and 1.0° at
30 m/s; the pendant trails 9.9° and 12.5°.

### 6.4 Recipes
- **Pivot placement.**
  - Put the pivot at the attachment (collar, neck base, the chain's lowest link, a thigh strap)
    with identity rotation, and build the meshes relative to it (rex.ts `pivotAt` + `rel()`,
    :69–76).
  - `restDir` points to the centre of mass, and `length` is the distance to it. `length` also
    sets the pendulum term.
- **Multi-segment props:** chain 2–3 SpringBones with falling f. Delayed copies of the parent
  rotation stutter at variable frame rates.
- **Impulses** (hits, recoil, landings): there is no public kick. Add `kick(v) { this.vel.add(v) }`
  (1.5–3 rad/s × length), or put a `SecondOrder`/`Kick` wobble on a child.
- **Twist:** on a child of the pivot, `twist = new SecondOrder(1, 1.5, 0.15)`;
  `twist.impulse(0, ±0.5)` on hits; `child.rotation.y = twist.update(dt, [0])[0]`.
- **Squash:** s = 1 + clamp(k·a_axis, ±0.08) along the motion axis, and 1/√s on the other axes.
- **Parts animated in `tick()`** (drum, rings): give the spring a separate parent group, or use a
  `SecondOrder` inside `tick()` (#11).

## 7. Physics with keyframed animation
- **Hand-key signature moments** (ultimates, intros, victories, emotes, silhouette frames)
  [ArcSys; Blizzard]; simulate locomotion, hits and environment. Bake authored moments with
  `scripts/blender/cloth_to_bones.py` (cloth → bone keys, error measured, GLB).
- **Animation-driven targets:** the sim tracks keyed bones as rest targets with a per-clip
  `poseStrength` 0.3–1.0 to lock a pose, then relaxes [SPCR; Chaos; Kawaii]. Here: rotate `restDir`
  or the pivot rest from the clip.
- **Per-clip curves** (physics weight, stiffness/damping multipliers, gravity scale, impulses):
  route them through clip `events` → `onAnimEvent` or `cue(id, v)`, on local and remote paths.
  `SpringBone` options are private, so add a `tune()` first; `ClothChain.o` is public.
- **Rigid props are additive:** key a parent, spring the pivot.
- **Transitions:** never crossfade sim against keys; inertialize (offset decayed by a critical
  spring, halflife 0.08–0.15 s) [Holden]. Never `reset()` cloth on a clip change.
- **Hitstop:** sim dt is already 0.06·dt; add a radial impulse on the hit frame so the release
  whips. **KO / ragdoll:** the same strands with λ = 1.

## 8. Wind and environment
Wind is an **air velocity** in the drag term, never a raw acceleration. It has three parts:
- **Base wind:** 2–4 m/s, with travelling gust fronts at ≈ 0.5 Hz and ±60 %. A workable field is
  w = base·(1 + gust·sin(0.63t + φ)·sin(1.71t + 1.3φ + 0.7)), with φ = 0.37x + 0.23z − 0.9t, so
  neighbouring characters and locks differ.
- **Radial blasts:** add speed·env(age)·(1 − r/R) along the outward direction, with a linear rise
  and an exponential decay.
  - Ultimate: 20–30 m/s, R 6–8 m, rise 0.05 s, decay 0.3 s.
  - Grenade: 15 m/s, R 4 m.
  - Landing puff: 3 m/s, R 1 m, applied only to skirts and capes.
- **The character's own speed:** already inside (v_world − wind). Never also feed −v as wind
  (#7).

Ghost of Tsushima favours "volume over accuracy" [GoT]; UE exposes Strength, Speed and Min/Max Gust
[UE-Wind]. Scale each accessory's response with its `airDrag`/`drag` (ribbons 1.5×, hair 0.6×,
spikes 0). To wire it in, set `anim.wind` from the field at Fighter.ts:1075, with blasts owned by
the match.

---

## 9. Parameter table
How to read the table:
- s₉₀ and d₉₀ apply to `ClothChain`/`ClothSheet` at 90 Hz, on **relative** velocity.
- `SpringBone` takes f and ζ.
- gScale is given upright → inverted.
- Drag is k in s⁻¹, clamped at 12 m/s.
- Inertia is L/A/C (the engine has λ_L only, via §3.1).
- (R) marks a rigid prop.
- Chain options are listed as stiffness/stiffFalloff/damping, solved with §1.5 for the given
  number of segments.

| Accessory | Engine type → options | Segs × length | f root→tip (Hz) | ζ | s₉₀ root→tip | d₉₀ | gScale | Drag | Inertia L/A/C | Cone | Collision |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Spiky / short hair group (R) | `SpringBone` freq 6, zeta 0.5, gravity 0 | rigid, 8–16 cm | 6 | 0.5 | 0.141 | 0.77 | 0 | 0 | 0.3/0.5/0.3 | 8–12° | none (cone only) |
| Bangs | `SpringBone` per group (freq 4.5, zeta 0.6, gravity 0.1), or `ClothChain` 3 seg 0.097/0.47/0.77 | 2–3 × 8–15 cm | 4.5→3.5 | 0.6 | 0.082→0.051 | 0.75→0.79 | 0.1→0.3 | 0.3 | 0.3/0.3/0.2 | 10–20°, back 5° | forehead sphere, face plane |
| Side lock | `ClothChain` 4 seg 0.049/0.69/0.91 | 3–4 × 20–40 cm | 3.0→1.8 | 0.4→0.35 | 0.040→0.015 | 0.88→0.93 | 0.2→0.8 | 0.6 | 0.4/0.4/0.5 | 30–50° | head, neck, shoulder, upper-arm capsule |
| Long lock / ponytail | `ClothChain` 6 seg 0.033/0.79/0.93 | 5–7 × 40–80 cm | 2.5→1.2 | 0.35→0.3 | 0.029→0.007 | 0.91→0.96 | 0.25→1.0 | 0.8 | 0.5/0.5/0.7 | 35°→70° | head, neck, shoulders, back plane, LRA 102 % |
| Braid | `ClothChain` 5 seg 0.022/0.68/0.95 | 5–6 × 40–60 cm | 2.0→1.2 | 0.3 | 0.019→0.007 | 0.94→0.96 | 0.6→1.0 | 0.5 | 0.5/0.5/0.7 | 45–70° | as long lock; bending α 1e-4 |
| Earring / dangle | `SpringBone` gravity 1, zeta 0.2, freq per §6.2; or `ClothChain` 2 seg 0.042/0/0.96 | 1–2 × 3–6 cm | 3.0 | 0.2 | 0.042 | 0.96 | 1.0 | 0.3 | 0.6/0.6/0.8 | 50° | jaw/neck sphere |
| Chain + pendant | `ClothChain` 3 seg 0.026/0.42/0.95 + pendant `SpringBone` (§6.2) | 2–3 × 10–15 cm | 2.2→1.8 | 0.25 | 0.023→0.015 | 0.95 | 1.0 | 0.3 | 0.6/0.5/0.7 | 55° | chest plane + chest capsule |
| Hood string | `ClothChain` 4 seg 0.049/0.62/0.945 | 3–4 × 12–20 cm | 3.0→2.0 | 0.25 | 0.041→0.019 | 0.94→0.95 | 1.0 | 0.5 | 0.6/0.5/0.6 | 70° | chest plane, belly capsule |
| Coat tail | `ClothSheet` open, 4 rows 0.022/0.64/0.92 (`BoneChain` on GLB) | 3–4 × 30–60 cm | 2.0→1.3 | 0.4 | 0.018→0.008 | 0.91→0.94 | 0.6→1.0 | 1.0 | 0.5/0.4/0.6 | hinge ±70° | thighs, seat, LRA |
| Skirt (columns) | `ClothSheet` closed, 3 rows 0.029/0.68/0.92, slackH 1.15–1.25 | 2–4 × 15–45 cm | 2.2→1.4 | 0.4 | 0.022→0.009 | 0.90→0.93 | 0.5→1.0 | 0.6 | 0.5/0.5/0.9 | in 5–10° / out 80° | thigh and shin capsules, hips, LRA |
| Cape | `ClothSheet` open, 5 rows 0.012/0.68/0.95 | 4–6 × 60–100 cm | 1.5→0.9 | 0.35 | 0.011→0.004 | 0.94→0.96 | 0.8→1.0 | 2.0 | 0.5/0.4/0.6 | 100–120° | back plane, shoulders, LRA |
| Scarf end | `ClothChain` ribbon, 5 seg 0.012/0.61/0.956 | 4–5 × 40–70 cm | 1.5→1.0 | 0.3 | 0.011→0.005 | 0.95→0.96 | 0.8→1.0 | 2.0 | 0.6/0.5/0.7 | 110° | chest and back planes |
| Ribbon | `ClothChain` render 'ribbon', 5 seg 0.012/0.61/0.973 | 4–6 × 20–40 cm | 1.5→1.0 | 0.2 | 0.011→0.005 | 0.97→0.98 | 0.5→0.7 | 3.0 | 0.6/0.6/0.8 | 120° | torso capsule only |
| Tail | `ClothChain` 6 seg 0.032/0.67/0.91 | 5–8 × 40–90 cm | 2.5→1.5 | 0.4 | 0.028→0.011 | 0.90→0.93 | 0.3→0.6 | 0.5 | 0.5/0.5/0.6 | 60° | legs, seat |
| Animal ear (R) | `SpringBone` freq 5, zeta 0.5, gravity 0 | rigid | 5 | 0.5 | 0.102 | 0.79 | 0 | 0 | 0.4/0.6/0.3 | 15° | none |
| Headphones (R) | `SpringBone` freq 7, zeta 0.4, gravity 0.2 | rigid | 7 | 0.4 | 0.194 | 0.84 | 0.2 | 0 | 0.4/0.3/0.2 | 6–10° | none |
| Pouch / holster (R) | `SpringBone` freq 8, zeta 0.35, gravity 0.3 | rigid | 8 | 0.35 | 0.252 | 0.90 | 0.3 | 0 | 0.6/0.3/0.2 | 5–8° | none |
| Antenna / "boing" (R) | `SpringBone` freq 5, zeta 0.12, gravity 0 (verlet cannot: d > 1) | rigid | 5 | 0.12 | n/a | n/a | 0 | 0 | 0.5/0.7/0.5 | 25° | none |

Entering the numbers:
- **`SpringBone`:**
  - `maxAngle` = Cone, `drag` = Drag (0.2–0.3 for a mild trail), `inertia` 1.
  - For hanging props, set `freq` = √(f² − g_s·g/(4π²L)). If that is imaginary, lengthen L.
  - Set `zeta` = ζ·f_eff/freq.
- **`ClothChain`:** `relative: true`, the listed triple, `airDrag` = Drag, `maxAir` 12, `drag` 0,
  and `gravity` = 9.8·gScale m/s².
- **`ClothSheet`:** the same over rows. Damping stays world-space until it has a relative mode
  (#9). `restYawOnly` stands in for gScale on hair, and `slackH` sets the flare.

Static sag at gScale 1 is g/ω² (17 cm at a 1.2 Hz tip), which is why gScale exists. Scale
collider radii by the rendered thickness.

---

## 10. REX and Elisabbat

### 10.1 The research gap list vs current `Cloth.ts`

1. World-velocity damping: ✓ `ClothChain relative` (Cloth.ts:45–52, 197–217); ✗ sheets,
   `BoneChain`.
2. End-of-frame anchors and colliders on every substep: the chain anchor position is interpolated
   (but k/n, #2); rotation ✗ (#12); colliders ✗ (#5); sheets ✗.
3. No render interpolation: ✗ (#2).
4. Reset to straight rest above 6 m: unchanged, and #1 makes it fire every frame away from the
   origin.
5. One `restDir` per chain or column: ✗.
6. Spheres only: ✗; REX passes all 11 body spheres.
7. Wind as acceleration: ✓ relative chains and `SpringBone`; ✗ sheets; −0.6·vel still fed (#7).
8. Constant gravity: ✗ (`restYawOnly` on sheets only).

New since the research: `SpringBone`, with issues #3, #4 and #8.

### 10.2 REX (src/champions/rex.ts, values as set)

| Part | As set | Today (measured) | Research | Action |
|---|---|---|---|---|
| Spikes front/crown/back (pivots :166–168) | `SpringBone` `freq 6.5/6/5, zeta 0.5, gravity 0, maxAngle 10/10/12, drag 0.2, length 0.09/0.1/0.1` (:236–238) | Idle 0.1–0.2°. Pinned from 2 m/s (#3). Fixed: ≤ 1.3° at 30 m/s, 4–6° spin flare | f 6.5/6.0/5.0, ζ 0.5, cone 8–12°, ±10 % per spike, flip profile (angular 0.8). Never soft chains | Values match. Add per-spike variation and a flip profile |
| Headphones (:133) | `freq 7, zeta 0.4, gravity 0.2, maxAngle 8, length 0.05` | 1.1° droop. Pinned at speed (#3) and in jumps (#8) | Same, plus a ≤ 1 cm bob from a 7 Hz spring kicked on landing | Add the bob as a child offset: `Kick(7, 0.4).hit(0.01)` |
| Pendant (:142) | `freq 2.2, zeta 0.2, gravity 1, maxAngle 35, drag 0.3, length 0.035` | No swing (#4). After the fix: 3.45 Hz, ζ_eff 0.13 | f 2.0, ζ 0.2, cone 55°, arm 6 cm; twist 1.5 Hz/0.15 kicked ±0.5 rad/s; chest-plane reflect; clink SFX above 3 rad/s at the cone | `length 0.06, freq 0.5, maxAngle 55` (≈ 2.1 Hz); twist via `SecondOrder` |
| Hood (:113) | `freq 3.5, zeta 0.4, gravity 0.5, maxAngle 10, length 0.07` | 7.7° droop in a 10° cone; pinned in jumps | f 3.5, ζ 0.4, max 10°, gravity 0.5; bounces on landings | `gravity 0.15` or `maxAngle 16` |
| Pockets (:148) | `freq 8, zeta 0.35, gravity 0.3, maxAngle 6, length 0.06` | 0.3–0.5° | Same; optional 1 cm footfall squash | Matches |
| Drawstrings (:245–261) | `ClothChain` ×2: `segments 4, length 0.17, stiffness 0.035, stiffFalloff 0.7, damping 0.94, relative, airDrag 0.5`; all body spheres | 2.5→1.5 Hz, ζ 0.26→0.35. Broken (#1). Fixed: 15.6° off at rest, 77° at 30 m/s (#5) | 3 segments over 15 cm, 3.0→2.0 Hz, ζ 0.25, heavy aglet (wInv 0.5), chest plane, belly capsule, cone 70° | `stiffness 0.049, stiffFalloff 0.62, damping 0.945`; replace the chest sphere with a chest plane |
| Hip charm (:263–277) | `ClothChain`: `segments 4, length 0.22, stiffness 0.04, damping 0.9, relative, airDrag 0.6` | 2.7→1.9 Hz, ζ 0.37→0.47. Crumpled 120° (#1, #5) | Hips frame, 2.5→1.8 Hz, ζ 0.3, thigh capsules | `stiffness 0.033, stiffFalloff 0.55, damping 0.935`; thigh capsules |
| Drum (:201, :286, :343–346) | index `SecondOrder(1, 6, 0.55, −0.35)`, +⅛ turn per shot; spin `charge²·40` rad/s | ✓ Snaps | (6, 0.5, −0.3) ✓, plus a 10 Hz, ζ 0.3, 6° jiggle kicked 1.5–3 rad/s per shot | On a parent group: `SecondOrder(2, 10, 0.3)` impulsed on `cue('shot')` |
| Equalizer (:214, :354–355) | One `uEnergy`; `eqKick` += 0.6·k per shot, decays 3/s | All bands move together | `uLevels[10]` via `SecondOrder(10, 9, 0.4, 2)`: band noise 1.5–4 Hz, fire +0.8, charge on lows, hits on highs; peak caps fall at 3/s² | Per-band uniform in `equalizerMaterial` (render/toon.ts:475) |
| Rings (:331–342) | pulse × e^(−16·dt), 25 ms stagger | Fine | — | Optional: `SecondOrder` with r > 1 |
| Recoil | `Kick` springs (`KICK_TUNE`, FighterAnimator.ts:40) | Done | Spring plus a velocity kick | Done (game-feel.md) |
| Weapon yaw lag | — | Missing | 1–2° at 5 Hz, ζ 0.7 | `SecondOrder(1, 5, 0.7)` on the aim-yaw delta |

### 10.3 Elisabbat (src/champions/elisabbat.ts)

| Part | As set | Today (measured) | Research | Action |
|---|---|---|---|---|
| Hair curtain (:549–577) | `ClothSheet` on the head, 19 × 6, `stiffness 0.05, stiffFalloff 0.75, damping 0.9, gravity 9, slackH 1.5, restYawOnly`; lengths 0.52–0.82 m. Colliders: body spheres without the arms, head 0.118, neck 0.07, chest-mounted shoulders 0.075, back 0.14, hips | 3.1→1.65 Hz; sag ≈ 8 cm; idle 4.3°, 0.31 mm ✓; 56° at 9.6 m/s | 5–7 clumps of 3 columns (slack 1.05 and averaging 0.25 inside, 1.5 between); curved rest directions; 2.5→1.2 Hz, ζ 0.35→0.3; aligner gScale 0.25→1; tethers 102 %; drag 0.8; back plane; flip profile (centrifugal 1, stiffness × 0.7) | First a sheet relative mode, then `stiffness 0.033, stiffFalloff 0.79, damping 0.934` |
| Skirt tiers (:531–546) | 3 sheets on the hips, `rows 2, closed, stiffness 0.19/0.17/0.15` (top/mid/bottom), `stiffFalloff 0.3, damping 0.88, gravity 7, slackH 1.25`; 28/30/32 columns; body spheres + hips 0.15 | 6.25→5.0 Hz; 26–27° at 9.6 m/s; 59–69° with 77 % stretch at 30 m/s; 17–18° in spins | 3–4 Hz once relative; thigh-following rest directions; thigh and shin capsules; cones in 8°/out 80°; centrifugal 0.9; tethered bottom rows; stagger ×1/0.92/0.85; frills in the vertex shader | After the relative mode: top `0.069/0.41/0.9` (3.5→3.0 Hz), mid 0.059, bottom 0.050 |
| Bangs, ear locks (:467, :472) | Static | Rigid | 4.5→3.5 Hz, ζ 0.6, cone 15° (5° back), face plane 1.5 cm | `SpringBone` per group at the temple: `freq 4.5, zeta 0.6, gravity 0.1, maxAngle 15` |
| Ribbons | None | — | 4–6 seg, 1.5→1.0 Hz, ζ 0.2, drag 3, cone 120°, gScale 0.6, ±0.3 rad tip twist | `ClothChain` 'ribbon' `0.012/0.61/0.973`, `airDrag 3` |
| Earrings (:457–459) | Static | Rigid | f 3, ζ 0.2, cone 50° | `SpringBone length 0.02, gravity 1, freq 0–1` (the pendulum alone is 3.5 Hz) |
| Bat form (elisabbatKit.ts:371) | Resets cloth when she turns back | ✓ | Carry + 6 warm-up substeps; 20 m/s radial blast, R 5 m | Add the blast once wind is a field |

---

## 11. QA: debugging and acceptance

### 11.1 Debug views
The project has no GUI library. Draw these with `LineSegments`/`Points` in the viewer or a
scenario:
- Particles coloured by strain.
- Rest targets.
- Colliders, planes and cones.
- Frame acceleration and ω vectors, with clamp and teleport markers.
- Per-chain f, ζ and energy.
- Slow motion and frame stepping (the capture lab's virtual clock; see verification.md).
- Deterministic input replay.
- Sim on/off A/B.

### 11.2 Motion suite
- Idle, 10 s.
- Spin, 720°/s for 1 s.
- Sprint at 9 m/s (GGG run speed 9.6) to a sudden stop.
- Jump and land from 3 m.
- 30 m/s grapple dive to a stop.
- 15 m rope pendulum.
- Front and back flips.
- 5 m and 50 m teleports.
- Respawn.
- Camera-cut close-up.
- 120 ms hitstop.
- Knockback.
- Frame-rate sweep: 30, 60, 144 Hz and variable.

### 11.3 Acceptance checklist
1. Idle: no visible jitter; tip displacement RMS < 0.5 mm; no outline flicker at 1080p.
2. A sudden stop settles in < 1.0 s for hair and < 1.5 s for skirt or cape; overshoot ≤ 30 % of
   the peak deviation.
3. Spin: flare is visible, but no lock passes its cone and no hair crosses the face plane.
4. 30 m/s dive: the cape streams to 0.5–0.8 of its length, hair stays within 45°, no chain lies
   flat.
5. Grapple swing: outward flare, chain stretch ≤ 3 %.
6. A 50 m teleport or respawn gives no pop beyond one frame and no stretch.
7. A 5 m blink behaves like a teleport and never yanks the chain.
8. Network correction snaps on remote players do not explode the sim.
9. Tip trajectories agree within 5 % across 30, 60 and 144 Hz.
10. No judder at 144 Hz (render interpolation).
11. Roots never detach from their anchors at any speed.
12. Skirt-thigh penetration < 1 cm in 99 % of frames during kicks and runs.
13. Hair-head/neck/shoulder penetration < 1 cm in 99 % of frames.
14. Drawstrings and pendant never sink into the chest (plane-enforced).
15. Bangs never cover both eyes in gameplay poses.
16. A skirt never inverts over the hips in dives or flips.
17. Chain stretch < 3 %; skirt horizontal stretch stays within the slack.
18. An injected NaN resets cleanly with warm-up.
19. Hitstop freezes or slows secondary motion consistently with the body.
20. Per-move profiles blend in and out without pops.
21. Gusts are not synchronous across characters; blasts push away from the source with falloff.
22. Rigid props: spin-up gives a transient, constant spin gives no lag, recoil kicks settle within
    0.3 s.
23. The equalizer reacts to fire, charge and hit events within 50 ms.
24. ≤ 0.25 ms per character at LOD0, ≤ 2 ms for 10 characters on a mid-range laptop, zero
    steady-state garbage (heap snapshots).
25. LOD switches and off-screen resume show no pop.
26. Keyed poses: alpha and pose-strength curves hit the authored silhouette within 2 cm.

GGG additions:

27. No anchor lies inside its own colliders, and the rest shape clears every collider.
28. Idle rest deviation < 5°, unless sag or droop is intended (§6.2).
29. A chain more than 6 m from the origin still moves (#1).
30. Hanging props stay off their cone walls during a normal jump (#8).
31. Local, bot, remote and viewer copies agree. The viewer runs in place, so test speed in
    scenarios or the harness.

### 11.4 Headless harness: `tools/sm_report.ts`
`npx tsx tools/sm_report.ts <champ> [fps]` drives the real builder and `FighterAnimator` without a
browser along fixed tracks (idle, a 9.6 m/s run, a 30 m/s dive, an instant stop from 10 m/s, a
720°/s spin, a 26 m/s² fall, a 5 m blink, a 28 m teleport) and prints, per SpringBone and
ClothChain, the peak / final angle off rest and the worst chain stretch (`NOCOL=1` disables the
body colliders). Sheets and GLB bone chains are not measured (filmstrips). Run it at 30, 60 and
144 fps: the numbers must agree.

REX after the pass (60 fps; peak/final): idle everything ≤ 9° (the drawstrings' 9° is their
gravity sag); run: hair ≤ 4°, pendant 35/10 (its cone on the start), drawstrings 21-40/9-20; 30 m/s
(a 2 s ramp from rest): hair ≤ 11°, drawstrings 53-103/10-24; instant stop from 10 m/s: strings
flick up (140-150°) and settle to 9°, stretch 8 % (the follow-the-leader cap); blink and
teleport: identical to idle, stretch 1 %. Before the pass the charm streamed at 79° in a run and
88° at 30 m/s, flipped to 173° in a fall and stretched 1203 % on a 5 m blink. Non-relative chains on other champions (Kaiser, Nova, Sera) still stream at
speed (55-100°): they damp in world space (§3.1).

### 11.5 Debugging

Symptom → cause → fix (issue numbers from §3.1):
- Chain rigid away from the origin, alive near it → #1 → its own anchor vector.
- Thrashing every other frame at 60 fps → #1 or #2 → `SubstepClock`.
- Prop pinned whenever the character moves → #3 → §6.3.
- Flicker or detached roots at 144 Hz only → #2 → render carry.
- Pendant glued → #4, or f_eff too high from a short arm (§6.2).
- Streams flat at speed → #9, #10, or too much `airDrag` (deflection ≈ k·v_max/ω²).
- Strands flip up every jump → #8 → λ_L 0.38.
- Explodes after a blink → #6 → `reset()` from the kit, locally and remotely.
- Crumpled or offset at rest → #5 → per-strand lists, planes.
- Hair through the face when an arm rises → shoulder spheres on the arm → mount them on the chest;
  face plane.
- Outline shimmer at idle → sub-mm jitter → dead zone.
- Everything moves in unison → identical tuning → ±10–15 % f and phase.
- Spring fights an animated part → #11 → spring a child.
- Remote copies jerk on corrections → puppet bursts → air clamp, λ_L, `reset()` on snaps.
- Motion freezes ~0.1 s on hits → hitstop (Match.ts:672), expected → release impulse.

---

## 12. Sources
Primary (read directly):
- [VRM] https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_springBone-1.0/README.md
- [Kawaii] https://github.com/pafuhana1213/KawaiiPhysics
- [SPCR] https://github.com/SPARK-inc/SPCRJointDynamics
- [EZSoftBone] https://github.com/EZhex1991/EZSoftBone
- [NvCloth] https://github.com/NVIDIAGameWorks/NvCloth/blob/master/NvCloth/include/NvCloth/Cloth.h
- [Holden] https://github.com/orangeduck/Spring-It-On ; https://theorangeduck.com/page/spring-roll-call
- [Juckett] https://www.ryanjuckett.com/damped-springs/
- [t3ssel8r] https://www.youtube.com/watch?v=KPoeNZZ6H4s
- [PBD] https://matthias-research.github.io/pages/publications/posBasedDyn.pdf
- [XPBD] https://matthias-research.github.io/pages/publications/XPBD.pdf
- [SmallSteps] https://matthias-research.github.io/pages/publications/smallsteps.pdf
- [LRA] https://matthias-research.github.io/pages/publications/sca2012cloth.pdf
- [FTL] https://matthias-research.github.io/pages/publications/FTLHairFur.pdf
- [OrientedParticles] https://matthias-research.github.io/pages/publications/animParticles.pdf
- [TMP14], [TMP15] https://matthias-research.github.io/pages/tenMinutePhysics/14-cloth.pdf , …/15-selfCollision.pdf

Via summaries:
- [Chou] https://allenchou.net/2015/04/game-math-precise-control-over-numeric-springing/
- [Jakobsen] https://code.tutsplus.com/simulate-tearable-cloth-and-ragdolls-with-simple-verlet-integration--gamedev-519t
- [DynBone] https://g.freya.cat/unityprojects/plain/VRCSDK3AvatarsLegacy/Assets/Resources/DynamicBone/ReadMe.txt
- [PhysBones] https://creators.vrchat.com/common-components/physbones
- [UE-AnimDyn] https://dev.epicgames.com/documentation/unreal-engine/animation-blueprint-animdynamics-in-unreal-engine
- [UE-RigidBody] https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/AnimGraphRuntime/FSimSpaceSettings
- [Chaos] https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ChaosCloth/UChaosClothConfig
- [UE-Wind] https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/UWindDirectionalSourceComponent
- [Unity] https://docs.unity3d.com/ScriptReference/Cloth-worldVelocityScale.html
- [HoYo] https://blog.csdn.net/m0_55815830/article/details/131316388
- [ArcSys] https://www.arcsystemworks.com/guilty-gear-xrd-art-talk-at-game-developers-conference-2015/
- [Blizzard] https://dl.acm.org/doi/10.1145/3587421.3595447
- [Insomniac] https://www.gdcvault.com/play/1025663/Technical-Artist-Bootcamp-Real-Time
- [GoT] https://gdcvault.com/play/1027124/Blowing-from-the-West-Simulating

*Measured* = the §11.4 harness on the 2026-10-11 working tree.
