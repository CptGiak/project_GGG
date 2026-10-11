# Rig, weights and animation

Contents: rig from landmarks · weights per part · deformation test · animation craft (beat
sheet, poses, timing tables, easing, overlap, follow-through, arcs) · recipes (idle, walk,
run, attack, hit, emote) · review · bpy 5.x notes.

## Rig from landmarks

- Bones come from the same joint table as the model (`J` in the example), so a proportion
  change never desyncs the rig.
- Core chain: `root → hips → spine → chest → neck → head`, `clavicle → upper_arm → forearm →
  hand → fingers1/2 + thumb`, `thigh → shin → foot → toe`.
- Extras earn their place: chains for things that should lag (beard, scarf tails, coat
  tails, ponytail, earrings), a **prop bone** parented to the hand (weapon, book, case) so
  props never need weights, and optional jaw or eye bones if the face must act.
- Bones are not connected (`use_connect=False`) so heads sit exactly on the landmarks.
  Rotation mode is quaternion (no gimbal flips in IK solutions).

## Weights per part (`rig.segment_weights`)

`w_b = exp(-(d_b - d_min) / sigma)` over the bones a part is allowed to follow, top 4,
normalised. `sigma` is the blend width at joints: 1.2 cm for fingers, 2 to 3 cm for limbs,
3 to 8 cm for soft cloth. `bias` grows a bone's territory (the head bone gets +3 to 6 cm so the
whole skull stays rigid).

| Part | Allowed bones | Notes |
|---|---|---|
| head pieces (skin above the neck, eyes, cap, glasses, brows, hair) | head | rigid; skin also blends `neck`/`chest` low down |
| beard, moustache | head, beard_1, beard_2 | head bias 3.5 cm so only the hanging part swings |
| torso clothes | hips, spine, chest, neck, clavicles, upper arms, forearms | blend into skirt weights below the waist |
| skirt or coat tails | hips, thighs (+ spine) | wide sigma (8 cm), hips bias 10 cm: the legs pull it gently instead of tearing it |
| hands | forearm, hand, fingers, thumb (that side) | sigma 1.2 cm |
| trousers | hips, thighs, shins | |
| shoes | foot, toe (+ shin) | |
| props | prop bone | `rig.rigid(ob, 'case')` |
| scarf | neck, chest, scarf chains | |
Use preserve-volume (dual quaternion) skinning on the armature modifier (`rig.bind`).
Decimate the dense SDF meshes first (ratio 0.3 to 0.4).

**Regions from the modelling shapes.** For a garment built from several volumes (torso,
sleeves, skirt), decide each vertex's region with the SDFs it came from before computing
weights. Compare `sleeves(v)` with `torso(v)`, blend over about 3 cm, and use the arm bones
only in the sleeve region (see `weight_parts` in `chess_master_anim.py`). This only works if
the volumes do not overlap at rest. That is why the model must be in a wide A-pose: arms
40 to 45° from the body.

## Deformation test (gate before animating)

Pose: arms up 150°, arms forward 90°, elbows bent 130°, deep squat (knees 110°), head turned
70° and tilted 30°, spine twisted 35°. Render front and side. Look for tearing between parts
(raise sigma or add the bone to the part's allowed list), collapsing elbows or knees
(preserve volume, move the joint landmark to the real pivot), clothes passing through the body
(blend skirt weights more towards the hips), and props drifting (prop bone parent).

## Animation craft

### Beat sheet first
Write what the character *thinks* in each beat, with frames (30 fps):
```
0-18   settles weight onto the left leg, looks down at the board      (thought: "hm.")
18-30  anticipation: shoulder dips, hand drops a touch                (preparing)
30-44  hand rises in an arc to the chin                                (deciding to think)
44-80  two strokes down the beard, head nods on each                  (thinking)
80-90  head snaps up, lean back                                        ("aha!")
90-104 hand drops with a little overshoot, weight returns             (settled, confident)
104-119 back to neutral (loop)
```

### Key poses
- **Line of action**: one clear curve through the spine and head in every key pose.
  Straight vertical bodies look dead.
- **Weight**: the hips sit over the supporting foot. Shift 1.5 to 3 cm towards it, tilt the
  pelvis 2 to 4° down on the free side, counter-tilt the chest (contrapposto).
- **Silhouette**: arms away from the body where the action reads (negative space). Test with
  the silhouette row.
- **Asymmetry**: never key both arms or both legs doing the same thing.
- **Hands lead or trail, never both**: in a strike the hand trails the shoulder then
  overtakes it.

### Timing at 30 fps (starting points)

| Action | Anticipation | Action | Recovery / follow-through | Hold |
|---|---|---|---|---|
| light jab / flick | 3 to 4 | 2 to 3 | 6 to 8 | – |
| heavy swing (greatsword) | 10 to 14 | 3 to 5 | 14 to 20 | 4 to 6 on impact |
| throw | 8 to 10 | 3 | 10 | – |
| jump take-off | 6 to 8 (crouch) | 4 | land: 3 squash + 6 settle | – |
| hit reaction | 0 | 2 to 3 (snap away) | 10 to 16 | – |
| idle breathing | – | 2 breaths per 4 s cycle | – | moving holds |
| head turn | 2 (small dip) | 6 to 10 | 4 overshoot | – |
| walk cycle | – | 30 to 36 frames per 2 steps | – | – |
| run cycle | – | 16 to 20 frames per 2 steps | – | – |
Heavy and old characters: longer anticipations, shorter snaps, longer settles. Agile ones:
shorter everything, bigger overshoot.

### Easing (`rig.ease(arm, frame, kind)`, applied to the segment that starts at the key)
- `smooth`: slow in and slow out (default, everything organic).
- `windup`: accelerate into the next key (anticipation into a strike).
- `snap`: explosive start that settles into the next key (strikes, "aha" moments, impacts).
- `settle`: overshoot and settle (arm landing, head stop, prop catch).
- `hold`: stepped (blocking pass only).

### Overlap and follow-through
- Offset child bones 2 to 4 frames after their parent on big moves: hips → chest → head →
  arms.
- Hair, beards, scarves, tails and coat tails: `rig.bake_spring_chain(chain, frames,
  stiffness, damping)`. Use stiffness 0.15 to 0.25 and damping 0.7 to 0.78. Lower stiffness
  means more lag and a floppier result.
- Moving holds: nothing is ever fully still. Keep breathing (spine and chest ±1 to 2°) and
  let the head drift 1 to 2° between keys.

### Arcs
Hands, head and weapon tips travel on arcs. Animate effectors with `two_bone_ik(upper,
lower, target, pole)` on targets placed along a curve (out to the side, then in) and check
`rig.trail(...)` rendered with `trail_object`: the trail must be a curve. Dots close together
mean slow, far apart mean fast, and the spacing should match the easing intent.

## Recipes

- **Idle with personality**: weight shift + look at the thing they care about + one
  signature gesture (beard stroke, weapon check, adjusting glasses) + breath, looped (`cycle`).
- **Walk**: contact → down (lowest, 3 to 4 cm) → passing (highest) → up, hips rotate ±5° and
  tilt ±3°, arms counter-swing with a 2-frame lag, heel strike with a 3-frame toe roll.
- **Heavy attack**: anticipation coil (twist away, weight back) → smear frames (2 to 3) →
  impact hold → recovery with overshoot. Pair it with VFX events on the impact frame.
- **Hit react**: no anticipation, snap away from the hit direction in 2 to 3 frames, head
  lags 2 frames, recover over 12 to 16.
- **Emote / taunt**: the strongest silhouette of the character, held 10 to 20 frames.

## Review

- **Key-pose sheet** (`studio.sheet` of the key frames, same camera, with the hand trail): it
  must read as a story without in-betweens.
- **GIF** at 10 to 15 fps (every 2nd or 3rd frame) for timing.
- Check feet do not slide (planted feet: re-solve the legs with `two_bone_ik` to the ankle
  landmarks in every key), hands do not intersect the body, and props stay in the grip.

## bpy 5.x notes

- `pose_bone.keyframe_insert('rotation_quaternion', frame=f)` creates a layered action. Reach
  the curves with `bpy_extras.anim_utils.action_get_channelbag_for_slot(action, slot)`
  (`rig.fcurves`).
- Use `scene.frame_set(f)` before reading posed positions (drivers and constraints update).
- `bpy.ops.nla.bake` needs UI context. Bake procedural motion yourself: pose per frame, then
  `keyframe_insert` (that is what `bake_spring_chain` does).
