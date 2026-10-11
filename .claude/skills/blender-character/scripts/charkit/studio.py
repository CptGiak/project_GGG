"""
Review studio: the eyes of a code-only character artist. Builds meshes from arrays, sets up a
three-point light rig scaled to the subject, renders the standard review views (clay, colour,
silhouette, value) and assembles labelled contact sheets you can Read and critique.

Cycles on CPU only (EEVEE / Workbench need a display). Axes: X = character's left,
-Y = character's front, Z = up. Azimuth 0 = camera in front of the character.
"""
from __future__ import annotations

import math
import os
from typing import Iterable, Sequence

import bpy  # noqa: I001
import numpy as np
from mathutils import Matrix, Vector

V = Vector


# =============================================================================================
# Scene and objects
# =============================================================================================

def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(ob: bpy.types.Object, coll: bpy.types.Collection | None = None) -> bpy.types.Object:
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def mesh_from_arrays(name: str, verts: np.ndarray, faces: np.ndarray, smooth: bool = True,
                     mats: Sequence[bpy.types.Material] = (), face_mat: np.ndarray | None = None) -> bpy.types.Object:
    """Fast mesh creation from numpy arrays (triangles or quads, uniform arity)."""
    verts = np.asarray(verts, np.float32)
    faces = np.asarray(faces, np.int32)
    k = faces.shape[1]
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.ravel())
    me.loops.add(len(faces) * k)
    me.loops.foreach_set('vertex_index', faces.ravel())
    me.polygons.add(len(faces))
    me.polygons.foreach_set('loop_start', np.arange(0, len(faces) * k, k, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    for m in mats:
        me.materials.append(m)
    if face_mat is not None:
        me.polygons.foreach_set('material_index', np.asarray(face_mat, np.int32))
    me.polygons.foreach_set('use_smooth', np.full(len(faces), smooth, bool))
    ob = bpy.data.objects.new(name, me)
    link(ob)
    return ob


def mesh_arrays(ob: bpy.types.Object, world: bool = True) -> tuple:
    """(verts, triangles) of an object's evaluated mesh."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    v = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', v)
    v = v.reshape(-1, 3)
    t = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get('vertices', t)
    ev.to_mesh_clear()
    if world:
        M = np.array(ob.matrix_world, np.float32)
        v = v @ M[:3, :3].T + M[:3, 3]
    return v, t.reshape(-1, 3)


def vertex_normals(ob: bpy.types.Object) -> np.ndarray:
    me = ob.data
    n = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('normal', n)
    return n.reshape(-1, 3)


def set_vertex_colors(ob: bpy.types.Object, rgb: np.ndarray, name: str = 'Col') -> None:
    """Per-vertex linear RGB(A) colours as a POINT colour attribute."""
    me = ob.data
    attr = me.color_attributes.get(name) or me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    rgba = np.ones((len(me.vertices), 4), np.float32)
    rgba[:, :rgb.shape[1]] = rgb
    attr.data.foreach_set('color', rgba.ravel())
    me.color_attributes.active_color = attr


def bounds(objs: Iterable[bpy.types.Object]) -> tuple:
    lo = np.full(3, 1e9)
    hi = np.full(3, -1e9)
    for o in objs:
        if o.type not in {'MESH', 'CURVE'}:
            continue
        for c in o.bound_box:
            w = o.matrix_world @ V(c)
            lo = np.minimum(lo, w)
            hi = np.maximum(hi, w)
    return lo, hi


# =============================================================================================
# Colour helpers and materials
# =============================================================================================

def srgb_to_linear(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def hex_lin(h: str) -> tuple:
    h = h.lstrip('#')
    return tuple(float(x) for x in srgb_to_linear([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]))


def principled(name: str, color='#9a948c', rough: float = 0.6, metal: float = 0.0, sss: float = 0.0,
               sss_radius=(1.0, 0.35, 0.2), sheen: float = 0.0, spec: float = 0.4, attr: str | None = None,
               emission: float = 0.0, coat: float = 0.0) -> bpy.types.Material:
    """Principled BSDF material; `attr` = name of a colour attribute to use as base colour."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    col = hex_lin(color) if isinstance(color, str) else tuple(color)
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if 'Specular IOR Level' in b.inputs:
        b.inputs['Specular IOR Level'].default_value = spec
    if sss > 0:
        b.inputs['Subsurface Weight'].default_value = sss
        b.inputs['Subsurface Radius'].default_value = sss_radius
        b.inputs['Subsurface Scale'].default_value = 0.01
    if sheen > 0:
        b.inputs['Sheen Weight'].default_value = sheen
    if coat > 0:
        b.inputs['Coat Weight'].default_value = coat
    if attr:
        a = nt.nodes.new('ShaderNodeAttribute')
        a.attribute_type = 'GEOMETRY'
        a.attribute_name = attr
        nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
        if emission > 0:
            nt.links.new(a.outputs['Color'], b.inputs['Emission Color'])
    if emission > 0:
        b.inputs['Emission Strength'].default_value = emission
        if not attr:
            b.inputs['Emission Color'].default_value = (*col, 1)
    m.diffuse_color = (*col, 1)
    return m


def clay_material() -> bpy.types.Material:
    m = bpy.data.materials.get('REVIEW_Clay')
    if m:
        return m
    m = principled('REVIEW_Clay', '#b8ada0', rough=0.5, spec=0.35)
    m.name = 'REVIEW_Clay'
    return m


def assign(ob: bpy.types.Object, mat: bpy.types.Material) -> None:
    ob.data.materials.clear()
    ob.data.materials.append(mat)


# =============================================================================================
# Lights, world, cameras
# =============================================================================================

def _area(name, loc, target, power, color, size):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = power
    ld.color = color
    ld.size = size
    ob = bpy.data.objects.new(name, ld)
    link(ob)
    ob.location = loc
    d = V(target) - V(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def light_rig(objs: Sequence[bpy.types.Object], key_az: float = -40.0, mood: str = 'studio') -> None:
    """Warm key, cool fill, strong rim and a faint ground bounce, scaled to the subject.
    key_az: azimuth of the key light in degrees (0 = in front, negative = character's right)."""
    for o in [o for o in bpy.data.objects if o.type == 'LIGHT']:
        bpy.data.objects.remove(o)
    lo, hi = bounds(objs)
    c = (lo + hi) / 2
    size = float(max(hi - lo))
    r = size * 2.2

    def at(az, el, dist):
        a, e = math.radians(az), math.radians(el)
        return V((c[0] + dist * math.sin(a) * math.cos(e), c[1] - dist * math.cos(a) * math.cos(e), c[2] + dist * math.sin(e)))

    s = size * size  # inverse-square: keep exposure constant across subject sizes
    warm, cool = (1.0, 0.9, 0.78), (0.78, 0.86, 1.0)
    if mood == 'night':
        warm, cool = (1.0, 0.82, 0.62), (0.55, 0.7, 1.0)
    _area('KEY', at(key_az, 35, r), c, 260 * s, warm, size * 0.9)
    _area('FILL', at(key_az + 95, 10, r), c, 70 * s, cool, size * 1.4)
    _area('RIM', at(key_az + 200, 40, r), c + V((0, 0, size * 0.15)), 360 * s, (0.92, 0.95, 1.0), size * 0.6)
    _area('BOUNCE', at(0, -60, r * 0.8), c, 25 * s, (1.0, 0.85, 0.7), size * 2.0)


def world(color=(0.16, 0.165, 0.18), strength: float = 1.0) -> None:
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = strength


def render_settings(width: int = 768, height: int = 1024, samples: int = 48, transparent: bool = True) -> None:
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.03
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except TypeError:
        pass
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 2
    sc.cycles.transparent_max_bounces = 16
    sc.render.film_transparent = transparent
    sc.render.resolution_x = width
    sc.render.resolution_y = height
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        sc.view_settings.view_transform = 'Standard'
    sc.view_settings.exposure = -0.6


def camera(name: str = 'CAM') -> bpy.types.Object:
    cam = bpy.data.objects.get(name)
    if cam is None:
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        link(cam)
    bpy.context.scene.camera = cam
    return cam


def frame(cam: bpy.types.Object, lo, hi, az: float = 0.0, el: float = 4.0, lens: float = 70.0,
          margin: float = 1.12, ortho: bool = False) -> None:
    """Points the camera at the box [lo, hi] from azimuth/elevation (degrees) and fits it."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    c = V(((lo + hi) / 2).tolist())
    a, e = math.radians(az), math.radians(el)
    d = V((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    sc = bpy.context.scene
    aspect = sc.render.resolution_x / sc.render.resolution_y
    cam.data.sensor_fit = 'AUTO'
    ext = hi - lo
    # projected half extents (approximate with the box seen from this direction)
    right = V((math.cos(a), math.sin(a), 0))
    up = d.cross(right).normalized() * -1 if False else V((0, 0, 1))
    corners = [V((x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    hw = max(abs((p - c).dot(right)) for p in corners)
    hh = max(abs((p - c).dot(up)) for p in corners)
    half = max(hh, hw / aspect) * margin
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = 2 * half * max(aspect, 1.0) if aspect >= 1 else 2 * half
        dist = float(max(ext)) * 3
    else:
        cam.data.type = 'PERSP'
        cam.data.lens = lens
        fov = 2 * math.atan(cam.data.sensor_width / 2 / lens)
        # sensor fit AUTO: the fov applies to the larger dimension
        vfov = fov if aspect <= 1 else 2 * math.atan(math.tan(fov / 2) / aspect)
        dist = half / math.tan(vfov / 2) + float(max(ext)) / 2
    cam.location = c + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    cam.data.clip_start = 0.01
    cam.data.clip_end = dist * 4


# =============================================================================================
# Rendering
# =============================================================================================

def render(path: str) -> str:
    sc = bpy.context.scene
    sc.render.filepath = path
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    bpy.ops.render.render(write_still=True)
    return path


VIEWS = {
    'front': (0, 4),
    'three_quarter': (-35, 6),
    'side': (-90, 4),
    'back': (180, 4),
    'three_quarter_left': (35, 6),
}


def review(objs: Sequence[bpy.types.Object], out_dir: str, prefix: str, views: Sequence[str] = ('front', 'three_quarter', 'side', 'back'),
           clay: bool = False, width: int = 640, height: int = 900, samples: int = 32, lens: float = 70.0,
           box: tuple | None = None, mood: str = 'studio', key_az: float = -40.0) -> list:
    """Renders the review views. clay=True overrides every material with neutral clay (judge
    forms without colour). Returns the list of PNG paths."""
    render_settings(width, height, samples)
    world()
    light_rig(objs, key_az=key_az, mood=mood)
    vl = bpy.context.view_layer
    vl.material_override = clay_material() if clay else None
    cam = camera()
    lo, hi = box if box is not None else bounds(objs)
    paths = []
    for v in views:
        az, el = VIEWS[v] if isinstance(v, str) else v
        name = v if isinstance(v, str) else f'az{az}'
        frame(cam, lo, hi, az, el, lens)
        paths.append(render(os.path.join(out_dir, f'{prefix}_{name}{"_clay" if clay else ""}.png')))
    vl.material_override = None
    return paths


# =============================================================================================
# Contact sheets (PIL)
# =============================================================================================

def _font(size: int):
    from PIL import ImageFont
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def sheet(paths: Sequence[str], out: str, labels: Sequence[str] | None = None, cols: int | None = None,
          title: str = '', bg=(46, 47, 52), cell_h: int = 560, silhouettes: bool = False, values: bool = False) -> str:
    """Labelled grid of images on a neutral background. silhouettes / values add a second row
    with the alpha silhouette (readability) and the greyscale value check of each image."""
    from PIL import Image, ImageDraw, ImageOps

    ims = [Image.open(p).convert('RGBA') for p in paths]
    rows_extra = []
    if silhouettes:
        rows_extra.append([Image.merge('RGBA', [ImageOps.invert(i.getchannel('A'))] * 3 + [Image.new('L', i.size, 255)]) for i in ims])
    if values:
        rows_extra.append([_on_bg(i, bg).convert('L').convert('RGBA') for i in ims])
    ims = [_on_bg(i, bg) for i in ims]
    rows = [ims] + rows_extra if (silhouettes or values) else None
    if rows is None:
        cols = cols or len(ims)
        grid = [ims[i:i + cols] for i in range(0, len(ims), cols)]
    else:
        grid = rows
        cols = len(ims)
    scale = [cell_h / im.size[1] for im in ims]
    widths = [int(im.size[0] * s) for im, s in zip(ims, scale)]
    cw = max(widths)
    pad, top = 10, (44 if title else 10)
    W = pad + cols * (cw + pad)
    H = top + len(grid) * (cell_h + 26 + pad)
    canvas = Image.new('RGB', (W, H), tuple(int(b * 0.6) for b in bg))
    dr = ImageDraw.Draw(canvas)
    if title:
        dr.text((pad, 10), title, fill=(240, 220, 170), font=_font(22))
    for r, row in enumerate(grid):
        for c_, im in enumerate(row):
            im2 = im.resize((int(im.size[0] * cell_h / im.size[1]), cell_h), Image.LANCZOS)
            x = pad + c_ * (cw + pad) + (cw - im2.size[0]) // 2
            y = top + r * (cell_h + 26 + pad) + 22
            canvas.paste(im2.convert('RGB'), (x, y))
            idx = r * cols + c_ if rows is None else c_
            if labels and r == 0 and idx < len(labels):
                dr.text((pad + c_ * (cw + pad), y - 20), labels[idx], fill=(225, 225, 225), font=_font(15))
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    canvas.save(out)
    return out


def _on_bg(im, bg):
    from PIL import Image
    base = Image.new('RGBA', im.size, (*bg, 255))
    base.alpha_composite(im)
    return base


def gif(paths: Sequence[str], out: str, fps: int = 12, bg=(46, 47, 52), width: int | None = None) -> str:
    from PIL import Image
    frames = []
    for p in paths:
        im = _on_bg(Image.open(p).convert('RGBA'), bg).convert('RGB')
        if width:
            im = im.resize((width, int(im.size[1] * width / im.size[0])), Image.LANCZOS)
        frames.append(im.convert('P', palette=Image.ADAPTIVE, colors=200))
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(1000 / fps), loop=0, disposal=2)
    return out


# =============================================================================================
# Hero shot: painterly post-process (Blender 5.x compositor = node group)
# =============================================================================================

def painterly_post(size: int = 4, sharpness: float = 0.55, grade: bool = True, enable: bool = True):
    """Anisotropic Kuwahara filter on the final image: flattens render noise into brush-like
    patches (the cheapest big step towards a hand-painted look) plus a warm/cool grade.
    size 3 to 5 at 1000 px. Call with enable=False to turn it off for review renders (it hides
    modelling problems, so never judge forms through it)."""
    sc = bpy.context.scene
    if not enable:
        sc.compositing_node_group = None
        return None
    ng = bpy.data.node_groups.get('CHARKIT_Comp') or bpy.data.node_groups.new('CHARKIT_Comp', 'CompositorNodeTree')
    for n in list(ng.nodes):
        ng.nodes.remove(n)
    if not ng.interface.items_tree:
        ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    sc.compositing_node_group = ng
    try:
        sc.render.compositor_device = 'CPU'
    except (AttributeError, TypeError):
        pass
    rl = ng.nodes.new('CompositorNodeRLayers')
    out = ng.nodes.new('NodeGroupOutput')
    cur = rl.outputs['Image']
    kw = ng.nodes.new('CompositorNodeKuwahara')
    kw.inputs['Size'].default_value = size
    try:
        kw.inputs['Type'].default_value = 'Anisotropic'
    except (KeyError, TypeError):
        pass
    for key, val in (('Sharpness', sharpness), ('Eccentricity', 1.0)):
        if key in kw.inputs:
            kw.inputs[key].default_value = val
    ng.links.new(cur, kw.inputs['Image'])
    cur = kw.outputs[0]
    if grade:
        cb = ng.nodes.new('CompositorNodeColorBalance')
        for i in cb.inputs:
            try:
                if i.name == 'Factor':
                    i.default_value = 1.0
                elif i.name == 'Lift':
                    i.default_value = (0.98, 0.98, 1.04, 1)
                elif i.name == 'Gain':
                    i.default_value = (1.04, 1.0, 0.95, 1)
            except (TypeError, AttributeError):
                pass
        img_in = [i for i in cb.inputs if i.type == 'RGBA' and i.name in ('Image', 'Color')]
        ng.links.new(cur, img_in[0] if img_in else cb.inputs[1])
        cur = cb.outputs[0]
    ng.links.new(cur, out.inputs[0])
    return ng


def backdrop(color_floor='#3a3f4a', color_wall='#2a2d36', radius: float = 3.0) -> list:
    """A simple curved stage (floor + cyclorama) so hero shots get grounding shadows and a
    context colour instead of a void."""
    import bmesh
    objs = []
    for name, col, verts_fn in (('STAGE_floor', color_floor, None),):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=True, radius=radius, segments=64)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        link(ob)
        assign(ob, principled(name, col, rough=0.8))
        objs.append(ob)
    me = bpy.data.meshes.new('STAGE_wall')
    bm = bmesh.new()
    seg = 48
    vs = []
    for i in range(seg + 1):
        a = math.radians(-70 + 140 * i / seg)
        for z in (0.0, radius * 1.4):
            vs.append(bm.verts.new((radius * math.sin(a), radius * math.cos(a), z)))
    for i in range(seg):
        bm.faces.new((vs[2 * i], vs[2 * i + 2], vs[2 * i + 3], vs[2 * i + 1]))
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('STAGE_wall', me)
    link(ob)
    assign(ob, principled('STAGE_wall', color_wall, rough=0.9))
    objs.append(ob)
    return objs
