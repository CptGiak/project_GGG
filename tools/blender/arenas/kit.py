"""Shared helpers for the arena builders (headless Blender through the `bpy` module).

Units are metres. Blender axes: X right, -Y front (towards the viewer), Z up; the glTF export turns
them into the game axes (front = +Z, up = +Y). Every kit piece is modelled with its origin at the
bottom centre and its front towards -Y, so in game it faces +Z.

Two products come out of a builder:
  * texture tiles: a strip of facade (or floor) modelled in 3D, rendered orthographically with Cycles
    under a flat sky light, so recesses, sills and frames carry soft baked shading. A second render
    gives the "glow" mask (glass that can light up at night). Tiles are seamless because the tile is
    rendered surrounded by copies of itself.
  * a kit GLB: one mesh per piece, UV-mapped onto a shared palette atlas, with at most two
    materials: `atlas` (cel shaded in game) and `glow` (unlit, emissive in game).
"""
from __future__ import annotations

import math
import os
from typing import Callable, Iterable, Sequence

import bpy  # noqa: I001 - bpy must come first, it registers bmesh and mathutils
import bmesh
import numpy as np
from mathutils import Vector
from PIL import Image

V = Vector
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT_DIR = os.path.join(ROOT, 'public', 'models', 'arenas')
CACHE_DIR = os.path.join(HERE, '_cache')
PREVIEW_DIR = os.path.join(ROOT, 'docs', 'art', 'arenas')

JP_FONT_PATHS = [
    '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',
    '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
]
# heavy sans for latin signage (falls back to Blender's built-in font)
LATIN_FONT_PATHS = [
    '/usr/share/fonts/opentype/inter/InterDisplay-Black.otf',
    '/usr/share/fonts/opentype/inter/Inter-Black.otf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]


# =============================================================================================
# Scene
# =============================================================================================

def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves, bpy.data.collections):
        for item in list(coll):
            coll.remove(item)
    _MATS.clear()


def new_collection(name: str, linked: bool = True) -> bpy.types.Collection:
    c = bpy.data.collections.new(name)
    if linked:
        bpy.context.scene.collection.children.link(c)
    return c


def link(ob: bpy.types.Object, coll: bpy.types.Collection | None) -> bpy.types.Object:
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


# =============================================================================================
# Colours and materials
# =============================================================================================

def _lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def srgb(c) -> tuple:
    """'#rrggbb' or 0..1 sRGB triple -> linear RGBA for Blender sockets."""
    if isinstance(c, str):
        h = c.lstrip('#')
        c = tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (_lin(c[0]), _lin(c[1]), _lin(c[2]), 1.0)


def hex_rgb(c) -> tuple:
    if isinstance(c, str):
        h = c.lstrip('#')
        return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return tuple(c)


_MATS: dict[str, bpy.types.Material] = {}


def mat(name: str, color='#808080', emit: float = 0.0, rough: float = 0.9, metal: float = 0.0) -> bpy.types.Material:
    """Principled material, cached by name. Names starting with 'glass' or 'lit' feed the glow mask."""
    m = _MATS.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    if bsdf is None:
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = srgb(color)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit > 0:
        bsdf.inputs['Emission Color'].default_value = srgb(color)
        bsdf.inputs['Emission Strength'].default_value = emit
    m['base'] = hex_rgb(color)
    m['emit'] = emit
    _MATS[name] = m
    return m


def _emission_material(name: str, value: float) -> bpy.types.Material:
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (value, value, value, 1)
    em.inputs['Strength'].default_value = 1.0
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


# =============================================================================================
# Geometry
# =============================================================================================

def _object(name: str, bm: bmesh.types.BMesh, mats: Sequence[bpy.types.Material], coll) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    return link(ob, coll)


def apply_mods(ob: bpy.types.Object) -> None:
    if not ob.modifiers:
        return
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.data = me
    for md in list(ob.modifiers):
        ob.modifiers.remove(md)
    if old.users == 0:
        bpy.data.meshes.remove(old)


def bevel(ob: bpy.types.Object, width: float, segs: int = 1, angle: float = 40.0) -> bpy.types.Object:
    md = ob.modifiers.new('bevel', 'BEVEL')
    md.width = width
    md.segments = segs
    md.limit_method = 'ANGLE'
    md.angle_limit = math.radians(angle)
    md.use_clamp_overlap = True
    md.harden_normals = False
    apply_mods(ob)
    return ob


def box(coll, name: str, mn, mx, m: bpy.types.Material, bev: float = 0.0, segs: int = 1) -> bpy.types.Object:
    """Axis aligned box from min to max corner."""
    mn, mx = V(mn), V(mx)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    c = (mn + mx) / 2
    s = mx - mn
    for v in bm.verts:
        v.co = V((c.x + v.co.x * s.x, c.y + v.co.y * s.y, c.z + v.co.z * s.z))
    ob = _object(name, bm, [m], coll)
    if bev > 0:
        bevel(ob, min(bev, min(s) * 0.45), segs)
    flat(ob)
    return ob


def cbox(coll, name: str, center, size, m, bev: float = 0.0, segs: int = 1, rot_z: float = 0.0) -> bpy.types.Object:
    """Box by centre and size, optionally rotated about Z."""
    c, s = V(center), V(size)
    ob = box(coll, name, -s / 2, s / 2, m, bev, segs)
    ob.data.transform(_rot_z(rot_z))
    ob.data.transform(_translate(c))
    return ob


def cut(ob: bpy.types.Object, cutters: Sequence[bpy.types.Object]) -> bpy.types.Object:
    """Boolean difference with each cutter (the cutters are deleted)."""
    for k, cu in enumerate(cutters):
        md = ob.modifiers.new(f'cut{k}', 'BOOLEAN')
        md.operation = 'DIFFERENCE'
        md.solver = 'EXACT'
        md.object = cu
        cu.hide_render = True
    apply_mods(ob)
    for cu in cutters:
        me = cu.data
        bpy.data.objects.remove(cu)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    flat(ob)
    return ob


def rotate(ob: bpy.types.Object, axis: str, deg: float, pivot=(0, 0, 0)) -> bpy.types.Object:
    """Rotates the mesh data about an axis through `pivot` (pieces keep identity transforms)."""
    from mathutils import Matrix
    p = V(pivot)
    ob.data.transform(Matrix.Translation(p) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-p))
    return ob


def _rot_z(a: float):
    from mathutils import Matrix
    return Matrix.Rotation(a, 4, 'Z')


def _translate(v):
    from mathutils import Matrix
    return Matrix.Translation(V(v))


def cyl(coll, name: str, p0, p1, r0: float, r1: float | None = None, n: int = 16, m=None, cap: bool = True, smooth: bool = True) -> bpy.types.Object:
    """Cylinder / cone between two points."""
    p0, p1 = V(p0), V(p1)
    r1 = r0 if r1 is None else r1
    axis = (p1 - p0)
    length = axis.length
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=n, radius1=r0, radius2=r1, depth=length)
    q = V((0, 0, 1)).rotation_difference(axis.normalized())
    for v in bm.verts:
        v.co = q @ v.co + (p0 + p1) / 2
    ob = _object(name, bm, [m], coll)
    if smooth:
        smooth_by_angle(ob, 35)
    else:
        flat(ob)
    return ob


def torus(coll, name: str, center, R: float, r: float, n: int = 16, k: int = 6, m=None, axis: str = 'Z') -> bpy.types.Object:
    verts, faces = [], []
    for i in range(n):
        a = i / n * math.tau
        for j in range(k):
            b = j / k * math.tau
            x = (R + r * math.cos(b)) * math.cos(a)
            y = (R + r * math.cos(b)) * math.sin(a)
            z = r * math.sin(b)
            p = {'Z': (x, y, z), 'Y': (x, z, y), 'X': (z, x, y)}[axis]
            verts.append(V(p) + V(center))
    for i in range(n):
        for j in range(k):
            a = i * k + j
            b = ((i + 1) % n) * k + j
            c = ((i + 1) % n) * k + (j + 1) % k
            d = i * k + (j + 1) % k
            faces.append((a, b, c, d))
    return mesh(coll, name, verts, faces, m, smooth=True)


def mesh(coll, name: str, verts, faces, m, smooth: bool = False) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update(calc_edges=True)
    me.materials.append(m)
    ob = link(bpy.data.objects.new(name, me), coll)
    if smooth:
        smooth_by_angle(ob, 40)
    else:
        flat(ob)
    return ob


def prism_x(coll, name: str, profile_yz: Sequence[tuple], x0: float, x1: float, m) -> bpy.types.Object:
    """Extrudes a closed YZ profile (counter-clockwise seen from +X) between x0 and x1."""
    n = len(profile_yz)
    verts = [(x0, y, z) for y, z in profile_yz] + [(x1, y, z) for y, z in profile_yz]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return mesh(coll, name, verts, faces, m)


def flat(ob: bpy.types.Object) -> None:
    for p in ob.data.polygons:
        p.use_smooth = False


def smooth_by_angle(ob: bpy.types.Object, deg: float) -> None:
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(deg))


def join(objs: Sequence[bpy.types.Object], name: str) -> bpy.types.Object:
    """Joins meshes (no modifiers left) into the first one, keeping material slots per face."""
    objs = [o for o in objs if o is not None]
    # text / curves: evaluate to meshes first
    dg = None
    for i, o in enumerate(objs):
        if o.type != 'MESH':
            dg = dg or bpy.context.evaluated_depsgraph_get()
            me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
            mo = bpy.data.objects.new(o.name + '_mesh', me)
            mo.matrix_world = o.matrix_world.copy()
            for c in o.users_collection:
                c.objects.link(mo)
            bpy.data.objects.remove(o)
            objs[i] = mo
    base = objs[0]
    if len(objs) > 1:
        bm = bmesh.new()
        mats: list[bpy.types.Material] = []
        for o in objs:
            me = o.data
            remap = []
            for m in me.materials:
                if m not in mats:
                    mats.append(m)
                remap.append(mats.index(m))
            tmp = me.copy()
            tmp.transform(o.matrix_world)
            for p in tmp.polygons:
                p.material_index = remap[p.material_index] if remap else 0
            bm.from_mesh(tmp)
            bpy.data.meshes.remove(tmp)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for m in mats:
            me.materials.append(m)
        for o in objs:
            old = o.data
            bpy.data.objects.remove(o)
            if old.users == 0:
                bpy.data.meshes.remove(old)
        base = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(base)
    base.name = name
    base.data.name = name
    return base


def text(coll, name: str, body: str, size: float, loc, m, jp: bool = False, align: str = 'CENTER',
         extrude: float = 0.004, vertical: bool = False, rot_x: float = 90.0, latin: bool = False) -> bpy.types.Object:
    """Text standing on the XZ plane facing -Y (rot_x=0: lying on XY facing +Z). `vertical` stacks
    the characters (tategaki); `jp` / `latin` pick the japanese gothic or the heavy latin font."""
    cu = bpy.data.curves.new(name, type='FONT')
    cu.body = '\n'.join(body) if vertical else body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = 'CENTER'
    if vertical:
        cu.space_line = 0.92
    if jp or latin:
        for p in (JP_FONT_PATHS if jp else LATIN_FONT_PATHS):
            if os.path.exists(p):
                cu.font = bpy.data.fonts.load(p, check_existing=True)
                break
    ob = bpy.data.objects.new(name, cu)
    ob.data.materials.append(m)
    ob.location = V(loc)
    ob.rotation_euler = (math.radians(rot_x), 0, 0)
    return link(ob, coll)


# =============================================================================================
# Texture tiles
# =============================================================================================

def _setup_cycles(px_w: int, px_h: int, samples: int) -> None:
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.max_bounces = 3
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 1
    sc.cycles.transmission_bounces = 0
    try:
        sc.cycles.use_denoising = True
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:  # noqa: BLE001 - builds without OIDN just render noisier
        sc.cycles.use_denoising = False
    sc.render.film_transparent = False
    sc.render.resolution_x = px_w
    sc.render.resolution_y = px_h
    sc.render.resolution_percentage = 100
    sc.render.filter_size = 1.0
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.color_depth = '8'


def _world(color=(1, 1, 1), strength: float = 1.0) -> None:
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
    nt = sc.world.node_tree
    bg = nt.nodes.get('Background')
    if bg is None:
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        bg = nt.nodes.new('ShaderNodeBackground')
        out = nt.nodes.new('ShaderNodeOutputWorld')
        nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = strength


def _sun(direction, strength: float, angle_deg: float = 25.0) -> bpy.types.Object:
    ld = bpy.data.lights.new('sun', 'SUN')
    ld.energy = strength
    ld.angle = math.radians(angle_deg)
    ob = bpy.data.objects.new('sun', ld)
    d = V(direction).normalized()
    ob.rotation_euler = V((0, 0, -1)).rotation_difference(-d).to_euler()
    return link(ob, None)


def render_tile(build: Callable[[bpy.types.Collection], None], W: float, H: float, px_per_m: float, name: str,
                view: str = 'front', samples: int = 96, sun_dir=(-0.35, -0.5, 1.0), sun: float = 1.5, sky: float = 0.72,
                repeat=(1, 1)) -> tuple[np.ndarray, np.ndarray]:
    """Renders a seamless tile of size W x H (metres) built by `build` into [0,W] x [0,H].

    view 'front': the tile lies on the XZ plane facing -Y (facades). view 'top': on the XY plane
    facing +Z (floors). Returns (albedo uint8 HxWx3, glow mask float HxW 0..1) and caches PNGs.
    """
    reset()
    tile = new_collection('tile', linked=False)
    build(tile)
    rx, ry = repeat
    for i in range(-rx, rx + 1):
        for j in range(-ry, ry + 1):
            inst = bpy.data.objects.new(f'inst_{i}_{j}', None)
            inst.instance_type = 'COLLECTION'
            inst.instance_collection = tile
            inst.location = (i * W, 0, j * H) if view == 'front' else (i * W, j * H, 0)
            link(inst, None)
    px_w = int(round(W * px_per_m))
    px_h = int(round(H * px_per_m))
    _setup_cycles(px_w, px_h, samples)
    cam_d = bpy.data.cameras.new('cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = max(W, H)
    cam_d.sensor_fit = 'AUTO'
    cam_d.clip_start = 0.05
    cam_d.clip_end = 200
    cam = link(bpy.data.objects.new('cam', cam_d), None)
    if view == 'front':
        cam.location = (W / 2, -50, H / 2)
        cam.rotation_euler = (math.radians(90), 0, 0)
    else:
        cam.location = (W / 2, H / 2, 50)
        cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam
    _world((0.93, 0.95, 1.0), sky)
    # sun_dir points towards the sun (Blender axes, Z up) for both views
    sun_ob = _sun(sun_dir if view == 'front' else (sun_dir[0], sun_dir[1], abs(sun_dir[2])), sun)
    os.makedirs(CACHE_DIR, exist_ok=True)
    albedo_path = os.path.join(CACHE_DIR, f'{name}_albedo.png')
    bpy.context.scene.render.filepath = albedo_path
    bpy.ops.render.render(write_still=True)
    # glow mask: glass / lit materials white, everything else black, no lights
    bpy.data.objects.remove(sun_ob)
    _world((0, 0, 0), 0.0)
    white = _emission_material('_mask_white', 1.0)
    half = _emission_material('_mask_half', 0.55)
    black = _emission_material('_mask_black', 0.0)
    for ob in tile.all_objects:
        if ob.type not in ('MESH', 'FONT'):
            continue
        slots = ob.material_slots
        for s in slots:
            nm = s.material.name if s.material else ''
            s.material = white if nm.startswith(('glass', 'lit')) else half if nm.startswith('dim') else black
    sc = bpy.context.scene
    sc.cycles.samples = 16
    sc.cycles.use_denoising = False
    mask_path = os.path.join(CACHE_DIR, f'{name}_mask.png')
    sc.render.filepath = mask_path
    bpy.ops.render.render(write_still=True)
    albedo = np.asarray(Image.open(albedo_path).convert('RGB'))
    mask = np.asarray(Image.open(mask_path).convert('L')).astype(np.float32) / 255.0
    return albedo, mask


def save_rgba(path: str, rgb: np.ndarray, alpha: np.ndarray | None = None) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    if alpha is None:
        Image.fromarray(rgb, 'RGB').save(path, optimize=True)
    else:
        a = np.clip(alpha * 255.0 + 0.5, 0, 255).astype(np.uint8)
        Image.fromarray(np.dstack([rgb, a]), 'RGBA').save(path, optimize=True)


# =============================================================================================
# Procedural 2D helpers (noise for ground textures, colour grading of tiles)
# =============================================================================================

def value_noise(h: int, w: int, cells: int, seed: int) -> np.ndarray:
    """Tileable smooth value noise in 0..1 (cells per side)."""
    rng = np.random.default_rng(seed)
    g = rng.random((cells, cells)).astype(np.float32)
    ys = np.arange(h) / h * cells
    xs = np.arange(w) / w * cells
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    fy = (ys - y0)[:, None]
    fx = (xs - x0)[None, :]
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    y1 = (y0 + 1) % cells
    x1 = (x0 + 1) % cells
    y0 %= cells
    x0 %= cells
    a = g[y0][:, x0]
    b = g[y0][:, x1]
    c = g[y1][:, x0]
    d = g[y1][:, x1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(h: int, w: int, base: int, octaves: int, seed: int) -> np.ndarray:
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += value_noise(h, w, base * (2 ** o), seed + o * 101) * amp
        tot += amp
        amp *= 0.5
    return out / tot


# =============================================================================================
# Palette atlas + kit export
# =============================================================================================

class Atlas:
    """Grid of flat colour swatches. Every kit material maps to one swatch; faces get the swatch
    centre as UV, so mip-mapping never bleeds and the game needs a single texture per arena."""

    def __init__(self, cells: int = 8, cell_px: int = 16):
        self.cells = cells
        self.cell_px = cell_px
        self.slots: dict[str, int] = {}
        self.colors: list[tuple] = []

    def slot(self, m: bpy.types.Material) -> int:
        key = m.name
        if key not in self.slots:
            if len(self.colors) >= self.cells * self.cells:
                raise RuntimeError('atlas full')
            self.slots[key] = len(self.colors)
            self.colors.append(tuple(m['base']))
        return self.slots[key]

    def uv(self, idx: int) -> tuple[float, float]:
        cx = idx % self.cells
        cy = idx // self.cells
        # v measured from the bottom (glTF flips at export, three flips back on load)
        return ((cx + 0.5) / self.cells, 1.0 - (cy + 0.5) / self.cells)

    def image(self) -> np.ndarray:
        n = self.cells * self.cell_px
        img = np.zeros((n, n, 3), np.float32)
        for i, c in enumerate(self.colors):
            cx = i % self.cells
            cy = i // self.cells
            img[cy * self.cell_px:(cy + 1) * self.cell_px, cx * self.cell_px:(cx + 1) * self.cell_px] = np.array(c[:3]) * 255
        return img


def atlas_piece(ob: bpy.types.Object, atlas: Atlas, atlas_mat: bpy.types.Material, glow_mat: bpy.types.Material) -> None:
    """Puts every face on its material's swatch and collapses the materials to atlas / glow."""
    me = ob.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    mats = list(me.materials)
    glow_flags = [bool(m.get('emit', 0) > 0) for m in mats]
    for p in me.polygons:
        m = mats[p.material_index]
        u, v = atlas.uv(atlas.slot(m))
        for li in p.loop_indices:
            uv.data[li].uv = (u, v)
    face_glow = [glow_flags[p.material_index] for p in me.polygons]
    # clearing the slots resets the face indices, so assign them afterwards
    me.materials.clear()
    me.materials.append(atlas_mat)
    me.materials.append(glow_mat)
    for p, g in zip(me.polygons, face_glow):
        p.material_index = 1 if g else 0


def export_kit(pieces: Iterable[bpy.types.Object], path: str) -> None:
    pieces = list(pieces)
    bpy.context.view_layer.update()
    for o in bpy.context.scene.objects:
        if o is not None:
            o.select_set(False)
    for o in pieces:
        o.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_extras=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
    )


def tri_count(objs) -> int:
    n = 0
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
    return n


def beam(coll, name: str, p0, p1, w: float, m, n: int = 4) -> bpy.types.Object:
    """Thin square (n=4) or round beam between two points (braces, rails, cables)."""
    return cyl(coll, name, p0, p1, w / 2 * (math.sqrt(2) if n == 4 else 1), n=n, m=m, smooth=n > 6)


def prism(coll, name: str, profile, axis: str, a0: float, a1: float, m) -> bpy.types.Object:
    """Extrudes a closed 2D profile along an axis. For axis 'Y' the profile is (x, z), for 'X' it is (y, z)."""
    n = len(profile)
    if axis == 'X':
        verts = [(a0, p, q) for p, q in profile] + [(a1, p, q) for p, q in profile]
    elif axis == 'Y':
        verts = [(p, a0, q) for p, q in profile] + [(p, a1, q) for p, q in profile]
    else:
        verts = [(p, q, a0) for p, q in profile] + [(p, q, a1) for p, q in profile]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    ob = mesh(coll, name, verts, faces, m)
    # make sure normals point outwards whatever the profile winding
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def contact_sheet(pieces: Sequence[bpy.types.Object], path: str, cols: int = 4, cell: float = 6.0, px: int = 1600) -> None:
    """Perspective render of every piece standing on a grid (for checking the kit)."""
    sc = bpy.context.scene
    cols = min(cols, len(pieces))
    rows = (len(pieces) + cols - 1) // cols
    for i, ob in enumerate(pieces):
        bb = [V(c) for c in ob.bound_box]
        size = max(max(c[k] for c in bb) - min(c[k] for c in bb) for k in range(3))
        s = min(1.0, (cell * 0.75) / max(size, 1e-3))
        zmin = min(c.z for c in bb)
        ob.scale = (s, s, s)
        ob.location = ((i % cols) * cell, -(i // cols) * cell, -zmin * s)
    w, d = cols * cell, rows * cell
    floor = box(None, '_floor', (-cell, -d, -0.05), (w, cell, 0), mat('_floor', '#3a3a40'))
    _setup_cycles(px, int(px * 0.62), 48)
    sc.render.film_transparent = False
    _world((0.55, 0.6, 0.75), 0.9)
    _sun((-0.5, -0.8, 1.0), 2.4, 8)
    cam_d = bpy.data.cameras.new('sheet_cam')
    cam_d.lens = 30
    cam = link(bpy.data.objects.new('sheet_cam', cam_d), None)
    cx = (cols - 1) * cell / 2
    cy = -(rows - 1) * cell / 2
    dist = max(w, d * 1.6) * 1.05
    cam.location = (cx, cy - dist * 0.8, dist * 0.62)
    direction = V((cx, cy, 0.8)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(floor)


def build_kit(theme: str, pieces: dict, out_dir: str, export: bool = True, preview: bool = False,
              cells: int = 8, cell_px: int = 8) -> None:
    """Models every piece, maps it onto the palette atlas, exports <theme>.glb + <theme>_atlas.png."""
    reset()
    atlas = Atlas(cells=cells, cell_px=cell_px)
    atlas_mat = mat('atlas', '#ffffff')
    glow_mat = mat('glow', '#ffffff')
    out = []
    for name, fn in pieces.items():
        coll = new_collection(f'c_{name}')
        fn(coll)
        ob = join(list(coll.objects), name)
        for col in list(ob.users_collection):
            col.objects.unlink(ob)
        bpy.context.scene.collection.objects.link(ob)
        atlas_piece(ob, atlas, atlas_mat, glow_mat)
        out.append(ob)
        print(f'  {name}: {tri_count([ob])} tris')
    print(f'  atlas: {len(atlas.colors)} / {cells * cells} swatches')
    save_rgba(os.path.join(out_dir, f'{theme}_atlas.png'), atlas.image())
    if export:
        export_kit(out, os.path.join(out_dir, f'{theme}.glb'))
    if preview:
        for ob in out:
            _colorize(ob, atlas)
        contact_sheet(out, os.path.join(CACHE_DIR, f'{theme}_kit.png'))


def _colorize(ob: bpy.types.Object, atlas: Atlas) -> None:
    """Preview only: per-face material from the atlas swatch under its UV."""
    me = ob.data
    uv = me.uv_layers['UVMap']
    cache: dict = {}
    me_mats = list(me.materials)
    me.materials.clear()
    for p in me.polygons:
        u, v = uv.data[p.loop_indices[0]].uv
        cx = int(u * atlas.cells)
        cy = int((1 - v) * atlas.cells)
        idx = cy * atlas.cells + cx
        col = atlas.colors[idx]
        glow = me_mats[p.material_index].name == 'glow'
        key = (idx, glow)
        if key not in cache:
            m = bpy.data.materials.new(f'prev_{idx}_{glow}')
            bsdf = m.node_tree.nodes.get('Principled BSDF')
            bsdf.inputs['Base Color'].default_value = srgb(col)
            if glow:
                bsdf.inputs['Emission Color'].default_value = srgb(col)
                bsdf.inputs['Emission Strength'].default_value = 2.0
            me.materials.append(m)
            cache[key] = len(me.materials) - 1
        p.material_index = cache[key]
