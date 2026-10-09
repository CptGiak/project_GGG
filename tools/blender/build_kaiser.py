"""
KAISER — builds the 3D model from the Gemini character sheets, from scratch, every run.

  /root/blender-venv/bin/python tools/blender/build_kaiser.py --iter 3          # sheet comparison v3
  /root/blender-venv/bin/python tools/blender/build_kaiser.py --poses           # deformation renders
  /root/blender-venv/bin/python tools/blender/build_kaiser.py --export          # public/models/kaiser.glb

Pipeline: measure the sheets (sheet_measure.py) -> sample the flat palette -> cut the back crest
texture -> model every piece in T-pose (Blender axes: X = character's left, -Y = front, Z = up)
-> game skeleton (same bone names / hierarchy / joint formula as src/fighter/Rig.ts) + extra
bones (coat flaps, fingers) -> automatic weights per piece, then corrected -> renders / GLB.
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

import bpy  # noqa: E402  (bpy before bmesh / mathutils)
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402
from scipy import ndimage  # noqa: E402
from scipy.spatial import Delaunay  # noqa: E402

import bl_kit as K  # noqa: E402
import compare  # noqa: E402
import sheet_measure as SM  # noqa: E402

V = Vector
ROOT = SM.ROOT
OUT_DIR = os.path.join(ROOT, 'docs', 'art', 'blender')
TEX_DIR = os.path.join(HERE, 'textures')
GLB_PATH = os.path.join(ROOT, 'public', 'models', 'kaiser.glb')
HEIGHT = 1.85  # soles -> top of the skull (hair excluded)

# ---------------------------------------------------------------------------------------------
# Skeleton: BodySpec in the game's terms (src/fighter/Rig.ts), fitted to the sheet landmarks:
# hip joint 0.97 m, knee 0.515, ankle 0.085, shoulder joint (0.185, 1.49), wrist 0.525 m from
# the shoulder, head pivot at the jaw (1.615) so the eyes sit 0.11 above it like the old model.
# ---------------------------------------------------------------------------------------------
SPEC = {
    'hipHeight': 1.015, 'spineLen': 0.115, 'chestLen': 0.19, 'neckLen': 0.18, 'clavicle': 0.185,
    'shoulderDrop': 0.18, 'upperArm': 0.28, 'foreArm': 0.245, 'hipWidth': 0.095, 'thigh': 0.455,
    'shin': 0.43, 'footHeight': 0.085, 'bulk': 1.0, 'female': False,
}

# Sheet pose (A-pose of the drawings) used for the comparison renders, measured on the
# silhouettes: arm centre lines ~36 deg below horizontal, legs spread ~9 deg, toes out.
SHEET_POSE = {'arm': 37.0, 'hand': 0.0, 'leg': 9.0, 'foot': 6.0}

# =============================================================================================
# Profiles (metres). Rings: (z, rx, front depth, back depth). All tuned against the sheets.
# =============================================================================================

COAT_UPPER = [  # long coat + cropped jacket over the torso (open front)
    (1.075, 0.152, 0.110, 0.116),
    (1.13, 0.150, 0.104, 0.114),
    (1.20, 0.150, 0.104, 0.113),
    (1.25, 0.156, 0.108, 0.114),
    (1.29, 0.176, 0.122, 0.117),
    (1.34, 0.182, 0.126, 0.118),
    (1.40, 0.188, 0.126, 0.118),
    (1.45, 0.194, 0.120, 0.117),
    (1.49, 0.200, 0.112, 0.113),
    (1.515, 0.198, 0.102, 0.106),
    (1.533, 0.178, 0.090, 0.096),
    (1.548, 0.122, 0.077, 0.084),
    (1.56, 0.084, 0.068, 0.076),
]
COAT_EDGE = [(1.075, 0.068), (1.20, 0.072), (1.30, 0.080), (1.40, 0.086), (1.47, 0.082), (1.515, 0.07), (1.545, 0.052), (1.56, 0.045)]

COLLAR = [  # stand-up collar
    (1.528, 0.092, 0.076, 0.086),
    (1.56, 0.098, 0.080, 0.092),
    (1.60, 0.107, 0.088, 0.100),
    (1.64, 0.116, 0.097, 0.108),
    (1.682, 0.128, 0.108, 0.120),
]
COLLAR_EDGE = [(1.528, 0.044), (1.56, 0.052), (1.60, 0.07), (1.64, 0.092), (1.682, 0.118)]

SKIRT = [  # coat skirt below the belt (z, rx, front depth, back depth)
    (1.105, 0.168, 0.118, 0.124),
    (1.04, 0.190, 0.124, 0.135),
    (0.96, 0.214, 0.132, 0.150),
    (0.85, 0.240, 0.142, 0.166),
    (0.72, 0.268, 0.152, 0.186),
    (0.60, 0.292, 0.160, 0.202),
    (0.50, 0.310, 0.166, 0.214),
    (0.42, 0.318, 0.168, 0.220),
    (0.36, 0.322, 0.170, 0.224),
]
SKIRT_EDGE = [(1.105, 0.066), (1.04, 0.064), (0.96, 0.075), (0.85, 0.12), (0.75, 0.152), (0.65, 0.175), (0.55, 0.205), (0.48, 0.225), (0.36, 0.24)]
SLIT_TOP = 0.70


def skirt_hem(theta_deg: float) -> float:
    """Hem height around the skirt: short front flaps, long back panel (sheet front + back)."""
    a = abs(((theta_deg + 180) % 360) - 180)  # 0 front .. 180 back
    pts = [(0, 0.54), (45, 0.53), (70, 0.49), (90, 0.462), (120, 0.42), (150, 0.385), (180, 0.372)]
    return interp_pts(pts, a)


HEAD = [  # z, rx, front, back, y-centre
    (1.600, 0.016, 0.060, 0.012, 0.000),
    (1.612, 0.046, 0.072, 0.050, 0.000),
    (1.635, 0.068, 0.080, 0.070, 0.004),
    (1.665, 0.083, 0.088, 0.085, 0.008),
    (1.695, 0.087, 0.093, 0.098, 0.010),
    (1.725, 0.088, 0.095, 0.106, 0.010),
    (1.755, 0.088, 0.094, 0.110, 0.012),
    (1.785, 0.085, 0.090, 0.110, 0.014),
    (1.812, 0.076, 0.080, 0.102, 0.016),
    (1.834, 0.058, 0.062, 0.084, 0.018),
    (1.846, 0.034, 0.036, 0.052, 0.018),
    (1.852, 0.008, 0.008, 0.012, 0.018),
]
EYE_H = 1.727
EYE_LAT = 0.049


# =============================================================================================
# helpers
# =============================================================================================

def interp_pts(pts, x):
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            t = (x - x0) / (x1 - x0)
            return y0 + (y1 - y0) * t
    return pts[-1][1]


def interp_rows(rows, z):
    """Linear interpolation of profile rows (first column = z, ascending or descending)."""
    rr = sorted(rows, key=lambda r: r[0])
    if z <= rr[0][0]:
        return rr[0][1:]
    for a, b in zip(rr, rr[1:]):
        if z <= b[0]:
            t = (z - a[0]) / (b[0] - a[0])
            return tuple(x + (y - x) * t for x, y in zip(a[1:], b[1:]))
    return rr[-1][1:]


def theta_for_lateral(e, rx, p=2.0):
    """Angle (from the front) where a superellipse ring of half-width rx reaches lateral e."""
    s = min(0.985, e / rx)
    return math.asin(s ** (p / 2.0))


def ring_pt(theta, z, rx, f, b, yc=0.0, p=2.0):
    x, y = K.superellipse(theta, rx, f, b, p)
    return V((x, y + yc, z))


def flip_outward(ob, axis_pt=lambda z: V((0, 0, z)), inward=False):
    """Makes face normals point away from (or toward) a vertical axis."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        c = f.calc_center_median()
        a = axis_pt(c.z)
        d = V((c.x - a.x, c.y - a.y, 0))
        if d.length < 1e-6:
            continue
        out = f.normal.dot(d) > 0
        if out == inward:
            f.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()


def mirror_x(ob, name):
    """Duplicate mirrored across X (character left <-> right)."""
    me = ob.data.copy()
    me.name = name
    for v in me.vertices:
        v.co.x = -v.co.x
    me.flip_normals()
    o = bpy.data.objects.new(name, me)
    K.link(o)
    for k in ob.keys():
        o[k] = ob[k]
    return o


def tag(ob, outline=1.0, part=None):
    ob['outline'] = outline
    if part:
        ob['part'] = part
    return ob


# =============================================================================================
# Sheets: measurements, palette, textures
# =============================================================================================

class Sheets:
    def __init__(self):
        self.front = SM.load_sheet('kaiser', 'front', HEIGHT)
        self.back = SM.load_sheet('kaiser', 'back', HEIGHT, skull_ratio=self.front.extra['skull_ratio'])
        self.palette = {}

    def log(self):
        f, b = self.front, self.back
        return {
            'front': {'size': f.size, 'cx': f.cx, 'sole_y': f.sole, 'skull_y': f.skull, 'hair_top_y': f.top, 'm_per_px': f.s, 'face': f.extra.get('face'), 'insets': f.extra.get('insets')},
            'back': {'size': b.size, 'cx': b.cx, 'sole_y': b.sole, 'skull_y': b.skull, 'hair_top_y': b.top, 'm_per_px': b.s},
            'hair_top_m': float(f.h(f.top)),
            'palette': self.palette,
            'width_profile_front_cm': [(h, w) for h, w in SM.width_profile(f, 0.02)],
        }


def is_dark(sub):
    return sub.sum(2) < 260


def is_light(sub):
    return sub.min(2) > 170


def is_gold(sub):
    R, G, B = sub[..., 0], sub[..., 1], sub[..., 2]
    return (R > 150) & (G > 100) & (B < 140) & (R - B > 55)


def is_magenta(sub):
    R, G, B = sub[..., 0], sub[..., 1], sub[..., 2]
    return (R > 90) & (B > 50) & (G < 80) & (R - G > 50)


def is_skin(sub):
    R, G, B = sub[..., 0], sub[..., 1], sub[..., 2]
    return (R > 200) & (G > 140) & (B > 110) & (R - B > 40)


def is_hair(sub):
    s = sub.sum(2)
    R, B = sub[..., 0], sub[..., 2]
    return (s > 300) & (B >= R - 6) & ((sub.max(2) - sub.min(2)) < 60)


def not_gold_dark(sub):
    s = sub.sum(2)
    return (s > 120) & (s < 420) & ~is_gold(sub)


# where each material is sampled (view, lat0, h0, lat1, h1, predicate); lat = character's left
SAMPLES = {
    'coat': ('back', -0.22, 0.70, 0.22, 0.98, is_dark),
    'lining': ('front', -0.09, 0.50, 0.09, 0.85, is_magenta),
    'top': ('front', -0.045, 1.13, 0.045, 1.26, is_dark),
    'pants': ('back', 0.15, 0.24, 0.26, 0.34, is_dark),
    'boots': ('back', 0.16, 0.04, 0.29, 0.14, is_dark),
    'sole': ('back', 0.16, 0.0, 0.30, 0.025, is_light),
    'skin': ('front', -0.035, 1.625, 0.035, 1.665, is_skin),
    'hair': ('back', -0.13, 1.74, 0.13, 1.95, is_hair),
    'gold': ('back', -0.135, 1.42, 0.135, 1.50, is_gold),
    'mask': ('front', -0.03, 1.70, 0.03, 1.745, is_dark),
    'metal': ('back', -0.33, 1.47, -0.24, 1.54, not_gold_dark),
    'canister': ('back', 0.19, 0.99, 0.28, 1.07, not_gold_dark),
    'glove': ('back', 0.63, 1.0, 0.73, 1.12, is_dark),
}


def sample_palette(S: Sheets) -> dict:
    pal = {}
    for name, (view, a, h0, c, h1, pred) in SAMPLES.items():
        sh = S.front if view == 'front' else S.back
        lit, shade = SM.lit_and_shade(sh, a, h0, c, h1, pred)
        pal[name] = {'lit': SM.srgb_hex(lit) if lit else None, 'shade': SM.srgb_hex(shade) if shade else None, 'from': f'{view} sheet, lat {a:+.2f}..{c:+.2f} m, h {h0:.2f}..{h1:.2f} m'}
    S.palette = pal
    return pal


def build_materials(pal: dict, emblem_png: str, face_png: str) -> dict:
    def P(n, fallback):
        v = pal.get(n, {}).get('lit')
        return v or fallback

    def Sh(n):
        return pal.get(n, {}).get('shade')

    M = {
        'coat': K.make_material('coat', P('coat', '#333037'), Sh('coat')),
        'lining': K.make_material('lining', P('lining', '#b52d77'), Sh('lining')),
        'top': K.make_material('top', P('top', '#262629'), Sh('top')),
        'pants': K.make_material('pants', P('pants', '#2c2c2e'), Sh('pants')),
        'boots': K.make_material('boots', P('boots', '#262628'), Sh('boots')),
        'sole': K.make_material('sole', P('sole', '#e0e0e0'), '#a9a7b2', band=0.0),
        'skin': K.make_material('skin', P('skin', '#f0c5a8'), '#d39c8f'),
        'face': K.make_material('face', P('skin', '#f0c5a8'), '#d39c8f', image=face_png),
        'hair': K.make_material('hair', P('hair', '#d6d5de'), Sh('hair'), band=0.34),
        'gold': K.make_material('gold', P('gold', '#e0b864'), Sh('gold'), band=0.12),
        # the mask sample is polluted by the eye whites: keep the sheet's near-black lacquer
        'mask': K.make_material('mask', '#1e1d23', '#0b0a0e'),
        # pauldron plates: the sampled lit tone is the sheen band; the plate itself is darker
        'metal': K.make_material('metal', '#4b4339', Sh('metal') or '#2b2520', band=0.15),
        'metal_hi': K.make_material('metal_hi', P('metal', '#8b8475'), '#5a5248'),
        'canister': K.make_material('canister', P('canister', '#57504a'), Sh('canister')),
        'dial': K.make_material('dial', '#f2f0ec', '#b8b4bc'),
        'strap': K.make_material('strap', '#1c1b20', '#0e0d11'),
        'glove': K.make_material('glove', P('glove', '#1e1e22'), Sh('glove')),
        'pendant': K.make_material('pendant', '#ea5fae', '#a3306f', emissive=True),
        'emblem': K.make_material('emblem', '#333037', None, image=emblem_png, alpha_clip=True),
        'eye': K.make_material('eye', '#c99a3e', '#8a5a1a'),
    }
    return M


def make_face_texture(path: str, pal: dict) -> None:
    """Face decal drawn in head-front UV space: u = (x + 0.1) / 0.2, v = (z - 1.6) / 0.2."""
    N = 512
    skin = pal.get('skin', {}).get('lit') or '#f0c5a8'
    img = Image.new('RGB', (N, N), K.hex_rgb(skin) and tuple(int(c * 255) for c in K.hex_rgb(skin)))
    d = ImageDraw.Draw(img)

    def px(lat, h):
        return ((lat + 0.1) / 0.2 * N, (1 - (h - 1.6) / 0.2) * N)

    for sx in (1, -1):
        cx, cy = px(sx * EYE_LAT, EYE_H)
        w, hgt = 0.05 / 0.2 * N, 0.027 / 0.2 * N
        # sclera
        d.ellipse([cx - w / 2, cy - hgt / 2, cx + w / 2, cy + hgt / 2], fill=(248, 244, 238))
        # iris: amber, darker at the top
        ir = 0.0128 / 0.2 * N
        for k in range(int(ir), 0, -1):
            t = k / ir
            col = (int(150 + 70 * (1 - t)), int(100 + 70 * (1 - t)), int(25 + 40 * (1 - t)))
            d.ellipse([cx - k, cy - k * 1.05 + 2, cx + k, cy + k * 1.05 + 2], fill=col)
        d.ellipse([cx - ir * 0.42, cy - ir * 0.45 + 2, cx + ir * 0.42, cy + ir * 0.45 + 2], fill=(40, 22, 8))
        d.ellipse([cx - ir * 0.55 + sx * 4, cy - ir * 0.75, cx - ir * 0.15 + sx * 4, cy - ir * 0.35], fill=(255, 255, 250))
        # upper lash line + lower line
        d.arc([cx - w / 2 - 2, cy - hgt / 2 - 2, cx + w / 2 + 2, cy + hgt / 2 + 6], 190, 350, fill=(20, 12, 14), width=9)
        d.arc([cx - w / 2 + 6, cy - hgt / 2, cx + w / 2 - 6, cy + hgt / 2 + 2], 20, 160, fill=(120, 70, 60), width=3)
    # nose shadow + mouth
    nx, ny = px(0.004, 1.683)
    d.line([nx, ny - 14, nx + 5, ny], fill=(200, 140, 120), width=4)
    mx0, my = px(-0.013, 1.647)
    mx1, _ = px(0.013, 1.647)
    d.line([mx0, my, mx1, my], fill=(150, 85, 80), width=5)
    img = img.filter(ImageFilter.SMOOTH)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)


# =============================================================================================
# Geometry
# =============================================================================================

def build_body(M):
    """Body under the clothes (Skin modifier skeleton + subdivision): shirt torso, neck, pants."""
    pts = {
        'pelvis': ((0, 0.0, 1.00), (0.150, 0.108)),
        'waist': ((0, 0.004, 1.13), (0.132, 0.094)),
        'chest': ((0, 0.0, 1.32), (0.150, 0.108)),
        'chest2': ((0, 0.006, 1.46), (0.150, 0.098)),
        'neck0': ((0, 0.012, 1.535), (0.058, 0.054)),
        'neck1': ((0, 0.010, 1.645), (0.050, 0.048)),
        'hipL': ((0.095, 0.0, 0.93), (0.086, 0.086)),
        'kneeL': ((0.095, -0.004, 0.515), (0.060, 0.062)),
        'calfL': ((0.095, 0.006, 0.36), (0.061, 0.063)),
        'ankleL': ((0.095, 0.0, 0.12), (0.040, 0.042)),
    }
    for k in list(pts):
        if k.endswith('L'):
            (x, y, z), r = pts[k]
            pts[k[:-1] + 'R'] = ((-x, y, z), r)
    names = list(pts)
    me = bpy.data.meshes.new('body')
    me.from_pydata([pts[n][0] for n in names], [(names.index(a), names.index(b)) for a, b in [
        ('pelvis', 'waist'), ('waist', 'chest'), ('chest', 'chest2'), ('chest2', 'neck0'), ('neck0', 'neck1'),
        ('pelvis', 'hipL'), ('hipL', 'kneeL'), ('kneeL', 'calfL'), ('calfL', 'ankleL'),
        ('pelvis', 'hipR'), ('hipR', 'kneeR'), ('kneeR', 'calfR'), ('calfR', 'ankleR')]], [])
    ob = bpy.data.objects.new('body', me)
    K.link(ob)
    ob.modifiers.new('skin', 'SKIN')
    for n, sv in zip(names, me.skin_vertices[0].data):
        sv.radius = pts[n][1]
        sv.use_root = n == 'pelvis'
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = 1
    K.apply_modifiers(ob)
    for m in (M['top'], M['pants'], M['skin']):
        ob.data.materials.append(m)
    for p in ob.data.polygons:
        z = p.center.z
        p.material_index = 2 if z > 1.53 else (0 if z > 1.075 else 1)
        p.use_smooth = True
    return tag(ob, 1.0, 'body')


def build_head(M):
    rings = []
    n = 20
    for z, rx, f, b, yc in HEAD:
        rings.append([ring_pt(2 * math.pi * j / n, z, rx, f, b, yc, 2.0) for j in range(n)])
    ob = K.loft('head', rings, closed=True, cap0=True, cap1=True, mats=[M['face']])
    flip_outward(ob, lambda z: V((0, 0.01, z)))
    K.planar_uv(ob, V((1, 0, 0)), V((0, 0, 1)), V((-0.1, 0, 1.6)), 0.2, 0.2)
    parts = [ob]
    # ears (mostly under the hair; peek out at the back like on the sheet)
    for sx in (1, -1):
        e = K.uv_sphere('ear', (0.010, 0.017, 0.025), (sx * 0.087, 0.016, 1.706), 10, 7, [M['skin']])
        K.ensure_uv(e)
        parts.append(e)
    # nose
    nose = K.loft('nose', [[V((-0.008, -0.088, 1.676)), V((0.008, -0.088, 1.676)), V((0, -0.097, 1.674))],
                           [V((0, -0.091, 1.70)), V((0, -0.091, 1.70)), V((0, -0.091, 1.70))]], closed=True, cap0=True, mats=[M['skin']])
    K.ensure_uv(nose)
    parts.append(nose)
    return tag(K.join(parts, 'head'), 0.8, 'head')


def head_surface(lat, z, push=0.0):
    """Point on the face at (projected) lateral `lat`: what the sheet shows at x = lat."""
    rx, f, b, yc = interp_rows(HEAD, z)
    R = max(rx, 0.03)
    u = max(-1.0, min(1.0, lat / (R + push)))
    y = yc - (f + push) * math.sqrt(max(0.0, 1 - u * u))
    if abs(lat) > R + push:
        # beyond the head outline (mask wings over the hair): keep flowing backwards
        y = yc + (abs(lat) - R - push) * 0.6
    return V((lat, y, z))


def smooth_poly(pts, k=3, it=2):
    """Circular moving-average smoothing of a traced (pixel-stepped) outline."""
    P = np.array(pts, float)
    for _ in range(it):
        Q = np.zeros_like(P)
        for d in range(-k, k + 1):
            Q += np.roll(P, d, axis=0)
        P = Q / (2 * k + 1)
    return [tuple(p) for p in P]


def point_in_poly(px, py, poly):
    """Even-odd test, vectorised over points."""
    inside = np.zeros(px.shape, bool)
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        cond = ((y0 > py) != (y1 > py)) & (px < (x1 - x0) * (py - y0) / ((y1 - y0) + 1e-12) + x0)
        inside ^= cond
    return inside


def moore_trace(reg: np.ndarray):
    """Ordered outer boundary (row, col) of a binary blob."""
    ys, xs = np.nonzero(reg)
    start = (ys[0], xs[0])
    nb = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    H, W = reg.shape

    def on(p):
        return 0 <= p[0] < H and 0 <= p[1] < W and reg[p]
    path = [start]
    cur = start
    back = 6  # came from the west
    for _ in range(200000):
        found = False
        for k in range(8):
            d = (back + 1 + k) % 8
            q = (cur[0] + nb[d][0], cur[1] + nb[d][1])
            if on(q):
                back = (d + 4) % 8
                cur = q
                found = True
                break
        if not found or cur == start:
            break
        path.append(cur)
    return path


def resample_poly(pts, step):
    out = [pts[0]]
    acc = 0.0
    for a, b in zip(pts, pts[1:] + pts[:1]):
        seg = math.dist(a, b)
        acc += seg
        if acc >= step:
            out.append(b)
            acc = 0.0
    return out


def trace_mask_shape(S: Sheets):
    """Domino mask outline + eye holes traced from the front sheet (lat, h polygons)."""
    f = S.front
    box = (-0.16, 1.66, 0.16, 1.80)
    xa, xb = int(f.x(box[0])), int(f.x(box[2]))
    ya, yb = int(f.y(box[3])), int(f.y(box[1]))
    sub = f.img[ya:yb, xa:xb]
    R, G, B = sub[..., 0], sub[..., 1], sub[..., 2]
    dark = (R + G + B) < 230
    lab, n = ndimage.label(dark)
    sy, sx = int(f.y(1.735)) - ya, int(f.x(0.0)) - xa
    cands = [(np.hypot(*(np.argwhere(lab == i).mean(0) - (sy, sx))), i) for i in range(1, n + 1) if (lab == i).sum() > 200]
    i = min(cands)[1]
    blob = ndimage.binary_closing(lab == i, iterations=1)
    filled = ndimage.binary_fill_holes(blob)
    # the eye openings include the skin ring and the lash lines: open the blob so thin dark
    # line art inside the openings drops out, keep only the thick lacquered band
    core = ndimage.binary_opening(blob, iterations=2)
    cl, cn = ndimage.label(core)
    if cn > 1:
        sizes = ndimage.sum(core, cl, index=range(1, cn + 1))
        core = cl == (1 + int(np.argmax(sizes)))
    holes_lab, nh = ndimage.label(filled & ~core)
    sizes = sorted([((holes_lab == k).sum(), k) for k in range(1, nh + 1)], reverse=True)[:2]

    def to_m(path):
        return [(float(f.lat(c + 0.5 + xa)), float(f.h(r + 0.5 + ya))) for r, c in path]
    outer = resample_poly(smooth_poly(to_m(moore_trace(filled)), 2, 2), 0.0045)
    holes = [resample_poly(smooth_poly(to_m(moore_trace(holes_lab == k)), 2, 2), 0.004) for _, k in sizes]
    # our own outline is drawn inside the opening: widen the holes by ~ the line width
    grown = []
    for hp in holes:
        cx = sum(p[0] for p in hp) / len(hp)
        cy = sum(p[1] for p in hp) / len(hp)
        grown.append([(cx + (x - cx) * 1.14, cy + (y - cy) * 1.2) for x, y in hp])
    return outer, grown


def poly_mesh_2d(outer, holes, grid=0.008):
    """Triangulates a polygon with holes: Delaunay on boundary + interior grid, drop outside tris."""
    pts = list(outer) + [p for h in holes for p in h]
    xs = [p[0] for p in outer]
    ys = [p[1] for p in outer]
    gx, gy = np.meshgrid(np.arange(min(xs), max(xs), grid), np.arange(min(ys), max(ys), grid))
    gx, gy = gx.ravel(), gy.ravel()
    ins = point_in_poly(gx, gy, outer)
    for h in holes:
        ins &= ~point_in_poly(gx, gy, h)
    # keep interior points away from the boundary
    allb = np.array(pts)
    keep = []
    for x, y, ok in zip(gx, gy, ins):
        if ok and np.min(np.hypot(allb[:, 0] - x, allb[:, 1] - y)) > grid * 0.6:
            keep.append((x, y))
    P = np.array(pts + keep)
    tri = Delaunay(P)
    cx = P[tri.simplices].mean(1)
    ok = point_in_poly(cx[:, 0], cx[:, 1], outer)
    for h in holes:
        ok &= ~point_in_poly(cx[:, 0], cx[:, 1], h)
    return P, tri.simplices[ok]


def build_mask(S, M):
    outer, holes = trace_mask_shape(S)
    P, T = poly_mesh_2d(outer, holes, 0.016)
    verts = [head_surface(x, z, 0.006) for x, z in P]
    ob = K.mesh_object('mask', verts, [tuple(t) for t in T], [M['mask']])
    flip_outward(ob, lambda z: V((0, 0.01, z)))
    K.solidify(ob, 0.004, offset=-1.0)
    K.ensure_uv(ob)
    return tag(ob, 0.9, 'mask'), outer, holes


def bent_spike(name, base: V, tip: V, w0: float, ctrl: V | None = None, depth: float = 0.6, seg: int = 3, M=None, up: V | None = None, mat='hair'):
    """Anime hair spike: diamond cross-section (two facets -> lit / shade split), quadratic
    path base -> ctrl -> tip, width tapering to a (slightly blunt) point."""
    if ctrl is None:
        ctrl = base.lerp(tip, 0.5)
    path = []
    for i in range(seg + 1):
        t = i / seg
        path.append((1 - t) ** 2 * base + 2 * (1 - t) * t * ctrl + t * t * tip)
    hint = up if up is not None else V((0, 1, 0))
    return K.sweep(name, path, lambda t: (max(w0 * depth * (1 - t) ** 0.9, 0.002), max(w0 * (1 - t) ** 0.85, 0.003)), n=4, mats=[M[mat]], cap=True, up=hint)


def build_hair(S, M):
    C = V((0, 0.015, 1.74))
    parts = []
    # scalp cap over the skull; its lower edge rises from the nape (1.62) to the hairline (1.80)
    rings = []
    n = 18
    nz = 8
    for k in range(nz):
        t = k / (nz - 1)
        ring = []
        for j in range(n):
            th = 2 * math.pi * j / n
            front = max(0.0, math.cos(th))
            z0 = 1.62 + 0.18 * front ** 1.5
            z = z0 + (1.872 - z0) * t
            rx, f, b, yc = interp_rows(HEAD, min(z, 1.85))
            ring.append(ring_pt(th, z, rx * 1.10 + 0.004, f * 1.06 + 0.007, b * 1.10 + 0.01, yc, 2.0))
        rings.append(ring)
    cap = K.loft('hair_cap', rings, closed=True, cap1=True, mats=[M['hair']])
    flip_outward(cap, lambda z: V((0, 0.018, z)))
    parts.append(cap)

    def P(phi_deg, r, dy):
        a = math.radians(phi_deg)
        return C + V((math.cos(a) * r, dy, math.sin(a) * r))

    def spike(name, phi_t, r_t, dy_t, w, sweep=14.0, dy_b=0.01, r_b=0.07):
        """phi measured in the front plane from +X (character's left) toward +Z."""
        side = 1 if math.cos(math.radians(phi_t)) >= -1e-6 else -1
        sw = sweep * side if abs(phi_t - 90) > 6 else 0.0
        phi_b = phi_t + sw
        base = P(phi_b, r_b, dy_b)
        ctrl = P(phi_b - 0.35 * sw, 0.55 * r_t, (dy_b + dy_t) * 0.5)
        tip = P(phi_t, r_t, dy_t)
        parts.append(bent_spike(name, base, tip, w, ctrl, 0.6, M=M))

    tips, prof = SM.hair_tips(S.front, centre_h=1.74, min_r_m=0.10, below_h=1.675, win_deg=4, prominence=0.006)
    one = []
    for t in tips:
        if t['h'] < 1.69 and t['r'] < 0.15:
            continue  # collar tips, not hair
        a = t['ang']
        phi = a if (a <= 90 or a >= 270) else 180 - a
        phi = ((phi + 180) % 360) - 180
        one.append((phi, t['r']))
    one.sort()
    merged = []
    for phi, r in one:
        if merged and abs(phi - merged[-1][0]) < 7:
            merged[-1] = ((merged[-1][0] + phi) / 2, (merged[-1][1] + r) / 2)
        else:
            merged.append((phi, r))
    S.palette['_hair_tips'] = [(round(p, 1), round(r, 3)) for p, r in merged]
    for k, (phi, r) in enumerate(merged):
        w = min(0.056, max(0.036, 0.04 + 0.11 * (r - 0.2)))
        if abs(phi - 90) < 6:
            spike(f'spk{k}c', 90.0, r, 0.03, w)
            continue
        for sx in (1, -1):
            ph = phi if sx > 0 else 180 - phi
            spike(f'spk{k}{sx}', ph, r, 0.03, w)
    ang = sorted(p for p, _ in merged)
    for k in range(len(ang) - 1):
        a0, a1 = ang[k], ang[k + 1]
        mid = (a0 + a1) / 2
        lo = min(prof[int(round(a)) % 360] for a in np.linspace(a0, a1, 12))
        r = max(0.12, lo * 0.93)
        for sx in (1, -1):
            ph = mid if sx > 0 else 180 - mid
            spike(f'in{k}{sx}f', ph, r, -0.045, 0.034, sweep=10.0, dy_b=-0.02)
            spike(f'in{k}{sx}b', ph, r * 0.86, 0.075, 0.034, sweep=10.0, dy_b=0.05)
    # back of the head: locks radiating from a crown whorl (sheet back view), lying on the
    # skull and pointing out along it, so no lock is seen end-on
    W = V((0.0, 0.118, 1.83))
    for k, (a, rr, w) in enumerate([(90, 0.12, 0.042), (55, 0.13, 0.042), (125, 0.13, 0.042), (20, 0.14, 0.04), (160, 0.14, 0.04),
                                     (-15, 0.12, 0.038), (195, 0.12, 0.038), (-55, 0.10, 0.036), (235, 0.10, 0.036), (-90, 0.09, 0.036)]):
        ar = math.radians(a)
        tip = W + V((math.cos(ar) * rr, 0.0, math.sin(ar) * rr))
        # keep the tip on / just outside the cap surface, a bit behind it
        rx, f, b, yc = interp_rows(HEAD, max(1.6, min(tip.z, 1.85)))
        u = max(-0.99, min(0.99, tip.x / (rx * 1.15 + 0.01)))
        tip.y = yc + (b * 1.12 + 0.02) * math.sqrt(1 - u * u) + 0.012
        ctrl = W.lerp(tip, 0.5) + V((0, 0.035, 0))
        parts.append(bent_spike(f'whorl{k}', W, tip, w, ctrl, 0.5, M=M, up=V((0, 1, 0))))
    for k, xb in enumerate((-0.075, -0.05, -0.025, 0.0, 0.025, 0.05, 0.075)):
        base = V((xb, 0.075, 1.775))
        tip = V((xb * 1.5, 0.128, 1.674 + 0.01 * abs(xb) / 0.075))
        parts.append(bent_spike(f'nape{k}', base, tip, 0.03, base.lerp(tip, 0.5) + V((0, 0.025, 0)), 0.5, M=M, up=V((0, 1, 0))))
    # bangs: overlapping pointed strands from the crown down to the top of the mask
    for k, x in enumerate((-0.075, -0.05, -0.025, 0.0, 0.025, 0.05, 0.075)):
        tip = head_surface(x * 1.05, 1.766 + 0.008 * (k % 2), 0.016)
        base = head_surface(x * 0.55, 1.842, 0.002) + V((0, 0.02, 0))
        ctrl = head_surface(x * 0.85, 1.80, 0.03)
        parts.append(bent_spike(f'bang{k}', base, tip, 0.03, ctrl, 0.42, M=M, up=V((0, -1, 0))))
    for sx in (1, -1):
        for k, (dz, w) in enumerate([(1.686, 0.023), (1.71, 0.021)]):
            tip = V((sx * (0.096 + 0.006 * k), -0.04 + 0.03 * k, dz))
            base = V((sx * 0.078, -0.03 + 0.03 * k, 1.80))
            parts.append(bent_spike(f'lock{sx}{k}', base, tip, w, base.lerp(tip, 0.5) + V((sx * 0.012, -0.01, 0)), 0.5, M=M, up=V((sx, 0, 0))))
    hair = K.join(parts, 'hair')
    K.ensure_uv(hair)
    return tag(hair, 0.85, 'hair')


def open_rings(rows, edges, n_cols, z_list, p=2.3, extra=None):
    """Rings over the open range [theta_open, 2pi - theta_open] (front opening)."""
    rings = []
    for z in z_list:
        rx, f, b = interp_rows(rows, z)[:3]
        e = interp_pts(edges, z) if not isinstance(edges, (int, float)) else edges
        t0 = theta_for_lateral(e, rx, p)
        ring = []
        for j in range(n_cols):
            th = t0 + (2 * math.pi - 2 * t0) * j / (n_cols - 1)
            pt = ring_pt(th, z, rx, f, b, 0.0, p)
            if extra:
                pt = extra(pt, th, z)
            ring.append(pt)
        rings.append(ring)
    return rings


def build_coat_upper(M):
    zs = [r[0] for r in COAT_UPPER]
    zs = sorted(set(zs + list(np.linspace(1.075, 1.56, 8))))
    rings = open_rings(COAT_UPPER, COAT_EDGE, 23, zs, p=2.5)
    ob = K.loft('coat_upper', rings, closed=False, mats=[M['coat'], M['lining']])
    flip_outward(ob)
    K.solidify(ob, 0.007, offset=-1.0, mat_offset=1, rim_offset=0)
    lining_near_edges(ob, COAT_UPPER, COAT_EDGE, 2.5, 0.5)
    return tag(ob, 1.0, 'coat'), rings


def build_jacket_hem(M):
    """Cropped-jacket hem ridge across the front panels (front view line at h ~1.27)."""
    parts = []
    for sx in (1, -1):
        ring_lo, ring_hi = [], []
        for j in range(12):
            z = 1.268
            rx, f, b = interp_rows(COAT_UPPER, z)[:3]
            e = interp_pts(COAT_EDGE, z)
            t0 = theta_for_lateral(e, rx, 2.4)
            th = t0 + (math.radians(112) - t0) * j / 11
            th = th if sx > 0 else 2 * math.pi - th
            p0 = ring_pt(th, z - 0.012, rx + 0.004, f + 0.004, b + 0.004, 0, 2.4)
            p1 = ring_pt(th, z + 0.006, rx + 0.009, f + 0.009, b + 0.006, 0, 2.4)
            ring_lo.append(p0)
            ring_hi.append(p1)
        o = K.loft('hem', [ring_lo, ring_hi], closed=False, mats=[M['coat']])
        flip_outward(o)
        K.solidify(o, 0.004, offset=-1)
        parts.append(o)
    return tag(K.join(parts, 'jacket_hem'), 0.8, 'coat')


def build_collar(M):
    zs = list(np.linspace(1.528, 1.68, 7))
    rings = open_rings(COLLAR, COLLAR_EDGE, 23, zs, p=2.2)
    ob = K.loft('collar', rings, closed=False, mats=[M['coat'], M['lining']])
    flip_outward(ob)
    K.solidify(ob, 0.009, offset=-1.0, mat_offset=1, rim_offset=0)
    return tag(ob, 1.0, 'coat'), rings


def build_skirt(M):
    """Coat skirt: open front, short front flaps, long back panel, open slit at the back."""
    ncol = 27
    nrow = 11
    z_top = 1.105
    rings = []
    for i in range(nrow):
        t = i / (nrow - 1)
        ring = []
        for j in range(ncol):
            u = j / (ncol - 1)
            z_est = z_top + t * (0.45 - z_top)
            rx, f, b = interp_rows(SKIRT, z_est)
            t0 = theta_for_lateral(interp_pts(SKIRT_EDGE, z_est), rx, 2.0)
            th = t0 + (2 * math.pi - 2 * t0) * u
            hem = skirt_hem(math.degrees(th))
            z = z_top + t * (hem - z_top)
            rx, f, b = interp_rows(SKIRT, z)
            t0 = theta_for_lateral(interp_pts(SKIRT_EDGE, z), rx, 2.0)
            th = t0 + (2 * math.pi - 2 * t0) * u
            ring.append(ring_pt(th, z, rx, f, b, 0.004, 2.15))
        rings.append(ring)
    rows = [list(r) for r in reversed(rings)]  # bottom -> top for outward normals
    mid = ncol // 2
    verts = []
    index = {}
    for i, ring in enumerate(rows):
        for j, p in enumerate(ring):
            index[(i, j, 0)] = len(verts)
            if j == mid and p.z < SLIT_TOP:
                # the slit opens toward the hem: left lip moves +X, right lip -X
                gap = 0.014 * min(1.0, (SLIT_TOP - p.z) / (SLIT_TOP - 0.37))
                verts.append(p + V((gap, 0, 0)))
                index[(i, j, 1)] = len(verts)
                verts.append(p + V((-gap, 0, 0)))
            else:
                verts.append(p)
                index[(i, j, 1)] = index[(i, j, 0)]
    faces = []
    for i in range(len(rows) - 1):
        for j in range(ncol - 1):
            def vi(ii, jj):
                return index[(ii, jj, 1 if (jj == mid and j >= mid) else 0)]
            faces.append((vi(i, j), vi(i, j + 1), vi(i + 1, j + 1), vi(i + 1, j)))
    ob = K.mesh_object('skirt', verts, faces, [M['coat'], M['lining']])
    flip_outward(ob)
    K.solidify(ob, 0.008, offset=-1.0, mat_offset=1, rim_offset=0)
    return tag(ob, 1.0, 'skirt'), rows


def build_belt(M):
    rings = []
    for z, grow in ((1.074, 0.0), (1.09, 0.004), (1.108, 0.0)):
        rx, f, b = interp_rows(SKIRT, 1.105)
        rings.append([ring_pt(2 * math.pi * j / 28, z, rx + 0.006 + grow, f + 0.006 + grow, b + 0.006 + grow, 0.004, 2.15) for j in range(28)])
    ob = K.loft('belt', rings, closed=True, mats=[M['strap']])
    flip_outward(ob)
    K.solidify(ob, 0.006, offset=-1)
    return tag(ob, 0.8, 'belt')


def build_canisters(M):
    parts = []
    for sx in (1, -1):
        c = V((sx * 0.224, -0.008, 1.025))
        r = 0.046
        L0, L1 = -0.085, 0.07
        prof = [(L0 - 0.022, 0.0), (L0 - 0.014, r * 0.7), (L0 - 0.002, r * 0.97), (L1 - 0.004, r), (L1 + 0.01, r * 0.86), (L1 + 0.024, 0.0)]
        rings = []
        n = 12
        for y, rr in prof:
            rings.append([c + V((math.cos(2 * math.pi * j / n) * rr, y, math.sin(2 * math.pi * j / n) * rr)) for j in range(n)])
        body = K.loft('can', rings, closed=True, mats=[M['canister']])
        flip_outward_axis_y(body, c)
        parts.append(body)
        for y in (L0 + 0.016, L1 - 0.016):
            parts.append(K.torus('canring', c + V((0, y, 0)), (0, 1, 0), r + 0.0015, 0.0045, 12, 4, [M['gold']]))
        yf = L0 - 0.019
        parts.append(K.torus('bezel', c + V((0, yf, 0)), (0, 1, 0), 0.031, 0.0042, 14, 4, [M['gold']]))
        parts.append(K.cylinder('dial', 0.029, 0.029, c + V((0, yf + 0.004, 0)), c + V((0, yf - 0.003, 0)), 12, [M['dial']]))
        nd = K.box('needle', (0.0035, 0.002, 0.022), V((0, 0, 0)), [M['lining']])
        nd.data.transform(Matrix.Rotation(math.radians(-40 * sx), 4, 'Y'))
        nd.data.transform(Matrix.Translation(c + V((sx * 0.006, yf - 0.0045, 0.006))))
        parts.append(nd)
        parts.append(K.box('bracket', (0.04, 0.05, 0.03), c + V((-sx * 0.04, -0.005, 0.042)), [M['strap']], bevel=0.006, segs=1))
    ob = K.join(parts, 'canisters')
    K.ensure_uv(ob)
    return tag(ob, 0.8, 'gear')


def flip_outward_axis_y(ob, c):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        p = f.calc_center_median()
        d = p - c
        if abs(d.y) > 0.07:
            d = V((0, d.y, 0))
        else:
            d.y = 0
        if f.normal.dot(d) < 0:
            f.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()


def build_back_unit(M):
    parts = []
    c = V((0, 0.165, 1.062))
    parts.append(K.box('unit', (0.17, 0.05, 0.085), c, [M['strap']], bevel=0.014, segs=1))
    for sx in (1, -1):
        parts.append(K.box('knob', (0.034, 0.036, 0.05), c + V((sx * 0.048, 0.03, -0.008)), [M['gold']], bevel=0.012, segs=1))
    parts.append(K.box('bar', (0.08, 0.012, 0.012), c + V((0, 0.028, 0.03)), [M['gold']], bevel=0.004, segs=1))
    blade = K.mesh_object('blade', [V((0.085, 0.18, 1.08)), V((0.112, 0.18, 1.08)), V((0.096, 0.188, 0.94)), V((0.085, 0.196, 1.08)), V((0.112, 0.196, 1.08))],
                          [(0, 1, 2), (3, 2, 4), (0, 2, 3), (1, 4, 2), (0, 3, 4, 1)], [M['strap']])
    parts.append(blade)
    ob = K.join(parts, 'back_unit')
    K.ensure_uv(ob)
    return tag(ob, 0.8, 'gear')


ARM_Y = 0.015
ARM_Z = 1.49


def build_sleeves(M):
    parts = []
    prof = [(0.140, 0.040), (0.152, 0.056), (0.185, 0.060), (0.24, 0.056), (0.30, 0.053), (0.38, 0.051), (0.465, 0.050), (0.55, 0.048), (0.64, 0.046)]
    for sx in (1, -1):
        rings = []
        n = 12
        for x, r in prof:
            rings.append([V((sx * x, ARM_Y + math.cos(2 * math.pi * j / n) * r, ARM_Z + math.sin(2 * math.pi * j / n) * r * 1.02)) for j in range(n)])
        s = K.loft('sleeve', rings, closed=True, cap0=True, cap1=True, mats=[M['coat']])
        flip_outward_axis_x(s)
        parts.append(s)
        cuff = []
        for x, r in [(0.630, 0.052), (0.638, 0.060), (0.700, 0.060), (0.706, 0.056)]:
            cuff.append([V((sx * x, ARM_Y + math.cos(2 * math.pi * j / n) * r, ARM_Z + math.sin(2 * math.pi * j / n) * r)) for j in range(n)])
        c = K.loft('cuff', cuff, closed=True, cap0=True, cap1=True, mats=[M['coat']])
        flip_outward_axis_x(c)
        parts.append(c)
        parts.append(K.torus('cuffgold', (sx * 0.701, ARM_Y, ARM_Z), (1, 0, 0), 0.059, 0.0058, 18, 5, [M['gold']]))
    ob = K.join(parts, 'sleeves')
    K.ensure_uv(ob)
    return tag(ob, 1.0, 'sleeves')


def flip_outward_axis_x(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        p = f.calc_center_median()
        d = V((0, p.y - ARM_Y, p.z - ARM_Z))
        if d.length < 0.02:
            d = V((p.x, 0, 0))
        if f.normal.dot(d) < 0:
            f.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()


def build_arm_band(M):
    return tag(K.torus('armband', (0.285, ARM_Y, ARM_Z), (1, 0, 0), 0.058, 0.0085, 16, 5, [M['gold']]), 0.6, 'armband')


def build_pauldron(M):
    """Right shoulder only (character right = -X): three overlapping lames shaped as ellipsoid
    bands along the upper arm (rounded like the sheet's shells), the inner ones over the
    outer ones; dark metal with a sheen band along the front, thick gold rims; gold top lame."""
    parts = []
    O = V((-0.252, ARM_Y, 1.528))
    A, B, Cc = 0.150, 0.098, 0.078
    plates = [  # phi range along the arm (-90 inner end .. +90 outer end), scale, material
        (-84, -20, 1.17, 'gold'),
        (-52, 28, 1.085, 'metal'),
        (-12, 86, 1.0, 'metal'),
    ]
    th0, th1 = -118.0, 118.0
    for k, (p0, p1, sc, mat) in enumerate(plates):
        nu, nv = 5, 11
        verts, faces, fm = [], [], []
        for i in range(nu):
            phi = math.radians(p0 + (p1 - p0) * i / (nu - 1))
            s = math.cos(phi)
            for j in range(nv):
                th = math.radians(th0 + (th1 - th0) * j / (nv - 1))
                verts.append(V((O.x - A * sc * math.sin(phi), O.y + B * sc * s * math.sin(th), O.z + Cc * sc * s * math.cos(th))))
        for i in range(nu - 1):
            for j in range(nv - 1):
                a = i * nv + j
                faces.append((a, a + 1, a + nv + 1, a + nv))
                thc = th0 + (th1 - th0) * (j + 0.5) / (nv - 1)
                fm.append(1 if (mat == 'metal' and -62 < thc < -24) else 0)
        o = K.mesh_object(f'plate{k}', verts, faces, [M[mat], M['metal_hi']], face_mat=fm)
        flip_outward_axis_point(o, O)
        K.solidify(o, 0.007, offset=-1)
        parts.append(o)
        rim = [verts[(nu - 1) * nv + j] for j in range(nv)]
        parts.append(K.sweep(f'rim{k}', rim, 0.0075, n=4, mats=[M['gold']]))
        for jj in (0, nv - 1):
            edge = [verts[i * nv + jj] for i in range(nu)]
            parts.append(K.sweep(f'rimS{k}{jj}', edge, 0.0055, n=4, mats=[M['gold']]))
    ob = K.join(parts, 'pauldron')
    K.ensure_uv(ob)
    return tag(ob, 0.9, 'pauldron')


def build_gloves(M):
    parts = []
    for sx in (1, -1):
        X = lambda x: sx * x  # noqa: E731
        parts.append(K.cylinder('gwrist', 0.041, 0.044, (X(0.69), ARM_Y, ARM_Z), (X(0.722), ARM_Y, ARM_Z - 0.002), 10, [M['glove']]))
        parts.append(K.box('palm', (0.100, 0.090, 0.042), (X(0.758), ARM_Y - 0.002, ARM_Z - 0.004), [M['glove']], bevel=0.016, segs=1))
        fing = K.box('fingers', (0.078, 0.080, 0.027), V((0, 0, 0)), [M['glove']], bevel=0.011, segs=1)
        fing.data.transform(Matrix.Rotation(math.radians(10 * sx), 4, 'Y'))
        fing.data.transform(Matrix.Translation(V((X(0.843), ARM_Y + 0.003, ARM_Z - 0.013))))
        parts.append(fing)
        parts.append(K.sweep('thumb', [V((X(0.728), ARM_Y - 0.028, ARM_Z - 0.008)), V((X(0.768), ARM_Y - 0.058, ARM_Z - 0.016)), V((X(0.806), ARM_Y - 0.068, ARM_Z - 0.024))],
                             lambda t: 0.0155 - 0.003 * t, n=6, mats=[M['glove']]))
        parts.append(K.box('knuckle', (0.042, 0.072, 0.012), (X(0.792), ARM_Y, ARM_Z + 0.019), [M['gold']], bevel=0.005))
        for dy, xx in ((-0.018, 0.838), (0.016, 0.83)):
            fp = K.box('fplate', (0.024, 0.028, 0.008), V((0, 0, 0)), [M['gold']], bevel=0.003)
            fp.data.transform(Matrix.Rotation(math.radians(10 * sx), 4, 'Y'))
            fp.data.transform(Matrix.Translation(V((X(xx), ARM_Y + dy, ARM_Z + 0.004 - 0.006))))
            parts.append(fp)
    ob = K.join(parts, 'gloves')
    K.ensure_uv(ob)
    return tag(ob, 0.8, 'gloves')


def build_boots(M):
    parts = []
    for sx in (1, -1):
        x0 = sx * 0.095
        n = 12
        rings = []
        for z, rx, ry in [(0.09, 0.052, 0.058), (0.14, 0.054, 0.057), (0.205, 0.056, 0.058), (0.216, 0.051, 0.052)]:
            rings.append([V((x0 + math.sin(2 * math.pi * j / n) * rx, -math.cos(2 * math.pi * j / n) * ry, z)) for j in range(n)])
        sh = K.loft('shaft', rings, closed=True, cap1=True, mats=[M['boots']])
        flip_outward(sh, lambda z: V((x0, 0, z)))
        parts.append(sh)
        band = []
        for z, r in [(0.122, 0.059), (0.128, 0.063), (0.192, 0.063), (0.198, 0.059)]:
            band.append([V((x0 + math.sin(2 * math.pi * j / n) * r, -math.cos(2 * math.pi * j / n) * r * 1.03, z)) for j in range(n)])
        bo = K.loft('band', band, closed=True, mats=[M['boots']])
        flip_outward(bo, lambda z: V((x0, 0, z)))
        parts.append(bo)
        parts.append(K.box('flap', (0.016, 0.062, 0.064), (x0 + sx * 0.064, -0.012, 0.16), [M['boots']], bevel=0.006))
        # foot upper: superellipse sections along -Y (y, half width, top height) on the sole
        secs = [(0.075, 0.030, 0.082), (0.06, 0.045, 0.104), (0.03, 0.054, 0.12), (-0.02, 0.058, 0.118), (-0.08, 0.061, 0.098),
                (-0.14, 0.063, 0.087), (-0.19, 0.062, 0.079), (-0.228, 0.053, 0.069), (-0.252, 0.035, 0.059), (-0.263, 0.014, 0.051)]
        floor = 0.026
        m = 10
        frs = []
        for y, w, top in secs:
            ring = []
            for j in range(m):
                a = 2 * math.pi * j / m
                s, c = math.sin(a), math.cos(a)
                zz = floor + (top - floor) * (0.5 + 0.5 * math.copysign(abs(s) ** 0.75, s))
                ring.append(V((x0 + w * math.copysign(abs(c) ** 0.8, c), y, zz)))
            frs.append(ring)
        foot = K.loft('foot', frs, closed=True, cap0=True, cap1=True, mats=[M['boots']])
        flip_outward_axis_point_list(foot, [V((x0, y, floor + (top - floor) * 0.5)) for y, w, top in secs])
        parts.append(foot)
        # sole: slab with vertical sides following the foot outline (+ lip), toe lifted a bit
        outline = [(secs[0][0] + 0.007, secs[0][1] + 0.004)] + [(y, w + 0.007) for y, w, _ in secs[1:-1]] + [(secs[-1][0] - 0.008, secs[-1][1] + 0.016)]
        loop = [V((x0 + w, y, 0)) for y, w in outline] + [V((x0 - w, y, 0)) for y, w in reversed(outline)]
        sole_rings = []
        for zz, shrink in ((0.0, 0.004), (0.005, 0.0), (0.023, 0.0), (floor + 0.002, 0.003)):
            ring = []
            for p in loop:
                toe = max(0.0, (-0.2 - p.y) / 0.07)
                ring.append(V((x0 + (p.x - x0) * (1 - shrink / max(abs(p.x - x0), 1e-3)), p.y, zz + 0.011 * toe)))
            sole_rings.append(ring)
        sole = K.loft('sole', sole_rings, closed=True, cap0=True, cap1=True, mats=[M['sole']])
        flip_outward(sole, lambda z, x0=x0: V((x0, -0.09, z)))
        sole.data.set_sharp_from_angle(angle=math.radians(50))
        parts.append(sole)
    ob = K.join(parts, 'boots')
    K.ensure_uv(ob)
    return tag(ob, 1.0, 'boots')


def flip_outward_axis_foot(ob, x0):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        p = f.calc_center_median()
        d = V((p.x - x0, 0, p.z - 0.05))
        if abs(f.normal.y) > 0.8:
            d = V((0, p.y + 0.08, 0))
        if f.normal.dot(d) < 0:
            f.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()


def build_chest_gear(M):
    parts = []
    path = K.catmull([V((0.11, -0.082, 1.535)), V((0.065, -0.118, 1.47)), V((0.0, -0.124, 1.39)), V((-0.065, -0.116, 1.30)), V((-0.12, -0.096, 1.21))], 4)
    parts.append(K.sweep('strap', path, (0.0035, 0.0135), n=6, mats=[M['strap']], up=V((0, -1, 0))))
    # buckle: dark plate + gold square frame, tilted along the strap
    c = V((0.034, -0.129, 1.432))
    sq = []
    for a in range(0, 360, 30):
        t = math.radians(a + 45)
        k = 0.02 / max(abs(math.cos(t)), abs(math.sin(t)))
        sq.append(V((math.cos(t) * k, 0, math.sin(t) * k)))
    fr = K.sweep('buckle', sq + [sq[0]], 0.0035, n=5, mats=[M['gold']], cap=False)
    pl = K.box('buckleplate', (0.03, 0.004, 0.03), V((0, 0.003, 0)), [M['strap']])
    for o in (fr, pl):
        o.data.transform(Matrix.Rotation(math.radians(-38), 4, 'Y'))
        o.data.transform(Matrix.Translation(c))
        parts.append(o)
    chain = K.catmull([V((0.056, -0.035, 1.565)), V((0.045, -0.088, 1.525)), V((0.0, -0.121, 1.478)), V((-0.045, -0.088, 1.525)), V((-0.056, -0.035, 1.565))], 5)
    parts.append(K.sweep('chain', chain, 0.0024, n=4, mats=[M['gold']], cap=False))
    gem = bmesh.new()
    pts = [V((0, -0.130, 1.474)), V((0, -0.130, 1.436)), V((0.012, -0.130, 1.455)), V((-0.012, -0.130, 1.455)), V((0, -0.137, 1.455)), V((0, -0.123, 1.455))]
    vv = [gem.verts.new(p) for p in pts]
    for a, b, c2 in [(0, 2, 4), (0, 4, 3), (0, 3, 5), (0, 5, 2), (1, 4, 2), (1, 3, 4), (1, 5, 3), (1, 2, 5)]:
        gem.faces.new((vv[a], vv[b], vv[c2]))
    me = bpy.data.meshes.new('gem')
    gem.to_mesh(me)
    gem.free()
    go = bpy.data.objects.new('gem', me)
    K.link(go)
    go.data.materials.append(M['pendant'])
    bmesh_recalc(go)
    parts.append(go)
    ob = K.join(parts, 'chest_gear')
    K.ensure_uv(ob)
    return tag(ob, 0.6, 'chest')


def bmesh_recalc(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


def build_piping(M, coat_rings, collar_rings):
    """Gold piping along the coat front edges (collar tip -> h 1.03) and the collar top."""
    parts = []
    off = 0.006
    for side in (0, -1):
        pts = [r[side] for r in collar_rings][::-1] + [r[side] for r in coat_rings][::-1]
        pts = [p + V((0, -off, 0)) for p in pts]
        pts = [p for p in pts if p.z > 1.075]
        parts.append(K.sweep('pipe', pts, 0.0042, n=5, mats=[M['gold']]))
    top = collar_rings[-1]
    parts.append(K.sweep('pipetop', [p + V((0, 0, 0.003)) for p in top], 0.0045, n=5, mats=[M['gold']]))
    # skirt front edges just under the belt (gold until ~1.03)
    for sx in (1, -1):
        pts = []
        for z in np.linspace(1.10, 1.02, 5):
            rx, f, b = interp_rows(SKIRT, z)
            th = theta_for_lateral(interp_pts(SKIRT_EDGE, z), rx, 2.0)
            th = th if sx > 0 else 2 * math.pi - th
            pts.append(ring_pt(th, z, rx + 0.004, f + 0.004, b, 0.004, 2.15))
        parts.append(K.sweep('pipeskirt', pts, 0.004, n=5, mats=[M['gold']]))
    ob = K.join(parts, 'piping')
    K.ensure_uv(ob)
    return tag(ob, 0.5, 'piping')


def build_emblem(M, crest):
    """Back crest decal: a curved patch on the coat back carrying the cut-out texture."""
    half = crest['half']
    hc = crest['h_c']
    n = 10
    verts, uvs = [], []
    for i in range(n + 1):
        for j in range(n + 1):
            u = j / n
            v = i / n
            lat = (u - 0.5) * 2 * half  # character's left on the back view = -lat on screen
            z = hc + (v - 0.5) * 2 * half
            rx, f, b = interp_rows(COAT_UPPER, z)[:3]
            th = math.pi - math.asin(max(-0.98, min(0.98, lat / rx)))
            p = ring_pt(th, z, rx + 0.0035, f, b + 0.0035, 0, 2.4)
            verts.append(p)
            uvs.append((1 - u, v))
    faces = []
    for i in range(n):
        for j in range(n):
            a = i * (n + 1) + j
            faces.append((a, a + 1, a + n + 2, a + n + 1))
    ob = K.mesh_object('emblem', verts, faces, [M['emblem']], uvs=uvs)
    flip_outward(ob)
    ob['no_outline'] = True
    return tag(ob, 0.0, 'emblem')


# =============================================================================================
# Rig
# =============================================================================================

COAT_CHAINS = [  # (name, theta deg) — chain bones along the skirt
    ('coatFL', 62), ('coatSL', 104), ('coatBL', 150), ('coatBR', 210), ('coatSR', 256), ('coatFR', 298),
]


def skirt_point(theta_deg, t):
    """Point on the skirt mid-surface at angle theta and parameter t (0 = belt, 1 = hem)."""
    th = math.radians(theta_deg)
    hem = skirt_hem(theta_deg)
    z = 1.08 + t * (hem - 1.08)
    rx, f, b = interp_rows(SKIRT, z)
    return ring_pt(th, z, rx - 0.004, f - 0.004, b - 0.004, 0.004, 2.15)


def extra_bones():
    ex = []
    for name, th in COAT_CHAINS:
        pts = [skirt_point(th, t) for t in (0.0, 0.34, 0.67, 1.0)]
        for k in range(3):
            ex.append({'name': f'{name}{k}', 'head': pts[k], 'tail': pts[k + 1], 'parent': 'hips' if k == 0 else f'{name}{k - 1}'})
    for sx, s in ((1, 'L'), (-1, 'R')):
        ex.append({'name': f'fingers{s}', 'head': V((sx * 0.803, ARM_Y + 0.002, ARM_Z - 0.008)), 'tail': V((sx * 0.846, ARM_Y + 0.002, ARM_Z - 0.008)), 'parent': f'hand{s}'})
        ex.append({'name': f'fingertips{s}', 'head': V((sx * 0.846, ARM_Y + 0.002, ARM_Z - 0.008)), 'tail': V((sx * 0.889, ARM_Y + 0.002, ARM_Z - 0.008)), 'parent': f'fingers{s}'})
        ex.append({'name': f'thumb{s}', 'head': V((sx * 0.725, ARM_Y - 0.03, ARM_Z - 0.006)), 'tail': V((sx * 0.80, ARM_Y - 0.066, ARM_Z - 0.016)), 'parent': f'hand{s}'})
    return ex


def build_rig(parts: dict):
    joints = K.game_joints(SPEC, tpose=True)
    tails = {
        'handL': V((0.803, ARM_Y, ARM_Z)), 'handR': V((-0.803, ARM_Y, ARM_Z)),
        'footL': V((0.095, -0.16, 0.03)), 'footR': V((-0.095, -0.16, 0.03)),
        'head': V((0, 0.003, 1.85)),
        'shoulderL': joints['upperArmL'], 'shoulderR': joints['upperArmR'],
        'thighL': joints['shinL'], 'thighR': joints['shinR'],
    }
    arm = K.build_armature('kaiser_rig', joints, extra_bones(), tails)
    core = K.GAME_BONES
    chains = [f'{n}{k}' for n, _ in COAT_CHAINS for k in range(3)]
    hands = {s: [f'hand{s}', f'fingers{s}', f'fingertips{s}', f'thumb{s}', f'foreArm{s}'] for s in 'LR'}
    t0 = time.time()
    # --- automatic weights per piece, restricted to the bones that piece may follow ----------
    K.bind_auto(parts['body'], arm, ['hips', 'spine', 'chest', 'neck', 'shoulderL', 'shoulderR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'])
    K.bind_auto(parts['coat_upper'], arm, ['hips', 'spine', 'chest', 'neck', 'shoulderL', 'shoulderR', 'upperArmL', 'upperArmR'])
    K.bind_auto(parts['sleeves'], arm, ['chest', 'shoulderL', 'shoulderR', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR'])
    K.bind_auto(parts['collar'], arm, ['chest', 'neck'])
    K.bind_auto(parts['skirt'], arm, ['hips'] + chains)
    K.bind_auto(parts['gloves'], arm, hands['L'] + hands['R'])
    K.bind_auto(parts['boots'], arm, ['shinL', 'footL', 'shinR', 'footR'])
    K.bind_auto(parts['chest_gear'], arm, ['spine', 'chest', 'neck'])
    for name in ('head', 'hair', 'mask'):
        K.bind_rigid(parts[name], arm, 'head')
    pauldron_weights(parts['pauldron'], arm)
    K.bind_rigid(parts['armband'], arm, 'upperArmL')
    for name in ('belt', 'canisters', 'back_unit'):
        K.bind_rigid(parts[name], arm, 'hips')
    # --- corrections --------------------------------------------------------------------------
    fix_weights(parts, arm)
    K.transfer_weights(parts['coat_upper'], parts['jacket_hem'], arm)
    K.transfer_weights(parts['coat_upper'], parts['emblem'], arm)
    piping_weights(parts, arm)
    print(f'[rig] weights in {time.time() - t0:.1f}s')
    return arm


def fix_weights(parts, arm):
    """Post-process the bone-heat result where it is known to go wrong for clothes."""
    # skirt: no leg influence by construction; the top band sticks to the hips
    sk = parts['skirt']
    tab = K.weights_table(sk)
    for v, w in zip(sk.data.vertices, tab):
        k = max(0.0, min(1.0, (1.06 - v.co.z) / 0.06))
        if k < 1:
            for b in list(w):
                if b != 'hips':
                    w[b] *= k
            w['hips'] = w.get('hips', 0) + (1 - k)
    K.set_weights(sk, tab)
    K.clean_weights(sk)
    # coat torso: the shoulder area follows the upper arm only near the arm hole
    co = parts['coat_upper']
    tab = K.weights_table(co)
    for v, w in zip(co.data.vertices, tab):
        for s, sx in (('L', 1), ('R', -1)):
            b = f'upperArm{s}'
            if b in w:
                k = max(0.0, min(1.0, (v.co.x * sx - 0.12) / 0.06))
                w[b] *= k
    K.set_weights(co, tab)
    K.clean_weights(co)
    # stand-up collar: rides on the chest, only its upper rim follows the neck a little
    col = parts['collar']
    tab = []
    for v in col.data.vertices:
        t = max(0.0, min(1.0, (v.co.z - 1.56) / 0.12))
        tab.append({'chest': 1 - 0.35 * t, 'neck': 0.35 * t})
    K.set_weights(col, tab)
    K.clean_weights(col)
    for name in ('body', 'sleeves', 'gloves', 'boots', 'chest_gear'):
        K.clean_weights(parts[name])


def piping_weights(parts, arm):
    """Piping follows the garment it sits on (nearest of coat / collar / skirt)."""
    pip = parts['piping']
    srcs = [parts['coat_upper'], parts['collar'], parts['skirt']]
    tabs = []
    from mathutils.bvhtree import BVHTree
    trees = []
    for s in srcs:
        verts = [s.matrix_world @ v.co for v in s.data.vertices]
        tris = []
        for p in s.data.polygons:
            vs = list(p.vertices)
            for i in range(1, len(vs) - 1):
                tris.append((vs[0], vs[i], vs[i + 1]))
        trees.append((BVHTree.FromPolygons(verts, tris), verts, tris, K.weights_table(s)))
    out = []
    for v in pip.data.vertices:
        p = v.co
        best = None
        for tree, verts, tris, tab in trees:
            loc, nrm, idx, dist = tree.find_nearest(p)
            if idx is not None and (best is None or dist < best[0]):
                best = (dist, loc, verts, tris[idx], tab)
        _, loc, verts, (a, b, c), tab = best
        wa, wb, wc = K.barycentric(loc, verts[a], verts[b], verts[c])
        w = {}
        for vi, fct in ((a, wa), (b, wb), (c, wc)):
            for kk, x in tab[vi].items():
                w[kk] = w.get(kk, 0) + x * fct
        out.append(w)
    K.set_weights(pip, out)
    K.clean_weights(pip)
    K.add_armature_modifier(pip, arm)
    tabs.append(out)


# =============================================================================================
# Posing, renders, comparisons
# =============================================================================================

def pose_sheet(arm, P=SHEET_POSE):
    K.pose_reset(arm)
    K.pose_rotate(arm, 'upperArmL', (0, 1, 0), P['arm'])
    K.pose_rotate(arm, 'upperArmR', (0, 1, 0), -P['arm'])
    K.pose_rotate(arm, 'handL', (0, 1, 0), P['hand'])
    K.pose_rotate(arm, 'handR', (0, 1, 0), -P['hand'])
    K.pose_rotate(arm, 'thighL', (0, 1, 0), -P['leg'])
    K.pose_rotate(arm, 'thighR', (0, 1, 0), P['leg'])
    K.pose_rotate(arm, 'footL', (0, 0, 1), P['foot'])
    K.pose_rotate(arm, 'footR', (0, 0, 1), -P['foot'])


def view_camera(S: Sheets, view: str, scale: int = 1):
    sh = S.front if view == 'front' else S.back
    W, H = sh.size
    s = sh.s
    if view == 'front':
        x = (W / 2 - sh.cx) * s
        loc = (x, -10, (sh.sole - H / 2) * s)
        rot = (90, 0, 0)
        light = (-0.45, -0.6, 0.66)
    else:
        x = -(W / 2 - sh.cx) * s
        loc = (x, 10, (sh.sole - H / 2) * s)
        rot = (90, 0, 180)
        light = (0.45, 0.6, 0.66)
    K.ortho_camera('cam_' + view, loc, rot, H * s)
    K.set_light_dir(light)
    return W * scale, H * scale


def render_views(S: Sheets, objs, tag_name: str, scale_front=2, samples=16):
    out = {}
    added = K.add_outlines(objs, 0.0034)
    K.material_mode('render')
    try:
        for view, sc in (('front', scale_front), ('back', 1)):
            w, h = view_camera(S, view, sc)
            K.setup_render(w, h, samples)
            path = os.path.join(OUT_DIR, '_work', f'{tag_name}_{view}.png')
            os.makedirs(os.path.dirname(path), exist_ok=True)
            K.render_to(path)
            out[view] = path
    finally:
        K.remove_outlines(added)
        K.material_mode('export')
    return out


# =============================================================================================
# Main
# =============================================================================================

def build(args):
    t0 = time.time()
    K.reset_scene()
    S = Sheets()
    pal = sample_palette(S)
    os.makedirs(TEX_DIR, exist_ok=True)
    emblem_png = os.path.join(TEX_DIR, 'kaiser_emblem.png')
    face_png = os.path.join(TEX_DIR, 'kaiser_face.png')
    crest = SM.cut_emblem(S.back, emblem_png, SM.lit_and_shade(S.back, -0.2, 0.75, 0.2, 0.95, is_dark)[0] or (51, 48, 55), centre_h=1.44, half_w_m=0.15, half_h_m=0.10)
    make_face_texture(face_png, pal)
    M = build_materials(pal, emblem_png, face_png)
    K.toon_group()

    parts = {}
    parts['body'] = build_body(M)
    parts['head'] = build_head(M)
    parts['mask'], mask_outer, mask_holes = build_mask(S, M)
    parts['hair'] = build_hair(S, M)
    parts['coat_upper'], coat_rings = build_coat_upper(M)
    parts['jacket_hem'] = build_jacket_hem(M)
    parts['collar'], collar_rings = build_collar(M)
    parts['skirt'], skirt_rows = build_skirt(M)
    parts['belt'] = build_belt(M)
    parts['canisters'] = build_canisters(M)
    parts['back_unit'] = build_back_unit(M)
    parts['sleeves'] = build_sleeves(M)
    parts['armband'] = build_arm_band(M)
    parts['pauldron'] = build_pauldron(M)
    parts['gloves'] = build_gloves(M)
    parts['boots'] = build_boots(M)
    parts['chest_gear'] = build_chest_gear(M)
    parts['piping'] = build_piping(M, coat_rings, collar_rings)
    parts['emblem'] = build_emblem(M, crest)
    for o in parts.values():
        K.ensure_uv(o)
    tris = K.tri_count(parts.values())
    print(f'[build] {len(parts)} pieces, {tris} triangles, {time.time() - t0:.1f}s')
    per = {k: K.tri_count([o]) for k, o in parts.items()}
    print('[build] triangles per piece:', per)

    arm = build_rig(parts)
    meas = S.log()
    meas['spec'] = SPEC
    meas['sheet_pose'] = SHEET_POSE
    meas['triangles'] = tris
    meas['crest'] = crest
    meas['mask_outline_points'] = len(mask_outer)
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, 'kaiser_measurements.json'), 'w') as fh:
        json.dump(meas, fh, indent=1, default=float)
    return S, parts, arm, tris, M


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--iter', type=int, default=0, help='write docs/art/blender/kaiser_v<N>.png')
    ap.add_argument('--note', type=str, default='')
    ap.add_argument('--poses', action='store_true')
    ap.add_argument('--export', action='store_true')
    ap.add_argument('--samples', type=int, default=16)
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    args = ap.parse_args(argv)
    S, parts, arm, tris, M = build(args)
    objs = list(parts.values())
    if args.iter:
        pose_sheet(arm)
        paths = render_views(S, objs, f'v{args.iter}', samples=args.samples)
        rf = Image.open(paths['front']).convert('RGBA')
        rb = Image.open(paths['back']).convert('RGBA')
        title = f'KAISER v{args.iter} — render | scheda   ({tris} triangoli)  {args.note}'
        mets = compare.compose(os.path.join(OUT_DIR, f'kaiser_v{args.iter}.png'), title, [(S.front, rf, 'FRONTE'), (S.back, rb, 'RETRO')])
        for v, m in zip(('front', 'back'), mets):
            print(f'[compare] {v}: IoU {m["iou"] * 100:.1f}%  width err {m["width_err_mean"] * 100:.2f} cm  worst {m["worst_rows"]}')
        K.pose_reset(arm)
    if args.poses:
        import kaiser_poses
        kaiser_poses.render_poses(S, parts, arm, OUT_DIR, render_views, M=M, chains=COAT_CHAINS)
    if args.export:
        export(parts, arm)


def export(parts, arm):
    K.pose_reset(arm)
    K.material_mode('export')
    objs = [o for o in parts.values()]
    for o in objs:
        K.add_armature_modifier(o, arm)
    model = K.join(objs, 'kaiser')
    # glTF extras read by the game loader
    arm['ggg_spec'] = json.dumps(SPEC)
    # coat-flap chains: bones + joint positions (model space, game axes) for the verlet chains
    arm['ggg_chains'] = json.dumps([{'bones': [f'{n}{k}' for k in range(3)], 'joints': [[round(c, 5) for c in K.b2g(skirt_point(th, t))] for t in (0.0, 0.34, 0.67, 1.0)]}
                                    for n, th in COAT_CHAINS])
    gl = lambda p: list(K.b2g(p))  # noqa: E731
    arm['ggg_sockets'] = json.dumps({
        'gearL': gl(V((0.222, -0.13, 1.03))), 'gearR': gl(V((-0.222, -0.13, 1.03))), 'nozzle': gl(V((0, 0.21, 1.05))),
        'eyes': gl(V((0, -0.09, EYE_H))),
    })
    K.export_glb(GLB_PATH, [model, arm])
    print('[export]', GLB_PATH, os.path.getsize(GLB_PATH) // 1024, 'KB')





def flip_outward_axis_line(ob, a0, axis):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        p = f.calc_center_median()
        rel = p - (a0 + axis * axis.dot(p - a0))
        if f.normal.dot(rel) < 0:
            f.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()


def flip_outward_axis_point(ob, c):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        if f.normal.dot(f.calc_center_median() - c) < 0:
            f.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()





def flip_outward_axis_point_list(ob, centres):
    """Normals away from the nearest of a set of interior points (lofts along a path)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        p = f.calc_center_median()
        c = min(centres, key=lambda q: (q - p).length)
        if f.normal.dot(p - c) < 0:
            f.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()





def lining_near_edges(ob, rows, edges, p, keep_rad):
    """Inner shell shows the magenta lining only near the front opening (where it is seen);
    elsewhere it gets the coat colour so folds at the shoulders never flash magenta."""
    for f in ob.data.polygons:
        if f.material_index != 1:
            continue
        c = f.center
        rx = interp_rows(rows, c.z)[0]
        t0 = theta_for_lateral(interp_pts(edges, c.z), rx, p)
        th = math.atan2(c.x, -c.y) % (2 * math.pi)
        d = min(abs(th - t0), abs(th - (2 * math.pi - t0)))
        if d > keep_rad:
            f.material_index = 0


def pauldron_weights(ob, arm):
    """The pauldron rides the shoulder: inner lames mostly on the clavicle (shoulderR), outer
    lames mostly on the upper arm, so it tilts ~half as much as the arm like on the sheet."""
    tab = []
    for v in ob.data.vertices:
        u = max(0.0, min(1.0, (-v.co.x - 0.14) / 0.24))
        a = 0.35 + 0.5 * u
        tab.append({'upperArmR': a, 'shoulderR': 1 - a})
    K.set_weights(ob, tab)
    K.add_armature_modifier(ob, arm)


if __name__ == '__main__':
    main()
