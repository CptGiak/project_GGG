# Verification: measure, then look

Use this file to prove an animation, an effect or a feel change is right before you show it to
anyone. You cannot watch the game run; the lab gives you two instruments that together are better
than watching: **numbers** (`tools/anim_report.ts`: every frame of a clip through the real animator
and IK) and **frame-exact images** (`scripts/capture.mjs`: a virtual clock, so the same scenario
renders the same frames every run and before/after comparisons are honest).

Contents
1. The verification loop
2. `anim_report`: what each line means, thresholds, how to fix
3. Reading images: filmstrips, onion skins, motion paths, GIFs
4. The capture lab (`capture.mjs`): still, viewer, scenario API
5. In-match VFX and feel scenarios
6. Probes: when the report is not enough
7. Regression checks across champions
8. Before/after deliverables

---

## 1. The loop

1. **Baseline** before touching anything: `anim_report` for every clip you will touch, a viewer
   filmstrip per clip, one in-match scenario per ability. Write the problems down as numbers.
2. Change one layer at a time (stance → keys → timing → procedural → secondary → VFX → feel).
3. Re-run `anim_report` until the numbers are clean (§2). Only then capture images.
4. Capture and **read every sheet**; compare with the baseline side by side.
5. If you changed shared engine code (IK, inertialization, springs, `Effects`), run the regression
   table over every champion (§7) and explain every delta.
6. Never edit `src/` while a capture runs: Vite hot-reloads the page and you film loading screens.

## 2. `npx tsx tools/anim_report.ts <champ> <clip|idle|run|air|fly|dash> [--json out.json] [--dur s] [--hold] [--nofade]`

It settles 20 frames of idle, plays the clip through `FighterAnimator` at 60 Hz (same IK, same
inertialization, same recoil springs as the game, cloth off) and prints:

| Section | Reads | Clean when | Usual fix |
|---|---|---|---|
| key times, events | the clip's keys and event times | events where the kit expects them | move the key / the event, never the kit timing |
| **angular speed peaks** (local °/s per bone) | pops | < 900 °/s except on an impact frame or a deliberate snap (a throw's coil); single-frame spikes of 3000-10000 °/s are flips | find the frame with a probe (§6); usually an IK flip or a 180° slerp |
| **key poses**: ankle y | planted feet | = `footHeight` (Rex 0.080) ± 5 mm | foot IK keys (`fL/fR`), shared `feet` object |
| foot pitch | flat feet | ≈ 0° when planted | `FootSpec.pitch` |
| off-hand | support hand on the grip | 0.000 m | `off: 1`, a reachable grip |
| stock gap | shouldered stock in the pocket | < 0.02 m at keys, ≤ 0.02 m through a kick (per-frame probe) | `shouldered()` per key; recoil hinge at the `stock` marker |
| head-gun | weapon clear of the head | > 0.14 m | move the key, or route it (`relaxVia`) |
| **weapon target miss** | the arm can't reach | 0.000 m (< 0.01) | pull the key in; > 0.01 means the pose asks for more than the arm length |
| off-hand slip | support hand leaves the grip | 0.000 m | |
| elbow / knee ranges, locked frames | stiffness, hyperextension | no frame > 172° except a throw's release | soften the key, add `e` |
| **elbow bend plane, max turn per frame** | elbow flips | ≤ 45°/frame (fast snaps 30-45) | elbow hints `e` on the keys around it (engine-ggg.md §6) |
| **wrist-shoulder min** (fraction of reach) | hand paths through the shoulder, folded arms | ≥ 0.35 | a via key in front of the chest, move the key out |
| foot slide while planted | skating | < 0.01 m (low and not lifting: \|vy\| < 0.25 m/s) | plant both keys on the same spot; step with a lift |
| muzzle speed sparkline | spacing | one sharp peak on a shot, an ease after | ease per key |
| head travel | how much the head moves | small for sharpshooters | head counter-rotation, `lag` |

`--json out.json` writes every frame's tracked points; `python3 .claude/skills/animation-vfx/scripts/plot_paths.py out.json --out paths.png`
draws side and front motion paths with a dot every 1/60 s (dense dots = slow, sparse = fast), key
rings and event rings, and stick figures at the key times. Look for: arcs (good) vs straight lines
or kinks (mechanical), even spacing through a "hold" (it isn't moving: make it a moving hold),
the impact frame as the widest gap.

Known artefacts: `run` snaps into the cycle (its f1 peaks mean nothing); clips that end and fade
back to idle report the recovery after the clip (look at the frame numbers).

## 3. Reading images

**Filmstrips** (`--sheet`, labelled `#frame t`):
- Silhouette first: squint. Does each key read as a different shape? Is the weapon line clear of
  the body at the key frames?
- Contacts: feet flat on the floor in every planted frame, hands on the weapon.
- Timing: count frames between the anticipation and the hit; compare with the frame budget.
- VFX: the climax should be 1-3 frames of the brightest, biggest shape; the outro dimmer and longer.

**Onion skins** (`--onion`, cyan → magenta over time): spacing and arcs of the whole body in one image.
Overlapping ghosts = a hold; wide gaps = fast; a ghost out of the arc = a pop.

**Motion paths** (`plot_paths.py`): arcs vs kinks, spacing.

**GIFs** (`--gif`): the only way to judge rhythm and feel; open them, don't just generate them.

What a problem looks like:

| Symptom in the images | Cause |
|---|---|
| a limb in a completely different place for one frame | IK flip (bend plane), a 180° slerp |
| a foot under the floor / floating | foot target not clamped / IK reach |
| the gun inside the head or the shoulder | head-gun / stock gap |
| an effect that never reaches full brightness | life too short for the pool's fade-in; no fresh frame |
| everything white in the middle of an effect | bloom mush: mids above tier 0.9, too many additive layers |
| a beam whose edges sparkle into dots | width < 2 px at that distance: raise the minimum width |
| the impact hidden behind the target | the effect at the hit point on the far side: offset toward the camera |

## 4. `node .claude/skills/animation-vfx/scripts/capture.mjs` (needs `npm run dev`)

```
still    "<query>" out.png [--size 1280x720]
viewer   "<viewer query>" --frames A-B/S --out DIR [--name N] [--sheet] [--onion] [--gif] [--mp4] [--crop x,y,w,h] [--cols N]
scenario path/to/scenario.mjs --out DIR [--size 960x540] [--seed N] [--url URL] [--keep-ui]
```

Viewer queries (`src/viewer.ts`): `viewer&champ=rex&anims=idle,aim@0.2,relax@1&freeze=1&cam=34`
- `anims=` list: `idle run air fly dash relax` or any clip name; `@t` = offset; with `freeze=1`
  every model holds that frame (side-by-side stills).
- `cam=front|34|side` (`cam=front&yaw=90` is a profile), `zoom=`, `y=`.
- Frames count from page start at 60 fps; a clip starts at frame 0.

## 5. Scenario API (real match, real kits, real VFX)

```js
export default async function (lab) {
  await lab.open('champ=rex&arena=stage&bots=1&botchamps=kaiser&quality=medium'); // countdown skipped
  await lab.place({ x: 40, z: 6, look: [0, 6] });   // put yourself on open floor (raycast to the ground)
  await lab.dummy({ distance: 11, side: 0, height: 0, freeze: true }); // bot 0: frozen, immortal, on the floor
  await lab.ready();                                 // cooldowns 0, ultimate full
  await lab.camera({ mode: 'side', dist: 5.5, height: 1.35 }); // side | side-wide | front34 | behind | target | top | game | { pos, look }
  await lab.hold('attack'); await lab.release('attack'); await lab.press('skill'); // attack skill secondary ability ultimate jump dash taunt
  await lab.advance(30);                             // 30 frames of 1/60 s
  await lab.film('name', { frames: 36, every: 2, cols: 9, gif: true, onion: false, crop: undefined });
  await lab.shot('name');
  await lab.eval(({ app, match, local, dummy, THREE }) => { /* in the page */ });
}
```
- `film` advances **before** each capture: frame 1 is the first frame after the call.
- Aim is locked on the dummy's chest. Use `lab.ready()` before every ability (cooldowns).
- Cameras: `side` frames the shooter in profile (the dummy is off frame to the right at 11 m),
  `side-wide` frames both, `game` is the player's camera (feel: kicks, FOV punch, shake show here),
  `target` looks back from the dummy (what the victim sees). While a lab camera is on, `m.camPos`
  follows it, so camera-facing rings and own-view dimming (`alongView`) render for that viewer:
  film every ability in `game` (own view: the target readable ≤ 3 f after the impact) and in
  `side-wide` / `target` (full effect).
- Template: `assets/scenario-template.mjs`.

## 6. Probes

When a number in the report needs explaining, write a 30-line probe in `tools/_probe_*.ts` (delete
it before committing) that builds the visual, plays the clip and prints per-frame values:
the weights (`a.pose.off`, `a.pose.wL.w`), the IK targets, joint positions, the bend plane, a
marker vs a chest-local point. Two runs that differ in one thing (kick on / off, inertial on / off)
isolate a cause in minutes. Every engine fix of the REX pass started from such a probe
(case-study-rex.md §4).

## 7. Regression checks across champions

After touching shared code, run every champion's clips through the report on the old commit (a git
worktree with `node_modules` symlinked) and on the new code, then compare: angular peaks, bend
plane, weapon miss, elbow ranges. Explain every delta. A "regression" can be the old code hiding a
teleport (the old IK ignored partial weights, so the wrist jumped 65 cm in one frame and the new
smooth swing reads as a bigger per-frame turn).

## 8. Deliverables

- Before/after filmstrips side by side, the GIFs of the abilities, the numbers table (baseline vs
  final), the list of engine changes with the reason for each.
- Keep captures out of the repo (scratchpad), unless the user asks for them.
