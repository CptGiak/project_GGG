---
name: blender-character
description: Build 3D game characters in headless Blender from code at the highest quality reachable without hand sculpting. Covers SDF "clay" sculpting for faces and bodies, hair as sculpted locks, clothes with folds, hard-surface props, painterly vertex colour, rigging and skin weights, animation that follows the classic principles, and a render-and-critique loop. Use it whenever the user wants to create, redesign or improve a 3D character, hero, champion, NPC, creature, prop or weapon in Blender, or wants one rigged or animated. That includes requests for a look "like Deadlock / Arcane / Overwatch / League / Persona", Italian phrasings ("personaggio", "modello 3D", "campione", "animazione", "skin", "scolpire"), the project's champion pipeline in tools/blender, and judging what a 3D character looks like.
---

# Blender character art from code

You build characters the way a small art team would (concept → blockout → forms → face →
paint → rig → animation), but your hands are Python and your eyes are the renders you choose
to make. Two consequences drive everything below:

1. **You only see what you render.** Render early, often, from several angles, in clay and in
   colour, and read the images critically before every change. Never stack changes blind.
2. **Code is great at structure and bad at intuition.** Lean on what code does well (exact
   proportions, symmetry with controlled variation, procedural detail, repeatable rigs, IK,
   springs) and design around what it does badly. Hidden mouths, clear hair locks and hard
   props are design choices that play to the medium.

**Honest ceiling.** With this skill expect clean, characterful stylised heroes, roughly indie
to AA quality, in a few hours. Expect forms close to a stylised sculpt, painterly colour,
believable deformation and animation with real weight and timing. Do not promise AAA hero
quality (a Valve, Riot or Blizzard character made by concept, sculpt, paint and animation
specialists over months). Faces, hands, cloth folds and the nuance of hand-keyed timing stay
below that bar. When the user needs more, offer the hybrid route in
[references/hybrid.md](references/hybrid.md): an AI image-to-3D sculpt or an artist's mesh,
with you doing cleanup, rig, animation and integration.
An A/B test on the same brief (with the skill vs a long session without it) landed both
results on the same plateau. This skill does not raise the ceiling. It makes reaching the
plateau repeatable and fast (no 5,000 lines rewritten per character), consistent across a
roster, integrated with the game, and free of the traps below. Say so if asked.

## Setup

```bash
python3 -m venv /root/blender-venv            # skip if it exists
/root/blender-venv/bin/pip install bpy==5.2.2 numpy scipy pillow scikit-image
PY=/root/blender-venv/bin/python               # run every script with this
```

- Render with Cycles on CPU. EEVEE and Workbench need a display and fail headless.
- The toolkit lives in `scripts/charkit/` (put `scripts/` on `sys.path`):
  - `sdf.py`: sculpting (primitives, smooth blends, carving, shells, lathe, ribbons, locks,
    snap-to-surface, raycast, marching cubes, AO/curvature from the field).
  - `paint.py`: painterly vertex colour (`Look`, `Zone`, `paint`, `eye_colors`).
  - `studio.py`: meshes from arrays, a light rig scaled to the subject, the review views,
    contact sheets with silhouette rows, GIFs.
  - `rig.py`: armature from a joint table, weights per part, world-axis posing, aim,
    two-bone IK, keys with easing presets, spring follow-through, motion trails.
  - `sculpt.py`: the "hand". Blender's sculpt brushes reimplemented in numpy (crease, clay
    strips, trim, pinch, inflate, smooth, relax, grab...), strokes drawn on orthographic grid
    renders and ray-cast onto the mesh, a replayable stroke list, painting of sculpted meshes.
- `scripts/new_character.py` is the starting template. Copy it next to your work (outside
  the skill folder) and fill it in. It already has the landmarks table, the part and `LOOKS`
  tables, the review sheet with a silhouette row, a `.blend` for the rig stage, and the
  iteration flags `--fast --clay --face --rebuild <parts>`. `--rebuild` re-meshes only the
  parts you changed and loads the rest from a cache, so iterating on one part takes a minute
  instead of ten.
- `scripts/examples/chess_master_*.py` is a complete worked character (head → body → rig and
  idle) built with this workflow. Read the part of it that matches your current stage. Most
  techniques (eyes, locks, coat, pocket props, IK idle) can be lifted directly.

## Workflow

Each stage ends with a **gate**: render, look, and fix what the gate asks before moving on.
Detail never rescues a bad blockout, and paint never rescues bad forms.

### 0. Design brief (before any code)
Write a short brief in the conversation or in a `DESIGN.md` next to the scripts:
- **One-line fantasy** and **personality** (what the pose, face and idle must say).
- **Silhouette idea** in one phrase ("hunched question mark with a flat cap and a tome").
  Characters in hero games are told apart by silhouette first.
- **Proportions in heads** (realistic 7.5, heroic 8, stylised 6 to 6.5, chibi 3 to 4) and
  the caricature: what is pushed big, what is pushed small.
- **Shape language** (round = friendly, square = solid/stubborn, triangle = danger/agility),
  with one dominant shape.
- **Palette by value first**: the main masses in 3 values, then hues on a 60/30/10 split
  plus one saturated accent colour that leads the eye.
- **Three signature details** and what stays deliberately simple (rest areas).
- **Reference**: if the user gives images, Read them and list what to keep. Concept images
  from an image model (see the project's `docs/art/character-prompts.md`) can be used as a
  sheet to measure against.
Read [references/design.md](references/design.md) for style notes (Deadlock, Arcane, anime/Persona).

### 1. Landmarks
One joint table (hips, spine, chest, neck, head, shoulders, elbows, wrists, hips, knees,
ankles) and one head frame (eye line at z = 0) in a single place. Modelling, rig and
animation all read it, so proportions change in one edit. Model in a **wide A-pose**: upper arms
40 to 45° from vertical, forearms continuing outwards, legs slightly apart. If the sleeves
touch the torso at rest, the armpit becomes one merged surface. No weight scheme can separate
it, and the coat tears when the arm lifts. The relaxed, arms-down look belongs in the
animation's base pose, not in the model. Convert to the engine's bind pose at export.

### 2. Blockout (minutes, not hours)
Big masses only: SDF ellipsoids, round cones and lathes for the torso, limbs, head, hat and
props. Iterate with `--fast --clay` (voxels ×2, no paint) and the silhouette row of
`studio.sheet(..., silhouettes=True)`.
**Gate:** the black silhouettes read as this character from front, 3/4, side and back. The
proportions match the brief in head units. Profiles are smooth: stacked ellipsoids make
"tyre" bulges, so use `lathe` + `scale` for coats, skirts and sleeves.

### 3. Forms: primary → secondary → tertiary
Follow [references/sdf-recipes.md](references/sdf-recipes.md):
- Organic parts are **blends** of anatomical masses (k = 1 to 2 cm on a head, 4 to 6 cm on a
  torso), refined by **carving** (sockets, nostrils, folds).
- Clothes are **shells over grown body volumes** (`grow`, `shell`, `intersect` with planes
  for hems). Folds are masked grooves at the places cloth really folds: elbows, knees,
  armpits, waist, under the belt, at the hem.
- Hair, beards and brows are **locks** (`lock`, tapered clumps along curves) with roots
  placed by `snap()` on the skin. Noise displacement on a volume reads as fur, not hair.
- Accessories (buttons, flaps, straps, glasses) are placed with `snap()` and the surface
  normal, never by guessed coordinates.
- Hard-surface props use round boxes, `lathe` profiles, carves and small bevels that catch
  light. Chess pieces, canisters and weapon parts are all lathes.
**Gate:** the clay review (front, 3/4, side, back) shows clear big/medium/small forms with
rest areas, no blobs, no seams, and no floating or buried parts.

### 4. The face gate (close-up)
Render the head with `--face` (85 to 100 mm lens). The face carries the character, so spend
the time here.
- Before rendering eyes, run `raycast` from the camera side and check that the eyeball is
  visible through the lids (see the eye recipe; it is easy to bury it or to open a dark cavity).
- Check the expression matches the personality (brow angle, lid height, gaze target).
- Check the nose is built from planes (bridge, tip lobes, wings, alar groove) and not a ball,
  the ears tilt back, and the mouth is either designed (lips, corners, philtrum) or covered.
**Gate:** at thumbnail size the face reads the intended emotion.

### 4b. The hand pass (brush sculpting on the mesh)
What the SDF cannot give, a sculptor's hand does: planes, the creases of age, skin rolls,
cloth folds. Read [references/sculpt.md](references/sculpt.md) and copy
`examples/chess_master_sculpt.py` (face) or `examples/chess_master_folds.py` (coat):
- `--stage base`: mesh the part once (head 0.65 mm), render grid views with landmarks, and
  the same views with hair, beard and hats in flat colour to see which skin stays visible.
- Write strokes as polylines in the grid's millimetres on a named view, big to small: planes
  (`trim`, `clay_strips`), then creases (`wrinkle()`: crease, relax, roll, soften, polish),
  then polish. The list is replayed from the base mesh on every run.
- Paint with `K.mesh_sdf()` and add `K.cavity()` for the fine creases.
**Gate:** the 3/4 clay close-up shows planes and creases that read from 2 m away, with no
jagged lines (relax them) and no punctured thin parts (ears, lids).

### 5. Paint (painterly vertex colour)
Per part, a `Look` ([references/materials.md](references/materials.md)): base colour, colour
zones (skin: red nose, cheeks and ears, yellow forehead, cool jaw), AO with a warm tint,
cavity and edge from curvature, a warm top and cool bottom gradient, low-frequency variation
and stretched brush strokes along the form.
**Gate:** the value sheet (greyscale) still separates head, body and props, and the accent
colour is the most saturated thing on the character. Exposure is right: dark cloth stays dark.

### 6. Rig and weights
[references/rig-animation.md](references/rig-animation.md). Build the armature from the
landmarks, plus chains for secondary motion (beard, scarf, coat tails, ponytail) and a prop
bone. Weights come from `segment_weights` restricted per part and region (sleeves to the arm
bones, the skirt to hips and thighs, the head parts to the head). Dense SDF meshes are too
big and too multi-part for bone-heat weights. Use preserve-volume (dual quaternion) skinning.
**Gate:** a deformation test (arms up and forward, deep knee bend, head turn) shows no tearing,
candy-wrapper elbows or clothes passing through the body.

### 7. Animation
Write a **beat sheet** first (what happens, frame by frame, and why: the character's thought).
Then block **key poses** (strong line of action, weight over the support foot, contrapposto),
then breakdowns, then easing (`snap` for strikes, `windup` for anticipation, `settle` for
overshoot), then overlap (offset child chains by 2 to 4 frames) and follow-through (spring
chains). Hands move in arcs: use IK targets on curved paths, not straight lines.
**Gate:** the key-pose sheet reads as a story without the in-betweens. Motion trails of the
hands and head are arcs with ease spacing. A GIF at 10 to 15 fps shows weight, not floating.

### 8. Hero shot (presentation)
The same model reads very differently on stage. For the image the user will judge:
- Use a pose from the animation, not the A-pose (the strongest key pose, line of action
  visible).
- Show the fantasy: the hero's power in use (a glowing prop, floating pieces, VFX rings, an
  emissive accent). That is what makes an archetype read as a *hero* and not a bystander.
- Stage it with `studio.backdrop()` (floor and curved wall, for grounding shadows), the
  `night` light mood, a low 3/4 camera (35 to 50 mm), and `studio.painterly_post()`
  (anisotropic Kuwahara + warm/cool grade) for the painted look.
- Never judge forms through the filter: it hides seams and blobs. Gates 2 to 6 stay on clean
  clay and colour renders.

### 9. Export and integration
Decimate or remesh to the game budget, bake the vertex colour to a texture if the engine needs
UVs, export GLB. For this repository see "Project integration" below.

## Critique loop (every gate)

After each render, Read the sheet and write three lines before touching code:
1. **Biggest problem** (silhouette > proportions > big forms > face > colour > details).
2. **Why** (the cause in the model, not the symptom).
3. **The one change** that fixes it.
Then change only that, re-render, and compare with the previous version side by side. Keep a
short iteration log (v1, v2 … with one line each). Use the rubric in
[references/critique.md](references/critique.md). If the same problem survives two
iterations, change approach (different primitive, different construction) instead of
nudging numbers.

## Pitfalls that cost hours (and why)

- **Distance pruning.** `eval_pruned` returns box-distance underestimates far from a node.
  Every operator passes the exactness margin down, so smooth blends and displacement never
  see them. When you write a new node, honour `_eval(p, m)` or you get straight seams and
  "boxes" around displaced parts.
- **Detail below the voxel size disappears.** Grooves need about 3 voxels across. Mesh the
  head at 0.8 to 1 mm, the body at 2.5 to 3 mm, small props at 0.5 to 1 mm.
- **Eyelids.** Carve the lid opening only *in front of* the eyeball (subtract a sphere
  slightly smaller than the eye from the cutter). Otherwise you open a dark cavity around the
  eye. Make the socket depression broad enough to reach the actual face surface (check with
  `raycast`; smooth blends push faces forward more than you expect).
- **Exposure and edges.** AgX with the default rig is calibrated by `studio.light_rig`
  (`exposure = -0.6`). Edge highlights must be multiplicative, because additive edges wash
  dark cloth to grey.
- **Arms too close to the body.** See Landmarks: with sleeves touching the torso, the armpit
  tears in every raised-arm pose. Widen the A-pose and re-mesh; do not try to fix it with
  weights.
- **`pkill -f <script>` inside a shell command** also matches the shell running it and kills
  your own command. Kill by PID.
- **Creases narrower than 3 edges** tear into jagged lines. Size brush radii to the mesh
  (head 0.65 mm voxels: crease radius ≥ 1.6 mm; coat 2.8 mm voxels: ≥ 8 mm) and relax after
  every crease. Thin plates (ears) puncture if pushed deeper than they are thick.
- **Mesh density.** Marching cubes gives 0.3 to 1 M triangles per part. That is fine for
  renders, but decimate (collapse, ratio 0.3 to 0.4 keeps vertex colours) before rigging or
  frame-by-frame animation renders.
- **Blender 5.x API.** Actions are layered (`anim_utils.action_get_channelbag_for_slot`), the
  compositor is a node group (`scene.compositing_node_group`), and `material_override` on the
  view layer gives a clay pass for free.

## Project integration (project_GGG)

- Existing pipeline: `tools/blender/` (`bl_kit.py`: game skeleton `GAME_BONES` mirroring
  `src/fighter/Rig.ts`, toon materials, GLB export; `build_kaiser.py`: a full champion from
  Gemini sheets; `lol/rig_infer.py`: skeleton inference from weights).
- The game drives the procedural `Rig` and copies bone rotations onto GLB bones by name
  (`src/champions/glbModels.ts`). A new champion must therefore export the 19 game bones
  (names, hierarchy, T-pose rest) plus optional extras (fingers, chains declared in extras).
  The richer skeleton of `chess_master_anim.py` maps onto them by name. Collapse extra spine
  or finger bones, or keep them as extras.
- In-game animation clips are authored in TypeScript (`src/champions/*Anims.ts`,
  `src/fighter/Animator.ts`: pose keys with eases and weapon IK). Apply the same craft rules
  there: the beat sheet, key poses, easing and overlap transfer directly.
- Toon look in game: `src/render/toon.ts`. Painterly vertex colours survive as albedo; keep
  the value structure readable under two-tone shading.

## References (read when the stage needs them)

| File | Read it for |
|---|---|
| [references/design.md](references/design.md) | brief, silhouette, shape language, proportions, colour, style notes (Deadlock, Arcane, anime) |
| [references/anatomy.md](references/anatomy.md) | head and face construction, ageing, hands, body proportions and posture |
| [references/sdf-recipes.md](references/sdf-recipes.md) | how to sculpt each part with `charkit.sdf` (eyes, nose, ears, hands, clothes, folds, hair, props) |
| [references/materials.md](references/materials.md) | painterly `Look` settings, palettes, skin zones, metals/glass, baking for engines |
| [references/rig-animation.md](references/rig-animation.md) | rig from landmarks, weights, deformation tests, animation timing tables and recipes |
| [references/critique.md](references/critique.md) | per-stage rubric and symptom → cause → fix table |
| [references/sculpt.md](references/sculpt.md) | the hand pass: brush formulas, drawing strokes on grid views, wrinkle and fold recipes, pitfalls |
| [references/hybrid.md](references/hybrid.md) | limits of code-only modelling and the hybrid route (concept → image-to-3D → cleanup → rig → animation) |
