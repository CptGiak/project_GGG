"""
ggg_anim.py - headless bpy helpers for game animation (Blender 4.2 LTS .. 5.x).

Library: import it from a script next to it, e.g.
  blender -b --factory-startup -P build_clips.py -- OUT_DIR
  python -I build_clips.py OUT_DIR                     (PyPI `bpy` wheel, same API)

Version map this file handles:
  4.2/4.3 : legacy actions  -> Action.fcurves / Action.groups
  4.4/4.5 : slotted actions -> Action.slots/layers/strips/channelbags; Action.fcurves is a
            *legacy proxy of the first slot* (still works, but don't rely on it)
  5.0+    : Action.fcurves/groups/id_root REMOVED; channelbag API only;
            EEVEE id 'BLENDER_EEVEE' (was 'BLENDER_EEVEE_NEXT' in 4.2-4.5);
            bone selection lives on PoseBone.select (was Bone.select)
"""
from __future__ import annotations

import json
import math

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

BL = bpy.app.version
SLOTTED = BL >= (4, 4, 0)


# ----------------------------------------------------------------------------------------------
# version shims
# ----------------------------------------------------------------------------------------------
def eevee_id() -> str:
    return 'BLENDER_EEVEE' if BL >= (5, 0, 0) else 'BLENDER_EEVEE_NEXT'


def select_pose_bone(pb, state: bool = True) -> None:
    if hasattr(pb, 'select'):          # 5.0+
        pb.select = state
    else:                              # <= 4.5
        pb.bone.select = state


def assign_action(owner, action):
    """Assign `action` to an ID (Object, or mesh.shape_keys) and bind a slot on 4.4+."""
    ad = owner.animation_data or owner.animation_data_create()
    ad.action = action
    if SLOTTED and ad.action_slot is None:
        slot = next((s for s in action.slots
                     if s.target_id_type in ('UNSPECIFIED', owner.id_type)), None)
        if slot is None:
            slot = action.slots.new(owner.id_type, owner.name)
        ad.action_slot = slot
    return ad


def _channelbag(action, slot):
    """Cross-version 'ensure channelbag' (anim_utils only exposes a public one from 5.0)."""
    layer = action.layers[0] if len(action.layers) else action.layers.new("Layer")
    strip = layer.strips[0] if len(layer.strips) else layer.strips.new(type='KEYFRAME')
    return strip.channelbag(slot, ensure=True)


def ensure_fcurve(action, owner, data_path: str, index: int = 0, group: str = ""):
    """Find-or-create an F-Curve of `action` for `owner` (action must be assigned to owner)."""
    if not SLOTTED:
        fc = action.fcurves.find(data_path, index=index)
        return fc or action.fcurves.new(data_path, index=index, action_group=group)
    ad = owner.animation_data
    if ad is None or ad.action != action or ad.action_slot is None:
        raise RuntimeError("call assign_action(owner, action) first")
    cb = _channelbag(action, ad.action_slot)
    fc = cb.fcurves.find(data_path, index=index)
    if fc is None:
        fc = cb.fcurves.new(data_path, index=index)       # no group_name kwarg before 5.0
        if group:
            fc.group = cb.groups.get(group) or cb.groups.new(group)
    return fc


def action_fcurves(action):
    """All F-Curves of an action, every slot (read-only use)."""
    if not SLOTTED:
        return list(action.fcurves)
    return [fc for layer in action.layers for strip in layer.strips
            for cb in strip.channelbags for fc in cb.fcurves]


# ----------------------------------------------------------------------------------------------
# armature
# ----------------------------------------------------------------------------------------------
def build_armature(name: str, bones: list[dict], roll_ref=(0.0, -1.0, 0.0)):
    """bones: [{name, head, tail, parent=None, deform=True, roll_ref=None}] in armature space.
    Roll rule: bone local Z is aligned to `roll_ref` (default -Y = character front), falling back
    to +Z when the bone is (nearly) parallel to it -> same local axes on every build."""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    ebs = {}
    for b in bones:
        eb = arm.edit_bones.new(b['name'])
        eb.head, eb.tail = Vector(b['head']), Vector(b['tail'])
        eb.use_deform = b.get('deform', True)
        eb.use_connect = False
        ref = Vector(b.get('roll_ref') or roll_ref)
        if abs((eb.tail - eb.head).normalized().dot(ref.normalized())) > 0.95:
            ref = Vector((0.0, 0.0, 1.0))
        eb.align_roll(ref)
        ebs[b['name']] = eb
    for b in bones:
        if b.get('parent'):
            ebs[b['name']].parent = ebs[b['parent']]
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in ob.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return ob


def rigid_box_mesh(arm_ob, name="Body", thickness=0.06, skip=()):
    """One box per deform bone, 100% weighted to it (hard-surface 'rigid' skinning)."""
    verts, faces, groups = [], [], []
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    for bone in arm_ob.data.bones:
        if not bone.use_deform or bone.name in skip:
            continue
        m = bone.matrix_local                       # armature space, Y along bone
        t = thickness * (0.6 if 'hand' in bone.name or 'foot' in bone.name else 1.0)
        base = len(verts)
        for x in (-t, t):
            for y in (0.0, bone.length):
                for z in (-t, t):
                    verts.append(m @ Vector((x, y, z)))
        faces += [tuple(base + i for i in q) for q in quads]
        groups.append((bone.name, list(range(base, base + 8))))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for bname, idx in groups:
        ob.vertex_groups.new(name=bname).add(idx, 1.0, 'REPLACE')
    ob.parent = arm_ob
    mod = ob.modifiers.new("Armature", 'ARMATURE')
    mod.object = arm_ob
    return ob


# ----------------------------------------------------------------------------------------------
# keyframing
# ----------------------------------------------------------------------------------------------
def key_clip(arm_ob, clip: str, keys: list[dict], fps: int = 30, start: int = 0,
             interp: str = 'BEZIER', easing: str = 'AUTO', loop: bool = False):
    """keys: [{'t': sec, 'rot': {bone: (w,x,y,z)}, 'eul': {bone: (x,y,z) deg, 'XYZ'},
               'loc': {bone: (x,y,z)}, 'interp': 'BACK', 'easing': 'EASE_OUT', 'back': 1.7}]
    Values are bone-LOCAL (rest-relative) = what pose_bone.rotation_* / location store.
    'interp'/'easing' of a key apply to the segment that STARTS at that key.
    loop=True: the last key closes the cycle (should equal the first); sets a manual frame
    range + use_cyclic, adds a Cycles modifier so Blender previews it as a loop."""
    act = bpy.data.actions.new(clip)
    act.use_fake_user = True                     # survive save/reload with 0 users
    assign_action(arm_ob, act)
    chans: dict[tuple, list] = {}
    prev_q: dict[str, Quaternion] = {}
    prev_e: dict[str, Euler] = {}

    def add(path, i, grp, f, v, k):
        chans.setdefault((path, i, grp), []).append(
            (f, v, k.get('interp', interp), k.get('easing', easing), k.get('back', 1.70158)))

    for k in sorted(keys, key=lambda k: k['t']):
        f = start + k['t'] * fps
        for bn, q in k.get('rot', {}).items():
            pb = arm_ob.pose.bones[bn]
            pb.rotation_mode = 'QUATERNION'
            q = Quaternion(q).normalized()
            if bn in prev_q:
                q.make_compatible(prev_q[bn])    # keep the same hemisphere (no 360-degree flips)
            prev_q[bn] = q
            for i in range(4):
                add(pb.path_from_id('rotation_quaternion'), i, bn, f, q[i], k)
        for bn, (xyz, order) in k.get('eul', {}).items():
            pb = arm_ob.pose.bones[bn]
            pb.rotation_mode = order
            e = Euler([math.radians(a) for a in xyz], order)
            if bn in prev_e:
                e.make_compatible(prev_e[bn])
            prev_e[bn] = e
            for i in range(3):
                add(pb.path_from_id('rotation_euler'), i, bn, f, e[i], k)
        for bn, v in k.get('loc', {}).items():
            pb = arm_ob.pose.bones[bn]
            for i in range(3):
                add(pb.path_from_id('location'), i, bn, f, v[i], k)

    for (path, i, grp), pts in chans.items():
        fc = ensure_fcurve(act, arm_ob, path, i, grp)
        fc.keyframe_points.add(len(pts))
        fc.keyframe_points.foreach_set('co', [c for p in pts for c in p[:2]])
        for kp, (_, _, ip, ez, back) in zip(fc.keyframe_points, pts):
            kp.interpolation = ip                # CONSTANT LINEAR BEZIER SINE ... BACK BOUNCE ELASTIC
            kp.easing = ez                       # AUTO EASE_IN EASE_OUT EASE_IN_OUT
            kp.back = back                       # overshoot for BACK
            kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
        if loop:
            fc.modifiers.new('CYCLES')
        fc.update()                              # sort + recalc handles
    end = start + max(k['t'] for k in keys) * fps
    act.use_frame_range = True                   # exporter uses action.frame_range
    act.frame_start, act.frame_end = start, end
    act.use_cyclic = loop
    return act


# ----------------------------------------------------------------------------------------------
# NLA + events
# ----------------------------------------------------------------------------------------------
def push_to_nla(owner, action, track_name: str | None = None):
    """One action per track (the glTF 'Actions' mode exports single-strip tracks only)."""
    ad = owner.animation_data or owner.animation_data_create()
    tr = ad.nla_tracks.new()
    tr.name = track_name or action.name
    st = tr.strips.new(action.name, int(action.frame_range[0]), action)
    if SLOTTED and st.action_slot is None:        # unslotted strips are skipped by the exporter
        st.action_slot = next(s for s in action.slots
                              if s.target_id_type in ('UNSPECIFIED', owner.id_type))
    st.extrapolation = 'NOTHING'                 # no HOLD bleeding into other tracks in Blender
    tr.mute = False
    if ad.action == action:
        ad.action = None                         # else exported twice ('Clip' + 'Clip-Slot')
    return tr, st


def preview_clip(owner, action, frame=None):
    """Evaluate exactly one clip (for renders/checks) regardless of NLA content."""
    ad = owner.animation_data or owner.animation_data_create()
    ad.use_nla = False
    assign_action(owner, action)
    if frame is not None:
        bpy.context.scene.frame_set(int(frame))


def end_preview(owner):
    ad = owner.animation_data
    ad.action = None
    ad.use_nla = True


def set_events(action, events: list[tuple[str, float]], fps: int):
    """events: [(name, seconds-from-clip-start)]. Writes pose markers (visible in the Action
    editor) AND a JSON-safe custom property that the glTF exporter writes to
    animations[i].extras (export_extras=True) -> three.js AnimationClip.userData."""
    start = action.frame_range[0]
    for m in list(action.pose_markers):
        action.pose_markers.remove(m)
    for name, t in events:
        m = action.pose_markers.new(name)
        m.frame = int(round(start + t * fps))
    action['ggg_events'] = [{'name': n, 'time': round(t, 4)} for n, t in sorted(events, key=lambda e: e[1])]
    action['ggg_fps'] = fps
    action['ggg_loop'] = int(action.use_cyclic)


# ----------------------------------------------------------------------------------------------
# constraints -> FK bake
# ----------------------------------------------------------------------------------------------
def bake_to_fk(arm_ob, frame_start: int, frame_end: int, name: str, clear_constraints=True):
    """Visual-keys every pose bone per frame (IK/Child-Of/Damped-Track results) into a new
    action; optionally deletes the constraints so the export samples plain FK."""
    from bpy_extras import anim_utils
    opts = anim_utils.BakeOptions(
        only_selected=False, do_pose=True, do_object=False, do_visual_keying=True,
        do_constraint_clear=clear_constraints, do_parents_clear=False, do_clean=False,
        do_location=True, do_rotation=True, do_scale=False, do_bbone=False,
        do_custom_props=False)
    (act,) = anim_utils.bake_action_objects(
        [(arm_ob, None)], frames=range(frame_start, frame_end + 1), bake_options=opts)
    act.name = name
    act.use_fake_user = True
    act.use_frame_range = True
    act.frame_start, act.frame_end = frame_start, frame_end
    return act


# ----------------------------------------------------------------------------------------------
# export
# ----------------------------------------------------------------------------------------------
def export_glb(path: str, objects, **overrides):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    kw = dict(
        filepath=path, export_format='GLB', use_selection=True,
        export_yup=True, export_apply=False,          # export_apply=True drops shape keys
        export_animations=True, export_animation_mode='ACTIONS',
        export_anim_single_armature=False,            # True = every bone action in bpy.data!
        export_merge_animation='ACTION',              # 4.4+ only (filtered below)
        export_force_sampling=True, export_frame_step=1,
        export_sampling_interpolation_fallback='LINEAR',
        export_anim_slide_to_zero=True, export_negative_frame='SLIDE',
        export_reset_pose_bones=True, export_bake_animation=False,
        export_def_bones=True,                        # drop IK targets/poles/MCH bones
        export_rest_position_armature=True, export_current_frame=False,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=True,
        export_skins=True, export_influence_nb=4,
        export_morph=True, export_morph_animation=True,
        export_extras=True,                           # Action custom props -> animation.extras
        export_cameras=False, export_lights=False,
    )
    kw.update(overrides)
    known = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    dropped = sorted(k for k in kw if k not in known)
    bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in known})
    return dropped


# ----------------------------------------------------------------------------------------------
# checks
# ----------------------------------------------------------------------------------------------
def check_clip(arm_ob, action, fps, foot_bones=('footL', 'footR'), contact_margin=0.01):
    """Returns dict: frames, curve count, NaN count, max per-frame XY slide of a foot that stays
    within `contact_margin` of its rest (ankle) height on two consecutive frames (= planted)."""
    nan = sum(1 for fc in action_fcurves(action) for kp in fc.keyframe_points
              if not math.isfinite(kp.co[1]))
    f0, f1 = (int(round(x)) for x in action.frame_range)
    preview_clip(arm_ob, action)
    ground = {fb: (arm_ob.matrix_world @ arm_ob.data.bones[fb].head_local).z + contact_margin
              for fb in foot_bones}
    prev, slide, planted = {}, 0.0, 0
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        for fb in foot_bones:
            p = arm_ob.matrix_world @ arm_ob.pose.bones[fb].head
            if p.z < ground[fb] and fb in prev and prev[fb].z < ground[fb]:
                slide = max(slide, (p.xy - prev[fb].xy).length)
                planted += 1
            prev[fb] = p.copy()
    end_preview(arm_ob)
    return {'clip': action.name, 'frames': (f0, f1), 'seconds': (f1 - f0) / fps,
            'curves': len(action_fcurves(action)), 'nan': nan, 'planted_samples': planted, 'max_foot_slide_m': round(slide, 4)}
