"""
Worked example, stage 1: the head of an original character, an old New York park chess
master ("Zugzwang"). Caricature choices: big bulbous nose, heavy furrowed brow, drooping lids,
big ears, walrus moustache that hides the mouth, long beard, flat cap, half-moon glasses.

Head-local frame: eye line at z = 0, front = -Y, metres.
Run:  /root/blender-venv/bin/python chess_master_head.py --out <dir> [--clay] [--iter N]
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import numpy as np  # noqa: E402

from charkit import sdf as S  # noqa: E402

E = S.ellipsoid
RC = S.round_cone


# =============================================================================================
# Skin
# =============================================================================================

def ear() -> S.SDF:
    """Right/left ear modelled in its own frame: X = outwards, -Y = towards the face, Z = up."""
    base = E((0.004, 0.0, 0.0), (0.006, 0.019, 0.033))
    helix = S.intersect(S.torus((0.007, 0.002, 0.004), 0.0175, 0.0042, R=S.rot(0, 90, 0), sx=1.0, sy=0.62),
                        S.plane((0, -0.004, 0), (0, -1, 0)), k=0.004)
    lobe = E((0.006, -0.002, -0.03), (0.005, 0.009, 0.011))
    tragus = E((0.002, -0.017, -0.006), (0.004, 0.004, 0.006))
    shell = S.blend(base, helix, lobe, tragus, k=0.006)
    concha = E((0.012, -0.004, -0.004), (0.006, 0.011, 0.014))
    fossa = E((0.012, 0.002, 0.014), (0.004, 0.008, 0.009))
    return S.carve(shell, concha, fossa, k=0.003)


def almond(c, gaze_y: float, half_up: float, half_dn: float, width: float, tilt: float) -> S.SDF:
    """Eye opening seen from the front: intersection of two big circles (upper and lower lid
    arcs), extruded along the gaze (-Y). tilt (deg) droops the outer corner."""
    x, y, z = c
    def circle_for(h, sign):
        # radius so that a circle with sagitta h spans `width`
        R = (width * width / 4 + h * h) / (2 * h)
        return S.cylinder((0, 0, sign * (R - h)), R, 0.04, R=S.rot(90, 0, 0))
    shape = S.intersect(circle_for(half_up, -1), circle_for(half_dn, 1), k=0.0008)
    return S.place(shape, t=(x, y + gaze_y, z), R=S.rot(0, tilt, 0))


def eye_region(head: S.SDF, side: float, c, r_eye: float) -> S.SDF:
    """Sculptor's eyelids: a lid ball over the eyeball blended into the socket, then the almond
    opening cut through it. The skin stays tight around the eye (no dark gap)."""
    x, y, z = c
    socket = E((x, y - 0.032, z + 0.001), (0.019, 0.0175, 0.0135))
    head = S.carve(head, socket, k=0.008)
    lid_ball = S.sphere(c, r_eye + 0.0026)
    head = S.blend(head, lid_ball, k=0.0055)
    upper_fold = E((x + 0.004 * side, y - 0.0085, z + 0.0085), (0.016, 0.006, 0.0042), R=S.rot(0, -16 * side, 0))
    head = S.blend(head, upper_fold, k=0.004)
    opening = almond((x + 0.0008 * side, y, z - 0.0008), -0.03, 0.0058, 0.0043, 0.0275, -7 * side)
    opening = S.intersect(opening, S.sphere(c, r_eye + 0.0095), k=0.001)
    # cut only the lid in front of the eyeball: the skin closes again 1.5 mm inside the eyeball,
    # so the lid margins sit tight on the eye (no dark cavity around it)
    opening = S.carve(opening, S.sphere(c, r_eye - 0.0015))
    return S.carve(head, opening, k=0.0009)


def skin(eye_c=0.032, eye_y=-0.051, r_eye=0.0125) -> S.SDF:
    cranium = E((0, 0.012, 0.03), (0.074, 0.097, 0.087))
    forehead = E((0, -0.045, 0.045), (0.06, 0.045, 0.05))
    face = E((0, -0.033, -0.032), (0.058, 0.06, 0.062))
    cheek = E((0.051, -0.048, -0.016), (0.02, 0.022, 0.015)).mirror_x()
    brow = E((0.03, -0.074, 0.017), (0.03, 0.016, 0.013), R=S.rot(0, -14, 0)).mirror_x()
    glabella = S.sphere((0, -0.08, 0.016), 0.0115)
    muzzle = E((0, -0.07, -0.064), (0.032, 0.026, 0.024))
    chin = E((0, -0.066, -0.102), (0.024, 0.02, 0.019))
    jaw = S.tube([(0.057, 0.006, -0.058), (0.04, -0.035, -0.09), (0.017, -0.063, -0.104)], [0.013, 0.013, 0.012]).mirror_x()
    neck = RC((0, 0.014, -0.05), (0, 0.026, -0.17), 0.047, 0.05)
    temple_hollow = E((0.07, -0.03, 0.03), (0.008, 0.02, 0.02)).mirror_x()

    # nose: long bridge with a hump, drooping bulbous tip, wide flared wings
    bridge = S.smooth_tube([(0, -0.079, 0.008), (0, -0.092, -0.006), (0, -0.099, -0.018), (0, -0.104, -0.029)],
                           [0.0074, 0.0084, 0.008, 0.0095], samples=4, k=0.004)
    tip = E((0, -0.1065, -0.036), (0.0108, 0.0105, 0.0118), R=S.rot(-24, 0, 0))
    lobes = S.sphere((0.0052, -0.1095, -0.0395), 0.0074).mirror_x()
    tip = S.blend(tip, lobes, k=0.004)
    columella = RC((0, -0.102, -0.046), (0, -0.089, -0.05), 0.005, 0.0045)
    ala = E((0.0158, -0.091, -0.041), (0.0082, 0.0115, 0.0098), R=S.rot(0, 0, 22)).mirror_x()
    nose = S.blend(bridge, tip, columella, ala, k=0.0065)
    nostril = E((0.0085, -0.096, -0.0505), (0.004, 0.0065, 0.003), R=S.rot(0, 0, 22)).mirror_x()
    nose = S.carve(nose, nostril, k=0.0018)
    ala_groove = S.capsule((0.0142, -0.099, -0.031), (0.021, -0.087, -0.037), 0.0015).mirror_x()
    nose = S.carve(nose, ala_groove, k=0.002)

    head = S.blend(cranium, forehead, face, cheek, brow, glabella, muzzle, chin, jaw, neck, k=0.018)
    head = S.blend(head, nose, k=0.008)
    head = S.carve(head, temple_hollow, k=0.012)
    cheek_hollow = E((0.05, -0.055, -0.045), (0.012, 0.012, 0.016)).mirror_x()
    head = S.carve(head, cheek_hollow, k=0.014)
    for side in (1, -1):
        head = eye_region(head, side, (side * eye_c, eye_y, 0.0), r_eye)
    bags = E((0.033, -0.059, -0.0135), (0.0155, 0.0052, 0.0052), R=S.rot(0, 8, 0)).mirror_x()
    head = S.blend(head, bags, k=0.004)
    # ears
    ears = S.place(ear(), t=(0.071, 0.012, -0.012), R=S.rot(-14, 0, 0)).mirror_x()
    head = S.blend(head, ears, k=0.006)

    # wrinkles: forehead lines, frown lines, crow's feet, nasolabial crease
    forehead_zone = E((0, -0.07, 0.055), (0.05, 0.04, 0.026))
    frown_zone = E((0, -0.085, 0.03), (0.011, 0.02, 0.016))
    crow_zone = E((0.055, -0.045, 0.0), (0.012, 0.03, 0.014)).mirror_x()
    lines = S.masked(S.grooves((0, 0, 1), 0.0105, width=0.26, wobble=0.22, wobble_freq=24), forehead_zone, 0.012)
    frown = S.masked(S.grooves((1, 0, 0), 0.009, width=0.18, wobble=0.12, wobble_freq=40, seed=3), frown_zone, 0.005)
    crows = S.masked(S.grooves((0, 0.25, 1), 0.0045, width=0.3, wobble=0.2, wobble_freq=60, seed=5), crow_zone, 0.006)
    head = head.displace(lines, -0.0009).displace(frown, -0.0008).displace(crows, -0.0005)
    # skin pores / unevenness (very subtle; reads as a sculpted surface instead of plastic)
    head = head.displace(lambda p: S.fbm(p, 180, 3, seed=11), 0.00018)
    return head


def eyes(eye_c=0.032, eye_y=-0.051, r_eye=0.0125) -> S.SDF:
    return S.sphere((eye_c, eye_y, 0.0), r_eye).mirror_x()


# =============================================================================================
# Hair: beard, moustache, brows, side tufts
# =============================================================================================

def hair_strands(scale=0.012, depth=1.0):
    """Fine strand grooves elongated along the local flow (mostly downwards)."""
    fine = S.ridged(lambda p: S.perlin(p, 1.0 / scale, seed=22))
    return lambda p: depth * S.stretched(fine, (0, 0.25, 1), 0.12)(p)


def _sides(fn):
    """Builds locks for both sides from a left-side (+X) generator with different seeds, so the
    two halves are similar but not mirror copies (symmetry reads as artificial)."""
    return S.union(fn(1.0, 0), fn(-1.0, 1))


def beard() -> S.SDF:
    def side(sx, seed):
        J = S.jitter(100 + seed, 1.0)
        roots, paths = [], []
        rows = [
            # (root curve along the jaw, from sideburn to chin), lock length factor
            ([(0.068, -0.002, -0.014), (0.064, -0.016, -0.045), (0.056, -0.032, -0.07), (0.043, -0.054, -0.09), (0.023, -0.074, -0.104), (0.004, -0.081, -0.109)], 1.0),
            ([(0.052, -0.058, -0.052), (0.04, -0.074, -0.066), (0.024, -0.088, -0.078), (0.008, -0.094, -0.084)], 0.8),
        ]
        out = []
        i = 0
        for curve, lf in rows:
            pts = S.catmull(curve, 3)
            for r in pts:
                j = J(i) * np.array([0.004, 0.004, 0.004], np.float32)
                x, y, z = float(r[0]), float(r[1]), float(r[2])
                centre = 1 - min(x / 0.068, 1)          # 0 at the sideburn, 1 at the chin
                L = (0.09 + 0.12 * centre) * lf
                p0 = np.array([x * sx, y, z], np.float32)
                p1 = np.array([x * 0.92 * sx, y - 0.016 - 0.01 * centre, z - 0.028], np.float32) + j
                p2 = np.array([x * 0.55 * sx, -0.093 + 0.01 * (1 - centre), z - 0.03 - L * 0.45], np.float32) + j * 1.5
                p3 = np.array([x * 0.22 * sx + 0.006 * float(J(i + 50)[0]), -0.08 + 0.008 * centre, z - 0.03 - L], np.float32)
                rr = 0.0085 + 0.003 * float(J(i + 7)[1])
                out.append(S.lock([p0, p1, p2, p3], rr, rr * 1.45, 0.0016, strands=0.0011, strand_scale=0.0035, seed=i + 10 * seed))
                i += 1
        return S.Union(out, k=0.0035)
    locks = _sides(side)
    # a core so the locks never show gaps
    core = S.blend(E((0, -0.075, -0.115), (0.045, 0.03, 0.045)), RC((0, -0.08, -0.13), (0, -0.07, -0.22), 0.035, 0.012),
                   RC((0.058, -0.02, -0.04), (0.045, -0.05, -0.09), 0.012, 0.018).mirror_x(), k=0.02)
    return S.blend(S.grow(core, -0.004), locks, k=0.006)


def moustache() -> S.SDF:
    def side(sx, seed):
        J = S.jitter(200 + seed, 1.0)
        out = []
        roots = [(0.003, -0.107, -0.05), (0.011, -0.105, -0.053), (0.019, -0.101, -0.056), (0.026, -0.096, -0.06)]
        for i, (x, y, z) in enumerate(roots):
            j = J(i) * 0.003
            p0 = np.array([x * sx, y, z], np.float32)
            p1 = np.array([(x + 0.016) * sx, y + 0.002, z - 0.012], np.float32) + j
            p2 = np.array([(x + 0.028) * sx, y + 0.014, z - 0.03], np.float32) + j
            p3 = np.array([(x + 0.03 + 0.004 * i) * sx, y + 0.024, z - 0.052 - 0.004 * i], np.float32)
            out.append(S.lock([p0, p1, p2, p3], 0.0065, 0.0085, 0.0014, strands=0.0007, strand_scale=0.0025, seed=i + 7 * seed))
        return S.Union(out, k=0.003)
    return _sides(side)


def brows(skin_shape=None) -> S.SDF:
    skin_shape = skin_shape or _skin_cached()
    def side(sx, seed):
        J = S.jitter(300 + seed, 1.0)
        out = []
        guide = S.catmull([(0.006 * sx, -0.09, 0.012), (0.024 * sx, -0.09, 0.02), (0.043 * sx, -0.082, 0.024), (0.058 * sx, -0.068, 0.016)], 2)
        roots = S.snap(skin_shape, guide, offset=0.0015)
        for i, r in enumerate(roots):
            x, y, z = (float(v) for v in r)
            t = i / (len(roots) - 1)
            j = J(i) * 0.0015
            p0 = np.array([x, y, z], np.float32)
            p1 = np.array([x + (0.008) * sx, y + 0.0015 + 0.004 * t, z + 0.003], np.float32) + j * 0.5
            p2 = np.array([x + (0.015 + 0.004 * t) * sx, y + 0.0045 + 0.007 * t, z + 0.002 + 0.006 * t * t], np.float32) + j
            out.append(S.lock([p0, p1, p2], 0.0044, 0.0048, 0.0013, strands=0.0004, strand_scale=0.0018, seed=i + 5 * seed))
        return S.Union(out, k=0.0025)
    return _sides(side)


_SKIN = []


def _skin_cached():
    if not _SKIN:
        _SKIN.append(skin())
    return _SKIN[0]


def side_hair() -> S.SDF:
    def side(sx, seed):
        J = S.jitter(400 + seed, 1.0)
        out = []
        for i in range(7):
            t = i / 6
            x, y, z = 0.068 - 0.02 * t * t, -0.008 + 0.1 * t, 0.044 - 0.006 * t
            j = J(i) * 0.003
            p0 = np.array([x * sx, y, z], np.float32)
            p1 = np.array([(x + 0.004) * sx, y + 0.014, z - 0.014], np.float32) + j
            p2 = np.array([(x + 0.001) * sx, y + 0.022, z - 0.03 - 0.008 * t], np.float32) + j
            out.append(S.lock([p0, p1, p2], 0.0075, 0.0085, 0.0016, strands=0.0008, strand_scale=0.003, seed=i + 9 * seed))
        return S.Union(out, k=0.004)
    sides = _sides(side)
    J2 = S.jitter(450, 1.0)
    back = []
    for i in range(7):
        t = i / 6
        ang = np.radians(-60 + 120 * t)
        x, y, z = 0.058 * np.sin(ang), 0.085 + 0.012 * np.cos(ang), 0.034
        j2 = J2(i) * 0.003
        p0 = np.array([x, y, z], np.float32)
        p1 = np.array([x * 1.08, y + 0.012, z - 0.016], np.float32) + j2
        p2 = np.array([x * 1.02, y + 0.008, z - 0.036], np.float32) + j2
        back.append(S.lock([p0, p1, p2], 0.0085, 0.0095, 0.0018, strands=0.0008, strand_scale=0.003, seed=60 + i))
    return S.union(sides, S.Union(back, k=0.004))


# =============================================================================================
# Cap and glasses
# =============================================================================================

def cap() -> S.SDF:
    """Flat cap: a low band hugging the skull, a flat top panel sloping down to the front and a
    short stiff brim. Low profile: the top sits ~1.5 cm above the skull."""
    skull = E((0, 0.012, 0.035), (0.074, 0.097, 0.09))
    above_band = S.plane((0, 0, 0.048), (0, -0.12, -1))
    below_top = S.plane((0, 0, 0.07), (0, -0.12, 1))
    band = S.intersect(S.intersect(S.grow(skull, 0.0055), above_band, k=0.003), below_top, k=0.01)
    top = E((0, 0.0, 0.096), (0.088, 0.114, 0.027), R=S.rot(12, 0, 0))
    crown = S.blend(band, top, k=0.022)
    brim = S.round_box((0, -0.104, 0.057), (0.062, 0.03, 0.003), 0.0028, R=S.rot(18, 0, 0))
    brim = S.intersect(brim, E((0, -0.086, 0.05), (0.072, 0.05, 0.05)), k=0.006)
    button = S.sphere((0, -0.012, 0.118), 0.0055)
    c = S.union(S.blend(crown, brim, k=0.008), button)
    rib = S.grooves((1, 0, 1), 0.004, width=0.5, wobble=0.15, wobble_freq=80)
    return c.displace(rib, -0.00035)


def glasses() -> tuple:
    """Half-moon reading glasses low on the nose: frame (metal) and lenses (glass)."""
    lens_c = [(0.0215, -0.113, -0.02), (-0.0215, -0.113, -0.02)]
    frames, lenses = [], []
    for c in lens_c:
        ring = S.torus(c, 0.0135, 0.0011, R=S.rot(90, 0, 0), sy=0.9)
        ring = S.intersect(ring, S.plane((0, 0, c[2] + 0.002), (0, 0, 1)))
        frames.append(ring)
        top = S.capsule((c[0] - 0.0135, c[1], c[2] + 0.002), (c[0] + 0.0135, c[1], c[2] + 0.002), 0.0011)
        frames.append(top)
        disc = S.cylinder(c, 0.0128, 0.0006, R=S.rot(90, 0, 0))
        lenses.append(S.intersect(disc, S.plane((0, 0, c[2] + 0.002), (0, 0, 1))))
    bridge = S.smooth_tube([(0.008, -0.113, -0.018), (0.0, -0.112, -0.012), (-0.008, -0.113, -0.018)], 0.001, samples=4)
    temple = S.smooth_tube([(0.035, -0.112, -0.018), (0.063, -0.07, -0.01), (0.071, -0.01, -0.006), (0.069, 0.012, -0.022)],
                           0.0011, samples=5).mirror_x()
    return S.union(*frames, bridge, temple), S.union(*lenses)


# =============================================================================================
# Build
# =============================================================================================

def looks():
    """Painterly palette and colour zones per part (sRGB hex)."""
    from charkit.paint import Look, Zone
    nose_zone = S.blend(S.sphere((0, -0.106, -0.036), 0.016), S.sphere((0, -0.094, -0.02), 0.01), k=0.01)
    return {
        'skin': Look('#d7a184', zones=[
            Zone(nose_zone, '#bd5547', 0.65, 0.014),
            Zone(S.sphere((0.05, -0.06, -0.025), 0.022).mirror_x(), '#cc7262', 0.4, 0.02),
            Zone(S.sphere((0.075, 0.012, -0.012), 0.03).mirror_x(), '#c56656', 0.45, 0.015),
            Zone(E((0, -0.07, 0.05), (0.06, 0.04, 0.03)), '#e3bb8e', 0.35, 0.02),
            Zone(E((0.033, -0.06, -0.012), (0.018, 0.01, 0.009)).mirror_x(), '#8a5a68', 0.4, 0.008),
            Zone(E((0, -0.06, -0.09), (0.06, 0.05, 0.04)), '#a08f8c', 0.35, 0.02),
        ], ao_step=0.007, ao_strength=1.15, ao_tint='#6e231f', cavity=0.6, edge=0.35, top_light=0.3, var_amount=0.09, stroke_axis=(0.3, 0, 1), stroke_amount=0.07),
        'beard': Look('#dcd6cc', zones=[
            Zone(E((0, -0.1, -0.075), (0.03, 0.03, 0.022)), '#c4ad82', 0.5, 0.02),
            Zone(S.grow(E((0, -0.04, -0.06), (0.07, 0.07, 0.07)), 0.0), '#9d978f', 0.35, 0.03),
        ], ao_step=0.005, ao_strength=1.1, ao_tint='#4f4a52', cavity=0.6, edge=0.45, top_light=0.25,
           stroke_axis=(0, 0.25, 1), stroke_squash=0.12, stroke_freq=220, stroke_amount=0.06),
        'moustache': Look('#d8d0c2', zones=[Zone(E((0, -0.106, -0.055), (0.02, 0.012, 0.01)), '#b99a6a', 0.5, 0.015)],
                          ao_step=0.004, ao_strength=1.0, ao_tint='#4f4a52', cavity=0.6, edge=0.45, stroke_axis=(1, 0, -1), stroke_squash=0.15),
        'brows': Look('#e4ded4', ao_step=0.003, ao_tint='#4f4a52', cavity=0.5, edge=0.4, stroke_axis=(1, 0, 0), stroke_squash=0.15),
        'side_hair': Look('#dad4ca', ao_step=0.004, ao_tint='#4f4a52', cavity=0.6, edge=0.4, stroke_axis=(0, 1, -1), stroke_squash=0.15),
        'cap': Look('#5f5b50', ao_step=0.008, ao_tint='#2b2420', cavity=0.4, edge=0.35, top_light=0.25,
                    pattern=S.grooves((1, 0, 1), 0.006, width=0.5), pattern_color='#46433a', pattern_strength=0.6,
                    stroke_amount=0.03),
    }


PARTS = {
    # name: (builder, voxel, roughness, subsurface)
    'skin': (_skin_cached, 0.0009, 0.55, 0.12),
    'eyes': (eyes, 0.0006, 0.12, 0.0),
    'beard': (beard, 0.001, 0.7, 0.0),
    'moustache': (moustache, 0.0007, 0.7, 0.0),
    'brows': (brows, 0.0005, 0.7, 0.0),
    'side_hair': (side_hair, 0.0008, 0.7, 0.0),
    'cap': (cap, 0.0009, 0.85, 0.0),
}


def build(out: str, clay: bool, tag: str, views, samples: int, lens: float = 85, box=None, width=700, height=820) -> list:
    import time

    from charkit import paint as P
    from charkit import studio as ST

    ST.reset()
    objs = []
    LK = looks()
    t0 = time.time()
    for name, (fn, vox, rough, sss) in PARTS.items():
        t = time.time()
        shape = fn()
        v, f = S.mesh(shape, voxel=vox)
        ob = ST.mesh_from_arrays(name, v, f)
        if name == 'eyes':
            col = P.eye_colors(v, [(0.032, -0.051, 0.0), (-0.032, -0.051, 0.0)], [(0.08, -1, -0.12), (-0.03, -1, -0.12)], 0.0125)
        else:
            nrm = P.mesh_normals(v, f)
            col = P.paint(v, nrm, shape, LK[name])
        ST.set_vertex_colors(ob, col)
        ST.assign(ob, ST.principled(name, '#ffffff', rough=rough, sss=sss, attr='Col', sss_radius=(1.0, 0.4, 0.25)))
        objs.append(ob)
        print(f'{name}: {len(f)} tris in {time.time() - t:.1f}s')
    fr, ln = glasses()
    v, f = S.mesh(fr, voxel=0.0004)
    ob = ST.mesh_from_arrays('glasses_frame', v, f)
    ST.assign(ob, ST.principled('metal', '#c9a45c', rough=0.3, metal=1.0))
    objs.append(ob)
    v, f = S.mesh(ln, voxel=0.0004)
    ob = ST.mesh_from_arrays('glasses_lens', v, f)
    m = ST.principled('glass', '#ffffff', rough=0.05)
    m.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1.0
    ST.assign(ob, m)
    objs.append(ob)
    print(f'meshing+paint total {time.time() - t0:.1f}s')
    box = box or (np.array([-0.11, -0.16, -0.2]), np.array([0.11, 0.12, 0.15]))
    return ST.review(objs, out, f'head_{tag}', views=views, clay=clay, width=width, height=height, samples=samples, lens=lens, box=box)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--clay', action='store_true')
    ap.add_argument('--iter', default='v1')
    ap.add_argument('--samples', type=int, default=32)
    ap.add_argument('--face', action='store_true')
    a = ap.parse_args()
    from charkit import studio as ST
    if a.face:
        box = (np.array([-0.09, -0.13, -0.075]), np.array([0.09, 0.0, 0.06]))
        paths = build(a.out, a.clay, a.iter + '_face', ['front', 'three_quarter', 'side'], a.samples, lens=100, box=box, width=760, height=760)
        ST.sheet(paths, os.path.join(a.out, f'head_{a.iter}_face{"_clay" if a.clay else ""}_sheet.png'),
                 labels=['front', '3/4', 'side'], title=f'Zugzwang face {a.iter}', cell_h=640)
    else:
        views = ['front', 'three_quarter', 'side', (-150, 10)]
        paths = build(a.out, a.clay, a.iter, views, a.samples)
        ST.sheet(paths, os.path.join(a.out, f'head_{a.iter}{"_clay" if a.clay else ""}_sheet.png'),
                 labels=['front', '3/4', 'side', 'back 3/4'], title=f'Zugzwang head {a.iter}', cell_h=520)
