"""
Deformation check: renders the GLB rig in real game poses (dumped by dump_poses.ts from the
game's own animation + IK code) to verify the skin weights.

The game drives bones with model-space rotations relative to its arms-down rest; the GLB is
bound in T-pose. Each bone gets   delta = W_pose * W_tpose^-1   (game axes), converted to
Blender axes and applied on top of the bone's T-pose rest: the same retarget the game loader
does at runtime. Coat flaps are swung away from the legs here the way the runtime verlet
chains do it (legs push the flaps, the flaps never ride the thighs); fingers close on the grip.
"""
from __future__ import annotations

import json
import math
import os
import subprocess

import bpy
from mathutils import Matrix, Quaternion, Vector
from PIL import Image, ImageDraw, ImageFont

import bl_kit as K

V = Vector
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))  # game axes -> Blender axes
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def game_quat_matrix(q):
    return Quaternion((q[3], q[0], q[1], q[2])).to_matrix()


def tpose_world():
    W = {b: Matrix.Identity(3) for b in K.GAME_BONES}
    for s, sign in (('L', 1), ('R', -1)):
        for b in ('upperArm', 'foreArm', 'hand'):
            W[b + s] = Matrix.Rotation(math.radians(90 * sign), 3, 'Z')
    return W


def apply_game_pose(arm, pose: dict, chains: list):
    K.pose_reset(arm)
    WT = tpose_world()
    deltas = {}
    for name in K.GAME_BONES:
        bd = pose['bones'][name]
        Wg = game_quat_matrix(bd['q'])
        delta_b = C @ (Wg @ WT[name].inverted()) @ C.transposed()
        deltas[name] = delta_b
        pb = arm.pose.bones[name]
        rest = pb.bone.matrix_local
        head = K.g2b(bd['p'])
        R = delta_b.to_4x4()
        pb.matrix = Matrix.Translation(head) @ R @ Matrix.Translation(-rest.to_translation()) @ rest
        bpy.context.view_layer.update()
    # coat flaps: legs push them, they never follow the thighs
    hips_x = (deltas['hips'] @ V((1, 0, 0))).normalized()
    pitch = {}
    for s in 'LR':
        d = game_quat_matrix(pose['bones'][f'thigh{s}']['q']) @ V((0, -1, 0))
        pitch[s] = math.atan2(d.z, -d.y)  # >0 = leg swung forward
    for name, theta in chains:
        side = 'L' if 0 < theta < 180 else 'R'
        front = math.cos(math.radians(theta))
        p = pitch[side]
        if front > 0.3:
            a = 0.9 * max(0.0, p) + 0.25 * max(0.0, pitch['L' if side == 'R' else 'R'])
        elif front < -0.3:
            a = 0.75 * min(0.0, p)
        else:
            a = 0.45 * p
        pb = arm.pose.bones[f'{name}0']
        h = pb.head.copy()
        pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(-a, 4, hips_x) @ Matrix.Translation(-h) @ pb.matrix
        bpy.context.view_layer.update()
    # fingers: right hand grips the sword, left hand by the off-hand weight
    for s, sign, curl in (('R', -1, 1.0), ('L', 1, 0.25 + 0.75 * pose.get('off', 0.0))):
        ax = (deltas[f'hand{s}'] @ V((0, 1, 0))).normalized()
        arm_ax = (deltas[f'hand{s}'] @ V((sign, 0, 0))).normalized()
        for bn, ang, axis in ((f'fingers{s}', 60, ax), (f'fingertips{s}', 70, ax), (f'thumb{s}', 35, arm_ax)):
            pb = arm.pose.bones[bn]
            bpy.context.view_layer.update()
            h = pb.head.copy()
            pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(ang * curl * sign), 4, axis) @ Matrix.Translation(-h) @ pb.matrix
            bpy.context.view_layer.update()


def proxy_sword(M, pose):
    """Stand-in for BASSLINE (built procedurally in the game), placed by the game's IK."""
    me = bpy.data.meshes.get('sword_proxy')
    ob = bpy.data.objects.get('sword_proxy')
    if ob is None:
        parts = [
            K.box('sw_blade', (0.026, 0.24, 1.26), (0, 0, 0.77), [M['strap']], bevel=0.004, segs=1),
            K.box('sw_edge', (0.03, 0.02, 1.2), (0, -0.125, 0.75), [M['gold']]),
            K.box('sw_core', (0.032, 0.06, 0.7), (0, 0.0, 0.78), [M['lining']]),
            K.box('sw_guard', (0.07, 0.27, 0.04), (0, 0, 0.13), [M['gold']], bevel=0.008, segs=1),
            K.box('sw_grip', (0.04, 0.04, 0.3), (0, 0, -0.04), [M['glove']], bevel=0.008, segs=1),
        ]
        for o in parts:  # authored in game weapon axes (blade along +Z) -> Blender axes
            o.data.transform(C.to_4x4())
        ob = K.join(parts, 'sword_proxy')
        _ = me
    R = (C @ game_quat_matrix(pose['weapon']['q']) @ C.transposed()).to_4x4()
    ob.matrix_world = Matrix.Translation(K.g2b(pose['weapon']['p'])) @ R
    return ob


def camera(name, target, az, el, dist, lens=50):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        K.link(cam)
    cam.data.type = 'PERSP'
    cam.data.lens = lens
    a, e = math.radians(az), math.radians(el)
    d = V((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.location = V(target) + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def render_poses(S, parts, arm, out_dir, _render_views=None, M=None, chains=None):
    meas = os.path.join(out_dir, 'kaiser_measurements.json')
    dump = os.path.join(out_dir, '_work', 'kaiser_game_poses.json')
    os.makedirs(os.path.dirname(dump), exist_ok=True)
    subprocess.run(['npx', 'tsx', 'tools/blender/dump_poses.ts', meas, dump], cwd=ROOT, check=True)
    poses = json.load(open(dump))
    objs = list(parts.values())
    views = [('3/4', -32, 8, 3.3), ('lato', -90, 4, 3.3)]
    w, h = 560, 760
    tiles = []
    for pname, pose in poses.items():
        apply_game_pose(arm, pose, chains)
        sw = proxy_sword(M, pose)
        sw.hide_render = pname == 'rest'
        all_objs = objs + ([sw] if pname != 'rest' else [])
        added = K.add_outlines(all_objs, 0.004)
        K.material_mode('render')
        row = []
        pviews = [('fronte', 0, 4, 3.3), views[1]] if pname == 'rest' else views
        for vname, az, el, dist in pviews:
            camera('pose_cam', (0, 0, 1.0 if pname not in ('atk3',) else 0.9), az, el, dist, 50)
            K.set_light_dir((-0.5 if az <= 0 else 0.5, -0.6, 0.65))
            K.setup_render(w, h, 12)
            path = os.path.join(out_dir, '_work', f'pose_{pname}_{vname.replace("/", "")}.png')
            K.render_to(path)
            row.append(path)
        K.remove_outlines(added)
        K.material_mode('export')
        tiles.append((pose['label'], row))
    K.pose_reset(arm)
    # contact sheet
    pad, head = 10, 44
    cols = len(tiles)
    sheet = Image.new('RGB', (cols * (w + pad) + pad, 2 * (h + pad) + head + pad), (30, 28, 36))
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
    except OSError:
        font = ImageFont.load_default()
    for c, (label, row) in enumerate(tiles):
        x = pad + c * (w + pad)
        dr.text((x + 6, 12), label, fill=(255, 220, 120), font=font)
        for r, path in enumerate(row):
            im = Image.open(path).convert('RGBA')
            bg = Image.new('RGBA', im.size, (206, 204, 212, 255))
            sheet.paste(Image.alpha_composite(bg, im).convert('RGB'), (x, head + r * (h + pad)))
    out = os.path.join(out_dir, 'kaiser_poses.png')
    sheet.save(out)
    print('[poses]', out)
    return out
