"""
Brings a character made by an image-to-3D generator (Meshy, see tools/meshy/meshy.py) into the
game: the generator's mesh and texture as they are, with the game skeleton fitted to the shape,
skin weights and the extras the game reads, exported to a GLB like the other models.

    PY=/root/blender-venv/bin/python
    $PY tools/blender/import_generated.py <model.glb> --id rex --height 1.8 --bulk 1.12 \\
        --glb public/models/generated/rex.glb --render <folder>

1. Load: every mesh of the file joined into one (a rigged input is taken in its bind pose), the
   base colour map saved as a JPEG of at most 2048 px.
2. Frame: the arm span along X, facing -Y (the toes tell front from back), scaled to --height,
   feet on z = 0, centred.
3. Skeleton (rig_fit.py): joints found from the silhouette and the depth of the body.
4. T-pose: if the arms hang or the elbows / legs are bent, a provisional rig with automatic
   weights straightens them (arms along X, legs vertical), as the game's GLBs are bound.
5. Weights: Blender's automatic (bone heat) weights computed on a voxel-remeshed copy, which is
   watertight even when the generator's surface is not, then copied to the real mesh (4 bones
   per vertex at most).
6. Export: game bones + fingers, ggg_spec (body proportions for the driver Rig), sockets of the
   grappling gear, provenance in ggg_source.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402,I001
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import bl_kit as K  # noqa: E402
import rig_fit  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
V = Vector
FINGERS = ['fingersL', 'fingertipsL', 'fingersR', 'fingertipsR']


# =============================================================================================
# Load and frame
# =============================================================================================

def mesh_arrays(ob):
    mw = np.array(ob.matrix_world)
    co = np.array([v.co[:] for v in ob.data.vertices])
    Vw = co @ mw[:3, :3].T + mw[:3, 3]
    tris = []
    for p in ob.data.polygons:
        vs = p.vertices
        for i in range(1, len(vs) - 1):
            tris.append((vs[0], vs[i], vs[i + 1]))
    return Vw, np.array(tris, dtype=np.int64)


def base_color_image(ob):
    for slot in ob.material_slots:
        m = slot.material
        if not (m and m.use_nodes):
            continue
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                links = n.inputs['Base Color'].links
                node = links[0].from_node if links else None
                # through a mix / vertex colour node to the texture
                for _ in range(3):
                    if node is None or node.type == 'TEX_IMAGE':
                        break
                    ins = [i for i in node.inputs if i.links]
                    node = ins[0].links[0].from_node if ins else None
                if node is not None and node.type == 'TEX_IMAGE' and node.image:
                    return node.image
    return None


def save_texture(img, path: str, max_px: int = 2048) -> str:
    from PIL import Image
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
    rgb = (np.clip(px[::-1, :, :3], 0, 1) * 255 + 0.5).astype(np.uint8)
    im = Image.fromarray(rgb, 'RGB')
    if max(w, h) > max_px:
        im = im.resize((max_px * w // max(w, h), max_px * h // max(w, h)), Image.LANCZOS)
    im.save(path, quality=92)
    return path


def load(path: str, work: str):
    K.reset_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.data.polygons and o.name != 'Icosphere']
    rigged = any(o.type == 'ARMATURE' for o in bpy.data.objects)
    for o in meshes:
        for md in list(o.modifiers):
            if md.type == 'ARMATURE':
                o.modifiers.remove(md)       # bind pose
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
        for vg in list(o.vertex_groups):
            o.vertex_groups.remove(vg)
        for k in list(o.data.shape_keys.key_blocks) if o.data.shape_keys else []:
            o.shape_key_remove(k)
    img = None
    for o in meshes:
        img = img or base_color_image(o)
    for o in list(bpy.data.objects):
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    ob = K.join(meshes, 'generated') if len(meshes) > 1 else meshes[0]
    ob.name = 'generated'
    weld(ob)
    tex = save_texture(img, os.path.join(work, 'basecolor.jpg')) if img else None
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print(f'[load] {os.path.basename(path)}: {len(meshes)} mesh(es), {len(ob.data.vertices)} vertices, {tris} triangles, '
          f'texture {img.size[:] if img else None}{", rigged (bind pose kept, skeleton dropped)" if rigged else ""}', flush=True)
    return ob, tex


def weld(ob) -> None:
    """one surface again: glTF stores a vertex per corner wherever normals or UVs differ (a
    flat-shaded file is a triangle soup); co-located vertices are merged (UV seams stay in the
    face corners) and the surface is smooth-shaded"""
    import bmesh
    n0 = len(ob.data.vertices)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    size = max(bm.verts[i].co.length for i in range(0, len(bm.verts), max(1, len(bm.verts) // 1000)))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=max(size, 1e-3) * 1e-5)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(ob.data)
    bm.free()
    if ob.data.has_custom_normals:
        K.set_active(ob)
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    ob.data.update()
    if len(ob.data.vertices) < n0:
        print(f'[load] welded {n0} -> {len(ob.data.vertices)} vertices', flush=True)


def transform(ob, M: Matrix) -> None:
    ob.data.transform(M)
    ob.data.update()


def frame(ob, height: float, yaw: float | None = None) -> dict:
    """arm span along X, front towards -Y, feet on z = 0, scaled to `height`, centred"""
    Vw, _ = mesh_arrays(ob)
    M = Matrix.Identity(4)

    def apply(T):
        nonlocal M, Vw
        transform(ob, T)
        M = T @ M
        Vw, _ = mesh_arrays(ob)

    if yaw is None:
        # the arm span is the widest horizontal direction: rotate it onto X
        yaw = 90.0 if np.ptp(Vw[:, 1]) > np.ptp(Vw[:, 0]) * 1.15 else 0.0
    if yaw:
        apply(Matrix.Rotation(math.radians(yaw), 4, 'Z'))
    lo, hi = Vw.min(0), Vw.max(0)
    k = height / (hi[2] - lo[2])
    c = (lo + hi) / 2
    apply(Matrix.Scale(k, 4) @ Matrix.Translation(V((-c[0], -c[1], -lo[2]))))
    # toes point to the front: from the ankles the feet reach further forward than back
    H = height
    flipped = False
    reach = []
    for m in (Vw[:, 0] > 0.01 * H, Vw[:, 0] < -0.01 * H):
        feet = Vw[m & (Vw[:, 2] < 0.03 * H), 1]
        ankle = Vw[m & (Vw[:, 2] > 0.07 * H) & (Vw[:, 2] < 0.12 * H), 1]
        if len(feet) > 20 and len(ankle) > 20:
            a = (np.percentile(ankle, 2) + np.percentile(ankle, 98)) / 2
            reach.append((a - np.percentile(feet, 1), np.percentile(feet, 99) - a))
    if reach:
        fwd, back = np.mean(reach, axis=0)
        flipped = bool(back > fwd)
        print(f'[frame] feet reach: {fwd:.3f} m to -Y, {back:.3f} m to +Y', flush=True)
    if flipped:
        apply(Matrix.Rotation(math.pi, 4, 'Z'))
    # centre: x on the middle of the span, y on the middle of the torso
    torso = Vw[(Vw[:, 2] > 0.55 * H) & (Vw[:, 2] < 0.7 * H) & (np.abs(Vw[:, 0]) < 0.1 * H)]
    dy = (np.percentile(torso[:, 1], 2) + np.percentile(torso[:, 1], 98)) / 2 if len(torso) else 0.0
    dx = (Vw[:, 0].min() + Vw[:, 0].max()) / 2
    apply(Matrix.Translation(V((-dx, -dy, 0))))
    print(f'[frame] yaw {yaw}, scale {k:.4f}{", turned 180 (was facing +Y)" if flipped else ""}', flush=True)
    return {'yaw': yaw, 'scale': k, 'flipped': flipped, 'matrix': [list(r) for r in M]}


# =============================================================================================
# Skeleton
# =============================================================================================

def armature_from_fit(name: str, fit: rig_fit.Fit):
    joints = {b: V(fit.joints[b]) for b in K.GAME_BONES}
    tails = {b: V(t) for b, t in fit.tails.items()}
    extra = [{'name': e['name'], 'head': V(e['head']), 'tail': V(e['tail']), 'parent': e['parent']} for e in fit.extra]
    return K.build_armature(name, joints, extra, tails)


def heat_weights(ob, arm, bones, voxel: float, max_tris: int = 40000) -> None:
    """bone heat on a voxel-remeshed (watertight) copy, copied back to the real mesh"""
    t0 = time.time()
    proxy = bpy.data.objects.new('proxy', ob.data.copy())
    K.link(proxy)
    proxy.data.materials.clear()
    md = proxy.modifiers.new('voxel', 'REMESH')
    md.mode = 'VOXEL'
    md.voxel_size = voxel
    md.adaptivity = 0.0
    K.apply_modifiers(proxy, keep=())
    n = sum(len(p.vertices) - 2 for p in proxy.data.polygons)
    if n > max_tris:
        md = proxy.modifiers.new('dec', 'DECIMATE')
        md.ratio = max_tris / n
        md.use_collapse_triangulate = True
        K.apply_modifiers(proxy, keep=())
    K.bind_auto(proxy, arm, bones)
    # bone heat can fail for a bone (Blender only warns): its vertices then went to the nearest
    # bone; report the deforming bones that got nothing
    used = {vg.name for vg in proxy.vertex_groups}
    counts = {vg.index: 0 for vg in proxy.vertex_groups}
    for v in proxy.data.vertices:
        for g in v.groups:
            if g.weight > 0.05:
                counts[g.group] += 1
    empty = [b for b in bones if b not in used or counts[proxy.vertex_groups[b].index] == 0]
    if empty:
        print(f'[weights] WARNING: no vertices on {", ".join(empty)} (bone heat failed there?)', flush=True)
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    K.transfer_weights(proxy, ob, arm)
    bpy.data.objects.remove(proxy, do_unlink=True)
    print(f'[weights] bone heat on a {len(bpy.data.meshes) and n} -> {min(n, max_tris)} triangle proxy, {time.time() - t0:.1f}s', flush=True)


def align(arm, bone: str, a: str, b: str, target) -> None:
    """rotate `bone` (about its head) so that the direction from joint a to joint b is `target`"""
    bpy.context.view_layer.update()
    pa = arm.matrix_world @ arm.pose.bones[a].head
    pb = arm.matrix_world @ arm.pose.bones[b].head
    d = (pb - pa).normalized()
    t = V(target).normalized()
    ang = d.angle(t)
    if ang < 1e-4:
        return
    ax = d.cross(t)
    if ax.length < 1e-8:
        return
    K.pose_rotate(arm, bone, ax.normalized(), math.degrees(ang))


PALM_TWIST = {'down': 0.0, 'forward': 90.0, 'back': -90.0}


def needs_tpose(fit: rig_fit.Fit, tol_deg: float = 3.0) -> bool:
    if any(fit.measures.get('palm' + s, 'down') != 'down' for s in 'LR'):
        return True
    J = fit.joints
    for s, sx in (('L', 1), ('R', -1)):
        for a, b in (('upperArm', 'foreArm'), ('foreArm', 'hand')):
            d = J[b + s] - J[a + s]
            if math.degrees(math.acos(np.clip(d[0] * sx / np.linalg.norm(d), -1, 1))) > tol_deg:
                return True
        for a, b in (('thigh', 'shin'), ('shin', 'foot')):
            d = J[b + s] - J[a + s]
            if math.degrees(math.acos(np.clip(-d[2] / np.linalg.norm(d), -1, 1))) > tol_deg:
                return True
    return False


def straighten(ob, fit: rig_fit.Fit, voxel: float) -> rig_fit.Fit:
    """provisional rig + weights, arms along X and legs vertical, applied to the mesh"""
    tmp = armature_from_fit('fit_rig', fit)
    bones = K.GAME_BONES + FINGERS
    heat_weights(ob, tmp, bones, voxel)
    for s, sx in (('L', 1.0), ('R', -1.0)):
        align(tmp, 'upperArm' + s, 'upperArm' + s, 'foreArm' + s, (sx, 0, 0))
        align(tmp, 'foreArm' + s, 'foreArm' + s, 'hand' + s, (sx, 0, 0))
        align(tmp, 'hand' + s, 'hand' + s, 'fingers' + s, (sx, 0, 0))
        twist = PALM_TWIST.get(fit.measures.get('palm' + s, 'down'), 0.0)
        if twist:
            # palm down, as the game's T-pose hands (fingers close about the forward axis)
            K.pose_rotate(tmp, 'hand' + s, (1, 0, 0), twist)
        align(tmp, 'thigh' + s, 'thigh' + s, 'shin' + s, (0, 0, -1))
        align(tmp, 'shin' + s, 'shin' + s, 'foot' + s, (0, 0, -1))
    bpy.context.view_layer.update()
    pose = lambda b: np.array(tmp.matrix_world @ tmp.pose.bones[b].head)  # noqa: E731
    tail = lambda b: np.array(tmp.matrix_world @ tmp.pose.bones[b].tail)  # noqa: E731
    J = {b: pose(b) for b in K.GAME_BONES}
    T = {b: tail(b) for b in fit.tails}
    extra = [{**e, 'head': pose(e['name']), 'tail': tail(e['name'])} for e in fit.extra]
    K.set_active(ob)
    md = next(m for m in ob.modifiers if m.type == 'ARMATURE')
    bpy.ops.object.modifier_apply(modifier=md.name)
    mw = ob.matrix_world.copy()
    ob.parent = None
    ob.matrix_world = mw
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    bpy.data.objects.remove(tmp, do_unlink=True)
    # exact T-pose: arms at the shoulders' height, legs under the hips (the alignment leaves
    # sub-millimetre drift)
    for s in 'LR':
        z = J['upperArm' + s][2]
        for b in ('foreArm', 'hand'):
            J[b + s][2] = z
    print('[tpose] arms along X, legs vertical', flush=True)
    return rig_fit.Fit(J, T, extra, {**fit.measures, 'straightened': True}, fit.notes)


def on_formula(fit: rig_fit.Fit, spec: dict) -> rig_fit.Fit:
    """bones exactly where the game's Rig puts them for these proportions (bl_kit.game_joints, the
    Rig.ts formula): the driver skeleton and the model then agree joint by joint, so the weapon
    pivot of the driver sits in the model's fist. The measured joints differ by a few cm, mostly
    in depth; finger bones and bone tips move with their joint."""
    jf = {b: np.array(p) for b, p in K.game_joints(spec).items()}
    d = {b: jf[b] - fit.joints[b] for b in K.GAME_BONES}
    worst = max(K.GAME_BONES, key=lambda b: np.linalg.norm(d[b]))
    shift = float(np.linalg.norm(d[worst]))
    print(f'[formula] joints moved onto the Rig formula: max {shift * 100:.1f} cm ({worst})', flush=True)
    tails = {b: t + d[b] for b, t in fit.tails.items()}
    for s in 'LR':
        tails['shoulder' + s] = jf['upperArm' + s]
        tails['thigh' + s] = jf['shin' + s]
        tails['shin' + s] = jf['foot' + s]
    extra = [{**e, 'head': e['head'] + d['hand' + e['name'][-1]], 'tail': e['tail'] + d['hand' + e['name'][-1]]}
             for e in fit.extra]
    return rig_fit.Fit(jf, tails, extra, {**fit.measures, 'formula_shift_cm': round(shift * 100, 1)}, fit.notes)


# =============================================================================================
# Export, renders
# =============================================================================================

def sockets(spec: dict, J: dict) -> dict:
    """grappling-gear sockets as in build_lol (game coordinates)"""
    hips_b = V(J['hips'])
    g = lambda p: [round(float(c), 4) for c in K.b2g(p)]  # noqa: E731
    return {'gearL': g(hips_b + V((spec['hipWidth'] + 0.12, -0.05, -0.02))),
            'gearR': g(hips_b + V((-spec['hipWidth'] - 0.12, -0.05, -0.02))),
            'nozzle': g(hips_b + V((0, 0.16, 0.08)))}


def pose_down(arm, deg: float = 70.0) -> None:
    K.pose_reset(arm)
    for s, sx in (('L', 1.0), ('R', -1.0)):
        K.pose_rotate(arm, 'upperArm' + s, (0, 1, 0), sx * deg)
        K.pose_rotate(arm, 'foreArm' + s, (0, 0, 1), sx * 18)


def pose_action(arm) -> None:
    """a stress pose: aiming elbows, a lunge, a twist"""
    K.pose_reset(arm)
    K.pose_rotate(arm, 'spine', (0, 0, 1), 18)
    K.pose_rotate(arm, 'upperArmR', (0, 0, 1), -70)
    K.pose_rotate(arm, 'foreArmR', (0, 0, 1), -60)
    K.pose_rotate(arm, 'upperArmL', (0, 1, 0), 35)
    K.pose_rotate(arm, 'upperArmL', (0, 0, 1), 60)
    K.pose_rotate(arm, 'foreArmL', (0, 0, 1), 80)
    K.pose_rotate(arm, 'thighL', (1, 0, 0), -55)
    K.pose_rotate(arm, 'shinL', (1, 0, 0), 70)
    K.pose_rotate(arm, 'thighR', (1, 0, 0), 25)
    K.pose_rotate(arm, 'shinR', (1, 0, 0), 30)
    for s, sx in (('L', 1), ('R', -1)):
        for b in ('fingers', 'fingertips'):
            K.pose_rotate(arm, b + s, (0, 1, 0), -sx * 70)


def render_checks(ob, arm, out: str, tag: str, fit: rig_fit.Fit, H: float) -> str:
    from PIL import Image, ImageDraw
    os.makedirs(out, exist_ok=True)
    added = K.add_outlines([ob], 0.003)
    K.material_mode('render')
    span = H * 1.08
    zc = H / 2
    shots = [('front', (0, -10, zc), (90, 0, 0), (-0.45, -0.6, 0.66)),
             ('back', (0, 10, zc), (90, 0, 180), (0.45, 0.6, 0.66)),
             ('side', (-10, 0, zc), (90, 0, -90), (-0.6, -0.45, 0.66)),
             ('q34', (-6, -8, zc), (90, 0, -36.87), (-0.6, -0.55, 0.6))]
    tiles = []
    try:
        for pose in ('tpose', 'down', 'action'):
            if pose == 'down':
                pose_down(arm)
            elif pose == 'action':
                pose_action(arm)
            for name, loc, rot, light in (shots if pose == 'tpose' else [shots[0], shots[3]]):
                w = 1000 if pose == 'tpose' and name in ('front', 'back') else 560
                K.ortho_camera('cam', loc, rot, span)
                K.set_light_dir(light)
                K.setup_render(w, 1000, 8)
                p = os.path.join(out, f'{tag}_{pose}_{name}.png')
                K.render_to(p)
                tiles.append((pose, name, p, w))
    finally:
        K.pose_reset(arm)
        K.remove_outlines(added)
        K.material_mode('export')
    # joints on the T-pose front view
    p = os.path.join(out, f'{tag}_tpose_front.png')
    im = Image.open(p).convert('RGBA')
    dr = ImageDraw.Draw(im)
    pts = {**{b: fit.joints[b] for b in K.GAME_BONES}, **{e['name']: e['head'] for e in fit.extra}}
    for b, q in pts.items():
        u = (q[0] - 0) / span * 1000 + 500
        v = 500 - (q[2] - zc) / span * 1000
        dr.ellipse((u - 6, v - 6, u + 6, v + 6), fill=(255, 40, 60, 255), outline=(255, 255, 255, 255))
    im.save(p.replace('.png', '_joints.png'))
    tiles[0] = (tiles[0][0], tiles[0][1], p.replace('.png', '_joints.png'), tiles[0][3])
    # contact sheet
    row1 = [t for t in tiles if t[0] == 'tpose']
    row2 = [t for t in tiles if t[0] != 'tpose']
    W = max(sum(t[3] for t in row1), sum(t[3] for t in row2))
    sheet = Image.new('RGB', (W, 2000), (52, 50, 60))
    for r, row in enumerate((row1, row2)):
        x = 0
        for _, _, path, w in row:
            t = Image.open(path).convert('RGBA')
            bg = Image.new('RGBA', t.size, (206, 204, 212, 255))
            sheet.paste(Image.alpha_composite(bg, t).convert('RGB'), (x, r * 1000))
            x += w
    sp = os.path.join(out, f'{tag}_sheet.jpg')
    sheet.save(sp, quality=88)
    for _, _, path, _ in tiles:
        os.remove(path)
    if os.path.exists(p):
        os.remove(p)
    return sp


def compare_truth(fit: rig_fit.Fit, truth_path: str, info: dict) -> dict:
    """joint errors against a stand-in's source skeleton (standin_generated.py)"""
    t = json.load(open(truth_path))
    fr = t['frame']
    M = np.array(info['matrix'])
    errs = {}
    for b, p in t['joints'].items():
        if b not in fit.joints:
            continue
        q = (np.array(p) - np.array(fr['center'])) * fr['scale']           # generator frame
        q = M[:3, :3] @ q + M[:3, 3]
        errs[b] = round(float(np.linalg.norm(q - fit.joints[b])) * 100, 1)
    worst = sorted(errs.items(), key=lambda kv: -kv[1])
    print('[truth] joint error (cm):', ', '.join(f'{b} {e}' for b, e in worst), flush=True)
    return errs


def from_brief(name: str) -> tuple:
    """(model GLB of the latest finished 'model' task, the brief's import settings, job.json)"""
    meshy = os.path.join(ROOT, 'tools', 'meshy')
    brief = json.load(open(os.path.join(meshy, 'briefs', f'{name}.json')))
    job_path = os.path.join(meshy, 'jobs', brief['name'], 'job.json')
    if not os.path.exists(job_path):
        sys.exit(f'no Meshy job for "{name}" yet ({job_path}): run tools/meshy/meshy.py model {name} first')
    job = json.load(open(job_path))
    done = [t for t in job['tasks'] if t['step'] == 'model' and t['status'] == 'SUCCEEDED']
    if not done:
        sys.exit(f'the job "{name}" has no finished model task')
    files = done[-1].get('files', {})
    glb = files.get('model_urls.glb') or next((p for p in files.values() if p.endswith('.glb')), None)
    if not glb:
        sys.exit(f'the model task {done[-1]["id"]} has no GLB file')
    return os.path.join(ROOT, glb), brief.get('import', {}), job_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('model', nargs='?', help='GLB from the generator (default with --brief: the latest model of the job)')
    ap.add_argument('--brief', default=None, help='Meshy brief name (tools/meshy/briefs): model, settings and provenance from its job')
    ap.add_argument('--id', default=None, help='champion id (default: the brief name, else rex)')
    ap.add_argument('--height', type=float, default=None, help='from the soles to the top of the head, hair included (default 1.8)')
    ap.add_argument('--bulk', type=float, default=None)
    ap.add_argument('--female', action='store_true', default=None)
    ap.add_argument('--yaw', type=float, default=None, help='turn the input by this many degrees (default: auto)')
    ap.add_argument('--tris', type=int, default=0, help='decimate to this many triangles (0 = keep)')
    ap.add_argument('--voxel', type=float, default=0.007, help='voxel size of the weight proxy (m)')
    ap.add_argument('--hand', type=float, default=0.09, help='expected hand length / height')
    ap.add_argument('--glb', default=None, help='output (default with --brief: public/models/generated/<id>.glb)')
    ap.add_argument('--render', default=None, help='folder for the check renders')
    ap.add_argument('--work', default=None, help='folder for intermediate files (default: next to --glb or --render)')
    ap.add_argument('--truth', default=None, help='stand-in truth json: print the joint errors')
    ap.add_argument('--source', default=None, help='job.json of the Meshy client: provenance in the extras')
    a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

    settings = {}
    if a.brief:
        model, settings, job_path = from_brief(a.brief)
        a.model = a.model or model
        a.source = a.source or job_path
        a.id = a.id or a.brief
        a.glb = a.glb or os.path.join(ROOT, 'public', 'models', 'generated', f'{a.id}.glb')
        a.render = a.render or os.path.join(os.path.dirname(job_path), 'import')
    if not a.model:
        ap.error('give the model GLB or --brief')
    a.id = a.id or 'rex'
    height = a.height or settings.get('height', 1.8)
    bulk = a.bulk if a.bulk is not None else settings.get('bulk', 1.0)
    female = a.female if a.female is not None else settings.get('female', False)

    t0 = time.time()
    work = a.work or a.render or os.path.dirname(os.path.abspath(a.glb or a.model))
    os.makedirs(work, exist_ok=True)
    ob, tex = load(a.model, work)
    info = frame(ob, height, a.yaw)
    if a.tris:
        n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        if n > a.tris:
            md = ob.modifiers.new('dec', 'DECIMATE')
            md.ratio = a.tris / n
            md.use_collapse_triangulate = True
            K.apply_modifiers(ob, keep=())
    mat = K.make_material('generated', '#ffffff', shade_mul=(0.62, 0.58, 0.72), image=tex, band=0.0) if tex else None
    if mat:
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        for p in ob.data.polygons:
            p.material_index = 0

    Vw, F = mesh_arrays(ob)
    fit = rig_fit.fit(Vw, F, hand_frac=a.hand)
    for n in fit.notes:
        print('  note:', n)
    print('[fit]', {k: v for k, v in fit.measures.items() if k != 'arms'}, flush=True)
    if a.truth:
        compare_truth(fit, a.truth, info)
    if needs_tpose(fit):
        fit = straighten(ob, fit, a.voxel)

    spec = rig_fit.fit_spec(fit.joints, female, bulk)
    print('[spec]', spec, flush=True)
    fit = on_formula(fit, spec)
    arm = armature_from_fit(f'{a.id}_rig', fit)
    heat_weights(ob, arm, K.GAME_BONES + FINGERS, a.voxel)
    arm['ggg_spec'] = json.dumps(spec)
    arm['ggg_chains'] = json.dumps([])
    arm['ggg_sockets'] = json.dumps(sockets(spec, fit.joints))
    src = {'generator': 'meshy', 'file': os.path.relpath(os.path.abspath(a.model), ROOT), 'height': height}
    if a.source and os.path.exists(a.source):
        job = json.load(open(a.source))
        src['tasks'] = [{k: t.get(k) for k in ('step', 'shot', 'endpoint', 'id', 'created')} for t in job['tasks']
                        if t['status'] == 'SUCCEEDED']
    arm['ggg_source'] = json.dumps(src)
    ob.name = a.id
    if a.render:
        sp = render_checks(ob, arm, a.render, a.id, fit, height)
        print('[render]', sp, flush=True)
    if a.glb:
        K.material_mode('export')
        K.export_glb(os.path.abspath(a.glb), [ob, arm])
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        print(f'[export] {os.path.relpath(os.path.abspath(a.glb), ROOT)}: {tris} triangles, {os.path.getsize(a.glb) / 1e6:.2f} MB', flush=True)
    with open(os.path.join(work, f'{a.id}_fit.json'), 'w') as f:
        json.dump({'frame': info, 'spec': spec, 'measures': fit.measures, 'notes': fit.notes,
                   'joints': {b: np.round(p, 4).tolist() for b, p in fit.joints.items()}}, f, indent=1, default=float)
    print(f'[done] {time.time() - t0:.0f}s', flush=True)


if __name__ == '__main__':
    main()
