"""
Rigging and animation helpers for code-built characters.

  * armature from a joint table (one source of truth with the modelling landmarks)
  * skin weights from bone segments, restricted per part / region (dense SDF meshes are too big
    and too multi-part for bone-heat weights)
  * posing in WORLD axes (readable: "swing the upper arm 30 deg forward"), aim, analytic two-bone
    IK, keyframes with easing presets, spring follow-through baked into keys
  * motion trails of end effectors for arc review

Animation craft lives in the skill references; this module only makes it cheap to apply.
Axes: X = character's left, -Y = front, Z = up.
"""
from __future__ import annotations

import math
from typing import Callable, Iterable, Sequence

import bpy  # noqa: I001
import numpy as np
from mathutils import Matrix, Quaternion, Vector

V = Vector


# =============================================================================================
# Armature
# =============================================================================================

def build_armature(name: str, bones: Sequence[tuple], roll_up=(0, 0, 1)) -> bpy.types.Object:
    """bones: (name, head, tail, parent | None, deform: bool). Bones are not connected (free
    heads keep the joint table exact)."""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for b in bones:
        nm, h, t, par = b[0], b[1], b[2], b[3]
        e = arm.edit_bones.new(nm)
        e.head = V(h)
        e.tail = V(t)
        if (e.tail - e.head).length < 1e-4:
            e.tail = e.head + V((0, 0, 0.02))
        e.align_roll(V(roll_up) if abs((e.tail - e.head).normalized().dot(V(roll_up))) < 0.95 else V((0, -1, 0)))
        e.use_deform = b[4] if len(b) > 4 else True
        eb[nm] = e
    for b in bones:
        if b[3]:
            eb[b[0]].parent = eb[b[3]]
            eb[b[0]].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in ob.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return ob


def bone_segments(arm: bpy.types.Object, names: Iterable[str] | None = None) -> dict:
    out = {}
    for b in arm.data.bones:
        if names is None or b.name in names:
            out[b.name] = (np.array(arm.matrix_world @ b.head_local, np.float32), np.array(arm.matrix_world @ b.tail_local, np.float32))
    return out


def seg_distance(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(float(ab @ ab), 1e-12), 0, 1)
    return np.linalg.norm(p - (a + np.outer(t, ab)), axis=1)


def segment_weights(verts: np.ndarray, segs: dict, allowed: Sequence[str], sigma: float = 0.035,
                    bias: dict | None = None, max_inf: int = 4) -> tuple:
    """Soft nearest-bone weights: w_b = exp(-(d_b - d_min) / sigma) over `allowed` bones, top
    `max_inf`, normalised. sigma is the width of the blend at joints (2 cm crisp, 5 cm soft).
    bias: bone -> metres subtracted from its distance (grow a bone's territory)."""
    names = [n for n in allowed if n in segs]
    D = np.stack([seg_distance(verts, *segs[n]) - (bias or {}).get(n, 0.0) for n in names], axis=1)
    dmin = D.min(axis=1, keepdims=True)
    W = np.exp(-(D - dmin) / sigma)
    if len(names) > max_inf:
        idx = np.argsort(-W, axis=1)[:, max_inf:]
        np.put_along_axis(W, idx, 0.0, axis=1)
    W /= W.sum(axis=1, keepdims=True)
    return names, W.astype(np.float32)


def set_weights(ob: bpy.types.Object, names: Sequence[str], W: np.ndarray, threshold: float = 0.01) -> None:
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    for i, n in enumerate(names):
        col = W[:, i]
        idx = np.nonzero(col > threshold)[0]
        if not len(idx):
            continue
        vg = ob.vertex_groups.new(name=n)
        # group vertices by (rounded) weight to keep the number of API calls small
        q = np.round(col[idx] * 200).astype(int)
        for val in np.unique(q):
            sel = idx[q == val]
            vg.add(sel.tolist(), float(val) / 200.0, 'REPLACE')


def rigid(ob: bpy.types.Object, bone: str) -> None:
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')


def bind(ob: bpy.types.Object, arm: bpy.types.Object, preserve_volume: bool = True) -> None:
    md = ob.modifiers.new('Armature', 'ARMATURE')
    md.object = arm
    md.use_deform_preserve_volume = preserve_volume   # dual quaternions: no candy-wrapper elbows
    ob.parent = arm
    ob.matrix_parent_inverse = arm.matrix_world.inverted()


# =============================================================================================
# Posing (world-axis rotations, aim, two-bone IK)
# =============================================================================================

def _upd():
    bpy.context.view_layer.update()


def reset_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
        pb.location = (0, 0, 0)
    _upd()


def rotate_world(arm: bpy.types.Object, bone: str, axis, deg: float, pivot: str = 'head') -> None:
    """Rotates a pose bone about a WORLD axis through its head, on top of its current pose."""
    _upd()
    pb = arm.pose.bones[bone]
    Mw = arm.matrix_world
    head_w = Mw @ pb.head
    R = Matrix.Rotation(math.radians(deg), 4, V(axis).normalized())
    Mbone_w = Mw @ pb.matrix
    Mnew_w = Matrix.Translation(head_w) @ R @ Matrix.Translation(-head_w) @ Mbone_w
    pb.matrix = Mw.inverted() @ Mnew_w
    _upd()


def aim(arm: bpy.types.Object, bone: str, target_world, twist: float = 0.0) -> None:
    """Rotates the bone (about its head) so its tail points at target_world."""
    _upd()
    pb = arm.pose.bones[bone]
    Mw = arm.matrix_world
    h = Mw @ pb.head
    t = Mw @ pb.tail
    cur = (t - h).normalized()
    want = (V(target_world) - h).normalized()
    q = cur.rotation_difference(want)
    axis, ang = q.to_axis_angle()
    if ang > 1e-6:
        rotate_world(arm, bone, axis, math.degrees(ang))
    if twist:
        rotate_world(arm, bone, want, twist)


def two_bone_ik(arm: bpy.types.Object, upper: str, lower: str, target_world, pole_world) -> None:
    """Analytic two-bone IK: places the end of `lower` on target (or as close as the chain
    reaches), with the middle joint bending towards pole_world."""
    _upd()
    Mw = arm.matrix_world
    pu, pl = arm.pose.bones[upper], arm.pose.bones[lower]
    a = (Mw @ pu.tail - Mw @ pu.head).length
    b = (Mw @ pl.tail - Mw @ pl.head).length
    S_ = Mw @ pu.head
    T = V(target_world)
    d = T - S_
    L = min(max(d.length, abs(a - b) + 1e-4), a + b - 1e-4)
    dn = d.normalized()
    P = V(pole_world) - S_
    side = (P - dn * P.dot(dn))
    if side.length < 1e-6:
        side = dn.orthogonal()
    side.normalize()
    x = (a * a - b * b + L * L) / (2 * L)
    y = math.sqrt(max(a * a - x * x, 0.0))
    elbow = S_ + dn * x + side * y
    aim(arm, upper, elbow)
    aim(arm, lower, S_ + dn * L)


def tail_world(arm: bpy.types.Object, bone: str) -> Vector:
    _upd()
    return arm.matrix_world @ arm.pose.bones[bone].tail


def head_world(arm: bpy.types.Object, bone: str) -> Vector:
    _upd()
    return arm.matrix_world @ arm.pose.bones[bone].head


# =============================================================================================
# Keyframes and easing
# =============================================================================================

def key(arm: bpy.types.Object, frame: int, bones: Iterable[str] | None = None, loc: Sequence[str] = ('root', 'hips')) -> None:
    for pb in arm.pose.bones:
        if bones is not None and pb.name not in bones:
            continue
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        if pb.name in loc:
            pb.keyframe_insert('location', frame=frame)


def fcurves(arm: bpy.types.Object):
    from bpy_extras import anim_utils
    ad = arm.animation_data
    if ad is None or ad.action is None:
        return []
    cb = anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot)
    return list(cb.fcurves) if cb else []


EASES = {
    # name: (interpolation, easing)  -- applied to the segment that STARTS at the key
    'smooth': ('BEZIER', 'AUTO'),        # slow in / slow out (default)
    'snap': ('EXPO', 'EASE_OUT'),        # strike: explodes out of the key, settles into the next
    'windup': ('SINE', 'EASE_IN'),       # anticipation: accelerates into the next key
    'hold': ('CONSTANT', 'AUTO'),        # stepped (blocking pass)
    'linear': ('LINEAR', 'AUTO'),
    'settle': ('BACK', 'EASE_OUT'),      # overshoot and settle
}


def ease(arm: bpy.types.Object, frame: int, kind: str = 'smooth', bones: Iterable[str] | None = None) -> None:
    interp, easing = EASES[kind]
    for fc in fcurves(arm):
        if bones is not None:
            nm = fc.data_path.split('"')[1] if '"' in fc.data_path else ''
            if nm not in bones:
                continue
        for kp in fc.keyframe_points:
            if int(round(kp.co[0])) == frame:
                kp.interpolation = interp
                kp.easing = easing


def cycle(arm: bpy.types.Object) -> None:
    """Makes every curve loop seamlessly (idles, walk cycles)."""
    for fc in fcurves(arm):
        if not any(m.type == 'CYCLES' for m in fc.modifiers):
            fc.modifiers.new('CYCLES')


# =============================================================================================
# Follow-through: damped springs on chains (beard, scarf tails, coat tails, ponytails)
# =============================================================================================

def bake_spring_chain(arm: bpy.types.Object, chain: Sequence[str], frames: range, stiffness: float = 0.18,
                      damping: float = 0.72, gravity: float = 0.0, loops: int = 2) -> None:
    """Simulates each bone of `chain` as a damped spring that tries to keep its rest direction
    relative to its parent and keys the result: lag on the way in, overshoot on the way out.
    Runs the clip `loops` times so a cyclic clip starts from a settled state."""
    rest_dirs = {}
    reset_pose(arm)
    for nm in chain:
        pb = arm.pose.bones[nm]
        rest_dirs[nm] = (pb.bone.matrix_local.to_3x3().inverted() @ (pb.bone.tail_local - pb.bone.head_local)).normalized()
    state = {nm: None for nm in chain}
    vel = {nm: V((0, 0, 0)) for nm in chain}
    results = {}
    scene = bpy.context.scene
    for lp in range(loops):
        for f in frames:
            scene.frame_set(f)
            for nm in chain:
                pb = arm.pose.bones[nm]
                # where the bone would point if it simply followed its parent
                M = arm.matrix_world @ pb.matrix
                h = M.to_translation()
                follow = (M.to_3x3() @ rest_dirs[nm]).normalized()
                if state[nm] is None:
                    state[nm] = follow.copy()
                cur = state[nm]
                acc = (follow - cur) * stiffness + V((0, 0, -gravity))
                vel[nm] = vel[nm] * damping + acc
                cur = (cur + vel[nm]).normalized()
                state[nm] = cur
                if lp == loops - 1:
                    results.setdefault(nm, {})[f] = (follow.copy(), cur.copy())
    # key: rotate from the "follow" direction to the simulated one
    for f in frames:
        scene.frame_set(f)
        for nm in chain:
            follow, cur = results[nm][f]
            pb = arm.pose.bones[nm]
            q = follow.rotation_difference(cur)
            axis, ang = q.to_axis_angle()
            if ang > 1e-5:
                rotate_world(arm, nm, axis, math.degrees(ang))
            pb.keyframe_insert('rotation_quaternion', frame=f)


# =============================================================================================
# Review: motion trails and contact sheets
# =============================================================================================

def trail(arm: bpy.types.Object, bone: str, frames: range, use_tail: bool = True) -> np.ndarray:
    pts = []
    sc = bpy.context.scene
    for f in frames:
        sc.frame_set(f)
        pts.append(np.array(tail_world(arm, bone) if use_tail else head_world(arm, bone)))
    return np.array(pts, np.float32)


def trail_object(name: str, pts: np.ndarray, color=(1.0, 0.55, 0.1), radius: float = 0.004) -> bpy.types.Object:
    """A glowing tube along a trajectory (render it to judge arcs and spacing: dots close
    together = slow, far apart = fast)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
    cu.bevel_depth = radius
    cu.bevel_resolution = 2
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new(name + '_mat')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Emission Color'].default_value = (*color, 1)
    b.inputs['Emission Strength'].default_value = 3.0
    cu.materials.append(m)
    # spacing dots
    for i, p in enumerate(pts[::2]):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=radius * 2.2, location=tuple(p), segments=8, ring_count=6)
        d = bpy.context.active_object
        d.data.materials.append(m)
        d.name = f'{name}_dot{i}'
    return ob
