# Case study: the REX pass

Use this file as a worked example of the whole loop on one champion: what the baseline measured,
what was decided and why, the final parameters, and the engine bugs the process surfaced. REX is a
heavy sharpshooter with a two-handed bass-cannon rifle (`src/champions/rex.ts`,
`src/combat/kits/rexKit.ts`, VFX in `src/combat/kits/rexFx.ts`).

Contents
1. Baseline (numbers and images)
2. Body: stance, contacts, clips
3. Recoil, charge and feel
4. Engine bugs found by measuring (and how each was found)
5. Secondary motion
6. Weapon detail and VFX
7. Final numbers
8. What is still open

---

## 1. Baseline

| Check | Baseline | Why it mattered |
|---|---|---|
| support hand on the rifle | 0.39 m off the grip (unreachable), torso yawed the wrong way | the rifle floated in one hand |
| stance | square, no foot IK | no handedness, feet slid between poses |
| recoil | linear lean in the clip, no spring | "the shot is weak" |
| stock | 7 cm off the shoulder under torso lean | gun detached from the body |
| idle | static ready pose | no personality, no music |
| Lead Single VFX | muzzle + 2 rings + an instant tracer drawn **before** the slug | the line lied about the projectile |
| Bass Charge | no charge visuals on the model; release beam 0.86 m wide for a 0.4 m hit | gameplay dishonest |
| Sub Bomb | stock grenade + generic explosion; no telegraph | the 4.6 m radius was invisible |
| ult | 12 stock notes; hitstop 120 ms per note → the world crawled | |
| model cues | `rex.ts` had ring pumps, drum, heat, EQ behind `cue()`… nobody called it | |

## 2. Body: stance, contacts, clips

- **Bladed rifle stance** (body-animation.md §5): pelvis −14°, spine/chest −13° each (left
  shoulder toward the target), head counter-turned +23°; left foot forward, weight on the rear
  leg. One `feet` object (`fL (0.15, 0.19, yaw −18)`, `fR (−0.19, −0.23, yaw −60)`) shared by
  every standing pose, so switching poses never slides a planted foot.
- **Shouldered keys solved, not posed**: `shouldered(spec, d, u)` poses a scratch rig with the
  key's torso and returns the grip that puts the butt plate (`stock` marker) on the chest-local
  pocket `(−0.13, 0.1, 0.09)`.
- **Support hand** on the drum's left speaker (`offhand` marker), elbow under the rifle
  (`gripElbow [0.35, −0.85, −0.25]` in the weapon's frame: it stays under the rifle when the ult
  points it at the sky).
- **Relaxed idle** after 2.5 s calm: rifle on the right shoulder, left hand on the hip, routed
  through `relaxVia` so the barrel swings past the head; groove nod on the beat; idle life.
- **Clips** (frames @60): `single` (load f4, fire f6, outExpo lean f9, moving hold to f16, settle
  f30-f50, `lag` neck 2 / head 3); `release` (the beam's kick: body back f2, rear foot hop-step
  lifted f2-f4, planted 12 cm back f6, recovery step f18, `inertia 0.035`); `throw` (coil f0,
  release f6 = the kit's event, follow-through f15, back on the rifle f30, `inertia 0.03`, `lag`
  ≤ 1 f on the throwing arm so the hand is at the release pose on the event frame); `ult`
  (count-in dip, skyward with outBack, the drop routed out to the right of the head at 1.21 s);
  `taunt` (authored in beats; a via key out in front of the chest; elbow hints on every hand key;
  the rifle on the shoulder rides the body's dip).

## 3. Recoil, charge and feel

| Event | Weapon kick (`KickSpec`) | Camera (local) | Other |
|---|---|---|---|
| Beat Shot (7/s) | pitch 3.2-4.4, back 0.035, roll ±0.6-1.2 alternating, yaw ±0.6, body 0.35; default spring 6.5 Hz ζ 0.6 | 0.35° pitch, ±0.25° roll, no shake | muzzle star, tracer, ring cue |
| Lead Single | clip event: pitch 16, back 0.05, roll 3, body 1, **freq 3.6, ζ 0.62, rise 0.03, hang 0.065** | 1.6° + FOV −3, trauma 0.12 | refund tell |
| Bass Charge hold | — | — | tremble 0.2→1.2° @16 Hz (inQuad with charge), 0 in the perfect window, 2.2° @10 Hz overcharged; perfect: a small pop kick |
| Beam release | pitch 9+8k, back 0.07+0.05k, roll 2, body 1, **freq 2.9, ζ 0.62, rise 0.035, hang 0.085** + the `release` clip | 2.2-4.4° + FOV −4 (perfect −6), trauma 0.16k / 0.22 | |
| Ult note (×12) | pitch 2.2, back 0.02, roll ±1.2, body 0.4 | 0.3° | hitstop no longer chains |

Kick envelopes measured: light peak f2, 70 % gone f5, settled f9; heavy peak f2, hold to f6, 70 %
gone f11, settled f20, undershoot 7 %. The stock stays within 1.6 cm of the pocket through the
heaviest kick (only 30 % of the shove slides along the barrel; the torso carries the rest exactly).

## 4. Engine bugs found by measuring

| Symptom (how it showed) | Cause | Fix |
|---|---|---|
| stock gap 4.6 cm at the slug's peak (anim_report key row) | recoil hinge at (0,0,stockZ) while the marker is at y 0.03; inertialization applied after the kick rotated the hinge | hinge = `stock` marker; inertialization moved before the procedural layers |
| left hand 6000-10000 °/s spikes when releasing the rifle (angular peaks) | **`slerpQuaternions(fk, bone.quaternion, w)` aliasing: every partial IK weight was "no IK"**, so hands snapped at weight 1 | copy to a temp; then blend IK in limb space (reach direction / distance / swivel) |
| elbow flips through the shoulder (new bend-plane metric) | two IK solves in a row on the left arm (grip, then gesture); wrist paths through the shoulder; a fixed pole lining up with the arm | one merged left chain swung around the shoulder; reach floor 25 %; elbow hints `e`; weapon-relative grip pole |
| the throw's arm dropped before coiling (probe) | inertialization remembered the hidden FK under the IK | `rememberVisible()` after IK |
| hop-step foot through the floor (ankle 0.055) | inertialization offset subtracting while a fast first key rose | per-clip `inertia`; ground-clamped foot targets |
| Lead Single never fired after the pass (in-match capture) | the new "ready" cue called `skillReady()`, which **consumes** the buffered press | read the cooldown instead |
| giant flat quads around the rifle in the ult (in-match capture) | the ult weapon hologram merges every mesh under the weapon, including the new billboards | `userData.noGhost` |
| beats jumped 0.23 beat once per bar (reference audit) | `rephase` snapped off-beat kicks to the nearest whole beat | push hits with their bar position |
| drawstrings thrashing / frozen far from the origin (`sm_report`) | a chain's anchor aliased a module temp | own vector; `SubstepClock`; collider time alignment; root-containing sphere shrink |
| props pinned on their cones while running (`sm_report`) | spring sub-steps used the end-of-frame pivot; absolute velocity bled at the cone | per-sub-step pivot; relative bleed; radial velocity dropped; `linearInertia` 0.4 |
| drawstrings 45 % too long for frames after an instant stop; a 54° flick after every blink; 650-1200 % stretch on other champions' chains after a 5 m blink (`sm_report` stop10 / tele5) | four constraint iterations can't recover a strand thrown at 4 m/s; teleports re-laid the strand straight along its rest direction (relative chains) or didn't count a 5 m blink as one (6 m threshold) | follow-the-leader cap at 8 % after the iterations; teleports (> 2.5 m in a frame, every chain) carry the strand: shape and motion kept, turned with the anchor |
| a white ball hid the target for ~200 ms after a Lead Single or a beam, **only through the game camera** (side captures looked great) | seen from behind, the slug's head and ribbons and the beam collapse onto the crosshair; the bass ripples (a ring every 4.5 m, facing the flight) stack into a disc; the crit impact rings face the shooter and are born small and thick (a white disc at tier 3 × 2); the cone rings, cast glow and impact sit on the same line; on a beam the rifle's own speaker rings pumped to 1.7× and white-hot 2.5 m from the lens; the 60 ms hitstop freezes all of it (found by A/B captures switching off the hit flash, particles, segments, rings and model cues in turn) | `Segments` end-on fade (to 20 % running away from the viewer, 50 % toward; width-weighted so thin tracers stay); `alongView()` dims cast glows and rings facing along the shot 60-85 % for the shooter; `lineView()` shrinks and dims the impact (star, glow, rings) for the shooter and the target; `sprayDir()` fans the sparks across the view; beam pump 1.6× and white-hot only above 85 % heat; the lab points `m.camPos` at its camera |

## 5. Secondary motion

SpringBones (Hz, ζ, other): hair front 6.5/0.5 (max 10°), top 6/0.5, back 5/0.5 (max 12°),
headphones 7/0.4 (gravity 0.2, max 8°), pendant 2.2/0.2 (gravity 1, drag 0.3, max 35°), hood
3.5/0.4 (gravity 0.5, max 10°), pockets 8/0.35 (gravity 0.3, max 6°). Drawstrings: two relative
`ClothChain`s, 4 segments, 0.17 m, stiffness 0.035, damping 0.94, air drag 0.5, heavier aglets.
Hip charm: relative chain, 0.22 m. Measured after the fixes: spikes trail ~1° at a run, the pendant
10-12° and swings to its cone on stops, drawstrings 9° at idle and 9-20° at a run, identical from
30 to 240 fps.

## 6. Weapon detail and VFX

Model (`cue`s from the kit on local and remote copies): speaker rings pump back-to-front 25 ms
apart per shot; the drum indexes 1/8 turn with a mechanical anticipate-and-snap (`SecondOrder`
r −0.35) and spins up with the charge; barrel heat violet → gold → white; EQ kicks; the muzzle orb
(ready pulse on the beat; charge 0.08 → 0.30 m, violet → gold; perfect glint; overcharge red
flicker and jitter at 20 fps) and the approach ring that closes from 0.9 m onto the orb exactly
at full charge.

Kit VFX (`rexFx.ts`), all through `bloomColor` tiers:
- Beat Shot: 4-point muzzle star (quantized roll), side streaks widening with spread, beat accent
  ring; a stretched tracer per frame with a 35 % afterimage; light-tier impacts (shrinking with the
  damage falloff); a "sound dent" on walls.
- Lead Single: three gold cone rings on f0/f1/f2, 6-point flare; the slug as a stretched head +
  gold ribbon over a dark ink under-layer + staff lines + a bass ripple every 4.5 m; heavy-tier
  impact; refund ring contracting on the rifle; scorch on floors.
- Bass Charge: inward energy streaks (12 → 60/s), contracting rings at 0 / 0.32 / 0.64 s, a planted
  ground ring; the beam as one premultiplied segment eased to exactly the hit width, thin hot
  core, body under the bloom threshold, rings riding the energy at 400 m/s, sparks along it, caps;
  overcharged: red, frayed, narrower.
- Sub Bomb: hand flash, violet ribbon, a sub ring on every eighth note, bounce rings and dust, the
  fuse telegraph at exactly 4.6 m (enemy view in threat red) filling and blinking for the last
  150 ms; the burst: flash, ground shockwave to the exact radius, three air rings, 24 EQ bars,
  notes, dust, a fading scorch.
- Drop The Beat: a gold light column (everyone's warning), the 32-bar EQ ring at his feet for the
  whole ult, note trails / sparkles / staff lines, escalating light hits, a big last note.

## 7. Final numbers (anim_report)

| Clip | Weapon miss | Off-hand | Stock gap (max) | Bend plane max | Wrist-shoulder min | Foot slide |
|---|---|---|---|---|---|---|
| idle / aim / charge | 0 | 0 | ≤ 0.007 | ≤ 2°/f | 0.81 | 0 |
| single | 0 | 0 | 0.016 (kick) | 30°/f (kick) | 0.81 | 0 |
| release | 0 | 0 | 0.011 | 4°/f | 0.82 | 0.003 (hop contacts) |
| throw | 0 | — | — | 16°/f | 0.81 | 0 |
| ult | 0 | 0 | — | 39°/f (the drop) | 0.42 | 0 |
| taunt | 0 | — | — | 16°/f | 0.31 (rifle on the shoulder) | 0 |

## 8. Still open

- Hitstop is still a global sim slow-down (presentation-only holds, victim-only for ranged hits).
- Screen-flash limiter and accessibility sliders (shake / flash / FOV effects).
- Taunt VFX (spotlight, EQ pops on the pumps, the point glint) are specified (vfx-design.md §10.7)
  but not built.
- Sheets (Elisabbat's skirt and hair, GLB bone chains) still damp in world space.
- Kaiser's ult clips ask the arms for 15-30 cm more than their length (anim_report weapon miss).
- The ult's announce column (everyone's warning) also fills REX's own view for ~0.3 s; an
  owner-only variant needs the match to say whose camera is rendering (`m.local` is not enough
  under the lab cameras).
- The model's weapon detail (ring pumps, heat) cannot see the camera: its own-view brightness is
  tuned globally.
