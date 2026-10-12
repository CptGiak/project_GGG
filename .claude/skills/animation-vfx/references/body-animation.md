# Body animation: timing, posing, weapons, locomotion, hits, taunts

**Use this file for** authoring or reviewing the bone motion of a GGG champion: attack and ability
clips, key poses, easing and weight, two-handed weapons (recoil, aim, reload, charge-up, throw),
locomotion, hit reactions, taunts on the beat, procedural layers and the final review (§12).
Numbers are 60 fps defaults. Each names its engine knob or is marked **(not in engine)**. Props and
cloth: `secondary-motion.md`; hit-stop and camera: `game-feel.md`; full API: `engine-ggg.md`.

**Conventions.** 1 f = 1/60 s; author keys with `F(n) = n/60` (30 fps source numbers are doubled).
"rec." = a practitioner default, not a quoted fact; `[S#]` = source.
- Rig: +Z forward, +X = the character's LEFT, +Y up, feet at the origin, Euler YXZ in degrees.
- Signs: spine/chest +X = flex forward · neck/head −X = look up · thigh −X = leg forward · shin +X =
  knee bend · +Y = turn toward the character's left · pelvis +Z = left hip up · +Z on a left limb
  (−Z on a right one) = abduct.
- `PoseSpec`: `hips` translation (m) · `pelvis` rotation (deg) · `wR`/`wL` weapon or hand IK
  `{p, d, u, e?}` (grip, barrel direction, weapon up, elbow hint; model space; set `e` when the
  elbow flips or the wrist lines up with the default pole) · `off` support-hand weight · `fL`/`fR`
  planted foot `{p, yaw, pitch}`, flat at ankle y = `footHeight` (0.08 m).

## Contents
- §0 Ten rules · §1 Principles · §2 Attack and ability anatomy (2.7 frame budgets)
- §3 Posing · §4 Spacing, easing, weight (4.3 heavy vs light)
- §5 Weapons: 5.1 recoil · 5.2 aim · 5.3 reload · 5.4 charge-up · 5.5 throw
- §6 Locomotion: run, lean, strafe, idle, landing, foot IK, transitions, swing
- §7 Hits and deaths · §8 Taunts · §9 Procedural layers · §10 Review
- §11 REX worked spec · §12 Checklist · Sources

---

## 0. Ten rules that matter most

1. **Responsiveness beats anticipation.** Spend frames on recovery, not startup [S10][S17]; hide
   anticipation in the ready pose or overlap it with the action.
2. **Snap, then hold.** 2–4 f into an overshot extreme, a 4–10 f moving hold, a longer settle.
   Overwatch holds key poses "a bit longer than usual" [S37]; Rivals: get into the pose fast and
   stay clearly in it [S23].
3. **Name an ease on every key.** The default `inOut` stops dead at every key: `outCubic`/`outExpo`
   into extremes, `linear` through passing keys, `lag` for overlap (§4).
4. **`pelvis` rotates the pelvis, `hips` moves it.** Contrapposto and recoil hip turns need both.
5. **Recoil = slow clip keys + fast springs** (§5.1). A one-frame kick "can make animation look
   jerky" [S57]; Unity's FPS Microgame kicks at sharpness 50/s and recovers at 10/s [S6].
6. **Inertialize, don't crossfade**: `anims.inertial` 0.05–0.1 s, `f.anim.cut()` on stops. Gears of
   War 4 evaluates only the target pose [S70]; Holden's demo uses 0.1 s [S3].
7. **Cadence reads weight.** The default `stride` 2.3 m at 9.6 m/s gives 8.3 steps/s; real runners
   take ~2.8–3 [S69]. Heavies use 3.0–3.4 m.
8. **Hit-stop freezes the impact pose**: the attacker on contact, the victim on the first flinch
   frame [S35]. SF6 scales it 9/11/13 f for light/medium/heavy [S5].
9. **The beat is identity**: 104 BPM = 0.577 s per beat. Author taunts, nods and ult pumps with
   `beats: true`.
10. **Read through the gameplay camera** (behind the right shoulder): shapes off the torso, no
    single-axis motion [S15], the weapon out of the body silhouette [S39], vertical motion
    exaggerated for weight [S45].

---

## 1. Principles as game rules

Cooper: with too little anticipation a move has no weight; with too much it "will feel
unresponsive, removing agency from the player" [S10].

| Principle | GGG rule (rec. unless cited) |
|---|---|
| Squash & stretch | Limb compression, no mesh deformation: landing 2–4 f, recovery 0.2–0.45 s [S44] |
| Anticipation | Player actions 0–6 f, heavy ≤10 f [S17]; a reactable attack needs ≥18 f [S22] |
| Staging | Key poses held ≥4–6 f, arms and weapon off the torso outline [S41] |
| Pose-to-pose | The default; `Ease.step` holds for anime flourishes [S28] |
| Follow-through | Chest/head 1–3 f behind the driver (`lag`); loose parts on 40–120 ms springs |
| Slow in / out | Ease-out into hits, ease-in out of holds [S23] |
| Arcs | Hands, head and muzzle on arcs; check the muzzle path at 0.25× |
| Secondary action | Additive breathing, props, cloth at 0.5–2° |
| Exaggeration | Extremes 20–50% past realistic; smears where motion blur is missing [S37][S38] |
| Solid posing | No twinning: L/R differ ≥8–10° and 1–3 f [S96] |
| Appeal | Personality on top of speed and function [S39] |

**Anticipation without input latency**
1. **Loaded ready pose**: the stance is already coiled, so the anticipation happened before the input.
2. **Contact-frame anticipation**: the event on f0–1, a 1–2 f opposite compression while already moving.
3. **Recovery-heavy timing**, with the recovery cancelable [S17].
4. **Telegraph with VFX and SFX**, not the body.
5. **`outExpo` snaps**: ~90% of a segment in its first third, so a 3 f snap reads as a 1 f pop plus a settle.
6. **Remote copies skip the windup**: start them 2 f before the first event (Rex `single`:
   `offset: 0.067`, event at 0.1 s) so the event and its kick still fire.

---

## 2. Attack and ability anatomy

### 2.1 Phases
- Startup = frames before the hit can connect; active = live hitbox; recovery = until the attacker
  can act. SF6 counts the first active frame in startup: total = startup + active + recovery − 1 [S18].
- The defender needs ~100 ms perception + 70 ms cognition + 70 ms motor [S24]; the minimum
  reactable anticipation is 18 f [S22].
- In GGG: startup = clip time to the event (`events` → kit `onAnimEvent`), lock =
  `startAction(f, name, seconds)`. The visual recovery may outlast the lock.

### 2.2 Real frame data (SF6 Ryu) [S5]

| Move | Startup | Active | Recovery | Total | Hit-stop |
|---|---|---|---|---|---|
| 5LP jab | 4 | 3 | 7 | 13 | 9 |
| 5MP | 6 | 4 | 11 | 20 | 11 |
| 5HP | 10 | 5 | 18 | 32 | 13 |
| 5HK | 12 | 4 | 20 | 35 | 13 |
| Hadoken LP/MP/HP | 16/14/12 | – | 31/33/35 | 47 | 8 |
| Shoryuken HP | 7 | 10 | 34 + 12 landing | 62 | 20 |
| Charge super Lv1/2/3 | 12/18/50 | 6 | 39 | 56/62/94 | 18/20/23 |
| Taunts | — | — | — | 124–210 | — |

- Heavy recovery ≈ 1.8× startup; a projectile throw ≈0.78 s, recovery 2–3× startup; more charge,
  more hit-stop.
- Elsewhere: jabs start in 6–9 f, heavies in 13–20 f [S20].
- Derived (rec.): startup : active : recovery ≈ 1 : 0.75 : 1.75 light, 1 : 0.5 : 1.8 heavy, 1 : – : 2–3
  projectile. Put the mass in recovery, mostly cancelable.

### 2.3 Hero-shooter benchmarks
LoL casts last 0.25–1.0 s; ~0.25 s is "the standard for most abilities" [S45][S50]. Widowmaker
charges in 0.9 s plus a 0.32 s zoom [S51]; Hanzo draws in 0.72 s [S52]; McCree's reload had to fit
45 frames [S42].

### 2.4 Cancel windows (rec.) [S22][S26]
- Startup and active: nothing, or a dodge-cancel with a cost.
- First 30–40% of recovery: same-ability buffer only (the kit's `skillBuf` holds a signature press 0.3 s).
- After 40–60%: move, dash, grapple, jump; exit with `action.stop(0)` + `f.anim.cut()` (half-life
  0.06–0.1 s).
- Buffer 100–150 ms, timed in seconds; expire buffered inputs on context changes [S26].

### 2.5 Holds, smears, hang time
- Overwatch offsets arm timing ("total symmetry looks stiff") [S37] and smears "for a lack of
  motion blur" [S38]. Rivals: powerful moves use fewer transition
  frames [S23]. GG Xrd uses stepped keys [S28].
- A 19-bone smear (rec.): a 1–2 f key over-rotating forearm and hand 20–40° along the arc, only
  where the camera sees it. Bone stretch is **(not in engine)**.
- Hang time: an apex key plus a key 4–8 f later drifting 5–15% toward the next pose.

### 2.6 Authoring in GGG
The shape of Rex's `single` (`src/champions/rex.ts`) is the heavy-shot template:

```ts
const F = (n: number) => n / 60;            // frames @60
// load, fire, peak, hang, recover, under: PoseSpecs on aimSpec; sh() re-solves the stock per key
single: clip('single', base, [
  [0, aimSpec],
  [F(4), sh(load), Ease.outCubic],          // 4 f compress = the anticipation
  [F(6), sh(fire), Ease.linear],            // event frame, passing key
  [F(9), sh(peak), Ease.outExpo],           // snap into the extreme
  [F(16), sh(hang), Ease.linear],           // moving hold, 5–15% toward the next pose
  [F(30), sh(recover), Ease.outCubic],      // ~70% back
  [F(40), sh(under), Ease.inOut],           // undershoot
  [F(50), aimSpec, Ease.inOut],             // hold-to-hold only
], { events: [{ t: F(6), id: 'fire', kick: { pitch: 16, back: 0.05, roll: 3, body: 1,
       freq: 3.6, zeta: 0.62, rise: 0.03, hang: 0.065 } }],              // heavy envelope (§5.1)
     fadeIn: 0.05, fadeOut: 0.2, lag: { neck: 2, head: 3 } }),
```

- Re-solve every shouldered key with `shouldered()`: a lerped `wR` floats the stock off the shoulder
  when the torso changes a lot.
- On twos for flourishes **(not in engine)**: sample at `Math.floor(t * 30) / 30`, never for
  gameplay events.

### 2.7 Frame budgets for GGG ability types (rec., 60 Hz)

| Type | Startup (to event) | Peak / hold | Recovery (visual) | Cancelable from | Victim hit-stop |
|---|---|---|---|---|---|
| Auto-fire shot (7 rps) | 0 f | 1–2 f kick | 6–8 f (inside an 8.6 f shot interval) | always | 0 (hit marker only) |
| Heavy shot | 4–6 f | 2 f rise, 4–6 f hang | 24–36 f | 18–24 f | 4–6 f |
| Thrown grenade | 4–6 f | 3–4 f follow-through | 15–20 f | 14 f | n/a |
| Charged beam release | 0 f after release | 2 f rise, 5 f hang | 25–35 f | 15 f | 3 + 3×charge f (max 7) |
| Ultimate barrage | 6–10 f count-in | per-shot micro-kick | 15–20 f finish | ult lock | 6–8 f |
| Taunt | — | climax hold ≥20 f | — | any input after 12 f | — |

---

## 3. Posing

- **Line of action.** One C or S curve through the body [S107]. A C on 19 bones splits spine 40%,
  chest 35%, neck 15%, head 10%, same sign (a 30° recoil C: −12/−10/−5/−3). An S gives the pelvis and
  chest opposite rolls.
- **Silhouette.** Action and attitude read from the silhouette alone; check at distance first
  [S95].
- **GGG camera** (rec.): judge keys from the real camera behind the right shoulder. Arms ≥5–10 cm off
  the torso, the weapon outside the body outline (toon outlines merge overlapping shapes), actions
  15–30° off the camera axis [S15].
- **Handedness.** A right-handed long gun goes left shoulder to the target: torso bladed 30–45°, head
  counter-turned onto the barrel, stock in the right pocket. Rex: pelvis yaw −14°, spine −13°, chest
  −13°, neck +15°, head +23°, pocket at chest-local (−0.13, 0.10, 0.09), keys solved by
  `shouldered()`. Reach: shoulder → grip ≤ 0.9× arm length (heavy 0.50 m).
- **Contrapposto** [S106], weight on the right leg (mirror for the left): `hips` x −0.02 to
  −0.05, `pelvis` Z −3 to −8° (the free left side drops), `chest` Z +2 to +5°, support knee 5–10°,
  free knee 15–25°.
- **Asymmetry.** No twinning, not even feet turned the same way [S96]: L/R ≥8–10° and 1–3 f apart,
  never both arms on one frame with one ease. Overgrowth randomizes body-bob frequency 0.9–1.1× per
  character [S1].
- **Strong poses.** Silhouette matters most "in the anticipation frames of a powerful attack" [S23].
  Hold gameplay extremes ≥4 f, heavy 6–10 f.

---

## 4. Spacing, easing, timing and weight

### 4.1 Eases (distance covered at ⅓ of the segment)
- `outExpo` 90%: recoil peaks, hits, 1 f reads. `outQuart` 80%: throws, punches.
- `outCubic` 70%: weighty moves into extremes, first recovery stage. `outQuad`/`outSine` 56/50%.
- `outBack` 96%, then +10% overshoot at t ≈ 0.58: pops, taunts, ready-ups.
- `linear` 33%: passing keys inside an arc.
- `smooth`/`inOut`/`inOutCubic` 26/22/15%: hold-to-hold only.
- `inQuad`/`inCubic` 11/4%: gravity falls, accelerating windups and compressions.
- `step` 0%: holds the previous key, then jumps at this key's time.

### 4.2 No stop at every key
1. Ease per key, or `opts.ease` for keys without one. Never leave passing keys on `inOut`.
2. A moving hold 4–10 f after each extreme, drifting 5–15% toward the next pose.
3. `lag` (frames per bone): `{ chest: 1, neck: 2, head: 3 }` on big actions, `{ chest: 1,
   upperArmL: 2, foreArmL: 3 }` for a throw.
   - It delays **rotations only**, not `hips`, IK targets or `off`: no effect on an IK-held arm.
   - It delays arrival too: an event at a key's time fires before the lagged bones arrive (§5.5).
   - Non-looping clips clamp at t = 0; loops wrap. In `beats` clips the unit is 1/60 beat (0.58 real
     frames at 104 BPM).
4. A critically damped chest/head/off-hand settle (half-life 40–80 ms) is **(not in engine)**: key
   an overshoot-and-settle. Props and cloth: `secondary-motion.md`.
5. Splines through keys (Catmull-Rom on grips, SQUAD on rotations) are **(not in engine)**: add
   mid-keys and check the paths with `plot_paths.py`.

### 4.3 Heavy vs. light (rec., grounded in [S99][S100][S101])
Heavy masses start and stop slowly with tight spacing; impact compression shows the effort of
stopping the mass; strain is slow, reactions are bursts; the body never moves as one lump.

| Parameter | Light (Tracer-like) | **Heavy (REX)** | GGG knob |
|---|---|---|---|
| Time into an extreme | 2–3 f | 3–5 f (`outCubic`, not `outExpo`) | keys, ease |
| Recovery multiplier | 1.0 | 1.4–1.8 | keys after the event |
| Accel to full run | 0.12–0.18 s | 0.25–0.35 s (visual lean) | (not in engine) |
| Stop settle | 0.15–0.2 s | 0.3–0.4 s, forward lean and gun swing | (not in engine) |
| Landing compression / recovery | 2 f / 0.18 s | 3–4 f / 0.35–0.45 s, hips −0.12 to −0.2 m | `landDepth`, `landRecover` |
| Run bob, peak to peak | 5–7 cm, soft | 8–10 cm, hard drop at contact | `runBob` |
| Arm and gun lag on turns | 30–50 ms | 60–100 ms | (not in engine) |
| Hit-react displacement | 1.0× | 0.7–0.8×, slower decay | (not per champion) |

**Selling a big gun** (rec.): the gun lags torso turns (half-life 60–90 ms), the muzzle dips 2–4° on
stops, the off-hand supports *under* the barrel, and recovery is slower than the kick.

---

## 5. Shooter weapon animation

### 5.1 Recoil
CoD4 separates view-kick and gun-kick springs [S8][S60].

**Target envelope for the gun as seen** (rec.): rise 1–2 f; hang 2–6 f on heavy shots only, ≤10%
drift; fast return 6–12 f removing 60–75%; settle 10–20 f with a 3–8% undershoot; spread = pitch
up, random yaw/roll, a push along the barrel.

**GGG recoil = clip keys (slow body) + `kick()` springs (gun).** Keys carry the load, the body ride
(shouldered keys follow the torso) and the body's settle. Fire the kick from a clip event `kick`
(fixed: every copy kicks the same) or `f.anim.kick(spec)` in the kit (dynamic: charge-scaled, random).
- `KickSpec`: `pitch`, `roll`, `yaw` (deg), `back` (m), `body` (0 arms only … 1 whole body), plus the
  envelope: `rise` (s; 0 = impulse, else an exponential approach, 98% at `rise`), `hang` (s; moving
  hold drifting back 10%), `freq` (Hz of the pitch return; the other channels scale with it) and
  `zeta` (return damping; roll uses 0.75×).
- Light shot ~{ pitch 3, back 0.035, body 0.35 } (Rex Beat Shot: pitch 3.2–4.4, alternating roll
  ±0.6–1.2, yaw ±0.6). Heavy slug ~{ pitch 16, back 0.05, body 1, freq 3.6, zeta 0.62, rise 0.03,
  hang 0.065 } (Rex `single`). Biggest release: freq 2.8–3, rise 0.035, hang 0.085 (Rex charge).
- The gun hinges at the weapon's `stock` marker (else `stockZ`); 30% of `back` slides along the
  barrel and the body carries the rest. With lean = (0.32·pitch + 70·back)·body and twist = −150·back·body: spine
  −0.4·lean, chest −0.6·lean, both twisting the right shoulder back (0.35/0.65·twist); the head
  counters (+0.55·lean, −0.6·twist) so the eye line holds. Above `body` 0.6 the hips go back
  0.55·back and down and the knees bend; the shouldered weapon rides it all.
- Every kick re-tunes all four springs and sets the shared `body`, so a light kick restores the fast
  return of a heavy one still ringing. Nothing kicks while `wR.w` ≈ 0.

| Pitch kick | f, ζ | Peak | Through rest | Undershoot |
|---|---|---|---|---|
| Default impulse | 6.5 Hz, 0.55 | 1.7 f | 5.5 f | −13% at 7 f |
| Rex `single` | 3.6 Hz, 0.62, rise 2 f, hang 4 f | 2 f | 13 f | −8% at 16 f |
| Rex charge release | 2.9 Hz, 0.62, rise 2 f, hang 5 f | 2 f | 17 f | −8% at 20 f |

Default back/roll/yaw: 8.5/5.5/6 Hz, ζ 0.6/0.4/0.5, undershoot 9.5/25/16%. Keep impulse kicks
≤4–5° so the dip stays under ~1°; give every heavy shot `rise`, `hang`, `freq` and `zeta`.

**Body propagation** (rec., share of gun pitch): shoulderR back 25–35% at 0 f, chest 30–40% at 1 f,
spine 15–20% at 1 f, head 10–20% at 2 f (a sharpshooter keeps the eye line), hips back 2–6 cm on
heavy shots at 2 f. The engine extends the chest ≈19% and the spine ≈13% of pitch (plus a `back`
term), all parts on the same frame: per-part delays are **(not in engine)**.

Third person is read at 10–40 m: 1.5–3× the first-person angular recoil plus body propagation (rec.).

### 5.2 Aim
- Enter the shouldered pose in 0.07–0.15 s `outCubic`; the FOV zoom is separate (Widowmaker 0.32 s [S51]).
- Engine chain: neck (pitch 0.3, yaw 0.35) and head (0.4, 0.45) always; spine (0.18, 0.2) and chest
  (0.3, 0.25) × `st.aim` (damped 12/s); clamps ±55° / ±75°; the aimed `wR` turns about the shoulder.
- Rec.: cheek weld = head roll 4–8° toward the stock, pitch down 4–6°; chest yaw 10–15° toward the
  gun side; support elbow under the barrel.
- A held clip replaces the idle, breathing included, so the aim is dead still between shots: add a
  slow 2-key loop, or a kit `tremble` of 0.1–0.3° at `trembleHz` 0.3–0.5.

### 5.3 Reload and vent (rec.)
Budget 0.8–1.5 s (McCree: 45 frames [S42]). Roll the weapon 20–35° and dip it; slap or vent with the
off-hand (`off` 1→0→1, 4 f each way); snap back with `outBack`; cancelable into sprint after 60%.
The personality lives in the off-hand gesture [S41].

### 5.4 Charge-up that sells building power
Benchmarks: §2.3. SF6's charge super escalates startup 12→18→50 f and hit-stop 18→23 f [S5].
1. **Compression**: hips −4 to −9 cm, knees 8–15° on `inQuad`, in a clip played with `hold: true`.
2. **Tremble ramp**: 0.2→1.2° at 14–18 Hz, chest 40%; the kit sets `f.anim.tremble` and
   `trembleHz` (16) every frame.
3. **Breath hold**: automatic, a full-body held clip has no breathing.
4. **Full charge**: tremble → 0 within 2 f, then a 3–4 f `outBack` ready pop timed by the kit.
5. **Overcharge strain**: tremble 2–2.5° at a *lower* 9–11 Hz, knees buckle, spine flexes.
6. **Release**: the kit's biggest kick, a step back (a lifted foot target, §6.6), a 4–6 f hang, a
   0.4–0.5 s settle.

`tremble` stays on until zeroed: reset it on release, cancel, stun and death, and drive remote
copies from the broadcast charge state.

### 5.5 Grenade / overhand throw
A kinetic chain runs legs → pelvis → trunk → arm [S64]: start side-on, weight back, arm back; rotate
toward the target as the weight moves forward; follow through across the body [S65]. Keep the
projectile on the hand until release, key the hand up to it [S63], and spawn it at the hand.

| Frame | Event (rec., release at f6) |
|---|---|
| f0 | Coil: weight back, chest yaw 20–25° away, throwing upper arm behind and above |
| f2 / f3 / f4 | Pelvis, then chest, then upper arm start to rotate |
| f5 | Forearm whips |
| f6 | **Release** at maximum extension, hand ahead of the head |
| f6–f15 | Follow-through: arm across the body, spine flex 15–20°, back heel lifts |
| f15–f25 | Recover; off-hand back on the rifle over 4–6 f |

With `lag` `{ chest: 1, upperArmL: 2, foreArmL: 3 }` the forearm reaches each key 3 f late: key the
release pose at f3 with the event at f6, or move the event 3 f later. Keep the throwing arm in FK
(`wL` unset, `off` 0).

---

## 6. Locomotion

### 6.1 Run
Key poses Contact → Down → Passing → Up → flight [S66]; a two-step cycle is 16–20 frames at 30 fps
[S67]; the centre of mass moves 6–9.5 cm per step [S68][S69], exaggerated in LoL [S45].
- `stride`: metres per cycle. Default 2.3 = 8.3 steps/s at 9.6 m/s. Rec.: heavy 3.2–3.6 (2.7–3.0
  cycles/s), light 2.8–3.0; Rex 3.2.
- `legSwing`: thigh amplitude ×; heavy 1.1–1.15 with longer flight (Rex 1.12).
- `runBob`: peak-to-peak hip drop (m) at run speed, falling fast over the first 30% of each step and
  rising slowly, with a 6° head counter-pitch. p2p = `runBob`, not 2×; unset gives a 7 cm cosine.
  Rec. heavy 0.08–0.10 (Rex 0.045 = 4.5 cm).
- `runLean` (deg), `runArms` (arm pose masked onto the run), `armSwing` [L, R] (0 for two-handed
  weapons, with `offhandLoco: 1`).
- Rec. **(not in engine)**: stride warping `strideLen(v) = lerp(1.7, 3.4, clamp(v / 9.6, 0, 1))`
  rather than a faster play rate; pelvis roll ±3–6° (free side drops; the engine has yaw ±9° only);
  chest counter-yaw ±9–15°, ±5–7° with both hands on a gun; head counter-pitch 30–50% of the bob.
  Check on a side filmstrip that the low point falls 2–3 f after contact.

### 6.2 Lean, starts, stops, pivots
- Engine (`Fighter.ts`): the body pivot pitches with speed (hspeed/40 rad, max ≈7°) and banks with
  turn rate (max ±0.3 rad), damped 8/s and 7/s, grounded and not aiming only.
- Rec. **(not in engine)**: lean = 0.5° per m/s + 0.4° per m/s², clamped −12 to +22°, half-life
  0.08 s ground / 0.15 s air; bank = 0.7·atan(v·ω/g) within ±20°; split 45% spine, 35% chest, 20%
  pivot. A per-tick factor f at R Hz has half-life `ln 0.5 / (R·ln f)` (Overgrowth's 0.9 at 120 Hz
  ≈ 55 ms [S1]).
- **Starts** 0.15–0.25 s with an 8–12° lean pulse, the cycle starting with the other foot raised [S15].
- **Stops** 0.25–0.4 s: lean back 6–10°, knees +10°, gun forward 4–6° and back, moving-hold settle.
- **Pivots** over 120°: plant 4–6 f, hips first, chest 2 f later, gun 4 f later.

### 6.3 Strafe and backpedal
The engine twists hips −35°, spine +20°, chest +15° per unit of `st.strafe` (max ±0.6) and reverses
the phase for backpedal at full stride. Rec.: backpedal at 70% stride; crossovers or a side-shuffle
beyond 60° lateral.

### 6.4 Idle
Sourced: breathing loops 2–4 s, weight-shift loops 8–12 s; a loop is noticed after ~90 s (use 2–4
variations); 15–20 breaths/min relaxed, 20–25 alert, 1–2 cm chest travel, no symmetry [S83];
fidgets every 30–60 s [S84]. Engine layers:
- **Base breathing**, always: 3.0 s cycle, chest 1.6°, upper arms 1.2°, hips ±6 mm, spine yaw sway 1.5°.
- **`idleLife`** (0–1): weight shift every 7.5 s (hips x ±1.5 cm, pelvis roll ±1.5°, chest counter
  ±1°), shoulders breathing apart on 3.4 s (L 1.2°, R 0.8°), head drift 1.2° at 0.37 Hz, 2° at 0.23 Hz.
- **`relaxed` + `relaxVia`**: after 2.5 s free (grounded, still, no action, not aiming, not hit) the
  idle blends over 0.6 s through the via pose, which swings a long weapon around the head; any
  activity snaps it back in 0.14 s.
- **`groove`** (0–1), while free: 9° head nod on the beat, neck 4°, chest 2.5° and a half-time sway,
  shoulders ±3° on the snare, hips −1.8 cm; with `relaxed` it follows the relax blend.
- **Fidgets** (rec., **not in engine**): additive, every 15–60 s, cancelable. An action clip would
  reset the calm timer, drop `relaxed` and stop the groove.

### 6.5 Landing
- Engine: an impact over 9 m/s sets `wLand = clamp((impact − 6)/16, 0.25, 1)` at once and decays it
  linearly over `landRecover` s (default 0.29). Crouch: hips −0.16 m × `wLand` × `landDepth`, thighs
  −55/−50°, shins +95/+90°, spine +18°. A hard landing at speed becomes a roll.
- Rec.: compress over 2–4 f, hold 1–2 f, recover on a critically damped spring (half-life 0.08 s
  light, 0.12–0.15 s heavy), depth by impact; a 1–2 f gun dip and a ≤4° head nod 2 f later. The ramp
  and spring are **(not in engine)**.

### 6.6 Foot IK
- Engine: `fL`/`fR` plant the ankle at a model-space target, knee along the toes, blended with FK.
  Give every standing pose one foot placement (Rex `feet`) so pose changes never slide. Move a foot
  by keying a lifted target, never by sliding a planted one: Rex `release` hops the rear foot 12 cm
  back (lifted F2–F4, planted F6). Targets ride with the body; world pinning is **(not in engine)**.
- Rec.: blend the lock in and out around the plant [S78]; don't lock a foot far from its animated
  position [S76]; place the next step ahead of the body [S90]; clamp offsets ±0.15 m, lift ≤0.1 m [S1].
- Accept: sole within 1 cm of the floor (ankle y = `footHeight` ± 5 mm), slide < 1 cm per stance, no
  hyper-extension, no pelvis pop [S77].

### 6.7 Transitions
- Engine (`Inertialize.ts`): offsets on the clip pose (every bone, `hips`, the four IK keys, `off`)
  before look-at, recoil, groove and tremble, which stay continuous on top; arms and legs start from
  their on-screen IK rotation. With `anims.inertial`, `play()` fades in ≤0.02 s (≤0.03 s with `hold`)
  and ignores the clip's `fadeIn`. Per clip, `inertia` overrides the half-life: 0.025–0.035 for
  actions whose key pose must show within a few frames (Rex `throw`, `release`), 0.1 for emotes.
- `f.anim.cut(hl)` covers stops and state cuts and needs `inertial`: exit with `action.stop(0)` +
  `cut()`. A plain `stop(fadeOut)` or a clip's end fade stays a linear crossfade.
- One half-life per transition; per-bone half-lives (arms 0.05, spine 0.08, legs 0.1 s) are **(not
  in engine)**.

**Blend times** (rec.; inertialization half-lives ≈40% of these): into an attack 0–0.05 s · into a
hit-react 0–0.02 s · into death 0.03–0.05 s · out of an attack 0.1–0.2 s · out of a hit-react
0.15–0.3 s · idle ↔ run 0.15–0.25 s · air → land ≤0.05 s, then the landing spring · taunt in/out
0.1/0.25 s · grapple flight in/out 0.12/0.18 s.

### 6.8 Grapple swing
The engine's `fly` blends dive and swing by `st.swing` and banks the pivot from lateral
acceleration and rope pull. Sell speed with camera, FOV and body together. Rec.: a 4–8 f weightless
hang at the apex [S44]; bank 15–35°; hips lead toward the hook, legs trail 2–4 f; the free hand
points at the hook.

---

## 7. Hit reactions and deaths

- A layered reaction keeps locomotion alive but looks disconnected if the pelvis never moves; a
  full-body one cropped at the spine loses weight. Pick the direction in character space and mask
  the upper body [S81].
- Freeze the attacker on contact and the victim on its first flinch frame (§0 rule 8); ideally only
  the two participants pause [S33].
- Engine: hit-stop slows the whole simulation to 6% for 0.045–0.15 s (`Match.ts`; `game-feel.md`).
  `hitReact(pushX, pushZ, strength 0.35–1.3)` ramps over 50 ms, then follows exp(−7.5t)·cos(9t) to
  0.7 s: spine 13°, chest 9°, neck 8°, head 15° plus roll and yaw, arms flare, hips 4.5–5 cm. Above
  0.7 the knees buckle; a blow within 0.15 s keeps 50% of the last. The ramp runs at 6% speed during
  the freeze, so the victim barely reacts.
- Rec.: start the envelope at its peak (`reactT = 0.05`); shake `hips` x and `head` ±1–2 cm at
  25–30 Hz during hit-stop; in ranged PvP keep the shooter-side freeze at 0–2 f.

| Tier (rec.) | Trigger | Duration | Pose |
|---|---|---|---|
| Flinch (additive) | Chip, auto-fire | 0.25–0.4 s | Spine 6–13°, head 8–15°, arms flare 10–15° |
| Stagger (full-body) | Heavy shot, crit | 0.45–0.7 s | Step back 15–30 cm, knees buckle |
| Launch | kb.y > 6 | Air time + 0.5–0.9 s get-up | Limbs trail, tuck, "thud"; invulnerable get-up |
| Death | HP 0 | 0.9–1.4 s | Impact pose 3–6 f, `inQuad` buckle, 2–3 cm bounce |

**Death timing.** A 1 m fall takes √(2/9.81) ≈ 0.45 s: drop the hips on `inQuad` over 0.3–0.45 s,
then a 3–5 f bounce and a 0.2 s settle. The shared `death` clip: 0.12 s `outCubic` impact, `inQuad`
collapse to hips −0.5 m by 0.55 s, settled by 1.0 s.

---

## 8. Taunts, emotes and victory poses

- **Structure** (rec.): anticipation 4–8 f before the first downbeat; accents on the beat, with
  transitions leaving 2–4 f before it; one climax held ≥20 f, then a button pose; big shapes above
  the shoulders, readable from behind; cancelable after 12 f (the engine's `stopTaunt` cancels on the
  first move, attack or jump input).
- **Engine** (`beats: true`): keys are in beats. `play()` runs the clip at `Beat.bpm/60` from
  `Beat.beats % 1`, so t = 1 lands on the next beat and 0..1 is the lead-in. `Beat.beats` re-phases
  onto audio kicks within 0.3 beat; a running clip does not re-sync.
- **Gotchas**:
  - The lead-in shrinks with the phase (at phase 0.8 a key at 0.75 is skipped). A given `offset`
    disables auto-phasing, so pass the tempo too:
    `f.anim.play('taunt', { offset: ph > 0.5 ? ph - 1 : ph, speed: Beat.bpm / 60 })` with
    `ph = Beat.beats % 1` (t < 0 holds key 0).
  - `fadeIn`/`fadeOut` stay in seconds; `lag` is in 1/60 beat.
  - `Fighter.startTaunt` sets `tauntT = clip.duration`, beats for a beat clip: convert with
    `× 60 / Beat.bpm`.

---

## 9. Procedural layers and springs

**Engine order** (`FighterAnimator.update`): locomotion → action clip (events, event kicks) → flinch
clip → `hitReact` and tumble → `animScale` → inertialization → look-at and aimed weapon → kick
springs → groove → tremble → FK → foot IK → hand IK → cloth and spring bones. Look-at, kicks, groove
and tremble add on top of clips, held ones included.

- `SecondOrder(dim, f, ζ, r)` (`Springs.ts`): f in Hz (1–2 lazy, 4–6 lively, 8+ snappy); ζ 0.3–0.6
  overshoots, 1 is critical; r is the initial response (< 0 anticipates). Stable at any dt.
- Half-life ↔ frequency, critically damped: **f ≈ 0.22 / half-life** (0.05 s → 4.4 Hz, 0.08 → 2.8,
  0.12 → 1.8). Holden: damping = 4·ln2 / half-life [S2].
- `Kick(freq, ζ)`: `hit(peak)` sets the first peak. Peak time = atan(√(1−ζ²)/ζ) / (2πf·√(1−ζ²)).
  First undershoot = exp(−πζ/√(1−ζ²)): ζ 0.35 → 31%, 0.42 → 23%, 0.5 → 16%, 0.6 → 9.5%, 0.7 → 4.6%.
- Smooth with half-lives or exp(−k·dt), never per-frame factors.
- Noise: 2–3 incommensurate sines (idle drift 0.23/0.37/0.61 Hz at 0.5–2°; tremble 14–18 Hz
  excited, 9–11 Hz strained).
- Look-at follows the aim each frame. Rec. **(not in engine)**: critically damped head (0.04–0.06 s)
  and chest (0.08–0.12 s), the head leading the torso by 2–4 f [S89].

---

## 10. How to review

- Cooper's polish pass [S15]: foot sliding, popping at cycle seams, contact points, momentum per
  body part across loops, interpenetration. Watch the feet alone at 0.25× [S78].
- `tools/anim_report.ts` thresholds:
  - angular speed ≤900°/s except on impact frames (more reads as a pop)
  - weapon target miss ≤1 cm (more = an unreachable pose)
  - off-hand slip 0 (flagged > 1.5 cm), stock gap < 5 cm, head–gun clearance > 14 cm
  - elbows and knees never at 180° except a throw's release (> 172° counts as locked)
  - planted ankle y = `footHeight` ± 5 mm, slide < 1 cm (flagged > 3 cm)

---

## 11. Applying this to REX

**Read.** A heavy producer-sharpshooter (`bodySpec('heavy')`, arm 0.56 m) with a right-handed
bass-cannon rifle. **The body absorbs, the eye stays**: hips and knees eat the recoil, the head
returns exactly to the aim line. **Bass weight**: slower startups, punchier peaks, longer settles.
**On the beat**: nods, pumps and the ult at 104 BPM.

**Kit timings** (`rexKit.ts`): Beat Shot 7 rps · Lead Single lock 0.42 s, fire at 0.1 s · Bass
Charge full at 0.95 s, PERFECT 0.95–1.13 s, overcharge 1.55–2.55 s · Sub Bomb lock 0.42 s, release
at 0.1 s · ult 1.5 s, 12 notes every 0.09 s from 0.15 s. Clips in rex.ts: `aim`, `charge`, `single`,
`release`, `throw`, `ult`, `taunt`.

### 11.1 Idle
- rex.ts `stance`/`readyGun`: bladed ~40°, head counter-turned, left foot forward, gun shouldered
  14° down, `off` 1.
- Rec.: weight on the right leg (`pelvis` Z −4°, knees R 6° / L 18°, hips x −3 cm); breathing 3.4 s,
  chest 2.2°, shoulders a beat apart; weight shift 7.5 s (`idleLife`); nod ≤1.5° on `Beat.kick`.
- Relaxed: rifle on the right shoulder, left hand on the hip, swung past the head (`relaxVia`); the
  full groove plays here. Fidgets every 15–25 s (not in engine): neck roll ±20° in 0.8 s, EQ tap
  (`off` 1→0→1, 0.9 s), a look at the rifle (1.2 s).

### 11.2 Run
Stride 3.2–3.4 m, thighs +12%, longer flight; bob 9 cm p2p dropping within 3 f of contact, head
countering 40%; chest counter-yaw ±6°; port arms, muzzle 30–40° up-left, the gun counter-bobbing
±1.5 cm 2 f behind the hips (not in engine). Lean: `runLean` 2°, acceleration lean
half-life 0.12 s, 10° start pulse; stops lean back 8° with a 5° gun swing and a 0.35 s settle.

### 11.3 Aim
`aimSpec` plus a 5° head roll toward the stock, chest yaw 10° toward the gun side, left elbow under
the barrel. Enter 4–6 f `outCubic`; exit 0.18 s or `stop(0)` + `cut(0.08)`. Breathing 40%, no nod,
a slow sway (§5.2).

### 11.4 Beat Shot (a shot every 8.6 f)
Per shot +3.5° pitch, 2.5 cm back, roll ±1° alternating, rise 1 f, ≤10% of peak left at the next
shot, head ≤0.4°. From `bloom` (0–1): a 1.5°·bloom climb, ±0.6° drift on alternating shots, a brace
of hips −2 cm and chest +2.5°, so the animation shows the spread [S60]. Shots within 30 ms of
`Beat.kick` kick 1.25×.

### 11.5 Lead Single (lock 25 f, fire event f6)

| f | Key | Values relative to aim | Ease |
|---|---|---|---|
| 4 | Load | hips −5 to −6 cm, spine/chest +3–4°, muzzle −2° | `outCubic` |
| 6 | Fire + heavy kick (§5.1: pitch 16°, body 1, freq 3.6, rise 0.03, hang 0.065) | 1 cm lower | `linear` |
| 8–9 | Peak | spine −6°, chest −5 to −10°, pelvis −4°, hips z −7 cm, shoulderR back 8°, head on line | `outExpo` |
| 14–16 | Hang | 10% back; rear foot hops 6 cm back (kit push 3.5 m/s) | `linear` |
| 28–30 | Recover | 70% back | `outCubic` |
| 40 | Undershoot | gun −1.5°, hips −1 cm | `inOut` |
| 50 | Aim | — | `inOut` |

Lag head 3, neck 2, chest 1 f (the IK off-hand ignores `lag`). Cancel into movement from f20, into
fire from f25 (lock end). rex.ts `single` follows this key timing (F0/4/6/9/16/30/40/50).

### 11.6 Bass Charge (hold)

| Phase | Time | Animation |
|---|---|---|
| Plant | 0–0.15 s | thighs Z ±4°, hips −4 cm, `outCubic`; grip 2 cm toward the shoulder |
| Build | 0.15–0.95 s | hips to −9 cm, knees +15°, `inQuad`; tremble 0.2→1.2° at 16 Hz |
| **Perfect** | 0.95–1.13 s | stillness: tremble → 0 in 2 f, 4 f `outBack` pop (chest −2°, muzzle on line), audio tick, EQ flash |
| Holding | 1.13–1.55 s | tremble 0.4° |
| Overcharge | 1.55–2.55 s | tremble 1.2→2.5° at 10 Hz, knees +6°, spine +4°, head ±2° roll (the kit's 2.2° wobble) |
| Release | +0 | kit kick { pitch 9 + 8k, back 0.07 + 0.05k, body 1, freq 2.9, zeta 0.62, rise 0.035, hang 0.085 }; gun +(20 + 12k)°, (10 + 6k) cm back in total; perfect 1.4×, chest −12°; rear foot 10–25 cm back |
| Settle | 5 f hang, 0.45 s | a release clip, never a 0.02 s fade to `aim` |

rex.ts has `charge` (plant 0.15 s, `inQuad` build to 0.95 s) and `release` (rear-foot hop F2–F6,
hang to F10, recovery step F18, aim at F38, `inertia: 0.035`).

### 11.7 Sub Bomb (release event f6)
f0 wind-up (weight back, chest away, left arm cocked, rifle low, `off` 0) → f0–6 chain pelvis → chest
→ upperArmL → foreArmL, release at full extension with the hand ahead of and above the head → f6–15
arm across the body (yaw −30°), spine flex 18° and yaw 25°, right heel up → f15–25 ready, `off` 0→1
in 5 f `outCubic`; muzzle −10° at release. In rex.ts `throw` the lag puts the forearm's release pose
at F9, 3 f after the event (§5.5).

### 11.8 Drop The Beat (ult, 1.5 s)
0–0.15 s count-in: hips −10 cm, rifle skyward on `outBack`, head −20°. 0.15–1.14 s, per note: gun
+5°, 3 cm, chest −1°, hips −1 cm, rise 1 f, return 4 f, muzzle yaw ±3° alternating, barrel toward
the target (±25°, half-life 60 ms). Each `Beat.kick`: knees +6°, head +3°. 1.14–1.5 s: rifle onto
the shoulder in 6 f `outBack`, +8° head bang on the next beat, hold, 0.2 s fade. The per-note kicks
come from the kit, local and remote.

### 11.9 Raise the Roof (taunt, `beats: true`)

| Beat | Action |
|---|---|
| 0–0.75 | Rifle to the shoulder (`shoulderRest`); hips dip −4 cm at 0.75 |
| 1–4 | Four pumps: `roofUp` on the beat (`outExpo`), `roofLow` on the "and"; hips −3 cm and a 6° head nod on the beat, 3 f late |
| 5 | Point at the target (`pointAt`, `outBack`), hold 1 beat |
| 6–6.6 | Recover to the button pose |

≈3.2–3.8 s by entry phase (SF6: 2.1–3.5 s [S5]), rifle on the shoulder (`off` 0), cancelable after
12 f. rex.ts `taunt` follows these beats with `lag: { head: 2, neck: 1 }` (1.2 and 0.6 real frames;
a 3 f nod needs `head: 5`).

### 11.10 Hit (not in engine: `hitReact` has no per-champion parameters)
Amplitude ×0.75, decay 6.0 not 7.5, oscillation 8 rad/s not 9; start at the peak with a 25–30 Hz
±1.5 cm shake during hit-stop; head snap ≤12°; above 0.7 the rear foot steps back (hips z −5 cm).

### 11.11 Death and launch
Death 1.3 s: f0–5 impact pose, arms flare, `off` → 0 in 2 f · f6–27 knees buckle (`inQuad`, hips
−0.5 m) · f27–48 torso falls by hit direction (`inQuad`) · f48–54 3 cm bounce · f54–78 settle. `wR`
→ 0 so the rifle stays in the FK hand, with a 10° wrist drop. Launch: flail 0.7×, legs together,
rifle trailing; a 0.5 s get-up (hips −0.15 m, hand-on-knee push, stand).

---

## 12. Review checklist (at gameplay speed, through the gameplay camera)

**Readability**
1. Every key pose reads as a silhouette from the over-shoulder camera at 10, 25 and 40 m.
2. Weapon and arms sit outside the torso outline in gameplay-critical poses (toon outline test).
3. The action is not purely along the camera axis: 15–30° off-axis [S15].
4. A clear line of action runs through every extreme (C or S, spine → head).
5. No twinning: L/R angles differ ≥8°, timing 1–3 f [S96].
6. The pose identifies the champion at a glance (stance, gun carry) [S108].

**Feel and timing**

7. Input to first visible change ≤2 f; gameplay events fire on the authored frame.
8. Startup within budget (§2.7); recovery ≥1.5× startup, cancelable after 40–60%.
9. Extremes reached with an ease-out and held ≥4 f (heavy 6–10 f) as moving holds [S37][S23].
10. No segment inside a continuous arc uses `inOut`: nothing stops at a passing key.
11. Recoil rises over 1–2 f (never 0), recovers ≥3× slower, and reaches chest and head with lag [S57][S6].
12. Hit-stop freezes the impact pose; total stop ≤120 ms except kills and ults [S32].
13. Taunts, nods and ult pumps land on the beat (≤30 ms) and correct drift > 0.2 s [S103].

**Fluidity**

14. No pops on action start, stop or cancel at 0.25× with inertialization on [S79].
15. Loops match pose *and* tangents at the seam, momentum preserved per body part [S15].
16. Transitions never pass through the rest or bind pose [S79].
17. Every action ends in an overshoot-and-settle (3–8% undershoot), not a dead stop.
18. Springs and smoothing are frame-rate independent (30, 60, 144 fps).

**Contacts and body mechanics**

19. Feet don't slide: < 1 cm per stance at 0.25× [S78][S77].
20. Stride length matches speed at walk, run and strafe [S15][S78].
21. Knees and elbows never hyper-extend or flip; check IK poles at the aim pitch and yaw extremes.
22. No broken wrists: hand vs forearm within ±70° flex and ±30° deviation.
23. The off-hand stays on the grip in locomotion, and releases and returns in 4–6 f when needed.
24. The centre of mass stays over the support base unless falling or launching on purpose [S106].
25. Heavies take longer to start, stop and settle than lights (§4.3).

**Arcs and overlap**

26. Muzzle, hands and head travel on arcs; trace them at 0.25× (`plot_paths.py`).
27. Head, chest and off-hand lag the driver by 1–3 f on big actions.
28. Props, cloth and chains settle after the body, without jitter at rest.

**Intersection and edge cases**

29. No weapon interpenetration with torso or head at aim pitch ±55° and yaw ±75° [S15].
30. No floor clipping in landing, death or get-up; feet above the ground on slopes.
31. Remote copies play the same clip minus the anticipation (offset 2 f before the first event);
    the event and its kick still fire.
32. The animation reads with VFX off; VFX enhance it but do not carry the pose.

**GGG engine**

33. Kit-driven layers reset: `tremble` back to 0 after release, cancel, stun and death; held clips stopped.
34. Lagged bones reach the event pose by the event frame (§4.2); beat clips convert `lag` and the
    taunt timer from beats.

---

## Sources

Read directly (code or full text):
- [S1] Wolfire, *Overgrowth* `aschar.as`. https://raw.githubusercontent.com/WolfireGames/overgrowth/main/Data/Scripts/aschar.as
- [S2] Holden, *Spring-It-On* `common.h`. https://raw.githubusercontent.com/orangeduck/Spring-It-On/main/common.h
- [S3] Holden, *Spring-It-On* `inertialization.c`. https://raw.githubusercontent.com/orangeduck/Spring-It-On/main/inertialization.c
- [S5] SF6 Ryu frame data. https://raw.githubusercontent.com/NPJigaK/SF6-skills/main/wiki/outputs/data/frame-data/supercombo/ryu/frames.json
- [S6] Unity FPS Microgame weapons manager. https://raw.githubusercontent.com/Ankit512/FPS-Minigame/master/Scripts/PlayerWeaponsManager.cs
- [S8] cod4-decomp #173, view vs gun kick. https://github.com/jeiang/cod4-decomp/issues/173

Read via search-engine extracts:
- [S10] Cooper, 12 principles in games. https://www.gamedeveloper.com/production/the-12-principles-of-animation-in-video-games
- [S15] Cooper, *Game Anim*, 2nd ed. https://www.routledge.com/Game-Anim-Video-Game-Animation-Explained/Cooper/p/book/9780367707651
- [S17] GamineAI, animation principles. https://gamineai.com/blog/game-animation-principles-from-sprites-to-3d-character-movement
- [S18] SuperCombo, SF6 game data. https://wiki.supercombo.gg/w/Street_Fighter_6/Game_Data
- [S20] Avatar Legends frame data. https://roguewiki.com/avatar-legends-the-fighting-game/guides/avatar-legends-the-fighting-game-frame-data
- [S22] GDKeys, anatomy of an attack. https://gdkeys.com/keys-to-combat-design-1-anatomy-of-an-attack/
- [S23] Rivals Workshop, anticipation/recovery. https://www.rivalslib.com/workshop_guide/art/anticipation_action_recovery.html
- [S24] Dark Souls 3 attack anatomy. https://www.gamedeveloper.com/game-platforms/anatomy-of-an-enemy-attack-in-dark-souls-3
- [S26] Input buffering. https://gg.imporinfo.com/2026/05/input-buffering-explained-for-non.html
- [S28] Motomura, GG Xrd GDC 2015. https://www.ggxrd.com/Motomura_Junya_GuiltyGearXrd.pdf
- [S32] SwordArcade, hit-stop. https://swordarcade.xyz/guides/game-feel-hitstop-and-screen-shake/
- [S33] Sicienski, Capcom hitstop. https://shane-sicienski.com/blog/blog-post-title-one-55pmn
- [S35] SmashWiki, hitlag. https://www.ssbwiki.com/Hitlag
- [S37] Sokolova, Overwatch GDC animation talk. https://evasokolova.wordpress.com/2016/04/03/gdc-overwatch-animation-talk-summary/
- [S38] Kotaku, Overwatch smears. https://kotaku.com/this-is-not-an-overwatch-glitch-1777612546
- [S39] Blizzard, Animation Station. https://overwatch.blizzard.com/en-us/news/24239492/weekly-recall-animation-station/
- [S41] Inven, Overwatch first-person animation. https://www.invenglobal.com/articles/1187/how-overwatchs-first-person-animation-breathed-life-into-heroes
- [S42] Game Anim, Overwatch first person. https://www.gameanim.com/2017/04/29/first-person-animation-overwatch/
- [S44] Tracer, Gibson quotes. https://neoencyclopedia.fandom.com/wiki/Tracer_(Overwatch)
- [S45] Alderton (Riot), League animation. https://www.animationcareerreview.com/articles/riot-games-senior-animator-rory-alderton-discusses-league-legends-animation-process
- [S50] League Wiki, cast time. https://wiki.leagueoflegends.com/en-us/Template:Data_Senna/Piercing_Darkness
- [S51] Overwatch Wiki, Widowmaker. https://overwatch.fandom.com/wiki/Widowmaker
- [S52] Overwatch Wiki, Hanzo. https://overwatch.fandom.com/wiki/Hanzo
- [S57] CRYENGINE, procedural weapon animations. https://docs.cryengine.com/display/SDKDOC2/Procedural+Weapon+Animations
- [S60] Denkirson, CoD4 recoil. https://denkirson.proboards.com/thread/5906/kicks-speeds-recoil-depth
- [S63] Animation Mentor, throwing. https://www.animationmentor.com/blog/tutorial-how-to-animate-tossing-or-throwing/
- [S64] Wikipedia, overhand throw. https://en.wikipedia.org/wiki/Overhand_throw
- [S65] OPHEA, overhand throw. https://ophea.net/learn-move-fundamental-movement-skills-and-strategies/movement-skills-posters/overhand-throw
- [S66] AnimSchool, run key poses. https://blog.animschool.edu/2024/04/10/the-key-poses-of-a-run-cycle/
- [S67] MocapOnline, run cycles. https://mocaponline.com/blogs/mocap-news/run-cycle-animation
- [S68] ISBS, vertical oscillation. https://ojs.ub.uni-konstanz.de/cpa/article/view/1308/1229
- [S69] RunnersConnect, vertical oscillation. https://runnersconnect.net/improve-your-vertical-oscillation-for-better-running-performance/
- [S70] Bollo, Gears of War transitions. https://www.gamedeveloper.com/art/video-high-performance-animation-transitions-in-i-gears-of-war-i-
- [S76] Delannoy, 2016 tech talks. https://medium.com/@jcdelannoy/the-best-game-animation-tech-talks-of-2016-d6a86e3d5a26
- [S77] ae3d #577, foot IK criteria. https://github.com/aether-lang-dev/ae3d/issues/577
- [S78] MocapOnline, game-ready animations. https://mocaponline.com/blogs/mocap-news/game-ready-animations-guide
- [S79] Standard-of-Iron #1401, transitions. https://github.com/djeada/Standard-of-Iron/issues/1401
- [S81] nikoff, hit reactions. https://nikoff.cc/resources/hit-reaction-animation-guide
- [S83] MocapOnline, idle animation. https://mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide
- [S84] karem505, animation fluidity. https://github.com/karem505/character-animation-skill/blob/main/references/animation-fluidity.md
- [S89] Little Polygon, locomotion 1. https://blog.littlepolygon.com/posts/loco1/
- [S90] Little Polygon, locomotion 2. https://blog.littlepolygon.com/posts/loco2/
- [S95] Animworks, silhouette. https://anim.works/silhouette-in-animation/
- [S96] Flylib, twinning. https://flylib.com/books/en/2.750.1/creating_appealing_poses.html
- [S99] Cave Academy, lifting weight. https://caveacademy.com/wiki/post-production-shots/animation/animation-training/introduction-to-animation-course/animate-a-character-lift-weight/
- [S100] AnimSchool, weight. https://blog.animschool.edu/2025/05/02/animating-weight/
- [S101] Animation Mentor, weight. https://www.animationmentor.com/blog/how-to-create-believable-weight-in-animation/
- [S103] FireGB2012 PR #1, beat re-snap. https://github.com/FireGB2012/multiplayer/pull/1
- [S106] AVG Guild, 12 principles. https://www.avgguild.org/post/12-principles-of-animation
- [S107] Animation Mentor, solid drawing. https://www.animationmentor.com/blog/solid-drawing-the-12-basic-principles-of-animation/
- [S108] Wikipedia, Tracer. https://en.wikipedia.org/wiki/Tracer_(Overwatch)
