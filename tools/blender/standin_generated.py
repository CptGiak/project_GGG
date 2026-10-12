"""
Stand-in for a model made by an image-to-3D generator (Meshy, Tripo...), to test
import_generated.py without spending credits: a rigged GLB of the game (public/models/rex.glb by
default) is posed, fused into one surface by a voxel remesh, decimated and painted into a single
baked texture, then exported in the generator's frame (no skeleton, Y-up, front +Z, centred and
normalised). That is what a generator returns: one closed surface, sleeves fused to the arms,
mitten hands, one colour map. The source joints are saved next to it for the error check.

    PY=/root/blender-venv/bin/python
    $PY tools/blender/standin_generated.py --out <dir>/standin_t.glb                  # T-pose
    $PY tools/blender/standin_generated.py --out <dir>/standin_a.glb --drop 40 --elbow 12 --stance 6
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402,I001
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import bl_kit as K  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))


def posed_copy(src, arm, a) -> bpy.types.Object:
    """the source mesh with the pose applied (arms dropped, elbows bent, legs apart)"""
    K.pose_reset(arm)
    for s, sx in (('L', 1.0), ('R', -1.0)):
        K.pose_rotate(arm, 'upperArm' + s, (0, 1, 0), sx * a.drop)
        # elbows bend down and a little forward, as generated "relaxed T-poses" do
        K.pose_rotate(arm, 'foreArm' + s, (0, 1, 0), sx * a.elbow)
        K.pose_rotate(arm, 'foreArm' + s, (0, 0, 1), -sx * a.elbow * 0.5)
        K.pose_rotate(arm, 'thigh' + s, (0, 1, 0), -sx * a.stance)
        K.pose_rotate(arm, 'foot' + s, (0, 1, 0), sx * a.stance)
        if a.palms_forward:
            # thumbs up, palms to the front: the hand turned 90 deg about the arm
            bpy.context.view_layer.update()
            ax = (arm.pose.bones['fingers' + s].head - arm.pose.bones['hand' + s].head).normalized()
            K.pose_rotate(arm, 'hand' + s, ax, -90 * sx)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(src.evaluated_get(dg), depsgraph=dg)
    ob = bpy.data.objects.new('posed', me)
    K.link(ob)
    ob.matrix_world = src.matrix_world.copy()
    joints = {b.name: list(arm.matrix_world @ arm.pose.bones[b.name].head) for b in arm.data.bones}
    return ob, joints


def base_colors(ob) -> np.ndarray:
    cols = []
    for slot in ob.material_slots:
        m = slot.material
        c = (0.5, 0.5, 0.5, 1.0)
        if m and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    c = tuple(n.inputs['Base Color'].default_value)
                    if n.inputs['Emission Strength'].default_value > 0.5 and any(n.inputs['Emission Color'].default_value[:3]):
                        c = tuple(n.inputs['Emission Color'].default_value)
        cols.append(c[:3])
    return np.array(cols or [(0.5, 0.5, 0.5)])


def fuse(posed, voxel: float, tris: int) -> bpy.types.Object:
    """one closed surface (voxel remesh), coloured from the nearest posed face, decimated"""
    mw = posed.matrix_world
    verts = [mw @ v.co for v in posed.data.vertices]
    polys = [tuple(p.vertices) for p in posed.data.polygons]
    mat_of = np.array([p.material_index for p in posed.data.polygons])
    bvh = BVHTree.FromPolygons(verts, polys)
    colors = base_colors(posed)

    ob = bpy.data.objects.new('generated', posed.data.copy())
    K.link(ob)
    ob.matrix_world = mw.copy()
    md = ob.modifiers.new('voxel', 'REMESH')
    md.mode = 'VOXEL'
    md.voxel_size = voxel
    md.adaptivity = 0.0
    K.apply_modifiers(ob, keep=())
    ob.data.materials.clear()
    print(f'  voxel remesh: {len(ob.data.polygons)} faces', flush=True)
    attr = ob.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for v in ob.data.vertices:
        loc, _, idx, _ = bvh.find_nearest(mw @ v.co)
        c = colors[mat_of[idx]] if idx is not None else (0.5, 0.5, 0.5)
        attr.data[v.index].color = (*c, 1.0)
    n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if n > tris:
        md = ob.modifiers.new('dec', 'DECIMATE')
        md.ratio = tris / n
        md.use_collapse_triangulate = True
        K.apply_modifiers(ob, keep=())
    for poly in ob.data.polygons:
        poly.use_smooth = True
    print(f'  decimated: {len(ob.data.polygons)} faces', flush=True)
    return ob


def bake_texture(ob, path: str, size: int) -> None:
    """smart UV unwrap + Cycles bake of the colour attribute into one base colour map"""
    K.set_active(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new('baked', size, size, alpha=False)
    m = bpy.data.materials.new('Material_0')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    at = nt.nodes.new('ShaderNodeAttribute')
    at.attribute_name = 'Col'
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(at.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.nodes.active = tex
    ob.data.materials.append(m)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 1
    sc.render.bake.margin = 6
    bpy.ops.object.bake(type='EMIT')
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    # export material: the map as base colour (what a generator's GLB carries)
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(path)
    nt.links.new(tex.outputs['Color'], bs.inputs['Base Color'])
    nt.links.new(bs.outputs[0], out.inputs['Surface'])
    ob.data.color_attributes.remove(ob.data.color_attributes['Col'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.path.join(ROOT, 'public', 'models', 'rex.glb'))
    ap.add_argument('--out', required=True)
    ap.add_argument('--drop', type=float, default=0.0, help='arms lowered from the T-pose (deg)')
    ap.add_argument('--elbow', type=float, default=0.0, help='elbow bend (deg)')
    ap.add_argument('--stance', type=float, default=0.0, help='legs apart (deg)')
    ap.add_argument('--palms-forward', action='store_true', help='hands turned thumbs up')
    ap.add_argument('--voxel', type=float, default=0.006)
    ap.add_argument('--tris', type=int, default=30000)
    ap.add_argument('--tex', type=int, default=1024)
    ap.add_argument('--scale', type=float, default=1.0, help='height in the generator frame (Meshy: about 1 unit)')
    a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

    K.reset_scene()
    bpy.ops.import_scene.gltf(filepath=a.src)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    src = next(o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm)
    posed, joints = posed_copy(src, arm, a)
    ob = fuse(posed, a.voxel, a.tris)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    bake_texture(ob, os.path.splitext(a.out)[0] + '_basecolor.png', a.tex)

    # generator frame: bounding box centred on the origin, normalised height
    P = np.array([ob.matrix_world @ v.co for v in ob.data.vertices])
    lo, hi = P.min(0), P.max(0)
    c = (lo + hi) / 2
    k = a.scale / (hi[2] - lo[2])
    for v in ob.data.vertices:
        v.co = (ob.matrix_world @ v.co - Vector(c)) * k
    ob.matrix_world.identity()
    for o in list(bpy.data.objects):
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    K.export_glb(os.path.abspath(a.out), [ob])
    truth = {'frame': {'center': [float(x) for x in c], 'scale': float(k), 'height': float(hi[2] - lo[2])},
             'joints': {b: [float(x) for x in p] for b, p in joints.items()},
             'pose': {'drop': a.drop, 'elbow': a.elbow, 'stance': a.stance, 'palms_forward': a.palms_forward}}
    with open(os.path.splitext(a.out)[0] + '_truth.json', 'w') as f:
        json.dump(truth, f, indent=1)
    print(f'standin {a.out}: {len(ob.data.polygons)} faces, {os.path.getsize(a.out) / 1e6:.2f} MB', flush=True)


if __name__ == '__main__':
    main()
