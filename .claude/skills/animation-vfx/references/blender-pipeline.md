# Blender pipeline: headless bpy → GLB → three.js (and Unity)

**Use this file for** authoring PROJECT GGG animation and VFX assets in Blender entirely from scripts: keying clips with slotted actions, NLA and events (§1), building and baking 19-bone rigs (§2), baking cloth to bones (§3), exporting GLBs with correct animation (§4), playing them in three.js or feeding them into GGG's own pose system (§5), rendering flipbooks and slash meshes (§6), checking everything without a GUI (§7) and exporting for Unity (§8). The tested scripts are in `scripts/blender/`; this file documents their CLI, functions, version gotchas and the pitfalls that broke real exports.

## Contents

0. Setup, script index, verified results
1. Keying: 1.1 Version map · 1.2 `ggg_anim.py` reference · 1.3 Keying rules · 1.4 NLA and events
2. Rigs: 2.1 Axes, roll, skinning · 2.2 IK and FK bake · 2.3 `build_clips.py` · 2.4 Rigify, Mixamo, springs
3. Physics: 3.1 `cloth_to_bones.py` · 3.2 Trade-offs
4. Export: 4.1 `export_glb` options · 4.2 Exporter behaviour · 4.3 Post-processing · 4.4 Root motion
5. three.js: 5.1 Mixer runtime · 5.2 Into GGG's pose system · 5.3 Events
6. VFX: 6.1 `flipbook.py` · 6.2 Atlas and slash mesh in three.js · 6.3 Flipbook or procedural
7. Verification: 7.1 Loop · 7.2 `render_sheet.py` · 7.3 Checks, `inspect_glb.py` · 7.4 Headless facts
8. Unity · Pitfalls · Sources

---

## 0. Setup, script index, verified results

**Environment.**
- `/root/blender-venv/bin/python` is the PyPI `bpy` **5.2.2 LTS** wheel (Python 3.13, numpy, scipy, Pillow); setup is in `tools/blender/README.md`.
- There is no `blender` binary and no `libEGL.so.1`: Workbench and EEVEE are unavailable, and the scripts fall back to Cycles CPU.
- The wheel lacks the Draco and meshopt bridges, so every export logs two harmless `ERROR … not available` lines.
- Run `/root/blender-venv/bin/python -I <script> …` from the scratchpad; output paths are relative to the current directory.
- `-I` keeps the script's folder off `sys.path`, so each script inserts it before `import ggg_anim`. Your own builds should do the same: `sys.path.insert(0, '<skill>/scripts/blender'); import ggg_anim as G`.

**Relation to `tools/blender/`.** `bl_kit.py` builds *champion model* GLBs (T-pose, no animation, `export_apply=True`, `ggg_spec`/`ggg_chains`/`ggg_sockets` extras). These scripts build *clip* GLBs. A clip GLB has no `ggg_spec`, so `instantiateGlb` refuses it (glbModels.ts:170): load it with `GLTFLoader` and convert it (§5.2).

| Script | What it does | CLI | Outputs |
|---|---|---|---|
| `ggg_anim.py` | Library: version shims, builders, keying, NLA, events, FK bake, filtered export, checks (§1.2) | `import ggg_anim as G` | — |
| `build_clips.py` | Reference build: 19-bone rig; `Idle` loop; `Attack` with BACK overshoot and events; `Walk` IK baked to FK; stray `WIP_unused`; NLA; checks; 3 exports | `python -I build_clips.py [OUT_DIR]` (default `./out`) | `char_<MM>.glb`, `…_default_single_armature.glb`, `…_nosample.glb`, `char_<MM>.blend` (`<MM>` = version, e.g. 52) |
| `cloth_to_bones.py` | Cloth cape on an animated chest → Damped Track → FK bake → 4-bone skinned cape | `python -I cloth_to_bones.py OUT_DIR` | `cape.glb`, `cape.blend` |
| `flipbook.py` | Emissive ring burst → transparent frames → atlas + JSON; slash arc mesh | `python -I flipbook.py OUT_DIR [--frames 16] [--cell 128]` | `frames/burst_NNN.png`, `burst_atlas.png/.json`, `slash.glb` |
| `render_sheet.py` | Contact sheet or onion skin of one action, 256 px cells | `python -I render_sheet.py [file.blend] CLIP N OUT.png [--onion]` | `OUT.png`, `<dir>/_frames/fNNNN.png` |
| `inspect_glb.py` | Plain-Python GLB report: animations, interpolation, keys, duration, extras, joints, rest rotations | `python3 inspect_glb.py a.glb [b.glb …] [--quat-flips]` | stdout |

**CLI rules.**
- Arguments come from after `--` when present (binary form: `blender -b --factory-startup --python-exit-code 1 -P script.py -- args`), else from `sys.argv[1:]` (wheel form).
- **There is no argparse, so `--help` is not a help flag.** `build_clips.py`, `cloth_to_bones.py` and `flipbook.py` take it as OUT_DIR and run a full build into `./--help/`; `render_sheet.py` raises `IndexError`. Missing positionals also raise `IndexError`.
- `flipbook.py` needs OUT_DIR first. `render_sheet.py` opens the `.blend` only if the first argument ends in `.blend`, and uses the scene's first ARMATURE.
- `ggg_anim.py`'s docstring example `-- --out out/char.glb` is wrong: `build_clips.py` takes a positional directory.

**Verified results** (4 wheels in the research [S7]; re-run here on 5.2.2):

| Check | Result |
|---|---|
| `build_clips.py` on bpy 4.2.23 / 4.4.0 / 4.5.14 / 5.2.2 | identical: 3 clips, 19 joints, 0 NaN; Walk planted 26 samples, max slide 1.2 mm/frame; pole angle 90°. 5.2.2 here: same `CHECK` lines, `dropped …: []` |
| `inspect_glb.py char_52.glb` | `Attack/Idle/Walk`, 57 channels each (19 bones × T/R/S; static ones 2-key STEP); `Attack` extras `ggg_events` windup 0 / hit 0.3 / recover 0.4 s, `ggg_fps` 30; 2 quaternion sign flips each in `Walk/thighL`, `thighR` |
| Default `export_anim_single_armature=True` | exports the unpublished `WIP_unused` as a 4th clip |
| Non-sampled export | only keyed bones (3/3/38 channels); BEZIER → CUBICSPLINE; SINE/BACK baked |
| gltf-validator [S10] | 0 errors, 1 harmless `NODE_SKINNED_MESH_NON_ROOT` |
| Extras → three.js | Action custom property → `animations[i].extras` → `AnimationClip.userData` on all 4 versions; events fired in Node three r186 at 0 / 0.30 / 0.40 s |
| `cloth_to_bones.py` | bit-identical on 4.2 and 5.2; bone tip vs cloth error ≤ 1.9 cm (re-run: 0.019 m) |
| `flipbook.py` | 4×4 atlas of 128 px via Cycles CPU in ≈ 2 s here (EEVEE in software: 3 min) |
| gltfpack `-cc -ke` [S16] | **dropped the animation extras** and constant tracks (57 → 11 channels); glTF-Transform kept both [S17] |
| Retarget GLB ↔ 19-bone driver | round-trip error 3.5e-4° |

---

## 1. Keying: actions, slotted actions (4.4+), interpolation, NLA, events

### 1.1 Version map (Blender 4.2 LTS → 5.x) [S5, S7, S12]

| | 4.2 / 4.3 | 4.4 / 4.5 | 5.x (checked on 5.2) |
|---|---|---|---|
| F-curves | `action.fcurves.new(path, index=, action_group=)` | `layers[0].strips[0].channelbag(slot, ensure=True).fcurves.new(...)`; `action.fcurves` = legacy proxy of the **first slot** | channelbag only; `Action.fcurves/groups/id_root` **removed** |
| Binding | `adt.action = act` | also `adt.action_slot = slot` (auto only if the identifier matches, e.g. `OBRig`) | same |
| NLA strip | `track.strips.new(name, start, act)` | also `strip.action_slot`; **unslotted strips are skipped by the glTF exporter** | same |
| Groups | `action.groups` | `channelbag.groups.new(name)`, `fc.group = grp`; no `group_name` kwarg | `fcurves.new(..., group_name=)` |
| Helper | — | `anim_utils.action_get_channelbag_for_slot` | `action_ensure_channelbag_for_slot` |
| Bone selection | `bone.select` | `bone.select` | `pose_bone.select` |
| EEVEE id | `BLENDER_EEVEE_NEXT` | `BLENDER_EEVEE_NEXT` | `BLENDER_EEVEE` |
| glTF options | — | `export_merge_animation`, `export_sampling_interpolation_fallback` appear | `export_meshopt_*` (absent in 4.5) |
| Deprecations | `eevee.use_bloom` no-op | — | `use_bloom` gone; `Material.use_nodes` warns "removed in 6.0" (flipbook.py:49) |

Slot rules: an Action has one layer with one keyframe strip (adding more raises); `slots.new(id_type, name)` prefixes a 2-letter ID code; assigning another action's slot raises `RuntimeError`; unassigning keeps `last_slot_identifier`, so re-assigning auto-binds.

### 1.2 `ggg_anim.py` reference

Constants `BL = bpy.app.version`, `SLOTTED = BL >= (4, 4, 0)`.

| Function | Notes |
|---|---|
| `eevee_id() -> str` | `'BLENDER_EEVEE'` on 5.x, else `'BLENDER_EEVEE_NEXT'` |
| `select_pose_bone(pb, state=True)` | `PoseBone.select` on 5.x, `Bone.select` before |
| `assign_action(owner, action) -> AnimData` | Sets the action; on 4.4+ binds the first slot with `target_id_type` `UNSPECIFIED` or `owner.id_type`, else a new one named after the owner. Objects and `mesh.shape_keys` |
| `ensure_fcurve(action, owner, data_path, index=0, group="")` | Find-or-create; on 4.4+ raises `RuntimeError` unless `assign_action` ran first |
| `action_fcurves(action) -> list` | every slot's F-curves (read-only) |
| `build_armature(name, bones, roll_ref=(0,-1,0)) -> Object` | `bones = [{name, head, tail, parent=None, deform=True, roll_ref=None}]`, armature space. Local Z → `roll_ref` (front), +Z if the bone is near-parallel. Pose bones in `QUATERNION` mode |
| `rigid_box_mesh(arm_ob, name="Body", thickness=0.06, skip=()) -> Object` | One 100%-weighted box per deform bone (hands/feet 60% thick), Armature modifier, parented |
| `key_clip(arm_ob, clip, keys, fps=30, start=0, interp='BEZIER', easing='AUTO', loop=False) -> Action` | `keys = [{'t': s, 'rot': {bone: (w,x,y,z)}, 'eul': {bone: ((x,y,z) deg, 'XYZ')}, 'loc': {bone: (x,y,z)}, 'interp', 'easing', 'back'}]`, bone-local. A key's interp/easing apply to the segment it **starts**. `make_compatible` on consecutive keys, `AUTO_CLAMPED` handles, manual frame range, fake user. `loop`: CYCLES modifier (preview only) + `use_cyclic` |
| `push_to_nla(owner, action, track_name=None) -> (track, strip)` | One action per track; slot bound on 4.4+; extrapolation `NOTHING`; unmuted; clears the active action if it is this clip (else it exports twice) |
| `preview_clip(owner, action, frame=None)`, `end_preview(owner)` | Evaluate one clip alone (`use_nla = False`), then restore |
| `set_events(action, events, fps)` | `[(name, seconds)]` → pose markers **and** custom props `ggg_events = [{name, time}]`, `ggg_fps`, `ggg_loop` |
| `bake_to_fk(arm_ob, frame_start, frame_end, name, clear_constraints=True) -> Action` | `anim_utils.bake_action_objects`, visual keying of loc/rot; removes **all** constraints on baked bones; same signature 4.2–5.2 [S3] |
| `export_glb(path, objects, **overrides) -> list[str]` | Selects `objects`, exports with §4.1 defaults + overrides, drops options this exporter lacks and **returns their names** |
| `check_clip(arm_ob, action, fps, foot_bones=('footL','footR'), contact_margin=0.01) -> dict` | `{clip, frames, seconds, curves, nan, planted_samples, max_foot_slide_m}`; planted = within 1 cm of rest height on two consecutive frames |

### 1.3 Keying rules

- **Interpolation** per key: `CONSTANT LINEAR BEZIER SINE QUAD CUBIC QUART QUINT EXPO CIRC BACK BOUNCE ELASTIC`; **easing** `AUTO EASE_IN EASE_OUT EASE_IN_OUT`; `BACK` uses `kp.back`, `ELASTIC` `amplitude`/`period`. They map to GGG's `outBack`, `outExpo`… but export baked (§4.2).
- **Quaternions need `make_compatible`** between keys: Blender interpolates components independently, so a sign flip spins 360°. Model-space targets: `arm.convert_space(pose_bone=pb, matrix=M, from_space='POSE', to_space='LOCAL')`, parents first.
- **Loops**: the last key equals the first and lies inside `frame_range` (glTF has no wrap; three.js plays `t mod duration`).
- **fps**: the scene default is 24 and glTF time is frame/fps. GGG budgets frames at 60, so author with `FPS = 60` (`sc.render.fps`, `key_clip(..., fps=60)`, `set_events(..., 60)`). `build_clips.py` uses 30 only to reproduce the test.
- **`keyframe_insert()` keys into the assigned action**: clear `animation_data.action` first (build_clips.py:122).

### 1.4 NLA and events

The `ACTIONS` export mode takes the active action (only with a bound slot) plus **every NLA track holding exactly one unmuted strip**. `strip.mute` is honoured, `track.mute` ignored; multi-strip tracks are skipped with a warning; since 4.4 tracks merge by action [S2].

**Markers are not exported; Action custom properties are** (`generate_extras`, 4.2 and 5.2 [S2]), lists of dicts included. Hence `set_events` writes both, and `GLTFLoader` copies the extras into `AnimationClip.userData` [S14]:

```json
"extras": {"ggg_events": [{"name": "windup", "time": 0.0}, {"name": "hit", "time": 0.3}, {"name": "recover", "time": 0.4}], "ggg_fps": 30, "ggg_loop": 0}
```

---

## 2. Rig construction by script

### 2.1 Axes, roll, skinning

- **World convention** (as `bl_kit.py`): X = character's left, −Y = front, Z = up; `export_yup` gives GGG's +Y up, +Z forward, +X left.
- **Joint frames**: glTF joints keep Blender bone frames (**local +Y head → tail**); only the root gets Z-up → Y-up. With `build_armature`'s roll rule, vertical bones have an **identity rest rotation** in glTF (hips, spine; upperArm vs shoulder) and thighs sit 180° from the hips (`inspect_glb.py`). **Fix one roll rule**: otherwise clips stop being portable between rebuilds and pole angles drift. GGG's retarget (§5.2) tolerates any roll.
- **Skinning**: rigid (one group at 1.0 per part: `rigid_box_mesh`, `bl_kit.bind_rigid`) for hard-surface champions, never candy-wraps; bone heat (`ARMATURE_AUTO`) for organic meshes, with `bl_kit.fill_unweighted` as fallback; 4 influences.
- **Names**: three.js strips `[ ] . : /` and turns spaces into `_` (`upperArm.L` → `upperArmL`; duplicates `_1`) [S13]. Name bones exactly like `src/fighter/Rig.ts` `BONES`.

### 2.2 IK, poles, Child-Of, then the FK bake

- IK targets and poles are world-space **empties** (their animation is not exported). Calibrate the pole angle that reproduces the rest pose: try 0/90/−90/180° and sum `min(d, 2π − d)` (`rotation_difference().angle` ≈ 2π for q vs −q) (build_clips.py:97–113). With the roll rule it is 90° on every version.
- Weapon swaps: `CHILD_OF` to `handR`, `inverse_matrix` = inverse of the target's world matrix at bind, keyframe `influence`; bake like IK. GGG stores sockets as `ggg_sockets` extras.
- **Always finish with `G.bake_to_fk`**: sampled export evaluates constraints, so leftover IK/Child-Of/Damped Track overrides *every* clip. Avoid `bpy.ops.nla.bake`: it needs selection/pose-mode context and its `only_selected` reads `PoseBone.select` on 5.x vs `Bone.select` on ≤ 4.5 [S4].

### 2.3 `build_clips.py`, the reference build

The template to copy for real clips:
1. Factory settings, fps 30; the 19 GGG bones in T-pose from a joint table `J` and a `CHAIN` of (head, tail, parent); asserts 19; rigid body mesh.
2. `rot(bone, axis, deg)`: "rotate about the **armature** axis" expressed bone-locally (`R⁻¹·Q·R`).
3. **`Idle`**: BEZIER loop, chest breath + arm sway, last key = first.
4. **`Attack`**: 0 s SINE/EASE_IN anticipation → 0.18 s BACK/EASE_OUT strike (`back` 2.2) → 0.30 s CONSTANT hold (hitstop) → 0.40 s release → 0.80 s recovered; events `windup` 0, `hit` 0.30, `recover` 0.40.
5. **`Walk`**: shin IK + `COPY_ROTATION` feet on empties, calibrated poles, scripted stance/swing foot path (10 cm lift), hips root motion 0.6 m/cycle toward −Y with a 2 cm bob; `bake_to_fk(arm, 0, 30, 'Walk')`, then empties and source action deleted.
6. Stray `WIP_unused` (export trap demo); `push_to_nla` ×3; `check_clip` → `CHECK {...}`; exports default / single-armature / non-sampled + `.blend`.

Expected on 5.2: `pole_angle L/R: 90 deg`; Idle 2.0 s/12 curves, Attack 0.8 s/12, Walk 1.0 s/133 with 26 planted and 1.2 mm slide; `dropped …: []`; `DONE 5.2.2 LTS`.

### 2.4 Rigify, Mixamo, spring bones

- **Rigify**: `export_def_bones=True` keeps and bakes deform bones; rename `DEF-*`. For a fixed 19-bone contract a script-built rig is simpler.
- **Mixamo FBX**: import, strip `mixamorig:`, fix the 0.01 scale, retarget per frame with §5.2's rest-offset formula via world-space Copy Rotation + `bake_to_fk`; split hips root motion as Mixamo Converter does [S23].
- **Wiggle/spring bones** run from frame handlers with their own bake [S21]. Headless, prefer a cloth proxy (§3) or GGG's runtime chains (`BoneChain` glbModels.ts:410, `ClothChain`, `SpringBone`).

---

## 3. Physics bakes

### 3.1 `cloth_to_bones.py`: cloth cape → bone keys

1. Rig: `chest` + 4-bone `cape0..3` (0.8 m, behind the back at +Y 0.12, `roll_ref` (0,1,0)). Cape: 9×17-vertex grid, 0.45 m wide; groups `pin` + `chest` on the top row, `tip0..3` on the row at each bone tail.
2. Modifiers **Armature before Cloth**; cloth quality 8, mass 0.25, air damping 2, tension/compression 20, bending 0.5, pinned by `pin`.
3. Chest animation over frames 1–60 at 30 fps: 0.9 m lunge forward, then a 90° turn.
4. Bake the point cache: `frame_set(F0)`, `bpy.ops.ptcache.bake(bake=True)` under `temp_override(scene=…, active_object=cape, point_cache=…)` (sims must be baked or stepped in order).
5. `DAMPED_TRACK` (`TRACK_Y`) per cape bone to its `tip{i}` group; tip error printed every 10 frames.
6. `bake_to_fk(arm, 1, 60, 'CapeSwing')` (constraints removed); drop Cloth and helper groups; re-skin rows to `cape{i}` with linear blends; `push_to_nla`; export `cape.glb`.

Result: `CapeSwing`, 15 channels, 1.97 s, 5 joints, tip error ≤ 1.9 cm. Damped Track keeps bone lengths, so cloth stretch becomes tip error (use Stretch To or more bones). Same recipe for skirts (a chain per panel) and hoods.

### 3.2 Trade-offs

| Method | Output | Good for | Costs |
|---|---|---|---|
| Sim → bone chain (§3.1) | skin clip; blends | capes, strands, tails, skirts on authored clips | detail ∝ bone count |
| Sim → shape keys | `modifier_apply_as_shapekey(keep_modifier=True, modifier='Cloth')` per frame, keyed one-hot → morphs (dropped by `export_apply=True`) | short flourishes, small meshes | a morph per frame; no blending |
| Sim → VAT | per-frame evaluated vertices → Float16 texture (`DataTexture(HalfFloatType)` or EXR + min/max JSON, as OpenVAT/Unreal Tools [S22]); vertex shader by `gl_VertexID` | long sims, destruction, GN sim zones | custom shader; verts × frames × 8 B |
| Runtime springs | `ClothChain`, `SpringBone`, `BoneChain` | gameplay-reactive motion | CPU, tuning |

GN simulation zones bake with `bpy.ops.object.simulation_nodes_cache_bake(selected=False)` (4.2 and 5.2) but are not glTF-exportable: convert to VAT or shape keys. **For GGG** keep reactive secondary motion at runtime (secondary-motion.md); bake cloth only for showcase clips (emotes, ult intros).

---

## 4. glTF export for animation

### 4.1 `export_glb` options (ggg_anim.py:289–317)

| Option | Value | Why |
|---|---|---|
| `export_animation_mode` | `ACTIONS` | one animation per action/track |
| `export_anim_single_armature` | **False** | default True exports **every** bone action in `bpy.data` |
| `export_merge_animation` | `ACTION` | 4.4+: merge by action, not track name |
| `export_force_sampling`, `export_frame_step` | True, 1 | evaluates constraints/drivers; writes all bones (no pose leakage) |
| `export_sampling_interpolation_fallback` | `LINEAR` | 4.4+ |
| `export_anim_slide_to_zero`, `export_negative_frame` | True, `SLIDE` | clips start at t = 0 |
| `export_optimize_animation_size` (+ `_keep_anim_armature`) | True | static channels → 2-key STEP, all bones kept |
| `export_def_bones` | True | drops IK/MCH/helper bones |
| `export_rest_position_armature`, `export_reset_pose_bones` | True | bind = rest |
| `export_apply` | **False** | True drops shape keys and morph animation |
| `export_extras` | True | Action custom props → `animations[i].extras` |
| skins / influences / morphs; `export_yup`; cameras, lights | True / 4 / True; True; False | |

On 4.2 `export_glb` drops the 4.4+ options and returns their names; on 5.2 it drops none. Compression options exist on 5.2 but cannot run in the wheel.

### 4.2 What the exporter does [S1, S2]

- **Range** `action.frame_range` (a manual range wins); seconds = frame/fps.
- **Sampling** (default): every frame is evaluated **including constraints and drivers**, all bones written; a channel whose **first key is CONSTANT is exported entirely as STEP**, everything else LINEAR.
- **Without sampling**: BEZIER → CUBICSPLINE, LINEAR stays, CONSTANT → STEP; SINE/BACK/ELASTIC force a bake ("unsupported interpolation method", logged 15× by `build_clips.py`); **unkeyed bones are omitted** → pose leakage in three.js.
- **Spec** [S8, S9]: only node TRS and morph weights animate in core glTF; one target per node/path per animation; inputs need min/max and no NaN/Inf; outputs clamp outside the range; LINEAR rotation = shortest-path slerp; CUBICSPLINE needs ≥ 2 keys and renormalised quaternions; skinned meshes ignore parent transforms, so keep the armature at identity with scale applied.

### 4.3 Post-processing and validation

These tools are not in `package.json`: install them into a scratch folder (`npm i --prefix <scratch> gltf-validator @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions`).

```js
// validate.mjs: node validate.mjs a.glb   (npm 'gltf-validator' is an API; the native CLI is gltf_validator)
import { readFileSync } from 'node:fs';
import validator from 'gltf-validator';
const rep = await validator.validateBytes(new Uint8Array(readFileSync(process.argv[2])));
console.log(rep.issues.numErrors, 'errors', rep.issues.messages.filter((m) => m.severity <= 1));

// shrink.mjs: node shrink.mjs in.glb out.glb — lossless key reduction that KEEPS animation extras
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { resample, prune, dedup } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
await doc.transform(resample({ tolerance: 1e-4 }), dedup(), prune({ keepLeaves: true }));
await io.write(process.argv[3], doc);
```

**gltfpack** [S16]: `npx gltfpack -i in.glb -o out.glb -cc -ac -kn` (meshopt; keep constant tracks; keep named nodes). It **drops animation extras even with `-ke`** (re-read events from the pre-pack GLB, §5.3), resamples (`-af 30`) and quantises rotations (`-ar 12`); 63 KB → 17 KB on the test GLB. three.js then needs `loader.setMeshoptDecoder(MeshoptDecoder)`; `EXT_meshopt_compression` also packs keyframes [S11]. Draco/meshopt cannot run inside the wheel: compress as a post step.

### 4.4 Root motion

GGG has no root bone: locomotion lives on `hips`. Author dashes and lunges with real hips travel (the Walk's 0.6 m/cycle shows as glTF +Z 0.600), strip it at load (§5.1 `makeInPlace` or §5.2's trend removal) and let the character controller move the body.

---

## 5. three.js side (r186)

### 5.1 Mixer runtime (props, set pieces, menus, VFX meshes)

Champions go through §5.2. This module was tested in Node against the exported GLB:

```js
// anim_runtime.mjs
import * as THREE from 'three';

export function fixQuaternionFlips(clip) {          // hemisphere-continuous quaternion tracks
  for (const t of clip.tracks) {
    if (!(t instanceof THREE.QuaternionKeyframeTrack)) continue;
    const v = t.values;
    for (let i = 4; i < v.length; i += 4)
      if (v[i - 4] * v[i] + v[i - 3] * v[i + 1] + v[i - 2] * v[i + 2] + v[i - 1] * v[i + 3] < 0)
        for (let k = 0; k < 4; k++) v[i + k] = -v[i + k];
  }
  return clip;
}

export function makeInPlace(clip, hips = 'hips') {  // pins XZ to frame 0 (also removes sway), returns travel
  const t = clip.tracks.find((tr) => tr.name === `${hips}.position`);
  if (!t) return { clip, rootDelta: new THREE.Vector3() };
  const v = t.values, n = v.length / 3;
  const d = new THREE.Vector3(v[(n - 1) * 3] - v[0], 0, v[(n - 1) * 3 + 2] - v[2]);
  for (let i = 0; i < n; i++) { v[i * 3] = v[0]; v[i * 3 + 2] = v[2]; }
  return { clip, rootDelta: d };
}

export class ClipPlayer extends THREE.EventDispatcher {
  constructor(root, clips) {
    super();
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = Object.fromEntries(clips.map((c) => [c.name, c]));
    this.base = null;
    this._watch = new Map();
    this.mixer.addEventListener('finished', (e) => this._onFinished(e));
  }
  action(name) { return this.mixer.clipAction(this.clips[name]); }
  loop(name, fade = 0.2) {                          // base states: idle / walk / run
    const next = this.action(name);
    if (this.base === next) return next;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (this.base) this.base.crossFadeTo(next, fade, false);
    this.base = next;
    this._track(next);
    return next;
  }
  oneShot(name, { fadeIn = 0.06, fadeOut = 0.12, timeScale = 1 } = {}) {
    const a = this.action(name);
    a.reset().setLoop(THREE.LoopOnce, 1).setEffectiveTimeScale(timeScale).setEffectiveWeight(1);
    a.clampWhenFinished = true;
    a.fadeIn(fadeIn).play();
    a.userData = { fadeOut };
    this._track(a);
    return a;
  }
  additive(name, weight = 1, refFrame = 0, fps = 30) {   // makeClipAdditive mutates -> clone
    const src = this.clips[name];
    const add = THREE.AnimationUtils.makeClipAdditive(src.clone(), refFrame, src, fps);
    add.name = `${name}+add`;
    return this.mixer.clipAction(add, undefined, THREE.AdditiveAnimationBlendMode).setEffectiveWeight(weight).play();
  }
  update(dt) {
    this.mixer.update(dt);
    for (const [a, w] of this._watch) {             // events whose time was crossed this step
      const t = a.time, wrapped = t < w.prev;
      for (const ev of w.events) {
        const hit = wrapped ? (ev.time > w.prev || ev.time <= t) : (ev.time > w.prev && ev.time <= t);
        if (hit && a.getEffectiveWeight() > 0) this.dispatchEvent({ type: 'clipevent', clip: a.getClip().name, name: ev.name, time: ev.time });
      }
      w.prev = t;
    }
  }
  _track(a) { this._watch.set(a, { events: a.getClip().userData?.ggg_events ?? [], prev: -1e-6 }); }
  _onFinished(e) {
    const a = e.action;
    if (a.loop === THREE.LoopOnce && this.base) {
      a.fadeOut(a.userData?.fadeOut ?? 0.12);
      this.dispatchEvent({ type: 'oneshotdone', clip: a.getClip().name });
    }
  }
}
```

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/models/prop.glb');
const player = new ClipPlayer(gltf.scene, gltf.animations.map(fixQuaternionFlips));
player.addEventListener('clipevent', (e) => { if (e.name === 'hit') spawnHitVfx(); });
player.loop('Idle'); player.additive('Idle', 0.3);
// on input: player.loop('Walk', 0.25); player.oneShot('Attack');   every tick: player.update(dt)
```

Test log (60 Hz; Idle → Walk at 0.5 s, Attack at 1.0 s): `1.000 windup | 1.283 hit | 1.400 recover | 1.800 done`; events land on the first step at or after their time. three.js facts [S13, S15]: `crossFadeTo(next, duration, warp)` (warp also ramps time scale); the mixer emits `finished` (LoopOnce) and `loop`; `AnimationUtils.subclip(clip, name, start, end, fps = 30)` has an **exclusive** end and shifts to 0; `makeClipAdditive` **mutates** its target; `mixer.setTime(t)` zeroes all actions and updates by `t`; `SkeletonUtils.retargetClip` copies **world** rotations (identical rest orientations unless `localOffsets`).

### 5.2 Feeding Blender clips into GGG's 19-bone pose system

**Champions must not use the mixer**: `syncPose` rewrites every GLB bone from the procedural driver rig each frame (glbModels.ts:283–292), and the mixer would bypass foot/hand IK, weapon kick springs, flinch, groove, inertialization, cloth, remote copies, the viewer and `tools/anim_report.ts`. Convert the clip into a GGG `Clip` with glbModels' rest-offset formula: `offset = tpose⁻¹·bind` (glbModels.ts:193), driver = `glbWorld·offset⁻¹`, local = `parentDriver⁻¹·driver`.

```ts
// src/champions/glbClips.ts (proposed): Blender clip → GGG Clip (blends, IK, kicks, remote copies like code clips)
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { BONES, BONE_COUNT } from '../fighter/Rig';
import { Clip, Ease, Pose, type ClipEvent, type ClipOptions, type Key } from '../fighter/Animator';

/** tpose: driver-rig model-space rotations of the T-pose the GLB is bound in = glbModels.ts:143 tposeQuats() (export it) */
export function glbClipToPoseClip(gltf: GLTF, name: string, tpose: THREE.Quaternion[], opts: ClipOptions = {}, fps = 60, inPlace = true): Clip {
  const anim = gltf.animations.find((a) => a.name === name);
  if (!anim) throw new Error(`GLB has no clip ${name}`);
  const scene = SkeletonUtils.clone(gltf.scene);              // private copy, never the in-game instance
  scene.updateMatrixWorld(true);                               // bind pose
  const bones = BONES.map((n) => scene.getObjectByName(n)!);
  const parent = bones.map((b) => {                            // nearest ancestor that is a driver bone
    for (let p = b.parent; p; p = p.parent) { const k = BONES.indexOf(p.name as (typeof BONES)[number]); if (k >= 0) return k; }
    return -1;
  });
  const wq = (o: THREE.Object3D, q = new THREE.Quaternion()) => o.getWorldQuaternion(q);
  const offInv = bones.map((b, i) => tpose[i].clone().invert().multiply(wq(b)).invert());
  const hips0 = bones[0].getWorldPosition(new THREE.Vector3());
  const mixer = new THREE.AnimationMixer(scene);
  const act = mixer.clipAction(anim).setLoop(THREE.LoopOnce, 1);
  act.clampWhenFinished = true;
  act.play();
  const n = Math.max(1, Math.round(anim.duration * fps)), drv = bones.map(() => new THREE.Quaternion());
  const keys: Key[] = [];
  for (let f = 0; f <= n; f++) {
    mixer.setTime(f / fps);
    scene.updateMatrixWorld(true);
    const p = new Pose();
    for (let i = 0; i < BONE_COUNT; i++) {
      wq(bones[i], drv[i]).multiply(offInv[i]);                // driver model-space rotation
      p.setQuat(BONES[i], parent[i] < 0 ? drv[i] : drv[parent[i]].clone().invert().multiply(drv[i]));
    }
    bones[0].getWorldPosition(p.hips).sub(hips0);              // Pose.hips = offset from the rest hips
    keys.push({ t: f / fps, pose: p, ease: Ease.linear });
  }
  if (inPlace) {                                               // remove the XZ trend, keep the sway
    const d = keys[n].pose.hips.clone().sub(keys[0].pose.hips);
    for (const k of keys) { k.pose.hips.x -= (d.x * k.t) / keys[n].t; k.pose.hips.z -= (d.z * k.t) / keys[n].t; }
  }
  const events: ClipEvent[] = (anim.userData.ggg_events ?? []).map((e: { name: string; time: number }) => ({ t: e.time, id: e.name }));
  return new Clip(name, keys, { ...opts, events: [...(opts.events ?? []), ...events], loop: opts.loop ?? !!anim.userData.ggg_loop });
}
```

Usage notes:
- Convert once after the GLB loads and register it (`anims.clips[name] = clip`); it then plays through `f.anim.play(name)`. Add GGG-only data through `opts` (`lag`, `mask`, `fadeIn/Out`, `inertia`, kick events `{ t, id: 'fire', kick: {...} }`).
- Build clips on the champion's own skeleton (the `bl_kit` 19-bone T-pose rig) so offsets and hips travel match; `v.animScale` scales positions when proportions differ. Name bones like `BONES`; pass `{ loop: true }` for cycles (`ggg_loop` exists only via `set_events`); author at 60 fps.
- `Pose` blending takes the shortest path, so sign flips need no fix. **Verify** with `npx tsx tools/anim_report.ts <champ> <clip>` and viewer filmstrips (SKILL.md §5).

### 5.3 Events from `clip.userData`

- `glbClipToPoseClip` turns `ggg_events` into `ClipEvent`s, delivered to `kit.onAnimEvent` on local, bot and remote copies (Fighter.ts:1075–1082); with the mixer, `ClipPlayer` dispatches `clipevent`.
- Never trust client playback for hit timing: extract events at build time into `shared/` so the server uses the same times. This also survives gltfpack:

```js
// glb_events.mjs: node glb_events.mjs clips.glb > shared/anim/<champ>_events.json
import { readFileSync } from 'node:fs';
const b = readFileSync(process.argv[2]);
const json = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));   // GLB chunk 0 = JSON
console.log(JSON.stringify(Object.fromEntries((json.animations ?? []).map((a) => [a.name, a.extras?.ggg_events ?? []])), null, 1));
```

- Drive any mixer from **simulation time** (fixed step), not render dt; GGG's animator already steps with the fighter's dt.

---

## 6. VFX asset authoring in Blender

### 6.1 `flipbook.py`

- **Mesh**: `arc_mesh('Ring', 0.55, 1.0, 0, 2π)`, UV u along the arc, v inner → outer.
- **Material**: emission colour from a ramp over v (orange edge → warm core → orange), alpha = ramp alpha × an animated `Value`, mixed with Transparent; strength 1.2 (> 1 clips to white under `Standard`).
- **Animation** over `--frames` N (default 16): scale 0.2 → 1.0 EXPO/EASE_OUT, alpha 1 → 0 QUAD/EASE_IN. The node tree has its own action (own slot on 4.4+); `ease()` handles both F-curve APIs (flipbook.py:91–101).
- **Render**: orthographic top-down camera (`ortho_scale` 2.1); `film_transparent`, PNG RGBA (**straight alpha**), compositing off, view transform **Standard** (AgX shifts emissive colours). EEVEE (16 TAA samples) if `ctypes.CDLL('libEGL.so.1')` loads, else **Cycles CPU**, 16 samples, no denoise.
- **Pack**: `cols = ceil(√N)`, `rows = ceil(N/cols)`, frame 0 top-left, row-major (Blender rows are bottom-up, so the packer flips). `burst_atlas.json` = `{image, frames, cols, rows, cell, fps: 30, order, alpha: "straight"}`.
- **Slash**: `arc_mesh('Slash', 0.8, 1.0, −60°, 110°, seg=32)` exported alone as `slash.glb`.

To make a new effect, copy the script and change the ramp, mesh or keyed `scale`/`fade`; keep emission ≤ 1, `Standard`, straight alpha and the packing order.

### 6.2 Atlas and slash mesh in three.js

```glsl
// flipbook sampling: texture.flipY = true (default), frame 0 top-left, row-major; f = age * fps
vec2 atlasUv(vec2 uv, float i) {
  vec2 c = vec2(mod(i, COLS), floor(i / COLS));
  return vec2((c.x + uv.x) / COLS, 1.0 - (c.y + 1.0 - uv.y) / ROWS);
}
float i0 = floor(f), i1 = min(i0 + 1.0, FRAMES - 1.0);        // blend neighbours to hide low frame counts
vec4 col = mix(texture2D(map, atlasUv(vUv, i0)), texture2D(map, atlasUv(vUv, i1)), fract(f));
```

- **Alpha**: straight alpha → black transparent texels → dark fringes when filtered. Set `texture.premultiplyAlpha = true` with `material.premultipliedAlpha = true`, or dilate RGB. **Additive** effects: render on black (`film_transparent = False`) and ignore alpha.
- **Slash mesh**: scroll `u − time`, multiply by noise, erode with `smoothstep(threshold, threshold + soft, noise)` driven by age (shaders: vfx-tech.md).
- **Tileable noise/erosion textures** (recipe not executed): bake (Cycles `bpy.ops.object.bake(type='EMIT')`) a plane with a 4D Noise Texture, Vector `(cos 2πu, sin 2πu, cos 2πv)·r`, W `sin 2πv·r` (a 4D torus tiles in u and v); `Standard` view, saved Non-Color.

### 6.3 Flipbook or procedural

Keep effects procedural (ShaderMaterial/TSL) when they are parametric and gameplay-driven (team colour, direction, length, charge), geometric (rings, beams, trails, dissolves, shields) or must be resolution-independent. Bake flipbooks only for organic, expensive motion (smoke, fire, explosions, fluids, sims). Budget: a 4×4 atlas of 256 px cells is 1024² RGBA ≈ 4 MB on the GPU (5.3 MB with mips) unless KTX2-compressed. Static tileable textures + procedural animation cover most brawler hits.

---

## 7. Verification loop without a GUI

### 7.1 The loop

1. **Build**: `python -I <your_build>.py <scratch>/out`; read the `CHECK` lines (`nan: 0`, `max_foot_slide_m` ≤ 0.01) and the `dropped` list.
2. **Inspect**: `python3 inspect_glb.py out/x.glb --quat-flips`: clip names and durations vs the design table, `ggg_events` inside each duration, 19 joints named like `BONES`, 57 channels per clip, no surprise `extensionsUsed`.
3. **Validate**: gltf-validator, 0 errors.
4. **Look**: `python -I render_sheet.py out/x.blend Attack 9 out/attack.png` (and `--onion`); Read the PNGs.
5. **In GGG**: convert (§5.2), run `tools/anim_report.ts` and `capture.mjs` filmstrips; compare with the baseline.

### 7.2 `render_sheet.py`

- `[file.blend] CLIP N OUT.png [--onion]`: `CLIP` must exist in `bpy.data.actions`; `N` frames spread over `action.frame_range`, evaluated alone via `preview_clip`.
- Orthographic 3/4 front camera (front = −Y) framed on all sampled bone positions × 1.25; a sun light if none; a red `CLIP fF t.tts` label parented to the camera (hidden with `--onion`).
- Workbench (studio light, object colour, outline, 8× AA) when libEGL loads, else Cycles CPU 8 samples, world colour 0.8 (this container).
- Grid sheet top-left first on 0.12 grey; `--onion` composites all frames in one cell, cyan (old) → magenta (new), rising opacity. Per-frame PNGs stay in `<dir of OUT>/_frames/`; `scripts/contact_sheet.py` can re-sheet them (it labels t = frame/60).

### 7.3 `check_clip` and `inspect_glb.py`

- `G.check_clip`: NaN keys, curve count, planted-foot slide. Add bone-length constancy (`(pb.tail − pb.head).length`), events inside the duration, quaternion-flip count, and a Node three.js load (`new GLTFLoader().parse(arrayBuffer, '', onLoad)` works without a browser).
- `inspect_glb.py` prints per animation `channels`, `interp` histogram, distinct `keycounts`, `duration`, `extras`; the joint list; rest TRS + angle for `hips spine thighL shinL footL upperArmL upperArmR`. `--quat-flips` counts sign flips per rotation channel (2 per thigh in the Walk: harmless for slerp and `Pose` blends; run `fixQuaternionFlips` before custom blending or compression). It reads float/short/byte accessors only: run it on the **pre-gltfpack** file.

### 7.4 Headless facts

- **CLI** [S6]: `blender -b file.blend --factory-startup --python-exit-code 1 -P script.py -- args`. Arguments run **in order**: `-o/-F/-E` after the `.blend` (loading resets them) and before `-f/-a`; without `--python-exit-code 1` failing scripts exit 0.
- **GPU**: Workbench and EEVEE need EGL/GLX; a missing `libEGL.so.1` **aborts** (SIGABRT, exit 134, no Python exception), so probe with `ctypes.CDLL`. `apt-get install libegl1 libegl-mesa0` makes Workbench usable at 1–3 s per frame [S24]; software EEVEE spends 45–60 s compiling the first frame; Cycles CPU needs nothing (< 1 s per 128–256 px frame at 8–16 samples).
- **Defaults to override**: AgX → `Standard`; 24 fps → 60.
- **Determinism**: cloth matched bit for bit on 4.2 and 5.2; still pin the version per asset and store `bpy.app.version_string` in extras. The bpy 4.4.0 wheel needs `numpy<2`; 5.2.2 runs with numpy 2.5.

---

## 8. Unity export notes

Unity's manual was unreachable; these notes come from exporter options and package READMEs.
- **FBX** (`export_scene.fbx`, defaults checked on 5.2): `apply_scale_options='FBX_SCALE_UNITS'`; `axis_forward='-Z'`, `axis_up='Y'`; `use_armature_deform_only=True`; `add_leaf_bones=False` (default adds `_end` bones); `bake_anim_use_all_actions=False` (default exports every action) with `bake_anim_use_nla_strips=True`; `bake_anim_force_startend_keying=True`; `bake_anim_simplify_factor=0.0` (default 1.0 is lossy); `primary_bone_axis='Y'`, `secondary_bone_axis='X'`.
- **glTF**: glTFast plays clips only through the legacy Animation component and supports Draco/meshopt [S19]; UnityGLTF imports Legacy, Mecanim or **Humanoid** clips and supports `KHR_animation_pointer` [S18]; glTFast wins when both are installed.
- **Humanoid**: required bones = VRM's set (hips, spine, head; upper/lower arm, hand, upper/lower leg, foot per side; chest, neck, shoulders optional) [S20]. GGG's 19 bones map 1:1 and the bind is a T-pose. Muscle space approximates twists and extra bones: use **Generic** for exact playback.
- **Root motion and compression**: locomotion on hips, "Bake Into Pose" per axis, Animator "Apply Root Motion"; keyframe-reduction compression **Off** for hit-frame-critical attacks.

---

## Pitfalls

Seen in the tests or read in the source:
1. **Slots (4.4+)**: `adt.action = act` without a slot animates nothing; unslotted NLA strips are **silently skipped** on export → `assign_action`, `push_to_nla`.
2. **`Action.fcurves` is gone in 5.x** (a first-slot proxy in 4.4/4.5) → `ensure_fcurve`, `action_fcurves`.
3. **`keyframe_insert()` keys into the assigned action** (the test once polluted `Attack`): clear or assign first.
4. **`export_anim_single_armature=True`** (default) exports every bone action in `bpy.data`: set False, delete scratch actions, `use_fake_user` on real ones.
5. **NLA (ACTIONS mode)**: one unmuted strip per track; `track.mute` ignored; active + on a track = exported twice.
6. **Sampled export evaluates constraints**: bake and clear them (`bake_to_fk`).
7. **Non-sampled export omits unkeyed bones** → pose leakage. Keep sampling.
8. **A CONSTANT first key makes the whole channel STEP**; non-native easings force a bake.
9. **Quaternion sign flips** on bones ≈ 180° from their parent: fix before custom blending, compression or additive math.
10. **`rotation_difference().angle` ≈ 2π** for near-equal rotations: use `min(a, 2π − a)`.
11. **Loop seams**: the closing key equals the first, inside `frame_range`; CYCLES only loops Blender's preview.
12. **fps**: default 24; a mismatch rescales clips and events; GGG wants 60.
13. **Names**: three.js strips `. : / [ ]`, spaces → `_`, duplicates → `_1`.
14. **Roll defines joint frames**: fix one rule, calibrate poles against the rest pose.
15. **Armature transform**: skinned meshes ignore parents; keep it at identity, scale applied.
16. **`export_apply=True` drops shape keys and morph animation** (fine for bl_kit's static models only).
17. **`bpy.ops.nla.bake`** needs selection context and its selection API changed in 5.x → `anim_utils.bake_action_objects`.
18. **EEVEE id** `BLENDER_EEVEE_NEXT` (4.2–4.5) vs `BLENDER_EEVEE` (5.x); the wrong one raises.
19. **No EGL → SIGABRT (134)** for Workbench/EEVEE: probe and fall back to Cycles.
20. **AgX** shifts colours: `Standard` for VFX, Non-Color for data, emission ≤ 1.
21. **Straight-alpha PNGs** fringe dark: premultiply or dilate.
22. **gltfpack drops extras** (even `-ke`) and constant tracks (unless `-ac`), resamples and quantises; glTF-Transform keeps extras.
23. **The wheel has no Draco/meshopt bridges**: compress in post.
24. **Sims must be baked or stepped in order**; Armature before Cloth; Damped Track doesn't stretch.
25. **No `--help`** in the scripts: it becomes an output folder named `--help`.
26. **CLI order**: `-o/-F` before the `.blend` are reset by loading it; use `--python-exit-code 1` in CI.

---

## Sources

Read in full or in the relevant sections; exporter internals from the copies bundled in the bpy 4.2.23 and 5.2.2 wheels (matching glTF-Blender-IO `main`).

- [S1] glTF-Blender-IO `docs/blender_docs/scene_gltf2.rst` and `addons/io_scene_gltf2/__init__.py` (github.com/KhronosGroup/glTF-Blender-IO).
- [S2] glTF-Blender-IO `blender/exp/animation/action.py`, `sampled/armature/sampler.py`, `blender/com/conversion.py`, `blender/com/extras.py`.
- [S3] Blender `scripts/modules/bpy_extras/anim_utils.py`.
- [S4] Blender `scripts/startup/bl_operators/anim.py` (`NLA_OT_bake`).
- [S5] Blender `tests/python/bl_animation_action.py`.
- [S6] Blender `source/creator/creator_args.cc`.
- [S7] PyPI `bpy` 4.2.23 / 4.4.0 / 4.5.14 / 5.2.2 wheels (RNA introspection, test runs).
- [S8] Khronos glTF 2.0 specification.
- [S9] Khronos glTF Tutorial 007, Animations.
- [S10] Khronos glTF-Validator README.
- [S11] `EXT_meshopt_compression` spec.
- [S12] Blender 4.4 manual (Actions) and API (`ActionChannelBags`, `ActionFCurves`), search summaries only.
- [S13] three.js `src/animation/` (`AnimationAction`, `AnimationMixer`, `AnimationUtils`, `AnimationClip`, `PropertyBinding`).
- [S14] three.js `examples/jsm/loaders/GLTFLoader.js` (`assignExtrasToUserData`).
- [S15] three.js `SkeletonUtils.js`; examples `webgl_animation_skinning_blending`, `_additive_blending`.
- [S16] meshoptimizer `gltf/README.md` (gltfpack).
- [S17] glTF-Transform README.
- [S18] UnityGLTF README.
- [S19] Unity glTFast `Documentation~/features.md`.
- [S20] VRM 1.0 humanoid specification.
- [S21] Wiggle 2 README.
- [S22] OpenVAT README; Unreal Tools `vertex_animation.py`.
- [S23] Mixamo Converter README.
- [S24] Ubuntu `libegl1` / `libegl-mesa0` packages (headless EGL test).

GGG files read: `tools/blender/bl_kit.py`, `tools/blender/README.md`, `src/champions/glbModels.ts`, `src/fighter/Animator.ts`, `src/fighter/Rig.ts`.
