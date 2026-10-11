"""
Worked example, stage 3: rig + an idle with personality for "Zugzwang".

The beat (4 s at 30 fps, loops): he shifts his weight onto the left leg and looks down at his
chess case, an anticipation dip, then the right hand rises in an arc to stroke his beard (two
strokes while the head nods: thinking), a quick "aha" lift of the head with a lean back, and the
hand settles back with a little overshoot. Breathing runs underneath; beard and scarf tails
follow through on springs.

Run:  /root/blender-venv/bin/python chess_master_anim.py --blend <zugzwang.blend> --out <dir>
"""
from __future__ import annotations

import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

import chess_master_body as B  # noqa: E402
from charkit import sdf as S  # noqa: E402

FPS = 30
END = 120


def P(name):
    return B.j(name)


def head_point(local):
    """Head-local point (eye line frame) -> world."""
    return np.array(B.HEAD_T, np.float32) + B.HEAD_R @ (np.array(local, np.float32) * B.HEAD_S)


def hand_frame(side: float):
    """Same frame as chess_master_body.hands() (left), mirrored for the right side."""
    w = P('wrist_L')
    fwd = w - P('elbow_L')
    fwd /= np.linalg.norm(fwd)
    z = -fwd
    yv = np.array([-1.0, 0.0, 0.0], np.float32)
    yv = yv - z * float(yv @ z)
    yv /= np.linalg.norm(yv)
    x = np.cross(yv, z)
    R = np.stack([x, yv, z], axis=1).astype(np.float32)
    M = np.diag([side, 1, 1]).astype(np.float32)
    return (M @ w), (M @ R)


def hand_point(side, local):
    t, R = hand_frame(side)
    return t + R @ (np.array(local, np.float32) * 1.28)


def bone_table():
    T = []
    T.append(('root', (0, 0, 0), (0, 0.15, 0), None, False))
    T.append(('hips', P('hips'), P('spine'), 'root'))
    T.append(('spine', P('spine'), P('chest'), 'hips'))
    T.append(('chest', P('chest'), P('neck'), 'spine'))
    T.append(('neck', P('neck'), P('head'), 'chest'))
    T.append(('head', P('head'), P('head') + np.array([0, -0.02, 0.22], np.float32), 'neck'))
    for s, sx in (('L', 1.0), ('R', -1.0)):
        M = np.diag([sx, 1, 1]).astype(np.float32)
        sh, el, wr = P('shoulder_' + s), P('elbow_' + s), P('wrist_' + s)
        T.append((f'clavicle_{s}', M @ np.array([0.03, -0.01, 1.3], np.float32), sh, 'chest'))
        T.append((f'upper_arm_{s}', sh, el, f'clavicle_{s}'))
        T.append((f'forearm_{s}', el, wr, f'upper_arm_{s}'))
        T.append((f'hand_{s}', wr, hand_point(sx, (0, 0, -0.098)), f'forearm_{s}'))
        T.append((f'fingers1_{s}', hand_point(sx, (0, 0, -0.098)), hand_point(sx, (0, -0.012, -0.136)), f'hand_{s}'))
        T.append((f'fingers2_{s}', hand_point(sx, (0, -0.012, -0.136)), hand_point(sx, (0, -0.035, -0.166)), f'fingers1_{s}'))
        T.append((f'thumb_{s}', hand_point(sx, (-0.04, 0.01, -0.03)), hand_point(sx, (-0.066, -0.032, -0.08)), f'hand_{s}'))
        th, kn, an = P('thigh_' + s), P('knee_' + s), P('ankle_' + s)
        T.append((f'thigh_{s}', th, kn, 'hips'))
        T.append((f'shin_{s}', kn, an, f'thigh_{s}'))
        T.append((f'foot_{s}', an, an + np.array([0.004 * sx, -0.11, -0.06], np.float32), f'shin_{s}'))
        T.append((f'toe_{s}', an + np.array([0.004 * sx, -0.11, -0.06], np.float32), an + np.array([0.006 * sx, -0.19, -0.065], np.float32), f'foot_{s}'))
    # beard chain (follow-through), from the chin down to the tip
    b0, b1, b2 = head_point((0, -0.08, -0.115)), head_point((0, -0.088, -0.19)), head_point((0, -0.075, -0.265))
    T.append(('beard_1', b0, b1, 'head'))
    T.append(('beard_2', b1, b2, 'beard_1'))
    # scarf tails
    tails = [[(0.04, -0.09, 1.33), (0.06, -0.13, 1.24), (0.07, -0.155, 1.1), (0.075, -0.165, 0.95)],
             [(0.02, -0.08, 1.32), (-0.005, -0.13, 1.22), (-0.03, -0.17, 1.1), (-0.04, -0.18, 1.0)]]
    for ti, pts in enumerate(tails):
        par = 'chest'
        for k in range(3):
            nm = f'scarf{ti + 1}_{k + 1}'
            T.append((nm, pts[k], pts[k + 1], par))
            par = nm
    # prop: the chess case rides on the left hand
    t, R = B.case_transform()
    T.append(('case', t, t + np.array([0, 0, 0.1], np.float32), 'hand_L', False))
    return T


# =============================================================================================
# Weights per part
# =============================================================================================

def weight_parts(arm, objs):
    from charkit import rig as RG
    from charkit import studio as ST

    segs = RG.bone_segments(arm)
    head_parts = {'skin', 'eyes', 'beard', 'moustache', 'brows', 'side_hair', 'cap', 'glasses_frame', 'glasses_lens'}
    case_parts = {'case_wood', 'case_light', 'case_dark', 'case_brass'}
    for ob in objs:
        v, _ = ST.mesh_arrays(ob)
        name = ob.name
        if name in case_parts:
            RG.rigid(ob, 'case')
        elif name in head_parts:
            if name == 'skin':
                names, W = RG.segment_weights(v, segs, ['head', 'neck', 'chest'], sigma=0.03, bias={'head': 0.06})
            elif name in ('beard', 'moustache'):
                names, W = RG.segment_weights(v, segs, ['head', 'beard_1', 'beard_2'], sigma=0.035, bias={'head': 0.035})
            else:
                names, W = ['head'], np.ones((len(v), 1), np.float32)
            RG.set_weights(ob, names, W)
        elif name == 'hands':
            Wt = []
            allowed = ['forearm_L', 'hand_L', 'fingers1_L', 'fingers2_L', 'thumb_L', 'forearm_R', 'hand_R', 'fingers1_R', 'fingers2_R', 'thumb_R']
            names, W = RG.segment_weights(v, segs, allowed, sigma=0.012, bias={'hand_L': 0.012, 'hand_R': 0.012})
            RG.set_weights(ob, names, W)
        elif name in ('coat', 'buttons', 'pocket', 'patches', 'halfbelt', 'pieces_ivory', 'pieces_ebony'):
            # regions from the very shapes the coat was built from: a vertex belongs to the sleeve
            # if it is closer to the sleeve volume than to the torso volume (soft over 3 cm). This
            # keeps arm bones off the chest and side seams (no torn armpits when the arm lifts).
            d_sl = B.sleeves_shape()(v)
            d_to = S.grow(B.torso_volume(), 0.022)(v)
            t_sl = np.clip((d_to - d_sl + 0.012) / 0.03, 0, 1)
            arm_bones = ['clavicle_L', 'upper_arm_L', 'forearm_L', 'clavicle_R', 'upper_arm_R', 'forearm_R']
            body_bones = ['hips', 'spine', 'chest', 'neck', 'clavicle_L', 'clavicle_R']
            n_a, W_a = RG.segment_weights(v, segs, arm_bones, sigma=0.03)
            n_b, W_b = RG.segment_weights(v, segs, body_bones, sigma=0.04, bias={'chest': 0.02})
            n_s, W_s = RG.segment_weights(v, segs, ['hips', 'thigh_L', 'thigh_R', 'spine'], sigma=0.08, bias={'hips': 0.1})
            names = sorted(set(n_a) | set(n_b) | set(n_s))
            W = np.zeros((len(v), len(names)), np.float32)
            skirt = np.clip((0.9 - v[:, 2]) / 0.12, 0, 1) * (1 - t_sl)
            for nn, WW, f_ in ((n_a, W_a, t_sl), (n_b, W_b, (1 - t_sl) * (1 - skirt)), (n_s, W_s, skirt)):
                for i, n in enumerate(nn):
                    W[:, names.index(n)] += WW[:, i] * f_
            W /= np.maximum(W.sum(axis=1, keepdims=True), 1e-6)
            RG.set_weights(ob, names, W)
        elif name == 'scarf':
            allowed = ['neck', 'chest'] + [f'scarf{t}_{k}' for t in (1, 2) for k in (1, 2, 3)]
            names, W = RG.segment_weights(v, segs, allowed, sigma=0.025, bias={'neck': 0.03})
            RG.set_weights(ob, names, W)
        elif name == 'trousers':
            names, W = RG.segment_weights(v, segs, ['hips', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R'], sigma=0.03, bias={'hips': 0.02})
            RG.set_weights(ob, names, W)
        elif name in ('shoes', 'soles'):
            names, W = RG.segment_weights(v, segs, ['foot_L', 'toe_L', 'foot_R', 'toe_R', 'shin_L', 'shin_R'], sigma=0.02, bias={'foot_L': 0.02, 'foot_R': 0.02})
            RG.set_weights(ob, names, W)
        else:
            continue
        RG.bind(ob, arm)


# =============================================================================================
# Animation
# =============================================================================================

def animate(arm):
    from charkit import rig as RG
    import bpy

    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 0, END - 1
    beard_tip = head_point((0.0, -0.092, -0.16))
    chin = head_point((0.0, -0.1, -0.105))

    def base(weight: float = 0.0, look_down: float = 0.0, breathe: float = 0.0):
        """Neutral stance with a weight shift towards the left leg (weight in 0..1)."""
        RG.reset_pose(arm)
        hips = arm.pose.bones['hips']
        hips.location = (0, 0, 0)
        # weight on the left leg: hips slide left and tilt, chest counter-tilts (contrapposto)
        RG.rotate_world(arm, 'hips', (0, 1, 0), -3.0 * weight)
        arm.pose.bones['hips'].location = arm.pose.bones['hips'].matrix.to_3x3().inverted() @ __import__('mathutils').Vector((0.018 * weight, 0, -0.004 * weight))
        RG.rotate_world(arm, 'chest', (0, 1, 0), 4.0 * weight)
        RG.rotate_world(arm, 'spine', (1, 0, 0), 2.0 + breathe * 1.2)
        RG.rotate_world(arm, 'chest', (1, 0, 0), -breathe * 1.8)
        RG.rotate_world(arm, 'neck', (1, 0, 0), 4.0 * look_down)
        RG.rotate_world(arm, 'head', (1, 0, 0), 9.0 * look_down)
        RG.rotate_world(arm, 'head', (0, 0, 1), 8.0 * look_down)
        # legs: keep feet planted (knee IK back to the ankles)
        for s, sx in (('L', 1), ('R', -1)):
            RG.two_bone_ik(arm, f'thigh_{s}', f'shin_{s}', P('ankle_' + s), P('knee_' + s) + np.array([0, -0.4, 0], np.float32))
        # relaxed arms (the model is in a wide A-pose for clean skinning): bring them down,
        # left hand holds the case
        RG.rotate_world(arm, 'upper_arm_L', (0, 1, 0), 21)
        RG.rotate_world(arm, 'upper_arm_R', (0, 1, 0), -21)
        RG.rotate_world(arm, 'forearm_L', (0, 1, 0), 8)
        RG.rotate_world(arm, 'forearm_R', (0, 1, 0), -8)
        RG.rotate_world(arm, 'upper_arm_L', (1, 0, 0), -4)
        RG.rotate_world(arm, 'forearm_L', (1, 0, 0), -10)
        RG.rotate_world(arm, 'upper_arm_R', (0, 1, 0), -6)
        RG.rotate_world(arm, 'forearm_R', (1, 0, 0), -14)
        RG.rotate_world(arm, 'fingers1_L', (1, 0, 0), -25)
        RG.rotate_world(arm, 'fingers2_L', (1, 0, 0), -30)

    def right_hand_to(target, pole=(-0.5, 0.25, -0.2), curl=0.0, palm_twist=0.0, touch=None):
        """target = wrist position; touch = point the fingers reach for (hand aims at it)."""
        sh = RG.head_world(arm, 'upper_arm_R')
        RG.two_bone_ik(arm, 'upper_arm_R', 'forearm_R', target, np.array(sh) + np.array(pole, np.float32))
        if touch is not None:
            RG.aim(arm, 'hand_R', touch)
        if palm_twist:
            RG.rotate_world(arm, 'hand_R', RG.tail_world(arm, 'forearm_R') - RG.head_world(arm, 'forearm_R'), palm_twist)
        RG.rotate_world(arm, 'fingers1_R', (1, 0, 0), -25 - 30 * curl)
        RG.rotate_world(arm, 'fingers2_R', (1, 0, 0), -20 - 40 * curl)

    keys = []

    def K(frame, kind='smooth'):
        RG.key(arm, frame)
        keys.append((frame, kind))

    # 0: neutral
    base(0.0, 0.0, 0.0)
    rest_hand = np.array(RG.tail_world(arm, 'forearm_R'))
    K(0)
    # 18: weight onto the left leg, look down at the case
    base(1.0, 1.0, 0.6)
    K(18)
    # 30: anticipation: right shoulder dips, hand drops a touch behind before the lift
    base(1.0, 0.8, 1.0)
    RG.rotate_world(arm, 'clavicle_R', (0, 1, 0), -4)
    right_hand_to(rest_hand + np.array([0.01, 0.03, -0.03], np.float32), curl=0.2)
    K(30, 'windup')
    # 44: hand arrives at the chin (arc: out to the side and up, palm in)
    base(1.0, 0.5, 0.4)
    right_hand_to(chin + np.array([-0.05, -0.07, -0.13], np.float32), pole=(-0.6, 0.35, -0.35), curl=0.45, touch=chin + np.array([-0.01, -0.02, 0], np.float32))
    RG.rotate_world(arm, 'head', (1, 0, 0), -4)
    K(44, 'snap')
    # 56 / 70 / 84: two strokes down the beard while the head nods
    base(1.0, 0.65, 0.0)
    right_hand_to(beard_tip + np.array([-0.04, -0.075, -0.13], np.float32), pole=(-0.6, 0.35, -0.35), curl=0.7, touch=beard_tip + np.array([0, -0.025, 0], np.float32))
    K(56)
    base(1.0, 0.45, 0.6)
    right_hand_to(chin + np.array([-0.05, -0.075, -0.14], np.float32), pole=(-0.6, 0.35, -0.35), curl=0.45, touch=chin + np.array([-0.01, -0.02, 0], np.float32))
    K(68)
    base(1.0, 0.7, 1.0)
    right_hand_to(beard_tip + np.array([-0.04, -0.08, -0.15], np.float32), pole=(-0.6, 0.35, -0.35), curl=0.75, touch=beard_tip + np.array([0, -0.025, -0.02], np.float32))
    K(80)
    # 90: "aha": head snaps up, lean back, hand leaves the beard
    base(0.6, -0.6, 0.2)
    RG.rotate_world(arm, 'spine', (1, 0, 0), -3)
    right_hand_to(chin + np.array([-0.12, -0.16, -0.17], np.float32), pole=(-0.6, 0.35, -0.35), curl=0.3, touch=chin + np.array([-0.1, -0.3, 0.05], np.float32))
    K(90, 'snap')
    # 104: hand settles down (overshoot), weight returns
    base(0.2, 0.1, 0.5)
    right_hand_to(rest_hand + np.array([0.0, -0.01, 0.01], np.float32), curl=0.1)
    K(104, 'settle')
    # 119: back to neutral for the loop
    base(0.0, 0.0, 0.0)
    K(END - 1)
    for f, kind in keys:
        RG.ease(arm, f, kind)
    # follow-through: beard and scarf tails lag behind the body
    RG.bake_spring_chain(arm, ['beard_1', 'beard_2'], range(0, END), stiffness=0.22, damping=0.7)
    RG.bake_spring_chain(arm, ['scarf1_1', 'scarf1_2', 'scarf1_3'], range(0, END), stiffness=0.16, damping=0.75)
    RG.bake_spring_chain(arm, ['scarf2_1', 'scarf2_2', 'scarf2_3'], range(0, END), stiffness=0.15, damping=0.75)
    return [f for f, _ in keys]


def main():
    import bpy

    from charkit import rig as RG
    from charkit import studio as ST

    ap = argparse.ArgumentParser()
    ap.add_argument('--blend', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--decimate', type=float, default=0.35)
    ap.add_argument('--gif', action='store_true')
    ap.add_argument('--samples', type=int, default=24)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=a.blend)
    objs = [o for o in bpy.data.objects if o.type == 'MESH']
    for ob in objs:   # lighter meshes for rigging and frame renders
        if len(ob.data.polygons) > 60000:
            md = ob.modifiers.new('dec', 'DECIMATE')
            md.ratio = a.decimate
            bpy.context.view_layer.objects.active = ob
            with bpy.context.temp_override(object=ob, active_object=ob):
                bpy.ops.object.modifier_apply(modifier='dec')
    arm = RG.build_armature('ZugzwangRig', bone_table())
    weight_parts(arm, objs)
    keys = animate(arm)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.out, 'zugzwang_rigged.blend'))
    # key-pose sheet with the right-hand trail
    pts = RG.trail(arm, 'fingers1_R', range(0, END, 2))
    RG.trail_object('trail_hand_R', pts)
    box = (np.array([-0.45, -0.35, 0.0]), np.array([0.45, 0.3, 1.7]))
    ST.render_settings(560, 760, a.samples)
    ST.world()
    ST.light_rig([o for o in objs], key_az=-40)
    cam = ST.camera()
    ST.frame(cam, *box, az=-30, el=6, lens=55)
    paths = []
    for f in keys:
        bpy.context.scene.frame_set(f)
        paths.append(ST.render(os.path.join(a.out, f'pose_{f:03d}.png')))
    ST.sheet(paths, os.path.join(a.out, 'anim_keys_sheet.png'), labels=[f'f{f}' for f in keys], title='Zugzwang idle: key poses (orange = right-hand trail)', cell_h=560)
    if a.gif:
        for o in bpy.data.objects:
            if o.name.startswith('trail_hand_R'):
                o.hide_render = True
        ST.render_settings(360, 480, max(8, a.samples // 2))
        frames = []
        for f in range(0, END, 3):
            bpy.context.scene.frame_set(f)
            frames.append(ST.render(os.path.join(a.out, 'gif', f'f_{f:03d}.png')))
        ST.gif(frames, os.path.join(a.out, 'zugzwang_idle.gif'), fps=10)


if __name__ == '__main__':
    main()
