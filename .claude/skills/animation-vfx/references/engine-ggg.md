# GGG engine reference for animation, VFX and feel

Use this file before writing any animation, VFX or feel code in PROJECT GGG. It documents the
APIs as they are in `src/` (three.js r186, TypeScript), their conventions and sign tables, the
per-frame order, and the gotchas that already cost a debugging session. Read the domain references
for *what* to build; this file is *how* it plugs in.

Contents
1. Coordinates and rig
2. Poses and specs (`Animator.ts`)
3. Clips (`clip()`, options, easing, events, beats)
4. Champion anim set (`locomotion.ts`)
5. The per-frame order (`FighterAnimator.update`)
6. IK: arms, legs, the support hand, elbow hints
7. Recoil kicks (`KickSpec`) and camera kicks
8. Inertialization
9. Springs and cloth (`Springs.ts`, `Cloth.ts`)
10. Champion visual (`types.ts`): tick, cue, markers
11. Kits: actions, events, remote copies, network fields
12. VFX API (`Effects`, `Segments`, `Decals`, particles, `bloomColor`)
13. Projectiles: visual hooks
14. Feel: shake, hitstop, camera kick, flashes
15. Music: `Beat`
16. Gotchas (each one cost real time)

---

## 1. Coordinates and rig

| Item | Convention |
|---|---|
| Model space | **+Z forward, +X = the character's LEFT, +Y up**, feet at y = 0 |
| Bones | 19: `hips spine chest neck head shoulderL/R upperArmL/R foreArmL/R handL/R thighL/R shinL/R footL/R` (`src/fighter/Rig.ts`) |
| Limbs | extend along the bone's **-Y**; elbows bend toward the bone's -Z (back), knees toward +Z (front) |
| Euler | degrees, order **YXZ** (yaw, then pitch, then roll) |
| Signs | `x+` pitches the bone's +Y toward +Z (spine: lean forward); `y+` yaws toward the character's left; `z+` rolls (spine: lean to the right side... check with a still) |
| `pose.addEuler(bone, x, y, z)` | post-multiply: rotation in the bone's **local** frame |
| `pose.preEuler(bone, x, y, z)` | pre-multiply: rotation in the **parent's** frame (what procedural layers use) |
| Body sizes | `bodySpec('heavy')` etc.; `footHeight` = ankle height when the foot is flat (Rex 0.08 m) |

A pre-rotation of the spine is a rotation about the hips' frame, which is yawed by the pelvis: it
is **not** a model-space rotation. Anything that must ride on the torso (a shouldered stock) has to
be carried with `parentWorld · e · parentWorld⁻¹` about the joint (see `FighterAnimator.carry`).

## 2. Poses and specs (`src/fighter/Animator.ts`)

```ts
pose(spec: PoseSpec, base?: Pose): Pose
type PoseSpec = Partial<Record<bone, JointSpec>> & {
  hips?: [x, y, z];          // pelvis translation (m) from rest
  pelvis?: JointSpec;        // pelvis rotation (deg YXZ): contrapposto, weight shift, recoil hip turn
  wR?: WeaponSpec | null;    // right-hand weapon IK
  wL?: WeaponSpec | null;    // left hand: second weapon, or a bare-hand gesture
  fL?: FootSpec | null;      // planted-foot IK (ankle target)
  fR?: FootSpec | null;
  off?: number;              // 0..1 left hand on the two-handed weapon's off-hand grip
};
type JointSpec = [x, y, z] /* deg */ | { dir: [x, y, z]; twist?: number } /* limb direction */;
interface WeaponSpec { p; d; u; w?; e? }   // all model space
interface FootSpec { p; yaw?; pitch?; w? }
```

| Field | Meaning |
|---|---|
| `WeaponSpec.p` | weapon origin (its grip, as placed under the hand) in model space |
| `WeaponSpec.d` | weapon +Z (barrel / blade direction); `u` = weapon up (spine side), orthogonalized |
| bare hand (`weaponL/R` null) | `p` is the **wrist**, `d`/`u` the hand frame |
| `WeaponSpec.e` | **elbow hint**: model-space direction the elbow points to; length = override weight; keys lerp it (§6) |
| `FootSpec.p` | ankle position; `y = footHeight` is flat on the ground |
| `FootSpec.pitch` | + = toes up (stored as Euler x = -pitch); `yaw` + = toes toward the left |

Rex helpers worth copying (`src/champions/rex.ts`):
- `shouldered(spec, d, u, push)` poses a scratch rig with the key's torso and returns the grip that
  puts the butt plate on the chest-local shoulder pocket. Use it for every shouldered key.
- `FL(x, z, yaw, pitch, y)` builds a `FootSpec`; one `feet` object shared by every standing pose
  means switching poses never slides a planted foot.
- `W(p, d, u, e)` builds a `WeaponSpec` with an elbow hint.

## 3. Clips

```ts
clip(name, base: Pose, keys: Array<[t, PoseSpec | Pose, Ease?]>, opts?: ClipOptions): Clip
const F = (n: number) => n / 60;   // author keys in frames at 60 fps
```

- `t` is seconds, or **beats** when `opts.beats` (the clip then plays at `bpm/60` and is phased so
  t = 1 lands on the next downbeat).
- The ease on a key shapes the segment **into** that key. Default `opts.ease ?? Ease.inOut`.
- `Ease`: `linear inQuad outQuad inOut outCubic inCubic outQuart outExpo outBack outSine inOutCubic
  step smooth`. Rules of thumb: `outExpo`/`outCubic` into extremes (impacts, recoil), `linear`
  through passing keys, `inOut` only hold-to-hold, `inQuad` for accelerating compression (charge).
  An `outBack` on a key also overshoots its **weights** (`off`, `w`): clamp-safe now, but it reads as
  a twitch on IK hand switches: prefer `inOut` there.

| `ClipOptions` | Use |
|---|---|
| `loop` | cycles |
| `events: [{ t, id, kick? }]` | fired once when the clip passes `t`; `id` goes to `kit.onAnimEvent` (or the taunt handler) and `visual.onAnimEvent`; `kick` fires a recoil on **every copy** of the clip (local, remote, viewer) |
| `mask` | bone mask (e.g. upper body only) |
| `fadeIn`, `fadeOut` | crossfade times (champions with `inertial` replace fade-in by inertialization) |
| `lag: { neck: 2, head: 3 }` | per-bone delay in **frames**: overlap without extra keys |
| `beats` | author in beats (taunts, emotes) |
| `inertia` | per-clip inertialization half-life (s). Fast actions whose key pose must show within a few frames (a throw releasing at f6) need 0.025-0.035; the champion default (Rex 0.07) would swallow the coil |

Remote copies: start the clip 2 frames before the first event with `play(name, { offset })` so the
event (and its kick) still fires on that copy.

## 4. Champion anim set (`ChampionAnimSet`, `src/fighter/locomotion.ts`)

| Field | Meaning | Rex |
|---|---|---|
| `idle`, `runArms`, `airArms`, `flyArms` | base poses | |
| `clips` | named clips (`sharedClips(idle)` adds hit/stun/death/roll/victory) | |
| `armSwing`, `offhandLoco`, `runLean` | run arm swing amplitudes, off-hand weight in loco, lean | `[0,0]`, 1, 2 |
| `stride` | metres per two steps (heavy 3.0-3.4; wall-run keeps 2.3) | 3.2 |
| `runBob` | heavy footfall bob amplitude (m) | 0.045 |
| `legSwing` | leg swing multiplier | 1.12 |
| `relaxed`, `relaxVia` | relaxed idle after ~2.5 s calm; `relaxVia` routes a long weapon around the head | |
| `idleLife` | weight shift (7.5 s) + asymmetric breathing (3.4 s) + head drift | 1 |
| `groove` | head nod / sway on the beat while free | 1 |
| `inertial` | inertialization half-life (s) for clip transitions | 0.07 |
| `landDepth`, `landRecover` | landing compression and recovery time | 1.25, 0.42 |

## 5. The per-frame order (`FighterAnimator.update`)

1. `loco.evaluate` (idle / run / air / fly / dash blend, relaxed, idle life)
2. `action.update` → events; their `kick`s go to the recoil springs
3. `action.apply` (clip pose over loco), `flinch`, procedural hit react, `animScale`
4. **inertialization** of the clip pose and its IK targets (§8)
5. look-at (neck / head, and chest when aiming), aimed-weapon rotation about the shoulder pivot
6. **recoil** (§7): hinge at the stock, body absorption, weapon carried by the torso
7. **groove** (beat nod; the shouldered weapon is carried with the chest)
8. **tremble** (`anim.tremble` deg, `anim.trembleHz`; two incommensurate sines; 40 % on the chest)
9. `applyPose` (FK) → **foot IK** (ground-clamped) → **hand IK** (right; left = one merged chain)
10. `inert.rememberVisible` (the IK limbs as shown) → `syncPose` → springs and cloth

Procedural layers 5-8 run *after* inertialization on purpose: they are continuous by themselves,
and running them on top keeps the recoil hinge exactly on the stock while a transition decays.

## 6. IK

`solveTwoBone(upper, lower, end, target, pole, weight, frontJoint, memo)`:
- weight 1: analytic solve; the elbow/knee goes toward `pole` (any world point; only its direction
  from the root, perpendicular to the root→target line, matters).
- **reach floor**: a target closer than 25 % of the limb length is pushed out (the joint never
  folds below ~30°, and the bend plane never goes undefined at the root joint).
- **partial weight** blends in limb terms: the reach direction (slerp on the sphere around the root
  joint, temporally coherent), the reach distance (lerp) and the joint's swivel around the axis,
  from where FK had them to the target and pole, then solves fully; the bones' twist is faded in
  over the first 20 % of the weight.
- `IKMemo` per chain keeps the last result for coherence (the animator owns one per chain).

Arms (`FighterAnimator.solveWeapons`):
- right: `wR` → weapon (or bare wrist) target, pole `POLE_ARMED [0.5,-0.5,-0.3]` /
  `POLE_BARE [0.6,-0.3,-0.1]` (x mirrored per side), overridden by the key's `e`.
- **left: one chain** whose wrist target is blended between the off-hand grip (`off`) and the `wL`
  key, swung **around the shoulder** (direction slerp + distance lerp); weight `min(1, off + wL.w)`.
  Two solves in a row on the same bones (the old code) swing the elbow through the shoulder.
- support-hand pole: `POLE_GRIP [0.45,-0.55,-0.25]`, or the visual's `gripElbow` given in the
  **weapon's frame** (Rex `[0.35,-0.85,-0.25]`: under the rifle, a little out and back) so a rifle
  raised skyward keeps the elbow under it.
- **elbow hints**: any fixed pole has a target direction where it lines up with the arm and the
  elbow flips (a hairy-ball fact, not a bug to tune away). When `anim_report` says "elbow bend
  plane > 45°/frame", give the keys around it an `e` (out at the hip `[1,0,-0.2]`, down-out under a
  raised palm `[0.55,-0.83,0]`, out-down overhead `[0.9,-0.4,0]`, down-back while the hand passes
  in front `[0.3,-0.75,-0.6]`). Keys lerp `e` with the hand, so author it on every key of the path.

Legs: `fL/fR` ankle targets, pole in front of the knee along the toe direction, **ground clamp**
(`y >= footHeight`) so no transition offset or hop key can push a foot through the floor.

## 7. Recoil kicks and camera kicks

```ts
f.anim.kick({ pitch, back, roll, yaw, body, freq, zeta, rise, hang })  // from a kit (dynamic)
events: [{ t: F(6), id: 'fire', kick: { ... } }]                       // from a clip (every copy)
```

| Field | Meaning | Typical |
|---|---|---|
| `pitch` | muzzle climb (deg at the peak) | light 3-4.5, heavy 16, release 17-20 |
| `back` | shove along the barrel (m) | 0.035 / 0.05 / 0.1 |
| `roll`, `yaw` | deg, sign = direction | ±0.6-1.2 / ±3 |
| `body` | 0 arms only … 1 the whole body rocks (hips back and down, knees) | 0.35 / 1 |
| `freq`, `zeta` | return spring (Hz, damping) of the climb; the others scale with it | light 6.5 Hz ζ 0.55 (default); heavy 3.6 Hz ζ 0.62; release 2.9 Hz ζ 0.62 |
| `rise`, `hang` | heavy envelope: rise in `rise` s (outExpo), moving hold `hang` s (drifts 10 %), then the spring returns from rest (eases in) | heavy 0.03 / 0.065; release 0.035 / 0.085 |

Measured envelopes (`Kick`): light impulse 6.5 Hz ζ 0.55 → peak f2, 70 % gone f5, undershoot 11 %,
settled f9. Heavy 3.6 Hz ζ 0.62 r 0.03 h 0.065 → peak f2, hold to f6, 70 % gone f11, undershoot
7 %, settled f20 (matches the research table: rise 1-2 f, hang 2-6 f, return 6-12 f, settle 10-20 f,
undershoot 3-8 %).

The hinge is the weapon's `stock` marker (else `(0, 0, stockZ)`): the muzzle climbs, the butt stays
in the pocket. Only 30 % of `back` slides along the barrel (shoulder compression); the rest is
carried by the torso (lean + twist of the right shoulder back) and, for `body > 0.6`, the hips.
Verify with `anim_report`: stock gap ≤ 2 cm through the kick.

**Camera kick is separate** (cosmetic, the aim never moves): `m.cameraKick(f, pitchDeg, yawDeg,
rollDeg, fovDeg)`, applied only when `f` is the viewed fighter. Own light shots: 0.3-0.4° and no
shake; heavy: 1.5-2° + FOV -3; biggest release: 3-4° + FOV -4 (perfect -6).

## 8. Inertialization (`src/fighter/Inertialize.ts`)

- `play()` on a champion with `inertial` shows the new clip at once and `trigger(halfLife)`s an
  offset = (what was on screen) − (new pose), decaying critically damped (Holden / Gears 4).
- Channels: 19 bone rotations, hips, and the 4 IK keys (position, rotation, weight, elbow hint), and
  `off`. It runs on the clip pose **before** procedural layers and IK.
- `rememberVisible()` stores the IK limbs **as shown** after IK: a clip that drives an arm by FK after
  one that held it by IK then starts from the visible arm, not from the hidden FK under the IK.
- Fast first keys fight the offset (the offset subtracts while the key races ahead): give such clips
  a short `inertia` (0.03) rather than moving keys.
- `f.anim.cut(halfLife)` inertializes into whatever the layers produce next frame (stops, state cuts).

## 9. Springs and cloth

- `SecondOrder(dim, f, ζ, r, x0)`: t3ssel8r second-order follower (r < 0 anticipates, r > 1
  overshoots). Rex's drum index uses `(6, 0.55, -0.35)`.
- `Kick(freq, ζ)`: impulse oscillator with `hit(peak, rise?, hang?)` (§7).
- `SpringBone({ pivot, restDir, length, freq, zeta, gravity, drag, maxAngle, inertia })`: a rigid
  prop swinging from a pivot (hair spikes, headphones, pendants, hood, pockets); damping relative to
  the parent, air drag clamped at 12 m/s, cone limit, 120 Hz substeps, resets on teleports.
- `ClothChain({ ..., relative: true, airDrag, maxAir, linearInertia })`: strings, tails, ribbons;
  `relative` damps against the anchor's motion (a grapple at 30 m/s must not stream the chain
  flat) and sub-steps on a `SubstepClock`. Every chain: stretch capped at 8 % (follow-the-leader
  after the constraint iterations); a jump > 2.5 m in one frame is a teleport and carries the
  strand along (shape and motion kept, turned with the anchor) instead of re-laying it.
- `ClothSheet`: skirts, capes, hair curtains. Details and parameter tables: secondary-motion.md.

## 10. Champion visual (`src/champions/types.ts`, `assembleVisual`)

| Member | Use |
|---|---|
| `tick(dt, time, energy)` | per-frame detail animation of the model (rings, drums, glows, orbs) |
| `cue(id, value?)` | kit → model detail: Rex uses `shot slug note beam charge chargeState ready` |
| `onAnimEvent(id)` | clip events reaching the model (every copy) |
| `muzzle`, `offhandGrip` | markers (`marker(w, x, y, z, name)`) |
| `stockZ` / a `stock` marker | recoil hinge |
| `gripElbow` | support elbow direction in the weapon's frame (§6) |
| `cloth` | springs and chains updated after IK |

Weapon-attached effects that must exist for local, remote and viewer copies (Rex's charge orb and
approach ring) belong in the model, driven by `cue`s, as camera-facing billboards
(`modelViewMatrix * vec4(0,0,0,1)` + `position.xy * size` in view space).

## 11. Kits (`src/combat/kits/*Kit.ts`, `BaseKit`)

- `handleInput(f, intent, dt, m)` (local and bots), `tickAction`, `startAction(f, id, lock)`,
  `onAnimEvent(f, id, m)`, `endAction`, `cancel`.
- Remote copies: `playRemote(f, event, m)` and `tickRemote(f, dt, m)`. **Every visual must also run
  here** (cues, clips, VFX); a remote charge has to simulate its own timer from the start event.
- `m.broadcastAction(f, { a, p, d, t, n })`: the server relays **only** `a p d t n` (`cleanAction`
  in `server/Room.ts`, `n` clamped to ±100). Encode extra state in `n` (Rex: an overcharged beam is
  sent as `n = -(1 + overcharge)`).
- Gameplay numbers (cooldowns, radii, event times, speeds) live in the kit and `shared/champions.ts`:
  animation and VFX fit them; never change them silently. `stream` parts also change dodge rewards
  on the server: do not mark a part `stream` just to silence its hitstop.

## 12. VFX API

`m.vfx` is `Effects` (`src/vfx/Effects.ts`):

| API | What | Notes |
|---|---|---|
| `add.emit(spec)`, `alpha.emit(spec)` | instanced particles (additive / alpha) | `Shape`: `glow puff star streak ring shard square star6 note`; `size` is the half-size (m); `size1` end size; `stretch` for streaks; colours may be HDR `THREE.Color`s |
| `ring(pos, normal, color, r0, r1, life)` | shockwave ring mesh (pool of 24; `r0 > r1` contracts) | one draw call each: don't spam (ripples every ≥ 4 m) |
| `beam(from, to, color, width, life)` | legacy cylinder beam | prefer `seg` with `Seg.beam` |
| `after(delay, fn)` | delayed one-shot (f0/f1/f2 staggers, rings travelling with the energy) | ≤ 128 pending |
| `seg.emit(SegSpec)` | **axial billboards**, 1 draw call: `Seg.tracer` (sharp head, emit one per frame, life 0.0256 s = 35 % afterimage next frame), `Seg.beam` (1.4× width f0-1 → hit width → erase muzzle→target while thinning; `noise` frays the edge), `Seg.ribbon` (trail piece per frame; `ink` = dark under-layer), `Seg.column` (light column), `Seg.bar` (EQ bar stepping at 20 fps, eroding) | premultiplied: `core`/`edge` add light, `ink` darkens the background. Own-view safety in the shader: pieces fade near the lens; tracers/beams/ribbons ≥ 0.3 m wide seen end-on fade to 20 % from behind (running away: the shooter's own beam) and to 50 % from the front (incoming: still a threat) |
| `decals.add(DecalSpec)` → handle | ground decals, 1 draw call: `Decal.telegraph` (border at **exactly** `r`, fill with `progress`, blink), `Decal.ring` (expands r0→r), `Decal.scorch`, `Decal.planted` | `move(h, pos)`, `progress(h, p, blink)`, `kill(h)`; `life: Infinity` until killed |
| `bloomColor(hex, tier)` (`src/vfx/color.ts`) | HDR colour whose luminance is `tier ×` the bloom threshold (1.45) | 0.3-0.9 mids (no bloom), 1.2 halo, 2 strong, 4 flash (≤3 f), 6+ impact frames |
| `alongView(m.camPos, at, dir, sign?)`, `lineView(m.camPos, at, dir)`, `sprayDir(out, dir, bias, own)` (`src/vfx/view.ts`) | `alongView`: 0..1, how much the viewer looks down a shot from behind (`dir` = travel; `sign −1` for a hit normal that points back at the shooter). `lineView`: the same either way along the line of fire (the shooter and the target: use it for impacts). `sprayDir`: a spark direction around `dir` that fans out across the view when `own` | scale cast glows, face-on rings and the target's glow by `1 − 0.6…0.85·own`; decided at emit time. The capture lab points `m.camPos` at its camera, so side views show what other players see |

New segments and decals render their first frame at age 0 (they are "fresh" until the next update),
so a per-frame tracer shows at full strength. Budgets: ≤ 40 VFX draw calls, ≤ 3000 particles,
zero allocations per frame in hot paths (reuse module-level vectors and spec objects).

## 13. Projectiles (`src/combat/Projectiles.ts`)

`m.projectiles.spawn({ ..., fx, mesh, sparks, blast, onBurst })`:
- `fx: ProjectileFx` visual hooks, called for local and remote (visual-only) copies alike, with
  scratch vectors: `tick(pos, prev, vel, age)` every frame after moving, `bounce(pos, normal)`,
  `hit(at, dir, crit)` (return true to replace the stock spark), `wall(at, normal)`, `expire(pos)`.
- `mesh: false` hides the stock mesh when `fx.tick` draws the projectile; `sparks: false` drops the
  stock glow trail.
- `blast: false` + `onBurst(pos)` replaces the stock explosion (then play the sound and shake there).
- The `kind` drives gameplay (bounce, homing, explode): never change it for looks.

## 14. Feel

- `m.shake(amount, at?)`: trauma on the local camera, attenuated by distance (40 m).
- `m.hitStop(seconds)`: slows the **whole local simulation** to 6 % (not presentation-only yet). It
  no longer chains: right after a stop, only a stronger one may start (cool-down = stop + 0.2 s).
- `m.cameraKick(f, …)` (§7). `CameraRig.punchFov(deg)`: + widens (blasts), - narrows (focus).
- Hit flash on the target model: full at most ~3×/s; rapid hits in between flash at 35 % (WCAG).
- Tiers, shake amplitudes, impact frames: game-feel.md.

## 15. Music (`src/core/Beat.ts`)

`Beat.kick`, `Beat.snare` (1 on the hit, fast decay), `Beat.pulse` (max of both), `Beat.beats`
(continuous count), `Beat.bpm` (104). The music scheduler pushes hits with their position in the
bar (`Beat.push(t, snare, beatInBar)`); a kick re-phases `beats` onto that grid position (off-beat
kicks align to their own fraction). Without audio a free-running groove keeps the same tempo.

## 16. Gotchas

- `q.slerpQuaternions(a, q, t)` with `q` as the second argument copies `a` over `q` first: the result
  is `a`. That silently disabled every partial IK weight for months (hands snapped at weight 1). Copy
  the target to a temp first.
- Never edit `src/` while a capture runs: Vite hot-reloads the page mid-film.
- The analyzer's key-pose rows are at the clip's key times assuming it starts at frame 0; a check
  that matters between keys (stock gap during a kick) needs a per-frame probe.
- `anim_report rex run` snaps straight into the run (no blend): its f1 angular peaks are an artefact.
- Rendering order: decals 9, legacy rings 12, segments 18, alpha particles 15, additive particles 20,
  Rex's muzzle billboards 22.
- Arm targets authored in model space interpolate in straight lines between keys: a path from the
  hip to a raised palm passes ~12 cm from the shoulder. Add a via key out in front of the chest.
