"""
Pose del gioco sui modelli importati da LoL (controllo dei pesi rimappati), come kaiser_poses.py.

dump_kit_poses.ts valuta le pose vere del campione (locomozione, clip di lolAnims.ts, IK delle armi, animScale) sulle
proporzioni del modello. Qui ogni osso del GLB riceve la stessa rotazione del Rig pilota rispetto
alla T-pose (lo stesso retarget di glbModels.ts), le posizioni restano quelle del GLB; le armi
seguono la mano visibile come nel gioco, le dita si chiudono sull'impugnatura e le falde si
scostano dalle gambe come farebbero le catene verlet.
"""
from __future__ import annotations

import json
import math
import os
import subprocess

import bpy
from mathutils import Matrix, Vector
from PIL import Image, ImageDraw, ImageFont

import bl_kit as K
from kaiser_poses import C, camera, game_quat_matrix, tpose_world

V = Vector
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))


def pivot_tpose(arm, side: str, female: bool) -> Matrix:
    """perno dell'arma (weaponPivot del gioco) nella T-pose, coordinate Blender"""
    sign = 1 if side == 'L' else -1
    RT = C @ Matrix.Rotation(math.radians(90 * sign), 3, 'Z') @ C.transposed()
    off = C @ V((0, -0.05 * (0.88 if female else 1.0), 0.006))
    head = arm.matrix_world @ arm.data.bones['hand' + side].head_local
    return Matrix.Translation(head + RT @ off) @ RT.to_4x4()


def apply_pose(arm, pose: dict, chains: list, grip: dict):
    K.pose_reset(arm)
    WT = tpose_world()
    deltas = {}
    for name in K.GAME_BONES:
        bd = pose['bones'][name]
        Wg = game_quat_matrix(bd['q'])
        d = C @ (Wg @ WT[name].inverted()) @ C.transposed()
        deltas[name] = d
        pb = arm.pose.bones[name]
        bpy.context.view_layer.update()
        rest = pb.bone.matrix_local
        head = K.g2b(bd['p']) if name == 'hips' else pb.head.copy()
        pb.matrix = Matrix.Translation(head) @ d.to_4x4() @ Matrix.Translation(-rest.to_translation()) @ rest
    bpy.context.view_layer.update()
    # falde: le gambe le spingono, non le trascinano
    hips_x = (deltas['hips'] @ V((1, 0, 0))).normalized()
    pitch = {}
    for s in 'LR':
        d = game_quat_matrix(pose['bones'][f'thigh{s}']['q']) @ V((0, -1, 0))
        pitch[s] = math.atan2(d.z, -d.y)
    for ch in chains:
        if ch.get('parent') not in (None, 'hips', 'spine', 'chest'):
            continue  # capelli: nel gioco li muove la catena verlet
        j0 = ch['joints'][0]
        theta = math.degrees(math.atan2(j0[0], j0[2])) % 360
        side = 'L' if 0 < theta < 180 else 'R'
        front = math.cos(math.radians(theta))
        p = pitch[side]
        if front > 0.3:
            a = 0.9 * max(0.0, p) + 0.25 * max(0.0, pitch['L' if side == 'R' else 'R'])
        elif front < -0.3:
            a = 0.75 * min(0.0, p)
        else:
            a = 0.45 * p
        pb = arm.pose.bones[ch['bones'][0]]
        bpy.context.view_layer.update()
        h = pb.head.copy()
        pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(-a, 4, hips_x) @ Matrix.Translation(-h) @ pb.matrix
    # dita: come glbModels.ts (asse delle nocche della T-pose = Z del gioco, pollice attorno a X)
    for s, sign in (('L', -1), ('R', 1)):
        curl = grip[s]
        for bn, ang, ax in ((f'fingers{s}', 62 * sign, V((0, 0, 1))), (f'fingertips{s}', 132 * sign, V((0, 0, 1))), (f'thumb{s}', 38, V((1, 0, 0)))):
            if bn not in arm.pose.bones:
                continue
            pb = arm.pose.bones[bn]
            bpy.context.view_layer.update()
            rest = pb.bone.matrix_local
            R = deltas['hand' + s] @ (C @ Matrix.Rotation(math.radians(ang * curl), 3, ax) @ C.transposed())
            pb.matrix = Matrix.Translation(pb.head.copy()) @ R.to_4x4() @ Matrix.Translation(-rest.to_translation()) @ rest
    bpy.context.view_layer.update()


def place_weapons(arm, weapons: dict, female: bool):
    for side, ob in weapons.items():
        hb = arm.pose.bones['hand' + side]
        posed = arm.matrix_world @ hb.matrix
        rest = arm.matrix_world @ hb.bone.matrix_local
        ob.matrix_world = posed @ rest.inverted() @ pivot_tpose(arm, side, female)


def render_poses(cid: str, B: dict):
    spec = B['spec']
    work = os.path.join(os.path.dirname(__file__), '_cache', cid, 'renders')
    os.makedirs(work, exist_ok=True)
    inp = os.path.join(work, 'kit_in.json')
    dump = os.path.join(work, 'kit_poses.json')
    json.dump({'spec': spec, 'champ': cid, 'grip': B['grip_hands']}, open(inp, 'w'))
    subprocess.run(['npx', 'tsx', 'tools/blender/dump_kit_poses.ts', inp, dump], cwd=ROOT, check=True)
    poses = json.load(open(dump))
    arm, mesh = B['arm'], B['mesh']
    chains = json.loads(arm['ggg_chains'])
    weapons = B['weapons']
    w, h = 520, 760
    tiles = []
    for pname, pose in poses.items():
        grip = {s: 1.0 if s in B['grip_hands'] else 0.22 + 0.78 * pose.get('off', 0.0) for s in 'LR'}
        apply_pose(arm, pose, chains, grip)
        place_weapons(arm, weapons, spec['female'])
        objs = [mesh, *weapons.values()]
        added = K.add_outlines(objs, 0.0035)
        K.material_mode('render')
        row = []
        views = [('fronte', 0, 4, 3.4), ('lato', -90, 4, 3.4)] if pname == 'rest' else [('3/4', -32, 8, 3.4), ('lato', -90, 4, 3.4)]
        for vname, az, el, dist in views:
            camera('pose_cam', (0, 0, 0.92), az, el, dist, 50)
            K.set_light_dir((-0.5 if az <= 0 else 0.5, -0.6, 0.65))
            K.setup_render(w, h, 12)
            path = os.path.join(work, f'pose_{pname}_{vname.replace("/", "")}.png')
            K.render_to(path)
            row.append(path)
        K.remove_outlines(added)
        K.material_mode('export')
        tiles.append((pose['label'], row))
    K.pose_reset(arm)
    for ob in weapons.values():
        ob.matrix_world = Matrix.Identity(4)
    pad, head = 10, 44
    sheet = Image.new('RGB', (len(tiles) * (w + pad) + pad, 2 * (h + pad) + head + pad), (30, 28, 36))
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
    out = os.path.join(work, 'poses.png')
    sheet.save(out)
    print('  [poses]', out)
    return out
