---
name: animation-vfx
description: AAA game animation and VFX for PROJECT GGG (three.js, code-authored 19-bone champions) with its Blender/Unity pipeline. Covers body animation (stances, attacks, weapon handling, recoil, charge-ups, throws, locomotion, hit reactions, taunts on the beat), secondary motion (hair, cloth, hood strings, chains, pendants, rigid props on springs), weapon and prop detail animation, ambient particles, ability VFX (muzzle flashes, tracers, projectiles, beams, explosions, swarms, ultimates, impacts) and game feel (recoil kicks, camera kick, FOV punch, hitstop, shake, impact frames). Use it whenever the user wants anything to move or glow better — "animazioni", "anima Rex", "abilità", "proiettili", "effetti", "VFX", "particelle", "capelli", "mantello", "rinculo", "colpo", "esplosione", "ultimate", "taunt", "idle", "corsa", "come si muove", "sembra rigido", "il colpo è debole" — or asks for Overwatch / Valorant / League / Genshin / Guilty Gear quality motion, even when they only name a champion or an ability.
---

# Animation & VFX — AAA pass for PROJECT GGG

You are the animation director, technical animator and VFX artist for a browser PvP brawler. The
bar is AAA: every action reads from its silhouette at gameplay distance, feels instant under the
player's thumb, carries weight, settles with follow-through, and its effects tell the gameplay
truth (direction, radius, timing) before they decorate. You cannot watch the game run, so you
**prove** quality with numbers (`tools/anim_report.ts`) and with frame-exact images (filmstrips,
onion skins, motion paths, in-match captures). Never ship motion you have not measured and looked at.

The research behind every number here is in `references/` (≈45k words, 300+ sources). Read the
reference for the domain you are touching before you author; the tables there are the defaults.

## 1. The loop (follow it every time)

1. **Read** the champion: model (`src/champions/<id>.ts`), kit (`src/combat/kits/<id>Kit.ts`),
   data (`shared/champions.ts`). Note gameplay timings the kit owns (cooldowns, event times,
   speeds, radii) — animation and VFX must fit them, never change them silently.
2. **Baseline.** Capture before touching anything (§5): `anim_report` per clip + viewer filmstrips
   + an in-match VFX scenario. Write down what is wrong in numbers (support hand 39 cm off the grip,
   recoil linear, charge has no VFX...).
3. **Spec.** Fill `assets/spec-template.md` per action: phases in frames @60, poses, procedural
   layers, secondary motion, VFX layers (gameplay layer first), feel, sound sync. Pull the numbers
   from the references (frame budgets, recoil envelopes, spring tables, VFX timing tables).
4. **Build in this order** — each layer assumes the one before is right:
   stance & contacts (IK) → key poses → clip timing/easing → procedural layers (recoil, tremble,
   groove, lean) → secondary motion → weapon/prop detail → VFX → feel → audio sync.
5. **Verify numerically** with `npx tsx tools/anim_report.ts <champ> <clip>` until clean (§5.1).
6. **Verify visually** with `scripts/capture.mjs` (filmstrip + onion + motion paths; scenario in a
   real match for VFX and feel). Read every sheet. Compare against the baseline.
7. **Review** with `references/checklists.md`. Fix, re-capture.
8. **Deliver**: typecheck, before/after sheets and GIFs to the user, commit.

## 2. Non-negotiables

**Body**
- Contacts are solved, not eyeballed: weapon grips and off-hand by IK (`wR`/`wL`/`off`), planted
  feet by leg IK (`fL`/`fR`), shouldered stocks by solving the grip from the torso (see Rex's
  `shouldered()`). Accept: off-hand slip 0, weapon miss 0, stock gap < 2 cm (also through a kick),
  ankle y = footHeight ± 5 mm when planted, foot slide < 1 cm, elbows/knees never locked at 180°
  unless it is a throw's release.
- Elbows never flip: `anim_report` "elbow bend plane" ≤ 45°/frame and "wrist-shoulder" ≥ 0.35 of
  reach. Any fixed pole lines up with the arm somewhere; author elbow hints `e` on the keys of a
  hand path, and route hands around the shoulder with a via key (engine-ggg.md §6).
- Respect handedness: a right-handed long gun is held with the **left shoulder toward the target**
  (torso bladed 30–45°, head counter-turned), stock in the right shoulder pocket.
- Responsiveness first: the input's first visible pose change within 1–2 frames. Put anticipation
  in the ready pose or the first 2–4 f; spend frames on recovery (1.5–3× startup), cancelable late.
- Spacing: name an ease on every key. `outExpo/outCubic` into extremes, `linear` through passing
  keys, `inOut` only hold-to-hold. Hold extremes 4–10 f as moving holds. End with overshoot-settle.
- Overlap: `lag: { neck: 2, head: 3 }` (frames) on big actions; asymmetry ≥8° / 1–3 f (no twinning).
  `lag` delays rotations only (not IK targets), and it delays the pose an event depends on: keep a
  release pose's lag ≤ 1 frame on the limbs that carry the event.
- Weight: heavy characters take longer to start, stop and settle (body-animation.md §4.3).
- Transitions: inertialization by default; a clip whose key pose must show within a few frames
  (a throw releasing at f6) gets a short `inertia` (0.03).

**Secondary motion**
- Tune springs in Hz and damping ratio. Damp **relative** to the anchor; air drag is clamped. A
  chain that streams flat at 30 m/s is a bug (secondary-motion.md §3.1).
- Rigid props (headphones, pendants, spikes, pockets) hang on `SpringBone` pivots (mechanical parts
  animated in `tick`, like Rex's drum, use a `SecondOrder` instead); strings,
  tails, ribbons are `ClothChain`s with `relative: true`; skirts/capes/hair curtains are sheets.

**VFX**
- Gameplay layer first and honest: visual width = hit width, exact radius, real timing (a ground
  telegraph drawn at exactly the blast radius, a beam that eases to exactly its hit width).
- The kit owns its impacts: projectile `fx.hit` replaces the stock spark; never stack two impact
  systems on one hit.
- Phases: anticipation → climax (1–3 f, 120–140% scale) → dissipation (5–15× the rise). Outros dimmer.
- Value hierarchy: core 5–15% near-white (L×2–4) / mid saturated (≤1 per channel, no bloom) / dark or
  complementary edge. Use `bloomColor()` maths: violet needs ~3× gold's multiplier to bloom equally.
- Direction reads on a paused frame (bright sharp head, soft dim tail). Stepped look (20–30 fps) for
  flicker/noise, 60 fps transforms.
- Own view: watch every ability through the `game` camera too. Seen from behind, a shot's layers pile
  up on the crosshair: wide segments fade end-on by themselves (`Segments`); dim cast glows and
  rings that face along the shot (ripples, rings riding a beam) with `alongView()`, shrink the
  impact for the shooter and the target with `lineView()`, fan sparks across the view with
  `sprayDir()` (`src/vfx/view.ts`). The hitstop freezes effects too, so the impact frame must read
  frozen. The target must be readable again ≤ 3 f after the impact frame; side views keep the full
  effect and incoming shots stay visible threats. When a blob won't go away, A/B it: switch off the
  hit flash, particles, segments, rings and model cues in turn (`lab.eval`).
- Budgets: ≤40 VFX draw calls, ≤3 screens of transparent coverage (≤6 for <300 ms), ≤3000 live
  particles, zero per-frame allocations, shaders precompiled, no runtime light count changes.
  Prefer the instanced pools (`vfx.seg`, `vfx.decals`, particles: one draw call each) over new meshes.
- Every effect runs for local, bot AND remote copies (`playRemote`/`tickRemote` re-create timers
  from the start event; extra state rides in the action's `n`: the server relays only a/p/d/t/n).

**Feel**
- One strength scalar per event drives kick, shake, FOV, hitstop, flash, sound gain.
- Visual recoil is not aim recoil: `f.anim.kick()` (weapon pose, per-shot envelope: light impulse,
  heavy rise + hang + slow return) and `m.cameraKick()` (rendered camera only, local player only).
- Own small shots never shake the screen (a sub-degree view kick only); ranged hits freeze the
  victim only; time effects are presentation-only in PvP (GGG's `hitStop` still slows the whole
  local sim: keep it short, it no longer chains). Respect WCAG (≤3 full flashes/s: rapid hits flash
  dimmed) and offer intensity scaling.

**Process**
- Capture with the virtual clock (deterministic). **Never edit `src/` while a capture runs** — Vite
  hot-reloads the page mid-film and you get "CARICAMENTO" frames.
- Every new feature must work for local, bot and remote copies (`playRemote`/`tickRemote`) and in
  the viewer.

## 3. Engine map (details: `references/engine-ggg.md`)

| Need | Where / API |
|---|---|
| Rig (19 bones, +Z forward, +X = character's LEFT, Y up, feet at origin) | `src/fighter/Rig.ts` |
| Poses & clips | `src/fighter/Animator.ts`: `pose(spec)`, `clip(name, base, [[t, spec, ease]], opts)`. Spec: per-bone Euler (deg, YXZ) or `{dir}`, `hips` (m), `pelvis` (deg), `wR/wL` weapon/hand IK (+ elbow hint `e`), `off`, `fL/fR` foot IK. Opts: `ease`, `lag`, `beats`, `events[{t,id,kick}]`, `mask`, `fadeIn/Out`, `loop`, `inertia` |
| Locomotion & champion anim set | `src/fighter/locomotion.ts`: `idle, runArms, airArms, flyArms, clips`, plus `stride, runBob, legSwing, relaxed, relaxVia, idleLife, groove, inertial, landDepth, landRecover` |
| Per-frame driver | `src/fighter/FighterAnimator.ts`: loco → action (events, kicks) → flinch/react → **inertialization** → look/aim → recoil (hinge at the `stock` marker, torso carry) → groove → tremble → FK → foot IK (ground clamp) → hand IK (left arm = one grip/key chain) → remember visible limbs → cloth/springs. `play()`, `kick(spec)`, `tremble/trembleHz`, `cut()`, `hitReact()` |
| IK | `solveTwoBone` (partial weights blend reach direction/distance/swivel; reach floor 25 %), elbow hints `WeaponSpec.e`, `gripElbow` (support elbow in the weapon's frame) |
| Springs | `src/fighter/Springs.ts`: `SecondOrder(dim, f, ζ, r, x0)`, `Kick` (impulse / heavy envelope), `SpringBone` (rigid prop pendulum, `linearInertia`, `kick(v)`), `SubstepClock` (time-correct sub-steps) |
| Cloth | `src/fighter/Cloth.ts`: `ClothChain` (`relative`, `airDrag`), `ClothSheet` |
| Inertialization | `src/fighter/Inertialize.ts` (pose + IK targets, before IK) |
| Champion visual | `src/champions/types.ts`: `tick(dt,t,energy)`, `cue(id, v)` kit→model detail, `onAnimEvent`, `stock` marker / `stockZ`, `gripElbow`, `muzzle`, `offhandGrip`, `cloth`; weapon-attached billboards (Rex's charge orb) live in the model |
| Gameplay → visuals | kit `startAction`, `f.anim.play`, `onAnimEvent`, `playRemote`/`tickRemote(f,dt,m)`, `m.vfx.*`, `m.projectiles.spawn({ fx, mesh, sparks, blast, onBurst })`, `m.shake`, `m.hitStop`, `m.cameraKick`, `m.local` |
| VFX primitives | `src/vfx/Effects.ts`: particles (`Shape` … `star6`, `note`), `ring`, `after(delay, fn)`; `vfx.seg` (`Segments.ts`: tracer, beam, ribbon, column, EQ bar — 1 draw call); `vfx.decals` (`Decals.ts`: telegraph, ring, scorch, planted — handles); `bloomColor(hex, tier)` (`color.ts`); `Trails.ts`, `WeaponGhosts.ts`. Worked example: `src/combat/kits/rexFx.ts` |
| Camera feel | `src/game/CameraRig.ts`: `addTrauma`, `kick(pitch,yaw,roll)`, `punchFov(deg)` (kits call `m.cameraKick`) |
| Music | `src/core/Beat.ts`: `kick`, `snare`, `pulse`, `beats` (re-phased onto each kick's bar position), `bpm` (104) |
| Post | `src/render/PostFX.ts` (Persona grade, speed lines, chroma, flash), `src/core/Engine.ts` (bloom threshold 1.45) |

## 4. Recipes (start here, then open the reference)

- **New attack / ability animation** → body-animation.md §2 (anatomy, frame budgets §2.7), §3 posing,
  §5 weapons. Author keys in frames (`F(n) = n/60`), ease per key, `lag` for overlap, recoil as a
  clip event `kick` (fixed) or `f.anim.kick()` from the kit (dynamic). Remote copies start 2 f
  before the first event so the event still fires.
- **Rifle / two-handed weapon** → stance with the support hand on a reachable grip (check reach:
  shoulder→grip ≤ 0.9× arm length), shouldered keys solved from the torso, a `stock` marker as the
  recoil hinge, `gripElbow` so the support elbow stays under the weapon, body absorption (`body`
  0.3 light … 1 heavy), heavy shots with `freq/zeta/rise/hang` (engine-ggg.md §7).
- **Charge-up** → plant + inQuad compression, `f.anim.tremble` ramp (0.2→1.2° @16 Hz, strain 2.2° @10 Hz),
  stillness + pop at "perfect", biggest kick on release (a release clip, not just a spring), VFX
  converging inward + an approach ring that closes exactly at full charge (vfx-design.md §3).
- **Idle with personality** → `idleLife` (weight shift, asymmetric breathing), relaxed idle after calm
  (`relaxed` + `relaxVia` so a long weapon swings around the head), `groove` nod on the beat.
- **Run** → `stride` (m per two steps; heavy 3.0–3.4), `runBob` (heavy footfall drop in m: Rex 0.045), `legSwing`.
- **Taunt / emote** → author in beats (`beats: true`): accents on integer beats, transitions leave
  2–4 f before, one climax held ≥20 f, a button pose.
- **Hair / cloth / props** → secondary-motion.md §9 parameter table, §10 per-champion recipes.
- **Weapon detail** (rings pumping, drum indexing, EQ, barrel heat, muzzle glow) → implement in the
  model's `tick`, triggered by `cue()` from the kit (local AND remote paths).
- **Projectile / beam / explosion / swarm / slash** → vfx-design.md §2–6, shaders in vfx-tech.md.
- **Hit feedback & camera** → game-feel.md (tiers §1.3, shake §2, kicks §2.3, impact frames §5.3).
- **Blender-authored clips, physics bakes, flipbooks** → blender-pipeline.md + `scripts/blender/`.

## 4b. Engine pitfalls already paid for (details: engine-ggg.md §16)

- `q.slerpQuaternions(a, q, t)` with `q` as the 2nd argument returns `a` (it disabled partial IK
  weights engine-wide: hands snapped at weight 1). Copy the target to a temp first.
- A kit check with side effects (`skillReady()` consumes the buffered press) must never run every
  frame for a cosmetic cue: read the cooldown instead.
- Inertialization offsets fight fast first keys (a hop key pulled a foot through the floor):
  short clip `inertia`, ground-clamped foot targets.
- Never edit `src/` while a capture runs.

## 5. Tools

### 5.1 Numbers: `npx tsx tools/anim_report.ts <champ> <clip|idle|run|air|fly|dash> [--json out.json]`
Plays the clip through the real `FighterAnimator` (same IK) at 60 Hz and prints key times/events,
**key-pose checks** (ankle height, foot pitch, off-hand distance, stock gap, head–gun clearance),
**angular-speed peaks** (pops: >900°/s off an impact frame), **IK** (weapon miss, off-hand slip,
elbow/knee ranges, locked frames), **foot slide**, muzzle **speed profile** (spacing sparkline).
`--json` feeds `scripts/plot_paths.py` (motion paths with 1/60 s dots + stick-figure key poses).

`npx tsx tools/sm_report.ts <champ> [fps]` does the same for secondary motion: hair, strings and
props through idle, run, a 30 m/s dive, an instant stop, a spin, a fall and teleports (peak / final
angle off rest, chain stretch). Run it at 30 / 60 / 144 fps after touching springs or cloth.

### 5.2 Images: `node .claude/skills/animation-vfx/scripts/capture.mjs …` (needs `npm run dev`)
- `still "<viewer query>" out.png` — e.g. `viewer&champ=rex&anims=idle,aim@0.2,relax@1&freeze=1&cam=34`
- `viewer "<query>" --frames 0-48/3 --name X --out DIR --sheet --onion --gif` — the clip plays on a
  virtual clock; side view = `cam=front&yaw=90`. Viewer specs: `idle`, `run`, `air`, `fly`, `dash`,
  `relax`, or any clip name (`@t` offset; with `freeze` it holds that frame).
- `scenario file.mjs --out DIR` — a real practice match with a frozen dummy and lab cameras
  (`side`, `side-wide`, `front34`, `behind`, `target`, `top`, `game`), scripted inputs
  (`press/hold/release`), `ready()` (cooldowns 0, ult full), `film(name, {frames, every, gif})`.
  Template: `assets/scenario-template.mjs`. Full API: references/verification.md.
- How to read the outputs (what a pop, a float, a mushy flash look like): references/verification.md §3.

### 5.3 Blender (headless bpy 4.2–5.x): `scripts/blender/`
`ggg_anim.py` (slotted-action-safe keying, NLA, events as glTF extras, FK bake, GLB export, clip
checks), `build_clips.py`, `cloth_to_bones.py` (cloth sim → bone keys), `flipbook.py` (VFX atlas),
`render_sheet.py` (contact sheets), `inspect_glb.py`. Run with `/root/blender-venv/bin/python -I`.

## 6. References (read the one you need)

| File | Read when |
|---|---|
| `references/engine-ggg.md` | Always before coding: every API above with conventions, sign tables, gotchas |
| `references/body-animation.md` | Posing, timing, attacks, weapons, recoil, charge, throws, locomotion, hits, taunts |
| `references/secondary-motion.md` | Springs maths, spring bones, cloth/hair/props, parameter tables, QA |
| `references/vfx-design.md` | Any effect: principles, timing, colour/value, projectile/beam/AoE/slash anatomy, REX worked spec |
| `references/vfx-tech.md` | Implementing effects in three.js: shaders (noise, erosion, fresnel, SDF, beams, rings), pools, trails, bloom, perf |
| `references/game-feel.md` | Hitstop, shake, kicks, FOV, impact frames, AV sync, PvP rules, feel tables |
| `references/blender-pipeline.md` | Authoring clips/rigs/bakes/flipbooks in Blender, glTF export, three.js playback, Unity |
| `references/verification.md` | Capture lab, filmstrips, onion skins, motion paths, metric thresholds, scenario API |
| `references/checklists.md` | Final review: body, secondary, VFX, feel, performance |
| `references/case-study-rex.md` | A complete worked pass (REX): baseline numbers, decisions, final parameters |
