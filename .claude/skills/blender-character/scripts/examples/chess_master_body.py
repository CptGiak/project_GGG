"""
Worked example, stage 2: the full figure of "Zugzwang", the old park chess master.

Silhouette idea: a hunched question mark (rounded back, forward head) topped by a flat cap,
long coat flaring to the knees, a red scarf as the single accent colour, big knobbly hands,
skinny legs in baggy trousers, a folding chess case held like a tome.

World frame: feet on z = 0, front = -Y, X = character's left, metres. Modelled in A-pose.
Run:  /root/blender-venv/bin/python chess_master_body.py --out <dir> [--clay] [--iter N]
"""
from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from charkit import sdf as S  # noqa: E402
import chess_master_head as H  # noqa: E402

E = S.ellipsoid
RC = S.round_cone

# =============================================================================================
# Skeleton landmarks (also used by the rig): one place to edit proportions
# =============================================================================================

J = {
    'hips': (0.0, 0.02, 0.88),
    'spine': (0.0, 0.035, 1.0),
    'chest': (0.0, 0.04, 1.17),
    'neck': (0.0, -0.005, 1.34),
    'head': (0.0, -0.045, 1.42),
    'shoulder_L': (0.165, 0.0, 1.3),
    'elbow_L': (0.335, 0.02, 1.1),
    'wrist_L': (0.5, -0.025, 0.915),
    'shoulder_R': (-0.165, 0.0, 1.3),
    'elbow_R': (-0.335, 0.02, 1.1),
    'wrist_R': (-0.5, -0.025, 0.915),
    'thigh_L': (0.09, 0.02, 0.86),
    'knee_L': (0.105, -0.012, 0.47),
    'ankle_L': (0.115, 0.03, 0.085),
    'thigh_R': (-0.09, 0.02, 0.86),
    'knee_R': (-0.105, -0.012, 0.47),
    'ankle_R': (-0.115, 0.03, 0.085),
}
HEAD_T = (0.0, -0.112, 1.482)       # head-local origin (eye line centre) in world space
HEAD_R = S.rot(9, 0, 0)            # chin slightly down: he is reading the board
HEAD_S = 1.3                       # caricature: big head on a slight body (~6.5 heads tall)


def j(name):
    return np.array(J[name], np.float32)


def mid(a, b, t=0.5):
    return j(a) * (1 - t) + j(b) * t


# =============================================================================================
# Body volumes (what the clothes are built on)
# =============================================================================================

def torso_volume() -> S.SDF:
    chest = E((0, 0.0, 1.2), (0.16, 0.115, 0.145))
    hump = E((0, 0.08, 1.27), (0.14, 0.085, 0.11), R=S.rot(-24, 0, 0))
    belly = E((0, -0.03, 1.0), (0.16, 0.125, 0.13))
    pelvis = E((0, 0.02, 0.89), (0.165, 0.12, 0.1))
    shoulders = S.sphere(j('shoulder_L') + np.array([-0.01, -0.005, -0.02], np.float32), 0.058).mirror_x()
    trap = RC(j('neck') + np.array([0.0, 0.025, -0.015], np.float32), j('shoulder_L') + np.array([-0.01, 0.0, -0.01], np.float32), 0.05, 0.05).mirror_x()
    return S.blend(chest, hump, belly, pelvis, shoulders, trap, k=0.06)


# =============================================================================================
# Coat
# =============================================================================================

def sleeves_shape() -> S.SDF:
    """Baggy sleeves (both arms). Also used by the rig to tell sleeve vertices from torso ones."""
    return S.smooth_tube([j('shoulder_L') + np.array([0.015, 0.0, -0.015], np.float32), j('elbow_L'),
                          j('wrist_L') + np.array([0.004, -0.004, 0.018], np.float32)],
                         [0.062, 0.052, 0.046], samples=5, k=0.01).mirror_x()


def coat() -> S.SDF:
    body = S.grow(torso_volume(), 0.022)
    # skirt: hollow cone from the waist to just below the knee, flaring
    profile = [(0.0, 0.33), (0.222, 0.33), (0.21, 0.45), (0.198, 0.6), (0.188, 0.75), (0.184, 0.88), (0.188, 0.97), (0.176, 1.04), (0.0, 1.04)]
    skirt_solid = S.scale(S.lathe(profile), (1.0, 0.8, 1.0))
    skirt_solid = S.place(skirt_solid, t=(0, 0.012, 0))
    skirt = S.shell(skirt_solid, 0.0075)
    skirt = S.intersect(skirt, S.plane((0, 0, 0.33), (0, -0.22, -1)), k=0.004)   # hem, slightly lower at the back
    skirt = S.intersect(skirt, S.plane((0, 0, 1.02), (0, 0, 1)), k=0.01)
    # front opening of the skirt (a narrow wedge from the hem up to the last button)
    slit = S.round_box((0, -0.25, 0.52), (0.04, 0.09, 0.22), 0.01)
    wedge = S.intersect(S.plane((0, 0, 0.0), (1, 0.0, 0.18)), S.plane((0, 0, 0.0), (-1, 0.0, 0.18)))
    skirt = S.carve(skirt, S.intersect(slit, wedge), k=0.004)
    back_vent = S.round_box((0, 0.22, 0.45), (0.006, 0.06, 0.13), 0.004)
    skirt = S.carve(skirt, back_vent, k=0.002)
    torso = body
    sleeves = sleeves_shape()
    cuff = RC(mid('elbow_L', 'wrist_L', 0.84), mid('elbow_L', 'wrist_L', 0.985), 0.05, 0.051).mirror_x()
    coat = S.blend(torso, skirt, k=0.06)
    coat = S.blend(coat, sleeves, k=0.035)
    coat = S.blend(coat, cuff, k=0.004)
    # hollow cuffs so the wrists go in
    coat = S.carve(coat, RC(mid('elbow_L', 'wrist_L', 0.8), mid('elbow_L', 'wrist_L', 1.06), 0.039, 0.041).mirror_x(), k=0.003)
    # big shawl collar
    collar = S.torus((0, -0.01, 1.35), 0.092, 0.036, R=S.rot(-28, 0, 0), sx=1.08, sy=0.92)
    coat = S.blend(coat, collar, k=0.02)
    # front closure: a step where the right panel overlaps the left
    closure = S.round_box((0.006, -0.2, 1.08), (0.0025, 0.08, 0.24), 0.002)
    coat = S.carve(coat, closure, k=0.0015)
    # pocket flaps
    fp = S.snap(coat, [(0.12, -0.3, 0.8)], offset=0.0025)[0]
    fn_ = S.normals(coat, fp[None])[0]
    flap = S.round_box(fp, (0.06, 0.02, 0.003), 0.0025, R=S.look_rot(fn_, up=(0, 0, 1)))
    coat = S.blend(coat, flap.mirror_x(), k=0.003)
    # folds: elbow compression rings, armpit drag, back drape, skirt pipes
    elbow_zone = S.sphere(j('elbow_L'), 0.075).mirror_x()
    elbow_folds = S.masked(S.grooves(j('elbow_L') - j('wrist_L'), 0.03, width=0.35, wobble=0.7, wobble_freq=12, seed=3), elbow_zone, 0.03)
    back_zone = E((0, 0.14, 1.12), (0.13, 0.08, 0.12))
    back_folds = S.masked(S.grooves((1, 0, 0.35), 0.05, width=0.45, wobble=0.5, wobble_freq=6, seed=4), back_zone, 0.05)
    skirt_zone = S.intersect(S.sphere((0, 0.02, 0.42), 0.4), S.plane((0, 0, 0.68), (0, 0, 1)))
    pipes = S.masked(lambda p: 0.5 + 0.5 * np.sin(np.arctan2(p[:, 0], p[:, 1] - 0.02) * 7 + 2.5 * S.perlin(p, 4, 7)), skirt_zone, 0.15)
    sym = lambda f: (lambda p: f(np.concatenate([np.abs(p[:, :1]), p[:, 1:]], axis=1)))
    coat = coat.displace(sym(elbow_folds), -0.0045).displace(back_folds, -0.004).displace(pipes, 0.0035)
    tweed = S.grooves((1, 0, 1), 0.006, width=0.5, wobble=0.1, wobble_freq=40)
    return coat.displace(tweed, -0.0004)


def buttons() -> S.SDF:
    out = []
    coat_shape = coat_cached()
    guide = [(0.018, -0.3, z) for z in (1.22, 1.1, 0.98)]
    pts = S.snap(coat_shape, guide, offset=0.003)
    for p in pts:
        n = S.normals(coat_shape, p[None])[0]
        out.append(S.cylinder(p, 0.013, 0.0035, r=0.0025, R=S.look_rot(n)))
    return S.union(*out)


_COAT = []


def coat_cached():
    if not _COAT:
        _COAT.append(coat())
    return _COAT[0]


def breast_pocket():
    """Patch pocket on the left chest; returns (pocket SDF, top centre, outward normal)."""
    coat_shape = coat_cached()
    c = S.snap(coat_shape, [(-0.095, -0.3, 1.15)], offset=0.003)[0]
    n = S.normals(coat_shape, c[None])[0]
    R = S.look_rot(n, up=(0, 0, 1))
    pocket = S.round_box(c, (0.045, 0.05, 0.004), 0.003, R=R)
    top = c + R @ np.array([0, 0.05, 0], np.float32)
    return pocket, top, n


def pocket_pieces() -> tuple:
    """Ivory knight + ebony bishop + ivory pawn standing in the breast pocket (oversized for
    readability, as hero props usually are)."""
    _, top, n = breast_pocket()
    base = top - np.array([0, 0, 0.055], np.float32) + n * 0.01
    s = 1.55
    ivory = S.union(knight(base + np.array([-0.022, 0.0, 0.0], np.float32), s),
                    piece('pawn', base + np.array([0.026, 0.004, -0.012], np.float32), s))
    ebony = piece('bishop', base + np.array([0.004, 0.006, 0.0], np.float32), s)
    return ivory, ebony


def half_belt() -> S.SDF:
    """Back half-belt with two buttons: the classic overcoat detail, sitting on the waist line."""
    coat_shape = coat_cached()
    pts = S.snap(coat_shape, [(x, 0.3, 0.93) for x in np.linspace(-0.11, 0.11, 7)], offset=0.004)
    belt = S.ribbon(list(pts), 0.042, 0.007, up=(0, 1, 0), k=0.004)
    knobs = []
    for x in (-0.095, 0.095):
        p = S.snap(coat_shape, [(x, 0.3, 0.93)], offset=0.01)[0]
        n = S.normals(coat_shape, p[None])[0]
        knobs.append(S.cylinder(p, 0.011, 0.003, r=0.002, R=S.look_rot(n)))
    return S.union(belt, *knobs)


def elbow_patches() -> S.SDF:
    coat_shape = coat_cached()
    e = j('elbow_L') + np.array([0.02, 0.05, 0.0], np.float32)
    c = S.snap(coat_shape, [e + np.array([0.0, 0.04, 0.0], np.float32)], offset=0.002)[0]
    n = S.normals(coat_shape, c[None])[0]
    axis = j('elbow_L') - j('wrist_L')
    patch = E(c, (0.034, 0.045, 0.004), R=S.look_rot(n, up=axis))
    return patch.mirror_x()


# =============================================================================================
# Scarf (the accent)
# =============================================================================================

def scarf() -> S.SDF:
    loop = S.torus((0, -0.03, 1.37), 0.078, 0.03, R=S.rot(-30, 0, 0), sx=1.08, sy=0.95)
    knot = E((0.035, -0.085, 1.335), (0.04, 0.03, 0.035), R=S.rot(0, 0, 20))
    tail1 = S.ribbon([(0.04, -0.09, 1.33), (0.06, -0.13, 1.24), (0.07, -0.155, 1.1), (0.075, -0.165, 0.95)],
                     lambda t: 0.1 - 0.015 * t, 0.016, up=(0, -1, 0.15), k=0.006)
    tail2 = S.ribbon([(0.02, -0.08, 1.32), (-0.005, -0.13, 1.22), (-0.03, -0.17, 1.1), (-0.04, -0.18, 1.0)],
                     lambda t: 0.095 - 0.01 * t, 0.016, up=(0.1, -1, 0.2), k=0.006)
    s = S.blend(loop, knot, k=0.02)
    s = S.union(s, tail1, tail2)
    knit = S.grooves((0, 0, 1), 0.007, width=0.45, wobble=0.25, wobble_freq=30)
    folds = S.stretched(S.ridged(lambda p: S.perlin(p, 30, 5)), (0, 0, 1), 0.3)
    return s.displace(knit, -0.0012).displace(folds, 0.003)


# =============================================================================================
# Hands (big, knobbly, slightly curled) -- modelled in hand space, placed at the wrists
# =============================================================================================

def hand(curl: float = 0.35, seed: int = 0) -> S.SDF:
    """Left hand in local space: wrist at the origin, fingers along -Z, palm facing +Y... the
    caller orients it. Finger joints get knuckle bulges; curl bends each segment."""
    J_ = S.jitter(500 + seed, 1.0)
    palm = S.round_box((0.0, 0.0, -0.055), (0.043, 0.014, 0.045), 0.012)
    heel = E((0.0, 0.005, -0.02), (0.038, 0.017, 0.025))
    parts = [palm, heel]
    fingers = [(-0.031, 0.044, 0.95), (-0.0105, 0.05, 1.07), (0.0105, 0.048, 1.0), (0.03, 0.04, 0.82)]
    for i, (x, L, s) in enumerate(fingers):
        base = np.array([x, 0.0, -0.098], np.float32)
        segs = [0.42, 0.33, 0.25]
        d = np.array([x * 0.08, 0.0, -1.0], np.float32)
        d /= np.linalg.norm(d)
        p = base
        pts = [p]
        ang = 0.0
        for k, sl in enumerate(segs):
            ang += curl * (0.5 + 0.3 * k) + 0.05 * float(J_(i * 3 + k)[0])
            dirv = np.array([d[0], -np.sin(ang), -np.cos(ang)], np.float32)
            p = p + dirv * (L * 1.45 * sl * s)
            pts.append(p)
        r0 = 0.0105 * (1.0 if i in (1, 2) else 0.92)
        radii = [r0, r0 * 0.93, r0 * 0.85, r0 * 0.72]
        parts.append(S.tube(pts, radii, k=0.0025))
        for k in range(1, 3):  # knuckle bulges (old hands)
            parts.append(S.sphere(pts[k] + np.array([0, 0.003, 0], np.float32), radii[k] * 1.06))
        parts.append(S.sphere(base + np.array([0, 0.004, 0.004], np.float32), r0 * 1.15))
    # thumb
    t0 = np.array([-0.04, 0.01, -0.03], np.float32)
    t1 = t0 + np.array([-0.022, -0.02, -0.03], np.float32)
    t2 = t1 + np.array([-0.006, -0.022, -0.024], np.float32)
    t3 = t2 + np.array([0.004, -0.02, -0.016], np.float32)
    parts.append(S.tube([t0, t1, t2, t3], [0.016, 0.0125, 0.011, 0.0095], k=0.004))
    parts.append(S.sphere(t2, 0.0118))
    h = S.blend(*parts, k=0.008)
    # veins and tendons on the back of the hand (old age)
    veins = S.union(*[S.capsule((x, -0.0155, -0.02), (x * 1.2, -0.0145, -0.09), 0.0022) for x in (-0.022, -0.004, 0.016)])
    h = S.blend(h, veins, k=0.004)
    wrist = RC((0, 0.0, 0.03), (0, 0.0, -0.02), 0.031, 0.034)
    return S.blend(h, wrist, k=0.015)


def hands() -> S.SDF:
    # left hand: hangs from the left wrist, palm facing the thigh (-X), fingers down-forward
    fwd = j('wrist_L') - j('elbow_L')
    fwd = fwd / np.linalg.norm(fwd)
    # local -Z (fingers) -> along the forearm; local +Y (palm) -> towards the body (-X)
    z = -fwd
    yv = np.array([-1.0, 0.0, 0.0], np.float32)
    yv = yv - z * float(yv @ z)
    yv /= np.linalg.norm(yv)
    x = np.cross(yv, z)
    R = np.stack([x, yv, z], axis=1).astype(np.float32)
    left = S.place(hand(0.42, 0), t=j('wrist_L'), R=R, s=1.28)
    return left.mirror_x()


# =============================================================================================
# Legs, shoes
# =============================================================================================

def trousers() -> S.SDF:
    leg = S.smooth_tube([j('thigh_L') + np.array([0, 0, 0.04], np.float32), j('knee_L'), j('ankle_L') + np.array([0, -0.005, 0.03], np.float32)],
                        [0.082, 0.064, 0.056], samples=5, k=0.01)
    hem_break = S.torus(j('ankle_L') + np.array([0, -0.01, 0.035], np.float32), 0.052, 0.008, R=S.rot(8, 0, 0))
    leg = S.blend(leg, hem_break, k=0.016)
    seat = E((0, 0.03, 0.86), (0.17, 0.12, 0.1))
    knee_zone = S.sphere(j('knee_L'), 0.09)
    ankle_zone = S.sphere(j('ankle_L') + np.array([0, 0, 0.06], np.float32), 0.07)
    f1 = S.masked(S.grooves((0, 0.2, 1), 0.03, width=0.4, wobble=0.7, wobble_freq=10, seed=8), knee_zone, 0.04)
    f2 = S.masked(S.grooves((0, -0.3, 1), 0.022, width=0.4, wobble=0.8, wobble_freq=14, seed=9), ankle_zone, 0.03)
    legs = S.blend(leg.mirror_x(), seat, k=0.04)
    sym = lambda p: np.maximum(f1(np.abs(p) * np.array([1, 0, 0], np.float32) + p * np.array([0, 1, 1], np.float32)),
                               f2(np.abs(p) * np.array([1, 0, 0], np.float32) + p * np.array([0, 1, 1], np.float32)))
    return legs.displace(sym, -0.004)


def shoes() -> S.SDF:
    a = j('ankle_L')
    body = S.round_box((a[0] + 0.004, a[1] - 0.06, 0.05), (0.048, 0.115, 0.04), 0.03)
    toe = E((a[0] + 0.006, a[1] - 0.15, 0.04), (0.047, 0.045, 0.034))
    heel = E((a[0], a[1] + 0.035, 0.055), (0.042, 0.04, 0.05))
    upper = S.blend(body, toe, heel, k=0.02)
    upper = S.intersect(upper, S.plane((0, 0, 0.012), (0, 0, -1)), k=0.002)
    opening = E((a[0], a[1] + 0.01, 0.12), (0.04, 0.05, 0.03))
    upper = S.carve(upper, opening, k=0.01)
    lace = S.round_box((a[0] + 0.004, a[1] - 0.085, 0.087), (0.022, 0.04, 0.006), 0.004, R=S.rot(-24, 0, 0))
    return S.blend(upper, lace, k=0.006).mirror_x()


def soles() -> S.SDF:
    shoe = shoes()
    sole = S.intersect(S.grow(shoe, 0.0035), S.plane((0, 0, 0.02), (0, 0, 1)), k=0.002)
    return sole


# =============================================================================================
# The chess case (hard surface) and pieces
# =============================================================================================

PIECES = {
    'pawn': [(0.0, 0.0), (0.016, 0.0), (0.016, 0.004), (0.012, 0.007), (0.007, 0.012), (0.005, 0.024), (0.009, 0.026), (0.009, 0.028),
             (0.0045, 0.03), (0.008, 0.035), (0.0085, 0.04), (0.006, 0.045), (0.0, 0.047)],
    'rook': [(0.0, 0.0), (0.018, 0.0), (0.018, 0.005), (0.013, 0.009), (0.01, 0.03), (0.013, 0.034), (0.013, 0.048), (0.0, 0.048)],
    'bishop': [(0.0, 0.0), (0.017, 0.0), (0.017, 0.004), (0.012, 0.008), (0.006, 0.03), (0.01, 0.033), (0.005, 0.036),
               (0.009, 0.045), (0.008, 0.052), (0.004, 0.057), (0.0025, 0.06), (0.003, 0.062), (0.0, 0.064)],
    'queen': [(0.0, 0.0), (0.019, 0.0), (0.019, 0.005), (0.013, 0.01), (0.0065, 0.04), (0.011, 0.043), (0.0065, 0.047), (0.012, 0.062),
              (0.009, 0.065), (0.004, 0.066), (0.005, 0.07), (0.0, 0.072)],
    'king': [(0.0, 0.0), (0.02, 0.0), (0.02, 0.005), (0.014, 0.01), (0.007, 0.045), (0.012, 0.048), (0.007, 0.052), (0.011, 0.068),
             (0.0, 0.07)],
}


def piece(kind: str, base=(0, 0, 0), scale: float = 1.0) -> S.SDF:
    prof = [(r * scale, z * scale) for r, z in PIECES[kind]]
    p = S.lathe(prof, c=base)
    if kind == 'rook':
        top = np.array(base, np.float32) + np.array([0, 0, 0.048 * scale], np.float32)
        for a in range(4):
            ang = a * np.pi / 2
            notch = S.round_box(top + np.array([np.cos(ang) * 0.01 * scale, np.sin(ang) * 0.01 * scale, 0], np.float32),
                                (0.003 * scale, 0.02 * scale, 0.005 * scale), 0.0005, R=S.rot(0, 0, np.degrees(ang)))
            p = S.carve(p, notch)
    if kind == 'king':
        c = np.array(base, np.float32) + np.array([0, 0, 0.078 * scale], np.float32)
        cross = S.union(S.round_box(c, (0.0022 * scale, 0.0022 * scale, 0.009 * scale), 0.0008),
                        S.round_box(c + np.array([0, 0, 0.002 * scale], np.float32), (0.0065 * scale, 0.0022 * scale, 0.0022 * scale), 0.0008))
        p = S.union(p, cross)
    if kind == 'bishop':
        c = np.array(base, np.float32) + np.array([0.003 * scale, 0, 0.052 * scale], np.float32)
        p = S.carve(p, S.round_box(c, (0.0012 * scale, 0.02 * scale, 0.006 * scale), 0.0004, R=S.rot(0, 35, 0)))
    if kind == 'queen':
        c = np.array(base, np.float32) + np.array([0, 0, 0.064 * scale], np.float32)
        for a in range(8):
            ang = a * np.pi / 4
            p = S.carve(p, S.sphere(c + np.array([np.cos(ang) * 0.0125 * scale, np.sin(ang) * 0.0125 * scale, 0.002 * scale], np.float32), 0.0038 * scale))
    return p


def knight(base=(0, 0, 0), scale: float = 1.0, facing: float = 0.0) -> S.SDF:
    s = scale
    foot = S.lathe([(0.0, 0.0), (0.019 * s, 0.0), (0.019 * s, 0.005 * s), (0.013 * s, 0.01 * s), (0.0, 0.012 * s)], c=base)
    b = np.array(base, np.float32)
    neck = RC(b + np.array([0, 0.002, 0.01], np.float32) * s, b + np.array([0, -0.004, 0.04], np.float32) * s, 0.012 * s, 0.009 * s)
    head = RC(b + np.array([0, -0.002, 0.042], np.float32) * s, b + np.array([0, -0.022, 0.034], np.float32) * s, 0.009 * s, 0.006 * s)
    mane = RC(b + np.array([0, 0.01, 0.015], np.float32) * s, b + np.array([0, 0.004, 0.048], np.float32) * s, 0.006 * s, 0.004 * s)
    ears = S.sphere(b + np.array([0, 0.0, 0.052], np.float32) * s, 0.004 * s)
    k = S.blend(neck, head, mane, ears, k=0.004 * s)
    return S.union(foot, k)


def chess_case() -> tuple:
    """Folding wooden chess case carried like a tome: returns (wood, squares_light, squares_dark,
    brass, pieces) SDFs in prop space (centre of the case at the origin, the board face +Y)."""
    W, Hh, T = 0.2, 0.2, 0.024     # half width, half height, half thickness (closed case)
    wood = S.round_box((0, 0, 0), (W, T, Hh), 0.006)
    seam = S.round_box((0, 0, 0), (W + 0.01, 0.0015, Hh + 0.01), 0.001)
    wood = S.carve(wood, seam, k=0.001)
    # inlaid board on the front face: 8x8 squares as shallow tiles
    sq = (2 * (Hh - 0.02)) / 8
    light, dark = [], []
    for r in range(8):
        for c in range(8):
            x = -Hh + 0.02 + sq * (c + 0.5)
            z = -Hh + 0.02 + sq * (r + 0.5)
            tile = S.round_box((x, -T - 0.0008, z), (sq / 2 - 0.0006, 0.0012, sq / 2 - 0.0006), 0.0006)
            (light if (r + c) % 2 == 0 else dark).append(tile)
    brass = []
    for sx in (-1, 1):
        for sz in (-1, 1):
            brass.append(S.round_box((sx * (W - 0.012), 0, sz * (Hh - 0.012)), (0.016, T + 0.002, 0.016), 0.004))
    handle = S.torus((0, 0, Hh + 0.012), 0.03, 0.006, R=S.rot(90, 0, 0), sy=0.6)
    latch = S.round_box((W + 0.002, 0, 0), (0.006, T * 0.6, 0.02), 0.002)
    brass = S.union(*brass, handle, latch)
    return wood, S.union(*light), S.union(*dark), brass


# =============================================================================================
# Build
# =============================================================================================

def head_parts() -> dict:
    """The head stage parts moved onto the body."""
    out = {}
    for name, (fn, vox, rough, sss) in H.PARTS.items():
        out[name] = (S.place(fn(), t=HEAD_T, R=HEAD_R, s=HEAD_S), vox * HEAD_S, rough, sss)
    return out


def case_transform():
    """Chess case held in the left hand like a tome, pressed against the hip."""
    w = j('wrist_L')
    R = S.rot(0, 0, 50) @ S.rot(0, -8, 0)
    t = w + np.array([0.06, -0.035, -0.11], np.float32)
    return t, R


def looks() -> dict:
    from charkit.paint import Look, Zone
    lk = H.looks()
    lk.update({
        'coat': Look('#4b4535', zones=[Zone(S.plane((0, 0, 0.62), (0, 0, 1)), '#2c2820', 0.55, 0.3),
                                       Zone(S.sphere((0, 0.0, 1.32), 0.2), '#5e5845', 0.35, 0.12)],
                     ao_step=0.02, ao_strength=1.0, ao_tint='#2a2018', cavity=0.55, edge=0.45, curv_scale=0.012, top_light=0.3,
                     pattern=S.grooves((1, 0, 1), 0.008, width=0.5), pattern_color='#463f31', pattern_strength=0.5,
                     stroke_axis=(0, 0, 1), stroke_squash=0.2, stroke_freq=60, stroke_amount=0.06, var_freq=6, var_amount=0.08),
        'buttons': Look('#2b1f18', ao_step=0.004, cavity=0.3, edge=0.6, top_light=0.2),
        'pocket': Look('#4b4535', ao_step=0.006, ao_tint='#2a2018', cavity=0.5, edge=0.5, curv_scale=0.004, top_light=0.3,
                       pattern=S.grooves((1, 0, 1), 0.008, width=0.5), pattern_color='#3c372b', pattern_strength=0.5),
        'halfbelt': Look('#433d2f', ao_step=0.006, ao_tint='#2a2018', cavity=0.5, edge=0.6, curv_scale=0.004, top_light=0.3),
        'patches': Look('#3a261b', ao_step=0.006, ao_tint='#140a06', cavity=0.4, edge=0.7, curv_scale=0.004, top_light=0.35),
        'pieces_ivory': Look('#e8dcc0', ao_step=0.004, ao_tint='#6a5236', cavity=0.6, edge=0.4, curv_scale=0.002, top_light=0.25, stroke_amount=0.02),
        'pieces_ebony': Look('#2a211c', ao_step=0.004, ao_tint='#0a0605', cavity=0.4, edge=0.8, curv_scale=0.002, top_light=0.3, stroke_amount=0.02),
        'scarf': Look('#8f2626', zones=[Zone(S.sphere((0.04, -0.1, 1.3), 0.06), '#a83a2e', 0.3, 0.05)],
                      ao_step=0.012, ao_strength=1.1, ao_tint='#3a0d10', cavity=0.6, edge=0.4, curv_scale=0.008, top_light=0.3,
                      stroke_axis=(0, 0, 1), stroke_squash=0.25, stroke_freq=90, var_freq=10),
        'hands': Look('#d39a7d', zones=[Zone(S.union(*[S.sphere(p, 0.03) for p in [j('wrist_L') + np.array([0.03, -0.03, -0.12], np.float32)]]).mirror_x(), '#c4675a', 0.35, 0.04)],
                      ao_step=0.006, ao_strength=1.1, ao_tint='#6e231f', cavity=0.6, edge=0.4, curv_scale=0.004, top_light=0.25),
        'trousers': Look('#3c3c42', zones=[Zone(S.sphere(j('knee_L'), 0.06).mirror_x(), '#4a4a50', 0.4, 0.05)],
                         ao_step=0.02, ao_strength=1.0, ao_tint='#141420', cavity=0.5, edge=0.45, curv_scale=0.012, top_light=0.3,
                         stroke_axis=(0, 0, 1), stroke_squash=0.2, stroke_freq=60, var_freq=6),
        'shoes': Look('#4b2f22', ao_step=0.01, ao_strength=1.0, ao_tint='#1a0c08', cavity=0.4, edge=0.7, curv_scale=0.008, top_light=0.35),
        'soles': Look('#1d1715', ao_step=0.006, cavity=0.3, edge=0.3),
        'case_wood': Look('#5a3220', ao_step=0.006, ao_tint='#1f0d06', cavity=0.4, edge=0.7, curv_scale=0.004, top_light=0.3,
                          stroke_axis=(1, 0, 0), stroke_squash=0.08, stroke_freq=160, stroke_amount=0.12),
        'case_light': Look('#d9c49a', ao_step=0.004, cavity=0.3, edge=0.3, top_light=0.2, stroke_axis=(1, 0, 0), stroke_squash=0.1, stroke_freq=200),
        'case_dark': Look('#2e1c14', ao_step=0.004, cavity=0.3, edge=0.3, top_light=0.2, stroke_axis=(1, 0, 0), stroke_squash=0.1, stroke_freq=200),
        'case_brass': Look('#b08a3e', ao_step=0.004, ao_tint='#3a2a10', cavity=0.5, edge=0.8, curv_scale=0.003, top_light=0.3),
    })
    return lk


def parts() -> dict:
    """name -> (sdf, voxel, roughness, subsurface, metallic)"""
    P = {}
    for name, (shape, vox, rough, sss) in head_parts().items():
        P[name] = (shape, vox, rough, sss, 0.0)
    P['coat'] = (coat_cached(), 0.0028, 0.85, 0.0, 0.0)
    P['buttons'] = (buttons(), 0.001, 0.4, 0.0, 0.0)
    P['pocket'] = (breast_pocket()[0], 0.0015, 0.85, 0.0, 0.0)
    P['patches'] = (elbow_patches(), 0.0015, 0.5, 0.0, 0.0)
    P['halfbelt'] = (half_belt(), 0.0015, 0.85, 0.0, 0.0)
    ivory, ebony = pocket_pieces()
    P['pieces_ivory'] = (ivory, 0.0006, 0.3, 0.05, 0.0)
    P['pieces_ebony'] = (ebony, 0.0006, 0.3, 0.0, 0.0)
    P['scarf'] = (scarf(), 0.002, 0.9, 0.0, 0.0)
    P['hands'] = (hands(), 0.0012, 0.5, 0.12, 0.0)
    P['trousers'] = (trousers(), 0.0028, 0.85, 0.0, 0.0)
    P['shoes'] = (shoes(), 0.0018, 0.38, 0.0, 0.0)
    P['soles'] = (soles(), 0.002, 0.7, 0.0, 0.0)
    t, R = case_transform()
    wood, light, dark, brass = chess_case()
    P['case_wood'] = (S.place(wood, t=t, R=R), 0.0012, 0.45, 0.0, 0.0)
    P['case_light'] = (S.place(light, t=t, R=R), 0.0008, 0.35, 0.0, 0.0)
    P['case_dark'] = (S.place(dark, t=t, R=R), 0.0008, 0.35, 0.0, 0.0)
    P['case_brass'] = (S.place(brass, t=t, R=R), 0.0008, 0.3, 0.0, 1.0)
    return P


def build(out: str, clay: bool, tag: str, views, samples: int, only=None, width=720, height=1000, lens=60.0, box=None,
          fast: bool = False, rebuild=None) -> list:
    """rebuild: list of part names to re-mesh and re-paint; every other part is loaded from the
    cache written by the previous full build (iterate on one part in a minute, not ten)."""
    import time

    from charkit import paint as Pt
    from charkit import studio as ST

    ST.reset()
    objs = []
    LK = looks()
    t0 = time.time()
    P = parts()
    cache_dir = os.path.join(out, '_parts')
    os.makedirs(cache_dir, exist_ok=True)
    for name, (shape, vox, rough, sss, metal) in P.items():
        if only and name not in only:
            continue
        t = time.time()
        cpath = os.path.join(cache_dir, f'{name}.npz')
        if rebuild is not None and name not in rebuild and os.path.exists(cpath) and not clay and not fast:
            z = np.load(cpath)
            ob = ST.mesh_from_arrays(name, z['v'], z['f'])
            ST.set_vertex_colors(ob, z['c'])
            ST.assign(ob, ST.principled(name, '#ffffff', rough=rough, sss=sss, metal=metal, attr='Col', sss_radius=(1.0, 0.4, 0.25)))
            objs.append(ob)
            print(f'{name}: cached', flush=True)
            continue
        v, f = S.mesh(shape, voxel=vox * (2.0 if fast else 1.0))
        ob = ST.mesh_from_arrays(name, v, f)
        if clay:
            objs.append(ob)
            print(f'{name}: {len(f)} tris in {time.time() - t:.1f}s', flush=True)
            continue
        if name == 'eyes':
            centers = [np.array(HEAD_T) + HEAD_R @ (np.array(c, np.float32) * HEAD_S) for c in [(0.032, -0.051, 0.0), (-0.032, -0.051, 0.0)]]
            target = t_case = case_transform()[0]
            gaze = [target - c for c in centers]
            col = Pt.eye_colors(v, centers, gaze, 0.0125 * HEAD_S)
        else:
            nrm = Pt.mesh_normals(v, f)
            col = Pt.paint(v, nrm, shape, LK[name])
        ST.set_vertex_colors(ob, col)
        if not fast:
            np.savez(cpath, v=v, f=f.astype(np.int32), c=col)
        ST.assign(ob, ST.principled(name, '#ffffff', rough=rough, sss=sss, metal=metal, attr='Col', sss_radius=(1.0, 0.4, 0.25)))
        objs.append(ob)
        print(f'{name}: {len(f)} tris in {time.time() - t:.1f}s', flush=True)
    if not only or 'glasses' in only:
        fr, ln = H.glasses()
        for nm, shp, mat in (('glasses_frame', fr, ST.principled('metal', '#c9a45c', rough=0.3, metal=1.0)),
                             ('glasses_lens', ln, None)):
            v, f = S.mesh(S.place(shp, t=HEAD_T, R=HEAD_R, s=HEAD_S), voxel=0.0005)
            ob = ST.mesh_from_arrays(nm, v, f)
            if mat is None:
                mat = ST.principled('glass', '#ffffff', rough=0.05)
                mat.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1.0
            ST.assign(ob, mat)
            objs.append(ob)
    print(f'meshing+paint total {time.time() - t0:.1f}s', flush=True)
    import bpy
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, f'zugzwang_{tag}.blend'))
    box = box or (np.array([-0.45, -0.3, 0.0]), np.array([0.45, 0.3, 1.66]))
    return ST.review(objs, out, f'body_{tag}', views=views, clay=clay, width=width, height=height, samples=samples, lens=lens, box=box)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--clay', action='store_true')
    ap.add_argument('--iter', default='v1')
    ap.add_argument('--samples', type=int, default=32)
    ap.add_argument('--only', default='')
    ap.add_argument('--fast', action='store_true')
    ap.add_argument('--rebuild', default=None, help='comma list of parts to rebuild; others come from the cache')
    a = ap.parse_args()
    from charkit import studio as ST
    only = [s for s in a.only.split(',') if s] or None
    views = ['front', 'three_quarter', 'side', 'back']
    rebuild = None if a.rebuild is None else [s for s in a.rebuild.split(',') if s]
    paths = build(a.out, a.clay, a.iter, views, a.samples, only=only, fast=a.fast, rebuild=rebuild)
    ST.sheet(paths, os.path.join(a.out, f'body_{a.iter}{"_clay" if a.clay else ""}_sheet.png'),
             labels=['front', '3/4', 'side', 'back'], title=f'Zugzwang {a.iter}', cell_h=640, silhouettes=True)
