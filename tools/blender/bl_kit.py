"""
Shared Blender (bpy) toolkit for the champion builds: mesh primitives (lofts, sweeps,
superellipse rings), flat cel-shading materials, the game skeleton, weighting helpers,
orthographic sheet-matched renders and GLB export.

Blender world axes used everywhere: X = character's left, -Y = character's front, Z = up.
glTF export with +Y up turns that into the game's convention (X left, Y up, +Z forward).
"""
from __future__ import annotations

import json
import math
import os
from typing import Callable, Iterable, Sequence

import bpy  # noqa: I001 (bpy must be imported before bmesh / mathutils)
import bmesh
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

V = Vector


# =============================================================================================
# Scene
# =============================================================================================

def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures, bpy.data.node_groups):
        for item in list(coll):
            coll.remove(item)


def link(ob: bpy.types.Object, coll: bpy.types.Collection | None = None) -> bpy.types.Object:
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def collection(name: str) -> bpy.types.Collection:
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def set_active(ob: bpy.types.Object) -> None:
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


# =============================================================================================
# Colours
# =============================================================================================

def hex_rgb(h: str) -> tuple:
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def srgb_to_lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(rgb: Sequence[float]) -> tuple:
    return tuple(srgb_to_lin(v) for v in rgb[:3])


def as_rgb(c) -> tuple:
    if isinstance(c, str):
        return hex_rgb(c)
    if max(c) > 1.0:
        return tuple(v / 255 for v in c)
    return tuple(c)


# =============================================================================================
# Mesh building
# =============================================================================================

def mesh_object(name: str, verts, faces, mats: Sequence[bpy.types.Material] = (), face_mat: Sequence[int] | None = None,
                smooth: bool = True, uvs: Sequence | None = None, coll=None) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update(calc_edges=True)
    for m in mats:
        me.materials.append(m)
    if face_mat is not None:
        for p, mi in zip(me.polygons, face_mat):
            p.material_index = mi
    for p in me.polygons:
        p.use_smooth = smooth
    if uvs is not None:
        uv = me.uv_layers.new(name='UVMap')
        for li, loop in enumerate(me.loops):
            uv.data[li].uv = uvs[loop.vertex_index]
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    return ob


def superellipse(theta: float, rx: float, ry_front: float, ry_back: float, p: float = 2.0) -> tuple:
    """Point on a horizontal superellipse. theta = 0 at the front (-Y), +90 deg = character's left."""
    s, c = math.sin(theta), math.cos(theta)
    e = 2.0 / p
    x = rx * math.copysign(abs(s) ** e, s)
    ry = ry_front if c >= 0 else ry_back
    y = -ry * math.copysign(abs(c) ** e, c)
    return x, y


def grid_faces(rows: int, cols: int, closed: bool = False, flip: bool = False) -> list:
    """Quads for a (rows x cols) vertex grid stored row-major."""
    faces = []
    cmax = cols if closed else cols - 1
    for r in range(rows - 1):
        for c in range(cmax):
            c1 = (c + 1) % cols
            a, b, cc, d = r * cols + c, r * cols + c1, (r + 1) * cols + c1, (r + 1) * cols + c
            faces.append((a, d, cc, b) if flip else (a, b, cc, d))
    return faces


def loft(name: str, rings: Sequence[Sequence], closed: bool = True, cap0: bool = False, cap1: bool = False,
         mats=(), smooth: bool = True, flip: bool = False, coll=None, uvs=None) -> bpy.types.Object:
    """Connects rings of equal vertex count with quads (optionally closing the ends with fans)."""
    n = len(rings[0])
    verts = [V(p) for ring in rings for p in ring]
    faces = grid_faces(len(rings), n, closed, flip)
    if cap0:
        c = sum((V(p) for p in rings[0]), V()) / n
        verts.append(c)
        ci = len(verts) - 1
        for j in range(n if closed else n - 1):
            f = (ci, (j + 1) % n, j)
            faces.append(f[::-1] if flip else f)
    if cap1:
        base = (len(rings) - 1) * n
        c = sum((V(p) for p in rings[-1]), V()) / n
        verts.append(c)
        ci = len(verts) - 1
        for j in range(n if closed else n - 1):
            f = (ci, base + j, base + (j + 1) % n)
            faces.append(f[::-1] if flip else f)
    return mesh_object(name, verts, faces, mats, smooth=smooth, coll=coll, uvs=uvs)


def frames_along(path: Sequence[V], up: V = V((0, 0, 1))) -> list:
    """Parallel-transport frames (tangent, normal, binormal) along a polyline."""
    pts = [V(p) for p in path]
    tans = []
    for i in range(len(pts)):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        tans.append(t.normalized())
    n = up - up.dot(tans[0]) * tans[0]
    if n.length < 1e-5:
        n = V((1, 0, 0)) - tans[0].x * tans[0]
    n.normalize()
    out = []
    for i, t in enumerate(tans):
        if i > 0:
            # rotate previous normal by the rotation between tangents
            q = tans[i - 1].rotation_difference(t)
            n = q @ n
            n = (n - n.dot(t) * t).normalized()
        b = t.cross(n).normalized()
        out.append((t, n, b))
    return out


def sweep(name: str, path: Sequence, radius: float | Callable[[float], float] | Callable[[float], tuple],
          n: int = 8, mats=(), cap: bool = True, up: V = V((0, 0, 1)), flat: float = 1.0, coll=None,
          smooth: bool = True, twist: float = 0.0) -> bpy.types.Object:
    """Tube along a polyline. radius(t) may return a float or (r_normal, r_binormal)."""
    pts = [V(p) for p in path]
    fr = frames_along(pts, up)
    rings = []
    L = len(pts)
    for i, (p, (t, nrm, bn)) in enumerate(zip(pts, fr)):
        u = i / (L - 1) if L > 1 else 0
        r = radius(u) if callable(radius) else radius
        if isinstance(r, (tuple, list)):
            ra, rb = r
        else:
            ra, rb = r, r * flat
        ring = []
        for j in range(n):
            a = 2 * math.pi * j / n + twist
            ring.append(p + nrm * (math.cos(a) * ra) + bn * (math.sin(a) * rb))
        rings.append(ring)
    return loft(name, rings, closed=True, cap0=cap, cap1=cap, mats=mats, coll=coll, smooth=smooth)


def catmull(pts: Sequence, samples: int = 6) -> list:
    """Catmull-Rom resampling of a control polyline."""
    P = [V(p) for p in pts]
    out = []
    for i in range(len(P) - 1):
        p0 = P[max(i - 1, 0)]
        p1, p2 = P[i], P[i + 1]
        p3 = P[min(i + 2, len(P) - 1)]
        for s in range(samples):
            t = s / samples
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1])
    return out


def box(name: str, size, center=(0, 0, 0), mats=(), bevel: float = 0.0, segs: int = 2, coll=None) -> bpy.types.Object:
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = V((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + V(center)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    if bevel > 0:
        md = ob.modifiers.new('bevel', 'BEVEL')
        md.width = bevel
        md.segments = segs
        md.limit_method = 'NONE'
        apply_modifiers(ob)
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(50))
    return ob


def uv_sphere(name: str, radius=(1, 1, 1), center=(0, 0, 0), seg: int = 12, rings: int = 8, mats=(), coll=None) -> bpy.types.Object:
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = V((v.co.x * radius[0], v.co.y * radius[1], v.co.z * radius[2])) + V(center)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    return ob


def cylinder(name: str, r0: float, r1: float, p0, p1, n: int = 12, mats=(), cap: bool = True, coll=None) -> bpy.types.Object:
    return sweep(name, [V(p0), V(p1)], lambda t: r0 + (r1 - r0) * t, n=n, mats=mats, cap=cap, coll=coll)


def torus(name: str, center, axis, R: float, r: float, n: int = 20, m: int = 6, mats=(), coll=None, sx: float = 1.0, sy: float = 1.0) -> bpy.types.Object:
    axis = V(axis).normalized()
    q = V((0, 0, 1)).rotation_difference(axis)
    path = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        path.append(V(center) + q @ V((math.cos(a) * R * sx, math.sin(a) * R * sy, 0)))
    ob = sweep(name, path[:-1] + [path[0]], r, n=m, mats=mats, cap=False, coll=coll, up=axis)
    # weld the seam
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def apply_modifiers(ob: bpy.types.Object, keep: Iterable[str] = ('ARMATURE',)) -> None:
    """Bakes the modifier stack into the mesh (keeps armature modifiers)."""
    kept = [(m.name, m.type) for m in ob.modifiers if m.type in keep]
    saved = {}
    for m in ob.modifiers:
        if m.type in keep:
            saved[m.name] = m.show_viewport
            m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.data = me
    for m in list(ob.modifiers):
        if m.type not in keep:
            ob.modifiers.remove(m)
        else:
            m.show_viewport = saved.get(m.name, True)
    if old.users == 0:
        bpy.data.meshes.remove(old)
    _ = kept


def solidify(ob: bpy.types.Object, thickness: float, offset: float = -1.0, mat_offset: int = 0, rim_offset: int = 0, rim: bool = True, even: bool = True) -> None:
    md = ob.modifiers.new('solid', 'SOLIDIFY')
    md.thickness = thickness
    md.offset = offset
    md.use_rim = rim
    md.use_even_offset = even
    md.material_offset = mat_offset
    md.material_offset_rim = rim_offset
    md.use_quality_normals = True
    apply_modifiers(ob)


def subdivide(ob: bpy.types.Object, levels: int = 1) -> None:
    md = ob.modifiers.new('sub', 'SUBSURF')
    md.levels = levels
    md.render_levels = levels
    apply_modifiers(ob)


def join(objs: Sequence[bpy.types.Object], name: str) -> bpy.types.Object:
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    set_active(objs[0])
    for o in objs:
        o.select_set(True)
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs, object=objs[0]):
        bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


def tri_count(objs) -> int:
    n = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != 'MESH':
            continue
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
        o.evaluated_get(dg).to_mesh_clear()
    return n


def planar_uv(ob: bpy.types.Object, axis_u: V, axis_v: V, origin: V, size_u: float, size_v: float) -> None:
    """Planar projection UVs: u = (p - origin) . axis_u / size_u (same for v)."""
    me = ob.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for loop in me.loops:
        p = me.vertices[loop.vertex_index].co
        d = V(p) - V(origin)
        uv.data[loop.index].uv = (d.dot(axis_u) / size_u, d.dot(axis_v) / size_v)


def ensure_uv(ob: bpy.types.Object) -> None:
    if not ob.data.uv_layers:
        ob.data.uv_layers.new(name='UVMap')


# =============================================================================================
# Materials: Principled for glTF export, flat two-tone emission for the sheet-matched renders
# =============================================================================================

TOON_GROUP = 'GGG_Toon'


def toon_group() -> bpy.types.NodeTree:
    g = bpy.data.node_groups.get(TOON_GROUP)
    if g:
        return g
    g = bpy.data.node_groups.new(TOON_GROUP, 'ShaderNodeTree')
    g.interface.new_socket('Color', in_out='INPUT', socket_type='NodeSocketColor')
    g.interface.new_socket('Shade', in_out='INPUT', socket_type='NodeSocketColor')
    band = g.interface.new_socket('Band', in_out='INPUT', socket_type='NodeSocketFloat')
    band.default_value = 0.05
    g.interface.new_socket('Shader', in_out='OUTPUT', socket_type='NodeSocketShader')
    n = g.nodes
    gi = n.new('NodeGroupInput')
    go = n.new('NodeGroupOutput')
    geo = n.new('ShaderNodeNewGeometry')
    light = n.new('ShaderNodeCombineXYZ')
    light.name = 'LightDir'
    light.inputs[0].default_value, light.inputs[1].default_value, light.inputs[2].default_value = -0.45, -0.55, 0.7
    norm = n.new('ShaderNodeVectorMath')
    norm.operation = 'NORMALIZE'
    dot = n.new('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    gt = n.new('ShaderNodeMath')
    gt.operation = 'GREATER_THAN'
    gt.inputs[1].default_value = 0.05
    mix = n.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    em = n.new('ShaderNodeEmission')
    l = g.links
    l.new(light.outputs[0], norm.inputs[0])
    l.new(geo.outputs['Normal'], dot.inputs[0])
    l.new(norm.outputs[0], dot.inputs[1])
    l.new(dot.outputs['Value'], gt.inputs[0])
    l.new(gi.outputs['Band'], gt.inputs[1])
    l.new(gt.outputs[0], mix.inputs['Factor'])
    l.new(gi.outputs['Shade'], mix.inputs[6])
    l.new(gi.outputs['Color'], mix.inputs[7])
    l.new(mix.outputs[2], em.inputs['Color'])
    l.new(em.outputs[0], go.inputs['Shader'])
    return g


def set_light_dir(d: Sequence[float]) -> None:
    node = toon_group().nodes['LightDir']
    for i in range(3):
        node.inputs[i].default_value = d[i]


def make_material(name: str, color, shade=None, image: str | None = None, alpha_clip: bool = False,
                  shade_mul=(0.64, 0.6, 0.74), emissive: bool = False, band: float = 0.05) -> bpy.types.Material:
    """Flat material. `color`/`shade` are sRGB (hex or 0..255/0..1 tuples)."""
    rgb = as_rgb(color)
    sh = as_rgb(shade) if shade is not None else tuple(c * m for c, m in zip(rgb, shade_mul))
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.name = 'Out'
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.name = 'BSDF'
    bsdf.inputs['Base Color'].default_value = (*lin(rgb), 1.0)
    bsdf.inputs['Roughness'].default_value = 0.8
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.2
    if emissive:
        bsdf.inputs['Emission Color'].default_value = (*lin(rgb), 1.0)
        bsdf.inputs['Emission Strength'].default_value = 1.0
    grp = nt.nodes.new('ShaderNodeGroup')
    grp.node_tree = toon_group()
    grp.name = 'Toon'
    grp.inputs['Color'].default_value = (*lin(rgb), 1.0)
    grp.inputs['Shade'].default_value = (*lin(sh), 1.0)
    grp.inputs['Band'].default_value = band
    final = grp
    if image:
        img = bpy.data.images.load(image, check_existing=True)
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.name = 'Tex'
        tex.image = img
        tex.interpolation = 'Linear'
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(tex.outputs['Color'], grp.inputs['Color'])
        # shade = texture * shade multiplier
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        mul.inputs[7].default_value = (*lin(tuple(s / max(c, 1e-4) for s, c in zip(sh, rgb))), 1.0) if shade is not None else (*lin(shade_mul), 1.0)
        nt.links.new(tex.outputs['Color'], mul.inputs[6])
        nt.links.new(mul.outputs[2], grp.inputs['Shade'])
        if alpha_clip:
            nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            transp = nt.nodes.new('ShaderNodeBsdfTransparent')
            mix = nt.nodes.new('ShaderNodeMixShader')
            rnd = nt.nodes.new('ShaderNodeMath')
            rnd.operation = 'GREATER_THAN'
            rnd.inputs[1].default_value = 0.5
            nt.links.new(tex.outputs['Alpha'], rnd.inputs[0])
            nt.links.new(rnd.outputs[0], mix.inputs[0])
            nt.links.new(transp.outputs[0], mix.inputs[1])
            nt.links.new(grp.outputs[0], mix.inputs[2])
            final = mix
            try:
                m.blend_method = 'CLIP'
            except (AttributeError, TypeError):
                pass
    m['ggg_render'] = final.name
    nt.links.new(final.outputs[0], out.inputs['Surface'])
    m.diffuse_color = (*lin(rgb), 1.0)
    return m


def material_mode(mode: str) -> None:
    """'render' -> flat toon emission (sheet comparisons), 'export' -> Principled (glTF)."""
    for m in bpy.data.materials:
        if not m.use_nodes or 'Out' not in m.node_tree.nodes:
            continue
        nt = m.node_tree
        out = nt.nodes['Out']
        src = nt.nodes.get(m.get('ggg_render', 'Toon')) if mode == 'render' else nt.nodes.get('BSDF')
        if src is None:
            continue
        for l in list(out.inputs['Surface'].links):
            nt.links.remove(l)
        nt.links.new(src.outputs[0], out.inputs['Surface'])


def outline_material(color='#0b0709') -> bpy.types.Material:
    m = bpy.data.materials.get('GGG_Outline')
    if m:
        return m
    m = bpy.data.materials.new('GGG_Outline')
    m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*lin(hex_rgb(color)), 1)
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(geo.outputs['Backfacing'], mix.inputs[0])
    nt.links.new(em.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return m


# =============================================================================================
# Game skeleton (mirror of src/fighter/Rig.ts)
# =============================================================================================

GAME_BONES = ['hips', 'spine', 'chest', 'neck', 'head',
              'shoulderL', 'upperArmL', 'foreArmL', 'handL',
              'shoulderR', 'upperArmR', 'foreArmR', 'handR',
              'thighL', 'shinL', 'footL',
              'thighR', 'shinR', 'footR']
GAME_PARENT = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck',
               'shoulderL': 'chest', 'upperArmL': 'shoulderL', 'foreArmL': 'upperArmL', 'handL': 'foreArmL',
               'shoulderR': 'chest', 'upperArmR': 'shoulderR', 'foreArmR': 'upperArmR', 'handR': 'foreArmR',
               'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL',
               'thighR': 'hips', 'shinR': 'thighR', 'footR': 'shinR'}


def g2b(p) -> V:
    """game (x left, y up, z forward) -> Blender (x left, y back, z up)"""
    return V((p[0], -p[2], p[1]))


def b2g(p) -> tuple:
    return (p[0], p[2], -p[1])


def game_joints(spec: dict, tpose: bool = True) -> dict:
    """Joint positions (Blender coords) computed exactly like Rig.ts. In T-pose the upper arms
    are rotated 90 deg about the forward axis (arms along +-X)."""
    s = spec
    local = {
        'hips': (0, s['hipHeight'], 0),
        'spine': (0, s['spineLen'], -0.005),
        'chest': (0, s['chestLen'], 0.0),
        'neck': (0, s['shoulderDrop'] + 0.045, -0.01),
        'head': (0, s['neckLen'] - 0.11, 0.012),
        'shoulderL': (0.035, s['shoulderDrop'], -0.01),
        'upperArmL': (s['clavicle'] - 0.035, -0.01, 0),
        'foreArmL': (0, -s['upperArm'], 0),
        'handL': (0, -s['foreArm'], 0),
        'shoulderR': (-0.035, s['shoulderDrop'], -0.01),
        'upperArmR': (-(s['clavicle'] - 0.035), -0.01, 0),
        'foreArmR': (0, -s['upperArm'], 0),
        'handR': (0, -s['foreArm'], 0),
        'thighL': (s['hipWidth'], -0.045, 0),
        'shinL': (0, -s['thigh'], 0),
        'footL': (0, -s['shin'], 0),
        'thighR': (-s['hipWidth'], -0.045, 0),
        'shinR': (0, -s['thigh'], 0),
        'footR': (0, -s['shin'], 0),
    }
    leg = 0.045 + s['thigh'] + s['shin'] + s['footHeight']
    local['hips'] = (0, leg, 0)
    rot = {b: Matrix.Identity(3) for b in GAME_BONES}
    if tpose:
        rot['upperArmL'] = Matrix.Rotation(math.radians(90), 3, 'Z')
        rot['upperArmR'] = Matrix.Rotation(math.radians(-90), 3, 'Z')
    world_pos = {}
    world_rot = {}
    for b in GAME_BONES:
        p = GAME_PARENT[b]
        lp = V(local[b])
        if p is None:
            world_pos[b] = lp
            world_rot[b] = rot[b]
        else:
            world_pos[b] = world_pos[p] + world_rot[p] @ lp
            world_rot[b] = world_rot[p] @ rot[b]
    return {b: g2b(world_pos[b]) for b in GAME_BONES}


def build_armature(name: str, joints: dict, extra: Sequence[dict] = (), tails: dict | None = None) -> bpy.types.Object:
    """Armature with the game bones (+ extra bones: dicts with name, head, tail, parent)."""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    link(ob)
    set_active(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    child_of = {}
    for b in GAME_BONES:
        p = GAME_PARENT[b]
        if p:
            child_of.setdefault(p, []).append(b)
    for b in GAME_BONES:
        e = arm.edit_bones.new(b)
        e.head = joints[b]
        if tails and b in tails:
            e.tail = tails[b]
        else:
            kids = [k for k in child_of.get(b, []) if not k.startswith('shoulder') and not k.startswith('thigh')]
            if b == 'chest':
                kids = ['neck']
            if b == 'hips':
                kids = ['spine']
            if kids:
                e.tail = joints[kids[0]]
            else:
                e.tail = V(joints[b]) + V((0, 0, 0.1))
        if (V(e.tail) - V(e.head)).length < 1e-3:
            e.tail = V(e.head) + V((0, 0, 0.05))
        e.use_connect = False
        eb[b] = e
    for b in GAME_BONES:
        p = GAME_PARENT[b]
        if p:
            eb[b].parent = eb[p]
    for x in extra:
        e = arm.edit_bones.new(x['name'])
        e.head = V(x['head'])
        e.tail = V(x['tail'])
        e.use_connect = False
        eb[x['name']] = e
    for x in extra:
        if x.get('parent'):
            eb[x['name']].parent = eb[x['parent']]
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


# =============================================================================================
# Weights
# =============================================================================================

def bind_auto(ob: bpy.types.Object, arm: bpy.types.Object, allowed: Sequence[str]) -> None:
    """Blender automatic (bone heat) weights restricted to `allowed` bones."""
    saved = {b.name: b.use_deform for b in arm.data.bones}
    for b in arm.data.bones:
        b.use_deform = b.name in allowed
    set_active(arm)
    ob.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO', keep_transform=True)
    for b in arm.data.bones:
        b.use_deform = saved[b.name]
    # vertices bone heat could not reach: nearest allowed bone segment
    fill_unweighted(ob, arm, allowed)


def bind_rigid(ob: bpy.types.Object, arm: bpy.types.Object, bone: str) -> None:
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
    add_armature_modifier(ob, arm)


def add_armature_modifier(ob, arm) -> None:
    if not any(m.type == 'ARMATURE' for m in ob.modifiers):
        md = ob.modifiers.new('Armature', 'ARMATURE')
        md.object = arm
    ob.parent = arm
    ob.matrix_parent_inverse = arm.matrix_world.inverted()


def bone_segments(arm, names) -> dict:
    segs = {}
    for b in arm.data.bones:
        if b.name in names:
            segs[b.name] = (arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local)
    return segs


def seg_dist(p: V, a: V, b: V) -> float:
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (a + ab * t - p).length


def fill_unweighted(ob, arm, allowed) -> int:
    segs = bone_segments(arm, allowed)
    groups = {vg.index: vg.name for vg in ob.vertex_groups}
    missing = []
    mw = ob.matrix_world
    for v in ob.data.vertices:
        tot = sum(g.weight for g in v.groups if groups.get(g.group) in allowed)
        if tot < 1e-4:
            missing.append(v.index)
    for vi in missing:
        p = mw @ ob.data.vertices[vi].co
        best = min(segs, key=lambda n: seg_dist(p, *segs[n]))
        vg = ob.vertex_groups.get(best) or ob.vertex_groups.new(name=best)
        vg.add([vi], 1.0, 'REPLACE')
    return len(missing)


def weights_table(ob) -> list:
    names = {vg.index: vg.name for vg in ob.vertex_groups}
    return [{names[g.group]: g.weight for g in v.groups if g.weight > 0} for v in ob.data.vertices]


def set_weights(ob, table: list) -> None:
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    groups = {}
    for vi, w in enumerate(table):
        for n, x in w.items():
            if n not in groups:
                groups[n] = ob.vertex_groups.new(name=n)
            groups[n].add([vi], x, 'REPLACE')


def clean_weights(ob, max_inf: int = 4, min_w: float = 0.02, allowed: Sequence[str] | None = None) -> None:
    """Drop disallowed / tiny influences, keep the strongest 4 and renormalise."""
    tab = weights_table(ob)
    out = []
    for w in tab:
        if allowed is not None:
            w = {k: v for k, v in w.items() if k in allowed}
        items = sorted(w.items(), key=lambda kv: -kv[1])[:max_inf]
        items = [(k, v) for k, v in items if v >= min_w] or items[:1]
        s = sum(v for _, v in items) or 1.0
        out.append({k: v / s for k, v in items})
    set_weights(ob, out)


def transfer_weights(src: bpy.types.Object, dst: bpy.types.Object, arm: bpy.types.Object) -> None:
    """Copies skin weights from the nearest point of `src` (barycentric on its faces)."""
    dg = bpy.context.evaluated_depsgraph_get()
    sme = src.data
    verts = [src.matrix_world @ v.co for v in sme.vertices]
    polys = [tuple(p.vertices) for p in sme.polygons]
    tris = []
    for p in polys:
        for i in range(1, len(p) - 1):
            tris.append((p[0], p[i], p[i + 1]))
    bvh = BVHTree.FromPolygons(verts, tris)
    tab = weights_table(src)
    out = []
    for v in dst.data.vertices:
        p = dst.matrix_world @ v.co
        loc, nrm, idx, dist = bvh.find_nearest(p)
        if idx is None:
            out.append({})
            continue
        a, b, c = tris[idx]
        wa, wb, wc = barycentric(loc, verts[a], verts[b], verts[c])
        w = {}
        for vi, f in ((a, wa), (b, wb), (c, wc)):
            for k, x in tab[vi].items():
                w[k] = w.get(k, 0) + x * f
        out.append(w)
    set_weights(dst, out)
    clean_weights(dst)
    add_armature_modifier(dst, arm)
    _ = dg


def barycentric(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
    d20, d21 = v2.dot(v0), v2.dot(v1)
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-14:
        return 1.0, 0.0, 0.0
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    u = 1 - v - w
    return max(u, 0), max(v, 0), max(w, 0)


# =============================================================================================
# Posing
# =============================================================================================

def pose_reset(arm) -> None:
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def pose_rotate(arm, bone: str, axis, deg: float) -> None:
    """Rotates a pose bone about a WORLD axis through its head (applied on top of its pose)."""
    bpy.context.view_layer.update()
    pb = arm.pose.bones[bone]
    head = pb.head.copy()
    R = Matrix.Rotation(math.radians(deg), 4, V(axis))
    M = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ pb.matrix
    pb.matrix = M
    bpy.context.view_layer.update()


def pose_world_quats(arm, quats: dict) -> None:
    """Sets bones to model-space rotations (dict bone -> Quaternion applied to the rest frame),
    processed parents first so children compose correctly."""
    order = [b.name for b in arm.data.bones]
    for name in order:
        if name not in quats:
            continue
        pb = arm.pose.bones[name]
        bpy.context.view_layer.update()
        rest = pb.bone.matrix_local
        q = quats[name]
        R = q.to_matrix().to_4x4()
        head = pb.head.copy() if pb.parent else rest.to_translation()
        M = Matrix.Translation(head) @ R @ Matrix.Translation(-rest.to_translation()) @ rest
        pb.matrix = M
    bpy.context.view_layer.update()


# =============================================================================================
# Rendering
# =============================================================================================

def setup_render(width: int, height: int, samples: int = 16) -> None:
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.transparent_max_bounces = 24
    sc.cycles.max_bounces = 2
    sc.render.film_transparent = True
    sc.render.resolution_x = width
    sc.render.resolution_y = height
    sc.render.resolution_percentage = 100
    sc.render.filter_size = 1.2
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (0.7, 0.7, 0.7, 1)
        bg.inputs['Strength'].default_value = 0.0


def ortho_camera(name: str, loc, rot_deg, ortho_scale: float) -> bpy.types.Object:
    cam = bpy.data.objects.get(name)
    if cam is None:
        cd = bpy.data.cameras.new(name)
        cam = bpy.data.objects.new(name, cd)
        link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = ortho_scale
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.clip_start = 0.1
    cam.data.clip_end = 100
    cam.location = loc
    cam.rotation_euler = [math.radians(a) for a in rot_deg]
    bpy.context.scene.camera = cam
    return cam


def add_outlines(objs, width: float = 0.0032, skip: Sequence[str] = ()) -> list:
    """Inverted-hull outlines (render only)."""
    om = outline_material()
    added = []
    for o in objs:
        if o.type != 'MESH' or o.name in skip or o.get('no_outline'):
            continue
        k = len(o.data.materials)
        o.data.materials.append(om)
        md = o.modifiers.new('OUTLINE', 'SOLIDIFY')
        md.thickness = width * float(o.get('outline', 1.0))
        md.offset = 1.0
        md.use_flip_normals = True
        md.use_rim = False
        md.material_offset = k
        md.use_even_offset = False
        added.append((o, k))
    return added


def remove_outlines(added) -> None:
    for o, k in added:
        md = o.modifiers.get('OUTLINE')
        if md:
            o.modifiers.remove(md)
        o.data.materials.pop(index=k)


def render_to(path: str) -> None:
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# =============================================================================================
# Export
# =============================================================================================

def export_glb(path: str, objects: Sequence[bpy.types.Object]) -> None:
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_extras=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_cameras=False,
        export_lights=False,
        export_rest_position_armature=True,
        export_def_bones=False,
        export_influence_nb=4,
        export_all_influences=False,
    )
